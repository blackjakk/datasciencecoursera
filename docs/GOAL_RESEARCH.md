# /goal — RESEARCH DESK: trade intelligence + autopsy + market screen

**Mission**: a new weekly report, `data/MONEYLEAGUE_RESEARCH_DESK.pdf`,
with four analyses: (1) in-league Trade Ledger (sharks & fish), (2)
Counterparty Dossiers (rivals' trading behavior across their OTHER public
Sleeper leagues), (3) the 2025 Autopsy (why 12th place — decomposed), (4)
Market Inefficiency Screen (FantasyPros consensus vs Sleeper room price).
Everything runs from cached public API data, regenerates in the weekly
pipeline, and ships through the banknote design system.

## Facts agents need (verified)
- Season → league_id: 2023 `1001657805583077376`, 2024 `1085805164784664576`,
  2025 `1245039290518360064` (dirs under `data/sleeper/`, each has
  `users.json`, `rosters.json`, `league.json`). 2026 league not drafted yet.
- Brian = `bigguap69`, user_id `207020614303621120`, roster_id 9.
- Sleeper API is public, no auth: `/v1/user/<uid>/leagues/nfl/<season>`,
  `/v1/league/<lid>/transactions/<week>` (week 1..18), `/matchups/<week>`,
  `/rosters`, `/users`; weekly player stats:
  `https://api.sleeper.com/stats/nfl/regular/<season>/<week>` (note .com
  host for stats, like scripts/backtest_recommender.py uses).
  Throttle ~0.15s between calls; User-Agent header; retry once on failure.
- Player id → name/pos: `data/sleeper/players_nfl.json` (14MB, on disk).
- Manager display names ↔ ids: `data/sleeper/league_*/users.json`;
  MANAGER_COLORS keys in design/tokens.py use snake ids (mgr_color()).
- Draft pick assets in trades appear as `draft_picks` entries.

## Ownership (disjoint; nobody commits; orchestrator integrates)

| Agent | Owns exactly |
|---|---|
| R1 trades | `scripts/fetch_trade_intel.py` (NEW), `scripts/build_trade_ledger.py` (NEW), cache dir `data/scouting/` |
| R2 autopsy | `scripts/fetch_league_history.py` (NEW), `scripts/build_autopsy_2025.py` (NEW), cache dir `data/league_history/` |
| R3 screen | `scripts/build_market_screen.py` (NEW), the INEFFICIENCY section added to `scripts/build_weekly_movers.py` (R3 owns that file for this task) |
| Orchestrator | `scripts/build_research_desk.py` (assembler), pipeline/verify/workflow/HEX-scan wiring, landing-page papers card |

## The fragment contract (all three agents)
Each build script, when run, writes TWO artifacts into `data/research/`:
- `<name>.json` — the findings, machine-readable (committed; the cache of record)
- `<name>.html` — ONE self-contained `<section>…</section>` fragment styled
  ONLY with ml.css classes/vars (ml-panel, ml-card, ml-table, ml-num,
  ml-serial, ml-fineprint, ml-badge--*, ml-sv-*) and NO raw hex/rgba, no
  <html>/<head>/<style> wrappers (page CSS belongs to the assembler). Any
  color must be `var(--ml-*)` or a class. Scripts will be ADDED to the RAW
  HEX scan — write accordingly (hex in comments is fine).
Section names: `trade_ledger`, `counterparty_dossiers`, `autopsy_2025`,
`market_screen` (R1 emits two).

## Per-agent spec

R1 — Trade Ledger + Counterparty Dossiers:
- fetch_trade_intel.py: (a) in-league transactions, all weeks, seasons
  2023-25 (+2026 when it exists — tolerate 404s); (b) for each of the 11
  rival user_ids: their other leagues per season 2023-25 via
  /user/<uid>/leagues/nfl/<season>, then those leagues' transactions +
  rosters + league settings (format detection: SUPER_FLEX in
  roster_positions; settings.type==2 → dynasty); (c) weekly player stats
  per season (18 weeks × 3 seasons from api.sleeper.com) for rest-of-season
  grading. Cache EVERYTHING under data/scouting/ as json; cache-first
  (skip fetch when file exists) so weekly reruns only pull the current
  season. `--refresh-current` flag refetches the newest season only.
- build_trade_ledger.py:
  * In-league ledger: every completed trade 2023-25 — parties, assets both
    ways (players + picks), week; grade = rest-of-season points swung
    (sum of weekly 0.5-PPR-ish points AFTER the trade week for players
    received minus given, per side; use Sleeper weekly stat `pts_half_ppr`
    if present else pts_ppr − 0.5·rec). All-time W/L per manager, biggest
    heist, worst deal. Fragment: ledger table + sharks/fish standings.
  * Dossiers: per rival across OTHER leagues — leagues count + formats,
    trades closed per season, buy/sell week histogram (early/mid/deadline),
    positional flow (pos acquired minus shipped), picks-traded count,
    same-format flag weighting (SF leagues weighted, called out). Include
    in-league trade count alongside for contrast ("closes 6 deals/yr
    elsewhere, 1 here"). No value-grading cross-league (format-fuzzy —
    say so in fineprint). Fragment: one dossier card per manager
    (ml-card), Tim/Donnie get "no outside book" cards.
- Self-verify: fetch completes with counts logged; ledger totals match
  transaction counts; fragments contain no raw hex (grep); json+html for
  BOTH sections present.

R2 — 2025 Autopsy:
- fetch_league_history.py: matchups weeks 1-17 for seasons 2023-25 (all
  three MONEYLEAGUE ids) → data/league_history/<season>_matchups_w<w>.json
  (cache-first). Matchups give per-roster starters, players, players_points.
- build_autopsy_2025.py — decompose Brian's (roster_id 9) 2025 12th place
  into named, sized buckets (points):
  1. Draft value: cite the backtest verdict (scripts/backtest_recommender.py
     output exists — rerun or hardcode the recorded −154 for 2025 with the
     ~break-even 3-yr context).
  2. Lineup efficiency: per week, optimal-lineup points (from players_points
     over the roster, using MONEYLEAGUE start shape 1QB/2RB/3WR/1TE/1FLX/
     1SFLX/1K/1DEF) minus actual starter points; season total + league rank
     of that efficiency; the 3 worst benchings by name/week.
  3. Roster churn: adds/drops vs league median (from R1's scouting cache if
     present, else in-league transactions — fetch your own copy into
     data/league_history/ to stay decoupled from R1).
  4. Schedule luck: all-play record vs actual record; expected wins delta.
  Also the same table computed for ALL 12 teams (Brian highlighted) so the
  numbers have context. Fragment: verdict banner + decomposition table +
  worst-benchings list + fineprint on method.
- Self-verify: weekly optimal ≥ actual for every team-week (invariant);
  all-play totals sum correctly; 2025 final standings from matchups match
  known result (Brian 12th).

R3 — Market Inefficiency Screen:
- build_market_screen.py: RAW Sleeper superflex ADP (adp_2qb from
  data/sleeper/projections_2026.json) vs FantasyPros superflex consensus
  (data/fantasypros CSV/JSON the pipeline already fetches — find it; it has
  fp_rank_overall / fp_adp_avg). Convert both to overall-pick scale;
  divergence = sleeper_adp − fp_adp. Report top 12 "room is late" (experts
  higher → your value window) and top 12 "room is early" (let them reach),
  with round math ("experts see R3, the room pays R5"). Exclude ADP>180 and
  fp_rank missing. Fragment: two ml-tables + how-to-read fineprint.
- Also append a compact INEFFICIENCY SCREEN section (top 5 each way, text)
  to the MARKET REPORT markdown in scripts/build_weekly_movers.py — same
  computation, import from your module; do not change existing movers logic
  or the injury snapshot schema.
- Self-verify: screen runs from on-disk data only (no network); movers
  markdown still generates; both directions non-empty (or explicitly
  "aligned" when tight).

## Hard constraints (all)
- No credentials, public endpoints only, throttled; caches committed
  (except anything >5MB — check sizes; shard by season/league).
- Zero raw hex outside design/tokens.json; fragments use ml classes only.
- Nothing outside your owned files/dirs; do NOT touch verify_outputs.py,
  refresh_all.sh, workflows (orchestrator wires those).
- Report actual numbers in your summary (trades found, points computed) —
  they go to the user.

## Orchestrator (after agents land)
build_research_desk.py: banknote chrome (design.guilloche + tokens, serial
SERIES 2026 · WK · sha, fineprint) wrapping the four fragments in order:
market_screen, trade_ledger, counterparty_dossiers, autopsy_2025; Playwright
→ PDF. Wire: refresh_all.sh reports stage (fetchers in fetch stage with
cache-first), verify (PDF >100KB + fragments exist), weekly workflow release
upload + landing page papers card. HEX_SCAN_TARGETS += the four new
HTML-emitting scripts + assembler.
