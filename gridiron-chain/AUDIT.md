# Hashmark Heroes — Realism Audit Runbook
*(originally documented as "GridironChain"; renamed 2026-05)*

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

# ⭐ STANDARD: the FULL bundle ("all materials") — run THIS after any sim/talent
# change. Runs both harnesses in parallel; produces game-realism stats AND the
# franchise/career/record-book materials (incl. BEST SEASON BY POSITION).
./_audit_all.sh 40         # logs → /tmp/audit_sim_40.log + /tmp/audit_brady_40.log
./_audit_all.sh 100        # settles the noisy tails (K/P, Brady cadence, legends)

# Or the harnesses individually:
# Game realism (fast). Arg = seasons; each season = 992 games (32 teams round-robin).
node _sim_audit.js 2       # ~1 min, quick sanity (1,984 team-games)
node _sim_audit.js 5       # ~8 min, clean sample (4,960 team-games)

# Franchise + player development + Brady-gem pipeline (slow — plays full seasons).
node _brady_audit.js 40    # ~17 min — standard
node _brady_audit.js 100   # ~40 min — settles the noisy Brady cadence
```

> **Standard practice:** every simulation/talent change gets the **full bundle**
> (`_audit_all.sh`), not a single harness — both the per-game realism *and* the
> franchise/career materials. The 100-season run is the truth for any
> tail-sensitive question (per-position 90+ rates, K/P, legends) — 40-season
> per-position tails are small-sample noise.

No flags, no build step, no browser. Output is plain-text tables with NFL
bands and `OK` / `!!` flags. Stderr carries progress + benign noise (filter
with `2>&1 | grep -vE "missing pick|IDB|^\s+at "` if you want it clean).

---

## ⚠ Harness invariant — the draft class MUST cycle (rosters stay ~full)

**The big one — found & fixed.** `_brady_audit.js` drove the offseason with a
*synchronous* `step()` that fire-and-forgot the **async** draft chain
(`frnAutoDraftRemaining`, `frnDraftFinishScramble`, which `await _frnConfirm`).
The part that **mints next year's draft picks and fills rosters to 53 never
ran**, so the pick inventory (seeded with only ~3 years at `startFranchise`)
stopped cycling. From ~season 4 the draft starved, rosters bled out via
retirement, and the league collapsed to **~6 players/team**. Every long-run
roster-dependent metric — roster construction, cap utilization, **and the
talent distribution itself** — was computed on a ~190-player league instead of
~1,700. It failed **silently** (an un-awaited Promise; node just exited 0).

**Fix (commit `0c3955d`):** `await` the async offseason steps (`stepA`),
auto-resolve `_frnConfirm` headless (`async () => true`), make the
`requestAnimationFrame` stub actually fire its callback (so frame-yield awaits
resolve instead of hanging), async IIFE + clean `process.exit(0)`.

**Guard (so it can't recur):** the season loop checks mean roster size each
season after season 2 and **aborts LOUD** (`process.exit(3)`, banner) if it
drops below 40/team. A regression in the await chain trips this in seconds
instead of emitting 13 minutes of garbage.

**Recognize it again by:** "mean roster size" well under 53 in the LEAGUE OVR
DISTRIBUTION header; round buckets dominated by R4–R7/UDFA with a tiny R1 count;
cap utilization near 0%.

**Sample size (healthy):** a full league is 32 × 53 = **1,696 players**; the
audit snapshots active rosters once per season, so an N-season run pools
**~1,696 × N player-seasons** for the league OVR / draft-round distributions
(40 seasons ≈ **~68,000 player-seasons**). The collapsed runs pooled only
~7,300 over 40 seasons (~183/season) — a ~9× smaller *and* survivor-biased
sample. Career/bust tables count distinct players (thousands); ROSTER
CONSTRUCTION + cap are the final-season snapshot (1,696 players / 32 teams).

**⚠ Consequence:** numbers in `TALENT_MODEL.md` predating commit `0c3955d`
were measured on collapsed rosters and need re-validation. First clean read:
elite 90+ share moved 1.3% (collapsed) → 4.4% (full, 3 seasons).

## ⚠ Harness invariant — production stats are REGULAR-SEASON ONLY

`_brady_audit`'s per-player season/career **production** (season highs, career
leaders, best-by-position, single-game highs, TOP-10-by-position, typical
career) accumulates **only from regular-season games**. The `frnSimOnce`
wrapper returns early when `isPlayoff` — otherwise a deep playoff run folds ~4
extra games into a player's "season", inflating every production view (a
Super-Bowl QB's season/career totals balloon). This was a real bug, fixed; if
you see season-game counts above the regular-season length or suspiciously high
season totals for contending teams, the `isPlayoff` guard has regressed.
(Talent / OVR / roster / cap / gem snapshots are roster-based and unaffected
either way.) `_sim_audit` is regular-season by construction — round-robin, no
bracket, one line per game.

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
- **PLAYBOOK BREAKDOWN** — per-team-game tagged by the offense's playbook:
  pass%, pass/rush yds, yds/play, points, sacks-allowed. Confirms the 5 schemes
  differentiate (AIR_RAID 66% pass / 6.8 ypp / most pts; GROUND_AND_POUND &
  OPTION run-heavy; OPTION fewest sacks — QB keepers dodge the rush). Also
  surfaces the passing-hot theme (AIR_RAID over-scores).
- **WEATHER BREAKDOWN** — per-team-game tagged by condition: comp%, yds, points,
  fumbles, FG%. Gradient: CLEAR best → WINDY/HOT mild → RAIN/SNOW worst (cut
  comp% + FG%, spike fumbles). (WINDY/HOT quirks fixed — see calibration.)
- **COACHING BREAKDOWN** — `_sim_audit` injects a `franchise.coaches` stub
  assigning each team a balanced HC `specialtyTrait`, then tags 4th-down
  go-attempts / conversion% / points by trait. Confirms `hcAggMul` fires:
  Riverboat Gambler 1.56 go/g > Neutral 1.27 > Game Manager 1.22 > Conservative
  0.96 (62% more aggressive than Conservative).
- **DEFENSIVE SCHEME / PERSONNEL / COVERAGE** — per-play tags from the play log.
  DEF SCHEME: plays%, yds/play faced, comp% allowed, sack% (DIME tightest comp +
  most sacks, BASE_43 best run-stop). PERSONNEL: plays%, yds/play, pass% (SPREAD/
  EMPTY most efficient + pass-leaning, HEAVY/I_FORM run-heavy). COVERAGE: per
  completion Y/CMP (which shell gets beaten deepest — coverage is logged only on
  completions, so comp%-allowed isn't derivable).
- **FATIGUE BREAKDOWN** — reads `sim._fatigue` post-game; end-of-game fatigue
  (med/P90/max) by starter position + per-quarter yds/play. Workhorse trench
  players (OL/DL) end ~59 median / ~68 P90, RB workhorse P90 ~60, QB/low-snap
  stay fresh; Q4 efficiency dips ~3% (realistic). (Caught the no-recovery bug —
  see calibration.)
- **RUN-PLAY YARDAGE HISTOGRAM** — per-play yardage distribution for run plays
  (incl. scrambles) by down. 7 buckets: `loss / 0 / 1-3 / 4-9 / 10-19 / 20-39 /
  40+`. Per-down columns + mean + 10+% (chunk rate). Reveals shape bugs a mean
  would hide. 4th-down runs hit more chunks (defense sells out for stop). 1-season
  smoke: run mean 5.0 (NFL ~4.4, slightly hot).
- **COMPLETION YARDAGE HISTOGRAM** — per-completion yardage distribution by
  down (catches only, sacks/incompletes excluded). Same buckets. 3rd-down
  completions are deepest (mean 13.6, 60% gain 10+ — engine throws downfield
  on 3rd correctly). 4th-down completions shortest (checkdown bias).
- **3RD-DOWN CONVERSION BY DISTANCE** — `short(1-2)/medium(3-6)/long(7-10)/
  xlong(11+)` att/conv/conv% with NFL bands per bucket (~70/45/30/17%).
  Smoke: 72/50/33/20%, all in band. Catches shape bugs a 41.6% aggregate would
  hide.

### 1b. `_qb_probe.js` — QB-archetype isolation probe
`node _qb_probe.js [games]` (default 300). Builds **one fixed home roster + one
fixed opponent under a fixed seed**, then swaps ONLY the home QB across hand-built
profiles (pocket cannon / dual-threat / noodle-arm-quick-legs / balanced),
dropping all other home QBs so the profile QB always starts. Seeded RNG ⇒ cast,
opponent, and game conditions are identical across profiles and run-to-run, so
**win% + production are directly comparable** (the QB is the only variable).
Reports OVR, archetype, win%, pass line, and QB rush line per profile. This is
the regression tool for the dual-threat run game.

### 1c. `_arch_probe.js` — positional archetype isolation probe
`node _arch_probe.js [POS|ALL] [games]` (default ALL 200). For each position it
generates one exemplar of every archetype near a common OVR (realistic stat
profiles via rejection sampling), swaps it/them into a fixed home lineup as the
starter(s) — with deliberately-weak fixed backups so the exemplar ALWAYS starts,
even for picker-rare archetypes — and runs seeded games vs a fixed opponent.
Reports each archetype's signature stats: own line for skill positions
(QB/RB/WR/TE/K/P), the OPPONENT offense for defensive units (DL/LB/CB/S), team
aggregate for OL. **This is how you tell a real archetype from a flavor label**:
if two archetypes produce the same box score, the label is cosmetic. Verdict
(2026-05): every archetype differentiates except the three HYBRID types
(TE/LB/S) which were flavor-only and picker-capped to low OVR — since fixed.

### 1d. `_jumbo_probe.js` — 13-personnel matchup probe
`node _jumbo_probe.js [games]` (default 250). Forces the offense into JUMBO (13
personnel — 1 RB / 3 TE / 1 WR) on every play, pins the defense to each scheme
(BLITZ_46 / BASE_43 / BASE_34 / NICKEL / DIME / PREVENT) via getter shadow, and
measures how 13-personnel produces against each. Answers *"what is 13 personnel
best against?"* Confirms design intent: 13 punishes blitz/heavy fronts via PA
shots (BLITZ_46 6.81 Y/play, 30 PTS/g — best for offense); least valuable vs
DIME (6.26, 27.3 PTS/g). Seeded → reproducible.

### 1e. `_ux_snapshot.js` — Playwright visual-verification harness
`node _ux_snapshot.js [shot|ALL]` (default: all default shots). The UX
counterpart to the audit harnesses — instead of stats, produces directly-
readable PNG screenshots in `/tmp/ux/` for every major UI state. Backbone of
the UX retune (banner removal, delete safety, Quick Start flow, nav rail).

**Prereq**: an http-server on :5173 (run once per session, persists in
background): `nohup npx http-server -p 5173 -c-1 -s . > /tmp/dev-server.log
2>&1 &`. Uses the pre-installed Chromium at `/opt/pw-browsers/chromium-1194/`
via the global Playwright (`/opt/node22/lib/node_modules/playwright`); the
`node_modules` install in repo root is just the deps record (gitignored).

**Default shots:**
- `cold` — fresh visitor, no saves (the cold-start screen)
- `returning` — seeded slot data, slot list visible
- `mobile` — 390×844 viewport
- `dev` — `?dev=1` URL — testing-tools entry
- `slot-menu` — `⋯` popover (rename / delete) open
- `delete-modal-low` / `delete-modal-high` — styled confirm modal, with + without type-name gate
- `story-picker` / `story-picker-mobile` — the Choose Your Story archetype view
- `navbar-fa` / `navbar-awards` / `navbar-playoffs` — in-loop nav rail per phase

**Interactive driver** — each shot has optional `setup(page)` (pre-navigation:
seed localStorage) + `after(page)` (post-navigation: click/type to reach the
target UI state). `franchise` is a top-level `let` (not on window) — access by
name from `page.evaluate`, NOT `window.franchise`.

### 2. `_brady_audit.js` — franchise + player development
Drives a full franchise headlessly season-by-season (plays every game + the
playoff bracket, runs the awards/retirement/draft/offseason chain). Answers:
*"does the league develop like the NFL over decades, and does the hidden-gem
→ legend ('Brady') pipeline fire at the right rate?"*

Tables:
- **BRADY-TEST AUDIT** — hidden gems rolled + legend-tier (OVR ≥ 96) emergences,
  late-round (R5+) and Brady-tier (R6+/UDFA) cadence vs the ~1-per-75-yr target.
- **BEST SEASON BY POSITION** — the best individual (real-named) single season
  at each of the 11 positions, ranked by a position-appropriate metric (QB
  pass yds+TD, RB rush yds, WR/TE rec yds, OL pancakes, DL sacks, LB tackles,
  CB/S INTs, K FG made, P punt yds). Filters the engine's placeholder
  stat-key aggregates ("QB"/"WR1"/"MLB" — nameless lines bucketed by slot).
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
- **STAR CAREERS** — top-15 peak-90+ careers that never crossed the 96+ legend
  bar (Nasser/Peterson/Sherman tier). Header includes archetype; long careers
  windowed to 8 seasons around the peak. Closes the gap where generational
  near-legends left no career record. (`starPlayers` map; sec ~242, dump ~1040.)
- **INJURY REPORT** — injuries/team-season (contact vs non-contact split),
  non-contact share %, season-ending (8+ wk) rate, career-ending rate, games
  missed, median/P90 weeks out, by-position rate, and injury-type frequencies.
  Captured by wrapping `_rollGameInjuries` + `_rollNonContactInjuries` (which
  fire per game in `recordFranchiseResult`) so every injury is tallied at
  assignment — players later cut/retired are still counted. This is also the
  only lens on the **HEADHUNTER** archetype, whose identity is causing injuries
  (×1.5 on big hits), invisible to the box-score archetype probe. Also split by
  **HC culture trait** (Disciplinarian lowest) and **trainer trait**.
- **STRESS REPORT** — final-season `_stress` (0-100) by position; drives
  non-contact injuries. Concentrates in WR/CB/S; OL/QB/RB/TE near 0.
- **PERSONALITY REPORT** — league distribution % (matches gen rates) + avg
  career length by personality (captain/cancer/quiet_pro/showman/coachs_son).
- **SALARY CAP** — final-season payroll/cap utilization (mean/P10/P90).

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

### Injuries (`_brady_audit.js` INJURY REPORT)
> Bands are **approximate** — NFL "injuries causing missed time" isn't a clean
> public stat; these flag systemic over/under-injury, not precise rates.

| Metric | Band | Notes |
|---|---|---|
| Injuries / team-season | 18–42 | all injuries costing ≥1 game |
| Non-contact share % | 28–45% | soft-tissue/stress (code targets ~40%) |
| Season-ending (8+ wk) / team-season | 4–14 | ≈ IR placements |
| Position gradient | WR/CB/S high, QB/OL/K/P low | speed positions tear soft tissue |
| Median weeks out | ~2–3 | most injuries are short soft-tissue |

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

**Archetype differentiation** (found via `_arch_probe.js` — all 11 positions
swept; every archetype confirmed to move the box score except where noted)
- **Dual-threat QB run game** — designed QB runs were playbook-gated (only
  OPTION); now archetype + mobility driven. DUAL_THREAT 2.3→9.8 rush att/g.
  (`dc8b5e4`)
- **RB fumble tilt was inverted** — POWER's high STR drove the grip term so low
  the ×1.35 fumble multiplier was canceled (power backs fumbled *least*). Grip
  is now AWR-dominant + dampened; archetype tilt is additive. POWER now > ELUSIVE
  as intended; league turnovers stay in band. (`ec2a2e8`)
- **K long-range was invisible** — FG attempt ceiling was a flat 57 yd for every
  kicker. Max attempt distance now scales with leg + LEG/PRECISION archetype:
  LEG FGlong 57→61 (and lowest FG%), PRECISION 53 (highest FG%). League FG%
  83.6% (in band). (`ec2a2e8`)
- **WR SLOT played like a deep threat** — ELUSIVE break + 1.15 YAC mult gave it
  house-call YAC (led team in Y/REC + long). Dampened its explosive break bonus
  + capped per-catch YAC (26). Pulled back (Y/REC 13.8→13.1, LONG 61→55) but
  **still edges the field downfield because DEEP_THREAT under-produces** (its
  +3.0 air bonus is canceled by its 0.85 YAC penalty) — see open items.
  (`ec2a2e8`)
- **HYBRID (TE/LB/S) was flavor-only + picker-capped to low OVR** — pickers now
  reward genuine all-around balance (HYBRID appears at real OVR ~82-84), and
  HYBRID gained real balanced hooks (TE air/YAC between receiving+blocking; LB
  partial coverage + run-stuff; S run-stuff + ball production). All three went
  from low-OVR traps to legitimate do-it-all players. (`ec2a2e8`)

**Gameplay systems** (found via the new PLAYBOOK/WEATHER/COACHING breakdowns)
- **Playbooks differentiate correctly** — AIR_RAID 66% pass / 6.8 ypp / most pts,
  GROUND_AND_POUND & OPTION run-heavy, OPTION fewest sacks. (Surfaces the
  passing-hot theme: AIR_RAID over-scores ~30 pts.)
- **Weather: WINDY + HOT were no-ops.** WINDY effects were direction-symmetric
  (helped with-wind, hurt into-wind → averaged to ~0), and HOT was labeled but
  never referenced. Added a net-negative WINDY component to completion/air-yards/
  FG plus a HOT completion dip. Now CLEAR best → WINDY/HOT mild → RAIN/SNOW worst.
- **Coaching: HC trait now exercised + audited.** `_sim_audit` had no franchise,
  so coaching never fired; injected a balanced `franchise.coaches` stub. Verified
  Riverboat 1.56 4th-down go/g > Game Manager 1.22 > Conservative 0.96.
- **Fatigue had ZERO in-game recovery.** `_fatigue` was only ever incremented, so
  starters redlined to ~95-100 by Q4 (OL/DL med 96, RB 84) vs the ~60-70 design
  target — and the stamina stat stopped differentiating once everyone saturated.
  Added sideline rest on the breaks (×0.55 halftime, ×0.88 quarter breaks); OL/DL
  now end ~59 med / ~68 P90, RB workhorse P90 ~60. Both teams equal → box score
  unchanged, Q4 dip preserved (~3%).
- **Coverage comp% was a bogus 100%** — coverage is logged only on completions,
  so incompletes weren't tagged. Relabeled the table to per-completion Y/CMP.

**Engine realism (shipped this session — see TALENT_MODEL.md for the talent retune)**
- **Dual-threat QB run game** — designed QB runs were playbook-gated; now QB
  archetype + mobility drive them, layered on the playbook. DUAL_ELITE 2.3 →
  9.8 rush att/g.
- **RB fumble tilt was inverted** — POWER's high STR drove `grip` so low the
  ×1.35 fumble multiplier was canceled; rewrote as additive `archFumbleAdd` on
  AWR-dominant grip. POWER now > ELUSIVE as intended.
- **K range was invisible** — FG ceiling was a flat 57 yd for every kicker. Max
  attempt now scales with `KPW` + LEG/PRECISION archetype: LEG FGlong 57→61,
  PRECISION 53 (highest FG%). League FG% in band.
- **WR archetype `archAirMod` orphan** — defined at engine ~4986, NEVER consumed
  (only YAC + comp% read the archetype, not air-yards). Wired into `airYds` so
  SLOT actually throws short (was leading the team in Y/REC like a deep threat)
  and DEEP_THREAT boosted +3 → +4.5 to lead vertically.
- **HYBRID archetypes (TE/LB/S) were flavor-only** — engine never read them; pickers
  capped them to low OVR. Pickers rewritten + balanced engine hooks added (HYBRID
  TE air/YAC between rec+blocking; HYBRID LB partial coverage + run-stuff; HYBRID
  S balanced ball production). All three appear at real OVR ~82-84 now.
- **Weather: WINDY + HOT were no-ops.** WINDY effects were direction-symmetric;
  HOT was labeled but never referenced. Added net-negative WINDY comp + air-yard
  + FG penalty + HOT comp dip. Gradient is now CLEAR → WINDY/HOT mild → RAIN/SNOW
  worst.
- **Coaching: HC trait now exercised** in `_sim_audit` (was no-op without
  franchise stub). Riverboat 1.56 4th-down go/g > Game Manager 1.22 > Conservative
  0.96.
- **13 personnel / JUMBO surfaced** + made real. `JUMBO` package added to
  PERSONNEL with run/air/sack/comp mods (best PA in the game, max protection);
  play-by-play chip shows the package; **TE2 now targetable** in 2+ TE sets so
  the 3-TE package has a real 2nd receiving threat.
- **Trade reactions** (chip/sulk/neutral) — personality+age biased roll on every
  trade, replacing the flat +20% boost. Delayed reveal at season-end; cancer+CHIP
  redemption arc (personality flips to normal). Cut-and-resigned gets a milder roll.

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

---

## SESSION STATE — talent retune (IN PROGRESS) + open work

> Recorded so a future session can resume without re-deriving. Two docs split
> the work: this one (`AUDIT.md`) covers the audit infrastructure + game-realism
> calibration; `TALENT_MODEL.md` covers the talent-economy first-principles
> framework + the retune log + queued items. **For talent retune state and
> queued findings, start with `TALENT_MODEL.md`.**
>
> Live position: r-6 in flight (coachBoost cap ≤ 2.0). r-1 through r-5 logged
> in TALENT_MODEL.md "Retune log" section.

### The big architectural arc: unify NFL development onto the college model
**Root finding (took far too long — I anchored on the NFL gem mechanic and never
mapped the player lifecycle until prompted to audit the college pipeline):**
the **college pipeline already has a clean hidden-destiny dev model** — `HiddenOracle`
rolls a hidden `ceiling` (16% land 88+, *decoupled from visible draft tier* — a
2-star can have ceiling 95) + a `_growthRate`; `_developCollegePlayer` grows
**stats** toward it with a per-year **regression** roll, then `overall =
calcOverall(stats)` (stats-as-source-of-truth, no clawback). Bradys are baked in.

**But the NFL handoff threw it away:** `_clearCollegeFlags` *deleted* `_growthRate`,
NFL dev switched to a separate tangle (grind + `peakMult` + breakout reroll) we
patched **7×** and still got **0 Bradys** (60-season baseline: 713 gems, 0 legends).
And `_rollHiddenGem` re-rolled a **duplicate** hidden ceiling on top of the college one.

**Stage 1 — DONE (`49df277`, `71a14b8`):** `_clearCollegeFlags` no longer deletes
`_growthRate`; new `_developNflPlayer(p, mult)` runs the oracle model for pros
(ceiling = `max(p.potential, hiddenGem.ceiling)`; growth via `_applyGemDevelopment`;
**regression roll = bust source**; pre-peak only). Wired into `runFrnOffseason`
behind `const _ORACLE_DEV = true` — **old grind/normal-dev kept in the `else`** for
instant fallback/A-B. `NFL_DEV_SCALE = 0.35` + `0.6*gap` single-year cap (college
rate over-realized everyone: smoke showed R1 mean 91.7, 25% at 95+).

**Stage 2 — PENDING:** once Stage 1 validates, delete the now-redundant
`_rollHiddenGem`, `_rerollPotentialForBreakouts` (the breakout/flash), `peakMult`,
`devMult`. Bradys + busts + year-1 jumps all emerge from the one oracle model
(burst-intensity roll already gives a year-1 jump; regression gives busts).

**Stage 3 — PENDING:** retarget the audit's emergence detection from `hiddenGem`
to "late-round player reaching 96+ via `p.potential`" (cleaner); apply oracle dev
to the **practice-squad** branch too (still on old grind); update the offseason
gains-sheet "hidden-gem hero" UI + scouting tags that read `hiddenGem`.

### IN-FLIGHT validation run (started this session)
`node _brady_audit.js 40` → `/tmp/s1val.log` (bg task `b6q3mr7jb`). **When it
finishes, check:** (1) Brady-tier cadence now NON-ZERO? (2) 90+ share pulled from
9.7% toward NFL ~2-3% (did `NFL_DEV_SCALE` fix the inflation)? (3) R1 bust% > 0 /
PB% down from 93% (does oracle regression create busts)? *Note: `/tmp` logs are
ephemeral — re-run if the container recycled.*

### Open realism fixes (prioritized)
1. **Dual-threat QB run game — DONE.** Designed QB runs were tied to the
   *playbook* (`pb.qbRushPct`, only OPTION set it), so a Lamar/Vick-type on any
   other scheme got ~2 carries/game (all pressure-scrambles). Fix: the engine now
   derives the designed-run rate from the **QB himself** (DUAL_THREAT archetype
   floor + actual SPD/AGI mobility), layered on the playbook; added `qbRushPct`
   to the DUAL_THREAT playbook; QB-run YPC now scales with speed. Probe result:
   DUAL_ELITE 2.3→9.8 rush att, 13→48 rush yds (4.9 ypc), and the dual-threat
   went from a clear downgrade (−6 win%, −80 tot yds vs pocket) to producing MORE
   total offense at equal OVR. League rush/g stayed in-band (no inflation).
   Validate with `node _qb_probe.js`.
   - **STILL OPEN (judgment call):** QB OVR under-weights mobility — a 96-SPD /
     74-THR "noodle-arm quick-legs" profile rates only 77 (backup tier) because
     THR is 42% of `calcOverall` (spd 9 / agi 13). It now *produces* like a
     functional starter (327 tot yds) thanks to the run game, but the rating
     still says backup. Bumping SPD/AGI weight touches draft/dev/all audits —
     left for a deliberate decision.
2. **Offense ~8-10% hot** (the recurring signal): passing yds/att ~7.67 vs ~7.0;
   records 7,599 pass yds / 78 TD / 738 team pts vs NFL 5,477 / 55 / 606;
   QB 300+yd games 33% (NFL ~20%); INT 3.05% / multi-INT 30%. Lever: trim
   passing yds/att (completion% + deep-ball rate) and re-tune INT to ~2.5%.
   Theme: run game (incl. QB-run) under-weighted vs pass.
3. **Elite inflation + R1 busts** — same root (high-potential players over-convert).
   Stage-1 oracle regression is the intended fix; confirm in the validation run
   before adding more levers. `_peakMult` failed (R1s drafted near-PB already).
4. **WR depth gradient** — after the SLOT YAC nerf, SLOT still slightly leads
   downfield (Y/REC, LONG) because DEEP_THREAT under-produces vertically: its
   +3.0 air-yards bonus is offset by its 0.85 YAC penalty, so it lands mid-pack
   in Y/REC (~12.5) instead of clearly highest. To get a proper depth gradient
   (DEEP_THREAT highest aDOT/long + lowest catch%, SLOT highest volume/short),
   boost DEEP_THREAT's air-yards and/or long-ball rate rather than only nerfing
   SLOT. Lever: `archAirMod` / deep-completion rate in the pass model.

### Gameplay-system audit coverage (what's measured vs not)
**Covered:** offensive playbooks, defensive schemes, personnel packages (incl.
**13/JUMBO** — added 2026-05), coverages, weather, coaching (HC 4th-down +
**culture-trait injury**), fatigue, **stress**, **special-teams returns**, **trick
plays / 2-pt / onside**, **play-type mix + play-action**, **ejections**, **clock
(kneels/spikes/momentum)**, **personality**, **salary-cap utilization**,
**injury-by-trainer**, injuries, every positional archetype (`_arch_probe`),
QB styles (`_qb_probe`), box score / drives / situational / kicking / per-position.
**NOT yet isolated (audit notes them but doesn't deeply attribute):**
- **Coaching:** OC/DC run tilts (`ocRunArchBonus`/`dcRunStopperMalus`),
  `coachBoost` (dev gain by coach) — still not isolated.
- **Trades / free agency** — cap utilization is reported, but per-transaction
  trade/FA realism (volume, value) isn't tracked.
- **Scouting / draft-eval accuracy** (projected vs actual ceiling), GM traits.

### Findings from the new system audits (open realism items)
- **Salary cap not enforced — FIXED.** Teams ran **~127% of cap** (P90 150%):
  `_trimAiRostersToCap` only cut for roster SIZE, and `assignContracts`'
  normalization never re-ran. Added `enforceCapCompliance()` — each offseason any
  over-cap AI team restructures (proportional AAV scale-down + bonus re-proration)
  to ~94% of cap; wired into `frnProceedToRosterChanges` (live + audit). Now 83.9%
  mean / 91.7% P90, no team over. (Mean slightly conservative — rebuilders run
  cheap; raising it is a separate FA-aggression lever.)
- **quiet_pro longevity not showing** — its avg career (~4.0) ≈ normal; the
  "slower decline" trait doesn't translate to longer careers.
- **Trainer effect weak** — Sports Sci isn't clearly the lowest-injury trainer.
- **Stress shape** — concentrates in WR/CB/S; OL/QB/RB/TE ~0 (trench load gap?).
- **Trick-play rates run a touch hot** (flea-flicker ~0.5/g, onside ~0.3/g);
  measurement is correct (log flags), the engine call-rates are slightly high.
- **KR avg ~29 / PR att ~4.4/g** mildly hot vs NFL (~23 / ~2.5).

### Audit-band quirks to fix (cosmetic, measurement-only)
- Franchise-health **unique-champions band** is wrong (set 45-100, impossible —
  capped at 32 teams). - **OL n=0** in per-position (not individually tracked).
- Career-length absolute ~1.5× NFL (definitional — active-roster seasons).
- Injury **count** flags low (15/team-season vs rough 18-42 band) though
  games-missed (~68) is realistic — bands are approximate, may need refining.

### What's solid and shouldn't be re-litigated
Core box score, drive shape, RB room (committee + fumbles fixed), franchise
parity, initial roster OVR shape, the whole audit suite (game-stat 3 tables +
drive/situational/kicking; brady: distribution, decade drift, OVR-by-round,
bust/hit, record book, HOF, awards, team records, milestones, franchise health,
career length, legend careers, positional depth, top-10 QB/league leaders).
