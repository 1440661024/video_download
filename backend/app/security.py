from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app import config


def hash_password(plain: str) -> str:
    digest = bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12))
    return digest.decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False


def create_access_token(*, user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=config.JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])


def safe_decode_user_id(token: str) -> int | None:
    try:
        payload = decode_token(token)
        sub = payload.get("sub")
        if sub is None:
            return None
        return int(sub)
    except (JWTError, TypeError, ValueError):
        return None
