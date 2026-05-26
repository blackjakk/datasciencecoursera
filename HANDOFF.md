# Sprite Pipeline Handoff

Context for a local Claude Code session driving the PixelLab MCP to
generate player sprites for this football game.

## Goal

Replace the hand-tuned canvas pose-math in `play-render.js` with sprite
images authored in PixelLab. The sprite atlas in `play-sprites.js` is
already wired up — drop PNGs in the expected layout and they render
automatically. Poses we don't have sprites for fall back to the existing
pose math.

## Current state

- One character already authored (see PixelLab dashboard — search for
  "American football player, top-down view")
- 8 directional rotations for the **idle** pose already in
  `gridiron-chain/sprites/idle/` (south.png, east.png, etc.)
- Sprite atlas (`gridiron-chain/play-sprites.js`) auto-loads any matching
  files at page load — see file header for layout conventions.
- Pages-deployed live site:
  https://blackjakk.github.io/datasciencecoursera/play.html

## Sprite layout convention

```
gridiron-chain/sprites/
├── idle/
│   ├── south.png        ← single-frame poses: <dir>.png
│   ├── east.png
│   └── ... (8 directions total)
├── run/
│   ├── south_0.png      ← multi-frame poses: <dir>_<frame>.png
│   ├── south_1.png
│   ├── south_2.png
│   ├── south_3.png
│   ├── east_0.png
│   └── ... (8 dirs × 4 frames)
└── ...
```

8 directions: `south, south-east, east, north-east, north, north-west,
west, south-west` (matches PixelLab's rotation export naming).

Sprite size: **92×92** px (PixelLab default). White/grey base so canvas
can tint per team color at render time.

## Pose list (priority order)

| Priority | Pose folder | Frames | Prompt for PixelLab |
|----------|-------------|--------|---------------------|
| P0 | `run` | 4 | "Running cycle, legs alternating, arms pumping forward, moving forward at speed" |
| P0 | `carry` | 4 | "Running forward with football tucked under right arm" |
| P0 | `tackled` | 1 | "Knocked down on the ground, face-up, arms splayed" |
| P0 | `hit` | 1 | "Diving forward to wrap a tackle, body horizontal, arms extended forward" |
| P1 | `stance` | 1 | "Crouched athletic stance, hands forward, ready" |
| P1 | `engage` | 2 | "Crouched, both arms punched forward in a blocking position" |
| P1 | `kick_slide` | 2 | "Wide-base shuffle, pass protection footwork, arms punched out" |
| P1 | `celebrate` | 4 | "Both arms raised high, jumping in celebration" |
| P2 | `reach` | 1 | "Both arms extended fully upward for a high catch" |
| P2 | `handoff` | 1 | "Arms in front at waist level, palms up to receive ball" |
| P2 | `leap` | 1 | "Horizontal in mid-air, one arm extended forward in a diving catch" |
| P2 | `dive` | 1 | "Horizontal in mid-air, both arms extended forward in a diving tackle" |

For each pose: PixelLab "Animate" feature, base it on the existing
character (so cross-frame consistency stays — same body, same proportions),
use the prompt above. Export as zip, extract the rotation PNGs into the
matching `sprites/<pose>/` folder.

## Workflow

1. In Claude Code (local), open a session with the PixelLab MCP attached.
2. Ask Claude to "generate the run pose for character <ID>, save to
   `gridiron-chain/sprites/run/`".
3. Claude uses PixelLab MCP to:
   - List characters (find the football player)
   - Generate animation with the run prompt
   - Save 8 rotations × 4 frames to disk in the expected naming
4. Run `node --check gridiron-chain/play-sprites.js` to verify nothing
   else broke.
5. Commit + push:
   ```bash
   git add gridiron-chain/sprites/
   git commit -m "PixelLab: add run pose (4 frames, 8 directions)"
   git push origin claude/football-sim-blockchain-game-b3sdq
   ```
6. Wait for the GitHub Pages deploy (~1 min) and check the live site
   to see the new pose in action.
7. Iterate on the next pose.

## Credit budget warning

PixelLab Tier 1 = 2000 images/month. A full P0+P1 set for one character
is roughly:
- P0: 4 poses × ~10 frames avg × 8 dirs ≈ 320 generations
- P1: 4 poses × ~3 frames avg × 8 dirs ≈ 96 generations
- Iteration multiplier (some pose attempts will need re-rolling): ~2x
- **One character, P0+P1: ~800 generations** of monthly budget

Budget to stay safe:
- Do ONE pose end-to-end first to validate quality before batching
- Stop and review after each pose
- Don't run "generate all poses" in one shot — credits gone in seconds

## Variety phase (later)

Phase 2: create 2-4 additional characters in PixelLab UI (small body
for WR/DB, large body for OL/DL, medium for everyone else). Repeat the
P0+P1 set for each. Atlas can then assign characters by `position` +
`bodyType` deterministically.

For now: ONE character, all poses, validate the pipeline.
