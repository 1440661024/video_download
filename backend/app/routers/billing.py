from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import stripe
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from stripe._error import SignatureVerificationError, StripeError as StripeApiError

from app import config
from app.db.models import StripeWebhookEvent, User
from app.db.session import get_db
from app.deps import get_current_user
from app.schemas import ApiError, ApiResponse

router = APIRouter(prefix="/api/billing", tags=["billing"])

stripe.api_key = config.STRIPE_SECRET_KEY


def _checkout_session_marker(session_id: str) -> str:
    return f"checkout_session:{session_id}"


@router.post("/create-checkout-session")
def create_checkout_session(
    user: User = Depends(get_current_user),
):
    if not config.STRIPE_SECRET_KEY:
        return JSONResponse(
            status_code=503,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="STRIPE_NOT_CONFIGURED",
                    message="支付未配置，请稍后重试。",
                    detail=None,
                ),
            ).model_dump(),
        )

    success_url = f"{config.FRONTEND_BASE_URL}/?billing=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{config.FRONTEND_BASE_URL}/?billing=cancel"

    line_items: list[dict]
    if config.STRIPE_PRICE_ID:
        line_items = [{"price": config.STRIPE_PRICE_ID, "quantity": 1}]
    else:
        line_items = [
            {
                "price_data": {
                    "currency": "cny",
                    "unit_amount": config.STRIPE_MEMBERSHIP_CNY_MINOR_UNITS,
                    "product_data": {
                        "name": "AI 会员（30 天）",
                        "description": "解锁 AI 总结、思维导图、字幕与问答等功能",
                    },
                },
                "quantity": 1,
            }
        ]

    idempotency_key = f"checkout-{user.id}-{uuid.uuid4().hex}"[:255]

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            success_url=success_url,
            cancel_url=cancel_url,
            line_items=line_items,
            client_reference_id=str(user.id),
            customer_email=user.email,
            metadata={"user_id": str(user.id), "product": "ai_membership_30d"},
            idempotency_key=idempotency_key,
        )
    except StripeApiError as exc:
        return JSONResponse(
            status_code=502,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="STRIPE_ERROR",
                    message="创建支付会话失败，请稍后重试。",
                    detail=str(exc),
                ),
            ).model_dump(),
        )

    return ApiResponse(
        success=True,
        data={"checkout_url": session.url, "session_id": session.id},
    )


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    if not config.STRIPE_WEBHOOK_SECRET or not config.STRIPE_SECRET_KEY:
        return JSONResponse(
            status_code=503,
            content={"error": "Webhook not configured"},
        )

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    if not sig_header:
        return JSONResponse(status_code=400, content={"error": "Missing signature"})

    try:
        event = stripe.Webhook.construct_event(
            payload,
            sig_header,
            config.STRIPE_WEBHOOK_SECRET,
        )
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "Invalid payload"})
    except SignatureVerificationError:
        return JSONResponse(status_code=400, content={"error": "Invalid signature"})

    event_id = event.id
    event_type = event.type
    data_object = event.data.object

    try:
        db.add(StripeWebhookEvent(id=event_id))
        db.flush()
    except IntegrityError:
        db.rollback()
        return JSONResponse(content={"received": True, "duplicate": True})

    if event_type == "checkout.session.completed":
        _apply_checkout_completed(db, data_object)

    db.commit()
    return JSONResponse(content={"received": True})


def _apply_checkout_completed(db: Session, session_obj: object) -> None:
    if isinstance(session_obj, dict):
        session_id = session_obj.get("id")
        payment_status = session_obj.get("payment_status")
        mode = session_obj.get("mode")
        meta = session_obj.get("metadata") or {}
        ref = session_obj.get("client_reference_id")
    else:
        session_id = getattr(session_obj, "id", None)
        payment_status = getattr(session_obj, "payment_status", None)
        mode = getattr(session_obj, "mode", None)
        raw_meta = getattr(session_obj, "metadata", None)
        if isinstance(raw_meta, dict):
            meta = raw_meta
        elif hasattr(raw_meta, "to_dict"):
            meta = raw_meta.to_dict()
        else:
            meta = {}
        ref = getattr(session_obj, "client_reference_id", None)

    if payment_status != "paid" or mode != "payment":
        return
    if not session_id:
        return

    uid_raw = meta.get("user_id") or ref
    if not uid_raw:
        return

    try:
        user_id = int(uid_raw)
    except (TypeError, ValueError):
        return

    user = db.get(User, user_id)
    if user is None:
        return

    if db.get(StripeWebhookEvent, _checkout_session_marker(str(session_id))) is not None:
        return
    db.add(StripeWebhookEvent(id=_checkout_session_marker(str(session_id))))
    db.flush()

    now = datetime.now(timezone.utc)
    current = user.ai_membership_until
    base = max(current, now) if current is not None else now
    user.ai_membership_until = base + timedelta(days=config.AI_MEMBERSHIP_DAYS)


@router.get("/checkout-session/{session_id}")
def get_checkout_session_status(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Optional: confirm payment client-side after redirect (Stripe is source of truth via webhook)."""
    if not config.STRIPE_SECRET_KEY:
        return JSONResponse(
            status_code=503,
            content=ApiResponse(
                success=False,
                error=ApiError(code="STRIPE_NOT_CONFIGURED", message="支付未配置。", detail=None),
            ).model_dump(),
        )
    try:
        sess = stripe.checkout.Session.retrieve(session_id)
    except StripeApiError:
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(code="SESSION_NOT_FOUND", message="会话无效。", detail=None),
            ).model_dump(),
        )

    raw_meta = getattr(sess, "metadata", None)
    if isinstance(raw_meta, dict):
        meta = raw_meta
    elif hasattr(raw_meta, "to_dict"):
        meta = raw_meta.to_dict()
    else:
        meta = {}
    if str(meta.get("user_id", "")) != str(user.id):
        return JSONResponse(
            status_code=403,
            content=ApiResponse(
                success=False,
                error=ApiError(code="SESSION_FORBIDDEN", message="无权查看该会话。", detail=None),
            ).model_dump(),
        )

    if sess.payment_status == "paid" and sess.status in {"complete", "paid"}:
        _apply_checkout_completed(db, sess)
        db.commit()

    return ApiResponse(
        success=True,
        data={
            "payment_status": sess.payment_status,
            "status": sess.status,
        },
    )
