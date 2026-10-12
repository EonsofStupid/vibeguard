# Design Style Guide — VibeGuard

STATUS: ESTABLISHED (2026-10-11)

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
