# MFF — advanced-analytics layer (EPA + PFF-style player grades)

> Status: **slices #1 + #2 shipped** — all four trench grades (pass-rush,
> pass-protection, run-stuff, run-block) + combined DL/OL grades. Coverage,
> EPA layer, and LB run-D are planned, not yet built.
> This doc is the resume point for a future session.

## Goal

Add an EPA / DVOA / PFF-family analytics layer ("MFF") on top of the sim:
team & QB **EPA**, and per-player **0-99 grades** for every position. The owner
wants full-position grades ("go all the way"), with the explicit constraint:
do not destabilise the calibration the engine was just tuned to (AUDIT.md bands).

## Architecture decision — attribution-only (Arch A), NOT mechanistic (Arch B)

A deep read of the engine flipped the original risk assessment. The per-rep
matchups are **already computed every snap — they just weren't recorded**:

- `_pickTrenchRep()` (`play-engine.js:2277`) picks a **specific DL + OL player**
  each snap (position-aware: edges vs tackles, interior vs guards/center;
  `overall^2`-weighted) and resolves their battle into the `pressure` scalar
  (`play-engine.js:3034-3044`) via team d-line/o-line ratings + the per-archetype
  `PASS_MATCHUP`/`RUN_MATCHUP` tables (`play-player.js`).
- Coverage already maps target receiver → covering defender deterministically
  (`_coverName`, ~`play-engine.js:4904`) and that defender's COV modulates the
  completion (`compPct`, ~`:5179`).
- Run blocking already resolves a **per-snap** OL-vs-DL win/loss
  (`_trench`/`_battleScore`, ~`:6019-6047`).

So "full-position grades" is mostly a **logging layer**, not engine surgery.

| | **Arch A — attribution-only (CHOSEN)** | Arch B — mechanistic (rejected) |
|---|---|---|
| What | Record the rep outcomes the engine already computes | Rewrite how pressure/credit drive play results |
| Calibration risk | **Zero** — no new `Math.random()`, no outcome change → aggregates byte-identical | Re-opens sack rate, comp%, YPC, INT, turnovers |
| Grade quality | Defensible for OL, DL/edge, CB, S, LB-coverage | Marginally better only for LB run-defense |

The only grade that stays genuinely weak under Arch A is **LB run-defense
tackling / S run-support**, because tackle *credit* is RNG-assigned
(`_creditDefStat`, `:1922`) — a grade there re-discovers OVR. Everything trench-
and coverage-based is real. Arch B's sole win over A (real LB run-D) does not
justify re-doing the whole calibration, so it is rejected.

## Safety model — `_MFF_ATTR` flag + A/B byte-identical proof

- Instance flag `this._MFF_ATTR` (constructor, default on; `opts.mffAttr:false`
  to disable) mirrors the existing `_ORACLE_DEV` pattern.
- **All** attribution writes are gated by it, use the `(x||0)+1` idiom (so the
  new keys only exist when written — `_emptyLine` is untouched), consume **no
  `Math.random()`**, and never mutate an existing field or a play outcome.
- `_mff_ab_check.js` proves the safety property: it patches `Math.random` with a
  seeded PRNG and runs each game **twice from the same seed** — flag off vs on —
  then asserts the box score (`sim.stats`) is **byte-identical** after stripping
  the MFF-only keys. If attribution ever consumed RNG or mutated state, the RNG
  streams desync and the test fails. It currently **PASSES**.
- Independently confirmed: `node _sim_audit.js 2` with the flag on (default)
  still reports every band OK (Completion% 64.3, INT 1.83%, Sacks/g 1.95,
  Turnovers 0.97, Yds/comp 10.5).

## Slice #1 — pass-rush / pass-protection (SHIPPED)

### What the engine now records (gated by `_MFF_ATTR`)
On every dropback, the resolved `reps` pair is credited:
- DL: `pass_rush_snaps`, `pressures` (expected-pressure, fractional), `qb_hits`
  (= sacks). On a sack the existing `sk` credit (`reps.dl`, `:4573`) is unchanged.
- OL: `pass_pro_snaps`, `pressures_allowed`. Existing `sacks_allowed`
  (`reps.ol`, `:4585`) unchanged.

Insertion points in `_playInner`: the per-dropback block sits just before the
sack roll (`if (Math.random() < sackPct)`, ~`:4440`); the sack top-up sits right
after the existing OL sacks_allowed charge (~`:4600`).

### xPressure credit (the key modelling choice)
The engine's `pressure` scalar is a **team** trench quantity (it uses team
d-line/o-line averages + the picked pair's archetype matchup; it does **NOT**
use the individual rusher's own rating). Measured over ~23k dropbacks it sits at
median **-0.12**, range ~[-0.57, +0.24] (OL wins most reps — completions ~62%;
probe: `_mff_press_probe.js`).

A **hard threshold** on it saturated badly — a dominant d-line cleared it on
~95% of reps, producing absurd 90%+ "pressure rates." Replaced with a smooth,
deterministic **expected-pressure (xPressure)** credit per rep:
`xp = clamp(MFF_PRESS_BASE + (pressure − MFF_PRESS_MED)·MFF_PRESS_SLOPE, 0.02, 0.85)`
with `BASE=0.34, MED=-0.12, SLOPE=0.55` (`play-engine.js`, top consts). A sack
tops the rep's credit up to a full 1.0. This lands the **league pressure rate at
36.8%** (NFL ~33-38%) and realistic per-player rates (top rushers ~40-46% over
their *key-matchup* reps — note the denominator is "snaps where this player was
THE resolved rep," a selected subset, so rates run higher than the all-snaps
NFL ~15%).

### Grade formulas (`_mff_audit.js`, 0-99 PFF-style, standardized)
- **Pass-rush**: `60 + 7·z(xPressureRate) + 11·z(sackRate) + 3·z(reps)`.
  Weighted toward sacks because the engine's pressure ignores the individual
  rusher's rating (so rate alone is a noisy individual signal), whereas sacks
  ARE individually credited; reps add a workload signal (picks are `overall^2`).
- **Pass-pro**: `60 − 13·z(pressureAllowedRate) − 6·z(sackAllowedRate)`.

### Validation (2-season round-robin)
- League pressure rate **36.8%** — in NFL band. ✓
- Pass-rush grade ↔ OVR **r=0.47**, pass-pro grade ↔ OVR **r=0.43** — both in the
  target 0.4-0.85 "defensible" band: talent shows through, but the grade adds
  information beyond raw OVR (not circular). ✓
- Face validity: top rushers are OVR 86-90, best blockers OVR 90-94, worst
  blockers all OVR 74-76, with realistic mid-OVR outliers having good/bad seasons.

## Slice #2 — run-block / run-stuff (SHIPPED)

### What the engine now records (gated by `_MFF_ATTR`)
On every run, the resolved `reps` pair is credited from the **already-computed**
per-snap run battle `_trench` (`play-engine.js:6079-6084`), which is derived from
`_battleScore = (reps.ol.overall − reps.dl.overall)/8 + (runMul−1)·5 + …` plus
`normal(0,1.5)` noise. Unlike pass pressure, this uses the **individual** lineman
ratings, so it's a genuine individual signal.
- OL: `run_block_snaps`, `run_block_wins` (`_trench` win/dominant_win),
  `run_block_losses` (loss/dominant_loss).
- DL: `run_def_snaps`, `run_stuffs` (OL beaten), `run_def_losses` (DL blocked).

Insertion point: immediately after the `_trench` tier is assigned (`:6085`).
Purely additive (`(x||0)+1`), no `Math.random()`, no outcome change.

**Deliberately left untouched:** the existing random pancake credit
(`olArr[Math.floor(Math.random()*olArr.length)]`, `:6207`). Redirecting it to
`reps.ol` would either remove a `Math.random()` (RNG desync) or change the
per-player pancake distribution (breaks the A/B byte-identical proof). The
run-block grade uses the new win/loss fields instead.

### Grades (`_mff_audit.js`)
- **Run-block (OL)**: `60 + 14·z((wins−losses)/snaps)`.
- **Run-stuff (DL)**: `60 + 14·z((stuffs−losses)/snaps)` (net DL run-trench win rate).
- **Combined DL** = avg(pass-rush, run-stuff); **Combined OL** = avg(pass-pro, run-block).

### Validation (5-season round-robin, ~1.4M plays — stable)
| grade | r ↔ OVR | verdict |
|---|---|---|
| pass-rush | 0.42 | ✓ defensible |
| pass-pro | 0.52 | ✓ defensible |
| run-block | 0.78 | ✓ defensible |
| run-stuff | 0.87 | ⚠ slightly circular (see finding #2) |
| DL combo | 0.79 | ✓ |
| OL combo | 0.82 | ✓ |

League run-block-win rate 48.2%; pressure rate 38.0%. A/B still byte-identical
(`_mff_ab_check.js` strips the six new run fields). Face validity strong: combined
OL leaders OVR 89-95, worst all OVR 72-76; combined DL leaders OVR 82-92.

## Findings surfaced by the slices
1. **The engine's `pressure` is team-level** — it never incorporates the picked
   rusher's individual rating, only team d-line avg + archetype matchup + pick
   frequency. So a pure pressure-rate grade is a weak *individual* signal
   (pass-rush rate ↔ OVR is NOISY); sack-weighting is needed to recover talent
   correlation. (Lifting this would require Arch B — out of scope.)
2. **Opposite asymmetry in the run game:** the run-trench `_battleScore` IS
   individual (OVR-delta dominated, only SD-1.5 noise), so run-trench outcomes
   are nearly rating-deterministic. A pure run-D win-rate grade therefore
   re-derives OVR (run-stuff r=0.87 — too high to "add info"). The grade is still
   REAL (actual resolved reps), it just confirms OVR; combined with pass-rush into
   the DL grade (r=0.79) it's defensible. Real value-add for run-D will come from
   the (noisier) tackle/TFL attribution in a later slice. Net: pass-rush is too
   NOISY and run-stuff too DETERMINISTIC — opposite failure modes, both inherent
   to how the engine models each phase, and both fixed by combining signals.
3. **Latent bug (left untouched, out of scope):** `this._currentPressure` is set
   to the real value at `:3044` then **reset to 0 at `:3088`** ("set below" — but
   nothing below re-sets it). So the play-log / visual trench animation always
   sees `pressure=0`. Game logic is unaffected (only `_pushVisual` reads it). The
   MFF layer correctly uses the local `pressure` const, not the logged value.
   Worth fixing separately if the trench animation is meant to react to pressure.

## Tooling
- `_mff_audit.js [seasons]` — grades + leaderboards + validation (the deliverable).
- `_mff_ab_check.js` — byte-identical safety gate (run after ANY MFF change).
- `_mff_press_probe.js` — pressure-distribution probe for re-calibrating the
  xPressure constants (throwaway; neutralise the `:3088` reset to use it).

## Next steps (planned, not built)
Order = cheapest/most-defensible first, each behind the same flag + A/B gate:
1. ~~**Run-block / run-stuff**~~ — ✅ DONE (slice #2).
2. **Coverage (CB / S / cover-LB)** — reuse `_coverName` + completion outcome
   (`:4904`, `:5179`); add `cover_snaps`, `targets_allowed`, `completions_allowed`,
   `cover_yds_allowed`. Medium effort, high payoff (strongest defensive grade).
3. **EPA layer** — empirical EP(down,dist,field) table from sim data, EPA per
   play, team/QB/skill roll-ups, success rate. Pure post-processing over the
   play log (self-contained per entry: pre-state `{down,ytg,startYard}`,
   post-state from `endYard`). See the EPA plan in session history.
4. **LB run-defense tackling** — last; stays weak under Arch A. Consider an
   isolated, targeted Arch-B tweak ONLY here if face validity is poor.
5. **Franchise UI surface** — show grades near `scoutGrade`
   (`play-franchise-core.js:1082`) and team EPA near the win-prob block
   (`play-franchise-stats.js:~5554`). UI-only, medium risk (save-state).
