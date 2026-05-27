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
// Multiplier applied to native sprite pixel size when drawing on field.
// Our 104px PixelLab sprites need to scale down to match the ~25-30px
// procedural player render. Tune live (window.GC_SPRITE_SCALE override).
const _SPRITE_SCALE = 0.3;

// Direction order matches PixelLab's rotation set.
const _DIRECTIONS = [
  "east", "north-east", "north", "north-west",
  "west", "south-west", "south", "south-east",
];
// Kick has no head-on/away frames (leg swing doesn't read top-down).
const _KICK_DIRS = [
  "south-east", "east", "north-east",
  "north-west", "west", "south-west",
];

// Pose-key → { folder, frames, dirs }. `folder` is the on-disk directory;
// multiple pose keys can point at the same folder (aliasing). Pose keys
// MUST match what the engine emits (see grep `.pose =` in play-animation).
const _SPRITE_POSES = {
  // Direct matches (key == folder)
  idle:      { folder: "idle",      frames: 1, dirs: _DIRECTIONS },
  stance:    { folder: "stance",    frames: 4, dirs: _DIRECTIONS },
  run:       { folder: "run",       frames: 4, dirs: _DIRECTIONS },
  celebrate: { folder: "celebrate", frames: 4, dirs: _DIRECTIONS },

  // Engine-emitted poses → closest existing folder
  carry:     { folder: "run",       frames: 4, dirs: _DIRECTIONS },  // ball-carrier
  tackled:   { folder: "fall",      frames: 4, dirs: _DIRECTIONS },  // on the ground
  engage:    { folder: "block",     frames: 4, dirs: _DIRECTIONS },  // OL/DL clash
  reach:     { folder: "catch",     frames: 4, dirs: _DIRECTIONS },  // receiver reach
  dive:      { folder: "tackle",    frames: 4, dirs: _DIRECTIONS },  // diving forward
  sack:      { folder: "fall",      frames: 4, dirs: _DIRECTIONS },  // QB sacked
  ragdoll:   { folder: "fall",      frames: 4, dirs: _DIRECTIONS },  // tossed body

  // Newer folders, no engine pose emits these yet — ready for when it does
  pass:      { folder: "pass",      frames: 4, dirs: _DIRECTIONS },
  kick:      { folder: "kick",      frames: 4, dirs: _KICK_DIRS  },
  dodge:     { folder: "dodge",     frames: 4, dirs: _DIRECTIONS },

  // Not yet sprite-backed (engine emits these → fall through to shape math):
  // backpedal, hit, jam, scrape
};

// Per-(pose,dir,frame) raw image cache. Keyed "pose|dir|frame".
const _spriteCache = {};
// Per-(pose,dir,frame,color) tinted canvas cache.
const _tintCache = new Map();
let _spritesEnabled = false;

function _loadSprite(pose, dir, frame) {
  const def = _SPRITE_POSES[pose];
  if (!def) return;
  const folder = def.folder || pose;
  const key = `${pose}|${dir}|${frame}`;
  if (_spriteCache[key] !== undefined) return;
  const fname = frame == null
    ? `${dir}.png`
    : `${dir}_${frame}.png`;
  const url = `${_SPRITE_BASE_URL}${folder}/${fname}`;
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

// Last-call diagnostic — populated by drawPlayerSprite for debug.
const _lastMiss = { pose: null, dir: null, reason: null, count: 0 };

// Public API
const SpriteAtlas = {
  preload: _preloadAllSprites,
  anyLoaded: () => _spritesEnabled,
  // Diagnostic — report what's loaded and what's not. Call from devtools:
  //   SpriteAtlas.stats()
  stats: () => {
    let loaded = 0, loading = 0, missing = 0;
    for (const k in _spriteCache) {
      const v = _spriteCache[k];
      if (v === "loading") loading++;
      else if (v == null) missing++;
      else loaded++;
    }
    return {
      enabled: _spritesEnabled,
      total: Object.keys(_spriteCache).length,
      loaded, loading, missing,
      lastMiss: { ..._lastMiss },
      poseKeys: Object.keys(_SPRITE_POSES),
    };
  },
  // Inspect a specific cache entry. e.g. SpriteAtlas.peek('run','south',0)
  peek: (pose, dir, frame) => {
    const key = `${pose}|${dir}|${frame == null ? "" : frame}`;
    return { key, value: _spriteCache[key] };
  },
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

// Map (vx, vy, facing) → 8-direction string. Velocity wins if moving;
// otherwise fall back to facing (±1 = east/west — matches the L/R axis
// the engine uses for facing).
function _velocityToDirection(vx, vy, facing) {
  if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) {
    return (facing == null || facing >= 0) ? "east" : "west";
  }
  // atan2 returns (-π, π] with 0 = east; map to 8 octants.
  // +y is DOWN (south) on canvas, so negate vy for CCW math-angle.
  const ang = Math.atan2(-vy, vx);   // -π..π, CCW from east
  let octant = Math.round((ang / (Math.PI / 4)) + 8) % 8;
  // _DIRECTIONS index order: 0=east, 1=NE, 2=N, 3=NW, 4=W, 5=SW, 6=S, 7=SE
  return _DIRECTIONS[octant];
}

// Draw the player using a sprite if available. Returns true if drawn,
// false if the caller should fall back to shape rendering.
// `ctx` must already be translated to the player's local origin.
// `vx`, `vy` are recent velocity (used to pick the 8-direction sprite).
// `facing` is the L/R heading sign (used when stationary).
// `t` is the pose-internal time (0..1 for animation cycles).
function drawPlayerSprite(ctx, pose, t, vx, vy, teamPrimary, facing) {
  if (!_spritesEnabled) { _lastMiss.pose=pose; _lastMiss.reason="atlas-disabled"; _lastMiss.count++; return false; }
  const def = _SPRITE_POSES[pose];
  if (!def) { _lastMiss.pose=pose; _lastMiss.reason="unknown-pose"; _lastMiss.count++; return false; }
  const dir = _velocityToDirection(vx || 0, vy || 0, facing);
  if (!def.dirs.includes(dir)) { _lastMiss.pose=pose; _lastMiss.dir=dir; _lastMiss.reason="dir-not-in-pose"; _lastMiss.count++; return false; }
  const frameIdx = def.frames > 1
    ? Math.floor(Math.max(0, Math.min(0.999, t)) * def.frames)
    : null;
  const key = `${pose}|${dir}|${frameIdx == null ? "" : frameIdx}`;
  const src = _spriteCache[key];
  if (!src || src === "loading") { _lastMiss.pose=pose; _lastMiss.dir=dir; _lastMiss.reason=src==="loading"?"still-loading":"404-or-missing"; _lastMiss.count++; return false; }
  const tinted = teamPrimary
    ? _tintedSprite(src, `${key}|${teamPrimary}`, teamPrimary)
    : src;
  const scale = (typeof window !== "undefined" && window.GC_SPRITE_SCALE)
    ? window.GC_SPRITE_SCALE
    : _SPRITE_SCALE;
  const fw = src.width * scale;
  const fh = src.height * scale;
  // Sprite is drawn centered on the player's local origin.
  ctx.drawImage(tinted, -fw / 2, -fh / 2, fw, fh);
  return true;
}

// Auto-preload at module load.
if (typeof window !== "undefined") {
  setTimeout(_preloadAllSprites, 0);
  window.SpriteAtlas = SpriteAtlas;
  window.drawPlayerSprite = drawPlayerSprite;
}
