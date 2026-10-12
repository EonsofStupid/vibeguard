# Design Style Guide — VibeGuard

STATUS: ESTABLISHED (v2, 2026-10-11 evening)

## Aesthetic direction

**An inspection ledger.** VibeGuard records decisions about an AI on a leash: what it proposed, what a human allowed, what it cost. The page is a ruled ledger on engineering paper, not a dashboard: content sits on rule lines, status is a word in a colour, evidence is stamped inline. One flourish only — the held-out curve plotted on graph paper as the hero, drawn once on load.

Rejected on purpose: the dark console with an acid accent, the rounded-card kit with uniform shadows, tracked all-caps labels, middle-dot meta strings, monospace for anything that is not code.

## Colour (`@theme` tokens in `src/client/index.css`)

| Token | Value | Use |
|---|---|---|
| `paper` | `#edf0f3` | page |
| `sheet` | `#ffffff` | ledger sheets, inputs, chart |
| `ink` | `#16213a` | text, rules between sections, the held-out line |
| `rule` | `#c6ced8` | ledger lines, graph paper |
| `mute` | `#5b6578` | secondary text |
| `flag` | `#e8590c` | proposed / needs a human; evidence rail |
| `pass` | `#1f7a4d` | approved / pass |
| `stop` | `#9b1b30` | reverted / fail / wrongly blocked |
| `wash` | `#dde3ea` | quiet fills (code blocks, meters) |

Status words are fixed: *Needs a decision* (flag), *In force* (pass), *Reverted* (stop).

## Typography

One family: **Archivo** (variable width 62–125, weight 300–800). Headlines use the wide axis (`.display`: `font-stretch 112%`, 700, tight leading); body is 400/500 at 15px; numbers are tabular. **JetBrains Mono** appears only where the content is code (triggers, evidence). No typographic labels above content; headings are sentence case.

## Layout

Max width 1180px, left-aligned. Statement headline (≤ 62ch body) with the three actions on the right → full-width hero: chart on graph paper with four facts in a ruled column → two-column workbench: Decisions ledger (7/12) | What the agent remembers + Ask the harness (5/12) → tabs for Runs, Receipts, Prompt check. Sections are separated by ink rules, rows by `rule` lines; corners are square except 2px on controls.

## Motion

The held-out line draws once on load (`--animate-draw`, 1.2s). Everything else responds only to the person's action. `prefers-reduced-motion` disables the draw.
