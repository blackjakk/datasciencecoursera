// Headless audit harness — runs the engine in node (NO browser) to compute
// real NFL-realism benchmarks over many games. Concatenates the DOM-free
// script files + the audit code into ONE script so top-level const/class
// declarations share lexical scope (they don't attach to a VM global).
// Dev/audit tool only — ignored by the build.
const fs = require("fs");
const path = require("path");

const files = [
  "play-data.js",     // TEAMS, PERSONNEL, DEF_PACKAGE, pickReceiver, getPlaybook, PLAYBOOKS
  "play-player.js",   // genRoster, genUniquePlayer, player gen + stat helpers
  "play-render.js",   // pickBodyType, CELEB_STYLES, gen helpers (UI-init lines stripped below)
  "play-sim.js",      // SimPlayer, simIntercept, Engagement, PassProSim, RunBlockSim
  "play-motion.js",   // MotionPlayback
  "play-engine.js",   // GameSimulator
];
const extraConsts = "";
// play-render.js runs 4 UI-init calls at load that touch real DOM elements
// (the team dropdowns + preview). Strip those specific top-level lines — the
// gen helpers + constants we need are all plain declarations above them.
function stripUiInit(code, file) {
  if (file !== "play-render.js") return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [audit] stripped")
             .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [audit] stripped");
}

// Minimal browser shims. play-render.js runs some UI-init at load time, so DOM
// getters return a BENIGN chainable stub (not null) — every property is a
// no-op so top-level setup can't throw. The sim path never reads back from it.
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

const SEASONS = Number(process.argv[2] || 100);

const audit = `
;(function runAudit() {
  if (typeof TEAMS === "undefined" || typeof GameSimulator === "undefined") {
    console.error("Missing TEAMS or GameSimulator after load");
    process.exit(1);
  }
  console.error("Loaded OK — " + TEAMS.length + " teams, GameSimulator ready.");
  const SEASONS = ${SEASONS};
  function buildRoster(team) { return genRoster(getPlaybook(team), {}, null); }

  const lb = { totalYds:0, passYds:0, rushYds:0, sacks:0, sacks_allowed:0,
    turnovers:0, takeaways:0, firstDowns:0, pass_comp:0, pass_att:0, rush_att:0,
    penalties:0, penaltyYds:0, intThrown:0, ptsSum:0, teamGames:0, games:0 };

  const t0 = Date.now();
  for (let s = 0; s < SEASONS; s++) {
    const rosters = {};
    for (const t of TEAMS) rosters[t.id] = buildRoster(t);
    for (let i = 0; i < TEAMS.length; i++) {
      for (let j = i + 1; j < TEAMS.length; j++) {
        const h = TEAMS[i], a = TEAMS[j];
        const sim = new GameSimulator(h, a, rosters[h.id], rosters[a.id]);
        const r = sim.simulate();
        lb.games++; lb.ptsSum += (r.homeScore + r.awayScore);
        for (const side of ["home","away"]) {
          const tm = r.stats[side].team;
          lb.totalYds += tm.totalYds; lb.passYds += tm.passYds; lb.rushYds += tm.rushYds;
          lb.sacks += tm.sacks; lb.sacks_allowed += tm.sacks_allowed;
          lb.turnovers += tm.turnovers; lb.takeaways += tm.takeaways;
          lb.firstDowns += tm.firstDowns;
          lb.pass_comp += tm.pass_comp; lb.pass_att += tm.pass_att; lb.rush_att += tm.rush_att;
          lb.penalties += (tm.penalties||0); lb.penaltyYds += (tm.penaltyYds||0);
          for (const p of Object.values(r.stats[side].players)) lb.intThrown += (p.pass_int||0);
          lb.teamGames++;
        }
      }
    }
    if ((s+1) % 5 === 0) console.error("  ..."+(s+1)+"/"+SEASONS+" seasons ("+lb.games+" games, "+((Date.now()-t0)/1000).toFixed(0)+"s)");
  }

  const tg = lb.teamGames;
  const g = {
    pts: lb.ptsSum / lb.games / 2,
    totalYds: lb.totalYds/tg, passYds: lb.passYds/tg, rushYds: lb.rushYds/tg,
    firstDowns: lb.firstDowns/tg, sacks: lb.sacks/tg, turnovers: lb.turnovers/tg,
    penalties: lb.penalties/tg, penaltyYds: lb.penaltyYds/tg,
    compPct: lb.pass_att ? lb.pass_comp/lb.pass_att*100 : 0,
    ypc: lb.rush_att ? lb.rushYds/lb.rush_att : 0,
    intRate: lb.pass_att ? lb.intThrown/lb.pass_att*100 : 0,
  };
  const B = [
    ["Points / game", g.pts, 17, 27, v=>v.toFixed(1)],
    ["Total yds / game", g.totalYds, 290, 380, v=>v.toFixed(0)],
    ["Pass yds / game", g.passYds, 190, 270, v=>v.toFixed(0)],
    ["Rush yds / game", g.rushYds, 90, 145, v=>v.toFixed(0)],
    ["Completion %", g.compPct, 58, 69, v=>v.toFixed(1)+"%"],
    ["Yards / carry", g.ypc, 3.9, 4.9, v=>v.toFixed(2)],
    ["INT rate / att", g.intRate, 1.8, 3.4, v=>v.toFixed(2)+"%"],
    ["Sacks / game", g.sacks, 1.6, 3.3, v=>v.toFixed(2)],
    ["Turnovers / game", g.turnovers, 0.9, 2.1, v=>v.toFixed(2)],
    ["First downs / game", g.firstDowns, 16, 24, v=>v.toFixed(1)],
    ["Penalties / game", g.penalties, 4, 8, v=>v.toFixed(2)],
    ["Penalty yds / game", g.penaltyYds, 35, 70, v=>v.toFixed(0)],
  ];
  let nOk = 0;
  console.log("\\n══════════════════════════════════════════════════════════");
  console.log(" NFL REALISM AUDIT — "+SEASONS+" seasons · "+lb.games.toLocaleString()+" games · "+lb.teamGames.toLocaleString()+" team-games");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" "+"METRIC".padEnd(22)+" "+"SIM".padStart(9)+"   "+"NFL BAND".padStart(13)+"  FLAG");
  console.log(" "+"-".repeat(54));
  for (const [label,val,lo,hi,fmt] of B) {
    const ok = val>=lo && val<=hi; if (ok) nOk++;
    const band = fmt(lo).replace("%","")+"-"+fmt(hi);
    console.log(" "+label.padEnd(22)+" "+fmt(val).padStart(9)+"   "+band.padStart(13)+"   "+(ok?"OK":"!!"));
  }
  console.log(" "+"-".repeat(54));
  console.log(" "+nOk+"/"+B.length+" in range\\n");
})();
`;

let bundle = shim + extraConsts;
for (const f of files) bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
bundle += audit;

// Run as one script in this process's scope (Function avoids strict-mode
// const/let leakage issues; sloppy-mode top-level decls stay function-local).
new Function(bundle)();
