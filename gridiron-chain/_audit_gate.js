// _audit_gate.js — realism regression gate (companion to _teleport_gate.sh).
//
// Runs the SEEDED realism audits and fails if a tracked aggregate metric drifts
// from its committed baseline by more than its tolerance. Because the audits are
// seeded (default 1337), the numbers are reproducible, so any drift is
// attributable to an engine/talent code change rather than sampling noise —
// which is the whole reason this can be a gate at all (the unseeded audits
// swung several points run-to-run on identical code).
//
//   Usage:  node _audit_gate.js
//   Exit :  0 = all metrics within tolerance   1 = drift (regression)   2 = harness error
//
// Re-baseline after an INTENTIONAL realism change: run this, confirm the new
// numbers are what you meant, and update the matching "value" in
// _audit_baseline.json in the same commit (same protocol as the teleport gate).
//
// NOTE on scope: this gates AGGREGATE metrics (league rates) — stable when
// seeded and externally meaningful (NFL bands). It deliberately does NOT gate
// the per-player leaderboards: those are small-sample noise even seeded, so
// raise the season count for those, don't gate them.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, "_audit_baseline.json"), "utf8"));
const SEED = BASE.seed != null ? BASE.seed : 1337;

// Group metrics by the (audit, args) command so each audit runs ONCE.
const groups = new Map();
for (const m of BASE.metrics) {
  const key = m.audit + " " + (m.args || []).join(" ");
  if (!groups.has(key)) groups.set(key, { audit: m.audit, args: m.args || [], metrics: [] });
  groups.get(key).metrics.push(m);
}

let fails = 0, warns = 0;
const rows = [];
for (const [key, g] of groups) {
  process.stderr.write(`▶ ${g.audit} ${g.args.join(" ")} (seed=${SEED}) ...\n`);
  let out;
  try {
    out = execFileSync("node", [g.audit, ...g.args, String(SEED)], {
      cwd: __dirname, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000,
    });
  } catch (e) {
    console.error(`✗ ${g.audit} failed to run: ${(e.message || e).slice(0, 200)}`);
    process.exit(2);
  }
  for (const m of g.metrics) {
    const mm = out.match(new RegExp(m.pattern));
    if (!mm) { console.error(`✗ could not parse "${m.label}" via /${m.pattern}/`); process.exit(2); }
    const cur = parseFloat(mm[1]);
    const drift = +(cur - m.value).toFixed(2);
    const overTol = Math.abs(drift) > m.tol;
    const outNfl = m.nfl && (cur < m.nfl[0] || cur > m.nfl[1]);
    if (overTol) fails++;
    if (outNfl) warns++;
    rows.push({ label: m.label, cur, base: m.value, tol: m.tol, drift, overTol, nfl: m.nfl, outNfl });
  }
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log("");
console.log("──────────────────────────────────────────────────────────────────────");
console.log(` AUDIT REGRESSION GATE — seed=${SEED}`);
console.log("──────────────────────────────────────────────────────────────────────");
console.log(`  ${pad("metric", 26)} ${padL("current", 8)} ${padL("baseline", 9)} ${padL("drift", 7)} ${padL("tol", 5)}  verdict`);
for (const r of rows) {
  const v = r.overTol ? "✗ DRIFT" : "✓";
  const nflFlag = r.outNfl ? `  ⚠ outside NFL band [${r.nfl[0]},${r.nfl[1]}]` : "";
  console.log(`  ${pad(r.label, 26)} ${padL(r.cur, 8)} ${padL(r.base, 9)} ${padL((r.drift >= 0 ? "+" : "") + r.drift, 7)} ${padL("±" + r.tol, 5)}  ${v}${nflFlag}`);
}
console.log("");
if (warns) console.log(` ⚠ ${warns} metric(s) outside their NFL realism band (informational — not a gate failure).`);
if (fails) {
  console.log(`✗ AUDIT REGRESSION — ${fails} metric(s) drifted beyond tolerance.`);
  console.log(`  If intentional, update the matching "value" in _audit_baseline.json in the same commit.`);
  process.exit(1);
}
console.log(`✓ audit gate PASS — all ${rows.length} metrics within tolerance.`);
process.exit(0);
