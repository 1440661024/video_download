from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import app
from app.routers import billing


def test_auth_register_login_logout_flow():
    with TestClient(app) as client:
        register_response = client.post(
            "/api/auth/register",
            json={"email": "newuser@example.com", "password": "password123"},
        )
        assert register_response.status_code == 200
        register_payload = register_response.json()
        assert register_payload["success"] is True
        assert register_payload["data"]["email"] == "newuser@example.com"
        assert register_payload["data"]["is_ai_member"] is False

        me_response = client.get("/api/auth/me")
        me_payload = me_response.json()
        assert me_response.status_code == 200
        assert me_payload["success"] is True
        assert me_payload["data"]["email"] == "newuser@example.com"

        logout_response = client.post("/api/auth/logout")
        assert logout_response.status_code == 200

        me_after_logout = client.get("/api/auth/me")
        assert me_after_logout.status_code == 200
        assert me_after_logout.json()["data"] is None

        login_response = client.post(
            "/api/auth/login",
            json={"email": "newuser@example.com", "password": "password123"},
        )
        assert login_response.status_code == 200
        assert login_response.json()["success"] is True


def test_create_checkout_session_requires_login():
    with TestClient(app) as client:
        response = client.post("/api/billing/create-checkout-session")
        assert response.status_code == 401
        payload = response.json()
        assert payload["success"] is False
        assert payload["error"]["code"] == "AUTH_REQUIRED"


def test_create_checkout_session_success(monkeypatch):
    with TestClient(app) as client:
        register_response = client.post(
            "/api/auth/register",
            json={"email": "payuser@example.com", "password": "password123"},
        )
        assert register_response.status_code == 200

        monkeypatch.setattr(
            billing.stripe.checkout.Session,
            "create",
            lambda **kwargs: SimpleNamespace(url="https://checkout.stripe.test/session", id="cs_test_123"),
        )
        response = client.post("/api/billing/create-checkout-session")
        assert response.status_code == 200
        payload = response.json()
        assert payload["success"] is True
        assert payload["data"]["checkout_url"] == "https://checkout.stripe.test/session"
        assert payload["data"]["session_id"] == "cs_test_123"


def test_checkout_session_status_grants_membership_when_paid(monkeypatch):
    with TestClient(app) as client:
        register_response = client.post(
            "/api/auth/register",
            json={"email": "paiduser@example.com", "password": "password123"},
        )
        assert register_response.status_code == 200
        user_id = register_response.json()["data"]["id"]

        paid_session = SimpleNamespace(
            id="cs_paid_123",
            payment_status="paid",
            status="complete",
            mode="payment",
            metadata={"user_id": str(user_id)},
            client_reference_id=str(user_id),
        )
        monkeypatch.setattr(
            billing.stripe.checkout.Session,
            "retrieve",
            lambda session_id: paid_session,
        )

        response = client.get("/api/billing/checkout-session/cs_paid_123")
        assert response.status_code == 200
        payload = response.json()
        assert payload["success"] is True
        assert payload["data"]["payment_status"] == "paid"

        me_response = client.get("/api/auth/me")
        me_payload = me_response.json()
        assert me_response.status_code == 200
        assert me_payload["data"]["is_ai_member"] is True


def test_checkout_session_status_does_not_double_grant_membership(monkeypatch):
    with TestClient(app) as client:
        register_response = client.post(
            "/api/auth/register",
            json={"email": "repeatpaid@example.com", "password": "password123"},
        )
        assert register_response.status_code == 200
        user_id = register_response.json()["data"]["id"]

        paid_session = SimpleNamespace(
            id="cs_paid_repeat",
            payment_status="paid",
            status="complete",
            mode="payment",
            metadata={"user_id": str(user_id)},
            client_reference_id=str(user_id),
        )
        monkeypatch.setattr(
            billing.stripe.checkout.Session,
            "retrieve",
            lambda session_id: paid_session,
        )

        first = client.get("/api/billing/checkout-session/cs_paid_repeat")
        assert first.status_code == 200
        me_after_first = client.get("/api/auth/me").json()["data"]["ai_membership_until"]

        second = client.get("/api/billing/checkout-session/cs_paid_repeat")
        assert second.status_code == 200
        me_after_second = client.get("/api/auth/me").json()["data"]["ai_membership_until"]
        assert me_after_first == me_after_second
