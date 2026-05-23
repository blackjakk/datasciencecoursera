// ─── PIXI field renderer (Phase 2A) ──────────────────────────────────────
// Replaces the canvas2D static-field background (grass + mowing bands +
// sidelines + end zones + yard lines + numbers + hash marks) with a single
// PIXI WebGL render pass into a RenderTexture, displayed on the #field-pixi
// canvas. The canvas2D #field continues to render dynamic elements
// (players, ball, LOS, FD line, weather particles) on top.
//
// Feature flag — window._useFieldPixi (default true once verified). When
// off, the PIXI canvas stays hidden and canvas2D drawField renders
// everything as before. Drop it to false in devtools to compare.
//
// Phase 2A scope:
//   - Base grass fill (with subtle vertical gradient for depth)
//   - Mowing band stripes (alternating darker/lighter green every 5 yards)
//
// Future phases extend this file:
//   2A.2 — sidelines, end zones, end-zone team text
//   2A.3 — yard lines, yard numbers, hash marks
//   2B   — LOS, FD line (per-play updates)
//   2C   — weather particles

window._useFieldPixi = (window._useFieldPixi != null) ? window._useFieldPixi : true;

const GCField = (() => {
  let _app = null;              // PIXI.Application bound to #field-pixi
  let _bg = null;               // PIXI.Container holding static field bg
  let _attachedTo = null;       // Canvas element we attached to
  let _lastRenderKey = "";      // Cache key: "homeId|awayId" — re-render on team change

  function _pixiAvailable() {
    return typeof PIXI !== "undefined" && typeof PIXI.Application === "function";
  }

  // Idempotent init — wires PIXI to the #field-pixi canvas. Safe to call
  // every frame; bails out fast if already attached.
  function ensure() {
    if (!_pixiAvailable() || !window._useFieldPixi) return false;
    const cv = document.getElementById("field-pixi");
    if (!cv) return false;
    if (_app && _attachedTo === cv) return true;
    // Wrap rebuild — destroy + re-create.
    if (_app && _attachedTo !== cv) {
      try { _app.destroy(false); } catch (_) {}
      _app = null; _bg = null; _lastRenderKey = "";
    }
    try {
      _app = new PIXI.Application({
        view: cv,
        width: FIELD.W, height: FIELD.H,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: false,
        preserveDrawingBuffer: true,
      });
      _bg = new PIXI.Container();
      _app.stage.addChild(_bg);
      _attachedTo = cv;
      // Mark the wrap so CSS knows to make #field transparent.
      const wrap = cv.parentElement;
      if (wrap) wrap.classList.add("uses-pixi-field");
      return true;
    } catch (e) {
      console.warn("PIXI field init failed, falling back to canvas2D:", e);
      _app = null;
      return false;
    }
  }

  // Renders the static field background. Called once per game (or on team
  // change). Subsequent calls with the same team key are no-ops.
  function renderStatic(homeTeam, awayTeam) {
    if (!ensure()) return false;
    const key = `${homeTeam?.id || "?"}|${awayTeam?.id || "?"}`;
    if (key === _lastRenderKey) {
      _app.renderer.render(_app.stage);
      return true;
    }
    _lastRenderKey = key;
    // Clear prior render.
    _bg.removeChildren();
    // ── Base grass — full-canvas fill (matches canvas2D #1c5e2f) ──
    const grass = new PIXI.Graphics();
    grass.beginFill(0x1c5e2f, 1);
    grass.drawRect(0, 0, FIELD.W, FIELD.H);
    grass.endFill();
    _bg.addChild(grass);
    // ── Mowing band stripes ──
    // Alternating darker/lighter greens every 10 yards. Colors match the
    // canvas2D drawField exactly (#2b7a40 / #1d6232) so the PIXI hand-off
    // is visually indistinguishable.
    const bandG = new PIXI.Graphics();
    for (let i = 0; i < 10; i++) {
      const col = i % 2 === 0 ? 0x2b7a40 : 0x1d6232;
      const x = FIELD.EZ_PX + i * 10 * FIELD.PX_PER_YARD;
      bandG.beginFill(col, 1);
      bandG.drawRect(x, FIELD.TOP, 10 * FIELD.PX_PER_YARD, FIELD.BOT - FIELD.TOP);
      bandG.endFill();
    }
    _bg.addChild(bandG);
    _app.renderer.render(_app.stage);
    return true;
  }

  // Public-ish — drawField calls this each frame; we no-op if the cached
  // key matches, and only re-render when teams change.
  function draw(homeTeam, awayTeam) {
    return renderStatic(homeTeam, awayTeam);
  }

  // Returns true when the PIXI field can render — drawField uses this to
  // skip elements already ported to PIXI. Triggers lazy ensure() so the
  // first frame doesn't fall through to canvas2D.
  function active() {
    if (!_pixiAvailable() || !window._useFieldPixi) return false;
    if (!_app) ensure();
    return !!_app;
  }

  return { ensure, draw, active };
})();
