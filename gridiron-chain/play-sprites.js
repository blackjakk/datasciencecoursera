// ─── Sprite atlas (optional skin for drawPlayer) ────────────────────────
//
// Drop-in sprite rendering on top of the existing pose-math drawPlayer.
// If sprites are loaded for a given pose, the sprite is drawn and the
// shape-math is skipped. If not, drawPlayer falls back to the
// hand-tuned body-part rendering. Mix and match as you generate assets.
//
// HOW TO ADD SPRITES:
//
//   1. Generate sprite PNGs in PixelLab.ai (or any tool that produces
//      consistent characters across poses). Recommended size: 64x64 per
//      frame, top-down view, white jersey + white helmet so we can
//      tint per-team at runtime.
//
//   2. Drop the PNGs into /gridiron-chain/sprites/ with the filename
//      pattern below. Example:
//
//        sprites/player_run.png        → 4-frame strip, 64×256 (4×64)
//        sprites/player_carry.png      → 4-frame strip, 64×256
//        sprites/player_tackled.png    → 1 frame,        64×64
//        sprites/player_hit.png        → 1 frame,        64×64
//        ...
//
//      Each strip is HORIZONTAL: frames laid out left-to-right inside
//      one row of height 64. Frames are read in order for animation
//      cycles (run pose t=0 → frame 0, t=0.25 → frame 1, etc).
//
//   3. The sprite layer auto-loads any file matching the pattern at
//      page load. To force a manual load (e.g. for a content drop
//      after page load) call `SpriteAtlas.preload()`.
//
//   4. To tint white pixels to team color, sprites are drawn through
//      an off-screen canvas with a multiply blend against the team
//      primary color. Sprite outlines stay dark; jersey/helmet white
//      areas pick up the team color.
//
// MINIMUM USEFUL ASSET SET (priority order):
//   P0:  run (4 frames), carry (4), tackled (1), hit (1)
//   P1:  idle, stance, engage, kick_slide (2), celebrate (4)
//   P2:  reach, handoff, leap, dive
//   ...

const _SPRITE_BASE_URL = "sprites/";
const _SPRITE_FRAME_SIZE = 64;   // px per frame; must match the asset

// Pose name → expected frame count. Add entries here as you add poses.
const _SPRITE_POSES = {
  // Locomotion
  idle:        { frames: 1 },
  stance:      { frames: 1 },
  run:         { frames: 4 },
  carry:       { frames: 4 },
  churn:       { frames: 4 },
  backpedal:   { frames: 4 },
  scrape:      { frames: 4 },
  release:     { frames: 2 },
  drop_step:   { frames: 4 },
  // Catch / handoff
  reach:       { frames: 1 },
  catch:       { frames: 1 },
  handoff:     { frames: 1 },
  leap:        { frames: 1 },
  // Blocking
  engage:      { frames: 2 },
  kick_slide:  { frames: 2 },
  block:       { frames: 1 },
  jam:         { frames: 1 },
  // Tackle / impact
  hit:         { frames: 1 },
  dive:        { frames: 1 },
  tackled:     { frames: 1 },
  tumble:      { frames: 1 },
  spin_fall:   { frames: 1 },
  ragdoll:     { frames: 1 },
  sack:        { frames: 1 },
  stiff:       { frames: 1 },
  // QB / kicker / specialty
  throw:       { frames: 4 },
  kick:        { frames: 4 },
  // Locomotion variants
  juke:        { frames: 1 },
  spin:        { frames: 2 },
  hurdle:      { frames: 1 },
  truck:       { frames: 1 },
  // Celebration
  celebrate:   { frames: 4 },
  lateral:     { frames: 1 },
  point:       { frames: 1 },
};

const _spriteCache = {};         // pose → HTMLImageElement (raw sprite strip)
const _tintCache = new Map();    // (pose,color) → off-screen canvas (tinted)
let _spritesEnabled = false;     // flips true once at least one image loads

function _loadSpritePose(pose) {
  const url = _SPRITE_BASE_URL + "player_" + pose + ".png";
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    _spriteCache[pose] = img;
    _spritesEnabled = true;
  };
  img.onerror = () => {
    // 404 expected for poses we haven't authored yet — silent.
    _spriteCache[pose] = null;
  };
  img.src = url;
  _spriteCache[pose] = "loading";
}

function _preloadAllSprites() {
  for (const pose of Object.keys(_SPRITE_POSES)) {
    if (_spriteCache[pose] === undefined) _loadSpritePose(pose);
  }
}

// Public API
const SpriteAtlas = {
  preload: _preloadAllSprites,
  isLoaded: (pose) => !!_spriteCache[pose] && _spriteCache[pose] !== "loading",
  anyLoaded: () => _spritesEnabled,
};

// Tint a sprite strip to team color. Cached per (pose, color) so we
// only do the multiply blend once per team per pose, not per frame.
function _tintedSprite(pose, hexColor) {
  const key = pose + "|" + hexColor;
  let cached = _tintCache.get(key);
  if (cached) return cached;
  const src = _spriteCache[pose];
  if (!src || src === "loading") return null;
  const off = document.createElement("canvas");
  off.width = src.width;
  off.height = src.height;
  const octx = off.getContext("2d");
  // Draw the raw sprite first.
  octx.drawImage(src, 0, 0);
  // Multiply the team color over it — white pixels become team color,
  // black pixels stay black. Sprite must use WHITE for tintable areas
  // (jersey, helmet body) and any non-tinted detail in dark grey/black.
  octx.globalCompositeOperation = "multiply";
  octx.fillStyle = hexColor;
  octx.fillRect(0, 0, off.width, off.height);
  // Restore alpha from the original (multiply can darken transparent
  // pixels into visible darkness without this).
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(src, 0, 0);
  _tintCache.set(key, off);
  return off;
}

// Draw the player using a sprite if available. Returns true if drawn,
// false if the caller should fall back to shape rendering.
//
// Caller is expected to have already translated the context to (x,y).
// `t` is the pose-internal time (0..1 for animation cycles, or 0 for
// single-frame poses). `facing` is +1 (right) or -1 (left); the sprite
// is horizontally flipped for -1.
function drawPlayerSprite(ctx, pose, t, facing, teamPrimary) {
  if (!_spritesEnabled) return false;
  const def = _SPRITE_POSES[pose];
  if (!def) return false;
  const src = _spriteCache[pose];
  if (!src || src === "loading") return false;
  const tinted = teamPrimary ? _tintedSprite(pose, teamPrimary) : src;
  if (!tinted) return false;
  const frameCount = Math.max(1, def.frames);
  const frameIdx = frameCount > 1
    ? Math.floor(Math.max(0, Math.min(0.999, t)) * frameCount)
    : 0;
  const fw = _SPRITE_FRAME_SIZE;
  const fh = _SPRITE_FRAME_SIZE;
  const sx = frameIdx * fw;
  const sy = 0;
  ctx.save();
  if (facing < 0) ctx.scale(-1, 1);
  ctx.drawImage(tinted, sx, sy, fw, fh, -fw / 2, -fh / 2, fw, fh);
  ctx.restore();
  return true;
}

// Auto-preload at module load.
if (typeof window !== "undefined") {
  // Defer one tick so script-tag load order doesn't matter.
  setTimeout(_preloadAllSprites, 0);
  window.SpriteAtlas = SpriteAtlas;
  window.drawPlayerSprite = drawPlayerSprite;
}
