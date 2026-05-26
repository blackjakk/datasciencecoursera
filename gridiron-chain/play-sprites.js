// ─── Sprite atlas (optional skin for drawPlayer) ────────────────────────
//
// Drop-in sprite rendering on top of the existing pose-math drawPlayer.
// If sprites are loaded for a given pose + direction, the sprite is drawn
// and the shape-math is skipped. If not, drawPlayer falls back to the
// hand-tuned body-part rendering. Mix and match as you generate assets.
//
// PIXELLAB ASSET LAYOUT
// ─────────────────────
//
// Each pose lives in its own folder:
//
//   sprites/<pose>/<direction>.png         (single-frame poses)
//   sprites/<pose>/<direction>_<frame>.png (animation cycles)
//
// Directions match PixelLab's "low top-down" 8-direction output:
//   south, south-east, east, north-east, north, north-west, west, south-west
//
// Examples:
//   sprites/idle/south.png                 (mannequin idle, facing camera)
//   sprites/run/east_0.png ... east_3.png  (4-frame run cycle, facing right)
//   sprites/tackled/south.png              (single fallen frame)
//
// The atlas auto-loads any matching files at page load. Files that 404
// are silently treated as "not authored yet" — drawPlayer falls back to
// canvas pose math for those (pose, direction) combinations.
//
// TEAM COLORS
// ───────────
// PixelLab characters are generated in white/grey so we can tint at
// runtime. Each sprite is recolored once per (pose, direction, color)
// via multiply blend, then cached.
//
// FACING → DIRECTION
// ──────────────────
// The game uses ±1 facing + (vx, vy) locomotion velocity. We pick the
// 8-direction sprite that best matches the player's heading angle.

const _SPRITE_BASE_URL = "sprites/";
const _SPRITE_FRAME_SIZE = 92;   // PixelLab default; tracks generator output

// Direction order matches PixelLab's rotation set.
const _DIRECTIONS = [
  "east", "north-east", "north", "north-west",
  "west", "south-west", "south", "south-east",
];

// Pose name → { frames: N, dirs: [...] } — N=1 for single-frame, >1 for
// animation cycles. Falls back to mid-pose-math if not present.
const _SPRITE_POSES = {
  idle:        { frames: 1, dirs: _DIRECTIONS },
  stance:      { frames: 1, dirs: _DIRECTIONS },
  run:         { frames: 4, dirs: _DIRECTIONS },
  carry:       { frames: 4, dirs: _DIRECTIONS },
  reach:       { frames: 1, dirs: _DIRECTIONS },
  handoff:     { frames: 1, dirs: _DIRECTIONS },
  engage:      { frames: 2, dirs: _DIRECTIONS },
  kick_slide:  { frames: 2, dirs: _DIRECTIONS },
  hit:         { frames: 1, dirs: _DIRECTIONS },
  dive:        { frames: 1, dirs: _DIRECTIONS },
  tackled:     { frames: 1, dirs: _DIRECTIONS },
  celebrate:   { frames: 4, dirs: _DIRECTIONS },
  throw:       { frames: 4, dirs: _DIRECTIONS },
  kick:        { frames: 4, dirs: _DIRECTIONS },
};

// Per-(pose,dir,frame) raw image cache. Keyed "pose|dir|frame".
const _spriteCache = {};
// Per-(pose,dir,frame,color) tinted canvas cache.
const _tintCache = new Map();
let _spritesEnabled = false;

function _loadSprite(pose, dir, frame) {
  const key = `${pose}|${dir}|${frame}`;
  if (_spriteCache[key] !== undefined) return;
  const fname = frame == null
    ? `${dir}.png`
    : `${dir}_${frame}.png`;
  const url = `${_SPRITE_BASE_URL}${pose}/${fname}`;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload  = () => { _spriteCache[key] = img; _spritesEnabled = true; };
  img.onerror = () => { _spriteCache[key] = null; };
  img.src = url;
  _spriteCache[key] = "loading";
}

function _preloadAllSprites() {
  for (const pose of Object.keys(_SPRITE_POSES)) {
    const def = _SPRITE_POSES[pose];
    for (const dir of def.dirs) {
      if (def.frames === 1) {
        _loadSprite(pose, dir, null);
      } else {
        for (let f = 0; f < def.frames; f++) _loadSprite(pose, dir, f);
      }
    }
  }
}

// Public API
const SpriteAtlas = {
  preload: _preloadAllSprites,
  anyLoaded: () => _spritesEnabled,
};

// Multiply-blend tint to recolor white pixels to team color. Cached.
function _tintedSprite(srcImg, key, hexColor) {
  let cached = _tintCache.get(key);
  if (cached) return cached;
  const off = document.createElement("canvas");
  off.width = srcImg.width;
  off.height = srcImg.height;
  const octx = off.getContext("2d");
  octx.drawImage(srcImg, 0, 0);
  octx.globalCompositeOperation = "multiply";
  octx.fillStyle = hexColor;
  octx.fillRect(0, 0, srcImg.width, srcImg.height);
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(srcImg, 0, 0);
  _tintCache.set(key, off);
  return off;
}

// Map (vx, vy) → 8-direction string. velocity-relative; if stationary
// or unknown, defaults to "south" (facing the broadcast camera).
function _velocityToDirection(vx, vy) {
  if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) return "south";
  // atan2 returns (-π, π] with 0 = east; we need to map to 8 octants.
  // In our coord system, +y is DOWN (south) and +x is EAST.
  // The DIRECTIONS array is ordered starting at east, going CCW visually
  // (north is up), but on canvas +y goes DOWN. So the octant for an
  // angle is: 0=east (vx>0,vy=0), 2=north (vy<0), 4=west, 6=south.
  // atan2(vy, vx) where vy is canvas-down gives clockwise angle from
  // east, so we negate vy to get CCW math-angle.
  const ang = Math.atan2(-vy, vx);   // -π..π, CCW from east
  // Map to 0..8 with 0=east.
  let octant = Math.round((ang / (Math.PI / 4)) + 8) % 8;
  // _DIRECTIONS index order: 0=east, 1=NE, 2=N, 3=NW, 4=W, 5=SW, 6=S, 7=SE
  // Already CCW from east — matches octant.
  return _DIRECTIONS[octant];
}

// Draw the player using a sprite if available. Returns true if drawn,
// false if the caller should fall back to shape rendering.
// `ctx` must already be translated/rotated to the player's local origin.
// `vx`, `vy` are recent velocity (used to pick the 8-direction sprite).
// `t` is the pose-internal time (0..1 for animation cycles).
function drawPlayerSprite(ctx, pose, t, vx, vy, teamPrimary) {
  if (!_spritesEnabled) return false;
  const def = _SPRITE_POSES[pose];
  if (!def) return false;
  const dir = _velocityToDirection(vx || 0, vy || 0);
  const frameIdx = def.frames > 1
    ? Math.floor(Math.max(0, Math.min(0.999, t)) * def.frames)
    : null;
  const key = `${pose}|${dir}|${frameIdx == null ? "" : frameIdx}`;
  const src = _spriteCache[key];
  if (!src || src === "loading") return false;
  const tinted = teamPrimary
    ? _tintedSprite(src, `${key}|${teamPrimary}`, teamPrimary)
    : src;
  const fw = src.width;
  const fh = src.height;
  // Sprite is drawn centered on the player's local origin.
  ctx.drawImage(tinted, -fw / 2, -fh / 2);
  return true;
}

// Auto-preload at module load.
if (typeof window !== "undefined") {
  setTimeout(_preloadAllSprites, 0);
  window.SpriteAtlas = SpriteAtlas;
  window.drawPlayerSprite = drawPlayerSprite;
}
