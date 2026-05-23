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
    // ── End zones — team-color rectangles flanking the field ──
    const ezG = new PIXI.Graphics();
    const hexColor = (cssCol, fallback) => {
      if (typeof cssCol !== "string") return fallback;
      if (cssCol[0] === "#") {
        if (cssCol.length === 4) {
          return (parseInt(cssCol[1], 16) * 17) << 16 |
                 (parseInt(cssCol[2], 16) * 17) << 8 |
                  parseInt(cssCol[3], 16) * 17;
        }
        return parseInt(cssCol.slice(1), 16);
      }
      return fallback;
    };
    const homeHex = hexColor(homeTeam?.primary, 0x002244);
    const awayHex = hexColor(awayTeam?.primary, 0x880022);
    ezG.beginFill(homeHex, 1);
    ezG.drawRect(0, FIELD.TOP, FIELD.EZ_PX, FIELD.BOT - FIELD.TOP);
    ezG.endFill();
    ezG.beginFill(awayHex, 1);
    ezG.drawRect(FIELD.W - FIELD.EZ_PX, FIELD.TOP, FIELD.EZ_PX, FIELD.BOT - FIELD.TOP);
    ezG.endFill();
    _bg.addChild(ezG);
    // ── End zone team text — rotated 90° to read along the field, scaled
    // to fill the endzone length. PIXI.Text natively supports rotation +
    // independent scale.x/scale.y, and dropShadow gives us the 4px black
    // stroke effect. Matches canvas2D drawField exactly.
    const ezSpan = FIELD.BOT - FIELD.TOP;
    const ezPad  = 8;
    const ezTargetH = FIELD.EZ_PX * 0.78;
    const ezTargetW = ezSpan - ezPad * 2;
    const makeText = (name) => {
      const t = new PIXI.Text(String(name || "").toUpperCase(), {
        fontFamily: "monospace",
        fontWeight: "900",
        fontSize: ezTargetH,
        fill: 0xf0f0f0,                  // ~rgba(255,255,255,0.92)
        stroke: 0x000000,
        strokeThickness: 4,
      });
      t.anchor.set(0.5);
      return t;
    };
    const hText = makeText(homeTeam?.name);
    const hMeasure = hText.width || 1;
    const hScaleX = ezTargetW / hMeasure;
    hText.position.set(FIELD.EZ_PX / 2, (FIELD.TOP + FIELD.BOT) / 2);
    hText.rotation = -Math.PI / 2;
    // scale.x stretches the text along its natural reading direction,
    // which after the 90° rotation is the vertical-on-screen axis.
    hText.scale.set(hScaleX, 1);
    _bg.addChild(hText);
    const aText = makeText(awayTeam?.name);
    const aMeasure = aText.width || 1;
    const aScaleX = ezTargetW / aMeasure;
    aText.position.set(FIELD.W - FIELD.EZ_PX / 2, (FIELD.TOP + FIELD.BOT) / 2);
    aText.rotation = Math.PI / 2;
    aText.scale.set(aScaleX, 1);
    _bg.addChild(aText);
    // ── Sidelines — solid white chalk along TOP + BOT of the field.
    const slG = new PIXI.Graphics();
    slG.lineStyle(2, 0xffffff, 0.85);
    slG.moveTo(0, FIELD.TOP);
    slG.lineTo(FIELD.W, FIELD.TOP);
    slG.moveTo(0, FIELD.BOT);
    slG.lineTo(FIELD.W, FIELD.BOT);
    _bg.addChild(slG);
    // ── Yard lines — every 5 thin, every 10 thick. White at varying alpha.
    const absYardToX = (yd) => FIELD.EZ_PX + yd * FIELD.PX_PER_YARD;
    const ylG = new PIXI.Graphics();
    for (let yd = 0; yd <= 100; yd += 5) {
      const x = absYardToX(yd);
      const isMajor = yd % 10 === 0;
      const alpha = isMajor ? 0.85 : 0.4;
      const width = isMajor ? 1.5 : 1;
      ylG.lineStyle(width, 0xffffff, alpha);
      ylG.moveTo(x, FIELD.TOP);
      ylG.lineTo(x, FIELD.BOT);
    }
    _bg.addChild(ylG);
    // ── Yard numbers — 10, 20, 30, 40, 50, 40, 30, 20, 10 at the top and
    // bottom of the field. White with black stroke, 36px 900 sans.
    const numStyle = {
      fontFamily: "sans-serif",
      fontWeight: "900",
      fontSize: 36,
      fill: 0xfafafa,                    // ~rgba(255,255,255,0.95)
      stroke: 0x000000,
      strokeThickness: 4,
    };
    for (let yd = 10; yd <= 90; yd += 10) {
      const x = absYardToX(yd);
      const num = String(yd <= 50 ? yd : 100 - yd);
      const topT = new PIXI.Text(num, numStyle);
      topT.anchor.set(0.5);
      topT.position.set(x, FIELD.TOP + 52);
      _bg.addChild(topT);
      const botT = new PIXI.Text(num, numStyle);
      botT.anchor.set(0.5);
      botT.position.set(x, FIELD.BOT - 52);
      _bg.addChild(botT);
    }
    // ── Hash marks — small ticks every yard (skip multiples of 5 since
    // those are yard lines). Top + bottom rows + sideline ticks.
    const hashG = new PIXI.Graphics();
    for (let yd = 1; yd <= 99; yd++) {
      if (yd % 5 === 0) continue;
      const x = absYardToX(yd);
      hashG.lineStyle(1, 0xffffff, 0.55);
      hashG.moveTo(x, FIELD.TOP + 75);
      hashG.lineTo(x, FIELD.TOP + 80);
      hashG.moveTo(x, FIELD.BOT - 80);
      hashG.lineTo(x, FIELD.BOT - 75);
      hashG.moveTo(x, FIELD.TOP);
      hashG.lineTo(x, FIELD.TOP + 6);
      hashG.moveTo(x, FIELD.BOT);
      hashG.lineTo(x, FIELD.BOT - 6);
    }
    _bg.addChild(hashG);
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
