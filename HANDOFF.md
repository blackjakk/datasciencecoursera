# Sprite Pipeline Handoff

Context for a local Claude Code session driving the PixelLab MCP to
generate / refine player sprites for this football game.

## Goal

Sprite images authored in PixelLab replace the hand-tuned canvas
pose-math in `play-render.js`. The sprite atlas in `play-sprites.js`
maps every engine-emitted pose name to a sprite folder. Any pose
without a sprite falls back to the procedural pose-math (currently
that fallback is effectively suppressed — see commit ac53e2e).

## Current state — sprite library is COMPLETE (v3)

One base character ("American football player, top-down view"),
~1,190 PNGs across 37 player-pose folders + ball art. Standard layout
is **8 directions × 4 frames** unless noted.

Live site: https://blackjakk.github.io/datasciencecoursera/play.html

### Pose folders on disk (frame count)

Locomotion:   idle(8×1) run carry churn→carry backpedal scrape release drop_step(SE/SW only)
Catch:        catch(=reach/leap) handoff
Block:        block(=engage) kick_slide jam
Tackle:       tackle(=hit) dive_forward(=dive) fall(=tackled/sack) tackled_carry ragdoll tumble spin_fall
Carrier moves: juke spin(8×8) truck stiff_arm(=stiff)
QB:           pass(=throw) qb_carry qb_scramble drop_step
Defense:      strip_swat(=strip/swat)
Specialty:    kick(6 dirs ×4) hurdle dodge
Referee:      ref_idle ref_first_down ref_flag ref_td_signal ref_whistle
Ball art:     objects/ball.png, objects/football/<dir>.png

The atlas (`play-sprites.js` `_SPRITE_POSES`) is the source of truth
for pose-key → folder mapping + per-pose frame/direction counts. Some
poses use non-standard direction sets (`kick` = 6, `hurdle` = 7,
`drop_step` = SE/SW only). Edit that table when adding/retiring a pose.

## Sprite layout convention

```
gridiron-chain/sprites/<folder>/<direction>.png        (single-frame, e.g. idle)
gridiron-chain/sprites/<folder>/<direction>_<frame>.png (animation cycle)
```

8 directions: `south, south-east, east, north-east, north, north-west,
west, south-west`. Native size 92–104 px, white/grey base (tinted per
team color at runtime via multiply blend, cached).

## DO NOT COMMIT (gitignored in sprites/.gitignore)

Raw PixelLab exports and helpers: `*.zip`, `*.py`, `_*`. These were
accidentally committed in session 2 (~3 MB) and removed in 7052885.
Extract sprites into the pose folder, then delete the zip — don't
commit it.

## Adding / refining a pose (local PixelLab MCP session)

1. List characters via MCP, find "American football player, top-down view".
2. Generate the animation off that base character (keeps body/proportions
   consistent). 8 directions × 4 frames unless the pose only reads in
   fewer directions.
3. Save PNGs to `gridiron-chain/sprites/<folder>/<dir>_<frame>.png`.
4. If it's a NEW pose key, add it to `_SPRITE_POSES` in play-sprites.js.
5. `node --check gridiron-chain/play-sprites.js`
6. Delete any leftover .zip/.py, then:
   git add gridiron-chain/sprites/ gridiron-chain/play-sprites.js
   git commit -m "sprites: <pose> ..." && git push origin claude/football-sim-blockchain-game-b3sdq
7. Deploy auto-runs (~1 min); check the live site.

## Credit budget

PixelLab Tier 1 = 2000 images/month. A full pose (8×4) ≈ 32 generations;
re-rolls multiply that. The base library is done — remaining spend is
refinement (re-rolling poses that look off) and the variety phase below.

## Variety phase (NOT started)

Create 2-4 more base characters in PixelLab UI:
  - small/sleek  → WR, CB, S
  - medium       → QB, RB, TE, LB
  - large/bulky  → OL, DL
Repeat the pose set per character. Then the atlas assigns a character
per player by position + bodyType + a per-player hash (deterministic so
a given player always looks the same). Plumbing for multi-character
selection is NOT built yet — single shared character today.

## Known follow-ups (deferred gameplay/visual items)

From the last full audit, not yet addressed:
- Ball Y discontinuity at the catch frame (hand-height → feet snap)
- Pre-catch route strideHz hardcoded 3.0 (looks fast on comeback/hitch)
- First-down PASS has no get-up beat (abrupt tackled→celebrate); run does
- KR secondary tackler can pop into "tackled" pose mid-field on long returns
- Screen-TD POST_CATCH_MS formula mismatch
