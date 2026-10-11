import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from vibeguard.api import create_app  # noqa: E402
from vibeguard.storage import FlatFileStore  # noqa: E402


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(FlatFileStore(tmp_path)))


def test_dashboard_and_health(client):
    assert client.get("/api/health").json()["ok"] is True
    page = client.get("/")
    assert page.status_code == 200 and "VibeGuard" in page.text


def test_run_propose_approve_rerun(client):
    r1 = client.post("/api/runs").json()
    assert r1["run_id"] == "run_001" and r1["proposed"]
    rid = r1["proposed"][0]
    assert client.post(f"/api/rules/{rid}/approve", json={"actor": "agent:vibeguard"}).status_code == 422
    ok = client.post(f"/api/rules/{rid}/approve", json={"actor": "human:test"})
    assert ok.status_code == 200 and ok.json()["status"] == "approved"
    r2 = client.post("/api/runs").json()
    assert r2["heldout"]["passed"] >= r1["heldout"]["passed"] and rid in r2["rules_active"]
    s = client.get("/api/summary").json()
    assert [r["run_id"] for r in s["runs"]] == ["run_001", "run_002"]
    assert [a["event"] for a in s["audit"]][:2] == ["propose", "approve"]
    detail = client.get("/api/runs/run_002").json()
    assert len(detail["traces"]) == 16


def test_revert_requires_human_and_keeps_record(client):
    rid = client.post("/api/runs").json()["proposed"][0]
    client.post(f"/api/rules/{rid}/approve", json={"actor": "human:test"})
    v = client.post(f"/api/rules/{rid}/revert", json={"actor": "human:test", "reason": "too broad"})
    assert v.status_code == 200 and v.json()["status"] == "reverted"
    assert any(r["rule_id"] == rid for r in client.get("/api/summary").json()["rules"])


def test_costar_endpoint(client):
    d = client.post("/api/costar", json={"prompt": "make it take payments"}).json()
    assert "context" in d["missing"] and 1 <= len(d["ask"]) <= 2
    assert d["lexicon"] and d["lexicon"][0]["canonical_label"].startswith("payment")
