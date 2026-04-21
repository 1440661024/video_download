from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import (
    COOKIE_NAME,
    get_current_user_optional,
    get_free_ai_summaries_remaining_today,
    user_has_ai_access,
)
from app.db.models import User
from app.db.session import get_db
from app.schemas import ApiError, ApiResponse, LoginRequest, RegisterRequest, UserPublic
from app import config
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _to_public(user: User) -> UserPublic:
    until = user.ai_membership_until
    is_member = user_has_ai_access(user)
    until_iso = until.isoformat() if until else None
    return UserPublic(
        id=user.id,
        email=user.email,
        is_ai_member=is_member,
        ai_membership_until=until_iso,
        free_ai_summaries_remaining_today=get_free_ai_summaries_remaining_today(user),
    )


@router.post("/register")
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    try:
        user = User(
            email=str(payload.email).lower().strip(),
            password_hash=hash_password(payload.password),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(code="EMAIL_TAKEN", message="该邮箱已注册，请直接登录。", detail=None),
            ).model_dump(),
        )

    token = create_access_token(user_id=user.id)
    response = JSONResponse(
        content=ApiResponse(success=True, data=_to_public(user).model_dump()).model_dump(),
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        max_age=60 * 60 * 24 * 7,
        samesite="lax",
        path="/",
        secure=config.COOKIE_SECURE,
    )
    return response


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    email = str(payload.email).lower().strip()
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.password_hash):
        return JSONResponse(
            status_code=401,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INVALID_CREDENTIALS", message="邮箱或密码错误。", detail=None),
            ).model_dump(),
        )
    token = create_access_token(user_id=user.id)
    response = JSONResponse(
        content=ApiResponse(success=True, data=_to_public(user).model_dump()).model_dump(),
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        max_age=60 * 60 * 24 * 7,
        samesite="lax",
        path="/",
        secure=config.COOKIE_SECURE,
    )
    return response


@router.post("/logout")
def logout():
    response = JSONResponse(content=ApiResponse(success=True, data={"ok": True}).model_dump())
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return response


@router.get("/me")
def me(user: User | None = Depends(get_current_user_optional)):
    if user is None:
        return ApiResponse(success=True, data=None)
    return ApiResponse(success=True, data=_to_public(user).model_dump())
