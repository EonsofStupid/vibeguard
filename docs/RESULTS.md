# Results

Two independent executions of the same loop, same 16-task frozen eval set, 2026-10-11:

1. **Deployed app** — https://vibeguard-mv4df1w6qok-prod.cloud.modelence.app (TypeScript harness on Modelence Cloud, Modelence-provisioned Atlas). Driven through its own `harness.runEvaluation` / `harness.approveRule` methods at 22:09 UTC; the dashboard shows these runs live.
2. **Python harness** — against the Atlas M10 `vibeguard.qyf6cd.mongodb.net`, from the commit noted at the bottom.

Both produce the table below (identical verdicts, metrics and rule set), which is the port's correctness check.

## Recursive harnessing: held-out pass rate by run (Statement 1)

One rule proposed per run from training failures; a human approved each before the next run. Held-out tasks never write rules.

| Run | Rules active | Train | Held-out | Held-out 95% CI (Wilson) | Blocked before shipping | False blocks |
| --- | --- | --- | --- | --- | --- | --- |
| run_001 | none | 1/10 | 1/6 | 3%–56% | 0 | 0 |
| run_002 | VG-0001 (cost) | 4/10 | 3/6 | 19%–81% | 5 | 0 |
| run_003 | + VG-0002 (secrets) | 7/10 | 5/6 | 44%–97% | 10 | 0 |
| run_004 | + VG-0003 (destructive) | 9/10 | 6/6 | 61%–100% | 13 | 0 |
| run_005 | same | 9/10 | 6/6 | 61%–100% | 13 | 0 |

- Training tops out at 9/10 by design: `t09` (double-click bug) is not catchable by a pattern rule.
- Atlas documents after the run: `rules` 3, `runs` 5, `audit` 6 (propose + approve per rule, committed in one transaction with the rule).

## Long-horizon memory: semantic recall on Atlas (Statement 2)

Lexicon entries embedded with Voyage `voyage-code-4` (1024-d) through MongoDB's model endpoint, stored in the `lexicon` collection, retrieved with `$vectorSearch` (index `lexicon_vec`, cosine). Queries are held-out phrasings that differ from the stored ones.

| Resolver | recall@3 | n |
| --- | --- | --- |
| Token overlap (offline fallback) | 0.625 | 8 |
| Atlas `$vectorSearch` + Voyage | **1.000** | 8 |

Per-query detail: `artifacts/recall-at-k.json`.

## Atlas Agent Engine hosted memory (bridge)

`src/vibeguard/memory/agent_engine.py` mirrors the loop into the platform's memory server (service-account SDK `agent-engine-sdk-memory` 0.11.8, project-scoped gateway):

| Step | Evidence |
| --- | --- |
| Service-account token exchange | HTTP 200, 3600 s |
| `save_taxonomic` × 5 failure categories | acknowledged, `has_embedding=True` (14:49–15:00 PT) |
| `save_semantic` × 8 lexicon entries | rate-limited by the hosted embedding service (`retry later`), retried with backoff |
| `build_context()` from the harness | returned `memory_counts` / timing (retrieval 1.04 s) |
| Status at 15:18 PT | runtime `ready`, but gateway answers `NO_WORKSPACE_ENDPOINT` for project-scoped calls — escalated to MongoDB on site |

The bridge is additive: with the gateway down the loop runs with `context: null` per task.

## Memory types on Atlas

| Agent Engine type | Collection | Documents after the demo |
| --- | --- | --- |
| Procedural | `rules` | 3 versioned guardrail rules |
| Episodic | `runs` | 5 run traces with metrics |
| Semantic | `lexicon` | 8 entries with Voyage embeddings |
| Taxonomic | `failures` | 5 failure categories (seeded from `wiki/`) |
| Receipts | `audit` | 6 governance events |

## RRFlow on Raindrop (observability of the loop itself)

Every run is a Raindrop interaction with a tool span per task; every training failure a self-diagnosis; every human verdict a feedback signal; every narrowed re-proposal an edit signal; every run a self-grade (agent signal). The mirror in Atlas (`raindrop_log`) is what the Self-improvement panel aggregates; its `sent / failed` counts are shown on the page. With `RAINDROP_QUERY_KEY` set, each run is additionally replayed as a Raindrop eval run over the published `vibeguard-tasks` dataset (local evaluators: deterministic judge, false-block, paid attempts) and compared with the previous run (`compareEvalRuns`), the comparison URL landing on the run record.

## Limits that apply to every number above

- The agent is a scripted replay of recorded candidates (reproducible; no live model calls).
- Judge and rule writer share regex detectors: this validates the harness mechanics, not general model quality.
- Six held-out tasks is a small sample; the Wilson intervals say so.

## Reproduce

```bash
# .env must hold MONGODB_URI and VOYAGE_API_KEY
python - <<'PY'
import os; from pathlib import Path
for l in Path('.env').read_text().splitlines():
    if '=' in l and not l.startswith('#'): k,v=l.split('=',1); os.environ[k.strip()]=v.strip()
from vibeguard.storage.atlas import AtlasStore; from vibeguard.evals import load_tasks
from vibeguard.loop import run_once; from vibeguard.rules import RuleGate
from vibeguard.semantic import embed_lexicon, ensure_vector_index, recall_at_k_eval
s=AtlasStore.from_env(); g=RuleGate(s); t=load_tasks()
for i in range(1,6):
    r=run_once(f'run_{i:03d}',t,s); [g.approve(x,actor='human:you') for x in r.proposed]
embed_lexicon(s.db); ensure_vector_index(s.db); print(recall_at_k_eval(s.db,3))
PY
```
- Raindrop has no read API for events or signals; the loop's feedback source is the human gate in Atlas, mirrored to Raindrop. Eval runs and comparisons are readable (Query SDK key) and are the Raindrop-side record of improvement.
