import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(f"sqlite:///{tmp_path / 'test.db'}")) as api:
        yield api


def node(node_id="api"):
    return {"id": node_id, "type": "service", "label": "API", "position": {"x": 0, "y": 0}}


def test_persistence_conflict_and_restore(tmp_path):
    url = f"sqlite:///{tmp_path / 'persistent.db'}"
    with TestClient(create_app(url)) as client:
        created = client.post("/api/diagrams", json={"title": "Feed", "graph": {"nodes": [node()]}}).json()
        diagram_id = created["id"]
        payload = {"title": "Updated feed", "graph": created["graph"], "context": {"brief": "Read-heavy"}, "expected_version": 1}
        saved = client.patch(f"/api/diagrams/{diagram_id}", json=payload)
        assert saved.status_code == 200
        assert saved.json()["version"] == 2
        assert client.patch(f"/api/diagrams/{diagram_id}", json=payload).status_code == 409
        assert client.get(f"/api/diagrams/{diagram_id}").json()["context"]["brief"] == "Read-heavy"
    # A fresh app/connection can read the persisted document after shutdown.
    with TestClient(create_app(url)) as client:
        assert client.get(f"/api/diagrams/{diagram_id}").json()["title"] == "Updated feed"
        restored = client.post(f"/api/diagrams/{diagram_id}/restore", json={"expected_version": 2, "version": 1}).json()
        assert restored["version"] == 3
        assert restored["title"] == "Feed"
        assert len(client.get(f"/api/diagrams/{diagram_id}/versions").json()) == 3


def test_graph_validation_is_atomic(client):
    created = client.post("/api/diagrams", json={"graph": {"nodes": [node()]}}).json()
    payload = {"title": "Bad", "expected_version": 1, "graph": {"nodes": [node()], "edges": [{"id": "e1", "source": "api", "target": "missing"}]}}
    assert client.patch(f"/api/diagrams/{created['id']}", json=payload).status_code == 422
    assert client.get(f"/api/diagrams/{created['id']}").json()["version"] == 1
    assert client.post("/api/diagrams", json={"graph": {"nodes": [node(), node()]}}).status_code == 422
    assert client.post("/api/diagrams", json={"graph": {"nodes": [{**node(), "width": 0}]}}).status_code == 422


def test_identical_save_does_not_create_a_revision(client):
    created = client.post("/api/diagrams", json={"title": "Unchanged"}).json()
    payload = {"title": created["title"], "graph": created["graph"], "context": created["context"], "expected_version": 1}
    saved = client.patch(f"/api/diagrams/{created['id']}", json=payload).json()
    assert saved["version"] == 1
    assert len(client.get(f"/api/diagrams/{created['id']}/versions").json()) == 1


def test_deletion_and_origin_guard(client):
    created = client.post("/api/diagrams", json={}).json()
    path = f"/api/diagrams/{created['id']}"
    assert client.delete(path, params={"expected_version": 2}).status_code == 409
    assert client.post("/api/diagrams", json={}, headers={"origin": "https://untrusted.example"}).status_code == 403
    assert client.delete(path, params={"expected_version": 1}).status_code == 204
    assert client.get(path).status_code == 404
    assert client.get("/api/diagrams").json() == []
