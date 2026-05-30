# GridironChain — Realism Audit Runbook

> **Purpose.** Two headless Node harnesses that run the *real* game engine
> (no browser) over many games/seasons and check that the output matches NFL
> reality. They exist so realism tuning is **regression-proof**: change a
> formula, re-run the audit, see immediately whether you helped or broke
> something. This doc is the durable record of *how to run them*, *what every
> metric means*, the *NFL reference bands*, and the *calibration history* —
> so this exercise can always be reproduced.

---

## TL;DR — how to run

```bash
cd gridiron-chain

# Game realism (fast). Arg = seasons; each season = 992 games (32 teams round-robin).
node _sim_audit.js 2       # ~1 min, quick sanity (1,984 team-games)
node _sim_audit.js 5       # ~8 min, clean sample (4,960 team-games)

# Franchise + player development + Brady-gem pipeline (slow — plays full seasons).
node _brady_audit.js 40    # ~17 min — standard
node _brady_audit.js 100   # ~40 min — settles the noisy Brady cadence
```

No flags, no build step, no browser. Output is plain-text tables with NFL
bands and `OK` / `!!` flags. Stderr carries progress + benign noise (filter
with `2>&1 | grep -vE "missing pick|IDB|^\s+at "` if you want it clean).

---

## The two harnesses

### 1. `_sim_audit.js` — game realism
Runs `new GameSimulator(home, away, rosterH, rosterA).simulate()` directly for
every matchup, **freshly generated rosters each season** (no franchise layer,
no development). Answers: *"does a single game produce NFL-shaped box scores?"*

Three tables:
- **NFL REALISM AUDIT** — per-game volumes + per-attempt rates + efficiency.
- **DISTRIBUTION** — P10/median/P90 + min/max + std per metric (catches tail
  bugs a mean would hide, e.g. a clamp truncating the top end).
- **EVENT RATES** — rare-event shape checks (shutouts, blowouts, multi-INT…).
- **DRIVE / SITUATIONAL / KICKING** — drive outcomes, 3rd/4th-down, red zone,
  FG by distance, XP, punts, OT.
- **PER-POSITION PRODUCTION** — for each O/D/ST position's *starter*, per-game
  median/P10/P90/max of key stats + milestone-game frequencies (300+yd QB
  games, 100+yd RB/WR games, multi-sack DL, INT-game CB, etc.). The fastest way
  to spot a position over/under-producing. (OL shows n=0 — not individually
  tracked beyond team pancakes.)

### 2. `_brady_audit.js` — franchise + player development
Drives a full franchise headlessly season-by-season (plays every game + the
playoff bracket, runs the awards/retirement/draft/offseason chain). Answers:
*"does the league develop like the NFL over decades, and does the hidden-gem
→ legend ('Brady') pipeline fire at the right rate?"*

Tables:
- **BRADY-TEST AUDIT** — hidden gems rolled + legend-tier (OVR ≥ 96) emergences,
  late-round (R5+) and Brady-tier (R6+/UDFA) cadence vs the ~1-per-75-yr target.
- **RECORD BOOK** — career / single-season / single-game leaders (offense +
  full defense).
- **LEAGUE OVR DISTRIBUTION** — active-roster OVR spread pooled over all seasons.
- **DRIFT BY DECADE** — isolates real OVR creep from artifacts.
- **OVR BY DRAFT ROUND** — pedigree gradient (R1 → R7 → UDFA), late-round
  outliers = gem emergences.
- **BUST / HIT RATES BY DRAFT ROUND** — career-peak based; round-tiered bust
  thresholds.
- **FRANCHISE HEALTH** — competitive balance (win% spread, persistence,
  worst-to-first, champion concentration).
- **CAREER LENGTH BY POSITION** — attrition gradient (RB/DL short, QB/K/P long).
- **LEGEND CAREERS** — full per-season story for every OVR-96+ player:
  trajectory, accolades (SB/MVP/All-Pro/PB), career totals.

---

## How the headless technique works (for maintainers)

The game is vanilla browser JS (no modules/exports). Each harness:
1. Reads the `play-*.js` source files as text and concatenates them into one
   string, so their top-level `const`/`class`/`function` declarations share a
   single lexical scope (they don't attach to a VM global).
2. Prepends a **minimal DOM shim** — a chainable `Proxy` stub that absorbs any
   DOM access without throwing, plus `confirm`/`alert`/`localStorage`/
   `indexedDB` no-ops. UI-init calls that run at file load are stripped via
   `stripUiInit()`.
3. Appends the audit code, then executes the whole thing with
   `new Function(bundle)()`.

**Files loaded** (order matters — dependency order):
`play-data → play-player → play-render → play-sim → play-motion → play-engine`
and, for the Brady audit, also `play-broadcast` (defines `_bspnLiveAbbr` that
franchise award/record code calls) + the four `play-franchise-*.js` files.

**Gotchas learned the hard way:**
- The harness string is a template literal: inner newlines must be `\\n`, not
  `\n` (a `\n` terminates the outer string → `SyntaxError` at `new Function`).
- `node --check` only validates the *outer* file; it does **not** catch errors
  inside the bundled string. Always smoke-run (`node _x_audit.js 2`) after edits.
- Render functions are re-assigned to no-ops *at runtime* (bareword, not
  `globalThis[...]`) because the bundled scope isn't `globalThis`.
- The Brady audit drives the season explicitly (`frnSimToEndOfSeason` →
  `showFrnAwards` → `frnProceedToRosterChanges` → `frnGoToDraft` →
  `frnAutoDraftRemaining` → `frnDraftFinishScramble` → `frnNewSeason`) because
  the live phase machine expects UI clicks. **`showFrnAwards` is mandatory** —
  it runs `_processSeasonEndRetirements` (aging + retirement + the gem breakout
  reroll) AND `_stampSeasonAccolades`. Skipping it silently zeroes development.
- `frnDraftFinishScramble` is mandatory too — it calls `_draftFinalize`, which
  **mints the next future year's draft picks**. Skip it and the pick inventory
  (seeded with only 3 years) runs dry by season 4 and the draft collapses to
  UDFA-only.

---

## Metric reference — NFL bands

> Bands are deliberately a bit wider than real single-season NFL averages
> because the sim pools many games; they're tuned to flag *systemic* drift,
> not single-game noise. A metric being in-band = realistic; `!!` = investigate.

### Game realism (`_sim_audit.js`)
| Metric | NFL band | Notes |
|---|---|---|
| Points / game (per team) | 17–27 | ~22.5 real |
| Total yds / game | 290–380 | |
| Pass yds / game | 190–270 | |
| Rush yds / game | 90–145 | |
| Completion % | 58–69% | |
| Yards / carry | 3.9–4.9 | |
| INT rate / att | 1.8–3.4% | |
| Sacks / game | 1.6–3.3 | |
| Turnovers / game | 0.9–2.1 | |
| First downs / game | 16–24 | |
| Penalties / game | 4–8 | |
| Penalty yds / game | 35–70 | DPI single-counts (verified not double) |
| Plays / game | 58–68 | |
| Yards / play | 5.0–6.0 | NFL ~5.4 — cleanest "offense hot/cold" tell |
| Points / play | 0.30–0.42 | all-snap basis (NOT scoring-plays-only) |
| Yards / completion | 10.0–12.5 | |

### Drive / situational / kicking (`_sim_audit.js`)
| Metric | NFL band |
|---|---|
| Drives / team-game | 10.5–12.5 |
| Points / drive | 1.6–2.3 |
| Yards / drive | 28–36 |
| TD / drive | 18–26% |
| FG / drive | 9–18% |
| Punt+TO / drive | 48–62% |
| 3rd-down conv % | 36–44% |
| 4th-down conv % | 45–60% |
| Red-zone TD % | 52–66% |
| FG % (overall / 0-39 / 40-49 / 50+) | 82-90 / 93-100 / 78-90 / 55-75% |
| XP % | 92–97% |
| Punt avg | 43–48 |
| OT game % | 4–10% |

### Franchise health (`_brady_audit.js`, bands scale with sim length)
| Metric | Band | Meaning |
|---|---|---|
| Best team win% (P99 season) | 76–90% | best season shouldn't be 17-0 every year |
| Worst team win% (P01 season) | 10–24% | nor 0-17 |
| Win% spread P90–P10 | 30–55 pts | league not too flat / too lopsided |
| Yr-to-yr persistence (Pearson r) | 0.30–0.65 | good teams stay good, but not permanently |
| Worst-to-first rate | 3–12% | turnaround stories exist |
| Unique champions | ≥ ~45% of seasons | parity |
| Repeat / most titles | small | dynasties exist but aren't permanent |

### Brady-gem cadence (`_brady_audit.js`)
Target ~**1 Brady-tier (R6+/UDFA → OVR 96+) emergence per 75 years**.
**This metric is Poisson-noisy** — at 40 seasons you'll see anywhere from 0 to
4 and it spans the whole target range. Only judge cadence on **100+ season
runs**. The lever is `GEM_DEV_BREAKOUT_P` in `play-franchise-stats.js`
(`_rerollPotentialForBreakouts`).

---

## Calibration history — what we changed and *why*

> The audits *found* every one of these. Kept here so the reasoning isn't lost.

**Game engine**
- **INT rate 1.4% → 2.7%** — base bump + clamp lift; the old 0.030 clamp was
  truncating the high-pressure tail. (commit `523bc97`)
- **Points/play /2 bug** — audit metric (not engine) was halving it and
  false-flagging; fixed. (`e656a16`)

**Hidden-gem → legend ("Brady") pipeline** — this was badly broken; the audit
was the only way to see it:
1. **Draft never ran** in the harness → 0 gems. Fixed by driving the real
   offseason chain. (`e651dc3`)
2. **Games are required** — the gem breakout (`_rerollPotentialForBreakouts`)
   is gated on in-season production; a games-free loop produced 0 breakouts.
   (`184a8f2`)
3. **Pick inventory ran dry** by season 4 → draft collapsed to UDFA-only.
   Fixed by calling `frnDraftFinishScramble`/`_draftFinalize`. (`e651dc3`)
4. **Recompute clawback** — gem grind + breakout set `p.overall` directly, but
   the physical-decline pass recomputes `overall = calcOverall(stats)`, which
   only "saw" the 2 stats the grind bumped → ~28% of growth retained, so
   high-ceiling gems stalled ~OVR 85 and never emerged. Fixed by growing
   *developable stats* instead (`_applyGemDevelopment`, `_gemDevStats`):
   retention 28% → 88%. (`acb893c`)
5. **K/P excluded from gems** — punters were becoming OVR-99 legends (AWR is
   42% of K/P OVR, grows in-season, and K/P don't decline). (`f725108`)
6. **Emergence = peak OVR ≥ 96** (dropped the stale first-sighting ceiling
   filter — the breakout *raises* the ceiling mid-career). (`06b9c6a`)

**Player development**
- **`_peakMult`** [0.75, 1.05] — per-player OVR ceiling, rolled once. Creates
  real R1 busts (old model converted ~every R1 to a Pro Bowler). (`b1a7d66`)
- **`_devMult`** [0.30, 1.20] — per-player dev *timing* variance. (`b1a7d66`)
- **Breakout gate tightened** top-5% → top-3% + bump 5-10 → 1-4 (non-gem), to
  pull the league 90+ share toward NFL ~2-3% after the clawback fix made
  breakouts stick. (`31bb8f5`)

**Initial roster generation** (`genRoster`/`genPlayer` in `play-player.js`)
- League started star-poor: 0 players at 95+, every team's #1 capped at OVR 80.
  Three fixes: probability-weighted tier mix (elite tier was *never* used),
  tier-aware TEC (TEC caps at 80 but is 15% of every OVR → structural ceiling),
  and fixed an inflated CB AGI/COV floor. Result: ~30 players at 90+, a few at
  95+, position medians cluster 70-76. (`bf31438`)

---

## Known limitations
- **Brady cadence is Poisson-noisy** — needs 100+ seasons to judge. (covered above)
- **3-and-out rate omitted** — the engine's `drives[]` don't carry per-drive
  play counts, so we can't derive it cleanly.
- **Drive outcomes lump "FG/Punt/TO"** in the engine result string — the audit
  re-derives FG vs TD vs TO from score deltas; punt-vs-nonscoring-TO aren't split.
- **Games-free roster bloat** — *only* a concern in ad-hoc probes; the Brady
  audit runs the real offseason which cuts to 53 (`_trimAiRostersToCap`).
- **Offense currently runs ~5% hot** (yds/play ~6.3 vs ~5.4 NFL) — open tuning
  item as of this writing.

---

## Adding a new metric
1. **Accumulate** in the per-game/per-season loop (most raw fields already
   exist on `r.stats[side].team`, `r.stats[side].players`, or `r.full.drives`
   / `r.full.plays` — grep `play-engine.js` `_emptyLine()` for the field name).
2. **Compute + add a row** to the relevant table array (`B` / `D2` in
   `_sim_audit.js`; the report blocks in `_brady_audit.js`) with `[label, value,
   lo, hi, fmt]`.
3. **Use `\\n` not `\n`** in any new `console.log` inside the harness string.
4. **Smoke-run** `node _x_audit.js 2` (don't trust `node --check` alone).
