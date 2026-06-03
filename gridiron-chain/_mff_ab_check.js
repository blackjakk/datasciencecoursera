// MFF A/B safety gate — proves the per-snap attribution layer is calibration-
// neutral. For each game it runs the engine TWICE from the SAME seeded RNG
// stream — once with _MFF_ATTR off, once on — and asserts the resulting box
// score (`sim.stats`) is byte-identical after stripping the new MFF-only keys.
//
// The logic: attribution writes consume NO Math.random() and mutate NO existing
// field. So with an identical seeded Math.random sequence, the two runs must
// walk the RNG stream identically and produce identical aggregates. Any diff
// means attribution illegally consumed randomness or mutated state — a bug.
//
// Dev/audit tool only — ignored by the build.  Run: node _mff_ab_check.js
const fs = require("fs");
const path = require("path");

const files = [
  "play-data.js", "play-player.js", "play-render.js",
  "play-sim.js", "play-motion.js", "play-engine.js",
];
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [audit] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [audit] stripped");
}
const shim = `
  var _stub = new Proxy(function(){}, {
    get(t, k) { if (k === "style" || k === "classList" || k === "dataset") return _stub;
                if (k === "length") return 0;
                if (k === Symbol.iterator) return function*(){};
                return _stub; },
    set() { return true; }, apply() { return _stub; }, construct() { return _stub; },
  });
  var document = {
    createElement: () => _stub, getElementById: () => _stub,
    querySelector: () => _stub, querySelectorAll: () => [],
    addEventListener: () => {}, body: _stub, documentElement: _stub,
  };
  var window = (typeof globalThis !== "undefined" ? globalThis : this);
  window.addEventListener = () => {};
  if (typeof performance === "undefined") var performance = { now: () => Date.now() };
  var requestAnimationFrame = () => 0;
  var localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
`;

const audit = `
;(function runAB() {
  if (typeof TEAMS === "undefined" || typeof GameSimulator === "undefined") {
    console.error("Missing TEAMS or GameSimulator after load"); process.exit(1);
  }
  console.error("Loaded OK — " + TEAMS.length + " teams.");

  // Seedable PRNG (mulberry32). We OVERRIDE Math.random so the engine's global
  // Math.random() calls become deterministic and replayable.
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

  // MFF-only keys to strip before comparing (these legitimately only exist when
  // attribution is ON).
  const MFF_KEYS = new Set(["pressures","pressures_allowed","pass_rush_snaps","pass_pro_snaps","qb_hits",
    "run_block_snaps","run_block_wins","run_block_losses","run_def_snaps","run_stuffs","run_def_losses",
    "cover_tgt","cover_comp","cover_yds"]);
  function mkStrip(extra) { const KILL = new Set([...MFF_KEYS, ...(extra||[])]);
    return function strip(obj) {
      if (Array.isArray(obj)) return obj.map(strip);
      if (obj && typeof obj === "object") { const out = {};
        for (const k of Object.keys(obj)) { if (KILL.has(k)) continue; out[k] = strip(obj[k]); }
        return out; }
      return obj; }; }
  const strip = mkStrip();              // strip MFF-only keys
  const stripTkl = mkStrip(["tkl"]);    // also strip per-player tackle counts
  function sumTkl(stats){ let s=0; for(const side of ["home","away"]){ const p=stats[side].players;
    for(const n in p) s += p[n].tkl||0; } return s; }
  // Count recorded MFF events so we can confirm attribution actually fired.
  function tally(stats) {
    let pr = 0, pa = 0, rs = 0, hits = 0;
    for (const side of ["home","away"]) {
      const pls = stats[side].players;
      for (const n in pls) { const p = pls[n];
        pr += p.pressures||0; pa += p.pressures_allowed||0; rs += p.pass_rush_snaps||0; hits += p.qb_hits||0; }
    }
    return { pressures: pr, pressures_allowed: pa, rush_snaps: rs, qb_hits: hits };
  }

  function clone(roster) { return JSON.parse(JSON.stringify(roster)); }
  function buildRoster(team) { return genRoster(getPlaybook(team), {}, null); }

  // Build a fixed set of game configs (team pairs). Roster gen randomness is
  // irrelevant — we clone the SAME source rosters into both runs.
  const pairs = [];
  for (let i = 0; i + 1 < TEAMS.length && pairs.length < 8; i += 2) pairs.push([TEAMS[i], TEAMS[i+1]]);
  const srcRosters = {};
  for (const t of TEAMS) srcRosters[t.id] = buildRoster(t);

  let attrPass = true, skillPass = true, totalEvents = { pressures:0, rush_snaps:0, qb_hits:0 };
  let tklMoved = 0, tklTotal = 0; let firstDiff = null;
  pairs.forEach(([h, a], gi) => {
    const seed = 1000 + gi * 7919;
    const G = (opts) => { Math.random = mulberry32(seed);
      const s = new GameSimulator(h, a, clone(srcRosters[h.id]), clone(srcRosters[a.id]), opts); s.simulate(); return s; };

    // (A) attribution OFF (baseline) vs ON, both tackle-skill OFF → must be byte-identical.
    const base   = G({ mffAttr:false, mffTackleSkill:false });
    const attrOn = G({ mffAttr:true,  mffTackleSkill:false });
    const sBase = JSON.stringify(strip(base.stats)), sAttr = JSON.stringify(strip(attrOn.stats));
    const okA = sBase === sAttr;

    // (B) tackle-skill OFF vs ON (attribution ON for both) → identical EXCEPT
    //     per-player tkl distribution; tackle TOTAL preserved.
    const skillOn = G({ mffAttr:true, mffTackleSkill:true });
    const sAttrNoTkl  = JSON.stringify(stripTkl(strip(attrOn.stats)));
    const sSkillNoTkl = JSON.stringify(stripTkl(strip(skillOn.stats)));
    const okB_other = sAttrNoTkl === sSkillNoTkl;          // everything but tkl identical
    const okB_total = sumTkl(attrOn.stats) === sumTkl(skillOn.stats); // tkl total preserved
    const okB = okB_other && okB_total;
    // measure how much tackle credit actually moved between players
    for (const side of ["home","away"]) { const pa=attrOn.stats[side].players, ps=skillOn.stats[side].players;
      for (const n in pa) { tklTotal += pa[n].tkl||0; tklMoved += Math.abs((ps[n]?.tkl||0)-(pa[n].tkl||0)); } }

    const ev = tally(skillOn.stats); for (const k in totalEvents) totalEvents[k] += ev[k];
    if (!okA && !firstDiff) { let i=0; while(i<sBase.length&&sBase[i]===sAttr[i])i++;
      firstDiff = {t:"attr", g:(h.abbr||h.id)+" vs "+(a.abbr||a.id), ctx:sBase.slice(Math.max(0,i-70),i+70)+" ||vs|| "+sAttr.slice(Math.max(0,i-70),i+70)}; }
    if (!okB_other && !firstDiff) { let i=0; while(i<sAttrNoTkl.length&&sAttrNoTkl[i]===sSkillNoTkl[i])i++;
      firstDiff = {t:"skill", g:(h.abbr||h.id)+" vs "+(a.abbr||a.id), ctx:sAttrNoTkl.slice(Math.max(0,i-70),i+70)+" ||vs|| "+sSkillNoTkl.slice(Math.max(0,i-70),i+70)}; }
    attrPass = attrPass && okA; skillPass = skillPass && okB;
    console.error("  game " + (gi+1) + " " + (h.abbr||h.id) + " vs " + (a.abbr||a.id) + ":  attr " +
      (okA?"IDENTICAL ✓":"DIVERGED ✗") + "   tackle-skill " + (okB?"tkl-only ✓":(okB_total?"NON-TKL DIFF ✗":"TOTAL CHANGED ✗")));
  });

  console.error("");
  console.error("Attribution fired: "+totalEvents.pressures+" pressures over "+totalEvents.rush_snaps+
    " reps ("+(totalEvents.rush_snaps?(100*totalEvents.pressures/totalEvents.rush_snaps).toFixed(1):0)+"%), "+totalEvents.qb_hits+" QB hits.");
  console.error("Tackle-skill redistributed "+(tklTotal?(100*tklMoved/2/tklTotal).toFixed(1):0)+"% of tackles between players (total preserved).");
  console.error("");
  if (attrPass && skillPass) {
    console.error("RESULT: PASS");
    console.error("  • Attribution: box scores byte-identical on vs off (zero calibration effect).");
    console.error("  • Tackle-skill: only per-player tkl distribution changes; every other stat");
    console.error("    byte-identical and tackle totals preserved → RNG stream intact, no band moves.");
  } else {
    console.error("RESULT: FAIL");
    if (!attrPass) console.error("  • Attribution changed a non-MFF aggregate (consumed RNG / mutated state).");
    if (!skillPass) console.error("  • Tackle-skill changed more than tkl distribution (RNG desync downstream).");
    if (firstDiff) console.error("  first diff ["+firstDiff.t+"] ("+firstDiff.g+"):\\n  "+firstDiff.ctx);
    process.exit(2);
  }
})();
`;

let code = shim + "\n";
for (const f of files) {
  let c = fs.readFileSync(path.join(__dirname, f), "utf8");
  c = stripUiInit(c, f);
  code += "\n//==== " + f + " ====\n" + c + "\n";
}
code += audit;

const vm = require("vm");
vm.runInThisContext(code, { filename: "_mff_ab_bundle.js" });
