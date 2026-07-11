# /goal — "The Exchange": the MONEYLEAGUE money theme

**Mission**: reskin every UI surface as The Exchange — trading terminal (dark,
live tool) + engraved banknote (light, PDFs) — per the approved pitch
(artifact "exchange-pitch-v3"). Ship through the existing design-system
pipeline with every enforcement gate green: `check_design_system.py`,
`check_a11y.py`, full `verify_outputs.py`, keyboard/phone/zoom e2e intact.
Theme is *display + language*; no analytical numbers change meaning, no
a11y affordance regresses. Doctrine reference: DESIGN.md (rewritten by D1).

## Ownership (disjoint; nobody commits; orchestrator integrates)

| Agent | Owns exactly |
|---|---|
| D1 design system | `design/` (tokens.json, build_design.py, guilloche.py NEW, regenerated ml.css/tokens.py, fonts in `data/fonts/`), `DESIGN.md`, `docs/DESIGN_SYSTEM.md`, contrast-pair extensions in `scripts/check_a11y.py`, sync `docs/draft_helper/ml.css` |
| D2 helper | `docs/draft_helper/index.html`, `scripts/build_draft_helper_data.py` |
| D3 PDFs | `scripts/build_round_menu.py`, `build_preseason_2026.py`, `build_power_rankings.py`, `build_mock_draft_report.py`, `build_weekly_movers.py` |
| Orchestrator | `scripts/append_adp_history.py` NEW, `.github/workflows/weekly_refresh.yml`, integration, validation, docs, commit |

## FROZEN CONTRACT (build against these names; do not rename existing tokens)

Token VALUE retunes (names unchanged — check_a11y reads names):
- `surface.dark` → vault green family: bg ≈ #0c1710, panel ≈ #12211a,
  panel2 ≈ #1a2f24, row ≈ #16281e, text ≈ #dfe7df, muted ≈ green-tinted
  gray. D1 owns final values; EVERY muted/text/semantic pair must pass the
  existing 4.5:1 gates on the new surfaces (checker enforces).
- `surface.light` → banknote paper: bg/panel = cream (start from
  palette.cream #f7f4ea), panel2 deeper cream, text = engraving ink-green,
  muted/borders recomputed to pass. PDFs inherit automatically.
- `brand.header_a/header_b` → deep vault greens (≈ #0e2417 / #123020);
  `brand.on_brand` stays #ffffff.
- Position, semantic success/warn/danger/info/keeper, focus: values
  UNCHANGED unless a pair fails on the new surfaces — then adjust minimally
  and re-measure.

NEW tokens:
- `semantic.gold` — market-state/premium accent. dark ≈ #e8c76a (text-safe
  on vault panels ≥4.5), light ≈ #8a6d15 (text-safe on cream). Chip form:
  bg #d4a017 with #14130a text (measured-safe dark-on-gold polarity).
- `typography.data` = IBM Plex Mono stack → `--ml-font-data`
- `typography.engraving` = Cinzel stack → `--ml-font-engraving`
- `typography.display` VALUE → Archivo stack (var name `--ml-font-display`
  unchanged; Bebas retired), body stays Inter.

NEW component classes (D1 emits; D2/D3 consume; names frozen):
- `.ml-num` — data numerals: font-data, tabular-nums, right-aligned
- `.ml-tape` — mono ticker strip (static; no animation, ever)
- `.ml-badge--bluechip` — gold ◆ tag (gold chip polarity)
- `.ml-serial` — red mono serial (danger-colored, letterspaced)
- `.ml-seal` — engraved circular seal (Cinzel, gold radial tint)
- `.ml-fineprint` — muted sub-.7rem disclosure text
- `.ml-clock--me` → gold "closing bell" treatment (dark text on gold);
  `.ml-clock--soon` stays warn amber. Pulse + reduced-motion rules unchanged.

Fonts (D1): latin woff2 subsets self-hosted — IBM Plex Mono 400/700,
Cinzel 700, Archivo 600/800 (source: fonts.googleapis.com css2 → gstatic,
UA header required; all OFL — record licenses in data/fonts/OFL_NOTICE.md).
TTF/woff2 files in `data/fonts/`; builder embeds @font-face base64 woff2
into ml.css (≈112 KB total; standalone/PDFs inherit; zero network at
runtime). `mpl_style()` registers TTFs for matplotlib (needs TTF versions:
same gstatic woff2 is fine for CSS; matplotlib needs TTF — fetch TTFs from
the same css2 API with a non-woff2 UA, or convert via fontTools).

`design/guilloche.py` API (D1 implements exactly; D3 imports):
- `lattice_svg(width: int, height: int, stroke: str, opacity: float) -> str`
- `rosette_svg(size: int, stroke: str, opacity: float) -> str`
Deterministic inline-`<svg>` strings (spirograph math from the pitch,
edge-tapered lattice, 9-lobe rosette). No randomness, no files.

Serial format (D3): `SERIES 2026 · WK{ISO week} · {git rev-parse --short
HEAD, fallback "local"}` + per-card ids like `NO. B06-R{round}-{pick}`.
Fine print line: "Past performance (2025: 12th of 12) is not indicative of
future results."

## Hard constraints (all agents)
- Zero raw hex outside design/tokens.json (checker); never hand-edit
  generated files; page CSS = layout only.
- D2: the three standalone-builder anchor strings in index.html are
  byte-frozen (see scripts/build_standalone_helper.py CSS_LINK/DATA_DECL/
  FETCH_INIT); `python3 scripts/build_standalone_helper.py` must pass.
- D2: every check_a11y ARIA/RESPONSIVE assertion stays true — row-draft
  buttons, roving tabindex, #sr-clock, aria-pressed, nth-child(3|4|5)
  column collapse (Δwk = column 8, hidden ≤480px alongside), no page
  hscroll at 375/360, sticky header. Re-run the keyboard e2e.
- Language renames LABEL, never replace numbers: VAL header keeps the
  hidden VBD expansion; "contract: keep '27 @ R4" keeps the round math;
  GUAP suffixes the projection total, never substitutes it.
- Kitsch guard (DESIGN.md): no money emoji in chrome, no moving tickers,
  gold only for market state + blue-chip tier.

## Per-agent definition of done
- D1: builder regenerates clean; check_design_system green;
  check_a11y --only contrast green with gold/cream pairs ADDED to the
  data-driven pair list; fonts load in a real browser (document.fonts);
  one PDF builder runs (tokens.py consumers alive); DESIGN.md rewritten
  hex-free; both-theme screenshots.
- D2: keyboard-only draft flow re-verified in Chromium; 375/360 no
  hscroll with Δwk hidden; movers tape + Δwk show real deltas when git
  HEAD has a previous players csv (else gracefully blank); standalone
  builds; zero-hex scan passes.
- D3: all 4 PDFs render >100 KB with guilloché + serials + fine print;
  round menu still 1 page; preseason gains keeper-bond styling; movers
  briefing reads as a market report; visual screenshots of each PDF page 1.

## Sequencing
D1/D2/D3 launch in parallel against this contract. D2/D3 self-test with
temporary injected styles / current tokens until D1's regeneration lands,
then re-test for real. Orchestrator: adp_history plumbing, then
integration (full pipeline + verify), design-review + a11y-review skills,
final e2e, docs, commit, push master.
