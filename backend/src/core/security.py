from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError, VerificationError

ph = PasswordHasher()


def hash_password(password: str) -> str:
    return ph.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    # Argon2 raises on bad match / bad hash / general verify failure. Anything
    # else is unexpected and should surface as a 500 rather than a silent no.
    try:
        ph.verify(hashed_password, password)
        return True
    except (VerifyMismatchError, InvalidHashError, VerificationError):
        return False