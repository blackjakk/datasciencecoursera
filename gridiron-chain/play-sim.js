// ─── Player physics simulation primitives ───────────────────────────────
//
// Used by play-animation.js to replace the per-defender tween model with
// actual physics. Each SimPlayer has position, velocity, max speed, and
// acceleration. Defenders pursue a moving carrier by computing INTERCEPT
// points (where the carrier WILL be when the defender can reach them)
// rather than chasing the carrier's current spot — produces realistic
// angles where a defender cuts across the field rather than chasing in
// a straight line.
//
// Engine outcomes (yards, named tackler) still drive the play; the sim
// is the visual layer that makes those outcomes look like real football.

// All constants in PIXELS (matches FIELD coords). 1 yard = 15 px.
const SIM_DEFAULT_MAX_SPEED = 9.5 * 15;     // ≈ 142 px/s — top NFL DB speed
// Lower default accel so the spool-up from rest is VISIBLE in the
// animation (was 18 yd/s² which hit top speed in 0.53s — looked nearly
// instant). 10 yd/s² hits top in ~1s — clear "build-up" motion.
const SIM_DEFAULT_ACCEL     = 10.0 * 15;    // ≈ 150 px/s²
const SIM_CONTACT_RADIUS    = 12;           // ≈ 0.8 yd — circle radius for collision

function _len(x, y) { return Math.sqrt(x * x + y * y); }

class SimPlayer {
  constructor(x, y, opts = {}) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.maxSpeed = opts.maxSpeed != null ? opts.maxSpeed : SIM_DEFAULT_MAX_SPEED;
    this.accel    = opts.accel    != null ? opts.accel    : SIM_DEFAULT_ACCEL;
    this.radius   = opts.radius   != null ? opts.radius   : SIM_CONTACT_RADIUS;
    this._lastMs  = null;
  }

  // Accelerate toward (tx, ty) and integrate by dt seconds. Cap velocity
  // at maxSpeed. dt is in SECONDS, not ms.
  stepToward(tx, ty, dt) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = _len(dx, dy);
    if (d > 0.001) {
      // Apply acceleration along the direction to target
      this.vx += (dx / d) * this.accel * dt;
      this.vy += (dy / d) * this.accel * dt;
    }
    // Cap speed
    const speed = _len(this.vx, this.vy);
    if (speed > this.maxSpeed) {
      this.vx = (this.vx / speed) * this.maxSpeed;
      this.vy = (this.vy / speed) * this.maxSpeed;
    }
    // Integrate position
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  // Step using a wall-clock timestamp (ms). Returns the dt actually
  // integrated so callers can detect skipped frames.
  stepTowardAt(tx, ty, nowMs) {
    if (this._lastMs == null) { this._lastMs = nowMs; return 0; }
    const dt = Math.min(0.05, Math.max(0, (nowMs - this._lastMs) / 1000));
    this._lastMs = nowMs;
    if (dt > 0) this.stepToward(tx, ty, dt);
    return dt;
  }

  // Distance to another SimPlayer (or {x,y} point) in yards.
  distanceTo(other) {
    return _len(other.x - this.x, other.y - this.y);
  }

  // Circle-vs-circle collision check. Returns true if our radii overlap.
  collides(other) {
    const r = (this.radius + (other.radius || SIM_CONTACT_RADIUS));
    return this.distanceTo(other) < r;
  }
}

// Compute the intercept point — where the defender should AIM to catch
// the carrier given the carrier's current velocity. Uses an iterative
// solution since the closed-form is gnarly. ~3 iterations converges.
//
// carrier: { x, y, vx, vy } — units in yards / yards-per-second
// defender: SimPlayer
// Returns: { x, y, t } — the intercept point and time-to-intercept.
//   If no intercept is possible (carrier outruns defender), returns the
//   carrier's CURRENT position with t = Infinity, so the defender just
//   chases directly (best-effort).
function simIntercept(defender, carrier) {
  const cs = _len(carrier.vx || 0, carrier.vy || 0);
  // No intercept needed if carrier is stationary
  if (cs < 0.1) return { x: carrier.x, y: carrier.y, t: 0 };
  // Carrier outruns defender — chase the current spot
  if (cs >= defender.maxSpeed) return { x: carrier.x, y: carrier.y, t: Infinity };
  // Iterative solve — start with time-to-current-position, then update
  let t = defender.distanceTo(carrier) / defender.maxSpeed;
  for (let i = 0; i < 4; i++) {
    const tx = carrier.x + (carrier.vx || 0) * t;
    const ty = carrier.y + (carrier.vy || 0) * t;
    const d = _len(tx - defender.x, ty - defender.y);
    const newT = d / defender.maxSpeed;
    if (Math.abs(newT - t) < 0.02) { t = newT; break; }
    t = newT;
  }
  return {
    x: carrier.x + (carrier.vx || 0) * t,
    y: carrier.y + (carrier.vy || 0) * t,
    t,
  };
}

// Convert pixel positions to yard-space and back. The sim works in
// yards so physics constants are intuitive (NFL speeds are quoted in
// yards/sec). Pixel coords come from FIELD.PX_PER_YARD.
function pxToYards(px, pxPerYard) { return px / pxPerYard; }
function yardsToPx(yd, pxPerYard) { return yd * pxPerYard; }

// ─── Trench engagement primitives ──────────────────────────────────────
//
// Phase-1 first-principles rebuild of OL/DL line play. The trench is no
// longer scripted (OL drop with a wobble, DL "barely move"). Each pair
// of contacting bodies becomes one Engagement: blocker + defender locked
// to a moving anchor, with a leverage scalar that drifts the anchor
// along the defender's attack axis. The pocket on pass plays emerges
// from the centroid of held anchors — it isn't a fixed spot.
//
// IMPORTANT: Engagement owns ITS OWN copy of each body's x/y. Caller
// reads engagement.blockerX/Y and .defenderX/Y to drive rendering.
// This avoids mutating formation-shared player objects.
class Engagement {
  // blockerKey/defenderKey are opaque identity tokens — typically the
  // formation player reference. The Engagement only uses them for
  // lookup (engagementFor); positions are stored on the Engagement.
  //
  // opts:
  //   axisX, axisY: unit vector — defender's attack direction
  //                 (+x toward QB on a pass play if dir=+1 offense)
  //   leverage:    -1..+1 — negative = defender winning (drifts anchor
  //                along +axis); +ve = blocker winning. 0 = stalemate.
  //   startBX/Y, startDX/Y: initial positions (typically formation home
  //                of each)
  //   offsetPx:    half the lockup depth — blocker sits at anchor-offset
  //                in -axis, defender at anchor+offset in +axis
  //   driftPx:     px/frame the anchor moves at full |leverage|
  //   pull:        EMA strength toward target positions
  //   wobble:      small lateral jitter so engagement reads alive
  constructor(blockerKey, defenderKey, opts = {}) {
    this.blockerKey = blockerKey;
    this.defenderKey = defenderKey;
    this.axisX = opts.axisX != null ? opts.axisX : -1;
    this.axisY = opts.axisY != null ? opts.axisY :  0;
    this.leverage = opts.leverage || 0;
    this.shed = false;
    this.startMs = null;
    this.offsetPx = opts.offsetPx != null ? opts.offsetPx : 7;
    this.driftPx  = opts.driftPx  != null ? opts.driftPx  : 0.5;
    this.pull     = opts.pull     != null ? opts.pull     : 0.28;
    this.wobble   = opts.wobble   != null ? opts.wobble   : 1.2;
    this.wobblePhase = Math.random() * Math.PI * 2;
    // Position state. The anchor begins at the CONTACT POINT just in
    // front of the blocker (on the defense side) — not the raw midpoint
    // of the two pre-snap spots, which sits ~2.5yd downfield because the
    // DL aligns off the ball. Anchoring at the blocker keeps the OL at
    // the LOS and pulls the DL DOWN into the line (reads as the rush
    // meeting the block) rather than both drifting to no-man's-land.
    this.blockerX = opts.startBX;
    this.blockerY = opts.startBY;
    this.defenderX = opts.startDX;
    this.defenderY = opts.startDY;
    // −axis = defense side of the blocker. anchor = blocker − axis*offset
    // makes blocker's own target resolve back to its start; defender is
    // pulled to blocker + 2*offset on the defense side.
    this.anchorX = this.blockerX - this.axisX * this.offsetPx;
    this.anchorY = this.blockerY * 0.7 + this.defenderY * 0.3;
  }

  step(nowMs) {
    if (this.shed) return;
    if (this.startMs == null) this.startMs = nowMs;
    const elapsed = nowMs - this.startMs;
    // Anchor drift along defender's attack axis. -leverage → +axis (def wins).
    this.anchorX += this.axisX * this.driftPx * -this.leverage;
    this.anchorY += this.axisY * this.driftPx * -this.leverage;
    // Wobble — perpendicular jitter so locked bodies don't read frozen.
    const w = Math.sin((elapsed / 220) + this.wobblePhase) * this.wobble;
    const perpX = -this.axisY;
    const perpY =  this.axisX;
    // axis points in the DEFENDER's attack direction (toward the QB /
    // offense side). So +axis from the anchor is the OFFENSE side
    // (where the blocker belongs) and −axis is the DEFENSE side (where
    // the defender belongs). Getting these backwards put the DL behind
    // the OL — the "D-line past the O-line" bug.
    const bTx = this.anchorX + this.axisX * this.offsetPx + perpX * w;
    const bTy = this.anchorY + this.axisY * this.offsetPx + perpY * w;
    const dTx = this.anchorX - this.axisX * this.offsetPx + perpX * w * -0.6;
    const dTy = this.anchorY - this.axisY * this.offsetPx + perpY * w * -0.6;
    // EMA pull each body toward its target.
    this.blockerX += (bTx - this.blockerX) * this.pull;
    this.blockerY += (bTy - this.blockerY) * this.pull;
    this.defenderX += (dTx - this.defenderX) * this.pull;
    this.defenderY += (dTy - this.defenderY) * this.pull;
  }

  releaseShed() { this.shed = true; }
}

// PassProSim — owner of the pass-protection engagement set + pocket calc.
//
// One per pass play. Construct after formation is built, add OL↔DL pairs,
// step each render frame, query for positions and pocket center.
class PassProSim {
  constructor(opts = {}) {
    this.engagements = [];
    this.dir = opts.dir || 1;          // offense direction (+1 = +X)
    this.losX = opts.losX || 0;
  }

  // Add a blocker↔defender engagement. Defender attacks toward -dir
  // (toward QB by default).
  addPair(blocker, defender, opts = {}) {
    const eng = new Engagement(blocker, defender, {
      axisX: -this.dir,
      axisY: 0,
      startBX: blocker.x, startBY: blocker.y,
      startDX: defender.x, startDY: defender.y,
      leverage: opts.leverage || 0,
      offsetPx: opts.offsetPx,
      driftPx:  opts.driftPx,
      pull:     opts.pull,
      wobble:   opts.wobble,
    });
    this.engagements.push(eng);
    return eng;
  }

  step(nowMs) {
    for (const e of this.engagements) e.step(nowMs);
  }

  // Engagement that holds this player as blocker or defender, or null.
  engagementFor(player) {
    for (const e of this.engagements) {
      if (e.blockerKey === player || e.defenderKey === player) return e;
    }
    return null;
  }

  // Pocket centroid — average of held-block ANCHORS, shifted ~1 yd behind
  // (on the QB side of the LOS). Excludes shed engagements. Returns null
  // when nothing's holding (rare but possible if every DL sheds).
  pocketCenter(pxPerYard) {
    const yd = pxPerYard || 15;
    let sx = 0, sy = 0, n = 0;
    for (const e of this.engagements) {
      if (e.shed) continue;
      sx += e.blockerX - this.dir * yd;   // ~1yd behind blocker
      sy += e.blockerY;
      n++;
    }
    return n === 0 ? null : { x: sx / n, y: sy / n };
  }
}

// Exported globals (this file is loaded as a plain script, not a module).
window.SimPlayer = SimPlayer;
window.simIntercept = simIntercept;
window.Engagement = Engagement;
window.PassProSim = PassProSim;
window.simPxToYards = pxToYards;
window.simYardsToPx = yardsToPx;
window.SIM_DEFAULTS = {
  MAX_SPEED: SIM_DEFAULT_MAX_SPEED,
  ACCEL:     SIM_DEFAULT_ACCEL,
  CONTACT_RADIUS: SIM_CONTACT_RADIUS,
};
