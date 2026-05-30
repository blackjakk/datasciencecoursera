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

  // Snapshot every player flagged as a hiddenGem at draft/UDFA time so we
  // can count those that LATER hit their ceiling (legend-tier emergence).
  // _rollHiddenGem stamps p.hiddenGem = { ceiling, growthRate, ... } on draft;
  // _maybeApplyHiddenGem in offseason grows them; when overall >= ceiling the
  // flag is deleted. We tag draft round at gem-stamp time.
  let totalGemsRolled = 0;
  let legendEmergences = 0;          // gem with ceiling >= 96 that reaches OVR >= 96
  let lateRoundLegends = 0;          // round >= 5 OR UDFA
  let bradyEmergences = 0;           // round >= 6 OR UDFA (the actual Brady definition)
  const seenGems = new Map();        // name → { round, ceiling, emerged }

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
          seenGems.set(p.name, { round, ceiling: p.hiddenGem.ceiling, peakOvr: p.overall, emerged: false });
          totalGemsRolled++;
        }
        if (seenGems.has(p.name)) {
          const g = seenGems.get(p.name);
          if (p.overall > g.peakOvr) g.peakOvr = p.overall;
          if (!g.emerged && g.peakOvr >= 96 && g.ceiling >= 96) {
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
    // Snapshot BEFORE the season rolls over so a gem drafted this cycle is
    // recorded even if it's cut before next season; scanGems runs again after.
    scanGems();
    step(typeof frnNewSeason !== "undefined" && frnNewSeason, "newSeason", s);
    scanGems();
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
})();
`;

let bundle = shim + extraConsts;
for (const f of files) {
  bundle += "\n;// ===== " + f + " =====\n" + stripUiInit(fs.readFileSync(path.join(__dirname, f), "utf8"), f) + "\n";
}
bundle += harness;

new Function(bundle)();
