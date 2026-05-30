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
`;

const files = [
  "play-data.js",
  "play-player.js",
  "play-render.js",           // pickBodyType, CELEB_STYLES + gen helpers (UI-init stripped below)
  "play-sim.js",
  "play-motion.js",
  "play-engine.js",
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
  // Silence render functions at runtime — after the files load they're the
  // REAL fns; replace with no-ops so the sim loop doesn't burn cycles in
  // dashboard rendering that depends on DOM. We only need the sim logic.
  if (typeof showFranchiseDashboard === "function") showFranchiseDashboard = function() {};
  if (typeof renderFrnPreseason === "function") renderFrnPreseason = function() {};
  if (typeof renderFrnDashboard === "function") renderFrnDashboard = function() {};
  if (typeof renderFrnSeasonRecap === "function") renderFrnSeasonRecap = function() {};
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

  function scanGems() {
    for (const t of TEAMS) {
      const roster = franchise.rosters[t.id] || [];
      for (const p of roster) {
        if (p.hiddenGem && !seenGems.has(p.name)) {
          // Tag with current OVR + draft round if available
          const round = p.draftRound || p.draft_round || (p.udfa ? 8 : 99);
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

  // Drive seasons headlessly. The sim path: for each week, sim every game in
  // franchise.schedule that hasn't been played; then advance week; at season
  // end runFrnOffseason() handles draft/dev/age/retire — all the Brady levers.
  const t0 = Date.now();
  for (let s = 0; s < ${SEASONS}; s++) {
    // Sim all 18 regular-season weeks (NFL schedule len from generateFranchiseSchedule)
    let safety = 0;
    while (franchise.phase !== "offseason" && safety++ < 500) {
      const wk = franchise.week;
      const wkGames = franchise.schedule.filter(g => g.week === wk && !g.played);
      if (wkGames.length === 0) {
        try { advanceWeekIfDone && advanceWeekIfDone(); } catch (e) {}
        try { frnAdvanceWeek && frnAdvanceWeek(); } catch (e) {}
        // If still stuck, force phase forward
        if (franchise.week === wk && franchise.phase !== "offseason") break;
        continue;
      }
      for (const g of wkGames) {
        try { frnSimGame(g.homeId, g.awayId); } catch (e) {}
      }
    }
    // Offseason: draft + dev + age + retire — where gems are rolled & resolved.
    try { runFrnOffseason && runFrnOffseason(); } catch (e) { console.error("offseason err season "+s+":", e.message); }
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
