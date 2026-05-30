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
  var requestAnimationFrame = () => 0;
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
;(function brady() {
  if (typeof startFranchise !== "function") {
    console.error("startFranchise missing — franchise files didn't load");
    process.exit(1);
  }
  console.error("Franchise layer loaded. Starting Brady-test: " + ${SEASONS} + " seasons.");
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
  // Stat fields per engine _emptyLine: pass_yds/pass_td, rush_yds/rush_td,
  // rec_yds/rec_td, sk (sacks), tkl (tackles), int_made (INTs).
  const CATS = [
    ["pass_yds","Passing yds"], ["pass_td","Passing TD"],
    ["rush_yds","Rushing yds"], ["rush_td","Rushing TD"],
    ["rec_yds","Receiving yds"], ["rec_td","Receiving TD"],
    ["sk","Sacks"], ["int_made","INTs"], ["tkl","Tackles"],
  ];
  const career = new Map();          // name → { games, <cat sums> }
  let   seasonAcc = new Map();       // name → season sums (reset each season)
  const seasonRec = {};              // cat → { val, name, season }
  const gameRec   = {};              // cat → { val, name, season, opp }
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
  function _foldSeasonRecords() {
    for (const [name, r] of seasonAcc) {
      for (const [k] of CATS) {
        const v = r[k] || 0;
        if (v > 0 && (!seasonRec[k] || v > seasonRec[k].val)) {
          seasonRec[k] = { val: v, name, season: franchise.season };
        }
      }
    }
    seasonAcc = new Map();
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
  let bradyEmergences = 0;           // round >= 6 OR UDFA (the actual Brady definition)
  const seenGems = new Map();        // name → { round, peakOvr, emerged }

  // ── League OVR distribution over the whole sim ─────────────────────────
  // Each season, snapshot every team's ACTIVE roster (top-53 by OVR — the
  // players who'd actually be on the 53-man) and pool all the OVRs across all
  // seasons. This is the developed steady-state distribution as it played out,
  // from the games-based flow (bounded rosters), not a games-free artifact.
  // Also track mean roster size so we can see if rosters bloat (top-53 only
  // cherry-picks if the underlying rosters are much larger than 53).
  const leagueOvr = [];
  const decadeOvr = [[], [], [], [], [], [], [], []];  // per-decade OVR pools (index = (year-1)/10)
  // OVR by draft round, pooled across all seasons. p.draftRound: 1-7 for drafted
  // (set in _aiAutoPick at slot.round), 0 for UDFA (per _rollHiddenGem's rate
  // table), null/undefined for the initial generation. We bucket UDFA→8 and
  // null/0→9 for clarity. Late-round outliers in the right tail = emerged gems.
  const byRound = {};   // round → array of OVRs
  function _roundBucket(p) {
    const r = p.draftRound;
    if (r === 0 || p.udfa) return 8;        // UDFA
    if (r >= 1 && r <= 7) return r;
    return 9;                                // initial-gen / unknown
  }
  let rosterSizeSum = 0, rosterSizeN = 0;
  function snapshotLeagueOvr(year) {
    const dIdx = Math.min(decadeOvr.length - 1, Math.floor((year - 1) / 10));
    for (const t of TEAMS) {
      const full = franchise.rosters[t.id] || [];
      rosterSizeSum += full.length; rosterSizeN++;
      const active = full.slice().sort((a, b) => (b.overall || 0) - (a.overall || 0)).slice(0, 53);
      for (const p of active) {
        const o = p.overall || 0;
        leagueOvr.push(o); decadeOvr[dIdx].push(o);
        const rb = _roundBucket(p); (byRound[rb] = byRound[rb] || []).push(o);
      }
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
            if (g.round >= 6) bradyEmergences++;
          }
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
  for (let s = 0; s < ${SEASONS}; s++) {
    // Play the season: regular games + full playoff bracket → awards phase.
    step(typeof frnSimToEndOfSeason !== "undefined" && frnSimToEndOfSeason, "simSeason", s);
    // CRITICAL: process season-end retirements + the GEM BREAKOUT reroll. In
    // the live game this runs inside showFrnAwards() (the awards-screen render),
    // which the headless flow never calls. _processSeasonEndRetirements ages +
    // retires players AND calls _rerollPotentialForBreakouts() — the
    // performance-gated jump to 82-87% of a gem's ceiling that, combined with
    // the slow offseason grind, is the ONLY path to 96+. Without this call,
    // games are played but no breakout ever fires and 0 gems emerge. Must run
    // before frnProceedToRosterChanges, which assumes aging already happened.
    step(typeof _processSeasonEndRetirements !== "undefined" && _processSeasonEndRetirements, "seasonEnd", s);
    // All regular + playoff games for this season are now played — fold the
    // per-player season totals into the single-season record book, then reset.
    _foldSeasonRecords();
    // awards → offseason (frnApbProceedToOffseason wraps startFrnOffseason and
    // dismisses the all-pro-bowl crowning; fall back to startFrnOffseason).
    if (franchise.phase === "awards") {
      if (typeof frnApbProceedToOffseason === "function") step(frnApbProceedToOffseason, "toOffseason", s);
      else step(typeof startFrnOffseason !== "undefined" && startFrnOffseason, "startOffseason", s);
    }
    step(typeof frnProceedToRosterChanges !== "undefined" && frnProceedToRosterChanges, "rosterChanges", s);
    step(typeof frnGoToDraft !== "undefined" && frnGoToDraft, "goToDraft", s);
    step(typeof frnAutoDraftRemaining !== "undefined" && frnAutoDraftRemaining, "autoDraft", s);
    // CRITICAL: finalize the draft. frnAutoDraftRemaining only makes the draft
    // picks — it does NOT run _draftFinalize, which (a) fills roster gaps with
    // UDFAs, (b) runs UDFA AI claims so undrafted gems land on teams, and most
    // importantly (c) CONSUMES this year's pick rows and MINTS the next future
    // year's. Without this, the pick inventory (seeded with only 3 years at
    // startFranchise) is never replenished — so from the 4th season on,
    // _buildDraftPickOrder finds no pick rows and EVERY regular slot is skipped,
    // collapsing the draft to UDFA-only. frnDraftFinishScramble runs the UDFA
    // claims and calls _draftFinalize internally.
    step(typeof frnDraftFinishScramble !== "undefined" && frnDraftFinishScramble, "finishDraft", s);
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
  console.log("  BRADY-TIER (R6+/UDFA → 96+ OVR):              " + bradyEmergences);
  console.log("");
  const cadence = bradyEmergences > 0 ? (${SEASONS} / bradyEmergences).toFixed(1) : "∞";
  const target = 75;
  const ok = bradyEmergences > 0 && Math.abs((${SEASONS}/bradyEmergences) - target) / target < 0.5;
  console.log("  Cadence: 1 per " + cadence + " years (target: ~1 per " + target + " years)  " + (ok?"OK":"!!"));
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
  }
})();
`;

let bundle = shim + extraConsts;
for (const f of files) {
  bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
}
bundle += harness;

new Function(bundle)();
