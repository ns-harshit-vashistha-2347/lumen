from __future__ import annotations

from functools import lru_cache
from cryptography.fernet import Fernet, InvalidToken
from src.core.config import settings

class TokenCryptoError(RuntimeError):
    pass


@lru_cache
def _fernet() -> Fernet:
    key = settings.REPO_TOKEN_ENCRYPTION_KEY
    if not key:
        raise TokenCryptoError(
            "REPO_TOKEN_ENCRYPTION_KEY is not set. Generate one with: "
            "python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )

    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as exc:
        raise TokenCryptoError(f"Invalid Fernet key: {exc}") from exc


def encrypt_token(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise TokenCryptoError("Failed to decrypt token (key rotation? corruption?)") from exc

    
