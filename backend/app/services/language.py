import re
from typing import Literal

Lang = Literal["en", "ur"]

_ARABIC_SCRIPT = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def detect_language(text: str) -> Lang:
    """Script-based detection: good enough to choose between English and Urdu (Arabic script)."""
    letters = _LETTER.findall(text)
    if not letters:
        return "en"
    arabic = sum(1 for ch in letters if _ARABIC_SCRIPT.match(ch))
    return "ur" if arabic / len(letters) >= 0.3 else "en"


def resolve_answer_language(requested: str, question: str) -> Lang:
    if requested in ("en", "ur"):
        return requested  # type: ignore[return-value]
    return detect_language(question)


INSUFFICIENT_EVIDENCE: dict[Lang, str] = {
    "en": (
        "I couldn't find enough information about that in your uploaded document. "
        "I don't want to give you an unsupported answer. You can upload another source "
        "or ask about a topic the document covers."
    ),
    "ur": (
        "مجھے آپ کی اپ لوڈ کردہ دستاویز میں اس بارے میں کافی معلومات نہیں ملیں۔ "
        "بغیر ثبوت کے جواب دینا مناسب نہیں ہوگا۔ آپ کوئی اور ماخذ اپ لوڈ کر سکتے ہیں "
        "یا ایسے موضوع کے بارے میں پوچھ سکتے ہیں جو دستاویز میں شامل ہو۔"
    ),
}

GENERATION_ERROR: dict[Lang, str] = {
    "en": "Sorry, I couldn't generate an answer right now. Please try again in a moment.",
    "ur": "معذرت، اس وقت جواب تیار نہیں ہو سکا۔ براہ کرم کچھ دیر بعد دوبارہ کوشش کریں۔",
}
