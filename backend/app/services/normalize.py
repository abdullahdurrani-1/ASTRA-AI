"""Text normalization for Urdu/English matching and search.

`normalize_urdu` is safe for display (it only unifies equivalent code points).
`match_key` is lossy (strips diacritics, punctuation, case, repeated letters) and must only be
used for matching, never for text shown to the user.
"""

import re
import unicodedata

# Arabic code points that look the same as the Urdu ones but break exact matching.
_UNIFY = str.maketrans(
    {
        "ي": "ی",  # Arabic Yeh -> Farsi/Urdu Yeh
        "ى": "ی",  # Alef Maksura -> Urdu Yeh
        "ك": "ک",  # Arabic Kaf -> Keheh
        "ە": "ہ",  # Ae -> Heh Goal
        "ـ": None,  # tatweel (kashida) is decoration only
    }
)
# Harakat, superscript alef and Quranic marks: optional in Urdu, dropped for search only.
_DIACRITICS = re.compile("[ً-ٰٟۖ-ۭ]")
_JOINERS = re.compile("[‌‍‎‏]")
_REPEATS = re.compile(r"(.)\1+")
# A token is a run of letters/digits plus the combining marks used in Urdu words.
TOKEN = re.compile("[\\wً-ٰٟۖ-ۭ‌‍]+")


def normalize_urdu(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(_UNIFY)


def strip_diacritics(text: str) -> str:
    return _DIACRITICS.sub("", text)


def match_key(token: str) -> str:
    """Aggressive key for lexicon matching: 'Hellooo' -> 'helo', 'السّلام' -> 'السلام'."""
    t = strip_diacritics(normalize_urdu(token))
    t = _JOINERS.sub("", t).casefold().replace("_", "")
    # Arabic Heh is often typed for Urdu Heh Goal; unify only for matching.
    t = t.replace("ه", "ہ")
    return _REPEATS.sub(r"\1", t)


def tokens_with_spans(text: str) -> list[tuple[str, int, int]]:
    """(match_key, start, end) for each word in the original text."""
    out = []
    for m in TOKEN.finditer(text):
        key = match_key(m.group(0))
        if key:
            out.append((key, m.start(), m.end()))
    return out
