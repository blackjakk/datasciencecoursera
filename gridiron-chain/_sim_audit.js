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

  // ── PER-POSITION PRODUCTION ──
  // For each team-game we find the PRIMARY producer at each position (the de
  // facto starter, by the position's signature stat) and push their per-game
  // stat line into pp[POS]. At report time we show median / P10 / P90 / max
  // per key stat + milestone-game frequencies. Player lines carry a pos
  // (subPos), normalized here: DE/DT to DL, FS/SS to S.
  const pp = { QB:[], RB:[], WR:[], TE:[], OL:[], DL:[], LB:[], CB:[], S:[], K:[], P:[] };
  const normPos = (p) => p==="DE"||p==="DT"||p==="NT" ? "DL" : p==="FS"||p==="SS" ? "S" : p;
  // signature stat → picks the "starter" at each position
  const sigStat = { QB:"pass_att", RB:"rush_att", WR:"rec_yds", TE:"rec_yds", OL:"pancakes",
                    DL:"sk", LB:"tkl", CB:"pd", S:"tkl", K:"fg_att", P:"punt_att" };
  // Per-GAME (not per-team-game) — margin is one value per matchup.
  const game_margin=[];

  const t0 = Date.now();
  for (let s = 0; s < SEASONS; s++) {
    // Per-offensive-playbook + per-weather accumulators (gameplay-system audit).
    // Each team uses its real playbook (getPlaybook), so tagging team-games by
    // the offense's playbook shows whether the 5 schemes produce distinct,
    // NFL-shaped profiles. Weather is read off the sim instance post-game.
    const PB = {};
    const WX = {};
    const _pbInit = id => (PB[id] || (PB[id] = { g:0, plays:0, passYds:0, rushYds:0, pAtt:0, rAtt:0, comp:0, pts:0, sacksAllowed:0 }));
    const _wxInit = l => (WX[l] || (WX[l] = { g:0, passYds:0, rushYds:0, pAtt:0, comp:0, pts:0, fum:0, fgM:0, fgA:0 }));
    const rosters = {};
    for (const t of TEAMS) rosters[t.id] = buildRoster(t);
    for (let i = 0; i < TEAMS.length; i++) {
      for (let j = i + 1; j < TEAMS.length; j++) {
        const h = TEAMS[i], a = TEAMS[j];
        const sim = new GameSimulator(h, a, rosters[h.id], rosters[a.id]);
        const r = sim.simulate();
        lb.games++; lb.ptsSum += (r.homeScore + r.awayScore);
        game_margin.push(Math.abs(r.homeScore - r.awayScore));
        const _wxL = (sim.weather && sim.weather.label) || "CLEAR";
        const _wx = _wxInit(_wxL);
        for (const side of ["home","away"]) {
          const tm = r.stats[side].team;
          const pts = side==="home" ? r.homeScore : r.awayScore;
          // name→OVR for this side's roster, so per-position OVR can be reported.
          const _sideRoster = side==="home" ? rosters[h.id] : rosters[a.id];
          const _ovrByName = {};
          for (const _p of _sideRoster) _ovrByName[_p.name] = _p.overall || 0;
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
          // ── Per-playbook (offense) + per-weather accumulation ──
          const _offTeam = side==="home" ? h : a;
          const _pb = _pbInit(_offTeam.playbook || "BALANCED");
          _pb.g++; _pb.plays += (tm.plays||0); _pb.passYds += tm.passYds; _pb.rushYds += tm.rushYds;
          _pb.pAtt += tm.pass_att; _pb.rAtt += tm.rush_att; _pb.comp += tm.pass_comp;
          _pb.pts += pts; _pb.sacksAllowed += (tm.sacks_allowed||0);
          _wx.g++; _wx.passYds += tm.passYds; _wx.rushYds += tm.rushYds;
          _wx.pAtt += tm.pass_att; _wx.comp += tm.pass_comp; _wx.pts += pts;
          // Situational (team stats)
          lb.thirdAtt += (tm.thirdAtt||0); lb.thirdConv += (tm.thirdConv||0);
          lb.fourthAtt += (tm.fourthAtt||0); lb.fourthConv += (tm.fourthConv||0);
          lb.rzAtt += (tm.rz_att||0); lb.rzTD += (tm.rz_td||0);
          // Kicking / ST (player lines) + per-position starter detection
          const posLeader = {};   // POS → best line this team-game by sigStat
          for (const p of Object.values(r.stats[side].players)) {
            lb.fgMade += (p.fg_made||0); lb.fgAtt += (p.fg_att||0);
            lb.xpMade += (p.xp_made||0); lb.xpAtt += (p.xp_att||0);
            lb.puntAtt += (p.punt_att||0); lb.puntYds += (p.punt_yds||0);
            _wx.fum += (p.fumbles||0); _wx.fgM += (p.fg_made||0); _wx.fgA += (p.fg_att||0);
            const P = normPos(p.pos);
            if (pp[P]) {
              const stat = sigStat[P];
              if (!posLeader[P] || (p[stat]||0) > (posLeader[P][stat]||0)) posLeader[P] = p;
            }
          }
          for (const P in posLeader) { posLeader[P]._ovr = _ovrByName[posLeader[P].name] || 0; pp[P].push(posLeader[P]); }
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
    // ptsSum is per-game (both teams); pass_att+rush_att is summed per
    // team-game (also both teams). Same scale → NO /2 (an earlier /2 halved
    // this to ~0.20 and false-flagged it; true all-snap NFL ppp ~0.36-0.41).
    ppp: (lb.pass_att + lb.rush_att) ? lb.ptsSum / (lb.pass_att + lb.rush_att) : 0,
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

  // ============== PER-POSITION PRODUCTION (per-game, the starter) ==============
  function _q(arr,p){ if(!arr.length) return 0; const s=arr.slice().sort((a,b)=>a-b); return s[Math.min(s.length-1,Math.floor(p*s.length))]; }
  function _mx(arr){ return arr.length?Math.max(...arr):0; }
  // dist line: "label  P50 / P10 / P90 / max"  for a derived per-line value
  function distLine(label, lines, fn, fmt){
    const vals = lines.map(fn).filter(v=>!isNaN(v));
    fmt = fmt || (v=>v.toFixed(1));
    return label.padEnd(11)+" "+fmt(_q(vals,.5)).padStart(6)+" /"+fmt(_q(vals,.10)).padStart(6)+" /"+fmt(_q(vals,.90)).padStart(6)+" /"+fmt(_mx(vals)).padStart(6);
  }
  function freq(label, lines, pred){ const n=lines.length||1; return label+" "+(lines.filter(pred).length/n*100).toFixed(0)+"%"; }
  console.log("══════════════════════════════════════════════════════════");
  console.log(" PER-POSITION PRODUCTION — per game, the position's starter");
  console.log(" (each row: median / P10 / P90 / max ; n = starter-games)");
  console.log("══════════════════════════════════════════════════════════");
  const QB=pp.QB, RB=pp.RB, WR=pp.WR, TE=pp.TE, DL=pp.DL, LB=pp.LB, CB=pp.CB, S=pp.S, K=pp.K, P=pp.P, OL=pp.OL;
  // Starter OVR by position (these are FRESH-GEN rosters — no development; for
  // the DEVELOPED OVR-by-round + by-position picture see _brady_audit.js).
  console.log(" STARTER OVR by position (median / P10 / P90 / max):");
  for (const Pn of ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"]) {
    const ov = pp[Pn].map(l=>l._ovr||0).filter(v=>v>0);
    if (!ov.length) continue;
    console.log("   "+Pn.padEnd(3)+" "+_q(ov,.5).toString().padStart(3)+" / "+_q(ov,.10).toString().padStart(3)+" / "+_q(ov,.90).toString().padStart(3)+" / "+_mx(ov).toString().padStart(3));
  }
  console.log("");
  console.log(" QB  (n="+QB.length+")   NFL starter refs in (parens)");
  console.log("   "+distLine("Comp%", QB, l=>l.pass_att?l.pass_comp/l.pass_att*100:0, v=>v.toFixed(0)+"%")+"   (~63%)");
  console.log("   "+distLine("Pass yds", QB, l=>l.pass_yds||0, v=>v.toFixed(0))+"   (~230)");
  console.log("   "+distLine("Pass TD", QB, l=>l.pass_td||0, v=>v.toFixed(1))+"   (~1.5)");
  console.log("   "+distLine("INT", QB, l=>l.pass_int||0, v=>v.toFixed(1))+"   (~0.7)");
  console.log("   "+freq("300+yd game",QB,l=>(l.pass_yds||0)>=300)+"   "+freq("3+TD",QB,l=>(l.pass_td||0)>=3)+"   "+freq("multi-INT",QB,l=>(l.pass_int||0)>=2));
  console.log(" RB  (n="+RB.length+")");
  console.log("   "+distLine("Carries", RB, l=>l.rush_att||0, v=>v.toFixed(0))+"   (~16)");
  console.log("   "+distLine("Rush yds", RB, l=>l.rush_yds||0, v=>v.toFixed(0))+"   (~70)");
  console.log("   "+distLine("YPC", RB, l=>l.rush_att?l.rush_yds/l.rush_att:0, v=>v.toFixed(1))+"   (~4.3)");
  console.log("   "+distLine("Rec", RB, l=>l.rec||0, v=>v.toFixed(1))+"   (~3)");
  console.log("   "+freq("100+yd game",RB,l=>(l.rush_yds||0)>=100)+"   "+freq("2+TD",RB,l=>((l.rush_td||0)+(l.rec_td||0))>=2));
  console.log(" WR  (n="+WR.length+")");
  console.log("   "+distLine("Targets", WR, l=>l.rec_tgt||0, v=>v.toFixed(0))+"   (~8)");
  console.log("   "+distLine("Rec", WR, l=>l.rec||0, v=>v.toFixed(1))+"   (~5)");
  console.log("   "+distLine("Rec yds", WR, l=>l.rec_yds||0, v=>v.toFixed(0))+"   (~70)");
  console.log("   "+distLine("Yds/catch", WR, l=>l.rec?l.rec_yds/l.rec:0, v=>v.toFixed(1))+"   (~13)");
  console.log("   "+freq("100+yd game",WR,l=>(l.rec_yds||0)>=100)+"   "+freq("2+TD",WR,l=>(l.rec_td||0)>=2));
  console.log(" TE  (n="+TE.length+")");
  console.log("   "+distLine("Rec", TE, l=>l.rec||0, v=>v.toFixed(1))+"   (~4)");
  console.log("   "+distLine("Rec yds", TE, l=>l.rec_yds||0, v=>v.toFixed(0))+"   (~45)");
  console.log("   "+freq("100+yd game",TE,l=>(l.rec_yds||0)>=100));
  console.log(" DL  (n="+DL.length+")   LB (n="+LB.length+")");
  console.log("   DL "+distLine("Tkl", DL, l=>l.tkl||0, v=>v.toFixed(1))+"  | Sacks "+_q(DL.map(l=>l.sk||0),.5).toFixed(1)+" med, "+_mx(DL.map(l=>l.sk||0))+" max  "+freq("multi-sk",DL,l=>(l.sk||0)>=2));
  console.log("   LB "+distLine("Tkl", LB, l=>l.tkl||0, v=>v.toFixed(1))+"  | Sk "+_q(LB.map(l=>l.sk||0),.5).toFixed(1)+" INT "+_q(LB.map(l=>l.int_made||0),.5).toFixed(1));
  console.log(" CB  (n="+CB.length+")   S (n="+S.length+")");
  console.log("   CB Tkl "+_q(CB.map(l=>l.tkl||0),.5).toFixed(1)+" med | PD "+_q(CB.map(l=>l.pd||0),.5).toFixed(1)+" med/"+_mx(CB.map(l=>l.pd||0))+" max | "+freq("INT game",CB,l=>(l.int_made||0)>=1));
  console.log("   S  Tkl "+_q(S.map(l=>l.tkl||0),.5).toFixed(1)+" med | INT "+freq("game",S,l=>(l.int_made||0)>=1)+" | PD "+_q(S.map(l=>l.pd||0),.5).toFixed(1)+" med");
  console.log(" K  (n="+K.length+")   P (n="+P.length+")");
  console.log("   K  FG made "+_q(K.map(l=>l.fg_made||0),.5).toFixed(1)+"/g (max "+_mx(K.map(l=>l.fg_made||0))+") | long "+_mx(K.map(l=>l.fg_long||0)));
  console.log("   P  Punts "+_q(P.map(l=>l.punt_att||0),.5).toFixed(1)+"/g | avg "+(()=>{const a=P.filter(l=>l.punt_att);return a.length?(a.reduce((s,l)=>s+l.punt_yds,0)/a.reduce((s,l)=>s+l.punt_att,0)).toFixed(1):"0";})()+" | long "+_mx(P.map(l=>l.punt_long||0)));
  console.log(" OL  (n="+OL.length+")   Pancakes "+_q(OL.map(l=>l.pancakes||0),.5).toFixed(1)+" med/"+_mx(OL.map(l=>l.pancakes||0))+" max");
  console.log("");

  // ============== PLAYBOOK BREAKDOWN — scheme differentiation ==============
  // Each team runs its real offensive playbook; this shows whether the 5
  // schemes produce distinct, NFL-shaped profiles (AIR_RAID pass-heavy,
  // GROUND_AND_POUND run-heavy, OPTION/DUAL_THREAT run-leaning, etc.).
  console.log("══════════════════════════════════════════════════════════");
  console.log(" PLAYBOOK BREAKDOWN (offense) — per team-game by scheme");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   "+"SCHEME".padEnd(16)+"PASS%".padStart(6)+"pYDS".padStart(7)+"rYDS".padStart(7)+"Y/PLAY".padStart(8)+"PTS".padStart(6)+"SKall".padStart(7));
  console.log("   "+"-".repeat(57));
  for (const [id, s] of Object.entries(PB).sort((a,b)=>b[1].g-a[1].g)) {
    if (!s.g) continue;
    const passShare = 100*s.pAtt/Math.max(1,(s.pAtt+s.rAtt));
    const ypp = (s.passYds+s.rushYds)/Math.max(1,s.plays);
    console.log("   "+id.padEnd(16)+passShare.toFixed(1).padStart(6)+(s.passYds/s.g).toFixed(0).padStart(7)
      +(s.rushYds/s.g).toFixed(0).padStart(7)+ypp.toFixed(2).padStart(8)+(s.pts/s.g).toFixed(1).padStart(6)
      +(s.sacksAllowed/s.g).toFixed(2).padStart(7));
  }

  // ============== WEATHER BREAKDOWN — environment effects ==============
  // Verifies weather actually moves the game: RAIN/SNOW should cut completion%
  // and lift fumbles; wind/snow should drop FG%.
  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" WEATHER BREAKDOWN — per team-game by condition");
  console.log("══════════════════════════════════════════════════════════");
  console.log("   "+"WEATHER".padEnd(10)+"share".padStart(7)+"CMP%".padStart(7)+"pYDS".padStart(7)+"rYDS".padStart(7)+"PTS".padStart(6)+"FUM/g".padStart(7)+"FG%".padStart(7));
  console.log("   "+"-".repeat(58));
  const _wxTot = Object.values(WX).reduce((n,s)=>n+s.g,0)||1;
  for (const [lab, s] of Object.entries(WX).sort((a,b)=>b[1].g-a[1].g)) {
    if (!s.g) continue;
    console.log("   "+lab.padEnd(10)+(100*s.g/_wxTot).toFixed(1).padStart(7)+(100*s.comp/Math.max(1,s.pAtt)).toFixed(1).padStart(7)
      +(s.passYds/s.g).toFixed(0).padStart(7)+(s.rushYds/s.g).toFixed(0).padStart(7)+(s.pts/s.g).toFixed(1).padStart(6)
      +(s.fum/s.g).toFixed(3).padStart(7)+(100*s.fgM/Math.max(1,s.fgA)).toFixed(1).padStart(7));
  }
  console.log("");
})();
`;

let bundle = shim + extraConsts;
for (const f of files) bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
bundle += audit;

// Run as one script in this process's scope (Function avoids strict-mode
// const/let leakage issues; sloppy-mode top-level decls stay function-local).
new Function(bundle)();
