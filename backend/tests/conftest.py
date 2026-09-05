"""Test-time configuration.

We DON'T spin up Postgres/Redis/Chroma in unit tests — they cover pure
helpers (cache keys, JWT, tokenization, prompt guard). Integration tests
that need real services can opt in via `-m integration` and their own
docker-compose fixture (out of scope for this scaffold).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Ensure the backend dir is on sys.path so `import src.xxx` works regardless
# of where pytest is invoked from.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Neutralize secret-required paths so `Settings()` never fails to import.
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-only-for-unit-tests")
os.environ.setdefault("REPO_TOKEN_ENCRYPTION_KEY", "")
os.environ.setdefault("ENV", "test")
