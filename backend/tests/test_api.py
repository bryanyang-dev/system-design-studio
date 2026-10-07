import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.database import DiagramRecord, RevisionRecord, make_engine, session_factory


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


def test_multiple_connections_and_two_way_metadata(client):
    edges = [
        {"id": "e1", "source": "api", "target": "cache", "direction": "two_way", "source_port": "bottom", "target_port": "top"},
        {"id": "e2", "source": "api", "target": "db"},
        {"id": "e3", "source": "api", "target": "cache", "source_port": "bottom", "target_port": "top"},
        {"id": "e4", "source": "cache", "target": "api", "source_port": "top", "target_port": "bottom"},
    ]
    response = client.post("/api/diagrams", json={"graph": {"nodes": [node("api"), node("cache"), node("db")], "edges": edges}})
    assert response.status_code == 201
    created = response.json()
    path = f"/api/diagrams/{created['id']}"
    graph = client.get(path).json()["graph"]
    assert len(graph["edges"]) == 4
    assert graph["edges"][0]["direction"] == "two_way"
    assert graph["edges"][0]["source_port"] == "bottom"
    graph["edges"][0]["direction"] = "one_way"
    payload = {"title": created["title"], "graph": graph, "expected_version": 1}
    assert client.patch(path, json=payload).status_code == 200
    restored = client.post(f"{path}/restore", json={"version": 1, "expected_version": 2}).json()
    assert restored["graph"]["edges"][0]["direction"] == "two_way"
    assert len(restored["graph"]["edges"]) == 4
    for field, value in [("direction", "unknown"), ("source_port", "unknown")]:
        graph["edges"][0][field] = value
        assert client.patch(path, json={**payload, "graph": graph, "expected_version": 3}).status_code == 422
        graph["edges"][0][field] = restored["graph"]["edges"][0][field]
    assert client.get(path).json()["version"] == 3


def test_legacy_connections_are_read_and_restored_without_a_data_migration(tmp_path):
    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    with TestClient(create_app(url)) as client:
        created = client.post("/api/diagrams", json={"graph": {"nodes": [node("api"), node("db")], "edges": [{"id": "e1", "source": "api", "target": "db"}]}}).json()
    # Reproduce the JSON shape already present in databases created before this feature.
    legacy_graph = created["graph"]
    for field in ["direction", "source_port", "target_port"]:
        del legacy_graph["edges"][0][field]
    engine = make_engine(url)
    with session_factory(engine)() as session:
        session.get(DiagramRecord, created["id"]).graph = legacy_graph
        session.get(RevisionRecord, (created["id"], 1)).graph = legacy_graph
        session.commit()
    engine.dispose()
    with TestClient(create_app(url)) as client:
        path = f"/api/diagrams/{created['id']}"
        loaded = client.get(path).json()
        assert loaded["graph"]["edges"][0]["source_port"] == "right"
        assert loaded["graph"]["edges"][0]["target_port"] == "left"
        assert loaded["graph"]["edges"][0]["direction"] == "one_way"
        payload = {"title": loaded["title"], "graph": loaded["graph"], "context": loaded["context"], "expected_version": 1}
        assert client.patch(path, json=payload).json()["version"] == 1
        payload["graph"]["edges"][0]["direction"] = "two_way"
        assert client.patch(path, json=payload).status_code == 200
        restored = client.post(f"{path}/restore", json={"version": 1, "expected_version": 2}).json()
        assert restored["graph"]["edges"][0]["direction"] == "one_way"
