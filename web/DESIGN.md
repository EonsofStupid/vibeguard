# Design Style Guide — VibeGuard

STATUS: ESTABLISHED (2026-10-11)

The first view makes the RSI cycle explicit: observed failure, proposed change,
shadow results, human review, active policy and measured rerun. Use six numbered
cards that wrap on small screens. Cobalt means recorded evidence; amber marks
the human's next step. Green requires a matching human receipt and active policy,
and the final step additionally requires a passing rerun of that policy hash.
Lead the comparison with actual avoidable-call counts and retained simulated
turns, keeping the replay label visible. Training and held-out scores remain
separate. Chat and native review stay visible; legacy fixture dashboards and
learning explanations begin collapsed. Never complete the cycle from a proposed
status or a better shadow score alone.

## Learning while building

Pending RRFlow reviews open an accessible dialog once per execution in the
current browser session. Keep a compact amber summary and a visible "Review
now" button in the workbench. The dialog contains the exact policy, evidence,
reviewer name, decision and acknowledgment; opening it never submits a decision.
"Review later" and Escape dismiss it and return focus to the review control.
Use a scrollable dark surface on small screens so every form field stays usable.

The first panel speaks to the builder: “Make the next attempt better.” Show the
real comparison and its review state before the recorded examples. Keep both
goals visible: adapting the harness and remembering the goal and its results.

Use plain-language headings, with canonical engineering terms inside optional
native details disclosures. Small “Did you know?” cards are chosen by actual
application state: first example, running replay, failed promotion check,
proposal awaiting review, approved proposal, and held-out results. They explain
retry budgets, shadow trials, regression, held-out evaluation, receipts and
recall versus learning. Each card says why it appears and labels its explanation
as curated, with an experiment/proposal identifier when applicable. No random
trivia, invented user facts or model-generated approval controls.

An approved proposal remains distinct from a verified rerun. Show only recorded
measurements, state clearly when the review service is unavailable, and route
decisions to the configured RRFlow review surface. A link opens a review; it
does not activate a rule. Recorded fixtures are labeled prominently, including
“simulated attempts” and “replay score change”. No reset control deletes history.

Retain the palette, typography and animation tokens below. Knowledge cards use
the raised surface and cobalt links; amber identifies a proposed change and
green identifies approval. Loading, empty and error states remain distinct.
Group results and learning notes under level-two headings beneath the page
heading. Keep rule matchers and implementation metadata inside “Technical
details”. Receipts show only fields present in the stored event, including an
experiment identifier for experiment events; missing rule fields stay absent.

The working conversation sits beside the improvement evidence on the same page.
It uses plain role labels and preserves line breaks in coding replies. Pending,
failed, replied-but-unsaved and acknowledged-memory states have distinct copy.
Memory notes quote actual selected records and disclose their IDs and sources;
curated teaching notes are selected from the latest message and memory events.
Policy decisions show their version and event receipt. Browser history and
hosted memory are described separately. Starting a new conversation changes the
session, while the single-operator demo keeps its server-owned memory identity.

Assistant replies render CommonMark with `react-markdown`: readable emphasis,
lists, links, quotes and fenced code. User messages remain plain text. Generated
headings stay at level three within the chat section; code and long identifiers
wrap inside their message card. Code blocks use the ink surface, subtle line
border and monospace type. Links use cobalt and a visible keyboard focus ring.
Raw HTML is skipped, and the renderer keeps its default URL filtering.

## Aesthetic Direction

**Control room / audit ledger.** VibeGuard is a governance surface: judges and
founders read pass rates, confidence intervals, rule diffs and receipts. The UI
is dark, dense and typographic — closer to an ops console than a marketing
page. Every state has one color and one word (proposed / approved / reverted,
pass / fail). Nothing decorative; the data is the decoration.

Rationale: the audience (hackathon judges, an experienced founder) scans
numbers under time pressure. High contrast, monospace for identifiers and
regex, and a single accent per semantic state make the gate's one-way ratchet
legible at a glance.

## Color Palette (`@theme` tokens in `src/client/index.css`)

| Token | Value | Usage |
|---|---|---|
| `--color-ink` | `#0f1115` | page background |
| `--color-surface` | `#171a21` | cards |
| `--color-raised` | `#1f232c` | inputs, table rows, hover |
| `--color-line` | `#2a2f3a` | borders, chart grid |
| `--color-text` | `#e6e8ee` | primary text |
| `--color-muted` | `#8b93a7` | secondary text, axis labels |
| `--color-signal` | `#f5b73d` | **proposed** rules, warnings, run markers |
| `--color-verdant` | `#3ddc97` | **approved** rules, pass, human actions |
| `--color-ember` | `#ff5c5c` | **reverted** rules, fail, false blocks |
| `--color-cobalt` | `#5b8cff` | held-out series, links, focus ring |

Semantic mapping is fixed: amber = agent proposed (waiting on a human),
green = human approved, red = human reverted. Never reuse these for anything
else.

## Typography

- Display / headings: **Space Grotesk** (Google Fonts) — `font-display`
- Body: **IBM Plex Sans** (Google Fonts) — `font-sans`
- Identifiers, regex, numbers in tables: **JetBrains Mono** — `font-mono`

Headings are tight (`tracking-tight`), uppercase micro-labels use
`text-[11px] tracking-[0.14em] uppercase text-muted`.

## Spacing & Radius

- Page gutter 16px on phones, 24px from `md:`; max content width 1200px.
- Cards: `rounded-xl` (12px), 1px `border-line`, 16–20px padding.
- Controls: `rounded-md` (6px). Badges: `rounded-full`.
- Vertical rhythm in 8px steps (`space-y-2/4/6`).

## Motion & Animation

- `--animate-fade-up`: cards and rows enter with a 320ms translate+fade. Apply
  `animate-fade-up` to new content; stagger with inline `animation-delay`.
- `--animate-pulse-soft`: running state indicator (eval in progress).
- Transitions on hover/focus are 150ms `transition-colors`. No motion on data
  updates besides the fade; charts redraw instantly.
