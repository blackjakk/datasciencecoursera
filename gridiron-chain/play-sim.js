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
const SIM_DEFAULT_ACCEL     = 18.0 * 15;    // ≈ 270 px/s² — explosive start
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

// Exported globals (this file is loaded as a plain script, not a module).
window.SimPlayer = SimPlayer;
window.simIntercept = simIntercept;
window.simPxToYards = pxToYards;
window.simYardsToPx = yardsToPx;
window.SIM_DEFAULTS = {
  MAX_SPEED: SIM_DEFAULT_MAX_SPEED,
  ACCEL:     SIM_DEFAULT_ACCEL,
  CONTACT_RADIUS: SIM_CONTACT_RADIUS,
};
