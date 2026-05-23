// ─── Visual FX layer ──────────────────────────────────────────────────────
// Particle effects + screen shake on top of the existing canvas renderer.
// Pure canvas2D for now — no PIXI dependency. Designed so the API can be
// re-pointed to a PIXI ParticleContainer later without touching callers.
//
// API:
//   GCFx.dust(x, y, dir)            — kick-up dust at a player position
//                                     (x,y in #field-uprights canvas coords)
//   GCFx.hitBurst(x, y, color)      — collision debris on big hits
//   GCFx.confetti(x, y, color, n)   — touchdown confetti burst
//   GCFx.shake(strength=10, ms=400) — broadcast-wrap screen shake
//   GCFx.tick(dtMs)                 — advance particles each frame
//   GCFx.draw(ctx)                  — render to a 2D context
//
// Called from play-animation.js' tick loop (after _frameStartBroadcast and
// before _frameEndBroadcast) so particles render on the upright overlay
// canvas with the rest of the broadcast-cam sprites.

const GCFx = (() => {
  const particles = [];
  const MAX = 600;             // particle cap — drop newest if exceeded
  let shakeStart = 0;
  let shakeDur   = 0;
  let shakeAmp   = 0;
  let shakeTarget = null;

  // ── PIXI WebGL renderer (Phase 1) ─────────────────────────────────────
  // When PIXI is available we render particles via WebGL Graphics + a
  // BlurFilter "bloom-lite" pass. Particle data + update logic stay in
  // canvas2D so the caller API is unchanged; only the draw step swaps.
  // PIXI canvas gets attached as a child of the field-wrap once and
  // re-attached on wrap rebuilds (renderGameLayout reassembles innerHTML).
  let _pxApp = null;            // PIXI.Application
  let _pxParticles = null;      // PIXI.Container holding particle Graphics
  let _pxPool = [];             // recycled Graphics instances
  let _pxAttachedTo = null;     // wrap element we attached to (for invalidation)
  let _pxVignetteSprite = null; // PIXI.Sprite displaying a pre-rendered vignette texture
  let _pxLightBeams = null;     // PIXI.Container holding animated stadium-light rays
  let _pxFlashSprite = null;    // PIXI.Sprite (Texture.WHITE) for tinted full-screen flash
  let _flashStart = 0;
  let _flashDur = 0;
  let _flashColor = 0xffffff;
  let _flashPeak = 0;
  function _pixiAvailable() {
    return typeof PIXI !== "undefined" && typeof PIXI.Application === "function";
  }
  function _ensurePixiOverlay() {
    if (!_pixiAvailable()) return false;
    const wrap = document.querySelector(".bspnlive-field-wrap.broadcast-cam")
              || document.querySelector(".bspnlive-field-wrap")
              || document.querySelector(".field-wrap");
    if (!wrap) return false;
    // Wrap was rebuilt — our canvas got detached. Destroy and recreate.
    if (_pxApp && _pxAttachedTo !== wrap) {
      try { _pxApp.destroy(true, { children: true, texture: true }); } catch (_) {}
      _pxApp = null; _pxParticles = null; _pxPool.length = 0;
    }
    if (_pxApp) return true;
    try {
      _pxApp = new PIXI.Application({
        width: 1700, height: 720,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: false,            // we drive renders from the game tick
        preserveDrawingBuffer: true, // lets headless screenshots capture WebGL
      });
      const view = _pxApp.view;
      view.className = "gc-pixi-fx";
      view.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;" +
        "pointer-events:none;z-index:4;";
      wrap.appendChild(view);
      _pxAttachedTo = wrap;
      // ── Vignette layer (drawn FIRST — bottom of z-stack). Pre-render
      // to a RenderTexture once, then display as a Sprite. This bypasses
      // the per-frame Graphics path that produced the gray-composite
      // artifact on software WebGL in Phase 1.5.
      try {
        const vignTex = PIXI.RenderTexture.create({ width: 1700, height: 720 });
        const vignG = new PIXI.Graphics();
        // Build a proper radial vignette: draw a dark full-canvas rect,
        // then "punch" a transparent center via PIXI BLEND_MODES.ERASE on
        // overlapping bright ellipses. Net result: dark at the corners,
        // clear in the center. RenderTexture caches the result so the
        // per-frame cost is just blitting one Sprite.
        const W = 1700, H = 720, cx = W / 2, cy = H * 0.58;
        vignG.beginFill(0x000000, 0.5);
        vignG.drawRect(0, 0, W, H);
        vignG.endFill();
        // Subtractive bright ellipses — clear the center.
        vignG.blendMode = PIXI.BLEND_MODES.ERASE;
        const layers = 10;
        for (let i = 0; i < layers; i++) {
          const t = (layers - i) / layers;     // 1 → 1/layers
          const rx = (0.30 + 0.50 * t) * W;
          const ry = (0.34 + 0.55 * t) * H;
          const a = 0.12 * t;
          vignG.beginFill(0xffffff, a);
          vignG.drawEllipse(cx, cy, rx, ry);
          vignG.endFill();
        }
        _pxApp.renderer.render(vignG, { renderTexture: vignTex });
        vignG.destroy();
        _pxVignetteSprite = new PIXI.Sprite(vignTex);
        _pxApp.stage.addChild(_pxVignetteSprite);
      } catch (e) {
        console.warn("PIXI vignette failed:", e);
      }
      // ── Stadium light beams (drawn second). Soft additive sprites at
      // the existing CSS stadium-light positions, gently pulsing. New
      // effect that wasn't easily doable in canvas2D.
      try {
        _pxLightBeams = new PIXI.Container();
        _pxLightBeams.blendMode = PIXI.BLEND_MODES.ADD;
        const beamTex = PIXI.RenderTexture.create({ width: 180, height: 720 });
        const beamG = new PIXI.Graphics();
        // Soft conical beam — bright at top, fading to transparent.
        for (let i = 0; i < 22; i++) {
          const t = i / 21;
          const halfW = 14 + t * 70;
          const yTop = t * 720 * 0.6;
          const a = (1 - t) * 0.06;
          beamG.beginFill(0xfff0c8, a);
          beamG.drawRect(90 - halfW, yTop, halfW * 2, 12);
          beamG.endFill();
        }
        _pxApp.renderer.render(beamG, { renderTexture: beamTex });
        beamG.destroy();
        const beamPositions = [0.10, 0.32, 0.50, 0.68, 0.90];
        for (const px of beamPositions) {
          const s = new PIXI.Sprite(beamTex);
          s.anchor.set(0.5, 0);
          s.position.set(px * 1700, 8);
          s.alpha = 0.55;
          _pxLightBeams.addChild(s);
        }
        _pxApp.stage.addChild(_pxLightBeams);
      } catch (e) {
        console.warn("PIXI light beams failed:", e);
        _pxLightBeams = null;
      }
      // ── Particle layer with bloom-lite blur ──
      _pxParticles = new PIXI.Container();
      const blur = new PIXI.BlurFilter();
      blur.blur = 2.4;
      blur.quality = 2;
      _pxParticles.filters = [blur];
      _pxApp.stage.addChild(_pxParticles);
      // ── Flash layer on top — full-screen Sprite with PIXI.Texture.WHITE
      // tinted to the flash color. Sprite-tinting bypasses the Graphics
      // path that produced the gray-composite issue in Phase 1.5.
      try {
        _pxFlashSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        _pxFlashSprite.width  = 1700;
        _pxFlashSprite.height = 720;
        _pxFlashSprite.alpha  = 0;
        _pxApp.stage.addChild(_pxFlashSprite);
      } catch (e) {
        console.warn("PIXI flash sprite failed:", e);
        _pxFlashSprite = null;
      }
      return true;
    } catch (e) {
      console.warn("PIXI FX init failed, falling back to canvas2D:", e);
      _pxApp = null;
      return false;
    }
  }
  function _hexFromRgba(rgbaPrefix) {
    // "rgba(255,180,80,"  →  0xFFB450
    const m = /rgba\((\d+),(\d+),(\d+),/.exec(rgbaPrefix);
    if (!m) return 0xffffff;
    return (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
  }
  function _hexFromCss(c) {
    if (!c) return 0xffffff;
    if (c[0] === "#") {
      if (c.length === 4) {
        return (parseInt(c[1], 16) * 17) << 16 |
               (parseInt(c[2], 16) * 17) << 8 |
                parseInt(c[3], 16) * 17;
      }
      return parseInt(c.slice(1), 16);
    }
    return _hexFromRgba(c.startsWith("rgba") ? c : "rgba(" + c.slice(4));
  }
  function flash(color, durMs, peak) {
    _flashStart = performance.now();
    _flashDur   = durMs || 240;
    _flashColor = (typeof color === "string") ? _hexFromCss(color) : (color || 0xffffff);
    _flashPeak  = peak != null ? peak : 0.45;
    if (_pxFlashSprite && _pxApp) {
      // Bake the color into a fresh RenderTexture so we never depend on
      // sprite tint (PIXI 7 tint behavior is unreliable on the headless
      // software-WebGL renderer we use in CI).
      try {
        const tex = PIXI.RenderTexture.create({ width: 1700, height: 720 });
        const g = new PIXI.Graphics();
        g.beginFill(_flashColor, 1);
        g.drawRect(0, 0, 1700, 720);
        g.endFill();
        _pxApp.renderer.render(g, { renderTexture: tex });
        g.destroy();
        if (_pxFlashSprite.texture && _pxFlashSprite.texture !== PIXI.Texture.WHITE) {
          _pxFlashSprite.texture.destroy(true);
        }
        _pxFlashSprite.texture = tex;
        _pxFlashSprite.width = 1700;
        _pxFlashSprite.height = 720;
      } catch (e) { console.warn("flash texture rebuild failed:", e); }
    }
  }
  function _updateFlash() {
    if (!_pxFlashSprite) return;
    if (!_flashDur) { _pxFlashSprite.alpha = 0; return; }
    const elapsed = performance.now() - _flashStart;
    if (elapsed >= _flashDur) {
      _pxFlashSprite.alpha = 0;
      _flashDur = 0;
      return;
    }
    const k = elapsed / _flashDur;
    // Fast rise to peak in the first 25%, then exponential decay.
    const env = k < 0.25 ? (k / 0.25) : Math.exp(-(k - 0.25) * 6);
    _pxFlashSprite.alpha = env * _flashPeak;
  }
  function _drawPixi() {
    if (!_ensurePixiOverlay()) return false;
    // Pool: reuse Graphics across frames; index into _pxPool.
    let i = 0;
    for (const p of particles) {
      const alpha = Math.max(0, 1 - p.life / p.ttl);
      let g = _pxPool[i];
      if (!g) {
        g = new PIXI.Graphics();
        _pxPool[i] = g;
        _pxParticles.addChild(g);
      }
      g.visible = true;
      g.clear();
      const tint = _hexFromRgba(p.col);
      if (p.type === "confetti" && p.rot != null) {
        g.beginFill(tint, alpha);
        g.drawRect(-p.r, -p.r * 0.35, p.r * 2, p.r * 0.7);
        g.endFill();
        g.position.set(p.x, p.y);
        g.rotation = p.rot;
      } else {
        g.beginFill(tint, alpha);
        g.drawCircle(0, 0, Math.max(0.5, p.r));
        g.endFill();
        g.position.set(p.x, p.y);
        g.rotation = 0;
      }
      i++;
    }
    // Hide any extra pooled Graphics from a previous (larger) frame.
    for (; i < _pxPool.length; i++) _pxPool[i].visible = false;
    // Stadium light beams — slow per-beam pulse so the lighting feels
    // alive instead of static. Phase offset per beam keeps them out of
    // sync.
    if (_pxLightBeams) {
      const now = performance.now() / 1000;
      const beams = _pxLightBeams.children;
      for (let bi = 0; bi < beams.length; bi++) {
        const pulse = 0.4 + 0.18 * Math.sin(now * 0.6 + bi * 1.7);
        beams[bi].alpha = pulse;
      }
    }
    _updateFlash();
    _pxApp.renderer.render(_pxApp.stage);
    return true;
  }

  function _push(p) {
    if (particles.length >= MAX) return;
    particles.push(p);
  }

  function dust(x, y, dir) {
    // Light tan puff scattered from a foot strike. Drifts opposite to the
    // player's direction so it looks left behind.
    const d = (dir || 0);
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4 - d * 0.4;
      const sp = 0.8 + Math.random() * 1.0;
      _push({
        type: "dust",
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0, ttl: 380 + Math.random() * 220,
        r: 6 + Math.random() * 4,
        rg: 0.04,
        col: "rgba(195,178,142,",
        gravity: 0.0010,
      });
    }
  }

  function hitBurst(x, y, color) {
    // Sharp short-lived debris on collisions. Bigger spray, faster, mixes
    // tan dust with team-colored chips. Sized for visibility on the 1700×
    // 720 upright canvas where player sprites are ~30px tall.
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2.4 + Math.random() * 4.0;
      const isChip = i % 3 === 0;
      _push({
        type: "hit",
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.5,
        life: 0, ttl: 380 + Math.random() * 320,
        r: isChip ? (4 + Math.random() * 3) : (7 + Math.random() * 5),
        rg: -0.008,
        col: isChip ? (color || "rgba(40,40,55,") : "rgba(165,150,115,",
        gravity: 0.0035,
        drag: 0.985,
      });
    }
  }

  function confetti(x, y, color, n) {
    const count = n || 28;
    const cols = [
      color || "rgba(245,197,66,",
      "rgba(245,245,240,",
      "rgba(80,200,255,",
      "rgba(255,120,80,",
    ];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const sp = 3.2 + Math.random() * 4.0;
      _push({
        type: "confetti",
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0, ttl: 1500 + Math.random() * 800,
        r: 6 + Math.random() * 5,
        rg: 0,
        col: cols[i % cols.length],
        gravity: 0.0020,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.018,
      });
    }
  }

  // Trigger a screen shake on the field-wrap element via CSS transform.
  // The wrap is the parent of the canvas; shaking it preserves the broadcast
  // cam perspective intact.
  function shake(strength, ms) {
    shakeStart = performance.now();
    shakeDur   = ms || 400;
    shakeAmp   = (strength != null) ? strength : 8;
    if (!shakeTarget) {
      shakeTarget = document.querySelector(".bspnlive-field-wrap")
                 || document.querySelector(".field-wrap");
    }
  }

  // Advance particle state and shake.
  function tick(dtMs) {
    const dt = dtMs || 16.7;
    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.ttl) { particles.splice(i, 1); continue; }
      p.vy += (p.gravity || 0) * dt;
      if (p.drag) { p.vx *= Math.pow(p.drag, dt / 16.7); p.vy *= Math.pow(p.drag, dt / 16.7); }
      p.x += p.vx;
      p.y += p.vy;
      p.r += (p.rg || 0) * dt;
      if (p.rotV) p.rot += p.rotV * dt;
    }
    // Shake — apply transform to the field-wrap target until duration ends.
    if (shakeTarget) {
      const elapsed = performance.now() - shakeStart;
      if (elapsed < shakeDur) {
        const decay = 1 - elapsed / shakeDur;
        const dx = (Math.random() - 0.5) * 2 * shakeAmp * decay;
        const dy = (Math.random() - 0.5) * 2 * shakeAmp * decay;
        shakeTarget.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      } else if (shakeTarget.style.transform) {
        shakeTarget.style.transform = "";
      }
    }
  }

  function draw(ctx) {
    // Prefer PIXI WebGL rendering with bloom; transparent fallback to
    // canvas2D if PIXI failed to init or isn't attached yet.
    if (_drawPixi()) return;
    if (!particles.length) return;
    ctx.save();
    for (const p of particles) {
      const alpha = Math.max(0, 1 - p.life / p.ttl);
      ctx.fillStyle = p.col + alpha.toFixed(2) + ")";
      if (p.type === "confetti" && p.rot != null) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.r, -p.r * 0.35, p.r * 2, p.r * 0.7);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function clear() { particles.length = 0; }

  return { dust, hitBurst, confetti, shake, flash, tick, draw, clear };
})();
