"""Opt-in test against the local PostgreSQL database; only creates/removes its own record."""
import os

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.mark.skipif(os.environ.get("RUN_POSTGRES_SMOKE") != "1", reason="Opt-in PostgreSQL integration check")
def test_postgres_roundtrip():
    with TestClient(create_app()) as client:
        created_response = client.post("/api/diagrams", json={"title": "Disposable PostgreSQL smoke test"})
        assert created_response.status_code == 201
        created = created_response.json()
        path = f"/api/diagrams/{created['id']}"
        version = created["version"]
        try:
            payload = {"title": created["title"], "expected_version": version, "graph": {"nodes": [{"id": "service", "type": "service", "label": "API", "position": {"x": 100, "y": 200}}]}, "context": {"brief": "Persistent diagram"}}
            response = client.patch(path, json=payload)
            assert response.status_code == 200
            version = response.json()["version"]
            assert client.get(path).json()["graph"]["nodes"][0]["label"] == "API"
            unchanged = client.patch(path, json={**payload, "expected_version": version})
            assert unchanged.status_code == 200
            assert unchanged.json()["version"] == version
            assert client.patch(path, json=payload).status_code == 409
            restored = client.post(f"{path}/restore", json={"expected_version": version, "version": 1})
            assert restored.status_code == 200
            version = restored.json()["version"]
            assert restored.json()["graph"]["nodes"] == []
        finally:
            assert client.delete(path, params={"expected_version": version}).status_code == 204
        assert client.get(path).status_code == 404
