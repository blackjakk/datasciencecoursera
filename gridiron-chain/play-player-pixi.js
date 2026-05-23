// ─── PIXI player renderer (Phase 3.2) ────────────────────────────────────
// Sprite-atlas player system. Each unique (color, secondary, label, pose,
// facing, frame-bucket) gets a lazily-rendered PIXI.Texture sourced from
// an offscreen canvas2D _drawPlayerImpl call. Per-frame, the broadcast-
// cam draw queue swaps from "canvas2D _spriteQueue closure" to a PIXI
// Sprite update — one sprite per player, identified by (color|label).
//
// Why a sprite atlas instead of a 1:1 Graphics rewrite of _drawPlayerImpl?
//   - _drawPlayerImpl is ~1000 lines of canvas2D paths/fills with team-
//     color shading, AO, rim light, equipment variations, pose math.
//   - Rewriting that in PIXI Graphics is 3-5 sessions of risky regression.
//   - Pre-rendering once per pose-state and reusing the texture gives an
//     immediate perf win + 100% visual parity with the existing art.
//   - This is how AAA sports games (Madden / 2K) actually work — sprite
//     sheets, not per-frame paint.
//
// Feature flag — window._usePlayerPixi. Default false until Phase 3.2.2
// wires it into drawPlayer; toggle to true to test in devtools.

window._usePlayerPixi = (window._usePlayerPixi != null) ? window._usePlayerPixi : false;

const GCPlayer = (() => {
  let _app = null;              // PIXI.Application bound to #player-pixi
  let _stage = null;            // PIXI.Container, sortable by zIndex
  let _attachedTo = null;
  // Texture cache: key → PIXI.Texture. Lazily populated on first request.
  const _texCache = new Map();
  // Sprite cache: playerKey → PIXI.Sprite. Stable per-game so PIXI can
  // reuse the WebGL render state.
  const _spriteCache = new Map();
  let _frameMarker = 0;          // ticks each frameStart; sprites not
                                 // refreshed by frame end are hidden.

  function _pixiAvailable() {
    return typeof PIXI !== "undefined" && typeof PIXI.Application === "function";
  }
  function _drawAvailable() {
    return typeof _drawPlayerImpl === "function";
  }

  // Idempotent — wires PIXI onto a new flat overlay canvas inside the
  // field-wrap. Hidden by default (alpha controlled by window flag).
  function ensure() {
    if (!_pixiAvailable() || !_drawAvailable() || !window._usePlayerPixi) return false;
    // The wrap exists in either topdown or broadcast — find it.
    const wrap = document.querySelector(".bspnlive-field-wrap.broadcast-cam")
              || document.querySelector(".bspnlive-field-wrap")
              || document.querySelector(".field-wrap");
    if (!wrap) return false;
    if (_app && _attachedTo === wrap) return true;
    // Wrap rebuild — destroy + re-create (mirrors play-fx.js pattern).
    if (_app && _attachedTo !== wrap) {
      try { _app.destroy(true, { children: true, texture: false }); } catch (_) {}
      _app = null; _stage = null;
      _spriteCache.clear();
      // Textures stay cached across wrap rebuilds (they're not bound
      // to the destroyed Application's renderer in PIXI 7).
    }
    try {
      // Create the canvas first so we can position it correctly.
      const cv = document.createElement("canvas");
      cv.className = "gc-player-pixi";
      cv.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;" +
        "pointer-events:none;z-index:3;";
      // Insert above #field-uprights so PIXI players occlude the
      // billboarded canvas2D sprite layer when both are present.
      const upr = wrap.querySelector("#field-uprights");
      if (upr && upr.nextSibling) wrap.insertBefore(cv, upr.nextSibling);
      else wrap.appendChild(cv);
      _app = new PIXI.Application({
        view: cv,
        width: FIELD.W, height: FIELD.H,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: false,
        preserveDrawingBuffer: true,
      });
      _stage = new PIXI.Container();
      _stage.sortableChildren = true;   // depth sort via child.zIndex
      _app.stage.addChild(_stage);
      _attachedTo = wrap;
      return true;
    } catch (e) {
      console.warn("PIXI player init failed:", e);
      _app = null;
      return false;
    }
  }

  // Renders the canvas2D player to an offscreen canvas at a fixed
  // texture size, then wraps it as a PIXI.Texture. Suppresses the PIXI
  // shadow hook so the shadow is drawn IN the texture (not on the
  // global PIXI field).
  const TEX_W = 96;
  const TEX_H = 192;
  // Foot position inside the texture — body extends UP from here.
  // 18% margin at the bottom gives room for the shadow + foot dust.
  const TEX_FOOT_FX = 0.5;
  const TEX_FOOT_FY = 0.82;
  function _renderPoseToTexture(color, secondary, label, pose, t, facing, style) {
    const canvas = document.createElement("canvas");
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    const offCtx = canvas.getContext("2d");
    // Inhibit the PIXI-shadow side-effect so the shadow paints onto
    // this offscreen canvas in canvas2D (where it belongs in the
    // texture).
    const prev = window._useFieldPixi;
    window._useFieldPixi = false;
    try {
      _drawPlayerImpl(
        offCtx,
        TEX_W * TEX_FOOT_FX,
        TEX_H * TEX_FOOT_FY,
        color, secondary, label, pose, t, facing, style || {}
      );
    } catch (e) {
      console.warn("offscreen player render failed:", e);
    } finally {
      window._useFieldPixi = prev;
    }
    return PIXI.Texture.from(canvas);
  }

  // Quantize t to a finite set of frames per pose. 6 frames per pose
  // is enough animation to read as fluid without exploding cache size.
  const T_BUCKETS = 6;
  function _texKey(color, secondary, label, pose, t, facing, style) {
    const tBucket = Math.max(0, Math.min(T_BUCKETS - 1, Math.floor(t * T_BUCKETS)));
    // style flags that affect rendering go into the key; ignore style
    // params that are equivalent for the same player.
    const sk = style ? `${style.longSleeves ? 1 : 0}${style.glove ? 1 : 0}${style.brace ? 1 : 0}` : "0";
    return `${color}|${secondary}|${label}|${pose}|${facing}|${tBucket}|${sk}`;
  }
  function _getTexture(color, secondary, label, pose, t, facing, style) {
    const key = _texKey(color, secondary, label, pose, t, facing, style);
    let tex = _texCache.get(key);
    if (!tex) {
      const tBucket = Math.max(0, Math.min(T_BUCKETS - 1, Math.floor(t * T_BUCKETS)));
      const tRender = (tBucket + 0.5) / T_BUCKETS;
      tex = _renderPoseToTexture(color, secondary, label, pose, tRender, facing, style);
      _texCache.set(key, tex);
    }
    return tex;
  }

  // Public — call once at the start of every animation frame BEFORE any
  // GCPlayer.render() calls. Bumps the frame marker so sprites not
  // refreshed this frame can be hidden in frameEnd.
  function frameStart() {
    if (!ensure()) return;
    _frameMarker++;
  }

  // Public — call per player per frame.
  //   playerKey: stable string (e.g., `${color}|${label}`) used as the
  //              Sprite cache key. Same player should pass same key.
  //   screenX, screenY: the projected (broadcast cam) or world (topdown)
  //              position where the FOOT should land on the canvas.
  //   scale:    per-player depth scale (projected.scale in broadcast).
  //   color/secondary/label/pose/t/facing/style: same as _drawPlayerImpl.
  function render(playerKey, screenX, screenY, scale, color, secondary, label, pose, t, facing, style) {
    if (!ensure()) return;
    let sprite = _spriteCache.get(playerKey);
    if (!sprite) {
      sprite = new PIXI.Sprite();
      sprite.anchor.set(TEX_FOOT_FX, TEX_FOOT_FY);
      _stage.addChild(sprite);
      _spriteCache.set(playerKey, sprite);
    }
    const tex = _getTexture(color, secondary, label, pose, t || 0, facing, style);
    sprite.texture = tex;
    sprite.position.set(screenX, screenY);
    sprite.scale.set(scale, scale);
    sprite.zIndex = screenY;        // depth sort: lower-on-screen = closer = on top
    sprite.visible = true;
    sprite._lastFrame = _frameMarker;
  }

  // Public — call once at the end of every animation frame to hide
  // sprites not refreshed (player went out of play / off screen).
  function frameEnd() {
    if (!_app || !_stage) return;
    for (const [key, sprite] of _spriteCache) {
      if (sprite._lastFrame !== _frameMarker) sprite.visible = false;
    }
    frameEndBall();
    _app.renderer.render(_app.stage);
  }

  // ── Ball renderer (Phase 3.3) ─────────────────────────────────────
  // Same sprite-atlas pattern for the football. One base texture per
  // glow-vs-no-glow variant; rotation handled via sprite.rotation
  // (continuous, not cached). Sprite lives in the same _stage as
  // players so depth sorting via zIndex is unified.
  const BALL_TEX_W = 48, BALL_TEX_H = 48;
  function _renderBallToTexture(glow) {
    if (typeof _drawBallImpl !== "function") return null;
    const canvas = document.createElement("canvas");
    canvas.width = BALL_TEX_W;
    canvas.height = BALL_TEX_H;
    const offCtx = canvas.getContext("2d");
    try {
      _drawBallImpl(offCtx, BALL_TEX_W / 2, BALL_TEX_H / 2, 1, { glow, angle: 0 });
    } catch (e) {
      console.warn("offscreen ball render failed:", e);
    }
    return PIXI.Texture.from(canvas);
  }
  let _ballSprite = null;
  let _ballTexGlow = null, _ballTexPlain = null;
  function renderBall(screenX, screenY, scale, angle, opts) {
    if (!ensure()) return;
    const glow = opts ? opts.glow !== false : true;
    if (glow && !_ballTexGlow)  _ballTexGlow  = _renderBallToTexture(true);
    if (!glow && !_ballTexPlain) _ballTexPlain = _renderBallToTexture(false);
    const tex = glow ? _ballTexGlow : _ballTexPlain;
    if (!tex) return;
    if (!_ballSprite) {
      _ballSprite = new PIXI.Sprite();
      _ballSprite.anchor.set(0.5);
      _stage.addChild(_ballSprite);
    }
    _ballSprite.texture = tex;
    _ballSprite.position.set(screenX, screenY);
    _ballSprite.scale.set(scale, scale);
    _ballSprite.rotation = angle || 0;
    _ballSprite.zIndex = screenY + 0.5;   // slight bias so ball renders
                                          // just above same-y players
    _ballSprite.visible = true;
    _ballSprite._lastFrame = _frameMarker;
  }

  function active() {
    if (!_pixiAvailable() || !window._usePlayerPixi) return false;
    if (!_app) ensure();
    return !!_app;
  }

  function _stats() {
    return {
      textures: _texCache.size,
      sprites: _spriteCache.size,
      active: active(),
    };
  }

  function frameEndBall() {
    // If ball wasn't rendered this frame, hide it
    if (_ballSprite && _ballSprite._lastFrame !== _frameMarker) {
      _ballSprite.visible = false;
    }
  }

  return { ensure, frameStart, render, renderBall, frameEnd, frameEndBall, active, _stats };
})();
