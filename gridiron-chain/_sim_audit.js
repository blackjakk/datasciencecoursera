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
    penalties:0, penaltyYds:0, intThrown:0, ptsSum:0, teamGames:0, games:0,
    // ── Tier 1: drive-level (yds/drive = totalYds/drives; 3-and-out needs
    // per-drive play grouping the engine doesn't expose, so omitted) ──
    drives:0, driveTDs:0, driveFGs:0, driveTOs:0, driveOther:0, drivePts:0,
    thirdAtt:0, thirdConv:0, fourthAtt:0, fourthConv:0, rzAtt:0, rzTD:0,
    // ── Tier 2: kicking / ST / situational ──
    fgMade:0, fgAtt:0, xpMade:0, xpAtt:0, puntAtt:0, puntYds:0,
    fg0_39_m:0, fg0_39_a:0, fg40_49_m:0, fg40_49_a:0, fg50_m:0, fg50_a:0,
    otGames:0 };
  // Per-team-game arrays for distribution stats (median/quantiles/extremes).
  // Means alone can mask shape bugs — a clamp truncating tails would never
  // show in the average but jumps out in P90/max.
  const tg_pts=[], tg_totalYds=[], tg_passYds=[], tg_rushYds=[], tg_firstDowns=[],
        tg_sacks=[], tg_turnovers=[], tg_penalties=[], tg_penaltyYds=[],
        tg_intThrown=[], tg_passAtt=[], tg_passComp=[], tg_rushAtt=[];
  // Per-GAME (not per-team-game) — margin is one value per matchup.
  const game_margin=[];

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
        game_margin.push(Math.abs(r.homeScore - r.awayScore));
        for (const side of ["home","away"]) {
          const tm = r.stats[side].team;
          const pts = side==="home" ? r.homeScore : r.awayScore;
          let teamInt = 0;
          for (const p of Object.values(r.stats[side].players)) teamInt += (p.pass_int||0);
          // Sums (for means + rate denominators)
          lb.totalYds += tm.totalYds; lb.passYds += tm.passYds; lb.rushYds += tm.rushYds;
          lb.sacks += tm.sacks; lb.sacks_allowed += tm.sacks_allowed;
          lb.turnovers += tm.turnovers; lb.takeaways += tm.takeaways;
          lb.firstDowns += tm.firstDowns;
          lb.pass_comp += tm.pass_comp; lb.pass_att += tm.pass_att; lb.rush_att += tm.rush_att;
          lb.penalties += (tm.penalties||0); lb.penaltyYds += (tm.penaltyYds||0);
          lb.intThrown += teamInt;
          // Situational (team stats)
          lb.thirdAtt += (tm.thirdAtt||0); lb.thirdConv += (tm.thirdConv||0);
          lb.fourthAtt += (tm.fourthAtt||0); lb.fourthConv += (tm.fourthConv||0);
          lb.rzAtt += (tm.rz_att||0); lb.rzTD += (tm.rz_td||0);
          // Kicking / ST (player lines)
          for (const p of Object.values(r.stats[side].players)) {
            lb.fgMade += (p.fg_made||0); lb.fgAtt += (p.fg_att||0);
            lb.xpMade += (p.xp_made||0); lb.xpAtt += (p.xp_att||0);
            lb.puntAtt += (p.punt_att||0); lb.puntYds += (p.punt_yds||0);
          }
          lb.teamGames++;
          // Per-team-game arrays (for quantiles + event rates)
          tg_pts.push(pts);
          tg_totalYds.push(tm.totalYds); tg_passYds.push(tm.passYds); tg_rushYds.push(tm.rushYds);
          tg_firstDowns.push(tm.firstDowns); tg_sacks.push(tm.sacks);
          tg_turnovers.push(tm.turnovers); tg_penalties.push(tm.penalties||0);
          tg_penaltyYds.push(tm.penaltyYds||0); tg_intThrown.push(teamInt);
          tg_passAtt.push(tm.pass_att); tg_passComp.push(tm.pass_comp); tg_rushAtt.push(tm.rush_att);
        }
        // ── Drive-level (game-level, both teams) ──
        // Drives carry running homeScore/awayScore; the delta vs the prior
        // drive tells us this drive's points + outcome (FG vs TD vs none).
        // "FG/Punt/TO" is lumped by the engine, so we re-derive: +3 → FG,
        // +6/7/8 → TD, 0 → punt-or-TO (we don't separate those two here).
        const drv = r.full?.drives || r.drives || [];
        let prevH = 0, prevA = 0;
        for (const d of drv) {
          lb.drives++;
          const dH = (d.homeScore||0) - prevH, dA = (d.awayScore||0) - prevA;
          prevH = d.homeScore||0; prevA = d.awayScore||0;
          const off = d.team;  // "home"/"away" — points scored BY this drive's offense
          const ptsThis = off === "home" ? dH : dA;
          const oppPts  = off === "home" ? dA : dH;  // def/return TD against
          lb.drivePts += Math.max(0, ptsThis);
          if (d.result === "TD") lb.driveTDs++;
          else if (ptsThis === 3) lb.driveFGs++;
          else if (d.result === "TURNOVER_ON_DOWNS" || oppPts > 0) lb.driveTOs++;
          else lb.driveOther++;  // punt or non-scoring TO (lumped by engine)
        }
        // 3-and-outs + OT from the play log
        const plays = r.full?.plays || r.plays || [];
        if (plays.some(p => p.qtr === 5 || p.quarter === 5 || /\bOT\b|overtime/i.test(p.desc||""))) lb.otGames++;
        // FG by distance from play log
        for (const p of plays) {
          if (p.kind === "fg_good" || p.kind === "fg_miss" || p.kind === "fg_blocked") {
            const dist = p.fgDist || 0, made = p.kind === "fg_good";
            if (dist < 40)      { lb.fg0_39_a++; if (made) lb.fg0_39_m++; }
            else if (dist < 50) { lb.fg40_49_a++; if (made) lb.fg40_49_m++; }
            else                { lb.fg50_a++; if (made) lb.fg50_m++; }
          }
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
    // Efficiency / pace — total plays = pass attempts + rush attempts (sacks
    // count as pass plays via pass_att in NFL accounting and our engine).
    // ptsSum is per-game-both-teams, so divide by 2 for per-team.
    playsPerGame: tg ? (lb.pass_att + lb.rush_att) / tg : 0,
    ypp: (lb.pass_att + lb.rush_att) ? lb.totalYds / (lb.pass_att + lb.rush_att) : 0,
    ppp: (lb.pass_att + lb.rush_att) ? (lb.ptsSum / 2) / (lb.pass_att + lb.rush_att) : 0,
    ypComp: lb.pass_comp ? lb.passYds / lb.pass_comp : 0,
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
    // Efficiency block — NFL refs: plays/game ~63, ypp ~5.4, ppp ~0.36, yds/comp ~11
    ["Plays / game", g.playsPerGame, 58, 68, v=>v.toFixed(1)],
    ["Yards / play", g.ypp, 5.0, 6.0, v=>v.toFixed(2)],
    ["Points / play", g.ppp, 0.30, 0.42, v=>v.toFixed(3)],
    ["Yards / completion", g.ypComp, 10.0, 12.5, v=>v.toFixed(1)],
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
  console.log(" "+nOk+"/"+B.length+" in range");

  // ============== DISTRIBUTION TABLE — P10/P50/P90 + min/max ==============
  // Quantile picks the lower-of-two index (no interpolation) — fine at this
  // sample size and avoids float fuzz when comparing to NFL reference points.
  function q(arr, p) {
    if (!arr.length) return 0;
    const sorted = arr.slice().sort((a,b)=>a-b);
    return sorted[Math.min(sorted.length-1, Math.floor(p * sorted.length))];
  }
  function mn(arr) { return arr.length ? Math.min(...arr) : 0; }
  function mx(arr) { return arr.length ? Math.max(...arr) : 0; }
  function std(arr, mean) {
    if (arr.length < 2) return 0;
    let s = 0; for (const v of arr) s += (v - mean)*(v - mean);
    return Math.sqrt(s / (arr.length - 1));
  }
  // NFL reference: P10 / P50 / P90 per team-game from recent seasons.
  // Sources: NFL.com 2018-2023 team game logs aggregated; rough but useful.
  const D = [
    // [label, arr, mean, fmt, nflP10, nflP50, nflP90]
    ["Points",       tg_pts,        g.pts,        v=>v.toFixed(0),  10,  22,  37],
    ["Total yds",    tg_totalYds,   g.totalYds,   v=>v.toFixed(0), 250, 345, 450],
    ["Pass yds",     tg_passYds,    g.passYds,    v=>v.toFixed(0), 140, 235, 340],
    ["Rush yds",     tg_rushYds,    g.rushYds,    v=>v.toFixed(0),  55, 115, 190],
    ["First downs",  tg_firstDowns, g.firstDowns, v=>v.toFixed(0),  12,  20,  28],
    ["Sacks",        tg_sacks,      g.sacks,      v=>v.toFixed(0),   0,   2,   5],
    ["Turnovers",    tg_turnovers,  g.turnovers,  v=>v.toFixed(0),   0,   1,   3],
    ["Penalties",    tg_penalties,  g.penalties,  v=>v.toFixed(0),   2,   6,  10],
    ["Penalty yds",  tg_penaltyYds, g.penaltyYds, v=>v.toFixed(0),  15,  50,  90],
  ];
  console.log("\\n══════════════════════════════════════════════════════════");
  console.log(" DISTRIBUTION — sim P10 / median / P90 vs NFL reference");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" "+"METRIC".padEnd(13)+"  "+"P10".padStart(4)+"  "+"P50".padStart(4)+"  "+"P90".padStart(4)+"  "+"min/max".padStart(9)+"  "+"std".padStart(4)+"   "+"NFL P10/P50/P90");
  console.log(" "+"-".repeat(70));
  for (const [label, arr, mean, fmt, n10, n50, n90] of D) {
    const sP10 = q(arr,0.10), sP50 = q(arr,0.50), sP90 = q(arr,0.90);
    const sd = std(arr, mean);
    const mm = fmt(mn(arr))+"/"+fmt(mx(arr));
    const nflRef = n10+"/"+n50+"/"+n90;
    console.log(" "+label.padEnd(13)+"  "+fmt(sP10).padStart(4)+"  "+fmt(sP50).padStart(4)+"  "+fmt(sP90).padStart(4)+"  "+mm.padStart(9)+"  "+sd.toFixed(0).padStart(4)+"   "+nflRef);
  }

  // ============== EVENT RATES — shape sanity checks ==============
  const shutoutPct  = tg_pts.filter(v=>v===0).length / tg_pts.length * 100;
  const big40Pct    = tg_pts.filter(v=>v>=40).length / tg_pts.length * 100;
  const margin14Pct = game_margin.filter(v=>v>=14).length / game_margin.length * 100;
  const margin21Pct = game_margin.filter(v=>v>=21).length / game_margin.length * 100;
  const multiIntPct = tg_intThrown.filter(v=>v>=2).length / tg_intThrown.length * 100;
  const totalPassAtt = tg_passAtt.reduce((s,v)=>s+v,0);
  const totalRushAtt = tg_rushAtt.reduce((s,v)=>s+v,0);
  const passShare = totalPassAtt / (totalPassAtt + totalRushAtt) * 100;
  // Yards per pass attempt (gross — NFL net-YPA adjusts for sacks but our
  // tm.passYds already excludes sack yardage by convention, so this is close).
  const ypa = lb.pass_att ? lb.passYds / lb.pass_att : 0;
  // Median game margin — pure distributional measure of competitiveness
  const marginMedian = q(game_margin, 0.50);
  const E = [
    ["Shutout rate (team-games at 0 pts)", shutoutPct.toFixed(2)+"%", "1.0-2.5%", shutoutPct>=1.0 && shutoutPct<=2.5],
    ["40+ pt games (team-games >=40)",     big40Pct.toFixed(2)+"%",   "3.0-7.0%", big40Pct>=3.0 && big40Pct<=7.0],
    ["Games with margin >=14",             margin14Pct.toFixed(1)+"%","40-55%",   margin14Pct>=40 && margin14Pct<=55],
    ["Games with margin >=21 (blowouts)",  margin21Pct.toFixed(1)+"%","20-32%",   margin21Pct>=20 && margin21Pct<=32],
    ["Median game margin (pts)",           marginMedian.toFixed(0),   "9-13",     marginMedian>=9 && marginMedian<=13],
    ["Multi-INT team-games (>=2 picks)",   multiIntPct.toFixed(2)+"%","8-14%",    multiIntPct>=8 && multiIntPct<=14],
    ["Pass share of plays",                passShare.toFixed(1)+"%",  "55-62%",   passShare>=55 && passShare<=62],
    ["Yards / pass attempt",               ypa.toFixed(2),            "6.6-7.4",  ypa>=6.6 && ypa<=7.4],
  ];
  let eOk = 0;
  console.log("\\n══════════════════════════════════════════════════════════");
  console.log(" EVENT RATES — shape checks (catch bugs that means hide)");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" "+"METRIC".padEnd(38)+"  "+"SIM".padStart(8)+"   "+"NFL BAND".padStart(10)+"  FLAG");
  console.log(" "+"-".repeat(70));
  for (const [label, val, band, ok] of E) {
    if (ok) eOk++;
    console.log(" "+label.padEnd(38)+"  "+String(val).padStart(8)+"   "+band.padStart(10)+"   "+(ok?"OK":"!!"));
  }
  console.log(" "+"-".repeat(70));
  console.log(" "+eOk+"/"+E.length+" in range\\n");

  // ============== TIER 1+2: DRIVE / SITUATIONAL / KICKING ==============
  // Per-DRIVE denominators. lb.drives counts both teams' drives across all
  // games; per-team-game drive count = lb.drives / lb.teamGames.
  const drv = lb.drives || 1;
  const D2 = [
    ["Drives / team-game", lb.drives/lb.teamGames, 10.5, 12.5, v=>v.toFixed(1)],
    ["Points / drive", lb.drivePts/drv, 1.6, 2.3, v=>v.toFixed(2)],
    ["Yards / drive", lb.totalYds/drv, 28, 36, v=>v.toFixed(1)],
    ["TD / drive", lb.driveTDs/drv*100, 18, 26, v=>v.toFixed(1)+"%"],
    ["FG / drive", lb.driveFGs/drv*100, 9, 18, v=>v.toFixed(1)+"%"],
    ["Punt+TO / drive", (lb.driveOther+lb.driveTOs)/drv*100, 48, 62, v=>v.toFixed(1)+"%"],
    ["3rd-down conv %", lb.thirdAtt?lb.thirdConv/lb.thirdAtt*100:0, 36, 44, v=>v.toFixed(1)+"%"],
    ["4th-down conv %", lb.fourthAtt?lb.fourthConv/lb.fourthAtt*100:0, 45, 60, v=>v.toFixed(1)+"%"],
    ["Red-zone TD %", lb.rzAtt?lb.rzTD/lb.rzAtt*100:0, 52, 66, v=>v.toFixed(1)+"%"],
    ["FG %", lb.fgAtt?lb.fgMade/lb.fgAtt*100:0, 82, 90, v=>v.toFixed(1)+"%"],
    ["  FG 0-39", lb.fg0_39_a?lb.fg0_39_m/lb.fg0_39_a*100:0, 93, 100, v=>v.toFixed(1)+"%"],
    ["  FG 40-49", lb.fg40_49_a?lb.fg40_49_m/lb.fg40_49_a*100:0, 78, 90, v=>v.toFixed(1)+"%"],
    ["  FG 50+", lb.fg50_a?lb.fg50_m/lb.fg50_a*100:0, 55, 75, v=>v.toFixed(1)+"%"],
    ["XP %", lb.xpAtt?lb.xpMade/lb.xpAtt*100:0, 92, 97, v=>v.toFixed(1)+"%"],
    ["Punt avg (yds)", lb.puntAtt?lb.puntYds/lb.puntAtt:0, 43, 48, v=>v.toFixed(1)],
    ["OT game %", lb.otGames/lb.games*100, 4, 10, v=>v.toFixed(1)+"%"],
  ];
  let dOk = 0;
  console.log("══════════════════════════════════════════════════════════");
  console.log(" DRIVE / SITUATIONAL / KICKING");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" "+"METRIC".padEnd(22)+" "+"SIM".padStart(9)+"   "+"NFL BAND".padStart(13)+"  FLAG");
  console.log(" "+"-".repeat(60));
  for (const [label,val,lo,hi,fmt] of D2) {
    const ok = val>=lo && val<=hi; if (ok) dOk++;
    const band = fmt(lo).replace("%","")+"-"+fmt(hi);
    console.log(" "+label.padEnd(22)+" "+fmt(val).padStart(9)+"   "+band.padStart(13)+"   "+(ok?"OK":"!!"));
  }
  console.log(" "+"-".repeat(60));
  console.log(" "+dOk+"/"+D2.length+" in range\\n");
})();
`;

let bundle = shim + extraConsts;
for (const f of files) bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
bundle += audit;

// Run as one script in this process's scope (Function avoids strict-mode
// const/let leakage issues; sloppy-mode top-level decls stay function-local).
new Function(bundle)();
