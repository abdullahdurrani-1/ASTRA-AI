"""Pull one string field out of a JSON object while it is still being streamed.

The grounded answer is a JSON object {"status": ..., "answer": "...", "citations": [...]}. Users
should see the answer text appear as the model writes it, without waiting for the closing brace.
"""

import json


class StringFieldExtractor:
    """Feed raw chunks; get back decoded pieces of the named string field as they arrive."""

    def __init__(self, field: str = "answer"):
        self._marker = f'"{field}"'
        self.raw = ""
        self._pos = 0  # how much of raw has been scanned
        self._state = "seek"  # seek -> colon -> quote -> inside -> done
        self._escape = ""  # pending escape sequence while inside the string
        self._high = ""  # a decoded high surrogate waiting for its low half
        self.complete = False
        self.text = ""

    def feed(self, chunk: str) -> str:
        self.raw += chunk
        out: list[str] = []
        while self._pos < len(self.raw) and not self.complete:
            if self._state == "seek":
                idx = self.raw.find(self._marker, self._pos)
                if idx < 0:
                    # Keep the tail in case the marker is split across chunks.
                    self._pos = max(self._pos, len(self.raw) - len(self._marker))
                    break
                self._pos = idx + len(self._marker)
                self._state = "colon"
            elif self._state == "colon":
                ch = self.raw[self._pos]
                self._pos += 1
                if ch == ":":
                    self._state = "quote"
                elif not ch.isspace():
                    self._state = "seek"
            elif self._state == "quote":
                ch = self.raw[self._pos]
                self._pos += 1
                if ch == '"':
                    self._state = "inside"
                elif not ch.isspace():
                    self._state = "seek"  # not a string value
            else:  # inside
                ch = self.raw[self._pos]
                if self._escape:
                    self._escape += ch
                    self._pos += 1
                    decoded = _decode_escape(self._escape)
                    if decoded is not None:
                        self._escape = ""
                        # Astral characters (emoji) arrive as two \u escapes; join them.
                        if self._high:
                            pair = self._high + decoded
                            self._high = ""
                            if len(decoded) == 1 and 0xDC00 <= ord(decoded) <= 0xDFFF:
                                out.append(pair.encode("utf-16", "surrogatepass").decode("utf-16"))
                                continue
                            out.append("\ufffd")
                        if len(decoded) == 1 and 0xD800 <= ord(decoded) <= 0xDBFF:
                            self._high = decoded
                        else:
                            out.append(decoded)
                    elif len(self._escape) > 6:
                        out.append(self._escape)  # malformed; show it rather than hang
                        self._escape = ""
                elif ch == "\\":
                    self._escape = ch
                    self._pos += 1
                elif ch == '"':
                    self._pos += 1
                    self.complete = True
                    if self._high:
                        out.append("\ufffd")
                        self._high = ""
                else:
                    out.append(ch)
                    self._pos += 1
        piece = "".join(out)
        self.text += piece
        return piece


def _decode_escape(seq: str) -> str | None:
    """Decode a JSON escape once it is complete; None while more characters are needed."""
    if len(seq) < 2:
        return None
    if seq[1] == "u":
        if len(seq) < 6:
            return None
        try:
            return json.loads(f'"{seq}"')
        except ValueError:
            return seq
    try:
        return json.loads(f'"{seq}"')
    except ValueError:
        return seq
