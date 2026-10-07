import base64
import hashlib
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.chatgpt import AskInput, CALLBACK, ISSUER, PLAN_SCOPES, RESOURCE, ChatGPTConnection
from backend.main import create_app


@pytest.fixture
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_connection(tmp_path, signing_key, *, scopes=None, claims_override=None, events=None):
    requests = []
    pending_claims = {}

    def handler(request):
        requests.append(request)
        if request.url.path.endswith("jwks.json"):
            key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key()))
            return httpx.Response(200, json={"keys": [{**key, "kid": "test-key", "alg": "RS256", "use": "sig"}]})
        if request.url.path.endswith("oauth/token"):
            form = parse_qs(request.content.decode())
            claims = {"sub": "user-1", "email": "test@example.invalid", "iss": ISSUER, "aud": "oaiapp_test",
                      "exp": int(time.time()) + 3600, "iat": int(time.time()), **pending_claims, **(claims_override or {})}
            token = jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "test-key"})
            return httpx.Response(200, json={"id_token": token, "access_token": "test-access", "refresh_token": "rotated-refresh",
                "expires_in": 3600, "token_type": "Bearer", "scope": scopes if scopes is not None else "openid resource.invoke chatgpt.tokens.use.direct offline_access"})
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"models": [{"slug": "available-model", "display_name": "Available model", "visibility": "list"},
                                                       {"slug": "hidden-model", "display_name": "Hidden", "visibility": "hidden"}]})
        if request.url.path == "/v1/responses":
            event_list = events if events is not None else [
                {"type": "response.output_text.delta", "delta": json.dumps({"explanation": "Consider a cache.", "graph": None})},
                {"type": "response.completed"}]
            content = "".join("data: " + json.dumps(item) + "\n\n" for item in event_list)
            return httpx.Response(200, content=content, headers={"content-type": "text/event-stream"})
        if request.url.path.endswith("openid-configuration"):
            return httpx.Response(200, json={"revocation_endpoint": ISSUER + "/api/accounts/oauth/revoke"})
        if request.url.path.endswith("oauth/revoke"):
            return httpx.Response(200)
        raise AssertionError(f"Unexpected request: {request.url.path}")

    connection = ChatGPTConnection(tmp_path / "credentials", httpx.MockTransport(handler))

    def authorize(account=None):
        url, state = connection.start(account)
        parameters = parse_qs(urlparse(url).query)
        pending_claims["nonce"] = parameters["nonce"][0]
        connection.callback({"code": "disposable-code", "state": state, "client_id": "oaiapp_test"}, state)
        return parameters

    return connection, authorize, requests, pending_claims


def test_registration_pkce_identity_protected_storage_and_no_token_leak(tmp_path, signing_key):
    connection, authorize, requests, _ = make_connection(tmp_path, signing_key)
    parameters = authorize()
    assert parameters["client_id"] == ["dynamic_agent_client"]
    assert parameters["agent_name_hint"] == ["System Design Studio"]
    assert parameters["redirect_uri"] == [CALLBACK]
    assert parameters["resource"] == [RESOURCE]
    assert PLAN_SCOPES.issubset(parameters["scope"][0].split())
    exchange = next(request for request in requests if request.url.path.endswith("oauth/token"))
    form = parse_qs(exchange.content.decode())
    verifier = form["code_verifier"][0]
    assert parameters["code_challenge"] == [base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")]
    assert form["client_id"] == ["oaiapp_test"]
    assert form["redirect_uri"] == [CALLBACK]
    assert os.stat(connection.directory / "connection.json").st_mode & 0o777 == 0o600
    assert os.stat(connection.directory).st_mode & 0o777 == 0o700
    assert connection.status()["plan_enabled"] is True
    public = json.dumps(connection.status())
    assert "test-access" not in public and "rotated-refresh" not in public and "id_token" not in public
    host = connection.read()["host_id"]
    restarted = ChatGPTConnection(connection.directory, connection.transport)
    assert restarted.status()["connected"]
    reauth, _ = restarted.start("oaiapp_test")
    query = parse_qs(urlparse(reauth).query)
    assert query["client_id"] == ["oaiapp_test"]
    assert query["ext_agent_host_id"] == [host]
    assert "agent_name_hint" not in query
    assert "id_token_hint" in query


@pytest.mark.parametrize("overrides", [{"nonce": "wrong"}, {"iss": "https://attacker.invalid"}, {"aud": "different-client"}, {"exp": 1}])
def test_untrusted_identity_never_replaces_credentials(tmp_path, signing_key, overrides):
    connection, authorize, _, _ = make_connection(tmp_path, signing_key, claims_override=overrides)
    with pytest.raises((ValueError, jwt.PyJWTError)):
        authorize()
    assert not connection.status()["connected"]


def test_state_cookie_expiry_and_registration_binding(tmp_path, signing_key):
    connection, authorize, requests, _ = make_connection(tmp_path, signing_key)
    _, state = connection.start(None)
    with pytest.raises(HTTPException):
        connection.callback({"state": state, "code": "code", "client_id": "oaiapp_test"}, "wrong")
    assert requests == []
    connection.pending[state]["expires"] = 0
    with pytest.raises(HTTPException):
        connection.callback({"state": state, "code": "code", "client_id": "oaiapp_test"}, state)
    authorize()
    _, state = connection.start("oaiapp_test")
    with pytest.raises(HTTPException):
        connection.callback({"state": state, "code": "code", "client_id": "different-client"}, state)
    assert connection.status()["active"] == "oaiapp_test"


def test_granted_scopes_not_callback_claims_control_plan_access(tmp_path, signing_key):
    connection, authorize, _, _ = make_connection(tmp_path, signing_key, scopes="openid email")
    authorize()
    assert connection.status()["connected"] and not connection.status()["plan_enabled"]
    with pytest.raises(HTTPException) as error:
        connection.active_token()
    assert error.value.status_code == 403


def test_refresh_is_serialized_and_disconnect_retains_registration(tmp_path, signing_key):
    connection, authorize, requests, _ = make_connection(tmp_path, signing_key)
    authorize()
    data = connection.read()
    data["accounts"]["oaiapp_test"]["expires_at"] = 0
    connection.write(data)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(lambda _: connection.active_token(), range(2))) == ["test-access", "test-access"]
    refreshes = [request for request in requests if b"grant_type=refresh_token" in request.content]
    assert len(refreshes) == 1
    assert connection.read()["accounts"]["oaiapp_test"]["refresh_token"] == "rotated-refresh"
    result = connection.disconnect()
    assert not result["connected"]
    saved = connection.read()["accounts"]["oaiapp_test"]
    assert saved["subject"] == "user-1" and not any(key in saved for key in ["access_token", "refresh_token", "id_token"])
    assert result["accounts"][0]["id"] == "oaiapp_test"


def test_model_catalog_and_successful_inference_use_plan_contract(tmp_path, signing_key):
    connection, authorize, requests, _ = make_connection(tmp_path, signing_key)
    authorize()
    assert connection.models() == [{"id": "available-model", "name": "Available model"}]
    result = connection.ask(AskInput(model="available-model", prompt="Review", diagram={"title": "Test", "context": {"brief": "100M reads"}}))
    assert result == {"explanation": "Consider a cache.", "graph": None}
    inference = next(request for request in requests if request.url.path == "/v1/responses")
    body = json.loads(inference.content)
    assert body["store"] is False and body["stream"] is True
    assert isinstance(body["input"], list) and "100M reads" in body["input"][0]["content"]
    assert inference.headers["authorization"] == "Bearer test-access"
    assert not {"temperature", "max_output_tokens", "background", "previous_response_id"} & body.keys()


@pytest.mark.parametrize("events", [
    [{"type": "response.output_text.delta", "delta": '{"explanation":"partial","graph":null}'}],
    [{"type": "response.failed", "response": {"error": {"code": "subscription_sharing_usage_limit_exceeded"}}}],
    [{"type": "response.output_text.delta", "delta": '{"explanation":"bad","graph":{"nodes":[],"edges":[{"id":"bad","source":"missing","target":"missing"}]}}'}, {"type": "response.completed"}],
])
def test_incomplete_failed_and_invalid_proposals_are_rejected(tmp_path, signing_key, events):
    connection, authorize, _, _ = make_connection(tmp_path, signing_key, events=events)
    authorize()
    with pytest.raises(HTTPException) as error:
        connection.ask(AskInput(model="available-model", prompt="Review", diagram={}))
    assert error.value.status_code == 502


def test_inference_logs_content_without_oauth_credentials(tmp_path, signing_key, caplog):
    connection, authorize, _, _ = make_connection(tmp_path, signing_key)
    authorize()
    with caplog.at_level(logging.INFO, logger="uvicorn.error.chatgpt"):
        connection.ask(AskInput(model="available-model", prompt="Review my cache",
                                 diagram={"title": "Logging example", "context": {"brief": "100M reads"}}))
    records = [record for record in caplog.records if record.name == "uvicorn.error.chatgpt"]
    assert len(records) == 2
    request, response = [record.getMessage() for record in records]
    assert "Review my cache" in request and "100M reads" in request
    assert "You help design software systems" in request
    assert "Consider a cache." in response and "elapsed_ms=" in response
    assert records[0].args[0] == records[1].args[0]
    for secret in ("test-access", "rotated-refresh", "disposable-code", "Authorization", "Bearer"):
        assert secret not in caplog.text


def test_inference_failure_logs_only_safe_error_metadata(tmp_path, signing_key, caplog):
    connection, authorize, _, _ = make_connection(tmp_path, signing_key)
    authorize()

    def fail(request):
        raise httpx.ReadError("Authorization: Bearer secret-from-exception", request=request)

    connection.transport = httpx.MockTransport(fail)
    with caplog.at_level(logging.INFO, logger="uvicorn.error.chatgpt"):
        with pytest.raises(httpx.ReadError):
            connection.ask(AskInput(model="available-model", prompt="Review", diagram={}))
    assert "ChatGPT failure" in caplog.text and "error=ReadError" in caplog.text
    assert "ChatGPT response" not in caplog.text
    assert "secret-from-exception" not in caplog.text and "test-access" not in caplog.text


def test_routes_reject_foreign_hosts_and_origins_and_redact_callback_query(tmp_path, signing_key):
    connection, _, _, pending_claims = make_connection(tmp_path, signing_key)
    app = create_app(f"sqlite:///{tmp_path / 'api.db'}", chatgpt_connection=connection)
    captured = []

    @app.middleware("http")
    async def inspect_scope(request, call_next):
        response = await call_next(request)
        captured.append(request.scope.get("query_string"))
        return response

    with TestClient(app, base_url="http://127.0.0.1:8000") as client:
        assert client.post("/api/chatgpt/connect", json={}, headers={"origin": "https://attacker.invalid"}).status_code == 403
        assert client.post("/api/chatgpt/connect", json={}, headers={"host": "attacker.invalid"}).status_code == 403
        assert client.post("/api/chatgpt/connect", content="{}").status_code == 415
        start = client.post("/api/chatgpt/connect", json={})
        params = parse_qs(urlparse(start.json()["url"]).query)
        pending_claims["nonce"] = params["nonce"][0]
        callback = client.get("/api/chatgpt/callback", params={"state": params["state"][0], "code": "secret-code", "client_id": "oaiapp_test"})
        assert callback.status_code == 200
        assert captured[-1] == b""
        assert "secret-code" not in callback.text
        assert callback.headers["cache-control"] == "no-store"
        assert client.get("/api/chatgpt/status").json()["plan_enabled"]
        assert client.post("/api/chatgpt/ask", json={"model": "available-model", "prompt": "Review", "diagram": {}}).json()["graph"] is None
