import time

import pytest

from src.core.jwt import (
    JWTError,
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_refresh_token,
)


def test_access_token_roundtrip_carries_subject_and_claims():
    tok = create_access_token(subject="user-123", extra_claims={"email": "a@b.co"})
    payload = decode_access_token(tok)
    assert payload["sub"] == "user-123"
    assert payload["email"] == "a@b.co"
    assert payload["type"] == "access"


def test_refresh_token_hash_is_stable_and_matches_generator():
    raw, digest, exp = generate_refresh_token()
    assert hash_refresh_token(raw) == digest
    assert exp.timestamp() > time.time()


def test_decode_rejects_wrong_token_type():
    # Craft a token that looks like an access token but with a different type
    from jose import jwt
    from src.core.config import settings

    bad = jwt.encode(
        {"sub": "x", "type": "refresh", "exp": int(time.time()) + 60},
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )
    with pytest.raises(JWTError):
        decode_access_token(bad)
