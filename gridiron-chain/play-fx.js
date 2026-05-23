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
      // ── Particle layer with bloom-lite blur ──
      _pxParticles = new PIXI.Container();
      const blur = new PIXI.BlurFilter();
      blur.blur = 2.4;
      blur.quality = 2;            // 2 passes — visible bloom, cheap GPU cost
      _pxParticles.filters = [blur];
      _pxApp.stage.addChild(_pxParticles);
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
  function flash(_color, _durMs, _peak) {
    // Reserved for Phase 1.5 — the WebGL flash overlay had a software-
    // renderer compositing issue that produced a uniform gray instead of
    // the expected red wash. Tracked in HANDOFF.md §8 for next session.
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
