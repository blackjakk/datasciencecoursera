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
// 104px PixelLab sprite at 1.0 = native size. Tune live via
// window.GC_SPRITE_SCALE.
const _SPRITE_SCALE = 1.0;
// Procedural _drawPlayerImpl renders with FEET at the (x, y) point and
// the body extending up. Our sprite has its visual center near the chest,
// so we offset the draw downward by half a sprite height to align feet.
// PixelLab "low top-down" sprites have feet at ~85% Y, so offset = 0.35.
const _SPRITE_FOOT_OFFSET_Y = 0.35;

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
// Hurdle: north-west generation failed on PixelLab; other 7 dirs landed.
const _HURDLE_DIRS = [
  "south", "south-east", "east", "north-east",
  "north", "west", "south-west",
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
  block:     { folder: "block",     frames: 4, dirs: _DIRECTIONS },  // direct
  reach:     { folder: "catch",     frames: 4, dirs: _DIRECTIONS },  // receiver reach
  catch:     { folder: "catch",     frames: 4, dirs: _DIRECTIONS },  // alt key (engine uses both)
  leap:      { folder: "catch",     frames: 4, dirs: _DIRECTIONS },  // leaping catch — arms up
  dive:      { folder: "tackle",    frames: 4, dirs: _DIRECTIONS },  // diving forward
  hit:       { folder: "tackle",    frames: 4, dirs: _DIRECTIONS },  // contact moment
  sack:      { folder: "fall",      frames: 4, dirs: _DIRECTIONS },  // QB sacked
  ragdoll:   { folder: "fall",      frames: 4, dirs: _DIRECTIONS },  // tossed body
  tumble:    { folder: "fall",      frames: 4, dirs: _DIRECTIONS },  // falling + rolling
  spin_fall: { folder: "fall",      frames: 4, dirs: _DIRECTIONS },  // falling w/ spin
  point:     { folder: "stance",    frames: 4, dirs: _DIRECTIONS },  // DB pre-snap pointing
  throw:     { folder: "pass",      frames: 4, dirs: _DIRECTIONS },  // QB throw motion
  juke:      { folder: "dodge",     frames: 4, dirs: _DIRECTIONS },  // RB juke
  spin:      { folder: "dodge",     frames: 4, dirs: _DIRECTIONS },  // RB spin move (approx)
  jam:       { folder: "block",     frames: 4, dirs: _DIRECTIONS },  // DB press at line
  truck:     { folder: "run",       frames: 4, dirs: _DIRECTIONS },  // running through hit
  churn:     { folder: "run",       frames: 4, dirs: _DIRECTIONS },  // legs churning
  release:   { folder: "run",       frames: 4, dirs: _DIRECTIONS },  // WR release off line
  scrape:    { folder: "run",       frames: 4, dirs: _DIRECTIONS },  // LB scrape pursuit
  drop_step: { folder: "run",       frames: 4, dirs: _DIRECTIONS },  // QB dropback
  backpedal: { folder: "run",       frames: 4, dirs: _DIRECTIONS },  // DB cover (faces wrong way; iterate)
  stiff:     { folder: "run",       frames: 4, dirs: _DIRECTIONS },  // RB stiff-arm — still running, arm out (good enough)
  kick_slide:{ folder: "block",     frames: 4, dirs: _DIRECTIONS },  // OL pass-pro slide — crouched protective stance
  handoff:   { folder: "handoff",   frames: 4, dirs: _DIRECTIONS },  // QB→RB exchange
  hurdle:    { folder: "hurdle",    frames: 4, dirs: _HURDLE_DIRS }, // RB jump over defender

  // Newer folders for poses the engine doesn't emit yet (ready when it does)
  pass:      { folder: "pass",      frames: 4, dirs: _DIRECTIONS },
  kick:      { folder: "kick",      frames: 4, dirs: _KICK_DIRS  },
  dodge:     { folder: "dodge",     frames: 4, dirs: _DIRECTIONS },

  // Still fall through to shape math (no good alias):
  // handoff, hurdle, stiff, kick_slide
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
  // Match the lookup key format in drawPlayerSprite: empty string for
  // single-frame (frame=null), numeric for multi-frame. Previously stored
  // as the literal "null" via template-literal stringification — that
  // mismatch caused all 1-frame poses (idle) to 404 at draw time.
  const key = `${pose}|${dir}|${frame == null ? "" : frame}`;
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
// Per-pose hit/miss histogram. Cleared via SpriteAtlas.resetCounters().
const _hits = Object.create(null);
const _misses = Object.create(null);
function _bumpHit(pose)   { _hits[pose] = (_hits[pose] || 0) + 1; }
function _bumpMiss(pose, reason) {
  const key = `${pose}::${reason}`;
  _misses[key] = (_misses[key] || 0) + 1;
}

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
  // Per-pose hit/miss histogram. Counts since page load (or since reset).
  counters: () => ({ hits: { ..._hits }, misses: { ..._misses } }),
  resetCounters: () => {
    for (const k in _hits) delete _hits[k];
    for (const k in _misses) delete _misses[k];
  },
};

// Pixel-precise tint: replace WHITE pixels only with team color, preserve
// dark detail (visor, gloves, outline) so the sprite doesn't go uniformly
// blue/dark under multiply blend. Cached per (sprite, color).
function _tintedSprite(srcImg, key, hexColor) {
  let cached = _tintCache.get(key);
  if (cached) return cached;
  // Parse hex color
  const c = hexColor.replace("#", "");
  const cr = parseInt(c.slice(0, 2), 16);
  const cg = parseInt(c.slice(2, 4), 16);
  const cb = parseInt(c.slice(4, 6), 16);
  const off = document.createElement("canvas");
  off.width = srcImg.width;
  off.height = srcImg.height;
  const octx = off.getContext("2d");
  octx.drawImage(srcImg, 0, 0);
  // Read pixels and selectively tint white-ish ones
  try {
    const img = octx.getImageData(0, 0, srcImg.width, srcImg.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
      if (a === 0) continue;
      // Treat near-white (R,G,B all > 180 AND all within 30 of each other) as jersey/pad surface.
      // Replace with tint color but preserve relative brightness.
      if (r > 180 && g > 180 && b > 180 &&
          Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30) {
        // Brightness factor: 1.0 for pure white, ~0.72 for the darkest "white" (180/255).
        const brightness = (r + g + b) / (3 * 255);
        d[i]   = Math.round(cr * brightness);
        d[i+1] = Math.round(cg * brightness);
        d[i+2] = Math.round(cb * brightness);
      }
      // else: preserve original pixel (visor, gloves, outline, etc.)
    }
    octx.putImageData(img, 0, 0);
  } catch (e) {
    // CORS or other error → fall back to multiply tint
    octx.globalCompositeOperation = "multiply";
    octx.fillStyle = hexColor;
    octx.fillRect(0, 0, srcImg.width, srcImg.height);
    octx.globalCompositeOperation = "destination-in";
    octx.drawImage(srcImg, 0, 0);
  }
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
  if (!_spritesEnabled) { _lastMiss.pose=pose; _lastMiss.reason="atlas-disabled"; _lastMiss.count++; _bumpMiss(pose,"atlas-disabled"); return false; }
  const def = _SPRITE_POSES[pose];
  if (!def) { _lastMiss.pose=pose; _lastMiss.reason="unknown-pose"; _lastMiss.count++; _bumpMiss(pose,"unknown-pose"); return false; }
  const dir = _velocityToDirection(vx || 0, vy || 0, facing);
  if (!def.dirs.includes(dir)) { _lastMiss.pose=pose; _lastMiss.dir=dir; _lastMiss.reason="dir-not-in-pose"; _lastMiss.count++; _bumpMiss(pose,"dir-not-in-pose"); return false; }
  const frameIdx = def.frames > 1
    ? Math.floor(Math.max(0, Math.min(0.999, t)) * def.frames)
    : null;
  const key = `${pose}|${dir}|${frameIdx == null ? "" : frameIdx}`;
  const src = _spriteCache[key];
  if (!src || src === "loading") { _lastMiss.pose=pose; _lastMiss.dir=dir; _lastMiss.reason=src==="loading"?"still-loading":"404-or-missing"; _lastMiss.count++; _bumpMiss(pose,src==="loading"?"still-loading":"404-or-missing"); return false; }
  _bumpHit(pose);
  const tinted = teamPrimary
    ? _tintedSprite(src, `${key}|${teamPrimary}`, teamPrimary)
    : src;
  const scale = (typeof window !== "undefined" && window.GC_SPRITE_SCALE)
    ? window.GC_SPRITE_SCALE
    : _SPRITE_SCALE;
  const fw = src.width * scale;
  const fh = src.height * scale;
  // Draw with feet at the local origin (procedural _drawPlayerImpl puts
  // feet at (x,y)). PixelLab sprites have head at top, feet near bottom,
  // so the foot is at ~+_SPRITE_FOOT_OFFSET_Y * sprite_height from center.
  const foot = (typeof window !== "undefined" && window.GC_SPRITE_FOOT_OFFSET_Y != null)
    ? window.GC_SPRITE_FOOT_OFFSET_Y
    : _SPRITE_FOOT_OFFSET_Y;
  ctx.drawImage(tinted, -fw / 2, -fh / 2 - fh * foot, fw, fh);
  return true;
}

// ── Jersey number overlay ─────────────────────────────────────────────────
// Drawn on top of a sprite. ctx must already be translated to the player's
// local origin (foot at 0,0; body extending up to -fh). Position tuned to
// fall on the back of the jersey between the shoulder blades — not floating
// above the player. 104px sprite at scale 1.0: jersey middle-back ≈ y=-45.
// Live-tunable via window.GC_SPRITE_TEXT_Y_NUM and window.GC_SPRITE_TEXT_SIZE.
function _drawSpriteTextOverlay(ctx, label, secondary, style) {
  const labelStr = (label != null && label !== "") ? String(label) : "";
  if (!labelStr) return;
  const numY = (typeof window !== "undefined" && window.GC_SPRITE_TEXT_Y_NUM != null)
    ? window.GC_SPRITE_TEXT_Y_NUM : -45;
  const numSize = (typeof window !== "undefined" && window.GC_SPRITE_TEXT_SIZE != null)
    ? window.GC_SPRITE_TEXT_SIZE : 16;
  ctx.save();
  // Pixel-align — sub-pixel positioning is the #1 reason text looks
  // "floaty" over pixel art. Integer positions, no fractional shadows.
  const x = 0;
  const y = Math.round(numY);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Monospace block letter look. Impact reads as too narrow at small
  // sizes; bold monospace gives chunky pixel-style letterforms that
  // match the sprite art aesthetic.
  ctx.font = `bold ${numSize}px "Courier New", monospace`;
  // Disable smoothing so text edges are sharp/aliased (more pixel art).
  // Caveat: canvas text AA can't be fully disabled via API, but turning
  // off imageSmoothing affects the surrounding compositing pipeline.
  if (ctx.imageSmoothingEnabled !== undefined) ctx.imageSmoothingEnabled = false;
  // Three-layer "stitched" rendering. Bottom-up:
  //   1. STITCH OUTLINE — chunky black ring, 1.5 px wide. Sits on the
  //      jersey fabric like a thread border.
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(labelStr, x, y);
  //   2. MAIN FILL — secondary team color, pixel-aligned.
  ctx.fillStyle = secondary || "#fff";
  ctx.fillText(labelStr, x, y);
  //   3. INNER SHADOW — 1-pixel down-right darker shadow. Gives a
  //      slight raised/embossed thread look.
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.fillText(labelStr, x + 1, y + 1);
  // Repaint the secondary color on top so the inner shadow only shows
  // through the "thread height" gap (~1 px offset).
  ctx.fillStyle = secondary || "#fff";
  ctx.fillText(labelStr, x, y);
  ctx.restore();
}

// Auto-preload at module load.
if (typeof window !== "undefined") {
  setTimeout(_preloadAllSprites, 0);
  window.SpriteAtlas = SpriteAtlas;
  window.drawPlayerSprite = drawPlayerSprite;
  window._drawSpriteTextOverlay = _drawSpriteTextOverlay;
}
