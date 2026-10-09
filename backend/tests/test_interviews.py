import copy

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.main import create_app


class InterviewAI:
    def __init__(self):
        self.calls = []
        self.fail = False
        self.invalid_evidence = False

    def complete(self, model, instructions, content, output_type):
        self.calls.append(copy.deepcopy(content))
        if self.fail:
            raise HTTPException(502, "Disposable failure")
        feedback = None
        if content["action"] == "finish":
            answers = [turn["id"] for turn in content["transcript"] if turn["action"] == "answer"]
            feedback = {"rubric": [{"criterion": criterion, "score": 3 if answers else None,
                                    "evidence": "Estimated throughput" if answers else "Not observed",
                                    "turn_ids": [999] if self.invalid_evidence else answers[:1]}
                                   for criterion in ["requirements", "quantitative_reasoning", "architecture",
                                                     "tradeoffs", "reliability", "communication"]],
                        "strengths": ["Explained assumptions"], "gaps": ["Validate peak capacity"],
                        "next_steps": ["Practice estimates", "Explore failure modes"]}
        return output_type.model_validate({"phase": "recap" if feedback else "requirements",
                                           "message": "What time window does 100M requests refer to?",
                                           "constraints": ["100M requests per day"] if content["action"] == "answer" else [],
                                           "feedback": feedback}).model_dump()


def start(client):
    diagram = client.post("/api/diagrams", json={"title": "Practice", "context": {"brief": "Design a feed"}}).json()
    snapshot = {key: diagram[key] for key in ["title", "graph", "context"]}
    response = client.post("/api/interviews", json={"diagram_id": diagram["id"], "diagram": snapshot,
                                                   "diagram_version": 1, "model": "test-model"})
    assert response.status_code == 201
    return diagram, snapshot, response.json()


def act(client, interview, snapshot, action, **extra):
    return client.post(f"/api/interviews/{interview['id']}/actions", json={
        "expected_version": interview["version"], "action": action, "diagram": snapshot,
        "diagram_version": 1, **extra})


def test_interview_persists_transcript_snapshots_and_feedback_without_editing_diagram(tmp_path):
    url = f"sqlite:///{tmp_path / 'practice.db'}"
    ai = InterviewAI()
    with TestClient(create_app(url, ai), base_url="http://127.0.0.1") as client:
        diagram, snapshot, interview = start(client)
        changed = copy.deepcopy(snapshot)
        changed["graph"]["nodes"] = [{"id": "cache", "type": "cache", "label": "Cache", "position": {"x": 0, "y": 0}}]
        interview = act(client, interview, changed, "answer", answer="100M per day, roughly 1157 RPS").json()
        assert interview["constraints"] == ["100M requests per day"]
        assert interview["turns"][-1]["diagram"]["graph"]["nodes"][0]["id"] == "cache"
        interview = act(client, interview, changed, "hint").json()
        interview = act(client, interview, changed, "coaching").json()
        interview = act(client, interview, changed, "skip").json()
        unchanged = client.get(f"/api/diagrams/{diagram['id']}").json()
        assert all(unchanged[key] == diagram[key] for key in ["title", "graph", "context", "version"])
    with TestClient(create_app(url, ai), base_url="http://127.0.0.1") as client:
        restored = client.get(f"/api/interviews/{interview['id']}").json()
        assert restored["turns"] == interview["turns"]
        assert len(client.get(f"/api/interviews?diagram_id={diagram['id']}").json()) == 1
        finished = act(client, restored, changed, "finish").json()
        assert finished["status"] == "finished"
        assert finished["turns"][-1]["reply"]["feedback"]["rubric"][0]["turn_ids"] == [2]
        assert [turn["action"] for turn in ai.calls[-1]["transcript"]] == ["start", "answer", "hint", "coaching", "skip"]
        assert ai.calls[-1]["current_diagram"]["graph"]["nodes"][0]["id"] == "cache"
        assert act(client, finished, snapshot, "answer", answer="Late answer").status_code == 409
        assert client.delete(f"/api/diagrams/{diagram['id']}?expected_version=1").status_code == 204
        assert client.get(f"/api/interviews/{interview['id']}").status_code == 404


def test_timer_pause_resume_extend_and_conflicts(tmp_path, monkeypatch):
    timestamp = [1000.0]
    monkeypatch.setattr("backend.interviews.time.time", lambda: timestamp[0])
    ai = InterviewAI()
    with TestClient(create_app(f"sqlite:///{tmp_path / 'timer.db'}", ai), base_url="http://127.0.0.1") as client:
        _, snapshot, interview = start(client)
        timestamp[0] += 120
        paused = act(client, interview, snapshot, "pause").json()
        assert paused["remaining_seconds"] == 1680
        timestamp[0] += 300
        assert client.get(f"/api/interviews/{paused['id']}").json()["remaining_seconds"] == 1680
        assert act(client, paused, snapshot, "answer", answer="While paused").status_code == 409
        assert act(client, interview, snapshot, "resume").status_code == 409
        resumed = act(client, paused, snapshot, "resume").json()
        assert resumed["remaining_seconds"] == 1680
        extended = act(client, resumed, snapshot, "extend").json()
        assert extended["remaining_seconds"] == 2580
        assert len(ai.calls) == 1
        timestamp[0] += 2600
        assert client.get(f"/api/interviews/{extended['id']}").json()["remaining_seconds"] == 0
        assert act(client, extended, snapshot, "finish").status_code == 200


def test_failed_turn_and_bad_evidence_do_not_commit(tmp_path):
    ai = InterviewAI()
    with TestClient(create_app(f"sqlite:///{tmp_path / 'failure.db'}", ai), base_url="http://127.0.0.1") as client:
        _, snapshot, interview = start(client)
        ai.fail = True
        assert act(client, interview, snapshot, "answer", answer="My answer").status_code == 502
        assert client.get(f"/api/interviews/{interview['id']}").json()["version"] == 1
        ai.fail = False
        interview = act(client, interview, snapshot, "answer", answer="My answer").json()
        ai.invalid_evidence = True
        assert act(client, interview, snapshot, "finish").status_code == 502
        saved = client.get(f"/api/interviews/{interview['id']}").json()
        assert saved["version"] == interview["version"] and saved["status"] == "active"


def test_interview_contract_rejects_graphs_blank_answers_and_foreign_origins(tmp_path):
    from backend.interviews import InterviewReply
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        InterviewReply.model_validate({"phase": "architecture", "message": "Solution", "graph": {"nodes": []}})
    with TestClient(create_app(f"sqlite:///{tmp_path / 'validation.db'}", InterviewAI()), base_url="http://127.0.0.1") as client:
        _, snapshot, interview = start(client)
        assert act(client, interview, snapshot, "answer", answer="   ").status_code == 422
        assert client.post("/api/interviews", json={}, headers={"origin": "https://foreign.invalid"}).status_code == 403
        assert client.post(f"/api/interviews/{interview['id']}/actions", content="{}").status_code == 415
