// Brady-test harness — headless multi-decade franchise sim that counts the
// rate of late-round/UDFA emergences into legend-tier (96+ OVR), the cadence
// we calibrated to ~1 per 75 years (commit 0f81227). Same bundle approach as
// _sim_audit.js: concatenate the script files + harness into one script so
// top-level const/class share scope; minimal DOM stub absorbs UI calls.
const fs = require("fs");
const path = require("path");

const SEASONS = Number(process.argv[2] || 75);

// Browser shims — chainable Proxy stub absorbs any DOM access without throwing.
const shim = `
  var _stub = new Proxy(function(){}, {
    get(t, k) { if (k === "length") return 0;
                if (k === Symbol.iterator) return function*(){};
                if (k === Symbol.toPrimitive) return () => 0;
                if (k === "value" || k === "innerHTML" || k === "textContent") return "";
                if (k === "checked" || k === "disabled") return false;
                if (k === "children" || k === "childNodes") return [];
                return _stub; },
    set() { return true; }, apply() { return _stub; }, construct() { return _stub; },
    has() { return true; },
  });
  var document = {
    createElement: () => _stub, getElementById: () => _stub,
    querySelector: () => _stub, querySelectorAll: () => [],
    addEventListener: () => {}, body: _stub, documentElement: _stub,
    head: _stub, location: { hash: "" },
  };
  var window = (typeof globalThis !== "undefined" ? globalThis : this);
  window.addEventListener = () => {};
  if (typeof performance === "undefined") var performance = { now: () => Date.now() };
  var requestAnimationFrame = (cb) => setTimeout(() => { if (typeof cb === "function") cb(Date.now()); }, 0);
  var localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  var location = { hash: "" };
  var alert = () => {};
  // The offseason chain routes through confirm()-guarded UI handlers
  // (frnConfirm*) and persists via IndexedDB. Auto-confirm everything and
  // give IndexedDB a benign stub so saves no-op instead of throwing per pick.
  var confirm = () => true;
  var prompt = () => "";
  var indexedDB = { open: () => ({ onsuccess: null, onerror: null, result: null }) };
`;

const files = [
  "play-data.js",
  "play-player.js",
  "play-render.js",           // pickBodyType, CELEB_STYLES + gen helpers (UI-init stripped below)
  "play-sim.js",
  "play-motion.js",
  "play-engine.js",
  "play-broadcast.js",        // _bspnLiveAbbr + ticker helpers — franchise award/
                              // news/record-break code calls these; without it
                              // frnSimToEndOfSeason throws once a record breaks.
  "play-franchise-core.js",
  "play-franchise-season.js",
  "play-franchise-stats.js",
  "play-franchise-offseason.js",
];

// Strip top-level UI-init calls that don't survive the DOM stub. Each was
// confirmed (grep "^[a-z_]+(" — column-0 executable statements) — these are
// the ONLY top-level calls; everything else is decl/function/closure.
function stripUiInit(code, file) {
  let c = code;
  if (file === "play-render.js") {
    c = c.replace(/^buildOptions\([^)]*\);\s*$/gm, "// [audit] stripped")
         .replace(/^setupPreview\([^)]*\);\s*$/gm, "// [audit] stripped");
  }
  if (file === "play-franchise-stats.js") {
    c = c.replace(/^_frnInstallHoverDelegation\(\);\s*$/gm, "// [audit] stripped");
  }
  if (file === "play-franchise-offseason.js") {
    c = c.replace(/^\$\([^)]*\)\.addEventListener[\s\S]*?\);\s*$/gm, "// [audit] stripped");
  }
  return c;
}

const extraConsts = `
  // showFranchiseDashboard / render fns are called after each week-advance;
  // make them no-ops so the sim loop doesn't waste time chasing render bugs.
  function showFranchiseDashboard() {}
  function renderFrnPreseason() {}
  function renderFrnDashboard() {}
  function _flushSaveFranchise() {}
  function saveFranchise() {}
`;

const harness = `
;(async function brady() {
  if (typeof startFranchise !== "function") {
    console.error("startFranchise missing — franchise files didn't load");
    process.exit(1);
  }
  console.error("Franchise layer loaded. Starting Brady-test: " + ${SEASONS} + " seasons.");
  // Headless: the offseason/draft chain awaits _frnConfirm — a custom MODAL
  // promise that never resolves without a real UI (the browser confirm() stub
  // doesn't cover it). Auto-confirm so the awaited draft-finalize (mint next
  // year's picks + fill rosters) actually completes instead of suspending the
  // run forever. THIS is what made the draft class stop cycling.
  if (typeof _frnConfirm !== "undefined") _frnConfirm = async () => true;
  // Mute known-benign console noise so the audit output stays readable:
  //  · "missing pick row" — R7 pick rows occasionally absent (see _ensurePicksForYear
  //    early-return vs _injectCompPicks; thins the gem pool slightly, doesn't break the test)
  //  · "[IDB save]" / "indexedDB" — persistence no-ops in node
  //  · "Dashboard render error" — DOM-dependent render paths we've stubbed
  const _origWarn = console.warn, _origErr = console.error;
  const _mute = (s) => typeof s === "string" && (
    s.indexOf("missing pick row") >= 0 || s.indexOf("[IDB") >= 0 ||
    s.indexOf("indexedDB") >= 0 || s.indexOf("Dashboard render") >= 0 ||
    s.indexOf("[save]") >= 0);
  console.warn  = function(...a) { if (!_mute(a[0])) _origWarn.apply(console, a); };
  console.error = function(...a) { if (!_mute(a[0])) _origErr.apply(console, a); };
  // Silence render functions at runtime — after the files load they're the
  // REAL fns; replace with no-ops so the sim loop doesn't burn cycles in
  // dashboard rendering that depends on DOM. We only need the sim logic.
  if (typeof showFranchiseDashboard === "function") showFranchiseDashboard = function() {};
  if (typeof renderFrnPreseason === "function") renderFrnPreseason = function() {};
  if (typeof renderFrnDashboard === "function") renderFrnDashboard = function() {};
  if (typeof renderFrnSeasonRecap === "function") renderFrnSeasonRecap = function() {};
  // The offseason→draft chain also renders these; no-op them so the loop
  // doesn't chase DOM-dependent render bugs (they touch team colors etc).
  if (typeof renderFrnOffseason === "function") renderFrnOffseason = function() {};
  if (typeof renderFrnDraft === "function") renderFrnDraft = function() {};
  if (typeof renderFrnAwards === "function") renderFrnAwards = function() {};
  if (typeof _startDraftFloorAnim === "function") _startDraftFloorAnim = function() {};
  if (typeof _flushSaveFranchise === "function") _flushSaveFranchise = function() {};
  if (typeof saveFranchise === "function") saveFranchise = function() {};
  // Pick any team as the "user team" so franchise.chosenTeamId is set, then
  // include it in audits (we don't care which team is the user).
  try { startFranchise(0); }
  catch (e) { console.error("startFranchise threw:", e.message); process.exit(1); }
  if (!franchise) { console.error("franchise global not populated"); process.exit(1); }
  console.error("franchise inited at season " + franchise.season + ", week " + franchise.week);

  // ── RECORD BOOK capture ───────────────────────────────────────────────
  // Wrap frnSimOnce to read each game's per-player stat lines (r.full.stats
  // .home/.away.players, keyed by name) BEFORE they're stripped for storage.
  // From those we build: career totals, single-season highs, single-game highs.
  // Stat fields per engine _emptyLine.
  const CATS = [
    ["pass_yds","Passing yds"], ["pass_td","Passing TD"], ["pass_int","Passing INT"],
    ["rush_yds","Rushing yds"], ["rush_td","Rushing TD"],
    ["rec_yds","Receiving yds"], ["rec_td","Receiving TD"], ["rec","Receptions"],
    ["sk","Sacks"], ["tkl","Tackles"],
    ["int_made","INTs"], ["int_td","Pick sixes"],
    ["pd","Pass deflect"], ["ff","Forced fum"], ["fr","Fum recov"], ["def_td","Def TDs"],
    // K / OL / P marquee stats — needed so the BEST-SEASON-BY-POSITION table can
    // rank every position, not just skill/defense.
    ["fg_made","FG made"], ["pancakes","Pancakes"], ["punt_yds","Punt yds"], ["punts","Punts"],
  ];
  const career = new Map();          // name → { games, <cat sums> }
  let   seasonAcc = new Map();       // name → season sums (reset each season)
  const seasonRec = {};              // cat → { val, name, season }
  const gameRec   = {};              // cat → { val, name, season, opp }
  // BEST SINGLE SEASON BY POSITION — the best individual (real-named) season at
  // each position. The engine keys some stat lines by a position/slot label
  // (placeholder aggregates like "QB"/"WR1"/"MLB"); those are filtered so only
  // real players surface. Position comes from a name→pos map rebuilt each season.
  const bestSeasonByPos = {};        // pos → { name, season, metric, line }
  const _normPos = (p) => ({ LT:"OL",LG:"OL",C:"OL",RG:"OL",RT:"OL", LDE:"DL",RDE:"DL",LDT:"DL",RDT:"DL",DE:"DL",DT:"DL",NT:"DL",
                             MLB:"LB",OLB:"LB",ILB:"LB",WLB:"LB",SLB:"LB", FS:"S",SS:"S", NB:"CB",DB:"CB" }[p] || p);
  const _posMetric = (pos, r) => {
    switch (pos) {
      case "QB": return (r.pass_yds||0) + (r.pass_td||0)*25 - (r.pass_int||0)*20;
      case "RB": return (r.rush_yds||0) + (r.rush_td||0)*10 + (r.rec_yds||0)*0.5;
      case "WR": case "TE": return (r.rec_yds||0) + (r.rec_td||0)*10;
      case "OL": return (r.pancakes||0);
      case "DL": return (r.sk||0)*10 + (r.tkl||0) + (r.ff||0)*5;
      case "LB": return (r.tkl||0) + (r.sk||0)*6 + (r.int_made||0)*8;
      case "CB": case "S": return (r.int_made||0)*12 + (r.pd||0)*2 + (r.tkl||0)*0.3 + (r.def_td||0)*15;
      case "K": return (r.fg_made||0);
      case "P": return (r.punt_yds||0);
      default: return 0;
    }
  };
  function _accInto(map, name, line) {
    let r = map.get(name);
    if (!r) { r = { games: 0 }; for (const [k] of CATS) r[k] = 0; map.set(name, r); }
    r.games++;
    for (const [k] of CATS) r[k] += (line[k] || 0);
  }
  if (typeof frnSimOnce === "function") {
    const _origSimOnce = frnSimOnce;
    frnSimOnce = function(homeId, awayId, isPlayoff) {
      const res = _origSimOnce.apply(this, arguments);
      try {
        const st = res && res.full && res.full.stats;
        if (st) {
          const sNum = franchise.season;
          for (const side of ["home", "away"]) {
            const players = (st[side] && st[side].players) || {};
            for (const [name, line] of Object.entries(players)) {
              _accInto(career, name, line);
              _accInto(seasonAcc, name, line);
              // single-game highs
              for (const [k, label] of CATS) {
                const v = line[k] || 0;
                if (v > 0 && (!gameRec[k] || v > gameRec[k].val)) {
                  gameRec[k] = { val: v, name, season: sNum };
                }
              }
            }
          }
        }
      } catch (e) { /* records are best-effort */ }
      return res;
    };
  }
  // Fold the just-finished season's per-player totals into the single-season
  // record book, then reset for the next season. Called once per season.
  // Also maintains a top-5 single-season leaderboard per stat (seasonTop5).
  const seasonTop5 = {};   // cat → [{val,name,season}, ...] sorted desc, len<=5
  function _foldSeasonRecords() {
    // name → normalized position, from this season's active rosters.
    const nameToPos = {};
    for (const roster of Object.values(franchise.rosters || {}))
      for (const p of roster) if (p.name) nameToPos[p.name] = _normPos(p.position);
    // Placeholder aggregate? (no space + short all-caps = a slot/position label
    // like "QB", "WR1", "MLB" that the engine keyed nameless stats under).
    const _isPlaceholder = (n) => !/\s/.test(n) && /^[A-Z0-9]{1,4}$/.test(n);
    for (const [name, r] of seasonAcc) {
      for (const [k] of CATS) {
        const v = r[k] || 0;
        if (v <= 0) continue;
        if (!seasonRec[k] || v > seasonRec[k].val) seasonRec[k] = { val: v, name, season: franchise.season };
        const lb5 = (seasonTop5[k] = seasonTop5[k] || []);
        lb5.push({ val: v, name, season: franchise.season });
        lb5.sort((a, b) => b.val - a.val);
        if (lb5.length > 5) lb5.length = 5;
      }
      // Best season by position — real players only.
      if (_isPlaceholder(name)) continue;
      const pos = nameToPos[name];
      if (!pos) continue;
      const m = _posMetric(pos, r);
      if (m > 0 && (!bestSeasonByPos[pos] || m > bestSeasonByPos[pos].metric)) {
        bestSeasonByPos[pos] = { name, season: franchise.season, metric: m, line: { ...r } };
      }
    }
    seasonAcc = new Map();
  }

  // Award history — tally each season's accolade winners by player (persists
  // past retirement since we capture the season they win it, while active).
  const awardCounts = {};   // award label → { name → count }
  const AWARDS = ["MVP","Super Bowl MVP","OPOY","DPOY","ROY","Super Bowl","All-Pro","Pro Bowl"];
  function _captureAwards() {
    const pools = TEAMS.map(t => franchise.rosters[t.id] || []);
    pools.push(franchise.freeAgents || []);
    const seen = new Set();
    for (const pool of pools) for (const p of pool) {
      if (seen.has(p.name)) continue; seen.add(p.name);
      const row = (p.careerHistory || []).find(h => h.season === franchise.season);
      if (!row || !row.accolades) continue;
      for (const a of row.accolades) {
        if (!AWARDS.includes(a)) continue;
        (awardCounts[a] = awardCounts[a] || {});
        awardCounts[a][p.name] = (awardCounts[a][p.name] || 0) + 1;
      }
    }
  }

  // Snapshot every player flagged as a hiddenGem at draft/UDFA time so we can
  // count those that LATER reach legend tier (OVR >= 96). _rollHiddenGem stamps
  // p.hiddenGem = { ceiling, growthRate } on draft; the offseason grind + the
  // performance-gated breakout grow them.
  //
  // EMERGENCE = peak OVR >= 96, full stop. An earlier version also required the
  // first-sighting ceiling to be >= 96, which was WRONG: the breakout
  // (_rerollPotentialForBreakouts) can RAISE a gem's ceiling mid-career
  // (ceiling = max(ceiling, newPot)), so a gem drafted with ceiling 90 that
  // breaks out to 99 and reaches OVR 99 IS a legend — but the frozen snapshot
  // checked the stale 90 and missed it. Reaching 96+ OVR is the emergence; the
  // ceiling is just the (mutable) mechanism that gets it there. Late picks
  // can't reach 96 any other way — _rollPotential gives R6 a mean potential of
  // 63 (std 7), so normal dev to 96 is ~4.7σ; the gem path is the only road.
  let totalGemsRolled = 0;
  let legendEmergences = 0;          // any tracked gem that reaches OVR >= 96
  let lateRoundLegends = 0;          // round >= 5 OR UDFA
  let bradyEmergences = 0;           // round >= 6 OR UDFA, ANY position (late-round legend)
  let bradyQbEmergences = 0;         // round >= 6 OR UDFA AND QB — the TRUE Brady (once-a-generation)
  const emergeByPos = {};            // position → count of R6+/UDFA → 96+ emergences
  const seenGems = new Map();        // name → { round, peakOvr, emerged }
  // Star-tier tracker — peak OVR >= 90 regardless of gem status. Catches
  // Nasser-tier near-legend careers (4 of top-5 single-season rushing
  // performances, peak ~92-95 OVR) that never crossed the legend 96+ bar and
  // would otherwise leave no career record. Separate from gems by design.
  const starPlayers = new Map();     // name → { player, peakOvr, peakSeason }
  // Keep the actual player object for any legend so we can dump their full
  // career (history rows, accolades, championships) at the end of the sim.
  const legendPlayers = [];          // [{ player, emergedSeason }]

  // ── League OVR distribution over the whole sim ─────────────────────────
  // Each season, snapshot every team's ACTIVE roster (top-53 by OVR — the
  // players who'd actually be on the 53-man) and pool all the OVRs across all
  // seasons. This is the developed steady-state distribution as it played out,
  // from the games-based flow (bounded rosters), not a games-free artifact.
  // Also track mean roster size so we can see if rosters bloat (top-53 only
  // cherry-picks if the underlying rosters are much larger than 53).
  const leagueOvr = [];
  const decadeOvr = [[], [], [], [], [], [], [], []];  // per-decade OVR pools (index = (year-1)/10)
  const rcRoster = {};   // ROSTER CONSTRUCTION: round label → [ovr,...] (all 53 spots, final season)
  const rcStarter = {};  // round label → [ovr,...] (depth-chart starters, final season)
  let rcSynthCount = 0, rcInSimCount = 0;   // synthetic (pre-S1, OVR-backfilled round) vs in-sim-drafted survivors
  // Per-position OVR pool — every active-roster player-season tagged by pos so
  // we can dump a full distribution per position (count / mean / med / P10/P90
  // / %90+ / %85+ / %75+) alongside the leaguewide one. Catches position-specific
  // inflation that the league aggregate would hide (e.g. CBs running hot, RBs
  // declining hard).
  const POS_OVR = {};   // pos → flat array of OVRs across all season snapshots
  const POS_AGE = {};   // pos → flat array of ages (for cross-cuts later)
  // OVR by draft round, pooled across all seasons. p.draftRound: 1-7 for drafted
  // (set in _aiAutoPick at slot.round), 0 for UDFA (per _rollHiddenGem's rate
  // table), null/undefined for the initial generation. We bucket UDFA→8 and
  // null/0→9 for clarity. Late-round outliers in the right tail = emerged gems.
  const byRound = {};   // round → array of OVRs at every snapshot
  // Per-player career peak — for bust/hit rates by round. Keyed by name so we
  // track the same player across seasons; first sighting stamps the round.
  // pid would be more stable, but legacy code already names everyone uniquely.
  const careerPeak = new Map();   // name → { round, peakOvr, firstSeen }
  const careerLen = new Map();    // name → { pos, seasons } — Tier 4 career length
  function _roundBucket(p) {
    const r = p.draftRound;
    if (r === 0 || p.udfa) return 8;        // UDFA
    if (r >= 1 && r <= 7) return r;
    return 9;                                // initial-gen / unknown
  }
  // ── Tier 3: franchise-health — snapshot each season's standings + champ.
  // standings reset every season (frnNewSeason → initStandings), so we must
  // snapshot in-loop. franchise.history accumulates champions but we capture
  // here too so persistence/dynasty math has win% alongside the title.
  const seasonStandings = [];   // [{ year, winPct: {tid: pct}, champId }]
  function snapshotStandings(year) {
    const winPct = {};
    let bestPF = 0, bestPFteam = null, bestW = 0, bestWteam = null;
    for (const t of TEAMS) {
      const s = (franchise.standings && franchise.standings[t.id]) || { w: 0, l: 0, t: 0, pf: 0 };
      const g = (s.w || 0) + (s.l || 0) + (s.t || 0);
      winPct[t.id] = g ? ((s.w || 0) + 0.5 * (s.t || 0)) / g : 0.5;
      if ((s.pf || 0) > bestPF) { bestPF = s.pf || 0; bestPFteam = t; }
      if ((s.w || 0) > bestW)   { bestW = s.w || 0;   bestWteam = t; }
    }
    const champId = (franchise.history && franchise.history.length)
      ? franchise.history[franchise.history.length - 1].champion : null;
    // Team-season records (top offense, most wins) — track the best ever.
    if (bestPFteam && bestPF > (teamRecords.topPF.val || 0))
      teamRecords.topPF = { val: bestPF, team: bestPFteam.name, season: year };
    if (bestWteam && bestW > (teamRecords.topW.val || 0))
      teamRecords.topW = { val: bestW, team: bestWteam.name, season: year };
    seasonStandings.push({ year, winPct, champId });
  }
  const teamRecords = { topPF: {}, topW: {} };

  // ── POSITIONAL DEPTH + LEAGUE LEADERS (point-in-time snapshot) ──────────
  // Everything else we report is pooled-over-all-seasons or cumulative
  // career/season leaders. This answers "how many elite QBs exist AT ONE
  // TIME, what's the top-10 OVR range, who are the best players right now,
  // and what are they producing." Snapshot each season → average the depth;
  // keep the final season's top lists with stat lines.
  const POSN = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const normP = p => p==="DE"||p==="DT"||p==="NT" ? "DL" : p==="FS"||p==="SS" ? "S" : p;
  const posDepth = {}; for (const P of POSN) posDepth[P] = { n90:[], n85:[], t1:[], t5:[], t10:[] };
  let leagueTop = [], qbTop = [];   // final-season snapshots (with stat lines)
  // Short per-season stat line from a player's last careerHistory row.
  function _seasonLine(p) {
    const h = (p.careerHistory || []); const r = h[h.length - 1]; if (!r) return "";
    const pos = p.position;
    if (pos==="QB") return (r.pass_yds||0)+" yd, "+(r.pass_td||0)+" TD, "+(r.pass_int||0)+" INT";
    if (pos==="RB") return (r.rush_yds||0)+" yd, "+(r.rush_td||0)+" TD, "+(r.rec||0)+" rec";
    if (pos==="WR"||pos==="TE") return (r.rec||0)+" rec, "+(r.rec_yds||0)+" yd, "+(r.rec_td||0)+" TD";
    if (pos==="DL"||pos==="LB") return (r.tkl||0)+" tkl, "+(r.sk||0)+" sk, "+(r.ff||0)+" FF";
    if (pos==="CB"||pos==="S")  return (r.tkl||0)+" tkl, "+(r.int_made||0)+" INT, "+(r.pd||0)+" PD";
    if (pos==="K") return (r.fg_made||0)+"/"+(r.fg_att||0)+" FG";
    if (pos==="P") return (r.punt_att||0)+" punts";
    return "";
  }
  function snapshotDepth(year, isFinal) {
    const byPos = {}; for (const P of POSN) byPos[P] = [];
    const all = [];
    for (const t of TEAMS) {
      const active = (franchise.rosters[t.id] || []).slice()
        .sort((a,b)=>(b.overall||0)-(a.overall||0)).slice(0, 53);
      for (const p of active) { const P = normP(p.position); if (byPos[P]) byPos[P].push(p); all.push(p); }
    }
    for (const P of POSN) {
      const arr = byPos[P].sort((a,b)=>(b.overall||0)-(a.overall||0));
      const d = posDepth[P];
      d.n90.push(arr.filter(p=>(p.overall||0)>=90).length);
      d.n85.push(arr.filter(p=>(p.overall||0)>=85).length);
      d.t1.push(arr[0]?.overall||0); d.t5.push(arr[4]?.overall||0); d.t10.push(arr[9]?.overall||0);
    }
    if (isFinal) {
      all.sort((a,b)=>(b.overall||0)-(a.overall||0));
      leagueTop = all.slice(0,15).map(p=>({ name:p.name, pos:p.position, ovr:p.overall||0, age:p.age||0, line:_seasonLine(p) }));
      qbTop = byPos.QB.slice(0,10).map(p=>({ name:p.name, ovr:p.overall||0, age:p.age||0, line:_seasonLine(p) }));
    }
  }

  let rosterSizeSum = 0, rosterSizeN = 0;
  function snapshotLeagueOvr(year) {
    const dIdx = Math.min(decadeOvr.length - 1, Math.floor((year - 1) / 10));
    // Also walk the FA pool for career-peak tracking (cut busts that washed out
    // of the league should still count as their round's draftee, otherwise R7
    // bust % is undercounted — they retire from FA, never from a roster).
    const cpSeen = new Set();
    // ROSTER CONSTRUCTION snapshot — final season only. By year ~100 every
    // rostered player came through the draft (synthetic season-1 players have
    // retired), so this is a clean read of "what a roster is built from" by
    // draft round, split into full-roster vs depth-chart starters.
    const _isFinal = (year >= ${SEASONS});
    const _RC_DEPTH = { QB:1, RB:2, WR:3, TE:1, OL:5, DL:4, LB:3, CB:2, S:2, K:1, P:1 };
    const _rcLabel = (p) => { const r = p.draftRound; return (r == null || r === 0) ? "UDFA" : (r >= 7 ? "R7" : "R" + r); };
    for (const t of TEAMS) {
      const full = franchise.rosters[t.id] || [];
      rosterSizeSum += full.length; rosterSizeN++;
      const active = full.slice().sort((a, b) => (b.overall || 0) - (a.overall || 0)).slice(0, 53);
      if (_isFinal) {
        const _byPos = {};
        for (const p of active) (_byPos[p.position] = _byPos[p.position] || []).push(p);
        const _starters = new Set();
        for (const pos in _byPos) {
          _byPos[pos].sort((a, b) => (b.overall || 0) - (a.overall || 0));
          const n = _RC_DEPTH[pos] || 1;
          for (let i = 0; i < Math.min(n, _byPos[pos].length); i++) _starters.add(_byPos[pos][i]);
        }
        for (const p of active) {
          const lbl = _rcLabel(p);
          if (p.draftSeason != null && p.draftSeason < 1) rcSynthCount++; else rcInSimCount++;
          (rcRoster[lbl] = rcRoster[lbl] || []).push(p.overall || 0);
          if (_starters.has(p)) (rcStarter[lbl] = rcStarter[lbl] || []).push(p.overall || 0);
        }
      }
      for (const p of active) {
        const o = p.overall || 0;
        leagueOvr.push(o); decadeOvr[dIdx].push(o);
        const _pp = p.position;
        if (_pp) {
          (POS_OVR[_pp] = POS_OVR[_pp] || []).push(o);
          (POS_AGE[_pp] = POS_AGE[_pp] || []).push(p.age || 0);
        }
        const rb = _roundBucket(p); (byRound[rb] = byRound[rb] || []).push(o);
        // Career peak (active-roster snapshot)
        if (!cpSeen.has(p.name)) {
          cpSeen.add(p.name);
          const cp = careerPeak.get(p.name);
          if (!cp) careerPeak.set(p.name, { round: rb, peakOvr: o, firstSeen: year });
          else if (o > cp.peakOvr) cp.peakOvr = o;
          // Career length — count distinct seasons on an active roster.
          const cl = careerLen.get(p.name);
          if (!cl) careerLen.set(p.name, { pos: p.position, seasons: 1, pers: p.personality || "normal" });
          else cl.seasons++;
        }
      }
    }
    // Sweep FA pool too — cut players still have their highest OVR yet
    for (const p of (franchise.freeAgents || [])) {
      if (cpSeen.has(p.name)) continue;
      cpSeen.add(p.name);
      const o = p.overall || 0;
      const rb = _roundBucket(p);
      const cp = careerPeak.get(p.name);
      if (!cp) careerPeak.set(p.name, { round: rb, peakOvr: o, firstSeen: year });
      else if (o > cp.peakOvr) cp.peakOvr = o;
    }
  }

  // Scan rosters AND the free-agent pool. A gem cut by _trimAiRostersToCap
  // (on PERCEIVED potential) lands in franchise.freeAgents — it must still be
  // tracked there or we'd lose any gem that washed through FA between drafts.
  // peakOvr carries across wherever the player lives, so emergence is captured
  // regardless of roster churn.
  function scanGems() {
    const pools = TEAMS.map(t => franchise.rosters[t.id] || []);
    pools.push(franchise.freeAgents || []);
    for (const pool of pools) {
      for (const p of pool) {
        if (p.hiddenGem && !seenGems.has(p.name)) {
          // round 0 = UDFA in _rollHiddenGem's rate table; tag it as 8 here so
          // the R6+ "Brady-tier" bucket (round >= 6) includes undrafted gems.
          const round = (p.draftRound === 0 || p.udfa) ? 8 : (p.draftRound ?? 99);
          seenGems.set(p.name, { round, peakOvr: p.overall, emerged: false });
          totalGemsRolled++;
        }
        if (seenGems.has(p.name)) {
          const g = seenGems.get(p.name);
          if (p.overall > g.peakOvr) g.peakOvr = p.overall;
          if (!g.emerged && g.peakOvr >= 96) {
            g.emerged = true;
            legendEmergences++;
            if (g.round >= 5) lateRoundLegends++;
            if (g.round >= 6) {
              bradyEmergences++;
              emergeByPos[p.position] = (emergeByPos[p.position] || 0) + 1;
              if (p.position === "QB") bradyQbEmergences++;   // the true Brady
            }
            // Stash the live player ref so we can dump the career at sim end.
            legendPlayers.push({ player: p, emergedSeason: franchise.season });
          }
        }
        // Star-tier capture — any player whose CURRENT OVR >= 90, gem or not.
        if ((p.overall || 0) >= 90) {
          const cur = starPlayers.get(p.name);
          if (!cur) starPlayers.set(p.name, { player: p, peakOvr: p.overall, peakSeason: franchise.season });
          else if (p.overall > cur.peakOvr) { cur.peakOvr = p.overall; cur.peakSeason = franchise.season; }
        }
      }
    }
  }

  // Drive the FULL faithful season cycle headlessly. The original loop tried
  // to walk the live phase machine but bailed before the DRAFT ever ran, so
  // _aiAutoPick → _rollHiddenGem never fired and 0 gems were ever rolled.
  //
  // CRITICAL: games must actually be PLAYED. A hidden gem's leap to legend
  // tier comes from _rerollPotentialForBreakouts() (a performance-gated jump
  // to 82-87% of its ceiling), which ranks players by mvpScore from
  // franchise.seasonStats — i.e. it needs real game production. A games-free
  // loop only gets the slow ~4-9/yr offseason grind, so gems age out around
  // OVR 90 and NOTHING ever reaches 96+. Skipping games silently zeroes the
  // emergence rate. So we sim every game + playoff round each season.
  //
  // Per-season chain (each step is the real primitive the UI routes through):
  //   frnSimToEndOfSeason        → sims all regular-season + playoff games →
  //                                builds seasonStats → fires in-season
  //                                breakouts → lands on the awards phase
  //   frnApbProceedToOffseason   → awards → offseason
  //   frnProceedToRosterChanges  → _runCoachingCarousel + runFrnOffseason
  //                                (ages, retires, GROWS existing gems)
  //   frnGoToDraft               → builds the draft class + pick order
  //   frnAutoDraftRemaining      → AI auto-picks every slot → ROLLS new gems
  //   frnNewSeason               → rolls stats to career, ages the college
  //                                pipeline, increments franchise.season
  //
  // Roster churn (cuts → FA → re-signs) already happens inside the real
  // offseason chain, so a low-perceived gem can still wash out naturally —
  // no need for the manual _trimAiRostersToCap call the games-free draft used.
  const t0 = Date.now();
  function step(fn, label, s) {
    if (typeof fn !== "function") return;
    try { fn(); } catch (e) { console.error("[brady] "+label+" threw (season "+s+"): "+e.message); }
  }
  // Async-aware step — the draft finalize/auto-pick chain is async (UI confirms
  // + frame yields). Calling it synchronously fire-and-forgets the part that
  // mints next year's picks + fills rosters → the draft-class cycling stalls
  // and rosters collapse. await it so the offseason actually completes.
  async function stepA(fn, label, s) {
    if (typeof fn !== "function") return;
    try { await fn(); } catch (e) { console.error("[brady] "+label+" threw async (season "+s+"): "+e.message); }
  }
  // ── INJURY CAPTURE ──────────────────────────────────────────────────
  // Injuries fire per game inside recordFranchiseResult: _rollGameInjuries
  // (contact / hit-driven) + _rollNonContactInjuries (stress / soft-tissue).
  // Both push to p.injuryHistory at assignment. We wrap the two rollers to
  // tally every injury the moment it's assigned, so players later cut or
  // retired are still counted (scanning end-of-sim rosters would miss them).
  const _inj = { total:0, contact:0, nonContact:0, careerEnding:0, catastrophic:0,
                 gamesMissed:0, weeks:[], byPos:{}, byLabel:{}, byCulture:{}, byTrainer:{} };
  const _cultTS = {}, _trnTS = {};   // team-seasons by HC culture / trainer trait (rate denominators)
  function _hcCulture(teamId) { const c = franchise.coaches && franchise.coaches[teamId]; return (c && c.hc && c.hc.cultureTrait) || "(none)"; }
  function _trainerTrait(teamId) { const f = franchise.frontOffice && franchise.frontOffice[teamId]; return (f && f.trainer && f.trainer.trait) || "(none)"; }
  function _tallyInjuriesFor(teamId) {
    const roster = (franchise.rosters && franchise.rosters[teamId]) || [];
    for (const p of roster) {
      const h = p.injuryHistory;
      if (!h || !h.length) continue;
      const last = h[h.length - 1];
      if (!last || last._aud) continue;
      if (last.season !== franchise.season || last.week !== franchise.week) continue;
      last._aud = true;
      _inj.total++;
      if (last.cause === "non_contact") _inj.nonContact++; else _inj.contact++;
      if (last.careerEnding) _inj.careerEnding++;
      if (last.catastrophic) _inj.catastrophic++;
      const wks = last.weeks || last.duration || 0;
      _inj.weeks.push(wks);
      _inj.gamesMissed += Math.min(wks, 18);   // cap season-ending (99 wk) at one season
      const pos = p.position || "?";
      _inj.byPos[pos] = (_inj.byPos[pos] || 0) + 1;
      _inj.byLabel[last.label] = (_inj.byLabel[last.label] || 0) + 1;
      const cult = _hcCulture(teamId), trn = _trainerTrait(teamId);
      _inj.byCulture[cult] = (_inj.byCulture[cult] || 0) + 1;
      _inj.byTrainer[trn] = (_inj.byTrainer[trn] || 0) + 1;
    }
  }
  if (typeof _rollGameInjuries === "function") {
    const _origRGI = _rollGameInjuries;
    _rollGameInjuries = function (id) { const r = _origRGI(id); _tallyInjuriesFor(id); return r; };
  }
  if (typeof _rollNonContactInjuries === "function") {
    const _origRNC = _rollNonContactInjuries;
    _rollNonContactInjuries = function (id) { const r = _origRNC(id); _tallyInjuriesFor(id); return r; };
  }

  // ── FRANCHISE SYSTEMS capture (stress / personality / salary cap) ──
  const _stress = { QB:[], RB:[], WR:[], TE:[], OL:[], DL:[], LB:[], CB:[], S:[], K:[], P:[] };
  const _pers = {};                          // personality → count (final-season rosters)
  const _persLen = {};                       // personality → { n, seasonsSum } from careerLen
  const _cap = { teams:0, util:[], capTotal:0 };
  function snapshotSystems(year, isFinal) {
    // Per-season team-seasons by HC culture + trainer (injury-rate denominators).
    for (const t of TEAMS) { _cultTS[_hcCulture(t.id)] = (_cultTS[_hcCulture(t.id)]||0)+1; _trnTS[_trainerTrait(t.id)] = (_trnTS[_trainerTrait(t.id)]||0)+1; }
    if (!isFinal) return;
    for (const t of TEAMS) {
      const roster = franchise.rosters[t.id] || [];
      let payroll = 0;
      for (const p of roster) {
        if (_stress[p.position]) _stress[p.position].push(p._stress || 0);
        const pk = p.personality || "normal"; _pers[pk] = (_pers[pk]||0)+1;
        payroll += (typeof currentYearCapHit === "function")
          ? currentYearCapHit(p)
          : (p.salary || (p.contract && p.contract.aav) || 0);
      }
      const cap = franchise.salaryCap || 0;
      if (cap > 0) { _cap.teams++; _cap.util.push(100*payroll/cap); _cap.capTotal = cap; }
    }
  }
  for (let s = 0; s < ${SEASONS}; s++) {
    // Play the season: regular games + full playoff bracket → awards phase.
    step(typeof frnSimToEndOfSeason !== "undefined" && frnSimToEndOfSeason, "simSeason", s);
    // CRITICAL: showFrnAwards is the canonical season-end function — it runs
    // _processSeasonEndRetirements (aging + retire + the GEM BREAKOUT reroll
    // that's the ONLY path to 96+) AND _stampSeasonAccolades (MVP / All-Pro /
    // Pro Bowl / Super Bowl rings → careerHistory[].accolades). Calling
    // _processSeasonEndRetirements alone gets the OVR pipeline working but
    // attaches ZERO accolades to legends. The live game routes through
    // showFrnAwards after the Super Bowl; pb.champion is already set by
    // frnSimToEndOfSeason, so this call has all the inputs it needs. Render
    // side writes HTML to the DOM stub (benign no-op).
    step(typeof showFrnAwards !== "undefined" && showFrnAwards, "showFrnAwards", s);
    // All regular + playoff games for this season are now played — fold the
    // per-player season totals into the single-season record book, then reset.
    _foldSeasonRecords();
    _captureAwards();           // tally this season's MVP/All-Pro/etc winners
    snapshotStandings(s + 1);   // capture win% + champion before frnNewSeason resets
    snapshotDepth(s + 1, s === ${SEASONS} - 1);   // positional depth + (final yr) top lists
    snapshotSystems(s + 1, s === ${SEASONS} - 1);  // coach-season tally + (final) stress/personality/cap
    // awards → offseason (frnApbProceedToOffseason wraps startFrnOffseason and
    // dismisses the all-pro-bowl crowning; fall back to startFrnOffseason).
    if (franchise.phase === "awards") {
      if (typeof frnApbProceedToOffseason === "function") step(frnApbProceedToOffseason, "toOffseason", s);
      else step(typeof startFrnOffseason !== "undefined" && startFrnOffseason, "startOffseason", s);
    }
    step(typeof frnProceedToRosterChanges !== "undefined" && frnProceedToRosterChanges, "rosterChanges", s);
    step(typeof frnGoToDraft !== "undefined" && frnGoToDraft, "goToDraft", s);
    await stepA(typeof frnAutoDraftRemaining !== "undefined" && frnAutoDraftRemaining, "autoDraft", s);
    // CRITICAL: finalize the draft. frnAutoDraftRemaining only makes the draft
    // picks — it does NOT run _draftFinalize, which (a) fills roster gaps with
    // UDFAs, (b) runs UDFA AI claims so undrafted gems land on teams, and most
    // importantly (c) CONSUMES this year's pick rows and MINTS the next future
    // year's. Without this, the pick inventory (seeded with only 3 years at
    // startFranchise) is never replenished — so from the 4th season on,
    // _buildDraftPickOrder finds no pick rows and EVERY regular slot is skipped,
    // collapsing the draft to UDFA-only. frnDraftFinishScramble runs the UDFA
    // claims and calls _draftFinalize internally.
    await stepA(typeof frnDraftFinishScramble !== "undefined" && frnDraftFinishScramble, "finishDraft", s);
    // Final cuts to 53. The harness chain skips the live free-agency / training-
    // camp-cuts phases, so without this rosters bloat (~81 over 40 seasons) and
    // the top-53 snapshot cherry-picks upward, inflating the OVR distribution.
    // _trimAiRostersToCap cuts on PERCEIVED value → low-perceived gems can still
    // wash out to FA (realistic), where scanGems still tracks them.
    if (typeof _trimAiRostersToCap === "function") {
      try { _trimAiRostersToCap(53, { includeUser: true }); } catch (e) { console.error("[brady] trim threw (season "+s+"): "+e.message); }
    }
    // Snapshot BEFORE the season rolls over so a gem drafted this cycle is
    // recorded even if it's cut before next season; scanGems runs again after.
    scanGems();
    step(typeof frnNewSeason !== "undefined" && frnNewSeason, "newSeason", s);
    scanGems();
    snapshotLeagueOvr(s + 1);   // record this season's active-roster OVR spread
    if ((s+1) % 10 === 0) {
      console.error("  ...season "+(s+1)+"/"+${SEASONS}+" — gems rolled "+totalGemsRolled+", legends "+legendEmergences+", Brady-tier "+bradyEmergences+" ("+((Date.now()-t0)/1000).toFixed(0)+"s)");
    }
  }

  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" BRADY-TEST AUDIT — " + ${SEASONS} + " seasons");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  Hidden gems rolled (any round, any ceiling): " + totalGemsRolled);
  console.log("  Legend-tier emergences (gem hit 96+ OVR):     " + legendEmergences);
  console.log("  Late-round legends (R5+ or UDFA):             " + lateRoundLegends);
  console.log("  Late-round legends — R6+/UDFA, ALL positions: " + bradyEmergences);
  console.log("");
  // Two distinct cadences (these were conflated before): the QB-specific Brady
  // is once-a-generation; late-round legends across ALL positions (Terrell Davis
  // RB, Gates/Sharpe TE, Sherman CB, Harrison LB...) are far more common.
  const _cad = n => n > 0 ? ("1 per " + (${SEASONS}/n).toFixed(0) + " yrs") : "none";
  console.log("  ── TRUE BRADY (R6+/UDFA QB → 96+): " + bradyQbEmergences + "  (" + _cad(bradyQbEmergences) + ", target ~1 per 75 yrs) ──");
  const qbOk = bradyQbEmergences > 0 && Math.abs((${SEASONS}/bradyQbEmergences) - 75) / 75 < 0.6;
  console.log("       " + (bradyQbEmergences === 0 ? "!! (none in " + ${SEASONS} + " yrs — need a longer run or dev too weak)" : (qbOk ? "OK" : "!! off target")));
  console.log("  ── ALL-POSITION late-round legends: " + bradyEmergences + "  (" + _cad(bradyEmergences) + ") ──");
  if (Object.keys(emergeByPos).length) {
    const byp = Object.entries(emergeByPos).sort((a,b)=>b[1]-a[1])
      .map(([k,v]) => k + " " + v + " (" + _cad(v) + ")").join(",  ");
    console.log("       by position: " + byp);
  }
  console.log("");

  // ── RECORD BOOK ───────────────────────────────────────────────────────
  function topN(cat, n) {
    return [...career.entries()]
      .map(([name, r]) => ({ name, val: r[cat] || 0, games: r.games }))
      .filter(x => x.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, n);
  }
  console.log("══════════════════════════════════════════════════════════");
  console.log(" RECORD BOOK — " + ${SEASONS} + " seasons (" + career.size.toLocaleString() + " players tracked)");
  console.log("══════════════════════════════════════════════════════════");
  console.log(" CAREER LEADERS (top 3)");
  console.log(" " + "-".repeat(54));
  for (const [cat, label] of CATS) {
    const top = topN(cat, 3);
    if (!top.length) continue;
    const line = top.map((x, i) => (i+1) + ". " + x.name + " (" + x.val.toLocaleString() + ")").join("   ");
    console.log(" " + label.padEnd(13) + " " + line);
  }
  console.log("");
  console.log(" SINGLE-SEASON HIGHS                 SINGLE-GAME HIGHS");
  console.log(" " + "-".repeat(54));
  for (const [cat, label] of CATS) {
    const sr = seasonRec[cat], gr = gameRec[cat];
    const sStr = sr ? (sr.val.toLocaleString() + " — " + sr.name + " (S" + sr.season + ")") : "—";
    const gStr = gr ? (gr.val.toLocaleString() + " — " + gr.name + " (S" + gr.season + ")") : "—";
    console.log(" " + label.padEnd(13) + " " + sStr.padEnd(22).slice(0,22) + "  " + gStr);
  }
  console.log("");

  // ── BEST SINGLE SEASON BY POSITION (real players, all 11 positions) ──
  console.log("══════════════════════════════════════════════════════════");
  console.log(" BEST SINGLE SEASON BY POSITION — best individual season at each spot");
  console.log("══════════════════════════════════════════════════════════");
  const _statLine = (pos, r) => {
    const n = (k) => Math.round(r[k] || 0).toLocaleString();
    switch (pos) {
      case "QB": return n("pass_yds")+" yds, "+n("pass_td")+" TD, "+n("pass_int")+" INT";
      case "RB": return n("rush_yds")+" yds, "+n("rush_td")+" TD"+(r.rec_yds?(", "+n("rec_yds")+" rec yds"):"");
      case "WR": case "TE": return n("rec")+" rec, "+n("rec_yds")+" yds, "+n("rec_td")+" TD";
      case "OL": return n("pancakes")+" pancakes";
      case "DL": return n("sk")+" sacks, "+n("tkl")+" tkl"+(r.ff?(", "+n("ff")+" FF"):"");
      case "LB": return n("tkl")+" tkl, "+n("sk")+" sacks"+(r.int_made?(", "+n("int_made")+" INT"):"");
      case "CB": case "S": return n("int_made")+" INT, "+n("pd")+" PD, "+n("tkl")+" tkl"+(r.def_td?(", "+n("def_td")+" TD"):"");
      case "K": return n("fg_made")+" FG made";
      case "P": return n("punt_yds")+" punt yds, "+n("punts")+" punts";
      default: return "";
    }
  };
  for (const pos of ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"]) {
    const b = bestSeasonByPos[pos];
    if (!b) { console.log(" " + pos.padEnd(3) + "  —"); continue; }
    console.log(" " + pos.padEnd(3) + "  " + (b.name + " (S" + b.season + ")").padEnd(32) + " " + _statLine(pos, b.line));
  }
  console.log("");

  // ── LEAGUE OVR DISTRIBUTION (active rosters, pooled over all seasons) ──
  if (leagueOvr.length) {
    const a = leagueOvr.slice().sort((x, y) => x - y);
    const n = a.length;
    const mean = a.reduce((s, v) => s + v, 0) / n;
    const qd = (p) => a[Math.min(n - 1, Math.floor(p * n))];
    const buckets = {};
    for (let b = 40; b < 100; b += 5) buckets[b] = 0;
    for (const o of a) { const b = Math.min(95, Math.floor(o / 5) * 5); buckets[b] = (buckets[b] || 0) + 1; }
    let maxC = 0; for (const k in buckets) maxC = Math.max(maxC, buckets[k]);
    const pct = (c) => (c / n * 100).toFixed(1) + "%";
    console.log("══════════════════════════════════════════════════════════");
    console.log(" LEAGUE OVR DISTRIBUTION — active rosters, all " + ${SEASONS} + " seasons");
    console.log(" (" + n.toLocaleString() + " player-seasons · mean roster size " + (rosterSizeSum / Math.max(1, rosterSizeN)).toFixed(0) + ")");
    console.log("══════════════════════════════════════════════════════════");
    for (let b = 40; b < 100; b += 5) {
      const c = buckets[b] || 0;
      console.log(" " + b + "-" + (b + 4) + " " + pct(c).padStart(6) + " " + "█".repeat(Math.round(c / maxC * 40)));
    }
    console.log(" mean=" + mean.toFixed(1) + "  P10=" + qd(.10) + " P25=" + qd(.25) + " P50=" + qd(.50) +
                " P75=" + qd(.75) + " P90=" + qd(.90) + " P99=" + qd(.99) + "  max=" + a[n - 1]);
    console.log(" elite share: 90+=" + pct(a.filter(o => o >= 90).length) +
                "  95+=" + pct(a.filter(o => o >= 95).length) +
                "  99=" + a.filter(o => o >= 99).length + " player-seasons");
    console.log("");
    // Per-decade drift — isolates real league OVR creep from roster-bloat
    // artifacts. Stable mean + elite share across decades = no creep.
    console.log(" DRIFT BY DECADE (mean / P50 / P90 / 90+% / 95+%)");
    console.log(" " + "-".repeat(54));
    for (let d = 0; d < decadeOvr.length; d++) {
      const arr = decadeOvr[d];
      if (!arr.length) continue;
      const s2 = arr.slice().sort((x, y) => x - y), m2 = arr.length;
      const mn = (s2.reduce((s, v) => s + v, 0) / m2).toFixed(1);
      const lab = "Yr " + (d * 10 + 1) + "-" + (d * 10 + 10);
      console.log(" " + lab.padEnd(9) + " " + mn.padStart(5) +
                  " / " + s2[Math.floor(0.50 * m2)] +
                  " / " + s2[Math.floor(0.90 * m2)] +
                  " / " + (arr.filter(o => o >= 90).length / m2 * 100).toFixed(1) + "%" +
                  " / " + (arr.filter(o => o >= 95).length / m2 * 100).toFixed(1) + "%");
    }
    console.log("");
    // OVR by draft round — does the league reflect pedigree? Mean OVR should
    // step down from R1 → R7 → UDFA. Late-round max OVR + 90+% are the gem-
    // emergence signal (a R6 hitting 96+ is a Brady; UDFA outliers = Kurt Warner).
    const rOrder = [1,2,3,4,5,6,7,8,9];
    const rLabel = {1:"R1",2:"R2",3:"R3",4:"R4",5:"R5",6:"R6",7:"R7",8:"UDFA",9:"INITIAL"};
    if (Object.keys(byRound).length) {
      console.log(" OVR BY DRAFT ROUND (mean / P50 / P90 / max / 90+% / 95+% / n)");
      console.log(" " + "-".repeat(64));
      for (const r of rOrder) {
        const arr = byRound[r]; if (!arr || !arr.length) continue;
        const s3 = arr.slice().sort((x, y) => x - y), m3 = arr.length;
        const mn = (s3.reduce((s, v) => s + v, 0) / m3).toFixed(1);
        const p50 = s3[Math.floor(0.50 * m3)];
        const p90 = s3[Math.floor(0.90 * m3)];
        const mx = s3[m3 - 1];
        const e90 = (arr.filter(o => o >= 90).length / m3 * 100).toFixed(1);
        const e95 = (arr.filter(o => o >= 95).length / m3 * 100).toFixed(1);
        console.log(" " + rLabel[r].padEnd(8) + " " + mn.padStart(5) +
                    " / " + String(p50).padStart(2) +
                    " / " + String(p90).padStart(2) +
                    " / " + String(mx).padStart(2) +
                    " / " + (e90 + "%").padStart(5) +
                    " / " + (e95 + "%").padStart(5) +
                    " / " + m3.toLocaleString().padStart(7));
      }
      console.log("");
    }

    // ── BUST / HIT RATES BY DRAFT ROUND ─────────────────────────────────
    // Uses each player's CAREER PEAK OVR (max across all snapshots), so we're
    // measuring "did they ever pan out" — not whether they're elite right now.
    // Round-tiered BUST thresholds match NFL draft expectation: an R1 expected
    // to start (<78 = bust); a R7 only expected to crack a roster (<68 = bust).
    // HIT thresholds are uniform so cross-round comparison is clean:
    //   STARTER >= 75   (cracked starter quality somewhere in career)
    //   STRONG  >= 80   (became a solid starter)
    //   PB      >= 85   (Pro Bowl tier)
    //   ELITE   >= 90, SUPER >= 95 already in the OVR-by-round table above.
    // Only counts players seen at least 2 seasons before the final season,
    // so active-developing rookies don't pollute the bust count.
    const bustThresh = { 1:78, 2:75, 3:73, 4:71, 5:70, 6:68, 7:68, 8:67, 9:0 };
    const finalYear = ${SEASONS};
    const byRoundCareer = {};
    for (const cp of careerPeak.values()) {
      if (cp.round === 9) continue;                          // skip initial-gen
      if (cp.firstSeen > finalYear - 2) continue;            // active rookies — too early to call
      (byRoundCareer[cp.round] = byRoundCareer[cp.round] || []).push(cp.peakOvr);
    }
    if (Object.keys(byRoundCareer).length) {
      console.log(" BUST / HIT RATES BY DRAFT ROUND (career peak OVR; n = players)");
      console.log(" Bust = peak below round expectation. Hits = peak >= threshold.");
      console.log(" " + "-".repeat(64));
      console.log(" " + "ROUND".padEnd(7) + "BUST%   STARTER%(75+)  STRONG%(80+)  PB%(85+)    n");
      console.log(" " + "-".repeat(64));
      for (const r of rOrder) {
        const arr = byRoundCareer[r]; if (!arr || !arr.length) continue;
        const m4 = arr.length;
        const bust = (arr.filter(o => o < bustThresh[r]).length / m4 * 100).toFixed(1);
        const h75  = (arr.filter(o => o >= 75).length / m4 * 100).toFixed(1);
        const h80  = (arr.filter(o => o >= 80).length / m4 * 100).toFixed(1);
        const h85  = (arr.filter(o => o >= 85).length / m4 * 100).toFixed(1);
        console.log(" " + rLabel[r].padEnd(7) +
                    (bust + "% (<" + bustThresh[r] + ")").padEnd(12) +
                    (h75 + "%").padStart(8) +
                    (h80 + "%").padStart(14) +
                    (h85 + "%").padStart(13) +
                    m4.toLocaleString().padStart(8));
      }
      console.log("");
    }
  }

  // ── TIER 3: FRANCHISE HEALTH (competitive balance over the sim) ─────────
  if (seasonStandings.length) {
    const teamPcts = [];                  // every team-season win%
    const titles = {};                    // tid → # championships
    for (const ss of seasonStandings) {
      for (const tid of Object.keys(ss.winPct)) teamPcts.push(ss.winPct[tid]);
      if (ss.champId != null) titles[ss.champId] = (titles[ss.champId] || 0) + 1;
    }
    teamPcts.sort((a, b) => a - b);
    const tn = teamPcts.length;
    const tq = p => teamPcts[Math.min(tn - 1, Math.floor(p * tn))];
    // Standings persistence — Pearson r of a team's win% in year N vs N+1.
    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0, np = 0;
    for (let i = 1; i < seasonStandings.length; i++) {
      const prev = seasonStandings[i - 1].winPct, cur = seasonStandings[i].winPct;
      for (const tid of Object.keys(cur)) {
        if (prev[tid] == null) continue;
        const x = prev[tid], y = cur[tid];
        sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; np++;
      }
    }
    const r = np ? (np * sxy - sx * sy) / (Math.sqrt((np * sxx - sx * sx) * (np * syy - sy * sy)) || 1) : 0;
    // Worst-to-first: bottom-8 win% one year → top-4 the next.
    let w2f = 0, w2fOpps = 0;
    for (let i = 1; i < seasonStandings.length; i++) {
      const prev = seasonStandings[i - 1].winPct, cur = seasonStandings[i].winPct;
      const sortedPrev = Object.entries(prev).sort((a, b) => a[1] - b[1]).map(e => e[0]);
      const sortedCur  = Object.entries(cur).sort((a, b) => b[1] - a[1]).map(e => e[0]);
      const bottom8 = new Set(sortedPrev.slice(0, 8));
      const top4 = new Set(sortedCur.slice(0, 4));
      for (const tid of bottom8) { w2fOpps++; if (top4.has(tid)) w2f++; }
    }
    const titleCounts = Object.values(titles).sort((a, b) => b - a);
    const uniqueChamps = titleCounts.length;
    const maxTitles = titleCounts[0] || 0;
    const repeatChamps = titleCounts.filter(c => c >= 2).length;
    console.log("══════════════════════════════════════════════════════════");
    console.log(" FRANCHISE HEALTH — competitive balance over " + seasonStandings.length + " seasons");
    console.log("══════════════════════════════════════════════════════════");
    const FH = [
      ["Best team win% (P99 season)", tq(0.99)*100, 76, 90, v=>v.toFixed(0)+"%"],
      ["Worst team win% (P01 season)", tq(0.01)*100, 10, 24, v=>v.toFixed(0)+"%"],
      ["Win% spread P90-P10", (tq(0.90)-tq(0.10))*100, 30, 55, v=>v.toFixed(0)+"pts"],
      ["Yr-to-yr persistence (r)", r, 0.30, 0.65, v=>v.toFixed(2)],
      ["Worst-to-first rate", w2fOpps?w2f/w2fOpps*100:0, 3, 12, v=>v.toFixed(1)+"%"],
      ["Unique champions / " + seasonStandings.length + "yr", uniqueChamps, Math.round(seasonStandings.length*0.45), seasonStandings.length, v=>v.toFixed(0)],
      ["Repeat champions (2+ titles)", repeatChamps, 1, Math.max(2,Math.round(seasonStandings.length*0.25)), v=>v.toFixed(0)],
      ["Most titles by one team", maxTitles, 2, Math.max(3,Math.round(seasonStandings.length*0.15)), v=>v.toFixed(0)],
    ];
    console.log(" "+"METRIC".padEnd(30)+" "+"SIM".padStart(7)+"   "+"NFL-ish BAND".padStart(13)+"  FLAG");
    console.log(" "+"-".repeat(64));
    let fhOk = 0;
    for (const [label,val,lo,hi,fmt] of FH) {
      const ok = val>=lo && val<=hi; if (ok) fhOk++;
      console.log(" "+label.padEnd(30)+" "+fmt(val).padStart(7)+"   "+(fmt(lo)+"-"+fmt(hi)).padStart(13)+"   "+(ok?"OK":"!!"));
    }
    console.log(" "+"-".repeat(64));
    console.log(" "+fhOk+"/"+FH.length+" in range\\n");
  }

  // ── POSITIONAL DEPTH (how many elite at one time + top-10 OVR range) ────
  if (posDepth.QB.t1.length) {
    const avg = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
    console.log("══════════════════════════════════════════════════════════");
    console.log(" POSITIONAL DEPTH — per-season snapshot, averaged over the sim");
    console.log("══════════════════════════════════════════════════════════");
    console.log(" POS   #90+   #85+   |  #1 OVR  #5 OVR  #10 OVR   (NFL QB: ~6-8 @90+, top10 ~99→86)");
    console.log(" "+"-".repeat(64));
    for (const P of POSN) {
      const d = posDepth[P];
      console.log(" "+P.padEnd(4)+" "+avg(d.n90).toFixed(1).padStart(5)+" "+avg(d.n85).toFixed(1).padStart(6)+"   |  "+
                  avg(d.t1).toFixed(0).padStart(5)+"   "+avg(d.t5).toFixed(0).padStart(5)+"   "+avg(d.t10).toFixed(0).padStart(5));
    }
    console.log("");
  }

  // ── POSITIONAL OVR DISTRIBUTION (full player-season pool, all positions) ──
  // Per-position census across every active-roster snapshot in the sim. Catches
  // position-specific inflation that the league aggregate hides (e.g. CB tier
  // running hot independent of QB). count = player-seasons; OVR stats are the
  // distribution of that pool.
  if (Object.keys(POS_OVR).length) {
    const _q = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x,y)=>x-y); return s[Math.min(s.length-1, Math.floor(s.length*p))]; };
    const _avg = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
    const _shr = (a, t) => a.length ? 100 * a.filter(v=>v>=t).length / a.length : 0;
    console.log("══════════════════════════════════════════════════════════");
    console.log(" POSITIONAL OVR DISTRIBUTION — full player-season pool per position");
    console.log("══════════════════════════════════════════════════════════");
    console.log(" POS     n   mean  P10  med  P90   max   age   90+%   85+%   75+%");
    console.log(" "+"-".repeat(70));
    const allPos = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
    for (const P of allPos) {
      const a = POS_OVR[P]; if (!a || !a.length) continue;
      const ages = POS_AGE[P] || [];
      console.log(" "+P.padEnd(4)+" "+String(a.length).padStart(6)+"  "
        +_avg(a).toFixed(1).padStart(4)+" "
        +String(_q(a,.10)).padStart(4)+" "+String(_q(a,.50)).padStart(4)+" "+String(_q(a,.90)).padStart(4)+"   "
        +String(_q(a,.999)).padStart(3)+"   "
        +_avg(ages).toFixed(1).padStart(4)+"  "
        +_shr(a,90).toFixed(1).padStart(5)+"%  "
        +_shr(a,85).toFixed(1).padStart(5)+"%  "
        +_shr(a,75).toFixed(1).padStart(5)+"%");
    }
    console.log("");

    // ── CALIBRATION LUT (S1 of TALENT_RATING_ARCHITECTURE.md) ──
    // Per-position raw-OVR quantile LUT, machine-readable, so Layer-1
    // calibration (CALIBRATE[pos]) can be fit to map each position's raw
    // distribution onto one common within-position target shape. Dumps the
    // pooled raw player.overall quantiles at the knots the quantile-map needs.
    const _qExact = (a, p) => {
      if (!a.length) return 0;
      const s = a.slice().sort((x,y)=>x-y);
      const idx = Math.min(s.length-1, Math.max(0, Math.round((s.length-1)*p)));
      return s[idx];
    };
    const KNOTS = [0.01,0.02,0.05,0.10,0.20,0.30,0.40,0.50,0.60,0.70,0.80,0.90,0.95,0.98,0.99];
    console.log("══════════════════════════════════════════════════════════");
    console.log(" CALIBRATION LUT — raw per-position OVR quantiles (knots: "+KNOTS.join(",")+")");
    console.log("══════════════════════════════════════════════════════════");
    const lut = {};
    for (const P of allPos) {
      const a = POS_OVR[P]; if (!a || !a.length) continue;
      lut[P] = { n: a.length, q: KNOTS.map(k => _qExact(a, k)) };
    }
    console.log("CALIB_LUT_JSON " + JSON.stringify(lut));
    // Also the pooled ALL-position distribution = the natural common target shape.
    const _allOvr = [];
    for (const P of allPos) { const a = POS_OVR[P]; if (a) for (const v of a) _allOvr.push(v); }
    if (_allOvr.length) {
      console.log("CALIB_TARGET_JSON " + JSON.stringify({ n:_allOvr.length, q: KNOTS.map(k => _qExact(_allOvr, k)) }));
    }
    console.log("");
  }

  // ── LEAGUE LEADERS RIGHT NOW (final-season snapshot, with stats) ────────
  if (leagueTop.length) {
    console.log("══════════════════════════════════════════════════════════");
    console.log(" TOP 15 PLAYERS IN THE LEAGUE — final season (any position)");
    console.log("══════════════════════════════════════════════════════════");
    leagueTop.forEach((p,i)=>console.log(" "+String(i+1).padStart(2)+". "+(p.ovr+" "+p.pos).padEnd(7)+" "+(p.name+" ("+p.age+")").padEnd(28)+" "+p.line));
    console.log("");
  }
  if (qbTop.length) {
    console.log("══════════════════════════════════════════════════════════");
    console.log(" TOP 10 QBs — final season (OVR range = #1 vs #10)");
    console.log("══════════════════════════════════════════════════════════");
    qbTop.forEach((p,i)=>console.log(" "+String(i+1).padStart(2)+". OVR "+String(p.ovr).padStart(2)+"  "+(p.name+" ("+p.age+")").padEnd(28)+" "+p.line));
    console.log("");
  }

  // ── ROSTER CONSTRUCTION BY DRAFT ROUND (final-season snapshot) ──
  if (Object.keys(rcRoster).length) {
    const _avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
    const ORDER = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "UDFA"];
    const totR = ORDER.reduce((s, r) => s + ((rcRoster[r] || []).length), 0) || 1;
    const totS = ORDER.reduce((s, r) => s + ((rcStarter[r] || []).length), 0) || 1;
    console.log("══════════════════════════════════════════════════════════");
    console.log(" ROSTER CONSTRUCTION BY DRAFT ROUND — final season, all 32 rosters");
    console.log("══════════════════════════════════════════════════════════");
    console.log(" RND    roster#  roster%  meanOVR  |  starter#  starter%  meanOVR");
    console.log(" " + "-".repeat(64));
    for (const r of ORDER) {
      const ra = rcRoster[r] || [], sa = rcStarter[r] || [];
      console.log(" " + r.padEnd(5)
        + String(ra.length).padStart(7)
        + (100 * ra.length / totR).toFixed(1).padStart(8) + "%"
        + _avg(ra).toFixed(1).padStart(8) + "   | "
        + String(sa.length).padStart(7)
        + (100 * sa.length / totS).toFixed(1).padStart(8) + "%"
        + _avg(sa).toFixed(1).padStart(8));
    }
    const _rcTot = rcSynthCount + rcInSimCount;
    console.log(" " + "-".repeat(64));
    console.log(" attribution check — synthetic (pre-S1) survivors: " + rcSynthCount + " / " + _rcTot
      + "   (~0 => round labels are clean true-draft; in-sim drafted: " + rcInSimCount + ")");
    console.log("");
  }

  // ── TIER 4: CAREER LENGTH BY POSITION ───────────────────────────────────
  // From careerPeak.firstSeen + each player's seasons in the league. We track
  // span via the seenGems/career data; reuse careerPeak's round + a seasons
  // tally we accumulate here from the per-season OVR snapshots.
  if (careerLen.size) {
    const byPosLen = {};
    for (const [name, info] of careerLen) {
      (byPosLen[info.pos] = byPosLen[info.pos] || []).push(info.seasons);
    }
    console.log("══════════════════════════════════════════════════════════");
    console.log(" CAREER LENGTH BY POSITION (seasons on an active roster)");
    console.log("══════════════════════════════════════════════════════════");
    console.log(" "+"POS".padEnd(5)+"mean  median  max   n     (NFL avg ~3.3 yrs, QB/K/P longest)");
    console.log(" "+"-".repeat(58));
    const posOrder = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
    for (const pos of posOrder) {
      const arr = byPosLen[pos]; if (!arr || !arr.length) continue;
      arr.sort((a,b)=>a-b);
      const mean = (arr.reduce((s,v)=>s+v,0)/arr.length).toFixed(1);
      const med = arr[Math.floor(arr.length/2)];
      console.log(" "+pos.padEnd(5)+mean.padStart(4)+"  "+String(med).padStart(6)+"  "+String(arr[arr.length-1]).padStart(3)+"  "+String(arr.length).padStart(5));
    }
    console.log("");
  }

  // ══ HALL OF RECORDS ════════════════════════════════════════════════════
  const _fmt = n => (n||0).toLocaleString();
  const _top = (obj, n) => Object.entries(obj).map(([name,c])=>({name,c})).sort((a,b)=>b.c-a.c).slice(0,n);

  // ── SINGLE-SEASON LEADERBOARDS (top 5 all-time) ──
  console.log("══════════════════════════════════════════════════════════");
  console.log(" SINGLE-SEASON LEADERBOARDS — top 5 over " + ${SEASONS} + " seasons");
  console.log("══════════════════════════════════════════════════════════");
  const _ssCats = [["pass_yds","Passing yds"],["pass_td","Passing TD"],["rush_yds","Rushing yds"],
    ["rush_td","Rushing TD"],["rec_yds","Receiving yds"],["rec_td","Receiving TD"],
    ["sk","Sacks"],["int_made","INTs"],["tkl","Tackles"]];
  for (const [k,label] of _ssCats) {
    const lb5 = seasonTop5[k]; if (!lb5 || !lb5.length) continue;
    console.log(" " + label.padEnd(13) + " " + lb5.map(e => _fmt(e.val)+" ("+e.name+" S"+e.season+")").join("  ·  "));
  }
  console.log("");

  // ── HALL OF FAME (from franchise.hallOfFame — persistent inductee records) ──
  const hof = (typeof franchise !== "undefined" && franchise.hallOfFame) ? franchise.hallOfFame : [];
  console.log("══════════════════════════════════════════════════════════");
  console.log(" HALL OF FAME — " + hof.length + " inductees over " + ${SEASONS} + " seasons");
  console.log("══════════════════════════════════════════════════════════");
  if (hof.length) {
    const byPos = {}; let firstBallot = 0;
    for (const h of hof) { byPos[h.pos] = (byPos[h.pos]||0)+1; if (h.firstBallot) firstBallot++; }
    console.log(" Rate: 1 per " + (${SEASONS}/hof.length).toFixed(1) + " yrs  ·  first-ballot " + (firstBallot/hof.length*100).toFixed(0) + "%  (NFL ~7-8/yr, FB ~15%)");
    console.log(" By position: " + Object.entries(byPos).sort((a,b)=>b[1]-a[1]).map(([p,c])=>p+" "+c).join("  "));
    // top 8 by peak OVR — the headliners, with résumé
    const head = hof.slice().sort((a,b)=>(b.peakOvr||0)-(a.peakOvr||0)).slice(0,8);
    console.log(" ── Headliners (by peak OVR) ──");
    for (const h of head) {
      const acc = {}; for (const row of (h.careerHistory||[])) for (const a of (row.accolades||[])) acc[a]=(acc[a]||0)+1;
      const accStr = ["MVP","Super Bowl","All-Pro","Pro Bowl"].filter(a=>acc[a]).map(a=>acc[a]+"× "+a).join(", ") || "—";
      console.log("   " + (h.name+" ("+h.pos+")").padEnd(26) + " peak " + (h.peakOvr||"?") + " · " + (h.careerYears||"?") + "yr · " + (h.line||"") );
      console.log("      " + accStr);
    }
  }
  console.log("");

  // ── AWARD HISTORY (most decorated) ──
  console.log("══════════════════════════════════════════════════════════");
  console.log(" AWARD HISTORY — most decorated (" + ${SEASONS} + " seasons)");
  console.log("══════════════════════════════════════════════════════════");
  for (const a of ["MVP","Super Bowl MVP","OPOY","DPOY","Super Bowl","All-Pro","Pro Bowl"]) {
    const m = awardCounts[a]; if (!m) continue;
    const total = Object.values(m).reduce((s,v)=>s+v,0);
    const top3 = _top(m, 3).map(e=>e.name+" ("+e.c+")").join(", ");
    console.log(" " + a.padEnd(14) + " " + String(total).padStart(4) + " awarded  ·  most: " + top3);
  }
  console.log("");

  // ── TEAM RECORDS ──
  console.log("══════════════════════════════════════════════════════════");
  console.log(" TEAM RECORDS");
  console.log("══════════════════════════════════════════════════════════");
  if (teamRecords.topPF.val) console.log(" Most points, season:  " + teamRecords.topPF.val + " — " + teamRecords.topPF.team + " (S" + teamRecords.topPF.season + ")   [NFL record 606]");
  if (teamRecords.topW.val)  console.log(" Most wins, season:    " + teamRecords.topW.val + " — " + teamRecords.topW.team + " (S" + teamRecords.topW.season + ")");
  {
    const titles = {}; for (const ss of seasonStandings) if (ss.champId!=null) titles[ss.champId]=(titles[ss.champId]||0)+1;
    const dyn = Object.entries(titles).sort((a,b)=>b[1]-a[1])[0];
    if (dyn) { const t = TEAMS.find(x=>String(x.id)===dyn[0]); console.log(" Most titles:          " + dyn[1] + " — " + (t?t.name:"?")); }
  }
  console.log("");

  // ── CAREER MILESTONES (counts reaching round numbers) ──
  console.log("══════════════════════════════════════════════════════════");
  console.log(" CAREER MILESTONES — players reaching the mark (" + career.size.toLocaleString() + " tracked)");
  console.log("══════════════════════════════════════════════════════════");
  const _ms = [["pass_yds",50000,"50k pass yds"],["pass_td",300,"300 pass TD"],
    ["rush_yds",10000,"10k rush yds"],["rush_td",100,"100 rush TD"],
    ["rec_yds",12000,"12k rec yds"],["rec_td",100,"100 rec TD"],
    ["sk",100,"100 sacks"],["int_made",50,"50 INTs"],["tkl",1000,"1000 tackles"]];
  for (const [k,mark,label] of _ms) {
    let n=0; for (const r of career.values()) if ((r[k]||0)>=mark) n++;
    console.log(" " + label.padEnd(16) + " " + n + " player" + (n===1?"":"s"));
  }
  console.log("");

  // ── LEGEND CAREERS ─────────────────────────────────────────────────────
  // Full career story for every player who reached OVR >= 96: per-season
  // table (age / team / OVR / position-relevant stats / accolades that year)
  // + career totals + accolade tally. The legend's player object is still
  // alive on a roster or in the FA pool — we kept the ref at emergence time.
  function _accoladeTally(p) {
    const all = [];
    for (const h of (p.careerHistory || [])) for (const a of (h.accolades || [])) all.push(a);
    const count = {};
    for (const a of all) count[a] = (count[a] || 0) + 1;
    // Order: SB, MVP, AP1, AP2, PB, position-specific, position-of-year, ROY, etc.
    const order = ["Super Bowl","MVP","Super Bowl MVP","OPOY","DPOY","OL of the Year","ST PoY",
                   "All-Pro","All-Pro (2nd)","Pro Bowl","ROY","Comeback POY","Breakout POY"];
    const parts = [];
    for (const a of order) if (count[a]) parts.push(count[a] + "× " + a);
    for (const a of Object.keys(count)) if (!order.includes(a)) parts.push(count[a] + "× " + a);
    return parts.length ? parts.join(", ") : "(none)";
  }
  // Per-position stat columns — pick the 3 fields most relevant to the role.
  function _statCols(pos) {
    if (pos === "QB") return [["pass_yds","PassY"], ["pass_td","TD"], ["pass_int","INT"]];
    if (pos === "RB") return [["rush_att","Att"], ["rush_yds","RushY"], ["rush_td","TD"], ["rec","Rec"], ["rec_yds","RecY"]];
    if (pos === "WR" || pos === "TE") return [["rec","Rec"], ["rec_yds","RecY"], ["rec_td","TD"]];
    if (pos === "OL") return [["pancakes","Pncks"], ["sacks_allowed","SkAlw"], [null, ""]];
    // Defense — engine fields tracked: tkl, sk, int_made, int_td, pd, ff, fr, def_td.
    // TFL exists in comments but is never assigned to a player line, so we don't
    // surface it. Pick 4 most representative per position.
    if (pos === "DL" || pos === "LB") return [["tkl","Tkl"], ["sk","Sk"], ["ff","FF"], ["fr","FR"]];
    if (pos === "CB" || pos === "S")  return [["tkl","Tkl"], ["int_made","INT"], ["pd","PD"], ["def_td","DefTD"]];
    if (pos === "K")  return [["fg_made","FGM"], ["fg_att","FGA"], ["fg_long","Long"]];
    if (pos === "P")  return [[null,""], [null,""], [null,""]];
    return [[null,""], [null,""], [null,""]];
  }
  if (legendPlayers.length) {
    console.log("══════════════════════════════════════════════════════════");
    console.log(" LEGEND CAREERS — " + legendPlayers.length + " player" + (legendPlayers.length === 1 ? "" : "s") + " reached OVR 96+");
    console.log("══════════════════════════════════════════════════════════");
    for (const { player: p, emergedSeason } of legendPlayers) {
      const hist = (p.careerHistory || []).slice().sort((a, b) => (a.season || 0) - (b.season || 0));
      const peak = hist.reduce((m, h) => Math.max(m, h.overall || h.ovr || 0), 0);
      const round = (p.draftRound === 0 || p.udfa) ? "UDFA" :
                    (p.draftRound != null ? ("R" + p.draftRound) : "?");
      const draftPick = p.draftPick != null ? " pick " + p.draftPick : "";
      const draftSeason = p.draftSeason != null ? "S" + p.draftSeason : "?";
      const careerYrs = hist.length ? (hist[0].season + "-" + hist[hist.length - 1].season + " (" + hist.length + " yrs)") : "—";
      console.log("");
      console.log(" " + p.name + "  (" + p.position + ")  ·  Drafted " + round + draftPick + ", " + draftSeason +
                  "  ·  Peak OVR " + peak + "  ·  Emerged S" + emergedSeason);
      console.log(" Career: " + careerYrs +
                  (p.age != null ? "  ·  Final age " + p.age : "") +
                  (p._retired ? " (retired)" : ""));
      console.log(" Honors: " + _accoladeTally(p));
      // Per-season table
      const cols = _statCols(p.position);
      const headerCells = ["S#","Age","Team","OVR"].concat(cols.filter(c => c[0]).map(c => c[1])).concat(["Accolades"]);
      console.log(" " + "-".repeat(72));
      console.log(" " + headerCells.map((c, i) => i < 4 ? c.padStart(4) : c.padStart(7)).join(" "));
      console.log(" " + "-".repeat(72));
      for (const h of hist) {
        const ovr = h.overall != null ? h.overall : (h.ovr != null ? h.ovr : "");
        const tm = (h.teamName || "—").slice(0, 12);
        const row = [String(h.season || "").padStart(4),
                     String(h.age || "").padStart(4),
                     tm.padEnd(12),
                     String(ovr).padStart(4)];
        for (const [k] of cols) {
          if (!k) continue;
          const v = (h[k] != null) ? h[k] : (h.playoff && h.playoff[k] != null ? h.playoff[k] : 0);
          row.push(String(v).padStart(7));
        }
        const accStr = (h.accolades && h.accolades.length) ? h.accolades.join(", ") : "";
        row.push(accStr);
        console.log(" " + row.join(" "));
      }
      // Career totals — pull from p.careerStats
      const cs = p.careerStats || {};
      const totals = [];
      for (const [k, label] of cols) {
        if (!k) continue;
        totals.push(label + " " + (cs[k] || 0).toLocaleString());
      }
      if (totals.length) console.log(" CAREER TOTALS:  " + totals.join("  ·  "));
    }
    console.log("");
  }

  // ── STAR CAREERS ──────────────────────────────────────────────────────
  // Top peak-90+ careers that NEVER crossed the 96+ legend bar. Catches the
  // Nasser/Peterson/Sherman tier of generational players who sustained near-
  // legend production without quite reaching the legend ceiling. Includes
  // archetype on the header line. Capped at top 15 by peak OVR to keep the
  // dump readable; per-season table is windowed to 8 seasons around the peak
  // for long careers.
  const _stars = Array.from(starPlayers.values())
    .filter(s => s.peakOvr < 96)              // legends already have their section
    .sort((a, b) => b.peakOvr - a.peakOvr)
    .slice(0, 15);
  if (_stars.length) {
    console.log("══════════════════════════════════════════════════════════");
    console.log(" STAR CAREERS — top " + _stars.length + " peak-90+ careers (non-legend)");
    console.log("══════════════════════════════════════════════════════════");
    for (const { player: p, peakOvr, peakSeason } of _stars) {
      const hist = (p.careerHistory || []).slice().sort((a, b) => (a.season || 0) - (b.season || 0));
      const round = (p.draftRound === 0 || p.udfa) ? "UDFA" :
                    (p.draftRound != null ? ("R" + p.draftRound) : "?");
      const draftPick = p.draftPick != null ? " pick " + p.draftPick : "";
      const draftSeason = p.draftSeason != null ? "S" + p.draftSeason : "?";
      const careerYrs = hist.length ? (hist[0].season + "-" + hist[hist.length - 1].season + " (" + hist.length + " yrs)") : "—";
      const arch = p.archetype || "—";
      console.log("");
      console.log(" " + p.name + "  (" + p.position + " · " + arch + ")  ·  Drafted " + round + draftPick + ", " + draftSeason +
                  "  ·  Peak OVR " + peakOvr + " (S" + peakSeason + ")");
      console.log(" Career: " + careerYrs +
                  (p.age != null ? "  ·  Final age " + p.age : "") +
                  (p._retired ? " (retired)" : ""));
      console.log(" Honors: " + _accoladeTally(p));
      const cols = _statCols(p.position);
      // For long careers, window to 8 seasons centered on the peak.
      const showHist = hist.length > 8
        ? (() => {
            const peakIdx = Math.max(0, hist.findIndex(h => (h.season || 0) === peakSeason));
            const start = Math.max(0, peakIdx - 3);
            const end = Math.min(hist.length, start + 8);
            return hist.slice(start, end);
          })()
        : hist;
      const headerCells = ["S#","Age","Team","OVR"].concat(cols.filter(c => c[0]).map(c => c[1])).concat(["Accolades"]);
      console.log(" " + "-".repeat(72));
      console.log(" " + headerCells.map((c, i) => i < 4 ? c.padStart(4) : c.padStart(7)).join(" "));
      console.log(" " + "-".repeat(72));
      if (hist.length > 8) console.log(" (showing " + showHist.length + "-yr peak window of " + hist.length + "-yr career)");
      for (const h of showHist) {
        const ovr = h.overall != null ? h.overall : (h.ovr != null ? h.ovr : "");
        const tm = (h.teamName || "—").slice(0, 12);
        const row = [String(h.season || "").padStart(4),
                     String(h.age || "").padStart(4),
                     tm.padEnd(12),
                     String(ovr).padStart(4)];
        for (const [k] of cols) {
          if (!k) continue;
          const v = (h[k] != null) ? h[k] : (h.playoff && h.playoff[k] != null ? h.playoff[k] : 0);
          row.push(String(v).padStart(7));
        }
        const accStr = (h.accolades && h.accolades.length) ? h.accolades.join(", ") : "";
        row.push(accStr);
        console.log(" " + row.join(" "));
      }
      const cs = p.careerStats || {};
      const totals = [];
      for (const [k, label] of cols) {
        if (!k) continue;
        totals.push(label + " " + (cs[k] || 0).toLocaleString());
      }
      if (totals.length) console.log(" CAREER TOTALS:  " + totals.join("  ·  "));
    }
    console.log("");
  }

  // ── INJURY REPORT ───────────────────────────────────────────────────
  {
    const teamSeasons = ${SEASONS} * 32;
    const perTS = n => n / teamSeasons;
    const ws = _inj.weeks.slice().sort((a, b) => a - b);
    const med = ws.length ? ws[Math.floor(ws.length * 0.5)] : 0;
    const p90 = ws.length ? ws[Math.floor(ws.length * 0.9)] : 0;
    const seasonEnding = ws.filter(w => w >= 8).length;   // out 8+ wks ≈ IR / season-ending
    console.log("");
    console.log("══════════════════════════════════════════════════════════");
    console.log(" INJURY REPORT — " + ${SEASONS} + " seasons (" + teamSeasons + " team-seasons)");
    console.log("══════════════════════════════════════════════════════════");
    const row = (label, val, lo, hi, fmt) => {
      const v = fmt ? fmt(val) : val;
      const flag = (lo != null) ? ((val < lo || val > hi) ? " !!" : " OK") : "";
      const band = (lo != null) ? ("   [" + lo + "-" + hi + "]") : "";
      console.log("  " + String(label).padEnd(32) + String(v).padStart(8) + band + flag);
    };
    row("Injuries / team-season",         perTS(_inj.total),        18, 42, v => v.toFixed(1));
    row("  contact (hit-driven)",         perTS(_inj.contact),      null, null, v => v.toFixed(1));
    row("  non-contact (soft tissue)",    perTS(_inj.nonContact),   null, null, v => v.toFixed(1));
    row("Non-contact share %",            100 * _inj.nonContact / Math.max(1, _inj.total), 28, 45, v => v.toFixed(1));
    row("Season-ending (8+wk)/team-szn",  perTS(seasonEnding),      4, 14, v => v.toFixed(1));
    row("Career-ending / team-season",    perTS(_inj.careerEnding), null, null, v => v.toFixed(2));
    row("Games missed / team-season",     perTS(_inj.gamesMissed),  null, null, v => v.toFixed(1));
    row("Median weeks out",               med,                      null);
    row("P90 weeks out",                  p90,                      null);
    console.log("  ── by position (injuries / team-season) ──");
    for (const pos of ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"]) {
      if (!_inj.byPos[pos]) continue;
      console.log("    " + pos.padEnd(5) + perTS(_inj.byPos[pos]).toFixed(2).padStart(6));
    }
    console.log("  ── most common injury types (% of all) ──");
    for (const [lab, n] of Object.entries(_inj.byLabel).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log("    " + String(lab).padEnd(16) + (100 * n / Math.max(1, _inj.total)).toFixed(1).padStart(5) + "%");
    }
    // Injury rate by HC culture trait (Disciplinarian should be lowest) + trainer
    console.log("  ── injuries / team-season by HC culture trait ──");
    for (const [c, n] of Object.entries(_inj.byCulture).sort((a,b)=>b[1]-a[1])) {
      const ts = _cultTS[c] || 0; if (ts < 3) continue;
      console.log("    " + String(c).padEnd(18) + (n/ts).toFixed(1).padStart(6) + "  (" + ts + " team-szn)");
    }
    console.log("  ── injuries / team-season by trainer trait ──");
    for (const [tr, n] of Object.entries(_inj.byTrainer).sort((a,b)=>b[1]-a[1])) {
      const ts = _trnTS[tr] || 0; if (ts < 3) continue;
      console.log("    " + String(tr).padEnd(18) + (n/ts).toFixed(1).padStart(6) + "  (" + ts + " team-szn)");
    }
  }

  // ── STRESS REPORT (final season rosters) ──
  {
    console.log("");
    console.log("══════════════════════════════════════════════════════════");
    console.log(" STRESS REPORT — final-season _stress (0-100) by position");
    console.log("══════════════════════════════════════════════════════════");
    console.log("   (stress drives NON-contact injuries; high-usage skill/box positions highest)");
    const _qq = (arr,p)=>{ if(!arr.length) return 0; const s=arr.slice().sort((a,b)=>a-b); return s[Math.min(s.length-1,Math.floor(p*s.length))]; };
    console.log("   " + "POS".padEnd(6) + "med".padStart(6) + "P90".padStart(6) + "max".padStart(6));
    for (const Pn of ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"]) {
      const a = _stress[Pn]; if (!a || !a.length) continue;
      console.log("   " + Pn.padEnd(6) + _qq(a,.5).toFixed(0).padStart(6) + _qq(a,.9).toFixed(0).padStart(6) + Math.max(...a).toFixed(0).padStart(6));
    }
  }

  // ── PERSONALITY REPORT (distribution + career length) ──
  {
    // Aggregate career length by personality from the careerLen map.
    for (const cl of careerLen.values()) {
      const k = cl.pers || "normal";
      (_persLen[k] || (_persLen[k] = { n:0, sum:0 }));
      _persLen[k].n++; _persLen[k].sum += cl.seasons;
    }
    console.log("");
    console.log("══════════════════════════════════════════════════════════");
    console.log(" PERSONALITY REPORT — distribution + avg career length");
    console.log("══════════════════════════════════════════════════════════");
    console.log("   (quiet_pro should live longest; gen rates captain 8/cancer 2/quiet_pro 12/showman 8/coachs_son 4%)");
    const _ptot = Object.values(_pers).reduce((n,v)=>n+v,0) || 1;
    console.log("   " + "PERSONALITY".padEnd(13) + "share%".padStart(8) + "avgCareer".padStart(11));
    for (const k of ["normal","captain","cancer","quiet_pro","showman","coachs_son"]) {
      const share = 100*(_pers[k]||0)/_ptot;
      const cl = _persLen[k]; const avg = cl && cl.n ? cl.sum/cl.n : 0;
      console.log("   " + k.padEnd(13) + share.toFixed(1).padStart(8) + avg.toFixed(2).padStart(11));
    }
  }

  // ── SALARY CAP REPORT ──
  {
    console.log("");
    console.log("══════════════════════════════════════════════════════════");
    console.log(" SALARY CAP — final-season payroll utilization");
    console.log("══════════════════════════════════════════════════════════");
    if (_cap.teams && _cap.util.length) {
      const u = _cap.util, mean = u.reduce((a,b)=>a+b,0)/u.length;
      const su = u.slice().sort((a,b)=>a-b);
      console.log("   Cap: " + _cap.capTotal.toLocaleString() + "   teams measured: " + _cap.teams);
      console.log("   Payroll/cap utilization — mean " + mean.toFixed(1) + "%  P10 " + su[Math.floor(0.1*su.length)].toFixed(1) + "%  P90 " + su[Math.floor(0.9*su.length)].toFixed(1) + "%");
      console.log("   (NFL teams run ~88-100% of cap; over 100% = needs restructure/cuts)");
    } else {
      console.log("   (no salary/cap data on roster players — cap system not populated in this build)");
    }
  }
  if (typeof process !== "undefined" && process.exit) process.exit(0);
})();
`;

let bundle = shim + extraConsts;
for (const f of files) {
  bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
}
bundle += harness;

new Function(bundle)();
