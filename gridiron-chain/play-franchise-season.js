// ── Route to correct phase UI ────────────────────────────────────────────────
function showFranchiseDashboard() {
  // Dismiss any lingering hover tooltips when changing screens
  try { frnHoverTipHide && frnHoverTipHide(); } catch {}
  try { _frnHoverTipPgHide && _frnHoverTipPgHide(); } catch {}
  if (!franchise) { renderFrnStartScreen(); return; }
  // Defensive defaults for older saves missing newer fields
  if (!franchise.phase)            franchise.phase = "regular";
  if (!franchise.seasonStats)      franchise.seasonStats = {};
  if (!franchise.seasonHighlights) franchise.seasonHighlights = [];
  if (!franchise.history)          franchise.history = [];
  if (!franchise.rosters)          franchise.rosters = {};
  if (!franchise.schedule)         franchise.schedule = [];
  if (!franchise.standings)        franchise.standings = initStandings();
  if (!franchise.salaryCap)        franchise.salaryCap = SALARY_CAP_BASE;
  // Backfill contracts + draft info for saves from before Phase 1
  assignContracts(franchise.rosters, franchise.salaryCap);
  const baseYear = new Date().getFullYear() + (franchise.season || 1) - 1;
  assignDraftInfo(franchise.rosters, baseYear);
  // Backfill picks for saves from before draft-picks-as-assets
  if (!franchise.picks || !franchise.picks.length) _initFranchisePicks();
  // Backfill coaching staff
  if (!franchise.coaches) _initCoachingStaff();
  // Backfill jersey numbers for any roster where players are missing
  // p.number (older saves, or new FA signees, or traded-in players).
  for (const [tid, roster] of Object.entries(franchise.rosters || {})) {
    if (roster.some(p => !p.number)) assignTeamJerseyNumbers(roster);
  }
  // Backfill guaranteed-money fields on contracts from older saves so
  // released-player dead-cap math works for everyone.
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) {
      if (p.contract && p.contract.guaranteedYears == null) {
        p.contract.guaranteedYears = _guaranteedYearsForLength(p.contract.years || p.contract.remaining || 1);
        p.contract.guaranteedAAV = p.contract.aav;
      }
      // Clamp guaranteed years so there's always at least 1 free year at the end.
      // Fixes saves where guaranteedYears was never decremented and every contract
      // became 100% dead cap.
      if (p.contract && p.contract.guaranteedYears != null) {
        const rem = p.contract.remaining || 0;
        p.contract.guaranteedYears = Math.max(0, Math.min(p.contract.guaranteedYears, rem - 1));
      }
    }
  }
  // Backfill practice squad data for older saves.
  if (!franchise.practiceSquads) franchise.practiceSquads = {};
  if (!Object.keys(franchise.practiceSquads).length) _seedPracticeSquads();
  if (!franchise.scoutVisits) franchise.scoutVisits = {};
  if (!franchise.scoutedPS) franchise.scoutedPS = {};
  if (!franchise.psPoachAlerts) franchise.psPoachAlerts = [];
  if (franchise.autoSpendScouts == null) franchise.autoSpendScouts = true;
  // Backfill career history for veterans loaded from older saves where
  // generateCareer hadn't run with the careerHistory shape yet.
  for (const [tid, roster] of Object.entries(franchise.rosters || {})) {
    for (const p of roster) {
      const age = p.age || 22;
      if (age > 22 && (!p.careerHistory || !p.careerHistory.length)) {
        generateCareer(p);
      }
    }
  }
  assignCareerTeams(franchise.rosters || {});

  $("franchiseHome").style.display = "block";
  const { phase } = franchise;
  try {
    if      (phase === "preseason")            renderFrnPreseason();
    else if (phase === "free_agency")          renderFrnFA();
    else if (phase === "free_agency_results")  renderFrnFAResults();
    else if (phase === "fa_cuts")              renderFrnFACuts();
    else if (phase === "draft")                renderFrnDraft();
    else if (phase === "regular")              renderFrnRegular();
    else if (phase === "playoffs_pending")     startFrnPlayoffs();
    else if (phase === "playoffs")         renderFrnPlayoffs();
    else if (phase === "awards")           showFrnAwards();
    else if (phase === "offseason") {
      if (franchise._resignPending?.length) {
        const cap = franchise.salaryCap || SALARY_CAP_BASE;
        const committed = (franchise.rosters[franchise.chosenTeamId] || [])
          .filter(p => p.contract && p.contract.remaining > 0)
          .reduce((s, p) => s + p.contract.aav, 0);
        _renderResignUI(cap, committed);
      } else {
        renderFrnOffseason();
      }
    }
    else                                   renderFrnStartScreen();
  } catch (err) {
    console.error("Dashboard render error:", err);
    $("frnHomeContent").innerHTML = `
      <div class="frn-welcome">
        <div class="frn-welcome-title" style="color:var(--red)">⚠ Save data is corrupted</div>
        <div class="frn-welcome-sub">${err.message || "Unknown error"}</div>
        <div style="margin-top:1rem">
          <button class="btn btn-gold" onclick="frnStartNew()">+ Start New Franchise</button>
        </div>
      </div>`;
  }
}

// ── Team picker / welcome screen ─────────────────────────────────────────────
// Tier label for hover + detail screen
const TIER_LABEL = {
  powerhouse: "⭐ POWERHOUSE",
  contender:  "💪 CONTENDER",
  average:    "⚖ AVERAGE",
  rebuilding: "🔧 REBUILDING",
};

// Resolve roster/tier from either the live franchise OR the picker draft.
function _draftRosterFor(teamId) {
  return franchise?.rosters?.[teamId] || franchiseDraft?.rosters?.[teamId] || [];
}
function _draftTierFor(teamId) {
  return franchise?.teamTiers?.[teamId] || franchiseDraft?.teamTiers?.[teamId] || "average";
}

// Build a short scouting report for a team — 3-5 bullet points covering
// QB outlook, best/worst unit, age profile, and star presence.
function summarizeTeam(teamId) {
  const roster = _draftRosterFor(teamId);
  const tier   = _draftTierFor(teamId);
  const ratings = buildRatings(roster);
  const bullets = [];

  const qb = roster.filter(p => p.position === "QB").sort((a,b)=>b.overall-a.overall)[0];
  if (qb) {
    const g = scoutGrade(qb), age = qb.age || 25;
    if (age <= 24 && g >= 80)        bullets.push(`Promising young QB (age ${age}, ${gradeLabel(g)})`);
    else if (age >= 33 && g >= 85)   bullets.push(`Aging legend at QB (age ${age}) — win-now window`);
    else if (g >= 88)                bullets.push(`Elite QB anchors the offense`);
    else if (g >= 78)                bullets.push(`Reliable starting QB`);
    else if (g <= 60)                bullets.push(`Big question marks at QB`);
    else if (age <= 23)              bullets.push(`Developmental QB (age ${age})`);
  }

  const units = [
    { label:"rushing attack",   score: ratings.rb },
    { label:"receiving corps",  score: ratings.wr },
    { label:"offensive line",   score: ratings.ol },
    { label:"defensive line",   score: ratings.dl },
    { label:"linebacking corps",score: ratings.lb },
    { label:"secondary",        score: (ratings.cb + ratings.saf) / 2 },
  ];
  const sortedUnits = units.slice().sort((a,b) => b.score - a.score);
  const best = sortedUnits[0], worst = sortedUnits[sortedUnits.length-1];
  if (best.score  >= 80) bullets.push(`Strength: ${best.label}`);
  if (worst.score <= 64) bullets.push(`Weakness: ${worst.label}`);

  const totalAge = roster.reduce((s,p)=>s+(p.age||25),0);
  const avgAge = totalAge / Math.max(1, roster.length);
  if (avgAge < 25.3)      bullets.push(`Youthful core (avg age ${avgAge.toFixed(1)})`);
  else if (avgAge > 28.0) bullets.push(`Veteran-heavy (avg age ${avgAge.toFixed(1)})`);

  const stars = roster.filter(p => scoutGrade(p) >= 87);
  if (stars.length === 0)      bullets.push(`No headline talent`);
  else if (stars.length === 1) bullets.push(`Built around ${stars[0].name} (${stars[0].position})`);
  else if (stars.length >= 4)  bullets.push(`Stacked: ${stars.length} A-grade players`);

  return { tier, bullets: bullets.slice(0, 5) };
}

function renderFrnTeamPicker() {
  const confOrder = [
    "AFC East","AFC North","AFC South","AFC West",
    "NFC East","NFC North","NFC South","NFC West",
  ];
  const groups = {};
  for (const t of TEAMS) {
    const k = `${t.conference} ${t.division}`;
    (groups[k] = groups[k] || []).push(t);
  }
  let pickerHtml = `<div class="frn-picker-grid">`;
  for (const divKey of confOrder) {
    const teams = groups[divKey] || [];
    pickerHtml += `<div>
      <div style="font-size:.62rem;color:var(--gold);letter-spacing:.5px;margin-bottom:.3rem">${divKey.toUpperCase()}</div>
      <div class="frn-team-grid">`;
    for (const t of teams) {
      const tier    = _draftTierFor(t.id);
      const roster  = _draftRosterFor(t.id);
      const ratings = buildRatings(roster);
      pickerHtml += `<button class="frn-team-btn"
        onclick="renderFrnTeamDetail(${t.id})"
        onmouseenter="frnTeamTipShow(event,${t.id})"
        onmouseleave="frnTeamTipHide()"
        style="border-left:4px solid ${t.primary}">
        <span class="frn-ascii">${t.emoji || teamAscii(t)}</span>
        <div class="frn-team-btn-body">
          <span class="frn-team-btn-name">${t.city} ${t.name}</span>
          <span class="frn-team-btn-meta">OFF ${Math.round(ratings.offense)} · DEF ${Math.round(ratings.defense)} · ${roster.length} players</span>
        </div>
        <div class="frn-team-btn-right">
          <div class="frn-team-colors">
            <span class="frn-color-swatch" style="background:${t.primary}" title="${t.primary}"></span>
            <span class="frn-color-swatch" style="background:${t.secondary||'#fff'}" title="${t.secondary||''}"></span>
          </div>
          <span class="frn-team-tier tier-${tier}">${tier[0].toUpperCase()}</span>
        </div>
      </button>`;
    }
    pickerHtml += `</div></div>`;
  }
  pickerHtml += `</div>`;

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap">
      <button class="btn btn-outline" onclick="renderFrnStartScreen()">← Back</button>
      <div style="font-size:1.1rem;font-weight:700;color:var(--gold)">CHOOSE YOUR TEAM</div>
      <button class="btn btn-outline" onclick="frnRerollLeague()" style="margin-left:auto;font-size:.7rem" title="Reroll the entire league">🎲 Reroll League</button>
    </div>
    <div class="frn-picker-intro">
      Hover for a quick scout report · Click a team to inspect them in depth before choosing.
      League tiers: <span style="color:var(--gold-lt)">P=Powerhouse</span> ·
      <span style="color:#9be09b">C=Contender</span> ·
      <span style="color:var(--gray)">A=Average</span> ·
      <span style="color:#c08080">R=Rebuilding</span>
    </div>
    ${pickerHtml}
  `;
}

// Floating hover tooltip — single shared element appended to body.
function frnTeamTipShow(e, teamId) {
  let tip = document.getElementById("frn-team-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "frn-team-tooltip";
    tip.className = "frn-team-tooltip";
    document.body.appendChild(tip);
  }
  const team    = getTeam(teamId);
  const summary = summarizeTeam(teamId);
  const ratings = buildRatings(_draftRosterFor(teamId));
  tip.innerHTML = `
    <div class="frn-tip-head">
      <span style="color:var(--gold);font-size:1.2rem">${teamAscii(team)}</span>
      <span style="font-weight:900">${team.city} ${team.name}</span>
    </div>
    <div class="frn-tip-tier tier-${summary.tier}">${TIER_LABEL[summary.tier]}</div>
    <div class="frn-tip-ratings">
      OFF <b style="color:var(--gold)">${Math.round(ratings.offense)}</b> ·
      DEF <b style="color:var(--gold)">${Math.round(ratings.defense)}</b>
    </div>
    ${summary.bullets.map(b => `<div class="frn-tip-bullet">• ${b}</div>`).join("")}
    <div class="frn-tip-foot">Click to inspect roster</div>
  `;
  tip.style.display = "block";
  // Position near the team button, clamped to viewport
  const rect = e.currentTarget.getBoundingClientRect();
  const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
  let left = rect.right + 8;
  if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 8;
  let top = rect.top;
  if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
  if (top < 8) top = 8;
  tip.style.left = left + "px";
  tip.style.top  = top  + "px";
}

function frnTeamTipHide() {
  const tip = document.getElementById("frn-team-tooltip");
  if (tip) tip.style.display = "none";
}

// Team detail view — shown after a click in the picker.
function renderFrnTeamDetail(teamId) {
  frnTeamTipHide();
  const team   = getTeam(teamId);
  const roster = _draftRosterFor(teamId);
  const tier   = _draftTierFor(teamId);
  const ratings = buildRatings(roster);
  const summary = summarizeTeam(teamId);

  const byPos = {};
  for (const p of roster) (byPos[p.position] = byPos[p.position] || []).push(p);
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a,b)=>b.overall-a.overall);

  const renderDepthRow = (p, slot) => `<tr>
    <td class="frn-scout-slot">${slot}</td>
    <td>${p.name}</td>
    <td>${gradeBadge(p)}</td>
    <td style="color:var(--gray)">${p.age||"?"}</td>
    <td style="color:var(--gray);font-size:.66rem">${draftStr(p)}</td>
    <td style="color:var(--gold);font-size:.7rem">$${(p.contract?.aav||0).toFixed(1)}M</td>
  </tr>`;

  const buildDepth = positions => positions.map(({pos, n}) => {
    const players = (byPos[pos] || []).slice(0, n);
    return players.map((p, i) => renderDepthRow(p, players.length>1 ? `${pos}${i+1}` : pos)).join("");
  }).join("");

  const offenseDepth = buildDepth([
    {pos:"QB", n:1}, {pos:"RB", n:1}, {pos:"WR", n:3},
    {pos:"TE", n:1}, {pos:"OL", n:5},
  ]);
  const defenseDepth = buildDepth([
    {pos:"DL", n:4}, {pos:"LB", n:3}, {pos:"CB", n:2}, {pos:"S", n:2},
  ]);
  const stDepth = buildDepth([{pos:"K", n:1}, {pos:"P", n:1}]);

  // Star players — top 6 by scout grade
  const stars = roster.slice().sort((a,b) => scoutGrade(b) - scoutGrade(a)).slice(0, 6);

  // ── Franchise vitals ───────────────────────────────────────────────────────
  const capUsedPrev = roster.reduce((s,p) => s+(p.contract?.aav||0), 0);
  const capBase = SALARY_CAP_BASE || 220;
  const capLeft = capBase - capUsedPrev;
  const avgAge  = roster.length ? (roster.reduce((s,p)=>s+(p.age||25),0)/roster.length).toFixed(1) : "—";
  const qb      = roster.filter(p=>p.position==="QB").sort((a,b)=>b.overall-a.overall)[0];
  const pb      = (typeof getPlaybook === "function") ? getPlaybook(team) : null;
  const pbLabel = pb?.name || team.playbook?.replace(/_/g," ") || "Balanced";
  const tierDesc = { powerhouse:"Turn-Key Contender", contender:"Solid Foundation", average:"Development Mode", rebuilding:"Full Rebuild" }[summary.tier] || "";
  const diffColor = { powerhouse:"#7dff97", contender:"#aaffaa", average:"var(--gold)", rebuilding:"#ff9090" }[summary.tier] || "var(--gray)";

  // Position depth counts
  const posCounts = {};
  for (const p of roster) posCounts[p.position] = (posCounts[p.position]||0)+1;
  const depthStr = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"]
    .filter(p => posCounts[p])
    .map(p => `${p} ×${posCounts[p]}`).join("  ·  ");

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <button class="btn btn-outline" onclick="renderFrnTeamPicker()">← Back to picker</button>
      <div style="font-size:.75rem;color:var(--gray)">Inspect roster before committing</div>
      <button class="btn btn-gold-big" onclick="startFranchise(${teamId})" style="margin-left:auto">
        ✓ CHOOSE ${team.name.toUpperCase()}
      </button>
    </div>

    <div class="frn-team-banner" style="--banner-color:${team.primary}">
      <div class="frn-banner-stripe"></div>
      <div class="frn-banner-ascii" style="font-size:1.6rem">${team.emoji || teamAscii(team)}</div>
      <div class="frn-banner-info" style="flex:1">
        <div class="frn-banner-name">${team.city.toUpperCase()} ${team.name.toUpperCase()}</div>
        <div class="frn-banner-sub">${team.conference} ${team.division} · <span style="color:var(--gold-lt)">${TIER_LABEL[summary.tier]}</span> · OFF ${Math.round(ratings.offense)} · DEF ${Math.round(ratings.defense)}</div>
        <div class="frn-color-bar" style="max-width:120px">
          <div class="frn-color-bar-seg" style="background:${team.primary}"></div>
          <div class="frn-color-bar-seg" style="background:${team.secondary||'#fff'}"></div>
        </div>
      </div>
    </div>

    <div class="frn-vitals-grid">
      <div class="frn-vital-cell">
        <span class="frn-vital-label">FRANCHISE MODE</span>
        <span class="frn-vital-value" style="color:${diffColor}">${tierDesc}</span>
        <span class="frn-vital-sub">${TIER_LABEL[summary.tier]}</span>
      </div>
      <div class="frn-vital-cell">
        <span class="frn-vital-label">ROSTER</span>
        <span class="frn-vital-value">${roster.length} players</span>
        <span class="frn-vital-sub">Avg age ${avgAge}</span>
      </div>
      <div class="frn-vital-cell">
        <span class="frn-vital-label">CAP SPACE</span>
        <span class="frn-vital-value" style="color:${capLeft<20?'#ff9090':capLeft>50?'#7dff97':'var(--gold)'}">$${capLeft.toFixed(0)}M</span>
        <span class="frn-vital-sub">$${capUsedPrev.toFixed(0)}M committed</span>
      </div>
      <div class="frn-vital-cell">
        <span class="frn-vital-label">COLORS</span>
        <span class="frn-vital-value" style="display:flex;align-items:center;gap:.3rem">
          <span style="background:${team.primary};width:1.1rem;height:1.1rem;display:inline-block;border-radius:2px;border:1px solid rgba(255,255,255,0.15)"></span>
          <span style="background:${team.secondary||'#fff'};width:1.1rem;height:1.1rem;display:inline-block;border-radius:2px;border:1px solid rgba(255,255,255,0.15)"></span>
        </span>
        <span class="frn-vital-sub">${pbLabel}</span>
      </div>
    </div>

    <div style="font-size:.58rem;color:var(--gray);margin-bottom:.7rem;letter-spacing:.3px">${depthStr}</div>

    <div class="frn-card-box" style="margin-bottom:.8rem">
      <div class="frn-card-title">📋 SCOUT REPORT</div>
      <ul class="frn-summary-bullets">
        ${summary.bullets.map(b => `<li>${b}</li>`).join("")}
      </ul>
    </div>

    <div class="frn-dash-grid">
      <div class="frn-card-box">
        <div class="frn-card-title">OFFENSE DEPTH</div>
        <table class="frn-pre-roster-table">
          <thead><tr><th></th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>AAV</th></tr></thead>
          <tbody>${offenseDepth}</tbody>
        </table>
      </div>
      <div class="frn-card-box">
        <div class="frn-card-title">DEFENSE DEPTH</div>
        <table class="frn-pre-roster-table">
          <thead><tr><th></th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>AAV</th></tr></thead>
          <tbody>${defenseDepth}</tbody>
        </table>
      </div>
    </div>

    <div class="frn-card-box" style="margin-top:.8rem">
      <div class="frn-card-title">SPECIAL TEAMS</div>
      <table class="frn-pre-roster-table">
        <thead><tr><th></th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>AAV</th></tr></thead>
        <tbody>${stDepth}</tbody>
      </table>
    </div>

    <div class="frn-card-box" style="margin-top:.8rem">
      <div class="frn-card-title">⭐ TOP TALENT</div>
      <div class="frn-team-stars">
        ${stars.map(p => `<div class="frn-star-pill">
          ${gradeBadge(p)}
          <span style="font-weight:700">${p.name}</span>
          <span style="color:var(--gray);font-size:.65rem">${p.position} · age ${p.age||"?"} · ${draftStr(p)}</span>
        </div>`).join("")}
      </div>
    </div>

    <div class="frn-actions" style="justify-content:center;margin-top:1rem">
      <button class="btn btn-gold-big" onclick="startFranchise(${teamId})">✓ CHOOSE ${team.name.toUpperCase()}</button>
      <button class="btn btn-outline" onclick="renderFrnTeamPicker()">← Pick a different team</button>
    </div>
  `;
}

// Compute basic team rating (offense/defense averages) for display
function frnTeamRating(teamId) {
  const roster = franchise.rosters[teamId] || [];
  const r = buildRatings(roster);
  return { off: Math.round(r.offense), def: Math.round(r.defense), qb: Math.round(r.qb) };
}

// Compute season leaders for a single team (top stat-holder per category)
function frnTeamLeaders(teamId) {
  const players = franchise.seasonStats?.[teamId] || {};
  const list = Object.values(players);
  if (!list.length) return [];
  const out = [];
  const best = (key, label, fmt) => {
    const top = list.filter(p => p[key]).sort((a, b) => b[key] - a[key])[0];
    if (top && top[key] > 0) out.push({ cat: label, name: top.name, stat: fmt(top) });
  };
  best("pass_yds", "PASS", p => `${p.pass_yds} yds · ${p.pass_td || 0} TD`);
  best("rush_yds", "RUSH", p => `${p.rush_yds} yds · ${p.rush_td || 0} TD`);
  best("rec_yds",  "REC",  p => `${p.rec_yds} yds · ${p.rec_td || 0} TD`);
  best("sk",       "SACKS",p => `${(+p.sk).toFixed(1)} sacks`);
  best("int_made", "INTs", p => `${p.int_made} INT`);
  best("tkl",      "TKL",  p => `${p.tkl} tackles`);
  return out;
}

// ── Regular-season dashboard (polished inline layout) ────────────────────────
// ── Pre-season screen: roster review, schedule preview, scout opponents ───────
function renderFrnPreseason(tab, scoutId, scoutView, selName) {
  tab = tab || "roster";
  const { chosenTeamId, season, salaryCap, schedule, teamTiers } = franchise;
  const cap = effectiveSalaryCap(chosenTeamId);
  const myTeam = getTeam(chosenTeamId);
  const myRoster = franchise.rosters[chosenTeamId] || [];
  const capUsed = capUsedByTeam(chosenTeamId);
  const capLeft = cap - capUsed;
  const myRtg = frnTeamRating(chosenTeamId);
  const overCap = capLeft < 0;
  const myTier = teamTiers?.[chosenTeamId];
  const tierLabel = myTier
    ? { powerhouse:"⭐ POWERHOUSE", contender:"💪 CONTENDER",
        average:"⚖ AVERAGE", rebuilding:"🔧 REBUILDING" }[myTier] || ""
    : "";

  const bannerHtml = `
    <div class="frn-team-banner" style="--banner-color:${myTeam.primary}">
      <div class="frn-banner-stripe"></div>
      <div class="frn-banner-ascii">${teamAscii(myTeam)}</div>
      <div class="frn-banner-info">
        <div class="frn-banner-name">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()}</div>
        <div class="frn-banner-sub">
          Season ${season} · Pre-Season Camp · OFF ${myRtg.off} · DEF ${myRtg.def}
          ${tierLabel ? ` · <span style="color:var(--gold-lt)">${tierLabel}</span>` : ""}
        </div>
        <div class="frn-banner-cap" style="color:${overCap?"var(--red)":capUsed/cap>=0.95?"#e8a000":"var(--green-lt)"}">
          CAP $${capUsed.toFixed(1)}M / $${cap.toFixed(0)}M
          <span style="color:var(--gray);font-weight:400"> · Room $${capLeft.toFixed(1)}M</span>
          <button class="frn-cap-btn" onclick="renderFrnAnalytics('mysheet')">📊 Analytics</button>
        </div>
      </div>
      <div style="text-align:right">
        ${franchise.phase === "preseason"
          ? `<button class="btn btn-gold-big" onclick="frnStartSeason()">▶ START SEASON ${season}</button>`
          : `<button class="btn btn-outline" onclick="showFranchiseDashboard()">◀ Back to Week ${franchise.week || ""}</button>`
        }
      </div>
    </div>`;

  const tabs = [
    { id:"roster",   label:"📋 MY ROSTER" },
    { id:"schedule", label:"📅 SCHEDULE" },
    { id:"scout",    label:"🔍 SCOUT" },
  ];
  const tabBar = tabs.map(t =>
    `<button class="frn-ana-tab ${t.id===tab?"active":""}" onclick="renderFrnPreseason('${t.id}')">${t.label}</button>`
  ).join("");

  let body;
  if      (tab === "roster")   body = _preseasonRosterTab(myRoster, selName);
  else if (tab === "schedule") body = _preseasonScheduleTab(schedule, chosenTeamId);
  else                         body = _preseasonScoutTab(chosenTeamId, scoutId, scoutView, selName);

  // Fix 3: Over-cap wizard — shown instead of normal content when significantly over cap.
  const overCapWizard = (() => {
    if (capLeft >= 0) return "";
    const overBy = Math.abs(capLeft);
    const roster = myRoster.filter(p => p.contract);

    // Sort candidates: free cuts first (no dead cap), then by net savings descending
    const candidates = roster.map(p => {
      const hit = currentYearCapHit(p);
      const { perYear: deadPY, years: deadYrs } = deadCapOnRelease(p);
      const dead = deadPY * Math.min(deadYrs, 1); // Only this year's dead cap matters for relief
      const netSave = hit - dead;
      return { p, hit, dead, deadPY, deadYrs, netSave };
    }).filter(c => c.netSave > 0.3)
      .sort((a, b) => {
        // Free cuts (no dead cap) first, then by net savings
        const aFree = a.dead < 0.5 ? 1 : 0;
        const bFree = b.dead < 0.5 ? 1 : 0;
        if (aFree !== bFree) return bFree - aFree;
        return b.netSave - a.netSave;
      })
      .slice(0, 12);

    const rows = candidates.map(({ p, hit, dead, deadPY, deadYrs, netSave }) => {
      const escN = p.name.replace(/'/g, "\\'");
      const isFree = dead < 0.5;
      return `<tr style="${isFree ? "background:rgba(0,180,0,.06)" : ""}">
        <td style="font-weight:700;color:${isFree?"var(--green-lt)":"var(--white)"}">${isFree?"✓ ":""}${p.name}</td>
        <td style="color:var(--gray);font-size:.68rem">${p.position}</td>
        <td>${gradeBadge(p)}</td>
        <td style="color:var(--red);font-weight:700">$${hit.toFixed(1)}M</td>
        <td style="color:${isFree?"var(--gray)":"#ff9090"};font-size:.65rem">${isFree ? "No dead cap" : `☠ $${deadPY.toFixed(1)}M×${deadYrs}yr`}</td>
        <td style="color:var(--green-lt);font-weight:700">+$${netSave.toFixed(1)}M</td>
        <td style="color:var(--gray);font-size:.65rem">${p.contract.remaining}yr</td>
        <td><button class="btn btn-outline" onclick="frnReleasePlayer('${escN}','${p.position}')" style="font-size:.6rem;padding:.15rem .4rem;color:var(--red)">✗ Cut</button></td>
      </tr>`;
    }).join("");

    return `<div style="background:rgba(220,50,50,.08);border:1px solid rgba(220,50,50,.4);border-radius:6px;padding:.8rem 1rem;margin-bottom:.8rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;flex-wrap:wrap;gap:.4rem">
        <div>
          <span style="font-size:1rem;font-weight:900;color:var(--red)">⚠ OVER THE CAP BY $${overBy.toFixed(1)}M</span>
          <span style="color:var(--gray);font-size:.72rem;margin-left:.6rem">Must get under $${cap.toFixed(0)}M to start the season</span>
        </div>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-outline" onclick="renderFrnAnalytics('cuts')" style="font-size:.68rem">📋 Full Cut List</button>
          <button class="btn btn-outline" onclick="renderFrnAnalytics('caphealth')" style="font-size:.68rem">↺ Restructures</button>
        </div>
      </div>
      <p style="font-size:.63rem;color:var(--gray);margin-bottom:.5rem">✓ Green rows = free cuts (no dead cap). Cut these first. Net save = cap relief after dead money.</p>
      <div style="overflow-x:auto"><table class="frn-ana-table" style="font-size:.7rem">
        <thead><tr><th>Player</th><th>Pos</th><th>Grade</th><th>Cap Hit</th><th>Dead Cap</th><th>Net Save</th><th>Yrs</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
  })();

  $("frnHomeContent").innerHTML = `
    ${bannerHtml}
    ${overCapWizard}
    <div class="frn-ana-tabs">${tabBar}</div>
    <div class="frn-ana-body">${body}</div>
    <div class="frn-footer-row">
      <div class="frn-footer-info">Pre-season — review and tinker before Week 1 kicks off</div>
      <button class="btn btn-outline frn-abandon-btn" onclick="frnAbandon()">× Abandon</button>
    </div>`;
}

function _preseasonRosterTab(roster, selName) {
  const posOrder = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const groups = {};
  for (const p of roster) (groups[p.position] = groups[p.position] || []).push(p);

  // Default selected: highest-OVR player on the team
  let selected = null;
  if (selName) selected = roster.find(p => p.pid === selName || p.name === selName);
  if (!selected) selected = roster.slice().sort((a,b) => b.overall - a.overall)[0];

  let listHtml = "";
  for (const pos of posOrder) {
    const players = (groups[pos] || []).slice().sort((a,b) => b.overall - a.overall);
    if (!players.length) continue;
    listHtml += `<div class="frn-pre-pos-group">
      <div class="frn-pre-pos-title">${pos} <span style="color:var(--gray);font-weight:400;font-size:.6rem">${players.length}</span></div>
      <table class="frn-pre-roster-table">
        <tbody>
          ${players.map((p, i) => {
            const pKey = p.pid || p.name;
            const escName = pKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
            const isStarter = i === 0;
            const isSel = selected && (selected.pid ? selected.pid === p.pid : selected.name === p.name);
            const aav = p.contract?.aav || 0;
            const yrs = p.contract?.remaining || 0;
            const isPendingRelease = _releasePending?.name === p.name && _releasePending?.pos === p.position;
            if (isPendingRelease) {
              const { deadPerYr, deadYrs, deadTotal } = _releasePending;
              const deadMsg = deadTotal > 0
                ? `☠ Dead cap: <b style="color:var(--red)">$${deadPerYr.toFixed(1)}M × ${deadYrs}yr = $${deadTotal.toFixed(1)}M</b>`
                : `<span style="color:var(--green-lt)">No dead cap — fully freed</span>`;
              return `<tr style="background:rgba(220,50,50,.12)">
                <td colspan="6" style="padding:.4rem .6rem">
                  <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
                    <span style="font-weight:700;color:var(--red)">Release ${p.name}?</span>
                    <span style="font-size:.68rem">${deadMsg}</span>
                    <button class="btn btn-outline" onclick="frnReleasePlayerConfirm()" style="font-size:.62rem;padding:.2rem .5rem;border-color:var(--red);color:var(--red)">✓ Confirm Release</button>
                    <button class="btn btn-outline" onclick="frnReleasePlayerCancel()" style="font-size:.62rem;padding:.2rem .5rem">✗ Cancel</button>
                  </div>
                </td>
              </tr>`;
            }
            return `<tr class="frn-scout-row ${isSel?"selected":""}" onclick="renderFrnPreseason('roster',null,null,'${escName}')">
              <td class="frn-scout-slot">${isStarter?"★":"#"+(i+1)}</td>
              <td style="font-weight:${isStarter?700:400}">${playerLink(p)}</td>
              <td>${gradeBadge(p)}</td>
              <td style="color:var(--gray)">${p.age || "?"}</td>
              <td style="color:var(--gold);font-size:.7rem">$${aav.toFixed(1)}M · ${yrs}yr</td>
              <td><button class="frn-pre-cut" onclick="event.stopPropagation();frnReleasePlayer('${escName}','${p.position}')" title="Release — frees cap, removes from roster">✗</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  }

  return `<div class="frn-scout-split">
    <div class="frn-scout-roster">${listHtml}</div>
    <div class="frn-scout-player">${selected ? _buildPlayerDetailPanel(selected) : ""}</div>
  </div>`;
}

function _preseasonScheduleTab(schedule, myId) {
  const myGames = schedule.filter(g => g.homeId === myId || g.awayId === myId)
    .sort((a,b) => a.week - b.week);
  return `<table class="frn-pre-roster-table">
    <thead><tr><th>WK</th><th>Opponent</th><th>Where</th><th>OFF</th><th>DEF</th><th>Star Player</th></tr></thead>
    <tbody>
      ${myGames.map(g => {
        const isHome = g.homeId === myId;
        const oppId  = isHome ? g.awayId : g.homeId;
        const opp    = getTeam(oppId);
        const oppRtg = frnTeamRating(oppId);
        const star   = (franchise.rosters[oppId] || []).slice().sort((a,b) => b.overall - a.overall)[0];
        return `<tr>
          <td style="color:var(--gold);font-weight:700">W${g.week}</td>
          <td style="font-weight:700">${teamAscii(opp)} ${opp.city} ${opp.name}</td>
          <td style="color:${isHome?"var(--green-lt)":"var(--gray)"};font-size:.7rem">${isHome ? "HOME" : "@ AWAY"}</td>
          <td style="color:var(--gold)">${oppRtg.off}</td>
          <td style="color:var(--gold)">${oppRtg.def}</td>
          <td style="color:var(--gray);font-size:.7rem">${star ? `${star.name} (${star.position}, ${gradeLabel(scoutGrade(star))})` : "—"}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
}

// Number of "starters" we display per position in the depth-chart view.
const SCOUT_STARTER_COUNTS = { QB:1, RB:1, WR:3, TE:1, OL:5, DL:4, LB:3, CB:2, S:2, K:1, P:1 };

// ── Scout UI helpers ─────────────────────────────────────────────────────────

// Grade badge that shows a dashed-border "fuzzy" style when the team is
// unscouted (grades are noisy ±8 estimates rather than sharpened ±2).
function _scoutGradeBadge(p, scouted) {
  const g  = scoutGrade(p);
  const gL = gradeLabel(g);
  const gc = gradeClass(g);
  if (scouted) {
    return `<span class="tt-ovr tier-${gc}">${gL}</span>`;
  }
  return `<span class="tt-ovr tier-${gc} frn-scout-fuzzy">~${gL}</span>`;
}

// Compact player panel for the scout screen — omits career card, game log,
// recent-form strip, streaks, injury-prone/coachable flags, and flavor text.
function _buildScoutPlayerPanel(p, scouted) {
  const g   = scoutGrade(p);
  const gL  = gradeLabel(g);
  const gc  = gradeClass(g);
  const aav = p.contract?.aav || 0;
  const yrs = p.contract?.remaining || 0;
  const cmb = combineMeasurables(p);

  const isKicker = p.position === "K" || p.position === "P";
  const combineHtml = isKicker
    ? `<div class="frn-combine-grid">
         <div><span class="frn-meta-label">LEG</span> ${Math.round(70 + (cmb.kpw - 50) * 0.45)} yds</div>
         <div><span class="frn-meta-label">40-YD</span> ${cmb.fortyTime}s</div>
       </div>`
    : `<div class="frn-combine-grid">
         <div><span class="frn-meta-label">40-YD</span> ${cmb.fortyTime}s</div>
         <div><span class="frn-meta-label">BENCH</span> ${cmb.benchReps} reps</div>
         <div><span class="frn-meta-label">CONE</span> ${cmb.coneTime}s</div>
         <div><span class="frn-meta-label">VERT</span> ${cmb.verticalIn}"</div>
       </div>`;

  const archBlock    = _buildArchetypeBlock(p);
  const seasonBlock  = _buildSeasonStatsBlock(p);
  const noiseNote    = scouted
    ? `<div style="font-size:.58rem;color:#4dbd64;margin-top:.45rem">grades ±2 (scouted)</div>`
    : `<div style="font-size:.58rem;color:#f5a028;margin-top:.45rem">~grades are ±8 estimates</div>`;

  const gradeBadgeHtml = scouted
    ? `<span class="tt-ovr tier-${gc}">${gL}</span>`
    : `<span class="tt-ovr tier-${gc} frn-scout-fuzzy">~${gL}</span>`;

  return `<div class="frn-player-card">
    <div class="frn-player-card-head" style="display:flex;gap:.9rem;align-items:flex-start">
      ${_playerPortrait(p, 90)}
      <div style="flex:1;min-width:0">
        <div style="font-size:1.05rem;font-weight:900">${p.name}</div>
        <div style="color:var(--gray);font-size:.7rem;margin-top:.1rem">
          #${jerseyForPlayer(p) || "—"} · ${p.position} · Age ${p.age || "?"}${p.height ? ` · ${formatHeight(p.height)}, ${p.weight||"?"} lbs` : ""}
        </div>
        <div style="margin-top:.25rem;display:flex;align-items:center;gap:.5rem">
          ${gradeBadgeHtml}
          <span style="color:var(--gold);font-size:.75rem;font-weight:700">$${aav.toFixed(1)}M/yr</span>
          <span style="color:var(--gray);font-size:.62rem">${yrs}yr left</span>
        </div>
        ${noiseNote}
      </div>
    </div>
    ${archBlock ? `<div style="margin:.5rem 0">${archBlock}</div>` : ""}
    <div class="frn-pcard-section" style="margin-top:.5rem">
      <div class="frn-card-title">COMBINE</div>
      ${combineHtml}
    </div>
    ${seasonBlock ? `<div style="margin-top:.5rem">${seasonBlock}</div>` : ""}
    ${p.injury ? `<div class="frn-player-injury" style="margin-top:.5rem">&#x1F9F9; ${p.injury.label} &mdash; ${p.injury.weeksRemaining} wk${p.injury.weeksRemaining===1?"":"s"} out</div>` : ""}
  </div>`;
}

function _preseasonScoutTab(myId, scoutId, view, selName) {
  view = view || "starters";

  // ── Default opponent: your next unplayed game ────────────────────────────
  if (!scoutId) {
    const next = franchise.schedule.find(g =>
      !g.played && (g.homeId === myId || g.awayId === myId));
    if (next) {
      scoutId = next.homeId === myId ? next.awayId : next.homeId;
    } else {
      const any = franchise.schedule.find(g => g.homeId === myId || g.awayId === myId);
      scoutId = any
        ? (any.homeId === myId ? any.awayId : any.homeId)
        : TEAMS.find(t => t.id !== myId).id;
    }
  }
  scoutId = Number(scoutId);

  // ── Build team list sorted by schedule week ──────────────────────────────
  // Find each opponent's week number in the schedule (vs myId).
  const opponentWeekMap = {};
  for (const g of franchise.schedule) {
    if (g.homeId === myId || g.awayId === myId) {
      const oppId = g.homeId === myId ? g.awayId : g.homeId;
      if (!(oppId in opponentWeekMap)) opponentWeekMap[oppId] = g.week;
    }
  }

  // Find the next opponent (next unplayed game vs myId).
  let nextOppId = null;
  const nextGame = franchise.schedule.find(g =>
    !g.played && (g.homeId === myId || g.awayId === myId));
  if (nextGame) nextOppId = nextGame.homeId === myId ? nextGame.awayId : nextGame.homeId;

  const opponents = TEAMS.filter(t => t.id !== myId).slice().sort((a, b) => {
    const wa = opponentWeekMap[a.id] ?? 999;
    const wb = opponentWeekMap[b.id] ?? 999;
    return wa - wb;
  });

  const listHtml = opponents.map(t => {
    const active  = t.id === scoutId;
    const wk      = opponentWeekMap[t.id];
    const wkLabel = wk != null ? `WK ${wk}` : "";
    const st      = franchise.standings?.[t.id] || { w:0, l:0, t:0 };
    const rec     = `${st.w}-${st.l}${st.t ? `-${st.t}` : ""}`;
    const isNext  = t.id === nextOppId;
    const tOff    = typeof _getTeamOffScheme === "function" ? _getTeamOffScheme(t.id) : null;
    const tDef    = typeof _getTeamDefScheme === "function" ? _getTeamDefScheme(t.id) : null;
    return `<button class="frn-scout-team ${active?"active":""}" onclick="renderFrnPreseason('scout',${t.id})" style="border-left:3px solid ${t.primary}">
      <span class="frn-scout-team-week">${wkLabel}</span>
      <span style="color:var(--gold)">${teamAscii(t)}</span>
      <span>${t.name}</span>
      ${isNext ? `<span class="frn-scout-next-chip">NEXT</span>` : ""}
      <span class="frn-scout-team-rec">${rec}</span>
      ${tOff ? `<span style="display:block;margin-top:.15rem">${_schemeBadge(tOff,true)} ${_schemeBadge(tDef,true)}</span>` : ""}
    </button>`;
  }).join("");

  const oppTeam   = getTeam(scoutId);
  const oppRoster = franchise.rosters[scoutId] || [];
  const oppRtg    = frnTeamRating(scoutId);
  const oppCap    = capUsedByTeam(scoutId);

  // ── Scouting intel ────────────────────────────────────────────────────────
  const intel           = franchise?.scoutingIntel?.[scoutId];
  const scoutedThisSeason = intel?.season === franchise.season;

  // ── Opponent record & schedule info ──────────────────────────────────────
  const oppSt      = franchise.standings?.[scoutId] || { w:0, l:0, t:0 };
  const oppRec     = `${oppSt.w}-${oppSt.l}${oppSt.t ? `-${oppSt.t}` : ""}`;
  const oppWeek    = opponentWeekMap[scoutId];
  const oppWkLabel = oppWeek != null ? `· WK ${oppWeek}` : "";

  // Count injured starters (starter positions, injury present)
  const starterPositions = new Set(["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"]);
  const injuredStarterCount = oppRoster.filter(p =>
    p.injury && starterPositions.has(p.position)).length;
  const injuredStr = injuredStarterCount > 0
    ? ` · ${injuredStarterCount} starter${injuredStarterCount>1?"s":""} out &#x1F9F9;`
    : "";

  // ── Group roster by position, sorted by OVR desc ──────────────────────────
  const byPos = {};
  for (const p of oppRoster) (byPos[p.position] = byPos[p.position] || []).push(p);
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a,b) => b.overall - a.overall);

  // ── Selected player ───────────────────────────────────────────────────────
  let selected = null;
  if (selName) selected = oppRoster.find(p => p.pid === selName || p.name === selName);
  if (!selected) selected = oppRoster.slice().sort((a,b) => b.overall - a.overall)[0];

  // ── Key threats ───────────────────────────────────────────────────────────
  const offSkillPos  = new Set(["QB","RB","WR","TE"]);
  const defPos       = new Set(["DL","LB","CB","S"]);
  const bestOff  = oppRoster.filter(p => offSkillPos.has(p.position)).sort((a,b) => b.overall - a.overall)[0] || null;
  const bestDef  = oppRoster.filter(p => defPos.has(p.position)).sort((a,b) => b.overall - a.overall)[0] || null;
  const injured  = oppRoster.filter(p => p.injury);
  const topInj   = injured.length > 0 ? injured.sort((a,b) => b.overall - a.overall)[0] : null;

  // One-line season stat summary for a player.
  const _threatStatLine = (p) => {
    const ts = franchise?.seasonStats?.[scoutId] || {};
    const st = ts[p.name];
    if (!st || !st.gp) return "";
    const pos = p.position;
    if (pos === "QB") return `${st.pass_yds||0} yds · ${st.pass_td||0} TD`;
    if (pos === "RB") return `${st.rush_yds||0} yds · ${st.rush_td||0} TD`;
    if (pos === "WR" || pos === "TE") return `${st.rec||0} rec · ${st.rec_yds||0} yds`;
    if (pos === "DL" || pos === "LB" || pos === "CB" || pos === "S")
      return `${st.tkl||0} tkl${st.sk ? ` · ${st.sk} sk` : ""}${st.int_made ? ` · ${st.int_made} int` : ""}`;
    return "";
  };

  const _threatCard = (labelText, p) => {
    if (!p) return "";
    const pKey = (p.pid || p.name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const statLine = _threatStatLine(p);
    return `<div class="frn-scout-threat-card"
      onclick="renderFrnPreseason('scout',${scoutId},'${view}','${pKey}')">
      <div class="frn-scout-threat-lbl">${labelText}</div>
      <div class="frn-scout-threat-name">${playerLink(p)}</div>
      <div style="margin-top:.15rem">${_scoutGradeBadge(p, scoutedThisSeason)}</div>
      ${statLine ? `<div class="frn-scout-threat-stat">${statLine}</div>` : ""}
    </div>`;
  };

  const threatsHtml = (bestOff || bestDef || topInj)
    ? `<div class="frn-scout-threats">
        ${_threatCard("BEST OFFENSE", bestOff)}
        ${_threatCard("BEST DEFENSE", bestDef)}
        ${topInj ? _threatCard("INJURY RISK", topInj) : ""}
      </div>`
    : "";

  // ── Noise banner ──────────────────────────────────────────────────────────
  const noiseBanner = scoutedThisSeason
    ? `<div class="frn-scout-noise-banner scouted">
        &#x2713; Intel active &middot; Grades sharpened to &plusmn;2 (Wk ${intel.gainedWeek})
       </div>`
    : `<div class="frn-scout-noise-banner unscouted">
        &#x26A0; Grade noise &plusmn;8 &mdash; grades are estimates.
        <a onclick="renderFrnScrimmages()">Run a scrimmage to sharpen to &plusmn;2.</a>
       </div>`;

  // ── Roster table rows ─────────────────────────────────────────────────────
  const posOrder = ["QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const groupHeaders = { QB: "OFFENSE", DL: "DEFENSE", K: "SPECIAL TEAMS" };

  const rowHtml = (p, slotLabel) => {
    const pKey = p.pid || p.name;
    const isSel = selected && (selected.pid ? selected.pid === p.pid : selected.name === p.name);
    const escName = pKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const isStarter = slotLabel.includes("1") || slotLabel === "QB" || slotLabel === "RB"
      || slotLabel === "TE" || slotLabel === "K" || slotLabel === "P";
    return `<tr class="frn-scout-row ${isSel?"selected":""}"
      onclick="renderFrnPreseason('scout',${scoutId},'${view}','${escName}')">
      <td class="frn-scout-slot">${slotLabel}</td>
      <td style="font-weight:${isStarter?700:400}">${playerLink(p)}</td>
      <td>${_scoutGradeBadge(p, scoutedThisSeason)}</td>
      <td style="color:var(--gray)">${p.age || "?"}</td>
      <td style="color:var(--gray);font-size:.66rem">${draftStr(p)}</td>
      <td style="color:var(--gold);font-size:.7rem">$${(p.contract?.aav||0).toFixed(1)}M</td>
    </tr>`;
  };

  const rows = [];
  for (const pos of posOrder) {
    if (groupHeaders[pos]) {
      rows.push(`<tr class="frn-scout-group-hdr"><td colspan="6">${groupHeaders[pos]}</td></tr>`);
    }
    const all   = byPos[pos] || [];
    const limit = view === "starters" ? (SCOUT_STARTER_COUNTS[pos] || 1) : all.length;
    const shown = all.slice(0, limit);
    shown.forEach((p, i) => {
      const slotLabel = shown.length > 1 ? `${pos}${i+1}` : pos;
      rows.push(rowHtml(p, slotLabel));
    });
  }

  const escSel = selected ? (selected.name || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'") : "";
  const viewTabsHtml = `
    <div class="frn-scout-view-tabs">
      <button class="${view==="starters"?"active":""}"
              onclick="renderFrnPreseason('scout',${scoutId},'starters','${escSel}')">DEPTH CHART</button>
      <button class="${view==="full"?"active":""}"
              onclick="renderFrnPreseason('scout',${scoutId},'full','${escSel}')">FULL ROSTER (${oppRoster.length})</button>
    </div>`;

  return `<div class="frn-scout-layout">
    <div class="frn-scout-list">${listHtml}</div>
    <div class="frn-scout-detail">
      <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.5rem">
        <span style="font-size:1.8rem;color:var(--gold)">${teamAscii(oppTeam)}</span>
        <div style="flex:1">
          <div style="font-weight:900;font-size:1.05rem">${oppTeam.city} ${oppTeam.name.toUpperCase()}
            <span style="font-size:.75rem;font-weight:400;color:var(--gray);margin-left:.4rem">${oppRec}</span>
            ${scoutedThisSeason ? `<span style="color:var(--gold-lt);font-size:.6rem;border:1px solid var(--gold-lt);padding:.05rem .3rem;margin-left:.4rem">&#x1F3DF; SCOUTED</span>` : ""}
          </div>
          <div style="color:var(--gray);font-size:.7rem">
            OFF <b style="color:var(--gold)">${oppRtg.off}</b> ·
            DEF <b style="color:var(--gold)">${oppRtg.def}</b> ·
            Cap $${oppCap.toFixed(0)}M${oppWkLabel}${injuredStr}
          </div>
          <div style="margin-top:.3rem;display:flex;gap:.35rem;flex-wrap:wrap">
            ${typeof _getTeamOffScheme === "function" ? _schemeBadge(_getTeamOffScheme(scoutId)) : ""}
            ${typeof _getTeamDefScheme === "function" ? _schemeBadge(_getTeamDefScheme(scoutId)) : ""}
          </div>
        </div>
      </div>
      ${noiseBanner}
      ${threatsHtml}
      ${viewTabsHtml}
      <div class="frn-scout-split">
        <div class="frn-scout-roster">
          <table class="frn-pre-roster-table">
            <thead><tr><th></th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>AAV</th></tr></thead>
            <tbody>${rows.join("")}</tbody>
          </table>
        </div>
        <div class="frn-scout-player">${selected ? _buildScoutPlayerPanel(selected, scoutedThisSeason) : ""}</div>
      </div>
    </div>
  </div>`;
}

// ── Career stats + Hall of Fame helpers ──────────────────────────────────────
// Position-keyed HOF thresholds: combined career production benchmarks.
// Tuned for ~5% retirement-rate inclusion of real-stat-line stars.
const HOF_THRESHOLDS = {
  QB: p => (p.careerStats?.pass_yds||0) >= 28000 || (p.careerStats?.pass_td||0) >= 200,
  RB: p => (p.careerStats?.rush_yds||0) >= 8500 || (p.careerStats?.rush_td||0) >= 75,
  WR: p => (p.careerStats?.rec_yds ||0) >= 9000 || (p.careerStats?.rec_td ||0) >= 70,
  TE: p => (p.careerStats?.rec_yds ||0) >= 6000 || (p.careerStats?.rec_td ||0) >= 50,
  DL: p => (p.careerStats?.sk||0) >= 75 || (p.careerStats?.tkl||0) >= 450,
  LB: p => (p.careerStats?.tkl||0) >= 700 || (p.careerStats?.sk||0) >= 50,
  CB: p => (p.careerStats?.int_made||0) >= 25 || (p.careerStats?.pd||0) >= 80,
  S:  p => (p.careerStats?.int_made||0) >= 20 || (p.careerStats?.tkl||0) >= 500,
  K:  p => (p.careerStats?.fg_made||0) >= 220,
  P:  p => false,
};

function _maybeEnshrineHOF(player, team) {
  const check = HOF_THRESHOLDS[player.position];
  if (!check || !check(player)) return;
  if (!franchise.hallOfFame) franchise.hallOfFame = [];
  // Snapshot enough data to display the entry forever
  const _hofStatKeys = ["pass_yds","pass_td","rush_yds","rec_yds","sk","int_made","pancakes"];
  franchise.hallOfFame.push({
    name: player.name, pos: player.position,
    age: player.age, season: franchise.season,
    teamName: team ? `${team.city} ${team.name}` : "?",
    careerStats: { ...(player.careerStats || {}) },
    careerEarnings: player.careerEarnings || 0,
    careerYears: (player.careerHistory || []).length,
    careerHistory: (player.careerHistory || []).map(r => {
      const slim = { season: r.season, pos: r.pos };
      for (const k of _hofStatKeys) if (r[k]) slim[k] = r[k];
      return slim;
    }),
  });
  _pushNews({ type: "hof", season: franchise.season, label: `🏆 ${player.name} (${player.position}) enshrined in the Hall of Fame after ${player.careerHistory?.length || 0} seasons` });
}

// Build a career-stats card for any player — shown when you click into
// a player from the scout / roster screens. Falls back gracefully for
// rookies with no career data yet.
function _buildCareerCard(p) {
  const history = p.careerHistory || [];
  const stats   = p.careerStats   || {};
  if (history.length === 0) {
    const collLine  = p.collegeProfile?.line  || "";
    const collKnock = p.collegeProfile?.knock || "";
    const collBlock = collLine ? `
      <div style="margin:.35rem 0 .1rem;padding:.35rem .5rem;background:rgba(255,255,255,.04);border-left:2px solid var(--gray);border-radius:2px">
        <div style="font-size:.57rem;color:var(--gray);letter-spacing:.4px;margin-bottom:.18rem">COLLEGE</div>
        <div style="font-size:.65rem;color:var(--blgray)">${collLine}</div>
        ${collKnock ? `<div style="font-size:.62rem;color:#e8a000;margin-top:.15rem">⚠ ${collKnock}</div>` : ""}
      </div>` : "";
    return `<div class="frn-career-card">
      <div class="frn-card-title">📊 CAREER</div>
      <div style="color:var(--gray);font-size:.72rem;padding:.4rem 0">
        Rookie season — no career stats yet.
      </div>
      ${collBlock}
      <div class="frn-player-meta">
        <div><span class="frn-meta-label">DRAFT</span> ${draftStr(p)}</div>
        <div><span class="frn-meta-label">CAREER $</span> ${careerEarningsStr(p)}</div>
      </div>
    </div>`;
  }
  // Pick stat columns based on position
  const cols = _careerColsFor(p.position);
  const trajLabel = {
    EARLY_BLOOM: "⚡ Early Bloomer", LATE_BLOOM: "🌱 Late Bloomer",
    CONSISTENT: "📈 Consistent",    STREAKY: "〰 Streaky",
    FLASH: "💥 Flash",
  }[p._trajectory] || "";
  const _accAbbr = a => a === "MVP" ? "MVP" : a === "Super Bowl MVP" ? "SB MVP" : a === "Super Bowl" ? "💍" : a === "All-Pro" ? "AP1" : a === "All-Pro (2nd)" ? "AP2" : a === "Pro Bowl" ? "PB" : a === "OPOY" ? "OPOY" : a === "DPOY" ? "DPOY" : a === "ROY" ? "ROY" : a === "Comeback POY" ? "CPOY" : a === "Breakout POY" ? "BPOY" : "";
  const hasAcc = history.some(r => (r.accolades||[]).length > 0);
  const headerHtml = `<tr><th>AGE</th><th>TEAM</th><th>OVR</th><th>GP</th>${cols.map(c => `<th>${c.label}</th>`).join("")}${hasAcc ? "<th>🏆</th>" : ""}</tr>`;
  const rowsHtml = history.slice().reverse().map((row) => {
    const rowOvr = row.ovr ?? row.overall;
    const peakOvr = Math.max(...history.map(r => r.ovr ?? r.overall ?? 0));
    const isCareerBest = rowOvr != null && rowOvr === peakOvr;
    const accCell = hasAcc
      ? `<td style="font-size:.55rem;color:var(--gold);white-space:nowrap">${(row.accolades||[]).map(_accAbbr).filter(Boolean).join(" ")}</td>`
      : "";
    return `<tr>
      <td style="color:var(--gray);font-size:.63rem">${row.age ?? "?"}</td>
      <td style="font-size:.62rem;color:var(--gray)">${row.teamName}</td>
      <td style="color:${isCareerBest?"var(--gold)":"var(--blgray)"};font-weight:${isCareerBest?700:400}">${rowOvr || "—"}</td>
      <td>${row.gp || 0}</td>
      ${cols.map(c => `<td>${row[c.key] || 0}</td>`).join("")}
      ${accCell}
    </tr>`;
  }).join("");
  const totalsRow = `<tr style="border-top:2px solid var(--gold);font-weight:700">
    <td colspan="3" style="color:var(--gold)">CAREER</td>
    <td>${stats.gp || history.reduce((s,r)=>s+(r.gp||0),0)}</td>
    ${cols.map(c => `<td style="color:var(--gold-lt)">${stats[c.key]||0}</td>`).join("")}
    ${hasAcc ? "<td></td>" : ""}
  </tr>`;
  return `<div class="frn-career-card">
    <div style="display:flex;align-items:center;gap:.55rem;margin-bottom:.3rem">
      <div class="frn-card-title" style="margin:0">📊 CAREER · ${history.length} season${history.length>1?"s":""}</div>
      ${trajLabel ? `<span style="font-size:.58rem;color:var(--blgray)">${trajLabel}</span>` : ""}
    </div>
    <div style="overflow-x:auto">
      <table class="frn-pre-roster-table"><thead>${headerHtml}</thead>
        <tbody>${rowsHtml}${totalsRow}</tbody>
      </table>
    </div>
    <div class="frn-player-meta">
      <div><span class="frn-meta-label">DRAFT</span> ${draftStr(p)}</div>
      <div><span class="frn-meta-label">CAREER $</span> ${careerEarningsStr(p)}</div>
    </div>
  </div>`;
}

function _careerColsFor(pos) {
  if (pos === "QB") return [
    { key:"pass_yds", label:"YDS" }, { key:"pass_td", label:"TD" },
    { key:"pass_int", label:"INT" }, { key:"pass_att", label:"ATT" },
  ];
  if (pos === "RB") return [
    { key:"rush_yds", label:"YDS" }, { key:"rush_td", label:"TD" },
    { key:"rush_att", label:"ATT" }, { key:"rec_yds", label:"REC YDS" },
  ];
  if (pos === "WR" || pos === "TE") return [
    { key:"rec_yds", label:"YDS" }, { key:"rec_td", label:"TD" },
    { key:"rec", label:"REC" }, { key:"rec_tgt", label:"TGT" },
  ];
  if (pos === "DL") return [
    { key:"tkl", label:"TKL" }, { key:"sk", label:"SK" },
    { key:"ff", label:"FF" }, { key:"pd", label:"PD" },
  ];
  if (pos === "LB") return [
    { key:"tkl", label:"TKL" }, { key:"missed_tkl", label:"MISS" },
    { key:"sk", label:"SK" }, { key:"int_made", label:"INT" }, { key:"pd", label:"PD" },
  ];
  if (pos === "CB" || pos === "S") return [
    { key:"int_made", label:"INT" }, { key:"pd", label:"PD" },
    { key:"tkl", label:"TKL" }, { key:"missed_tkl", label:"MISS" }, { key:"def_td", label:"DEF TD" },
  ];
  if (pos === "K") return [
    { key:"fg_made", label:"FGM" }, { key:"fg_att", label:"FGA" },
    { key:"fg_long", label:"LONG" }, { key:"xp_made", label:"XP" },
  ];
  if (pos === "OL") return [
    { key:"pancakes", label:"PNK" }, { key:"sacks_allowed", label:"SA" },
  ];
  return [{ key:"gp", label:"GP" }];
}

// ── Injuries ──────────────────────────────────────────────────────────────────
// Per-game injury chance per player on a team, by position. Higher
// numbers for trench positions where contact is constant.
const INJURY_RATE = { QB:0.012, RB:0.022, WR:0.014, TE:0.016, OL:0.020,
                     DL:0.020, LB:0.018, CB:0.014, S:0.012, K:0.002, P:0.002 };
const INJURY_TYPES = [
  { label:"hamstring",   min:1, max:3, w:30 },
  { label:"ankle sprain",min:1, max:4, w:25 },
  { label:"concussion",  min:1, max:2, w:15 },
  { label:"knee",        min:3, max:8, w:10 },
  { label:"shoulder",    min:2, max:5, w:10 },
  { label:"hand/wrist",  min:1, max:3, w:10 },
];
function _pickInjuryType() {
  const total = INJURY_TYPES.reduce((s,t)=>s+t.w,0);
  let r = Math.random() * total;
  for (const t of INJURY_TYPES) { if ((r -= t.w) < 0) return t; }
  return INJURY_TYPES[0];
}
// Soft-tissue injuries recur at +20% per prior incident; structural
// injuries (knee, shoulder, concussion) recur at +40%. Capped at 3x
// the base rate so even chronically banged-up vets aren't auto-injured.
const _SOFT_TISSUE_INJURIES = new Set(["hamstring", "ankle sprain", "hand/wrist"]);
function _injuryRecurrenceMul(p) {
  const hist = p.injuryHistory || [];
  let mul = 1.0;
  for (const past of hist) {
    mul += _SOFT_TISSUE_INJURIES.has(past.label) ? 0.20 : 0.40;
  }
  return Math.min(3.0, mul);
}
function _isInjuryProne(p) {
  return (p.injuryHistory || []).length >= 3;
}
function _rollGameInjuries(teamId) {
  const roster = franchise.rosters[teamId] || [];
  const team = getTeam(teamId);
  // Disciplinarian HC culture: −20% injury rate; Players' Coach: +5%
  const cultureTrait = franchise.coaches?.[teamId]?.hc?.cultureTrait
                    || (franchise.coaches?.[teamId]?.hc?.trait === "Hard-Ass" ? "Disciplinarian" : null);
  const rateMul = cultureTrait === "Disciplinarian" ? 0.80
                : cultureTrait === "Players' Coach" ? 1.05 : 1.0;
  for (const p of roster) {
    if (p.injury && p.injury.weeksRemaining > 0) continue;
    const recMul = _injuryRecurrenceMul(p);
    const rate = (INJURY_RATE[p.position] || 0.01) * rateMul * recMul;
    if (Math.random() >= rate) continue;
    const t = _pickInjuryType();
    const wks = t.min + Math.floor(Math.random() * (t.max - t.min + 1));
    p.injury = { label: t.label, weeksRemaining: wks };
    // Persist injury history so future recurrence rates know about it.
    p.injuryHistory = p.injuryHistory || [];
    p.injuryHistory.push({
      label: t.label, week: franchise.week, season: franchise.season, weeks: wks,
    });
    if (p.injuryHistory.length > 20) p.injuryHistory = p.injuryHistory.slice(-20);
    // News only for notable injuries on user team or to top players
    const isMine = teamId === franchise.chosenTeamId;
    const grade = scoutGrade(p);
    if (isMine || grade >= 80) {
      const proneTag = _isInjuryProne(p) ? " (injury-prone)" : "";
      _pushNews({ type:"injury",
        label: `🩹 ${p.name} (${p.position}, ${team?.name||"?"})${proneTag} — ${t.label}, ${wks} wk${wks===1?"":"s"}` });
    }
  }
}
function _tickInjuriesForWeek() {
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) {
      if (!p.injury || p.injury.weeksRemaining <= 0) continue;
      p.injury.weeksRemaining -= 1;
      if (p.injury.weeksRemaining <= 0) p.injury = null;
    }
  }
}

// ── News ticker ──────────────────────────────────────────────────────────────
function _pushNews(item) {
  if (!franchise.news) franchise.news = [];
  franchise.news.push({ week: franchise.week || 0, season: franchise.season, ...item });
  // Cap kept high so a multi-season wire history survives. Each entry
  // is ~120 bytes so 500 entries is still small in localStorage.
  if (franchise.news.length > 500) franchise.news = franchise.news.slice(-500);
}

// Detail card for a single player — shown in Scout right side panel.
// Deliberately hides OVR. Uses scout grade, combine measurables, draft
// pedigree, and career earnings — same data a real scouting report works
// from, none of which is the simulator's hidden rating directly.
function _isOwnedPlayer(p) {
  const myId = franchise?.chosenTeamId;
  if (myId == null) return false;
  const roster = franchise?.rosters?.[myId] || [];
  return roster.some(rp => rp === p || rp.name === p.name);
}

// Production-ready human label for an archetype. Prefers the
// position-specific archetype table's `.label` (e.g.
// "Dual Threat", "Field General"); falls back to title-casing
// the raw key. Never returns the underscore-form like
// "DUAL_THREAT" to UI.
function _archetypeLabel(p) {
  if (!p || !p.archetype) return "";
  const tables = {
    QB: typeof QB_ARCHETYPES !== "undefined" ? QB_ARCHETYPES : null,
    RB: typeof RB_ARCHETYPES !== "undefined" ? RB_ARCHETYPES : null,
    WR: typeof WR_ARCHETYPES !== "undefined" ? WR_ARCHETYPES : null,
    TE: typeof TE_ARCHETYPES !== "undefined" ? TE_ARCHETYPES : null,
    OL: typeof OL_ARCHETYPES !== "undefined" ? OL_ARCHETYPES : null,
    DL: typeof DL_ARCHETYPES !== "undefined" ? DL_ARCHETYPES : null,
    LB: typeof LB_ARCHETYPES !== "undefined" ? LB_ARCHETYPES : null,
    CB: typeof CB_ARCHETYPES !== "undefined" ? CB_ARCHETYPES : null,
    S:  typeof S_ARCHETYPES  !== "undefined" ? S_ARCHETYPES  : null,
    K:  typeof K_ARCHETYPES  !== "undefined" ? K_ARCHETYPES  : null,
    P:  typeof P_ARCHETYPES  !== "undefined" ? P_ARCHETYPES  : null,
  };
  const entry = (tables[p.position] || {})[p.archetype];
  if (entry?.label) return entry.label;
  // Fallback: title-case the raw key, replace underscores with spaces.
  return String(p.archetype)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Per-position stat keys to highlight. SPD/STR/AGI/AWR/THR/CAT/BLK/PRS/COV/TCK/KPW.
const _STAT_INDEX = { SPD:0, STR:1, AGI:2, AWR:3, THR:4, CAT:5, BLK:6, PRS:7, COV:8, TCK:9, KPW:10 };
const _OWNED_STATS_BY_POS = {
  QB: ["AWR","THR","SPD","AGI","STR"],
  RB: ["SPD","STR","AGI","CAT","AWR"],
  WR: ["SPD","CAT","AGI","AWR","STR"],
  TE: ["CAT","BLK","STR","SPD","AWR"],
  OL: ["STR","BLK","AWR","AGI"],
  DL: ["STR","PRS","TCK","SPD","AWR"],
  LB: ["TCK","PRS","COV","SPD","AWR"],
  CB: ["SPD","COV","AGI","AWR","TCK"],
  S:  ["SPD","COV","TCK","AWR","AGI"],
  K:  ["KPW","AWR"],
  P:  ["KPW","AWR"],
};

function _buildOwnedStatsPanel(p) {
  const keys = _OWNED_STATS_BY_POS[p.position] || ["SPD","STR","AGI","AWR"];
  const stats = p.stats || [];
  const rows = keys.map(k => {
    const v = stats[_STAT_INDEX[k]] ?? 0;
    return `<div class="frn-rawstat-row">
      <span class="frn-rawstat-key">${k}</span>
      <span class="frn-rawstat-bar"><span class="frn-rawstat-bar-fill" style="width:${Math.max(0, Math.min(100, v))}%"></span></span>
      <span class="frn-rawstat-val">${v}</span>
    </div>`;
  }).join("");
  return `<div class="frn-pcard-section">
    <div class="frn-card-title">
      MEASURED RATINGS <span class="frn-pcard-private-badge">🔒 INTERNAL</span>
    </div>
    ${rows}
    <div style="color:var(--gray);font-size:.6rem;margin-top:.35rem;font-style:italic">
      Your training staff sees these — opponents only see the noisy grade.
    </div>
  </div>`;
}

function _buildArchetypeBlock(p) {
  // Best-effort: look up ARCHETYPE_BY_POS in window if available.
  let entry = null;
  try {
    const byPos = {
      QB: typeof QB_ARCHETYPES !== "undefined" ? QB_ARCHETYPES : null,
      RB: typeof RB_ARCHETYPES !== "undefined" ? RB_ARCHETYPES : null,
      WR: typeof WR_ARCHETYPES !== "undefined" ? WR_ARCHETYPES : null,
      TE: typeof TE_ARCHETYPES !== "undefined" ? TE_ARCHETYPES : null,
      OL: typeof OL_ARCHETYPES !== "undefined" ? OL_ARCHETYPES : null,
      DL: typeof DL_ARCHETYPES !== "undefined" ? DL_ARCHETYPES : null,
      LB: typeof LB_ARCHETYPES !== "undefined" ? LB_ARCHETYPES : null,
      CB: typeof CB_ARCHETYPES !== "undefined" ? CB_ARCHETYPES : null,
      S:  typeof S_ARCHETYPES  !== "undefined" ? S_ARCHETYPES  : null,
      K:  typeof K_ARCHETYPES  !== "undefined" ? K_ARCHETYPES  : null,
      P:  typeof P_ARCHETYPES  !== "undefined" ? P_ARCHETYPES  : null,
    };
    entry = (byPos[p.position] || {})[p.archetype];
  } catch {}
  if (!entry) return "";
  return `<div class="frn-pcard-archetype">
    <div class="frn-pcard-archetype-name">${(entry.label || p.archetype || "").toUpperCase()}</div>
    <div class="frn-pcard-archetype-blurb">${entry.blurb || ""}</div>
  </div>`;
}

// PPR fantasy points for a single stat line. Single source of truth so
// season totals, per-game lines, and rank calculations all agree.
function _fantasyPPR(line, pos) {
  if (!line) return 0;
  let f = 0;
  if (pos === "QB") f += (line.pass_yds||0)*0.04 + (line.pass_td||0)*4 - (line.pass_int||0)*2;
  f += (line.rush_yds||0)*0.1 + (line.rush_td||0)*6;
  f += (line.rec||0)*1 + (line.rec_yds||0)*0.1 + (line.rec_td||0)*6;
  f += (line.tkl||0)*1 + (line.sk||0)*2 + (line.int_made||0)*4 + (line.ff||0)*2 + (line.fr||0)*2 + (line.pd||0)*0.5;
  f += (line.fg_made||0)*3 + (line.xp_made||0)*1;
  // Bonus PPR yardage tiers — closer to standard fantasy with TD-only bonus
  if ((line.pass_yds||0) >= 300) f += 3;
  if ((line.rush_yds||0) >= 100) f += 3;
  if ((line.rec_yds||0) >= 100) f += 3;
  return Math.round(f * 10) / 10;
}

// Position-rank by total FPTS across every roster in the league.
// Returns { rank, total } where total = number of players at that pos
// who have logged any stats this season.
function _fantasyPositionRank(playerName, pos) {
  const seasonStats = franchise?.seasonStats || {};
  const bucket = [];
  for (const [tid, players] of Object.entries(seasonStats)) {
    for (const [name, line] of Object.entries(players || {})) {
      if (line && line.pos === pos) {
        bucket.push({ name, fpts: _fantasyPPR(line, pos) });
      }
    }
  }
  if (!bucket.length) return null;
  bucket.sort((a, b) => b.fpts - a.fpts);
  const idx = bucket.findIndex(b => b.name === playerName);
  if (idx === -1) return null;
  return { rank: idx + 1, total: bucket.length, fpts: bucket[idx].fpts };
}

// Simple passer rating from CMP/ATT/YDS/TD/INT. NFL formula, clamped.
function _passerRating(comp, att, yds, td, int_) {
  if (!att) return 0;
  const a = Math.max(0, Math.min(2.375, ((comp/att) - 0.3) * 5));
  const b = Math.max(0, Math.min(2.375, ((yds/att) - 3) * 0.25));
  const c = Math.max(0, Math.min(2.375, (td/att) * 20));
  const d = Math.max(0, Math.min(2.375, 2.375 - (int_/att) * 25));
  return Math.round(((a + b + c + d) / 6) * 100 * 10) / 10;
}

function _buildSeasonStatsBlock(p) {
  if (!franchise?.seasonStats) return "";
  // Search every team in case the player was traded mid-season.
  let stat = null, teamId = null;
  for (const [tid, ts] of Object.entries(franchise.seasonStats || {})) {
    if (ts && ts[p.name]) { stat = ts[p.name]; teamId = Number(tid); break; }
  }
  if (!stat || !stat.gp) return "";
  // Position-specific stat lines (totals + derived averages)
  const pos = p.position;
  const fmtTuples = [];
  const num = k => +(stat[k] || 0);
  const gp = num("gp") || stat.gp || 1;
  const per = v => (v / gp).toFixed(1);
  if (pos === "QB") {
    const cmp = num("pass_comp"), att = num("pass_att"), yds = num("pass_yds");
    fmtTuples.push(["CMP/ATT", `${cmp}/${att}`]);
    fmtTuples.push(["CMP %", att ? `${(cmp/att*100).toFixed(1)}%` : "—"]);
    fmtTuples.push(["PASS YDS", yds]);
    fmtTuples.push(["YDS/GAME", per(yds)]);
    fmtTuples.push(["PASS TD", num("pass_td")]);
    fmtTuples.push(["INT", num("pass_int")]);
    fmtTuples.push(["RATING", _passerRating(cmp, att, yds, num("pass_td"), num("pass_int"))]);
    if (num("snaps")) fmtTuples.push(["SNAPS", num("snaps")]);
    if (num("rush_att")) { fmtTuples.push(["RUSH ATT", num("rush_att")]); fmtTuples.push(["RUSH YDS", num("rush_yds")]); }
    if (num("rush_td")) fmtTuples.push(["RUSH TD", num("rush_td")]);
  } else if (pos === "RB") {
    const car = num("rush_att"), yds = num("rush_yds");
    fmtTuples.push(["CAR", car]);
    fmtTuples.push(["RUSH YDS", yds]);
    fmtTuples.push(["YPC", car ? (yds/car).toFixed(1) : "—"]);
    fmtTuples.push(["YDS/GAME", per(yds)]);
    fmtTuples.push(["RUSH TD", num("rush_td")]);
    if (num("broken_tackles")) fmtTuples.push(["BROKEN TKL", num("broken_tackles")]);
    if (num("snaps")) fmtTuples.push(["SNAPS", num("snaps")]);
    if (num("rec")) {
      fmtTuples.push(["REC", num("rec")]);
      fmtTuples.push(["REC YDS", num("rec_yds")]);
      fmtTuples.push(["REC TD", num("rec_td")]);
    }
  } else if (pos === "WR" || pos === "TE") {
    const rec = num("rec"), yds = num("rec_yds"), tgt = num("rec_tgt");
    fmtTuples.push(["REC", rec]);
    fmtTuples.push(["TGT", tgt]);
    fmtTuples.push(["REC YDS", yds]);
    fmtTuples.push(["YPR", rec ? (yds/rec).toFixed(1) : "—"]);
    fmtTuples.push(["YDS/GAME", per(yds)]);
    if (num("snaps")) fmtTuples.push(["SNAPS", num("snaps")]);
    fmtTuples.push(["REC TD", num("rec_td")]);
    fmtTuples.push(["CATCH %", tgt ? `${(rec/tgt*100).toFixed(1)}%` : "—"]);
  } else if (pos === "DL" || pos === "LB" || pos === "CB" || pos === "S") {
    const tklN = num("tkl"), missN = num("missed_tkl");
    fmtTuples.push(["TKL", tklN]);
    fmtTuples.push(["TKL/GAME", per(tklN)]);
    if (missN) fmtTuples.push(["MISS TKL", missN]);
    if (missN || tklN) {
      const total = tklN + missN;
      fmtTuples.push(["TKL%", total ? `${((tklN / total) * 100).toFixed(0)}%` : "—"]);
    }
    if (num("sk")) fmtTuples.push(["SK", num("sk")]);
    if (num("int_made")) fmtTuples.push(["INT", num("int_made")]);
    if (num("pd")) fmtTuples.push(["PD", num("pd")]);
    if (num("ff")) fmtTuples.push(["FF", num("ff")]);
    if (num("fr")) fmtTuples.push(["FR", num("fr")]);
    if (num("def_td")) fmtTuples.push(["DEF TD", num("def_td")]);
  } else if (pos === "K") {
    fmtTuples.push(["FG", `${num("fg_made")}/${num("fg_att")}`]);
    fmtTuples.push(["FG %", num("fg_att") ? `${(num("fg_made")/num("fg_att")*100).toFixed(1)}%` : "—"]);
    fmtTuples.push(["LONG", num("fg_long")]);
    fmtTuples.push(["XP", `${num("xp_made")}/${num("xp_att")}`]);
  } else if (pos === "OL") {
    fmtTuples.push(["PANCAKES", num("pancakes")]);
    fmtTuples.push(["SACKS ALLOWED", num("sacks_allowed")]);
    if (num("penalties")) fmtTuples.push(["PENALTIES", num("penalties")]);
  }
  if (!fmtTuples.length) return "";

  // Fantasy stats — appended after position-specific stats. Computed
  // from per-game lines so best/worst game is accurate.
  let fantasyHtml = "";
  if (["QB","RB","WR","TE","K"].includes(pos)) {
    // Sum per-game FPTS by scanning every played game for this player.
    const perGame = [];
    for (const g of (franchise.schedule || [])) {
      if (!g.played || !g.stats) continue;
      const line = g.stats.home?.players?.[p.name] || g.stats.away?.players?.[p.name];
      if (line) perGame.push({ week: g.week, fpts: _fantasyPPR(line, pos) });
    }
    const totalFpts = perGame.reduce((s, x) => s + x.fpts, 0);
    const fptsPg = perGame.length ? (totalFpts / perGame.length).toFixed(1) : "0.0";
    const best = perGame.length ? perGame.reduce((a, b) => b.fpts > a.fpts ? b : a) : null;
    const worst = perGame.length ? perGame.reduce((a, b) => b.fpts < a.fpts ? b : a) : null;
    const rank = _fantasyPositionRank(p.name, pos);
    // Opportunities = touches (carries + targets) — top fantasy stat
    const touches = num("rush_att") + num("rec_tgt");
    const fantasyTuples = [
      ["FPTS (PPR)", totalFpts.toFixed(1)],
      ["FPTS / GAME", fptsPg],
    ];
    if (rank) fantasyTuples.push([`POS RANK`, `#${rank.rank} of ${rank.total}`]);
    if (touches > 0) fantasyTuples.push(["TOUCHES", touches]);
    if (best) fantasyTuples.push(["BEST WK", `W${best.week} (${best.fpts.toFixed(1)})`]);
    if (worst && best && worst.week !== best.week) fantasyTuples.push(["WORST WK", `W${worst.week} (${worst.fpts.toFixed(1)})`]);
    const fantasyCells = fantasyTuples.map(([k, v]) =>
      `<div class="k">${k}</div><div class="v">${v}</div>`
    ).join("");
    fantasyHtml = `<div style="margin-top:.5rem;padding-top:.4rem;border-top:1px dashed var(--border)">
      <div class="frn-card-title" style="margin-bottom:.25rem">FANTASY (PPR)</div>
      <div class="frn-pcard-seasonstats">${fantasyCells}</div>
    </div>`;
  }

  const cells = fmtTuples.map(([k, v]) =>
    `<div class="k">${k}</div><div class="v">${v}</div>`
  ).join("");
  return `<div class="frn-pcard-section">
    <div class="frn-card-title">📈 SEASON TOTALS · ${stat.gp || 0} GP</div>
    <div class="frn-pcard-seasonstats">${cells}</div>
    ${fantasyHtml}
  </div>`;
}

// Per-game stat line — walks the franchise schedule, finds every played
// game where this player appeared, returns one row per game with a
// position-appropriate line.
function _buildGameLogBlock(p) {
  if (!franchise?.schedule) return "";
  const pos = p.position;
  const games = [];
  for (const g of franchise.schedule) {
    if (!g.played || !g.stats) continue;
    const homePlayers = g.stats.home?.players || {};
    const awayPlayers = g.stats.away?.players || {};
    let line = null, teamId = null, oppId = null;
    if (homePlayers[p.name]) { line = homePlayers[p.name]; teamId = g.homeId; oppId = g.awayId; }
    else if (awayPlayers[p.name]) { line = awayPlayers[p.name]; teamId = g.awayId; oppId = g.homeId; }
    if (!line) continue;
    games.push({ g, line, teamId, oppId });
  }
  if (!games.length) return "";
  // Show newest game first
  games.sort((a, b) => b.g.week - a.g.week);
  // Detect if older games were trimmed: look up season GP from seasonStats
  let seasonGP = 0;
  for (const ts of Object.values(franchise.seasonStats || {})) {
    if (ts && ts[p.name]) { seasonGP = +(ts[p.name].gp || 0); break; }
  }
  const missingNote = (seasonGP > 0 && games.length < seasonGP)
    ? `<div style="font-size:.6rem;color:var(--gray);font-style:italic;margin-bottom:.3rem">Showing ${games.length} of ${seasonGP} games — earlier stats compressed for storage</div>`
    : "";
  // If the player suited up for multiple teams this season (mid-season
  // trade), surface a "TM" column so the lineage is visible.
  const distinctTeams = new Set(games.map(x => x.teamId));
  const showTM = distinctTeams.size > 1;
  const tmCell = (teamId) => {
    if (!showTM) return "";
    const t = getTeam(teamId);
    return `<td style="font-weight:800;color:${t?.primary || "var(--gray)"};font-size:.62rem">${t ? _bspnLiveAbbr(t) : "—"}</td>`;
  };
  const tmHeader = showTM ? `<th>TM</th>` : "";
  // Render columns per position
  let headers = [], rowCells = [];
  if (pos === "QB") {
    const hasQBRush = games.some(({ line }) => (line.rush_att || 0) > 0);
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","CMP/ATT","YDS","TD","INT","RTG",...(hasQBRush ? ["CAR","RYD","RTD"] : []),"FPTS"];
    rowCells = games.map(({ g, line, teamId, oppId }) => {
      const opp = getTeam(oppId), my = getTeam(teamId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const cmp = +line.pass_comp || 0, att = +line.pass_att || 0;
      const fpts = _fantasyPPR(line, pos);
      return `<tr>
        <td>W${g.week}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${cmp}/${att}</td>
        <td>${line.pass_yds||0}</td>
        <td>${line.pass_td||0}</td>
        <td>${line.pass_int||0}</td>
        <td>${_passerRating(cmp, att, line.pass_yds||0, line.pass_td||0, line.pass_int||0)}</td>
        ${hasQBRush ? `<td>${line.rush_att||0}</td><td>${line.rush_yds||0}</td><td>${line.rush_td||0}</td>` : ""}
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "RB") {
    const hasBT = games.some(({ line }) => (line.broken_tackles || 0) > 0);
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","CAR","YDS","YPC","TD",...(hasBT?["BT"]:[]),"REC","REC YDS","FPTS"];
    rowCells = games.map(({ g, line, teamId, oppId }) => {
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const car = +line.rush_att || 0, yds = +line.rush_yds || 0;
      const bt = line.broken_tackles || 0;
      const fpts = _fantasyPPR(line, pos);
      return `<tr>
        <td>W${g.week}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${car}</td>
        <td>${yds}</td>
        <td>${car ? (yds/car).toFixed(1) : "—"}</td>
        <td>${line.rush_td||0}</td>
        ${hasBT ? `<td style="color:${bt>0?"var(--green-lt)":"var(--gray)"}">${bt}</td>` : ""}
        <td>${line.rec||0}</td>
        <td>${line.rec_yds||0}</td>
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "WR" || pos === "TE") {
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","REC","TGT","YDS","YPR","TD","FPTS"];
    rowCells = games.map(({ g, line, teamId, oppId }) => {
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const rec = +line.rec || 0, yds = +line.rec_yds || 0;
      const fpts = _fantasyPPR(line, pos);
      return `<tr>
        <td>W${g.week}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${rec}</td>
        <td>${line.rec_tgt||0}</td>
        <td>${yds}</td>
        <td>${rec ? (yds/rec).toFixed(1) : "—"}</td>
        <td>${line.rec_td||0}</td>
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "DL" || pos === "LB" || pos === "CB" || pos === "S") {
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","TKL","MISS","SK","INT","PD","FF","FPTS"];
    rowCells = games.map(({ g, line, teamId, oppId }) => {
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const fpts = _fantasyPPR(line, pos);
      const miss = line.missed_tkl || 0;
      return `<tr>
        <td>W${g.week}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${line.tkl||0}</td>
        <td style="color:${miss > 0 ? "#c08080" : "var(--gray)"}">${miss}</td>
        <td>${line.sk||0}</td>
        <td>${line.int_made||0}</td>
        <td>${line.pd||0}</td>
        <td>${line.ff||0}</td>
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "K") {
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","FG","LONG","XP","FPTS"];
    rowCells = games.map(({ g, line, teamId, oppId }) => {
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      const fpts = _fantasyPPR(line, pos);
      return `<tr>
        <td>W${g.week}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${line.fg_made||0}/${line.fg_att||0}</td>
        <td>${line.fg_long||0}</td>
        <td>${line.xp_made||0}/${line.xp_att||0}</td>
        <td style="color:var(--gold);font-weight:700">${fpts.toFixed(1)}</td>
      </tr>`;
    });
  } else if (pos === "OL") {
    headers = ["WK", ...(showTM ? ["TM"] : []), "OPP","RES","PNK","SA","PEN"];
    rowCells = games.map(({ g, line, teamId, oppId }) => {
      const opp = getTeam(oppId);
      const myHome = teamId === g.homeId;
      const myScore = myHome ? g.homeScore : g.awayScore;
      const themScore = myHome ? g.awayScore : g.homeScore;
      const res = myScore > themScore ? "W" : myScore < themScore ? "L" : "T";
      const resColor = res === "W" ? "var(--green-lt)" : res === "L" ? "#c08080" : "var(--gray)";
      return `<tr>
        <td>W${g.week}</td>
        ${tmCell(teamId)}
        <td>${myHome ? "vs" : "@"} <span style="color:${opp?.primary}">${(opp?.name||"").slice(0,4)}</span></td>
        <td style="color:${resColor};font-weight:700">${res} ${myScore}-${themScore}</td>
        <td>${line.pancakes||0}</td>
        <td style="color:${(line.sacks_allowed||0)>0?"#c08080":"inherit"}">${line.sacks_allowed||0}</td>
        <td>${line.penalties||0}</td>
      </tr>`;
    });
  } else {
    return "";
  }
  return `<div class="frn-pcard-section">
    <div class="frn-card-title">GAME LOG · ${games.length} GAME${games.length===1?"":"S"}</div>
    ${missingNote}
    <div style="overflow-x:auto">
      <table class="frn-gamelog-table">
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rowCells.join("")}</tbody>
      </table>
    </div>
  </div>`;
}

// Compact strip showing the player's last 3 games with colour-coded FPTS pills.
function _buildRecentFormStrip(p) {
  if (!franchise?.schedule) return "";
  const pos = p.position;
  const played = [];
  for (const g of franchise.schedule) {
    if (!g.played || !g.stats) continue;
    const line = g.stats.home?.players?.[p.name] || g.stats.away?.players?.[p.name];
    if (!line) continue;
    played.push({ week: g.week, line, oppId: g.stats.home?.players?.[p.name] ? g.awayId : g.homeId });
  }
  if (!played.length) return "";
  played.sort((a, b) => b.week - a.week);
  const recent = played.slice(0, 3);
  // Season average FPTS (all played games we have stats for)
  const allFpts = played.map(x => _fantasyPPR(x.line, pos));
  const avgFpts = allFpts.length ? allFpts.reduce((s, v) => s + v, 0) / allFpts.length : 0;
  const pills = recent.map(({ week, line, oppId }) => {
    const fpts = _fantasyPPR(line, pos);
    const opp = getTeam(oppId);
    const oppAbbr = opp ? (opp.abbr || opp.name.slice(0, 4)) : "?";
    let color = "var(--gray)";
    if (avgFpts > 0) {
      if (fpts >= avgFpts * 1.2) color = "var(--green-lt)";
      else if (fpts >= avgFpts * 0.8) color = "var(--gold)";
      else color = "#c08080";
    } else {
      if (fpts >= 15) color = "var(--green-lt)";
      else if (fpts >= 8) color = "var(--gold)";
      else color = "#c08080";
    }
    let secondary = "";
    if (pos === "QB") {
      const rating = _passerRating(+line.pass_comp||0, +line.pass_att||0, +line.pass_yds||0, +line.pass_td||0, +line.pass_int||0);
      secondary = ` · RTG ${rating}`;
    }
    return `<div style="display:inline-flex;align-items:center;gap:.3rem;background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:.3rem;padding:.15rem .45rem;font-size:.62rem;white-space:nowrap">
      <span style="color:var(--gray)">W${week} vs ${oppAbbr}</span>
      <span style="color:${color};font-weight:700">${fpts.toFixed(1)} pts${secondary}</span>
    </div>`;
  }).join("");
  return `<div class="frn-pcard-section">
    <div class="frn-card-title" style="margin-bottom:.3rem">LAST 3 GAMES</div>
    <div style="display:flex;flex-wrap:wrap;gap:.35rem">${pills}</div>
  </div>`;
}

function _buildContractBreakdownBlock(p) {
  const c = p.contract;
  if (!c || !c.aav) return "";
  const years      = c.years || 1;
  const remaining  = c.remaining || 1;
  const proration  = c.bonusProration || 0;
  const bases      = c.baseSalaries || Array(years).fill(+(c.aav - proration).toFixed(1));
  const curYrIdx   = Math.max(0, years - remaining);
  const guaranteed = c.guaranteedYears || 0;
  const structLabel = c.structure === "FRONTLOADED" ? "⬆ Front-loaded" :
                      c.structure === "BACKLOADED"  ? "⬇ Back-loaded"  : "— Balanced";
  const structColor = c.structure === "FRONTLOADED" ? "var(--green-lt)" :
                      c.structure === "BACKLOADED"  ? "#ff9090"         : "var(--gray)";

  // Build year rows
  const rows = bases.map((base, i) => {
    const capHit    = Math.round((base + proration) * 10) / 10;
    const isCur     = i === curYrIdx;
    const isPast    = i < curYrIdx;
    const isGuarant = i < guaranteed;
    // Dead cap = proration × years left after this cut point
    const deadCap   = proration > 0
      ? Math.round(proration * (Math.min(years, curYrIdx + (years - curYrIdx)) - i) * 10) / 10
      : 0;
    // Actually dead cap if cut at start of this year = proration × remaining years of bonus
    const prorationYears = Math.min(years, 5);
    const prorationRemaining = Math.max(0, prorationYears - i);
    const deadIfCut = Math.round(proration * prorationRemaining * 10) / 10;

    const rowBg = isCur ? "rgba(200,169,0,.12)" : isPast ? "rgba(255,255,255,.02)" : "";
    const textColor = isPast ? "var(--gray)" : isCur ? "var(--white)" : "rgba(255,255,255,.85)";
    const hitColor = isCur ? "var(--gold)" : isPast ? "var(--gray)" : "rgba(255,255,255,.85)";
    return `<tr style="background:${rowBg}">
      <td style="color:${textColor};font-size:.64rem;white-space:nowrap">
        Yr ${i+1}${isCur ? " <span style=\"color:var(--gold);font-size:.55rem\">◀ NOW</span>" : isPast ? " <span style=\"color:var(--gray);font-size:.55rem\">✓</span>" : ""}
        ${isGuarant ? "<span style=\"color:var(--green-lt);font-size:.52rem;margin-left:.2rem\">GTD</span>" : ""}
      </td>
      <td style="color:${textColor};font-size:.64rem;text-align:right">$${base.toFixed(1)}M</td>
      <td style="color:${proration>0?"var(--gold-lt)":"var(--gray)"};font-size:.64rem;text-align:right">
        ${proration > 0 ? `+$${proration.toFixed(1)}M` : "—"}
      </td>
      <td style="color:${hitColor};font-weight:${isCur?"700":"400"};font-size:.64rem;text-align:right">
        $${capHit.toFixed(1)}M
      </td>
      <td style="color:${deadIfCut > 0 ? "#ff9090" : "var(--gray)"};font-size:.62rem;text-align:right">
        ${deadIfCut > 0.05 ? `☠ $${deadIfCut.toFixed(1)}M` : "—"}
      </td>
    </tr>`;
  }).join("");

  const totalGuaranteed = Math.round(c.guaranteedAAV * (c.years||1) * 10) / 10;
  const totalRemaining  = Math.round(c.aav * remaining * 10) / 10;

  return `<div class="frn-pcard-section" style="margin-top:.6rem">
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.35rem;flex-wrap:wrap">
      <div class="frn-card-title">📋 CONTRACT BREAKDOWN</div>
      <span style="color:${structColor};font-size:.6rem;font-weight:700">${structLabel}</span>
      ${c.tradeKicker > 0 ? `<span style="color:var(--gold);font-size:.6rem" title="One-time cap hit if acquired via trade">⚡ Trade kicker $${c.tradeKicker.toFixed(1)}M</span>` : ""}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:.65rem">
      <thead>
        <tr style="border-bottom:1px solid var(--border)">
          <th style="text-align:left;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">YR</th>
          <th style="text-align:right;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">BASE</th>
          <th style="text-align:right;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">BONUS</th>
          <th style="text-align:right;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">CAP HIT</th>
          <th style="text-align:right;color:var(--gray);font-weight:600;padding:.15rem .2rem;font-size:.58rem">DEAD (IF CUT)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="display:flex;gap:1rem;margin-top:.4rem;flex-wrap:wrap;font-size:.6rem;color:var(--gray)">
      <span>Remaining: <b style="color:var(--white)">$${totalRemaining.toFixed(1)}M</b></span>
      ${c.signingBonus > 0 ? `<span>Sign bonus: <b style="color:var(--gold-lt)">$${c.signingBonus.toFixed(1)}M</b> (÷${Math.min(c.years||1,5)}yr)</span>` : ""}
      ${guaranteed > 0 ? `<span>Guaranteed yrs: <b style="color:var(--green-lt)">${guaranteed}</b></span>` : ""}
    </div>
  </div>`;
}

function _buildAccoladesBanner(p) {
  const chips = [];
  const isHof = (franchise.hallOfFame || []).some(h => h.name === p.name);
  const allAcc  = (p.careerHistory || []).flatMap(h => h.accolades || []);
  const sbMvpCount = allAcc.filter(a => a === "Super Bowl MVP").length;
  const pureRings  = allAcc.filter(a => a === "Super Bowl").length;
  const ap1Count   = allAcc.filter(a => a === "All-Pro").length;
  const ap2Count   = allAcc.filter(a => a === "All-Pro (2nd)").length;
  const purePB     = Math.max(0, (p.proBowls || 0) - ap1Count - ap2Count);
  if (isHof)             chips.push(["🏛", "HOF",                    "var(--gold)"]);
  if ((p.mvps||0) > 0)  chips.push(["🥇", `${p.mvps}× MVP`,         "var(--gold)"]);
  if ((p.opoys||0) > 0) chips.push(["⚡", `${p.opoys}× OPOY`,       "var(--gold)"]);
  if ((p.dpoys||0) > 0) chips.push(["🛡", `${p.dpoys}× DPOY`,       "var(--gold)"]);
  if ((p.roys||0) > 0)  chips.push(["🌟", "ROY",                     "var(--gold-lt)"]);
  if (sbMvpCount > 0)   chips.push(["🏆", `${sbMvpCount}× SB MVP`,  "var(--gold)"]);
  if (pureRings > 0)    chips.push(["💍", `${pureRings}× Ring`,      "var(--gold)"]);
  if (ap1Count > 0)     chips.push(["⭐", `${ap1Count}× AP 1st`,     "var(--gold)"]);
  if (ap2Count > 0)     chips.push(["✦",  `${ap2Count}× AP 2nd`,     "var(--gold-lt)"]);
  if (purePB > 0)       chips.push(["🎳", `${purePB}× Pro Bowl`,     "var(--blgray)"]);
  if (!chips.length) return "";
  return `<div style="display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.3rem">
    ${chips.map(([icon, text, color]) =>
      `<span style="font-size:.58rem;padding:.1rem .4rem;border-radius:4px;background:rgba(255,200,0,.12);color:${color};border:1px solid rgba(255,200,0,.25);white-space:nowrap">${icon} ${text}</span>`
    ).join("")}
  </div>`;
}

function _buildPlayerDetailPanel(p) {
  const g    = scoutGrade(p);
  const gL   = gradeLabel(g);
  const cmb  = combineMeasurables(p);
  const aav  = p.contract?.aav || 0;
  const yrs  = p.contract?.remaining || 0;
  const flav = p.flavor?.desc || "";
  const owned = _isOwnedPlayer(p);

  // Combine measurables — always visible. Owned roster also gets raw
  // ratings panel beside it.
  const isKicker = p.position === "K" || p.position === "P";
  const combineHtml = isKicker
    ? `<div class="frn-combine-grid">
         <div><span class="frn-meta-label">LEG</span> ${Math.round(70 + (cmb.kpw - 50) * 0.45)} yds</div>
         <div><span class="frn-meta-label">40-YD</span> ${cmb.fortyTime}s</div>
       </div>`
    : `<div class="frn-combine-grid">
         <div><span class="frn-meta-label">40-YD</span> ${cmb.fortyTime}s</div>
         <div><span class="frn-meta-label">BENCH</span> ${cmb.benchReps} reps</div>
         <div><span class="frn-meta-label">CONE</span> ${cmb.coneTime}s</div>
         <div><span class="frn-meta-label">VERT</span> ${cmb.verticalIn}"</div>
       </div>`;

  const combinePanel = `<div class="frn-pcard-section">
    <div class="frn-card-title">COMBINE</div>
    ${combineHtml}
  </div>`;

  const potTag = potentialTag(p, { known: _isKnownPlayer(p) });
  const archBlock = _buildArchetypeBlock(p);
  const seasonBlock = _buildSeasonStatsBlock(p);
  const recentFormStrip = _buildRecentFormStrip(p);
  const streaksBlock = _buildStreaksBlock(p);
  const gameLogBlock = _buildGameLogBlock(p);
  const contractBlock = _buildContractBreakdownBlock(p);
  const ratingsPanel = owned ? _buildOwnedStatsPanel(p) : "";

  // Right-column content: owned → raw ratings, otherwise scout note.
  const rightPanel = owned ? ratingsPanel : `<div class="frn-pcard-section">
    <div class="frn-card-title">SCOUTING NOTE</div>
    <div style="font-size:.68rem;color:var(--gray);line-height:1.4">
      Internal ratings are hidden for opposing players. Run a joint
      practice (Scrimmage tab) against this team to sharpen the
      grade noise from ±8 to ±2.
    </div>
  </div>`;

  return `<div class="frn-player-card">
    <div class="frn-player-card-head" style="display:flex;gap:.9rem;align-items:flex-start;padding-right:2.5rem">
      ${_playerPortrait(p, 110)}
      <div style="flex:1;min-width:0">
        <div style="font-size:1.15rem;font-weight:900">${p.name}</div>
        ${_buildAccoladesBanner(p)}
        <div style="color:var(--gray);font-size:.72rem;margin-top:.2rem">
          #${jerseyForPlayer(p) || "—"} · ${p.position} · Age ${p.age || "?"}${p.height?` · ${formatHeight(p.height)}, ${p.weight||"?"} lbs`:""}
        </div>
        <div style="color:var(--gray);font-size:.65rem;margin-top:.1rem">${draftStr(p)} · Career ${careerEarningsStr(p)}</div>
        ${p.faStory && !_isOwnedPlayer(p) ? `<div style="margin-top:.2rem;font-size:.62rem;color:var(--gold-lt);font-style:italic">"${p.faStory}"</div>` : ""}
        ${potTag ? `<div style="margin-top:.2rem;font-size:.62rem;color:var(--gold-lt);font-weight:700">${potTag}</div>` : ""}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="color:var(--gray);font-size:.55rem;letter-spacing:.5px">GRADE</div>
        <div style="font-size:1.6rem;font-weight:900;color:var(--gold);line-height:1"
          title="Scout grade — observers' estimate, not exact ability">${gL}</div>
        <div style="color:var(--gold);font-size:.85rem;font-weight:700;margin-top:.4rem">$${aav.toFixed(1)}M/yr</div>
        <div style="color:var(--gray);font-size:.62rem">${yrs}yr left</div>
      </div>
    </div>
    ${archBlock ? `<div style="margin:.6rem 0">${archBlock}</div>` : ""}
    <div class="frn-pcard-split" style="margin-top:.5rem">
      ${combinePanel}
      ${rightPanel}
    </div>
    ${seasonBlock ? `<div style="margin-top:.6rem">${seasonBlock}</div>` : ""}
    ${recentFormStrip ? `<div style="margin-top:.6rem">${recentFormStrip}</div>` : ""}
    ${streaksBlock}
    ${gameLogBlock ? `<div style="margin-top:.6rem">${gameLogBlock}</div>` : ""}
    ${p.injury ? `<div class="frn-player-injury" style="margin-top:.55rem">🩹 ${p.injury.label} — ${p.injury.weeksRemaining} wk${p.injury.weeksRemaining===1?"":"s"} out</div>` : ""}
    ${_isInjuryProne(p) ? `<div style="margin-top:.45rem;font-size:.6rem;color:#ff9090;letter-spacing:.5px;font-weight:700" title="Injured 3+ times — elevated recurrence risk">⚠ INJURY-PRONE · ${(p.injuryHistory||[]).length} prior injuries</div>` : ""}
    ${p.coachable ? `<div style="margin-top:.45rem;font-size:.6rem;color:#7ec8e3;letter-spacing:.5px;font-weight:700" title="Absorbs coaching exceptionally well — amplified TEC growth with a Film Mastermind DC">📋 COACHABLE</div>` : ""}
    ${flav ? `<div class="frn-player-flavor" style="margin-top:.55rem">${flav}</div>` : ""}
    ${contractBlock ? `<div style="margin-top:.6rem">${contractBlock}</div>` : ""}
    ${_buildCareerCard(p)}
  </div>`;
}

function frnReleasePlayer(name, pos) {
  const teamId = franchise.chosenTeamId;
  const roster = franchise.rosters[teamId];
  const idx = roster.findIndex(p => p.name === name && p.position === pos);
  if (idx === -1) return;
  const p = roster[idx];
  const { perYear: deadPerYr, years: deadYrs } = deadCapOnRelease(p);
  const deadTotal = deadPerYr * deadYrs;
  const msg = deadTotal > 0
    ? `Release ${name}?\n\nDead cap: $${deadPerYr.toFixed(1)}M × ${deadYrs}yr = $${deadTotal.toFixed(1)}M — prorated signing bonus still counts against your cap.`
    : `Release ${name}? No signing bonus remaining — cap is fully freed.`;
  if (!confirm(msg)) return;
  roster.splice(idx, 1);
  if (deadTotal > 0) {
    franchise.refunds = franchise.refunds || [];
    franchise.refunds.push({
      kind: "dead_cap",
      fromTeamId: teamId,
      toTeamId: null,
      amount: deadPerYr,
      yearsRemaining: deadYrs,
      label: `Dead cap: ${name}`,
    });
  }
  saveFranchise();
  renderFrnPreseason("roster");
}

function frnStartSeason() {
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const used = capUsedByTeam(franchise.chosenTeamId);
  if (used > cap) {
    alert(`Still over the cap by $${(used-cap).toFixed(1)}M. Cut players first.`);
    return;
  }
  // First action of every season: free agency. Generate a fresh pool.
  franchise.phase = "free_agency";
  franchise.freeAgents = _generateFAPool();
  franchise._faOffers = {};
  franchise._faResults = null;
  franchise.tradeOffers = [];
  _seedAITradeBlocks();
  saveFranchise();
  showFranchiseDashboard();
}

// ── Free Agency ───────────────────────────────────────────────────────────────
// First action in every season. A curated pool of veterans, mid-tier
// starters, and wildcards drops onto the market. The user (only) makes
// offers (AAV + years), can pre-flag which players they'd cut to make
// room, and at "End FA" all offers resolve based on whether the offer
// meets the player's demand. AI teams don't compete for now.


// FA pool templates — each kind defines its own age band, draft pedigree,
// pricing, and a story pool. Diamond-in-the-rough kind quietly bumps the
// player's true overall after generation; the scouting noise + low draft
// pedigree keeps the displayed grade conservative so the user has to
// trust their gut on a cheap young guy with "tools".
const FA_POOL_TEMPLATES = [
  // Veteran stars — proven, expensive, won't take a discount easily
  { kind:"vet_star",  count: 15, ageMin:27, ageMax:32, tier:"elite",
    drMin:1, drMax:3, demandMult:1.00, yearsMin:3, yearsMax:5,
    posPool:["QB","WR","WR","RB","OL","OL","DL","DL","LB","CB","TE","S"],
    stories:[
      "Former Pro Bowler hitting the open market",
      "Coming off a career year — wants top-of-market",
      "Cap casualty looking for a contender",
      "Wants one more chance to chase a ring",
      "Lost his locker last spring — still has plenty in the tank",
      "Big-money guy looking for a bigger role",
    ] },
  // Steady veterans — depth, decent prices
  { kind:"vet_depth", count: 28, ageMin:27, ageMax:33, tier:"good",
    drMin:2, drMax:5, demandMult:0.95, yearsMin:2, yearsMax:4,
    posPool:["QB","RB","WR","WR","TE","OL","OL","OL","DL","DL","LB","LB","CB","S"],
    stories:[
      "Reliable starter looking for a fresh start",
      "Productive rotation piece on his third team",
      "Solid film — needs the right system",
      "Plug-and-play veteran",
      "Pushed out by a 1st-round rookie",
      "Underrated grinder with starts on tape",
    ] },
  // Veteran minimums — cheap depth, locker room glue
  { kind:"vet_min",   count: 45, ageMin:31, ageMax:35, tier:"average",
    drMin:3, drMax:7, demandMult:0.65, yearsMin:1, yearsMax:2,
    posPool:["RB","WR","TE","OL","DL","LB","CB","S","K","P"],
    stories:[
      "Looking for one more shot",
      "Locker room glue guy",
      "Special teams ace on the back nine of his career",
      "Knows three playbooks cold",
      "End of the bench but earns his keep",
      "Wants to mentor a rookie at his position",
    ] },
  // Young camp bodies — cheap, room to grow
  { kind:"camp_body", count: 70, ageMin:22, ageMax:25, tier:"average",
    drMin:5, drMax:7, demandMult:0.55, yearsMin:1, yearsMax:3,
    posPool:["QB","RB","WR","WR","TE","OL","DL","LB","CB","S"],
    stories:[
      "Practice squad standout",
      "Training camp body — last team kept him in the building",
      "Late-round project who never got real reps",
      "Bounced around three rosters last year",
      "Young legs, chip on his shoulder",
      "Quietly impressed in joint practices",
      "Tools look promising — needs a coach",
      "Flashed in limited reps last preseason",
      "Coaches keep saying he's about to break out",
      "Late bloomer waiting for an opportunity",
    ] },
  // UDFAs — bottom of the pool, raw upside
  { kind:"udfa",      count: 40, ageMin:22, ageMax:23, tier:"poor",
    drMin:0, drMax:0, demandMult:0.42, yearsMin:1, yearsMax:2,
    posPool:["RB","WR","WR","WR","TE","OL","DL","LB","CB","S"],
    stories:[
      "Undrafted out of a small school",
      "Pro Day standout who slid through the draft",
      "Workout warrior — needs to translate it",
      "Walked on in college, kept earning reps",
      "Tape doesn't pop but he flies around",
      "All-conference at the FCS level",
    ] },
  // Diamonds in the rough — secretly good young players, undervalued
  // grade. Same story bucket as camp bodies so they don't out themselves.
  { kind:"diamond",   count: 18, ageMin:22, ageMax:25, tier:"good",
    drMin:5, drMax:7, demandMult:0.55, yearsMin:2, yearsMax:3,
    posPool:["QB","RB","WR","TE","OL","DL","LB","CB","S"],
    stories:[
      "Tools look promising — needs a coach",
      "Quietly impressed in joint practices",
      "Late bloomer waiting for an opportunity",
      "Coaches keep saying he's about to break out",
      "Flashed in limited reps last preseason",
      "Training camp body — last team kept him in the building",
    ] },
];

function _generateFAPool() {
  const taken = new Set();
  for (const r of Object.values(franchise.rosters)) r.forEach(p => taken.add(p.name));
  const pool = [];
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const currentYear = new Date().getFullYear() + (franchise.season || 1) - 1;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  for (const tmpl of FA_POOL_TEMPLATES) {
    for (let i = 0; i < tmpl.count; i++) {
      const pos = pick(tmpl.posPool);
      const p = genUniquePlayer(pos, tmpl.tier, taken);
      taken.add(p.name);

      // Age band per kind
      p.age = tmpl.ageMin + Math.floor(Math.random() * (tmpl.ageMax - tmpl.ageMin + 1));

      // Draft pedigree per kind (0 = undrafted)
      if (tmpl.drMin === 0 && tmpl.drMax === 0) {
        p.draftRound = 0; p.draftPick = null;
      } else {
        const round = tmpl.drMin + Math.floor(Math.random() * (tmpl.drMax - tmpl.drMin + 1));
        p.draftRound = round;
        p.draftPick  = (round - 1) * 32 + 1 + Math.floor(Math.random() * 32);
      }
      p.draftYear = currentYear - (p.age - 22);
      _rollHiddenGem(p);

      // Diamond bump: real overall pushed higher while draft pedigree
      // stays late. Scouting noise + draft penalty keeps the displayed
      // grade conservative. They'll come at a steep discount.
      if (tmpl.kind === "diamond") {
        const bump = 4 + Math.floor(Math.random() * 3);  // +4..+6
        p.overall = Math.min(99, p.overall + bump);
      }

      // Career earnings reflect years in league
      p.careerEarnings = Math.round((p.age - 22) * computeMarketValue(p, cap) * 0.6 * 10) / 10;

      // What they want
      p.demandedAAV   = Math.round(computeMarketValue(p, cap) * tmpl.demandMult * (0.90 + Math.random() * 0.20) * 10) / 10;
      p.demandedYears = tmpl.yearsMin + Math.floor(Math.random() * (tmpl.yearsMax - tmpl.yearsMin + 1));

      // Story flavor — visible to user; doesn't change stats
      p.faStory = pick(tmpl.stories);
      p.faKind  = tmpl.kind;  // internal — never displayed directly

      pool.push(p);
    }
  }

  // Sort by demanded AAV desc — heavy hitters at top, scrubs at bottom
  pool.sort((a, b) => b.demandedAAV - a.demandedAAV);
  return pool;
}

// Download the current FA pool as a CSV (opens cleanly in Excel/Sheets).
// Includes combine measurables, scout grade, contract demands, and story.
function frnFAExportCSV() {
  const fas = franchise.freeAgents || [];
  if (!fas.length) { alert("No free agents to export."); return; }
  const headers = [
    "Name", "Pos", "Age", "Height", "Weight (lbs)", "Scout Grade",
    "40-yd (s)", "Bench (reps)", "3-Cone (s)", "Vertical (in)", "Leg/KPW",
    "Archetype",
    "Demanded AAV ($M)", "Demanded Years",
    "Draft Round", "Draft Pick", "Draft Year",
    "Career Earnings ($M)", "Story",
  ];
  const rows = fas.map(p => {
    const c = combineMeasurables(p);
    const g = gradeLabel(scoutGrade(p));
    const heightStr = p.height ? formatHeight(p.height) : "";
    const draftR = p.draftRound === 0 ? "UDFA" : (p.draftRound ?? "");
    return [
      p.name, p.position, p.age, heightStr, p.weight ?? "", g,
      c.fortyTime, c.benchReps, c.coneTime, c.verticalIn, c.kpw,
      p.archetype || "",
      p.demandedAAV, p.demandedYears,
      draftR, p.draftPick ?? "", p.draftYear ?? "",
      p.careerEarnings ?? "", p.faStory || "",
    ];
  });
  const escapeCell = v => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map(r => r.map(escapeCell).join(",")).join("\r\n");
  // BOM so Excel reads UTF-8 names correctly
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fa-pool-season-${franchise.season || 1}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── FA screen helpers ─────────────────────────────────────────────────────────
function _faRosterFit(p, teamId) {
  const pos = p.position;
  const grade = scoutGrade(p);
  const roster = franchise.rosters[teamId] || [];
  const samePos = roster.filter(r => r.position === pos).sort((a,b) => scoutGrade(b) - scoutGrade(a));
  if (!samePos.length) return { label: `No ${pos} on roster — fills a void`, upgrade: true };
  const starter = samePos[0];
  const sg = scoutGrade(starter);
  if (grade >= sg + 3) return { label: `Upgrades ${pos}1 — starts over ${starter.name} (${gradeLabel(sg)})`, upgrade: true };
  if (grade >= sg - 2) return { label: `Competes for ${pos}1 with ${starter.name} (${gradeLabel(sg)})`, compete: true };
  let slot = samePos.length + 1;
  for (let i = 1; i < samePos.length; i++) {
    if (grade >= scoutGrade(samePos[i]) - 2) { slot = i + 1; break; }
  }
  return { label: `${pos}${slot} depth — ${samePos.length} already on roster` };
}

function _faNeedsSnippet(teamId, highlightPos) {
  const rows = ["QB","RB","WR","TE","OL","DL","LB","CB","S"].map(pos => {
    const top = (franchise.rosters[teamId]||[]).filter(p=>p.position===pos).sort((a,b)=>scoutGrade(b)-scoutGrade(a))[0];
    const lvl = _draftNeedLevel(teamId, pos);
    const hl = pos === highlightPos;
    const col = lvl === 2 ? "#ff9090" : lvl === 1 ? "#e8a000" : "var(--gray)";
    const badge = lvl === 2 ? "NEED" : lvl === 1 ? "THIN" : "OK";
    return `<div style="display:flex;align-items:center;gap:.35rem;padding:.1rem ${hl?".35rem":0};${hl?"background:rgba(245,197,66,.1);margin:0 -.35rem;border-radius:3px":""}">
      <span style="font-size:.58rem;font-weight:700;color:${hl?"var(--gold)":"var(--blgray)"};min-width:1.8rem">${pos}</span>
      <span style="font-size:.58rem;color:var(--blgray);flex:1">${top ? gradeLabel(scoutGrade(top)) : "—"}</span>
      <span style="font-size:.52rem;font-weight:700;color:${col}">${badge}</span>
    </div>`;
  }).join("");
  return `<div style="padding:.4rem .45rem;background:var(--bg3);border-radius:4px;border:1px solid var(--border);margin-bottom:.5rem">
    <div style="font-size:.53rem;letter-spacing:.6px;color:var(--blgray);margin-bottom:.22rem">POSITION NEEDS</div>
    ${rows}
  </div>`;
}

function frnFASetFilter(field, value) {
  if (!franchise._faFilters) franchise._faFilters = {};
  franchise._faFilters[field] = value;
  renderFrnFA();
  // Re-focus the search input after re-render so typing flows naturally
  if (field === "search") {
    const input = document.querySelector('.frn-fa-pool-col input[placeholder^="Search"]');
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }
}

function renderFrnFA(selectedKey) {
  const { chosenTeamId, freeAgents = [], _faOffers = {}, salaryCap, season } = franchise;
  const cap = effectiveSalaryCap(chosenTeamId);
  const myRoster = franchise.rosters[chosenTeamId] || [];
  const myCapUsed = capUsedByTeam(chosenTeamId);

  // Filters — persisted on franchise so they survive renders
  const filters = (franchise._faFilters = franchise._faFilters || {
    pos: "ALL", age: "ALL", sort: "price", search: "",
  });
  let filtered = freeAgents.slice();
  if (filters.pos && filters.pos !== "ALL") filtered = filtered.filter(p => p.position === filters.pos);
  if (filters.age === "YOUNG") filtered = filtered.filter(p => p.age <= 25);
  else if (filters.age === "VET") filtered = filtered.filter(p => p.age >= 26);
  if (filters.search) {
    const s = filters.search.toLowerCase();
    filtered = filtered.filter(p => p.name.toLowerCase().includes(s));
  }
  if (filters.sort === "age")        filtered.sort((a, b) => a.age - b.age);
  else if (filters.sort === "grade") filtered.sort((a, b) => scoutGrade(b) - scoutGrade(a));
  // default "price" already matches the source ordering (desc)

  // Match by pid (new saves) then by name (legacy saves)
  let selected = selectedKey
    ? (freeAgents.find(p => p.pid === selectedKey) || freeAgents.find(p => p.name === selectedKey))
    : null;
  if (!selected) selected = filtered[0] || freeAgents[0];

  // Filter chip helper
  const chip = (active, label, onclick, color) => `<button onclick="${onclick}" style="padding:.18rem .45rem;font-size:.6rem;letter-spacing:.5px;border:1px solid ${active?"var(--gold)":"var(--border)"};background:${active?"rgba(245,197,66,.15)":"transparent"};color:${active?"var(--gold-lt)":(color||"var(--blgray)")};border-radius:3px;font-family:inherit;cursor:pointer;font-weight:${active?700:400}">${label}</button>`;

  const POS_LIST = ["ALL","QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const posChips = POS_LIST.map(pos =>
    chip(filters.pos === pos, pos === "ALL" ? "ALL" : pos, `frnFASetFilter('pos','${pos}')`)
  ).join("");
  const ageChips = [["ALL","ALL"],["YOUNG","🌱 ≤25"],["VET","26+"]].map(([k,l]) =>
    chip(filters.age === k, l, `frnFASetFilter('age','${k}')`)
  ).join("");
  const sortChips = [["price","$↓"],["age","AGE↑"],["grade","GRADE↓"]].map(([k,l]) =>
    chip(filters.sort === k, l, `frnFASetFilter('sort','${k}')`)
  ).join("");
  const filterBar = `
    <div style="display:flex;flex-wrap:wrap;gap:.2rem;margin-bottom:.4rem;align-items:center">
      <span style="color:var(--blgray);font-size:.55rem;letter-spacing:.5px;margin-right:.15rem">POS</span>${posChips}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:.2rem;margin-bottom:.4rem;align-items:center">
      <span style="color:var(--blgray);font-size:.55rem;letter-spacing:.5px;margin-right:.15rem">AGE</span>${ageChips}
      <span style="color:var(--blgray);font-size:.55rem;letter-spacing:.5px;margin:0 .15rem 0 .4rem">SORT</span>${sortChips}
      <input type="text" placeholder="Search name…" value="${(filters.search || "").replace(/"/g,'&quot;')}"
        oninput="frnFASetFilter('search', this.value)"
        style="flex:1;min-width:6rem;background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.18rem .35rem;font-family:inherit;font-size:.65rem;border-radius:3px">
    </div>`;

  // FA list (left column)
  const workoutResults = franchise._faWorkoutResults || {};
  const faListHtml = filtered.map(p => {
    const faKey = p.pid || p.name;
    const myOffer = _faOffers[faKey] || _faOffers[p.name];
    const offered = !!myOffer;
    const isSel = selected && (p.pid ? p.pid === selected.pid : p.name === selected.name);
    const escKey = (faKey || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const young = p.age <= 25;
    const wo = workoutResults[p.name];
    const woIcon = wo ? (wo.result === "standout" ? "⭐" : wo.result === "solid" ? "✅" : wo.result === "mixed" ? "〰️" : "❌") : "";
    const pGrade = scoutGrade(p);
    const heatGrade = p._workoutHot ? Math.max(pGrade, 80) : pGrade;
    const hot = heatGrade >= 88, warm = !hot && heatGrade >= 80;
    const needLvl = _draftNeedLevel(chosenTeamId, p.position);
    // Left border: need takes priority over heat
    const borderCol = needLvl === 2 ? "#ff6b6b44" : needLvl === 1 ? "#e8a00044" : hot ? "#ff993344" : "transparent";
    const heatBadge = hot ? `<span style="font-size:.6rem;line-height:1">🔥</span>` : warm ? `<span style="font-size:.6rem;line-height:1">👀</span>` : "";
    const needBadge = needLvl === 2
      ? `<span style="font-size:.5rem;color:#ff9090;font-weight:700;letter-spacing:.2px;flex-shrink:0">NEED</span>`
      : needLvl === 1
      ? `<span style="font-size:.5rem;color:#e8a000;font-weight:700;letter-spacing:.2px;flex-shrink:0">FILL</span>` : "";
    // Show suitor count on the row for hot players (saves a click)
    const rowSuitors = (hot || warm)
      ? TEAMS.filter(t => t.id !== chosenTeamId && _faAIInterest(t.id, p) >= 0.1).length : 0;
    const suitorBit = rowSuitors >= 3
      ? `<span style="font-size:.52rem;color:${rowSuitors>=6?"var(--red)":"#e8a000"};flex-shrink:0">${rowSuitors} teams</span>` : "";
    return `<button class="frn-fa-row ${isSel?"selected":""} ${offered?"offered":""}"
      style="border-left:3px solid ${borderCol};padding-left:.45rem;display:block"
      onclick="renderFrnFA('${escKey}')">
      <div style="display:flex;align-items:center;gap:.28rem">
        ${heatBadge}${gradeBadge(p)}
        <span class="frn-fa-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}${young?" 🌱":""}${woIcon?` ${woIcon}`:""}</span>
        <span class="frn-fa-pos" style="flex-shrink:0">${p.position}</span>
        ${needBadge}
      </div>
      <div style="display:flex;align-items:center;gap:.4rem;margin-top:.08rem;padding-left:.05rem">
        <span style="color:var(--gray);font-size:.57rem">age ${p.age}</span>
        <span class="frn-fa-ask" style="font-size:.6rem">$${p.demandedAAV.toFixed(1)}M</span>
        ${suitorBit}
        ${offered ? `<span class="frn-fa-flag" style="font-size:.56rem;margin-left:auto">✓ $${myOffer.aav.toFixed(1)}M</span>` : ""}
      </div>
    </button>`;
  }).join("");

  // Cap math across ALL active offers
  let totalOfferedAAV = 0;
  const allPlannedCutNames = new Set();
  for (const o of Object.values(_faOffers)) {
    totalOfferedAAV += o.aav;
    (o.cutNames || []).forEach(n => allPlannedCutNames.add(n));
  }
  const totalCutSavings = myRoster.filter(p => allPlannedCutNames.has(p.name))
    .reduce((s, p) => s + (p.contract?.aav || 0), 0);
  const projectedCap = myCapUsed + totalOfferedAAV - totalCutSavings;
  const overCap = projectedCap > cap;

  const selFaKey   = selected ? (selected.pid || selected.name) : "";
  const escSelName = selFaKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  // Detail panel + offer form for selected FA
  let detailHtml = "";
  if (selected) {
    const existing = _faOffers[selFaKey] || _faOffers[selected.name];
    const offer = existing || { aav: selected.demandedAAV, years: selected.demandedYears, cutNames: [] };
    const cutSet = new Set(offer.cutNames || []);
    const myProjAfterCuts = myCapUsed + offer.aav -
      myRoster.filter(p => cutSet.has(p.name)).reduce((s,p) => s + (p.contract?.aav||0), 0);
    const room = cap - myProjAfterCuts;
    const score = (offer.aav / selected.demandedAAV) * Math.min(offer.years / selected.demandedYears, 1);
    const likelihood = score >= 1.05 ? "Very likely" : score >= 1.00 ? "Likely" : score >= 0.90 ? "Toss-up" : score >= 0.80 ? "Unlikely" : "Will reject";
    const lkColor = score >= 1.00 ? "var(--green-lt)" : score >= 0.90 ? "#e8a000" : "var(--red)";

    // Player intel
    const potTag  = potentialTag(selected, { known: _isKnownPlayer(selected) });
    const isKnown = _isKnownPlayer(selected);
    const sGrade  = scoutGrade(selected);
    const heatGrade = selected._workoutHot ? Math.max(sGrade, 80) : sGrade;
    const suitors = TEAMS.filter(t => t.id !== chosenTeamId && _faAIInterest(t.id, selected) >= 0.1).length;
    const heatColor = suitors >= 6 ? "var(--red)" : suitors >= 3 ? "#e8a000" : heatGrade >= 80 ? "#e8a000" : "var(--border)";
    const ageStage = selected.age <= 25 ? "🌱 Ascending" : selected.age <= 27 ? "⬆ Young Prime"
                   : selected.age <= 30 ? "★ Prime" : selected.age <= 32 ? "⬇ Late Prime" : "↘ Declining";

    // Workout block
    const wr = (franchise._faWorkoutResults || {})[selected.name];
    const slotsLeft = _workoutSlotsRemaining();
    let workoutHtml = "";
    if (wr) {
      const rCol = { standout:"var(--gold)", solid:"var(--green-lt)", mixed:"#e8a000", bombed:"var(--red)" }[wr.result];
      const rLbl = { standout:"⭐ STANDOUT", solid:"✅ SOLID", mixed:"〰️ MIXED", bombed:"❌ BOMBED" }[wr.result];
      const rGrade = gradeLabel(sGrade), sLabel = gradeLabel(wr.sharpGrade);
      const gradeChanged = rGrade !== sLabel;
      const demandNote = wr.demandDeltaPct > 0
        ? `<span style="color:var(--red);font-size:.62rem">⬆ Demand up ${wr.demandDeltaPct.toFixed(1)}% · $${wr.demandBefore.toFixed(1)}M→$${selected.demandedAAV.toFixed(1)}M</span>`
        : wr.demandDeltaPct < 0
        ? `<span style="color:var(--green-lt);font-size:.62rem">⬇ Demand down ${Math.abs(wr.demandDeltaPct).toFixed(1)}% · $${wr.demandBefore.toFixed(1)}M→$${selected.demandedAAV.toFixed(1)}M</span>` : "";
      const traitHtml = wr.result === "mixed"
        ? `<div style="font-size:.64rem;color:var(--green-lt)">+ ${wr.posTrait}</div><div style="font-size:.64rem;color:var(--red)">− ${wr.negTrait}</div>`
        : wr.result === "bombed"
        ? `<div style="font-size:.64rem;color:var(--red)">− ${wr.negTrait}</div>`
        : `<div style="font-size:.64rem;color:var(--green-lt)">+ ${wr.posTrait}</div>`;
      workoutHtml = `<div style="margin-top:.35rem;padding-top:.35rem;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap">
          <span style="font-size:.55rem;letter-spacing:.6px;color:var(--blgray)">WORKOUT</span>
          <b style="color:${rCol};font-size:.72rem">${rLbl}</b>
          ${gradeChanged
            ? `<span style="font-size:.6rem;color:var(--blgray)">${rGrade} → <b style="color:${rCol}">${sLabel}</b> <span style="font-size:.56rem">(fog lifted)</span></span>`
            : `<span style="font-size:.6rem;color:var(--gray)">${rGrade} holds under scrutiny</span>`}
        </div>
        ${traitHtml}
        ${demandNote ? `<div style="margin-top:.2rem">${demandNote}</div>` : ""}
      </div>`;
    }

    // Roster fit
    const fit = _faRosterFit(selected, chosenTeamId);
    const needLvl = _draftNeedLevel(chosenTeamId, selected.position);
    const fitIcon = fit.upgrade ? "⬆" : fit.compete ? "⟺" : needLvl === 2 ? "❗" : needLvl === 1 ? "⚠" : "→";
    const fitColor = fit.upgrade ? "var(--green-lt)" : fit.compete ? "var(--gold-lt)" : needLvl === 2 ? "#ff9090" : needLvl === 1 ? "#e8a000" : "var(--blgray)";

    // Market context
    const posAavs = [];
    for (const r of Object.values(franchise.rosters || {}))
      for (const p of r) if (p.position === selected.position && p.contract) posAavs.push(p.contract.aav);
    posAavs.sort((a,b) => b-a);
    let mktHtml = "";
    if (posAavs.length) {
      const top5Avg = posAavs.slice(0,5).reduce((s,v)=>s+v,0) / Math.min(posAavs.length,5);
      const median  = posAavs[Math.floor(posAavs.length/2)] || 0;
      const top1    = posAavs[0] || 0;
      const vGap    = offer.aav - top5Avg;
      const vTag    = vGap < -2 ? "BARGAIN" : vGap < 2 ? "FAIR" : vGap < 6 ? "PREMIUM" : "OVERPRICED";
      const vCol    = vTag === "BARGAIN" ? "var(--green-lt)" : vTag === "FAIR" ? "var(--gold-lt)" : vTag === "PREMIUM" ? "#e8a000" : "var(--red)";
      mktHtml = `<div style="padding:.38rem .5rem;background:var(--bg3);border-radius:4px;border:1px solid var(--border);margin-top:.45rem">
        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;font-size:.63rem">
          <span style="font-size:.53rem;letter-spacing:.6px;color:var(--blgray)">MARKET CTX</span>
          <b style="color:${vCol}">${vTag}</b>
          <span style="color:var(--border)">|</span>
          <span style="color:var(--blgray)">${selected.position} top5 avg <b style="color:var(--gold-lt)">$${top5Avg.toFixed(1)}M</b> · median <b style="color:var(--gold-lt)">$${median.toFixed(1)}M</b> · top <b style="color:var(--gold)">$${top1.toFixed(1)}M</b></span>
        </div>
      </div>`;
    }

    detailHtml = `<div class="frn-fa-detail">

      <!-- ① Identity -->
      <div class="frn-fa-detail-head" style="margin-bottom:.4rem">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:.38rem;flex-wrap:wrap;margin-bottom:.12rem">
            <span style="font-size:1.05rem;font-weight:900">${selected.name}</span>
            ${_posPillHtml(selected.position)}
            ${gradeBadge(selected)}
            <span style="font-size:.6rem;color:var(--blgray)">${ageStage} · age ${selected.age}</span>
          </div>
          <div style="color:var(--gray);font-size:.64rem">${_archetypeLabel(selected)||"—"} · ${draftStr(selected)} · ${careerEarningsStr(selected)}</div>
          ${potTag ? `<div style="font-size:.68rem;color:${isKnown?"var(--green-lt)":"var(--gold-lt)"};font-weight:700;margin-top:.2rem">${potTag}</div>` : ""}
          ${selected.faStory ? `<div style="color:var(--gold-lt);font-size:.67rem;margin-top:.18rem;font-style:italic">"${selected.faStory}"</div>` : ""}
        </div>
      </div>

      <!-- ② Market Pulse -->
      <div style="padding:.45rem .55rem;background:rgba(0,0,0,.2);border-left:3px solid ${heatColor};border-radius:0 4px 4px 0;margin-bottom:.45rem">
        <div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.22rem">MARKET PULSE</div>
        <div style="font-size:.82rem;font-weight:700">$${selected.demandedAAV.toFixed(1)}M / yr × ${selected.demandedYears} yr</div>
        ${suitors > 0
          ? `<div style="font-size:.67rem;color:${heatColor};margin-top:.18rem">${suitors >= 6 ? "🔥" : "👀"} ~${suitors} team${suitors!==1?"s":""} showing ${suitors>=6?"heavy":suitors>=3?"moderate":"some"} interest</div>`
          : `<div style="font-size:.63rem;color:var(--gray);margin-top:.15rem">No known competing interest</div>`}
        ${workoutHtml}
        ${!wr ? `<div style="margin-top:.35rem">
          <button class="btn btn-outline" onclick="frnFAInviteWorkout('${escSelName}')" ${slotsLeft<=0?"disabled":""}
            style="font-size:.63rem;width:100%;${slotsLeft<=0?"opacity:.4;cursor:not-allowed":""}">🏋 INVITE TO WORKOUT</button>
          <div style="text-align:right;font-size:.55rem;color:var(--blgray);margin-top:.12rem">${slotsLeft}/${WORKOUT_SLOTS_PER_FA_SEASON} workout slots left</div>
        </div>` : ""}
      </div>

      <!-- ③ Roster Fit -->
      <div style="padding:.38rem .5rem;background:rgba(0,0,0,.15);border:1px solid var(--border);border-radius:4px;margin-bottom:.45rem">
        <div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.18rem">ROSTER FIT</div>
        <div style="font-size:.7rem;color:${fitColor};font-weight:${fit.upgrade||fit.compete?700:400}">${fitIcon} ${fit.label}</div>
      </div>

      <!-- ③b Stats + Athletic Profile -->
      ${(()=>{
        const lastSzn = (selected.careerHistory||[]).slice(-1)[0];
        const cols = _careerColsFor(selected.position);
        const statCells = lastSzn ? cols.map(c =>
          `<div style="text-align:center"><div style="font-size:.52rem;color:var(--blgray);letter-spacing:.3px">${c.label}</div><div style="font-size:.78rem;font-weight:700;color:var(--blwhite)">${lastSzn[c.key]||0}</div></div>`
        ).join("") : "";
        const combineStr = _draftCombineStr(selected);
        if (!lastSzn && !combineStr) return "";
        return `<div style="padding:.38rem .5rem;background:rgba(0,0,0,.15);border:1px solid var(--border);border-radius:4px;margin-bottom:.45rem">
          ${lastSzn ? `<div style="font-size:.53rem;letter-spacing:.7px;color:var(--blgray);margin-bottom:.22rem">LAST SEASON · ${lastSzn.gp||0} GP · age ${lastSzn.age||"?"}</div>
          <div style="display:flex;gap:.65rem;flex-wrap:wrap;margin-bottom:.25rem">${statCells}</div>` : ""}
          <div style="font-size:.6rem;color:var(--gray)">📐 ${combineStr}</div>
        </div>`;
      })()}

      <!-- ④ Offer Builder -->
      <div class="frn-fa-offer-form">
        <label><span class="frn-meta-label">AAV ($M/yr)</span>
          <input type="number" min="0.5" max="60" step="0.5" value="${offer.aav.toFixed(1)}"
            id="faOfferAav" onchange="frnFASetOffer('${escSelName}','aav',this.value)">
        </label>
        <label><span class="frn-meta-label">YEARS</span>
          <input type="number" min="1" max="7" step="1" value="${offer.years}"
            id="faOfferYears" onchange="frnFASetOffer('${escSelName}','years',this.value)">
        </label>
        <div class="frn-fa-offer-actions">
          <button class="btn btn-gold" onclick="frnFASubmitOffer('${escSelName}')">${existing?"✓ Update Offer":"+ Submit Offer"}</button>
          ${existing?`<button class="btn btn-outline" onclick="frnFAWithdrawOffer('${escSelName}')">Withdraw</button>`:""}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap;margin-top:.35rem">
        <span class="frn-meta-label" style="margin:0">Structure:</span>
        ${["BALANCED","BACKLOADED","FRONTLOADED"].map(s => {
          const cur = offer.structure || _defaultStructure(selected.age||27, scoutGrade(selected));
          const desc = s==="BALANCED"?"flat salaries":s==="BACKLOADED"?"cheap now, costly later":"costly now, cheap later";
          return `<button class="btn ${cur===s?"btn-gold":"btn-outline"}" onclick="frnFASetOffer('${escSelName}','structure','${s}')" style="font-size:.61rem;padding:.18rem .45rem" title="${desc}">${s[0]+s.slice(1).toLowerCase()}</button>`;
        }).join("")}
      </div>

      <!-- ⑤ Acceptance + Cap Impact -->
      <div style="display:flex;align-items:center;gap:.6rem;padding:.42rem .55rem;background:var(--bg3);border-radius:4px;margin-top:.42rem;flex-wrap:wrap;border:1px solid var(--border)">
        <div style="font-size:.72rem">Acceptance: <b style="color:${lkColor};font-size:.85rem">${likelihood}</b></div>
        <div style="font-size:.64rem;color:var(--gray);margin-left:auto">
          Cap hit: <b style="color:${room<0?"var(--red)":"var(--green-lt)"}">$${myProjAfterCuts.toFixed(1)}M</b>
          <span style="color:var(--gray)"> (${room<0?`<b style="color:var(--red)">${Math.abs(room).toFixed(1)}M over cap</b>`:`$${room.toFixed(1)}M room`})</span>
        </div>
      </div>

      <!-- ⑥ Contract Preview -->
      ${_buildFAOfferContractPreview(selected, offer)}

      <!-- ⑦ Market Context -->
      ${mktHtml}
    </div>`;
  }

  // Right side: my roster — sort checked cuts to top, then starters, then by AAV
  const escForSel = selected ? selected.name.replace(/\\/g, "\\\\").replace(/'/g, "\\'") : "";
  const cutSet = selected ? new Set((_faOffers[selected.name]?.cutNames) || []) : new Set();
  const dcStarters = new Set(
    Object.values(franchise.depthChart?.[chosenTeamId] || {}).map(s => s.starter).filter(Boolean)
  );
  const rosterForCut = myRoster.slice().sort((a, b) => {
    const ac = cutSet.has(a.name), bc = cutSet.has(b.name);
    if (ac !== bc) return ac ? -1 : 1;
    const as = a.pid && dcStarters.has(a.pid), bs = b.pid && dcStarters.has(b.pid);
    if (as !== bs) return as ? -1 : 1;
    return (b.contract?.aav||0) - (a.contract?.aav||0);
  });
  const rosterHtml = rosterForCut.map(p => {
    const aav = p.contract?.aav || 0;
    const isChecked = cutSet.has(p.name);
    const escPlayer = (p.name || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const { perYear: deadPY, years: deadYrs } = deadCapOnRelease(p);
    const hasDeadCap = deadYrs > 0 && deadPY > 0;
    const netSavings = aav - (hasDeadCap ? deadPY : 0);
    const isStarter = !!(p.pid && dcStarters.has(p.pid));
    return `<label class="frn-cut-option" style="${isChecked?"background:rgba(255,70,70,.08);border-left:2px solid #ff6b6b;padding-left:.3rem":""}">
      <input type="checkbox" ${isChecked?"checked":""} ${selected?"":"disabled"}
        onchange="frnFAToggleCut('${escForSel}','${escPlayer}',this.checked)">
      <span class="frn-fa-cut-pos">${p.position}</span>
      <span class="frn-fa-cut-name" style="flex:1">${p.name}</span>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.05rem">
        ${gradeBadge(p)}
        ${isStarter?`<span style="font-size:.47rem;color:var(--gold);font-weight:700;letter-spacing:.2px">STARTER</span>`:""}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.04rem;min-width:3.8rem;text-align:right">
        <span style="font-size:.63rem;color:var(--green-lt);font-weight:700">+$${aav.toFixed(1)}M</span>
        ${hasDeadCap
          ? `<span style="font-size:.54rem;color:var(--red)">☠ $${deadPY.toFixed(1)}M dead</span>
             <span style="font-size:.52rem;color:var(--gray)">net +$${netSavings.toFixed(1)}M</span>`
          : `<span style="font-size:.52rem;color:var(--gray)">no dead cap</span>`}
      </div>
    </label>`;
  }).join("");

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🆓 FREE AGENCY · Season ${season}</div>
      <div style="font-size:.6rem;color:var(--blgray);letter-spacing:.4px;padding:.18rem .45rem;border:1px solid var(--border);border-radius:3px">
        🏋 WORKOUTS <b style="color:${_workoutSlotsRemaining()>0?"var(--gold-lt)":"var(--red)"}">${_workoutSlotsRemaining()}/${WORKOUT_SLOTS_PER_FA_SEASON}</b>
      </div>
      <button class="btn btn-outline" onclick="frnFAExportCSV()" style="margin-left:auto;font-size:.7rem">
        📊 Export Pool CSV
      </button>
      <button class="btn btn-gold-big" onclick="frnFAProcessOffers()">
        ⏭ END FA & ADVANCE WEEK →
      </button>
    </div>
    <div class="frn-fa-summary">
      <span>Roster: <b>$${myCapUsed.toFixed(1)}M</b></span>
      <span style="color:var(--gold)">+ Offers: <b>$${totalOfferedAAV.toFixed(1)}M</b></span>
      <span style="color:var(--gold)">− Cuts: <b>$${totalCutSavings.toFixed(1)}M</b></span>
      <span style="color:${overCap?"var(--red)":"var(--green-lt)"}">
        = Projected: <b>$${projectedCap.toFixed(1)}M</b> / $${cap.toFixed(0)}M
        ${overCap ? `(${(projectedCap-cap).toFixed(1)}M OVER)` : `(${(cap-projectedCap).toFixed(1)}M room)`}
      </span>
    </div>
    <div class="frn-fa-layout">
      <div class="frn-fa-pool-col">
        <div class="frn-card-title">FREE AGENT POOL (${filtered.length}${filtered.length !== freeAgents.length ? ` / ${freeAgents.length}` : ""})</div>
        ${filterBar}
        <div class="frn-fa-pool-list">${faListHtml.length ? faListHtml : `<div style="color:var(--blgray);font-size:.7rem;padding:.6rem;text-align:center;font-style:italic">No free agents match the filters.</div>`}</div>
      </div>
      <div class="frn-fa-mid-col">
        ${detailHtml || `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">Select a free agent on the left to make an offer.</div>`}
      </div>
      <div class="frn-fa-roster-col">
        <div class="frn-card-title">YOUR ROSTER · cut to make room</div>
        ${selected ? _faNeedsSnippet(chosenTeamId, selected.position) : `<div style="color:var(--gray);font-size:.7rem;margin-bottom:.4rem;font-style:italic">Pick an FA first, then flag cuts here.</div>`}
        <div class="frn-fa-roster-list">${rosterHtml}</div>
      </div>
    </div>`;
}

// Build an estimated year-by-year contract breakdown for an FA offer preview.
// Uses scout grade as the OVR proxy (real OVR is hidden at offer stage).
function _buildFAOfferContractPreview(player, offer) {
  const proxyOvr = scoutGrade(player);
  const struct   = offer.structure || _defaultStructure(player.age || 27, proxyOvr);
  const bonus    = _signingBonusCalc(offer.aav, offer.years, proxyOvr);
  const bases    = _baseSalarySchedule(offer.aav, offer.years, struct, bonus.bonusProration);
  const gtdYrs   = _guaranteedYearsForLength(offer.years);
  const synth    = { contract: {
    aav: offer.aav, years: offer.years, remaining: offer.years, structure: struct,
    baseSalaries: bases, bonusProration: bonus.bonusProration,
    signingBonus: bonus.signingBonus, tradeKicker: bonus.tradeKicker,
    guaranteedYears: gtdYrs,
  }};
  const inner = _buildContractBreakdownBlock(synth);
  if (!inner) return "";
  return `<div style="margin-top:.5rem">
    ${inner}
    <div style="font-size:.57rem;color:var(--blgray);margin-top:.2rem;font-style:italic">
      ★ Bonus estimated from scout grade — actual proration may differ by ±1yr
    </div>
  </div>`;
}

function _ensureFAOffer(faKey) {
  if (!franchise._faOffers) franchise._faOffers = {};
  if (franchise._faOffers[faKey]) return franchise._faOffers[faKey];
  // Find by pid (new) or name (legacy)
  const fa = franchise.freeAgents.find(p => p.pid === faKey || p.name === faKey);
  if (!fa) return null;
  const key = fa.pid || fa.name;
  if (!franchise._faOffers[key]) {
    franchise._faOffers[key] = {
      aav: fa.demandedAAV,
      years: fa.demandedYears,
      structure: _defaultStructure(fa.age || 27, fa.overall || 70),
      cutNames: [],
    };
  }
  return franchise._faOffers[key];
}

function frnFASetOffer(faName, field, value) {
  const offer = _ensureFAOffer(faName); if (!offer) return;
  if (field === "aav")       offer.aav       = Math.max(0.5, parseFloat(value) || 0);
  if (field === "years")     offer.years     = Math.max(1, Math.min(7, parseInt(value, 10) || 1));
  if (field === "structure") offer.structure = value;
  saveFranchise();
  renderFrnFA(faName);
}

function frnFAToggleCut(faName, cutName, checked) {
  const offer = _ensureFAOffer(faName); if (!offer) return;
  if (!Array.isArray(offer.cutNames)) offer.cutNames = [];
  if (checked && !offer.cutNames.includes(cutName)) offer.cutNames.push(cutName);
  else offer.cutNames = offer.cutNames.filter(n => n !== cutName);
  saveFranchise();
  renderFrnFA(faName);
}

function frnFASubmitOffer(faName) {
  _ensureFAOffer(faName);
  saveFranchise();
  renderFrnFA(faName);
}

function frnFAWithdrawOffer(faName) {
  // faName may be a pid or legacy name — delete whichever key exists
  if (franchise._faOffers) {
    delete franchise._faOffers[faName];
  }
  saveFranchise();
  renderFrnFA(faName);
}

// Convert this season's initial offers + AI interest into ongoing
// negotiations. From here, counter-bidding happens weekly across the
// regular season until a player signs (no raises in a given week) or
// the season ends with negotiations still open (player leaves the
// league). The user can manage their bids any time from the dashboard.
function frnFAProcessOffers() {
  franchise.faNegotiations = {};
  const myId = franchise.chosenTeamId;

  // Seed: every offer you made becomes a negotiation with you as
  // current high bidder.
  for (const [offerKey, offer] of Object.entries(franchise._faOffers || {})) {
    const fa = franchise.freeAgents.find(p => p.pid === offerKey || p.name === offerKey);
    if (!fa) continue;
    const negKey = fa.pid || fa.name;
    franchise.faNegotiations[negKey] = {
      fa,
      state: "negotiating",
      yourBid: { aav: offer.aav, years: offer.years, structure: offer.structure, cutNames: offer.cutNames || [] },
      aiBids: {},
      history: [{ teamId: myId, label: "You", aav: offer.aav, years: offer.years, week: 0 }],
      raisedThisRound: false,
      lastRaiseWeek: 0,
    };
  }

  // Run an initial AI bid round (week 0) so the user sees competition
  // immediately. AI can bid on FAs the user offered for AND on FAs the
  // user ignored.
  _faAIBidRound(0, /*isInitial=*/true);

  // Surface a news item showing how many AI-only negotiations opened
  const aiOnlyCount = Object.values(franchise.faNegotiations || {})
    .filter(n => !n.yourBid && Object.keys(n.aiBids || {}).length > 0).length;
  if (aiOnlyCount > 0) {
    _pushNews({ type: "fa_activity", label: `📋 ${aiOnlyCount} free agent${aiOnlyCount > 1 ? "s" : ""} entered AI-only negotiations — act before they sign.` });
  }

  // Players the AI didn't bid on either become negotiations with no
  // bids (drop) — they leave the pool.
  franchise._faOffers = {};
  franchise.freeAgents = [];
  // We jump straight into regular-season Week 1 — the dashboard banner
  // surfaces the open negotiations. If the user is over cap they go to
  // the cuts screen first.
  const cap = effectiveSalaryCap(myId);
  const used = capUsedByTeam(myId);
  if (used > cap) {
    franchise._faResults = { signed: [], lost: [] };
    franchise.phase = "free_agency_results";
  } else {
    franchise.phase = "regular";
  }
  saveFranchise();
  showFranchiseDashboard();
}

// Probability that a given AI team enters / counter-bids on a given FA.
function _faAIInterest(teamId, fa) {
  const cap   = effectiveSalaryCap(teamId);
  const used  = capUsedByTeam(teamId);
  const room  = cap - used;
  if (room < fa.demandedAAV * 0.6) return 0;        // no chance of affording
  const grade = scoutGrade(fa);
  let base = 0.04;
  if (grade >= 88) base = 0.28;
  else if (grade >= 80) base = 0.16;
  else if (grade >= 72) base = 0.12;
  if (fa._workoutHot) base = Math.min(0.55, base * 1.6); // standout workout drew league-wide attention
  // Team-need factor: teams weaker at this FA's position bid more
  const roster = franchise.rosters[teamId] || [];
  const same = roster.filter(p => p.position === fa.position);
  const bestSame = same.sort((a,b) => b.overall - a.overall)[0];
  if (bestSame && bestSame.overall < fa.overall - 3) base *= 1.8;
  if (room < fa.demandedAAV) base *= 0.4;            // tight cap dampens
  return Math.min(0.55, base);
}

// Decide what an AI bid would be given the current high. Returns
// { aav, years } or null if they can't / won't bid.
function _faAIBidAmount(teamId, fa, currentHighAav) {
  const cap   = effectiveSalaryCap(teamId);
  const room  = cap - capUsedByTeam(teamId);
  const demand = fa.demandedAAV;
  // Floor: just above current high if any, else ~95% of demand
  const floor = currentHighAav ? currentHighAav + 0.5 : demand * 0.92;
  // Knockout chance: high-need team with cap room may go nuclear past
  // 1.35× to lock the player in immediately (≥1.5× triggers knockout sign).
  const roster = franchise.rosters[teamId] || [];
  const same = roster.filter(p => p.position === fa.position);
  const bestSame = same.sort((a,b) => b.overall - a.overall)[0];
  const bigNeed = !bestSame || bestSame.overall < fa.overall - 5;
  const ampleRoom = room >= demand * 1.6;
  const goNuclear = bigNeed && ampleRoom && Math.random() < 0.08;
  // Knockout war: any team that has already bid in this neg and has
  // sunk-cost commitment will fight past their normal ceiling.
  const neg = franchise.faNegotiations?.[_negKey(fa)];
  const knockoutWar = neg?.knockoutWar;
  const isWarParticipant = knockoutWar
    && ((neg.aiBids?.[teamId]?.aav || 0) >= demand * FA_KNOCKOUT_MULT * 0.7);
  let ceilMul = goNuclear ? 1.7 : 1.35;
  if (isWarParticipant) ceilMul = 2.1;
  const ceil  = Math.min(demand * ceilMul, room);
  if (floor > ceil) return null;
  // Nuclear / war bids skew toward the top of the range so they actually escalate
  const skewTop = goNuclear || isWarParticipant;
  const t = skewTop ? 0.6 + Math.random() * 0.4 : Math.random();
  const aav = Math.round((floor + t * (ceil - floor)) * 10) / 10;
  const years = Math.max(2, Math.min(fa.demandedYears, 5));
  return { aav, years };
}

// Stable key for faNegotiations — pid when available, name as fallback.
function _negKey(fa) { return (fa && (fa.pid || fa.name)) || ""; }

// Run one AI bidding round. If isInitial, AI can also OPEN negotiations
// on FAs the user didn't bid on. Otherwise AI only counter-bids on FAs
// already in negotiations.
function _faAIBidRound(week, isInitial) {
  const negs = franchise.faNegotiations || {};
  const candidates = isInitial
    ? [...(franchise.freeAgents || []), ...Object.values(negs).map(n => n.fa)]
    : Object.values(negs).filter(n => n.state === "negotiating").map(n => n.fa);

  for (const fa of candidates) {
    const neg = negs[_negKey(fa)];
    // Current high across yourBid + aiBids
    let highAav = 0, highId = null;
    if (neg?.yourBid) { highAav = neg.yourBid.aav; highId = franchise.chosenTeamId; }
    if (neg) {
      for (const [tid, b] of Object.entries(neg.aiBids || {})) {
        if (b.aav > highAav) { highAav = b.aav; highId = Number(tid); }
      }
    }

    const koThreshold = fa.demandedAAV * FA_KNOCKOUT_MULT;
    for (const t of TEAMS) {
      if (t.id === franchise.chosenTeamId) continue;
      // War participants (teams that already crossed the knockout threshold)
      // skip the interest roll — they have sunk cost and stay in the fight.
      const isWarParticipant = neg?.knockoutWar
        && (neg.aiBids?.[t.id]?.aav || 0) >= koThreshold * 0.7;
      if (!isWarParticipant && Math.random() > _faAIInterest(t.id, fa)) continue;
      // If this AI team is already the high bidder, don't outbid themselves
      if (t.id === highId) continue;
      const bid = _faAIBidAmount(t.id, fa, highAav);
      if (!bid) continue;
      // Lazy-create negotiation if AI is opening a new one
      const nk = _negKey(fa);
      let n = negs[nk];
      if (!n) {
        n = negs[nk] = {
          fa, state: "negotiating", yourBid: null, aiBids: {},
          history: [], raisedThisRound: true, lastRaiseWeek: week,
        };
      }
      n.aiBids[t.id] = bid;
      n.history.push({ teamId: t.id, label: `${t.city} ${t.name}`, aav: bid.aav, years: bid.years, week });
      n.raisedThisRound = true;
      n.lastRaiseWeek = week;
      highAav = bid.aav; highId = t.id;
    }
  }
  // After every team has had its turn, resolve knockouts: solo-knockout
  // signs immediately; contested 150%+ bids escalate into a war.
  for (const fa of candidates) {
    if (negs[fa.name]?.state === "negotiating") _faTryKnockout(fa.name);
  }
}

// At the end of every regular-season week: resolve any negotiation
// where nobody raised this round. Highest standing bid signs the
// player (if it meets demand). Then mark all negotiations
// raisedThisRound=false so next week is a fresh raise window. If the
// week was the LAST week of the season, force-close all remaining
// negotiations as unsigned.
function _faResolveAfterWeek(week, isSeasonEnd) {
  const negs = franchise.faNegotiations || {};
  const myId = franchise.chosenTeamId;
  const newsSigned = [];
  const newsLost   = [];

  for (const [name, n] of Object.entries(negs)) {
    if (n.state !== "negotiating") continue;

    // Find highest bid (your + AI)
    let highAav = 0, highYrs = 0, highId = null, highIsYou = false;
    if (n.yourBid) {
      if (n.yourBid.aav > highAav) {
        highAav = n.yourBid.aav; highYrs = n.yourBid.years;
        highId = myId; highIsYou = true;
      }
    }
    for (const [tid, b] of Object.entries(n.aiBids)) {
      if (b.aav > highAav) {
        highAav = b.aav; highYrs = b.years;
        highId = Number(tid); highIsYou = false;
      }
    }

    if (!n.raisedThisRound) {
      // Stable round → player signs to the standing high bidder if
      // it meets demand (95% threshold). Otherwise the FA lowers
      // their asking and stays on the market.
      const signFn = () => {
        const _faStruct1 = n.yourBid?.structure || _defaultStructure(n.fa.age || 27, n.fa.overall || 70);
        const _faBonus1  = _signingBonusCalc(highAav, highYrs, n.fa.overall || 70);
        n.fa.contract = {
          years: highYrs, remaining: highYrs, aav: highAav,
          structure: _faStruct1,
          baseSalaries: _baseSalarySchedule(highAav, highYrs, _faStruct1, _faBonus1.bonusProration),
          signingBonus: _faBonus1.signingBonus, bonusProration: _faBonus1.bonusProration,
          guaranteedYears: _guaranteedYearsForLength(highYrs),
          guaranteedAAV: highAav,
          incentives: _generateIncentives(n.fa, highAav),
        };
        n.state = "signed";
        n.signedToTeamId = highId;
        n.fa.systemYears = 0; // new system — familiarity resets
        franchise.rosters[highId].push(n.fa);
        const signTeam = getTeam(highId);
        if (highIsYou) {
          const myRoster = franchise.rosters[myId];
          for (const cut of (n.yourBid.cutNames || [])) {
            const i = myRoster.findIndex(p => p.name === cut);
            if (i !== -1) myRoster.splice(i, 1);
          }
          newsSigned.push({ name, pos: n.fa.position, aav: highAav, years: highYrs });
          _pushNews({ type:"fa_sign",
            label: `🆓 You signed ${n.fa.position} ${name} — $${highAav.toFixed(1)}M × ${highYrs}yr` });
        } else {
          n.signedToTeamName = `${signTeam.city} ${signTeam.name}`;
          _pushNews({ type:"fa_sign",
            label: `🆓 ${signTeam.name} sign ${n.fa.position} ${name} — $${highAav.toFixed(1)}M × ${highYrs}yr` });
        }
      };

      // Roster Builder HC lowers the acceptance threshold — FAs take less to play here.
      const _myHcSpec     = franchise.coaches?.[myId]?.hc?.specialtyTrait;
      const _acceptThresh = (highIsYou && _myHcSpec === "Roster Builder") ? 0.80 : 0.95;
      if (highId != null && highAav >= n.fa.demandedAAV * _acceptThresh) {
        signFn();
      } else {
        // FA didn't get a satisfactory offer this week — they lower
        // their asking. Slow drop if someone's at least bidding;
        // faster if there are no bids at all.
        n.fa.originalDemandAAV ??= n.fa.demandedAAV;
        const floor = +(n.fa.originalDemandAAV * 0.65).toFixed(1);
        const dropMul = highId != null ? 0.93 : 0.88;  // 7% w/ bids, 12% without
        const newDemand = Math.max(floor, n.fa.demandedAAV * dropMul);
        const atFloor = (n.fa.demandedAAV - floor) < 0.05;
        if (atFloor) {
          // Already at the floor and nobody's biting → off the market
          n.state = "unsigned";
          newsLost.push({ name, pos: n.fa.position });
          _pushNews({ type:"fa_unsigned",
            label: `🆓 ${n.fa.position} ${name} went unsigned — no takers at his floor of $${n.fa.demandedAAV.toFixed(1)}M` });
        } else {
          const prev = n.fa.demandedAAV;
          n.fa.demandedAAV = Math.round(newDemand * 10) / 10;
          n.fa.demandDropsCount = (n.fa.demandDropsCount || 0) + 1;
          _pushNews({ type:"fa_demand_drop",
            label: `🆓📉 ${n.fa.position} ${name} drops asking $${prev.toFixed(1)}M → $${n.fa.demandedAAV.toFixed(1)}M${highId == null ? " (no offers)" : ""}` });
          // Re-check sign threshold against the lowered demand
          if (highId != null && highAav >= n.fa.demandedAAV * 0.95) signFn();
        }
      }
    } else if (isSeasonEnd) {
      // Continuous counter-bidding all season → never signs
      n.state = "unsigned";
      newsLost.push({ name, pos: n.fa.position, reason: "endless negotiation" });
    } else {
      // Active bidding week: demand still drifts down slowly (3%) even with
      // counter-bids, then check if the high bid now clears the threshold.
      // This prevents infinite negotiation when AI teams keep making tiny
      // incremental counter-bids that reset the stable-round clock.
      n.fa.originalDemandAAV ??= n.fa.demandedAAV;
      const slowFloor = +(n.fa.originalDemandAAV * 0.65).toFixed(1);
      const driftedDemand = Math.max(slowFloor, Math.round(n.fa.demandedAAV * 0.97 * 10) / 10);
      if (driftedDemand < n.fa.demandedAAV) n.fa.demandedAAV = driftedDemand;
      // If the standing high bid now clears 95% of the drifted demand → sign
      if (highId != null && highAav >= n.fa.demandedAAV * 0.95) {
        signFn();
      } else {
        n.raisedThisRound = false;
      }
    }
  }
  franchise._faLastNews = { week, signed: newsSigned, lost: newsLost };
}

// ── User actions on the negotiations screen ──────────────────────────────────
function frnFANegotiationOpen(name) {
  renderFrnFANegotiations(name);
}
function frnFARaiseBid(name, byAmount) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  const cur = n.yourBid?.aav || _faNegCurrentHigh(n)?.aav || n.fa.demandedAAV * 0.95;
  const newAav = Math.round((cur + byAmount) * 10) / 10;
  n.yourBid = {
    aav: newAav,
    years: n.yourBid?.years || n.fa.demandedYears,
    cutNames: n.yourBid?.cutNames || [],
  };
  n.history.push({ teamId: franchise.chosenTeamId, label: "You", aav: newAav, years: n.yourBid.years, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  _faTryKnockout(name);
  saveFranchise();
  renderFrnFANegotiations(n.state === "signed" ? null : name);
}
function frnFAMatchHigh(name) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  const high = _faNegCurrentHigh(n);
  if (!high) return;
  n.yourBid = {
    aav: high.aav + 0.5,
    years: high.years,
    cutNames: n.yourBid?.cutNames || [],
  };
  n.history.push({ teamId: franchise.chosenTeamId, label: "You (raise)", aav: n.yourBid.aav, years: n.yourBid.years, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  _faTryKnockout(name);
  saveFranchise();
  renderFrnFANegotiations(n.state === "signed" ? null : name);
}
function frnFAFoldNeg(name) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  if (!confirm(`Withdraw from negotiations for ${name}?`)) return;
  n.yourBid = null;
  n.history.push({ teamId: franchise.chosenTeamId, label: "You FOLDED", aav: 0, years: 0, week: franchise.week });
  saveFranchise();
  renderFrnFANegotiations();
}
function _faNegCurrentHigh(n) {
  let high = null;
  if (n.yourBid) high = { teamId: franchise.chosenTeamId, ...n.yourBid, isYou: true };
  for (const [tid, b] of Object.entries(n.aiBids)) {
    if (!high || b.aav > high.aav) high = { teamId: Number(tid), ...b, isYou: false };
  }
  return high;
}

// Knockout sign: if exactly ONE standing bid clears 150% of demand the FA
// accepts on the spot. If TWO+ teams clear the threshold, a bidding war
// is declared (knockoutWar=true) and the negotiation continues; both
// teams will need to keep raising. Returns "signed" | "war" | "none".
const FA_KNOCKOUT_MULT = 1.5;
function _faTryKnockout(name) {
  const n = franchise.faNegotiations?.[name];
  if (!n || n.state !== "negotiating") return "none";
  const threshold = n.fa.demandedAAV * FA_KNOCKOUT_MULT;
  const ko = [];
  if (n.yourBid && n.yourBid.aav >= threshold)
    ko.push({ teamId: franchise.chosenTeamId, ...n.yourBid, isYou: true });
  for (const [tid, b] of Object.entries(n.aiBids))
    if (b.aav >= threshold) ko.push({ teamId: Number(tid), ...b, isYou: false });
  if (ko.length === 0) return "none";
  if (ko.length > 1) {
    if (!n.knockoutWar) {
      n.knockoutWar = true;
      _pushNews({ type:"fa_war",
        label: `🆓⚔ KNOCKOUT WAR — ${ko.length} teams over $${threshold.toFixed(1)}M for ${n.fa.position} ${name}` });
    }
    return "war";
  }
  // Solo knockout — sign immediately
  const high = ko[0];
  const _faStruct2 = high.structure || _defaultStructure(n.fa.age || 27, n.fa.overall || 70);
  const _faBonus2  = _signingBonusCalc(high.aav, high.years, n.fa.overall || 70);
  n.fa.contract = {
    years: high.years, remaining: high.years, aav: high.aav,
    structure: _faStruct2,
    baseSalaries: _baseSalarySchedule(high.aav, high.years, _faStruct2, _faBonus2.bonusProration),
    signingBonus: _faBonus2.signingBonus, bonusProration: _faBonus2.bonusProration,
    guaranteedYears: _guaranteedYearsForLength(high.years),
    guaranteedAAV: high.aav,
    incentives: _generateIncentives(n.fa, high.aav),
  };
  n.state = "signed";
  n.signedToTeamId = high.teamId;
  n.history.push({ teamId: high.teamId,
    label: high.isYou ? "You KNOCKOUT" : `${getTeam(high.teamId)?.name || "?"} KNOCKOUT`,
    aav: high.aav, years: high.years, week: franchise.week });
  n.fa.systemYears = 0; // new system — familiarity resets
  franchise.rosters[high.teamId].push(n.fa);
  const signTeam = getTeam(high.teamId);
  if (high.isYou) {
    const myId = franchise.chosenTeamId;
    const myRoster = franchise.rosters[myId];
    for (const cut of (n.yourBid?.cutNames || [])) {
      const i = myRoster.findIndex(p => p.name === cut);
      if (i !== -1) myRoster.splice(i, 1);
    }
    _pushNews({ type:"fa_sign",
      label: `🆓💥 KNOCKOUT — You signed ${n.fa.position} ${name} for $${high.aav.toFixed(1)}M × ${high.years}yr (over market)` });
  } else {
    n.signedToTeamName = `${signTeam.city} ${signTeam.name}`;
    _pushNews({ type:"fa_sign",
      label: `🆓💥 KNOCKOUT — ${signTeam.name} sign ${n.fa.position} ${name} for $${high.aav.toFixed(1)}M × ${high.years}yr` });
  }
  return "signed";
}

function frnFAOpenSelf() { renderFrnFANegotiations(); }

function renderFrnFANegotiations(selectedName) {
  const negs = franchise.faNegotiations || {};
  const myId = franchise.chosenTeamId;
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const myCapUsed = capUsedByTeam(myId);

  const active   = Object.entries(negs).filter(([, n]) => n.state === "negotiating");
  const resolved = Object.entries(negs).filter(([, n]) => n.state !== "negotiating" && n.yourBid);

  // Build results section (user-bid-on negotiations that have concluded)
  const _buildResultsHtml = () => {
    if (!resolved.length) return "";
    const items = resolved.map(([name, n]) => {
      const won      = n.state === "signed" && n.signedToTeamId === myId;
      const unsigned = n.state === "unsigned";
      const statusColor = won ? "var(--green-lt)" : unsigned ? "var(--gray)" : "var(--red)";
      const statusLabel = won ? "WON" : unsigned ? "UNSIGNED" : "LOST";
      const rowClass    = won ? "won" : unsigned ? "unsigned" : "lost";
      // AAV: for won use yourBid; for lost use last history entry by winner; for unsigned use demand at time
      let aav, years;
      if (won) {
        aav   = n.yourBid.aav;
        years = n.yourBid.years;
      } else if (n.state === "signed") {
        const lastH = n.history.slice().reverse().find(h => h.teamId === n.signedToTeamId);
        aav   = lastH ? lastH.aav   : (n.history[n.history.length - 1]?.aav   || 0);
        years = lastH ? lastH.years : (n.history[n.history.length - 1]?.years || "?");
      } else {
        aav   = n.fa.demandedAAV || 0;
        years = "—";
      }
      const destStr = won
        ? "You signed them"
        : unsigned
          ? `Went unsigned · floor $${aav.toFixed ? aav.toFixed(1) : aav}M`
          : `Signed with ${n.signedToTeamName || "another team"} · $${aav.toFixed ? aav.toFixed(1) : aav}M × ${years}yr`;
      return `<div class="frn-fa-result-row ${rowClass}">
        <span>${gradeBadge(n.fa)}</span>
        <span class="frn-fa-name">${n.fa.name}</span>
        <span class="frn-fa-pos">${n.fa.position}</span>
        <span style="color:${statusColor};font-weight:900;font-size:.62rem;letter-spacing:.3px">${statusLabel}</span>
        <span style="color:var(--gray);font-size:.62rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${destStr}</span>
      </div>`;
    }).join("");
    return `<div style="margin-bottom:.7rem">
      <div class="frn-card-title">📋 YOUR BID RESULTS</div>
      <div class="frn-fa-results-list">${items}</div>
    </div>`;
  };

  if (active.length === 0) {
    const resultsHtml = _buildResultsHtml();
    $("frnHomeContent").innerHTML = `
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
        <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🆓 FA TRACKER · Week ${franchise.week}</div>
        <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Dashboard</button>
      </div>
      ${resultsHtml || `<div style="text-align:center;padding:1.5rem 1rem">
        <div style="font-size:1.05rem;font-weight:700;color:var(--gold)">No active free-agent negotiations.</div>
        <div style="color:var(--gray);font-size:.78rem;margin-top:.4rem">Submit bids during FA to track outcomes here.</div>
      </div>`}`;
    return;
  }

  // Pick selected (default: first negotiation involving you)
  let selKey = selectedName && negs[selectedName]?.state === "negotiating" ? selectedName : null;
  if (!selKey) selKey = active.find(([, n]) => n.yourBid)?.[0] || active[0][0];
  const selNeg = negs[selKey];
  const selHigh = _faNegCurrentHigh(selNeg);
  const escSel  = selKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  // Left: list of all negotiations
  const listHtml = active.map(([name, n]) => {
    const high = _faNegCurrentHigh(n);
    const isSel = name === selKey;
    const isHotForYou = n.yourBid && high && !high.isYou; // you're being outbid
    const escName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const warFlag = n.knockoutWar
      ? `<span class="frn-fa-flag" style="color:var(--red);font-weight:900">⚔ WAR</span>` : "";
    return `<button class="frn-fa-row ${isSel?"selected":""} ${n.yourBid?"offered":""}"
      onclick="renderFrnFANegotiations('${escName}')">
      <span>${gradeBadge(n.fa)}</span>
      <span class="frn-fa-name">${n.fa.name}</span>
      <span class="frn-fa-pos">${n.fa.position}</span>
      <span class="frn-fa-ask">high $${high?high.aav.toFixed(0):"-"}M</span>
      ${warFlag || (high ? `<span class="frn-fa-flag" style="color:${high.isYou?"var(--green-lt)":"var(--red)"}">${high.isYou?"YOU LEAD":isHotForYou?"OUTBID":(getTeam(high.teamId)?.name||"?")+" leads"}</span>` : "")}
    </button>`;
  }).join("");

  // History table
  const histHtml = selNeg.history.slice(-12).reverse().map(h => `
    <tr>
      <td style="color:var(--gray);font-size:.6rem">W${h.week}</td>
      <td>${h.label}</td>
      <td style="color:var(--gold)">$${h.aav.toFixed(1)}M</td>
      <td style="color:var(--gray)">${h.years || "—"}yr</td>
    </tr>`).join("");

  // Actions row
  const yourCur = selNeg.yourBid?.aav || 0;
  const yourYrs = selNeg.yourBid?.years || selNeg.fa.demandedYears;
  const beingOutbid = selHigh && !selHigh.isYou && selNeg.yourBid;
  const baseKO = +(selNeg.fa.demandedAAV * FA_KNOCKOUT_MULT).toFixed(1);
  const isKWar = !!selNeg.knockoutWar;
  const minKBid = +(Math.max(baseKO, (selHigh?.aav || 0) + 0.5)).toFixed(1);
  const knockoutNeed = Math.max(0, +(minKBid - yourCur).toFixed(1));
  const koLabel = isKWar ? `⚔ TOP WAR $${minKBid.toFixed(1)}M` : `💥 KNOCKOUT $${minKBid.toFixed(1)}M`;
  const actionsHtml = `
    <div class="frn-fa-neg-actions">
      ${selNeg.yourBid ? `
        <button class="btn btn-gold" onclick="frnFARaiseBid('${escSel}', 1)">↑ +$1M</button>
        <button class="btn btn-gold" onclick="frnFARaiseBid('${escSel}', 3)">↑ +$3M</button>
        ${beingOutbid ? `<button class="btn btn-gold" onclick="frnFAMatchHigh('${escSel}')">→ Outbid by $0.5M</button>` : ""}
        <button class="btn btn-gold" onclick="frnFAKnockoutBid('${escSel}')" style="background:var(--gold);color:#000;font-weight:900" title="${isKWar?'War on — bidders past 150% threshold':'Bid past 150% to win instantly'}">${koLabel}${knockoutNeed > 0 ? ` (+$${knockoutNeed.toFixed(1)}M)` : ""}</button>
        <button class="btn btn-outline" onclick="frnFAFoldNeg('${escSel}')" style="color:var(--red)">✗ Fold</button>
      ` : `
        <button class="btn btn-gold" onclick="frnFAEnterBid('${escSel}')">+ Enter Bid (match current high)</button>
        <button class="btn btn-gold" onclick="frnFAKnockoutBid('${escSel}')" style="background:var(--gold);color:#000;font-weight:900">${koLabel}</button>
      `}
    </div>
    <div class="frn-fa-neg-actions" style="margin-top:.5rem;align-items:center;gap:.4rem">
      <span class="frn-meta-label" style="margin:0">Contract length:</span>
      <button class="btn btn-outline" onclick="frnFASetNegotiationYears('${escSel}',${Math.max(1, yourYrs-1)})" style="font-size:.65rem;padding:.2rem .55rem">− 1yr</button>
      <span style="color:var(--gold-lt);font-weight:700;min-width:3rem;text-align:center">${yourYrs} yr</span>
      <button class="btn btn-outline" onclick="frnFASetNegotiationYears('${escSel}',${Math.min(7, yourYrs+1)})" style="font-size:.65rem;padding:.2rem .55rem">+ 1yr</button>
      <input type="number" min="1" max="7" step="1" value="${yourYrs}"
        onchange="frnFASetNegotiationYears('${escSel}',this.value)"
        style="width:3.6rem;background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.2rem .35rem;font-family:inherit;font-size:.7rem">
      <span style="color:var(--gray);font-size:.62rem">FA wants ${selNeg.fa.demandedYears}yr · longer = more risk for you, more comfort for them</span>
    </div>
    <div class="frn-fa-neg-actions" style="margin-top:.4rem;align-items:center;gap:.4rem">
      <span class="frn-meta-label" style="margin:0">Structure:</span>
      ${["BALANCED","BACKLOADED","FRONTLOADED"].map(s => {
        const cur = selNeg.yourBid?.structure || _defaultStructure(selNeg.fa.age||27, selNeg.fa.overall||70);
        const desc = s === "BALANCED" ? "flat salaries" : s === "BACKLOADED" ? "cheap now, costly later" : "costly now, cheap later";
        return `<button class="btn ${cur===s?"btn-gold":"btn-outline"}" onclick="frnFASetStructure('${escSel}','${s}')" style="font-size:.62rem;padding:.2rem .5rem" title="${desc}">${s[0]+s.slice(1).toLowerCase()}</button>`;
      }).join("")}
      <span style="color:var(--gray);font-size:.62rem">affects year-by-year cap hits &amp; dead cap if cut</span>
    </div>`;

  // Cap math preview
  const projAdd = selNeg.yourBid ? selNeg.yourBid.aav : 0;
  const cutNames = new Set(selNeg.yourBid?.cutNames || []);
  const myRoster = franchise.rosters[myId];
  const cutSavings = myRoster.filter(p => cutNames.has(p.name)).reduce((s,p) => s + (p.contract?.aav||0), 0);
  const proj = myCapUsed + projAdd - cutSavings;

  // — Decision support: full detail panel + position market + verdict —
  const fa = selNeg.fa;
  const posMarket = (() => {
    // Top 5 AAVs at this position currently signed in the league
    const aavs = [];
    for (const r of Object.values(franchise.rosters || {})) {
      for (const p of r) if (p.position === fa.position && p.contract) aavs.push(p.contract.aav);
    }
    aavs.sort((a,b) => b-a);
    const top5 = aavs.slice(0, 5);
    if (!top5.length) return null;
    const top5Avg = top5.reduce((s,v) => s+v, 0) / top5.length;
    const median = aavs[Math.floor(aavs.length/2)] || 0;
    return { top5Avg, median, top1: aavs[0] || 0 };
  })();
  // Verdict heuristic: scout grade + age + market vs demand
  const grade = scoutGrade(fa);
  const ageRisk = fa.age >= (fa.declineAge ?? 32) ? "declining"
    : fa.age >= 30 ? "late prime"
    : fa.age >= 27 ? "prime"
    : fa.age >= 24 ? "ascending"
    : "young";
  const valueGap = posMarket ? (fa.demandedAAV - posMarket.top5Avg) : 0;
  const valueTag = valueGap < -2 ? "BARGAIN"
    : valueGap < 2 ? "FAIR"
    : valueGap < 6 ? "PREMIUM"
    : "OVERPRICED";
  const verdictColor = valueTag === "BARGAIN" ? "var(--green-lt)"
    : valueTag === "FAIR" ? "var(--gold-lt)"
    : valueTag === "PREMIUM" ? "#e8a000"
    : "var(--red)";
  const recurrenceMul = _injuryRecurrenceMul(fa);
  const proneStr = recurrenceMul > 1.2 ? `${(recurrenceMul*100-100).toFixed(0)}% above baseline` : "normal";
  const verdictHtml = `
    <div class="frn-card-title" style="margin-top:.6rem">📋 SCOUT VERDICT</div>
    <div class="frn-fa-preview" style="display:grid;grid-template-columns:repeat(4,1fr);gap:.45rem;font-size:.7rem">
      <div><span class="frn-meta-label">PRICE TAG</span> <b style="color:${verdictColor}">${valueTag}</b></div>
      <div><span class="frn-meta-label">CAREER STAGE</span> <b style="color:var(--white)">${ageRisk}</b></div>
      <div><span class="frn-meta-label">INJURY RISK</span> <b style="color:${recurrenceMul>1.4?"#ff9090":"var(--white)"}">${proneStr}</b></div>
      <div><span class="frn-meta-label">SCOUT GRADE</span> <b style="color:var(--gold)">${gradeLabel(grade)}</b></div>
    </div>
    ${posMarket ? `<div style="margin-top:.35rem;color:var(--gray);font-size:.62rem">
      ${fa.position} market — top 5 avg <b style="color:var(--gold-lt)">$${posMarket.top5Avg.toFixed(1)}M</b> ·
      league median <b style="color:var(--gold-lt)">$${posMarket.median.toFixed(1)}M</b> ·
      top-paid <b style="color:var(--gold)">$${posMarket.top1.toFixed(1)}M</b>.
      He wants <b style="color:var(--gold-lt)">$${fa.demandedAAV.toFixed(1)}M</b>${fa.originalDemandAAV && fa.originalDemandAAV > fa.demandedAAV ? ` <span style="color:#ff9090">(was $${fa.originalDemandAAV.toFixed(1)}M · dropped ${fa.demandDropsCount}×)</span>` : ""}.
    </div>` : ""}`;

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🆓 FA NEGOTIATIONS · Week ${franchise.week}</div>
      <div style="color:var(--gray);font-size:.72rem">${active.length} active · raises lock the player in for another week</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Dashboard</button>
    </div>
    <div class="frn-fa-summary">
      <span>Your cap: <b>$${myCapUsed.toFixed(1)}M / $${cap.toFixed(0)}M</b></span>
      <span>If you win this FA: <b style="color:${proj>cap?"var(--red)":"var(--gold)"}">$${proj.toFixed(1)}M projected</b></span>
    </div>
    <div class="frn-fa-layout">
      <div class="frn-fa-pool-col">
        <div class="frn-card-title">ACTIVE NEGOTIATIONS</div>
        <div class="frn-fa-pool-list">${listHtml}</div>
        ${_buildResultsHtml()}
      </div>
      <div class="frn-fa-mid-col" style="grid-column: span 2">
        <div class="frn-fa-preview">
          <div>Current high: <b style="color:var(--gold)">$${selHigh?selHigh.aav.toFixed(1):"0"}M × ${selHigh?selHigh.years:"-"}yr</b>
          ${selHigh ? `by <b style="color:${selHigh.isYou?"var(--green-lt)":"var(--white)"}">${selHigh.isYou ? "YOU" : (getTeam(selHigh.teamId).city+" "+getTeam(selHigh.teamId).name)}</b>` : ""}
          </div>
          <div style="color:var(--gray);font-size:.68rem;margin-top:.2rem">
            Your bid: <b style="color:${yourCur?"var(--gold-lt)":"var(--gray)"}">${selNeg.yourBid?`$${yourCur.toFixed(1)}M × ${selNeg.yourBid.years}yr`:"not bidding"}</b>
            · ${selNeg.raisedThisRound ? "<span style='color:var(--gold-lt)'>This round had a raise — won't sign yet</span>" : "<span style='color:var(--green-lt)'>Stable — will sign at end of this week if no one raises</span>"}
          </div>
          <div style="color:var(--gray);font-size:.62rem;margin-top:.15rem">
            ${isKWar
              ? `⚔ <b style="color:var(--red)">KNOCKOUT WAR ACTIVE</b> — multiple teams over $${baseKO.toFixed(1)}M. Sole knockout signs; ties keep escalating.`
              : `💥 <b style="color:var(--gold-lt)">Knockout bid:</b> sole offer ≥ <b style="color:var(--gold)">$${baseKO.toFixed(1)}M</b> (${(FA_KNOCKOUT_MULT*100).toFixed(0)}% of demand) wins instantly. Two teams over → bidding war.`}
          </div>
        </div>
        ${actionsHtml}
        ${verdictHtml}
        ${(() => {
          // Contract advisor — show 2-3 construction suggestions
          const goals = [
            { id:"flex",    label:"Maximize Flexibility" },
            { id:"capnow",  label:"Minimize Cap Now" },
            { id:"lockup",  label:"Lock Up Long Term" },
            { id:"lowrisk", label:"Low Risk" },
          ];
          const capRoom = cap - myCapUsed;
          const suggs = _contractAdvisor(fa, selNeg._advisorGoal || "flex", cap);
          const goalBtns = goals.map(g => {
            const active = (selNeg._advisorGoal || "flex") === g.id;
            return `<button class="btn ${active?"btn-gold":"btn-outline"}" onclick="frnFASetAdvisorGoal('${escSel}','${g.id}')" style="font-size:.58rem;padding:.15rem .4rem">${g.label}</button>`;
          }).join("");
          const suggHtml = suggs.map(s => {
            const capHitNow = s.aav; // Simplified; real cap hit depends on structure
            return `<div style="background:var(--bg3);border-radius:4px;padding:.4rem .55rem;margin-top:.3rem;display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
              <div>
                <div style="font-weight:700;font-size:.68rem;color:var(--gold)">${s.label}</div>
                <div style="color:var(--gray);font-size:.6rem;margin-top:.1rem">${s.note}</div>
              </div>
              <button class="btn btn-outline" onclick="frnFAApplyAdvisor('${escSel}',${s.years},${s.aav},'${s.structure}')" style="font-size:.58rem;padding:.15rem .4rem;white-space:nowrap">Use $${s.aav.toFixed(1)}M × ${s.years}yr</button>
            </div>`;
          }).join("");
          return `<div style="margin-top:.7rem;padding:.5rem .6rem;background:rgba(200,169,0,.06);border:1px solid rgba(200,169,0,.2);border-radius:6px">
            <div style="font-size:.68rem;font-weight:700;color:var(--gold);margin-bottom:.4rem">🤝 CONTRACT ADVISOR</div>
            <div style="display:flex;flex-wrap:wrap;gap:.25rem;margin-bottom:.2rem">${goalBtns}</div>
            ${suggHtml}
          </div>`;
        })()}
        <div class="frn-card-title" style="margin-top:.8rem">📊 FULL PLAYER REPORT</div>
        ${_buildPlayerDetailPanel(fa)}
        <div class="frn-card-title" style="margin-top:.8rem">BID HISTORY</div>
        <table class="frn-pre-roster-table">
          <thead><tr><th>Wk</th><th>By</th><th>AAV</th><th>Years</th></tr></thead>
          <tbody>${histHtml}</tbody>
        </table>
      </div>
    </div>`;
}

function frnFAEnterBid(name) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  const high = _faNegCurrentHigh(n);
  const aav = high ? Math.round((high.aav + 0.5) * 10) / 10 : n.fa.demandedAAV;
  n.yourBid = { aav, years: n.fa.demandedYears, cutNames: [] };
  n.history.push({ teamId: franchise.chosenTeamId, label: "You (joined)", aav, years: n.fa.demandedYears, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  _faTryKnockout(name);
  saveFranchise();
  renderFrnFANegotiations(n.state === "signed" ? null : name);
}

// Drop a knockout bid: at minimum 150% of demand, but in an ongoing war
// it must clear the current high by $0.5M. Triggers instant sign only
// if you're the SOLE team over the knockout threshold; otherwise the
// war keeps escalating.
function frnFAKnockoutBid(name) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  const baseKO  = n.fa.demandedAAV * FA_KNOCKOUT_MULT;
  const curHigh = _faNegCurrentHigh(n);
  const minBid  = Math.max(baseKO, (curHigh?.aav || 0) + 0.5);
  const knockoutAav = Math.round(minBid * 10) / 10;
  const myId = franchise.chosenTeamId;
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const room = cap - capUsedByTeam(myId);
  const cutSavings = (n.yourBid?.cutNames || []).reduce((s, cutName) => {
    const p = (franchise.rosters[myId] || []).find(x => x.name === cutName);
    return s + (p?.contract?.aav || 0);
  }, 0);
  if (knockoutAav - cutSavings > room) {
    alert(`Not enough cap room: knockout needs $${knockoutAav.toFixed(1)}M, you have $${(room + cutSavings).toFixed(1)}M (after planned cuts).`);
    return;
  }
  const isWar = !!n.knockoutWar;
  const label = isWar ? "TOP KNOCKOUT" : "KNOCKOUT BID";
  if (!confirm(`💥 ${label} — pay $${knockoutAav.toFixed(1)}M × ${n.yourBid?.years || n.fa.demandedYears}yr for ${name}?${isWar ? "\n\nThis is a bidding war — other teams may keep raising next week." : ""}`)) return;
  n.yourBid = {
    aav: knockoutAav,
    years: n.yourBid?.years || n.fa.demandedYears,
    cutNames: n.yourBid?.cutNames || [],
  };
  n.history.push({ teamId: myId, label: `You (${label})`, aav: knockoutAav, years: n.yourBid.years, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  const result = _faTryKnockout(name);
  if (result === "war") {
    alert(`⚔ BIDDING WAR — another team is also over $${baseKO.toFixed(1)}M for ${name}. Keep raising next week to outlast them.`);
  }
  saveFranchise();
  renderFrnFANegotiations(n.state === "signed" ? null : name);
}

// Adjust contract length on an active offer. Capped at 1..7 years.
// A longer contract reads as more commitment to the FA, but each
// year also adds dead-money risk for the team — the AI agents
// weight years × aav when picking the winning bid, so this is a
// real lever for the user, not just cosmetic.
function frnFASetStructure(name, structure) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  if (!n.yourBid) n.yourBid = { aav: 0, years: n.fa.demandedYears, cutNames: [] };
  n.yourBid.structure = structure;
  saveFranchise();
  renderFrnFANegotiations(name);
}

function frnFASetNegotiationYears(name, years) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  const y = Math.max(1, Math.min(7, Math.round(Number(years) || 1)));
  if (!n.yourBid) {
    // Allow setting years before placing a bid — they apply on entry.
    n.yourBid = { aav: 0, years: y, cutNames: [] };
  } else {
    n.yourBid.years = y;
  }
  n.history.push({ teamId: franchise.chosenTeamId, label: `You (years → ${y})`,
    aav: n.yourBid.aav || 0, years: y, week: franchise.week });
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  saveFranchise();
  renderFrnFANegotiations(name);
}

function frnFASetAdvisorGoal(name, goal) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  n._advisorGoal = goal;
  saveFranchise();
  renderFrnFANegotiations(name);
}

function frnFAApplyAdvisor(name, years, aav, structure) {
  const n = franchise.faNegotiations?.[name]; if (!n) return;
  if (!n.yourBid) n.yourBid = { aav: 0, years, cutNames: [], structure };
  n.yourBid.years = years;
  n.yourBid.aav   = aav;
  n.yourBid.structure = structure;
  n.raisedThisRound = true;
  n.lastRaiseWeek = franchise.week;
  n.history.push({ teamId: franchise.chosenTeamId, label: `You (advisor: $${aav}M × ${years}yr)`, aav, years, week: franchise.week });
  saveFranchise();
  renderFrnFANegotiations(name);
}

function renderFrnFAResults() {
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const used = capUsedByTeam(franchise.chosenTeamId);
  const overCap = used > cap;
  const { signed = [], lost = [] } = franchise._faResults || {};

  const signedHtml = signed.length ? `
    <div class="frn-card-box" style="margin-top:.6rem">
      <div class="frn-card-title">✓ SIGNED (${signed.length})</div>
      ${signed.map(s => `<div style="font-size:.78rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <b style="color:var(--gold-lt)">${s.name}</b> (${s.pos}) — $${s.aav.toFixed(1)}M/yr × ${s.years}yr
        ${s.cut.length ? `<div style="color:var(--gray);font-size:.65rem;margin-top:.15rem">Released: ${s.cut.join(", ")}</div>` : ""}
      </div>`).join("")}
    </div>` : "";
  const lostHtml = lost.length ? `
    <div class="frn-card-box" style="margin-top:.6rem">
      <div class="frn-card-title">✗ DECLINED (${lost.length})</div>
      ${lost.map(l => `<div style="font-size:.78rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
        <b>${l.name}</b> (${l.pos}) — offered $${l.offered.toFixed(1)}M, wanted $${l.demanded.toFixed(1)}M
      </div>`).join("")}
    </div>` : "";

  $("frnHomeContent").innerHTML = `
    <div style="text-align:center;margin-bottom:1rem">
      <div style="font-size:1.2rem;font-weight:900;color:var(--gold)">📋 FREE AGENCY RESULTS</div>
      <div style="color:var(--gray);font-size:.78rem">A week has passed. Here's how your offers landed.</div>
    </div>
    ${signedHtml || `<div style="color:var(--gray);text-align:center;font-size:.78rem">No new players signed.</div>`}
    ${lostHtml}
    <div class="frn-card-box" style="margin-top:.6rem">
      <div class="frn-card-title">CAP STATUS</div>
      <div style="font-size:.85rem;padding:.4rem 0">
        Cap used: <b style="color:${overCap?"var(--red)":"var(--white)"}">$${used.toFixed(1)}M</b>
        / <b style="color:var(--gold)">$${cap.toFixed(0)}M</b>
        ${overCap
          ? `<div style="color:var(--red);font-weight:700;margin-top:.4rem">
              ⚠ OVER CAP by $${(used-cap).toFixed(1)}M.
              You have one grace week — start the season anyway, but you must be cap-legal before Week 2.
            </div>`
          : `<div style="color:var(--green-lt);margin-top:.3rem">✓ Cap-legal — ready for Week 1.</div>`}
      </div>
    </div>
    <div class="frn-actions" style="justify-content:center;margin-top:1rem">
      ${overCap
        ? `<button class="btn btn-gold-big" onclick="frnFAGoToCuts()">→ MAKE CUTS NOW</button>
           <button class="btn btn-outline" onclick="frnFAStartWithGrace()" style="color:var(--gold)">Defer cuts — start Week 1 anyway</button>`
        : `<button class="btn btn-gold-big" onclick="frnFAFinish()">▶ START WEEK 1</button>`}
    </div>`;
}

function frnFAGoToCuts() {
  franchise.phase = "fa_cuts";
  saveFranchise();
  renderFrnFACuts();
}

function frnFAStartWithGrace() {
  // 1-week grace: deadline is end of Week 1
  franchise.capGraceDeadline = 2;
  frnFAFinish();
}

function renderFrnFACuts() {
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const myRoster = franchise.rosters[franchise.chosenTeamId] || [];
  const used = capUsedByTeam(franchise.chosenTeamId);
  const room = cap - used;
  const overCap = used > cap;

  const rosterByCost = myRoster.slice().sort((a,b) => (b.contract?.aav||0) - (a.contract?.aav||0));
  const rows = rosterByCost.map(p => {
    const escName = (p.name||"").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `<tr>
      <td style="color:var(--gray)">${p.position}</td>
      <td style="font-weight:700">${p.name}</td>
      <td>${gradeBadge(p)}</td>
      <td style="color:var(--gray)">${p.age||"?"}</td>
      <td style="color:var(--gold)">$${(p.contract?.aav||0).toFixed(1)}M</td>
      <td><button class="frn-pre-cut" onclick="frnFACutPlayer('${escName}','${p.position}')">✗ CUT</button></td>
    </tr>`;
  }).join("");

  $("frnHomeContent").innerHTML = `
    <div style="text-align:center;margin-bottom:1rem">
      <div style="font-size:1.15rem;font-weight:900;color:${overCap?"var(--red)":"var(--gold)"}">
        ${overCap ? "⚠ CUT TO BE CAP-LEGAL" : "✓ CAP-LEGAL"}
      </div>
      <div style="color:var(--gray);font-size:.78rem;margin-top:.3rem">
        Cap used: <b style="color:${overCap?"var(--red)":"var(--white)"}">$${used.toFixed(1)}M</b>
        / <b style="color:var(--gold)">$${cap.toFixed(0)}M</b>
        · <span style="color:${overCap?"var(--red)":"var(--green-lt)"}">
          ${overCap ? `$${Math.abs(room).toFixed(1)}M over` : `$${room.toFixed(1)}M room`}
        </span>
      </div>
    </div>
    <table class="frn-pre-roster-table">
      <thead><tr><th>Pos</th><th>Player</th><th>Grade</th><th>Age</th><th>AAV</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="frn-actions" style="justify-content:center;margin-top:1rem">
      <button class="btn btn-gold-big" onclick="frnFAFinish()" ${overCap?"disabled style=\"opacity:.5;cursor:not-allowed\"":""}>
        ▶ START WEEK 1
      </button>
    </div>`;
}

function frnFACutPlayer(name, pos) {
  if (!confirm(`Release ${name}? They free up their cap immediately.`)) return;
  const roster = franchise.rosters[franchise.chosenTeamId];
  const idx = roster.findIndex(p => p.name === name && p.position === pos);
  if (idx !== -1) roster.splice(idx, 1);
  saveFranchise();
  renderFrnFACuts();
}

function frnFAFinish() {
  franchise.phase = "regular";
  franchise._faResults = null;
  saveFranchise();
  showFranchiseDashboard();
}

// ── League chat ───────────────────────────────────────────────────────────────
// Single-player today, but the data model maps cleanly onto the MegaETH
// chat contract: messages are events keyed by (season, week, teamId).
// The on-chain version swaps frnPostMessage for a contract write +
// substitutes _generateAITrashTalk with subscribed event ingestion.
function frnPostMessage(text) {
  const t = (text || "").trim();
  if (!t) return;
  if (!franchise.chat) franchise.chat = [];
  franchise.chat.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    ts: Date.now(),
    season: franchise.season,
    week:   franchise.week,
    teamId: franchise.chosenTeamId,
    text:   t.slice(0, 280),
  });
  // Cap to 200 entries
  if (franchise.chat.length > 200) franchise.chat = franchise.chat.slice(-200);
  saveFranchise();
  renderFrnChat();
}

const TRASH_TALK_LINES = {
  blowout_win:    ["Got 'em.", "Talked all week, played like that.", "Mercy rule should be a thing.", "Cancel the rest of the season."],
  blowout_loss:   ["We had a bye week, right?", "I'm benching everybody.", "Trade block just doubled."],
  upset_win:      ["Underdog who??", "We told you. Y'all didn't listen.", "Powerhouses are overrated."],
  upset_loss:     ["Soft schedule, my bad.", "Wake-up call.", "Heads will roll Monday."],
  trade_made:     ["Wheelin' and dealin'.", "Sometimes you gotta restock.", "Mortgaging futures, baby."],
  signing:        ["Welcome to the squad.", "We got our guy.", "Big pickup."],
  generic:        ["Anyone wanna scrimmage?", "Free agency is wild this year.", "Need a corner. Trades open."],
};

function _generateAITrashTalk() {
  if (!franchise.chat) franchise.chat = [];
  // Look at last week's news for talking points; post 0-3 AI messages per advance
  const lastWeek = franchise.week - 1;
  const recent = (franchise.news || []).filter(n => n.season === franchise.season && n.week === lastWeek);
  const myId = franchise.chosenTeamId;
  const posted = new Set();
  const choose = arr => arr[Math.floor(Math.random() * arr.length)];

  for (const n of recent) {
    if (Math.random() > 0.35) continue;
    // Pick a random team that wasn't the user
    const t = TEAMS.filter(x => x.id !== myId)[Math.floor(Math.random() * (TEAMS.length - 1))];
    if (posted.has(t.id)) continue;
    posted.add(t.id);
    let pool = TRASH_TALK_LINES.generic;
    if (n.type === "blowout") pool = TRASH_TALK_LINES.blowout_win;
    else if (n.type === "upset") pool = TRASH_TALK_LINES.upset_win;
    else if (n.type === "trade") pool = TRASH_TALK_LINES.trade_made;
    else if (n.type === "signing") pool = TRASH_TALK_LINES.signing;
    franchise.chat.push({
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      ts: Date.now(),
      season: franchise.season,
      week:   franchise.week,
      teamId: t.id,
      text:   choose(pool),
    });
  }
  if (franchise.chat.length > 200) franchise.chat = franchise.chat.slice(-200);
}

