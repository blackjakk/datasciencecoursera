// ── League Wire archive: scrollable, grouped by week, season-filterable ───────
function renderFrnNewsArchive(season) {
  const allSeasons = Array.from(new Set((franchise.news || [])
    .map(n => n.season))).sort((a, b) => b - a);
  if (!allSeasons.length) allSeasons.push(franchise.season);
  const sel = season != null ? Number(season) : allSeasons[0];
  const items = (franchise.news || [])
    .filter(n => n.season === sel)
    .slice().sort((a, b) => b.week - a.week || 0);
  // Group by week (descending)
  const byWeek = {};
  for (const n of items) (byWeek[n.week] ??= []).push(n);
  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => b - a);
  const typeIcon = t => ({
    trade:"🔀", fa_sign:"🆓", fa_unsigned:"🆓",
    injury:"🩹", hof:"🏆", draft:"📋",
    blowout:"🔥", upset:"⚡", scrimmage:"🏟",
  })[t] || "•";
  const seasonBtns = allSeasons.map(s =>
    `<button class="frn-ana-tab ${s===sel?"active":""}" onclick="renderFrnNewsArchive(${s})">SEASON ${s}</button>`
  ).join("");
  const weekBlocks = weeks.length ? weeks.map(w => `
    <div class="frn-wire-week">
      <div class="frn-wire-week-head">WEEK ${w}</div>
      <ul class="frn-wire-list">
        ${byWeek[w].map(n => `
          <li class="frn-wire-item frn-wire-type-${n.type||""}">
            <span class="frn-wire-icon">${typeIcon(n.type)}</span>
            <span class="frn-wire-label">${n.label || ""}</span>
          </li>`).join("")}
      </ul>
    </div>`).join("")
    : `<div style="color:var(--gray);padding:1rem;text-align:center;font-style:italic">No wire entries for Season ${sel} yet.</div>`;
  // BSPN broadcast chrome — matches the other "watch the league"
  // pages (standings, leaders, legacy). Season picker becomes a
  // nav-style tab row; week blocks render inside a single panel.
  const seasonNav = allSeasons.map(s =>
    `<button class="bspnlive-nav-item ${s===sel?"active":""}"
      style="background:transparent;border:0;font-family:inherit;cursor:pointer;padding:0;${s===sel?"color:var(--blwhite)":""}"
      onclick="renderFrnNewsArchive(${s})">[SEASON ${s}]</button>`
  ).join(" ");

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">LEAGUE WIRE ARCHIVE</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("WIRE")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        ${seasonNav}
      </div>
      <div style="padding:.5rem 1.4rem;border-bottom:1px solid var(--blborder);color:var(--blgray);font-size:.7rem;letter-spacing:.5px">
        Season ${sel} · ${items.length} entr${items.length===1?"y":"ies"}
      </div>
      <div style="padding:1rem 1.4rem">
        <section class="bspn-panel" style="padding:.7rem 1rem">
          <div class="bspn-panel-title" style="color:var(--blgold);font-size:.75rem;letter-spacing:2px">CHRONOLOGICAL FEED</div>
          <div class="frn-wire-scroll">${weekBlocks}</div>
        </section>
      </div>
    </div>`;
}

// ── Projected free agents: everyone whose contract expires after this season ──
// Sorted by scout grade, grouped into "Your expiring deals" + "League pool".
// Lets the user plan re-signs and identify likely opening-day FA targets.
function renderFrnProjectedFAs(sort) {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const sortBy = sort || "grade";
  // A player is a "projected FA" if their contract has only 1 year left
  // (they hit the market next offseason). Rookies on their first deal
  // and just-signed FAs typically have more years, so this picks the
  // right cohort.
  const collect = teamId => (franchise.rosters[teamId] || [])
    .filter(p => p.contract && p.contract.remaining === 1)
    .map(p => ({ ...p, _teamId: teamId }));
  const mine = collect(myId);
  const league = TEAMS.filter(t => t.id !== myId).flatMap(t => collect(t.id));
  const sorters = {
    grade: (a, b) => scoutGrade(b) - scoutGrade(a),
    age:   (a, b) => (a.age||0) - (b.age||0),
    pos:   (a, b) => (a.position||"").localeCompare(b.position||"") || (scoutGrade(b)-scoutGrade(a)),
    aav:   (a, b) => (b.contract?.aav||0) - (a.contract?.aav||0),
  };
  mine.sort(sorters[sortBy]); league.sort(sorters[sortBy]);
  const sortBtn = (id, label) =>
    `<button class="frn-ana-tab ${sortBy===id?"active":""}" onclick="renderFrnProjectedFAs('${id}')">${label}</button>`;
  const sortBar = `<div class="frn-ana-tabs" style="margin-bottom:.6rem">
    ${sortBtn("grade","Grade")}${sortBtn("age","Age")}${sortBtn("pos","Position")}${sortBtn("aav","AAV")}
  </div>`;
  const row = p => {
    const tm = getTeam(p._teamId);
    return `<tr>
      <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
      <td style="font-weight:700">${playerLinkByName(p.name)}</td>
      <td>${gradeBadge(p)}</td>
      <td style="color:var(--gray)">${p.age||"?"}</td>
      <td style="color:var(--gray);font-size:.62rem">${draftStr(p)}</td>
      <td style="color:var(--gold)">$${(p.contract?.aav||0).toFixed(1)}M</td>
      <td style="color:var(--gray);font-size:.62rem">${tm ? tm.name : "—"}</td>
      ${p.injury ? `<td style="color:#ff9090;font-size:.62rem">🩹 ${_bspnEsc(p.injury.label)}</td>` : `<td></td>`}
    </tr>`;
  };
  const tableHead = `<thead><tr>
    <th>Pos</th><th>Player</th><th>Grade</th><th>Age</th>
    <th>Draft</th><th>AAV</th><th>Team</th><th></th>
  </tr></thead>`;
  const mineHtml = mine.length ? `
    <table class="frn-pre-roster-table">
      ${tableHead}
      <tbody>${mine.map(row).join("")}</tbody>
    </table>` : `<div style="color:var(--gray);padding:.5rem;text-align:center;font-style:italic">
      No players on your roster have an expiring deal — your books are clean.
    </div>`;
  const leagueHtml = league.length ? `
    <table class="frn-pre-roster-table">
      ${tableHead}
      <tbody>${league.map(row).join("")}</tbody>
    </table>` : `<div style="color:var(--gray);padding:.5rem;text-align:center;font-style:italic">
      No projected free agents league-wide.
    </div>`;
  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">📅 PROJECTED FREE AGENTS</div>
      <div style="color:var(--gray);font-size:.7rem">Players whose contract expires after Season ${franchise.season}</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    ${sortBar}
    <div class="frn-card-title" style="margin-bottom:.4rem">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()} · ${mine.length} expiring</div>
    ${mineHtml}
    <div class="frn-card-title" style="margin-top:1rem;margin-bottom:.4rem">LEAGUE POOL · ${league.length} expiring</div>
    ${leagueHtml}`;
}

// ── Injury report: every injured player on your roster + key opponents ────────
// ── Practice squad UI ────────────────────────────────────────────────────────
function renderFrnPracticeSquad(tab) {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const ps = franchise.practiceSquads?.[myId] || [];
  const tabId = tab || "mine";
  const visitsLeft = _scoutVisitsRemaining(myId);
  const psCost = psCostForTeam(myId);
  const autoSpend = franchise.autoSpendScouts !== false;
  const alerts = (franchise.psPoachAlerts || [])
    .filter(a => a.ownerTeamId === myId && a.deadlineWeek >= franchise.week);
  const tabs = [
    { id: "mine",     label: `🏈 MY PS (${ps.length}/${PS_SLOTS})` },
    { id: "league",   label: "🌐 LEAGUE PS" },
    { id: "scouted",  label: `🔍 SCOUTED (${Object.keys(franchise.scoutedPS||{}).filter(n=>franchise.scoutedPS[n].byTeamId===myId).length})` },
  ];
  const tabBar = tabs.map(t =>
    `<button class="frn-ana-tab ${t.id===tabId?"active":""}" onclick="renderFrnPracticeSquad('${t.id}')">${t.label}</button>`
  ).join("");

  let body = "";
  if (tabId === "mine") body = _renderPSMyTab(myId, ps, alerts);
  else if (tabId === "league") body = _renderPSLeagueTab(myId, visitsLeft);
  else body = _renderPSScoutedTab(myId);

  const banner = `
    <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🏈 PRACTICE SQUAD</div>
      <div style="color:var(--gray);font-size:.7rem">
        ${myTeam.city} ${myTeam.name} · Week ${franchise.week} ·
        Cost <b style="color:var(--gold-lt)">$${psCost.toFixed(1)}M</b> ·
        Scout visits <b style="color:var(--gold-lt)">${visitsLeft}/${SCOUT_VISITS_PER_WEEK}</b>
      </div>
      <label style="color:var(--gray);font-size:.65rem;display:flex;align-items:center;gap:.3rem;margin-left:auto">
        <input type="checkbox" ${autoSpend?"checked":""} onchange="frnTogglePSAutoSpend(this.checked)">
        Auto-spend remaining scouts on advance
      </label>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()">← Back</button>
    </div>
    <div class="frn-ana-tabs">${tabBar}</div>`;

  $("frnHomeContent").innerHTML = banner + body;
}

function _renderPSMyTab(myId, ps, alerts) {
  const alertHtml = alerts.length ? `
    <div style="background:rgba(255,80,80,0.08);border:1px solid var(--red);padding:.6rem;margin-bottom:.7rem">
      <div style="color:#ff9090;font-weight:700;margin-bottom:.3rem">⚠️ POACH ALERTS (${alerts.length})</div>
      ${alerts.map(a => `
        <div style="font-size:.72rem;padding:.2rem 0">
          ${getTeam(a.suitorTeamId)?.name} wants ${a.position} ${a.playerName} —
          <button class="frn-pcard-yrbtn" onclick="frnPSPromote('${a.playerName.replace(/'/g,"\\'")}')">Promote Now</button>
          or lose him after week ${a.deadlineWeek}
        </div>`).join("")}
    </div>` : "";

  if (!ps.length) {
    return alertHtml + `<div style="color:var(--gray);font-style:italic;padding:1.5rem;text-align:center">Your practice squad is empty. Sign players from cuts or draft them onto the PS.</div>`;
  }
  const rows = ps.map(p => {
    const flashes = (p._psFlashLog || []).filter(f => f.season === franchise.season);
    const hasGem = flashes.some(f => f.kind === "gem");
    const hasWow = flashes.some(f => f.kind === "wow");
    const tag = hasGem ? `<span style="color:var(--gold);font-weight:700">💎 GEM</span>`
              : hasWow ? `<span style="color:var(--gold-lt);font-weight:700">⭐ FLASH</span>`
              : "";
    const escName = (p.name || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    return `<tr>
      <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
      <td style="font-weight:700">${playerLinkByName(p.name)} ${tag}</td>
      <td>${gradeBadge(p)}</td>
      <td style="color:var(--gray)">${p.age||"?"}</td>
      <td style="color:var(--gray);font-size:.62rem">${draftStr(p)}</td>
      <td style="color:var(--gold);font-size:.65rem">${flashes.length} flash${flashes.length===1?"":"es"}</td>
      <td><button class="frn-pcard-yrbtn" onclick="frnPSPromote('${escName}')">Promote</button>
          <button class="frn-pcard-yrbtn" style="border-color:var(--red);color:#ff9090" onclick="frnPSRelease('${escName}')">Release</button></td>
    </tr>`;
  }).join("");
  return alertHtml + `<table class="frn-pre-roster-table">
    <thead><tr><th>POS</th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>Practice</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function _renderPSLeagueTab(myId, visitsLeft) {
  const teams = TEAMS.filter(t => t.id !== myId);
  const sections = teams.map(t => {
    const ps = franchise.practiceSquads?.[t.id] || [];
    if (!ps.length) return "";
    const rows = ps.map(p => {
      const escName = (p.name || "").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
      const intel = franchise.scoutedPS?.[p.name];
      const scoutedByMe = intel && intel.byTeamId === myId;
      // Without scouting: only show position, age, draft, noisy grade.
      // With scouting: also show flash count + potential ceiling.
      const flashes = scoutedByMe ? (p._psFlashLog || []).filter(f => f.season === franchise.season).length : null;
      const potentialCell = scoutedByMe
        ? `<td style="color:var(--gold);font-size:.62rem">~${Math.max(60, (p.potential||p.overall) - 3)}-${Math.min(99, (p.potential||p.overall) + 3)}</td>`
        : `<td style="color:var(--gray);font-size:.62rem">—</td>`;
      const flashCell = scoutedByMe
        ? `<td style="color:var(--gold-lt);font-size:.62rem">${flashes} flash${flashes===1?"":"es"}</td>`
        : `<td style="color:var(--gray)">—</td>`;
      const scoutBtn = scoutedByMe
        ? `<span style="color:var(--gold);font-size:.62rem">✓ scouted</span>`
        : `<button class="frn-pcard-yrbtn" ${visitsLeft<=0?"disabled":""} onclick="frnPSScout('${escName}')">🔍 Scout</button>`;
      return `<tr>
        <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
        <td style="font-weight:600">${p.name}</td>
        <td>${gradeBadge(p)}</td>
        <td style="color:var(--gray)">${p.age||"?"}</td>
        <td style="color:var(--gray);font-size:.62rem">${draftStr(p)}</td>
        ${potentialCell}
        ${flashCell}
        <td>${scoutBtn}</td>
      </tr>`;
    }).join("");
    return `<div class="frn-card-title" style="margin-top:.5rem;color:${t.primary}">${t.city.toUpperCase()} ${t.name.toUpperCase()} · ${ps.length}/${PS_SLOTS}</div>
      <table class="frn-pre-roster-table">
        <thead><tr><th>POS</th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>Ceiling</th><th>Practice</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).filter(Boolean).join("");
  return sections || `<div style="color:var(--gray);padding:1rem;text-align:center;font-style:italic">No league PS data available.</div>`;
}

function _renderPSScoutedTab(myId) {
  const myScouted = Object.entries(franchise.scoutedPS || {})
    .filter(([name, info]) => info.byTeamId === myId)
    .map(([name, info]) => {
      for (const [tIdStr, ps] of Object.entries(franchise.practiceSquads || {})) {
        const found = ps.find(p => p.name === name);
        if (found) return { p: found, teamId: Number(tIdStr), info };
      }
      return null;
    }).filter(Boolean);
  if (!myScouted.length) {
    return `<div style="color:var(--gray);font-style:italic;padding:1.5rem;text-align:center">No scouted PS players yet. Visit the League PS tab and spend visits.</div>`;
  }
  const rows = myScouted.map(({ p, teamId, info }) => {
    const team = getTeam(teamId);
    const flashes = (p._psFlashLog || []).filter(f => f.season === franchise.season);
    const ovrLow = Math.max(60, (p.potential || p.overall) - 3);
    const ovrHigh = Math.min(99, (p.potential || p.overall) + 3);
    return `<tr>
      <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
      <td style="font-weight:700">${p.name}</td>
      <td style="color:var(--gray);font-size:.62rem">${team?.name||"?"}</td>
      <td>${gradeBadge(p)}</td>
      <td style="color:var(--gold);font-size:.62rem">~${ovrLow}-${ovrHigh}</td>
      <td style="color:var(--gold-lt);font-size:.62rem">${flashes.length}</td>
      <td style="color:var(--gray);font-size:.6rem">W${info.week}</td>
    </tr>`;
  }).join("");
  return `<table class="frn-pre-roster-table">
    <thead><tr><th>POS</th><th>Player</th><th>Team</th><th>Grade</th><th>Ceiling</th><th>Flashes</th><th>Scouted</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function frnPSPromote(name) {
  const myId = franchise.chosenTeamId;
  const ps = franchise.practiceSquads?.[myId] || [];
  const p = ps.find(x => x.name === name);
  if (!p) return;
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  if (capUsedByTeam(myId) + 1.0 > cap) {
    if (!confirm(`Promoting ${name} pushes you over the cap. Continue?`)) return;
  }
  _psPromote(myId, p);
  saveFranchise();
  renderFrnPracticeSquad("mine");
}
function frnPSRelease(name) {
  if (!confirm(`Release ${name} from the practice squad?`)) return;
  const myId = franchise.chosenTeamId;
  const ps = franchise.practiceSquads?.[myId] || [];
  const idx = ps.findIndex(x => x.name === name);
  if (idx === -1) return;
  ps.splice(idx, 1);
  saveFranchise();
  renderFrnPracticeSquad("mine");
}
function frnPSScout(name) {
  const myId = franchise.chosenTeamId;
  if (!_psScout(myId, name)) { alert("No scouting visits remaining this week."); return; }
  saveFranchise();
  renderFrnPracticeSquad("league");
}
function frnTogglePSAutoSpend(on) {
  franchise.autoSpendScouts = !!on;
  saveFranchise();
}

function renderFrnInjuryReport() {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const collect = teamId => (franchise.rosters[teamId] || [])
    .filter(p => p.injury && p.injury.weeksRemaining > 0)
    .sort((a, b) => (b.injury.weeksRemaining||0) - (a.injury.weeksRemaining||0));
  const mine = collect(myId);
  const acrossLeague = TEAMS
    .filter(t => t.id !== myId)
    .map(t => ({ team: t, injured: collect(t.id) }))
    .filter(x => x.injured.length);
  const rowHtml = (p, opp) => `
    <tr>
      <td style="font-weight:700">${playerLinkByName(p.name)}</td>
      <td style="color:var(--gray)">${p.position}</td>
      <td style="color:var(--gray)">${p.age||"?"}</td>
      <td style="color:#ff9090">🩹 ${_bspnEsc(p.injury.label||"Injury")}</td>
      <td style="color:#ff9090;font-weight:700">${p.injury.weeksRemaining} wk${p.injury.weeksRemaining===1?"":"s"}</td>
      ${opp ? `<td style="color:var(--gray);font-size:.62rem">${opp.city} ${opp.name}</td>` : ""}
    </tr>`;
  const mineHtml = mine.length ? `
    <table class="frn-pre-roster-table" style="width:100%">
      <thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>Injury</th><th>Weeks Out</th></tr></thead>
      <tbody>${mine.map(p => rowHtml(p, null)).join("")}</tbody>
    </table>` : `<div style="color:var(--green-lt);padding:.8rem;text-align:center">No injuries on the active roster.</div>`;
  const leagueHtml = acrossLeague.length ? `
    <table class="frn-pre-roster-table" style="width:100%">
      <thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>Injury</th><th>Weeks Out</th><th>Team</th></tr></thead>
      <tbody>${acrossLeague.flatMap(({team, injured}) =>
        injured.map(p => rowHtml(p, team))).join("")}</tbody>
    </table>` : `<div style="color:var(--gray);padding:.5rem;text-align:center;font-style:italic">No injuries reported league-wide.</div>`;
  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🩹 INJURY REPORT</div>
      <div style="color:var(--gray);font-size:.7rem">Week ${franchise.week} · ${mine.length} on your roster</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-card-title" style="margin-bottom:.4rem">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()}</div>
    ${mineHtml}
    <div class="frn-card-title" style="margin-top:1rem;margin-bottom:.4rem">LEAGUE-WIDE</div>
    ${leagueHtml}`;
}

function renderFrnChat() {
  const myId = franchise.chosenTeamId;
  const all = (franchise.chat || []).slice().sort((a,b) => a.ts - b.ts);
  // Group by week label for visual breaks
  let lastLabel = "";
  const msgs = all.map(m => {
    const team = getTeam(m.teamId);
    const isMe = m.teamId === myId;
    const label = `S${m.season} W${m.week}`;
    const divider = label !== lastLabel
      ? `<div class="frn-chat-divider">${label}</div>` : "";
    lastLabel = label;
    return `${divider}
      <div class="frn-chat-msg ${isMe?"mine":""}">
        <div class="frn-chat-head" style="border-left:3px solid ${team?.primary||"var(--gold)"};padding-left:.4rem">
          <span style="color:${isMe?"var(--gold-lt)":"var(--gold)"};font-weight:700">${team?.name||"?"}</span>
          <span style="color:var(--gray);font-size:.55rem">${new Date(m.ts).toLocaleTimeString()}</span>
        </div>
        <div class="frn-chat-body">${_escHtml(m.text)}</div>
      </div>`;
  }).join("") || `<div style="color:var(--gray);font-style:italic;font-size:.78rem;padding:1rem;text-align:center">No messages yet. Start the trash talk.</div>`;

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">💬 LEAGUE CHAT</div>
      <div style="color:var(--gray);font-size:.72rem">Season ${franchise.season}, Week ${franchise.week}</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-chat-list">${msgs}</div>
    <div class="frn-chat-compose">
      <input type="text" id="frnChatInput" placeholder="Post to the league…" maxlength="280"
        onkeydown="if(event.key==='Enter'){ frnPostMessage(this.value); this.value=''; }">
      <button class="btn btn-gold" onclick="(function(){const i=document.getElementById('frnChatInput');frnPostMessage(i.value);i.value='';})()">Post</button>
    </div>`;
  // Auto-scroll to bottom + focus the input
  const list = document.querySelector(".frn-chat-list");
  if (list) list.scrollTop = list.scrollHeight;
  const inp = document.getElementById("frnChatInput");
  if (inp) inp.focus();
}

// ── Universal hover tooltips: players & teams ─────────────────────────────────
// Anywhere a player/team name is rendered, wrapping it with
// playerLink(p) or teamLink(team) gives it hover-card + click-to-open
// behavior via document-level event delegation. Doesn't bloat each
// render site with handlers.

function playerLink(p) {
  if (!p) return "";
  const escName = String(p.name || "").replace(/"/g, "&quot;");
  return `<span class="frn-pname" data-player-name="${escName}">${p.name}</span>`;
}
function playerLinkByName(name) {
  if (!name) return "";
  const escName = String(name).replace(/"/g, "&quot;");
  return `<span class="frn-pname" data-player-name="${escName}">${name}</span>`;
}
function teamLink(team, full) {
  if (!team) return "";
  const label = full ? `${team.city} ${team.name}` : team.name;
  return `<span class="frn-tname" data-team-id="${team.id}">${label}</span>`;
}

// Locate a player by name across all rosters (for tooltips/detail).
function _findPlayer(name) {
  for (const roster of Object.values(franchise?.rosters || {})) {
    const p = roster.find(rp => rp.name === name);
    if (p) return p;
  }
  return null;
}
function _findPlayerTeam(p) {
  if (!p) return null;
  for (const [tid, roster] of Object.entries(franchise?.rosters || {})) {
    if (roster.some(rp => rp === p || rp.name === p.name)) return getTeam(Number(tid));
  }
  return null;
}

// AI-generated portrait (same one the single-game tooltip uses).
// `size` is an output box edge in px. Falls back to the canvas-drawn
// anime mugshot when the PNG isn't on disk, then to a flat color when
// even that fails (so we never show a broken-image icon).
function _playerPortrait(p, size) {
  const sz = size || 96;
  const team = _findPlayerTeam(p);
  let src = "";
  try { src = portraitFileForPlayer(p); } catch {}
  const safe = src ? src.split("/").map(encodeURIComponent).join("/") : "";
  let fallback = "";
  // generateMugshotDataUrl looks up gameResult; if absent it still works
  // with a fallback color. Wrap in try/catch since this is non-critical.
  try { fallback = generateMugshotDataUrl(p); } catch {}
  const flatBg = team?.primary || "#222";
  const onErr = fallback
    ? `this.onerror=null;this.src='${fallback}';`
    : `this.onerror=null;this.style.background='${flatBg}';this.removeAttribute('src');`;
  if (!safe) {
    return `<div class="frn-portrait" style="width:${sz}px;height:${sz*9/8}px;background:${flatBg}"></div>`;
  }
  return `<img class="frn-portrait" src="portraits/${safe}"
    width="${sz}" height="${Math.round(sz * 9/8)}"
    alt="${(p.name||"").replace(/"/g,'&quot;')}"
    style="object-fit:cover;background:${flatBg}"
    onerror="${onErr}">`;
}

function frnPlayerTipShow(anchorEl, name) {
  const p = _findPlayer(name);
  if (!p) return;
  const team = _findPlayerTeam(p);
  const tip = _getHoverTip();
  const g = scoutGrade(p), gL = gradeLabel(g), gCls = gradeClass(g);
  const aav = p.contract?.aav || 0;
  const yrs = p.contract?.remaining || 0;
  // Build a compact "this season" stat line from seasonStats
  let seasonLine = "";
  {
    let stat = null;
    for (const ts of Object.values(franchise?.seasonStats || {})) {
      if (ts && ts[p.name]) { stat = ts[p.name]; break; }
    }
    if (stat && (+(stat.gp || 0)) >= 1) {
      const pos = p.position;
      const num = k => +(stat[k] || 0);
      const gp = num("gp") || 1;
      if (pos === "QB") {
        const ypg = (num("pass_yds") / gp).toFixed(1);
        seasonLine = `${ypg} YPG · ${num("pass_td")} TD`;
      } else if (pos === "RB") {
        const ypg = (num("rush_yds") / gp).toFixed(1);
        seasonLine = `${ypg} RY/G · ${num("rush_td")} TD`;
      } else if (pos === "WR" || pos === "TE") {
        const ypg = (num("rec_yds") / gp).toFixed(1);
        seasonLine = `${ypg} REC Y/G · ${num("rec_td")} TD`;
      } else if (pos === "DL" || pos === "LB" || pos === "CB" || pos === "S") {
        const tklpg = (num("tkl") / gp).toFixed(1);
        seasonLine = `${tklpg} TKL/G · ${num("sk")} SK`;
      } else if (pos === "K") {
        const made = num("fg_made"), att = num("fg_att");
        const pct = att ? (made / att * 100).toFixed(1) : "0.0";
        seasonLine = `${made}/${att} FG · ${pct}%`;
      }
    }
  }
  tip.innerHTML = `
    <div class="frn-ptip-head">
      ${_playerPortrait(p, 56)}
      <div style="flex:1;min-width:0">
        <div style="font-weight:900;font-size:.9rem">${p.name}</div>
        <div style="color:var(--gray);font-size:.62rem">
          ${p.position} · Age ${p.age||"?"} · ${team?.name||"?"}
        </div>
        <div style="color:var(--gray);font-size:.62rem">${_archetypeLabel(p) || "—"}</div>
      </div>
      <div style="text-align:right">
        <span class="tt-ovr tier-${gCls}" style="font-size:.85rem;padding:.15rem .5rem">${gL}</span>
      </div>
    </div>
    <div class="frn-ptip-meta">
      <div><span class="frn-meta-label">DRAFT</span> ${draftStr(p)}</div>
      <div><span class="frn-meta-label">$/YR</span> $${aav.toFixed(1)}M · ${yrs}yr</div>
      <div><span class="frn-meta-label">CAREER $</span> ${careerEarningsStr(p)}</div>
      ${p.injury?.weeksRemaining ? `<div style="color:#ff9090">🩹 ${p.injury.label} · ${p.injury.weeksRemaining}wk</div>` : ""}
      ${p.onTradeBlock ? `<div style="color:#e8a000">●BLOCK</div>` : ""}
      ${seasonLine ? `<div style="color:var(--gold-lt);font-size:.62rem">${seasonLine}</div>` : ""}
    </div>
    <div class="frn-tip-foot">Click for full career</div>
  `;
  _positionTip(tip, anchorEl);
}

function frnTeamTipShow2(anchorEl, teamId) {
  const team = getTeam(Number(teamId));
  if (!team) return;
  const tip = _getHoverTip();
  const rtg = frnTeamRating(team.id);
  const tier = franchise?.teamTiers?.[team.id] || "average";
  const tierLabel = (typeof TIER_LABEL !== "undefined" && TIER_LABEL[tier]) || tier;
  const scouted = franchise?.scoutingIntel?.[team.id]?.season === franchise?.season;
  // If scouted: include top 3 players + grades
  let scoutLines = "";
  if (scouted) {
    const top = (franchise.rosters[team.id] || [])
      .slice().sort((a,b) => scoutGrade(b) - scoutGrade(a)).slice(0, 3);
    scoutLines = top.map(p =>
      `<div class="frn-tip-bullet">${p.position} ${p.name} (${gradeLabel(scoutGrade(p))})</div>`
    ).join("");
  }
  // Record so far
  const s = franchise?.standings?.[team.id];
  const rec = s ? `${s.w}-${s.l}${s.t?`-${s.t}`:""}` : "—";
  tip.innerHTML = `
    <div class="frn-tip-head">
      <span style="font-size:1.4rem;color:${team.primary}">${teamAscii(team)}</span>
      <div>
        <div style="font-weight:900">${team.city} ${team.name}</div>
        <div style="color:var(--gray);font-size:.62rem">${team.conference} ${team.division}</div>
      </div>
    </div>
    <div class="frn-tip-tier tier-${tier}">${tierLabel}${scouted ? " · 🏟 SCOUTED" : ""}</div>
    <div class="frn-tip-ratings">
      OFF <b style="color:var(--gold)">${rtg.off}</b> ·
      DEF <b style="color:var(--gold)">${rtg.def}</b> ·
      Rec ${rec}
    </div>
    ${scoutLines || `<div class="frn-tip-bullet" style="color:var(--gray);font-style:italic">Run a scrimmage to scout this team.</div>`}
    <div class="frn-tip-foot">Click to scout this team</div>
  `;
  _positionTip(tip, anchorEl);
}

function _getHoverTip() {
  let tip = document.getElementById("frn-hover-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "frn-hover-tip";
    tip.className = "frn-team-tooltip frn-player-tip";
    document.body.appendChild(tip);
  }
  return tip;
}
function _positionTip(tip, anchor) {
  tip.style.display = "block";
  const rect = anchor.getBoundingClientRect();
  const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
  let left = rect.right + 8;
  if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 8;
  if (left < 8) left = 8;
  let top = rect.top;
  if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
  if (top < 8) top = 8;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}
function frnHoverTipHide() {
  const tip = document.getElementById("frn-hover-tip");
  if (tip) tip.style.display = "none";
}

// Click handlers
// Player click opens a modal overlay anchored at the dashboard — no
// page-swap, no phase mutation. Closing returns you to whatever
// screen you were already on.
function frnOpenPlayerCard(name) {
  const p = _findPlayer(name);
  if (!p) return;
  frnHoverTipHide();
  frnClosePlayerModal();
  const team = _findPlayerTeam(p);
  const overlay = document.createElement("div");
  overlay.className = "frn-pcard-overlay";
  overlay.id = "frn-pcard-overlay";
  const teamLine = team
    ? `<div class="frn-pcard-team-link">
         ${team.city} ${team.name} ·
         <a href="javascript:void(0)" style="color:var(--gold)"
            onclick="frnClosePlayerModal();frnOpenTeamCard(${team.id})">
           View team →
         </a>
       </div>`
    : "";
  // One-shot compare: this button opens the dedicated compare modal
  // pre-populated with this player on the left and a position-filtered
  // picker on the right. No hidden multi-step state.
  const compareTag = `<button class="frn-pcard-yrbtn" style="margin-right:.4rem" onclick="frnSelectForCompare('${name.replace(/'/g, "\\'")}')">⚖ Compare</button>`;
  overlay.innerHTML = `
    <div class="frn-pcard-overlay-inner">
      <div style="position:absolute;top:.3rem;right:2.2rem;z-index:3">${compareTag}</div>
      <button class="frn-pcard-close" onclick="frnClosePlayerModal()" title="Close">×</button>
      ${_buildPlayerDetailPanel(p)}
      ${teamLine}
    </div>`;
  overlay.addEventListener("click", e => {
    if (e.target === overlay) frnClosePlayerModal();
  });
  document.body.appendChild(overlay);
  // ESC closes
  if (!window.__frnPCardEscBound) {
    window.__frnPCardEscBound = true;
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") frnClosePlayerModal();
    });
  }
}
function frnClosePlayerModal() {
  const ov = document.getElementById("frn-pcard-overlay");
  if (ov) ov.remove();
}
function frnCloseCompareModal() {
  const ov = document.getElementById("frn-compare-overlay");
  if (ov) ov.remove();
}
// One-shot compare: clicking "⚖ Compare" on a player opens the modal
// IMMEDIATELY with player A on the left + an inline searchable picker
// for player B on the right. No hidden multi-step state, no navigating
// away to find the second player. Pick from the dropdown (filtered by
// position by default), the right side fills in with the detail panel.
function frnSelectForCompare(name) {
  frnOpenCompareModal(name, null);
}
function frnOpenCompareModal(nameA, nameB) {
  const pA = _findPlayer(nameA);
  if (!pA) return;
  frnCloseCompareModal();
  const overlay = document.createElement("div");
  overlay.className = "frn-pcard-overlay";
  overlay.id = "frn-compare-overlay";
  overlay.innerHTML = _bspnCompareInner(pA, nameB ? _findPlayer(nameB) : null);
  overlay.addEventListener("click", e => { if (e.target === overlay) frnCloseCompareModal(); });
  document.body.appendChild(overlay);
}

// Build the inner markup for the compare modal. Left side = player A
// (locked). Right side = either a player detail panel (when B is set)
// or a picker UI: a position-filter dropdown + a player list (search
// pre-filters by team and position so the user finds the right guy fast).
function _bspnCompareInner(pA, pB) {
  const myId = franchise?.chosenTeamId;
  // Collect every player league-wide for the picker.
  const allPlayers = [];
  for (const [tidStr, roster] of Object.entries(franchise?.rosters || {})) {
    for (const p of roster) allPlayers.push({ ...p, _teamId: Number(tidStr) });
  }
  // Default filter: same position as player A.
  const defaultFilter = pA.position || "ALL";
  const filtered = allPlayers
    .filter(p => p.name !== pA.name)
    .filter(p => defaultFilter === "ALL" || p.position === defaultFilter)
    .sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const POS_OPTIONS = ["ALL","QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const posSelect = POS_OPTIONS.map(p =>
    `<option value="${p}" ${p === defaultFilter ? "selected" : ""}>${p}</option>`
  ).join("");
  const playerOptions = filtered.slice(0, 200).map(p => {
    const team = getTeam(p._teamId);
    const isMine = p._teamId === myId;
    const ovrTag = isMine ? ` · ${p.overall||"?"} OVR` : ` · ${gradeLabel(scoutGrade(p))} grade`;
    const escName = (p.name || "").replace(/"/g, "&quot;");
    return `<option value="${escName}">${p.position} · ${p.name} · ${team?.name || "?"}${ovrTag}</option>`;
  }).join("");
  const rightPane = pB
    ? `<div style="padding:.5rem">
         <div style="margin-bottom:.4rem;display:flex;justify-content:space-between;align-items:center">
           <span style="color:var(--gray);font-size:.65rem;letter-spacing:.5px">COMPARING WITH</span>
           <button onclick="_bspnCompareClearB()" style="background:transparent;border:1px solid var(--border);color:var(--gray);font-family:inherit;cursor:pointer;font-size:.65rem;padding:.15rem .45rem">← Pick a different player</button>
         </div>
         ${_buildPlayerDetailPanel(pB)}
       </div>`
    : `<div style="padding:1rem;display:flex;flex-direction:column;gap:.55rem">
         <div style="color:var(--gold);font-size:.7rem;letter-spacing:.5px;font-weight:700;text-transform:uppercase">Pick a player to compare</div>
         <div style="color:var(--gray);font-size:.66rem">Filtered by ${defaultFilter} by default — switch position to widen the list.</div>
         <div style="display:flex;gap:.4rem;align-items:center">
           <span style="color:var(--gray);font-size:.65rem">Position:</span>
           <select id="bspn-compare-pos" onchange="_bspnCompareRefilter()" style="background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.25rem .35rem;font-family:inherit;font-size:.72rem">${posSelect}</select>
         </div>
         <select id="bspn-compare-player" size="14" onchange="_bspnCompareSelectB()" style="background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.35rem;font-family:inherit;font-size:.72rem">
           ${playerOptions || `<option disabled>No players at this position</option>`}
         </select>
         <div style="color:var(--gray);font-size:.6rem;font-style:italic">Tip: click a player's name anywhere in the app first to pre-select A, then choose B here.</div>
       </div>`;
  // Compact A panel: use the existing detail panel but keep some breathing room.
  return `
    <div class="frn-pcard-overlay-inner" style="max-width:1180px;width:96vw">
      <button class="frn-pcard-close" onclick="frnCloseCompareModal()">×</button>
      <div style="padding:.55rem 1rem;border-bottom:1px solid var(--border);font-weight:700;color:var(--gold)">
        ⚖ Player Comparison · <span style="color:var(--gray);font-weight:400;font-size:.7rem">${pA.position} ${pA.name} vs ${pB ? pB.name : "?"}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
        <div style="border-right:1px dashed var(--border);padding:.4rem">${_buildPlayerDetailPanel(pA)}</div>
        ${rightPane}
      </div>
    </div>`;
}
// Stash player A's name so the inline picker handlers can refer to it.
function _bspnCompareCurrentA() {
  const head = document.querySelector("#frn-compare-overlay .frn-pcard-overlay-inner > div:nth-child(2)");
  if (!head) return null;
  const m = head.textContent.match(/^\s*⚖ Player Comparison · \w+ (.+?) vs/);
  return m ? m[1].trim() : null;
}
function _bspnCompareRefilter() {
  // Re-render the modal preserving A but with a different position filter.
  const aName = _bspnCompareCurrentA();
  const select = document.getElementById("bspn-compare-pos");
  if (!aName || !select) return;
  const overlay = document.getElementById("frn-compare-overlay");
  const pA = _findPlayer(aName);
  if (!pA || !overlay) return;
  // Rebuild with the new position filter applied via a temp re-shape.
  // Easiest: just monkey-patch by replacing the player select options.
  const playerSelect = document.getElementById("bspn-compare-player");
  if (!playerSelect) return;
  const filter = select.value;
  const all = [];
  for (const [tidStr, roster] of Object.entries(franchise?.rosters || {})) {
    for (const p of roster) all.push({ ...p, _teamId: Number(tidStr) });
  }
  const myId = franchise?.chosenTeamId;
  const filtered = all
    .filter(p => p.name !== pA.name)
    .filter(p => filter === "ALL" || p.position === filter)
    .sort((a, b) => (b.overall || 0) - (a.overall || 0));
  playerSelect.innerHTML = filtered.slice(0, 200).map(p => {
    const team = getTeam(p._teamId);
    const isMine = p._teamId === myId;
    const ovrTag = isMine ? ` · ${p.overall||"?"} OVR` : ` · ${gradeLabel(scoutGrade(p))} grade`;
    const escName = (p.name || "").replace(/"/g, "&quot;");
    return `<option value="${escName}">${p.position} · ${p.name} · ${team?.name || "?"}${ovrTag}</option>`;
  }).join("") || `<option disabled>No players at this position</option>`;
}
function _bspnCompareSelectB() {
  const aName = _bspnCompareCurrentA();
  const select = document.getElementById("bspn-compare-player");
  if (!aName || !select) return;
  frnOpenCompareModal(aName, select.value);
}
function _bspnCompareClearB() {
  const aName = _bspnCompareCurrentA();
  if (aName) frnOpenCompareModal(aName, null);
}
// Team click still uses the existing scout page — but only when it
// makes sense (preseason/regular/playoffs). In offseason/draft/FA
// screens, fall back to a small alert noting scouting is paused.
function frnOpenTeamCard(teamId) {
  frnHoverTipHide();
  renderFrnPreseason("scout", Number(teamId));
}

// Global event delegation — players & teams hover/click handlers
function _frnInstallHoverDelegation() {
  if (window.__frnHoverInstalled) return;
  window.__frnHoverInstalled = true;
  document.addEventListener("mouseover", e => {
    const el = e.target.closest?.("[data-player-name],[data-team-id]");
    if (!el) return;
    if (el.dataset.playerName) frnPlayerTipShow(el, el.dataset.playerName);
    else if (el.dataset.teamId) frnTeamTipShow2(el, el.dataset.teamId);
  });
  document.addEventListener("mouseout", e => {
    const el = e.target.closest?.("[data-player-name],[data-team-id]");
    if (el) frnHoverTipHide();
  });
  // Safety: any click that ISN'T on a tracked name clears the tooltip
  // (covers cases where the source span gets re-rendered away before
  // mouseout fires).
  document.addEventListener("click", e => {
    if (!e.target.closest?.("[data-player-name],[data-team-id]")) frnHoverTipHide();
  });
  document.addEventListener("click", e => {
    const el = e.target.closest?.("[data-player-name],[data-team-id]");
    if (!el) return;
    // If this name is inside a parent that has its OWN click handler
    // (e.g., a schedule row that opens the past-game viewer), let
    // that handler win — don't hijack the click for the tooltip.
    if (el.parentElement?.closest("[onclick]")) return;
    if (el.dataset.playerName) {
      e.preventDefault(); e.stopPropagation();
      frnOpenPlayerCard(el.dataset.playerName);
    } else if (el.dataset.teamId) {
      e.preventDefault(); e.stopPropagation();
      frnOpenTeamCard(el.dataset.teamId);
    }
  });
}
_frnInstallHoverDelegation();

function _escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Scrimmages / joint practices ──────────────────────────────────────────────
// Between weeks, you can propose a scrimmage to another team. If they
// accept, a practice game sims (no W/L, no season stats) and BOTH
// teams gain scouting intel — the opposing roster's noisy grades
// sharpen and combine measurables flip from estimated to revealed for
// the rest of the season. Bumpy roads here: in the MegaETH version,
// the matchup commits via dual signatures and the sim runs from a VRF
// seed; intel is encrypted to the participating wallets.
function frnScrimmageInterest(otherId) {
  // AI willingness based on relative talent + their own week's bye
  const myId = franchise.chosenTeamId;
  if (otherId === myId) return 0;
  const myRtg = frnTeamRating(myId);
  const otherRtg = frnTeamRating(otherId);
  const gap = Math.abs((myRtg.off + myRtg.def) - (otherRtg.off + otherRtg.def));
  // Closer ratings = more interest. Mid-tier teams more curious than elites.
  let interest = 0.55;
  if (gap > 25) interest *= 0.5;
  else if (gap > 12) interest *= 0.8;
  // Already scrimmaged this season? Refuse a rematch.
  if ((franchise.scrimmagesDone || []).some(s =>
       s.season === franchise.season && s.teamId === otherId)) return 0;
  return Math.min(0.85, interest);
}

function frnRequestScrimmage(otherId) {
  otherId = Number(otherId);
  // Hard caps: one scrimmage per week (just like real teams only get
  // one joint practice between games), four total per season.
  const allDone = (franchise.scrimmagesDone || []);
  const thisWeek = allDone.filter(s => s.season === franchise.season && s.week === franchise.week);
  if (thisWeek.length >= 1) {
    alert("You've already scrimmaged this week. Only one joint practice per week.");
    renderFrnScrimmages();
    return;
  }
  const thisSeason = allDone.filter(s => s.season === franchise.season);
  if (thisSeason.length >= 4) {
    alert("You've used your 4 scrimmage slots for the season.");
    renderFrnScrimmages();
    return;
  }
  const interest = frnScrimmageInterest(otherId);
  if (Math.random() > interest) {
    alert("They turned down the scrimmage — schedule too tight.");
    renderFrnScrimmages();
    return;
  }
  // Simulate the practice game using the existing simulator path
  const myId = franchise.chosenTeamId;
  const r = frnSimOnce(myId, otherId);
  // No W/L, no season stats. Just intel + a one-line news.
  if (!franchise.scrimmagesDone) franchise.scrimmagesDone = [];
  franchise.scrimmagesDone.push({
    season: franchise.season, week: franchise.week, teamId: otherId,
    score: `${r.homeScore}-${r.awayScore}`,
  });
  if (!franchise.scoutingIntel) franchise.scoutingIntel = {};
  // Intel marker valid for the rest of this season
  franchise.scoutingIntel[otherId] = { season: franchise.season, gainedWeek: franchise.week };
  const team = getTeam(otherId);
  _pushNews({ type:"scrimmage",
    label: `🏟 Joint practice with ${team.name} — scouting intel gathered (final: ${r.homeScore}-${r.awayScore})` });
  saveFranchise();
  alert(`🏟 Scrimmage done — final ${r.homeScore}–${r.awayScore}. Their roster now shows revealed combine numbers + sharper grades for the rest of the season.`);
  renderFrnScrimmages();
}

function renderFrnScrimmages() {
  const myId = franchise.chosenTeamId;
  const done = (franchise.scrimmagesDone || []).filter(s => s.season === franchise.season);
  const doneThisWeek = done.filter(s => s.week === franchise.week);
  const doneSet = new Set(done.map(s => s.teamId));
  const SEASON_CAP = 4;
  const lockedThisWeek = doneThisWeek.length >= 1;
  const lockedThisSeason = done.length >= SEASON_CAP;

  const candidates = TEAMS.filter(t => t.id !== myId).map(t => {
    const interest = frnScrimmageInterest(t.id);
    const rtg = frnTeamRating(t.id);
    return { t, interest, rtg };
  }).sort((a,b) => b.interest - a.interest);

  const rows = candidates.map(({ t, interest, rtg }) => {
    const already = doneSet.has(t.id);
    const tag = already ? `<span style="color:var(--gray);font-size:.62rem">Already scrimmaged</span>`
      : interest >= 0.55 ? `<span style="color:var(--green-lt);font-size:.62rem">Very willing</span>`
      : interest >= 0.35 ? `<span style="color:#e8a000;font-size:.62rem">Open to it</span>`
      : interest > 0     ? `<span style="color:#c08080;font-size:.62rem">Unlikely</span>`
      :                    `<span style="color:var(--gray);font-size:.62rem">Refused</span>`;
    const disabled = already || lockedThisWeek || lockedThisSeason;
    return `<tr>
      <td style="font-weight:700">${teamLink(t, true)}</td>
      <td style="color:var(--gray);font-size:.66rem">OFF ${rtg.off} · DEF ${rtg.def}</td>
      <td>${tag}</td>
      <td>${already
        ? `<span style="color:var(--gold);font-size:.62rem">✓ Intel gained</span>`
        : `<button class="btn btn-gold" style="font-size:.62rem;padding:.2rem .55rem${disabled?";opacity:.4;cursor:not-allowed":""}"
            ${disabled?"disabled":""}
            onclick="frnRequestScrimmage(${t.id})">Request</button>`}</td>
    </tr>`;
  }).join("");

  const capBanner = lockedThisSeason
    ? `<div class="frn-pre-warn">⚠ You've used all ${SEASON_CAP} scrimmage slots for the season.</div>`
    : lockedThisWeek
    ? `<div class="frn-pre-warn" style="border-color:var(--gold-lt);color:var(--gold-lt);background:rgba(200,169,0,0.10)">
         ✓ You already scrimmaged this week with ${getTeam(doneThisWeek[0].teamId)?.name||"a team"}. Try again next week.
       </div>`
    : "";

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🏟 JOINT PRACTICES</div>
      <div style="color:var(--gray);font-size:.72rem">
        One per week · ${done.length}/${SEASON_CAP} done this season
      </div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-fa-summary">
      Joint practices count as exhibition games — no W/L, no stat lines, no risk of injury <i>and</i> you walk away with scouting intel (their grades sharpen for the rest of the season). One per week, up to ${SEASON_CAP} per season, one per opponent per season.
    </div>
    ${capBanner}
    <table class="frn-pre-roster-table" style="margin-top:.5rem">
      <thead><tr><th>Team</th><th>Rating</th><th>Willingness</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Past-game viewer ──────────────────────────────────────────────────────────
// ── Legacy / all-time records ─────────────────────────────────────────────────
// Top nav shared across every BSPN broadcast page (standings, leaders,
// legacy, wire). Each entry is a real navigable button. Pass `active`
// to highlight the current page (e.g. "STANDINGS", "STATS").
const _BSPN_NAV_LINKS = [
  { id: "SCORECENTER", action: "showFranchiseDashboard()" },
  { id: "STANDINGS",   action: "renderFrnStandings()" },
  { id: "STATS",       action: "renderFrnLeaders()" },
  { id: "LEGACY",      action: "renderFrnLegacy()" },
  { id: "WIRE",        action: "renderFrnNewsArchive()" },
];
function _bspnNavHtml(activeId) {
  return _BSPN_NAV_LINKS.map(({ id, action }) =>
    `<button class="bspnlive-nav-item ${id === activeId ? "active" : ""}"
      style="background:transparent;border:0;font-family:inherit;cursor:pointer;padding:0;${id===activeId?"color:var(--blwhite)":""}"
      onclick="${action}">[${id}]</button>`
  ).join(" ");
}

// ── BSPN STANDINGS PAGE ─────────────────────────────────────────────────────
// Broadcast-styled league standings — uses the BSPN scoped CSS already
// loaded for the box-score page. Grouped by conference + division with
// the user's team highlighted. Tiebreakers from standingsSorted (which
// runs NFL-style W-L% → div → conf → H2H → PD).
function renderFrnStandings() {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const myId = franchise.chosenTeamId;
  const seasonDone = franchise.week > FRANCHISE_WEEKS;
  const sorted = standingsSorted();
  const sortedById = new Map(sorted.map((s, i) => [s.id, { ...s, rank: i + 1 }]));
  // Group by conference + division
  const groupKey = t => `${t.conference}|${t.division}`;
  const divisions = {};
  for (const t of TEAMS) {
    const k = groupKey(t);
    (divisions[k] ||= { conference: t.conference, division: t.division, teams: [] }).teams.push(t);
  }
  // Sort each division by W-L% etc., re-using the global sort order
  for (const g of Object.values(divisions)) {
    g.teams.sort((a, b) => (sortedById.get(a.id)?.rank || 99) - (sortedById.get(b.id)?.rank || 99));
  }

  const renderDivisionTable = (g) => {
    const rows = g.teams.map((t, i) => {
      const s = sortedById.get(t.id) || {};
      const detailed = s.detailed || {};
      const recStr  = `${s.w||0}-${s.l||0}${s.t?`-${s.t}`:""}`;
      const divRec  = `${detailed.divW||0}-${detailed.divL||0}${detailed.divT?`-${detailed.divT}`:""}`;
      const confRec = `${detailed.confW||0}-${detailed.confL||0}${detailed.confT?`-${detailed.confT}`:""}`;
      const pd = detailed.pointDiff || 0;
      const pdColor = pd > 0 ? "var(--blgreen)" : pd < 0 ? "#ff7676" : "var(--blgray)";
      const isMine = t.id === myId;
      return `<tr ${isMine ? `style="background:rgba(245,197,66,0.08)"` : ""}>
        <td style="color:var(--blgold);font-weight:900;width:1.5rem">${i + 1}</td>
        <td>
          <span class="bspnlive-num" style="color:${t.primary};font-weight:700">${t.abbr || t.name.slice(0,3).toUpperCase()}</span>
          <span style="color:${isMine ? "var(--blgold)" : "var(--blwhite)"};font-weight:${isMine?900:600};margin-left:.45rem;font-family:'Bebas Neue','Anton',sans-serif;letter-spacing:1px;font-size:.95rem">${t.city} ${t.name}</span>
          ${isMine ? `<span style="color:var(--blgold);font-size:.55rem;letter-spacing:.5px;margin-left:.4rem">YOU</span>` : ""}
        </td>
        <td class="bspnlive-num" style="text-align:right;font-weight:700">${recStr}</td>
        <td class="bspnlive-num" style="text-align:right;color:var(--blgray)">${divRec}</td>
        <td class="bspnlive-num" style="text-align:right;color:var(--blgray)">${confRec}</td>
        <td class="bspnlive-num" style="text-align:right">${s.pf || 0}</td>
        <td class="bspnlive-num" style="text-align:right">${s.pa || 0}</td>
        <td class="bspnlive-num" style="text-align:right;color:${pdColor};font-weight:700">${pd > 0 ? "+" : ""}${pd}</td>
      </tr>`;
    }).join("");
    return `<section class="bspn-panel" style="padding:.6rem .8rem">
      <div class="bspn-panel-title">${g.conference} ${g.division.toUpperCase()}</div>
      <table class="bspnlive-mini-table" style="font-size:.7rem;width:100%">
        <thead>
          <tr>
            <th></th>
            <th style="text-align:left">TEAM</th>
            <th style="text-align:right">W-L</th>
            <th style="text-align:right">DIV</th>
            <th style="text-align:right">CONF</th>
            <th style="text-align:right">PF</th>
            <th style="text-align:right">PA</th>
            <th style="text-align:right">DIFF</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  };

  const renderConferenceOutlook = (conf) => {
    const teams = sorted.filter(s => s.team?.conference === conf);
    const rows = teams.map((s, i) => {
      const isMine = s.id === myId;
      const inPlayoffs = i < (PLAYOFF_TEAMS / 2);
      const recStr = `${s.w||0}-${s.l||0}${s.t?`-${s.t}`:""}`;
      const seedTag = inPlayoffs
        ? `<span style="color:var(--blgold);font-weight:900;font-size:.85rem;font-family:'Bebas Neue',sans-serif">#${i+1}</span>`
        : `<span style="color:var(--blgray);font-weight:600">${i+1}</span>`;
      return `<tr ${isMine ? `style="background:rgba(245,197,66,0.08)"` : ""}>
        <td style="width:2.2rem;text-align:center">${seedTag}</td>
        <td>
          <span class="bspnlive-num" style="color:${s.team.primary};font-weight:700">${s.team.abbr || s.team.name.slice(0,3).toUpperCase()}</span>
          <span style="margin-left:.4rem;color:${isMine?"var(--blgold)":"var(--blwhite)"};font-family:'Bebas Neue','Anton',sans-serif;letter-spacing:1px">${s.team.name}</span>
        </td>
        <td class="bspnlive-num" style="text-align:right;font-weight:700">${recStr}</td>
      </tr>`;
    }).join("");
    return `<section class="bspn-panel" style="padding:.6rem .8rem">
      <div class="bspn-panel-title" style="color:#ff5a5a">${conf} PLAYOFF PICTURE</div>
      <table class="bspnlive-mini-table" style="font-size:.7rem;width:100%">
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:.4rem;padding-top:.35rem;border-top:1px dashed var(--blborder);font-size:.55rem;color:var(--blgray);letter-spacing:1px">
        TOP ${PLAYOFF_TEAMS/2} IN EACH CONFERENCE → PLAYOFFS
      </div>
    </section>`;
  };

  const sortedConfDivs = Object.values(divisions).sort((a, b) =>
    a.conference.localeCompare(b.conference) || a.division.localeCompare(b.division));
  const afcDivs = sortedConfDivs.filter(g => g.conference === "AFC");
  const nfcDivs = sortedConfDivs.filter(g => g.conference === "NFC");

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">LEAGUE STANDINGS · SEASON ${franchise.season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("STANDINGS")}</nav>
      </header>
      <div style="padding:.6rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:1rem;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        <span style="color:var(--blgray);font-size:.7rem;letter-spacing:.5px">
          Week ${Math.min(franchise.week, FRANCHISE_WEEKS)} of ${FRANCHISE_WEEKS}${seasonDone ? " · REGULAR SEASON COMPLETE" : ""}
        </span>
      </div>
      <div style="padding:1rem 1.4rem">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-bottom:.7rem">
          ${renderConferenceOutlook("AFC")}
          ${renderConferenceOutlook("NFC")}
        </div>
        <div style="font-family:'Bebas Neue','Anton',sans-serif;color:var(--blwhite);font-size:1.4rem;letter-spacing:2px;margin:1rem 0 .35rem 0">AFC DIVISIONS</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">
          ${afcDivs.map(renderDivisionTable).join("")}
        </div>
        <div style="font-family:'Bebas Neue','Anton',sans-serif;color:var(--blwhite);font-size:1.4rem;letter-spacing:2px;margin:1rem 0 .35rem 0">NFC DIVISIONS</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">
          ${nfcDivs.map(renderDivisionTable).join("")}
        </div>
      </div>
    </div>`;
}

// ── BSPN LEAGUE LEADERS PAGE ───────────────────────────────────────────────
// Top-10 leaders league-wide for the current season in: passing yards,
// Aggregate a player's season stats across all team buckets — handles traded
// players whose games are split across two team entries in franchise.seasonStats.
function _playerSeasonStatsAgg(name) {
  const agg = {};
  for (const players of Object.values(franchise.seasonStats || {})) {
    const entry = players[name];
    if (!entry) continue;
    for (const [k, v] of Object.entries(entry)) {
      if (typeof v === "number") agg[k] = (agg[k] || 0) + v;
      else if (!agg[k]) agg[k] = v;
    }
  }
  return Object.keys(agg).length ? agg : null;
}

// passing TDs, rushing yards, rushing TDs, receiving yards, receiving TDs,
// sacks, tackles, INTs, FG made. Built from franchise.seasonStats which
// already aggregates per-player numeric totals across played games.
function renderFrnLeaders(tab) {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const myId = franchise.chosenTeamId;
  // Flatten every player + team into a single list with team context,
  // aggregating across buckets so traded players show full-season totals.
  const seen = new Set();
  const all = [];
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const team = getTeam(tid);
    if (!team) continue;
    for (const [name, p] of Object.entries(players || {})) {
      if (seen.has(name)) continue; // already added via aggregation
      seen.add(name);
      const agg = _playerSeasonStatsAgg(name);
      // Find current team for display (where the player is on the live roster)
      let currentTeam = team;
      for (const t of TEAMS) {
        if ((franchise.rosters[t.id] || []).some(r => r.name === name)) { currentTeam = getTeam(t.id) || team; break; }
      }
      all.push({ ...agg, _teamId: currentTeam.id, _team: currentTeam });
    }
  }
  const cats = [
    { id: "passing",   label: "PASSING YARDS",  key: "pass_yds",  scope: "QB",
      extra: r => `${r.pass_td||0} TD · ${r.pass_int||0} INT` },
    { id: "passingTd", label: "PASSING TDs",    key: "pass_td",   scope: "QB",
      extra: r => `${r.pass_yds||0} YDS` },
    { id: "rushing",   label: "RUSHING YARDS",  key: "rush_yds",  scope: "RB",
      extra: r => `${r.rush_att||0} CAR · ${r.rush_td||0} TD` },
    { id: "rushingTd", label: "RUSHING TDs",    key: "rush_td",   scope: "RB",
      extra: r => `${r.rush_yds||0} YDS` },
    { id: "receiving", label: "RECEIVING YARDS",key: "rec_yds",   scope: ["WR","TE"],
      extra: r => `${r.rec||0} REC · ${r.rec_td||0} TD` },
    { id: "receivingTd", label: "RECEIVING TDs",key: "rec_td",    scope: ["WR","TE"],
      extra: r => `${r.rec_yds||0} YDS` },
    { id: "sacks",     label: "SACKS",          key: "sk",        scope: ["DL","LB","CB","S"],
      extra: r => `${r.tkl||0} TKL` },
    { id: "tackles",   label: "TACKLES",        key: "tkl",       scope: ["LB","S","CB","DL"],
      extra: r => `${r.sk||0} SK · ${r.int_made||0} INT` },
    { id: "ints",      label: "INTERCEPTIONS",  key: "int_made",  scope: ["CB","S","LB"],
      extra: r => `${r.pd||0} PD · ${r.tkl||0} TKL` },
    { id: "fg",        label: "FIELD GOALS",    key: "fg_made",   scope: "K",
      extra: r => `${r.fg_att||0} ATT · LNG ${r.fg_long||0}` },
    { id: "pancakes",  label: "PANCAKE BLOCKS", key: "pancakes",  scope: ["OL","LT","LG","C","RG","RT"],
      extra: r => `${r.sacks_allowed||0} SA` },
    { id: "sacksAllowed", label: "SACKS ALLOWED (OL)", key: "sacks_allowed", scope: ["OL","LT","LG","C","RG","RT"],
      extra: r => `${r.pancakes||0} pancakes`, sortAsc: true },
  ];
  const activeTab = tab && cats.find(c => c.id === tab) ? tab : cats[0].id;
  const cat = cats.find(c => c.id === activeTab) || cats[0];
  const scopeMatches = pos => Array.isArray(cat.scope) ? cat.scope.includes(pos) : cat.scope === pos;
  const filtered = all.filter(r => scopeMatches(r.pos) && (r[cat.key] || 0) > 0);
  filtered.sort((a, b) => cat.sortAsc
    ? (a[cat.key] || 0) - (b[cat.key] || 0)
    : (b[cat.key] || 0) - (a[cat.key] || 0));
  const top10 = filtered.slice(0, 10);

  const tabBar = cats.map(c =>
    `<button class="bspnlive-nav-item ${c.id === activeTab ? "active" : ""}"
       style="background:transparent;border:0;font-family:inherit;cursor:pointer;padding:0;${c.id===activeTab?"color:var(--blwhite)":""}"
       onclick="renderFrnLeaders('${c.id}')">[${c.label}]</button>`
  ).join(" ");

  const rows = top10.length ? top10.map((r, i) => {
    const isMine = r._teamId === myId;
    return `<tr ${isMine ? `style="background:rgba(245,197,66,0.08)"` : ""}>
      <td style="color:var(--blgold);font-weight:900;width:2rem;text-align:center;font-family:'Bebas Neue','Anton',sans-serif;font-size:1.1rem">${i + 1}</td>
      <td>
        <span style="font-family:'Bebas Neue','Anton',sans-serif;letter-spacing:1px;font-size:1rem;color:${isMine?"var(--blgold)":"var(--blwhite)"}">${playerLinkByName(r.name)}</span>
        <span style="color:${r._team.primary};font-weight:700;margin-left:.45rem;font-size:.7rem">${r._team.abbr || r._team.name.slice(0,3).toUpperCase()}</span>
        <span style="color:var(--blgray);font-size:.6rem;margin-left:.4rem">${r.pos}</span>
      </td>
      <td style="text-align:right;font-family:'Anton','Teko','Impact',sans-serif;font-size:1.5rem;line-height:1;font-weight:900;color:var(--blwhite)">${r[cat.key] || 0}</td>
      <td style="text-align:right;color:var(--blgray);font-size:.65rem;letter-spacing:.4px;padding-left:.7rem">${cat.extra(r)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="4" style="color:var(--blgray);font-style:italic;text-align:center;padding:1.5rem">No qualifying players yet — sim more games.</td></tr>`;

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">LEAGUE LEADERS · SEASON ${franchise.season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("STATS")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        ${tabBar}
      </div>
      <div style="padding:.5rem 1.4rem;border-bottom:1px solid var(--blborder);color:var(--blgray);font-size:.7rem;letter-spacing:.5px">
        Week ${Math.min(franchise.week, FRANCHISE_WEEKS)} of ${FRANCHISE_WEEKS} · Top 10 in ${cat.label.toLowerCase()}
      </div>
      <div style="padding:1rem 1.4rem">
        <section class="bspn-panel" style="padding:.7rem 1rem">
          <div class="bspn-panel-title" style="color:var(--blgold);font-size:.85rem;letter-spacing:2px">${cat.label}</div>
          <table style="width:100%;border-collapse:collapse">
            <tbody>${rows}</tbody>
          </table>
        </section>
      </div>
    </div>`;
}

function renderFrnLegacy(tab) {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  tab = tab || "champions";
  const tabs = [
    { id:"champions",   label:"🏆 CHAMPIONS" },
    { id:"hof",         label:"🏛 HALL OF FAME" },
    { id:"career",      label:"📚 CAREER LEADERS" },
    { id:"season",      label:"📊 SINGLE-SEASON" },
    { id:"records",     label:"📖 RECORD BOOK" },
    { id:"awards",      label:"⭐ AWARDS HISTORY" },
  ];
  const tabHtml = tabs.map(t =>
    `<button class="frn-ana-tab ${t.id===tab?"active":""}" onclick="renderFrnLegacy('${t.id}')">${t.label}</button>`
  ).join("");

  let body = "";
  if (tab === "champions") body = _legacyChampions();
  else if (tab === "hof") body = _legacyHOF();
  else if (tab === "career") body = _legacyCareer();
  else if (tab === "season") body = _legacySeason();
  else if (tab === "records") body = _legacyRecordBook();
  else if (tab === "awards") body = _legacyAwards();

  // BSPN broadcast chrome for the legacy/awards page — typography +
  // nav match the standings + leaders pages so the "watch the
  // league" surface feels cohesive across screens.
  const navHtml = tabs.map(t => `
    <button class="bspnlive-nav-item ${t.id===tab?"active":""}"
      style="background:transparent;border:0;font-family:inherit;cursor:pointer;padding:0;${t.id===tab?"color:var(--blwhite)":""}"
      onclick="renderFrnLegacy('${t.id}')">[${t.label}]</button>
  `).join(" ");

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">LEGACY · ${franchise.season} SEASON${franchise.season===1?"":"S"}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("LEGACY")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        ${navHtml}
      </div>
      <div style="padding:1rem 1.4rem">
        <section class="bspn-panel" style="padding:.8rem 1rem;background:var(--blbg2)">
          ${body}
        </section>
      </div>
    </div>`;
}

function _legacyChampions() {
  const history = (franchise.history || []).slice().reverse();
  if (!history.length) return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">No champion crowned yet — finish a season to start the record book.</div>`;
  return `<table class="frn-ana-table"><thead>
    <tr><th>Season</th><th>Champion</th><th>League MVP</th><th>SB MVP</th><th>Coach</th></tr>
  </thead><tbody>
    ${history.map(h => {
      const champTeam = getTeam(h.champion);
      // Find coach who was with the team that season (best-effort: current coach if still there)
      const hc = franchise.coaches?.[h.champion]?.hc;
      return `<tr>
        <td style="color:var(--gold);font-weight:700">S${h.season}</td>
        <td style="font-weight:700">${champTeam ? teamLink(champTeam) : "?"}</td>
        <td>${h.leagueMVP ? playerLinkByName(h.leagueMVP.name) + ` <span style="color:var(--gray);font-size:.62rem">(${h.leagueMVP.pos})</span>` : "—"}</td>
        <td>${h.superBowlMVP ? playerLinkByName(h.superBowlMVP.name) : "—"}</td>
        <td style="color:var(--gray);font-size:.66rem">${hc?.name || "—"}</td>
      </tr>`;
    }).join("")}
  </tbody></table>`;
}

function _legacyHOF() {
  const list = (franchise.hallOfFame || []).slice().reverse();
  if (!list.length) return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">The Hall of Fame opens with the first elite retirement.</div>`;
  return list.map(h => {
    const cs = h.careerStats || {};
    const yrs = h.careerYears ?? h.careerHistory?.length ?? 0;
    // Position-aware stat highlights
    let highlights = "";
    if (h.pos === "QB") highlights = `${cs.pass_yds||0} yds · ${cs.pass_td||0} TD · ${cs.pass_int||0} INT`;
    else if (h.pos === "RB") highlights = `${cs.rush_yds||0} rush yds · ${cs.rush_td||0} TD`;
    else if (h.pos === "WR" || h.pos === "TE") highlights = `${cs.rec||0} rec · ${cs.rec_yds||0} yds · ${cs.rec_td||0} TD`;
    else if (h.pos === "DL" || h.pos === "LB") highlights = `${cs.tkl||0} tkl · ${cs.sk||0} sk · ${cs.ff||0} FF`;
    else if (h.pos === "CB" || h.pos === "S") highlights = `${cs.int_made||0} INT · ${cs.pd||0} PD · ${cs.tkl||0} tkl`;
    else if (h.pos === "K") highlights = `${cs.fg_made||0} FG (long ${cs.fg_long||0}) · ${cs.xp_made||0} XP`;
    else if (["OL","LT","LG","C","RG","RT"].includes(h.pos)) highlights = `${cs.pancakes||0} pancakes · ${cs.sacks_allowed||0} sacks allowed`;
    return `<div class="frn-hof-row">
      <div style="font-size:1.6rem;color:var(--gold)">🏛</div>
      <div style="flex:1">
        <div style="font-weight:900;font-size:.95rem">${h.name}
          <span style="color:var(--gray);font-size:.62rem;font-weight:400">(${h.pos})</span>
        </div>
        <div style="color:var(--gray);font-size:.66rem">${h.teamName} · ${yrs} season${yrs===1?"":"s"} · enshrined S${h.season} · ${(h.careerEarnings||0).toFixed(1)}M career</div>
        <div style="color:var(--gold-lt);font-size:.66rem;margin-top:.1rem">${highlights}</div>
      </div>
    </div>`;
  }).join("");
}

function _allKnownPlayers() {
  // Active rosters + HOF (HOF entries hold their final stats)
  const out = [];
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) out.push({
      name: p.name, pos: p.position, careerStats: p.careerStats || {}, isHOF: false, _live: p,
    });
  }
  for (const h of (franchise.hallOfFame || [])) {
    // Skip dupes (shouldn't happen — retired players are removed from roster)
    if (out.some(x => x.name === h.name)) continue;
    out.push({ name: h.name, pos: h.pos, careerStats: h.careerStats || {}, isHOF: true });
  }
  return out;
}

function _legacyCareer() {
  const all = _allKnownPlayers();
  if (!all.length || all.every(p => Object.keys(p.careerStats).length === 0)) {
    return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">No career stats accumulated yet. Play through your first season.</div>`;
  }
  const cats = [
    { label:"PASSING YARDS",    key:"pass_yds",  posFilter:p => p.pos === "QB" },
    { label:"PASSING TDs",      key:"pass_td",   posFilter:p => p.pos === "QB" },
    { label:"RUSHING YARDS",    key:"rush_yds",  posFilter:p => p.pos === "RB" || p.pos === "QB" },
    { label:"RUSHING TDs",      key:"rush_td",   posFilter:p => p.pos === "RB" || p.pos === "QB" },
    { label:"RECEIVING YARDS",  key:"rec_yds",   posFilter:p => p.pos === "WR" || p.pos === "TE" || p.pos === "RB" },
    { label:"RECEIVING TDs",    key:"rec_td",    posFilter:p => p.pos === "WR" || p.pos === "TE" || p.pos === "RB" },
    { label:"SACKS",            key:"sk",        posFilter:p => p.pos === "DL" || p.pos === "LB" },
    { label:"TACKLES",          key:"tkl",       posFilter:p => ["DL","LB","CB","S"].includes(p.pos) },
    { label:"INTERCEPTIONS",    key:"int_made",  posFilter:p => ["CB","S","LB"].includes(p.pos) },
    { label:"FIELD GOALS",      key:"fg_made",   posFilter:p => p.pos === "K" },
    { label:"PANCAKE BLOCKS",   key:"pancakes",  posFilter:p => ["OL","LT","LG","C","RG","RT"].includes(p.pos) },
  ];
  return cats.map(c => {
    const list = all
      .filter(p => c.posFilter(p) && (p.careerStats[c.key] || 0) > 0)
      .sort((a,b) => (b.careerStats[c.key]||0) - (a.careerStats[c.key]||0))
      .slice(0, 10);
    if (!list.length) return "";
    return `<div class="frn-pg-card" style="margin-bottom:.5rem">
      <div class="frn-pg-card-title">${c.label}</div>
      <table class="frn-ana-table">
        <thead><tr><th>#</th><th>Player</th><th>${c.label}</th></tr></thead>
        <tbody>${list.map((p,i) => `<tr>
          <td style="color:var(--gold)">${i+1}</td>
          <td>${playerLinkByName(p.name)} ${p.isHOF?'<span style="color:var(--gold);font-size:.55rem">🏛</span>':''} <span style="color:var(--gray);font-size:.6rem">(${p.pos})</span></td>
          <td style="color:var(--gold-lt);font-weight:700">${p.careerStats[c.key] || 0}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
  }).join("");
}

function _legacySeason() {
  // Collect every (player, season) row from active careerHistory + HOF snapshots
  const rows = [];
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) {
      for (const r of (p.careerHistory || [])) {
        rows.push({ name: p.name, pos: p.position, ...r });
      }
    }
  }
  for (const h of (franchise.hallOfFame || [])) {
    for (const r of (h.careerHistory || [])) {
      rows.push({ name: h.name, pos: h.pos, ...r });
    }
  }
  if (!rows.length) {
    return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">Single-season records appear once you've completed a season.</div>`;
  }
  const cats = [
    { label:"PASSING YARDS (SEASON)",   key:"pass_yds" },
    { label:"PASSING TDs (SEASON)",     key:"pass_td" },
    { label:"RUSHING YARDS (SEASON)",   key:"rush_yds" },
    { label:"RECEIVING YARDS (SEASON)", key:"rec_yds" },
    { label:"SACKS (SEASON)",           key:"sk" },
    { label:"INTERCEPTIONS (SEASON)",   key:"int_made" },
    { label:"PANCAKE BLOCKS (SEASON)",  key:"pancakes" },
  ];
  return cats.map(c => {
    const list = rows.filter(r => (r[c.key]||0) > 0)
      .sort((a,b) => (b[c.key]||0) - (a[c.key]||0))
      .slice(0, 10);
    if (!list.length) return "";
    return `<div class="frn-pg-card" style="margin-bottom:.5rem">
      <div class="frn-pg-card-title">${c.label}</div>
      <table class="frn-ana-table">
        <thead><tr><th>#</th><th>Player</th><th>Season</th><th>Team</th><th>${c.label.split(" (")[0]}</th></tr></thead>
        <tbody>${list.map((r,i) => `<tr>
          <td style="color:var(--gold)">${i+1}</td>
          <td>${playerLinkByName(r.name)} <span style="color:var(--gray);font-size:.6rem">(${r.pos})</span></td>
          <td>S${r.season}</td>
          <td style="color:var(--gray);font-size:.66rem">${r.teamName || "—"}</td>
          <td style="color:var(--gold-lt);font-weight:700">${r[c.key] || 0}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
  }).join("");
}

function _legacyRecordBook() {
  const rec = franchise.records || {};
  const sg = rec.singleGame || {};
  const ss = rec.singleSeason || {};
  if (!Object.keys(sg).length && !Object.keys(ss).length) {
    return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">The record book is empty. Play through a season to start the books.</div>`;
  }

  const renderRow = (def, entry, isSingleGame) => {
    if (!entry) return "";
    const t = entry.teamId ? getTeam(entry.teamId) : null;
    const opp = isSingleGame && entry.oppId ? getTeam(entry.oppId) : null;
    return `<tr>
      <td style="color:var(--gold);font-weight:700">${def.label}</td>
      <td style="font-family:'Anton','Teko','Impact',sans-serif;font-size:1.3rem;color:var(--gold-lt);font-weight:900">${entry.value}</td>
      <td>${playerLinkByName(entry.playerName)} <span style="color:var(--gray);font-size:.6rem">(${entry.pos})</span></td>
      <td style="color:var(--gray);font-size:.66rem">${t ? `${t.city} ${t.name}` : "—"}</td>
      <td style="color:var(--gray);font-size:.66rem">S${entry.season}${isSingleGame ? ` · W${entry.week}` : ""}${opp ? ` · vs ${opp.name}` : ""}${entry.isPlayoff ? " · (PO)" : ""}</td>
    </tr>`;
  };

  const buildTable = (title, source, isSingleGame) => {
    const rows = _RECORD_CATS
      .filter(def => isSingleGame ? true : def.key !== "fg_long")
      .map(def => renderRow(def, source[def.key], isSingleGame))
      .filter(Boolean)
      .join("");
    if (!rows) return "";
    return `<div class="frn-pg-card" style="margin-bottom:.6rem">
      <div class="frn-pg-card-title">${title}</div>
      <table class="frn-ana-table">
        <thead><tr><th>Record</th><th>Value</th><th>Holder</th><th>Team</th><th>When</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  };

  return `${buildTable("📖 SINGLE-GAME RECORDS", sg, true)}
          ${buildTable("📅 SINGLE-SEASON RECORDS", ss, false)}`;
}

function _legacyAwards() {
  const history = (franchise.history || []).slice().reverse();
  if (!history.length) return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">No awards handed out yet.</div>`;
  return `<table class="frn-ana-table"><thead>
    <tr><th>Season</th><th>League MVP</th><th>SB MVP</th><th>Champ-Team MVP</th></tr>
  </thead><tbody>
    ${history.map(h => `<tr>
      <td style="color:var(--gold);font-weight:700">S${h.season}</td>
      <td>${h.leagueMVP ? `${playerLinkByName(h.leagueMVP.name)} <span style="color:var(--gray);font-size:.62rem">(${h.leagueMVP.pos}, ${h.leagueMVP.teamName})</span>` : "—"}</td>
      <td>${h.superBowlMVP ? `${playerLinkByName(h.superBowlMVP.name)} <span style="color:var(--gray);font-size:.62rem">(${h.superBowlMVP.pos})</span>` : "—"}</td>
      <td>${h.champTeamMVP ? `${playerLinkByName(h.champTeamMVP.name)} <span style="color:var(--gray);font-size:.62rem">(${h.champTeamMVP.pos})</span>` : "—"}</td>
    </tr>`).join("")}
  </tbody></table>`;
}

// ── Coaches view + hire/fire ──────────────────────────────────────────────────
function renderFrnCoaches() {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  if (!franchise.coaches) _initCoachingStaff();
  if (!franchise._coachingFAs) franchise._coachingFAs = [
    _rollCoach(), _rollCoach(), _rollCoach(), _rollCoach()
  ];
  const myId = franchise.chosenTeamId;
  const myHc = franchise.coaches[myId]?.hc;
  const myTeam = getTeam(myId);

  const traitDesc = key => COACH_TRAITS.find(t => t.key === key)?.desc || "";

  const leagueRows = TEAMS.map(t => {
    const hc = franchise.coaches[t.id]?.hc;
    const isMe = t.id === myId;
    return `<tr style="${isMe?"background:rgba(200,169,0,0.10)":""}">
      <td style="font-weight:${isMe?700:400}">${teamLink(t)}</td>
      <td>${hc?.name || "—"}</td>
      <td style="color:var(--gold);font-size:.66rem">${hc?.specialtyTrait || hc?.trait || "—"}</td>
      <td style="color:var(--gray)">${hc?.age || "?"}</td>
      <td style="color:var(--gray);font-size:.65rem">${hc?.yearsWithTeam ?? 0}yr</td>
      <td>${hc?.record?.w || 0}-${hc?.record?.l || 0}${hc?.record?.championships ? " · 🏆"+hc.record.championships : ""}</td>
    </tr>`;
  }).join("");

  const fasHtml = franchise._coachingFAs.map((c, i) => `
    <div class="frn-coach-fa">
      <div style="flex:1">
        <div style="font-weight:700">${c.name}</div>
        <div style="color:var(--gray);font-size:.66rem">Age ${c.age} · <span style="color:var(--gold)">${c.trait}</span></div>
        <div style="color:var(--gray);font-size:.6rem">${traitDesc(c.trait)}</div>
      </div>
      <button class="btn btn-gold" style="font-size:.65rem;padding:.25rem .65rem"
        onclick="frnHireCoach(${i})">Hire</button>
    </div>
  `).join("") || `<div style="color:var(--gray);font-size:.7rem;font-style:italic;padding:.4rem">No coaches on the market right now.</div>`;

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🎩 COACHING STAFF</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-pg-row">
      <div class="frn-pg-card" style="flex:1">
        <div class="frn-pg-card-title">YOUR HEAD COACH · ${myTeam.name}</div>
        ${myHc ? `
          <div style="padding:.45rem 0">
            <div style="font-size:1rem;font-weight:900">${myHc.name}</div>
            <div style="color:var(--gold);font-size:.78rem;margin-top:.15rem">
              ${myHc.specialtyTrait || myHc.trait || "—"}
              ${myHc.cultureTrait ? `<span style="color:var(--gray);margin-left:.4rem">· ${myHc.cultureTrait}</span>` : ""}
            </div>
            ${myHc.rating != null ? `<div style="color:var(--gray);font-size:.62rem">Rating: <b>${myHc.rating}</b></div>` : ""}
            <div style="color:var(--gray);font-size:.66rem;margin-top:.3rem">
              Age ${myHc.age} · ${myHc.yearsWithTeam}yr with team · Record ${myHc.record.w}-${myHc.record.l}
              ${myHc.record.championships ? " · 🏆 "+myHc.record.championships : ""}
            </div>
          </div>
          <button class="btn btn-outline" onclick="frnFireCoach()" style="color:var(--red);font-size:.65rem;padding:.25rem .65rem">
            ✗ Fire coach (forfeit experience)
          </button>
          <button class="btn btn-outline" onclick="renderFrnCoachingStaff()" style="font-size:.65rem;padding:.25rem .65rem;margin-top:.3rem">
            View Full Staff
          </button>` : `<div style="color:var(--gray);font-style:italic">No head coach. Hire from free agents below.</div>`}
      </div>
      <div class="frn-pg-card" style="flex:1.2">
        <div class="frn-pg-card-title">FREE AGENT COACHES</div>
        ${fasHtml}
      </div>
    </div>
    <div class="frn-pg-card">
      <div class="frn-pg-card-title">LEAGUE HEAD COACHES</div>
      <table class="frn-pg-totals">
        <thead><tr><th>Team</th><th>Coach</th><th>Trait</th><th>Age</th><th>Tenure</th><th>Record</th></tr></thead>
        <tbody>${leagueRows}</tbody>
      </table>
    </div>`;
}

function frnHireCoach(idx) {
  const pool = franchise._coachingFAs || [];
  const hire = pool[idx];
  if (!hire) return;
  if (!confirm(`Hire ${hire.name} (${hire.trait})?`)) return;
  const myId = franchise.chosenTeamId;
  const oldHc = franchise.coaches[myId]?.hc;
  if (oldHc) pool.push(oldHc); // released coach lands back on the FA market
  hire.yearsWithTeam = 0;
  franchise.coaches[myId] = { hc: hire };
  pool.splice(idx, 1);
  // Refill the pool with a fresh roll
  while (pool.length < 4) pool.push(_rollCoach());
  saveFranchise();
  renderFrnCoaches();
}

function frnFireCoach() {
  const myId = franchise.chosenTeamId;
  const hc = franchise.coaches[myId]?.hc;
  if (!hc) return;
  if (!confirm(`Fire ${hc.name}? They'll go back to the FA pool.`)) return;
  if (!franchise._coachingFAs) franchise._coachingFAs = [];
  franchise._coachingFAs.push(hc);
  franchise.coaches[myId] = { hc: null };
  saveFranchise();
  renderFrnCoaches();
}

// ── Alumni view — recent former players of the user's team ──────────────────
function renderFrnAlumni(yearsBackArg) {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  // Persist selection so re-renders (e.g. after profile close) keep the range.
  if (yearsBackArg !== undefined) franchise._alumniYearsBack = yearsBackArg;
  const yearsBack = franchise._alumniYearsBack ?? 3;
  const alumni = _computeAlumni(myId, yearsBack);
  const grouped = { team: [], hof: [], retired: [], unsigned: [] };
  for (const a of alumni) (grouped[a.location] || (grouped[a.location] = [])).push(a);
  const totalSnapshots = (franchise.rosterSnapshots || []).length;
  // Range options — only show options that have snapshots backing them.
  const rangeOptions = [
    { label: "Last 3", val: 3 },
    { label: "Last 5", val: 5 },
    { label: "Last 10", val: 10 },
    { label: "All-time", val: "all" },
  ];
  const rangeChips = rangeOptions.map(r => {
    const active = (yearsBack === r.val) ? "active" : "";
    // Disable options that exceed current snapshot depth (cosmetic only;
    // _computeAlumni handles the case gracefully)
    const disabled = (r.val !== "all" && r.val > totalSnapshots) ? "disabled" : "";
    return `<button class="bspnlive-nav-item ${active}"
      style="background:transparent;border:1px solid ${active?'var(--blgold)':'var(--blborder)'};border-radius:3px;font-family:inherit;cursor:${disabled?'default':'pointer'};padding:.2rem .55rem;${active?'color:var(--blwhite);font-weight:700':disabled?'color:var(--blgray);opacity:.45':''}"
      ${disabled ? "" : `onclick="renderFrnAlumni(${r.val === 'all' ? "'all'" : r.val})"`}
      >${r.label}${r.val !== 'all' && r.val > totalSnapshots ? ` <span style="font-size:.55rem">(${totalSnapshots} avail)</span>` : ""}</button>`;
  }).join("");

  const findCurrentPlayer = (name) => {
    for (const r of Object.values(franchise.rosters || {})) {
      const p = r.find(rp => rp.name === name);
      if (p) return p;
    }
    return null;
  };

  const renderEntry = (a) => {
    const live = findCurrentPlayer(a.name);
    let locationCell = "";
    if (a.location === "team" && a.currentTeam) {
      locationCell = `<span style="color:${a.currentTeam.primary};font-weight:700">→ ${a.currentTeam.city} ${a.currentTeam.name}</span>`;
    } else if (a.location === "hof") {
      locationCell = `<span style="color:var(--blgold);font-weight:700">🏛 HALL OF FAME</span>`;
    } else if (a.location === "retired") {
      locationCell = `<span style="color:var(--blgray)">Retired</span>`;
    } else {
      locationCell = `<span style="color:var(--blgray);font-style:italic">Unsigned</span>`;
    }
    return `<tr>
      <td>${playerLinkByName(a.name)} <span style="color:var(--blgray);font-size:.62rem">(${a.pos})</span></td>
      <td style="color:var(--blgray);font-size:.66rem">S${a.lastSeasonWithUs}</td>
      <td>${locationCell}</td>
      <td style="color:${live ? "var(--blwhite)" : "var(--blgray)"};font-size:.66rem">${live ? "Age " + (live.age || "?") : "—"}</td>
    </tr>`;
  };

  const buildSection = (label, list, color) => {
    if (!list.length) return "";
    return `<div class="frn-pg-card" style="margin-bottom:.6rem;border-left:3px solid ${color}">
      <div class="frn-pg-card-title">${label} · ${list.length}</div>
      <table class="frn-ana-table">
        <thead><tr><th>Player</th><th>Last season w/ us</th><th>Now</th><th></th></tr></thead>
        <tbody>${list.map(renderEntry).join("")}</tbody>
      </table>
    </div>`;
  };

  const body = alumni.length ? `
    ${buildSection("ON ANOTHER TEAM",      grouped.team,     "#1a5fb4")}
    ${buildSection("HALL OF FAME",         grouped.hof,      "var(--blgold)")}
    ${buildSection("RETIRED",              grouped.retired,  "#8898a8")}
    ${buildSection("CURRENTLY UNSIGNED",   grouped.unsigned, "#a0a0a0")}
  ` : `<div style="color:var(--blgray);font-size:.78rem;padding:1.5rem;text-align:center;font-style:italic">No alumni yet — players who leave your roster (trade, release, free agency, retirement) will show up here once a season has rolled over.</div>`;

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()} · ALUMNI · LAST 3 SEASONS</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("LEGACY")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        <span style="color:var(--blgray);font-size:.62rem;letter-spacing:1px;font-weight:700;margin-left:.6rem">RANGE:</span>
        <div style="display:flex;gap:.3rem;flex-wrap:wrap">${rangeChips}</div>
        <div style="color:var(--blgray);font-size:.65rem;margin-left:auto">${totalSnapshots} season snapshot${totalSnapshots===1?"":"s"} on file · cap 25</div>
      </div>
      <div style="padding:1rem 1.4rem">${body}</div>
    </div>`;
}

// ── Visual depth chart for your own team ──────────────────────────────────────
function renderFrnDepthChart() {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const roster = franchise.rosters[myId] || [];
  const byPos = {};
  for (const p of roster) (byPos[p.position] ||= []).push(p);
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a,b) => b.overall - a.overall);

  // Position display config: slot count + label
  const POS_ROWS = [
    { key:"QB", label:"QUARTERBACK", slots: 3 },
    { key:"RB", label:"RUNNING BACK", slots: 4 },
    { key:"WR", label:"WIDE RECEIVER", slots: 6 },
    { key:"TE", label:"TIGHT END", slots: 3 },
    { key:"OL", label:"OFFENSIVE LINE", slots: 8 },
    { key:"DL", label:"DEFENSIVE LINE", slots: 6 },
    { key:"LB", label:"LINEBACKER", slots: 5 },
    { key:"CB", label:"CORNERBACK", slots: 5 },
    { key:"S",  label:"SAFETY", slots: 3 },
    { key:"K",  label:"KICKER", slots: 1 },
    { key:"P",  label:"PUNTER", slots: 1 },
  ];

  const rowsHtml = POS_ROWS.map(p => {
    const players = (byPos[p.key] || []).slice(0, p.slots);
    const filled = players.length;
    const slotsHtml = Array.from({ length: p.slots }, (_, i) => {
      const pl = players[i];
      if (!pl) {
        return `<div class="frn-depth-slot empty">
          <div class="frn-depth-slot-num">#${i+1}</div>
          <div class="frn-depth-slot-empty">— empty —</div>
        </div>`;
      }
      const escName = (pl.name || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const isStarter = i === 0;
      const injuredTag = pl.injury?.weeksRemaining > 0
        ? `<span class="frn-depth-injured">🩹 ${pl.injury.weeksRemaining}w</span>` : "";
      const blockTag = pl.onTradeBlock
        ? `<span class="frn-depth-block">●BLK</span>` : "";
      return `<div class="frn-depth-slot ${isStarter?'starter':''}"
        onclick="frnOpenPlayerCard('${escName}')">
        <div class="frn-depth-slot-num">${isStarter ? "★ ST" : "#"+(i+1)}</div>
        <div class="frn-depth-slot-name">${pl.name}</div>
        <div class="frn-depth-slot-meta">
          ${gradeBadge(pl)}
          <span style="color:var(--gray);font-size:.6rem">age ${pl.age||"?"}</span>
        </div>
        <div class="frn-depth-slot-aav">$${(pl.contract?.aav||0).toFixed(1)}M · ${pl.contract?.remaining||0}yr</div>
        ${injuredTag}${blockTag}
      </div>`;
    }).join("");
    return `<div class="frn-depth-row">
      <div class="frn-depth-pos-label">
        <div style="font-size:1rem;font-weight:900;color:var(--gold)">${p.key}</div>
        <div style="font-size:.55rem;color:var(--gray);letter-spacing:.3px">${p.label}</div>
        <div style="font-size:.55rem;color:var(--gray);margin-top:.15rem">${filled}/${p.slots}</div>
      </div>
      <div class="frn-depth-slots">${slotsHtml}</div>
    </div>`;
  }).join("");

  // Quick summary header
  const totalPlayers = roster.length;
  const starters = POS_ROWS.reduce((s, p) => {
    const top = (byPos[p.key] || [])[0];
    return s + (top ? scoutGrade(top) : 0);
  }, 0);
  const avgStarterGrade = totalPlayers ? Math.round(starters / POS_ROWS.length) : 0;
  const rtg = frnTeamRating(myId);

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">📋 DEPTH CHART · ${myTeam.city} ${myTeam.name}</div>
      <div style="color:var(--gray);font-size:.72rem">${totalPlayers} players · OFF ${rtg.off} · DEF ${rtg.def} · Avg starter ${gradeLabel(avgStarterGrade)}</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-depth-chart">${rowsHtml}</div>`;
}

// Compute a team's W-L-T record AS OF a given week (before that week's game).
// confW/confL only count games against teams in the same conference.
function _teamRecordAsOf(teamId, throughWeek) {
  const team = getTeam(teamId);
  let w = 0, l = 0, t = 0, confW = 0, confL = 0;
  for (const g of (franchise.schedule || [])) {
    if (!g.played || g.week >= throughWeek) continue;
    let myScore, oppScore, oppId;
    if (g.homeId === teamId)      { myScore = g.homeScore; oppScore = g.awayScore; oppId = g.awayId; }
    else if (g.awayId === teamId) { myScore = g.awayScore; oppScore = g.homeScore; oppId = g.homeId; }
    else continue;
    const isConf = team && getTeam(oppId)?.conference === team.conference;
    if (myScore > oppScore)      { w++; if (isConf) confW++; }
    else if (myScore < oppScore) { l++; if (isConf) confL++; }
    else                          { t++; }
  }
  return { w, l, t, confW, confL };
}
// Fantasy points (standard PPR) so we can pick top performers per team.
function _fpts(p, pos) {
  let f = 0;
  if (pos === "QB") f += (p.pass_yds||0)*0.04 + (p.pass_td||0)*4 - (p.pass_int||0)*2;
  f += (p.rush_yds||0)*0.1 + (p.rush_td||0)*6;
  f += (p.rec||0)*1 + (p.rec_yds||0)*0.1 + (p.rec_td||0)*6;
  f += (p.tkl||0)*1 + (p.sk||0)*2 + (p.int_made||0)*4 + (p.ff||0)*2 + (p.fr||0)*2 + (p.pd||0)*0.5;
  f += (p.fg_made||0)*3 + (p.xp_made||0)*1;
  return Math.round(f * 10) / 10;
}
// secs left in quarter → "MM:SS"
function _clockMMSS(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
// Deterministic crowd size in the 45–75k range based on home/week.
function _attendanceFor(home, week, season) {
  if (!home) return 0;
  let h = (season || 1) * 7919 + week * 31 + home.id * 53;
  for (const c of (home.city + home.name)) h = (h * 31 + c.charCodeAt(0)) | 0;
  const base = 45000;
  const range = 30000;
  return base + Math.abs(h) % range;
}
// Pick top performer in a stat category. Returns null if no one qualifies.
function _topPerformer(players, scoreFn, threshold) {
  let best = null, bestS = -Infinity;
  for (const p of players) {
    const s = scoreFn(p);
    if (s > bestS && s >= (threshold || 0)) { best = p; bestS = s; }
  }
  return best;
}
// Mini helmet glyph used in leader rows (cheap inline SVG).
function _mini_helmet(team) {
  const primary = team?.primary || "#444";
  const secondary = team?.secondary || "#ccc";
  return `<svg class="frn-bs-leader-helm" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="20" cy="19" rx="15" ry="13" fill="${primary}" stroke="${secondary}" stroke-width="1.5"/>
    <rect x="6" y="22" width="20" height="2" fill="${secondary}" rx="1"/>
  </svg>`;
}
// Linear bars for the team-stat-comparison row.
function _bsCompRow(label, aVal, hVal, awayColor, homeColor, fmt) {
  const a = +aVal || 0, h = +hVal || 0;
  const max = Math.max(a, h) || 1;
  const aw = Math.round((a / max) * 100);
  const hw = Math.round((h / max) * 100);
  const fmtFn = fmt || (v => v);
  return `<div class="row">
    <div class="stat">${label}</div>
    <div class="v-left">${fmtFn(a)}</div>
    <div class="frn-bs-bar">
      <div class="frn-bs-bar-l"><span style="width:${aw}%;background:${awayColor}"></span></div>
      <div class="frn-bs-bar-r"><span style="width:${hw}%;background:${homeColor}"></span></div>
    </div>
    <div class="v-right">${fmtFn(h)}</div>
  </div>`;
}
// ── BSPN box-score: adapter + vanilla-JS render ─────────────────────────────
// Mirrors the React BSPN system (src/components/bspn/*) but lives inline in
// play.html so franchise mode can use it without crossing app boundaries.
// _franchiseGameToBSPNData() is the only place that knows the franchise
// schedule game shape; everything below consumes BSPNBoxScoreData only.

function _bspnAbbr(team) {
  if (!team) return "TBD";
  const c = (team.city || "").trim();
  const n = (team.name || "").trim();
  if (c && n) return (c[0] + n.slice(0, 2)).toUpperCase();
  return (n || "TBD").slice(0, 3).toUpperCase();
}
function _bspnEsc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _bspnTeamFromFranchise(team, recordStr) {
  if (!team) return { id: "tbd", name: "TBD", abbreviation: "TBD",
                      primaryColor: "#888", secondaryColor: "#444" };
  return {
    id: team.id,
    name: team.name,
    city: team.city,
    abbreviation: _bspnAbbr(team),
    record: recordStr || null,
    primaryColor: team.primary,
    secondaryColor: team.secondary,
    asciiMark: null,
  };
}
function _bspnFmtRecord(rec) {
  if (!rec) return null;
  const base = `${rec.w||0}-${rec.l||0}${rec.t ? `-${rec.t}` : ""}`;
  if (rec.confW != null) return `${base} (${rec.confW}-${rec.confL})`;
  return base;
}
function _bspnQuarterScoresFromScoring(scoring) {
  const out = {};
  for (const ev of (scoring || [])) {
    if (ev.isScore === false) continue;
    if (!ev.pts) continue;
    const q = Math.max(1, Math.min(8, ev.qtr || 1));
    out[q] ||= { home: 0, away: 0 };
    if (ev.poss === "home") out[q].home += ev.pts;
    else if (ev.poss === "away") out[q].away += ev.pts;
  }
  const maxQ = Math.max(4, ...Object.keys(out).map(Number));
  const arr = [];
  for (let q = 1; q <= maxQ; q++) {
    arr.push({
      periodLabel: q <= 4 ? `Q${q}` : (q === 5 ? "OT" : `OT${q-4}`),
      away: out[q]?.away || 0, home: out[q]?.home || 0,
    });
  }
  return arr;
}
function _bspnBuildComparisonStats(stats) {
  if (!stats) return [];
  const aT = stats.away?.totals || {};
  const hT = stats.home?.totals || {};
  const fmtTOP = v => `${Math.floor((v||0)/60)}:${String((v||0)%60).padStart(2,"0")}`;
  const row = (key, label, a, h, fmt) => ({
    key, label,
    awayValue: fmt ? fmt(a) : (a||0),
    homeValue: fmt ? fmt(h) : (h||0),
    awayBarValue: a||0, homeBarValue: h||0,
  });
  // Field names match the simulator's stats[side].team shape: totalYds,
  // passYds, rushYds, timeOfPoss (seconds), penalties (count), penaltyYds.
  return [
    row("first_downs",   "FIRST DOWNS",       aT.firstDowns,  hT.firstDowns),
    row("total_yards",   "TOTAL YARDS",       aT.totalYds,    hT.totalYds),
    row("passing_yards", "PASSING YARDS",     aT.passYds,     hT.passYds),
    row("rushing_yards", "RUSHING YARDS",     aT.rushYds,     hT.rushYds),
    row("turnovers",     "TURNOVERS",         aT.turnovers,   hT.turnovers),
    row("sacks",         "SACKS",             aT.sacks,       hT.sacks),
    row("penalties",     "PENALTIES (YDS)",   aT.penaltyYds,  hT.penaltyYds),
    row("top",           "TIME OF POSSESSION", aT.timeOfPoss, hT.timeOfPoss, fmtTOP),
  ];
}
function _bspnBuildStatGroups(sidePlayers) {
  const players = Object.values(sidePlayers || {});
  if (!players.length) return [];
  const filter = (fn, sortKey) => players
    .filter(fn).sort((a,b) => (b[sortKey]||0) - (a[sortKey]||0));
  const pNameCell = p => (typeof playerLinkByName === "function"
    ? playerLinkByName(p.name)
    : _bspnEsc(p.name));
  const passingRows = filter(p => (p.pass_att||0) > 0, "pass_yds").map(p => ({
    id: `pass-${p.name}`, cells: {
      player: pNameCell(p),
      cmp: p.pass_comp || 0, att: p.pass_att || 0,
      yds: p.pass_yds || 0, td: p.pass_td || 0, int: p.pass_int || 0,
      rtg: p.pass_att ? (((p.pass_comp||0)/p.pass_att*100*0.5 + (p.pass_yds||0)/p.pass_att*4 + (p.pass_td||0)*5 - (p.pass_int||0)*5).toFixed(1)) : "0.0",
    },
  }));
  const rushingRows = filter(p => (p.rush_att||0) > 0, "rush_yds").map(p => ({
    id: `rush-${p.name}`, cells: {
      player: pNameCell(p),
      att: p.rush_att || 0, yds: p.rush_yds || 0,
      avg: p.rush_att ? ((p.rush_yds||0)/p.rush_att).toFixed(1) : "0.0",
      td: p.rush_td || 0, lng: p.rush_long || 0,
    },
  }));
  const receivingRows = filter(p => (p.rec||0) > 0 || (p.rec_tgt||0) > 0, "rec_yds").map(p => ({
    id: `rec-${p.name}`, cells: {
      player: pNameCell(p),
      rec: p.rec || 0, yds: p.rec_yds || 0,
      avg: p.rec ? ((p.rec_yds||0)/p.rec).toFixed(1) : "0.0",
      td: p.rec_td || 0, lng: p.rec_long || 0,
    },
  }));
  const defRows = filter(p => ((p.tkl||0)+(p.sk||0)+(p.int_made||0)+(p.pd||0)) > 0, "tkl").map(p => ({
    id: `def-${p.name}`, cells: {
      player: pNameCell(p),
      tkl: p.tkl || 0, ast: p.ast || 0, tfl: p.tfl || 0,
      sack: (p.sk || 0).toFixed(1).replace(/\.0$/, ""),
      int: p.int_made || 0, ff: p.ff || 0, fr: p.fr || 0,
    },
  }));
  const kickRows = filter(p => (p.fg_att||0) > 0 || (p.xp_att||0) > 0, "fg_made").map(p => ({
    id: `k-${p.name}`, cells: {
      player: pNameCell(p),
      fgm_fga: `${p.fg_made||0}-${p.fg_att||0}`,
      lng: p.fg_long || 0,
      xp: `${p.xp_made||0}-${p.xp_att||0}`,
      pts: (p.fg_made||0)*3 + (p.xp_made||0),
    },
  }));
  const groups = [];
  const baseCols = key => [
    { key: "player", label: "" },
    ...({
      pass:    [{key:"cmp",label:"CMP",align:"right"},{key:"att",label:"ATT",align:"right"},{key:"yds",label:"YDS",align:"right"},{key:"td",label:"TD",align:"right"},{key:"int",label:"INT",align:"right"},{key:"rtg",label:"RTG",align:"right"}],
      rush:    [{key:"att",label:"ATT",align:"right"},{key:"yds",label:"YDS",align:"right"},{key:"avg",label:"AVG",align:"right"},{key:"td",label:"TD",align:"right"},{key:"lng",label:"LNG",align:"right"}],
      rec:     [{key:"rec",label:"REC",align:"right"},{key:"yds",label:"YDS",align:"right"},{key:"avg",label:"AVG",align:"right"},{key:"td",label:"TD",align:"right"},{key:"lng",label:"LNG",align:"right"}],
      def:     [{key:"tkl",label:"TKL",align:"right"},{key:"ast",label:"AST",align:"right"},{key:"tfl",label:"TFL",align:"right"},{key:"sack",label:"SACK",align:"right"},{key:"int",label:"INT",align:"right"},{key:"ff",label:"FF",align:"right"},{key:"fr",label:"FR",align:"right"}],
      kick:    [{key:"fgm_fga",label:"FGM-FGA",align:"right"},{key:"lng",label:"LONG",align:"right"},{key:"xp",label:"XP",align:"right"},{key:"pts",label:"PTS",align:"right"}],
    })[key],
  ];
  if (passingRows.length)   groups.push({ title: "PASSING",   columns: baseCols("pass"), rows: passingRows });
  if (rushingRows.length)   groups.push({ title: "RUSHING",   columns: baseCols("rush"), rows: rushingRows });
  if (receivingRows.length) groups.push({ title: "RECEIVING", columns: baseCols("rec"),  rows: receivingRows });
  if (defRows.length)       groups.push({ title: "DEFENSE",   columns: baseCols("def"),  rows: defRows });
  if (kickRows.length)      groups.push({ title: "KICKING",   columns: baseCols("kick"), rows: kickRows });
  return groups;
}
function _bspnBuildScoringSummary(scoring, awayT, homeT) {
  const out = [];
  for (const ev of (scoring || [])) {
    if (ev.isScore === false) continue;
    if (!ev.pts) continue;
    const tm = ev.poss === "home" ? homeT : awayT;
    const secs = ev.clock || 0;
    const mm = String(Math.floor(secs/60)).padStart(2,"0");
    const ss = String(secs%60).padStart(2,"0");
    out.push({
      period: ev.qtr <= 4 ? `Q${ev.qtr}` : "OT",
      time: `${mm}:${ss}`,
      teamId: tm.id,
      description: (ev.desc || "").replace(/\(\+\d+\)/, "").trim(),
      scoreText: `${ev.awayScore}-${ev.homeScore}`,
    });
  }
  return out;
}
function _bspnFantasy(p) {
  const pos = p.pos;
  let f = 0;
  if (pos === "QB") f += (p.pass_yds||0)*0.04 + (p.pass_td||0)*4 - (p.pass_int||0)*2;
  f += (p.rush_yds||0)*0.1 + (p.rush_td||0)*6;
  f += (p.rec||0)*1 + (p.rec_yds||0)*0.1 + (p.rec_td||0)*6;
  f += (p.tkl||0)*1 + (p.sk||0)*2 + (p.int_made||0)*4 + (p.ff||0)*2 + (p.fr||0)*2 + (p.pd||0)*0.5;
  f += (p.fg_made||0)*3 + (p.xp_made||0)*1;
  return Math.round(f*10)/10;
}
function _bspnBuildLeaders(stats, awayT, homeT) {
  if (!stats) return { leaderGroups: [], topPerformers: undefined };
  // Per-game stat records don't carry the jersey number — look it up from
  // the team's roster snapshot. This also surfaces .age, .archetype, etc.
  // if any downstream code wants them.
  const enrich = (slim, team) => {
    const roster = franchise.rosters?.[team.id] || [];
    const rosterP = roster.find(r => r.name === slim.name) || {};
    return { ...slim, _team: team, _rosterP: rosterP };
  };
  const all = [
    ...Object.values(stats.away?.players || {}).map(p => enrich(p, awayT)),
    ...Object.values(stats.home?.players || {}).map(p => enrich(p, homeT)),
  ];
  const top = (scoreFn, threshold) => {
    let best = null, b = -Infinity;
    for (const p of all) {
      const s = scoreFn(p);
      if (s > b && s >= (threshold || 0)) { best = p; b = s; }
    }
    return best;
  };
  const tp = top(p => p.pass_yds||0, 30);
  const tr = top(p => p.rush_yds||0, 20);
  const trc = top(p => p.rec_yds||0, 20);
  const td = top(p => (p.tkl||0)*1 + (p.sk||0)*3 + (p.int_made||0)*5, 4);
  const mkLeader = (label, p, statLine) => p ? {
    label, playerName: p.name, teamId: p._team.id,
    jersey: jerseyForPlayer(p._rosterP || p),
    statLine,
  } : null;
  const offRows = [
    mkLeader("PASSING",  tp,  tp  ? `${tp.pass_comp||0}-${tp.pass_att||0}, ${tp.pass_yds||0} YDS, ${tp.pass_td||0} TD, ${tp.pass_int||0} INT` : ""),
    mkLeader("RUSHING",  tr,  tr  ? `${tr.rush_att||0} ATT, ${tr.rush_yds||0} YDS, ${tr.rush_td||0} TD` : ""),
    mkLeader("RECEIVING", trc, trc ? `${trc.rec||0} REC, ${trc.rec_yds||0} YDS, ${trc.rec_td||0} TD` : ""),
    mkLeader("DEFENSE",  td,  td  ? `${td.tkl||0} TKL, ${td.sk||0} SK${td.int_made?`, ${td.int_made} INT`:""}` : ""),
  ].filter(Boolean);
  const topByFp = [...all].sort((a,b) => _bspnFantasy(b) - _bspnFantasy(a)).slice(0, 4);
  const tpRows = topByFp.map(p => {
    let detail = "";
    const pos = p.pos;
    if (pos === "QB") detail = `${p.pass_yds||0} PASS YDS, ${p.pass_td||0} TD`;
    else if (pos === "RB") detail = `${p.rush_yds||0} RUSH YDS, ${p.rush_td||0} TD`;
    else if (pos === "WR" || pos === "TE") detail = `${p.rec_yds||0} REC YDS, ${p.rec_td||0} TD`;
    else if (pos === "K") detail = `${p.fg_made||0}/${p.fg_att||0} FG`;
    else detail = `${p.tkl||0} TKL, ${p.sk||0} SK`;
    return {
      label: "", playerName: p.name, teamId: p._team.id,
      jersey: jerseyForPlayer(p._rosterP || p),
      statLine: `${_bspnFantasy(p).toFixed(1)} FPTS · ${detail}`,
      value: _bspnFantasy(p),
    };
  });
  return {
    leaderGroups: offRows.length ? [{ title: "OFFENSIVE LEADERS", rows: offRows }] : [],
    topPerformers: tpRows.length ? { title: "GAME LEADERS · TOP PERFORMERS", rows: tpRows } : undefined,
  };
}
function _bspnBuildGameNotes(g, week, awayT, homeT, home, away, homeWon, leaders) {
  const notes = [];
  const { topPerformers } = leaders || {};
  // Conference standings note
  if (home.conference === away.conference) {
    const winner = homeWon ? home : away;
    notes.push(`${winner.city} ${winner.name} improve in conference play.`);
  }
  // Career milestones — simple thresholds from raw stats
  const tp = (leaders.leaderGroups[0]?.rows || []).find(r => r.label === "PASSING");
  if (tp) {
    notes.push(`${tp.playerName} — top passing performance of the day.`);
  }
  notes.push(`Attendance: ${(_attendanceFor(home, week, franchise.season) || 0).toLocaleString()}`);
  if (g.weather && g.weather.label && g.weather.label !== "CLEAR") {
    const w = g.weather;
    notes.push(`Weather: ${w.tempF ? w.tempF+"°F" : ""} ${w.label}${w.windMph ? `, Wind ${w.windMph} mph` : ""}`.trim());
  } else {
    notes.push(`Weather: clear conditions.`);
  }
  // Next game for both teams
  const nextOf = teamId => {
    const ng = (franchise.schedule || [])
      .filter(s => !s.played && (s.homeId === teamId || s.awayId === teamId))
      .sort((a,b) => a.week - b.week)[0];
    if (!ng) return null;
    const opp = getTeam(ng.homeId === teamId ? ng.awayId : ng.homeId);
    const venue = ng.homeId === teamId ? "vs" : "at";
    return `${_bspnAbbr(getTeam(teamId))} ${venue} ${_bspnAbbr(opp)} (Wk ${ng.week})`;
  };
  const nh = nextOf(home.id), na = nextOf(away.id);
  if (nh || na) notes.push(`Next Game: ${[na, nh].filter(Boolean).join(" · ")}`);
  return notes.map((t, i) => ({ id: `n${i}`, text: t }));
}

/** Adapt a franchise schedule entry to BSPNBoxScoreData. */
function _franchiseGameToBSPNData(g, week) {
  const home = getTeam(g.homeId), away = getTeam(g.awayId);
  const homeWon = g.homeScore > g.awayScore;
  // Records as of this game (after applying its result)
  const awayRec = _teamRecordAsOf(g.awayId, week);
  const homeRec = _teamRecordAsOf(g.homeId, week);
  if (homeWon) {
    homeRec.w++; awayRec.l++;
    if (home.conference === away.conference) { homeRec.confW++; awayRec.confL++; }
  } else if (g.awayScore > g.homeScore) {
    awayRec.w++; homeRec.l++;
    if (home.conference === away.conference) { awayRec.confW++; homeRec.confL++; }
  } else {
    awayRec.t++; homeRec.t++;
  }
  const awayT = _bspnTeamFromFranchise(away, _bspnFmtRecord(awayRec));
  const homeT = _bspnTeamFromFranchise(home, _bspnFmtRecord(homeRec));
  const summary = {
    gameId: `wk${week}-${g.homeId}-${g.awayId}`,
    status: `WEEK ${week} · FINAL${g.isRivalry?" · RIVALRY":""}`,
    awayTeam: awayT, homeTeam: homeT,
    awayScore: g.awayScore || 0, homeScore: g.homeScore || 0,
    quarterScores: _bspnQuarterScoresFromScoring(g.scoring),
    winner: homeWon ? "home" : (g.awayScore > g.homeScore ? "away" : "tie"),
  };
  const leaders = _bspnBuildLeaders(g.stats, awayT, homeT);
  return {
    summary,
    comparisonStats: _bspnBuildComparisonStats(g.stats),
    awayBoxScoreGroups: _bspnBuildStatGroups(g.stats?.away?.players),
    homeBoxScoreGroups: _bspnBuildStatGroups(g.stats?.home?.players),
    scoringSummary: _bspnBuildScoringSummary(g.scoring, awayT, homeT),
    leaderGroups: leaders.leaderGroups,
    topPerformers: leaders.topPerformers,
    gameNotes: _bspnBuildGameNotes(g, week, awayT, homeT, home, away, homeWon, leaders),
  };
}

// ── Renderers ──────────────────────────────────────────────────────────────
const _BSPN_NAV = ["Scores","News","Box Score","Stats","Teams","Standings"];

function _bspnRenderHeader() {
  const items = _BSPN_NAV.map(it => {
    const active = it === "Box Score" ? " active" : "";
    return `<button type="button" class="bspn-nav-item${active}">${it}</button>`;
  }).join("");
  return `<header class="bspn-header">
    <div class="bspn-logo">BSPN</div>
    <nav class="bspn-nav">${items}</nav>
    <div class="bspn-header-right" aria-hidden="true">
      <span>⌕</span><span>▶ WATCH</span><span>◯</span><span>≡</span>
    </div>
  </header>`;
}
function _bspnRenderScoreNumeral(value, color, muted) {
  const cls = `bspn-score-numeral${muted ? " muted" : ""}`;
  const style = color && !muted ? `style="--num-color:${color}"` : "";
  return `<span class="${cls}" ${style}>${value}</span>`;
}
function _bspnRenderTeamMark(team) {
  const sz = 80;
  return `<div class="bspn-summary-team-mark" style="width:${sz}px;height:${sz}px;--team-color:${team.primaryColor}">
    <span style='font-family:"Bebas Neue","Anton",sans-serif;font-size:.95rem;letter-spacing:2px'>${_bspnEsc(team.abbreviation)}</span>
  </div>`;
}
function _bspnRenderSummary(s) {
  const awayWon = s.winner === "away", homeWon = s.winner === "home";
  const teamBlock = (t, side) => {
    const isWin = side === "away" ? awayWon : homeWon;
    const otherWon = side === "away" ? homeWon : awayWon;
    const sclass = side === "home" ? " right" : "";
    const score = side === "away" ? s.awayScore : s.homeScore;
    const arrow = isWin
      ? (side === "away"
        ? `<span class="bspn-summary-arrow" style="color:${t.primaryColor}">◄</span>`
        : `<span class="bspn-summary-arrow" style="color:${t.primaryColor}">►</span>`)
      : "";
    const scoreEl = _bspnRenderScoreNumeral(score, isWin ? t.primaryColor : undefined, !isWin && otherWon);
    const recordEl = t.record ? `<span class="bspn-summary-team-record">${_bspnEsc(t.record)}</span>` : "";
    const cityEl = t.city ? `<span class="bspn-summary-team-city">${_bspnEsc(t.city.toUpperCase())}</span>` : "";
    const scoreWrap = side === "home"
      ? `<div class="bspn-summary-score-wrap">${arrow}${scoreEl}</div>`
      : `<div class="bspn-summary-score-wrap">${scoreEl}${arrow}</div>`;
    return `<div class="bspn-summary-team${sclass}" style="--team-color:${t.primaryColor}">
      ${_bspnRenderTeamMark(t)}
      <div class="bspn-summary-team-block">
        ${cityEl}
        <span class="bspn-summary-team-name">${_bspnEsc(t.name.toUpperCase())}</span>
        ${recordEl}
      </div>
      ${scoreWrap}
    </div>`;
  };
  const headerCells = s.quarterScores.map(q => `<th>${q.periodLabel}</th>`).join("");
  const awayCells = s.quarterScores.map(q => `<td>${q.away ?? 0}</td>`).join("");
  const homeCells = s.quarterScores.map(q => `<td>${q.home ?? 0}</td>`).join("");
  return `<section class="bspn-summary">
    ${teamBlock(s.awayTeam, "away")}
    <div class="bspn-summary-center">
      <div class="bspn-summary-status">${_bspnEsc(s.status)}</div>
      <table class="bspn-summary-quarters">
        <thead><tr><th></th>${headerCells}<th>TOTAL</th></tr></thead>
        <tbody>
          <tr><td style="color:${s.awayTeam.primaryColor};font-weight:700">${s.awayTeam.abbreviation}</td>${awayCells}<td class="total">${s.awayScore}</td></tr>
          <tr><td style="color:${s.homeTeam.primaryColor};font-weight:700">${s.homeTeam.abbreviation}</td>${homeCells}<td class="total">${s.homeScore}</td></tr>
        </tbody>
      </table>
    </div>
    ${teamBlock(s.homeTeam, "home")}
  </section>`;
}
function _bspnRenderCompBars(aVal, hVal, aColor, hColor) {
  const a = Math.max(0, Number(aVal) || 0);
  const h = Math.max(0, Number(hVal) || 0);
  const max = Math.max(a, h, 1);
  const aw = Math.round((a/max)*100);
  const hw = Math.round((h/max)*100);
  return `<div class="bspn-comp-bars" aria-hidden="true">
    <div class="bspn-comp-bar-l"><span style="width:${aw}%;background:${aColor};color:${aColor}"></span></div>
    <div class="bspn-comp-bar-divider"></div>
    <div class="bspn-comp-bar-r"><span style="width:${hw}%;background:${hColor};color:${hColor}"></span></div>
  </div>`;
}
function _bspnRenderComparison(stats, awayT, homeT) {
  if (!stats?.length) {
    return `<section class="bspn-panel">
      <div class="bspn-panel-title">TEAM STAT COMPARISON</div>
      <div style="color:var(--bspn-gray);font-size:.7rem;font-style:italic">
        No team totals available for this game.
      </div>
    </section>`;
  }
  const rows = stats.map(s => `<div class="bspn-comp-row">
    <span class="bspn-comp-label">${_bspnEsc(s.label)}</span>
    <span class="bspn-comp-val left bspn-num">${_bspnEsc(s.awayValue)}</span>
    ${_bspnRenderCompBars(s.awayBarValue ?? s.awayValue, s.homeBarValue ?? s.homeValue, awayT.primaryColor, homeT.primaryColor)}
    <span class="bspn-comp-val right bspn-num">${_bspnEsc(s.homeValue)}</span>
  </div>`).join("");
  return `<section class="bspn-panel">
    <div class="bspn-panel-title">TEAM STAT COMPARISON</div>
    <div class="bspn-comp-row" style="border-bottom:1px solid var(--bspn-border-strong)">
      <span class="bspn-comp-label" style="color:var(--bspn-gray)">STAT</span>
      <span class="bspn-comp-val left" style="color:${awayT.primaryColor}">${awayT.abbreviation}</span>
      <span></span>
      <span class="bspn-comp-val right" style="color:${homeT.primaryColor}">${homeT.abbreviation}</span>
    </div>
    ${rows}
  </section>`;
}
function _bspnRenderStatTable(group, accentColor) {
  if (!group || !group.rows?.length) return "";
  const head = group.columns.map(c => `<th data-align="${c.align||"left"}">${_bspnEsc(c.label)}</th>`).join("");
  const rows = group.rows.map(r => `<tr>${
    group.columns.map(c => `<td data-align="${c.align||"left"}">${r.cells?.[c.key] ?? ""}</td>`).join("")
  }</tr>`).join("");
  return `<div class="bspn-stat-group">
    <div class="bspn-stat-group-title" ${accentColor ? `style="color:${accentColor}"` : ""}>
      <span>${_bspnEsc(group.title)}</span>
    </div>
    <table class="bspn-stat-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
function _bspnRenderTeamBox(team, groups) {
  if (!team) return "";
  const tables = (groups || []).map(g => _bspnRenderStatTable(g, team.primaryColor)).join("");
  const empty = (!groups || !groups.length)
    ? `<div style="color:var(--bspn-gray);font-size:.7rem;font-style:italic">No per-player stats recorded.</div>`
    : "";
  const rec = team.record ? `<div class="bspn-team-box-record">${_bspnEsc(team.record)}</div>` : "";
  return `<section class="bspn-panel" style="--team-color:${team.primaryColor}">
    <div class="bspn-team-box-head">
      <div class="bspn-team-box-name">${_bspnEsc((team.name||"").toUpperCase())}</div>
      ${rec}
    </div>
    ${tables}
    ${empty}
  </section>`;
}
function _bspnRenderScoring(plays, teamsById) {
  if (!plays?.length) {
    return `<section class="bspn-panel">
      <div class="bspn-panel-title">SCORING SUMMARY</div>
      <div style="color:var(--bspn-gray);font-size:.7rem;font-style:italic">No scoring events.</div>
    </section>`;
  }
  const rows = plays.map(p => {
    const tm = teamsById[p.teamId];
    return `<tr>
      <td class="qtr">${_bspnEsc(p.period)}</td>
      <td class="time">${_bspnEsc(p.time)}</td>
      <td class="team" style="color:${tm?.primaryColor || "var(--bspn-white)"}">${_bspnEsc(tm?.abbreviation || "")}</td>
      <td>${_bspnEsc(p.description)}</td>
      <td class="score">${_bspnEsc(p.scoreText)}</td>
    </tr>`;
  }).join("");
  return `<section class="bspn-panel">
    <div class="bspn-panel-title">SCORING SUMMARY</div>
    <table class="bspn-scoring-table">
      <thead><tr><th>QTR</th><th>TIME</th><th>TEAM</th><th>PLAY (SCORER)</th><th style="text-align:right">SCORE</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="bspn-scoring-legend">TD = TOUCHDOWN &nbsp;&nbsp; FG = FIELD GOAL &nbsp;&nbsp; XP = EXTRA POINT</div>
  </section>`;
}
function _bspnRenderLeadersGroup(group, teamsById) {
  if (!group?.rows?.length) return "";
  const rows = group.rows.map(r => {
    const tm = teamsById[r.teamId];
    const nameLink = (typeof playerLinkByName === "function") ? playerLinkByName(r.playerName) : _bspnEsc(r.playerName);
    return `<div class="bspn-leader-row" style="--team-color:${tm?.primaryColor || "var(--bspn-gold)"}">
      <div class="bspn-leader-helm">${_bspnEsc(tm?.abbreviation || "—")}</div>
      <div class="bspn-leader-meta">
        ${r.label ? `<div class="bspn-leader-cat">${_bspnEsc(r.label)}</div>` : ""}
        <div>
          <span class="bspn-leader-name">${r.jersey ? `#${_bspnEsc(r.jersey)} ` : ""}${nameLink}</span>
          ${tm ? `<span class="bspn-leader-team">${_bspnEsc(tm.abbreviation)}</span>` : ""}
        </div>
        <div class="bspn-leader-stat">${_bspnEsc(r.statLine)}</div>
      </div>
    </div>`;
  }).join("");
  const titleClass = group.title?.includes("LEADERS") ? "accent-gold" : "";
  return `<section class="bspn-panel">
    <div class="bspn-panel-title ${titleClass}">${_bspnEsc(group.title)}</div>
    ${rows}
  </section>`;
}
function _bspnRenderNotes(notes) {
  if (!notes?.length) return "";
  return `<section class="bspn-panel">
    <div class="bspn-panel-title">GAME NOTES</div>
    <ul class="bspn-notes">
      ${notes.map(n => `<li>${_bspnEsc(n.text)}</li>`).join("")}
    </ul>
  </section>`;
}
function _bspnRenderFooter() {
  const fieldL = ` x x x x x  ──────  ┊───┊
                 ┊   ┊
 x x x x x  ──────  ┊───┊`;
  const fieldR = ` ┊───┊  ──────  x x x x x
 ┊   ┊
 ┊───┊  ──────  x x x x x`;
  return `<footer class="bspn-footer">
    <pre class="bspn-footer-field">${fieldL}</pre>
    <div class="bspn-footer-center">
      BSPN ASCII FOOTBALL v1.0
      <span class="sub">GRIDIRON. CODE. GLORY.</span>
    </div>
    <pre class="bspn-footer-field right">${fieldR}</pre>
  </footer>`;
}

function _bspnRenderPage(data) {
  if (!data) return "";
  const { summary, comparisonStats, awayBoxScoreGroups, homeBoxScoreGroups,
    scoringSummary, leaderGroups, topPerformers, gameNotes } = data;
  const teamsById = {
    [summary.awayTeam.id]: summary.awayTeam,
    [summary.homeTeam.id]: summary.homeTeam,
  };
  return `<div class="bspn-root" style="--away-color:${summary.awayTeam.primaryColor};--home-color:${summary.homeTeam.primaryColor}">
    ${_bspnRenderHeader()}
    <div class="bspn-subbar">
      <button type="button" class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
    </div>
    <div class="bspn-container">
      ${_bspnRenderSummary(summary)}
      <div class="bspn-grid">
        <div>
          ${_bspnRenderComparison(comparisonStats, summary.awayTeam, summary.homeTeam)}
          <div class="bspn-teams-row">
            ${_bspnRenderTeamBox(summary.awayTeam, awayBoxScoreGroups)}
            ${_bspnRenderTeamBox(summary.homeTeam, homeBoxScoreGroups)}
          </div>
        </div>
        <aside>
          ${(leaderGroups || []).map(g => _bspnRenderLeadersGroup(g, teamsById)).join("")}
          ${topPerformers ? _bspnRenderLeadersGroup(topPerformers, teamsById) : ""}
          ${_bspnRenderScoring(scoringSummary, teamsById)}
          ${_bspnRenderNotes(gameNotes)}
        </aside>
      </div>
    </div>
    ${_bspnRenderFooter()}
  </div>`;
}

function renderFrnSnapShares() {
  $("frnHomeContent").innerHTML = `
    <div style="padding:1.5rem;color:var(--gray);font-size:.85rem">
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-bottom:1rem">← Back</button>
      <div style="color:var(--gold);font-weight:700;font-size:1rem;margin-bottom:.5rem">⚡ Snap Percentages</div>
      <div>Snap share management is coming in the next build phase. Use the Depth Chart to set your starters for now.</div>
      <button class="btn btn-outline" onclick="renderFrnDepthChart()" style="margin-top:1rem">Open Depth Chart →</button>
    </div>`;
}

function renderFrnPastGame(week, homeId, awayId) {
  frnHoverTipHide();
  _frnHoverTipPgHide();
  const g = (franchise.schedule || []).find(x =>
    x.week === Number(week) && x.homeId === Number(homeId) && x.awayId === Number(awayId) && x.played);
  if (!g) { alert("Game data not available."); return; }
  const data = _franchiseGameToBSPNData(g, Number(week));
  $("frnHomeContent").innerHTML = _bspnRenderPage(data);
}


function _frnHoverTipPgHide() {
  const tip = document.getElementById("frn-pg-tip");
  if (tip) tip.style.display = "none";
}

// ESPN-parody logo for the box-score header. Block-letter ASCII
// using Unicode box-drawing chars. (Bootleg Sports Programming Network.)
const BSPN_LOGO = `██████╗ ███████╗██████╗ ███╗   ██╗
██╔══██╗██╔════╝██╔══██╗████╗  ██║
██████╔╝███████╗██████╔╝██╔██╗ ██║
██╔══██╗╚════██║██╔═══╝ ██║╚██╗██║
██████╔╝███████║██║     ██║ ╚████║
╚═════╝ ╚══════╝╚═╝     ╚═╝  ╚═══╝`;

function _wxIcon(label) {
  switch (label) {
    case "RAIN":  return "🌧";
    case "SNOW":  return "❄";
    case "WINDY": return "💨";
    case "HOT":   return "☀";
    default:      return "";
  }
}

// Quick hover tooltip on a played-game row in the schedule.
function frnPastGameTipShow(e, week, homeId, awayId) {
  const g = (franchise.schedule || []).find(x =>
    x.week === Number(week) && x.homeId === Number(homeId) && x.awayId === Number(awayId) && x.played);
  if (!g) return;
  let tip = document.getElementById("frn-pg-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "frn-pg-tip";
    tip.className = "frn-team-tooltip";
    document.body.appendChild(tip);
  }
  const home = getTeam(g.homeId), away = getTeam(g.awayId);
  const stats = g.stats;
  let topLines = "";
  if (stats) {
    const allPlayers = [];
    for (const side of ["home","away"]) {
      const players = stats[side]?.players || {};
      for (const p of Object.values(players)) {
        const team = side === "home" ? home : away;
        if ((p.pass_yds||0) >= 200) allPlayers.push(`${p.name} (${team.name}): ${p.pass_yds} pass yds, ${p.pass_td||0} TD`);
        else if ((p.rush_yds||0) >= 80) allPlayers.push(`${p.name} (${team.name}): ${p.rush_yds} rush yds`);
        else if ((p.rec_yds||0) >= 80) allPlayers.push(`${p.name} (${team.name}): ${p.rec_yds} rec yds`);
      }
    }
    topLines = allPlayers.slice(0, 4).map(l => `<div class="frn-tip-bullet">• ${l}</div>`).join("");
  }
  tip.innerHTML = `
    <div class="frn-tip-head"><span style="font-weight:900">W${week}</span></div>
    <div style="margin-bottom:.25rem">
      <b>${away.name} ${g.awayScore}</b> @ <b>${home.name} ${g.homeScore}</b>
    </div>
    ${topLines || `<div class="frn-tip-bullet" style="color:var(--gray)">No stat lines recorded</div>`}
    <div class="frn-tip-foot">Click to see full box score</div>`;
  tip.style.display = "block";
  const rect = e.currentTarget.getBoundingClientRect();
  const tipW = tip.offsetWidth, tipH = tip.offsetHeight;
  let left = rect.right + 8;
  if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 8;
  let top = rect.top;
  if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
  if (top < 8) top = 8;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}
function frnPastGameTipHide() {
  const tip = document.getElementById("frn-pg-tip");
  if (tip) tip.style.display = "none";
}

function _buildWeekReviewCard(week, myId) {
  // Your team's game this week
  const myGame = franchise.schedule.find(g => g.week === week &&
    (g.homeId === myId || g.awayId === myId));
  const isHome = myGame && myGame.homeId === myId;
  const myScore = myGame ? (isHome ? myGame.homeScore : myGame.awayScore) : 0;
  const oppScore = myGame ? (isHome ? myGame.awayScore : myGame.homeScore) : 0;
  const opp = myGame ? getTeam(isHome ? myGame.awayId : myGame.homeId) : null;
  const won = myScore > oppScore;
  const resultTag = won ? `<span style="color:var(--green-lt)">W ${myScore}-${oppScore}</span>`
                        : `<span style="color:var(--red)">L ${myScore}-${oppScore}</span>`;

  // Top result lines: blowouts/upsets this week
  const weekNews = (franchise.news || []).filter(n => n.season === franchise.season && n.week === week).slice(-6);
  const newsLis = weekNews.length ? weekNews.map(n => `<li>${n.label}</li>`).join("")
                : `<li style="color:var(--gray);font-style:italic">Quiet week around the league.</li>`;

  // Weekly tasks count
  const negs = franchise.faNegotiations || {};
  const activeNegs = Object.values(negs).filter(n => n.state === "negotiating");
  const outbidCount = activeNegs.filter(n => {
    if (!n.yourBid) return false;
    const high = _faNegCurrentHigh(n);
    return high && !high.isYou;
  }).length;

  // Your injuries
  const myInjuries = (franchise.rosters[myId] || []).filter(p => p.injury && p.injury.weeksRemaining > 0);

  const tasksHtml = `
    <div class="frn-week-tasks">
      ${outbidCount > 0
        ? `<div class="frn-week-task urgent">
            <span>⚡ ${outbidCount} FA negotiation${outbidCount>1?"s":""} where you've been outbid</span>
            <button class="btn btn-gold" onclick="renderFrnFANegotiations()" style="font-size:.65rem">Respond</button>
          </div>` : ""}
      ${activeNegs.length > outbidCount
        ? `<div class="frn-week-task">
            <span>🆓 ${activeNegs.length - outbidCount} FA negotiation${activeNegs.length-outbidCount>1?"s":""} active</span>
            <button class="btn btn-outline" onclick="renderFrnFANegotiations()" style="font-size:.65rem">View</button>
          </div>` : ""}
      ${myInjuries.length
        ? `<div class="frn-week-task">
            <span>🩹 ${myInjuries.length} player${myInjuries.length>1?"s":""} on injured list</span>
          </div>` : ""}
      ${(() => {
        const pendingTrades = (franchise.tradeOffers||[]).filter(o => o.status === "pending");
        return pendingTrades.length
          ? `<div class="frn-week-task urgent">
              <span>📨 ${pendingTrades.length} trade offer${pendingTrades.length>1?"s":""} pending</span>
              <button class="btn btn-gold" onclick="frnOpenTrade(null,'offers')" style="font-size:.65rem">Review</button>
            </div>`
          : "";
      })()}
      ${week <= TRADE_DEADLINE_WEEK
        ? `<div class="frn-week-task">
            <span>🔀 Trade deadline: Week ${TRADE_DEADLINE_WEEK} (${TRADE_DEADLINE_WEEK - week} weeks left)</span>
            <button class="btn btn-outline" onclick="frnOpenTrade()" style="font-size:.65rem">Trade Block</button>
          </div>` : ""}
    </div>`;

  return `
    <div class="frn-next-card" style="border-color:var(--gold-lt)">
      <div class="frn-next-header">
        <span>WEEK ${week} COMPLETE</span>
        <span class="frn-next-badge">REVIEW</span>
      </div>
      <div style="text-align:center;margin-bottom:.7rem">
        <div style="font-size:.7rem;color:var(--gray);letter-spacing:.5px;margin-bottom:.2rem">YOUR GAME</div>
        <div style="font-size:1.1rem;font-weight:900">
          ${resultTag} ${opp ? `${isHome?"vs":"@"} ${teamLink(opp)}` : ""}
        </div>
      </div>
      <div class="frn-card-title" style="margin-top:.4rem">📰 LEAGUE WIRE — WEEK ${week}</div>
      <ul class="frn-week-news">${newsLis}</ul>
      <div class="frn-card-title" style="margin-top:.6rem">📋 WEEKLY TASKS</div>
      ${tasksHtml}
      <div class="frn-next-actions">
        <button class="btn btn-gold-big" onclick="frnAdvanceWeek()">▶ ADVANCE TO WEEK ${week + 1}</button>
        <button class="btn btn-outline" onclick="frnSimSeason()" style="color:var(--gray)">⏭⏭ Sim Rest of Season</button>
      </div>
    </div>`;
}

// ── Opponent intel block: shown beneath the next-game matchup card ────────────
// Pulls recent form, PPG / PA averages, injury list, current top performers,
// and head-to-head this season — all data we already have. Marked OPP INTEL
// so the user knows where it comes from.
// Late-season "must-win" detection — flagged in opp intel banner.
// True when (a) week ≥ 10 and (b) user trails in division OR on the
// playoff bubble (rank 7 or 8 in their conference).
function _isMustWinForUser(week, nextGame) {
  if (week < 10) return false;
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const oppId = nextGame.homeId === myId ? nextGame.awayId : nextGame.homeId;
  const opp = getTeam(oppId);
  // (a) Division opponent + I'm not currently leading
  if (opp && myTeam && opp.division === myTeam.division && opp.conference === myTeam.conference) {
    const divTeams = standingsSorted().filter(t => t.team?.division === myTeam.division && t.team?.conference === myTeam.conference);
    if (divTeams[0]?.id !== myId) return true;
  }
  // (b) On the playoff bubble in own conference
  const confTeams = standingsSorted().filter(t => t.team?.conference === myTeam.conference);
  const myRank = confTeams.findIndex(t => t.id === myId) + 1;
  if (myRank >= 5 && myRank <= 8) return true;
  return false;
}

function _buildOpponentIntelBlock(oppId, isHome, week, nextGame) {
  const myId = franchise.chosenTeamId;
  const opp = getTeam(oppId);
  if (!opp) return "";
  const oppStand = franchise.standings?.[oppId] || { w:0, l:0, t:0, pf:0, pa:0 };
  const gp = (oppStand.w||0) + (oppStand.l||0) + (oppStand.t||0);
  const ppg = gp ? ((oppStand.pf||0) / gp).toFixed(1) : "—";
  const paPg = gp ? ((oppStand.pa||0) / gp).toFixed(1) : "—";
  const diff = (oppStand.pf||0) - (oppStand.pa||0);
  const diffColor = diff > 0 ? "var(--green-lt)" : diff < 0 ? "#c08080" : "var(--gray)";
  const diffStr = `${diff > 0 ? "+" : ""}${diff}`;
  // Last 3 results
  const lastGames = (franchise.schedule || [])
    .filter(g => g.played && (g.homeId === oppId || g.awayId === oppId))
    .sort((a, b) => b.week - a.week).slice(0, 3);
  const formHtml = lastGames.length ? lastGames.map(g => {
    const oppIsHome = g.homeId === oppId;
    const my = oppIsHome ? g.homeScore : g.awayScore;
    const them = oppIsHome ? g.awayScore : g.homeScore;
    const otherTeam = getTeam(oppIsHome ? g.awayId : g.homeId);
    const wl = my > them ? "W" : my < them ? "L" : "T";
    const wlColor = wl === "W" ? "var(--green-lt)" : wl === "L" ? "#c08080" : "var(--gray)";
    return `<span class="frn-opp-form-pill" style="color:${wlColor}" title="W${g.week} ${oppIsHome?"vs":"@"} ${otherTeam?.name||"?"}">${wl} ${my}-${them}</span>`;
  }).join(" ") : `<span style="color:var(--gray);font-style:italic">No prior games</span>`;

  // Top players — pulled by scout grade with whatever intel level we have
  const myRosterSorted = (franchise.rosters[myId] || []).slice()
    .sort((a, b) => scoutGrade(b) - scoutGrade(a));
  const oppRoster = (franchise.rosters[oppId] || []).slice()
    .sort((a, b) => scoutGrade(b) - scoutGrade(a));
  const scouted = !!franchise.scoutingIntel?.[oppId] &&
    franchise.scoutingIntel[oppId].season === franchise.season;

  // Side-by-side starters comparison
  const keyPositions = ["QB","RB","WR","DL","LB","CB"];
  const myTeam = getTeam(myId);
  const starterRows = keyPositions.map(pos => {
    const myP  = myRosterSorted.find(p => p.position === pos);
    const oppP = oppRoster.find(p => p.position === pos);
    if (!myP && !oppP) return "";
    const myCell = myP
      ? `<span style="font-weight:700;font-size:.68rem">${playerLinkByName(myP.name)}</span>
         <span>${gradeBadge(myP)}</span>
         <span style="color:var(--gray);font-size:.58rem">Age ${myP.age||"?"}</span>`
      : `<span style="color:var(--gray);font-size:.65rem">—</span>`;
    const oppCell = oppP
      ? `<span style="color:var(--gray);font-size:.58rem">Age ${oppP.age||"?"}</span>
         <span>${gradeBadge(oppP)}</span>
         <span style="font-weight:700;font-size:.68rem">${playerLinkByName(oppP.name)}</span>`
      : `<span style="color:var(--gray);font-size:.65rem">—</span>`;
    return `<div class="frn-matchup-starters-row">
      <div class="frn-matchup-starter-my">${myCell}</div>
      <span class="frn-opp-keyplayer-pos">${pos}</span>
      <div class="frn-matchup-starter-opp">${oppCell}</div>
    </div>`;
  }).join("");

  // Both teams' injuries
  const myInjured  = myRosterSorted.filter(p => p.injury && p.injury.weeksRemaining > 0).slice(0, 3);
  const oppInjured = oppRoster.filter(p => p.injury && p.injury.weeksRemaining > 0).slice(0, 4);
  const allInjuries = [
    ...myInjured.map(p => ({ side: "YOU", p, color: "#ffb0b0" })),
    ...oppInjured.map(p => ({ side: "OPP", p, color: "#ff9090" })),
  ];
  const injuryHtml = allInjuries.length ? `
    <div class="frn-opp-intel-row">
      <div class="frn-card-title" style="margin-bottom:.3rem">🩹 INJURY REPORT</div>
      ${allInjuries.map(({ side, p, color }) => `
        <div style="font-size:.68rem;color:${color};display:flex;gap:.4rem;align-items:center;padding:.1rem 0">
          <span style="color:${side==="YOU"?"var(--gold-lt)":"#c08080"};font-size:.55rem;font-weight:700;border:1px solid currentColor;padding:.05rem .22rem;flex-shrink:0">${side}</span>
          ${p.position} ${playerLinkByName(p.name)} — ${_bspnEsc(p.injury.label)} (${p.injury.weeksRemaining}wk)
        </div>`).join("")}
    </div>` : "";

  // Head-to-head this season
  const h2h = (franchise.schedule || []).filter(g => g.played &&
    ((g.homeId === oppId && g.awayId === myId) ||
     (g.awayId === oppId && g.homeId === myId)));
  const h2hHtml = h2h.length ? `
    <div class="frn-opp-intel-row">
      <div class="frn-card-title" style="margin-bottom:.25rem">📜 HEAD-TO-HEAD (S${franchise.season})</div>
      ${h2h.map(g => {
        const youHome = g.homeId === myId;
        const youScore = youHome ? g.homeScore : g.awayScore;
        const themScore = youHome ? g.awayScore : g.homeScore;
        const wl = youScore > themScore ? "W" : youScore < themScore ? "L" : "T";
        const color = wl === "W" ? "var(--green-lt)" : wl === "L" ? "#c08080" : "var(--gray)";
        return `<div style="font-size:.7rem">
          <span style="color:${color};font-weight:700">${wl}</span>
          ${youScore}-${themScore} (Wk ${g.week}, ${youHome?"home":"away"})
          <a href="javascript:void(0)" onclick="renderFrnPastGame(${g.week},${g.homeId},${g.awayId})"
             style="color:var(--gold);margin-left:.3rem">box →</a>
        </div>`;
      }).join("")}
    </div>` : "";

  const intelTag = scouted
    ? `<span class="frn-opp-intel-tag scouted">🏟 SCOUTED — sharp grades</span>`
    : `<span class="frn-opp-intel-tag">noisy grades · run a scrimmage to sharpen</span>`;

  const venueStr = isHome ? `Home — ${getTeam(myId).city}` : `Away @ ${opp.city}`;
  const mustWinTag = _isMustWinForUser(week, nextGame)
    ? `<span style="color:#ff5a5a;background:rgba(255,80,80,0.15);border:1px solid #ff5a5a;padding:.1rem .35rem;margin-left:.4rem;font-size:.55rem;letter-spacing:.5px">🚨 MUST WIN</span>`
    : "";

  return `<div class="frn-opp-intel">
    <div class="frn-opp-intel-head">
      <div class="frn-card-title" style="margin:0">📡 MATCHUP INTEL — ${opp.city} ${opp.name} ${mustWinTag}</div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <span style="color:var(--gray);font-size:.62rem">${venueStr}</span>
        ${intelTag}
      </div>
    </div>
    <div class="frn-opp-intel-grid">
      <div class="frn-opp-intel-row">
        <div class="frn-card-title" style="margin-bottom:.25rem">FORM (LAST 3) · ${opp.name.toUpperCase()}</div>
        <div style="display:flex;gap:.35rem;flex-wrap:wrap">${formHtml}</div>
      </div>
      <div class="frn-opp-intel-row">
        <div class="frn-card-title" style="margin-bottom:.25rem">SCORING · ${opp.name.toUpperCase()}</div>
        <div style="font-size:.7rem">
          PPG <b style="color:var(--gold-lt)">${ppg}</b> · PAPG <b style="color:var(--gold-lt)">${paPg}</b>
          · DIFF <b style="color:${diffColor}">${diffStr}</b>
        </div>
      </div>
    </div>
    <div class="frn-opp-intel-row">
      <div class="frn-matchup-starters-header">
        <span style="color:var(--gold-lt)">${myTeam ? myTeam.name.toUpperCase() : "YOU"}</span>
        <div class="frn-card-title" style="margin:0;border:none;padding:0">KEY STARTERS</div>
        <span style="color:#c08080">${opp.name.toUpperCase()}</span>
      </div>
      <div class="frn-matchup-starters">${starterRows}</div>
    </div>
    ${injuryHtml}
    ${h2hHtml}
  </div>`;
}

function _buildMatchupStatsStrip(myId, oppId, myStand, oppStand, myRtg, oppRtg) {
  const myGP  = (myStand.w||0)  + (myStand.l||0)  + (myStand.t||0);
  const oppGP = (oppStand.w||0) + (oppStand.l||0) + (oppStand.t||0);
  const myPPG   = myGP  ? ((myStand.pf||0)  / myGP).toFixed(1)  : "—";
  const myPAPG  = myGP  ? ((myStand.pa||0)  / myGP).toFixed(1)  : "—";
  const oppPPG  = oppGP ? ((oppStand.pf||0) / oppGP).toFixed(1) : "—";
  const oppPAPG = oppGP ? ((oppStand.pa||0) / oppGP).toFixed(1) : "—";
  const myDiff  = (myStand.pf||0)  - (myStand.pa||0);
  const oppDiff = (oppStand.pf||0) - (oppStand.pa||0);

  const formPills = (teamId) => {
    const games = (franchise.schedule || [])
      .filter(g => g.played && (g.homeId === teamId || g.awayId === teamId))
      .sort((a, b) => b.week - a.week).slice(0, 3);
    if (!games.length) return `<span style="color:var(--gray)">—</span>`;
    return games.map(g => {
      const isH = g.homeId === teamId;
      const my = isH ? g.homeScore : g.awayScore;
      const them = isH ? g.awayScore : g.homeScore;
      const wl = my > them ? "W" : my < them ? "L" : "T";
      const c = wl === "W" ? "var(--green-lt)" : wl === "L" ? "#c08080" : "var(--gray)";
      return `<span class="frn-opp-form-pill" style="color:${c}">${wl}</span>`;
    }).join("");
  };

  const statRow = (label, myVal, oppVal, higherBetter = true) => {
    const mn = parseFloat(myVal), on = parseFloat(oppVal);
    const myEdge  = !isNaN(mn) && !isNaN(on) && (higherBetter ? mn > on : mn < on);
    const oppEdge = !isNaN(mn) && !isNaN(on) && (higherBetter ? on > mn : on < mn);
    return `<div class="frn-matchup-stat-row">
      <span class="frn-matchup-stat-val ${myEdge ? "edge" : ""}">${myVal}</span>
      <span class="frn-matchup-stat-label">${label}</span>
      <span class="frn-matchup-stat-val ${oppEdge ? "edge" : ""}">${oppVal}</span>
    </div>`;
  };

  // Simple win probability from OFF+DEF delta
  const myTotal  = (myRtg.off  || 0) + (myRtg.def  || 0);
  const oppTotal = (oppRtg.off || 0) + (oppRtg.def || 0);
  const rawPct   = Math.round(50 + (myTotal - oppTotal) * 0.35);
  const myWinPct = Math.min(84, Math.max(16, rawPct));
  const edgeLabel = myWinPct > 53 ? `YOU FAV ${myWinPct}%`
    : myWinPct < 47 ? `OPP FAV ${100 - myWinPct}%`
    : "PICK 'EM";
  const edgeColor = myWinPct > 53 ? "var(--green-lt)"
    : myWinPct < 47 ? "#c08080"
    : "var(--gold)";

  return `<div class="frn-matchup-compare">
    <div class="frn-matchup-compare-title">SEASON STATS MATCHUP</div>
    <div class="frn-matchup-stat-row">
      <div style="display:flex;justify-content:flex-end;gap:.2rem">${formPills(myId)}</div>
      <span class="frn-matchup-stat-label">FORM L3</span>
      <div style="display:flex;justify-content:flex-start;gap:.2rem">${formPills(oppId)}</div>
    </div>
    ${statRow("PPG", myPPG, oppPPG, true)}
    ${statRow("PAPG", myPAPG, oppPAPG, false)}
    ${statRow("PT DIFF", myDiff >= 0 ? `+${myDiff}` : String(myDiff), oppDiff >= 0 ? `+${oppDiff}` : String(oppDiff), true)}
    ${statRow("OFF", myRtg.off, oppRtg.off, true)}
    ${statRow("DEF", myRtg.def, oppRtg.def, true)}
    <div class="frn-matchup-edge-row">
      <span></span>
      <span style="color:${edgeColor};font-weight:900;font-size:.62rem;letter-spacing:.5px">⚡ ${edgeLabel}</span>
      <span></span>
    </div>
  </div>`;
}

// ── Highlight Replay Modal ────────────────────────────────────────────────────
function renderHighlightReplay(idx) {
  const h = (franchise.seasonHighlights || [])[idx];
  if (!h) return;
  const { label, type, week, isPlayoff, isClutch, clip,
          homeId, awayId, finalHome, finalAway } = h;
  const homeTeam = getTeam(homeId), awayTeam = getTeam(awayId);
  const homeName = homeTeam?.name || "HOME", awayName = awayTeam?.name || "AWAY";
  const typeColor = type === "def" ? "#4dbdbd" : type === "game" ? "#a78bfa" : "#f5c542";
  const typeBadge = type === "def" ? (isClutch ? "CLUTCH DEF" : "DEF")
                  : type === "game" ? (isClutch ? "OT" : "GAME")
                  : (isClutch ? "CLUTCH" : "OFF");

  // Fallback clip for old saves without stored clip data
  const plays = clip?.length
    ? clip
    : [{ sit: h.quarter ? `Q${h.quarter}${h.time ? " · " + h.time : ""}` : "",
         desc: label, hs: finalHome ?? 0, as: finalAway ?? 0,
         q: h.quarter, t: h.time, hi: true }];

  const playsHtml = plays.map((cp, i) => `
    <div class="frn-replay-play${cp.hi ? " frn-replay-hl" : ""}" style="animation-delay:${i * 0.52}s;border-color:${cp.hi ? typeColor + "44" : "transparent"};background:${cp.hi ? typeColor + "0d" : "transparent"}">
      ${cp.sit ? `<div class="frn-replay-sit">${cp.sit}</div>` : ""}
      <div class="frn-replay-desc ${cp.hi ? "" : "frn-replay-ctx"}">${cp.desc || (cp.hi ? label : "—")}</div>
      ${cp.hi && isClutch ? `<div class="frn-replay-clutch">⚡ CLUTCH MOMENT</div>` : ""}
      ${cp.hi ? `<div class="frn-replay-score-line">${homeName} <strong>${cp.hs}</strong> — ${awayName} <strong>${cp.as}</strong></div>` : ""}
    </div>`).join("");

  const existing = document.getElementById("frn-replay-modal");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.id = "frn-replay-modal";
  el.className = "frn-replay-overlay";
  el.innerHTML = `
    <div class="frn-replay-box">
      <div class="frn-replay-header">
        <div style="display:flex;align-items:center;gap:.65rem">
          <span class="bspnlive-logo" style="font-size:.85rem;padding:.1rem .35rem">BSPN</span>
          <span style="color:var(--blgray);font-size:.68rem;letter-spacing:.8px">${week}${isPlayoff ? " · PLAYOFF" : ""}</span>
          <span class="frn-hl-badge" style="color:${typeColor};border-color:${typeColor}55">${typeBadge}</span>
        </div>
        <button class="frn-replay-close" onclick="_closeHighlightReplay()">✕</button>
      </div>
      <div class="frn-replay-scoreboard">
        <span class="frn-replay-team">${homeName}</span>
        <span class="frn-replay-score-num">${finalHome ?? "?"}</span>
        <span class="frn-replay-score-sep">–</span>
        <span class="frn-replay-score-num">${finalAway ?? "?"}</span>
        <span class="frn-replay-team">${awayName}</span>
      </div>
      <div class="frn-replay-plays" id="frn-replay-plays-${idx}">${playsHtml}</div>
      <div class="frn-replay-footer">
        <button class="frn-cap-btn" onclick="_replayAgain(${idx})" style="font-size:.63rem">▶ Replay</button>
        <button class="frn-cap-btn" onclick="_closeHighlightReplay()" style="font-size:.63rem">Close</button>
      </div>
    </div>`;
  el.addEventListener("click", e => { if (e.target === el) _closeHighlightReplay(); });
  document.body.appendChild(el);
}

function _replayAgain(idx) {
  const list = document.getElementById(`frn-replay-plays-${idx}`);
  if (!list) return;
  list.querySelectorAll(".frn-replay-play").forEach((el, i) => {
    el.style.opacity = "0";
    el.style.animation = "none";
    el.offsetHeight; // force reflow
    el.style.animation = `frn-replay-fade .35s ease ${i * 0.52}s forwards`;
  });
}

function _closeHighlightReplay() {
  const el = document.getElementById("frn-replay-modal");
  if (el) el.remove();
}

function _buildHighlightsSidebar(teamId, seasonHighlights) {
  const allHL = franchise.seasonHighlights || [];
  // Keep track of each highlight's index in the master array for replay lookup
  const myHLIdx = allHL
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.homeId === teamId || h.awayId === teamId);

  if (!myHLIdx.length) return `<div style="color:var(--gray);font-size:.72rem;padding:.5rem 0">Highlights appear as you play.</div>`;

  // Numeric sort key: playoff games rank above regular season
  const weekOrd = h => {
    if (h.weekNum != null) return h.weekNum;
    if (h.isPlayoff) return 100 + (parseInt(h.week?.match(/\d+/)?.[0]) || 0);
    return parseInt(h.week?.match(/\d+/)?.[0]) || 0;
  };

  // Group by game (home-away-week triplet)
  const games = {};
  for (const { h, i } of myHLIdx) {
    const k = `${h.homeId}|${h.awayId}|${h.week}`;
    if (!games[k]) games[k] = { ord: weekOrd(h), items: [] };
    games[k].items.push({ h, i });
  }
  const sortedGames = Object.values(games).sort((a, b) => b.ord - a.ord);

  // Opponent context + win/loss line
  const hlCtx = (h) => {
    const oppId = h.homeId === teamId ? h.awayId : h.homeId;
    const opp   = getTeam(oppId);
    const abbr  = opp?.abbreviation || opp?.name?.slice(0, 3).toUpperCase() || "OPP";
    if (h.finalHome == null) return `vs. ${abbr}`;
    const myPts  = h.homeId === teamId ? h.finalHome : h.finalAway;
    const oppPts = h.homeId === teamId ? h.finalAway  : h.finalHome;
    const wl = myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T";
    return `vs. ${abbr} — ${wl} ${myPts}-${oppPts}`;
  };

  // Visual config per type
  const typeCfg = (h) => {
    if (h.type === "def")  return { badge: h.isClutch ? "CLUTCH DEF" : "DEF",  color: "#4dbdbd" };
    if (h.type === "game") return { badge: h.isClutch ? "OT"          : "GAME", color: "#a78bfa" };
    return                        { badge: h.isClutch ? "CLUTCH"      : "OFF",  color: "#f5c542" };
  };

  // ── Featured card: best moment from most recent game ─────────────────────
  const latestGame = sortedGames[0];
  const latestSorted = latestGame.items.sort((a, b) => b.h.weight - a.h.weight);
  const { h: feat, i: featIdx } = latestSorted[0];
  const { badge: fBadge, color: fColor } = typeCfg(feat);
  const featHtml = `
    <div class="frn-hl-feat" style="border-color:${fColor}33;background:${fColor}0d">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.28rem">
        <span class="frn-hl-badge" style="color:${fColor};border-color:${fColor}55">${fBadge}</span>
        <span style="font-size:.57rem;color:var(--gray);letter-spacing:.3px">${feat.week}${feat.isPlayoff ? " · PLAYOFF" : ""}</span>
      </div>
      <div style="font-size:.6rem;color:var(--gray);margin-bottom:.3rem">${hlCtx(feat)}</div>
      <div style="font-size:.8rem;color:var(--blwhite);font-weight:700;line-height:1.3">${feat.label}</div>
      ${feat.isClutch ? `<div style="font-size:.57rem;color:#f87171;margin-top:.22rem;letter-spacing:.5px">⚡ CLUTCH MOMENT</div>` : ""}
      <button class="frn-replay-btn" onclick="renderHighlightReplay(${featIdx})" style="margin-top:.4rem">▶ Replay</button>
    </div>`;

  // ── Compact rows: top pick from each prior game (up to 4) ────────────────
  const priorBests = sortedGames.slice(1)
    .map(g => g.items.sort((a, b) => b.h.weight - a.h.weight)[0])
    .slice(0, 4);
  const compactHtml = priorBests.map(({ h, i }) => {
    const { badge, color } = typeCfg(h);
    return `
      <div class="frn-hl-row2" style="cursor:pointer" onclick="renderHighlightReplay(${i})">
        <span class="frn-hl2-badge" style="color:${color}">${badge}</span>
        <span class="frn-hl2-label">${h.label}</span>
        <span class="frn-hl2-week">${h.week}</span>
        <span style="font-size:.57rem;color:var(--gray);flex-shrink:0">▶</span>
      </div>`;
  }).join("");

  const totalGames = sortedGames.length;
  const moreBtn = totalGames > 5
    ? `<button class="frn-cap-btn" onclick="renderFrnHighlightsAll()" style="margin-top:.45rem;font-size:.6rem;width:100%">View all ${myHLIdx.length} moments →</button>`
    : "";

  return `
    ${featHtml}
    ${compactHtml ? `<div class="frn-hl-section-sep">SEASON MOMENTS</div>${compactHtml}` : ""}
    ${moreBtn}`;
}

function renderFrnHighlightsAll() {
  const { chosenTeamId, season } = franchise;
  const myTeam = getTeam(chosenTeamId);
  const allHL = franchise.seasonHighlights || [];
  // Keep master indices so replay modal can look them up
  const myHLIdx = allHL
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.homeId === chosenTeamId || h.awayId === chosenTeamId);

  const weekOrd = h => {
    if (h.isPlayoff) return 100 + (parseInt(h.week?.match(/\d+/)?.[0]) || 0);
    return parseInt(h.week?.match(/\d+/)?.[0]) || 0;
  };
  const games = {};
  for (const { h, i } of myHLIdx) {
    const k = `${h.homeId}|${h.awayId}|${h.week}`;
    if (!games[k]) games[k] = { ord: weekOrd(h), week: h.week, isPlayoff: h.isPlayoff, homeId: h.homeId, awayId: h.awayId, items: [] };
    games[k].items.push({ h, i });
  }
  const sortedGames = Object.values(games).sort((a, b) => b.ord - a.ord);

  const typeCfg = (h) => {
    if (h.type === "def")  return { badge: h.isClutch ? "CLUTCH DEF" : "DEF",  color: "#4dbdbd" };
    if (h.type === "game") return { badge: h.isClutch ? "OT"          : "GAME", color: "#a78bfa" };
    return                        { badge: h.isClutch ? "CLUTCH"      : "OFF",  color: "#f5c542" };
  };
  const hlCtx = (h) => {
    const oppId = h.homeId === chosenTeamId ? h.awayId : h.homeId;
    const opp   = getTeam(oppId);
    const abbr  = opp?.abbreviation || opp?.name?.slice(0, 3).toUpperCase() || "OPP";
    if (h.finalHome == null) return `vs. ${abbr}`;
    const myPts  = h.homeId === chosenTeamId ? h.finalHome : h.finalAway;
    const oppPts = h.homeId === chosenTeamId ? h.finalAway  : h.finalHome;
    const wl = myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T";
    return `vs. ${abbr} — ${wl} ${myPts}-${oppPts}`;
  };

  const blocksHtml = sortedGames.map(g => {
    const sorted = g.items.sort((a, b) => b.h.weight - a.h.weight);
    const ctx = hlCtx(sorted[0].h);
    const rows = sorted.map(({ h, i }) => {
      const { badge, color } = typeCfg(h);
      return `
        <div class="frn-hl-row2" style="padding:.35rem 0;cursor:pointer" onclick="renderHighlightReplay(${i})">
          <span class="frn-hl2-badge" style="color:${color}">${badge}</span>
          <span class="frn-hl2-label" style="white-space:normal">${h.label}</span>
          ${h.isClutch ? `<span style="font-size:.57rem;color:#f87171">⚡</span>` : ""}
          <span style="font-size:.57rem;color:var(--blgray);flex-shrink:0">▶</span>
        </div>`;
    }).join("");
    return `
      <section class="bspn-panel" style="margin-bottom:.75rem">
        <div class="bspn-panel-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>${g.week}${g.isPlayoff ? " · PLAYOFF" : ""}</span>
          <span style="color:var(--blgray);font-size:.67rem;font-weight:400">${ctx}</span>
        </div>
        ${rows}
      </section>`;
  }).join("");

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0;padding-bottom:1rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">SEASON ${season} HIGHLIGHTS</div>
        </div>
        <nav class="bspnlive-nav">${_bspnNavHtml("")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder)">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Back to Dashboard</button>
      </div>
      <div style="padding:1rem 1.4rem">
        <div style="color:var(--blgold);font-size:.7rem;letter-spacing:1.5px;margin-bottom:.75rem">${myTeam?.name?.toUpperCase()} · ${myHL.length} MOMENTS ACROSS ${sortedGames.length} GAMES</div>
        ${blocksHtml || `<div style="color:var(--blgray);padding:1rem">No highlights yet — play some games!</div>`}
      </div>
    </div>`;
}

function _frnCheckItem(key) {
  const { season, week } = franchise;
  if (!franchise._weeklyChecklist) franchise._weeklyChecklist = {};
  if (!franchise._weeklyChecklist[season]) franchise._weeklyChecklist[season] = {};
  if (!franchise._weeklyChecklist[season][week]) franchise._weeklyChecklist[season][week] = {};
  franchise._weeklyChecklist[season][week][key] = true;
  _scheduleSaveFranchise();
}

function renderFrnRegular() {
  const { chosenTeamId, season, week, schedule, standings, seasonHighlights } = franchise;
  const myTeam  = getTeam(chosenTeamId);
  const myStand = standings[chosenTeamId] || { w:0, l:0, t:0, pf:0, pa:0 };

  const myGames  = schedule
    .filter(g => g.homeId === chosenTeamId || g.awayId === chosenTeamId)
    .sort((a, b) => a.week - b.week);
  const nextGame = myGames.find(g => !g.played) || null;
  const sorted   = standingsSorted();
  const seasonDone = week > FRANCHISE_WEEKS;
  const recStr  = `${myStand.w}-${myStand.l}${myStand.t ? `-${myStand.t}` : ""}`;
  const myRtg   = frnTeamRating(chosenTeamId);

  const myRoster = franchise.rosters[chosenTeamId] || [];

  // ─── Cap ───────────────────────────────────────────────────────────────
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const capUsed = capUsedByTeam(chosenTeamId);
  const capPct  = Math.round(capUsed / cap * 100);
  const capColor = capPct >= 95 ? "var(--red)" : capPct >= 85 ? "#e8a000" : "var(--green-lt)";
  const refundsInfo = refundsForTeam(chosenTeamId);
  const refundLine = (refundsInfo.outgoingTotal || refundsInfo.incomingTotal)
    ? ` · ${refundsInfo.outgoingTotal > 0 ? `<span style="color:var(--red);font-size:.6rem">Fees −$${refundsInfo.outgoingTotal.toFixed(1)}M</span>` : ""}${refundsInfo.incomingTotal > 0 ? `<span style="color:var(--green-lt);font-size:.6rem">+$${refundsInfo.incomingTotal.toFixed(1)}M</span>` : ""}`
    : "";

  // ─── FA negotiations ──────────────────────────────────────────────────
  const negs = franchise.faNegotiations || {};
  const activeNegs = Object.values(negs).filter(n => n.state === "negotiating");
  const myActiveNegs = activeNegs.filter(n => n.yourBid);
  const outbidCount  = myActiveNegs.filter(n => { const h = _faNegCurrentHigh(n); return h && !h.isYou; }).length;

  // ─── Contextual data ──────────────────────────────────────────────────
  const injured  = myRoster.filter(p => p.injury && p.injury.weeksRemaining > 0);
  const demands  = (franchise.holdoutDemands || []).filter(d => d.deadlineWeek >= week);
  const psAlerts = (franchise.psPoachAlerts || []).filter(a => a.ownerTeamId === chosenTeamId && a.deadlineWeek >= week).length;

  // Form strip: last 5 results
  const playedGames = myGames.filter(g => g.played).slice(-5);
  const formStrip = playedGames.map(g => {
    const isHome = g.homeId === chosenTeamId;
    const my = isHome ? g.homeScore : g.awayScore;
    const their = isHome ? g.awayScore : g.homeScore;
    const r = my > their ? "W" : my < their ? "L" : "T";
    const col = r === "W" ? "var(--green-lt)" : r === "L" ? "var(--red)" : "var(--gray)";
    return `<span style="color:${col};font-weight:900">${r}</span>`;
  }).join("<span style='color:var(--border)'>·</span>");

  // Playoff position
  const myPos    = sorted.findIndex(s => s.id === chosenTeamId) + 1;
  const inPlayoffs = myPos > 0 && myPos <= PLAYOFF_TEAMS;
  const leader   = sorted[0];
  const gamesBack = leader && leader.id !== chosenTeamId
    ? ((leader.w - myStand.w) - (myStand.l - leader.l)) / 2 : 0;
  const playoffStr = inPlayoffs
    ? `<span style="color:var(--green-lt);font-size:.6rem;font-weight:700">#${myPos} SEED · IN</span>`
    : `<span style="color:var(--gray);font-size:.6rem">#${myPos} · ${gamesBack > 0 ? gamesBack.toFixed(1)+" GB" : "out"}</span>`;

  // Snap/stamina conflicts
  const dcLocal  = franchise.depthChart?.[chosenTeamId] || {};
  const ssLocal  = franchise.snapShares?.[chosenTeamId] || {};
  const byPidDash = {};
  for (const p of myRoster) byPidDash[p.pid] = p;
  let snapConflicts = 0;
  for (const [key, slot] of Object.entries(dcLocal)) {
    const starter = slot.starter ? byPidDash[slot.starter] : null;
    const share   = ssLocal[key];
    if (starter && share) {
      const stam = starter._stamina ?? 75;
      const pct  = share.starterPct ?? 75;
      if ((pct > 80 && stam < 55) || (pct > 65 && stam < 65)) snapConflicts++;
    }
  }

  // POTW
  const potwSeason   = franchise.potw?.[season] || {};
  const potwWks      = Object.keys(potwSeason).map(Number).sort((a,b) => b-a);
  const latestPotwWk = potwWks[0];
  const latestPotw   = latestPotwWk != null ? potwSeason[latestPotwWk] : null;
  const candWeeks    = Object.keys(franchise.potwCandidates?.[season] || {}).map(Number).sort((a,b)=>b-a);
  const votesByWeek  = franchise.potwVotes?.[season] || {};
  const unvotedWeek  = candWeeks.find(w => !votesByWeek[w]);

  // ─── Banner (compact, 3-zone) ─────────────────────────────────────────
  const bannerHtml = `
    <div class="frn-team-banner frn-dash-banner" style="--banner-color:${myTeam.primary}">
      <div class="frn-banner-stripe"></div>
      <div class="frn-banner-ascii">${teamAscii(myTeam)}</div>
      <div class="frn-banner-info">
        <div class="frn-banner-name">${myTeam.city.toUpperCase()} ${myTeam.name.toUpperCase()}</div>
        <div class="frn-banner-sub">
          Season ${season} · Week ${Math.min(week, FRANCHISE_WEEKS)} of ${FRANCHISE_WEEKS} ·
          PF ${myStand.pf} / PA ${myStand.pa} · OFF ${myRtg.off} · DEF ${myRtg.def}
          ${playedGames.length ? ` · <span style="letter-spacing:.1rem">${formStrip}</span>` : ""}
        </div>
        <div class="frn-banner-cap" style="color:${capColor}">
          CAP $${capUsed.toFixed(1)}M / $${cap.toFixed(0)}M
          <span style="color:var(--gray);font-weight:400">· ${capPct}% used</span>${refundLine}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="frn-banner-record">${recStr}</div>
        <div class="frn-banner-record-sub">RECORD</div>
        <div style="margin-top:.3rem">${playoffStr}</div>
      </div>
    </div>`;

  // ─── Quick nav (secondary actions, out of the way) ────────────────────
  const quickNavHtml = `
    <div class="frn-quick-nav">
      <button class="frn-cap-btn" onclick="renderFrnAnalytics('mysheet')">📊 Analytics</button>
      ${week <= TRADE_DEADLINE_WEEK ? `<button class="frn-cap-btn" onclick="frnOpenTrade()">🔀 Trade</button>` : ""}
      <button class="frn-cap-btn" onclick="renderFrnChat()">💬 Chat${(()=>{ const u=(franchise.chat||[]).filter(m=>m.season===season&&m.week===week&&m.teamId!==chosenTeamId).length; return u?` (${u})`:""; })()}</button>
      <button class="frn-cap-btn" onclick="renderFrnNewsArchive()">📰 Wire</button>
      <button class="frn-cap-btn" onclick="renderFrnLegacy()">🏆 Legacy</button>
      <button class="frn-cap-btn" onclick="renderFrnAlumni()">🎓 Alumni</button>
      <button class="frn-cap-btn" onclick="renderFrnProjectedFAs()">📅 Future FAs</button>
      <button class="frn-cap-btn ${psAlerts?"frn-cap-btn-alert":""}" onclick="renderFrnPracticeSquad()">🏈 Practice Squad${psAlerts?` ⚠${psAlerts}`:""}</button>
      <button class="frn-cap-btn" onclick="renderFrnCoachingStaff()">🎩 Coaches</button>
      <button class="frn-cap-btn" onclick="renderFrnStandings()">📊 Standings</button>
      <button class="frn-cap-btn" onclick="renderFrnLeaders()">📈 Leaders</button>
    </div>`;

  // ─── Alert strip (urgent items only, above the grid) ─────────────────
  const alerts = [];
  const faNews = franchise._faLastNews;
  if (faNews && faNews.week === week - 1 && (faNews.signed.length + faNews.lost.length)) {
    alerts.push({ msg: `<b style="color:var(--gold)">📰 FA Wire W${faNews.week}:</b> ` +
      faNews.signed.map(s=>`<span style="color:var(--green-lt)">✓ ${s.name} $${s.aav.toFixed(1)}M</span>`).join(" ") + " " +
      faNews.lost.map(l=>`<span style="color:#c08080">✗ Lost ${l.name}</span>`).join(" ") });
  }
  demands.forEach(d => {
    const esc = d.name.replace(/'/g,"\\'");
    alerts.push({ urgent: true, msg: `<b style="color:#ffc850">📣 ${d.position} ${playerLinkByName(d.name)}</b> demands extension ~$${d.marketValue.toFixed(1)}M — Wk ${d.deadlineWeek} deadline <button class="frn-cap-btn" onclick="frnExtendPlayer('${esc}')" style="margin-left:.3rem">📝 Extend</button>` });
  });
  if (outbidCount) alerts.push({ urgent: true, msg: `<span style="color:var(--red)">⚡ Outbid on ${outbidCount} FA target${outbidCount>1?"s":""}!</span> <button class="frn-cap-btn" onclick="renderFrnFANegotiations()" style="color:var(--red);border-color:var(--red);margin-left:.3rem">View Bids</button>` });
  const wireItems = (franchise.news||[]).filter(n=>n.season===season).slice(-4).reverse();
  if (wireItems.length) alerts.push({ msg: `<span style="color:var(--gold);font-weight:700;font-size:.62rem;letter-spacing:.4px">WIRE</span> ${wireItems.map(n=>`<span style="color:var(--gray);font-size:.68rem">W${n.week}: ${n.label}</span>`).join(" · ")} <a href="javascript:void(0)" onclick="renderFrnNewsArchive()" style="color:var(--gold);font-size:.62rem;margin-left:auto;text-decoration:none">Archive →</a>` });
  const alertStripHtml = alerts.length ? `
    <div class="frn-alert-strip">
      ${alerts.map(a=>`<div class="frn-alert-item${a.urgent?" urgent":""}">${a.msg}</div>`).join("")}
    </div>` : "";

  // ─── Weekly checklist ────────────────────────────────────────────────
  const cl = franchise._weeklyChecklist?.[season]?.[week] || {};
  const mkItem = (key, icon, label, sub, action, urgent=false) => {
    const done = !!cl[key];
    return `<div class="frn-checklist-item${done?" done":""}${urgent&&!done?" urgent":""}"
      onclick="_frnCheckItem('${key}');${action}">
      <span class="frn-check-icon">${done?"✓":"○"}</span>
      <div class="frn-check-body">
        <div class="frn-check-label">${icon} ${label}</div>
        ${sub?`<div class="frn-check-sub">${sub}</div>`:""}
      </div>
      <span class="frn-check-arrow">›</span>
    </div>`;
  };
  const oppId0   = nextGame ? (nextGame.homeId === chosenTeamId ? nextGame.awayId : nextGame.homeId) : null;
  const oppName0 = oppId0 ? (getTeam(oppId0)?.name || "opponent") : "Bye week";
  const checklistItems = [
    mkItem("scout",    "🔍","Scout Opponent",    nextGame ? `vs ${oppName0}` : "Bye week",                           `renderFrnPreseason('scout')`),
    mkItem("depth",    "📋","Depth Chart",        "Set your starters",                                                 `renderFrnDepthChart()`),
    mkItem("snaps",    "⚡","Snap Percentages",   snapConflicts ? `⚠ ${snapConflicts} stamina conflict${snapConflicts>1?"s":""}` : "Optimize rotations", `renderFrnSnapShares()`, snapConflicts > 0),
    mkItem("practice", "🏟","Scrimmage",          "Run a joint practice",                                              `renderFrnScrimmages()`),
    mkItem("injuries", "🩹","Injury Report",      injured.length ? `${injured.length} player${injured.length>1?"s":""} out` : "All clear", `renderFrnInjuryReport()`, injured.length > 0),
    ...(activeNegs.length ? [mkItem("fa","🆓","FA Negotiations",`${activeNegs.length} active${outbidCount?` · ${outbidCount} outbid!`:""}`,`renderFrnFANegotiations()`,outbidCount>0)] : []),
    ...(demands.length ? [mkItem("extensions","📝","Extension Demands",`${demands.length} pending`,`renderFrnAnalytics('extensions')`,true)] : []),
    ...(week <= TRADE_DEADLINE_WEEK ? [mkItem("trade","🔀","Trade Window",`Open until Wk ${TRADE_DEADLINE_WEEK}`,`frnOpenTrade()`)] : []),
    ...(unvotedWeek!=null ? [mkItem("potw","🗳","POTW Vote",`Week ${unvotedWeek} candidates ready`,`renderPotwVoting(${unvotedWeek})`)] : []),
  ];
  const doneCount = checklistItems.filter(s => s.includes('class="frn-checklist-item done')).length;

  // ─── Unit bars ────────────────────────────────────────────────────────
  const ratings = buildRatings(myRoster);
  const unitRows = [
    ["QB", ratings.qb || Math.round(myRtg.off*.9)],
    ["WR", ratings.wr], ["RB", ratings.rb], ["OL", ratings.ol], ["TE", ratings.te||70],
    ["DL", ratings.dl], ["LB", ratings.lb], ["CB", ratings.cb], ["S", ratings.saf],
  ].map(([lbl, raw]) => {
    const val = Math.round(raw || 0);
    const pct = Math.round(Math.max(0, Math.min(100, (val - 50) / 49 * 100)));
    const col = val >= 82 ? "var(--green-lt)" : val >= 72 ? "var(--gold-lt)" : val >= 62 ? "var(--gray)" : "var(--red)";
    return `<div class="frn-unit-bar-row">
      <span class="frn-unit-bar-label">${lbl}</span>
      <div class="frn-unit-bar-track"><div class="frn-unit-bar-fill" style="width:${pct}%;background:${col}"></div></div>
      <span class="frn-unit-bar-val" style="color:${col}">${val}</span>
    </div>`;
  }).join("");

  // ─── Left column: checklist + unit bars ──────────────────────────────
  const leftColHtml = `
    <div>
      <div class="frn-card-box" style="padding:0">
        <div class="frn-card-title" style="padding:.5rem .7rem">WEEK ${week} TASKS <span class="frn-card-title-sub">${doneCount}/${checklistItems.length} done</span></div>
        <div class="frn-checklist">${checklistItems.join("")}</div>
      </div>
      <div class="frn-card-box" style="margin-top:1rem">
        <div class="frn-card-title">UNIT RATINGS</div>
        ${unitRows}
      </div>
    </div>`;

  // ─── Next-game card ────────────────────────────────────────────────────
  let nextCardHtml = "";
  const nextGameIsThisWeek = nextGame && nextGame.week === week;
  if (franchise.weekPending && !seasonDone) {
    nextCardHtml = _buildWeekReviewCard(week, chosenTeamId);
  } else if (nextGameIsThisWeek) {
    const isHome = nextGame.homeId === chosenTeamId;
    const oppId  = isHome ? nextGame.awayId : nextGame.homeId;
    const opp    = getTeam(oppId);
    const oppRtg = frnTeamRating(oppId);
    const oppStand = standings[oppId] || { w:0, l:0 };

    const teamCard = (team, rec, rtg, isUser) => `
      <div class="frn-next-team ${isUser ? "user" : ""}">
        <div class="frn-next-team-ascii">${teamAscii(team)}</div>
        <div class="frn-next-team-name">${team.name.toUpperCase()}</div>
        <div class="frn-next-team-city">${team.city}</div>
        <div class="frn-next-team-rec">${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ""}</div>
        <div class="frn-next-team-ratings">
          OFF <span class="v">${rtg.off}</span>
          DEF <span class="v">${rtg.def}</span>
        </div>
      </div>`;

    nextCardHtml = `
      <div class="frn-next-card">
        <div class="frn-next-header">
          <span>WEEK ${nextGame.week} · ${isHome ? "HOME GAME" : "AWAY GAME"}</span>
          <span class="frn-next-badge">NEXT UP</span>
        </div>
        <div class="frn-pregame-actions">
          <button class="frn-pregame-cta" onclick="frnPlayGame(${nextGame.homeId},${nextGame.awayId},false)">
            ▶ PLAY GAME <span class="frn-pregame-cta-sub">interactive · live simulation</span>
          </button>
          <div class="frn-pregame-sims">
            <button class="frn-sim-btn" onclick="frnSimGame(${nextGame.homeId},${nextGame.awayId})">⏩ Sim Game</button>
            <button class="frn-sim-btn" onclick="frnSimWeek()">⏭ Sim Week ${week}</button>
            <button class="frn-sim-btn frn-sim-season" onclick="frnSimSeason()">⏭⏭ Sim Season</button>
          </div>
        </div>
        <div class="frn-next-matchup">
          ${isHome
            ? teamCard(myTeam, myStand, myRtg, true)
            : teamCard(opp, oppStand, oppRtg, false)}
          <div class="frn-next-vs">VS</div>
          ${isHome
            ? teamCard(opp, oppStand, oppRtg, false)
            : teamCard(myTeam, myStand, myRtg, true)}
        </div>
        ${_buildMatchupStatsStrip(chosenTeamId, oppId, myStand, oppStand, myRtg, oppRtg)}
        ${_buildOpponentIntelBlock(oppId, isHome, week, nextGame)}
      </div>`;
  } else if (seasonDone) {
    nextCardHtml = `
      <div class="frn-next-card" style="text-align:center;border-color:var(--gold-lt)">
        <div style="font-size:1.3rem;font-weight:900;color:var(--gold);margin-bottom:.5rem">REGULAR SEASON COMPLETE</div>
        <div style="color:var(--gray);margin-bottom:1rem">Final record: ${recStr} · PF ${myStand.pf} / PA ${myStand.pa}</div>
        <button class="btn btn-gold-big" onclick="startFrnPlayoffs()">🏆 START PLAYOFFS</button>
      </div>`;
  } else {
    // User played their game this week; other teams' games pending
    nextCardHtml = `
      <div class="frn-next-card" style="text-align:center;border-style:dashed">
        <div style="color:var(--gold);font-weight:700;margin-bottom:.4rem">Your Week ${week} game is done</div>
        <div style="color:var(--gray);font-size:.8rem;margin-bottom:.8rem">${FRANCHISE_WEEKS - week + 1} weeks of action remaining</div>
        <div class="frn-next-actions">
          <button class="btn btn-gold-big" onclick="frnSimWeek()">⏭ Finalize Week ${week} Results</button>
          <button class="btn btn-outline" onclick="frnSimSeason()" style="color:var(--gray)">⏭⏭ Sim Season</button>
        </div>
      </div>`;
  }

  // ─── Center column: next game + schedule ─────────────────────────────
  const centerHtml = `
    ${nextCardHtml}
    <div class="frn-card-box" style="margin-top:1rem">
      <div class="frn-card-title">MY SCHEDULE <span class="frn-card-title-sub">${FRANCHISE_WEEKS} games</span></div>
      ${(()=>{
  const schHtml = myGames.map(g => {
    const isHome = g.homeId === chosenTeamId;
    const oppId  = isHome ? g.awayId : g.homeId;
    const opp    = getTeam(oppId);
    const oppRec = standings[oppId];
    const oppRS  = oppRec ? `(${oppRec.w}-${oppRec.l})` : "";
    const isNext = g === nextGame;
    const isRival = _areRivals(g.homeId, g.awayId);
    const rivalTag = isRival ? `<span style="color:var(--gold-lt);font-size:.6rem">🔥</span>` : "";
    const wxTag = g.weather && g.weather.label && g.weather.label !== "CLEAR"
      ? `<span style="font-size:.65rem" title="${g.weather.label}">${_wxIcon(g.weather.label)}</span>` : "";
    if (g.played) {
      const my    = isHome ? g.homeScore : g.awayScore;
      const their = isHome ? g.awayScore : g.homeScore;
      const w = my > their, t = my === their;
      return `<div class="frn-game-row clickable"
        onclick="renderFrnPastGame(${g.week},${g.homeId},${g.awayId})"
        onmouseenter="frnPastGameTipShow(event,${g.week},${g.homeId},${g.awayId})"
        onmouseleave="frnPastGameTipHide()">
        <span class="frn-wk">W${g.week}</span>
        <span class="frn-opp">${rivalTag}${isHome ? "vs" : "@"} ${teamLink(opp)} ${wxTag}</span>
        <span class="frn-res ${w?"w":t?"t":"l"}">${w?"W":t?"T":"L"} ${my}–${their}</span>
      </div>`;
    }
    return `<div class="frn-game-row ${isNext ? "frn-next" : ""}">
      <span class="frn-wk">W${g.week}</span>
      <span class="frn-opp">${rivalTag}${isHome ? "vs" : "@"} ${teamLink(opp)} <span style="color:var(--gray);font-size:.62rem">${oppRS}</span></span>
      ${isNext ? `<span class="frn-res" style="color:var(--gold)">NEXT</span>` : ""}
    </div>`;
  }).join("");
  return schHtml;
      })()}
    </div>`;

  // ─── Sidebar: standings + leaders + highlights + POTW ────────────────
  const standHtml = sorted.slice(0, 14).map((s, i) => {
    const isMine   = s.id === chosenTeamId;
    const playoff  = i < PLAYOFF_TEAMS;
    const gp       = s.w + s.l + s.t;
    const pct      = gp === 0 ? ".000" : (s.w / gp).toFixed(3).replace(/^0/, "");
    return `<div class="frn-stand-row ${isMine ? "frn-me" : ""}">
      <span style="color:${playoff?"var(--gold)":"var(--gray)"};width:1.3rem;flex-shrink:0">${i+1}.</span>
      <span style="flex:1">${isMine ? "» " : ""}${teamLink(s.team)}</span>
      <span style="width:3rem;text-align:right">${s.w}-${s.l}${s.t?`-${s.t}`:""}</span>
      <span style="width:2.8rem;text-align:right;color:var(--gray);font-size:.62rem">${pct}</span>
    </div>`;
  }).join("");

  // ─── Sidebar: standings + leaders + highlights + POTW ────────────────
  const leaders = frnTeamLeaders(chosenTeamId);
  const leadersHtml = leaders.length ? leaders.map(l => `
    <div class="frn-leader-row">
      <span class="frn-leader-cat">${l.cat}</span>
      <span class="frn-leader-name">${playerLinkByName(l.name)}</span>
      <span class="frn-leader-stat">${l.stat}</span>
    </div>`).join("") : `<div style="color:var(--gray);font-size:.72rem;padding:.5rem 0">Play games to see leaders.</div>`;

  const hlHtml = _buildHighlightsSidebar(chosenTeamId, seasonHighlights);

  const potwRowFn = (label, entry) => {
    if (!entry) return "";
    const isMine = entry.teamId === chosenTeamId;
    return `<div class="frn-leader-row" style="${isMine?"background:rgba(245,197,66,0.08)":""}">
      <span class="frn-leader-cat" style="width:2rem;font-size:.58rem">${label}</span>
      <span class="frn-leader-name">${playerLinkByName(entry.name)}
        <span style="color:${entry.teamPrimary};font-size:.58rem;margin-left:.25rem">${entry.teamAbbr}</span>
      </span>
      <span class="frn-leader-stat" style="font-size:.62rem;color:var(--gray)">${entry.statLine}</span>
    </div>`;
  };
  const potwRoundLabel = w => {
    if (w <= FRANCHISE_WEEKS) return `WEEK ${w}`;
    const ri = w - FRANCHISE_WEEKS - 1;
    return ["WILD CARD","DIVISIONAL","CHAMPIONSHIP"][ri] || `R${ri+1}`;
  };
  const isLatestVoted = latestPotwWk != null && !!votesByWeek[latestPotwWk];
  const potwHtml = latestPotw ? `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem">
      <span style="color:var(--gray);font-size:.6rem">${potwRoundLabel(latestPotwWk)}</span>
      ${unvotedWeek!=null?`<button class="frn-cap-btn" onclick="renderPotwVoting(${unvotedWeek})" style="background:var(--gold);color:#000;font-weight:900;border:0;font-size:.6rem">🗳 VOTE W${unvotedWeek}</button>`:""}
    </div>
    ${potwRowFn("OFF",latestPotw.offense)}${potwRowFn("DEF",latestPotw.defense)}${potwRowFn("OL",latestPotw.ol)}${potwRowFn("ST",latestPotw.specialTeams)}
  ` : unvotedWeek!=null ? `<button class="frn-cap-btn" onclick="renderPotwVoting(${unvotedWeek})" style="padding:.35rem .9rem;font-size:.7rem;background:var(--gold);color:#000;font-weight:900;border:0">🗳 VOTE — WEEK ${unvotedWeek} READY</button>`
    : `<div style="color:var(--gray);font-size:.72rem;padding:.3rem 0">Awarded each week.</div>`;

  const sidebarHtml = `
    <div style="display:flex;flex-direction:column;gap:1rem">
      <div class="frn-card-box">
        <div class="frn-card-title">STANDINGS <span class="frn-card-title-sub">top ${PLAYOFF_TEAMS} → playoffs</span></div>
        ${standHtml}
        <button class="frn-cap-btn" onclick="renderFrnStandings()" style="margin-top:.5rem;font-size:.6rem">Full Standings →</button>
      </div>
      <div class="frn-card-box">
        <div class="frn-card-title">${myTeam.name.toUpperCase()} LEADERS</div>
        ${leadersHtml}
        <button class="frn-cap-btn" onclick="renderFrnLeaders()" style="margin-top:.5rem;font-size:.6rem">Full Leaders →</button>
      </div>
      <div class="frn-card-box">
        <div class="frn-card-title">HIGHLIGHTS</div>
        ${hlHtml}
      </div>
      <div class="frn-card-box">
        <div class="frn-card-title">PLAYER OF THE WEEK</div>
        ${potwHtml}
      </div>
    </div>`;

  // ─── Final composition ────────────────────────────────────────────────
  $("frnHomeContent").innerHTML = `
    ${bannerHtml}
    ${quickNavHtml}
    ${alertStripHtml}
    <div class="frn-dashboard-grid">
      ${leftColHtml}
      <div>${centerHtml}</div>
      ${sidebarHtml}
    </div>
    <div class="frn-footer-row">
      <div class="frn-footer-info">${(() => {
        if (_saveLastError?.startsWith("idb-only")) return `<span style="color:#e8a000">ℹ Save in IndexedDB only (localStorage full). Data is safe.</span>`;
        if (_saveLastError) return `<span style="color:#ff7070">⚠ Save error: ${_saveLastError}</span>`;
        const mb = (_saveLastSize / 1024 / 1024).toFixed(2);
        return `Auto-saved · ${mb}MB · Reload to keep playing`;
      })()}</div>
      <button class="btn btn-outline" onclick="frnExportSave()" style="font-size:.62rem;color:var(--gray)" title="Download backup .json">⬇ Export</button>
      <button class="btn btn-outline" onclick="frnImportSave()" style="font-size:.62rem;color:var(--gray)" title="Restore from .json">⬆ Import</button>
      <button class="btn btn-outline frn-abandon-btn" onclick="frnAbandon()">× Abandon</button>
    </div>`;
}

// ── Season-long stats / highlights / MVPs ────────────────────────────────────

// Player MVP weight formula. Rewards TDs, yards, takeaways; penalizes turnovers.
// Applied to season-aggregated stats; combined with team-success multiplier for
// the league MVP race.
function mvpScore(p) {
  let s = 0;
  // Offense
  s += (p.pass_td       || 0) * 6
     + (p.pass_yds      || 0) * 0.05
     + (p.pass_comp     || 0) * 0.30
     - (p.pass_int      || 0) * 4
     - (p.sk_taken      || 0) * 0.5;
  s += (p.rush_td       || 0) * 6
     + (p.rush_yds      || 0) * 0.08
     + (p.broken_tackles|| 0) * 0.5
     - (p.fumbles_lost  || 0) * 3;
  s += (p.rec_td        || 0) * 6
     + (p.rec_yds       || 0) * 0.10
     + (p.rec           || 0) * 0.5;
  // Defense
  s += (p.tkl           || 0) * 0.6
     + (p.sk            || 0) * 2
     + (p.int_made      || 0) * 5
     + (p.pd            || 0) * 1
     + (p.ff            || 0) * 2
     + (p.fr            || 0) * 2
     + (p.def_td        || 0) * 8;
  // Kicker
  s += (p.fg_made       || 0) * 2
     + (p.xp_made       || 0) * 0.5;
  return s;
}

function mvpStatLine(p) {
  const parts = [];
  if (p.pass_att)  parts.push(`${p.pass_comp || 0}/${p.pass_att} ${p.pass_yds || 0} pYds ${p.pass_td || 0} pTD${p.pass_int ? ` ${p.pass_int} INT` : ""}`);
  if (p.rush_att)  parts.push(`${p.rush_att} car ${p.rush_yds || 0} yds ${p.rush_td || 0} TD`);
  if (p.rec_tgt)   parts.push(`${p.rec || 0}/${p.rec_tgt} ${p.rec_yds || 0} yds ${p.rec_td || 0} TD`);
  if (p.tkl || p.sk || p.int_made) {
    const d = [];
    if (p.tkl)      d.push(`${p.tkl} TKL`);
    if (p.sk)       d.push(`${(+p.sk).toFixed(1)} SK`);
    if (p.int_made) d.push(`${p.int_made} INT`);
    if (p.ff)       d.push(`${p.ff} FF`);
    if (p.def_td)   d.push(`${p.def_td} TD`);
    parts.push(d.join(", "));
  }
  if (p.fg_att) parts.push(`${p.fg_made || 0}/${p.fg_att} FG`);
  if (p.pancakes || p.sacks_allowed) {
    const ol = [];
    if (p.pancakes)      ol.push(`${p.pancakes} PNK`);
    if (p.sacks_allowed) ol.push(`${p.sacks_allowed} SA`);
    parts.push(ol.join(" / "));
  }
  return parts.join(" · ");
}

// Merge a single game's per-player stats into season-long totals.
function mergeSeasonStats(homeId, awayId, gameStats) {
  if (!gameStats) return;
  if (!franchise.seasonStats) franchise.seasonStats = {};
  const merge = (teamId, side) => {
    if (!side || !side.players) return;
    if (!franchise.seasonStats[teamId]) franchise.seasonStats[teamId] = {};
    const ts = franchise.seasonStats[teamId];
    for (const [name, p] of Object.entries(side.players)) {
      if (!ts[name]) ts[name] = { name, pos: p.pos, gp: 0 };
      ts[name].gp = (ts[name].gp || 0) + 1;
      for (const [k, v] of Object.entries(p)) {
        if (k === "name" || k === "pos") continue;
        if (typeof v === "number") ts[name][k] = (ts[name][k] || 0) + v;
      }
    }
  };
  merge(homeId, gameStats.home);
  merge(awayId, gameStats.away);
}

// Pull the top 4-5 highlight-worthy plays from a game; weight by clutch
// context (Q4 + close, OT, playoff) so big moments rise to the top.
// Also appends one game-level capsule (OT, shutout, blowout, walk-off).
function captureGameHighlights(homeId, awayId, plays, isPlayoff, weekLabel) {
  if (!plays || !plays.length) return;
  if (!franchise.seasonHighlights) franchise.seasonHighlights = [];
  const homeTeam = getTeam(homeId), awayTeam = getTeam(awayId);
  const homeName = homeTeam?.name || "HOME", awayName = awayTeam?.name || "AWAY";
  const hl = [];

  const scoreCtx = (p) => {
    if (p.homeScore == null || p.awayScore == null) return "";
    const diff = p.homeScore - p.awayScore;
    if (diff === 0) return " (tied)";
    const leader = diff > 0 ? homeName : awayName;
    return ` (${leader} +${Math.abs(diff)})`;
  };

  // ── Clip helpers ──────────────────────────────────────────────────────────
  const ordSfx = n => (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
  const playDesc = (p) => {
    if (p.desc) return p.desc;
    if (p.kind === "complete")   return `${p.passer||"QB"} → ${p.receiver||"WR"} for ${p.yards||0} yds`;
    if (p.kind === "incomplete") return `Incomplete — ${p.passer||"QB"} to ${p.receiver||"WR"}`;
    if (p.kind === "run")        return `${p.rusher||"RB"} carries for ${p.yards||0} yds`;
    if (p.kind === "sack")       return `Sack — ${p.dlName||"DEF"} (-${p.sackLoss||0})`;
    if (p.kind === "int")        return `INT — ${p.defender||"DEF"}`;
    if (p.kind === "fumble")     return `Fumble — ${p.forcedBy||p.defender||"DEF"}`;
    if (p.kind === "score")      return p.rusher ? `TD — ${p.rusher}` : p.passer ? `TD — ${p.passer}→${p.receiver}` : "Scoring play";
    if (p.kind === "fg_good")    return `FG ${p.distance||"?"}yds GOOD`;
    if (p.kind === "fg_miss")    return `FG ${p.distance||"?"}yds NO GOOD`;
    if (p.kind === "punt")       return "Punt";
    return p.kind || "Play";
  };
  const trimPlay = (p, isHl) => ({
    sit: p.down ? `${p.down}${ordSfx(p.down)} & ${p.toGo} · ${p.fieldPos || "?"}` : "",
    desc: playDesc(p),
    hs: p.homeScore ?? 0, as: p.awayScore ?? 0,
    q: p.quarter, t: p.time, hi: !!isHl,
  });
  const recentBuf = []; // sliding window of last 3 plays for clip context

  for (const p of plays) {
    let w = 0, label = "", hlType = "off";
    if (p.kind === "score") {
      const scorer = p.poss === "home" ? homeName : awayName;
      const is_td = !!(p.passer || p.rusher || p.receiver) ||
                    (p.desc && /touchdown/i.test(p.desc));
      w = is_td ? 6 : 2.5;
      // Enrich label with scorer details from the last play before the score event
      if (is_td) {
        if (p.rusher)   label = `${p.rusher} rush TD${scoreCtx(p)}`;
        else if (p.passer && p.receiver) label = `${p.passer}→${p.receiver} TD${scoreCtx(p)}`;
        else label = `${scorer} TD${scoreCtx(p)}`;
      } else {
        label = `${scorer} FG${scoreCtx(p)}`;
      }
    } else if (p.kind === "int" && p.isPickSix) {
      w = 14; hlType = "def";
      label = `PICK-SIX! ${p.defender || "DEF"} ${p.intReturnYds || 0} yds`;
    } else if (p.kind === "int") {
      w = 7; hlType = "def";
      label = `INT — ${p.defender || "DEF"}${p.intReturnYds > 10 ? ` ret ${p.intReturnYds} yds` : ""}`;
    } else if (p.kind === "run" && (p.yards || 0) >= 20) {
      w = 4 + Math.min(4, ((p.yards || 0) - 20) / 10);
      label = `${p.rusher || "RB"} ${p.yards}-yd run${p.brokenTackles ? ` (${p.brokenTackles} broken)` : ""}`;
    } else if (p.kind === "complete" && (p.yards || 0) >= 25) {
      w = 4 + Math.min(4, ((p.yards || 0) - 25) / 10);
      label = `${p.passer || "QB"}→${p.receiver || "WR"} ${p.yards} yds`;
    } else if (p.kind === "sack" && (p.sackLoss || 0) >= 8) {
      w = 3.5; hlType = "def";
      label = `${p.dlName || "DEF"} sacks ${p.passer || "QB"} (-${p.sackLoss} yds)`;
    } else if (p.kind === "fumble") {
      w = 5; hlType = "def";
      label = `FUM — ${p.forcedBy || p.defender || "DEF"} forces it`;
    } else if (p.kind === "fg_good" && (p.distance || 0) >= 45) {
      w = 3 + ((p.distance || 0) - 45) / 5;
      label = `${p.kicker || "K"} ${p.distance}-yd FG`;
    }

    if (w > 0) {
      // Clutch multipliers
      const margin = (p.homeScore != null && p.awayScore != null)
        ? Math.abs(p.homeScore - p.awayScore) : 99;
      const isClutch = (p.quarter === 4 && margin <= 8);
      if (isClutch)              w *= 2.0;
      if ((p.quarter || 0) >= 5) w *= 3.0;
      if (isPlayoff)             w *= 1.5;

      const clip = [...recentBuf.slice(-2).map(cp => trimPlay(cp, false)), trimPlay(p, true)];
      hl.push({
        weight: w, label, desc: p.desc || "", type: hlType, clip,
        quarter: p.quarter, time: p.time,
        homeScore: p.homeScore, awayScore: p.awayScore,
        homeId, awayId, isPlayoff: !!isPlayoff, week: weekLabel, isClutch,
      });
    }

    recentBuf.push(p);
    if (recentBuf.length > 4) recentBuf.shift();
  }

  // ── Game-level capsule ──────────────────────────────────────────────────────
  // Derive final score from the last play that carries score fields
  const lastWithScore = [...plays].reverse().find(p => p.homeScore != null);
  if (lastWithScore) {
    const fh = lastWithScore.homeScore, fa = lastWithScore.awayScore;
    const isOT = plays.some(p => (p.quarter || 0) >= 5);
    const winId = fh > fa ? homeId : awayId;
    const winName = fh > fa ? homeName : awayName;
    const margin2 = Math.abs(fh - fa);
    const loserPts = Math.min(fh, fa);
    const capsule = { homeId, awayId, isPlayoff: !!isPlayoff, week: weekLabel, finalHome: fh, finalAway: fa, winId };
    // Clip for capsules: last 2 plays of the game → synthetic final card
    const capCtx = recentBuf.slice(-2).map(cp => trimPlay(cp, false));
    const mkCap = (lbl) => [...capCtx, { sit: "FINAL", desc: lbl, hs: fh, as: fa, q: "FIN", t: "", hi: true }];

    if (isOT) {
      const lbl = `OT THRILLER — ${winName} wins ${Math.max(fh,fa)}-${loserPts}`;
      hl.push({ weight: 18, label: lbl, desc: `Overtime game`, ...capsule, type: "game", isClutch: true, clip: mkCap(lbl) });
    } else if (loserPts === 0) {
      const lbl = `SHUTOUT — ${winName} blanks opponent`;
      hl.push({ weight: 16, label: lbl, desc: `${winName} shutout`, ...capsule, type: "def", isClutch: false, clip: mkCap(lbl) });
    } else if (loserPts <= 7 && margin2 >= 14) {
      const lbl = `Dominant W — ${winName} ${Math.max(fh,fa)}-${loserPts}`;
      hl.push({ weight: 9, label: lbl, desc: `Dominant victory`, ...capsule, type: "game", isClutch: false, clip: mkCap(lbl) });
    } else if (margin2 <= 3 && !isOT) {
      const lbl = `One-score game — ${winName} wins by ${margin2}`;
      hl.push({ weight: 11, label: lbl, desc: `Nail-biter`, ...capsule, type: "game", isClutch: true, clip: mkCap(lbl) });
    }
    // Back-fill final score onto play-level highlights from this game
    for (const h of hl) {
      if (h.finalHome == null) { h.finalHome = fh; h.finalAway = fa; h.winId = winId; }
    }
  }

  // Top 5 per game so we don't bury the season
  const top = hl.sort((a, b) => b.weight - a.weight).slice(0, 5);
  franchise.seasonHighlights.push(...top);
}

// Compute single team's MVP from accumulated stats. Returns null if no
// meaningful production.
function computeTeamMVP(teamId) {
  const players = franchise.seasonStats?.[teamId];
  if (!players) return null;
  const best = Object.values(players)
    .map(p => ({ ...p, score: mvpScore(p) }))
    .sort((a, b) => b.score - a.score)[0];
  return (best && best.score > 8) ? best : null;
}

// League MVP — best score across all teams, weighted by team success so
// production on winning teams matters more.
function computeLeagueMVP() {
  let best = null;
  for (const [teamId, players] of Object.entries(franchise.seasonStats || {})) {
    const stand = franchise.standings[+teamId];
    const gp    = stand ? stand.w + stand.l + stand.t : 1;
    const winPct = gp > 0 ? stand.w / gp : 0.5;
    const teamMul = 0.55 + winPct * 0.85; // 0.55x → 1.40x
    for (const p of Object.values(players)) {
      const s = mvpScore(p) * teamMul;
      if (!best || s > best.score) best = { ...p, teamId: +teamId, score: s };
    }
  }
  return best;
}

// Super Bowl MVP — top scorer from the winning side of the championship game.
function computeSuperBowlMVP() {
  const g = franchise.superBowlGame;
  if (!g || !g.stats) return null;
  const winSide = g.winnerId === g.homeId ? "home" : "away";
  const players = Object.values(g.stats[winSide]?.players || {});
  if (!players.length) return null;
  const ranked = players.map(p => ({ ...p, score: mvpScore(p) }))
                        .sort((a, b) => b.score - a.score);
  return { ...ranked[0], teamId: g.winnerId };
}

// ── Comprehensive Awards Engine ──────────────────────────────────────────────
// All-Pro formation per conference: 1 QB, 2 RB, 3 WR, 1 TE, 5 OL, 4 DL,
// 3 LB, 2 CB, 2 S, 1 K, 1 P. 1st team + 2nd team selected per conference.
const _ALLPRO_FORMATION = [
  ["QB",1],["RB",2],["WR",3],["TE",1],["OL",5],
  ["DL",4],["LB",3],["CB",2],["S",2],["K",1],["P",1],
];

// Per-position IDP scoring — secondary earns more per INT/PD to offset
// fewer tackle opportunities vs. LBs/DLs. Shared by _allProPlayerScore
// and _computeDPOY so both awards always agree on who's best.
function _idpScore(pos, s) {
  if (pos === "DL") {
    // Pass-rush specialists: sacks are premium
    return (s.tkl      || 0) * 1.0
         + (s.sk       || 0) * 4
         + (s.ff       || 0) * 3
         + (s.fr       || 0) * 2
         + (s.int_made || 0) * 3
         + (s.pd       || 0) * 1
         + (s.def_td   || 0) * 6;
  }
  if (pos === "LB") {
    // Coverage + run stop: tackles and sacks both valued, INT rewarded
    return (s.tkl      || 0) * 1.5
         + (s.sk       || 0) * 3
         + (s.int_made || 0) * 4
         + (s.pd       || 0) * 1.5
         + (s.ff       || 0) * 3
         + (s.fr       || 0) * 2
         + (s.def_td   || 0) * 6;
  }
  if (pos === "CB") {
    // Coverage specialists: INT and PD boosted, fewer raw tackles expected
    return (s.tkl      || 0) * 0.75
         + (s.sk       || 0) * 2
         + (s.int_made || 0) * 6
         + (s.pd       || 0) * 2.5
         + (s.ff       || 0) * 3
         + (s.fr       || 0) * 2
         + (s.def_td   || 0) * 6;
  }
  if (pos === "S") {
    // Hybrid: strong tackle scorer + good INT value
    return (s.tkl      || 0) * 1.0
         + (s.sk       || 0) * 2
         + (s.int_made || 0) * 5
         + (s.pd       || 0) * 2
         + (s.ff       || 0) * 3
         + (s.fr       || 0) * 2
         + (s.def_td   || 0) * 6;
  }
  return 0;
}

// Score a player for All-Pro consideration using fantasy football point
// equivalents so the formula is intuitive and OVR-free.
// Offense = standard PPR. Defense = per-position IDP. OL = pancakes/SA.
// K = tiered FG value (3/4/5 pts by distance).
function _allProPlayerScore(p, pos, statRow) {
  if (!statRow) return 0;
  const s = statRow;
  const OL_POS = new Set(["OL","LT","LG","C","RG","RT"]);

  if (OL_POS.has(pos)) {
    const pk = s.pancakes || 0, sa = s.sacks_allowed || 0;
    return (pk === 0 && sa === 0) ? 0 : pk * 3 - sa * 10;
  }

  if (pos === "K") {
    // Tiered FG value: <40yd=3, 40-49=4, 50+=5. We only know fg_long so
    // apply the distance bonus once as a range indicator, not per-FG.
    const distBonus = (s.fg_long || 0) >= 50 ? 2 : (s.fg_long || 0) >= 40 ? 1 : 0;
    const missPenalty = Math.max(0, (s.fg_att || 0) - (s.fg_made || 0));
    return (s.fg_made || 0) * 3
         + distBonus
         + (s.xp_made || 0) * 1
         - missPenalty * 1;
  }

  if (pos === "P") return (s.punts || 0) * 1.5;

  const DEF_POS = new Set(["DL","LB","CB","S"]);
  if (DEF_POS.has(pos)) return _idpScore(pos, s);

  // PPR offense
  return (s.pass_yds     || 0) * 0.04
       + (s.pass_td      || 0) * 4
       - (s.pass_int     || 0) * 2
       + (s.rush_yds     || 0) * 0.10
       + (s.rush_td      || 0) * 6
       + (s.rec          || 0) * 1.0
       + (s.rec_yds      || 0) * 0.10
       + (s.rec_td       || 0) * 6
       - (s.fumbles_lost || 0) * 2;
}

function _allProRowSnapshot(r) {
  const t = r.team;
  return {
    name: r.name, pos: r.pos, teamId: r.teamId,
    teamName: t ? `${t.city} ${t.name}` : "",
    teamAbbr: t ? _bspnLiveAbbr(t) : "—",
    teamPrimary: t?.primary || "#888",
    line: r.stats ? mvpStatLine(r.stats) : "",
  };
}

function _selectAllPros() {
  const result = {};
  for (const conf of ["AFC", "NFC"]) {
    const teamIds = new Set(TEAMS.filter(t => t.conference === conf).map(t => t.id));
    const all = [];
    for (const [tidStr, roster] of Object.entries(franchise.rosters || {})) {
      const tid = Number(tidStr);
      if (!teamIds.has(tid)) continue;
      const team = getTeam(tid);
      const ts = franchise.seasonStats?.[tid] || {};
      for (const p of roster) {
        const s = ts[p.name];
        all.push({ live: p, name: p.name, pos: p.position, teamId: tid, team, stats: s || null });
      }
    }
    const byPos = {};
    for (const r of all) (byPos[r.pos] = byPos[r.pos] || []).push(r);
    for (const pos of Object.keys(byPos)) {
      byPos[pos].sort((a, b) =>
        _allProPlayerScore(b.live, pos, b.stats) - _allProPlayerScore(a.live, pos, a.stats));
    }
    const firstTeam = {}, secondTeam = {}, alternates = {};
    for (const [pos, n] of _ALLPRO_FORMATION) {
      const list = byPos[pos] || [];
      firstTeam[pos]  = list.slice(0, n).map(_allProRowSnapshot);
      secondTeam[pos] = list.slice(n, n * 2).map(_allProRowSnapshot);
      alternates[pos] = list.slice(n * 2, n * 3).map(_allProRowSnapshot);
    }
    result[conf] = { firstTeam, secondTeam, alternates };
  }
  return result;
}

// Offensive Player of the Year — best offensive production × team success.
function _computeOPOY() {
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const stand = franchise.standings[tid] || { w:0, l:0, t:0 };
    const gp = (stand.w || 0) + (stand.l || 0) + (stand.t || 0);
    const winPct = gp > 0 ? stand.w / gp : 0.5;
    const teamMul = 0.6 + winPct * 0.8;
    for (const p of Object.values(players)) {
      if (!["QB","RB","WR","TE"].includes(p.pos)) continue;
      const offScore = (p.pass_td||0)*6 + (p.pass_yds||0)*0.05 + (p.pass_comp||0)*0.30
                     - (p.pass_int||0)*4 + (p.rush_td||0)*6 + (p.rush_yds||0)*0.08
                     + (p.rec_td||0)*6 + (p.rec_yds||0)*0.10 + (p.rec||0)*0.5;
      const s = offScore * teamMul;
      if (!best || s > best.score) best = { ...p, teamId: tid, score: s };
    }
  }
  return best && best.score > 30 ? best : null;
}

// Defensive Player of the Year — best defensive production × team success.
function _computeDPOY() {
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const stand = franchise.standings[tid] || { w:0, l:0, t:0 };
    const gp = (stand.w || 0) + (stand.l || 0) + (stand.t || 0);
    const winPct = gp > 0 ? stand.w / gp : 0.5;
    const teamMul = 0.6 + winPct * 0.8;
    for (const p of Object.values(players)) {
      if (!["DL","LB","CB","S"].includes(p.pos)) continue;
      const s = _idpScore(p.pos, p) * teamMul;
      if (!best || s > best.score) best = { ...p, teamId: tid, score: s };
    }
  }
  return best && best.score > 20 ? best : null;
}

// Rookie of the Year — best stat score among first-year players.
function _computeROY() {
  const baseYear = new Date().getFullYear() + (franchise.season || 1) - 1;
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const roster = franchise.rosters[tid] || [];
    for (const p of Object.values(players)) {
      const live = roster.find(r => r.name === p.name);
      if (!live) continue;
      // Treat anyone with a draftYear in the current league-year (or no
      // career history) as a rookie. The age check filters edge cases.
      const isRookie = live.draftYear === baseYear ||
        (live.careerHistory && live.careerHistory.length === 0 && (live.age || 30) <= 23);
      if (!isRookie) continue;
      const s = mvpScore(p);
      if (!best || s > best.score) best = { ...p, teamId: tid, score: s };
    }
  }
  return best && best.score > 8 ? best : null;
}

// Coach of the Year — wins + improvement vs prior season + champ bonus.
function _computeCOY() {
  const champId = franchise.playoffBracket?.champion;
  const prev = (franchise.history || []).find(h => h.season === franchise.season - 1);
  const prevRecs = {};
  if (prev?.standingsSnapshot) {
    for (const [tid, s] of Object.entries(prev.standingsSnapshot)) prevRecs[+tid] = s.w || 0;
  }
  let best = null;
  for (const t of TEAMS) {
    const hc = franchise.coaches?.[t.id]?.hc;
    if (!hc) continue;
    const s = franchise.standings[t.id] || { w:0, l:0 };
    const wins = s.w || 0;
    const prevW = prevRecs[t.id];
    const improvement = prevW != null ? Math.max(0, wins - prevW) : 0;
    const isChamp = t.id === champId;
    const score = wins * 1.0 + improvement * 1.5 + (isChamp ? 4 : 0);
    if (!best || score > best.score) {
      best = {
        name: hc.name, trait: hc.trait, teamId: t.id,
        teamName: `${t.city} ${t.name}`,
        teamAbbr: _bspnLiveAbbr(t), teamPrimary: t.primary,
        wins, prevWins: prevW, improvement, isChamp, score,
      };
    }
  }
  return best;
}

// Comeback Player of the Year — biggest mvpScore jump vs his last career row.
function _computeComebackPOY() {
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const roster = franchise.rosters[tid] || [];
    for (const p of Object.values(players)) {
      const live = roster.find(r => r.name === p.name);
      if (!live) continue;
      const hist = live.careerHistory || [];
      if (hist.length < 2) continue;
      const lastRow = hist[hist.length - 1] || {};
      const thisScore = mvpScore(p);
      const lastScore = mvpScore(lastRow);
      if (lastScore >= 35 || thisScore < 55) continue;
      const jump = thisScore - lastScore;
      if (jump < 25) continue;
      if (!best || jump > best.jump) best = {
        ...p, teamId: tid, jump, lastScore: Math.round(lastScore), thisScore: Math.round(thisScore),
      };
    }
  }
  return best;
}

// Breakout Player of the Year — young non-rookie blowing past his career peak.
function _computeBreakoutPOY() {
  const baseYear = new Date().getFullYear() + (franchise.season || 1) - 1;
  let best = null;
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const roster = franchise.rosters[tid] || [];
    for (const p of Object.values(players)) {
      const live = roster.find(r => r.name === p.name);
      if (!live) continue;
      if ((live.age || 30) > 25) continue;
      if (live.draftYear === baseYear) continue;
      const hist = live.careerHistory || [];
      const peak = hist.length ? Math.max(...hist.map(h => mvpScore(h))) : 0;
      const thisScore = mvpScore(p);
      if (thisScore < 60) continue;
      const lift = thisScore - peak;
      if (lift < 20) continue;
      if (!best || lift > best.lift) best = {
        ...p, teamId: tid, lift, prevPeak: Math.round(peak), thisScore: Math.round(thisScore),
      };
    }
  }
  return best;
}

// Top-3 league leaders in each major stat category (snapshot for history).
function _seasonStatLeaders() {
  const cats = [
    { key:"pass_yds",  label:"Passing Yards",    pos:["QB"] },
    { key:"pass_td",   label:"Passing TDs",      pos:["QB"] },
    { key:"rush_yds",  label:"Rushing Yards",    pos:["RB"] },
    { key:"rush_td",   label:"Rushing TDs",      pos:["RB"] },
    { key:"rec_yds",   label:"Receiving Yards",  pos:["WR","TE"] },
    { key:"rec_td",    label:"Receiving TDs",    pos:["WR","TE"] },
    { key:"sk",        label:"Sacks",            pos:["DL","LB"] },
    { key:"tkl",       label:"Tackles",          pos:["LB","S","CB","DL"] },
    { key:"int_made",  label:"Interceptions",    pos:["CB","S","LB"] },
    { key:"fg_made",   label:"Field Goals",      pos:["K"] },
  ];
  const all = [];
  for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
    const tid = Number(tidStr);
    const team = getTeam(tid);
    if (!team) continue;
    for (const p of Object.values(players)) all.push({ ...p, teamId: tid, team });
  }
  const out = {};
  for (const c of cats) {
    out[c.key] = {
      label: c.label,
      leaders: all
        .filter(r => c.pos.includes(r.pos) && (r[c.key] || 0) > 0)
        .sort((a, b) => (b[c.key] || 0) - (a[c.key] || 0))
        .slice(0, 3)
        .map(r => ({
          name: r.name, pos: r.pos, teamId: r.teamId,
          teamAbbr: _bspnLiveAbbr(r.team),
          teamPrimary: r.team.primary,
          value: r[c.key] || 0,
        })),
    };
  }
  return out;
}

// "By the numbers" — extreme regular-season facts.
function _seasonByTheNumbers() {
  const games = (franchise.schedule || []).filter(g => g.played);
  if (!games.length) return null;
  let biggestBlowout = null, closestGame = null, highestScoring = null;
  const teamPoints = {};
  for (const g of games) {
    const margin = Math.abs(g.homeScore - g.awayScore);
    const total = (g.homeScore || 0) + (g.awayScore || 0);
    const meta = {
      homeId: g.homeId, awayId: g.awayId,
      homeScore: g.homeScore, awayScore: g.awayScore,
      week: g.week, margin, total,
    };
    if (!biggestBlowout || margin > biggestBlowout.margin) biggestBlowout = meta;
    if (!closestGame   || margin < closestGame.margin)     closestGame   = meta;
    if (!highestScoring|| total  > highestScoring.total)   highestScoring = meta;
    teamPoints[g.homeId] = (teamPoints[g.homeId] || 0) + (g.homeScore || 0);
    teamPoints[g.awayId] = (teamPoints[g.awayId] || 0) + (g.awayScore || 0);
  }
  const ranked = Object.entries(teamPoints)
    .map(([tid, pts]) => ({ tid: Number(tid), pts }))
    .sort((a, b) => b.pts - a.pts);
  const sorted = TEAMS
    .map(t => ({ t, s: franchise.standings[t.id] || { w:0, l:0 } }))
    .sort((a, b) => (b.s.w || 0) - (a.s.w || 0) || (a.s.l || 0) - (b.s.l || 0));
  return {
    biggestBlowout, closestGame, highestScoring,
    mostPointsTeam: ranked[0] ? { teamId: ranked[0].tid, pts: ranked[0].pts } : null,
    bestRecord:  sorted[0]                    ? { teamId: sorted[0].t.id, w: sorted[0].s.w, l: sorted[0].s.l } : null,
    worstRecord: sorted[sorted.length - 1]    ? { teamId: sorted[sorted.length-1].t.id, w: sorted[sorted.length-1].s.w, l: sorted[sorted.length-1].s.l } : null,
  };
}

// Process retirements at season's end. Bumps age, rolls retirement,
// auto-enshrines qualifying HoFers. Returns the list for the awards
// screen. Pulled forward from `runFrnOffseason` so retirees + HoF
// inductees can be honored on the awards ceremony page.
function _processSeasonEndRetirements() {
  const retirees = [];
  const hofClass = [];
  for (const t of TEAMS) {
    const tId = t.id;
    const roster = franchise.rosters[tId] || [];
    const keep = [];
    for (const p of roster) {
      if (p.age == null) {
        p.age = (p.overall >= 85 ? 27 : p.overall >= 75 ? 24 : 22) + Math.floor(Math.random() * 6);
      }
      p.age += 1;
      const retProb = p.age >= 36 ? 1
                    : p.age === 35 ? 0.60
                    : p.age === 34 ? 0.35
                    : p.age === 33 ? 0.15
                    : p.age >= 31 ? 0.05
                    : 0;
      if (retProb > 0 && Math.random() < retProb) {
        const preHofCount = (franchise.hallOfFame || []).length;
        _maybeEnshrineHOF(p, t);
        const wasInducted = (franchise.hallOfFame || []).length > preHofCount;
        const entry = {
          name: p.name, pos: p.position, age: p.age,
          teamId: tId, teamName: `${t.city} ${t.name}`,
          teamAbbr: _bspnLiveAbbr(t), teamPrimary: t.primary,
          careerYears: p.careerHistory?.length || 0,
          careerEarnings: Math.round((p.careerEarnings || 0) * 10) / 10,
          isHof: wasInducted,
          line: mvpStatLine(p.careerStats || {}),
        };
        retirees.push(entry);
        if (wasInducted) hofClass.push(entry);
        continue;
      }
      keep.push(p);
    }
    franchise.rosters[tId] = keep;
  }
  return { retirees, hofClass };
}

// Snapshot an award-winner record for permanent storage on history[].
function _snapshotAwardWinner(p) {
  if (!p) return null;
  const team = p.teamId ? getTeam(p.teamId) : null;
  return {
    name: p.name, pos: p.pos, teamId: p.teamId,
    teamName: team ? `${team.city} ${team.name}` : "",
    teamAbbr: team ? _bspnLiveAbbr(team) : "",
    teamPrimary: team?.primary || "#888",
    line: mvpStatLine(p),
    // Optional extra context the renderer can use (comeback jump etc.)
    jump: p.jump, lastScore: p.lastScore, thisScore: p.thisScore,
    lift: p.lift, prevPeak: p.prevPeak,
  };
}

// Stamp accolades onto live players' careerHistory rows so trophy
// counters + career profiles reflect what happened this season.
function _stampSeasonAccolades(awards) {
  const seasonNum = franchise.season;
  const yearStamp = new Date().getFullYear() + seasonNum - 1;
  const stamp = (rec, label) => {
    if (!rec) return;
    const player = _findPlayer(rec.name);
    if (!player) return;
    const hist = player.careerHistory || (player.careerHistory = []);
    let row = hist.find(h => h.season === seasonNum || h.year === yearStamp);
    if (!row) {
      row = {
        season: seasonNum, year: yearStamp,
        age: player.age, ovr: player.overall, pos: player.position,
        teamId: null, teamName: "—", accolades: [],
      };
      hist.push(row);
    }
    if (!row.accolades) row.accolades = [];
    if (!row.accolades.includes(label)) row.accolades.push(label);
  };
  stamp(awards.leagueMVP,   "MVP");
  stamp(awards.superBowlMVP,"Super Bowl MVP");
  stamp(awards.opoy,        "OPOY");
  stamp(awards.dpoy,        "DPOY");
  stamp(awards.roy,         "ROY");
  stamp(awards.comeback,    "Comeback POY");
  stamp(awards.breakout,    "Breakout POY");
  // Champion gets ring
  const champId = franchise.playoffBracket?.champion;
  if (champId) {
    for (const p of (franchise.rosters[champId] || [])) stamp({ name: p.name }, "Super Bowl");
  }
  // All-Pro / Pro Bowl
  for (const conf of ["AFC","NFC"]) {
    const ap = awards.allPros?.[conf];
    if (!ap) continue;
    for (const list of Object.values(ap.firstTeam  || {})) for (const r of list) stamp(r, "All-Pro");
    for (const list of Object.values(ap.secondTeam || {})) for (const r of list) stamp(r, "All-Pro (2nd)");
    for (const list of Object.values(ap.alternates || {})) for (const r of list) stamp(r, "Pro Bowl");
  }
  // Refresh aggregate counters off careerHistory accolades.
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) {
      const all = (p.careerHistory || []).flatMap(h => h.accolades || []);
      p.proBowls = all.filter(a => a === "Pro Bowl" || a === "All-Pro" || a === "All-Pro (2nd)").length;
      p.allPros  = all.filter(a => a === "All-Pro" || a === "All-Pro (2nd)").length;
      p.mvps     = all.filter(a => a === "MVP").length;
      p.opoys    = all.filter(a => a === "OPOY").length;
      p.dpoys    = all.filter(a => a === "DPOY").length;
      p.roys     = all.filter(a => a === "ROY").length;
      p.sbRings  = all.filter(a => a === "Super Bowl" || a === "Super Bowl MVP").length;
    }
  }
}

// ── Coaching Staff Panel ─────────────────────────────────────────────────────
// Shows the user team's full coaching staff and allows hires/fires from the
// coach market. Market is populated by _generateCoachMarket() each offseason.
function renderFrnCoachingStaff() {
  const myId   = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const staff  = franchise.coaches?.[myId] || {};
  const hc     = staff.hc;
  const oc     = staff.oc;
  const dc     = staff.dc;
  const posStaff = staff.positionStaff || [];
  const market = franchise._coachMarket || [];
  const BUDGET_CAP = 15; // $15M coaching budget cap (display only)

  const ratingColor = r => r >= 80 ? "var(--green-lt)" : r >= 65 ? "var(--gold)" : "var(--red)";
  const ratingBadge = (r) => r != null
    ? `<span style="font-size:.7rem;font-weight:700;padding:.1rem .4rem;border-radius:3px;background:${ratingColor(r)};color:#000">${r}</span>`
    : "";

  // ── HC Card ──
  const hcHtml = hc ? `
    <div class="frn-coach-card frn-coach-hc">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
        <div>
          <div style="font-size:.95rem;font-weight:700;color:var(--white)">${hc.name}</div>
          <div style="font-size:.65rem;color:var(--gray);margin-top:.1rem">HEAD COACH · Age ${hc.age||"?"} · ${hc.yearsWithTeam||0} yr${(hc.yearsWithTeam||0)===1?"":"s"} w/team</div>
        </div>
        ${ratingBadge(hc.rating)}
      </div>
      <div style="margin-top:.5rem;font-size:.7rem;display:flex;flex-wrap:wrap;gap:.3rem">
        <span style="background:rgba(255,255,255,.08);padding:.15rem .5rem;border-radius:3px">Culture: <b>${hc.cultureTrait||"—"}</b></span>
        <span style="background:rgba(255,255,255,.08);padding:.15rem .5rem;border-radius:3px">Specialty: <b>${hc.specialtyTrait||"—"}</b></span>
      </div>
      <div style="margin-top:.4rem;font-size:.68rem;color:var(--gray)">
        Record: ${hc.record?.w||0}–${hc.record?.l||0}${(hc.record?.championships||0)>0?" · "+hc.record.championships+" ring"+(hc.record.championships>1?"s":""):""} ·
        $${(hc.salary||0).toFixed(1)}M/yr · ${hc.contractYears||"?"} yr${(hc.contractYears||1)===1?"":"s"} left
      </div>
      <div style="margin-top:.5rem;text-align:right">
        <button class="btn btn-outline" style="font-size:.65rem;color:var(--red);border-color:var(--red)"
          onclick="frnFireStaffSlot('hc')">Fire HC</button>
      </div>
    </div>` : `<div class="frn-coach-card" style="color:var(--gray);font-style:italic">No head coach — hire from market</div>`;

  // ── Coordinator Cards ──
  const coordCard = (label, coord, slot) => {
    if (!coord) return `<div class="frn-coach-card" style="color:var(--gray);font-style:italic">No ${label} — hire from market</div>`;
    const cYrs = coord.contractYears ?? 2;
    const expiryWarn = cYrs === 0
      ? `<div style="font-size:.63rem;color:var(--red);margin:.25rem 0">⚠ Contract expired — may depart this offseason</div>`
      : cYrs === 1
      ? `<div style="font-size:.63rem;color:var(--gold);margin:.25rem 0">Final contract year — extension needed</div>`
      : "";
    return `
    <div class="frn-coach-card" style="${cYrs === 0 ? "border-color:var(--red);" : cYrs === 1 ? "border-color:var(--gold);" : ""}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.4rem">
        <div>
          <div style="font-size:.8rem;font-weight:700;color:var(--white)">${coord.name}</div>
          <div style="font-size:.62rem;color:var(--gray)">${label} · Age ${coord.age||"?"} · ${coord.yearsWithTeam||0} yr${(coord.yearsWithTeam||0)===1?"":"s"}</div>
        </div>
        ${ratingBadge(coord.rating)}
      </div>
      ${expiryWarn}
      <div style="margin-top:.35rem;font-size:.68rem">
        <span style="background:rgba(255,255,255,.07);padding:.12rem .45rem;border-radius:3px">Trait: <b>${coord.trait||"—"}</b></span>
      </div>
      <div style="margin-top:.3rem;font-size:.65rem;color:var(--gray)">$${(coord.salary||0).toFixed(1)}M/yr · ${cYrs} yr${cYrs===1?"":"s"} left</div>
      <div style="margin-top:.4rem;text-align:right">
        <button class="btn btn-outline" style="font-size:.62rem;padding:.15rem .5rem"
          onclick="frnFireStaffSlot('${slot}')">Replace ${label}</button>
      </div>
    </div>`;
  };

  // ── Position Staff ──
  const tierColor = t => t === "Elite" ? "var(--gold)" : t === "Good" ? "var(--green-lt)" : "var(--gray)";
  const posSlots = POSITION_COACH_GROUPS.map((g, i) => {
    const coach = posStaff.find(s => s.group === g);
    return coach
      ? `<div class="frn-coach-pos-slot">
          <div style="font-size:.65rem;color:var(--gray);text-transform:uppercase;letter-spacing:.5px">${g}</div>
          <div style="font-size:.75rem;font-weight:700;color:var(--white);margin:.1rem 0">${coach.name}</div>
          <div style="font-size:.62rem;color:${tierColor(coach.tier)}">${coach.tier} · $${(coach.salary||0).toFixed(1)}M</div>
          <button class="btn btn-outline" style="font-size:.58rem;padding:.1rem .4rem;margin-top:.3rem"
            onclick="frnUpgradePositionCoach('${g}')">Upgrade</button>
        </div>`
      : `<div class="frn-coach-pos-slot" style="border-style:dashed;opacity:.6">
          <div style="font-size:.65rem;color:var(--gray);text-transform:uppercase;letter-spacing:.5px">${g}</div>
          <div style="font-size:.75rem;color:var(--gray);margin:.2rem 0">—</div>
          <button class="btn btn-outline" style="font-size:.58rem;padding:.1rem .4rem;margin-top:.3rem"
            onclick="frnHirePositionCoach('${g}')">Hire</button>
        </div>`;
  }).join("");

  // ── Budget Bar ──
  const budgetUsed = typeof coachingBudgetUsed === "function" ? coachingBudgetUsed(myId) : 0;
  const budgetPct  = Math.min(100, (budgetUsed / BUDGET_CAP) * 100);
  const budgetColor= budgetUsed > BUDGET_CAP ? "var(--red)" : budgetUsed > BUDGET_CAP * 0.85 ? "var(--gold)" : "var(--green-lt)";
  const budgetHtml = `
    <div style="margin:1rem 0 .5rem">
      <div style="font-size:.68rem;color:var(--gray);margin-bottom:.25rem;letter-spacing:.5px;text-transform:uppercase">
        Coaching Budget: <span style="color:${budgetColor}">$${budgetUsed.toFixed(1)}M</span> / $${BUDGET_CAP}M
      </div>
      <div style="height:5px;background:rgba(255,255,255,.12);border-radius:3px">
        <div style="height:100%;width:${budgetPct.toFixed(0)}%;background:${budgetColor};border-radius:3px;transition:width .3s"></div>
      </div>
    </div>`;

  // ── Coach Market ──
  const marketHcHtml  = market.filter(c => c.type === "hc").map((c, i) => `
    <div class="frn-coach-market-row">
      <div style="flex:1;min-width:0">
        <div style="font-size:.78rem;font-weight:700">${c.name} ${ratingBadge(c.rating)}</div>
        <div style="font-size:.62rem;color:var(--gray)">Culture: ${c.cultureTrait||"—"} · Spec: ${c.specialtyTrait||"—"} · $${(c.salary||0).toFixed(1)}M/yr · Age ${c.age||"?"}</div>
      </div>
      <button class="btn btn-outline" style="font-size:.65rem;white-space:nowrap"
        onclick="frnHireCoachFromMarket('hc',${i})">Hire as HC</button>
    </div>`).join("") || `<div style="color:var(--gray);font-size:.72rem;font-style:italic">No HC candidates available.</div>`;

  const marketOCHtml  = market.filter(c => c.type === "oc").map((c, i) => `
    <div class="frn-coach-market-row">
      <div style="flex:1;min-width:0">
        <div style="font-size:.78rem;font-weight:700">${c.name} ${ratingBadge(c.rating)}</div>
        <div style="font-size:.62rem;color:var(--gray)">Trait: ${c.trait||"—"} · $${(c.salary||0).toFixed(1)}M/yr · Age ${c.age||"?"}</div>
      </div>
      <button class="btn btn-outline" style="font-size:.65rem;white-space:nowrap"
        onclick="frnHireCoachFromMarket('oc',${i})">Hire as OC</button>
    </div>`).join("") || `<div style="color:var(--gray);font-size:.72rem;font-style:italic">No OC candidates available.</div>`;

  const marketDCHtml  = market.filter(c => c.type === "dc").map((c, i) => `
    <div class="frn-coach-market-row">
      <div style="flex:1;min-width:0">
        <div style="font-size:.78rem;font-weight:700">${c.name} ${ratingBadge(c.rating)}</div>
        <div style="font-size:.62rem;color:var(--gray)">Trait: ${c.trait||"—"} · $${(c.salary||0).toFixed(1)}M/yr · Age ${c.age||"?"}</div>
      </div>
      <button class="btn btn-outline" style="font-size:.65rem;white-space:nowrap"
        onclick="frnHireCoachFromMarket('dc',${i})">Hire as DC</button>
    </div>`).join("") || `<div style="color:var(--gray);font-size:.72rem;font-style:italic">No DC candidates available.</div>`;

  // ── Chemistry Panel ──
  const chem      = staff._chemistry || {};
  const hcGrp     = typeof _chemGroup === "function" ? _chemGroup("hc", hc?.specialtyTrait) : null;
  const ocGrp     = typeof _chemGroup === "function" ? _chemGroup("oc", oc?.trait) : null;
  const dcGrp     = typeof _chemGroup === "function" ? _chemGroup("dc", dc?.trait) : null;
  const chemBonus = typeof _computeChemistryBonus === "function" ? _computeChemistryBonus(myId) : { offBonus:0, defBonus:0, devMul:1.0, chaotic:false };
  const alYrs     = chem.alignmentYears || 0;
  const frYrs     = chem.frictionYears  || 0;
  const grpTag    = g => g
    ? `<span style="font-size:.62rem;font-weight:700;padding:.1rem .4rem;border-radius:3px;background:${g==="OFFENSE"?"rgba(0,180,120,.25)":g==="DEFENSE"?"rgba(60,120,255,.25)":g==="DEVELOP"?"rgba(200,160,0,.25)":"rgba(255,255,255,.1)"}">${g}</span>`
    : `<span style="font-size:.62rem;color:var(--gray);opacity:.6">NEUTRAL</span>`;
  const chemStatusColor = frYrs >= 2 ? "var(--red)" : alYrs >= 2 ? "var(--green-lt)" : alYrs >= 1 ? "var(--gold)" : "rgba(255,255,255,.35)";
  const chemStatusLabel = frYrs >= 2 ? `Friction (${frYrs} yr${frYrs===1?"":"s"})` : alYrs >= 1 ? `Alignment (${alYrs} yr${alYrs===1?"":"s"})` : "Neutral — building";
  const bondHtml = chem.qbOcBond
    ? `<div style="margin-top:.4rem;font-size:.67rem;color:var(--gold)">🔗 QB-OC Bond active — ${chem.qbOcBond}</div>` : "";
  const chemHtml = `
    <div class="frn-coach-card" style="border-color:${chemStatusColor};background:rgba(255,255,255,.03)">
      <div style="font-size:.72rem;font-weight:700;color:${chemStatusColor};letter-spacing:.5px;text-transform:uppercase;margin-bottom:.4rem">
        ${chemStatusLabel}${chemBonus.chaotic ? " · CHAOTIC" : ""}
      </div>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;font-size:.68rem;align-items:center">
        <div>HC ${grpTag(hcGrp)}</div>
        <div>OC ${grpTag(ocGrp)}</div>
        <div>DC ${grpTag(dcGrp)}</div>
      </div>
      <div style="margin-top:.45rem;font-size:.67rem;color:var(--gray);display:flex;flex-wrap:wrap;gap:.6rem">
        ${chemBonus.offBonus !== 0 ? `<span style="color:${chemBonus.offBonus>0?"var(--green-lt)":"var(--red)"}">OFF ${chemBonus.offBonus>0?"+":""}${chemBonus.offBonus}</span>` : ""}
        ${chemBonus.defBonus !== 0 ? `<span style="color:${chemBonus.defBonus>0?"var(--green-lt)":"var(--red)"}">DEF ${chemBonus.defBonus>0?"+":""}${chemBonus.defBonus}</span>` : ""}
        ${chemBonus.devMul > 1.0 ? `<span style="color:var(--green-lt)">DEV x${chemBonus.devMul.toFixed(2)}</span>` : ""}
        ${chemBonus.chaotic ? `<span style="color:var(--red)">+/-2 swing per game</span>` : ""}
        ${chemBonus.offBonus===0 && chemBonus.defBonus===0 && chemBonus.devMul<=1.0 && !chemBonus.chaotic ? `<span style="opacity:.5">Bonuses unlock as alignment builds across seasons</span>` : ""}
      </div>
      ${bondHtml}
    </div>`;

  $("frnHomeContent").innerHTML = `
    <style>
      .frn-coach-card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:.75rem 1rem;margin-bottom:.6rem}
      .frn-coach-hc{border-color:var(--gold);background:rgba(255,200,0,.06)}
      .frn-coach-pos-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.5rem;margin:.5rem 0}
      .frn-coach-pos-slot{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:5px;padding:.5rem .75rem}
      .frn-coach-market-row{display:flex;align-items:center;gap:.75rem;padding:.45rem 0;border-bottom:1px solid rgba(255,255,255,.07)}
      .frn-coach-market-row:last-child{border-bottom:0}
    </style>
    <div style="max-width:600px;margin:0 auto;padding:.5rem 0">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem">
        <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="font-size:.7rem;padding:.2rem .6rem">← Back</button>
        <div style="font-size:1rem;font-weight:700;color:var(--gold)">${myTeam?.city} ${myTeam?.name} — Coaching Staff</div>
      </div>
      ${budgetHtml}
      <div class="frn-sec-title" style="margin-top:.8rem">Head Coach</div>
      ${hcHtml}
      <div class="frn-sec-title" style="margin-top:.8rem">Coordinators</div>
      ${coordCard("OC", oc, "oc")}
      ${coordCard("DC", dc, "dc")}
      <div class="frn-sec-title" style="margin-top:.8rem">Staff Chemistry</div>
      ${chemHtml}
      <div class="frn-sec-title" style="margin-top:.8rem">Position Staff <span style="font-size:.65rem;font-weight:400;color:var(--gray)">(up to ${POSITION_COACH_GROUPS.length} groups)</span></div>
      <div class="frn-coach-pos-grid">${posSlots}</div>
      <div class="frn-sec-title" style="margin-top:1rem">Available Coaches</div>
      ${market.length === 0
        ? `<div style="color:var(--gray);font-size:.75rem;font-style:italic;margin:.5rem 0">No market available yet — coaches become available after the season ends.</div>`
        : `<div style="margin:.4rem 0">
             <div style="font-size:.72rem;font-weight:700;color:var(--gold);letter-spacing:.5px;margin:.4rem 0 .2rem">HEAD COACHES</div>
             ${marketHcHtml}
             <div style="font-size:.72rem;font-weight:700;color:var(--gold);letter-spacing:.5px;margin:.8rem 0 .2rem">OFFENSIVE COORDINATORS</div>
             ${marketOCHtml}
             <div style="font-size:.72rem;font-weight:700;color:var(--gold);letter-spacing:.5px;margin:.8rem 0 .2rem">DEFENSIVE COORDINATORS</div>
             ${marketDCHtml}
           </div>`
      }
    </div>`;
}

// ── Coaching staff action handlers ───────────────────────────────────────────
function frnFireStaffSlot(slot) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const name = staff[slot]?.name || "coach";
  if (slot === "hc") {
    if (!confirm(`Release ${name}? You will choose a replacement on the next screen.`)) return;
    _renderHcVacancyPanel();
    return;
  }
  if (!confirm(`Release ${name}? A replacement will be hired immediately.`)) return;
  if (slot === "oc") {
    if (staff._chemistry) staff._chemistry.qbOcBond = false;
    staff.oc = _rollOC();
    _pushNews({ type:"coach_hire", label: `Your team hired new OC ${staff.oc.name}` });
  } else if (slot === "dc") {
    staff.dc = _rollDC();
    _pushNews({ type:"coach_hire", label: `Your team hired new DC ${staff.dc.name}` });
  }
  saveFranchise();
  renderFrnCoachingStaff();
}

// Vacancy decision panel — shown after user confirms releasing the HC.
// The old HC is still in staff.hc here; each path fires them as part of its action.
function _renderHcVacancyPanel() {
  const myId   = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const staff  = franchise.coaches?.[myId] || {};
  const oldHc  = staff.hc;
  const oc     = staff.oc;
  const dc     = staff.dc;
  // Generate emergency market if the offseason carousel hasn't run yet
  if (typeof _ensureCoachMarket === "function") _ensureCoachMarket();
  const mktHcs = (franchise._coachMarket || []).filter(c => c.type === "hc");

  const ratingColor = r => r >= 80 ? "var(--green-lt)" : r >= 65 ? "var(--gold)" : "var(--red)";
  const ratingBadge = r => r != null
    ? `<span style="font-size:.7rem;font-weight:700;padding:.15rem .45rem;border-radius:3px;background:${ratingColor(r)};color:#000">${r}</span>`
    : "";
  const riskNote = r =>
    r < 50 ? `<div style="font-size:.64rem;color:var(--red);margin:.25rem 0">High-risk promotion — rating only ${r}</div>`
    : r < 65 ? `<div style="font-size:.64rem;color:var(--gold);margin:.25rem 0">Risky promotion — rating only ${r}</div>`
    : "";

  const coordCard = (coord, fromSlot, specialty, otherSlot) => coord ? `
    <div class="frn-coach-card" style="border-color:rgba(255,255,255,.22)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:.85rem;font-weight:700;color:var(--white)">${coord.name} ${ratingBadge(coord.rating)}</div>
          <div style="font-size:.63rem;color:var(--gray);margin:.1rem 0">${fromSlot.toUpperCase()} · ${coord.trait||"—"} · ${coord.yearsWithTeam||0} yr${(coord.yearsWithTeam||0)===1?"":"s"} w/team</div>
        </div>
      </div>
      ${riskNote(coord.rating || 60)}
      <div style="font-size:.67rem;color:var(--gray);line-height:1.7;margin:.4rem 0">
        Becomes HC · <b style="color:var(--white)">${specialty}</b> specialty<br>
        Always hires new ${fromSlot.toUpperCase()} from their network<br>
        40% chance also replaces ${otherSlot.toUpperCase()}<br>
        Chemistry <b style="color:var(--green-lt)">preserved</b> — knows the staff
      </div>
      <button class="btn btn-outline" style="font-size:.7rem"
        onclick="frnPromoteCoordinator('${fromSlot}')">Promote to Head Coach</button>
    </div>`
  : `<div class="frn-coach-card" style="opacity:.35;font-size:.7rem;font-style:italic;padding:.6rem 1rem">No ${fromSlot.toUpperCase()} on staff to promote</div>`;

  $("frnHomeContent").innerHTML = `
    <div style="max-width:500px;margin:0 auto;padding:.5rem 0">
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.6rem">
        <button class="btn btn-outline" onclick="renderFrnCoachingStaff()" style="font-size:.7rem;padding:.2rem .6rem">← Cancel</button>
        <div style="font-size:1rem;font-weight:700;color:var(--gold)">${myTeam?.city} ${myTeam?.name} — HC Vacancy</div>
      </div>
      <div style="font-size:.7rem;color:var(--gray);margin-bottom:.8rem">
        Releasing <b style="color:var(--white)">${oldHc?.name || "head coach"}</b>.
        How do you want to fill the position?
      </div>
      <div class="frn-sec-title">Promote from Within</div>
      ${coordCard(oc, "oc", "Offensive Minded", "dc")}
      ${coordCard(dc, "dc", "Defensive Minded", "oc")}
      <div class="frn-sec-title" style="margin-top:.9rem">Outside Hire</div>
      <div class="frn-coach-card" style="border-color:rgba(255,255,255,.22)">
        <div style="font-size:.85rem;font-weight:700;color:var(--white)">
          Hire from Market
          <span style="font-size:.65rem;font-weight:400;color:var(--gray);margin-left:.5rem">${mktHcs.length} candidate${mktHcs.length===1?"":"s"} available</span>
        </div>
        <div style="font-size:.67rem;color:var(--gray);line-height:1.7;margin:.4rem 0">
          You pick the HC from available candidates<br>
          <b>75%</b> chance new HC replaces OC with their guy<br>
          <b>40%</b> chance new HC replaces DC with their guy<br>
          Chemistry <b style="color:var(--red)">resets</b> — outside hire, no prior relationships
        </div>
        <button class="btn btn-outline" style="font-size:.7rem" onclick="frnBrowseHcMarket()">
          Browse Head Coach Market
        </button>
      </div>
    </div>`;
}

// Promotes OC or DC to HC. Fires old HC, builds new HC from the coordinator,
// fills the vacated slot from new HC's network, and 40% chance replaces the other
// coordinator. Chemistry is preserved — internal promotion keeps staff relationships.
function frnPromoteCoordinator(fromSlot) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const coord = staff[fromSlot];
  if (!coord) return;

  const oldHcName = staff.hc?.name;
  if (oldHcName) _pushNews({ type:"coach_depart", label: `🚪 HC ${oldHcName} released` });

  staff.hc = {
    name:          coord.name,
    rating:        Math.min(89, (coord.rating || 60) + Math.floor(Math.random() * 5)),
    cultureTrait:  HC_CULTURE_TRAITS[Math.floor(Math.random() * HC_CULTURE_TRAITS.length)].key,
    specialtyTrait: fromSlot === "oc" ? "Offensive Minded" : "Defensive Minded",
    age:           coord.age || 45,
    yearsWithTeam: 0,
    record:        { w:0, l:0, championships:0 },
    salary:        +((coord.salary || 1.5) * 1.5).toFixed(1),
    contractYears: 3 + Math.floor(Math.random() * 2),
  };
  _pushNews({ type:"coach_hire",
    label: `🏟 Your team promoted ${fromSlot.toUpperCase()} ${coord.name} to head coach` });

  // Vacated slot always filled from new HC's network
  const isOC = fromSlot === "oc";
  if (isOC) {
    if (staff._chemistry) staff._chemistry.qbOcBond = false;
    staff.oc = _rollOC();
  } else {
    staff.dc = _rollDC();
  }
  _pushNews({ type:"coach_hire",
    label: `🏟 New HC ${staff.hc.name} hires ${fromSlot.toUpperCase()} ${staff[fromSlot].name} from their network` });

  // 40% chance: also replaces the other coordinator
  const otherSlot = isOC ? "dc" : "oc";
  if (Math.random() < 0.40) {
    const oldOtherName = staff[otherSlot]?.name;
    if (isOC) {
      staff.dc = _rollDC();
    } else {
      if (staff._chemistry) staff._chemistry.qbOcBond = false;
      staff.oc = _rollOC();
    }
    _pushNews({ type:"coach_hire",
      label: `🏟 New HC also installs ${otherSlot.toUpperCase()} ${staff[otherSlot].name}${oldOtherName ? ` (replaces ${oldOtherName})` : ""}` });
  }
  // _chemistry NOT nulled — internal promotions preserve existing staff relationships

  saveFranchise();
  renderFrnCoachingStaff();
}

// Fires the current HC and re-renders the staff page in vacancy state.
// The HC market candidates at the bottom let the user pick their replacement.
function frnBrowseHcMarket() {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const oldName    = staff.hc?.name;
  staff.hc         = null;
  staff._chemistry = null;
  if (oldName) _pushNews({ type:"coach_depart", label: `🚪 HC ${oldName} released` });
  saveFranchise();
  renderFrnCoachingStaff();
}

function frnHireCoachFromMarket(slot, marketIdx) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const market = franchise._coachMarket || [];
  const pool = market.filter(c => c.type === slot);
  const pick = pool[marketIdx];
  if (!pick) return;
  if (slot === "hc") {
    const existing = staff.hc;
    staff.hc = { ...pick, yearsWithTeam: 0, record: existing?.record || { w:0, l:0, championships:0 } };
    delete staff.hc.type;
    staff._chemistry = null;
    _pushNews({ type:"coach_hire", label: `You hired HC ${staff.hc.name}` });
    for (const msg of _applyHcStaffSweep(staff, "Your team")) _pushNews(msg);
  } else if (slot === "oc") {
    if (staff._chemistry) staff._chemistry.qbOcBond = false;
    staff.oc = { ...pick, yearsWithTeam: 0 };
    delete staff.oc.type;
    _pushNews({ type:"coach_hire", label: `You hired OC ${staff.oc.name}` });
  } else if (slot === "dc") {
    staff.dc = { ...pick, yearsWithTeam: 0 };
    delete staff.dc.type;
    _pushNews({ type:"coach_hire", label: `You hired DC ${staff.dc.name}` });
  }
  // Remove from market to prevent double-hiring
  const globalIdx = market.indexOf(pick);
  if (globalIdx !== -1) market.splice(globalIdx, 1);
  saveFranchise();
  renderFrnCoachingStaff();
}

function frnHirePositionCoach(group) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  if (!staff.positionStaff) staff.positionStaff = [];
  const MAX_SLOTS = 3;
  if (staff.positionStaff.length >= MAX_SLOTS) {
    alert(`You already have ${MAX_SLOTS} position coaches. Upgrade one instead.`);
    return;
  }
  const newCoach = _rollPositionCoach(group);
  staff.positionStaff.push(newCoach);
  _pushNews({ type:"coach_hire", label: `Hired ${group} coach ${newCoach.name} (${newCoach.tier})` });
  saveFranchise();
  renderFrnCoachingStaff();
}

function frnUpgradePositionCoach(group) {
  const myId  = franchise.chosenTeamId;
  const staff = franchise.coaches?.[myId];
  if (!staff) return;
  const tiers = Object.keys(POSITION_COACH_TIERS);
  const idx = (staff.positionStaff || []).findIndex(s => s.group === group);
  if (idx === -1) { frnHirePositionCoach(group); return; }
  const cur = staff.positionStaff[idx];
  const curTierIdx = tiers.indexOf(cur.tier);
  if (curTierIdx >= tiers.length - 1) {
    alert(`${group} coach is already at Elite tier.`);
    return;
  }
  const nextTier = tiers[curTierIdx + 1];
  const cost = POSITION_COACH_TIERS[nextTier].salary;
  if (!confirm(`Upgrade ${group} coach to ${nextTier} tier? Cost: $${cost}M/yr`)) return;
  cur.tier    = nextTier;
  cur.salary  = cost;
  cur.name    = `${pickFirstName()} ${pickLastName()}`; // new hire at that tier
  _pushNews({ type:"coach_hire", label: `Upgraded ${group} coach to ${nextTier}: ${cur.name}` });
  saveFranchise();
  renderFrnCoachingStaff();
}

