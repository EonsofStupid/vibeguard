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

## Atlas Agent Engine hosted memory (bridge) — verified 16:05 PT

`src/vibeguard/memory/agent_engine.py` mirrors the loop into the platform's memory server (service-account SDK `agent-engine-sdk-memory` 0.11.8, project-scoped gateway, memory-only project `6acbc84c…`):

| Memory type | Written | Call |
| --- | ---: | --- |
| taxonomic | 5 failure categories (embedded) | `save_taxonomic` |
| semantic | 8 lexicon entries | `save_semantic` (upsert) |
| procedural | 3 approved rules as `vg-0001-v2` … (one procedure per rule version) | `save_procedure` |
| episodic | 5 runs, one episode per run session | `save_episode` |

`python -m vibeguard memory-context "make it keep trying the AI until it answers"` → the platform's `build_context()` selected **17 memories: semantic 8, taxonomic 5, procedural 3, episodic 1 — 932 tokens, retrieval 722 ms**. The three approved guardrails arrive as procedures in the agent's context: that is the context policy evolving with the rule set (Statement 1), assembled from long-horizon memory (Statement 2).

Caveats observed: the hosted embedding service rate-limits bursts (`retry later`, handled with backoff); the gateway briefly answered `NO_WORKSPACE_ENDPOINT` (~15:05–15:45 PT) while the runtime reported `ready`, then recovered. The bridge is additive: with the gateway down the loop runs with `context: null` per task.

## Raindrop instrumentation (verified 17:04 PT)

`web/src/server/harness/raindrop.ts`: `rule_proposed` → `trackAi` (input = the failing attempt + evidence, output = the rule), human approve/revert → `trackSignal` on that event (POSITIVE / NEGATIVE, actor in the comment), `harness_run` → `trackAi` (input = rules active, output = held-out metric). After one replay of the loop the Raindrop project shows 5 `harness_run` + 3 `rule_proposed` events from `agent:vibeguard` and `Rule approved` signals on VG-0002 and VG-0003 (`docs/demo/slides/slide-05-raindrop-events.png`). VG-0001's signal fired before Raindrop had ingested its proposal event and was dropped — signals must trail their event by a beat; fix: delay or retry the signal.

## Human signals shape proposals; the harness indexes itself (verified 18:04 PT, live site)

- `revertRule(VG-0001)` by `human:jesse` → run_007 held-out **6/6 → 4/6** (the gate loosened only by human action) → the harness proposed **VG-0004**: a narrower literal-pattern rule from the exact evidence (`while \(true\) \{ const r = await fetch\(`), `action: warn`, `origin.derived_from: reverted:VG-0001`. Approved → run_008 held-out 4/6, 0 false blocks: the trade-off (narrower = less general) is visible, not hidden. Two reverts in a category silence proposals for it.
- Every run now self-grades into Raindrop (`heldout_improved` / `heldout_regressed` / `heldout_flat` / `false_block` signals); signals trail their events by 1.5 s (fixes the VG-0001 race).
- Dogfooding: `scripts/extract-knowledge.mjs` reads the harness's own source (67 documented exports, SWEBOK-tagged); `indexKnowledge` embeds them + lexicon + failure taxonomy (80 units) into `knowledge` with vector index `knowledge_vec`; every approval grows it (`growFromRule`: 80 → 81 after VG-0004). `harness.explain("why did it block my retry loop?")` → `unbounded API usage / rate limiting` 0.542, `VG-0004` 0.542, `Unbounded paid API calls` 0.529, each with a plain-language gloss and the file path.

## Memory types on Atlas

| Agent Engine type | Collection | Documents after the demo |
| --- | --- | --- |
| Procedural | `rules` | 3 versioned guardrail rules |
| Episodic | `runs` | 5 run traces with metrics |
| Semantic | `lexicon` | 8 entries with Voyage embeddings |
| Taxonomic | `failures` | 5 failure categories (seeded from `wiki/`) |
| Receipts | `audit` | 6 governance events |

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
