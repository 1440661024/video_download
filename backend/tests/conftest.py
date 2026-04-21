"""Pytest configuration: isolate DB and JWT before importing the app."""

from __future__ import annotations

import os
import tempfile
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

_tmp_db = Path(tempfile.mkdtemp()) / "pytest_app.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_db.as_posix()}"
os.environ["JWT_SECRET"] = "pytest-jwt-secret-do-not-use-in-production"
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_placeholder_not_used_in_unit_tests")

from app.db.models import StripeWebhookEvent, User  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.deps import COOKIE_NAME  # noqa: E402
from app.main import app  # noqa: E402
from app.security import create_access_token, hash_password  # noqa: E402


@pytest.fixture
def member_client() -> Generator[TestClient, None, None]:
    """Logged-in user with active AI membership and HttpOnly cookie set."""
    with TestClient(app) as client:
        db = SessionLocal()
        db.execute(delete(StripeWebhookEvent))
        db.execute(delete(User))
        db.commit()
        user = User(
            email="member@example.test",
            password_hash=hash_password("testpass123"),
            ai_membership_until=datetime.now(timezone.utc) + timedelta(days=30),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        db.close()
        token = create_access_token(user_id=user.id)
        client.cookies.set(COOKIE_NAME, token)
        yield client
