"""Every setting the code reads must be discoverable from .env.example (set or commented)."""

import re
from pathlib import Path

from app.core.config import Settings

EXAMPLE = Path(__file__).resolve().parents[2] / ".env.example"


def test_env_example_documents_every_setting():
    text = EXAMPLE.read_text(encoding="utf-8")
    documented = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", text, re.M))
    expected = {name.upper() for name in Settings.model_fields}
    missing = sorted(expected - documented)
    assert not missing, f"Add to .env.example: {missing}"
