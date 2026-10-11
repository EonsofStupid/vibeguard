# VibeGuard — agent map

Table of contents for agents working in this repo. Read before writing.

## Layout (hypermodular, colocated: each domain owns its schema, logic, tests)
- `src/vibeguard/storage/` — flat-file store: one Markdown file per record, YAML frontmatter. Source of truth until the Atlas port.
- `src/vibeguard/rules/` — GuardrailRule schema, rule store, approve/revert gate (monotonic ratchet).
- `src/vibeguard/lexicon/` — vibecoder phrasing -> canonical label.
- `src/vibeguard/failures/` — failure categories (taxonomic memory), each a binary signal.
- `src/vibeguard/costar/` — COSTAR completeness check + natural side-conversation prompts.
- `src/vibeguard/evals/` — frozen eval tasks + deterministic judge.
- `src/vibeguard/loop/` — attempt -> judge -> classify -> propose rule -> gate -> reload.
- `wiki/` — the flat-file "LLM wiki" (rules, lexicon, failures, runs, costar captures, audit log).

## Invariants
- Agents may tighten their own leash; only humans loosen it.
- Never delete a rule: revert sets `status: reverted` and appends to `wiki/audit/`.
- Memory mapping: procedural = rules, episodic = runs, semantic = lexicon/project facts, taxonomic = failures.
