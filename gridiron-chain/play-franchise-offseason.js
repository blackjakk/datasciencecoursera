// ── Record Book ──────────────────────────────────────────────────────────────
// Tracks the all-time single-game + single-season records of the league.
// Single-game records are updated incrementally after each game (since
// the schedule is wiped each offseason). Single-season records are
// rolled up at season's end in showFrnAwards. Both stamp into
// franchise.records.brokenLog so the awards screen can showcase what
// fell this year.
const _RECORD_CATS = [
  { key:"pass_yds", label:"PASSING YARDS",   scope:["QB"] },
  { key:"pass_td",  label:"PASSING TDs",     scope:["QB"] },
  { key:"pass_comp",label:"COMPLETIONS",     scope:["QB"] },
  { key:"rush_yds", label:"RUSHING YARDS",   scope:["RB","QB"] },
  { key:"rush_td",  label:"RUSHING TDs",     scope:["RB","QB"] },
  { key:"rec_yds",  label:"RECEIVING YARDS", scope:["WR","TE","RB"] },
  { key:"rec_td",   label:"RECEIVING TDs",   scope:["WR","TE","RB"] },
  { key:"rec",      label:"RECEPTIONS",      scope:["WR","TE","RB"] },
  { key:"sk",       label:"SACKS",           scope:["DL","LB","S","CB"] },
  { key:"int_made", label:"INTERCEPTIONS",   scope:["CB","S","LB","DL"] },
  { key:"tkl",      label:"TACKLES",         scope:["LB","S","CB","DL"] },
  { key:"fg_made",  label:"FIELD GOALS MADE",scope:["K"] },
  { key:"fg_long",  label:"LONGEST FG",      scope:["K"] },
  { key:"pancakes", label:"PANCAKE BLOCKS",  scope:["OL","LT","LG","C","RG","RT"] },
];

function _ensureRecordBook() {
  if (!franchise.records) franchise.records = {};
  if (!franchise.records.singleGame)   franchise.records.singleGame = {};
  if (!franchise.records.singleSeason) franchise.records.singleSeason = {};
  if (!franchise.records.brokenLog)    franchise.records.brokenLog = [];
}

// Hooked into frnSimOnce after stats merge. Updates single-game records;
// stamps the previous holder onto brokenLog when toppled.
function _updateSingleGameRecords(homeId, awayId, gameStats, week, isPlayoff) {
  if (!gameStats) return;
  _ensureRecordBook();
  const sides = [
    { teamId: homeId, oppId: awayId, players: gameStats.home?.players || {} },
    { teamId: awayId, oppId: homeId, players: gameStats.away?.players || {} },
  ];
  for (const side of sides) {
    for (const [name, line] of Object.entries(side.players)) {
      const pos = line.pos || "";
      for (const def of _RECORD_CATS) {
        if (!def.scope.includes(pos)) continue;
        const v = +line[def.key] || 0;
        if (v <= 0) continue;
        const existing = franchise.records.singleGame[def.key];
        if (!existing || v > existing.value) {
          const next = {
            value: v, playerName: name, pos,
            teamId: side.teamId, oppId: side.oppId,
            season: franchise.season, week, isPlayoff: !!isPlayoff,
          };
          if (existing && existing.season != null) {
            franchise.records.brokenLog.push({
              recordType: "single-game",
              category: def.key, label: def.label,
              broken: { ...existing }, "new": next,
              atSeason: franchise.season, atWeek: week,
            });
          }
          franchise.records.singleGame[def.key] = next;
        }
      }
    }
  }
}

// Called at season's end from showFrnAwards. Walks franchise.seasonStats
// for max-in-category and compares to all-time single-season records.
function _updateSingleSeasonRecords() {
  _ensureRecordBook();
  for (const def of _RECORD_CATS) {
    if (def.key === "fg_long") continue; // single-game only
    let best = null;
    for (const [tidStr, players] of Object.entries(franchise.seasonStats || {})) {
      const tid = Number(tidStr);
      for (const [name, p] of Object.entries(players)) {
        if (!def.scope.includes(p.pos)) continue;
        const v = +p[def.key] || 0;
        if (v <= 0) continue;
        if (!best || v > best.value) {
          best = { value: v, playerName: name, pos: p.pos, teamId: tid, season: franchise.season };
        }
      }
    }
    if (!best) continue;
    const existing = franchise.records.singleSeason[def.key];
    if (!existing || best.value > existing.value) {
      if (existing && existing.season != null) {
        franchise.records.brokenLog.push({
          recordType: "single-season",
          category: def.key, label: def.label,
          broken: { ...existing }, "new": best,
          atSeason: franchise.season,
        });
      }
      franchise.records.singleSeason[def.key] = best;
    }
  }
}

function _recordsBrokenThisSeason() {
  if (!franchise.records?.brokenLog) return [];
  return franchise.records.brokenLog.filter(b => b.atSeason === franchise.season);
}

// ── Active Streaks ──────────────────────────────────────────────────────────
// Computed on demand from a player's current-season game log (the
// franchise.schedule entries). Streaks reset at season boundaries, just
// like real life. Returns a list of {count, label, icon} entries.
function _computeActiveStreaks(p) {
  if (!franchise?.schedule || !p) return [];
  const games = [];
  for (const g of franchise.schedule) {
    if (!g.played || !g.stats) continue;
    const line = g.stats.home?.players?.[p.name] || g.stats.away?.players?.[p.name];
    if (!line) continue;
    games.push({ week: g.week || 0, line });
  }
  games.sort((a, b) => a.week - b.week);
  if (games.length < 2) return [];

  const out = [];
  const streak = (criterion, label, icon, min = 2) => {
    let count = 0;
    for (let i = games.length - 1; i >= 0; i--) {
      if (criterion(games[i].line)) count++;
      else break;
    }
    if (count >= min) out.push({ count, label, icon });
  };

  const pos = p.position;
  if (pos === "QB") {
    streak(l => (+l.pass_yds||0) >= 300, "games with 300+ pass yds", "🎯");
    streak(l => (+l.pass_td||0)  >= 2,   "games with 2+ pass TDs",    "🚀");
    streak(l => (+l.pass_int||0) === 0,  "INT-free games",            "✋", 3);
  } else if (pos === "RB") {
    streak(l => (+l.rush_yds||0) >= 100, "games with 100+ rush yds",  "🏃");
    streak(l => (+l.rush_td||0)  >= 1,   "games with a rush TD",      "🔥");
  } else if (pos === "WR" || pos === "TE") {
    streak(l => (+l.rec_yds||0) >= 100,  "games with 100+ rec yds",   "🎯");
    streak(l => (+l.rec_td||0)  >= 1,    "games with a TD reception", "🔥");
    streak(l => (+l.rec||0)     >= 5,    "5+ catch games",            "🧲");
  } else if (pos === "DL" || pos === "LB") {
    streak(l => (+l.sk||0)      >= 1,    "games with a sack",         "💥");
    streak(l => (+l.tkl||0)     >= 8,    "8+ tackle games",           "🛡");
  } else if (pos === "CB" || pos === "S") {
    streak(l => (+l.int_made||0)>= 1,    "games with an INT",         "🦅");
    streak(l => (+l.pd||0)      >= 2,    "2+ PD games",               "🛡");
  } else if (pos === "K") {
    streak(l => (+l.fg_att||0) > 0 && (+l.fg_made||0) === (+l.fg_att||0),
           "perfect FG games", "🎯");
  }
  // Filter overlapping streaks: only keep the longest streak per icon-ish
  return out;
}

// ── Alumni Tracker ──────────────────────────────────────────────────────────
// At the end of each season we snapshot every team's roster (just names
// + position + departure age). At render time we compute "alumni" =
// names that appeared in the user's snapshot in any of the last 3
// seasons but are NOT currently on the roster. Their current location
// is resolved on-demand (other team, HoF, retired-unsigned).
function _takeAlumniSnapshot() {
  if (!franchise.rosterSnapshots) franchise.rosterSnapshots = [];
  const byTeam = {};
  for (const t of TEAMS) {
    byTeam[t.id] = (franchise.rosters[t.id] || []).map(p => ({
      name: p.name, pos: p.position,
      age: p.age,
      overall: p.overall, // internal — never shown
    }));
  }
  franchise.rosterSnapshots.push({ season: franchise.season, byTeam });
  // Cap retention at 25 seasons — well past any realistic franchise tenure
  // for the user, while keeping localStorage size sane (~25 × 32 × 50
  // small entries).
  if (franchise.rosterSnapshots.length > 25) {
    franchise.rosterSnapshots = franchise.rosterSnapshots.slice(-25);
  }
}

// Compute alumni for a given team using the last N seasons of snapshots.
// yearsBack = "all" to use every retained snapshot.
function _computeAlumni(teamId, yearsBack = 3) {
  if (!franchise.rosterSnapshots) return [];
  const currentNames = new Set((franchise.rosters[teamId] || []).map(p => p.name));
  const seen = new Map(); // name → { lastSeasonWithUs, pos }
  const all = franchise.rosterSnapshots;
  // Exclude this season's snapshot from "former" computation if it was
  // just stamped — current roster diff handles "still on the team."
  const trimmed = all.length > 1 ? all.slice(0, -1) : all;
  const snaps = (yearsBack === "all")
    ? trimmed
    : trimmed.slice(-yearsBack);
  const considered = (snaps.length > 0) ? snaps : trimmed;
  for (const snap of considered) {
    const names = snap.byTeam?.[teamId] || [];
    for (const entry of names) {
      if (currentNames.has(entry.name)) continue;
      const prev = seen.get(entry.name);
      if (!prev || snap.season > prev.lastSeasonWithUs) {
        seen.set(entry.name, { lastSeasonWithUs: snap.season, pos: entry.pos });
      }
    }
  }
  // Resolve current location
  const result = [];
  for (const [name, info] of seen.entries()) {
    let location = "unsigned", currentTeam = null, hofRow = null;
    // On another team?
    for (const t of TEAMS) {
      if (t.id === teamId) continue;
      if ((franchise.rosters[t.id] || []).some(p => p.name === name)) {
        location = "team"; currentTeam = t; break;
      }
    }
    // In HoF?
    if (location === "unsigned") {
      const h = (franchise.hallOfFame || []).find(x => x.name === name);
      if (h) { location = "hof"; hofRow = h; }
    }
    // Retired but not in HoF — surface as "retired"
    if (location === "unsigned") {
      // Did they retire? Check retirees in history
      for (let i = (franchise.history || []).length - 1; i >= 0; i--) {
        const r = (franchise.history[i].retirees || []).find(x => x.name === name);
        if (r) { location = "retired"; break; }
      }
    }
    result.push({
      name, pos: info.pos,
      lastSeasonWithUs: info.lastSeasonWithUs,
      location, currentTeam, hofRow,
    });
  }
  result.sort((a, b) => b.lastSeasonWithUs - a.lastSeasonWithUs ||
                       a.name.localeCompare(b.name));
  return result;
}

function _buildStreaksBlock(p) {
  const streaks = _computeActiveStreaks(p);
  if (!streaks.length) return "";
  return `<div class="frn-pcard-section" style="background:rgba(255,200,80,0.08);padding:.45rem .65rem;border-left:3px solid var(--gold);margin-top:.4rem">
    <div class="frn-card-title" style="margin-bottom:.25rem;color:var(--gold)">🔥 ACTIVE STREAKS</div>
    ${streaks.map(s => `<div style="font-size:.72rem;color:var(--white);padding:.1rem 0">${s.icon} <b style="color:var(--gold-lt)">${s.count}</b> straight ${s.label}</div>`).join("")}
  </div>`;
}

// ── All-Pro Bowl Tournament (Format C: 8 division all-star teams) ───────────
// After the awards ceremony, the league stages an exhibition tournament:
// each of the 8 divisions fields an all-star team built from its best
// regular-season performers; single-elimination bracket of 7 games crowns
// the "Best Division in Football."
const _APB_ROSTER_FORMATION = [
  ["QB", 2], ["RB", 3], ["WR", 5], ["TE", 2], ["OL", 8],
  ["DL", 6], ["LB", 5], ["CB", 4], ["S", 3], ["K", 1], ["P", 1],
];

// Synthetic team metadata per division. Primary color blends the
// strongest division team's color; name reads "<DIV> All-Stars".
function _apbBuildDivisionTeam(conf, div, seed) {
  const teams = TEAMS.filter(t => t.conference === conf && t.division === div);
  const teamIds = new Set(teams.map(t => t.id));
  // Best-record team in division sets the color identity + playbook
  const sortedByWins = teams.map(t => ({
    t,
    w: franchise.standings?.[t.id]?.w || 0,
    l: franchise.standings?.[t.id]?.l || 0,
  })).sort((a, b) => b.w - a.w);
  const lead = sortedByWins[0]?.t || teams[0];
  // Combined wins across the division — used for bracket seeding
  const totalWins = sortedByWins.reduce((s, x) => s + x.w, 0);

  // Pool all live players in division, sorted by score per position
  const pool = {};
  for (const t of teams) {
    const ts = franchise.seasonStats?.[t.id] || {};
    for (const p of (franchise.rosters[t.id] || [])) {
      const stats = ts[p.name];
      const score = _allProPlayerScore(p, p.position, stats);
      (pool[p.position] = pool[p.position] || []).push({ player: p, score, srcTeam: t });
    }
  }
  for (const k in pool) pool[k].sort((a, b) => b.score - a.score);

  const roster = [];
  const meta = [];
  for (const [pos, n] of _APB_ROSTER_FORMATION) {
    const picks = (pool[pos] || []).slice(0, n);
    for (const { player, srcTeam } of picks) {
      roster.push(player);
      meta.push({
        name: player.name, pos: player.position,
        srcTeamId: srcTeam.id, srcTeamName: srcTeam.name,
        srcTeamAbbr: _bspnLiveAbbr(srcTeam),
        srcTeamPrimary: srcTeam.primary,
        overall: player.overall, // internal — used for sorting only
      });
    }
  }

  return {
    id: -1000 - seed,   // synthetic negative IDs to avoid TEAMS collision
    name: `${div} All-Stars`,
    city: `${conf} ${div}`,
    conference: conf, division: div,
    primary: lead.primary,
    secondary: lead.secondary,
    emoji: "🌟",
    playbook: lead.playbook,
    defPlaybook: lead.defPlaybook,
    confDiv: `${conf} ${div}`,
    seed, totalWins,
    srcTeamIds: Array.from(teamIds),
    roster, rosterMeta: meta,
  };
}

// Build all 8 division all-star teams, seed them 1-8 by combined wins,
// and lay out a single-elimination bracket (1v8, 4v5, 2v7, 3v6).
function _apbInitTournament() {
  const allTeams = [];
  for (const conf of ["AFC", "NFC"]) {
    for (const div of ["East", "North", "South", "West"]) {
      allTeams.push(_apbBuildDivisionTeam(conf, div, 0));
    }
  }
  // Seed by combined regular-season wins (tiebreak: random)
  allTeams.sort((a, b) => b.totalWins - a.totalWins || Math.random() - 0.5);
  allTeams.forEach((t, i) => { t.seed = i + 1; t.id = -1000 - t.seed; });

  // Bracket layout (#-seed pairings)
  const qf = [
    { homeSeed: 1, awaySeed: 8 },
    { homeSeed: 4, awaySeed: 5 },
    { homeSeed: 2, awaySeed: 7 },
    { homeSeed: 3, awaySeed: 6 },
  ];
  const teamBySeed = Object.fromEntries(allTeams.map(t => [t.seed, t]));
  const round0 = qf.map(m => ({
    homeId: teamBySeed[m.homeSeed].id,
    awayId: teamBySeed[m.awaySeed].id,
    homeScore: null, awayScore: null,
    winnerId: null, played: false,
    stats: null, scoring: null, mvp: null,
  }));
  const round1 = [
    { homeId: null, awayId: null, homeScore: null, awayScore: null,
      winnerId: null, played: false, stats: null, scoring: null, mvp: null,
      from: [0, 1] },  // winners of QF1 + QF2
    { homeId: null, awayId: null, homeScore: null, awayScore: null,
      winnerId: null, played: false, stats: null, scoring: null, mvp: null,
      from: [2, 3] },  // winners of QF3 + QF4
  ];
  const round2 = [
    { homeId: null, awayId: null, homeScore: null, awayScore: null,
      winnerId: null, played: false, stats: null, scoring: null, mvp: null,
      from: [0, 1] },  // winners of SF1 + SF2
  ];
  return {
    teams: allTeams,
    rounds: [round0, round1, round2],
    roundLabels: ["Quarterfinals", "Semifinals", "All-Pro Bowl Final"],
    currentRound: 0,
    champion: null,
    runnerUp: null,
    mvp: null,
    complete: false,
  };
}

// Lookup synthetic team by negative ID
function _apbTeamById(t, tournament) {
  return tournament.teams.find(x => x.id === t);
}

// Simulate one APB match. Uses GameSimulator directly with the synthetic
// team + pooled roster — bypasses frnSimOnce so no franchise.seasonStats
// merge happens (exhibition).
function _apbSimMatch(tournament, roundIdx, matchIdx) {
  const m = tournament.rounds[roundIdx][matchIdx];
  if (m.played) return;
  const home = _apbTeamById(m.homeId, tournament);
  const away = _apbTeamById(m.awayId, tournament);
  if (!home || !away) return;
  const sim = new GameSimulator(home, away, home.roster, away.roster, {
    homeFieldAdv: false, // neutral-site exhibition
    isRivalry: false,
  });
  const r = sim.simulate();
  m.homeScore = r.homeScore;
  m.awayScore = r.awayScore;
  m.winnerId  = r.homeScore >= r.awayScore ? home.id : away.id;
  m.played    = true;
  m.stats     = _stripGameStatsForStorage(r.stats);
  if (r.plays) m.scoring = _extractScoringTimeline(r.plays, r.homeScore, r.awayScore);
  // Per-game MVP — top mvpScore on the winning side
  const winSide = m.winnerId === home.id ? "home" : "away";
  const winPlayers = Object.values(r.stats?.[winSide]?.players || {});
  if (winPlayers.length) {
    const ranked = winPlayers.map(p => ({ ...p, score: mvpScore(p) }))
                              .sort((a, b) => b.score - a.score);
    m.mvp = {
      name: ranked[0].name, pos: ranked[0].pos,
      line: mvpStatLine(ranked[0]),
      score: Math.round(ranked[0].score),
    };
  }
  // Stamp Pro Bowl appearances onto every player who suited up for an
  // All-Pro Bowl appearance (regardless of result). Already stamped from
  // _stampSeasonAccolades for first/second-team selections — only add
  // unique "APB Roster" so we can track via histories. Skip if already
  // there.
}

// Carry winners forward to fill the next round.
function _apbAdvanceWinners(tournament) {
  for (let r = 0; r < tournament.rounds.length - 1; r++) {
    const cur = tournament.rounds[r];
    const next = tournament.rounds[r + 1];
    for (const nm of next) {
      if (nm.homeId != null && nm.awayId != null) continue;
      const [a, b] = nm.from || [];
      if (a == null || b == null) continue;
      const aWin = cur[a]?.winnerId;
      const bWin = cur[b]?.winnerId;
      if (aWin) nm.homeId = aWin;
      if (bWin) nm.awayId = bWin;
    }
  }
  // Update currentRound — advance when current round is fully played.
  while (tournament.currentRound < tournament.rounds.length &&
         tournament.rounds[tournament.currentRound].every(m => m.played)) {
    tournament.currentRound += 1;
  }
  // Finalize if final game is played.
  const finalMatch = tournament.rounds[tournament.rounds.length - 1][0];
  if (finalMatch.played && !tournament.complete) {
    tournament.complete = true;
    tournament.champion = finalMatch.winnerId;
    tournament.runnerUp = finalMatch.winnerId === finalMatch.homeId ? finalMatch.awayId : finalMatch.homeId;
    // Tournament MVP — highest mvpScore across all final-game players (not just winner side)
    const finalStats = finalMatch.stats;
    if (finalStats) {
      const all = [
        ...Object.values(finalStats.home?.players || {}),
        ...Object.values(finalStats.away?.players || {}),
      ];
      const ranked = all.map(p => ({ ...p, score: mvpScore(p) }))
                        .sort((a, b) => b.score - a.score);
      if (ranked[0]) {
        // Find the live player for click-through
        const live = _findPlayer(ranked[0].name);
        const champ = _apbTeamById(tournament.champion, tournament);
        const meta = champ?.rosterMeta.find(m => m.name === ranked[0].name);
        tournament.mvp = {
          name: ranked[0].name, pos: ranked[0].pos,
          srcTeamId: meta?.srcTeamId, srcTeamAbbr: meta?.srcTeamAbbr,
          srcTeamPrimary: meta?.srcTeamPrimary,
          line: mvpStatLine(ranked[0]),
        };
        // Stamp accolade
        if (live) {
          const hist = live.careerHistory || (live.careerHistory = []);
          const row = hist.find(h => h.season === franchise.season);
          if (row) {
            row.accolades = row.accolades || [];
            if (!row.accolades.includes("All-Pro Bowl MVP")) row.accolades.push("All-Pro Bowl MVP");
          }
        }
        // News alert
        const champTeam = _apbTeamById(tournament.champion, tournament);
        _pushNews({
          type: "apb_final",
          label: `🏆 ${champTeam.confDiv} ALL-STARS take the All-Pro Bowl — ${tournament.mvp.name} (${tournament.mvp.pos}) named tournament MVP`,
        });
      }
    }
  }
}

// Public entry points
function frnStartAllProBowl() {
  if (!franchise.allProBowlTournament) {
    franchise.allProBowlTournament = _apbInitTournament();
    saveFranchise();
  }
  renderAllProBowl();
}

function frnSimApbMatch(roundIdx, matchIdx) {
  const t = franchise.allProBowlTournament;
  if (!t) return;
  _apbSimMatch(t, roundIdx, matchIdx);
  _apbAdvanceWinners(t);
  saveFranchise();
  renderAllProBowl();
}

function frnSimApbRound() {
  const t = franchise.allProBowlTournament;
  if (!t) return;
  const r = t.currentRound;
  if (r >= t.rounds.length) return;
  for (let i = 0; i < t.rounds[r].length; i++) {
    if (!t.rounds[r][i].played && t.rounds[r][i].homeId != null && t.rounds[r][i].awayId != null) {
      _apbSimMatch(t, r, i);
    }
  }
  _apbAdvanceWinners(t);
  saveFranchise();
  renderAllProBowl();
}

function frnSimApbAll() {
  const t = franchise.allProBowlTournament;
  if (!t) return;
  while (t.currentRound < t.rounds.length && !t.complete) {
    const r = t.currentRound;
    let anyUnplayed = false;
    for (let i = 0; i < t.rounds[r].length; i++) {
      if (!t.rounds[r][i].played && t.rounds[r][i].homeId != null && t.rounds[r][i].awayId != null) {
        _apbSimMatch(t, r, i);
        anyUnplayed = true;
      }
    }
    _apbAdvanceWinners(t);
    if (!anyUnplayed) break;
  }
  saveFranchise();
  renderAllProBowl();
}

// Build the All-Pro Bowl page
function renderAllProBowl() {
  frnHoverTipHide && frnHoverTipHide();
  _frnHoverTipPgHide && _frnHoverTipPgHide();
  const t = franchise.allProBowlTournament;
  if (!t) { renderFrnAwards(); return; }
  const link = (name) => playerLinkByName ? playerLinkByName(name) : name;

  // Trophy card when complete
  const champTeam = t.complete ? _apbTeamById(t.champion, t) : null;
  const trophyCard = (t.complete && champTeam) ? `
    <div class="bspnlive-apb-trophy-card">
      <div class="bspnlive-apb-trophy-icon">🏆</div>
      <div>
        <div class="bspnlive-apb-trophy-eyebrow">ALL-PRO BOWL CHAMPIONS · SEASON ${franchise.season}</div>
        <div class="bspnlive-apb-trophy-name">${champTeam.confDiv.toUpperCase()} ALL-STARS</div>
        ${t.mvp ? `<div class="bspnlive-apb-trophy-mvp">⭐ Tournament MVP: <b>${link(t.mvp.name)}</b> (${t.mvp.pos}) · <span style="color:${t.mvp.srcTeamPrimary}">${t.mvp.srcTeamAbbr || ""}</span> · ${t.mvp.line}</div>` : ""}
      </div>
    </div>` : "";

  // Hero
  const hero = `
    <div class="bspnlive-apb-hero">
      <div class="bspnlive-apb-hero-eyebrow">EXHIBITION TOURNAMENT · SEASON ${franchise.season}</div>
      <div class="bspnlive-apb-hero-title">ALL-PRO BOWL</div>
      <div class="bspnlive-apb-hero-sub">8 division all-star squads · single-elimination · 7 games to division supremacy</div>
    </div>`;

  // Each round
  const teamCell = (id, score, isWinner, isLoser) => {
    const team = _apbTeamById(id, t);
    if (!team) return `<div class="bspnlive-apb-match-side"><span class="bspnlive-apb-seed">—</span><span class="bspnlive-apb-team" style="color:var(--blgray);font-style:italic">TBD</span><span class="bspnlive-apb-score"></span></div>`;
    return `<div class="bspnlive-apb-match-side ${isWinner ? 'winner' : ''} ${isLoser ? 'loser' : ''}">
      <span class="bspnlive-apb-seed">#${team.seed}</span>
      <span class="bspnlive-apb-team"><span class="bspnlive-apb-team-stripe" style="background:${team.primary}"></span>${team.confDiv} All-Stars</span>
      <span class="bspnlive-apb-score">${score != null ? score : ""}</span>
    </div>`;
  };
  const renderMatch = (m, ri, mi) => {
    const cls = m.played ? "played" :
                (m.homeId != null && m.awayId != null) ? "upcoming" : "";
    const homeW = m.played && m.winnerId === m.homeId;
    const awayW = m.played && m.winnerId === m.awayId;
    const action = (!m.played && m.homeId != null && m.awayId != null)
      ? `<div class="bspnlive-apb-match-action"><button class="bspnlive-btn-outline" onclick="frnSimApbMatch(${ri},${mi})" style="font-size:.72rem;padding:.25rem .65rem">▶ Sim</button></div>`
      : "";
    const mvpLine = (m.played && m.mvp)
      ? `<div style="margin-top:.25rem;color:var(--blgray);font-size:.62rem">⭐ ${link(m.mvp.name)} (${m.mvp.pos}) · ${m.mvp.line}</div>`
      : "";
    return `<div class="bspnlive-apb-match ${cls}">
      ${teamCell(m.awayId, m.awayScore, awayW, homeW && m.played)}
      ${teamCell(m.homeId, m.homeScore, homeW, awayW && m.played)}
      ${mvpLine}${action}
    </div>`;
  };
  const roundsHtml = t.rounds.map((round, ri) => {
    const played = round.filter(m => m.played).length;
    const total  = round.length;
    const isCurrent = ri === t.currentRound;
    return `<div class="bspnlive-apb-round" style="${isCurrent && !t.complete ? 'border-color:var(--blgold)' : ''}">
      <div class="bspnlive-apb-round-head">
        <div class="bspnlive-apb-round-title">${t.roundLabels[ri]}</div>
        <div class="bspnlive-apb-round-progress">${played}/${total}</div>
      </div>
      <div class="bspnlive-apb-matches">
        ${round.map((m, mi) => renderMatch(m, ri, mi)).join("")}
      </div>
    </div>`;
  }).join("");

  // Rosters of teams still alive
  const aliveTeams = t.teams.filter(team => {
    if (t.complete) return team.id === t.champion;
    // Alive if seen in current or later round
    for (let r = t.currentRound; r < t.rounds.length; r++) {
      for (const m of t.rounds[r]) {
        if (m.homeId === team.id || m.awayId === team.id) return true;
      }
    }
    return false;
  });
  const rosterHtml = aliveTeams.length && aliveTeams.length <= 8 ? `
    <div class="bspnlive-section-title">📋 ${t.complete ? "CHAMPION ROSTER" : "TEAMS STILL ALIVE"}</div>
    <div class="bspnlive-allpro-grid">
      ${aliveTeams.map(team => `
        <div class="bspnlive-allpro-block" style="border-top-color:${team.primary}">
          <div class="bspnlive-allpro-title">#${team.seed} · ${team.confDiv.toUpperCase()} ALL-STARS</div>
          <div class="bspnlive-apb-roster-grid">
            ${team.rosterMeta.slice(0, 18).map(p => `
              <div class="bspnlive-apb-roster-row">
                <span class="bspnlive-apb-roster-pos">${p.pos}</span>
                <span class="bspnlive-apb-roster-name">${link(p.name)}</span>
                <span class="bspnlive-apb-roster-tm" style="color:${p.srcTeamPrimary}">${p.srcTeamAbbr}</span>
              </div>`).join("")}
          </div>
        </div>`).join("")}
    </div>` : "";

  // Action buttons
  const hasUnplayedInCurrent = t.currentRound < t.rounds.length &&
    t.rounds[t.currentRound].some(m => !m.played && m.homeId != null && m.awayId != null);
  const actions = `
    <div class="bspnlive-awards-footer">
      ${hasUnplayedInCurrent ? `<button class="bspnlive-btn-gold" onclick="frnSimApbRound()">⏩ Sim ${t.roundLabels[t.currentRound]}</button>` : ""}
      ${!t.complete ? `<button class="bspnlive-btn-outline" onclick="frnSimApbAll()">⏭ Sim Tournament</button>` : ""}
      <button class="bspnlive-btn-outline" onclick="renderFrnAwards()">‹ Awards Ceremony</button>
      ${t.complete ? `<button class="bspnlive-btn-gold" onclick="startFrnOffseason()">⏭ Begin Offseason</button>` : ""}
    </div>`;

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1.2rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">ALL-PRO BOWL · SEASON ${franchise.season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("AWARDS")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="renderFrnAwards()">‹ Back to Awards</button>
      </div>
      <div class="bspnlive-awards-body">
        ${trophyCard}
        ${hero}
        <div class="bspnlive-apb-rounds">${roundsHtml}</div>
        ${rosterHtml}
        ${actions}
      </div>
    </div>`;
}

// ── Sim helpers ──────────────────────────────────────────────────────────────
// `frnSimOnce` returns the simulation result; callers use it to capture
// season stats + highlights as a side effect. The full game object is
// available on the returned `.full` for callers that need playoff details.
function frnSimOnce(homeId, awayId, isPlayoff = false) {
  const isRivalry = _areRivals(homeId, awayId);
  const sim = new GameSimulator(
    getTeam(homeId), getTeam(awayId),
    franchise.rosters[homeId], franchise.rosters[awayId],
    { isRivalry }
  );
  // Coaching trait bumps applied AFTER constructor so they layer on
  // top of HFA. Offensive/Defensive guru = +2 in their phase.
  const hcHome = franchise.coaches?.[homeId]?.hc?.trait;
  const hcAway = franchise.coaches?.[awayId]?.hc?.trait;
  if (hcHome === "Offensive Guru")        sim.homeR.offense += 2;
  if (hcHome === "Defensive Mastermind")  sim.homeR.defense += 2;
  if (hcAway === "Offensive Guru")        sim.awayR.offense += 2;
  if (hcAway === "Defensive Mastermind")  sim.awayR.defense += 2;
  const r = sim.simulate();
  // Stamp gameday context onto the result so callers can persist it
  r.weather = sim.weather;
  r.isRivalry = isRivalry;
  mergeSeasonStats(homeId, awayId, r.stats);
  _updateSingleGameRecords(homeId, awayId, r.stats, franchise.week, isPlayoff);
  captureGameHighlights(homeId, awayId, r.plays, isPlayoff,
    isPlayoff ? `Playoff R${(franchise.playoffBracket?.roundIdx ?? 0) + 1}` : `W${franchise.week}`);
  return { homeScore: r.homeScore, awayScore: r.awayScore, full: r };
}

// Two teams are "rivals" if they share a division. Tagged on schedule
// entries at season-init by _assignRivalries; runtime fallback below.
function _areRivals(aId, bId) {
  const a = getTeam(aId), b = getTeam(bId);
  if (!a || !b) return false;
  return a.conference === b.conference && a.division === b.division;
}

function markGamePlayed(homeId, awayId, homeScore, awayScore, gameStats, plays, ctx) {
  const g = franchise.schedule.find(
    x => !x.played && x.homeId === homeId && x.awayId === awayId
  );
  if (g) {
    g.homeScore = homeScore; g.awayScore = awayScore; g.played = true;
    if (gameStats) g.stats = _stripGameStatsForStorage(gameStats);
    if (plays)     g.scoring = _extractScoringTimeline(plays, homeScore, awayScore);
    if (ctx?.weather)     g.weather = { label: ctx.weather.label, windStrength: ctx.weather.windStrength };
    if (ctx?.isRivalry)   g.isRivalry = true;
  }
  recordFranchiseResult(homeId, awayId, homeScore, awayScore);
}

// Extract a compact scoring timeline from sim plays. Each entry:
//   { qtr, clock, poss, pts, desc, homeScore, awayScore }
// Used by the past-game viewer to render quarter-by-quarter scoring
// and the win-probability chart.
function _extractScoringTimeline(plays, finalHome, finalAway) {
  if (!Array.isArray(plays)) return [];
  const out = [];
  let h = 0, a = 0, lastQtr = 1;
  for (const p of plays) {
    // Score events get a dot. Drive summaries get a no-dot anchor
    // so the WP chart wiggles as time advances even on stalled drives.
    if (p.kind === "score") {
      if (p.poss && p.pts != null) {
        if (p.poss === "home") h += p.pts; else a += p.pts;
        lastQtr = p.quarter || lastQtr;
        out.push({
          qtr: lastQtr, clock: p.clockAfter,
          poss: p.poss, pts: p.pts, desc: p.desc || "",
          homeScore: h, awayScore: a, isScore: true,
        });
      } else if (p.homeScore != null && p.awayScore != null) {
        const pts = (p.homeScore - h) + (p.awayScore - a);
        const side = (p.homeScore > h) ? "home" : "away";
        h = p.homeScore; a = p.awayScore;
        out.push({
          qtr: lastQtr, clock: p.clockAfter, poss: side, pts,
          desc: p.desc || "",
          homeScore: h, awayScore: a, isScore: true,
        });
      }
    } else if (p.kind === "drive_summary") {
      // Drive end without a score (TO/PUNT/MISS/DOWNS). The current
      // score is on the event; clock is `time` (seconds left in qtr).
      lastQtr = p.quarter || lastQtr;
      const result = String(p.driveResult || "").toUpperCase();
      // If the drive ended in a score we already pushed it above;
      // skip the dupe entry. Otherwise this is a non-scoring drive end.
      if (result === "TD" || result === "FG" || result === "SAFETY") continue;
      out.push({
        qtr: lastQtr, clock: p.time,
        poss: null, pts: 0, desc: result || "Drive end",
        homeScore: p.homeScore ?? h,
        awayScore: p.awayScore ?? a,
        isScore: false, driveResult: result,
      });
    }
  }
  // Sanity: if final totals don't match, append a synthetic delta so
  // the chart ends at the actual final score.
  if (h !== finalHome || a !== finalAway) {
    out.push({
      qtr: 4, clock: 0, poss: finalHome > h ? "home" : "away",
      pts: Math.max(0, (finalHome - h) + (finalAway - a)),
      desc: "Final score adjustment",
      homeScore: finalHome, awayScore: finalAway, isScore: true,
    });
  }
  // Stable order by elapsed game time.
  out.sort((x, y) => {
    const xe = ((x.qtr || 1) - 1) * 900 + (900 - (x.clock || 0));
    const ye = ((y.qtr || 1) - 1) * 900 + (900 - (y.clock || 0));
    return xe - ye;
  });
  return out;
}

// Strip a sim's gameStats down to just per-player numeric box-score
// data so we can persist N games per season without blowing localStorage.
// Drops play-by-play arrays; keeps totals + per-player stat lines.
function _stripGameStatsForStorage(stats) {
  if (!stats) return null;
  const out = { home: { totals: {}, players: {} }, away: { totals: {}, players: {} } };
  for (const side of ["home", "away"]) {
    const s = stats[side];
    if (!s) continue;
    // Team totals live under s.team (firstDowns, totalYds, passYds, rushYds,
    // turnovers, sacks, penalties, penaltyYds, timeOfPoss, …).
    if (s.team) {
      for (const [k, v] of Object.entries(s.team)) {
        if (typeof v === "number") out[side].totals[k] = v;
      }
    }
    if (s.players) {
      for (const [name, p] of Object.entries(s.players)) {
        const slim = { name: p.name || name, pos: p.pos };
        for (const [k, v] of Object.entries(p)) {
          if (typeof v === "number" && v !== 0) slim[k] = v;
        }
        // Skip players with zero stat lines
        if (Object.keys(slim).length > 2) out[side].players[name] = slim;
      }
    }
  }
  return out;
}

// When all of the current week's games are played, flag a pending
// week-end review. Don't run resolution or advance the week — the user
// has to click "Advance" so they can manage FA, see news, etc. first.
function _checkWeekComplete() {
  const w = franchise.week;
  if (w > FRANCHISE_WEEKS) return;
  const wGames = franchise.schedule.filter(g => g.week === w);
  if (wGames.length && wGames.every(g => g.played)) {
    franchise.weekPending = true;
  }
}

// Split out from the old advanceWeekIfDone: end-of-week resolution.
// Runs FA bid resolution + AI counter-bid round + injury tick. Does NOT
// bump the week counter.
function _runWeekEndResolution() {
  const w = franchise.week;
  if (franchise.faNegotiations && Object.keys(franchise.faNegotiations).length) {
    const seasonEnding = (w + 1) > FRANCHISE_WEEKS;
    _faResolveAfterWeek(w, seasonEnding);
    if (!seasonEnding) _faAIBidRound(w + 1, /*isInitial=*/false);
  }
  _tickInjuriesForWeek();
  // Trade-block: unsolicited offers (no public ask) + price-tag offers
  // (public ask matched against AI inventories).
  if (w + 1 <= TRADE_DEADLINE_WEEK) {
    _generateWeeklyAIOffers();
    _processBlockAsks();
    _generateAIvsAITrades();
  }
  // Practice squad: weekly flash roll + poach pass. Auto-spend any
  // remaining scout visits if the user has that toggle on.
  if (franchise.autoSpendScouts !== false) _psAutoSpendVisits();
  _psWeeklyFlashRoll();
  _psPoachPass();
  // Mid-season extension demands: stars in their contract year roll
  // for "wants a new deal" / forces 1-week sit-out if ignored.
  _checkHoldoutDemands();
  // Coach hot-seat alerts after a clear early-season sample.
  _checkCoachHotSeat();
  // League chat: AI teams react to last week's news
  _generateAITrashTalk();
}

// Bump the week counter, handle cap grace + season-end transitions.
function _bumpWeek() {
  franchise.week += 1;
  if (franchise.capGraceDeadline != null && franchise.week >= franchise.capGraceDeadline) {
    const cap  = franchise.salaryCap || SALARY_CAP_BASE;
    const used = capUsedByTeam(franchise.chosenTeamId);
    franchise.capGraceDeadline = null;
    if (used > cap) {
      franchise.phase = "fa_cuts";
      return;
    }
  }
  if (franchise.week > FRANCHISE_WEEKS) franchise.phase = "playoffs_pending";
}

// User-clicked "Advance to next week" from the review interstitial.
function frnAdvanceWeek() {
  if (!franchise.weekPending) return;
  try { _runWeekEndResolution(); } catch(e) { console.error("[frnAdvanceWeek] resolution error (non-fatal):", e); }
  _bumpWeek();
  franchise.weekPending = false;
  _flushSaveFranchise();
  showFranchiseDashboard();
}

// Legacy name preserved for any callers — now just marks the flag.
function advanceWeekIfDone() {
  _checkWeekComplete();
}

function frnSimGame(homeId, awayId) {
  // Only allow simming a game in the current week — otherwise you can
  // chain future-week games while leaving the current week unfinished.
  const target = franchise.schedule.find(g =>
    !g.played && g.homeId === Number(homeId) && g.awayId === Number(awayId));
  if (!target) return;
  if (target.week !== franchise.week) {
    alert("Finish the current week before simming future games.");
    return;
  }
  const r = frnSimOnce(homeId, awayId);
  markGamePlayed(homeId, awayId, r.homeScore, r.awayScore, r.full?.stats, r.full?.plays,
    { weather: r.full?.weather, isRivalry: r.full?.isRivalry });
  _checkWeekComplete();
  _flushSaveFranchise();
  showFranchiseDashboard();
}

// ── Player of the Week ────────────────────────────────────────────────────────
// Generates top-3 candidates per group and auto-selects the leader as winner.
// User can override via renderPotwVoting(); votes tally toward POTY at season end.
function _computeAndStorePOTW(week) {
  if (!franchise.potw) franchise.potw = {};
  if (!franchise.potwCandidates) franchise.potwCandidates = {};
  const seasonKey = franchise.season;
  if (!franchise.potw[seasonKey]) franchise.potw[seasonKey] = {};
  if (!franchise.potwCandidates[seasonKey]) franchise.potwCandidates[seasonKey] = {};

  const weekGames = franchise.schedule.filter(g => g.week === week && g.played && g.stats);
  if (!weekGames.length) return;

  const pMap = {};
  for (const g of weekGames) {
    for (const [side, teamId] of [["home", g.homeId], ["away", g.awayId]]) {
      const players = g.stats[side]?.players || {};
      for (const [name, p] of Object.entries(players)) {
        if (!pMap[name]) pMap[name] = { ...p, teamId };
        else for (const [k, v] of Object.entries(p)) {
          if (typeof v === "number") pMap[name][k] = (pMap[name][k] || 0) + v;
        }
      }
    }
  }

  const allP = Object.values(pMap);
  const OL_POS    = new Set(["OL","LT","LG","C","RG","RT"]);
  const SKILL_POS = new Set(["QB","RB","WR","TE"]);
  const DEF_POS   = new Set(["DL","LB","CB","S","DE","DT","FS","SS"]);
  const ST_POS    = new Set(["K","P"]);

  const pickTop = (filter, scoreF, n = 3) => {
    const pool = allP.filter(filter).map(p => ({ ...p, _s: scoreF(p) })).filter(p => p._s > 0);
    pool.sort((a, b) => b._s - a._s);
    return pool.slice(0, n).map(p => {
      const t = getTeam(p.teamId);
      return { name: p.name, pos: p.pos, teamId: p.teamId,
        teamAbbr: t ? _bspnLiveAbbr(t) : "—", teamPrimary: t?.primary || "#888",
        statLine: mvpStatLine(p), score: p._s };
    });
  };

  const candidates = {
    offense:      pickTop(p => SKILL_POS.has(p.pos), mvpScore),
    defense:      pickTop(p => DEF_POS.has(p.pos),   mvpScore),
    ol:           pickTop(p => OL_POS.has(p.pos),    p => (p.pancakes||0)*3 - (p.sacks_allowed||0)*4),
    specialTeams: pickTop(p => ST_POS.has(p.pos),    mvpScore),
  };
  franchise.potwCandidates[seasonKey][week] = candidates;

  // Auto-winner = top of each list; overridden when user votes
  franchise.potw[seasonKey][week] = {
    offense:      candidates.offense[0]      || null,
    defense:      candidates.defense[0]      || null,
    ol:           candidates.ol[0]           || null,
    specialTeams: candidates.specialTeams[0] || null,
  };
}

// Tally user votes across the season to find the Player of the Year per group.
function _computePOTY() {
  const votes = franchise.potwVotes?.[franchise.season] || {};
  const cands = franchise.potwCandidates?.[franchise.season] || {};
  const tally = { offense: {}, defense: {}, ol: {}, specialTeams: {} };
  for (const weekVotes of Object.values(votes)) {
    for (const g of ["offense","defense","ol","specialTeams"]) {
      const n = weekVotes[g];
      if (n) tally[g][n] = (tally[g][n] || 0) + 1;
    }
  }
  const winner = (groupTally, group) => {
    const entries = Object.entries(groupTally).sort((a,b) => b[1] - a[1]);
    if (!entries.length) return null;
    const [name, wins] = entries[0];
    for (const weekCands of Object.values(cands)) {
      const found = (weekCands[group] || []).find(c => c.name === name);
      if (found) return { ...found, wins };
    }
    return { name, wins, pos: "?", teamAbbr: "—", teamPrimary: "#888", statLine: "" };
  };
  return {
    offense:      winner(tally.offense,      "offense"),
    defense:      winner(tally.defense,      "defense"),
    ol:           winner(tally.ol,           "ol"),
    specialTeams: winner(tally.specialTeams, "specialTeams"),
  };
}

// Module-level pending votes for the voting page (cleared on open)
let _potwPendingVotes = {};

function renderPotwVoting(week) {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const season = franchise.season;
  const candidates = franchise.potwCandidates?.[season]?.[week];
  if (!candidates) { showFranchiseDashboard(); return; }

  const existingVotes = franchise.potwVotes?.[season]?.[week] || {};
  _potwPendingVotes = { ...existingVotes };

  const GROUPS = [
    { key: "offense",      label: "OFFENSIVE PLAYER",   icon: "⚡" },
    { key: "defense",      label: "DEFENSIVE PLAYER",   icon: "🛡" },
    { key: "ol",           label: "OFFENSIVE LINEMAN",  icon: "🧱" },
    { key: "specialTeams", label: "SPECIAL TEAMS",      icon: "🦵" },
  ];

  const renderGroup = (g) => {
    const list = candidates[g.key] || [];
    if (!list.length) return "";
    return `<div class="potw-group">
      <div class="potw-group-title">${g.icon} ${g.label}</div>
      <div class="potw-group-cards">
        ${list.map((c, i) => {
          const isSel = _potwPendingVotes[g.key] === c.name;
          return `<div class="potw-vote-card ${isSel ? "selected" : ""}"
                       onclick="_potwSelect('${g.key}','${c.name.replace(/['"\\]/g,"")}')"
                       style="--c:${c.teamPrimary}">
            <div class="potw-vote-card-rank">#${i+1}</div>
            <div class="potw-vote-card-name">${c.name}</div>
            <div class="potw-vote-card-meta">${c.pos} · <span style="color:${c.teamPrimary}">${c.teamAbbr}</span></div>
            <div class="potw-vote-card-stat">${c.statLine || "—"}</div>
            <div class="potw-vote-card-badge">${isSel ? "✓ YOUR PICK" : "VOTE"}</div>
          </div>`;
        }).join("")}
      </div>
      ${_potwPendingVotes[g.key]
        ? `<div class="potw-group-skip"><button class="bspn-back" onclick="_potwSelect('${g.key}',null)" style="font-size:.6rem">Clear vote</button></div>`
        : ""}
    </div>`;
  };

  const isRevote = Object.keys(existingVotes).length > 0;
  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:2rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">PLAYER OF THE WEEK · WEEK ${week} VOTING · SEASON ${season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("AWARDS")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;align-items:center;flex-wrap:wrap">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Dashboard</button>
        <span style="color:var(--blgray);font-size:.67rem;letter-spacing:.4px">
          ${isRevote ? "Changing your Week " + week + " votes — wins contribute to Player of the Year"
                     : "Pick one winner per category — your votes build the POTY race all season"}
        </span>
      </div>
      <div style="padding:.8rem 1.4rem">${GROUPS.map(renderGroup).join("")}</div>
      <div style="padding:.3rem 1.4rem 1rem;display:flex;gap:.8rem;align-items:center">
        <button class="frn-cap-btn" onclick="_potwSubmitVotes(${week})"
                style="padding:.55rem 1.6rem;font-size:.78rem;letter-spacing:1px">
          LOCK IN VOTES
        </button>
        <button class="bspn-back" onclick="showFranchiseDashboard()">Skip &amp; return</button>
      </div>
    </div>`;
}

function _potwSelect(group, name) {
  if (!name || name === "null") delete _potwPendingVotes[group];
  else _potwPendingVotes[group] = name;
  // Find the week currently shown from page context
  const sub = document.querySelector(".bspnlive-logo-sub");
  const m = sub ? sub.textContent.match(/WEEK (\d+) VOTING/) : null;
  if (m) renderPotwVoting(+m[1]);
}

function _potwSubmitVotes(week) {
  if (!franchise.potwVotes) franchise.potwVotes = {};
  const season = franchise.season;
  if (!franchise.potwVotes[season]) franchise.potwVotes[season] = {};
  franchise.potwVotes[season][week] = { ...(_potwPendingVotes || {}) };

  // Promote voted players to POTW winners
  const cands = franchise.potwCandidates?.[season]?.[week] || {};
  if (!franchise.potw?.[season]?.[week]) { franchise.potw = franchise.potw || {}; franchise.potw[season] = franchise.potw[season] || {}; franchise.potw[season][week] = {}; }
  for (const g of ["offense","defense","ol","specialTeams"]) {
    const votedName = _potwPendingVotes[g];
    if (votedName) {
      const found = (cands[g] || []).find(c => c.name === votedName);
      if (found) franchise.potw[season][week][g] = found;
    }
  }
  saveFranchise();
  showFranchiseDashboard();
}

function frnSimWeek() {
  const w      = franchise.week;
  const wGames = franchise.schedule.filter(g => g.week === w && !g.played);
  for (const g of wGames) {
    const r = frnSimOnce(g.homeId, g.awayId);
    g.homeScore = r.homeScore; g.awayScore = r.awayScore; g.played = true;
    g.stats = _stripGameStatsForStorage(r.full?.stats);
    g.scoring = _extractScoringTimeline(r.full?.plays, r.homeScore, r.awayScore);
    if (r.full?.weather) g.weather = { label: r.full.weather.label, windStrength: r.full.weather.windStrength };
    if (r.full?.isRivalry) g.isRivalry = true;
    recordFranchiseResult(g.homeId, g.awayId, r.homeScore, r.awayScore);
  }
  _computeAndStorePOTW(w);
  _checkWeekComplete();
  if (franchise.weekPending) {
    try { _runWeekEndResolution(); } catch(e) { console.error("[frnSimWeek] resolution error (non-fatal):", e); }
    _bumpWeek();
    franchise.weekPending = false;
  }
  _flushSaveFranchise();
  showFranchiseDashboard();
}

// Sim-season skips week-end review interstitials and just flies
// through to the playoffs.
function frnSimSeason() {
  for (let w = franchise.week; w <= FRANCHISE_WEEKS; w++) {
    const wGames = franchise.schedule.filter(g => g.week === w && !g.played);
    for (const g of wGames) {
      const r = frnSimOnce(g.homeId, g.awayId);
      g.homeScore = r.homeScore; g.awayScore = r.awayScore; g.played = true;
      g.stats = _stripGameStatsForStorage(r.full?.stats);
      g.scoring = _extractScoringTimeline(r.full?.plays, r.homeScore, r.awayScore);
      if (r.full?.weather) g.weather = { label: r.full.weather.label, windStrength: r.full.weather.windStrength };
      if (r.full?.isRivalry) g.isRivalry = true;
      recordFranchiseResult(g.homeId, g.awayId, r.homeScore, r.awayScore);
    }
    _computeAndStorePOTW(w);
    try { _runWeekEndResolution(); } catch(e) { console.error("[frnSimSeason] resolution error (non-fatal):", e); }
    _bumpWeek();
    franchise.weekPending = false;
    if (franchise.phase === "fa_cuts" || franchise.phase === "playoffs_pending") break;
  }
  _flushSaveFranchise();
  showFranchiseDashboard();
}

// ── Play a live (animated) franchise game ────────────────────────────────────
function frnPlayGame(homeId, awayId, isPlayoff) {
  // Hide franchise home so gameArea takes focus; show playback controls
  $("franchiseHome").style.display = "none";
  $("playbackControls").style.display = "flex";
  franchise.pendingFranchiseGame = { homeId, awayId, isPlayoff };
  saveFranchise();

  const home       = getTeam(homeId), away = getTeam(awayId);
  const homeRoster = franchise.rosters[homeId];
  const awayRoster = franchise.rosters[awayId];

  // Use franchise rosters for league nickname computation
  assignLeagueNicknames(franchise.rosters);

  const sim = new GameSimulator(home, away, homeRoster, awayRoster);
  gameResult = sim.simulate();
  playHead = 0; animState = null; playing = false;
  cancelAnimationFrame(rafId);

  renderGameLayout();
  updateButtons();

  // Floating return button
  const retBtn = $("frnReturnBtn");
  retBtn.style.display = "block";

  // Auto-start playback
  playing = true;
  startNextPlay();
  updateButtons();
}

function frnFinishGame() {
  const retBtn = $("frnReturnBtn");
  if (retBtn) retBtn.style.display = "none";
  // Hide playback controls + game area, restore franchise home
  $("playbackControls").style.display = "none";
  const ga = $("gameArea"); if (ga) { ga.classList.add("empty"); ga.innerHTML = `
    <div class="empty-icon">🏈</div>
    <div style="font-size: 1.2rem; font-weight: 700; margin-bottom: .25rem;">Start a Franchise or use Testing Tools</div>
    <div style="color: var(--gray);">Animated 2D field with live play-by-play action</div>
  `; }
  $("franchiseHome").style.display = "block";

  if (!franchise || !franchise.pendingFranchiseGame) {
    showFranchiseDashboard();
    return;
  }
  const { homeId, awayId, isPlayoff } = franchise.pendingFranchiseGame;
  franchise.pendingFranchiseGame = null;

  // gameResult is always fully simulated before animation starts
  const homeScore = gameResult ? gameResult.homeScore : 0;
  const awayScore = gameResult ? gameResult.awayScore : 0;

  // Capture stats and highlights from the played game
  if (gameResult) {
    mergeSeasonStats(homeId, awayId, gameResult.stats);
    captureGameHighlights(homeId, awayId, gameResult.plays, isPlayoff,
      isPlayoff ? `Playoff R${(franchise.playoffBracket?.roundIdx ?? 0) + 1}` : `W${franchise.week}`);
  }

  if (isPlayoff) {
    // Championship round? Save SB game stats for SB MVP.
    const pb = franchise.playoffBracket;
    const isChamp = pb && pb.roundIdx === pb.rounds.length - 1;
    if (isChamp && gameResult) {
      franchise.superBowlGame = {
        homeId, awayId, homeScore, awayScore,
        stats: gameResult.stats,
        winnerId: homeScore >= awayScore ? homeId : awayId,
      };
    }
    // Stash stats on the matchup so the user can click back into the
    // box score for any playoff game (not just the championship).
    if (pb && gameResult) {
      _savePlayoffMatchupStats(pb.roundIdx, homeId, awayId, {
        homeScore, awayScore, full: gameResult,
      });
    }
    applyPlayoffResult(homeId, awayId, homeScore, awayScore);
  } else {
    markGamePlayed(homeId, awayId, homeScore, awayScore, gameResult?.stats, gameResult?.plays,
      { weather: gameResult?.weather, isRivalry: gameResult?.isRivalry });
    advanceWeekIfDone();
  }
  _flushSaveFranchise();
  showFranchiseDashboard();
}

// ── Playoffs ─────────────────────────────────────────────────────────────────
function startFrnPlayoffs() {
  const sorted = standingsSorted();
  const seeds  = sorted.slice(0, PLAYOFF_TEAMS).map((s, i) => ({
    teamId: s.id, seed: i + 1,
  }));
  // 1v8, 4v5, 2v7, 3v6 → semis → championship
  franchise.playoffBracket = {
    seeds,
    rounds: [
      [
        { homeId: seeds[0].teamId, awayId: seeds[7].teamId, homeScore: null, awayScore: null, winnerId: null },
        { homeId: seeds[3].teamId, awayId: seeds[4].teamId, homeScore: null, awayScore: null, winnerId: null },
        { homeId: seeds[1].teamId, awayId: seeds[6].teamId, homeScore: null, awayScore: null, winnerId: null },
        { homeId: seeds[2].teamId, awayId: seeds[5].teamId, homeScore: null, awayScore: null, winnerId: null },
      ],
      [
        { homeId: null, awayId: null, homeScore: null, awayScore: null, winnerId: null },
        { homeId: null, awayId: null, homeScore: null, awayScore: null, winnerId: null },
      ],
      [
        { homeId: null, awayId: null, homeScore: null, awayScore: null, winnerId: null },
      ],
    ],
    roundIdx:  0,
    champion:  null,
  };
  franchise.phase = "playoffs";
  saveFranchise();
  renderFrnPlayoffs();
}

// Your-run recap: every playoff game the user's team played this
// postseason, with linescore + box-score link. Shown when the user
// is eliminated OR when they won the championship.
function _renderYourRunRecap() {
  const myId = franchise.chosenTeamId;
  const pb = franchise.playoffBracket;
  if (!pb) return "";
  const roundNames = ["WILD CARD", "DIVISIONAL", "CHAMPIONSHIP"];
  const myGames = [];
  for (let ri = 0; ri < pb.rounds.length; ri++) {
    for (let mi = 0; mi < pb.rounds[ri].length; mi++) {
      const m = pb.rounds[ri][mi];
      if (m.homeId === myId || m.awayId === myId) {
        myGames.push({ m, ri, mi });
      }
    }
  }
  if (!myGames.length) return "";
  const regSeasonRec = franchise.standings?.[myId] || { w: 0, l: 0, t: 0 };
  const wonChamp = pb.champion === myId;
  const elim = _userPlayoffStatus().eliminationMatch;
  const finalRound = wonChamp ? "CHAMPIONSHIP"
    : elim ? roundNames[_userPlayoffStatus().eliminatedRound] : "ONGOING";
  const headerColor = wonChamp ? "var(--blgold)" : "var(--blred)";
  const headerLabel = wonChamp ? "🏆 YOUR CHAMPIONSHIP RUN"
    : `🚫 YOUR RUN — Eliminated in ${finalRound}`;
  const rows = myGames.map(({ m, ri, mi }) => {
    if (m.winnerId == null) return "";
    const oppId = m.homeId === myId ? m.awayId : m.homeId;
    const opp = getTeam(oppId);
    const myScore = m.homeId === myId ? m.homeScore : m.awayScore;
    const themScore = m.homeId === myId ? m.awayScore : m.homeScore;
    const won = m.winnerId === myId;
    return `<button class="bspnlive-recap-row" onclick="frnOpenPlayoffBox(${ri}, ${mi})">
      <span style="color:var(--blgray);font-size:.6rem;letter-spacing:1px;min-width:6rem">${roundNames[ri] || `R${ri+1}`}</span>
      <span style="color:${won?"var(--blgold)":"var(--blred)"};font-weight:900;font-size:1rem;font-family:'Bebas Neue','Anton',sans-serif;min-width:1rem">${won?"W":"L"}</span>
      <span style="color:var(--blwhite);font-weight:700;font-variant-numeric:tabular-nums">${myScore}-${themScore}</span>
      <span style="color:var(--blgray)">vs</span>
      <span style="color:${opp?.primary || "var(--blwhite)"};font-weight:700">${opp?.abbr || opp?.name?.slice(0,3).toUpperCase()}</span>
      <span style="color:var(--blgray)">${opp?.name || ""}</span>
      <span style="color:var(--blgray);font-size:.6rem;margin-left:auto">📋 Box</span>
    </button>`;
  }).join("");
  return `
    <div class="bspnlive-recap" style="border-left-color:${headerColor}">
      <div class="bspnlive-recap-head" style="color:${headerColor}">${headerLabel}</div>
      <div class="bspnlive-recap-sub">Regular season ${regSeasonRec.w}-${regSeasonRec.l}${regSeasonRec.t?`-${regSeasonRec.t}`:""} → playoffs:</div>
      <div class="bspnlive-recap-list">${rows}</div>
    </div>`;
}

// Your road to the championship — for each round in the bracket
// (including future rounds), figure out which slot the user lands in
// and surface the most-likely opponent: if both feeder matchups are
// decided, show the future opponent's name; otherwise show "X / Y".
// Rendered next to the recap when the user is still alive.
function _renderRoadToChampionship() {
  const myId = franchise.chosenTeamId;
  const pb = franchise.playoffBracket;
  if (!pb || pb.champion) return "";
  const status = _userPlayoffStatus();
  if (!status.inBracket || status.eliminatedRound != null) return "";

  // Find which matchup slot the user occupies in each round (works for
  // all bracket sizes — derived from the existing rounds shape since
  // the engine seeds them deterministically).
  const roundNames = ["WILD CARD", "DIVISIONAL", "CHAMPIONSHIP"];
  // Track which "future slot" the user is in by walking forward from
  // their current matchup and applying the (paired-matchups) rule.
  let userMatchIdx = pb.rounds[pb.roundIdx]?.findIndex(m =>
    m.homeId === myId || m.awayId === myId);
  if (userMatchIdx === -1) {
    // Look in earlier rounds (already advanced)
    for (let ri = pb.roundIdx - 1; ri >= 0; ri--) {
      const idx = pb.rounds[ri]?.findIndex(m =>
        m.winnerId === myId);
      if (idx != null && idx !== -1) {
        userMatchIdx = Math.floor(idx / 2);
        break;
      }
    }
  }
  if (userMatchIdx == null || userMatchIdx === -1) return "";

  const steps = [];
  let curIdx = userMatchIdx;
  for (let ri = pb.roundIdx; ri < pb.rounds.length; ri++) {
    const m = pb.rounds[ri]?.[curIdx];
    if (!m) break;
    if (m.homeId === myId || m.awayId === myId) {
      const oppId = m.homeId === myId ? m.awayId : m.homeId;
      const opp = oppId ? getTeam(oppId) : null;
      steps.push({ ri, kind: "now", opp, m });
    } else {
      // Future round — figure out which feeder pair from previous round
      const prevRoundIdx = ri - 1;
      const feederA = pb.rounds[prevRoundIdx]?.[curIdx * 2];
      const feederB = pb.rounds[prevRoundIdx]?.[curIdx * 2 + 1];
      // The user's feeder is whichever side they're in; the OTHER feeder
      // gives us their projected opponent.
      const userInA = feederA && (feederA.homeId === myId || feederA.awayId === myId);
      const projFeeder = userInA ? feederB : feederA;
      let possible = [];
      if (projFeeder) {
        if (projFeeder.winnerId != null) {
          possible = [getTeam(projFeeder.winnerId)];
        } else if (projFeeder.homeId && projFeeder.awayId) {
          possible = [getTeam(projFeeder.homeId), getTeam(projFeeder.awayId)];
        }
      }
      steps.push({ ri, kind: "future", possible });
    }
    curIdx = Math.floor(curIdx / 2);
  }

  if (!steps.length) return "";
  const stepsHtml = steps.map(s => {
    const head = `<div class="bspnlive-road-round">${roundNames[s.ri] || `ROUND ${s.ri+1}`}</div>`;
    if (s.kind === "now") {
      if (!s.opp) return `${head}<div class="bspnlive-road-team tbd">TBD</div>`;
      return `${head}<div class="bspnlive-road-team next" style="--team-color:${s.opp.primary}">
        <span class="bspnlive-road-tag">NEXT</span>
        <span class="abbr" style="color:${s.opp.primary}">${s.opp.abbr || s.opp.name.slice(0,3).toUpperCase()}</span>
        <span class="name">${s.opp.name}</span>
      </div>`;
    }
    // future
    if (!s.possible.length) {
      return `${head}<div class="bspnlive-road-team tbd">TBD</div>`;
    }
    if (s.possible.length === 1 && s.possible[0]) {
      const opp = s.possible[0];
      return `${head}<div class="bspnlive-road-team" style="--team-color:${opp.primary}">
        <span class="abbr" style="color:${opp.primary}">${opp.abbr || opp.name.slice(0,3).toUpperCase()}</span>
        <span class="name">${opp.name}</span>
      </div>`;
    }
    // Two possible opponents
    return `${head}<div class="bspnlive-road-team possible">
      ${s.possible.filter(Boolean).map(t =>
        `<span style="color:${t.primary};font-weight:700">${t.abbr || t.name.slice(0,3).toUpperCase()}</span>`
      ).join(`<span style="color:var(--blgray);margin:0 .25rem"> / </span>`)}
    </div>`;
  }).join(`<div class="bspnlive-road-arrow">→</div>`);
  return `
    <div class="bspnlive-road">
      <div class="bspnlive-road-head">🛣 ROAD TO THE CHAMPIONSHIP</div>
      <div class="bspnlive-road-steps">${stepsHtml}</div>
    </div>`;
}

// Pregame matchup preview — surfaces head-to-head record this season,
// top performers per side (regular-season FPTS), team off/def ratings,
// and a one-line scout angle. Renders ABOVE the featured matchup card.
function _renderPregamePreview(m, seeds) {
  if (!m.homeId || !m.awayId || m.winnerId != null) return "";
  const home = getTeam(m.homeId), away = getTeam(m.awayId);
  if (!home || !away) return "";

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const abbr = t => t.abbr || t.name.slice(0, 3).toUpperCase();

  // Season games played by a team (regular season only)
  const teamGames = teamId => (franchise.schedule || []).filter(g =>
    g.played && (g.homeId === teamId || g.awayId === teamId)
  ).sort((a, b) => a.week - b.week);

  // Scoring avg: returns { pf, pa, gp } for a team
  const scoringAvg = teamId => {
    const gs = teamGames(teamId);
    if (!gs.length) return { pf: 0, pa: 0, gp: 0 };
    let pf = 0, pa = 0;
    for (const g of gs) {
      if (g.homeId === teamId) { pf += g.homeScore; pa += g.awayScore; }
      else                      { pf += g.awayScore; pa += g.homeScore; }
    }
    return { pf: pf / gs.length, pa: pa / gs.length, gp: gs.length };
  };

  // Last N results (most recent last in the sorted list → reverse)
  const recentForm = (teamId, n = 4) => {
    const gs = teamGames(teamId).slice(-n);
    return gs.map(g => {
      const myScore  = g.homeId === teamId ? g.homeScore : g.awayScore;
      const oppScore = g.homeId === teamId ? g.awayScore : g.homeScore;
      const isHome   = g.homeId === teamId;
      const opp      = getTeam(isHome ? g.awayId : g.homeId);
      const result   = myScore > oppScore ? "W" : myScore < oppScore ? "L" : "T";
      return { result, myScore, oppScore, oppAbbr: abbr(opp || { name: "???" }), week: g.week };
    });
  };

  // Season stat leaders for a team, with real line stats
  const teamFilmStats = teamId => {
    const players = Object.values(franchise.seasonStats?.[teamId] || {});
    const best = (key, cmp) => players.filter(p => (p[key] || 0) > 0)
      .sort((a, b) => (b[key] || 0) - (a[key] || 0))[0];
    const qb  = best("pass_yds");
    const rb  = best("rush_yds");
    const wr  = best("rec_yds");
    const sk  = best("sk");
    const itp = best("int_made");
    const lines = [];
    if (qb) lines.push({ cat: "QB", name: qb.name,
      stat: `${qb.pass_yds||0} yds · ${qb.pass_td||0} TD · ${qb.pass_int||0} INT`,
      pos: qb.pos });
    if (rb) lines.push({ cat: "RUSH", name: rb.name,
      stat: `${rb.rush_yds||0} yds · ${rb.rush_td||0} TD · ${(rb.rush_att||0)} att`,
      pos: rb.pos });
    if (wr) lines.push({ cat: "REC", name: wr.name,
      stat: `${wr.rec_yds||0} yds · ${wr.rec||0} rec · ${wr.rec_td||0} TD`,
      pos: wr.pos });
    if (sk) lines.push({ cat: "PASS RUSH", name: sk.name,
      stat: `${(+sk.sk).toFixed(1)} sacks · ${sk.tkl||0} tkl`,
      pos: sk.pos });
    if (itp && (!sk || itp.name !== sk.name)) lines.push({ cat: "DB", name: itp.name,
      stat: `${itp.int_made||0} INT · ${itp.pd||0} PD`,
      pos: itp.pos });
    return lines;
  };

  // ── H2H ─────────────────────────────────────────────────────────────────────
  const meetings = (franchise.schedule || []).filter(g =>
    g.played && (
      (g.homeId === m.homeId && g.awayId === m.awayId) ||
      (g.homeId === m.awayId && g.awayId === m.homeId)
    ));
  const h2hHtml = meetings.length
    ? meetings.map(g => {
        const winner = g.homeScore > g.awayScore ? g.homeId : g.awayScore > g.homeScore ? g.awayId : null;
        const winT = winner ? getTeam(winner) : null;
        return `<span>W${g.week}: <b style="color:${winT?.primary||'inherit'}">${winT ? abbr(winT) : "?"}</b> ${g.homeScore}–${g.awayScore}</span>`;
      }).join(" &nbsp;·&nbsp; ")
    : `<span style="color:var(--blgray);font-style:italic">No meeting this season</span>`;

  // ── Recent form bars ─────────────────────────────────────────────────────────
  const formPill = r => {
    const bg  = r.result === "W" ? "var(--green)" : r.result === "L" ? "var(--red)" : "#888";
    const tip = `W${r.week} ${r.result} ${r.myScore}–${r.oppScore} vs ${r.oppAbbr}`;
    return `<span title="${tip}" style="display:inline-block;width:1.4rem;height:1.4rem;line-height:1.4rem;text-align:center;border-radius:3px;background:${bg};color:#fff;font-size:.6rem;font-weight:900;margin:0 1px">${r.result}</span>`;
  };
  const renderForm = (team, n = 4) => {
    const form = recentForm(team.id, n);
    const avg  = scoringAvg(team.id);
    const streak = (() => {
      if (!form.length) return "";
      const last = form[form.length - 1].result;
      let cnt = 0;
      for (let i = form.length - 1; i >= 0 && form[i].result === last; i--) cnt++;
      return cnt > 1 ? `${cnt}${last} streak` : "";
    })();
    return `
      <div style="margin-bottom:.5rem">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
          <span style="color:${team.primary};font-weight:900;font-size:.75rem;letter-spacing:.5px">${abbr(team)}</span>
          <span style="color:var(--blgray);font-size:.6rem">${avg.gp ? `${avg.pf.toFixed(1)} PPG · ${avg.pa.toFixed(1)} opp PPG` : "No games"}</span>
          ${streak ? `<span style="color:${streak.startsWith("L") ? "var(--red)" : "var(--green-lt)"};font-size:.6rem;margin-left:auto">${streak}</span>` : ""}
        </div>
        <div>${form.length ? form.map(formPill).join("") : `<span style="color:var(--blgray);font-size:.65rem;font-style:italic">—</span>`}</div>
      </div>`;
  };

  // ── Film / stat leaders per team ─────────────────────────────────────────────
  const renderFilm = team => {
    const lines = teamFilmStats(team.id);
    if (!lines.length) return `<div style="color:var(--blgray);font-size:.65rem;font-style:italic;padding:.25rem 0">No season data</div>`;
    return lines.map(l => `
      <div style="display:flex;gap:.4rem;align-items:baseline;padding:.15rem 0;border-bottom:1px solid rgba(255,255,255,.04)">
        <span style="color:var(--blgray);font-size:.58rem;letter-spacing:.5px;min-width:3.8rem;flex-shrink:0">${l.cat}</span>
        <span style="font-size:.68rem;color:var(--blwhite)">${playerLinkByName(l.name)}</span>
        <span style="font-size:.62rem;color:var(--blgray);margin-left:auto;white-space:nowrap">${l.stat}</span>
      </div>`).join("");
  };

  // ── Scout angle (roster ratings + scoring avg mismatch) ───────────────────────
  const homeRtg = (typeof frnTeamRating === "function") ? frnTeamRating(home.id) : { off: 50, def: 50 };
  const awayRtg = (typeof frnTeamRating === "function") ? frnTeamRating(away.id) : { off: 50, def: 50 };
  const homeAvg = scoringAvg(home.id);
  const awayAvg = scoringAvg(away.id);

  // Build stat-based scout angles
  const angles = [];
  // Pass rush vs QB: away pass rush vs home QB pocket
  const awayPassRush = Object.values(franchise.seasonStats?.[away.id] || {}).reduce((s, p) => s + (p.sk || 0), 0);
  const homePassRush = Object.values(franchise.seasonStats?.[home.id] || {}).reduce((s, p) => s + (p.sk || 0), 0);
  const homePassYds  = Object.values(franchise.seasonStats?.[home.id] || {}).reduce((s, p) => s + (p.pass_yds || 0), 0);
  const awayPassYds  = Object.values(franchise.seasonStats?.[away.id] || {}).reduce((s, p) => s + (p.pass_yds || 0), 0);
  if (awayPassRush >= homePassRush * 1.35 && awayPassRush > 5)
    angles.push(`${abbr(away)} pass rush (${awayPassRush.toFixed(1)} sacks) pressures ${abbr(home)} QB`);
  else if (homePassRush >= awayPassRush * 1.35 && homePassRush > 5)
    angles.push(`${abbr(home)} pass rush (${homePassRush.toFixed(1)} sacks) pressures ${abbr(away)} QB`);
  // Scoring differential
  if (homeAvg.gp && awayAvg.gp) {
    if (homeAvg.pf - awayAvg.pa >= 5)
      angles.push(`${abbr(home)} offense (${homeAvg.pf.toFixed(1)} PPG) vs ${abbr(away)} defense (${awayAvg.pa.toFixed(1)} opp PPG) — ${abbr(home)} edge`);
    else if (awayAvg.pf - homeAvg.pa >= 5)
      angles.push(`${abbr(away)} offense (${awayAvg.pf.toFixed(1)} PPG) vs ${abbr(home)} defense (${homeAvg.pa.toFixed(1)} opp PPG) — ${abbr(away)} edge`);
  }
  // Roster ratings fallback
  const offDiff = (awayRtg.off || 0) - (homeRtg.def || 0);
  const defDiff = (homeRtg.off || 0) - (awayRtg.def || 0);
  if (!angles.length) {
    if (Math.abs(offDiff) >= 8 || Math.abs(defDiff) >= 8) {
      const bigger = Math.abs(offDiff) >= Math.abs(defDiff) ? offDiff : defDiff;
      const adv = bigger > 0 ? away : home;
      const opp = bigger > 0 ? home : away;
      angles.push(`Roster edge: ${abbr(adv)} offense vs ${abbr(opp)} defense (${Math.abs(bigger).toFixed(0)} pt gap)`);
    } else {
      angles.push("Evenly matched on paper — execution wins this one");
    }
  }

  return `
    <div class="bspnlive-preview">
      <div class="bspnlive-preview-head">📋 MATCHUP PREVIEW</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.6rem">
        <div>
          <div style="font-size:.58rem;letter-spacing:.8px;color:var(--blgray);margin-bottom:.2rem">RECENT FORM</div>
          ${renderForm(away)}
          ${renderForm(home)}
        </div>
        <div>
          <div style="font-size:.58rem;letter-spacing:.8px;color:var(--blgray);margin-bottom:.2rem">THIS SEASON H2H</div>
          <div style="font-size:.68rem;line-height:1.8;margin-bottom:.5rem">${h2hHtml}</div>
          <div style="font-size:.58rem;letter-spacing:.8px;color:var(--blgray);margin-bottom:.2rem">ROSTER RATINGS</div>
          <div style="font-size:.67rem;color:var(--blwhite)">
            <span style="color:${away.primary};font-weight:700">${abbr(away)}</span>
            OFF ${awayRtg.off ?? "—"} / DEF ${awayRtg.def ?? "—"} &nbsp;·&nbsp;
            <span style="color:${home.primary};font-weight:700">${abbr(home)}</span>
            OFF ${homeRtg.off ?? "—"} / DEF ${homeRtg.def ?? "—"}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.6rem">
        <div>
          <div style="font-size:.58rem;letter-spacing:.8px;color:${away.primary};margin-bottom:.2rem">${abbr(away)} SEASON FILM</div>
          ${renderFilm(away)}
        </div>
        <div>
          <div style="font-size:.58rem;letter-spacing:.8px;color:${home.primary};margin-bottom:.2rem">${abbr(home)} SEASON FILM</div>
          ${renderFilm(home)}
        </div>
      </div>

      <div style="background:rgba(255,255,255,.04);border-left:3px solid var(--gold);padding:.35rem .6rem;border-radius:0 4px 4px 0">
        <div style="font-size:.58rem;letter-spacing:.8px;color:var(--gold);margin-bottom:.2rem">KEY ANGLES</div>
        ${angles.map(a => `<div style="font-size:.68rem;color:var(--blwhite);margin-bottom:.15rem">▸ ${a}</div>`).join("")}
      </div>
    </div>`;
}

// Narrative one-liner per playoff matchup. Reads season schedule for
// rematches, weighs seed gap, surfaces "first appearance" hints.
function _playoffMatchupTag(m, seeds) {
  if (!m.homeId || !m.awayId) return "";
  const hSeed = seeds.find(s => s.teamId === m.homeId)?.seed || 99;
  const aSeed = seeds.find(s => s.teamId === m.awayId)?.seed || 99;
  const gap = Math.abs(hSeed - aSeed);
  // Rematch detection — was this exact matchup played in regular season?
  const meetings = (franchise.schedule || []).filter(g =>
    g.played && (
      (g.homeId === m.homeId && g.awayId === m.awayId) ||
      (g.homeId === m.awayId && g.awayId === m.homeId)
    ));
  if (meetings.length) {
    const lastMeeting = meetings[meetings.length - 1];
    const myHomeWon = lastMeeting.homeScore > lastMeeting.awayScore;
    const winName = (myHomeWon ? getTeam(lastMeeting.homeId) : getTeam(lastMeeting.awayId))?.name;
    return `🔁 Rematch — ${winName} won W${lastMeeting.week} ${lastMeeting.homeScore}-${lastMeeting.awayScore}`;
  }
  // Big-gap matchups
  if (gap >= 5) {
    const lower = aSeed < hSeed ? m.awayId : m.homeId;
    return `🐍 #${Math.min(hSeed, aSeed)} vs #${Math.max(hSeed, aSeed)} — ${getTeam(lower)?.name} heavy favorite`;
  }
  if (gap >= 3) {
    return `📊 #${Math.min(hSeed, aSeed)} vs #${Math.max(hSeed, aSeed)} — favorite has the edge`;
  }
  return `⚔ #${Math.min(hSeed, aSeed)} vs #${Math.max(hSeed, aSeed)} — toss-up`;
}

// Did the user's team get eliminated, and if so in which round?
function _userPlayoffStatus() {
  const myId = franchise.chosenTeamId;
  const pb = franchise.playoffBracket;
  if (!pb) return { inBracket: false };
  const inBracket = pb.seeds.some(s => s.teamId === myId);
  if (!inBracket) return { inBracket: false };
  const champion = pb.champion === myId;
  let eliminatedRound = null, eliminationMatch = null;
  for (let ri = 0; ri < pb.rounds.length; ri++) {
    for (const m of pb.rounds[ri]) {
      if (m.winnerId == null) continue;
      const lostHere = (m.homeId === myId || m.awayId === myId) && m.winnerId !== myId;
      if (lostHere) { eliminatedRound = ri; eliminationMatch = m; break; }
    }
    if (eliminatedRound != null) break;
  }
  return { inBracket: true, champion, eliminatedRound, eliminationMatch };
}

function renderFrnPlayoffs() {
  const { playoffBracket, chosenTeamId } = franchise;
  if (!playoffBracket) { startFrnPlayoffs(); return; }
  const { seeds, rounds, roundIdx, champion } = playoffBracket;
  const roundNames = ["WILD CARD", "DIVISIONAL", "CHAMPIONSHIP"];
  const seedOf = id => seeds.find(s => s.teamId === id);
  const userStatus = _userPlayoffStatus();

  const matchupCard = (m, ri, mi, opts = {}) => {
    const featured = opts.featured;
    if (!m.homeId || !m.awayId) {
      return `<div class="bspnlive-bracket-card tbd${featured?" featured":""}">
        <div style="color:var(--blgray);text-align:center;padding:.7rem;font-size:.72rem;letter-spacing:1px">TBD</div>
      </div>`;
    }
    const home = getTeam(m.homeId), away = getTeam(m.awayId);
    const homeSeed = seedOf(m.homeId), awaySeed = seedOf(m.awayId);
    const isUser  = m.homeId === chosenTeamId || m.awayId === chosenTeamId;
    const played  = m.winnerId != null;
    const hw      = played && m.winnerId === m.homeId;
    const aw      = played && m.winnerId === m.awayId;
    const isCurrentRound = ri === roundIdx;
    const showBtn = !played && isCurrentRound;
    const tag = !played ? _playoffMatchupTag(m, seeds) : "";
    const teamRow = (team, seed, isWinner, isLoser, score) => `
      <div class="bspnlive-bracket-team ${isWinner?"win":""} ${isLoser?"loss":""}" style="--team-color:${team.primary}">
        <span class="seed">${seed?.seed||"?"}</span>
        <span class="abbr" style="color:${team.primary}">${team.abbr || team.name.slice(0,3).toUpperCase()}</span>
        <span class="name">${team.city} ${team.name}</span>
        ${played
          ? `<span class="score ${isWinner?"win":"loss"}">${score}</span>`
          : `<span class="score" style="color:var(--blgray)">—</span>`}
      </div>`;
    const actions = showBtn ? `
      <div class="bspnlive-bracket-actions">
        ${isUser ? `<button class="bspnlive-bracket-btn play" onclick="frnPlayGame(${m.homeId},${m.awayId},true)">▶ PLAY GAME</button>` : ""}
        <button class="bspnlive-bracket-btn sim" onclick="frnSimPlayoffGame(${m.homeId},${m.awayId})">⏩ SIM</button>
      </div>` : (played ? `
      <div class="bspnlive-bracket-actions">
        <button class="bspnlive-bracket-btn box" onclick="frnOpenPlayoffBox(${ri}, ${mi})">📋 BOX SCORE</button>
      </div>` : `<div style="font-size:.6rem;color:var(--blgray);letter-spacing:.5px;padding:.15rem .25rem">Awaiting earlier round…</div>`);
    return `<div class="bspnlive-bracket-card ${isUser?"user":""} ${played?"played":""} ${featured?"featured":""}">
      ${featured ? `<div class="bspnlive-bracket-featured-tag">⭐ YOUR MATCHUP</div>` : ""}
      ${tag ? `<div class="bspnlive-bracket-tag">${tag}</div>` : ""}
      ${teamRow(home, homeSeed, hw, played && !hw, m.homeScore ?? "")}
      ${teamRow(away, awaySeed, aw, played && !aw, m.awayScore ?? "")}
      ${actions}
    </div>`;
  };

  // ── Champion banner (if decided) ────────────────────────────────────────
  const championBanner = champion ? (() => {
    const t = getTeam(champion);
    return `<section class="bspnlive-champ-banner" style="--team-color:${t.primary}">
      <div class="bspnlive-champ-crown">👑</div>
      <div class="bspnlive-champ-text">
        <div class="bspnlive-champ-label">SEASON ${franchise.season} CHAMPION</div>
        <div class="bspnlive-champ-team">${t.city} ${t.name}</div>
      </div>
      <div class="bspnlive-champ-cta">
        <button class="bspn-back" onclick="showFrnAwards()" style="border-color:var(--blgold);color:var(--blgold)">🌟 AWARDS CEREMONY</button>
      </div>
    </section>`;
  })() : "";

  // ── Past rounds collapsed strip ─────────────────────────────────────────
  const pastRoundsStrip = (() => {
    if (roundIdx === 0 && !champion) return "";
    const finishedRounds = champion ? rounds : rounds.slice(0, roundIdx);
    if (!finishedRounds.length) return "";
    return `<div class="bspnlive-bracket-past">
      <div class="bspnlive-bracket-past-label">PRIOR ROUNDS</div>
      <div class="bspnlive-bracket-past-grid">
        ${finishedRounds.map((rd, ri) => `
          <div class="bspnlive-bracket-past-col">
            <div class="bspnlive-bracket-past-col-head">${roundNames[ri] || `Round ${ri+1}`}</div>
            ${rd.map((m, mi) => {
              if (!m.homeId || !m.awayId || m.winnerId == null) return "";
              const winT = getTeam(m.winnerId);
              const losT = getTeam(m.homeId === m.winnerId ? m.awayId : m.homeId);
              const wScore = m.winnerId === m.homeId ? m.homeScore : m.awayScore;
              const lScore = m.winnerId === m.homeId ? m.awayScore : m.homeScore;
              return `<button class="bspnlive-bracket-past-row" onclick="frnOpenPlayoffBox(${ri}, ${mi})">
                <span style="color:${winT?.primary};font-weight:700">${winT?.abbr || winT?.name?.slice(0,3).toUpperCase()}</span>
                <span style="color:var(--blwhite)">${wScore}</span>
                <span style="color:var(--blgray)">—</span>
                <span style="color:var(--blgray);text-decoration:line-through">${lScore}</span>
                <span style="color:var(--blgray)">${losT?.abbr || losT?.name?.slice(0,3).toUpperCase()}</span>
              </button>`;
            }).join("")}
          </div>
        `).join("")}
      </div>
    </div>`;
  })();

  // ── Current round body ──────────────────────────────────────────────────
  const currentRound = !champion && roundIdx < rounds.length ? rounds[roundIdx] : null;
  let currentRoundHtml = "";
  if (currentRound) {
    const userMatchup = currentRound.find(m =>
      m.homeId === chosenTeamId || m.awayId === chosenTeamId);
    const otherMatchups = currentRound.filter(m => m !== userMatchup);
    const userIdx = userMatchup ? currentRound.indexOf(userMatchup) : -1;
    const totalInRound = currentRound.length;
    const playedCount = currentRound.filter(m => m.winnerId != null).length;
    currentRoundHtml = `
      <div class="bspnlive-bracket-current">
        <div class="bspnlive-bracket-current-head">
          <div class="bspnlive-bracket-current-title">${roundNames[roundIdx] || `ROUND ${roundIdx+1}`}</div>
          <div class="bspnlive-bracket-current-progress">${playedCount}/${totalInRound} GAMES PLAYED</div>
        </div>
        ${userMatchup ? `
          <div class="bspnlive-bracket-current-section">
            ${userMatchup.winnerId == null ? _renderPregamePreview(userMatchup, seeds) : ""}
            ${matchupCard(userMatchup, roundIdx, userIdx, { featured: true })}
          </div>` : userStatus.eliminatedRound != null ? `
          <div class="bspnlive-bracket-eliminated">
            🚫 ELIMINATED — Your run ended in ${roundNames[userStatus.eliminatedRound] || "an earlier round"}.
            ${(() => {
              const elim = userStatus.eliminationMatch;
              if (!elim) return "";
              const us = elim.homeId === chosenTeamId ? elim.homeScore : elim.awayScore;
              const them = elim.homeId === chosenTeamId ? elim.awayScore : elim.homeScore;
              const oppId = elim.homeId === chosenTeamId ? elim.awayId : elim.homeId;
              return ` Lost ${us}-${them} to ${getTeam(oppId)?.name}.`;
            })()}
          </div>` : ""}
        <div class="bspnlive-bracket-current-section">
          <div class="bspnlive-bracket-others-label">OTHER ${roundNames[roundIdx] || ""} MATCHUPS</div>
          <div class="bspnlive-bracket-others-grid">
            ${otherMatchups.map(m => matchupCard(m, roundIdx, currentRound.indexOf(m))).join("")}
          </div>
        </div>
      </div>`;
  }

  // ── Header actions ──────────────────────────────────────────────────────
  const roundPending = !!playoffBracket.roundPending;
  const pending = currentRound ? currentRound.filter(m => !m.winnerId && m.homeId && m.awayId) : [];
  const allRoundDone = currentRound && currentRound.every(m => m.winnerId != null);
  const userPending = currentRound?.find(m =>
    (m.homeId === chosenTeamId || m.awayId === chosenTeamId) && m.winnerId == null);
  const advanceLabel = roundIdx >= rounds.length - 1
    ? "🌟 Crown Champion"
    : `➡ Advance to ${roundNames[roundIdx + 1] || "Next Round"}`;
  const headerActions = champion
    ? `<button class="bspn-back" onclick="showFrnAwards()" style="border-color:var(--blgold);color:var(--blgold)">🌟 Awards</button>`
    : allRoundDone
      ? `<button class="frn-cap-btn" onclick="frnAdvancePlayoffRound()" style="padding:.3rem 1rem;font-size:.75rem;letter-spacing:.8px">${advanceLabel}</button>`
      : `<button class="bspn-back" onclick="frnSimPlayoffRound()" ${!pending.length ? "disabled style=\"opacity:.4;cursor:not-allowed\"" : ""}>⏩ Sim ${pending.length} remaining</button>
         ${userPending ? `<span class="bspnlive-bracket-blocker">Play YOUR matchup first ⬇</span>` : ""}`;

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1.2rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">PLAYOFF BRACKET · SEASON ${franchise.season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("PLAYOFFS")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
        ${headerActions}
        <span style="color:var(--blgray);font-size:.7rem;letter-spacing:.5px;margin-left:.4rem">
          ${champion ? "Postseason complete — review awards" : `Round ${roundIdx+1} of ${rounds.length}`}
        </span>
      </div>
      ${championBanner}
      <div style="padding:1rem 1.4rem">
        ${(userStatus.champion || userStatus.eliminatedRound != null) ? _renderYourRunRecap() : ""}
        ${(userStatus.inBracket && userStatus.eliminatedRound == null && !userStatus.champion) ? _renderRoadToChampionship() : ""}
        ${pastRoundsStrip}
        ${currentRoundHtml}
      </div>
    </div>`;
}

function frnSimPlayoffGame(homeId, awayId) {
  const r = frnSimOnce(homeId, awayId, /* isPlayoff */ true);
  // Persist stats + scoring on the matchup so the user can click into
  // the box score for any played playoff game (not just the final).
  const pb = franchise.playoffBracket;
  const isChamp = pb.roundIdx === pb.rounds.length - 1;
  if (isChamp) {
    franchise.superBowlGame = {
      homeId, awayId,
      homeScore: r.homeScore, awayScore: r.awayScore,
      stats: r.full.stats,
      winnerId: r.homeScore >= r.awayScore ? homeId : awayId,
    };
  }
  // Stash stats + scoring on the round's matchup before we mutate it.
  _savePlayoffMatchupStats(pb.roundIdx, homeId, awayId, r);
  applyPlayoffResult(homeId, awayId, r.homeScore, r.awayScore);
  saveFranchise();
  renderFrnPlayoffs();
}

function frnSimPlayoffRound() {
  const { playoffBracket } = franchise;
  const rd = playoffBracket.rounds[playoffBracket.roundIdx];
  const isChampRound = playoffBracket.roundIdx === playoffBracket.rounds.length - 1;
  for (const m of rd) {
    if (!m.winnerId && m.homeId && m.awayId) {
      const r = frnSimOnce(m.homeId, m.awayId, /* isPlayoff */ true);
      m.homeScore = r.homeScore; m.awayScore = r.awayScore;
      m.winnerId  = r.homeScore >= r.awayScore ? m.homeId : m.awayId;
      m.stats   = _stripGameStatsForStorage(r.full?.stats);
      m.scoring = _extractScoringTimeline(r.full?.plays, r.homeScore, r.awayScore);
      m.weather = r.full?.weather
        ? { label: r.full.weather.label, windStrength: r.full.weather.windStrength }
        : null;
      if (isChampRound) {
        franchise.superBowlGame = {
          homeId: m.homeId, awayId: m.awayId,
          homeScore: r.homeScore, awayScore: r.awayScore,
          stats: r.full.stats,
          winnerId: m.winnerId,
        };
      }
    }
  }
  // Mark round pending for review — user clicks "Advance" to proceed
  if (rd.every(m => m.winnerId)) playoffBracket.roundPending = true;
  saveFranchise();
  renderFrnPlayoffs();
}

// User-clicked "Advance to [Next Round]" after reviewing playoff results.
function frnAdvancePlayoffRound() {
  const pb = franchise.playoffBracket;
  if (!pb) return;
  // Compute POTW for the completed round (treated as playoff week 15/16/17)
  const playoffWeek = FRANCHISE_WEEKS + pb.roundIdx + 1;
  _computePlayoffRoundPOTW(pb.roundIdx, playoffWeek);
  pb.roundPending = false;
  advancePlayoffRound();
  saveFranchise();
  if (pb.champion) showFrnAwards();
  else renderFrnPlayoffs();
}

// Compute POTW for a completed playoff round from bracket matchup stats.
function _computePlayoffRoundPOTW(roundIdx, weekNum) {
  if (!franchise.potw) franchise.potw = {};
  if (!franchise.potwCandidates) franchise.potwCandidates = {};
  const seasonKey = franchise.season;
  if (!franchise.potw[seasonKey]) franchise.potw[seasonKey] = {};
  if (!franchise.potwCandidates[seasonKey]) franchise.potwCandidates[seasonKey] = {};

  const rd = franchise.playoffBracket?.rounds?.[roundIdx] || [];
  const pMap = {};
  for (const m of rd) {
    if (!m.stats) continue;
    for (const [side, teamId] of [["home", m.homeId], ["away", m.awayId]]) {
      const players = m.stats[side]?.players || {};
      for (const [name, p] of Object.entries(players)) {
        if (!pMap[name]) pMap[name] = { ...p, teamId };
        else for (const [k, v] of Object.entries(p)) {
          if (typeof v === "number") pMap[name][k] = (pMap[name][k] || 0) + v;
        }
      }
    }
  }
  const allP = Object.values(pMap);
  const OL_POS    = new Set(["OL","LT","LG","C","RG","RT"]);
  const SKILL_POS = new Set(["QB","RB","WR","TE"]);
  const DEF_POS   = new Set(["DL","LB","CB","S","DE","DT","FS","SS"]);
  const ST_POS    = new Set(["K","P"]);
  const pickTop = (filter, scoreF, n = 3) => {
    const pool = allP.filter(filter).map(p => ({ ...p, _s: scoreF(p) })).filter(p => p._s > 0);
    pool.sort((a, b) => b._s - a._s);
    return pool.slice(0, n).map(p => {
      const t = getTeam(p.teamId);
      return { name: p.name, pos: p.pos, teamId: p.teamId,
        teamAbbr: t ? _bspnLiveAbbr(t) : "—", teamPrimary: t?.primary || "#888",
        statLine: mvpStatLine(p), score: p._s };
    });
  };
  const candidates = {
    offense:      pickTop(p => SKILL_POS.has(p.pos), mvpScore),
    defense:      pickTop(p => DEF_POS.has(p.pos),   mvpScore),
    ol:           pickTop(p => OL_POS.has(p.pos),    p => (p.pancakes||0)*3 - (p.sacks_allowed||0)*4),
    specialTeams: pickTop(p => ST_POS.has(p.pos),    mvpScore),
  };
  franchise.potwCandidates[seasonKey][weekNum] = candidates;
  franchise.potw[seasonKey][weekNum] = {
    offense:      candidates.offense[0]      || null,
    defense:      candidates.defense[0]      || null,
    ol:           candidates.ol[0]           || null,
    specialTeams: candidates.specialTeams[0] || null,
  };
}

// Find the matchup in the round that matches the team pair and stash
// box-score-ready stats + scoring + weather onto it.
function _savePlayoffMatchupStats(roundIdx, homeId, awayId, r) {
  const rd = franchise.playoffBracket?.rounds?.[roundIdx];
  if (!rd) return;
  const m = rd.find(x =>
    (x.homeId === homeId && x.awayId === awayId) ||
    (x.homeId === awayId && x.awayId === homeId));
  if (!m) return;
  m.stats   = _stripGameStatsForStorage(r.full?.stats);
  m.scoring = _extractScoringTimeline(r.full?.plays, r.homeScore, r.awayScore);
  m.weather = r.full?.weather
    ? { label: r.full.weather.label, windStrength: r.full.weather.windStrength }
    : null;
}

// Click a played playoff matchup → BSPN box score. Synthesizes a
// franchise.schedule-style record from the bracket matchup, then
// hands off to the existing renderFrnPastGame() flow.
function frnOpenPlayoffBox(roundIdx, matchupIdx) {
  const m = franchise.playoffBracket?.rounds?.[roundIdx]?.[matchupIdx];
  if (!m || !m.winnerId) return;
  // Temporarily inject a synthetic schedule entry so renderFrnPastGame
  // can find the matchup. Remove it on close — we'll just not bother,
  // since the user backing out goes to showFranchiseDashboard().
  const week = FRANCHISE_WEEKS + roundIdx + 1;
  const synthetic = {
    week, homeId: m.homeId, awayId: m.awayId, played: true,
    homeScore: m.homeScore, awayScore: m.awayScore,
    stats: m.stats || null, scoring: m.scoring || [],
    weather: m.weather || null, isPlayoff: true,
  };
  franchise.schedule = franchise.schedule || [];
  // Avoid duplicates: replace any existing same-key entry.
  franchise.schedule = franchise.schedule.filter(g =>
    !(g.week === week && g.homeId === m.homeId && g.awayId === m.awayId));
  franchise.schedule.push(synthetic);
  saveFranchise();
  renderFrnPastGame(week, m.homeId, m.awayId);
}

function applyPlayoffResult(homeId, awayId, homeScore, awayScore) {
  const { playoffBracket } = franchise;
  const rd = playoffBracket.rounds[playoffBracket.roundIdx];
  const m  = rd.find(x => x.homeId === homeId && x.awayId === awayId);
  if (!m) return;
  m.homeScore = homeScore; m.awayScore = awayScore;
  m.winnerId  = homeScore >= awayScore ? homeId : awayId;
  // Don't auto-advance — let user review results then click Advance
  if (rd.every(x => x.winnerId !== null)) playoffBracket.roundPending = true;
}

function advancePlayoffRound() {
  const pb = franchise.playoffBracket;
  const rd = pb.rounds[pb.roundIdx];
  if (!rd.every(m => m.winnerId)) return;
  const winners   = rd.map(m => m.winnerId);
  const nextRdIdx = pb.roundIdx + 1;
  if (nextRdIdx >= pb.rounds.length) {
    pb.champion   = winners[0];
    franchise.phase = "awards";
  } else {
    const nextRd = pb.rounds[nextRdIdx];
    for (let i = 0; i < nextRd.length; i++) {
      nextRd[i].homeId = winners[i * 2];
      nextRd[i].awayId = winners[i * 2 + 1];
    }
    pb.roundIdx = nextRdIdx;
  }
}

// ── Awards ceremony ───────────────────────────────────────────────────────────
function showFrnAwards() {
  franchise.phase = "awards";
  // Record season in history (guard against double-entry on re-open).
  // Computes League MVP (best season stats × team-success multiplier), Super
  // Bowl MVP (top scorer from championship-winning side), and your team's MVP.
  const champId = franchise.playoffBracket?.champion;
  // Find an existing entry for this season — saves from before the
  // expanded awards engine carry the OLD shape (missing opoy/dpoy/roy
  // etc.). Detect that and re-compute on top of the existing entry so
  // every award card populates without double-processing retirements.
  const existingIdx = franchise.history.findIndex(h => h.season === franchise.season);
  const existing = existingIdx >= 0 ? franchise.history[existingIdx] : null;
  const isStale = existing && (existing.opoy === undefined || existing.allPros === undefined);
  if (champId && (!existing || isStale)) {
    // Tick coach records + tenure first (only on first entry — never on stale-refresh)
    if (!existing) {
      for (const t of TEAMS) {
        const hc = franchise.coaches?.[t.id]?.hc;
        if (!hc) continue;
        const s = franchise.standings?.[t.id] || { w:0, l:0 };
        hc.record = hc.record || { w:0, l:0, championships: 0 };
        hc.record.w += s.w || 0;
        hc.record.l += s.l || 0;
        hc.yearsWithTeam = (hc.yearsWithTeam || 0) + 1;
        hc.age = (hc.age || 50) + 1;
        if (t.id === champId) hc.record.championships = (hc.record.championships || 0) + 1;
      }
    }
    const champTeam = getTeam(champId);
    // Process retirements FIRST so all subsequent computations use the
    // post-retirement state. Skip on stale-refresh — retirees already
    // captured in original entry (and may already be off the roster).
    const { retirees, hofClass } = existing
      ? { retirees: existing.retirees || [], hofClass: existing.hofClass || [] }
      : _processSeasonEndRetirements();

    const leagueMVP    = computeLeagueMVP();
    const sbMVP        = computeSuperBowlMVP();
    const userMVP      = computeTeamMVP(franchise.chosenTeamId);
    const champTeamMVP = computeTeamMVP(champId);

    // Record book: roll up single-season records. (Single-game records
    // are already updated incrementally inside frnSimOnce.) Skip on
    // stale-refresh since the season records were already booked.
    if (!existing) _updateSingleSeasonRecords();
    // Snapshot rosters for the alumni tracker — after retirements so
    // retirees aren't included in the "active" snapshot.
    if (!existing) _takeAlumniSnapshot();

    // New awards
    const opoy         = _computeOPOY();
    const dpoy         = _computeDPOY();
    const roy          = _computeROY();
    const coy          = _computeCOY();
    const comeback     = _computeComebackPOY();
    const breakout     = _computeBreakoutPOY();
    const allPros      = _selectAllPros();
    const statLeaders  = _seasonStatLeaders();
    const byNumbers    = _seasonByTheNumbers();
    const poty         = _computePOTY();

    // Standings snapshot — feeds next year's COY improvement calculation.
    const standingsSnapshot = {};
    for (const [tid, s] of Object.entries(franchise.standings || {})) {
      standingsSnapshot[tid] = { w: s.w || 0, l: s.l || 0, t: s.t || 0 };
    }

    // Stamp accolades onto live players' careerHistory so trophy counters update.
    _stampSeasonAccolades({
      leagueMVP, superBowlMVP: sbMVP, opoy, dpoy, roy, comeback, breakout, allPros,
    });

    const sb = franchise.superBowlGame;
    const entry = {
      season: franchise.season,
      champion: champId,
      championName: `${champTeam.city} ${champTeam.name}`,
      championRecord: { ...(franchise.standings[champId] || { w:0, l:0 }) },
      superBowlScore: sb ? {
        homeId: sb.homeId, awayId: sb.awayId,
        homeScore: sb.homeScore, awayScore: sb.awayScore,
        winnerId: sb.winnerId,
      } : (existing?.superBowlScore || null),
      leagueMVP:    _snapshotAwardWinner(leagueMVP)    || existing?.leagueMVP,
      superBowlMVP: _snapshotAwardWinner(sbMVP)        || existing?.superBowlMVP,
      userTeamMVP:  userMVP      ? { name: userMVP.name,      pos: userMVP.pos,      line: mvpStatLine(userMVP) }      : existing?.userTeamMVP,
      champTeamMVP: champTeamMVP ? { name: champTeamMVP.name, pos: champTeamMVP.pos, line: mvpStatLine(champTeamMVP) } : existing?.champTeamMVP,
      opoy:         _snapshotAwardWinner(opoy),
      dpoy:         _snapshotAwardWinner(dpoy),
      roy:          _snapshotAwardWinner(roy),
      coy:          coy,
      comeback:     _snapshotAwardWinner(comeback),
      breakout:     _snapshotAwardWinner(breakout),
      allPros, statLeaders, byNumbers, poty,
      retirees, hofClass,
      standingsSnapshot,
      userRecord: existing?.userRecord || { ...(franchise.standings[franchise.chosenTeamId] || { w:0, l:0 }) },
    };
    if (existing) franchise.history[existingIdx] = entry;
    else          franchise.history.push(entry);
  }
  saveFranchise();
  renderFrnAwards();
}

// ── Analytics page ────────────────────────────────────────────────────────────
function renderFrnAnalytics(defaultTab) {
  const tab = defaultTab || "mysheet";
  const { chosenTeamId, salaryCap, rosters } = franchise;
  const cap = salaryCap || SALARY_CAP_BASE;

  // Helper: colour-code AAV relative to cap
  const aavColor = aav => {
    const pct = aav / cap;
    if (pct >= 0.18) return "var(--red)";
    if (pct >= 0.10) return "#e8a000";
    return "var(--white)";
  };

  // ── My Cap Sheet ────────────────────────────────────────────────────────
  function myCapSheet() {
    const roster = (rosters[chosenTeamId] || [])
      .filter(p => p.contract)
      .sort((a, b) => currentYearCapHit(b) - currentYearCapHit(a));
    const totalUsed = roster.reduce((s, p) => s + currentYearCapHit(p), 0);
    const capLeft   = cap - totalUsed;
    const rows = roster.map(p => {
      const c = p.contract;
      const expiring = c.remaining <= 1;
      const mv = computeMarketValue(p, cap);
      const capHit = currentYearCapHit(p);
      const { perYear: deadPY, years: deadYrs } = deadCapOnRelease(p);
      const deadTotal = deadPY * deadYrs;
      const canRestructure = c.remaining >= 2
        && (c.baseSalaries?.[(c.years||1)-(c.remaining||1)] ?? (c.aav-(c.bonusProration||0))) >= 2.0
        && c.restructuredSeason !== franchise.season;
      // Year-by-year schedule tooltip
      const curYrIdx = Math.max(0, (c.years||1) - (c.remaining||1));
      const scheduleHtml = c.baseSalaries?.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:.15rem .25rem;margin-top:.2rem">${
            c.baseSalaries.map((base, i) => {
              const isCur = i === curYrIdx;
              const hit = Math.round((base + (c.bonusProration || 0)) * 10) / 10;
              return `<span title="Yr${i+1}: $${base.toFixed(1)}M base + $${(c.bonusProration||0).toFixed(1)}M proration" style="font-size:.55rem;padding:.1rem .28rem;border-radius:3px;background:${isCur?"var(--gold)":"var(--bg3)"};color:${isCur?"#000":"var(--gray)"}">Yr${i+1} $${hit.toFixed(1)}M</span>`;
            }).join("")
          }</div>`
        : "";
      const incentiveHtml = (c.incentives||[]).length
        ? `<div style="display:flex;flex-wrap:wrap;gap:.1rem .25rem;margin-top:.15rem">${
            c.incentives.map(inc => `<span title="${inc.label}: $${inc.bonus.toFixed(1)}M ${inc.type}" style="font-size:.52rem;padding:.08rem .25rem;border-radius:3px;background:${inc.type==="LTBE"?"rgba(200,169,0,.25)":"rgba(100,100,100,.25)"};color:${inc.type==="LTBE"?"var(--gold)":"var(--gray)"}">${inc.type} $${inc.bonus.toFixed(1)}M</span>`).join("")
          }</div>`
        : "";
      const escName = p.name.replace(/'/g, "\\'");
      const isPendingRestructure = _restructurePending?.name === p.name && _restructurePending?.pos === p.position;
      // Inline restructure confirmation row — no browser dialog
      if (isPendingRestructure) {
        const { freed, newProration, currentBase, remaining } = _restructurePending;
        return `<tr style="background:rgba(200,169,0,.1)">
          <td style="font-weight:700;color:var(--gold)">${p.name}</td>
          <td style="color:var(--gray)">${p.position}</td>
          <td colspan="6" style="font-size:.68rem;padding:.4rem .5rem">
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.5rem">
              <span>Convert <b style="color:var(--white)">$${currentBase.toFixed(1)}M</b> base → signing bonus</span>
              <span style="color:var(--green-lt)">▼ Frees <b>$${freed.toFixed(1)}M</b> now</span>
              <span style="color:#ff9090">▲ Dead $${newProration.toFixed(1)}M/yr × ${remaining}yr = $${(newProration*remaining).toFixed(1)}M</span>
            </div>
          </td>
          <td colspan="2" style="white-space:nowrap;padding:.4rem .5rem">
            <button class="btn btn-gold" onclick="frnRestructureConfirm()" style="font-size:.62rem;padding:.2rem .55rem;margin-right:.3rem">✓ Restructure</button>
            <button class="btn btn-outline" onclick="frnRestructureCancel()" style="font-size:.62rem;padding:.2rem .55rem">✗ Cancel</button>
          </td>
        </tr>`;
      }
      return `<tr>
        <td style="color:${aavColor(capHit)};font-weight:700">${playerLink(p)}${scheduleHtml}${incentiveHtml}</td>
        <td style="color:var(--gray)">${p.position}</td>
        <td>${gradeBadge(p)}</td>
        <td style="color:var(--gray)">${p.age || "?"}</td>
        <td style="color:var(--gray);font-size:.65rem">${draftStr(p)}</td>
        <td style="color:${aavColor(capHit)};font-weight:700">$${capHit.toFixed(1)}M
          <div style="font-size:.58rem;color:var(--gray)">AAV $${c.aav.toFixed(1)}M</div></td>
        <td>${vsMarketCell(c.aav, mv)}${(() => {
          const tag = _tradeValueTag(p, cap);
          if (tag === "asset")   return `<div style="font-size:.52rem;color:var(--green-lt);margin-top:.1rem">▲ TRADE ASSET</div>`;
          if (tag === "blocker") return `<div style="font-size:.52rem;color:var(--red);margin-top:.1rem">▼ TRADE BLOCKER</div>`;
          return "";
        })()}</td>
        <td style="font-size:.6rem;color:${deadTotal>0?"#ff9090":"var(--gray)"}">
          ${deadTotal > 0 ? `☠ $${deadPY.toFixed(1)}M×${deadYrs}yr` : "—"}
        </td>
        <td style="color:var(--gray);font-size:.65rem">${c.remaining}yr left</td>
        <td style="font-size:.65rem">
          ${canRestructure ? `<button class="btn btn-outline" onclick="frnRestructure(${chosenTeamId},'${escName}','${p.position}')" style="font-size:.58rem;padding:.15rem .4rem;color:var(--gold)" title="Convert base salary to signing bonus — frees cap now, adds dead money">↺ Restructure</button>` : ""}
          ${expiring ? `<span style="color:var(--red)">EXPIRING</span>` : ""}
        </td>
      </tr>`;
    }).join("");
    return `
      <div class="frn-ana-capbar">
        <div class="frn-ana-capbar-fill" style="width:${Math.min(100,totalUsed/cap*100).toFixed(1)}%;background:${totalUsed/cap>=0.95?"var(--red)":totalUsed/cap>=0.85?"#e8a000":"var(--green)"}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.72rem;margin-bottom:.8rem">
        <span>Used: <b style="color:var(--white)">$${totalUsed.toFixed(1)}M</b></span>
        <span>Cap: <b style="color:var(--gold)">$${cap.toFixed(0)}M</b></span>
        <span style="color:${capLeft<0?"var(--red)":"var(--green-lt)"}">Room: <b>$${capLeft.toFixed(1)}M</b></span>
      </div>
      <p style="font-size:.62rem;color:var(--gray);margin-bottom:.5rem">Cap Hit = this year's base salary + annual bonus proration. Dead Cap = prorated bonus remaining if player is cut. ↺ Restructure converts base salary to bonus — frees cap now, increases dead cap later.</p>
      <table class="frn-ana-table"><thead>
        <tr><th>Player</th><th>Pos</th><th>Grade</th><th>Age</th><th>Draft</th><th>Cap Hit</th><th>vs Market</th><th>Dead Cap</th><th>Length</th><th></th></tr>
      </thead><tbody>${rows}</tbody></table>`;
  }

  // ── Cap Health Dashboard ────────────────────────────────────────────────
  function capHealthDashboard() {
    const roster = (rosters[chosenTeamId] || []).filter(p => p.contract);
    const used1  = roster.reduce((s,p) => s + currentYearCapHit(p), 0);
    const used2  = projectTeamCap(chosenTeamId, 1);
    const used3  = projectTeamCap(chosenTeamId, 2);
    const deadTotal = roster.reduce((s,p) => {
      const { perYear, years } = deadCapOnRelease(p);
      return s + perYear * years;
    }, 0);
    const expiring = roster.filter(p => p.contract.remaining <= 1).length;
    const capBar = (used, label) => {
      const pct = Math.min(100, used/cap*100);
      const color = pct>=95?"var(--red)":pct>=85?"#e8a000":"var(--green)";
      return `<div style="margin-bottom:.6rem">
        <div style="display:flex;justify-content:space-between;font-size:.68rem;margin-bottom:.2rem">
          <span style="color:var(--gray)">${label}</span>
          <span style="color:${color};font-weight:700">$${used.toFixed(1)}M / $${cap.toFixed(0)}M (${pct.toFixed(0)}%)</span>
        </div>
        <div style="background:var(--bg3);height:8px;border-radius:4px">
          <div style="width:${pct.toFixed(1)}%;height:100%;border-radius:4px;background:${color}"></div>
        </div>
      </div>`;
    };
    const restructureCandidates = roster.filter(p => {
      const c = p.contract;
      const yi = Math.max(0,(c.years||1)-(c.remaining||1));
      const base = c.baseSalaries?.[yi] ?? (c.aav-(c.bonusProration||0));
      return c.remaining>=2 && base>=2.0 && c.restructuredSeason !== franchise.season;
    });
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.6rem;margin-bottom:1rem">
        <div class="frn-stat-box"><div class="frn-stat-val" style="color:${used1/cap>0.9?"var(--red)":"var(--gold)"}">$${used1.toFixed(1)}M</div><div class="frn-stat-lbl">CAP USED</div></div>
        <div class="frn-stat-box"><div class="frn-stat-val" style="color:var(--green-lt)">$${(cap-used1).toFixed(1)}M</div><div class="frn-stat-lbl">CAP ROOM</div></div>
        <div class="frn-stat-box"><div class="frn-stat-val" style="color:#ff9090">$${deadTotal.toFixed(1)}M</div><div class="frn-stat-lbl">TOTAL DEAD CAP</div></div>
        <div class="frn-stat-box"><div class="frn-stat-val">${expiring}</div><div class="frn-stat-lbl">EXPIRING</div></div>
        <div class="frn-stat-box"><div class="frn-stat-val">${restructureCandidates.length}</div><div class="frn-stat-lbl">RESTRUCTURE-ELIGIBLE</div></div>
      </div>
      <div style="margin-bottom:1rem">
        <div style="font-size:.75rem;font-weight:700;color:var(--gold);margin-bottom:.5rem">3-YEAR CAP PROJECTION</div>
        ${capBar(used1, "This Season (Yr 1)")}
        ${capBar(used2, "Next Season (Yr 2)")}
        ${capBar(used3, "Season After (Yr 3)")}
      </div>
      ${restructureCandidates.length ? `
        <div style="font-size:.75rem;font-weight:700;color:var(--gold);margin-bottom:.4rem">RESTRUCTURE CANDIDATES</div>
        <div style="display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.8rem">
          ${restructureCandidates.map(p => {
            const escN = p.name.replace(/'/g,"\'");
            const capHit = currentYearCapHit(p);
            return `<button class="btn btn-outline" onclick="renderFrnAnalytics('mysheet');setTimeout(()=>frnRestructure(${chosenTeamId},'${escN}','${p.position}'),50)" style="font-size:.62rem;padding:.2rem .5rem;color:var(--gold)">↺ ${p.name} $${capHit.toFixed(1)}M</button>`;
          }).join("")}
        </div>` : ""}
      <div style="font-size:.62rem;color:var(--gray)">Yr 2/3 projections assume current roster with age progression. Expiring contracts show as $0.</div>`;
  }

  // ── Cut Candidates Smart List ────────────────────────────────────────────
  function cutCandidatesList() {
    const roster = (rosters[chosenTeamId] || []).filter(p => p.contract);
    const candidates = roster.map(p => {
      const capHit = currentYearCapHit(p);
      const market = computeMarketValue(p, cap);
      const { perYear: deadPY, years: deadYrs } = deadCapOnRelease(p);
      const deadTotal = deadPY * deadYrs;
      const savings = capHit - deadPY; // Net cap relief after accounting for dead money
      const overpaid = capHit - market;
      const score = overpaid * 2 + (deadTotal < 2 ? 3 : 0) + (p.contract.remaining <= 1 ? 1 : 0);
      return { p, capHit, market, deadTotal, deadPY, deadYrs, savings, overpaid, score };
    }).filter(c => c.score > 1 && c.savings > 0.5)
      .sort((a,b) => b.score - a.score)
      .slice(0, 10);

    if (!candidates.length) return `<p style="color:var(--gray);font-size:.78rem">No obvious cut candidates — your roster looks cap-healthy.</p>`;

    const rows = candidates.map(({ p, capHit, market, deadTotal, deadPY, deadYrs, savings, overpaid }) => {
      const escN = p.name.replace(/'/g,"\\'");
      return `<tr>
        <td style="font-weight:700">${playerLink(p)}</td>
        <td style="color:var(--gray)">${p.position}</td>
        <td>${gradeBadge(p)}</td>
        <td style="color:var(--red);font-weight:700">$${capHit.toFixed(1)}M</td>
        <td style="color:var(--gray);font-size:.65rem">$${market.toFixed(1)}M mkt</td>
        <td style="color:${overpaid>3?"var(--red)":"var(--gray)"};font-size:.65rem">${overpaid>0?"+$"+overpaid.toFixed(1)+"M over":"≈ fair"}</td>
        <td style="color:#ff9090;font-size:.65rem">${deadTotal>0.5?`☠ $${deadPY.toFixed(1)}M×${deadYrs}yr`:"No dead cap"}</td>
        <td style="color:var(--green-lt);font-weight:700">+$${savings.toFixed(1)}M</td>
        <td style="color:var(--gray);font-size:.65rem">${p.contract.remaining}yr left</td>
        <td><button class="btn btn-outline" onclick="frnReleasePlayer('${escN}','${p.position}');showFranchiseDashboard()" style="font-size:.58rem;padding:.15rem .4rem;color:var(--red)">✗ Release</button></td>
      </tr>`;
    }).join("");

    return `
      <p style="font-size:.65rem;color:var(--gray);margin-bottom:.6rem">Players ranked by overpay + low dead cap + short tenure. Net savings = cap relief minus dead cap this year.</p>
      <table class="frn-ana-table"><thead>
        <tr><th>Player</th><th>Pos</th><th>Grade</th><th>Cap Hit</th><th>Market</th><th>vs Mkt</th><th>Dead Cap</th><th>Net Save</th><th>Yrs</th><th></th></tr>
      </thead><tbody>${rows}</tbody></table>`;
  }

  // ── Contract Timeline (Gantt) ────────────────────────────────────────────
  function contractTimeline() {
    const roster = (rosters[chosenTeamId] || [])
      .filter(p => p.contract && p.contract.remaining > 0)
      .sort((a,b) => currentYearCapHit(b) - currentYearCapHit(a));
    const maxYears = 5;
    const yearLabels = Array.from({length:maxYears}, (_,i) => `Yr ${i+1}`);
    const rows = roster.map(p => {
      const c = p.contract;
      const cells = yearLabels.map((_, i) => {
        const hit = projectPlayerCapHit(p, i);
        if (hit === 0) return `<td style="background:var(--bg2);opacity:.3"></td>`;
        const pct = Math.min(1, hit / (cap * 0.15));
        const r = Math.round(180 * pct), g = Math.round(180 * (1-pct));
        return `<td style="background:rgba(${r},${g},0,.3);font-size:.6rem;text-align:center;color:var(--white);font-weight:${i===0?700:400}">$${hit.toFixed(1)}M</td>`;
      }).join("");
      return `<tr>
        <td style="font-weight:700;white-space:nowrap">${playerLink(p)}</td>
        <td style="color:var(--gray);font-size:.65rem">${p.position}</td>
        ${cells}
        <td style="color:var(--gray);font-size:.6rem">${c.remaining}yr</td>
      </tr>`;
    }).join("");
    return `
      <p style="font-size:.65rem;color:var(--gray);margin-bottom:.5rem">Cap hit per player per year. Green = cheap, amber/red = expensive. Dark cell = contract expired.</p>
      <div style="overflow-x:auto"><table class="frn-ana-table">
        <thead><tr><th>Player</th><th>Pos</th>${yearLabels.map(y=>`<th>${y}</th>`).join("")}<th>Rem</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  // ── League Cap Health ───────────────────────────────────────────────────
  function leagueCapHealth() {
    const rows = TEAMS.map(t => {
      const used = capUsedByTeam(t.id);
      const pct  = used / cap * 100;
      const bar  = `<div style="width:${Math.min(100,pct).toFixed(0)}%;height:6px;background:${pct>=95?"var(--red)":pct>=85?"#e8a000":"var(--green)"};"></div>`;
      const isMe = t.id === chosenTeamId;
      return `<tr style="${isMe?"background:rgba(200,169,0,0.07)":""}">
        <td style="color:${isMe?"var(--gold)":"var(--white)"};font-weight:${isMe?700:400}">${isMe?"»":""} ${t.city} ${t.name}</td>
        <td><div style="background:var(--bg3);width:100%;height:6px;">${bar}</div></td>
        <td style="text-align:right;color:${pct>=95?"var(--red)":pct>=85?"#e8a000":"var(--white)"};font-weight:700">$${used.toFixed(0)}M</td>
        <td style="text-align:right;color:var(--gray);font-size:.65rem">${pct.toFixed(0)}%</td>
      </tr>`;
    }).sort((a, b) => {
      // Already sorted by name; let's re-sort by cap used desc
      return 0;
    });
    // Re-sort properly
    const teams = TEAMS.map(t => ({ t, used: capUsedByTeam(t.id) }))
      .sort((a, b) => b.used - a.used);
    const sortedRows = teams.map(({ t, used }) => {
      const pct = used / cap * 100;
      const bar = `<div style="width:${Math.min(100,pct).toFixed(0)}%;height:6px;background:${pct>=95?"var(--red)":pct>=85?"#e8a000":"var(--green)"};"></div>`;
      const isMe = t.id === chosenTeamId;
      return `<tr style="${isMe?"background:rgba(200,169,0,0.07)":""}">
        <td style="color:${isMe?"var(--gold)":"var(--white)"};font-weight:${isMe?700:400}">${isMe?"»":""} ${t.city} ${t.name}</td>
        <td style="width:120px"><div style="background:var(--bg3);width:100%;height:6px;">${bar}</div></td>
        <td style="text-align:right;color:${pct>=95?"var(--red)":pct>=85?"#e8a000":"var(--white)"};font-weight:700">$${used.toFixed(0)}M</td>
        <td style="text-align:right;color:var(--gray);font-size:.65rem">${pct.toFixed(0)}%</td>
      </tr>`;
    }).join("");
    return `<table class="frn-ana-table"><thead>
      <tr><th>Team</th><th>Cap Usage</th><th style="text-align:right">Used</th><th style="text-align:right">%</th></tr>
    </thead><tbody>${sortedRows}</tbody></table>`;
  }

  // ── Top Contracts ───────────────────────────────────────────────────────
  function topContracts() {
    const all = [];
    for (const t of TEAMS) {
      for (const p of (rosters[t.id] || [])) {
        if (p.contract) all.push({ ...p, teamName: `${t.city} ${t.name}`, teamId: t.id });
      }
    }
    all.sort((a, b) => b.contract.aav - a.contract.aav);
    const rows = all.slice(0, 30).map((p, i) => {
      const c = p.contract;
      const isMe = p.teamId === chosenTeamId;
      return `<tr style="${isMe?"background:rgba(200,169,0,0.07)":""}">
        <td style="color:var(--gray);font-size:.65rem">${i+1}.</td>
        <td style="color:${isMe?"var(--gold)":"var(--white)"};font-weight:700">${p.name}</td>
        <td style="color:var(--gray)">${p.position}</td>
        <td>${gradeBadge(p)}</td>
        <td style="color:var(--gray)">${p.age||"?"}</td>
        <td style="color:var(--gray);font-size:.65rem">${draftStr(p)}</td>
        <td style="color:var(--gray);font-size:.68rem">${p.teamName}</td>
        <td style="color:${aavColor(c.aav)};font-weight:700">$${c.aav.toFixed(1)}M</td>
        <td style="color:var(--gold);font-size:.65rem">${careerEarningsStr(p)}</td>
        <td style="color:var(--gray);font-size:.65rem">${c.remaining}yr</td>
      </tr>`;
    }).join("");
    return `<table class="frn-ana-table"><thead>
      <tr><th>#</th><th>Player</th><th>Pos</th><th>Grade</th><th>Age</th><th>Draft</th><th>Team</th><th>AAV</th><th>Career $</th><th>Left</th></tr>
    </thead><tbody>${rows}</tbody></table>`;
  }

  // ── Position Market ─────────────────────────────────────────────────────
  function posMarket(pos) {
    const all = [];
    for (const t of TEAMS) {
      for (const p of (rosters[t.id] || [])) {
        if (p.position === pos && p.contract) {
          all.push({ ...p, teamName: `${t.city} ${t.name}`, teamId: t.id });
        }
      }
    }
    all.sort((a, b) => b.contract.aav - a.contract.aav);
    const rows = all.map((p, i) => {
      const c = p.contract;
      const isMe = p.teamId === chosenTeamId;
      const mv = computeMarketValue(p, cap);
      return `<tr style="${isMe?"background:rgba(200,169,0,0.07)":""}">
        <td style="color:var(--gray);font-size:.65rem">${i+1}.</td>
        <td style="color:${isMe?"var(--gold)":"var(--white)"};font-weight:700">${p.name}</td>
        <td>${gradeBadge(p)}</td>
        <td style="color:var(--gray)">${p.age||"?"}</td>
        <td style="color:var(--gray);font-size:.65rem">${draftStr(p)}</td>
        <td style="color:var(--gray);font-size:.68rem">${p.teamName}</td>
        <td style="color:${aavColor(c.aav)};font-weight:700">$${c.aav.toFixed(1)}M</td>
        <td>${vsMarketCell(c.aav, mv)}</td>
        <td style="color:var(--gold);font-size:.65rem">${careerEarningsStr(p)}</td>
        <td style="color:var(--gray);font-size:.65rem">${c.remaining}yr</td>
      </tr>`;
    }).join("");
    return `
      <div style="font-size:.72rem;color:var(--gray);margin-bottom:.5rem">
        ${all.length} ${pos}s · Avg AAV: <b style="color:var(--white)">$${all.length?(all.reduce((s,p)=>s+p.contract.aav,0)/all.length).toFixed(1):0}M</b>
        · Top-grade rate: <b style="color:var(--gold)">$${computeMarketValue({overall:85,age:27,position:pos},cap).toFixed(1)}M</b>
      </div>
      <table class="frn-ana-table"><thead>
        <tr><th>#</th><th>Player</th><th>Grade</th><th>Age</th><th>Draft</th><th>Team</th><th>AAV</th><th>vs Market</th><th>Career $</th><th>Left</th></tr>
      </thead><tbody>${rows}</tbody></table>`;
  }

  const tabs = [
    { id:"mysheet",   label:"MY CAP SHEET" },
    { id:"caphealth", label:"CAP HEALTH" },
    { id:"cuts",      label:"CUT LIST" },
    { id:"timeline",  label:"TIMELINE" },
    { id:"league",    label:"LEAGUE HEALTH" },
    { id:"top",       label:"TOP CONTRACTS" },
    { id:"picks",     label:"DRAFT CAPITAL" },
    { id:"power",     label:"POWER RANKINGS" },
    { id:"QB",  label:"QB" }, { id:"RB",  label:"RB" },
    { id:"WR",  label:"WR" }, { id:"TE",  label:"TE" },
    { id:"DL",  label:"DL" }, { id:"LB",  label:"LB" }, { id:"CB",  label:"CB" },
  ];

  const tabBarHtml = tabs.map(t => `
    <button class="frn-ana-tab ${t.id===tab?"active":""}" onclick="renderFrnAnalytics('${t.id}')">${t.label}</button>
  `).join("");

  function draftCapital() {
    const myId = chosenTeamId;
    const myPicks = (franchise.picks || []).filter(p => p.currentOwnerId === myId);
    const myPicksByYear = {};
    for (const p of myPicks) (myPicksByYear[p.year] ||= []).push(p);
    const years = Object.keys(myPicksByYear).sort();
    const sections = years.map(yr => {
      const picks = myPicksByYear[yr].slice().sort((a,b) => a.round - b.round);
      const rows = picks.map(p => {
        const origTeam = getTeam(p.originalTeamId);
        const own = p.originalTeamId === myId;
        return `<tr>
          <td style="color:var(--gold);font-weight:700">R${p.round}</td>
          <td>${own ? "Own" : `<span style="color:#7fbfff">via ${origTeam?.name||"?"}</span>`}</td>
          <td style="color:var(--gray)">${_pickValue(p).toFixed(0)} value</td>
        </tr>`;
      }).join("");
      return `<div style="margin-bottom:.8rem">
        <div class="frn-card-title">${yr} DRAFT · ${picks.length} pick${picks.length>1?"s":""}</div>
        <table class="frn-ana-table">
          <thead><tr><th>Round</th><th>Source</th><th>Approx value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join("");
    // League capital — every team's count of future picks
    const leagueRows = TEAMS.map(t => {
      const tp = (franchise.picks || []).filter(p => p.currentOwnerId === t.id);
      const firsts = tp.filter(p => p.round === 1).length;
      const seconds = tp.filter(p => p.round === 2).length;
      const total = tp.length;
      const isMe = t.id === myId;
      return `<tr style="${isMe?"background:rgba(200,169,0,0.08)":""}">
        <td style="color:${isMe?"var(--gold)":"var(--white)"};font-weight:${isMe?700:400}">${isMe?"»":""} ${t.city} ${t.name}</td>
        <td style="text-align:right;color:var(--gold)">${firsts}</td>
        <td style="text-align:right;color:var(--gold-lt)">${seconds}</td>
        <td style="text-align:right;color:var(--gray)">${total}</td>
      </tr>`;
    }).join("");
    return `${sections || `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center">No upcoming picks tracked yet.</div>`}
      <div class="frn-card-title" style="margin-top:1rem">LEAGUE CAPITAL (future picks owned)</div>
      <table class="frn-ana-table">
        <thead><tr><th>Team</th><th style="text-align:right">1st</th><th style="text-align:right">2nd</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${leagueRows}</tbody>
      </table>`;
  }

  function powerRankings() {
    // Composite: 50% W-L%, 30% point differential (normalized), 20% recent form.
    const myId = chosenTeamId;
    const rows = TEAMS.map(t => {
      const s = franchise.standings?.[t.id] || { w:0, l:0, t:0, pf:0, pa:0 };
      const gp = s.w + s.l + (s.t || 0);
      const winPct = gp ? (s.w + (s.t||0) * 0.5) / gp : 0.5;
      const pd = (s.pf || 0) - (s.pa || 0);
      const pdScore = Math.tanh(pd / 50) * 0.5 + 0.5; // 0..1 sigmoid
      // Recent form: last 3 played games
      const recent = (franchise.schedule || [])
        .filter(g => g.played && (g.homeId === t.id || g.awayId === t.id))
        .sort((a,b) => b.week - a.week)
        .slice(0, 3);
      let formW = 0;
      for (const g of recent) {
        const my = g.homeId === t.id ? g.homeScore : g.awayScore;
        const op = g.homeId === t.id ? g.awayScore : g.homeScore;
        if (my > op) formW++;
        else if (my === op) formW += 0.5;
      }
      const formScore = recent.length ? formW / recent.length : 0.5;
      const composite = winPct * 0.5 + pdScore * 0.3 + formScore * 0.2;
      return { t, s, gp, winPct, pd, formScore, composite, recent };
    }).sort((a,b) => b.composite - a.composite);

    const cellRecent = ({ recent, t }) => recent.map(g => {
      const my = g.homeId === t.id ? g.homeScore : g.awayScore;
      const op = g.homeId === t.id ? g.awayScore : g.homeScore;
      const r = my > op ? "W" : my === op ? "T" : "L";
      const c = r === "W" ? "var(--green-lt)" : r === "T" ? "var(--gray)" : "var(--red)";
      return `<span style="color:${c};font-weight:700">${r}</span>`;
    }).join(" ") || `<span style="color:var(--gray)">—</span>`;

    return `<table class="frn-ana-table"><thead>
      <tr><th>#</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th><th>Diff</th><th>L3</th><th>Power</th></tr>
    </thead><tbody>
      ${rows.map((r, i) => `<tr style="${r.t.id===myId?"background:rgba(200,169,0,0.10)":""}">
        <td style="color:var(--gold);font-weight:700">${i+1}</td>
        <td style="font-weight:${r.t.id===myId?700:400}">${teamLink(r.t)}</td>
        <td>${r.s.w}-${r.s.l}${r.s.t?`-${r.s.t}`:""}</td>
        <td>${r.s.pf||0}</td>
        <td>${r.s.pa||0}</td>
        <td style="color:${r.pd>=0?"var(--green-lt)":"var(--red)"}">${r.pd>0?"+":""}${r.pd}</td>
        <td>${cellRecent(r)}</td>
        <td style="color:var(--gold);font-weight:700">${(r.composite*100).toFixed(0)}</td>
      </tr>`).join("")}
    </tbody></table>`;
  }

  let bodyHtml;
  if      (tab === "mysheet")   bodyHtml = myCapSheet();
  else if (tab === "caphealth") bodyHtml = capHealthDashboard();
  else if (tab === "cuts")      bodyHtml = cutCandidatesList();
  else if (tab === "timeline")  bodyHtml = contractTimeline();
  else if (tab === "league")    bodyHtml = leagueCapHealth();
  else if (tab === "top")       bodyHtml = topContracts();
  else if (tab === "picks")     bodyHtml = draftCapital();
  else if (tab === "power")     bodyHtml = powerRankings();
  else                          bodyHtml = posMarket(tab);

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:.7rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">📊 CAP & CONTRACT ANALYTICS</div>
      <div style="color:var(--gray);font-size:.72rem">Season ${franchise.season} · Cap: $${cap.toFixed(0)}M</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto;font-size:.72rem">← Back</button>
    </div>
    <div class="frn-ana-tabs">${tabBarHtml}</div>
    <div class="frn-ana-body">${bodyHtml}</div>`;
}

// ── Coach hot seat ───────────────────────────────────────────────────────────
// After week 7, head coaches with .350-or-worse win rate get a hot-seat
// alert in the wire. One alert per coach per season so the wire doesn't
// get spammed. Persisted on franchise.hotSeats = { [teamId]: season }.
function _checkCoachHotSeat() {
  if (franchise.week < 8) return;
  franchise.hotSeats = franchise.hotSeats || {};
  for (const t of TEAMS) {
    const s = franchise.standings?.[t.id]; if (!s) continue;
    const gp = (s.w || 0) + (s.l || 0) + (s.t || 0);
    if (gp < 6) continue;
    const pct = (s.w + s.t * 0.5) / gp;
    if (pct > 0.35) continue;
    if (franchise.hotSeats[t.id] === franchise.season) continue;
    franchise.hotSeats[t.id] = franchise.season;
    const coach = franchise.coaches?.[t.id]?.hc;
    if (!coach) continue;
    _pushNews({ type: "hot_seat",
      label: `🔥 ${coach.name} (${t.name}) on the hot seat — ${s.w}-${s.l}${s.t?`-${s.t}`:""} record drawing scrutiny` });
  }
}

// ── Franchise tag ─────────────────────────────────────────────────────────────
// One per offseason. 1-year fully-guaranteed deal at the top-5 position
// ── Contract context helpers ──────────────────────────────────────────────────

// OVR delta vs last season (null if no history stored yet).
function _ovrTrend(player) {
  const hist = player?.careerHistory || [];
  const last = hist[hist.length - 1];
  if (!last || last.overall == null) return null;
  return (player.overall || 70) - last.overall;
}

// Age at contract expiry + warning string if risky.
function _ageCurveWarning(age, years) {
  const endAge = (age || 25) + (years || 1);
  if (endAge >= 36) return { endAge, level: "danger",  label: `⚠ age ${endAge} at expiry — deep decline risk` };
  if (endAge >= 33) return { endAge, level: "caution", label: `age ${endAge} at expiry — late-career deal` };
  return { endAge, level: "ok", label: null };
}

// Count teammates at the same position with OVR >= threshold (excludes self).
function _posDepth(position, excludeName, ovrMin = 75) {
  return (franchise.rosters[franchise.chosenTeamId] || [])
    .filter(p => p.position === position && p.name !== excludeName && (p.overall || 0) >= ovrMin).length;
}

// Seasons the player has been on the current roster (from careerHistory).
function _yearsWithTeam(playerName) {
  const myId = franchise.chosenTeamId;
  const player = (franchise.rosters[myId] || []).find(p => p.name === playerName);
  if (!player) return 0;
  return (player.careerHistory || []).filter(h => h.teamId === myId).length;
}

// Number of matching-position players in the current FA pool.
function _faMktDepth(position) {
  return (franchise.freeAgents || []).filter(p => p.position === position).length;
}

// Highest single AAV at a position across all league rosters.
function _positionLeagueMax(position) {
  let max = 0;
  for (const roster of Object.values(franchise.rosters || {}))
    for (const p of roster)
      if (p.position === position && p.contract && p.contract.aav > max) max = p.contract.aav;
  return Math.round(max * 10) / 10;
}

// Render a compact contract-context bar: market / top-5 avg / league max.
function _contractContextBar(position, marketValue, cap) {
  const avg5 = _positionTopAvgAAV(position, cap);
  const lmax = _positionLeagueMax(position);
  return `<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.2rem">
    <span style="font-size:.58rem;color:var(--gray)">MKT <b style="color:var(--white)">$${marketValue.toFixed(1)}M</b></span>
    <span style="font-size:.58rem;color:var(--gray)">TOP-5 AVG <b style="color:var(--gold)">$${avg5.toFixed(1)}M</b></span>
    <span style="font-size:.58rem;color:var(--gray)">LG MAX <b style="color:#e8a000">$${lmax.toFixed(1)}M</b></span>
  </div>`;
}

// average AAV. Second consecutive tag on the same player carries a +20%
// premium (which mirrors the NFL "second franchise tag" rule).
function _positionTopAvgAAV(position, cap, n = 5) {
  const all = [];
  for (const roster of Object.values(franchise.rosters || {})) {
    for (const p of roster) {
      if (p.position === position && p.contract) all.push(p.contract.aav);
    }
  }
  all.sort((a, b) => b - a);
  const top = all.slice(0, n);
  if (!top.length) return computeMarketValue({ position, overall: 80 }, cap);
  return Math.round((top.reduce((s, v) => s + v, 0) / top.length) * 10) / 10;
}
function _franchiseTagAAV(player, cap) {
  const base = _positionTopAvgAAV(player.position, cap);
  const tagged = (franchise.franchiseTagHistory?.[player.name] || 0);
  return Math.round(base * (1 + 0.20 * tagged) * 10) / 10;
}
function _franchiseTagAvailable() {
  return franchise.franchiseTagUsed !== franchise.season;
}

// ── Mid-season holdouts ──────────────────────────────────────────────────────
// Stars in the last year of their deal can demand a new contract DURING
// the season. If user doesn't extend or move them within 4 weeks, they
// hold out for a game (injury-style 1-week sit) and the demand expires.
function _checkHoldoutDemands() {
  const myId = franchise.chosenTeamId;
  const roster = franchise.rosters[myId] || [];
  franchise.holdoutDemands = franchise.holdoutDemands || [];
  // New demand rolls — only for stars in their contract year, age ≤30
  for (const p of roster) {
    if (!p.contract || p.contract.remaining !== 1) continue;
    if ((p.overall || 0) < 85) continue;
    if ((p.age || 0) > 30) continue;
    if (p.injury?.weeksRemaining > 0) continue;
    if (franchise.holdoutDemands.some(d => d.name === p.name)) continue;
    if (Math.random() >= 0.04) continue;
    franchise.holdoutDemands.push({
      name: p.name, position: p.position,
      week: franchise.week, deadlineWeek: franchise.week + 4,
      marketValue: computeMarketValue(p, franchise.salaryCap),
    });
    _pushNews({ type: "holdout_demand",
      label: `📣 ${p.position} ${p.name} wants a new deal before his contract expires — extend by Week ${franchise.week + 4}` });
  }
  // Resolve expired demands → 1-game sit-out
  for (const d of franchise.holdoutDemands.slice()) {
    if (d.deadlineWeek <= franchise.week) {
      const p = roster.find(r => r.name === d.name);
      if (p && !p.injury) {
        p.injury = { label: "holdout", weeksRemaining: 1 };
        _pushNews({ type: "holdout",
          label: `🚫 ${p.position} ${p.name} is holding out — not playing this week` });
      }
      franchise.holdoutDemands = franchise.holdoutDemands.filter(x => x.name !== d.name);
    }
  }
}
// Mid-season extension — replaces the player's contract with a fresh
// one. Cancels any active holdout demand.
function frnExtendPlayer(name) {
  const myId = franchise.chosenTeamId;
  const roster = franchise.rosters[myId] || [];
  const p = roster.find(r => r.name === name);
  if (!p) return;
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const baseMarket = computeMarketValue(p, cap);
  // Open inline modal-style picker — user picks 2-6 years.
  const years = parseInt(prompt(
    `Extend ${name}? Pick length (2-6 years):`, "4"
  ), 10);
  if (!years || years < 2 || years > 6) return;
  const aav = _resignAavForYears(baseMarket, years);
  const newTotal = aav * years;
  if (!confirm(`Sign ${name} to ${years}yr / $${aav.toFixed(1)}M/yr ($${newTotal.toFixed(1)}M total)?`)) return;
  const guaranteedYears = _guaranteedYearsForLength(years);
  p.contract = {
    years, remaining: years, aav,
    guaranteedYears, guaranteedAAV: aav,
    signedAav: aav,
  };
  franchise.holdoutDemands = (franchise.holdoutDemands || []).filter(d => d.name !== name);
  _pushNews({ type: "extension",
    label: `🤝 Extended ${p.position} ${name} — ${years}yr / $${aav.toFixed(1)}M/yr` });
  saveFranchise();
  showFranchiseDashboard();
}

// ── Re-signings screen ─────────────────────────────────────────────────────────
// Per-player length picker (1-6 years) with AAV that scales inversely:
// longer deal → small commitment discount, shorter deal → short-term
// premium so the player gets more cash up front. Player accepts if the
// offered AAV is within 92% of the length-adjusted market value;
// otherwise they decline and enter FA.
const _RESIGN_MIN_YEARS = 1;
const _RESIGN_MAX_YEARS = 6;
function _resignAavForYears(baseMarket, years) {
  const delta = years - 3;
  // Below 3yr: +5%/yr short-term premium. Above 3yr: -2%/yr commitment discount.
  const factor = delta < 0 ? 1 + Math.abs(delta) * 0.05
                           : 1 - delta * 0.02;
  const clamped = Math.max(0.85, Math.min(1.25, factor));
  return Math.max(0.5, Math.round(baseMarket * clamped * 10) / 10);
}
// Guaranteed years scale with length — this is the *downside* of long deals.
// If the team releases the player, the guaranteed remaining years still
// count against the cap (dead money).
//   1yr→1 (fully guaranteed),  2yr→2,  3yr→2,  4yr→2,  5yr→3,  6yr→3
function _guaranteedYearsForLength(years) {
  if (years <= 1) return 0;
  if (years <= 2) return 1;
  if (years <= 4) return 2;
  return 3;
}
function renderFrnResignings() {
  const { chosenTeamId, salaryCap } = franchise;
  const cap = salaryCap || SALARY_CAP_BASE;
  const myRoster   = franchise.rosters[chosenTeamId] || [];
  const expiring   = myRoster.filter(p => p.contract && p.contract.remaining <= 0);
  const committed  = myRoster.filter(p => p.contract && p.contract.remaining > 0);
  const capCommitted = committed.reduce((s, p) => s + currentYearCapHit(p), 0);

  if (expiring.length === 0) {
    frnProceedToRosterChanges();
    return;
  }

  // Default offer: 3-year deal at market rate.
  expiring.sort((a, b) => (b.overall || 0) - (a.overall || 0));
  franchise._resignPending = expiring.map(p => {
    const baseMarket = computeMarketValue(p, cap);
    const offerYears = 3;
    return {
      name: p.name, pos: p.position, overall: p.overall, age: p.age,
      baseMarket,
      offer: _resignAavForYears(baseMarket, offerYears),
      offerYears,
      structure: _defaultStructure(p.age || 27, p.overall || 70),
      decision: null,
    };
  });
  saveFranchise();
  _renderResignUI(cap, capCommitted);
}

function _renderResignUI(cap, capCommitted) {
  const { chosenTeamId, _resignPending } = franchise;
  const myTeam = getTeam(chosenTeamId);
  let runningCap = capCommitted;
  const _statLine = name => {
    const agg = _playerSeasonStatsAgg(name);
    return agg ? mvpStatLine(agg) : "";
  };

  const rows = _resignPending.map((r, idx) => {
    const newCap = runningCap + (r.decision === "accept" ? r.offer : 0);
    const capAfter = cap - newCap;
    const isAccept  = r.decision === "accept";
    const isDecline = r.decision === "decline";
    const isLocked  = isAccept || isDecline || r.decision === "tag";
    const struct = r.structure || "BALANCED";
    const { bonusProration } = _signingBonusCalc(r.offer, r.offerYears, r.overall || 70);
    const deadTotal = bonusProration * r.offerYears;

    // ── Signing preview panel (year-by-year breakdown before committing) ──
    if (_resignPreview === idx && !isLocked) {
      const bases = _baseSalarySchedule(r.offer, r.offerYears, struct, bonusProration);
      const yearPills = bases.map((base, i) => {
        const hit = Math.round((base + bonusProration) * 10) / 10;
        return `<div style="display:flex;justify-content:space-between;padding:.18rem .4rem;border-radius:4px;background:var(--bg3);font-size:.67rem;gap:.8rem">
          <span style="color:var(--gray)">Yr ${i+1}</span>
          <span>$${base.toFixed(1)}M base</span>
          <span style="color:var(--gray)">+$${bonusProration.toFixed(1)}M bonus</span>
          <span style="color:var(--gold);font-weight:700">= $${hit.toFixed(1)}M</span>
        </div>`;
      }).join("");
      return `
        <div class="frn-resign-row" style="border-color:var(--gold);background:rgba(200,169,0,.07)">
          <div class="frn-resign-info">
            <span style="font-weight:700;color:var(--gold)">${r.name}</span>
            <span style="color:var(--gray);font-size:.7rem">${r.pos} · ${r.overall} OVR · Age ${r.age}</span>
            <span style="font-size:.6rem;color:var(--gray);margin-top:.1rem">${struct} · $${r.offer.toFixed(1)}M/yr · ${r.offerYears}yr</span>
          </div>
          <div style="flex:1;display:flex;flex-direction:column;gap:.2rem;margin:0 .6rem">${yearPills}</div>
          <div class="frn-resign-btns" style="flex-direction:column;gap:.3rem">
            ${deadTotal >= 0.5 ? `<span style="color:#ff9090;font-size:.6rem;text-align:center">☠ Dead $${bonusProration.toFixed(1)}M×${r.offerYears}yr</span>` : ""}
            <button class="btn btn-gold" onclick="frnResignDecide(${idx},'accept')" style="white-space:nowrap">✓ Sign Deal</button>
            <button class="btn btn-outline" onclick="_resignPreview=null;_renderResignUIRefresh()" style="font-size:.65rem">← Back</button>
          </div>
        </div>`;
    }

    const livePlayer = (franchise.rosters[chosenTeamId] || []).find(p => p.name === r.name);
    const trend = _ovrTrend(livePlayer);
    const trendHtml = trend == null ? "" : trend > 0
      ? `<span style="color:var(--green-lt);font-size:.6rem">↑ +${trend} OVR</span>`
      : trend < 0 ? `<span style="color:var(--red);font-size:.6rem">↓ ${trend} OVR</span>`
      : `<span style="color:var(--gray);font-size:.6rem">→ flat</span>`;
    const curve = _ageCurveWarning(r.age, r.offerYears);
    const curveHtml = curve.label ? `<span style="color:${curve.level==="danger"?"var(--red)":"#e8a000"};font-size:.58rem">${curve.label}</span>` : "";
    const depth = _posDepth(r.pos, r.name);
    const depthHtml = `<span style="font-size:.58rem;color:var(--gray)">${depth} other ${r.pos} ≥75 OVR</span>`;
    const yrs = _yearsWithTeam(r.name);
    const yrsHtml = yrs >= 1 ? `<span style="font-size:.58rem;color:var(--gray)">${yrs}-yr veteran</span>` : "";
    const faMkt = _faMktDepth(r.pos);
    const faMktHtml = faMkt > 0 ? `<span style="font-size:.58rem;color:var(--gray)">${faMkt} FA${r.pos}s available</span>` : "";
    const flightRisk = livePlayer?.unhappy;
    const flightHtml = flightRisk ? `<span style="font-size:.58rem;color:var(--red)">⚠ flight risk — likely leaves</span>` : "";

    return `
      <div class="frn-resign-row ${isAccept?"accepted":isDecline?"declined":""}">
        <div class="frn-resign-info">
          <span style="font-weight:700;color:var(--white)">${r.name}</span>
          <span style="color:var(--gray);font-size:.7rem">${r.pos} · ${r.overall} OVR ${trendHtml} · Age ${r.age}</span>
          ${_statLine(r.name) ? `<span style="color:var(--gray);font-size:.6rem;font-style:italic">${_statLine(r.name)}</span>` : ""}
          ${_contractContextBar(r.pos, r.baseMarket, cap)}
          <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.15rem">${depthHtml}${yrsHtml ? " · "+yrsHtml : ""}${faMktHtml ? " · "+faMktHtml : ""}${flightHtml}</div>
        </div>
        <div class="frn-resign-offer">
          <span style="color:${r.offer > r.baseMarket * 1.1 ? 'var(--red)' : r.offer < r.baseMarket * 0.9 ? 'var(--green-lt)' : 'var(--gold)'};font-weight:700">$${r.offer.toFixed(1)}M/yr ${vsMarketCell(r.offer, r.baseMarket)}</span>
          <div style="display:flex;align-items:center;gap:.25rem;justify-content:flex-end;margin-top:.15rem">
            <button class="frn-resign-yrbtn"
              ${r.offerYears <= _RESIGN_MIN_YEARS || isLocked ? "disabled" : ""}
              onclick="frnResignAdjustYears(${idx}, -1)">−</button>
            <span style="color:var(--gray);font-size:.7rem;min-width:2.5rem;text-align:center">${r.offerYears} yr</span>
            <button class="frn-resign-yrbtn"
              ${r.offerYears >= _RESIGN_MAX_YEARS || isLocked ? "disabled" : ""}
              onclick="frnResignAdjustYears(${idx}, 1)">+</button>
          </div>
          <span style="color:var(--gray);font-size:.6rem;text-align:right">total $${(r.offer * r.offerYears).toFixed(1)}M</span>
          ${curveHtml}
          ${deadTotal < 0.5 ? `<span style="color:var(--gray);font-size:.6rem">No dead cap</span>`
            : `<span style="color:#ff9090;font-size:.6rem;text-align:right" title="Prorated signing bonus — counts as dead cap if you release this player.">☠ Dead $${bonusProration.toFixed(1)}M×${r.offerYears}yr = $${deadTotal.toFixed(1)}M</span>`}
          ${isLocked ? "" : `<div style="display:flex;gap:.2rem;justify-content:flex-end;margin-top:.25rem;align-items:center;flex-wrap:wrap">
            <span style="color:var(--gray);font-size:.58rem">Structure:</span>
            ${["BALANCED","BACKLOADED","FRONTLOADED"].map(s => {
              const desc = s==="BALANCED"?"flat salaries":s==="BACKLOADED"?"cheap now, costly later":"costly now, cheap later";
              return `<button class="btn ${struct===s?"btn-gold":"btn-outline"}" onclick="frnResignSetStructure(${idx},'${s}')" style="font-size:.55rem;padding:.1rem .3rem" title="${desc}">${s[0]+s.slice(1).toLowerCase()}</button>`;
            }).join("")}
          </div>`}
        </div>
        <div class="frn-resign-btns">
          ${r.decision === "tag"
            ? `<button class="btn frn-resign-btn accepted" title="Franchise tagged: 1yr fully guaranteed">🏷 Tagged $${r.tagAAV?.toFixed(1)}M</button>`
            : isAccept
              ? `<button class="btn frn-resign-btn accepted">✓ Accepted</button>`
              : isDecline
                ? `<button class="btn frn-resign-btn declined">✗ Declined</button>`
                : `<button class="btn frn-resign-btn accept-btn" onclick="_resignPreview=${idx};_renderResignUIRefresh()">Review & Sign</button>
                   ${_franchiseTagAvailable() ? `<button class="btn frn-resign-btn accept-btn" style="border-color:var(--gold);color:var(--gold)"
                     onclick="frnResignTag(${idx})" title="Franchise tag: 1yr fully guaranteed at top-5 position avg ($${_franchiseTagAAV({position: r.pos, name: r.name}, cap).toFixed(1)}M)">🏷 Tag</button>` : ""}
                   <button class="btn frn-resign-btn decline-btn" onclick="frnResignDecide(${idx},'decline')">Let Walk</button>`}
        </div>
      </div>`;
  }).join("");

  const acceptedCost = _resignPending
    .filter(r => r.decision === "accept").reduce((s, r) => s + r.offer, 0);
  const finalCap = capCommitted + acceptedCost;
  const pending  = _resignPending.filter(r => r.decision === null).length;

  $("frnHomeContent").innerHTML = `
    <div style="text-align:center;margin-bottom:1rem">
      <div style="font-size:1.15rem;font-weight:900;color:var(--gold)">Contract Re-Signings</div>
      <div style="color:var(--gray);font-size:.78rem">${myTeam.city} ${myTeam.name} · Season ${franchise.season} Offseason</div>
      <div style="margin-top:.4rem;font-size:.78rem">
        Cap room: <b style="color:${cap-finalCap<0?"var(--red)":"var(--green-lt)"}">$${(cap-finalCap).toFixed(1)}M</b>
        remaining after decisions · Cap: <b style="color:var(--gold)">$${cap.toFixed(0)}M</b>
      </div>
    </div>
    <div style="font-size:.68rem;color:var(--gray);margin-bottom:.5rem">
      ${_resignPending.length} players with expiring contracts —
      accepted players re-sign at market rate; declined players enter free agency (lost for now).
    </div>
    <div class="frn-resign-list">${rows}</div>
    <div class="frn-actions" style="justify-content:center;margin-top:1rem;flex-wrap:wrap;gap:.5rem">
      ${pending > 0
        ? `<div style="color:var(--gray);font-size:.72rem">${pending} decision${pending>1?"s":""} remaining</div>`
        : `<button class="btn btn-gold" onclick="frnConfirmResignings()">✓ Confirm & Continue Offseason</button>`}
      ${_resignPending.some(r => r.decision === null && (r.overall || 0) < 75)
        ? `<button class="btn btn-outline" style="font-size:.7rem;color:var(--gray)"
            onclick="frnResignBulkDecline(75)">✗ Let Walk All &lt;75 OVR</button>` : ""}
    </div>`;
}

function _renderResignUIRefresh() {
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const committed = (franchise.rosters[franchise.chosenTeamId] || [])
    .filter(p => p.contract && p.contract.remaining > 0)
    .reduce((s, p) => s + currentYearCapHit(p), 0);
  _renderResignUI(cap, committed);
}

function frnResignBulkDecline(ovrThreshold) {
  if (!franchise._resignPending) return;
  for (const r of franchise._resignPending) {
    if (r.decision === null && (r.overall || 0) < ovrThreshold) r.decision = "decline";
  }
  _renderResignUIRefresh();
}

function frnResignSetStructure(idx, structure) {
  const row = franchise._resignPending?.[idx];
  if (!row || row.decision) return;
  row.structure = structure;
  saveFranchise();
  _renderResignUIRefresh();
}

function frnResignTag(idx) {
  if (!_franchiseTagAvailable()) { alert("You've already used your franchise tag this offseason."); return; }
  const row = franchise._resignPending?.[idx];
  if (!row || row.decision) return;
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const tagAAV = _franchiseTagAAV({ position: row.pos, name: row.name }, cap);
  if (!confirm(`Franchise tag ${row.name}? 1yr fully guaranteed at $${tagAAV.toFixed(1)}M. You only get one tag per offseason.`)) return;
  row.decision = "tag";
  row.tagAAV = tagAAV;
  franchise.franchiseTagUsed = franchise.season;
  saveFranchise();
  const committed = (franchise.rosters[franchise.chosenTeamId] || [])
    .filter(p => p.contract && p.contract.remaining > 0)
    .reduce((s, p) => s + p.contract.aav, 0);
  _renderResignUI(cap, committed);
}

function frnResignDecide(idx, decision) {
  _resignPreview = null;
  franchise._resignPending[idx].decision = decision;
  saveFranchise();
  _renderResignUIRefresh();
}

function frnResignAdjustYears(idx, delta) {
  const row = franchise._resignPending?.[idx];
  if (!row || row.decision) return;
  const newYears = Math.max(_RESIGN_MIN_YEARS, Math.min(_RESIGN_MAX_YEARS, row.offerYears + delta));
  if (newYears === row.offerYears) return;
  row.offerYears = newYears;
  row.offer = _resignAavForYears(row.baseMarket, newYears);
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const committed = (franchise.rosters[franchise.chosenTeamId] || [])
    .filter(p => p.contract && p.contract.remaining > 0)
    .reduce((s, p) => s + p.contract.aav, 0);
  saveFranchise();
  _renderResignUI(cap, committed);
}

function frnConfirmResignings() {
  const { chosenTeamId, salaryCap, _resignPending } = franchise;
  const cap = salaryCap || SALARY_CAP_BASE;
  const myRoster = franchise.rosters[chosenTeamId] || [];

  for (const r of (_resignPending || [])) {
    const player = myRoster.find(p => p.name === r.name && p.position === r.pos);
    if (!player) continue;
    if (r.decision === "tag") {
      // Franchise tag: 1yr fully guaranteed — always balanced, small bonus.
      const _tagBonus = _signingBonusCalc(r.tagAAV, 1, player.overall || 70);
      player.contract = {
        years: 1, remaining: 1, aav: r.tagAAV,
        structure: "BALANCED",
        baseSalaries: [r.tagAAV - _tagBonus.bonusProration],
        signingBonus: _tagBonus.signingBonus, bonusProration: _tagBonus.bonusProration,
        guaranteedYears: 1, guaranteedAAV: r.tagAAV,
        signedAav: r.tagAAV,
      };
      franchise.franchiseTagHistory = franchise.franchiseTagHistory || {};
      franchise.franchiseTagHistory[r.name] = (franchise.franchiseTagHistory[r.name] || 0) + 1;
      _pushNews({ type: "tag",
        label: `🏷 Franchise-tagged ${r.pos} ${r.name} — 1yr / $${r.tagAAV.toFixed(1)}M fully guaranteed` });
    } else if (r.decision === "accept") {
      const guaranteedYears = _guaranteedYearsForLength(r.offerYears);
      const _rsStruct = r.structure || _defaultStructure(player.age || 27, player.overall || 70);
      const _rsBonus  = _signingBonusCalc(r.offer, r.offerYears, player.overall || 70);
      player.contract = {
        years: r.offerYears, remaining: r.offerYears, aav: r.offer,
        structure: _rsStruct,
        baseSalaries: _baseSalarySchedule(r.offer, r.offerYears, _rsStruct, _rsBonus.bonusProration),
        signingBonus: _rsBonus.signingBonus, bonusProration: _rsBonus.bonusProration,
        guaranteedYears,
        guaranteedAAV: r.offer,
        signedAav: r.offer,
        incentives: _generateIncentives(player, r.offer),
      };
    } else {
      // Declined: remove from roster (enters FA — currently just lost)
      const idx = myRoster.indexOf(player);
      if (idx !== -1) myRoster.splice(idx, 1);
    }
  }
  franchise._resignPending = null;
  _resignPreview = null;
  saveFranchise();
  frnProceedToRosterChanges();
}

function frnProceedToRosterChanges() {
  franchise._offChanges = runFrnOffseason();
  saveFranchise();
  renderFrnOffseason();
}

function renderFrnAwards() {
  const { season, chosenTeamId, history, standings, seasonHighlights } = franchise;
  const latest     = history[history.length - 1] || {};
  const champId    = latest.champion;
  const champTeam  = getTeam(champId);
  const userTeam   = getTeam(chosenTeamId);
  const isUserChamp= champId === chosenTeamId;
  const userStand  = standings[chosenTeamId] || { w:0, l:0 };

  const link = (rec) => (rec && rec.name) ? playerLinkByName(rec.name) : "—";

  // Hero champion card
  const sb = latest.superBowlScore;
  const sbHomeT = sb ? getTeam(sb.homeId) : null;
  const sbAwayT = sb ? getTeam(sb.awayId) : null;
  const champRec = latest.championRecord || { w:0, l:0 };
  const championHero = champTeam ? `
    <div class="bspnlive-awards-hero" style="--champ-color:${champTeam.primary};--champ-2:${champTeam.secondary || '#fff'}">
      <div class="bspnlive-awards-hero-stripe"></div>
      <div class="bspnlive-awards-hero-body">
        <div class="bspnlive-awards-hero-eyebrow">SEASON ${season} · CHAMPIONS</div>
        <div class="bspnlive-awards-hero-name">${champTeam.city.toUpperCase()} ${champTeam.name.toUpperCase()}</div>
        <div class="bspnlive-awards-hero-meta">
          ${champRec.w}-${champRec.l} regular season
          ${sb && sbHomeT && sbAwayT ? `<span class="bspnlive-awards-hero-divider">·</span>
            <span class="bspnlive-awards-hero-sb">SB:
              <b>${sbAwayT.name}</b> ${sb.awayScore} <span style="color:var(--blgray)">@</span>
              <b>${sbHomeT.name}</b> ${sb.homeScore}</span>` : ""}
        </div>
        ${isUserChamp
          ? `<div class="bspnlive-awards-hero-flag champ">🎉 YOUR TEAM WON IT ALL</div>`
          : `<div class="bspnlive-awards-hero-flag">${userTeam.name} finished ${userStand.w}-${userStand.l}</div>`}
      </div>
      <div class="bspnlive-awards-hero-trophy">🏆</div>
    </div>` : "";

  // Hero League MVP
  const mvp = latest.leagueMVP;
  const mvpTeam = mvp ? getTeam(mvp.teamId) : null;
  const mvpHero = mvp ? `
    <div class="bspnlive-mvp-hero" style="--mvp-color:${mvpTeam?.primary || '#b07a00'}">
      <div class="bspnlive-mvp-hero-stripe"></div>
      <div class="bspnlive-mvp-hero-body">
        <div class="bspnlive-mvp-hero-eyebrow">👑 LEAGUE MVP · SEASON ${season}</div>
        <div class="bspnlive-mvp-hero-name">${link(mvp)}</div>
        <div class="bspnlive-mvp-hero-meta">${mvp.pos}${mvpTeam ? ` · ${mvpTeam.city} ${mvpTeam.name}` : ""}</div>
        ${mvp.line ? `<div class="bspnlive-mvp-hero-line">${mvp.line}</div>` : ""}
      </div>
    </div>` : "";

  const awardCard = (icon, label, rec, extra) => {
    if (!rec) return `<div class="bspnlive-award-card empty">
      <div class="bspnlive-award-card-icon">${icon}</div>
      <div class="bspnlive-award-card-label">${label}</div>
      <div class="bspnlive-award-card-name" style="color:var(--blgray);font-style:italic">— vacant —</div>
    </div>`;
    const t = rec.teamId ? getTeam(rec.teamId) : null;
    return `<div class="bspnlive-award-card" style="--card-color:${rec.teamPrimary || t?.primary || '#888'}">
      <div class="bspnlive-award-card-stripe"></div>
      <div class="bspnlive-award-card-icon">${icon}</div>
      <div class="bspnlive-award-card-label">${label}</div>
      <div class="bspnlive-award-card-name">${link(rec)}</div>
      <div class="bspnlive-award-card-meta">${rec.pos || ""}${t ? ` · ${_bspnLiveAbbr(t)}` : ""}</div>
      ${rec.line ? `<div class="bspnlive-award-card-line">${rec.line}</div>` : ""}
      ${extra ? `<div class="bspnlive-award-card-extra">${extra}</div>` : ""}
    </div>`;
  };
  const sbMvp = latest.superBowlMVP;
  const coyCard = !latest.coy ? `<div class="bspnlive-award-card empty">
      <div class="bspnlive-award-card-icon">🎩</div>
      <div class="bspnlive-award-card-label">COACH OF THE YEAR</div>
      <div class="bspnlive-award-card-name" style="color:var(--blgray);font-style:italic">— vacant —</div>
    </div>` : `<div class="bspnlive-award-card" style="--card-color:${latest.coy.teamPrimary || '#888'}">
      <div class="bspnlive-award-card-stripe"></div>
      <div class="bspnlive-award-card-icon">🎩</div>
      <div class="bspnlive-award-card-label">COACH OF THE YEAR</div>
      <div class="bspnlive-award-card-name">${latest.coy.name}</div>
      <div class="bspnlive-award-card-meta">HC · ${latest.coy.teamAbbr || ""}</div>
      ${latest.coy.trait ? `<div class="bspnlive-award-card-line">${latest.coy.trait}</div>` : ""}
      <div class="bspnlive-award-card-extra">${latest.coy.wins} wins${latest.coy.improvement > 0 ? ` · +${latest.coy.improvement} W/W` : ""}${latest.coy.isChamp ? " · 🏆" : ""}</div>
    </div>`;
  const majorAwards = `
    <div class="bspnlive-awards-row">
      ${awardCard("🏆", "SUPER BOWL MVP", sbMvp)}
      ${awardCard("⚡", "OFFENSIVE POY", latest.opoy)}
      ${awardCard("🛡", "DEFENSIVE POY", latest.dpoy)}
      ${awardCard("🌱", "ROOKIE OF THE YEAR", latest.roy)}
      ${coyCard}
    </div>
    <div class="bspnlive-awards-row">
      ${awardCard("📈", "COMEBACK PLAYER", latest.comeback, latest.comeback ? `Score ${latest.comeback.lastScore} → ${latest.comeback.thisScore} · +${Math.round(latest.comeback.jump)}` : "")}
      ${awardCard("🚀", "BREAKOUT PLAYER", latest.breakout, latest.breakout ? `Career-best by +${Math.round(latest.breakout.lift)}` : "")}
      ${awardCard("⭐", "YOUR TEAM MVP", latest.userTeamMVP ? {...latest.userTeamMVP, teamPrimary: userTeam.primary, teamId: chosenTeamId} : null)}
      ${!isUserChamp ? awardCard("🥇", `${champTeam?.name || "?"} MVP`, latest.champTeamMVP ? {...latest.champTeamMVP, teamPrimary: champTeam?.primary, teamId: champId} : null) : `<div class="bspnlive-award-card empty"></div>`}
      <div class="bspnlive-award-card empty"></div>
    </div>`;

  // ── POTY section ────────────────────────────────────────────────────────────
  const poty = latest.poty;
  const voteWeeks = Object.keys(franchise.potwVotes?.[season] || {}).length;
  const potyCard = (icon, label, rec) => {
    if (!rec) return `<div class="bspnlive-award-card empty">
      <div class="bspnlive-award-card-icon">${icon}</div>
      <div class="bspnlive-award-card-label">${label}</div>
      <div class="bspnlive-award-card-name" style="color:var(--blgray);font-style:italic">— no votes cast —</div>
    </div>`;
    const t = rec.teamId ? getTeam(rec.teamId) : null;
    return `<div class="bspnlive-award-card" style="--card-color:${rec.teamPrimary || t?.primary || '#888'}">
      <div class="bspnlive-award-card-stripe"></div>
      <div class="bspnlive-award-card-icon">${icon}</div>
      <div class="bspnlive-award-card-label">${label}</div>
      <div class="bspnlive-award-card-name">${link(rec)}</div>
      <div class="bspnlive-award-card-meta">${rec.pos || ""}${t ? ` · ${_bspnLiveAbbr(t)}` : ""}</div>
      <div class="bspnlive-award-card-extra">${rec.wins} weekly vote${rec.wins===1?"":"s"}</div>
    </div>`;
  };
  const potySection = poty ? `
    <div class="bspnlive-section-title">🗳 PLAYER OF THE YEAR <span style="font-size:.65rem;font-weight:400;letter-spacing:.5px;color:var(--blgray);margin-left:.5rem">FAN VOTES · ${voteWeeks} WEEK${voteWeeks===1?"":"S"} VOTED</span></div>
    <div class="potw-poty-row">
      ${potyCard("⚡", "OFFENSIVE POTY",   poty.offense)}
      ${potyCard("🛡", "DEFENSIVE POTY",   poty.defense)}
      ${potyCard("🧱", "OL POTY",          poty.ol)}
      ${potyCard("🦵", "SPECIAL TEAMS POTY", poty.specialTeams)}
    </div>` : "";

  const renderAllProList = (formation, title, accent) => {
    if (!formation) return "";
    const rows = [];
    for (const [pos, n] of _ALLPRO_FORMATION) {
      const arr = formation[pos] || [];
      if (!arr.length) continue;
      rows.push(`<tr>
        <td class="bspnlive-allpro-pos">${pos}</td>
        <td class="bspnlive-allpro-names">${arr.map(r => `
          <span class="bspnlive-allpro-player">
            ${link(r)}
            <span class="bspnlive-allpro-tm" style="color:${r.teamPrimary}">${r.teamAbbr}</span>
          </span>`).join("")}</td>
      </tr>`);
    }
    return `<div class="bspnlive-allpro-block" style="border-top-color:${accent}">
      <div class="bspnlive-allpro-title">${title}</div>
      <table class="bspnlive-allpro-table"><tbody>${rows.join("")}</tbody></table>
    </div>`;
  };
  const allProSection = latest.allPros ? `
    <div class="bspnlive-section-title">★ ALL-PRO TEAMS</div>
    <div class="bspnlive-allpro-grid">
      ${renderAllProList(latest.allPros.AFC?.firstTeam,  "AFC FIRST TEAM",  "#d62c2c")}
      ${renderAllProList(latest.allPros.NFC?.firstTeam,  "NFC FIRST TEAM",  "#1a5fb4")}
      ${renderAllProList(latest.allPros.AFC?.secondTeam, "AFC SECOND TEAM", "#a04040")}
      ${renderAllProList(latest.allPros.NFC?.secondTeam, "NFC SECOND TEAM", "#3a6090")}
    </div>` : "";

  const renderLeaderCat = (cat) => {
    if (!cat || !cat.leaders?.length) return "";
    return `<div class="bspnlive-leader-cat">
      <div class="bspnlive-leader-cat-title">${cat.label}</div>
      ${cat.leaders.map((r, i) => `
        <div class="bspnlive-leader-row ${i===0?'lead':''}">
          <span class="bspnlive-leader-rank">${i+1}</span>
          <span class="bspnlive-leader-tm" style="color:${r.teamPrimary}">${r.teamAbbr}</span>
          <span class="bspnlive-leader-name">${link(r)}</span>
          <span class="bspnlive-leader-val">${r.value}</span>
        </div>`).join("")}
    </div>`;
  };
  const sl = latest.statLeaders || {};
  const leadersSection = Object.keys(sl).length ? `
    <div class="bspnlive-section-title">📊 STATISTICAL LEADERS</div>
    <div class="bspnlive-leaders-grid">
      ${["pass_yds","pass_td","rush_yds","rush_td","rec_yds","rec_td","sk","tkl","int_made","fg_made"]
        .map(k => renderLeaderCat(sl[k])).join("")}
    </div>` : "";

  const bn = latest.byNumbers;
  const tName = id => { const t = getTeam(id); return t ? `${t.city} ${t.name}` : "?"; };
  const tAbbr = id => { const t = getTeam(id); return t ? _bspnLiveAbbr(t) : "—"; };
  const numbersSection = bn ? `
    <div class="bspnlive-section-title">📋 SEASON BY THE NUMBERS</div>
    <div class="bspnlive-numbers-grid">
      ${bn.biggestBlowout ? `<div class="bspnlive-number-card">
        <div class="bspnlive-number-label">BIGGEST BLOWOUT</div>
        <div class="bspnlive-number-val">${bn.biggestBlowout.margin}-pt</div>
        <div class="bspnlive-number-sub">${tAbbr(bn.biggestBlowout.homeId)} ${bn.biggestBlowout.homeScore} — ${tAbbr(bn.biggestBlowout.awayId)} ${bn.biggestBlowout.awayScore} · W${bn.biggestBlowout.week}</div>
      </div>` : ""}
      ${bn.closestGame ? `<div class="bspnlive-number-card">
        <div class="bspnlive-number-label">CLOSEST GAME</div>
        <div class="bspnlive-number-val">${bn.closestGame.margin}-pt</div>
        <div class="bspnlive-number-sub">${tAbbr(bn.closestGame.homeId)} ${bn.closestGame.homeScore} — ${tAbbr(bn.closestGame.awayId)} ${bn.closestGame.awayScore} · W${bn.closestGame.week}</div>
      </div>` : ""}
      ${bn.highestScoring ? `<div class="bspnlive-number-card">
        <div class="bspnlive-number-label">HIGHEST SCORING</div>
        <div class="bspnlive-number-val">${bn.highestScoring.total} pts</div>
        <div class="bspnlive-number-sub">${tAbbr(bn.highestScoring.homeId)} ${bn.highestScoring.homeScore} — ${tAbbr(bn.highestScoring.awayId)} ${bn.highestScoring.awayScore} · W${bn.highestScoring.week}</div>
      </div>` : ""}
      ${bn.mostPointsTeam ? `<div class="bspnlive-number-card">
        <div class="bspnlive-number-label">MOST POINTS SCORED</div>
        <div class="bspnlive-number-val">${bn.mostPointsTeam.pts}</div>
        <div class="bspnlive-number-sub">${tName(bn.mostPointsTeam.teamId)}</div>
      </div>` : ""}
      ${bn.bestRecord ? `<div class="bspnlive-number-card">
        <div class="bspnlive-number-label">BEST RECORD</div>
        <div class="bspnlive-number-val">${bn.bestRecord.w}-${bn.bestRecord.l}</div>
        <div class="bspnlive-number-sub">${tName(bn.bestRecord.teamId)}</div>
      </div>` : ""}
      ${bn.worstRecord ? `<div class="bspnlive-number-card">
        <div class="bspnlive-number-label">WORST RECORD</div>
        <div class="bspnlive-number-val">${bn.worstRecord.w}-${bn.worstRecord.l}</div>
        <div class="bspnlive-number-sub">${tName(bn.worstRecord.teamId)}</div>
      </div>` : ""}
    </div>` : "";

  const hofRows = (latest.hofClass || []).map(r => `
    <div class="bspnlive-hof-row" style="border-left-color:${r.teamPrimary}">
      <div class="bspnlive-hof-trophy">🏛</div>
      <div class="bspnlive-hof-body">
        <div class="bspnlive-hof-name">${link(r)} <span style="color:var(--blgray);font-size:.65rem">(${r.pos})</span></div>
        <div class="bspnlive-hof-meta">${r.teamName} · ${r.careerYears} season${r.careerYears===1?"":"s"} · Age ${r.age}${r.careerEarnings ? ` · $${r.careerEarnings}M career` : ""}</div>
        ${r.line ? `<div class="bspnlive-hof-line">${r.line}</div>` : ""}
      </div>
    </div>`).join("");
  const otherRetirees = (latest.retirees || []).filter(r => !r.isHof);
  const retireeRows = otherRetirees.map(r => `
    <div class="bspnlive-retiree-row" style="border-left-color:${r.teamPrimary}">
      <div class="bspnlive-retiree-name">${link(r)} <span style="color:var(--blgray);font-size:.65rem">(${r.pos})</span></div>
      <div class="bspnlive-retiree-meta">${r.teamAbbr} · Age ${r.age} · ${r.careerYears}yr</div>
    </div>`).join("");
  const retirementSection = (latest.hofClass?.length || otherRetirees.length) ? `
    <div class="bspnlive-section-title">🏛 RETIREMENTS &amp; HALL OF FAME</div>
    ${hofRows ? `<div class="bspnlive-hof-grid">${hofRows}</div>` : ""}
    ${retireeRows ? `<div style="margin-top:.6rem"><div class="bspnlive-allpro-title" style="margin-bottom:.4rem">CALLING IT A CAREER</div><div class="bspnlive-retiree-grid">${retireeRows}</div></div>` : ""}
  ` : "";

  const topHL = [...(seasonHighlights || [])]
    .sort((a, b) => b.weight - a.weight).slice(0, 6);
  const hlSection = topHL.length ? `
    <div class="bspnlive-section-title">⭐ SEASON HIGHLIGHTS</div>
    <div class="bspnlive-highlights-grid">
      ${topHL.map(h => {
        const hT = getTeam(h.homeId), aT = getTeam(h.awayId);
        return `<div class="bspnlive-highlight-row">
          <span class="bspnlive-highlight-week">${h.week}</span>
          <span class="bspnlive-highlight-teams">${hT?.name || "?"} vs ${aT?.name || "?"}</span>
          <span class="bspnlive-highlight-label">${h.label}${h.isClutch ? ` <span style="color:#b07a00;font-size:.6rem">⚡CLUTCH</span>` : ""}</span>
        </div>`;
      }).join("")}
    </div>` : "";

  // Records broken this season (single-game + single-season).
  const broken = _recordsBrokenThisSeason();
  const recordsBrokenSection = broken.length ? `
    <div class="bspnlive-section-title">📖 RECORDS BROKEN</div>
    <div class="bspnlive-broken-grid">
      ${broken.slice(0, 10).map(b => {
        const t = b["new"]?.teamId ? getTeam(b["new"].teamId) : null;
        const oldT = b.broken?.teamId ? getTeam(b.broken.teamId) : null;
        const stripe = t?.primary || "#b07a00";
        return `<div class="bspnlive-broken-row" style="border-left-color:${stripe}">
          <div class="bspnlive-broken-head">
            <span class="bspnlive-broken-scope">${b.recordType === "single-game" ? "SINGLE-GAME" : "SINGLE-SEASON"}</span>
            <span class="bspnlive-broken-cat">${b.label}</span>
          </div>
          <div class="bspnlive-broken-new">
            <b style="color:var(--blgold);font-size:1.1rem;font-family:'Bebas Neue','Anton',sans-serif;letter-spacing:1px">${b["new"].value}</b>
            ${playerLinkByName(b["new"].playerName)}
            <span style="color:var(--blgray);font-size:.65rem">(${b["new"].pos}${t ? " · " + _bspnLiveAbbr(t) : ""})</span>
          </div>
          ${b.broken && b.broken.playerName ? `<div class="bspnlive-broken-old">
            <span style="color:var(--blgray);font-size:.62rem">prev: <b>${b.broken.value}</b> · ${b.broken.playerName} · S${b.broken.season}${oldT ? " · " + _bspnLiveAbbr(oldT) : ""}</span>
          </div>` : ""}
        </div>`;
      }).join("")}
    </div>` : "";

  const histSection = history.length > 1 ? `
    <div class="bspnlive-section-title">📚 FRANCHISE HISTORY</div>
    <div class="bspnlive-history-list">
      ${history.slice(-8).reverse().map(h => `
        <div class="bspnlive-history-row">
          <span class="bspnlive-history-season">S${h.season}</span>
          <span class="bspnlive-history-champ">🏆 ${h.championName}</span>
          ${h.leagueMVP ? `<span class="bspnlive-history-mvp">MVP ${link(h.leagueMVP)}</span>` : ""}
          ${h.superBowlMVP ? `<span class="bspnlive-history-mvp">SB MVP ${link(h.superBowlMVP)}</span>` : ""}
        </div>`).join("")}
    </div>` : "";

  const apbReady = !franchise.allProBowlTournament;
  const apbInProgress = franchise.allProBowlTournament && !franchise.allProBowlTournament.complete;
  const apbDone  = franchise.allProBowlTournament?.complete;
  const actionFooter = `
    <div class="bspnlive-awards-footer">
      ${apbReady ? `<button class="bspnlive-btn-gold" onclick="frnStartAllProBowl()">🏟 BEGIN ALL-PRO BOWL TOURNAMENT</button>` : ""}
      ${apbInProgress ? `<button class="bspnlive-btn-gold" onclick="renderAllProBowl()">🏟 CONTINUE ALL-PRO BOWL</button>` : ""}
      ${apbDone  ? `<button class="bspnlive-btn-outline" onclick="renderAllProBowl()">🏆 VIEW ALL-PRO BOWL RESULTS</button>` : ""}
      <button class="bspnlive-btn-gold" onclick="startFrnOffseason()">⏭ Begin Offseason</button>
      <button class="bspnlive-btn-outline" onclick="frnAbandon()" style="color:#a02020">× Abandon</button>
    </div>`;

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1.2rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">AWARDS CEREMONY · SEASON ${season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("AWARDS")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
      </div>
      <div class="bspnlive-awards-body">
        ${championHero}
        ${mvpHero}
        <div class="bspnlive-section-title">🏅 SEASON AWARDS</div>
        ${majorAwards}
        ${potySection}
        ${allProSection}
        ${leadersSection}
        ${numbersSection}
        ${recordsBrokenSection}
        ${retirementSection}
        ${hlSection}
        ${histSection}
        ${actionFooter}
      </div>
    </div>`;
}

// ── Offseason ─────────────────────────────────────────────────────────────────
function startFrnOffseason() {
  // Stash All-Pro Bowl result onto history (if complete) before clearing
  // the tournament from active state. Incomplete tournaments are dropped.
  if (franchise.allProBowlTournament?.complete) {
    const t = franchise.allProBowlTournament;
    const champ = t.teams.find(x => x.id === t.champion);
    const runnerUp = t.teams.find(x => x.id === t.runnerUp);
    const hist = franchise.history[franchise.history.length - 1];
    if (hist) {
      hist.allProBowl = {
        champion: champ ? { confDiv: champ.confDiv, primary: champ.primary } : null,
        runnerUp: runnerUp ? { confDiv: runnerUp.confDiv, primary: runnerUp.primary } : null,
        mvp: t.mvp,
      };
    }
  }
  franchise.allProBowlTournament = null;
  // Roll contract years down for all players
  for (const roster of Object.values(franchise.rosters)) {
    for (const p of roster) {
      if (p.contract && p.contract.remaining > 0) {
        p.contract.remaining -= 1;
        if (p.contract.guaranteedYears > 0) p.contract.guaranteedYears -= 1;
      }
    }
  }
  // Salary-refund obligations also tick down; clear expired ones
  for (const r of (franchise.refunds || [])) {
    if (r.yearsRemaining > 0) r.yearsRemaining -= 1;
  }
  franchise.refunds = (franchise.refunds || []).filter(r => r.yearsRemaining > 0);
  // Cap inflation: 5-9% per season (mean ~7%)
  const growth = 0.05 + Math.random() * 0.04;
  franchise.salaryCap = Math.round(
    ((franchise.salaryCap || SALARY_CAP_BASE) * (1 + growth)) * 10
  ) / 10;
  // Detect unhappy stars on the user's roster — they'll demand extensions
  // at the offseason summary screen.
  _detectHoldouts();
  franchise.phase = "offseason";
  franchise._resignPending = null;
  saveFranchise();
  renderFrnResignings();
}

// ── Holdouts ──────────────────────────────────────────────────────────────────
// A star (grade A or higher) with multiple years left whose AAV is well
// below current market value will demand a new deal in the offseason.
// Three resolutions: Extend (pay market), Trade (move them), Ignore
// (risk a hold-out next season — player auto-leaves at contract end).
function _detectHoldouts() {
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const myRoster = franchise.rosters[franchise.chosenTeamId] || [];
  const holdouts = [];
  for (const p of myRoster) {
    const grade = scoutGrade(p);
    if (grade < 82) continue;                 // only A-grades+
    if (!p.contract || p.contract.remaining < 2) continue; // walk-year not a holdout
    const market = computeMarketValue(p, cap);
    const aav = p.contract.aav || 0;
    if (aav >= market * 0.85) continue;       // fairly paid
    holdouts.push({
      name: p.name, position: p.position,
      currentAAV: aav, demandedAAV: Math.round(market * 10) / 10,
      demandedYears: Math.max(p.contract.remaining + 2, 4),
      resolved: null,
    });
  }
  franchise._holdouts = holdouts;
}

function frnHoldoutExtend(name) {
  const h = (franchise._holdouts || []).find(x => x.name === name);
  if (!h) return;
  const player = franchise.rosters[franchise.chosenTeamId].find(p => p.name === name);
  if (!player) return;
  player.contract = {
    years: h.demandedYears,
    remaining: h.demandedYears,
    aav: h.demandedAAV,
  };
  h.resolved = "extended";
  saveFranchise();
  renderFrnOffseason();
}

function frnHoldoutTrade(name) {
  const h = (franchise._holdouts || []).find(x => x.name === name);
  if (!h) return;
  h.resolved = "trade-block";
  // Open the trade screen with this player pre-flagged
  franchise._tradeProp = {
    targetTeamId: TEAMS.find(t => t.id !== franchise.chosenTeamId).id,
    youSend: [name],
    youReceive: [],
    result: null,
  };
  saveFranchise();
  renderFrnTrade();
}

function frnHoldoutIgnore(name) {
  const h = (franchise._holdouts || []).find(x => x.name === name);
  if (!h) return;
  h.resolved = "ignored";
  // Mark player as flight risk — they leave when contract ends (or sooner)
  const player = franchise.rosters[franchise.chosenTeamId].find(p => p.name === name);
  if (player) player.unhappy = true;
  saveFranchise();
  renderFrnOffseason();
}

function runFrnOffseason() {
  const changes  = [];
  const allNames = new Set();
  for (const r of Object.values(franchise.rosters)) r.forEach(p => allNames.add(p.name));

  for (const t of TEAMS) {
    const tId   = t.id;
    const roster = franchise.rosters[tId] || [];
    const keep   = [];
    const localNames = new Set(allNames);

    for (const p of roster) {
      // Age + retirement now happen at the awards-ceremony step so the
      // ceremony can honor retirees + HoF inductees. By the time we reach
      // here the roster has already been pruned. We still need a snapshot
      // for dev-swing wire alerts.
      if (p.age == null) {
        p.age = (p.overall >= 85 ? 27 : p.overall >= 75 ? 24 : 22) + Math.floor(Math.random() * 6);
      }
      const preOvr = p.overall;
      // Age has already been bumped in _processSeasonEndRetirements;
      // last-season's age is p.age - 1.
      const preDeclineHit = ((p.age - 1) >= (p.declineAge ?? Infinity));

      // Each player has a personal decline age. Drawn from a normal
      // distribution (mean 30, std 2) with no hard ceiling — typical
      // players fall off in 28-32, but iron-man outliers can hang on
      // way later (P[≥38] ≈ 1 in 30k, ≥40 ≈ 1 in 3.5M).
      if (p.declineAge == null) {
        let u1 = Math.random(); if (u1 < 1e-10) u1 = 1e-10;
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
        p.declineAge = Math.max(25, Math.round(30 + 2 * z));
      }
      if (p.age >= p.declineAge) {
        const yearsPast = p.age - p.declineAge;
        const regress   = 1 + Math.floor(yearsPast / 2); // 1, 1, 2, 2, 3, 3, ...
        p.stats[0] = Math.max(30, p.stats[0] - regress); // SPD
        p.stats[2] = Math.max(30, p.stats[2] - regress); // AGI
        // 50% chance to also chip STR/AWR for deeper veterans
        if (yearsPast >= 2 && Math.random() < 0.5) {
          p.stats[1] = Math.max(30, p.stats[1] - 1); // STR
        }
        p.overall = Math.max(50, p.overall - (regress >= 2 ? 2 : 1));
      }
      // Young progression: grow toward potential ceiling each offseason.
      // Hidden gems use a flat per-season rate toward their true ceiling;
      // normal players use the age-weighted percentage-of-gap approach.
      if (p.potential == null) p.potential = _rollPotential(p);
      const coachBoost = (franchise.coaches?.[tId]?.hc?.trait === "Player Developer") ? 1.35 : 1.0;

      // Resolve gem ceiling — remove flag once reached
      if (p.hiddenGem && p.overall >= p.hiddenGem.ceiling) delete p.hiddenGem;

      if (p.hiddenGem && p.age <= 28) {
        // Hidden gem path: steady flat growth, independent of the normal
        // potential system. Potential is raised to reflect the true ceiling
        // so the UI (if it ever shows potential) stays consistent.
        p.potential = Math.max(p.potential, p.hiddenGem.ceiling);
        const growth = Math.max(0, Math.min(
          p.hiddenGem.ceiling - p.overall,
          Math.round(p.hiddenGem.growthRate * coachBoost)
        ));
        if (growth > 0) {
          p.overall = Math.min(p.hiddenGem.ceiling, p.overall + growth);
          const k1 = Math.floor(Math.random() * p.stats.length);
          const k2 = Math.floor(Math.random() * p.stats.length);
          p.stats[k1] = Math.min(99, p.stats[k1] + Math.ceil(growth * 0.6));
          p.stats[k2] = Math.min(99, p.stats[k2] + Math.floor(growth * 0.4));
        }
        if (p.overall >= p.hiddenGem.ceiling) delete p.hiddenGem;
      } else if (!p.hiddenGem) {
        // Normal potential-based development
        const gap = p.potential - p.overall;
        if (gap > 0 && p.age <= 27) {
          const baseRate = p.age <= 22 ? 0.45 : p.age <= 24 ? 0.30 : p.age <= 26 ? 0.15 : 0.06;
          const growth = Math.max(0, Math.round(gap * baseRate * coachBoost));
          if (growth > 0) {
            p.overall = Math.min(99, p.overall + growth);
            const k1 = Math.floor(Math.random() * p.stats.length);
            const k2 = Math.floor(Math.random() * p.stats.length);
            p.stats[k1] = Math.min(99, p.stats[k1] + Math.ceil(growth * 0.6));
            p.stats[k2] = Math.min(99, p.stats[k2] + Math.floor(growth * 0.4));
          }
        }
      }

      // Wire alerts for dev swings. Hybrid framing — your own players
      // get explicit OVR numbers (you have full info); other teams'
      // players surface only as noisy scout-grade changes, keeping the
      // fog-of-war intact.
      const delta = p.overall - preOvr;
      const isMine = (tId === Number(franchise.chosenTeamId));
      const team = getTeam(tId);
      const teamName = team ? team.name : "";
      const justHitCliff = !preDeclineHit && p.age >= (p.declineAge ?? Infinity);
      // Filter what's newsworthy on other teams: only stars or large drops.
      const otherTeamWorthy = !isMine && (p.overall >= 80 || delta <= -5 || delta >= 5);
      if (delta >= 3 && (isMine || otherTeamWorthy)) {
        if (isMine) {
          _pushNews({ type:"breakout",
            label: `🚀 BREAKOUT: ${p.position} ${p.name} (${preOvr} → ${p.overall} OVR) — your roster got stronger` });
        } else {
          const gradeNow = gradeLabel(scoutGrade(p));
          _pushNews({ type:"breakout",
            label: `🚀 ${teamName} ${p.position} ${p.name} grading up to ${gradeNow} — breakout season expected` });
        }
      } else if (delta <= -3 && (isMine || otherTeamWorthy)) {
        if (isMine) {
          _pushNews({ type:"decline",
            label: `📉 DECLINE: ${p.position} ${p.name} (${preOvr} → ${p.overall} OVR)` });
        } else {
          const gradeNow = gradeLabel(scoutGrade(p));
          _pushNews({ type:"decline",
            label: `📉 ${teamName} ${p.position} ${p.name} grading down to ${gradeNow}` });
        }
      }
      if (justHitCliff && (isMine || p.overall >= 80)) {
        if (isMine) {
          _pushNews({ type:"age_cliff",
            label: `⏳ ${p.position} ${p.name} (age ${p.age}) starting to slow down — keep an eye on his snaps` });
        } else {
          _pushNews({ type:"age_cliff",
            label: `⏳ ${teamName} ${p.position} ${p.name} reportedly losing a step at ${p.age}` });
        }
      }

      keep.push(p);
    }

    // Rookie filling now happens via the annual draft phase + UDFA fill.
    // AI teams: auto-resign expired players at market rate (stars more likely to stay)
    if (tId !== franchise.chosenTeamId) {
      const aiCoachTrait = franchise.coaches?.[tId]?.hc?.trait;
      const stayBoost = aiCoachTrait === "Players' Coach" ? 0.15 : 0;
      for (const p of keep) {
        if (p.contract && p.contract.remaining <= 0) {
          let stayProb = p.overall >= 85 ? 0.85 : p.overall >= 75 ? 0.70 : 0.55;
          stayProb = Math.min(0.98, stayProb + stayBoost);
          if (Math.random() < stayProb) {
            p.contract = generateContract(p, franchise.salaryCap || SALARY_CAP_BASE);
          } else {
            // Declined — give a minimum deal so they don't disappear
            p.contract = { years: 1, remaining: 1, aav: 0.5 };
          }
        }
      }
    }

    franchise.rosters[tId] = keep;
  }
  return changes;
}

function renderFrnOffseason() {
  const { season, chosenTeamId, _offChanges, salaryCap } = franchise;
  const myTeam   = getTeam(chosenTeamId);
  const myChg    = (_offChanges || []).filter(c => c.tId === chosenTeamId);
  const retires  = myChg.filter(c => c.type === "retire");
  const rookies  = myChg.filter(c => c.type === "rookie");
  const cap      = salaryCap || SALARY_CAP_BASE;
  const capUsed  = capUsedByTeam(chosenTeamId);

  let chgHtml = "";
  if (retires.length) {
    chgHtml += `<div style="color:#ff9090;font-weight:700;margin-top:.4rem">Retirements (${retires.length})</div>`;
    chgHtml += retires.map(c => `<div class="frn-off-change retire">— ${c.name} (${c.pos}, age ${c.age})</div>`).join("");
  }
  if (rookies.length) {
    chgHtml += `<div style="color:#90ff90;font-weight:700;margin-top:.4rem">Rookies Signed (${rookies.length})</div>`;
    chgHtml += rookies.map(c => `<div class="frn-off-change rookie">+ ${c.name} (${c.pos})</div>`).join("");
  }
  if (!chgHtml) chgHtml = `<div style="color:var(--gray)">No major roster changes this offseason.</div>`;

  $("frnHomeContent").innerHTML = `
    <div style="text-align:center;margin-bottom:.75rem">
      <div style="font-size:1.1rem;font-weight:700;color:var(--gold)">Season ${season} — Offseason</div>
      <div style="color:var(--gray);font-size:.78rem">${myTeam.city} ${myTeam.name}</div>
      <div style="font-size:.72rem;margin-top:.3rem;color:var(--gray)">
        New cap: <b style="color:var(--gold)">$${cap.toFixed(0)}M</b>
        · Used: <b style="color:var(--white)">$${capUsed.toFixed(1)}M</b>
        · Room: <b style="color:${cap-capUsed<0?"var(--red)":"var(--green-lt)"}">$${(cap-capUsed).toFixed(1)}M</b>
        <button class="frn-cap-btn" onclick="renderFrnAnalytics('mysheet')" style="margin-left:.5rem">📊 View Cap</button>
      </div>
    </div>
    <div class="frn-sec-title">${myTeam.name} Roster Changes</div>
    <div class="frn-off-list">${chgHtml}</div>
    ${_renderHoldoutsBlock()}
    <div class="frn-actions" style="justify-content:center;margin-top:1.2rem">
      <button class="btn btn-gold" onclick="frnGoToDraft()">📋 Go to Draft</button>
      <button class="btn btn-outline" onclick="frnAbandon()" style="color:var(--red)">× Abandon</button>
    </div>`;
}

function _renderHoldoutsBlock() {
  const list = franchise._holdouts || [];
  if (!list.length) return "";
  const myRoster = franchise.rosters[franchise.chosenTeamId] || [];
  const rows = list.map(h => {
    const live = myRoster.find(p => p.name === h.name);
    const ovr = live?.overall ?? h.overall ?? "?";
    const statLine = (() => { const agg = _playerSeasonStatsAgg(h.name); return agg ? mvpStatLine(agg) : ""; })();
    const escName = (h.name||"").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    if (h.resolved === "extended") {
      return `<div class="frn-resign-row accepted">
        <div class="frn-resign-info">
          <span style="font-weight:700;color:var(--white)">${h.name}</span>
          <span style="color:var(--gray);font-size:.7rem">${h.position} · ${ovr} OVR</span>
        </div>
        <div class="frn-resign-offer"><span style="color:var(--green-lt)">✓ Extended $${h.demandedAAV.toFixed(1)}M × ${h.demandedYears}yr</span></div>
      </div>`;
    }
    if (h.resolved === "ignored") {
      return `<div class="frn-resign-row declined">
        <div class="frn-resign-info">
          <span style="font-weight:700;color:var(--white)">${h.name}</span>
          <span style="color:var(--gray);font-size:.7rem">${h.position} · ${ovr} OVR</span>
        </div>
        <div class="frn-resign-offer"><span style="color:#e8a000">⚠ Ignored — flight risk</span></div>
      </div>`;
    }
    const cap = franchise.salaryCap || SALARY_CAP_BASE;
    const marketVal = live ? computeMarketValue(live, cap) : h.demandedAAV;
    const raise = h.demandedAAV - h.currentAAV;
    const demandVsMarket = h.demandedAAV - marketVal;
    const demandColor = demandVsMarket > 2 ? "var(--red)" : demandVsMarket < -1 ? "var(--green-lt)" : "var(--gold)";
    const trend = _ovrTrend(live);
    const trendHtml = trend == null ? "" : trend > 0
      ? `<span style="color:var(--green-lt);font-size:.6rem">↑ +${trend}</span>`
      : trend < 0 ? `<span style="color:var(--red);font-size:.6rem">↓ ${trend}</span>`
      : `<span style="color:var(--gray);font-size:.6rem">→</span>`;
    const curve = _ageCurveWarning(live?.age, h.demandedYears);
    const curveHtml = curve.label ? `<span style="color:${curve.level==="danger"?"var(--red)":"#e8a000"};font-size:.58rem">${curve.label}</span>` : "";
    const depth = _posDepth(h.position, h.name);
    const yrs = _yearsWithTeam(h.name);
    const faMkt = _faMktDepth(h.position);
    return `<div class="frn-resign-row">
      <div class="frn-resign-info">
        <span style="font-weight:700;color:var(--white)">${h.name}</span>
        <span style="color:var(--gray);font-size:.7rem">${h.position} · ${ovr} OVR ${trendHtml} · Age ${live?.age ?? "?"}</span>
        ${statLine ? `<span style="color:var(--gray);font-size:.6rem;font-style:italic">${statLine}</span>` : ""}
        ${_contractContextBar(h.position, marketVal, cap)}
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.15rem">
          <span style="font-size:.58rem;color:var(--gray)">${depth} other ${h.position}s ≥75 OVR</span>
          ${yrs >= 1 ? `<span style="font-size:.58rem;color:var(--gray)"> · ${yrs}-yr veteran</span>` : ""}
          ${faMkt > 0 ? `<span style="font-size:.58rem;color:var(--gray)"> · ${faMkt} FA${h.position}s available</span>` : ""}
        </div>
      </div>
      <div class="frn-resign-offer">
        <span style="color:${demandColor};font-weight:700">$${h.demandedAAV.toFixed(1)}M/yr × ${h.demandedYears}yr</span>
        <span style="color:var(--gray);font-size:.6rem">Currently $${h.currentAAV.toFixed(1)}M · +$${raise.toFixed(1)}M raise</span>
        <span style="color:var(--gray);font-size:.6rem">Total $${(h.demandedAAV * h.demandedYears).toFixed(1)}M · ${demandVsMarket > 1 ? `<span style="color:var(--red)">+$${demandVsMarket.toFixed(1)}M above mkt</span>` : demandVsMarket < -1 ? `<span style="color:var(--green-lt)">$${Math.abs(demandVsMarket).toFixed(1)}M below mkt</span>` : `<span style="color:var(--gray)">≈ market</span>`}</span>
        ${curveHtml}
      </div>
      <div class="frn-resign-btns">
        <button class="btn frn-resign-btn accept-btn" onclick="frnHoldoutExtend('${escName}')">✓ Extend</button>
        <button class="btn frn-resign-btn" onclick="frnHoldoutTrade('${escName}')" style="border-color:var(--gold);color:var(--gold)">🔀 Trade</button>
        <button class="btn frn-resign-btn decline-btn" onclick="frnHoldoutIgnore('${escName}')">✗ Ignore</button>
      </div>
    </div>`;
  }).join("");
  return `
    <div class="frn-sec-title" style="margin-top:1rem">🗣 CONTRACT DEMANDS (${list.length})</div>
    <div style="color:var(--gray);font-size:.68rem;margin-bottom:.4rem">Underpaid stars demanding extensions — same buttons, same style as re-signings.</div>
    <div class="frn-resign-list">${rows}</div>`;
}

// ── New season ────────────────────────────────────────────────────────────────
function frnNewSeason() {
  // Before wiping season stats, roll them into each player's career
  _rollSeasonStatsToCareer();
  franchise.season       += 1;
  franchise.week          = 1;
  franchise.phase         = "free_agency";
  franchise.schedule      = generateFranchiseSchedule();
  franchise.standings     = initStandings();
  franchise.playoffBracket = null;
  franchise.pendingFranchiseGame = null;
  franchise._offChanges   = null;
  franchise.seasonStats   = {};
  franchise.seasonHighlights = [];
  franchise.superBowlGame = null;
  franchise.faNegotiations = {};
  franchise._faLastNews   = null;
  franchise.capGraceDeadline = null;
  // Each new season starts with a fresh FA pool
  franchise.freeAgents = _generateFAPool();
  franchise._faOffers = {};
  franchise._faResults = null;
  saveFranchise();
  showFranchiseDashboard();
}

// ── Draft picks (tradeable) ──────────────────────────────────────────────────
// Each team starts with their own 7 picks for the next 3 future drafts.
// Trades move currentOwnerId; the originalTeamId still controls the slot
// within the round (based on that team's next regular-season finish).
function _initFranchisePicks() {
  franchise.picks = [];
  const draftYearBase = (new Date().getFullYear()) + (franchise.season || 1);
  for (let yr = draftYearBase; yr < draftYearBase + 3; yr++) {
    for (const t of TEAMS) {
      for (let r = 1; r <= 7; r++) {
        franchise.picks.push({
          year: yr, round: r,
          originalTeamId: t.id,
          currentOwnerId: t.id,
        });
      }
    }
  }
}

function _ensurePicksForYear(year) {
  if (!franchise.picks) franchise.picks = [];
  const has = franchise.picks.some(p => p.year === year);
  if (has) return;
  for (const t of TEAMS) {
    for (let r = 1; r <= 7; r++) {
      franchise.picks.push({
        year, round: r,
        originalTeamId: t.id,
        currentOwnerId: t.id,
      });
    }
  }
}

// Rough trade-value of an UNREALIZED pick (before draft order is set).
// Round 1 expected value is the average of the 32 round-1 prospects.
const PICK_VALUE_BY_ROUND = { 1: 32, 2: 16, 3: 9, 4: 5, 5: 3, 6: 2, 7: 1.5 };
function _pickValue(pick) {
  return PICK_VALUE_BY_ROUND[pick.round] || 1;
}

function _teamPicks(teamId) {
  return (franchise.picks || []).filter(p => p.currentOwnerId === teamId);
}
function _teamPicksByYear(teamId) {
  const by = {};
  for (const p of _teamPicks(teamId)) (by[p.year] ||= []).push(p);
  return by;
}

// ── Trades ─────────────────────────────────────────────────────────────────────
// Player-for-player(s) trades. Trade deadline = Week 7. AI accepts if
// you give them >= what they give you, weighted by team need at the
// positions involved.
const TRADE_DEADLINE_WEEK = 7;

function _playerTradeValue(p) {
  const ovr = p.overall || 60;
  let v = Math.max(0, ovr - 50);
  const age = p.age || 25;
  if (age <= 25)      v *= 1.10;
  else if (age >= 32) v *= 0.65;
  else if (age >= 29) v *= 0.85;
  if (p.injury && p.injury.weeksRemaining > 0) v *= 0.4;
  return Math.round(v * 10) / 10;
}

function _aiTradeNeedBonus(teamId, players) {
  if (!players.length) return 0;
  const roster = franchise.rosters[teamId] || [];
  let bonus = 0;
  for (const p of players) {
    const same = roster.filter(rp => rp.position === p.position).sort((a,b)=>b.overall-a.overall);
    const bestSame = same[0]?.overall || 50;
    if (p.overall > bestSame + 3) bonus += (p.overall - bestSame) * 0.5;
  }
  return bonus;
}

function frnOpenTrade(targetTeamId, tab) {
  if (franchise.week > TRADE_DEADLINE_WEEK && franchise.phase === "regular") {
    alert("Trade deadline has passed.");
    return;
  }
  // null/"" → browse mode (no partner locked). A real team id → lock it.
  const wantsBrowse = (targetTeamId === null || targetTeamId === "" || targetTeamId === undefined);
  const fresh = () => ({
    youSend: [], youReceive: [],
    picksSend: [], picksReceive: [],
    theirAbsorb: 0,
    yourAbsorb:  0,
    result: null,
  });
  if (!franchise._tradeProp) {
    franchise._tradeProp = {
      targetTeamId: wantsBrowse ? null : Number(targetTeamId),
      ...fresh(),
      tab: tab || "propose",
      sortBy: "grade",
      posFilter: "ALL",
    };
  } else if (!wantsBrowse) {
    franchise._tradeProp.targetTeamId = Number(targetTeamId);
    Object.assign(franchise._tradeProp, fresh());
  } else if (wantsBrowse && targetTeamId !== undefined) {
    franchise._tradeProp.targetTeamId = null;
    Object.assign(franchise._tradeProp, fresh());
  }
  // Backfill new fields for older saves with a half-built proposal
  const tp = franchise._tradeProp;
  tp.picksSend    ||= []; tp.picksReceive ||= [];
  tp.theirAbsorb ??= 0;
  tp.yourAbsorb  ??= 0;
  if (tab) franchise._tradeProp.tab = tab;
  saveFranchise();
  renderFrnTrade();
}

function frnSetTradeSort(by) {
  if (!franchise._tradeProp) return;
  franchise._tradeProp.sortBy = by;
  saveFranchise();
  renderFrnTrade();
}

// ── Trade Block (mark for trade) ─────────────────────────────────────────────
function frnToggleBlock(name) {
  const myRoster = franchise.rosters[franchise.chosenTeamId];
  const p = myRoster.find(rp => rp.name === name);
  if (!p) return;
  p.onTradeBlock = !p.onTradeBlock;
  if (!p.onTradeBlock) delete p.blockAsk;
  // No immediate offers — other owners can't see the listing until the
  // week wraps up. Offers roll in during _runWeekEndResolution when the
  // user clicks "Advance to Week N+1".
  saveFranchise();
  renderFrnTrade();
}

// Open the asking-price form for a blocked player. Stores the target
// team in the trade prop so the form can be populated.
function frnEditAsk(playerName) {
  if (!franchise._tradeProp) franchise._tradeProp = { tab:"block", sortBy:"grade", youSend:[], youReceive:[] };
  const player = franchise.rosters[franchise.chosenTeamId].find(p => p.name === playerName);
  if (!player) return;
  if (!player.onTradeBlock) player.onTradeBlock = true;
  franchise._tradeProp.editAsk = playerName;
  const existing = player.blockAsk;
  franchise._tradeProp.askDraft = {
    // Generic price tag — picks by round (year defaults to next draft),
    // cash flowing either direction, optional player-grade min.
    askedPicks:  { ...(existing?.askedPicks || {}) },
    refundAmount: existing?.refund?.amount || 0,
    refundYears:  existing?.refund?.years  || 0,
    refundDirection: existing?.refund?.direction || "theyPay",
    minPlayerGrade: existing?.minPlayerGrade || "",
  };
  saveFranchise();
  renderFrnTrade();
}

function frnCancelAsk() {
  if (franchise._tradeProp) {
    delete franchise._tradeProp.editAsk;
    delete franchise._tradeProp.askDraft;
  }
  saveFranchise();
  renderFrnTrade();
}

function frnAskSetPicks(round, count) {
  const ad = franchise._tradeProp?.askDraft;
  if (!ad) return;
  ad.askedPicks = ad.askedPicks || {};
  const n = Math.max(0, Math.min(5, parseInt(count, 10) || 0));
  if (n === 0) delete ad.askedPicks[round];
  else ad.askedPicks[round] = n;
  saveFranchise();
  renderFrnTrade();
}

function frnAskSetMinGrade(value) {
  const ad = franchise._tradeProp?.askDraft;
  if (!ad) return;
  ad.minPlayerGrade = value || "";
  saveFranchise();
  renderFrnTrade();
}

function frnAskSetRefund(field, value) {
  const ad = franchise._tradeProp?.askDraft;
  if (!ad) return;
  if (field === "amount") ad.refundAmount = Math.max(0, parseFloat(value) || 0);
  if (field === "years")  ad.refundYears  = Math.max(0, Math.min(10, parseInt(value, 10) || 0));
  if (field === "direction") ad.refundDirection = value === "theyPay" ? "theyPay" : "youPay";
  saveFranchise();
  renderFrnTrade();
}

function frnSubmitAsk() {
  const tp = franchise._tradeProp;
  if (!tp?.editAsk || !tp?.askDraft) return;
  const ad = tp.askDraft;
  const totalPicks = Object.values(ad.askedPicks || {}).reduce((s,n) => s + n, 0);
  const cashTotal = (ad.refundAmount || 0) * (ad.refundYears || 0);
  if (totalPicks === 0 && cashTotal === 0 && !ad.minPlayerGrade) {
    alert("Set an asking price: picks, cash, or a player-grade minimum.");
    return;
  }
  const player = franchise.rosters[franchise.chosenTeamId].find(p => p.name === tp.editAsk);
  if (!player) return;
  player.onTradeBlock = true;
  const refund = (ad.refundAmount > 0 && ad.refundYears > 0)
    ? { amount: ad.refundAmount, years: ad.refundYears, direction: ad.refundDirection || "theyPay" }
    : null;
  player.blockAsk = {
    askedPicks: { ...(ad.askedPicks || {}) },
    refund,
    minPlayerGrade: ad.minPlayerGrade || null,
    listedSeason: franchise.season,
    listedWeek:   franchise.week,
  };
  delete tp.editAsk;
  delete tp.askDraft;
  saveFranchise();
  alert(`✓ Listed ${player.name} on the trade block. Interested teams will respond next week.`);
  renderFrnTrade();
}

// Value of an asking price for grading offers against the player.
// Returns total value units the SENDER would receive.
function _askPriceValue(ask, evaluatorTeamId) {
  if (!ask) return 0;
  let v = 0;
  // Picks the SENDER would gain. Use generic pick value table.
  for (const [round, count] of Object.entries(ask.askedPicks || {})) {
    v += _pickValue({ round: Number(round) }) * count;
  }
  // Cash flow: if direction=theyPay, sender gets +cash. youPay → −cash.
  const refund = ask.refund;
  if (refund && refund.amount > 0 && refund.years > 0) {
    const dir = refund.direction || "theyPay";
    const total = refund.amount * refund.years * 1.5;
    v += (dir === "theyPay" ? total : -total);
  }
  // Minimum player: assume a market-typical grade if provided (rough)
  if (ask.minPlayerGrade) {
    const gradeFloor = _gradeLabelToFloor(ask.minPlayerGrade);
    v += Math.max(0, gradeFloor - 50); // crude
  }
  return v;
}

function _gradeLabelToFloor(label) {
  const map = { "A+":92, "A":87, "A-":82, "B+":77, "B":72, "B-":67, "C+":62, "C":55 };
  return map[label] || 0;
}

// Sealed-bid auction for trade-block listings: when a player goes on
// the block, every interested AI team computes their max willingness
// (player value + position-need bonus). They each submit ONE final
// offer — the most-willing team bids only the minimum needed to beat
// the second-highest, everyone else bids their full willingness. The
// user sees all offers and picks any (preferences may matter more
// than raw value). No additional bidding rounds for that listing
// unless the user rejects every offer and a new week ticks over.
function _processBlockAsks() {
  if (!franchise.tradeOffers) franchise.tradeOffers = [];
  const myId = franchise.chosenTeamId;
  const blocked = (franchise.rosters[myId] || []).filter(p => p.onTradeBlock && p.blockAsk);

  for (const player of blocked) {
    // Only run the auction if no pending offers already exist on this
    // player. If user rejects them all, we'll auction again next week.
    const hasOpen = (franchise.tradeOffers||[])
      .some(o => o.status === "pending" && o.theyWant?.includes(player.name));
    if (hasOpen) continue;

    const askFloor = _askPriceValue(player.blockAsk);
    // Compute willingness for each potentially interested AI team
    const playerVal = _playerTradeValue(player);
    const candidates = TEAMS
      .filter(t => t.id !== myId)
      .map(t => {
        const need = _aiTradeNeedBonus(t.id, [player]);
        const w = playerVal + need;
        return { team: t, willingness: w, need };
      })
      // A team only bids if their willingness can plausibly meet the ask
      .filter(c => c.willingness >= askFloor * 0.85)
      .sort((a,b) => b.willingness - a.willingness)
      .slice(0, 5);

    if (!candidates.length) continue;

    // Most-willing team caps their bid at "second-most + 1". Everyone
    // else bids their full willingness. Ensures the top bid reveals
    // only just enough to beat the next-best, but lower-tier teams
    // still get to put their best foot forward.
    const secondMost = candidates[1]?.willingness || askFloor;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const targetValue = (i === 0)
        ? Math.max(askFloor, Math.min(c.willingness, secondMost + 1))
        : Math.max(askFloor, c.willingness);
      const pkg = _buildBestOfferPackage(c.team.id, player, targetValue);
      if (!pkg) continue;
      // Dedupe per (team, player, week)
      const dup = franchise.tradeOffers.some(o =>
        o.fromTeamId === c.team.id &&
        o.theyWant?.includes(player.name) &&
        o.week === franchise.week);
      if (dup) continue;
      franchise.tradeOffers.push({
        id: `${c.team.id}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        fromTeamId: c.team.id,
        theyGive: pkg.extraPlayerName ? [pkg.extraPlayerName] : [],
        theyWant: [player.name],
        pickIds: pkg.pickIds,
        absorb: pkg.absorb || 0,
        week: franchise.week,
        status: "pending",
        isFromAsk: true,
        bidValue: pkg.totalValue,
      });
    }
  }
}

// Build a near-target-value package from a team's inventory that
// satisfies the player's blockAsk. Returns { pickIds, extraPlayerName,
// refund, totalValue } or null if the team can't even meet the ask.
function _buildBestOfferPackage(teamId, player, targetValue) {
  const ask = player.blockAsk;
  if (!ask) return null;
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const aiRoom = cap - capUsedByTeam(teamId);
  const aiPicks = _teamPicks(teamId);

  // 1. Required picks (latest years first to conserve more-valuable near-year picks)
  const pickIds = [];
  let pickValue = 0;
  for (const [roundStr, count] of Object.entries(ask.askedPicks || {})) {
    const round = Number(roundStr);
    const avail = aiPicks.filter(p =>
      p.round === round && !pickIds.includes(`${p.year}-${p.round}-${p.originalTeamId}`))
      .sort((a,b) => b.year - a.year); // late years first = cheaper
    if (avail.length < count) return null; // can't satisfy
    for (let i = 0; i < count; i++) {
      const p = avail[i];
      pickIds.push(`${p.year}-${p.round}-${p.originalTeamId}`);
      pickValue += _pickValue(p);
    }
  }

  // 2. (Cash / transfer fee removed — absorption is computed internally)
  const cashUnits = 0;

  // 3. Optional grade-min player
  let extraPlayerName = null;
  let extraPlayerValue = 0;
  if (ask.minPlayerGrade) {
    const floor = _gradeLabelToFloor(ask.minPlayerGrade);
    const candidates = (franchise.rosters[teamId] || [])
      .filter(rp => scoutGrade(rp) >= floor && !rp.onTradeBlock)
      .sort((a,b) => scoutGrade(a) - scoutGrade(b)); // cheapest match first
    if (!candidates.length) return null;
    extraPlayerName = candidates[0].name;
    extraPlayerValue = _playerTradeValue(candidates[0]);
  }

  let totalValue = pickValue + cashUnits + extraPlayerValue;

  // 4. Sweeten by absorbing some of the user's dead cap from this trade.
  const userDeadCap = (player.contract?.bonusProration || 0) * (player.contract?.remaining || 0);
  let absorb = 0;
  if (totalValue < targetValue && userDeadCap >= 0.5) {
    const deficit = targetValue - totalValue;
    const sweetAbsorb = Math.min(userDeadCap, Math.max(0, deficit));
    if (sweetAbsorb >= 0.5) {
      absorb = Math.round(sweetAbsorb * 10) / 10;
      totalValue = pickValue + extraPlayerValue + absorb;
    }
  }
  return { pickIds, extraPlayerName, absorb, totalValue };
}

// Run during _runWeekEndResolution: convert queued counters into
// concrete offers in the user's inbox.
function _processPendingCounters() {
  if (!franchise._pendingCounters?.length) return;
  if (!franchise.tradeOffers) franchise.tradeOffers = [];
  const myId = franchise.chosenTeamId;
  for (const c of franchise._pendingCounters) {
    const player = franchise.rosters[myId].find(p => p.name === c.playerName);
    if (!player || !player.onTradeBlock) continue;
    const theirRoster = franchise.rosters[c.fromTeamId];
    if (!theirRoster) continue;
    // AI counter: keep wanting the user's player; offer a player worth
    // ~85% of the user's player (less generous than what user asked for)
    const target = _playerTradeValue(player) * 0.85;
    const candidates = theirRoster
      .map(rp => ({ rp, diff: Math.abs(_playerTradeValue(rp) - target) }))
      .sort((a,b) => a.diff - b.diff);
    const offered = candidates[0]?.rp;
    if (!offered) continue;
    franchise.tradeOffers.push({
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      fromTeamId: c.fromTeamId,
      theyGive: [offered.name],
      theyWant: [player.name],
      week: franchise.week,
      status: "pending",
      isCounter: true,
      counterToAsk: c.askWantNames,
    });
  }
  franchise._pendingCounters = [];
}

// Seed AI teams with 0-2 block listings at start of regular season so
// the trade-block view has activity even before the user lists anyone.
function _seedAITradeBlocks() {
  for (const t of TEAMS) {
    if (t.id === franchise.chosenTeamId) continue;
    const roster = franchise.rosters[t.id] || [];
    // Clear stale flags
    for (const p of roster) p.onTradeBlock = false;
    // Pick 0-2 mid-tier players, weighted toward older guys
    const candidates = roster.filter(p =>
      p.overall >= 70 && p.overall < 86 && (p.age || 25) >= 27
    ).sort(() => Math.random() - 0.5);
    const n = Math.floor(Math.random() * 3);
    for (let i = 0; i < n && i < candidates.length; i++) candidates[i].onTradeBlock = true;
  }
}

// For each player on the user's block (or AI block where AI is shopping
// AT us specifically), AI may submit a trade offer this week. Stored in
// franchise.tradeOffers and surfaced in the week-end review + trade
// screen's OFFERS tab.
// AI-to-AI trades. Each week (pre-deadline) a small chance two AI
// teams swap a depth player for a future pick — makes the league feel
// alive and surfaces in the user's wire ticker.
function _generateAIvsAITrades() {
  if (franchise.week > TRADE_DEADLINE_WEEK) return;
  // 35% chance of generating ONE AI-AI trade this week.
  if (Math.random() > 0.35) return;
  const myId = franchise.chosenTeamId;
  const aiTeams = TEAMS.filter(t => t.id !== myId);
  if (aiTeams.length < 2) return;
  const seller = aiTeams[Math.floor(Math.random() * aiTeams.length)];
  const sellerRoster = franchise.rosters[seller.id] || [];
  // Find a position with depth — top guy ≥80 OVR AND #3 ≥70 OVR
  // (so the seller is dealing from strength, not desperation).
  const POS_KEYS = ["QB","RB","WR","TE","OL","DL","LB","CB","S"];
  const candidatePositions = POS_KEYS.filter(pos => {
    const at = sellerRoster.filter(p => p.position === pos)
      .sort((a,b) => (b.overall||0) - (a.overall||0));
    return at.length >= 3 && (at[0]?.overall||0) >= 80 && (at[2]?.overall||0) >= 70;
  });
  if (!candidatePositions.length) return;
  const sellPos = candidatePositions[Math.floor(Math.random() * candidatePositions.length)];
  // Trade the 2nd or 3rd best at that position (keep the starter).
  const atPos = sellerRoster.filter(p => p.position === sellPos)
    .sort((a,b) => (b.overall||0) - (a.overall||0));
  const seedIdx = Math.random() < 0.5 ? 1 : 2;
  const player = atPos[seedIdx];
  if (!player || !player.contract || player.contract.remaining < 1) return;
  // Find a buyer with real positional need.
  const buyers = aiTeams
    .filter(t => t.id !== seller.id)
    .map(t => {
      const topOvr = (franchise.rosters[t.id] || [])
        .filter(p => p.position === sellPos)
        .sort((a,b) => (b.overall||0) - (a.overall||0))[0]?.overall || 50;
      return { t, need: 75 - topOvr };
    })
    .filter(b => b.need >= 8)
    .sort((a,b) => b.need - a.need);
  if (!buyers.length) return;
  const buyer = buyers[0].t;
  // Pick to compensate the seller (round scales with player value).
  const playerValue = _playerTradeValue(player);
  const targetRound = playerValue >= 20 ? 2 : playerValue >= 10 ? 3 : 4;
  const buyerPicks = (franchise.picks || [])
    .filter(p => p.currentOwnerId === buyer.id && p.round === targetRound);
  if (!buyerPicks.length) return;
  const pickToSend = buyerPicks[0];
  // Execute.
  const seIdx = sellerRoster.indexOf(player);
  if (seIdx === -1) return;
  sellerRoster.splice(seIdx, 1);
  (franchise.rosters[buyer.id] || []).push(player);
  pickToSend.currentOwnerId = seller.id;
  _pushNews({ type: "trade",
    label: `🔀 ${buyer.name} acquire ${sellPos} ${player.name} from ${seller.name} for ${pickToSend.year} R${pickToSend.round} pick` });
}

function _generateWeeklyAIOffers() {
  if (!franchise.tradeOffers) franchise.tradeOffers = [];
  // Prune expired offers (>2 weeks old)
  franchise.tradeOffers = franchise.tradeOffers
    .filter(o => franchise.week - o.week <= 2);

  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId] || [];
  // Players with a public ASK go through the sealed-bid auction
  // (_processBlockAsks). Players on the block with NO ask still get
  // unsolicited single-team feelers from this function.
  const blockedNoAsk = myRoster.filter(p => p.onTradeBlock && !p.blockAsk);
  if (!blockedNoAsk.length) return;

  for (const p of blockedNoAsk) _generateAIOffersForBlockedPlayer(p);
}

function _generateAIOffersForBlockedPlayer(p) {
  if (!franchise.tradeOffers) franchise.tradeOffers = [];
  const myId = franchise.chosenTeamId;
  // 1-2 AI teams per blocked player per round, weighted by team need
  const interested = TEAMS
    .filter(t => t.id !== myId)
    .map(t => ({ t, need: _aiTradeNeedBonus(t.id, [p]) }))
    .filter(x => x.need > 1)
    .sort((a,b) => b.need - a.need)
    .slice(0, 2 + Math.floor(Math.random() * 2));

  for (const { t } of interested) {
    if (Math.random() < 0.35) continue; // not every team bites every week
    // What the AI offers in return: a mid-tier player from their roster
    // worth ~70-95% of p's value. Pick best fit.
    const aiRoster = franchise.rosters[t.id];
    const myValue = _playerTradeValue(p);
    const candidates = aiRoster
      .filter(rp => !rp.onTradeBlock || true) // can include their block too
      .map(rp => ({ rp, v: _playerTradeValue(rp), diff: Math.abs(_playerTradeValue(rp) - myValue * 0.85) }))
      .sort((a,b) => a.diff - b.diff);
    const offered = candidates[0]?.rp;
    if (!offered) continue;
    // Don't duplicate offers in same week from same team for same player
    const dup = franchise.tradeOffers.some(o =>
      o.fromTeamId === t.id && o.theyWant.includes(p.name) && o.week === franchise.week
    );
    if (dup) continue;
    franchise.tradeOffers.push({
      id: `${t.id}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      fromTeamId: t.id,
      theyGive: [offered.name],
      theyWant: [p.name],
      week: franchise.week,
      status: "pending",
    });
  }
}

// Applies NFL-style trade mechanics to both sides of a deal:
// - Sending team eats remaining prorated signing bonus as dead cap (all accelerated).
// - Receiving team pays any trade kicker as a one-year cap hit.
// - Proration is stripped from the traded player (receiver only pays base salaries).
// Call BEFORE moving players so we read proration from the original contract.
function _applyTradeMechanics(sendPlayers, recvPlayers, sendTeamId, recvTeamId, theirAbsorb = 0, yourAbsorb = 0) {
  franchise.refunds ||= [];
  // Dead cap for sent players, minus any absorption the other team agreed to
  let absorbLeft = Math.max(0, theirAbsorb);
  for (const p of sendPlayers) {
    const proration = p.contract?.bonusProration || 0;
    const remYrs    = p.contract?.remaining      || 0;
    const deadTotal = Math.round(proration * remYrs * 10) / 10;
    const absorbed  = Math.min(absorbLeft, deadTotal);
    absorbLeft = Math.max(0, Math.round((absorbLeft - absorbed) * 10) / 10);
    const senderDead = Math.round((deadTotal - absorbed) * 10) / 10;
    if (senderDead >= 0.05)
      franchise.refunds.push({ kind: "dead_cap", label: `Dead cap (traded): ${p.name}`, fromTeamId: sendTeamId, toTeamId: null, amount: senderDead, yearsRemaining: 1 });
    if (absorbed >= 0.05)
      franchise.refunds.push({ kind: "salary_absorption", label: `Salary absorbed (${p.name})`, fromTeamId: recvTeamId, toTeamId: null, amount: absorbed, yearsRemaining: 1 });
    if (p.contract) p.contract.bonusProration = 0;
  }
  // Trade kicker for received players + optional sender absorbs receiver's dead cap
  for (const p of recvPlayers) {
    const kicker = p.contract?.tradeKicker || 0;
    if (kicker >= 0.05) {
      franchise.refunds.push({ kind: "trade_kicker", label: `Trade kicker: ${p.name}`, fromTeamId: recvTeamId, toTeamId: null, amount: kicker, yearsRemaining: 1 });
      p.contract.tradeKicker = 0;
    }
    if (p.contract) p.contract.bonusProration = 0;
  }
  // User absorbing the other team's dead cap as a sweetener
  if (yourAbsorb >= 0.05)
    franchise.refunds.push({ kind: "salary_absorption", label: "Salary absorbed (agreement)", fromTeamId: sendTeamId, toTeamId: null, amount: yourAbsorb, yearsRemaining: 1 });
}

function frnAcceptOffer(offerId) {
  const off = (franchise.tradeOffers||[]).find(o => o.id === offerId);
  if (!off || off.status !== "pending") return;
  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId];
  const theirRoster = franchise.rosters[off.fromTeamId];
  const sending = off.theyWant.map(n => myRoster.find(p => p.name === n)).filter(Boolean);
  const receiving = (off.theyGive||[]).map(n => theirRoster.find(p => p.name === n)).filter(Boolean);
  if (!sending.length) {
    off.status = "stale";
    saveFranchise();
    renderFrnTrade();
    return;
  }
  // NFL dead cap + trade kicker (must run before player objects are moved)
  _applyTradeMechanics(sending, receiving, myId, off.fromTeamId, off.absorb || 0, 0);
  // Execute player swaps
  for (const p of sending) {
    p.onTradeBlock = false;
    delete p.blockAsk;
    const i = myRoster.indexOf(p); if (i !== -1) myRoster.splice(i, 1);
    theirRoster.push(p);
  }
  for (const p of receiving) {
    p.onTradeBlock = false;
    const i = theirRoster.indexOf(p); if (i !== -1) theirRoster.splice(i, 1);
    myRoster.push(p);
  }
  // Transfer draft picks (block-ask offers)
  if (off.pickIds && off.pickIds.length) {
    for (const pid of off.pickIds) {
      const [yr, rd, origStr] = pid.split("-");
      const pick = (franchise.picks||[]).find(p =>
        p.year === Number(yr) && p.round === Number(rd) &&
        p.originalTeamId === Number(origStr) &&
        p.currentOwnerId === off.fromTeamId);
      if (pick) pick.currentOwnerId = myId;
    }
  }
  off.status = "accepted";
  const team = getTeam(off.fromTeamId);
  const pickLine = off.pickIds?.length ? ` + ${off.pickIds.length} pick${off.pickIds.length>1?"s":""}` : "";
  const absorbLine = off.absorb > 0 ? ` + $${off.absorb.toFixed(1)}M absorbed` : "";
  _pushNews({ type:"trade",
    label: `🔀 Trade with ${team.name}: ${sending.map(p=>p.position+" "+p.name).join(", ")} for ${receiving.map(p=>p.position+" "+p.name).join(", ") || "—"}${pickLine}${absorbLine}` });
  // Stale any other offers on the same player
  for (const other of franchise.tradeOffers) {
    if (other === off || other.status !== "pending") continue;
    if (other.theyWant.some(n => sending.some(p => p.name === n))) other.status = "stale";
  }
  saveFranchise();
  renderFrnTrade();
}

function frnRejectOffer(offerId) {
  const off = (franchise.tradeOffers||[]).find(o => o.id === offerId);
  if (!off) return;
  off.status = "rejected";
  saveFranchise();
  renderFrnTrade();
}

function frnToggleTradePlayer(side, name) {
  const tp = franchise._tradeProp;
  if (!tp) return;
  const list = tp[side === "send" ? "youSend" : "youReceive"];
  const idx = list.indexOf(name);
  if (idx === -1) list.push(name);
  else list.splice(idx, 1);
  tp.result = null;
  saveFranchise();
  renderFrnTrade();
}

// Click a league-browse player on the PROPOSE tab. Sets the partner
// team (if not already locked) and adds to youReceive. If a different
// partner is already locked, asks first.
function frnAddReceiveFromBrowse(teamId, name) {
  const tp = franchise._tradeProp;
  if (!tp) return;
  teamId = Number(teamId);
  if (tp.youReceive.length === 0) {
    // No partner locked yet — adopt this team and start the want list
    tp.targetTeamId = teamId;
    tp.youReceive.push(name);
  } else if (tp.targetTeamId === teamId) {
    // Same partner — toggle
    const idx = tp.youReceive.indexOf(name);
    if (idx === -1) tp.youReceive.push(name); else tp.youReceive.splice(idx, 1);
    if (tp.youReceive.length === 0) tp.targetTeamId = null;
  } else {
    // Different partner — confirm switch
    const newTeam = getTeam(teamId), oldTeam = getTeam(tp.targetTeamId);
    if (!confirm(`Switch trade partner from ${oldTeam?.name||"?"} to ${newTeam?.name||"?"}? Your current selections will be cleared.`)) return;
    tp.targetTeamId = teamId;
    tp.youReceive = [name];
    tp.youSend = [];
  }
  tp.result = null;
  saveFranchise();
  renderFrnTrade();
}

function frnSetTradePosFilter(pos) {
  const tp = franchise._tradeProp;
  if (!tp) return;
  tp.posFilter = pos; // "ALL" or position string
  saveFranchise();
  renderFrnTrade();
}

function frnClearTradePartner() {
  const tp = franchise._tradeProp;
  if (!tp) return;
  tp.targetTeamId = null;
  tp.youReceive = []; tp.youSend = [];
  tp.picksReceive = []; tp.picksSend = [];
  tp.theirAbsorb = 0;
  tp.yourAbsorb  = 0;
  tp.result = null;
  saveFranchise();
  renderFrnTrade();
}

// Picks don't have a primary key, so derive one from year+round+orig.
function _tradePickKey(p) { return `${p.year}_R${p.round}_T${p.originalTeamId}`; }
function _tradePickFromKey(key, ownerId) {
  return (franchise.picks || []).find(p =>
    p.currentOwnerId === ownerId && _tradePickKey(p) === key);
}
function frnToggleTradePick(side, key) {
  const tp = franchise._tradeProp; if (!tp) return;
  const arr = side === "send" ? tp.picksSend : tp.picksReceive;
  const idx = arr.indexOf(key);
  if (idx === -1) arr.push(key); else arr.splice(idx, 1);
  tp.result = null;
  saveFranchise();
  renderFrnTrade();
}
function frnSetAbsorption(side, val) {
  const tp = franchise._tradeProp; if (!tp) return;
  const num = Math.max(0, Math.round((Number(val) || 0) * 10) / 10);
  if (side === "their") tp.theirAbsorb = num;
  else tp.yourAbsorb = num;
  tp.result = null;
  saveFranchise();
}

// Sum a team's outstanding dead-cap obligations as `{totalDollars, maxYears}`.
// Dead-cap entries are franchise.refunds rows with fromTeamId === teamId and
// no kind:"dead_cap" check — we also include any other outgoing fee
// obligation since they all eat the team's cap the same way.
function _outstandingDeadCap(teamId) {
  const refunds = (franchise?.refunds || []).filter(r =>
    r.yearsRemaining > 0 && r.fromTeamId === teamId);
  if (!refunds.length) return { totalDollars: 0, maxYears: 0, refunds: [] };
  const totalDollars = refunds.reduce((s, r) => s + (r.amount * r.yearsRemaining), 0);
  const maxYears = Math.max(...refunds.map(r => r.yearsRemaining));
  return { totalDollars: Math.round(totalDollars * 10) / 10, maxYears, refunds };
}

// Auto-fill the theirAbsorb field to match the dead cap this trade would generate.
function frnAutoFillAbsorption() {
  const tp = franchise._tradeProp; if (!tp) return;
  const myId = franchise.chosenTeamId;
  const sendDeadCap = (tp.youSend || []).reduce((s, n) => {
    const p = (franchise.rosters[myId] || []).find(x => x.name === n);
    return s + (p ? (p.contract?.bonusProration || 0) * (p.contract?.remaining || 0) : 0);
  }, 0);
  tp.theirAbsorb = Math.round(sendDeadCap * 10) / 10;
  tp.result = null;
  saveFranchise();
  renderFrnTrade();
}

function frnSubmitTrade() {
  const tp = franchise._tradeProp;
  if (!tp) return;
  if (_tradeIsEmpty(tp)) {
    alert("Add something on each side — players, picks, or cash.");
    return;
  }
  const myId = franchise.chosenTeamId;
  const otherId = tp.targetTeamId;
  if (!otherId) { alert("Choose a trade partner first."); return; }
  const myRoster = franchise.rosters[myId];
  const theirRoster = franchise.rosters[otherId];

  const sendPlayers = tp.youSend.map(n => myRoster.find(p => p.name === n)).filter(Boolean);
  const recvPlayers = tp.youReceive.map(n => theirRoster.find(p => p.name === n)).filter(Boolean);
  const sendPicks = (tp.picksSend || [])
    .map(k => _tradePickFromKey(k, myId)).filter(Boolean);
  const recvPicks = (tp.picksReceive || [])
    .map(k => _tradePickFromKey(k, otherId)).filter(Boolean);

  const playerSendValue = sendPlayers.reduce((s,p) => s + _playerTradeValue(p), 0);
  const playerRecvValue = recvPlayers.reduce((s,p) => s + _playerTradeValue(p), 0);
  const pickSendValue = sendPicks.reduce((s,p) => s + _pickValue(p), 0);
  const pickRecvValue = recvPicks.reduce((s,p) => s + _pickValue(p), 0);
  const theirAbsorb = Math.max(0, tp.theirAbsorb || 0);
  const yourAbsorb  = Math.max(0, tp.yourAbsorb  || 0);

  // Absorption: theirAbsorb = they reduce my dead cap (value I receive)
  //             yourAbsorb  = I reduce their dead cap (value I give)
  const sendValue = playerSendValue + pickSendValue + yourAbsorb;
  const recvValue = playerRecvValue + pickRecvValue + theirAbsorb;

  // AI need bonus: how much they want what you're sending (players only)
  const theirNeedForSend = _aiTradeNeedBonus(otherId, sendPlayers);
  const myNeedForRecv = _aiTradeNeedBonus(myId, recvPlayers);

  // AI accepts if (sendValue + theirNeedForSend) >= recvValue * 0.97
  const aiScore = (sendValue + theirNeedForSend) / Math.max(0.1, recvValue);
  const accepted = aiScore >= 0.97;

  if (accepted) {
    // NFL dead cap + trade kicker (must run before player objects are moved)
    _applyTradeMechanics(sendPlayers, recvPlayers, myId, otherId, tp.theirAbsorb || 0, tp.yourAbsorb || 0);
    // Players
    for (const p of sendPlayers) {
      const i = myRoster.indexOf(p);
      if (i !== -1) myRoster.splice(i, 1);
      theirRoster.push(p);
    }
    for (const p of recvPlayers) {
      const i = theirRoster.indexOf(p);
      if (i !== -1) theirRoster.splice(i, 1);
      myRoster.push(p);
    }
    // Picks — flip currentOwnerId
    for (const pk of sendPicks)  pk.currentOwnerId = otherId;
    for (const pk of recvPicks)  pk.currentOwnerId = myId;
    franchise.refunds ||= [];

    const other = getTeam(otherId);
    const sendBits = [];
    if (sendPlayers.length) sendBits.push(sendPlayers.map(p => p.position+" "+p.name).join(", "));
    if (sendPicks.length)   sendBits.push(sendPicks.map(p => `${p.year} R${p.round}`).join(", "));
    if (yourAbsorb  > 0) sendBits.push(`$${yourAbsorb.toFixed(1)}M absorbed`);
    const recvBits = [];
    if (recvPlayers.length) recvBits.push(recvPlayers.map(p => p.position+" "+p.name).join(", "));
    if (recvPicks.length)   recvBits.push(recvPicks.map(p => `${p.year} R${p.round}`).join(", "));
    if (theirAbsorb > 0) recvBits.push(`$${theirAbsorb.toFixed(1)}M absorbed`);
    tp.result = {
      accepted: true,
      message: `Trade accepted! You got ${recvBits.join(" + ") || "nothing"}.`,
    };
    _pushNews({ type:"trade",
      label: `🔀 Trade with ${other.name}: sent ${sendBits.join(" + ")} for ${recvBits.join(" + ")}` });
  } else {
    const reason = aiScore < 0.6 ? "Way too lopsided in your favor"
                 : aiScore < 0.85 ? "Not enough value coming back to us"
                 : "Close, but pass — try sweetening the deal";
    tp.result = { accepted: false, message: `Rejected. ${reason}.`, aiScore };
  }
  saveFranchise();
  renderFrnTrade();
}

function _sortRoster(roster, sortBy) {
  const sorted = roster.slice();
  if (sortBy === "grade") sorted.sort((a,b) => scoutGrade(b) - scoutGrade(a));
  else if (sortBy === "age") sorted.sort((a,b) => (a.age||0) - (b.age||0));
  else if (sortBy === "aav") sorted.sort((a,b) => (b.contract?.aav||0) - (a.contract?.aav||0));
  else if (sortBy === "pos") sorted.sort((a,b) => (a.position||"").localeCompare(b.position||"") || (scoutGrade(b)-scoutGrade(a)));
  return sorted;
}

function renderFrnTrade() {
  const tp = franchise._tradeProp;
  if (!tp) { showFranchiseDashboard(); return; }
  const tab = tp.tab || "propose";
  const sortBy = tp.sortBy || "grade";
  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId] || [];
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const myCapUsed = capUsedByTeam(myId);

  // Offer count for tab badge
  const pendingOffers = (franchise.tradeOffers || []).filter(o => o.status === "pending");
  const blockedCount = myRoster.filter(p => p.onTradeBlock).length;

  // Tab bar
  const tabHtml = [
    { id:"propose", label:"PROPOSE TRADE" },
    { id:"block",   label:`TRADE BLOCK${blockedCount?` · ${blockedCount}`:""}` },
    { id:"market",  label:"LEAGUE BLOCK" },
    { id:"offers",  label:`OFFERS${pendingOffers.length?` · ${pendingOffers.length}`:""}` },
  ].map(t => `<button class="frn-ana-tab ${t.id===tab?"active":""}"
    onclick="frnOpenTrade(null,'${t.id}')">${t.label}</button>`).join("");

  // Sort controls
  const sortHtml = `
    <div class="frn-fa-summary">
      <span>Sort by:</span>
      ${["grade","age","aav","pos"].map(by => `
        <button class="frn-sort-btn ${sortBy===by?"active":""}" onclick="frnSetTradeSort('${by}')">
          ${by==="grade"?"Grade ↓":by==="age"?"Age ↑":by==="aav"?"AAV ↓":"Position"}
        </button>`).join("")}
      <span style="margin-left:auto">Cap: <b style="color:var(--gold)">$${myCapUsed.toFixed(1)}M</b> / $${cap.toFixed(0)}M</span>
    </div>`;

  let bodyHtml = "";
  if (tab === "propose") bodyHtml = _renderTradeProposeTab(tp, sortBy, myRoster, cap, myCapUsed);
  else if (tab === "block") bodyHtml = _renderTradeBlockTab(myRoster, sortBy);
  else if (tab === "market") bodyHtml = _renderTradeMarketTab(myId, sortBy);
  else if (tab === "offers") bodyHtml = _renderTradeOffersTab();

  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap">
      <div style="font-size:1.05rem;font-weight:900;color:var(--gold)">🔀 TRADES</div>
      <div style="color:var(--gray);font-size:.72rem">Trade deadline: Week ${TRADE_DEADLINE_WEEK} · ${franchise.week > TRADE_DEADLINE_WEEK ? "<span style=\"color:var(--red)\">PASSED</span>" : `Week ${franchise.week} of ${FRANCHISE_WEEKS}`}</div>
      <button class="btn btn-outline" onclick="showFranchiseDashboard()" style="margin-left:auto">← Back</button>
    </div>
    <div class="frn-ana-tabs">${tabHtml}</div>
    ${sortHtml}
    <div class="frn-ana-body">${bodyHtml}</div>`;
}

function _renderTradeProposeTab(tp, sortBy, myRoster, cap, myCapUsed) {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const posFilter = tp.posFilter || "ALL";
  const partnerId = tp.targetTeamId;
  const partnerTeam = partnerId ? getTeam(partnerId) : null;

  // Position tab bar
  const positions = ["ALL","QB","RB","WR","TE","OL","DL","LB","CB","S","K","P"];
  const posTabs = positions.map(pos =>
    `<button class="frn-pos-tab ${posFilter===pos?"active":""}" onclick="frnSetTradePosFilter('${pos}')">${pos}</button>`
  ).join("");

  // What's in the LEAGUE BROWSE list (left column for "you receive"):
  //   - If no partner locked: every team's players at the position
  //   - If partner locked: only that partner's players at the position
  let browseCandidates = [];
  if (!partnerId) {
    for (const t of TEAMS) {
      if (t.id === myId) continue;
      for (const p of (franchise.rosters[t.id] || [])) {
        if (posFilter === "ALL" || p.position === posFilter) {
          browseCandidates.push({ p, teamId: t.id, team: t });
        }
      }
    }
  } else {
    for (const p of (franchise.rosters[partnerId] || [])) {
      if (posFilter === "ALL" || p.position === posFilter) {
        browseCandidates.push({ p, teamId: partnerId, team: partnerTeam });
      }
    }
  }
  // Sort
  const sorter = (a,b) => {
    if (sortBy === "grade") return scoutGrade(b.p) - scoutGrade(a.p);
    if (sortBy === "age")   return (a.p.age||0) - (b.p.age||0);
    if (sortBy === "aav")   return (b.p.contract?.aav||0) - (a.p.contract?.aav||0);
    if (sortBy === "pos")   return (a.p.position||"").localeCompare(b.p.position||"");
    return 0;
  };
  browseCandidates.sort(sorter);
  // Cap the browse list when in "all-teams" mode to avoid 700-row lists
  const cappedBrowse = partnerId ? browseCandidates : browseCandidates.slice(0, 80);

  const receiveSet = new Set(tp.youReceive);
  const browseRows = cappedBrowse.map(({p, teamId, team}) => {
    const escName = (p.name||"").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const sel = receiveSet.has(p.name) && partnerId === teamId;
    const kicker = p.contract?.tradeKicker || 0;
    const kickerTag = kicker >= 0.05
      ? `<span style="color:#e8a000;font-size:.55rem;font-weight:700" title="Trade kicker — one-time cap hit if acquired">⚡ $${kicker.toFixed(1)}M</span>` : "";
    return `<label class="frn-trade-player ${sel?"selected":""}">
      <input type="checkbox" ${sel?"checked":""}
        onchange="frnAddReceiveFromBrowse(${teamId},'${escName}')">
      <span style="color:var(--gold);font-size:.58rem;font-weight:700">${p.position}</span>
      <span style="flex:1;font-weight:${sel?700:400}">${p.name}</span>
      ${!partnerId ? `<span style="color:var(--gray);font-size:.6rem">${team.name}</span>` : ""}
      ${kickerTag}
      <span>${gradeBadge(p)}</span>
      <span style="color:var(--gray);font-size:.62rem">${p.age||"?"}</span>
      <span style="color:var(--gold);font-size:.62rem">$${(p.contract?.aav||0).toFixed(0)}M</span>
    </label>`;
  }).join("");

  // Your roster on the send side, also filtered by position
  const sendRoster = (posFilter === "ALL"
    ? myRoster
    : myRoster.filter(p => p.position === posFilter));
  const sendSet = new Set(tp.youSend);
  const sendRows = _sortRoster(sendRoster, sortBy).map(p => {
    const escName = (p.name||"").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const sel = sendSet.has(p.name);
    const blockTag = p.onTradeBlock ? `<span style="color:#e8a000;font-size:.55rem;font-weight:700">●BLK</span>` : "";
    const dead = (p.contract?.bonusProration || 0) * (p.contract?.remaining || 0);
    const deadTag = dead >= 0.05 && sel
      ? `<span style="color:#ff9090;font-size:.55rem;font-weight:700" title="Dead cap you'll absorb">☠ $${dead.toFixed(1)}M</span>` : "";
    return `<label class="frn-trade-player ${sel?"selected":""}">
      <input type="checkbox" ${sel?"checked":""}
        onchange="frnToggleTradePlayer('send','${escName}')">
      <span style="color:var(--gold);font-size:.58rem;font-weight:700">${p.position}</span>
      <span style="flex:1;font-weight:${sel?700:400}">${p.name} ${blockTag}</span>
      ${deadTag}
      <span>${gradeBadge(p)}</span>
      <span style="color:var(--gray);font-size:.62rem">${p.age||"?"}</span>
      <span style="color:var(--gold);font-size:.62rem">$${(p.contract?.aav||0).toFixed(0)}M</span>
    </label>`;
  }).join("");

  // Cap math
  const theirRoster = partnerId ? (franchise.rosters[partnerId] || []) : [];
  const sendCap = tp.youSend.reduce((s,n) => s + (myRoster.find(p=>p.name===n)?.contract?.aav || 0), 0);
  const recvCap = tp.youReceive.reduce((s,n) => s + (theirRoster.find(p=>p.name===n)?.contract?.aav || 0), 0);
  // Dead cap you'd absorb by trading away selected players
  const sendDeadCap = tp.youSend.reduce((s, n) => {
    const p = myRoster.find(x => x.name === n);
    return s + (p ? (p.contract?.bonusProration || 0) * (p.contract?.remaining || 0) : 0);
  }, 0);
  // Trade kickers on players you're receiving
  const recvKickers = tp.youReceive.reduce((s, n) => {
    const p = theirRoster.find(x => x.name === n);
    return s + (p?.contract?.tradeKicker || 0);
  }, 0);
  const theirAbsorb_p = Math.min(tp.theirAbsorb || 0, sendDeadCap);
  const yourAbsorb_p  = Math.min(tp.yourAbsorb  || 0, (tp.youReceive || []).reduce((s, n) => {
    const p = theirRoster.find(x => x.name === n);
    return s + (p ? (p.contract?.bonusProration || 0) * (p.contract?.remaining || 0) : 0);
  }, 0));
  const projCap = myCapUsed - sendCap + recvCap + (sendDeadCap - theirAbsorb_p) + recvKickers + yourAbsorb_p;

  // Manual partner-override dropdown
  const teamOptionsHtml = `<option value="">— choose / clear —</option>` +
    TEAMS.filter(t => t.id !== myId).map(t =>
      `<option value="${t.id}" ${t.id===partnerId?"selected":""}>${t.city} ${t.name}</option>`
    ).join("");

  return `
    <div class="frn-fa-summary" style="margin-bottom:.5rem">
      ${partnerId
        ? `Trading with: <b style="color:var(--gold-lt)">${partnerTeam.city} ${partnerTeam.name}</b>
           <button class="btn btn-outline" onclick="frnClearTradePartner()" style="font-size:.6rem;padding:.15rem .45rem;margin-left:.4rem">× Clear</button>`
        : `<span style="color:var(--gray)">Click any player to set the trade partner</span>`}
      <span style="margin-left:auto">Override:
        <select onchange="frnOpenTrade(this.value||null,'propose')" style="background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.2rem .35rem;font-family:inherit;font-size:.7rem">${teamOptionsHtml}</select>
      </span>
      <span>Proj cap: <b style="color:${projCap>cap?'var(--red)':'var(--gold)'}">$${projCap.toFixed(1)}M</b></span>
      ${sendDeadCap >= 0.05 ? `<span style="color:#ff9090;font-size:.65rem" title="Prorated bonus you absorb when trading these players away">☠ Dead: $${sendDeadCap.toFixed(1)}M</span>` : ""}
      ${recvKickers >= 0.05 ? `<span style="color:#e8a000;font-size:.65rem" title="One-time trade kicker cap hit on elite player acquisition">⚡ Kicker: $${recvKickers.toFixed(1)}M</span>` : ""}
      ${(() => {
        const myDC = _outstandingDeadCap(franchise.chosenTeamId);
        return myDC.totalDollars >= 0.5
          ? `<button class="btn btn-outline" onclick="frnAutoFillAbsorption()" style="color:#ff9090;border-color:#ff9090;font-size:.6rem;padding:.15rem .45rem" title="Request partner absorbs your $${myDC.totalDollars.toFixed(1)}M in dead cap">💸 Recoup $${myDC.totalDollars.toFixed(1)}M dead</button>`
          : "";
      })()}
    </div>
    <div class="frn-pos-tabs">${posTabs}</div>
    <div class="frn-trade-layout" style="margin-top:.5rem">
      <div class="frn-fa-pool-col">
        <div class="frn-card-title">
          YOU RECEIVE
          ${partnerId
            ? ` · ${partnerTeam.name} ${posFilter==="ALL"?"":"("+posFilter+")"}`
            : ` · LEAGUE BROWSE${posFilter==="ALL"?"":" ("+posFilter+")"}`}
          <span style="color:var(--gray);font-weight:400;margin-left:auto">${tp.youReceive.length} selected</span>
        </div>
        ${!partnerId && browseCandidates.length > 80
          ? `<div style="color:var(--gray);font-size:.6rem;margin-bottom:.3rem">Showing top 80 of ${browseCandidates.length} — pick a position tab to narrow.</div>`
          : ""}
        <div class="frn-trade-list">${browseRows || `<div style="color:var(--gray);font-style:italic;font-size:.7rem;padding:.4rem">No players at this position.</div>`}</div>
      </div>
      <div class="frn-fa-pool-col">
        <div class="frn-card-title">
          YOU SEND · ${myTeam.name} ${posFilter==="ALL"?"":"("+posFilter+")"}
          <span style="color:var(--gray);font-weight:400;margin-left:auto">${tp.youSend.length} selected</span>
        </div>
        <div class="frn-trade-list">${sendRows || `<div style="color:var(--gray);font-style:italic;font-size:.7rem;padding:.4rem">None at this position.</div>`}</div>
      </div>
    </div>
    ${_renderTradePicksSection(myId, partnerId, tp)}
    ${_renderSalaryAbsorptionSection(myTeam, partnerTeam, tp)}
    ${tp.result ? `
      <div class="frn-trade-result ${tp.result.accepted?'accepted':'rejected'}">
        <b>${tp.result.accepted?"✓ ACCEPTED":"✗ REJECTED"}</b> · ${tp.result.message}
      </div>` : ""}
    <div class="frn-actions" style="justify-content:center;margin-top:.8rem">
      <button class="btn btn-gold-big" onclick="frnSubmitTrade()"
        ${(_tradeIsEmpty(tp) || !partnerId || franchise.week > TRADE_DEADLINE_WEEK)?"disabled style=\"opacity:.5;cursor:not-allowed\"":""}>
        📨 SUBMIT PROPOSAL
      </button>
    </div>`;
}

// A trade must move SOMETHING in each direction (players, picks, or cash)
// — empty side is considered "give nothing for everything", which we block.
function _tradeIsEmpty(tp) {
  const sendSide = tp.youSend.length + tp.picksSend.length;
  const recvSide = tp.youReceive.length + tp.picksReceive.length;
  return sendSide === 0 || recvSide === 0;
}

function _renderTradePicksSection(myId, partnerId, tp) {
  const yearLabel = yr => yr;
  const myPicks = (franchise.picks || [])
    .filter(p => p.currentOwnerId === myId)
    .sort((a,b) => a.year - b.year || a.round - b.round);
  const theirPicks = partnerId ? (franchise.picks || [])
    .filter(p => p.currentOwnerId === partnerId)
    .sort((a,b) => a.year - b.year || a.round - b.round) : [];
  const renderPickRow = (p, isMine) => {
    const key = _tradePickKey(p);
    const sel = isMine ? tp.picksSend.includes(key) : tp.picksReceive.includes(key);
    const origTeam = getTeam(p.originalTeamId);
    const viaMine = isMine ? p.originalTeamId !== myId : p.originalTeamId !== partnerId;
    const viaLabel = viaMine ? ` <span style="color:#7fbfff;font-size:.6rem">via ${origTeam?.name||"?"}</span>` : "";
    return `<label class="frn-trade-row" style="display:flex;gap:.4rem;align-items:center;padding:.18rem .25rem;cursor:pointer;${sel?"background:rgba(200,169,0,0.12)":""}">
      <input type="checkbox" ${sel?"checked":""} onchange="frnToggleTradePick('${isMine?"send":"receive"}','${key}')">
      <span style="color:var(--gold);font-weight:700;font-size:.65rem;min-width:2.2rem">${yearLabel(p.year)} R${p.round}</span>
      <span style="color:var(--gray);font-size:.6rem">~${_pickValue(p).toFixed(0)} val${viaLabel}</span>
    </label>`;
  };
  const myList = myPicks.length
    ? myPicks.map(p => renderPickRow(p, true)).join("")
    : `<div style="color:var(--gray);font-style:italic;font-size:.65rem;padding:.3rem">No picks owned.</div>`;
  const theirList = !partnerId
    ? `<div style="color:var(--gray);font-style:italic;font-size:.65rem;padding:.3rem">Lock a trade partner to see their picks.</div>`
    : (theirPicks.length
        ? theirPicks.map(p => renderPickRow(p, false)).join("")
        : `<div style="color:var(--gray);font-style:italic;font-size:.65rem;padding:.3rem">Partner has no picks.</div>`);
  return `<div class="frn-trade-layout" style="margin-top:.7rem">
    <div class="frn-fa-pool-col">
      <div class="frn-card-title">PICKS YOU SEND <span style="color:var(--gray);font-weight:400;margin-left:auto">${tp.picksSend.length} selected</span></div>
      <div class="frn-trade-list" style="max-height:14rem;overflow-y:auto">${myList}</div>
    </div>
    <div class="frn-fa-pool-col">
      <div class="frn-card-title">PICKS YOU RECEIVE <span style="color:var(--gray);font-weight:400;margin-left:auto">${tp.picksReceive.length} selected</span></div>
      <div class="frn-trade-list" style="max-height:14rem;overflow-y:auto">${theirList}</div>
    </div>
  </div>`;
}

function _renderSalaryAbsorptionSection(myTeam, partnerTeam, tp) {
  const myId = franchise.chosenTeamId;
  const theirRoster = partnerTeam ? (franchise.rosters[partnerTeam.id] || []) : [];
  const partnerName = partnerTeam ? partnerTeam.name : "Partner";

  const sendDeadCap = (tp.youSend || []).reduce((s, n) => {
    const p = (franchise.rosters[myId] || []).find(x => x.name === n);
    return s + (p ? (p.contract?.bonusProration || 0) * (p.contract?.remaining || 0) : 0);
  }, 0);
  const recvDeadCap = (tp.youReceive || []).reduce((s, n) => {
    const p = theirRoster.find(x => x.name === n);
    return s + (p ? (p.contract?.bonusProration || 0) * (p.contract?.remaining || 0) : 0);
  }, 0);

  const theirAbsorb = Math.min(tp.theirAbsorb || 0, sendDeadCap);
  const yourAbsorb  = Math.min(tp.yourAbsorb  || 0, recvDeadCap);

  if (sendDeadCap < 0.05 && recvDeadCap < 0.05) {
    return `<div style="color:var(--gray);font-size:.68rem;padding:.45rem .6rem;background:var(--bg2);border:1px dashed var(--border);margin-top:.7rem">
      ✓ No salary absorption — neither side generates dead cap in this trade.
    </div>`;
  }

  const panels = [];

  if (sendDeadCap >= 0.05) {
    const myRemaining = Math.max(0, sendDeadCap - theirAbsorb).toFixed(1);
    panels.push(`<div class="frn-fa-pool-col">
      <div class="frn-card-title">THEY ABSORB YOUR DEAD CAP
        <span style="color:var(--gray);font-weight:400;margin-left:auto;font-size:.6rem">${partnerName} covers your cost</span>
      </div>
      <div style="padding:.4rem .6rem;background:var(--bg3);font-size:.7rem;margin-bottom:.4rem;border-left:3px solid #ff9090">
        Trading these players generates <b style="color:#ff9090">$${sendDeadCap.toFixed(1)}M</b> dead cap for you.
        Request that ${partnerName} absorbs part of it.
      </div>
      <div style="display:flex;gap:.6rem;align-items:flex-end;padding:.4rem .5rem;flex-wrap:wrap">
        <label style="flex:1;min-width:8rem">
          <div class="frn-meta-label">THEY ABSORB ($M · ONE-TIME)</div>
          <input type="number" min="0" max="${sendDeadCap.toFixed(1)}" step="0.5"
            value="${theirAbsorb.toFixed(1)}"
            oninput="frnSetAbsorption('their', Math.min(${sendDeadCap.toFixed(1)}, Math.max(0, +this.value||0)))"
            style="width:100%;background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.25rem .35rem;font-family:inherit">
        </label>
        <div style="padding-bottom:.25rem;white-space:nowrap">
          <div style="color:var(--gray);font-size:.6rem">Your dead cap</div>
          <div style="font-weight:700">
            <span style="color:#ff9090${theirAbsorb > 0 ? ";text-decoration:line-through" : ""}">$${sendDeadCap.toFixed(1)}M</span>
            ${theirAbsorb > 0 ? ` → <span style="color:var(--green-lt)">$${myRemaining}M</span>` : ""}
          </div>
        </div>
        <button class="btn btn-outline" onclick="frnSetAbsorption('their',${sendDeadCap.toFixed(1)})" style="font-size:.6rem;padding:.2rem .45rem">Max</button>
        <button class="btn btn-outline" onclick="frnSetAbsorption('their',0)" style="font-size:.6rem;padding:.2rem .45rem;color:var(--gray)">Clear</button>
      </div>
    </div>`);
  }

  if (recvDeadCap >= 0.05) {
    panels.push(`<div class="frn-fa-pool-col">
      <div class="frn-card-title">YOU ABSORB THEIR DEAD CAP
        <span style="color:var(--gray);font-weight:400;margin-left:auto;font-size:.6rem">Sweetener — you cover their cost</span>
      </div>
      <div style="padding:.4rem .6rem;background:var(--bg3);font-size:.7rem;margin-bottom:.4rem;border-left:3px solid #e8a000">
        Their players carry <b style="color:#e8a000">$${recvDeadCap.toFixed(1)}M</b> dead cap.
        Offer to absorb some to sweeten your proposal (hits your cap).
      </div>
      <div style="display:flex;gap:.6rem;align-items:flex-end;padding:.4rem .5rem;flex-wrap:wrap">
        <label style="flex:1;min-width:8rem">
          <div class="frn-meta-label">YOU ABSORB ($M · ONE-TIME)</div>
          <input type="number" min="0" max="${recvDeadCap.toFixed(1)}" step="0.5"
            value="${yourAbsorb.toFixed(1)}"
            oninput="frnSetAbsorption('your', Math.min(${recvDeadCap.toFixed(1)}, Math.max(0, +this.value||0)))"
            style="width:100%;background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.25rem .35rem;font-family:inherit">
        </label>
        <div style="padding-bottom:.25rem;white-space:nowrap">
          <div style="color:var(--gray);font-size:.6rem">Extra cap hit (you)</div>
          <div style="font-weight:700;color:${yourAbsorb > 0 ? "var(--red)" : "var(--gray)"}">
            ${yourAbsorb > 0 ? `+$${yourAbsorb.toFixed(1)}M` : "—"}
          </div>
        </div>
        <button class="btn btn-outline" onclick="frnSetAbsorption('your',0)" style="font-size:.6rem;padding:.2rem .45rem;color:var(--gray)">Clear</button>
      </div>
    </div>`);
  }

  return `<div style="margin-top:.7rem">
    <div class="frn-card-title" style="margin-bottom:.5rem">SALARY ABSORPTION</div>
    <div class="frn-trade-layout">${panels.join("")}</div>
  </div>`;
}

function frnRecoupDeadCapMode() {
  const tp = franchise._tradeProp; if (!tp) return;
  tp.tab = "propose";
  frnAutoFillAbsorption();
}

function _renderTradeBlockTab(myRoster, sortBy) {
  const tp = franchise._tradeProp || {};
  // If editing an ask, swap the tab body for the ask form
  if (tp.editAsk) return _renderBlockAskForm(tp.editAsk);

  const sorted = _sortRoster(myRoster, sortBy);
  const rows = sorted.map(p => {
    const escName = (p.name||"").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const ask = p.blockAsk;
    const askPieces = [];
    if (ask?.askedPicks) {
      for (const [r, n] of Object.entries(ask.askedPicks)) {
        if (n > 0) askPieces.push(`${n}× R${r}`);
      }
    }
    if (ask?.refund && ask.refund.amount > 0) {
      const dir = ask.refund.direction || "theyPay";
      const sign = dir === "theyPay" ? "+" : "−";
      const color = dir === "theyPay" ? "var(--green-lt)" : "var(--red)";
      askPieces.push(`<span style="color:${color}">${sign}$${ask.refund.amount.toFixed(1)}M×${ask.refund.years}yr</span>`);
    }
    if (ask?.minPlayerGrade) askPieces.push(`${ask.minPlayerGrade}+ player`);
    const askSummary = ask
      ? `<div style="color:var(--gold-lt);font-size:.62rem;margin-top:.15rem">
           💰 Asking: ${askPieces.length ? askPieces.join(" + ") : "<i>price unset</i>"}
         </div>`
      : "";
    return `<tr class="${p.onTradeBlock?'frn-blocked':''}">
      <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
      <td style="font-weight:700">${p.name}${askSummary}</td>
      <td>${gradeBadge(p)}</td>
      <td style="color:var(--gray)">${p.age||"?"}</td>
      <td style="color:var(--gold)">$${(p.contract?.aav||0).toFixed(1)}M</td>
      <td>${p.contract?.remaining||0}yr</td>
      <td>
        <button class="btn ${p.onTradeBlock?'btn-gold':'btn-outline'}"
          onclick="frnToggleBlock('${escName}')" style="font-size:.6rem;padding:.2rem .55rem">
          ${p.onTradeBlock?"✓ ON BLOCK":"+ Block"}
        </button>
        ${p.onTradeBlock ? `<button class="btn btn-outline" onclick="frnEditAsk('${escName}')"
          style="font-size:.6rem;padding:.2rem .55rem;margin-left:.2rem">
          ${ask?"✎ Edit Ask":"💲 Set Ask"}
        </button>` : ""}
      </td>
    </tr>`;
  }).join("");
  const myDeadCap = _outstandingDeadCap(franchise.chosenTeamId);
  const deadCapBanner = myDeadCap.totalDollars >= 0.5 ? `
    <div style="background:rgba(255,100,100,0.08);border:1px solid rgba(255,100,100,.3);padding:.5rem .75rem;margin-bottom:.6rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
      <div>
        <div style="color:#ff9090;font-weight:900;font-size:.75rem">☠ DEAD CAP: $${myDeadCap.totalDollars.toFixed(1)}M outstanding</div>
        <div style="color:var(--gray);font-size:.62rem;margin-top:.15rem">From traded / released players. Demand cash in a trade proposal to offset it.</div>
      </div>
      <button class="btn btn-outline" onclick="frnRecoupDeadCapMode()" style="color:#ff9090;border-color:#ff9090;white-space:nowrap;margin-left:auto">
        💸 Request Salary Absorption to Recoup
      </button>
    </div>` : "";

  return `
    ${deadCapBanner}
    <div style="color:var(--gray);font-size:.72rem;margin-bottom:.5rem">
      Listings go public when the week ends. Set an asking price to send a direct proposal — the target team can accept on the spot or counter, with counters arriving the following week.
    </div>
    <table class="frn-pre-roster-table">
      <thead><tr><th>Pos</th><th>Player</th><th>Grade</th><th>Age</th><th>AAV</th><th>Yrs</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function _renderBlockAskForm(playerName) {
  const myId = franchise.chosenTeamId;
  const player = franchise.rosters[myId].find(p => p.name === playerName);
  if (!player) return `<div>Player not found.</div>`;
  const tp = franchise._tradeProp;
  const ad = tp.askDraft || { askedPicks:{}, refundAmount:0, refundYears:0, refundDirection:"theyPay", minPlayerGrade:"" };
  const maxRefundYears = Math.max(player.contract?.remaining || 1, 1);

  const totalPicks = Object.values(ad.askedPicks || {}).reduce((s,n) => s + n, 0);
  const refundTotal = (ad.refundAmount || 0) * (ad.refundYears || 0);

  // Pick demand inputs — 1st through 7th round
  const pickInputs = [1,2,3,4,5,6,7].map(r => `
    <label class="frn-pick-input">
      <span class="frn-meta-label">RD ${r}</span>
      <input type="number" min="0" max="5" step="1" value="${ad.askedPicks?.[r] || 0}"
        onchange="frnAskSetPicks(${r}, this.value)">
    </label>
  `).join("");

  const refundDir = ad.refundDirection || "theyPay";
  const refundLine = refundTotal > 0
    ? `<div class="frn-refund-summary ${refundDir==="theyPay"?"income":""}">
         ${refundDir === "youPay"
           ? `You pay them <b style="color:var(--red)">$${(ad.refundAmount||0).toFixed(1)}M/yr × ${ad.refundYears}yr</b> = total <b>$${refundTotal.toFixed(1)}M dead cap</b>.`
           : `They pay you <b style="color:var(--green-lt)">$${(ad.refundAmount||0).toFixed(1)}M/yr × ${ad.refundYears}yr</b> = total <b>$${refundTotal.toFixed(1)}M income</b>.`}
       </div>`
    : "";

  // Summary line
  const askLine = [];
  for (const [r, n] of Object.entries(ad.askedPicks || {})) {
    if (n > 0) askLine.push(`${n}× R${r}`);
  }
  if (refundTotal > 0) {
    askLine.push(refundDir === "theyPay"
      ? `+$${ad.refundAmount.toFixed(1)}M/yr×${ad.refundYears}yr`
      : `−$${ad.refundAmount.toFixed(1)}M/yr×${ad.refundYears}yr eaten`);
  }
  if (ad.minPlayerGrade) askLine.push(`${ad.minPlayerGrade}+ player`);

  return `
    <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem;flex-wrap:wrap">
      <button class="btn btn-outline" onclick="frnCancelAsk()">← Back</button>
      <div style="font-weight:900">Set price for ${player.name}</div>
      <div style="color:var(--gray);font-size:.7rem">(${player.position}, age ${player.age||"?"}, ${gradeLabel(scoutGrade(player))} · contract ${player.contract?.remaining||0}yr left @ $${(player.contract?.aav||0).toFixed(1)}M)</div>
    </div>
    <div class="frn-fa-summary">
      <span style="color:var(--gray)">Asking price is <b style="color:var(--gold)">public</b> — every team sees it. Anyone whose package matches sends an offer next week.</span>
    </div>

    <div class="frn-card-title" style="margin-top:.6rem">📋 DRAFT PICKS DEMANDED</div>
    <div style="color:var(--gray);font-size:.68rem;margin-bottom:.3rem">
      How many picks at each round you want. Years are flexible — teams ship the nearest matching pick they own.
    </div>
    <div class="frn-pick-grid">${pickInputs}</div>

    <div class="frn-card-title" style="margin-top:.7rem">💰 CASH / TRANSFER FEE (OPTIONAL)</div>
    <div class="frn-cash-dir">
      <button class="frn-sort-btn ${refundDir==="theyPay"?"active":""}" onclick="frnAskSetRefund('direction','theyPay')">📥 They pay you (premium)</button>
      <button class="frn-sort-btn ${refundDir==="youPay"?"active":""}" onclick="frnAskSetRefund('direction','youPay')">📤 You pay them (sweetener)</button>
    </div>
    <div class="frn-refund-form">
      <label>
        <span class="frn-meta-label">$M / YEAR</span>
        <input type="number" min="0" max="40" step="0.5" value="${(ad.refundAmount||0).toFixed(1)}"
          onchange="frnAskSetRefund('amount',this.value)">
      </label>
      <label>
        <span class="frn-meta-label">YEARS</span>
        <input type="number" min="0" max="${maxRefundYears}" step="1" value="${ad.refundYears||0}"
          onchange="frnAskSetRefund('years',this.value)">
      </label>
    </div>
    ${refundLine}

    <div class="frn-card-title" style="margin-top:.7rem">👤 MINIMUM PLAYER GRADE (OPTIONAL)</div>
    <div style="color:var(--gray);font-size:.68rem;margin-bottom:.3rem">
      Require a player of at least this grade in addition to picks/cash. Leave blank if you just want picks + cash.
    </div>
    <select onchange="frnAskSetMinGrade(this.value)" style="background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.3rem .5rem;font-family:inherit;font-size:.72rem">
      ${["","A+","A","A-","B+","B","B-","C+","C"].map(g =>
        `<option value="${g}" ${g===ad.minPlayerGrade?"selected":""}>${g||"— none —"}</option>`).join("")}
    </select>

    <div class="frn-fa-summary" style="margin-top:.7rem;background:var(--bg3);border-left:3px solid var(--gold)">
      <b style="color:var(--gold)">Asking price:</b>
      <span>${askLine.length ? askLine.join(" + ") : "<i>nothing yet — set picks, cash, or a player minimum.</i>"}</span>
    </div>

    <div class="frn-actions" style="justify-content:center;margin-top:.7rem">
      <button class="btn btn-gold-big" onclick="frnSubmitAsk()"
        ${(totalPicks===0 && refundTotal===0 && !ad.minPlayerGrade)?"disabled style=\"opacity:.5;cursor:not-allowed\"":""}>
        📨 LIST ON BLOCK
      </button>
    </div>`;
}

function _renderTradeMarketTab(myId, sortBy) {
  // League-wide list of blocked players (excluding yours)
  const all = [];
  for (const t of TEAMS) {
    if (t.id === myId) continue;
    for (const p of (franchise.rosters[t.id]||[])) {
      if (p.onTradeBlock) all.push({ p, t });
    }
  }
  // Sort
  const sorter = (a,b) => {
    if (sortBy === "grade") return scoutGrade(b.p) - scoutGrade(a.p);
    if (sortBy === "age")   return (a.p.age||0) - (b.p.age||0);
    if (sortBy === "aav")   return (b.p.contract?.aav||0) - (a.p.contract?.aav||0);
    if (sortBy === "pos")   return (a.p.position||"").localeCompare(b.p.position||"");
    return 0;
  };
  all.sort(sorter);

  if (!all.length) return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">No players currently on the league trade block.</div>`;

  const rows = all.map(({p, t}) => {
    const ask = p.blockAsk;
    const askPieces = [];
    if (ask?.askedPicks) {
      for (const [r, n] of Object.entries(ask.askedPicks)) {
        if (n > 0) askPieces.push(`${n}× R${r}`);
      }
    }
    if (ask?.refund && ask.refund.amount > 0) {
      const sign = (ask.refund.direction||"theyPay") === "theyPay" ? "+" : "−";
      askPieces.push(`${sign}$${ask.refund.amount.toFixed(1)}M×${ask.refund.years}yr`);
    }
    if (ask?.minPlayerGrade) askPieces.push(`${ask.minPlayerGrade}+ player`);
    const askLabel = askPieces.length
      ? `<span style="color:var(--gold-lt);font-size:.62rem">${askPieces.join(" + ")}</span>`
      : `<span style="color:var(--gray);font-size:.62rem;font-style:italic">no price set</span>`;
    return `<tr>
      <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
      <td style="font-weight:700">${p.name}</td>
      <td>${gradeBadge(p)}</td>
      <td style="color:var(--gray)">${p.age||"?"}</td>
      <td style="color:var(--gray);font-size:.66rem">${t.city} ${t.name}</td>
      <td>${askLabel}</td>
      <td><button class="btn btn-gold" style="font-size:.6rem;padding:.2rem .55rem"
        onclick="frnOpenTrade(${t.id},'propose')">→ Propose</button></td>
    </tr>`;
  }).join("");

  return `
    <div style="color:var(--gray);font-size:.72rem;margin-bottom:.5rem">
      ${all.length} player${all.length>1?"s":""} on the block league-wide. Click <b>Propose</b> to open a trade with their team.
    </div>
    <table class="frn-pre-roster-table">
      <thead><tr><th>Pos</th><th>Player</th><th>Grade</th><th>Age</th><th>Team</th><th>Asking</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function _renderTradeOffersTab() {
  const offers = (franchise.tradeOffers || []).slice().reverse();
  if (!offers.length) {
    return `<div style="color:var(--gray);font-size:.78rem;padding:1rem;text-align:center;font-style:italic">No trade offers in your inbox. Put players on the block to attract AI teams.</div>`;
  }
  return offers.map(o => {
    const fromTeam = getTeam(o.fromTeamId);
    const myRoster = franchise.rosters[franchise.chosenTeamId];
    const theirRoster = franchise.rosters[o.fromTeamId];
    const theyGive = o.theyGive.map(n => theirRoster.find(p => p.name === n)).filter(Boolean);
    const theyWant = o.theyWant.map(n => myRoster.find(p => p.name === n)).filter(Boolean);
    const statusBadge = o.status === "pending" ? ""
      : o.status === "accepted" ? `<span class="frn-offer-status accepted">ACCEPTED</span>`
      : o.status === "rejected" ? `<span class="frn-offer-status rejected">REJECTED</span>`
      : `<span class="frn-offer-status stale">STALE</span>`;
    // Build "they give" items: players + picks + refund
    const giveItems = [];
    for (const p of theyGive) {
      const kicker = p.contract?.tradeKicker || 0;
      giveItems.push(`<div class="frn-offer-player">
        <span style="color:var(--gold);font-size:.58rem;font-weight:700">${p.position}</span>
        <span style="font-weight:700">${p.name}</span>
        <span>${gradeBadge(p)}</span>
        <span style="color:var(--gray);font-size:.62rem">${p.age||"?"}</span>
        ${kicker >= 0.05 ? `<span style="color:#e8a000;font-size:.55rem;font-weight:700" title="Trade kicker — one-time cap hit you'll absorb">⚡ $${kicker.toFixed(1)}M kicker</span>` : ""}
      </div>`);
    }
    if (o.pickIds && o.pickIds.length) {
      // Group by round for display
      const byRd = {};
      for (const pid of o.pickIds) {
        const [yr, rd] = pid.split("-");
        const k = `${yr}-${rd}`;
        byRd[k] = (byRd[k] || 0) + 1;
      }
      for (const [k, count] of Object.entries(byRd)) {
        const [yr, rd] = k.split("-");
        giveItems.push(`<div class="frn-offer-player">
          <span style="color:#7fbfff;font-size:.58rem;font-weight:700">PICK</span>
          <span style="font-weight:700">${count>1?count+"× ":""}${yr} R${rd}</span>
        </div>`);
      }
    }
    if (o.absorb > 0) {
      giveItems.push(`<div class="frn-offer-player">
        <span style="color:var(--green-lt);font-size:.58rem;font-weight:700">ABSORB</span>
        <span style="font-weight:700" title="They absorb this much of your dead cap from the trade">$${o.absorb.toFixed(1)}M of your dead cap</span>
      </div>`);
    }

    const giveCol = `<div class="frn-offer-side">
      <div class="frn-offer-side-label" style="color:var(--green-lt)">THEY GIVE</div>
      ${giveItems.length ? giveItems.join("") : `<div style="color:var(--gray);font-style:italic;font-size:.65rem">No longer available</div>`}
      ${totalKicker >= 0.05 ? `<div style="color:#e8a000;font-size:.62rem;margin-top:.3rem;padding-top:.25rem;border-top:1px solid rgba(232,160,0,.2)">⚡ Kicker cap hit you absorb: <b>$${totalKicker.toFixed(1)}M</b></div>` : ""}
    </div>`;
    const totalDeadCap = theyWant.reduce((s, p) => s + (p.contract?.bonusProration||0) * (p.contract?.remaining||0), 0);
    const totalKicker  = theyGive.reduce((s, p) => s + (p.contract?.tradeKicker||0), 0);
    const wantCol = `<div class="frn-offer-side">
      <div class="frn-offer-side-label" style="color:var(--gold-lt)">THEY WANT</div>
      ${theyWant.length ? theyWant.map(p => {
        const dead = (p.contract?.bonusProration||0) * (p.contract?.remaining||0);
        return `<div class="frn-offer-player">
          <span style="color:var(--gold);font-size:.58rem;font-weight:700">${p.position}</span>
          <span style="font-weight:700">${p.name}</span>
          <span>${gradeBadge(p)}</span>
          <span style="color:var(--gray);font-size:.62rem">${p.age||"?"}</span>
          ${dead >= 0.05 ? `<span style="color:#ff9090;font-size:.55rem;font-weight:700" title="Dead cap you'll absorb">☠ $${dead.toFixed(1)}M dead</span>` : ""}
        </div>`;
      }).join("") : `<div style="color:var(--gray);font-style:italic;font-size:.65rem">No longer available</div>`}
      ${totalDeadCap >= 0.05 ? `<div style="color:#ff9090;font-size:.62rem;margin-top:.3rem;padding-top:.25rem;border-top:1px solid rgba(255,100,100,.2)">☠ Total dead cap absorbed: <b>$${totalDeadCap.toFixed(1)}M</b></div>` : ""}
    </div>`;
    return `<div class="frn-offer-card ${o.status}">
      <div class="frn-offer-head">
        <div>
          <div style="font-weight:900">${fromTeam?.city||"?"} ${fromTeam?.name||"?"}</div>
          <div style="color:var(--gray);font-size:.65rem">
            ${o.isFromAsk ? "💰 Meeting your ask" : o.isCounter ? "📬 Counter" : "Offer"} · Week ${o.week}
          </div>
        </div>
        ${statusBadge}
      </div>
      <div class="frn-offer-bodies">
        ${giveCol}
        <div class="frn-offer-arrow">⇄</div>
        ${wantCol}
      </div>
      ${o.status === "pending" ? `
        <div class="frn-offer-actions">
          <button class="btn btn-gold" onclick="frnAcceptOffer('${o.id}')">✓ Accept</button>
          <button class="btn btn-outline" onclick="frnRejectOffer('${o.id}')" style="color:var(--red)">✗ Reject</button>
        </div>` : ""}
    </div>`;
  }).join("");
}

// ── Annual Draft ──────────────────────────────────────────────────────────────
// 7 rounds × 32 teams = 224 picks. Pick order = reverse standings (worst
// team picks first). Class quality tapers across rounds — round 1 is
// stocked with elite/good prospects; later rounds are mostly poor. User
// picks for their team; AI auto-picks for others between user turns.
// After the final pick, remaining roster gaps are filled with UDFAs.
function frnGoToDraft() {
  const rookieYear = (new Date().getFullYear()) + (franchise.season || 1);
  franchise.draft = {
    class: _buildDraftClass(rookieYear),
    pickOrder: _buildDraftPickOrder(),
    picks: [],
    currentIdx: 0,
    targets: [],
    boardFilter: "ALL",
    _targetGone: [],
  };
  franchise.phase = "draft";
  saveFranchise();
  renderFrnDraft();
}

function _buildDraftClass(rookieYear) {
  const allTaken = new Set();
  for (const r of Object.values(franchise.rosters)) r.forEach(p => allTaken.add(p.name));
  // Mixed-position pool (will be drawn at random per round)
  const positions = [
    "QB","QB","QB","RB","RB","RB","RB","WR","WR","WR","WR","WR","WR",
    "TE","TE","TE","OL","OL","OL","OL","OL","OL","OL","OL",
    "DL","DL","DL","DL","DL","LB","LB","LB","LB",
    "CB","CB","CB","CB","S","S","K","P",
  ];
  const tierByRound = {
    1: () => Math.random() < 0.35 ? "elite" : "good",
    2: () => Math.random() < 0.20 ? "good"  : "average",
    3: () => Math.random() < 0.40 ? "average" : "poor",
    4: () => "poor", 5: () => "poor", 6: () => "poor", 7: () => "poor",
  };
  const cls = [];
  for (let round = 1; round <= 7; round++) {
    for (let pick = 1; pick <= 32; pick++) {
      const pos = positions[Math.floor(Math.random() * positions.length)];
      const tier = tierByRound[round]();
      const p = genUniquePlayer(pos, tier, allTaken);
      allTaken.add(p.name);
      p.age = 21 + Math.floor(Math.random() * 3);
      p.draftYear = rookieYear;
      p.draftSeason = (franchise?.season || 1) + 1;
      p.isProspect = true;
      cls.push(p);
    }
  }
  // Shuffle within each tier so positions feel mixed
  cls.sort((a,b) => (b.overall || 0) - (a.overall || 0));
  return cls;
}

function _buildDraftPickOrder() {
  // Pick slot order = reverse standings of ORIGINAL pick owner; worst
  // team's pick goes 1.1. But the actual team making the pick is the
  // CURRENT owner of that pick (whoever traded for it).
  const sorted = TEAMS.slice().sort((a, b) => {
    const sa = franchise.standings?.[a.id] || { w:0, l:0, pf:0, pa:0 };
    const sb = franchise.standings?.[b.id] || { w:0, l:0, pf:0, pa:0 };
    const diffA = (sa.pf||0) - (sa.pa||0);
    const diffB = (sb.pf||0) - (sb.pa||0);
    return (sa.w - sa.l) - (sb.w - sb.l) || (diffA - diffB);
  });
  // Use upcoming draft year (season + 1 in real-clock terms)
  const draftYear = (new Date().getFullYear()) + (franchise.season || 1);
  _ensurePicksForYear(draftYear);
  const order = [];
  for (let r = 1; r <= 7; r++) {
    for (const origTeam of sorted) {
      const pick = (franchise.picks || []).find(p =>
        p.year === draftYear && p.round === r && p.originalTeamId === origTeam.id);
      const ownerId = pick?.currentOwnerId ?? origTeam.id;
      order.push({ round: r, teamId: ownerId, originalTeamId: origTeam.id, year: draftYear });
    }
  }
  return order;
}

// ── Draft UI helpers ──────────────────────────────────────────────────────────

const _DRAFT_NFL_COMPS = {
  QB: { POCKET:"Stafford-type arm", GUNSLINGER:"Gunslinger — Favre comp", GAME_MANAGER:"Alex Smith comp", DUAL_THREAT:"Lamar Jackson-type", FIELD_GENERAL:"Peyton Manning IQ" },
  RB: { POWER:"Derrick Henry comp", ELUSIVE:"Barry Sanders type", SPEED:"Home-run hitter", WORKHORSE:"Every-down back", RECEIVING:"CMC receiving back" },
  WR: { DEEP_THREAT:"DeSean Jackson comp", POSSESSION:"Keenan Allen type", SLOT:"PPR machine", RED_ZONE:"Jump-ball threat", ROUTE_RUNNER:"Davante Adams type" },
  TE: { RECEIVING:"Travis Kelce comp", BLOCKING:"Old-school blocker", HYBRID:"Dual-threat TE" },
  OL: { ANCHOR:"Dominant run blocker", ATHLETIC:"Zone-scheme fit", TECHNICIAN:"Technique-first", PLUG:"Interior plug", MAULER:"Nasty road-grader" },
  DL: { POWER:"Penetrating 3-tech", SPEED:"Von Miller comp", TWEENER:"Versatile 5-tech", PENETRATOR:"Interior wrecker", TECHNICIAN:"Hand-fighter" },
  LB: { THUMPER:"Run-stuffer", COVER:"Coverage LB", BLITZER:"Blitz specialist", SIGNAL:"Mike LB anchor", HYBRID:"3-down athlete" },
  CB: { SHUTDOWN:"Island corner", BALL_HAWK:"INT machine", PHYSICAL:"Press corner", SLOT_CB:"Nickel specialist", ZONE:"Cover-2 corner" },
  S:  { BALL_HAWK:"Ed Reed comp", BOX:"Box enforcer", CENTER_FIELD:"True free safety", HYBRID:"Chess piece" },
  K:  { LEG:"Deep-range threat", PRECISION:"Automatic inside 50", CLUTCH:"Ice in his veins", BALANCED:"Reliable veteran" },
  P:  { BOOMER:"Distance punter", DIRECTIONAL:"Field-position artist", HANG_TIME:"Sky kick specialist", ATHLETE:"Fake-punt threat", BALANCED:"Consistent performer" },
};
function _draftNFLComp(p) { return (_DRAFT_NFL_COMPS[p.position] || {})[p.archetype] || ""; }

// Compact position-specific combine string.
function _draftCombineStr(p) {
  const m = combineMeasurables(p);
  const pos = p.position;
  const [,,,,thr=50,,,,,, kpw=50] = p.stats || [];
  if (pos === "QB") { const arm = Math.round(55 + (thr - 50) * 0.55); return `${m.fortyTime}s · ${arm}yd arm`; }
  if (pos === "RB") return `${m.fortyTime}s · ${m.coneTime} cone`;
  if (pos === "WR") return `${m.fortyTime}s · ${m.verticalIn}" vert`;
  if (pos === "TE") return `${m.fortyTime}s · ${m.benchReps} reps`;
  if (pos === "OL") return `${m.benchReps} reps · ${m.coneTime} cone`;
  if (pos === "DL") return `${m.fortyTime}s · ${m.benchReps} reps`;
  if (pos === "LB") return `${m.fortyTime}s · ${m.verticalIn}" vert`;
  if (pos === "CB") return `${m.fortyTime}s · ${m.coneTime} cone`;
  if (pos === "S")  return `${m.fortyTime}s · ${m.verticalIn}" vert`;
  if (pos === "K" || pos === "P") return `Leg: ${kpw}`;
  return `${m.fortyTime}s`;
}

// 0=fine  1=need (starter <75 OVR)  2=critical (no starter or <68 OVR)
function _draftNeedLevel(teamId, pos) {
  const best = (franchise.rosters[teamId] || [])
    .filter(p => p.position === pos).sort((a,b) => b.overall - a.overall)[0];
  if (!best) return 2;
  if (best.overall < 68) return 2;
  if (best.overall < 75) return 1;
  return 0;
}

// Returns {pos, cnt} if ≥3 of same position taken in last `lookback` picks, else null.
function _draftPositionRun(picks, lookback = 6) {
  const recent = picks.slice(-lookback).map(p => p.pos);
  const counts = {};
  for (const pos of recent) counts[pos] = (counts[pos] || 0) + 1;
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];
  return top && top[1] >= 3 ? { pos: top[0], cnt: top[1] } : null;
}

// Coloured position pill HTML (inline styles, no extra class dependencies).
function _posPillHtml(pos) {
  const s = { QB:"background:#1a2d7c;color:#91b4ff", RB:"background:#1a4d2a;color:#7dff97",
    WR:"background:#1a4d2a;color:#7dff97", TE:"background:#1a4d2a;color:#7dff97",
    OL:"background:#5c3200;color:#ffb347", DL:"background:#5a1515;color:#ff8080",
    LB:"background:#5a1515;color:#ff8080", CB:"background:#301a6b;color:#c090ff",
    S:"background:#301a6b;color:#c090ff",  K:"background:#2a2a2a;color:#999",
    P:"background:#2a2a2a;color:#999" }[pos] || "background:#222;color:#aaa";
  return `<span style="${s};padding:.07rem .27rem;font-size:.54rem;font-weight:900;letter-spacing:.3px">${pos}</span>`;
}

function renderFrnDraft() {
  const d = franchise.draft;
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);

  // Auto-advance AI picks until it's user's turn or draft is over
  let aiAdvanced = 0;
  while (d.currentIdx < d.pickOrder.length) {
    const slot = d.pickOrder[d.currentIdx];
    if (slot.teamId === myId) break;
    _aiAutoPick(slot);
    d.currentIdx++;
    aiAdvanced++;
    if (aiAdvanced > 250) break;
  }

  if (d.currentIdx >= d.pickOrder.length) {
    const myPicksFinal = d.picks.filter(pk => pk.teamId === myId);
    _draftFinalize();
    _renderPostDraftGrade(myPicksFinal);
    return;
  }
  if (aiAdvanced > 0) _flushSaveFranchise();

  const currentSlot = d.pickOrder[d.currentIdx];
  const round = currentSlot.round;
  const pickInRound = (d.currentIdx % 32) + 1;
  const dayLabel = round <= 2 ? "DAY 1 · PRIMETIME" : round === 3 ? "DAY 2" : "DAY 3";
  const filter = d.boardFilter || "ALL";

  // Build available pool
  const taken = new Set(d.picks.map(p => p.prospectName));
  const allAvail = d.class.filter(p => !taken.has(p.name))
    .sort((a,b) => scoutGrade(b) - scoutGrade(a));
  const filtered = filter === "K/P" ? allAvail.filter(p => p.position==="K"||p.position==="P")
    : filter === "ALL" ? allAvail : allAvail.filter(p => p.position === filter);
  const board = filtered.slice(0, 45);
  const targets = new Set(d.targets || []);

  // Collect and clear target-gone alerts
  const gone = (d._targetGone || []).splice(0);

  // Position run
  const posRun = _draftPositionRun(d.picks);

  // ── Filter tabs ──────────────────────────────────────────────────────────
  const TABS = ["ALL","QB","RB","WR","TE","OL","DL","LB","CB","S","K/P"];
  const filterHtml = TABS.map(f => {
    const cnt = f==="ALL" ? allAvail.length
      : f==="K/P" ? allAvail.filter(p=>p.position==="K"||p.position==="P").length
      : allAvail.filter(p=>p.position===f).length;
    return `<button class="frn-draft-filter-btn${filter===f?" active":""}" onclick="frnDraftSetFilter('${f}')">${f} <span style="opacity:.55;font-size:.52rem">${cnt}</span></button>`;
  }).join("");

  // ── Prospect board ───────────────────────────────────────────────────────
  const boardHtml = board.length ? board.map((p, i) => {
    const esc = (p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const needLvl = _draftNeedLevel(myId, p.position);
    const needBadge = needLvl===2 ? `<span class="frn-draft-need-crit">❗NEED</span>`
                    : needLvl===1 ? `<span class="frn-draft-need-need">⚠ NEED</span>` : "";
    const isTargeted = targets.has(p.name);
    const potTag = potentialTag(p);
    const comp = _draftNFLComp(p);
    const arch = _archetypeLabel(p) || "—";
    const meta = comp ? `${arch} · ${comp}` : arch;
    return `<div class="frn-draft-prospect${isTargeted?" targeted":""}">
      <div class="frn-dp-rank">#${i+1}</div>
      <div class="frn-dp-body">
        <div class="frn-dp-top">
          <span class="frn-dp-name">${p.name}</span>
          ${_posPillHtml(p.position)}
          ${needBadge}
          ${gradeBadge(p)}
          ${potTag?`<span style="font-size:.56rem;color:var(--gold-lt)">${potTag}</span>`:""}
          <span style="color:var(--gray);font-size:.56rem">Age ${p.age}</span>
        </div>
        <div class="frn-dp-bottom">
          <span class="frn-dp-meta">${meta}</span>
          <span class="frn-dp-combine"> · ${_draftCombineStr(p)}</span>
        </div>
      </div>
      <div class="frn-dp-actions">
        <button class="frn-draft-target-btn${isTargeted?" active":""}" onclick="frnDraftToggleTarget('${esc}')" title="${isTargeted?"Remove target":"Mark as target"}">★</button>
        <button class="btn btn-gold" style="padding:.2rem .5rem;font-size:.6rem" onclick="frnDraftPick('${esc}')">DRAFT</button>
      </div>
    </div>`;
  }).join("") : `<div style="color:var(--gray);font-size:.7rem;padding:.5rem">No ${filter!=="ALL"?filter:""} prospects available</div>`;

  // ── Live ticker ──────────────────────────────────────────────────────────
  const tickerHtml = d.picks.length ? d.picks.slice().reverse().slice(0,30).map(pk => {
    const team = getTeam(pk.teamId);
    const isMe = pk.teamId === myId;
    return `<div class="frn-draft-ticker-item${isMe?" my-pick":""}">
      <span class="frn-draft-ticker-pick-no">${pk.round}.${(((pk.pick-1)%32)+1)}</span>
      <span><span style="font-weight:700">${pk.prospectName}</span><span style="color:var(--gray);font-size:.57rem"> · ${pk.pos}</span></span>
      <span style="color:var(--gray);font-size:.6rem">${team?.name||"?"}</span>
    </div>`;
  }).join("") : `<div style="color:var(--gray);font-size:.64rem;font-style:italic">No picks yet</div>`;

  // ── Team needs ───────────────────────────────────────────────────────────
  const needsHtml = ["QB","RB","WR","TE","OL","DL","LB","CB","S"].map(pos => {
    const top = (franchise.rosters[myId]||[]).filter(p=>p.position===pos).sort((a,b)=>b.overall-a.overall)[0];
    const lvl = _draftNeedLevel(myId, pos);
    const badge = lvl===2 ? `<span style="color:#ff9090;font-size:.53rem;font-weight:700">CRITICAL</span>`
      : lvl===1 ? `<span style="color:var(--gold);font-size:.53rem;font-weight:700">NEED</span>`
      : `<span style="color:var(--gray);font-size:.53rem">OK</span>`;
    return `<div class="frn-draft-need-row">
      <span style="font-weight:700;font-size:.64rem;min-width:2rem">${pos}</span>
      <span style="color:var(--gray);font-size:.58rem">${top?`OVR ${top.overall}`:"—"}</span>
      <span style="margin-left:auto">${badge}</span>
    </div>`;
  }).join("");

  // ── Your class ───────────────────────────────────────────────────────────
  const myPicks = d.picks.filter(pk=>pk.teamId===myId);
  const myPicksHtml = myPicks.length ? myPicks.map(pk=>`
    <div class="frn-draft-ticker-item my-pick">
      <span class="frn-draft-ticker-pick-no">R${pk.round}.${(((pk.pick-1)%32)+1)}</span>
      <span style="font-weight:700">${pk.prospectName}</span>
      <span style="color:var(--gold);font-size:.57rem">${pk.pos}</span>
    </div>`).join("")
    : `<div style="color:var(--gray);font-size:.63rem;font-style:italic;padding:.25rem 0">No picks yet</div>`;

  // ── Alerts ───────────────────────────────────────────────────────────────
  const alertsHtml = gone.map(t=>{
    const team = getTeam(t.teamId);
    return `<div class="frn-draft-target-gone">📌 TARGET GONE — ${t.name} taken by ${team?.name||"?"} at ${t.round}.${t.pick}</div>`;
  }).join("");

  // ── Render ───────────────────────────────────────────────────────────────
  $("frnHomeContent").innerHTML = `
    <div style="display:flex;align-items:center;gap:.55rem;margin-bottom:.55rem;flex-wrap:wrap">
      <span style="font-size:1rem;font-weight:900;color:var(--gold)">📋 DRAFT · Season ${franchise.season+1}</span>
      <span class="frn-draft-day-badge">${dayLabel}</span>
      <span style="color:var(--gray);font-size:.7rem">Pick ${d.currentIdx+1} of ${d.pickOrder.length}</span>
    </div>
    ${posRun?`<div class="frn-draft-run-alert">🔥 ${posRun.pos} RUN — ${posRun.cnt} taken in last 6 picks · value elsewhere</div>`:""}
    ${alertsHtml}
    <div style="display:grid;grid-template-columns:1fr 270px;gap:.65rem;align-items:start">
      <div>
        <div class="frn-draft-clock-card">
          <div>
            <div style="font-size:.58rem;color:var(--gold);letter-spacing:.6px">ROUND ${round} · PICK ${pickInRound}</div>
            <div style="font-size:1.15rem;font-weight:900;color:var(--gold-lt)">YOU ARE ON THE CLOCK</div>
            <div style="color:var(--gray);font-size:.73rem">${myTeam?.city} ${myTeam?.name}</div>
          </div>
          <button class="btn btn-outline" style="font-size:.6rem;padding:.22rem .55rem;white-space:nowrap"
            onclick="frnSimRound()">⏭ Sim Rest of R${round}</button>
        </div>
        <div class="frn-draft-filters">${filterHtml}</div>
        <div class="frn-draft-board">${boardHtml}</div>
      </div>
      <div class="frn-draft-info-panel">
        <div class="frn-draft-info-card">
          <div class="frn-card-title" style="margin-bottom:.35rem">TEAM NEEDS</div>
          ${needsHtml}
        </div>
        <div class="frn-draft-info-card">
          <div class="frn-card-title" style="margin-bottom:.25rem">YOUR CLASS (${myPicks.length})</div>
          ${myPicksHtml}
        </div>
        <div class="frn-draft-info-card">
          <div class="frn-card-title" style="margin-bottom:.25rem">LIVE PICKS</div>
          <div class="frn-draft-ticker">${tickerHtml}</div>
        </div>
      </div>
    </div>`;
}

function frnDraftSetFilter(pos) {
  if (franchise.draft) { franchise.draft.boardFilter = pos; renderFrnDraft(); }
}

function frnDraftToggleTarget(name) {
  if (!franchise.draft) return;
  franchise.draft.targets = franchise.draft.targets || [];
  const idx = franchise.draft.targets.indexOf(name);
  if (idx >= 0) franchise.draft.targets.splice(idx, 1);
  else franchise.draft.targets.push(name);
  renderFrnDraft();
}

// Sim all remaining CPU picks in the current round, including the user's
// current pick. Pauses at the start of the next round (or end of draft).
function frnSimRound() {
  const d = franchise.draft;
  if (!d) return;
  const myId = franchise.chosenTeamId;
  const curRound = d.pickOrder[d.currentIdx]?.round;
  if (!curRound) return;
  while (d.currentIdx < d.pickOrder.length) {
    const slot = d.pickOrder[d.currentIdx];
    if (slot.round !== curRound) break;
    _aiAutoPick(slot);
    d.currentIdx++;
  }
  _flushSaveFranchise();
  renderFrnDraft();
}

// ── Post-draft grade screen ───────────────────────────────────────────────────
function _renderPostDraftGrade(myPicks) {
  const myTeam = getTeam(franchise.chosenTeamId);
  const roundExp = {1:80,2:72,3:65,4:58,5:54,6:50,7:47};
  const scored = myPicks.map(pk => {
    const prospect = (franchise.rosters[franchise.chosenTeamId]||[]).find(p=>p.name===pk.prospectName) || {};
    const sg = scoutGrade({...prospect, overall: prospect.overall||60, name:pk.prospectName});
    const exp = roundExp[pk.round]||58;
    return {...pk, sg, delta: sg - exp};
  });
  const avg = scored.length ? scored.reduce((s,p)=>s+p.sg,0)/scored.length : 60;
  const [letter, col] = avg>=82?["A+","#ffe066"]:avg>=77?["A","#ffe066"]:avg>=72?["A-","#ffcc44"]
    :avg>=68?["B+","#aaffaa"]:avg>=63?["B","#aaffaa"]:avg>=58?["B-","#aaffaa"]
    :avg>=53?["C+","#aaaaff"]:avg>=48?["C","#aaaaff"]:avg>=43?["D","#ffaaaa"]:["F","#ff7070"];
  const quotes = {
    "A+":["A dominant class — every pick fills a need at above-market value.","This front office absolutely crushed it. Best haul in the league."],
    "A": ["Strong class top to bottom — smart picks and good value throughout.","Hard to find a real miss here. Solid first-round value."],
    "A-":["Above-average class with a few steals in the later rounds.","Front office did their homework. The late-round picks stand out."],
    "B+":["Solid draft — some good value picks mixed with a couple of reaches.","Addressed the biggest needs. Nothing flashy but very functional."],
    "B": ["Decent class overall — some early-round questions but later rounds were smart.","A wait-and-see draft. Could look better or worse in two years."],
    "B-":["Mixed bag — reached early but steadied in the middle rounds.","Serviceable draft. A few picks that raise eyebrows but nothing catastrophic."],
    "C+":["Underwhelming — value wasn't there in the early rounds.","The fourth and fifth rounds might save this class from a C."],
    "C": ["A forgettable draft. Reached too often, left better players on the board.","Hard to find a signature pick here. Needs work in the next class."],
    "D": ["Poor draft — value misses and few needs addressed.","Front office left a lot of talent on the board. Concerning."],
    "F": ["A historically bad class — reaches at every level.","This front office has some serious explaining to do."],
  };
  const qList = quotes[letter]||quotes["C"];
  const quote = qList[Math.floor(Math.random()*qList.length)];
  const sortedByDelta = scored.slice().sort((a,b)=>b.delta-a.delta);
  const bestVal  = sortedByDelta[0];
  const bigReach = sortedByDelta[sortedByDelta.length-1];
  const picksHtml = scored.sort((a,b)=>a.pick-b.pick).map(pk=>{
    const tag = pk.delta>=6 ? `<span style="color:var(--green-lt);font-size:.56rem;font-weight:700">★ VALUE</span>`
              : pk.delta<=-6? `<span style="color:#ff9090;font-size:.56rem;font-weight:700">▼ REACH</span>` : "";
    const sg = pk.sg;
    const fakeP = {name:pk.prospectName||"",overall:sg,stats:[]};
    return `<div class="frn-draft-pick-review">
      <span class="frn-draft-ticker-pick-no">R${pk.round}.${(((pk.pick-1)%32)+1)}</span>
      <span style="font-weight:700">${pk.prospectName}</span>
      <span style="color:var(--gold);font-size:.6rem">${pk.pos}</span>
      <span>${tag||gradeBadge(fakeP)}</span>
    </div>`;
  }).join("");
  $("frnHomeContent").innerHTML = `
    <div style="max-width:540px;margin:0 auto">
      <div class="frn-draft-grade-card">
        <div style="font-size:.58rem;letter-spacing:1px;color:var(--gray);margin-bottom:.3rem">DRAFT CLASS · ${myTeam?.city} ${myTeam?.name}</div>
        <div class="frn-draft-grade-letter" style="color:${col}">${letter}</div>
        <div style="color:var(--gray);font-size:.76rem;font-style:italic;max-width:360px;margin:0 auto .8rem">"${quote}"</div>
        ${bestVal?.delta>=4?`<div style="font-size:.63rem;color:var(--green-lt);margin-bottom:.15rem">★ Best value: ${bestVal.prospectName} (R${bestVal.round})</div>`:""}
        ${bigReach?.delta<=-4?`<div style="font-size:.63rem;color:#ff9090;margin-bottom:.5rem">▼ Biggest reach: ${bigReach.prospectName} (R${bigReach.round})</div>`:""}
      </div>
      <div style="margin-top:.65rem;background:var(--bg2);border:1px solid var(--border);padding:.5rem .65rem">
        <div class="frn-card-title" style="margin-bottom:.25rem">YOUR CLASS (${myPicks.length} picks)</div>
        ${picksHtml||`<div style="color:var(--gray);font-size:.7rem;font-style:italic">No picks made</div>`}
      </div>
      <div style="margin-top:.75rem;text-align:center">
        <button class="btn btn-gold-big" onclick="frnDraftContinueToSeason()">▶ BEGIN NEW SEASON</button>
      </div>
    </div>`;
}

function frnDraftContinueToSeason() { frnNewSeason(); }

// Position value premium — how much each position is worth above its
// raw OVR in AI draft scoring. Reflects NFL "premier position" reality
// where QB / OT / EDGE / CB go higher than equally-rated RB/S/etc.
const _DRAFT_POS_PREMIUM = {
  QB: 8, OL: 5, DL: 4, CB: 4, WR: 3,
  LB: 1, TE: 0, S: 0, RB: -2, K: -4, P: -5,
};
// Scheme fit — if the team's playbook favors a position group, give a
// modest bump to prospects of that position.
function _draftSchemeBonus(teamId, pos) {
  const pb = (typeof getPlaybook === "function") ? getPlaybook(getTeam(teamId)) : null;
  if (!pb) return 0;
  const id = pb.id || "";
  if (id === "AIR_RAID"         && (pos === "QB" || pos === "WR")) return 3;
  if (id === "GROUND_AND_POUND" && (pos === "RB" || pos === "OL")) return 3;
  if (id === "DUAL_THREAT"      && (pos === "QB" || pos === "WR")) return 2;
  if (id === "OPTION"           && (pos === "QB" || pos === "RB")) return 3;
  return 0;
}
function _aiAutoPick(slot) {
  const taken = new Set(franchise.draft.picks.map(p => p.prospectName));
  const available = franchise.draft.class.filter(p => !taken.has(p.name));
  if (!available.length) return;
  // Score by overall + position need (weaker starter = bonus) +
  // positional value premium + scheme fit + tiny random.
  const roster = franchise.rosters[slot.teamId] || [];
  const startersByPos = {};
  for (const pos of Object.keys(ROSTER_SLOTS)) {
    const arr = roster.filter(p => p.position === pos).sort((a,b)=>b.overall-a.overall);
    startersByPos[pos] = arr[0]?.overall || 50;
  }
  const scored = available.map(p => {
    const needBonus = Math.max(0, 75 - (startersByPos[p.position] || 50));
    const posPrem  = _DRAFT_POS_PREMIUM[p.position] ?? 0;
    const scheme   = _draftSchemeBonus(slot.teamId, p.position);
    return { p, score: (p.overall || 60) + needBonus * 0.20 + posPrem + scheme + Math.random() * 4 };
  }).sort((a,b) => b.score - a.score);
  const pick = scored[0].p;
  pick.draftRound = slot.round;
  pick.draftPick  = ((franchise.draft.currentIdx) % 32) + 1;
  _rollHiddenGem(pick);
  pick.contract = rookieContract(pick, franchise.salaryCap || SALARY_CAP_BASE);
  pick.careerEarnings = 0;
  delete pick.isProspect;
  franchise.rosters[slot.teamId].push(pick);
  franchise.draft.picks.push({
    pick: franchise.draft.currentIdx + 1, round: slot.round,
    teamId: slot.teamId, prospectName: pick.name, pos: pick.position,
  });
  // Alert user if one of their targets was just stolen.
  if (franchise.draft.targets?.includes(pick.name)) {
    franchise.draft._targetGone = franchise.draft._targetGone || [];
    franchise.draft._targetGone.push({ name: pick.name, teamId: slot.teamId, round: slot.round, pick: pick.draftPick });
  }
}

function frnDraftPick(name) {
  const d = franchise.draft;
  const slot = d.pickOrder[d.currentIdx];
  if (slot.teamId !== franchise.chosenTeamId) return;
  const prospect = d.class.find(p => p.name === name);
  if (!prospect) return;
  // Draft info first — rookieContract() reads draftRound + draftPick.
  prospect.draftRound = slot.round;
  prospect.draftPick  = ((d.currentIdx) % 32) + 1;
  _rollHiddenGem(prospect);
  prospect.contract = rookieContract(prospect, franchise.salaryCap || SALARY_CAP_BASE);
  prospect.careerEarnings = 0;
  delete prospect.isProspect;
  franchise.rosters[slot.teamId].push(prospect);
  d.picks.push({
    pick: d.currentIdx + 1, round: slot.round,
    teamId: slot.teamId, prospectName: prospect.name, pos: prospect.position,
  });
  d.currentIdx++;
  saveFranchise();
  _pushNews({ type:"draft", label: `📋 You drafted ${prospect.name} (${prospect.position}) — R${slot.round}.${((d.currentIdx-1) % 32) + 1}` });
  renderFrnDraft();
}

function _draftFinalize() {
  // Fill remaining roster gaps with UDFAs
  const rookieYear = (new Date().getFullYear()) + (franchise.season || 1);
  for (const t of TEAMS) {
    const roster = franchise.rosters[t.id];
    const taken = new Set(roster.map(p => p.name));
    for (const [pos, needed] of Object.entries(ROSTER_SLOTS)) {
      const have = roster.filter(p => p.position === pos).length;
      for (let i = have; i < needed; i++) {
        const udfa = genUniquePlayer(pos, "poor", taken);
        udfa.age = 22;
        udfa.draftRound = 0; udfa.draftPick = null;
        udfa.draftYear = rookieYear;
        _rollHiddenGem(udfa);
        udfa.draftSeason = (franchise?.season || 1) + 1;
        udfa.careerEarnings = 0;
        udfa.contract = rookieContract(udfa, franchise.salaryCap || SALARY_CAP_BASE);
        roster.push(udfa);
        taken.add(udfa.name);
      }
    }
  }
  // Consume this draft's picks from inventory; mint a new future year
  // of picks so each team always has 3 years of capital tradable.
  const draftYear = rookieYear;
  franchise.picks = (franchise.picks || []).filter(p => p.year !== draftYear);
  const lastYear = (franchise.picks || []).reduce((m,p) => Math.max(m, p.year), draftYear);
  _ensurePicksForYear(lastYear + 1);
  franchise.draft = null;
  _flushSaveFranchise();
}

// Roll this season's per-game-aggregated stats into each player's
// career totals + season-by-season log. Called once at end-of-season,
// before seasonStats is wiped.
function _rollSeasonStatsToCareer() {
  const ss = franchise.seasonStats || {};
  for (const [tIdStr, players] of Object.entries(ss)) {
    const teamId = Number(tIdStr);
    const team = getTeam(teamId);
    const teamName = team ? `${team.city} ${team.name}` : "?";
    const roster = franchise.rosters[teamId] || [];
    for (const [name, st] of Object.entries(players)) {
      const player = roster.find(p => p.name === name);
      if (!player) continue;
      if (!player.careerStats)   player.careerStats   = {};
      if (!player.careerHistory) player.careerHistory = [];
      // Accumulate every numeric stat field
      for (const [k, v] of Object.entries(st)) {
        if (typeof v !== "number") continue;
        player.careerStats[k] = (player.careerStats[k] || 0) + v;
      }
      // Snapshot this season as a row
      const yearRow = { season: franchise.season, teamId, teamName, overall: player.overall };
      for (const [k, v] of Object.entries(st)) {
        if (typeof v === "number" || k === "pos") yearRow[k] = v;
      }
      player.careerHistory.push(yearRow);
      if (player.careerHistory.length > 20) player.careerHistory = player.careerHistory.slice(-20);
    }
  }
}

// ── Abandon franchise ─────────────────────────────────────────────────────────
function frnAbandon() {
  if (!confirm("Abandon this franchise? All progress will be lost.")) return;
  franchise = null;
  try { localStorage.removeItem(FRANCHISE_KEY); } catch(e) {}
  renderFrnStartScreen();
}

// ── Wire mode tabs + initial setup ────────────────────────────────────────────
$("modeFranchiseBtn").addEventListener("click", () => setAppMode("franchise"));
$("modeTestingBtn").addEventListener("click",   () => setAppMode("testing"));

// Default to franchise mode on page load
document.addEventListener("DOMContentLoaded", () => setAppMode("franchise"));
// If DOMContentLoaded already fired, run immediately
if (document.readyState !== "loading") setAppMode("franchise");

// ─── END FRANCHISE MODE ────────────────────────────────────────────────────

function renderDrives() {
  const r = gameResult; if (!r) return;
  $("driveLog").innerHTML = r.drives.map(d => `
    <div class="drive-entry">
      <span class="drive-team-${d.team}">
        ${d.team === "home" ? r.homeTeam.name : r.awayTeam.name}
      </span>
      <span class="${d.result === "TD" ? "drive-result-td" : ""}" style="color:var(--gray);">
        ${d.result} · ${d.homeScore}–${d.awayScore}
      </span>
    </div>
  `).join("");
}
