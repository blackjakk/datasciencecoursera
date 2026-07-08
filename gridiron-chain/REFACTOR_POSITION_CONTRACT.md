# Refactor: the single position-source-of-truth contract

*Goal: close the entire "teleport" bug family in the play renderer, instead of
discovering each seam by user report and patching it.*

Status: **DESIGN — awaiting go-ahead to start Stage 0.** No production code
changed by this doc. The RB-target reference-frame patch (`eb67c82`) and the FG
fixes (`b94f8c4`) are interim seam-patches that this refactor subsumes.

---

## Why this keeps happening (the root cause, not the symptom)

`play-animation.js` contains **27 distinct "teleport" fix comments**. That's a
structural fingerprint, not bad luck. Grouped:

- **Family A — coordinate-frame / init-point mismatch** (~17 comments: 1498,
  2002, 2315, 2652, 2837, 2919, 3397, 3468, 3565, 3589, 3986, 4265, 4415, 4512,
  4536, 4687, 5105, 5404, 6015). Two position systems hand off at a phase
  boundary (snap → route → catch → YAC → tackle), and the second initializes at
  a point the first didn't end at → visible jump.
- **Family B — time-budget mismatch** (~10: 1588, 3510, 3539, 3620, 7114, 7151,
  8547, 8666, 9019, 9049). A movement is given a fixed time window but must
  cover a distance that doesn't fit → easing snaps.

**The root cause of both families:** the renderer keeps its **own parallel
position model** alongside the engine's emitted motion tracks, and the two are
reconciled *by hand at every transition*. Each historical fix repaired one
transition; the *condition that produces transitions* — two models — was never
removed. So every new play-type × slot × coverage combination is a fresh chance
for the two models to disagree.

The RB bug was a perfect example: the engine emits route depth as **LOS-relative
yards**, but the renderer projected it from the **slot's X**. WR/TE slots sit on
the LOS so the gap is ~0 and they were always fine; the RB slot sits 8 yd behind
the LOS (`play-render.js:2844`), so its catch resolved 8 yd short and the YAC sim
absorbed the gap as a lateral slide. A prior continuity patch (3565) had made the
catch→YAC handoff smooth *from* `_wrLastX` — but never checked that `_wrLastX`
itself was right, so it masked the error for everyone except the one slot far
from the line.

---

## The contract (three rules)

For any slot that has an engine-emitted track in `play.motion.tracks[slot]`:

1. **One frame.** Every waypoint is **absolute LOS-relative yards** in *both*
   axes (downfield `dxYd` from the LOS, lateral `dyYd` toward midfield). No
   waypoint is ever interpreted relative to a slot's formation X/Y.
2. **Explicit start.** Each track carries an explicit **t=0 waypoint equal to
   the player's formation start** (in the same LOS-relative frame). The renderer
   *never* derives a tracked player's starting position from formation geometry,
   `targetX/targetY` constants, or hash decoys.
3. **One projector.** A single function projects a track sample → screen
   position. It is the *only* place that converts track yards to pixels. The
   renderer never re-computes a tracked player's position any other way.

Corollary (kills Family B): **time budgets derive from the track's own
arc-length**, not from `yards`/`yac`/`targetDepth`. The track is the clock.

Slots *without* a track (rare paths: some screens, kick coverage) either get a
track emitted, or are explicitly flagged `fallback: "constant"` so the
exception is deliberate and visible, not silent.

---

## Shared constant to extract

Formation-start offsets currently live only in `play-render.js:makeFormation`
(e.g. RB at `losX − dir·8·PX`, FB `−7`, WR/TE ~`losX`). The contract needs
**one** source of truth shared by the engine emit (rule 2) and the renderer:

```
FORMATION_DEPTHS = { wr1:{backYd:0, latYd:-16}, wr2:{backYd:0, latYd:16},
                     te:{backYd:0.13, latYd:5}, rb:{backYd:8, latYd:1.87},
                     fb:{backYd:7, latYd:0.27}, ... }   // i-form / pro variants
```

Extract to a module both sides import. `makeFormation` consumes it (no behavior
change); the engine consumes it to emit the t=0 waypoint.

---

## Staged plan (each stage independently shippable + detector-verified)

### Stage 0 — Teleport detector harness  *(enabler, no production change)*
The single most important step: convert "found by user report" → "found by
harness." Without it, the refactor just trades known patches for unknown
regressions.

- Headless render via the existing Playwright path (`_ux_snapshot.js` already
  boots the page against the dev server). Construct **synthetic `play` objects**
  and call `buildAnimForPlay(play)` directly in `page.evaluate` (top-level fns
  are reachable by name — same pattern as `franchise`).
- Instrument `drawPlayer` / `drawBall` in-page to record `(name|role, x, y)`
  every frame; step the returned `render(t, ctx)` over `t ∈ [0,1]` against an
  offscreen canvas.
- Battery: every `play.kind` (run, pass complete/incomplete/int, screen, sack,
  scramble, fg, punt, kickoff) × every target slot (wr1/wr2/te/rb) ×
  representative coverages × both `poss` directions.
- Flag any per-player frame Δ exceeding a physical cap (top speed ≈ 12 yps × dt
  + tolerance). Report play, player, frame, Δ.
- **Run against HEAD for a baseline.** This validates the detector (it should
  light up on the pre-patch RB bug and stay quiet on the patched build) and
  gives a regression baseline for every later stage.

### Stage 1 — Define contract + emit-side conformance  *(engine, behavior-neutral)*
- Extract `FORMATION_DEPTHS`; `makeFormation` consumes it (no visual change →
  detector unchanged).
- Engine emits the t=0 formation-start waypoint per slot, in LOS-relative yards.
- Renderer still uses its current projection, so nothing moves yet. Detector
  green throughout.

### Stage 2 — Unified projector + migrate the RB-target pass  *(behind a flag)*
- Add `_trackToScreen(track, aT, {losX, dir, cy})` — the single projector
  (rule 3).
- Replace the RB-target route + `_wrSim` + ctrl-fallback chain
  (`play-animation.js` ~3677–4006) with the unified sampler, behind
  `USE_TRACK_CONTRACT`. A/B against the old path.
- Detector confirms: no new teleports, RB lateral jump gone *without* the
  interim seam-patch.

### Stage 3 — Fold post-catch/YAC into the track  *(kills the parallel sim)*
- The track already carries YAC waypoints to the tackle. The catch stops being
  a handoff to a *separate* `_wrSim` model; the sim becomes a smoothing layer on
  the track sample, not a second source. Time budget = track arc-length (closes
  Family B for pass plays).

### Stage 4 — Migrate remaining slots/phases
- Non-target decoys (5389–5440), downfield blockers + `_followX/_followVX`
  (5167–5311), coverage CBs `_cbFollow*` (4358–4490), OL/DL engagement read-back
  (4300–4330, 5350–5360). One at a time, detector after each.

### Stage 5 — Delete dead fallbacks + retire the seam patches
- Once every slot is track-driven, remove hash-decoy fallbacks, the
  `_followX/_followVX` accumulators, bespoke `targetX/Y` constants, and fold the
  27 teleport patches into the contract. Detector is the guard.

### Stage 6 — Wire the detector into session-start / CI
- Runs on every change so the family stays closed.

---

## Handoff-init boundaries to retire (from the scoping inventory)

These 8 `new SimPlayer` / `_followX=` / `_cbFollowX=` sites are where Family-A
lives. The contract removes the *need* for per-boundary init because there's one
continuous track:

| site | init | boundary | risk |
|---|---|---|---|
| ~1527 | `d._sim` | run snap → rush | med |
| ~3988 | `_wrSim` | pass catch → YAC | **high** (the classic "WR under the ball") |
| ~4439 | `_cbFollowX` | route → coverage break | **high** (CB freeze-frame) |
| ~5273a/b | `_followX` / `_followVX` | route → post-catch blocker | med (NaN surge fixed) |
| ~4693 | `d._sim` | catch → YAC defender | low |
| ~2654/2663 | `d._sim` | run pursue → contact | med |
| ~5405/5443/5465 | `_followX` | post-catch persists | low |

## Time-budget sites to re-anchor on arc-length (Family B)

`basePass` / `POST_CATCH_MS` / `_yacScaleMs` (~3514, 3522, 3499), the INT-return
budget (~3620), `dropFrac`/`throwFrac` (~3592). All currently sized from
`yards`/`yac`/`targetDepth`; Stage 3 re-anchors them on the track length.

---

## Risk + rollback

- Every stage is flag-gated or behavior-neutral and verified by the Stage-0
  detector against the HEAD baseline. Roll back a stage by flipping its flag.
- The biggest risk is detector fidelity (a stubbed canvas drifting from the real
  render). Mitigated by using the *real* in-page render path via Playwright, not
  a hand-rolled ctx stub.
- This is the most heavily-patched file in the repo; do not big-bang. One slot
  per migration, detector after each, commit per stage.

---

## Stage 0 — BUILT (detector operational, baseline captured)

Three dev harnesses (committed, mirror the `_sim_audit.js` loader conventions):
- **`_teleport_capture.js`** (node) — runs the engine headlessly, buckets REAL
  play-visual objects by (kind × concept × coverage × targetSlot × poss), and
  writes per-game context (`teams`, `ratings`, serialized `playerLookup` Map,
  plays) → `/tmp/teleport_plays.json`.
- **`_teleport_detect.js`** (Playwright) — loads the real page, replays each
  play through `buildAnimForPlay`, records `drawPlayer`/`drawBall` positions per
  frame, and flags any per-frame jump over a human-speed cap. Players are the
  headline; the ball gets a high flight cap; non-finite (vanished) draws are a
  separate failure class.
- **`_teleport_trace.js`** — single-play per-frame dump for diagnosis.

**Gotchas solved (record for the next instance):**
- Scripts load as classic `<script>` — `buildAnimForPlay`/`drawPlayer` are
  global and reassignable. But `gameResult`/`cameraMode` are top-level **`let`s**
  (script scope, NOT `window`): assign by **bare name** inside `page.evaluate`.
- `playerLookup` is a **Map** → serialize as entry-pairs, rebuild per game; each
  play must replay against its OWN game's ratings+lookup or named lookups fail.
- `drawPlayer(ctx, x, y, …)` → **x=args[1], y=args[2]**. An off-by-one here
  (reading args[2]/args[3]) made the detector read the color string as "y",
  `isFinite` dropped every player, and it falsely reported "0 teleports."
  **Lesson: validate the detector against a known bug before trusting green.**

**Baseline on HEAD (5 games, 279 field plays, broadcast cam):**
- **228 plays** have a player teleport over the cap · 0 non-finite · 3 ball
  anomalies (spike — legit) · 1 render error.
- Teleports span BOTH targets and secondary players (converging defenders,
  downfield blockers) — i.e. the Family-A handoff seams the scoping inventory
  flagged (`_cbFollow`, tackler `_sim` sync, `_followX`).
- The interim RB anchor-fix (`eb67c82`) corrects catch position + ball-flight
  distance but does NOT change the post-catch teleports the detector finds
  (`complete/rb` worst 20.5yd at f38→39 is identical with the fix on/off) —
  confirming those are SEPARATE seams for Stages 2–4.

**Calibrated (done).** The first baseline (228/279) was inflated by two
harness-fidelity bugs, both now fixed in `_teleport_detect.js`:
- **Coarse sampling.** Stepping only 48 frames turned continuous fast motion
  into fake jumps. Now samples at **native ~60fps** (N = round(dur/16.67)), so a
  flagged jump is a real discontinuity in `render(t)` — which the live raf loop
  samples at the same cadence, so it IS visible on screen.
- **Frozen wall-clock sims.** `_wrSim` / pursuit integrate on
  `performance.now()`; in a tight replay loop that's ~0 so they froze, and a
  frozen sim handing off to a moving branch manufactured phantom jumps. Now a
  **controlled clock** advances `performance.now()` by the play-time dt each
  frame, so those sims step exactly as they do live.
- Plus **multi-draw continuity chaining** (an entity drawn twice in a frame is
  matched to the closest prior position, not "last wins") and **severity tiers**.

**Validated against a real bug:** traced a flagged play frame-by-frame — a
defender (Renly Pope) holds his formation spot in `stance` for many frames, then
**snaps 10.6yd to his pursuit start** in one frame as the pose flips to `run`.
A genuine Family-A teleport (formation-hold → pursuit-sim handoff with no
continuity), not an artifact.

**Calibrated baseline (HEAD, 5 games / 279 field plays, broadcast):**
- **116 plays** with an EGREGIOUS (≥6yd in one ~16ms frame) player teleport ←
  the regression gate. Each migration stage must drive this DOWN.
- 242 plays with any flag (incl. borderline 2–6yd); 0 non-finite; 1 ball
  anomaly; 1 render error.
- Dominant classes: complete/wr1, /wr2, /rb, /te, /- (catch & post-catch
  handoffs) and run/-, sack/- (defender formation→pursuit snaps). Mostly
  SECONDARY players (defenders, blockers) — the seams Stages 2–4 migrate.

Usage: `node _teleport_capture.js 6` then `node _teleport_detect.js broadcast`
(dev server on :5173). Report → `/tmp/teleport_report.json`.

---

## Resume pointer

- Interim patches already in: RB reference-frame remap `eb67c82`, FG sail/cheer
  `b94f8c4`. Both are subsumed by Stages 2–3 and can be deleted in Stage 5.
- Full position-write inventory (146 sites, grouped by phase/source) was produced
  by the scoping agent; the handoff + time-budget tables above are its
  actionable distillation.
- Start at **Stage 0**. It's pure upside and de-risks everything after it.
