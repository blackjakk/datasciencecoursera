# GridironChain — Handover Document

## 1. Project overview

**What we're building**
GridironChain is a vanilla HTML/CSS/JS football franchise simulation (no build tools). State persists in localStorage + IndexedDB under `gc_franchise_v1_slot_<id>`. The codebase is large (~44k lines across the main play-franchise-*.js files) and has evolved through dozens of major features. The current arc is pushing toward "class-leading" — beating Madden / 2K / Football Manager / OOTP on engine realism and visual quality.

**Current state**
Mature, deeply-featured. Recent work has shifted from contract/extension UX (settled) and engine physics (settled, in NFL elite stat bands) to the **visual / broadcast layer** — making the live game viewer feel like a real TV broadcast rather than a top-down sprite simulator. Replay system + week recap + scrubbable timeline now ship alongside the broadcast camera.

---

## 2. Repository / environment

- **Repo path**: `/home/user/datasciencecoursera/gridiron-chain/`
- **Active branch**: `claude/football-sim-blockchain-game-b3sdq`
- **Latest commit**: `7814b93` (scrubbable timeline + replay-clips backfill)
- **Stack**: vanilla JS, no bundler. Files concatenated via `<script src>` in `play.html` in this order: `play-data.js` → `play-franchise-core.js` → `play-franchise-season.js` → `play-franchise-stats.js` → `play-franchise-offseason.js` → `play-engine.js` → `play-broadcast.js` → `play-render.js` → `play-animation.js`. Top-level `const`/`function` declarations are cross-file accessible.
- **Lint/test**: `node -c <file>.js` for syntax checks (no other tests). User views via CDN: `https://rawcdn.githack.com/blackjakk/datasciencecoursera/<commit>/gridiron-chain/play.html`
- **Save layer**: `_idbPut`/`_idbGet` is primary; localStorage is the fast mirror. Auto-trim at 4MB via `_trimFranchiseForStorage`. Diagnostic: `frnSaveDiagnostics()` from devtools.
- **Verification helpers** (in `/tmp/`): `snap_calib.mjs` (projection dots on field), `snap_scrub.mjs` (timeline interaction), `snap_backfill.mjs` (round-trip a stripped save). All assume `python3 -m http.server 8765` running in repo root.

---

## 3. Current arc — visual / broadcast / replay (this session)

Recent commits on this arc:
- `82000b7` — replay system + saved highlights (SportsCenter Top 10 style)
- `cb2ee4d` — broadcast cam by default + week-recap modal + field/stadium art upgrade
- `f3099b3` — revert of broadcast tilt/perspective tweak (players landing off-field)
- `a68d701` — fix WR alignment off-field in broadcast cam (rewrote `projectBroadcast`)
- `7814b93` — scrubbable timeline + replay-clips backfill
- `682d508` — handoff refresh
- `e295b6a` — sideline pad: skip top apron in broadcast cam to avoid crowd gap
- `7580d74` — stadium wall band between crowd and field in broadcast cam
- `473f3fc` — port top sideline pad to cinema field render
- `904c69f` — LED ad ribbon on the stadium wall in broadcast cam
- `9823439` — larger yard-line numbers with black stroke
- `7ee5370` — soft radial-gradient player drop shadows
- `ddb54a4` — Tier 1 player uniform pass (cleats, gloves, name, captain "C", towel, visor, rim light)
- `062606b` — Tier 2 polish: AO shading, long sleeves on linemen, foot dust
- `c15fb85` — Tier 2 pass B: sock striping variants, knee braces, QB no gloves
- `5a5cfd4` — stadium audio system (Web Audio API, synth-based SFX)
- `c85bbd0` — visual FX layer (particles, screen shake) + vendored PIXI

### Audio system (new)

- **`play-audio.js`** — `GCAudio` global, vanilla Web Audio API. Lazy-inits AudioContext on first user gesture per browser autoplay policy.
- **SFX**: `snap` (square wave with frequency drop), `whistle` (sine + LFO vibrato), `hit` (low-pass noise + sub osc sweep), `cheer` (band-pass noise swell).
- **Ambient**: `GCAudio.crowd.start()` runs a band-pass-filtered noise loop while plays advance, stops at game end. ~6% gain so it sits under SFX.
- **Hooks** in `play-animation.js:startNextPlay`: routes per-`play.kind` to the appropriate SFX. Note actual kinds used (per a sample game): `score`/`fg_good`/`xp_good` → cheer; `big_hit`/`ejection`/`fumble`/`sack` → hit; `halftime`/`quarter`/`ot`/`two_min_warning` → whistle; `hc_decision` → silent; everything else → snap.
- **Mute toggle** in the field HUD camera bar (🔊/🔇 button). `_toggleAudio()` in `play-broadcast.js`. Single global enable flag.

### Visual FX layer (new)

- **`play-fx.js`** — `GCFx` global, canvas2D particles + CSS-transform screen shake. API: `dust(x,y,dir)`, `hitBurst(x,y,color)`, `confetti(x,y,color,n)`, `shake(strength,ms)`, plus `tick(dtMs)` + `draw(ctx)`.
- **Wired into tick loop** at `play-animation.js:5867-` — `tick(dt)` between frame setup, `draw(fxCtx)` after `_frameEndBroadcast`. `fxCtx` is `_uprightCtx` in broadcast, the field ctx in topdown.
- **Event hooks** in `startNextPlay`: score → confetti (28 particles, team-color palette) + light shake; big_hit/sack/fumble/ejection → hit burst (22 chips) + heavy shake (11px / 350ms).
- **Particle cap** 600 in `MAX`. Tan dust + team-color chips + 4-color confetti palette. Designed so the API can later re-point to a PIXI ParticleContainer with no caller changes.

### PIXI vendoring (new, not yet active)

- **`vendor/pixi.min.js`** — PIXI.js 7.4.0 (MIT, 456KB) downloaded from GitHub releases.
- **Not yet loaded by play.html** — vendored as the foundation for the future WebGL renderer migration. See section 8 for the migration roadmap.

### Broadcast camera

- **Default view**, not opt-in. The "looks like the old game" complaint traced to broadcast being hidden behind a BCAST toggle. Default flipped at `play-animation.js:5371`.
- **Two-canvas architecture**: `#field` is tilted via CSS `rotateX(38°) scaleY(1/cos(38°))` with origin `50% 100%`. `#field-uprights` is a flat overlay sibling for billboarded player sprites, depth-sorted via `_spriteQueue` per frame (closer players occlude farther on pile-ups).
- **Tilt + perspective constants** (`BROADCAST_TILT_DEG = 38`, `BROADCAST_PERSPECTIVE_PX = 1100`) are calibrated to the wrap CSS. **Don't tweak in isolation** — we already burned a commit reverting a tilt change that drifted sprite positions off the field.
- **`projectBroadcast` does the full CSS pipeline now**, not a simplified canvas-internal approximation. It reads the wrap's actual `clientWidth/clientHeight` + padding, derives the field's pre-transform CSS box from the aspect ratio, applies `scaleY` → `rotateX` around the transformOrigin, then the wrap's perspective with its 50%/80% origin, and finally maps the resulting screen position back into upright-canvas internal coords. Geometry cached in `_bcastGeom`, invalidated on resize and in `setCameraMode`.
- **Stadium chrome**: `.bspnlive-field-wrap.broadcast-cam` has a night-sky gradient + crowd silhouette band (32% tall with decked seating tiers via repeating-linear-gradient) + 5 stadium light banks with 26px halos and 4px bright cores.
- **Field art upgrade** (`drawField` in `play-render.js`): darker base grass (`#1c5e2f`), higher-contrast mowing stripes, radial vignette over the field, end-zone team text now has a 4px black stroke + 0.92 white fill.

### Replay system

- **`_scoreHighlight(play, ctx)`** in `play-franchise-offseason.js` scores every play; non-zero scores produce a `{rating, type}` candidate.
- **`_extractReplayClips(plays, ...)`** keeps the top 7 per game, including 1-2 preceding plays as context for the lead-up.
- **`_saveReplayClips(highlights)`** dedupes by id, persists into `franchise.replayClips`. Called from both `markGamePlayed` (user-played games) and the sim path (`frnSimOnce` invocations in week advance).
- **`_trimReplayClips()`** caps at 200 past-season + uncapped current season + top 30/week. **Note**: this had a bug — checked `franchise?.highlights` (wrong property) so trimming was effectively skipped. Fixed in `7814b93`.
- **`frnReplayClip(highlightId)`** swaps in a synthetic single-play gameResult and pumps it through the standard animation pipeline at 0.5x speed. **Note**: had the same stale `franchise?.highlights` reference. Fixed.
- **Replays tab UI** (`renderFrnReplayLib`) — scope tabs (Top 10 week / All week / My Team / Season Top 25), week chips, friendly empty state.

### Week-recap modal

- **`_showWeekRecapIfReady()`** in `play-franchise-offseason.js` — pops a modal once per completed regular-season week. Renders the top 6 league-wide plays with inline ▶ replay buttons.
- **Gated via `franchise._lastRecapSeen`** per `(season, week)` key. Idempotent — won't repeat.
- **`frnDismissWeekRecap()`** closes + sets the flag. **`frnOpenReplaysTab()`** dismisses + navigates to replays tab.
- **Hook**: `play-franchise-season.js:11` adds `try { _showWeekRecapIfReady && _showWeekRecapIfReady(); } catch (_e) {}` in `showFranchiseDashboard()`.

### Scrubbable timeline

- **DOM-injected, not part of the HUD render** — because `FieldHUD.update()` rebuilds its inner HTML on play change and would wipe drag state. The scrubber is appended to `.bspnlive-field-wrap` once via `_ensureScrubber()` (called at the top of `tick()`) and updated by ID lookup.
- **Controls**: play/pause button, restart (↺), drag track with knob, elapsed time readout (`0.00s` format).
- **`_scrubTo(ev, track)`** re-anchors `animState.startTime = performance.now() - frac * animState.duration` so elapsed matches the dragged position. Also clears `holdStart` and renders one frame immediately so the scrub feels live.
- **`_scrubStart` → pointerdown → document-level pointermove/pointerup** so dragging outside the track still tracks. Releases restore `playing` if it was true at drag start.
- **CSS** in `play.css` at the bottom of the broadcast-cam section. Sits at `bottom: 36px` so it clears the camera toggle row.

### Replay-clips backfill

- **`_backfillReplayClips()`** in `play-franchise-core.js` (next to `_backfillStamina`) initializes `franchise.replayClips = []` if missing.
- Wired into all three load-path backfill chains via `replace_all` in `play-franchise-core.js`.
- **Historical games can't be reconstructed** — `_stripGameStatsForStorage` drops the plays array after the game's stored. Empty array + the existing empty-state copy in `renderFrnReplayLib` is the answer.

---

## 4. Earlier shipped work (compact summary)

This is everything that was settled in prior sessions and remains the foundation. Don't redo any of this.

### Contracts / extensions / holdouts
- All three contract screens (offseason re-sign, mid-season holdout center, offseason demand) have portraits, tier-styled clickable names, raise/premium math, hover-preview cap bars, and the `_buildExtensionPitch` data block ("THE CASE" — season prod, career, honors, trajectory, league rank, availability, window, money's worth, market, comp $, verdict).
- Cap bars render as split-fill (baseline + signed extension segments in gold) with per-year delta callouts.
- Contract demand cooldown via `contract.startSeason` (stamped at all 7 creation sites, backfilled from `years - remaining` for legacy contracts).
- Demand probability 35% with 0.70 underpay threshold (3 seasons cooldown).
- Ignored-extension consequences: -2 OVR + dev freeze flag + 40% trade-request roll + 25% demand premium at FA + locker-room banner on player card.

### Player legacy / tier system
- LEGEND / ICON / ELITE / PRO tiers via `playerLegendTier(p)`. Wired through `playerLink(p)` everywhere.
- `_playerLinkSmart(name)` + `_findRetiredPlayer` + `_frnOpenRetiredPlayerModal` so historical names click through to a minimal HOF/RETIRED-badged modal.
- Nicknames are **flag-only** (`p.nickname` + `p.goesByNicknameOnly` — never rewrite `p.name`). 230 entries across 14 themed pools. Gate: OVR ≥ 85 AND (1+ MVP OR 1+ All-Pro OR 2+ Pro Bowls), top-5 per position, 70% acquisition. Themed origin stories per pool, deterministic via name-hash seed.

### HOF + awards
- Annual class-based HOF voting (`_runHOFVoting`, `_computeHOFScore`, `_hofPositionMul`) replacing direct enshrinement.
- First-ballot badges + active ballot section in `_legacyHOF`.
- `_cpuVoteWeeklyPOTW` casts weighted-random weekly POTW votes for every category so POTY races have full-season data.
- `_processSeasonEndRetirements` adds retirees to `_hofEligible` pool (not direct HOF).

### Offseason gains sheet
- `_buildOffseasonGainsSheet` — net Δ, biggest gainer/dropper, hidden-gem hero, re-sign priority block, gainers/holding/decliners tables, stat-delta chips, ceiling cells, contract cells, position filter chips.
- `runFrnOffseason` instruments per-player change records into `franchise._offChanges`.

### Migrations (version-flagged on `franchise.*`)
- `_careerHistoryRepaired_v3` — softened from over-aggressive calendar-year stripping
- `_careerHistoryRestored_v4` — reconstructs prior-team rows where v3 over-stripped
- `_reconcileOrphanSeasonStats` — defensive merge for nickname-split per-game stats
- All backfills idempotent (`_backfillCoachable`, `_backfillStamina`, `_backfillPhysicalPeak`, `_backfillReplayClips`, etc.)

---

## 5. Engine + physics layer (still authoritative)

All major NFL stat categories land in NFL elite bands. The full implementation lives in `play-engine.js` and `play-franchise-season.js`.

### Wear + stress
- `p._wear` (0-100), `p._stress` (0-100), `p._bodyWear` (21 regions).
- Force-scaled hit wear: `_bumpHitWear(carrier, base, tackler, opts)` = `base × tacklerForce × carrierVulnerability + extras`. Tackler gets 25% reciprocal wear.
- Age coupling: 30+ recover slower; 33+ +25% stress per snap; injury rate +10/25/45/65% by age band.

### Injury system
- Contact path (`_rollGameInjuries`) — weekly per-player roll, position-weighted, wear×age multipliers stacking.
- Non-contact path (`_rollNonContactInjuries`) — separate per-game roll, stress-banded rate (0.002-0.033).
- Bimodal ACL spike — W1-4 conditioning multiplier (2.0x → 1.0x) with veteran/Ironman/Sports-Sci mitigation up to -60%.
- Concussion engine — Second Impact recency multiplier (≤3 wks → 3.5x catastrophic), CTE arc (4+ lifetime → independent CE roll).
- Catastrophic variants: torn ACL, chronic concussion syndrome, labrum tear, Lisfranc fracture, torn achilles, chronic hamstring.
- Big-hit instant injury — fires inside `_bumpHitWear` for force ≥ 1.1.

### Tackle attribution
- `_tackleWeightsForContext(ctx)` — first-principles tackle weights per play type (run inside / outside / breakaway / stuff / pass short-middle / short-outside / mid / deep / goal-line / screen / scramble / TOR).
- MLB-biased LB picker (`_creditDefStat`): `lb2 × 1.15`, `lb1 × 0.95`, `lb3 × 0.85`. Bobby Wagner pattern emerges.

### Hit mechanism + discipline
- `_pickHitMechanism(tackler, opts)` returns `head_on / side / low / high / behind`. Weighted by archetype + play context.
- `_maybeFlagURForHit` — UR flag chance scales with mechanism × HEADHUNTER × defenseless context.
- Ejection roll — ~1.6/season league-wide. `_processWeeklyDiscipline(w)` runs auto-suspension cascade.

### Vitals UI
- `_buildVitalsBlock(p)` in `play-franchise-season.js`. Vitruvian body diagram (240×520 viewBox), position-scaled per `_VITALS_BODY_PROFILES` + player height/weight, 21 wearable regions overlaid as translucent paths colored by `_vitalsColor(v)`.
- Overall health score (100 − max(wear, stress)), STATUS card, CONCERNS top 4, RECOVERY GUIDANCE, RISK FACTORS, INJURY HISTORY last 6.

### Audited stat outcomes (NFL elite bands)
| Category | Audit | NFL elite |
|---|---|---|
| Top sacker / season | 22, 21, 21, 21, 20 | 15-22 ✓ |
| Top rusher / season | 2055, 1874, 1833 | 1800-2100 ✓ |
| Top WR / season | 1776, 1713, 1662 | 1700-1964 ✓ |
| Top tackler / season | 190, 182, 180 | 150-195 ✓ |
| Top QB / season | 5338, 5227, 4931 | 4500-5500 ✓ |
| Total injuries / team | 10.7-13.8 | 12-15 IR ✓ |
| Catastrophic % | 7-8% | ~8% ✓ |
| Career-ending / season | 2.6 | 5-10 (slightly under) |
| Ejections / season | 1.6 (5-season avg) | 1-3 ✓ |
| Avg injury duration | 4.0 wks | 4-6 ✓ |

### Personnel mix (modernized)
NFL 2024 uses 11 personnel (TRIPS) on ~62% of plays. All five playbooks (BALANCED, AIR_RAID, GROUND_AND_POUND, DUAL_THREAT, OPTION) bumped TRIPS share, trimmed BASE. WR3 / slot CB now see realistic snap shares.

---

## 6. Key decisions (cumulative)

**Visual / broadcast layer:**
- **Broadcast cam is the default**, not opt-in. Toggle still exists.
- **Two-canvas architecture is non-negotiable** — flat sprite overlay billboarded on top of tilted field. Don't try to draw sprites on the tilted canvas directly (they lie flat instead of standing upright).
- **`projectBroadcast` reads live wrap geometry** — don't hardcode dimensions. Constants (TILT 38°, PERSPECTIVE 1100px) are tested values; if changing them, re-run `/tmp/snap_calib.mjs` and verify the calibration dots against the field rect.
- **Scrubber is DOM-injected**, not in the HUD render, because the HUD rebuilds inner HTML on play change.

**Replay system:**
- **Top 7 per game** is the storage cap; `_trimReplayClips` further caps past seasons at 30/week and 200 total.
- **Historical replays can't be reconstructed** from old saves — sim games drop their plays after storage. Backfill initializes the array empty; new games populate going forward.
- **Replay clip carries 1-2 preceding plays as context** — `frnReplayClip` plays the whole context sequence so the user sees the lead-up.

**Design (cumulative from prior sessions):**
- **`p.name` is sacred** for lookups. Never rewrite. Use `p.nickname` + `p.goesByNicknameOnly`.
- **Tier system uses any-of clauses** for thresholds (a single MVP jumps you to ICON; a single ring jumps you to ELITE).
- **Cooldown via `contract.startSeason`** rather than per-player flags. Stamped at every contract creation site.
- **Pitch block takes a normalized `ctx`** — `{ position, marketAAV, demandedAAV, demandedYears }` — so all three contract screens map their row shape into the same signature.
- **Migrations are version-flagged** (`_careerHistoryRepaired_v3`, etc.) and run once per save.

**Architecture:**
- All player-name surfaces go through `playerLink(p)` or `_playerLinkSmart(name)`.
- `_findPlayer` falls through to `_findRetiredPlayer` so historical names don't dead-end on click.
- Cap bars use `data-cap-year` / `data-cap-used` attributes for hover-preview without re-rendering.

**UI/UX:**
- Pitch block always rendered (no toggle) — user wants to be "convinced with data."
- Split-fill cap bars over single-fill — makes "what did this signing add?" obvious.
- Reconstructed history rows render dimmed/italic with `~estimated` note.

**Explicitly rejected:**
- Pruning save data — user wants full fidelity. Auto-trim only at 4MB pressure.
- Recovering lost calendar-year rows perfectly — data is gone, reconstruction is even-distribution approximation.
- Counter-offer custom slider UI — discussed, not yet built.

---

## 7. Bugs / issues discovered (cumulative)

| Symptom | Cause | Status |
|---|---|---|
| WR lining up out of bounds in broadcast cam | `projectBroadcast` used canvas-internal coords, didn't match upright canvas geometry | Fixed (`a68d701`) — full CSS pipeline math |
| Players landing off-field after tilt tweak | Changed TILT/PERSPECTIVE constants without re-deriving sprite layer positions | Reverted (`f3099b3`) |
| Replays tab crashed on old saves | `franchise.replayClips` undefined; two stale `franchise.highlights` refs | Fixed (`7814b93`) — backfill + property rename |
| `_trimReplayClips` skipped silently | Guard checked `franchise?.highlights` (wrong key) | Fixed (`7814b93`) |
| QB demanding ext after just signing | `_detectHoldouts` had no cooldown | Fixed via `startSeason` gate |
| 168% availability | `careerStats.gp` polluted by phantom rows | Fixed: use careerHistory only, cap at 100% |
| Career table "2 seasons" / 12k yds | v3 over-stripped calendar-year rows | Fixed v3 + added v4 reconstruction |
| Marv Rossi click does nothing | `_findPlayer` only searched active rosters | Fixed via `_findRetiredPlayer` |
| WR missed Pro Bowl | nickname rewrite split per-game stats across two name keys | Fixed: `_reconcileOrphanSeasonStats` + nickname fallback |
| FPTS = 0.0 | per-game lookup keyed only by `p.name` | Fixed: nickname fallback + seasonStats |
| HIGH CEILING on a 31-yr-old vet | `potentialTag` didn't gate on age vs peak | Fixed: vets past peak get realized-state tags |
| Cap bars seemed unchanged after signing | bars updated but visual snap had no callout | Fixed: split fill + delta callouts |

**Logs/errors**: console outputs `[career repair v3] cleaned X player histories` and `[career repair v4] reconstructed prior history for X player(s)` on first save load.

---

## 8. Next steps (prioritized)

### PIXI / WebGL migration (committed direction — Tier 3 from session art-direction discussion)

The user picked Tier 3 ("Full engine rebuild") — migrate the canvas2D renderer to PIXI.js for WebGL shaders, real particle systems, post-processing. PIXI is **already vendored** at `vendor/pixi.min.js` (7.4.0, MIT, 456KB). This is multi-session work.

**Phase 1 — Foundation** (DONE, `1dccbe1`):
- Loaded `vendor/pixi.min.js` via script tag in `play.html`.
- Initialized a PIXI.Application as a `.gc-pixi-fx` canvas attached to the broadcast-cam wrap, internal 1700×720, `pointer-events:none`, z-index 4. Re-attached on wrap rebuilds (`_ensurePixiOverlay` pattern).
- Re-implemented `GCFx.draw` on PIXI Graphics in a pooled Container. Caller API unchanged. BlurFilter (blur 2.4, quality 2) provides bloom-lite.
- `preserveDrawingBuffer: true` so Playwright headless screenshots capture WebGL output.
- Canvas2D fallback intact — `_drawPixi` returns false on init failure.

**Phase 1.5 — Stage layers** (resolved + extended):
- Initial vignette + flash attempts on `PIXI.Graphics` produced uniform gray on the headless software-WebGL renderer. Fixed by switching to the `RenderTexture + Sprite` pattern for static elements (vignette, haze, noise) and `Graphics → RenderTexture → swap-Sprite-texture` for dynamic-color elements (flash). PIXI 7 `Sprite.tint` was unreliable on SwiftShader; baking color into a fresh texture per fire works.
- Shipped: vignette (`32b0ee4`), light beams (`32b0ee4`), flash (`4e6be68`), atmospheric haze (`33684e4`), TD celebration cinematic (`81e07f4`), replay film grain (`4472bb3`).

**Phase 2A — Static field migration to tilted PIXI canvas** (DONE):
- `d9979d5` Phase 2A.1: Stood up #field-pixi as a sibling of #field, both tilted via the same CSS rotateX(38°)/scaleY transform. PIXI Application attached with autoStart:false + preserveDrawingBuffer:true. Grass + mowing bands rendered into a Container, cached per (homeId|awayId). Canvas2D drawField skips the same elements when GCField.active().
- `863013a` Phase 2A.2: End zones (team-color Graphics) + KRAKEN/TITANS PIXI.Text rotated -90°/+90° with scale.x stretching the natural reading direction.
- `7e02b33` Phase 2A.3: Sidelines, yard lines (every 5/10), yard numbers, hash marks, sideline ticks.
- `64a6551` killed four compounding dimming sources (PIXI vignette + PIXI haze + canvas2D radial vignette + CSS contrast) — field reads vibrant green now.

**Phase 2B — Remaining field elements** (DONE):
- `634a36a` Phase 2B.1: Midfield team-initial logo (gold ring + initial PIXI.Text) + goal line indicators.
- `f2e177d` Phase 2B.2: Per-frame LOS + first-down line on a separate _dynG Graphics. GCField.drawDynamic(state) is called by drawField each frame.
- `ec749a1` LOS/FD glow halo — wider blurred lines on _dynGlow Graphics with BlurFilter, broadcast first-down-line styling.
- `f7c55f3` Red-zone goal-line pulse — when LOS is within 20 yards of a goal line, that goal line pulses warm orange.

Weather particles are still canvas2D. Phase 2C would port them to a PIXI ParticleContainer; works fine as-is so deferred.

**Phase 3 — Player + ball migration** (STARTED, multi-session):
- `4cefb2a` Phase 3.1: Player drop shadows ported. Single batched PIXI Graphics on the field-pixi canvas — one WebGL draw call for all 22 players' shadows instead of 22 canvas2D radial-gradient strokes. `GCField.clearShadows()` at the top of drawField, `GCField.addShadow(x, y, bulk, scale)` from drawPlayer (Phase 3.1 path). Canvas2D path kept as fallback.
- **Remaining**: ~1000 lines of `_drawPlayerImpl` in play-render.js + drawBall + ball trail. Players need depth sorting in broadcast cam (PIXI z-index sort replacing _spriteQueue). Ball + player must move together — depth-sorted in the same container.
- **Recommended next step (Phase 3.2)**: pre-render canonical player poses to PIXI textures once (canvas2D → PIXI.Texture.from(canvas)), then per-frame just position + scale + rotate a Sprite per player. This is the sprite-sheet approach Madden uses — avoids rewriting all the canvas2D paint code in PIXI Graphics, and gets the perf win immediately (sprite blit vs 1000-line canvas2D pass per player per frame).
- **Architectural tension**: the canvas2D player code branches on pose / facing / position type / time. Pre-rendering all combinations = sprite atlas. Plausible scope: 10-15 unique poses × 32 team color combos. Or: render per-team on first use, cache textures. Better starting point than a 1:1 Graphics port.
- **Depth sort**: when Phase 3 is fully on PIXI, _spriteQueue dies. PIXI Container `sortableChildren = true` + `child.zIndex = projected.screenY` replaces it (same semantics, GPU-batched).

**Phase 2 — Element ports** (extensive overlay work shipped earlier this session):
- LED ad ribbon (`6e6e098`): CSS background → PIXI Graphics panels with cycling color palette + BlurFilter glow.
- LED ribbon "slogan flash" mode (`62d0133`): every ~5s the ribbon switches from color-cycling to solid amber with a bright scan sweep.
- TOUCHDOWN/FIELD GOAL/EXTRA POINT/2-PT banner (`b23c88a`): PIXI.Text with overshoot scale + drop shadow.
- Player-highlight chyron (`20a0572`): Bloomberg-style lower-left banner with name + play-type tag. Wired to TD scorers, sacks, INTs.
- Drive recap chyron (`3424c3e`): fires on drive_summary plays w/ N PLAYS · M YDS · TOP.
- LIVE indicator (`ebb7427`): blinking red dot + LIVE text upper-left, swaps with INSTANT REPLAY badge in replay mode.
- INSTANT REPLAY badge + VHS scanlines + film grain (`e319402`, `4472bb3`): all gated by window._replayMode.
- Lens flare (`e319402`): 4-pointed star sprite that fires on TDs alongside the celebration.
- Atmospheric haze (`33684e4`), vignette + light beams (`32b0ee4`), flash (`4e6be68`), color grading (`81e07f4`).
- End-of-game FINAL banner + final whistle + delayed cheer (`62d0133`).
- Quarter / halftime / OT / two-min-warning banners (`62d0133`).

True `drawField` porting (grass / mowing / end zones / yard lines / numbers / hash marks) still requires either applying the CSS rotateX tilt to a dedicated PIXI canvas OR positioning each element via `projectBroadcast()`. Deliberate multi-session arc — don't start without committing to it.

**Phase 3 — Player render migration** (unchanged from prior plan):
- Port `_drawPlayerImpl` (`play-render.js:407-` ~1000 lines) to PIXI Containers. Player = Container of Graphics + Sprite + Text. Pose changes update child positions/rotations. Depth-sorted sprite queue becomes PIXI z-index sorting. 2-3 sessions for clean parity.

**Phase 4 — Effects unlocked**:
- Bloom upgrade on lights + LED ribbon (already in light/particles, can extend).
- Motion blur on breakaway runs (needs `@pixi/filter-motion-blur` vendored separately).
- Color grading by weather/time (currently a static CSS filter; PIXI ColorMatrixFilter would let it vary per state).
- Screen-space distortion ripple on big hits.
- Sprite sheet animation for run cycles (sample Mixamo for reference).

**Phase 2 — Field render migration**:
- Port `drawField` (`play-render.js:24-180`) to PIXI Graphics + Sprite. The grass, mowing bands, end zones, sidelines, yard numbers, hash marks, LOS marker, first-down line are all paint operations that map cleanly to PIXI Graphics.
- Keep the existing `#field` canvas around as a fallback during the migration.
- Verify topdown + broadcast cam look identical to the canvas2D version before deleting the old code.

**Phase 3 — Player render migration**:
- Port `_drawPlayerImpl` (`play-render.js:407-` — the big one, ~1000 lines) to PIXI Containers. Each player becomes a `Container` with child `Graphics` for helmet/body/limbs and child `Sprite`/`Text` for jersey number + name. Pose changes update child positions/rotations.
- This is the biggest single piece. Estimate 2-3 sessions to migrate cleanly with parity testing.
- The depth-sorted sprite queue (`_spriteQueue`) becomes PIXI's z-index sorting on the player Container parent.

**Phase 4 — Effects unlocked by PIXI**:
- Bloom on stadium lights + LED ribbon.
- Motion blur on breakaway runs (PIXI `MotionBlurFilter` from `@pixi/filter-motion-blur` — would need to vendor separately).
- Color grading for weather/time-of-day (day vs night vs snow).
- Screen-space distortion ripple on big hits.
- Sprite sheet animation for player run cycles (sample Mixamo as reference, export keyframes).

**Don't break the working game during migration.** Keep both renderers alive behind a feature flag (`useWebGL`) and switch to PIXI fully only when parity is verified.

### Visual / broadcast follow-ups (still open in canvas2D)

1. **Mechanism / UR / ejection visuals** in real-time play log — show hit mechanism chips ("blindside", "high hit") + UR flags + ejection moments as they happen, not just in injury history. Independent of the PIXI migration.
2. **Helmet shape rework toward NFL silhouette** — was proposed mid-session (option B from art-direction discussion: NFL helmet not sphere, slimmer proportions, jersey hang). Deferred when user committed to Tier 3 PIXI migration. Would be **redone in PIXI** during Phase 3, so don't do it in canvas2D first.

### Engine roadmap (open from prior session)

4. **Phase 5 — Smart pickers / player contracts**: replace flat snap-share % with three goal modes per slot: `share`, `count`, `touches`. Multi-file refactor: extend snapShares data model, modify `_rotateForSnap` + `pickRusher` + `pickReceiver` to consult mode/target, add auto-manage policies (Balanced / Ride starters / Playoff push), expose modes in the UI.
5. **Auto-manage UI for rest/sit decisions** — surface wear/stress with recommended sub policy per game.
6. **Career-ending injury rate bump** — currently 2.6/season vs NFL 5-10. Raise catastrophic upgrade chance slightly.
7. **Non-contact share** — currently 25% vs NFL ~40%. Stress accumulation works; rate could lift further.
8. **Pace tuning** — slightly too many plays per game (was 70 vs NFL 62 in earlier audit; may have shifted).

### Contract / extension follow-ups (from prior reassessment)

9. **#6 AI inquiries for unhappy stars** — when `tradeRequested=true`, generate weekly inbound trade offers.
10. **#2 Counter-offer flexibility** — custom AAV slider, "match years cut AAV" variants.
11. **#9 Price-aware verdict** — factor demand AAV vs market into pitch verdict.
12. **#7 Comp pick surplus value math** — quantify "let walk" vs deal cost.
13. **#8 Unify mid-season vs offseason demand systems** — `_checkHoldoutDemands` vs `_detectHoldouts` have subtly different rules.

**Do NOT do unless asked:**
- Tweak `BROADCAST_TILT_DEG` / `BROADCAST_PERSPECTIVE_PX` / field transformOrigin — coupled across JS and CSS, easy to break.
- Counter-offer slider UI redesign (touches a lot of layout).
- Save data pruning (user wants full fidelity).
- Coaching carousel expansion (already comprehensive).

---

## 9. Instructions for the next Claude Code chat

You're continuing mid-session work on GridironChain. Read this carefully:

- **Do not redo completed work.** Everything in sections 3-5 is shipped and committed on `claude/football-sim-blockchain-game-b3sdq`. Check `git log --oneline -30` before starting.
- **Inspect files before editing.** Files are large (`play-franchise-offseason.js` is 12k+ lines, `play-animation.js` is ~284 KB). Use `grep -n` to find functions; don't try to read whole files. Key entry points by area:
  - Broadcast cam: `projectBroadcast`, `setCameraMode`, `_frameStartBroadcast`/`_frameEndBroadcast` (all in `play-animation.js` ~5370-5530)
  - Replay system: `_scoreHighlight`, `_extractReplayClips`, `_saveReplayClips`, `frnReplayClip`, `renderFrnReplayLib` (`play-franchise-offseason.js` ~1900-2300)
  - Scrubber: `_ensureScrubber`, `_scrubToggle`, `_scrubTo`, `_updateScrubberUI` (`play-animation.js` ~5688-5800)
  - Contracts: `_buildExtensionPitch`, `_holdoutCapProjectionDetail`, `_renderHoldoutsBlock`, `_resignPlayerDemand`
  - Engine: `_rollGameInjuries`, `_rollNonContactInjuries`, `_tackleWeightsForContext`, `_bumpHitWear`, `_pickHitMechanism`, `_processWeeklyDiscipline`
  - Player names: `playerLink`, `_findPlayer`, `_findRetiredPlayer`
- **Preserve existing patterns.** Tier system goes through `playerLink`. Cap-bar hover uses `data-resign-hits`/`data-resign-cap` + `_resignHoverIn/Out`. Migrations flag-gated on `franchise.*`. Contracts must stamp `startSeason` + `signedOvr` at every creation site (currently 7). Backfills are idempotent + run from all three load paths.
- **`p.name` is sacred** — never rewrite for nicknames. Use `p.nickname` + `p.goesByNicknameOnly`.
- **`projectBroadcast` constants are tested** — TILT 38°, PERSPECTIVE 1100px, transform-origin 50% 100%, perspective-origin 50% 80%. If you change any, re-run `/tmp/snap_calib.mjs` and verify calibration dots against the actual field rect.
- **Verify edits with `node -c <file>.js`** — no formal test suite.
- **For UI changes, verify in a real browser** before claiming done. `python3 -m http.server 8765` in repo root + use Playwright via `/opt/node22/lib/node_modules/playwright/index.js`. Templates in `/tmp/snap_*.mjs`.
- **Commit + push each logical change** with a clear commit message. The user iterates fast and likes the audit trail.
- **Ask before broad architectural changes** — especially the broadcast cam math, unifying demand systems, or restructuring the contract screens.
- **The user prefers data-driven, persuasive UX** — when adding info, frame it as evidence the GM can act on.
- **CDN delivery**: after every push, give them `https://rawcdn.githack.com/blackjakk/datasciencecoursera/<commit>/gridiron-chain/play.html` (use `rawcdn`, not `raw`, to bypass branch caching).

---

## 10. Compact context (paste this as the opening message)

> Continuing work on **GridironChain**, a vanilla JS NFL franchise simulation at `/home/user/datasciencecoursera/gridiron-chain/`. Active branch: `claude/football-sim-blockchain-game-b3sdq`. Latest commit: `7814b93`. Files concatenated via `<script src>` in `play.html` — top-level `const`/`function` declarations are cross-file accessible. No build step. Syntax check with `node -c <file>.js`. After commit + push, share `https://rawcdn.githack.com/blackjakk/datasciencecoursera/<commit>/gridiron-chain/play.html`.
>
> **Current arc — visual / broadcast / replay** (last ~5 commits):
> - Broadcast cam is now default. Two-canvas architecture: `#field` tilted via CSS rotateX(38°) scaleY(1/cos(38°)), `#field-uprights` flat overlay for billboarded sprites depth-sorted via `_spriteQueue`.
> - `projectBroadcast` does the full CSS pipeline (scaleY → rotateX around transformOrigin → wrap perspective with 50%/80% origin → screen → upright-canvas internal). Geometry cached in `_bcastGeom`, invalidated on resize + camera change. **Don't tweak `BROADCAST_TILT_DEG=38` or `BROADCAST_PERSPECTIVE_PX=1100` in isolation** — coupled across JS and CSS.
> - Replay system: `_scoreHighlight` + `_extractReplayClips` save top 7 plays per game to `franchise.replayClips`. `frnReplayClip` plays a synthetic gameResult at 0.5x. Replays tab has scope tabs (Top 10 week / All week / My Team / Season Top 25).
> - Week-recap modal pops once per completed week via `_showWeekRecapIfReady()`, gated by `franchise._lastRecapSeen`.
> - Scrubbable timeline DOM-injected into field-wrap (NOT part of HUD render — HUD rebuilds inner HTML). Play/pause, restart (↺), drag track, elapsed time.
> - `_backfillReplayClips()` initializes empty array for old saves; historical games can't be reconstructed since sim drops plays after storage.
>
> **Earlier shipped foundations** (settled, don't redo): all three contract screens have portraits + tier-styled names + raise math + hover-preview cap bars + `_buildExtensionPitch` data block. Demand cooldown via `contract.startSeason` (7 creation sites, backfilled for legacy). Player legacy tier system (LEGEND/ICON/ELITE/PRO) via `playerLink`. Nicknames flag-only (never rewrite `p.name`). HOF voting annual + class-based. Engine physics layer with `p._wear`/`p._stress`/`p._bodyWear` (21 regions), force-scaled hit wear, bimodal ACL spike, concussion engine with CTE arc, hit mechanism + UR/ejection discipline. All major stat categories in NFL elite bands.
>
> **Open priorities** (from arc + prior reassessments):
> 1. Sideline graphic flush with field bottom (visual continuity)
> 2. Player art rebuild (current sprites look flat vs upgraded field — ask user first)
> 3. Mechanism / UR / ejection visuals in real-time play log
> 4. Engine Phase 5 — smart pickers (share/count/touches modes per slot)
> 5. Contract follow-ups: AI inbound offers for unhappy stars, custom AAV slider, price-aware verdict, comp pick surplus value
>
> **Conventions**: never rewrite `p.name`. Tier system through `playerLink(p)`. Migrations version-flagged on `franchise.*`. Contracts include `startSeason` + `signedOvr`. Verify with `node -c`. For UI, also verify in browser via Playwright (templates in `/tmp/snap_*.mjs` — `python3 -m http.server 8765` in repo root). Commit + push each change. Ask before broad architectural moves or before touching broadcast cam math.
