from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import User
from app.db.session import get_db
from app.schemas import ApiError, ApiResponse
from app.security import safe_decode_user_id

COOKIE_NAME = "sa_token"
FREE_AI_SUMMARY_DAILY_LIMIT = 1


def get_current_user_optional(
    db: Session = Depends(get_db),
    sa_token: str | None = Cookie(None, alias=COOKIE_NAME),
) -> User | None:
    if not sa_token:
        return None
    user_id = safe_decode_user_id(sa_token)
    if user_id is None:
        return None
    return db.get(User, user_id)


def get_current_user(
    user: User | None = Depends(get_current_user_optional),
) -> User:
    if user is None:
        raise HTTPException(
            status_code=401,
            detail=ApiResponse(
                success=False,
                error=ApiError(code="AUTH_REQUIRED", message="请先登录。", detail=None),
            ).model_dump(),
        )
    return user


def user_has_ai_access(user: User) -> bool:
    until = user.ai_membership_until
    if until is None:
        return False
    now = datetime.now(timezone.utc)
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return until > now


def get_free_ai_summaries_remaining_today(user: User) -> int:
    if user_has_ai_access(user):
        return 0

    last_used = user.free_ai_summary_last_used_at
    if last_used is None:
        return FREE_AI_SUMMARY_DAILY_LIMIT
    if last_used.tzinfo is None:
        last_used = last_used.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    if last_used.date() == now.date():
        return 0
    return FREE_AI_SUMMARY_DAILY_LIMIT


def require_ai_member(
    user: User = Depends(get_current_user),
) -> User:
    if not user_has_ai_access(user):
        raise HTTPException(
            status_code=403,
            detail=ApiResponse(
                success=False,
                error=ApiError(
                    code="MEMBERSHIP_REQUIRED",
                    message="AI 功能需要会员。请先开通 AI 会员。",
                    detail=None,
                ),
            ).model_dump(),
        )
    return user
