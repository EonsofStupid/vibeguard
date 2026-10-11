"""FastAPI app: runs, rules (approve/revert), COSTAR check, lexicon, audit, and the dashboard page.

Storage is chosen by environment so the Atlas backend can drop in without touching this file:
  VIBEGUARD_STORE=flatfile (default) | atlas
  VIBEGUARD_WIKI=<dir>            flat-file root (default: ./wiki)
Atlas: VIBEGUARD_STORE=atlas, MONGODB_URI, optional VIBEGUARD_DB (default vibeguard).
Auditing on Atlas needs AtlasStore.read_log(kind); without it the audit panel stays empty.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from vibeguard.costar import score_prompt, side_conversation
from vibeguard.costar.check import missing
from vibeguard.evals import load_tasks
from vibeguard.lexicon import resolve_label
from vibeguard.loop import run_once
from vibeguard.loop.promotion import check_promotion
from vibeguard.rules import GuardrailRule, RuleStatus
from vibeguard.loop.run import RunResult
from vibeguard.rules import GateError, RuleGate
from vibeguard.settings import load_env
from vibeguard.storage import FlatFileStore

STATIC = Path(__file__).with_name("static")
_ACTOR = re.compile(r"^human:[A-Za-z0-9._-]{1,40}$")


def make_store():
    load_env()
    kind = os.environ.get("VIBEGUARD_STORE", "flatfile").lower()
    if kind == "atlas":
        from vibeguard.storage.atlas import AtlasStore  # provided by the Atlas checkpoint

        if hasattr(AtlasStore, "from_env"):
            return AtlasStore.from_env()
        return AtlasStore(os.environ["MONGODB_URI"], os.environ.get("VIBEGUARD_DB", "vibeguard"))
    return FlatFileStore(Path(os.environ.get("VIBEGUARD_WIKI", "wiki")))


class ApproveBody(BaseModel):
    actor: str = Field(examples=["human:jesse"])


class RevertBody(ApproveBody):
    reason: str = ""


class CostarBody(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)


def _human(actor: str) -> str:
    if not _ACTOR.match(actor):
        raise HTTPException(422, "actor must look like human:name")
    return actor


def _audit(store, limit: int = 50) -> list[dict]:
    reader = getattr(store, "read_log", None)
    if callable(reader):
        return list(reader("audit"))[-limit:]
    root = getattr(store, "root", None)
    if root is None:  # backend without a log reader: show nothing rather than stale local files
        return []
    p = Path(root) / "audit" / "log.jsonl"
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()][-limit:]


def _run_row(r: RunResult) -> dict:
    return r.model_dump(mode="json", exclude={"traces"})


def create_app(store=None) -> FastAPI:
    store = store or make_store()
    app = FastAPI(title="VibeGuard", version="0.1.0",
                  description="Self-tightening harness: agents propose rules, humans approve them.")

    def runs() -> list[RunResult]:
        return sorted(store.list("runs", RunResult), key=lambda r: r.at)

    @app.get("/api/health")
    def health():
        return {"ok": True, "store": type(store).__name__}

    @app.get("/api/summary")
    def summary():
        gate = RuleGate(store)
        return {"runs": [_run_row(r) for r in runs()],
                "rules": [r.model_dump(mode="json") for r in gate.all()],
                "audit": _audit(store)}

    @app.get("/api/runs/{run_id}")
    def run_detail(run_id: str):
        if not store.exists("runs", run_id):
            raise HTTPException(404, f"no run {run_id}")
        return store.read("runs", run_id, RunResult).model_dump(mode="json")

    @app.post("/api/runs")
    def new_run():
        n = len(runs()) + 1
        result = run_once(f"run_{n:03d}", load_tasks(), store)
        return _run_row(result)

    @app.post("/api/rules/{rule_id}/approve")
    def approve(rule_id: str, body: ApproveBody):
        try:
            actor = _human(body.actor)
            gate = RuleGate(store)
            rule = store.read("rules", rule_id, GuardrailRule)
            if rule.status != RuleStatus.proposed:
                raise GateError("Rule must be proposed before approval.")
            check = check_promotion(rule, load_tasks(), gate.approved())
            if not check.eligible:
                raise GateError(check.reason)
            store.append_log("audit", {"event": "promotion_check", "rule_id": rule_id, "check": check.model_dump()})
            return gate.approve(rule_id, actor=actor).model_dump(mode="json")
        except GateError as e:
            raise HTTPException(403, str(e))
        except FileNotFoundError:
            raise HTTPException(404, f"no rule {rule_id}")

    @app.post("/api/rules/{rule_id}/revert")
    def revert(rule_id: str, body: RevertBody):
        try:
            return RuleGate(store).revert(rule_id, actor=_human(body.actor), reason=body.reason).model_dump(mode="json")
        except GateError as e:
            raise HTTPException(403, str(e))
        except FileNotFoundError:
            raise HTTPException(404, f"no rule {rule_id}")

    @app.post("/api/costar")
    def costar(body: CostarBody):
        scores = score_prompt(body.prompt)
        gaps = missing(scores)
        resolver = "token-overlap"
        matches = []
        db = getattr(store, "db", None)
        if db is not None and os.environ.get("VOYAGE_API_KEY"):
            try:
                from vibeguard.semantic import vector_resolve
                matches = [{"phrase": r["phrase"], "canonical_label": r["canonical_label"], "teach": r.get("teach", ""), "score": sc}
                           for r, sc in vector_resolve(db, body.prompt, k=3)]
                resolver = "atlas-vector-search+voyage"
            except Exception as e:  # fall back rather than fail the panel
                resolver = f"token-overlap (vector unavailable: {type(e).__name__})"
        if not matches:
            matches = [{"phrase": e.phrase, "canonical_label": e.canonical_label, "teach": e.teach, "score": round(s, 3)}
                       for e, s in resolve_label(body.prompt, k=3) if s > 0]
        return {"scores": [s.model_dump(mode="json") for s in scores],
                "missing": [d.value for d in gaps],
                "ask": side_conversation(gaps),
                "lexicon": matches,
                "resolver": resolver}

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


