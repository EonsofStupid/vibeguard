"""Record a completed, no-change live experiment and its receipt in Atlas.

This importer is insert-only: repeating an identical artifact verifies existing
records, while a different artifact with the same ID is rejected. It creates no
proposal, approval or active policy. No model API requests are made.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

from pymongo import MongoClient
from pymongo.errors import CollectionInvalid
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

from vibeguard.settings import load_env


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT = ROOT / "artifacts/improvement/retry-live-20261011T220933Z.json"


def canonical_hash(value: dict) -> str:
    serialized = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def validate_artifact(artifact: dict) -> None:
    if artifact.get("status") != "completed" or artifact.get("evidence_type") != "live_model_plans_with_simulated_tool_outcomes":
        raise ValueError("Only completed live-model experiments are accepted")
    if not isinstance(artifact.get("experiment_id"), str) or not artifact["experiment_id"]:
        raise ValueError("Experiment ID is missing")
    calls = artifact.get("model_calls", [])
    if not calls or artifact.get("actual_model_request_count") != len(calls):
        raise ValueError("Model request count does not match the receipts")
    if any(call.get("http_status") != 200 or call.get("status") != "completed" or not call.get("response_id") or not call.get("request_id") for call in calls):
        raise ValueError("Every model request must have a completed provider receipt")
    if artifact.get("proposal") is not None or artifact.get("candidate", {}).get("policy") is not None:
        raise ValueError("This importer records the no-change baseline checkpoint only")
    promotion = artifact.get("promotion", {})
    if promotion.get("eligible") is not False or promotion.get("false_blocks") != 0:
        raise ValueError("Baseline checkpoint must have no promotion and no false blocks")
    if artifact.get("activation", {}).get("status") != "not_activated":
        raise ValueError("This checkpoint must not activate a policy")
    for split in ("train", "heldout"):
        metrics = artifact.get("metrics", {}).get(split, {})
        if not metrics.get("total") or metrics.get("before") != metrics["total"] or metrics.get("after") != metrics["total"]:
            raise ValueError("This checkpoint requires a fully passing unchanged baseline")


def new_client(uri: str) -> MongoClient:
    return MongoClient(uri, appname="VibeGuardLiveExperimentRecorder", serverSelectionTimeoutMS=8000,
                       connectTimeoutMS=8000, socketTimeoutMS=15000, timeoutMS=20000)


def persist(artifact_path: Path) -> dict:
    raw = artifact_path.read_bytes()
    artifact = json.loads(raw)
    validate_artifact(artifact)
    experiment_id = artifact["experiment_id"]
    receipt_id = "harness-experiment-recorded:" + experiment_id
    file_sha = hashlib.sha256(raw).hexdigest()
    canonical_sha = canonical_hash(artifact)
    load_env(ROOT / ".env")
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        raise ValueError("The saved MONGODB_URI is missing")
    database = os.environ.get("MONGODB_DATABASE", "vibeguard")
    timestamp = datetime.now(timezone.utc).isoformat()
    try:
        source_path = artifact_path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        source_path = artifact_path.name
    document = {"_id": experiment_id, **artifact, "artifact_sha256": file_sha,
                "artifact_canonical_sha256": canonical_sha, "recorded_at": timestamp,
                "source_artifact": source_path}
    receipt = {
        "_id": receipt_id, "event": "harness_experiment_recorded", "at": timestamp,
        "experiment_id": experiment_id, "artifact_sha256": file_sha,
        "artifact_canonical_sha256": canonical_sha,
        "authorization": "explicit_user_request_to_measure_and_persist_live_harness_evidence",
        "check": "completed_provider_receipts_and_artifact_hash_validated_before_atomic_recording",
        "model_requests": len(artifact["model_calls"]),
        "metrics": artifact["metrics"], "evidence_type": artifact["evidence_type"],
        "proposals_created": 0, "approvals_created": 0, "policy_transitions": 0,
    }
    with new_client(uri) as client:
        db = client[database]
        existing_collections = set(db.list_collection_names())
        for name in ("harness_experiments", "audit"):
            if name not in existing_collections:
                try:
                    db.create_collection(name)
                except CollectionInvalid:
                    pass

        def record(session):
            existing = db.harness_experiments.find_one({"_id": experiment_id}, session=session)
            existing_receipt = db.audit.find_one({"_id": receipt_id}, session=session)
            if existing is not None:
                if existing.get("artifact_sha256") != file_sha or existing.get("artifact_canonical_sha256") != canonical_sha:
                    raise ValueError("Existing experiment ID has different evidence; refusing overwrite")
                saved_artifact = {key: existing.get(key) for key in artifact}
                if canonical_hash(saved_artifact) != canonical_sha:
                    raise ValueError("Existing experiment content does not match its digest")
                if not existing_receipt or existing_receipt.get("artifact_sha256") != file_sha or existing_receipt.get("event") != "harness_experiment_recorded":
                    raise ValueError("Existing experiment lacks its matching atomic receipt")
                return False
            if existing_receipt is not None:
                raise ValueError("Receipt exists without its experiment; refusing an inconsistent import")
            db.harness_experiments.insert_one(document, session=session)
            db.audit.insert_one(receipt, session=session)
            return True

        with client.start_session() as session:
            inserted = session.with_transaction(record, read_concern=ReadConcern("snapshot"),
                                                write_concern=WriteConcern("majority"))

    # A fresh connection reads committed data after the writer/session closes.
    with new_client(uri) as verifier:
        db = verifier.get_database(database, read_concern=ReadConcern("majority"))
        saved = db.harness_experiments.find_one({"_id": experiment_id})
        saved_receipt = db.audit.find_one({"_id": receipt_id})
        if not saved or canonical_hash({key: saved.get(key) for key in artifact}) != canonical_sha:
            raise ValueError("Independent committed experiment readback failed")
        if saved.get("artifact_sha256") != file_sha:
            raise ValueError("Independent artifact digest readback failed")
        if not saved_receipt or saved_receipt.get("artifact_sha256") != file_sha or saved_receipt.get("event") != "harness_experiment_recorded":
            raise ValueError("Independent audit readback failed")
        return {
            "experiment_id": experiment_id, "audit_receipt_id": receipt_id,
            "inserted_experiments": int(inserted), "inserted_receipts": int(inserted),
            "verified_experiments": 1, "verified_receipts": 1,
            "independent_majority_readback": True, "artifact_sha256_verified": file_sha,
            "total_experiments": db.harness_experiments.count_documents({}),
            "model_requests_recorded": len(artifact["model_calls"]),
            "proposals_created": 0, "approvals_created": 0, "policy_transitions": 0,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    args = parser.parse_args()
    try:
        result = persist(args.artifact)
    except Exception as error:
        # Driver errors can contain connection details; never echo their text.
        print(json.dumps({"verified_experiments": 0, "verified_receipts": 0,
                          "independent_majority_readback": False, "error_type": type(error).__name__}))
        raise SystemExit(1) from None
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
