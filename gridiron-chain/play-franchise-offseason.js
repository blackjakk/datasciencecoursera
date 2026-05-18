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

// Baseline league records. Starting the record book empty meant any
// non-zero stat became the record, then every above-average game after
// "broke" it — 50 rushing yards setting the bar, then 83 toppling it.
// Seeded as "LEAGUE HISTORICAL" holders so the broken-by display still
// shows a prior holder.
const _RECORD_BASELINES_SINGLE_GAME = {
  pass_yds: 425, pass_td: 6, pass_comp: 36,
  rush_yds: 195, rush_td: 4,
  rec_yds: 215, rec_td: 4, rec: 13,
  sk: 4, int_made: 3, tkl: 17,
  fg_made: 6, fg_long: 57,
  pancakes: 5,
};
const _RECORD_BASELINES_SINGLE_SEASON = {
  pass_yds: 4500, pass_td: 38, pass_comp: 400,
  rush_yds: 1700, rush_td: 16,
  rec_yds: 1500, rec_td: 13, rec: 100,
  sk: 18, int_made: 8, tkl: 140,
  fg_made: 35,
  pancakes: 50,
};

function _ensureRecordBook() {
  if (!franchise.records) franchise.records = {};
  if (!franchise.records.singleGame)   franchise.records.singleGame = {};
  if (!franchise.records.singleSeason) franchise.records.singleSeason = {};
  if (!franchise.records.brokenLog)    franchise.records.brokenLog = [];
  // Seed any missing baseline; lift any active record below baseline so
  // existing saves don't keep getting "broken" by routine games. Holder
  // stamped as a league historical so the UI still has a name to show.
  const seed = (bucket, baselines) => {
    for (const [k, v] of Object.entries(baselines)) {
      const cur = bucket[k];
      if (!cur || (cur.value || 0) < v) {
        bucket[k] = {
          value: v,
          playerName: "League historical",
          pos: null, teamId: null, oppId: null,
          season: null, week: null, isPlayoff: false,
          _baseline: true,
        };
      }
    }
  };
  seed(franchise.records.singleGame,   _RECORD_BASELINES_SINGLE_GAME);
  seed(franchise.records.singleSeason, _RECORD_BASELINES_SINGLE_SEASON);
  // One-time prune: drop brokenLog entries whose "new" value is below
  // the league baseline — those came from the pre-seed era when any
  // non-zero stat became a record.
  if (!franchise.records._baselinesPruned) {
    const minVal = (key, recordType) =>
      (recordType === "single-game" ? _RECORD_BASELINES_SINGLE_GAME : _RECORD_BASELINES_SINGLE_SEASON)[key] || 0;
    franchise.records.brokenLog = franchise.records.brokenLog.filter(b => {
      const threshold = minVal(b.category, b.recordType);
      return (b["new"]?.value || 0) >= threshold;
    });
    franchise.records._baselinesPruned = true;
  }
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
  // Ensure baselines + prune have run before reading the broken log —
  // otherwise re-rendering the awards screen on an already-processed
  // season would never run the prune (it only happens inside the
  // first-time season update).
  _ensureRecordBook();
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
  // Stamp APB-scouted on every participating player. You watched them
  // play against top competition → grade noise sharpens to ±2 for the
  // rest of this season and the next. Lookup by name into the live
  // rosters (the live player object — APB rosters reference the same
  // refs but stamping by name is robust to trades / cuts mid-offseason).
  const participants = new Set([
    ...Object.values(r.stats?.home?.players || {}).map(p => p.name),
    ...Object.values(r.stats?.away?.players || {}).map(p => p.name),
  ]);
  for (const name of participants) {
    const live = _findPlayer(name);
    if (live) live._apbScoutedSeason = franchise.season;
  }
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

// User dismisses the Selections Reveal → tournament can begin.
function frnApbKickoff() {
  const t = franchise.allProBowlTournament;
  if (!t) return;
  t._selectionsAcknowledged = true;
  saveFranchise();
  renderAllProBowl();
}

// User dismisses the Crowning screen → start offseason. Stamps the
// dismiss flag so re-entering the page goes to the tournament recap
// (with the crowning still accessible via a button).
function frnApbProceedToOffseason() {
  const t = franchise.allProBowlTournament;
  if (t) { t._crowningDismissed = true; saveFranchise(); }
  startFrnOffseason();
}

// "View Crowning" button from the tournament view re-opens the crown
// screen by clearing the dismiss flag.
function frnApbReopenCrowning() {
  const t = franchise.allProBowlTournament;
  if (t) { t._crowningDismissed = false; saveFranchise(); }
  renderAllProBowl();
}

// "Review Tournament" from the crowning screen — keeps user inside APB
// but routes them to the bracket view (the standard tournament screen).
function frnApbReviewTournament() {
  const t = franchise.allProBowlTournament;
  if (t) { t._crowningDismissed = true; saveFranchise(); }
  renderAllProBowl();
}

// Apply end-of-tournament stakes — champion-side players get a
// "Pro Bowl Champion" accolade on this season's careerHistory row;
// tournament MVP already gets "All-Pro Bowl MVP" inside
// _apbAdvanceWinners. Both stakes are idempotent via "if not already
// in the list" checks. Called from the crowning screen render so
// they only apply once the user actually sees the champion crowned.
function _apbApplyChampionStakes(t) {
  if (!t || !t.complete || t._stakesApplied) return;
  const champ = t.teams.find(x => x.id === t.champion);
  if (!champ) return;
  for (const meta of (champ.rosterMeta || [])) {
    const p = _findPlayer(meta.name);
    if (!p) continue;
    const hist = p.careerHistory || (p.careerHistory = []);
    const row = hist.find(h => h.season === franchise.season);
    if (!row) continue;
    row.accolades = row.accolades || [];
    if (!row.accolades.includes("Pro Bowl Champion")) row.accolades.push("Pro Bowl Champion");
  }
  t._stakesApplied = true;
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

// ── Helper shared across all 3 APB views ────────────────────────────
function _apbLink(name) {
  return (typeof _playerLinkSmart === "function") ? _playerLinkSmart(name) : name;
}

// Click a played APB game → modal box score. Synthetic team IDs
// (-1000…) would break the regular renderFrnPastGame path, so build a
// purpose-specific modal with scoring summary + per-team totals + per-
// side top performers + per-game MVP.
function frnOpenApbBox(roundIdx, matchIdx) {
  const t = franchise.allProBowlTournament;
  const m = t?.rounds?.[roundIdx]?.[matchIdx];
  if (!m || !m.played) return;
  const home = _apbTeamById(m.homeId, t);
  const away = _apbTeamById(m.awayId, t);
  if (!home || !away) return;
  const myId = franchise.chosenTeamId;
  const roundName = t.roundLabels?.[roundIdx] || `Round ${roundIdx+1}`;
  const stats = m.stats || { home: { totals:{}, players:{} }, away: { totals:{}, players:{} } };
  const homeWon = m.winnerId === m.homeId;

  // Top performers per side (top 4 by mvpScore)
  const topSide = (side) => Object.values(side?.players || {})
    .map(p => ({ ...p, score: mvpScore(p) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  // Helper: get source team chip for a player by name (from rosterMeta).
  const srcOf = (name, side) => {
    const team = side === "home" ? home : away;
    return team.rosterMeta?.find(x => x.name === name) || null;
  };
  const isMine = (name, side) => srcOf(name, side)?.srcTeamId === myId;

  // Position-aware stat line — same shape as the crowning screen uses.
  const lineFor = (p) => {
    const s = p; const parts = [];
    if (p.pos === "QB") {
      if (s.pass_yds) parts.push(`${s.pass_yds} PYDS`);
      if (s.pass_td) parts.push(`${s.pass_td} TD`);
      if (s.pass_int) parts.push(`${s.pass_int} INT`);
      if (s.rush_yds) parts.push(`${s.rush_yds} RYDS`);
    } else if (p.pos === "RB") {
      if (s.rush_yds) parts.push(`${s.rush_yds} RYDS`);
      if (s.rush_td) parts.push(`${s.rush_td} TD`);
      if (s.rec) parts.push(`${s.rec}/${s.rec_yds||0}rec`);
    } else if (p.pos === "WR" || p.pos === "TE") {
      if (s.rec) parts.push(`${s.rec} REC`);
      if (s.rec_yds) parts.push(`${s.rec_yds} YDS`);
      if (s.rec_td) parts.push(`${s.rec_td} TD`);
    } else if (p.pos === "K") {
      if (s.fg_made) parts.push(`${s.fg_made}/${s.fg_att||0} FG`);
    } else {
      if (s.tkl) parts.push(`${s.tkl} TKL`);
      if (s.sk) parts.push(`${s.sk} SK`);
      if (s.int_made) parts.push(`${s.int_made} INT`);
    }
    return parts.join(" · ");
  };

  const performerRow = (p, side) => {
    const mine = isMine(p.name, side);
    const src = srcOf(p.name, side);
    return `<div class="frn-apb-box-perf ${mine?"mine":""}">
      <span class="name">${_apbLink(p.name)}</span>
      <span class="pos">${p.pos}</span>
      ${src ? `<span class="src" style="color:${src.srcTeamPrimary}">${src.srcTeamAbbr}</span>` : ""}
      <span class="line">${lineFor(p)}</span>
    </div>`;
  };

  // Scoring timeline — reuse the same isScore filter pattern as the
  // playoff recap.
  const scoring = (m.scoring || []).filter(ev => ev.isScore);
  const teamIdForPoss = (poss) => poss === "home" ? home.id : poss === "away" ? away.id : null;
  const scoreLabel = (ev) => {
    if (ev.desc && ev.desc.length > 1) return ev.desc;
    if (ev.scoreType === "TD")     return `TD${ev.scorer?` — ${ev.scorer}`:""}`;
    if (ev.scoreType === "FG")     return `FG${ev.kicker?` — ${ev.kicker}`:""}`;
    if (ev.scoreType === "XP")     return "XP";
    if (ev.scoreType === "2PT")    return "2-pt";
    if (ev.scoreType === "SAFETY") return "Safety";
    if (ev.pts === 7 || ev.pts === 6) return "TD";
    if (ev.pts === 3) return "FG";
    return `+${ev.pts}`;
  };
  const scoringHtml = scoring.length ? scoring.map(ev => {
    const tId = teamIdForPoss(ev.poss);
    const team = tId === home.id ? home : tId === away.id ? away : null;
    return `<div class="frn-apb-box-score-row">
      <span class="q">Q${ev.qtr||"?"}</span>
      <span class="team" style="color:${team?.primary||'var(--blwhite)'}">${team?.confDiv?.slice(0,3).toUpperCase() || "?"}</span>
      <span class="desc">${scoreLabel(ev)}</span>
      <span class="num">${ev.homeScore}-${ev.awayScore}</span>
    </div>`;
  }).join("") : `<div style="color:var(--blgray);font-style:italic;font-size:.65rem;padding:.3rem 0">No scoring data captured for this matchup.</div>`;

  // Team totals comparison
  const cmpRows = [
    ["Total yards",   stats.home?.totals?.totalYds || 0, stats.away?.totals?.totalYds || 0],
    ["Passing",       stats.home?.totals?.passYds  || 0, stats.away?.totals?.passYds  || 0],
    ["Rushing",       stats.home?.totals?.rushYds  || 0, stats.away?.totals?.rushYds  || 0],
    ["First downs",   stats.home?.totals?.firstDowns || 0, stats.away?.totals?.firstDowns || 0],
    ["Turnovers",     stats.home?.totals?.turnovers || 0, stats.away?.totals?.turnovers || 0, true],
    ["Sacks",         stats.home?.totals?.sacks    || 0, stats.away?.totals?.sacks    || 0],
  ].filter(r => (r[1] || 0) + (r[2] || 0) > 0);
  const cmpRowHtml = ([label, h, a, lowerBetter]) => {
    const winner = h === a ? "tie" : (lowerBetter ? (h < a ? "home" : "away") : (h > a ? "home" : "away"));
    return `<tr>
      <td class="v ${winner==='home'?'win':''}">${h}</td>
      <td class="lbl">${label}</td>
      <td class="v away ${winner==='away'?'win':''}">${a}</td>
    </tr>`;
  };

  // Modal
  const close = `_closeApbBoxScore`;
  const existing = document.getElementById("frn-apb-box-modal");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "frn-apb-box-modal";
  el.className = "frn-apb-box-overlay";
  el.innerHTML = `
    <div class="frn-apb-box-card">
      <button class="frn-apb-box-close" onclick="_closeApbBoxScore()">×</button>
      <div class="frn-apb-box-eyebrow">ALL-PRO BOWL · ${roundName}</div>
      <div class="frn-apb-box-score-banner">
        <div class="side ${homeWon?"win":"loss"}" style="--accent:${home.primary}">
          <div class="seed">#${home.seed}</div>
          <div class="abbr">${home.confDiv.toUpperCase()}</div>
          <div class="score">${m.homeScore}</div>
        </div>
        <div class="vs">—</div>
        <div class="side ${!homeWon?"win":"loss"}" style="--accent:${away.primary}">
          <div class="score">${m.awayScore}</div>
          <div class="abbr">${away.confDiv.toUpperCase()}</div>
          <div class="seed">#${away.seed}</div>
        </div>
      </div>

      ${m.mvp ? `<div class="frn-apb-box-mvp">
        <span class="lbl">⭐ GAME MVP</span>
        <span class="name">${_apbLink(m.mvp.name)}</span>
        <span class="pos">${m.mvp.pos}</span>
        <span class="line">${m.mvp.line}</span>
      </div>` : ""}

      <div class="frn-apb-box-grid">
        <section>
          <div class="frn-apb-box-section-title">${home.confDiv} TOP PERFORMERS</div>
          ${topSide(stats.home).map(p => performerRow(p, "home")).join("")}
        </section>
        <section>
          <div class="frn-apb-box-section-title">${away.confDiv} TOP PERFORMERS</div>
          ${topSide(stats.away).map(p => performerRow(p, "away")).join("")}
        </section>
      </div>

      ${cmpRows.length ? `<section class="frn-apb-box-cmp-wrap">
        <div class="frn-apb-box-section-title">TEAM STATS</div>
        <table class="frn-apb-box-cmp">
          <thead><tr><th>${home.confDiv.slice(0,3).toUpperCase()}</th><th></th><th>${away.confDiv.slice(0,3).toUpperCase()}</th></tr></thead>
          <tbody>${cmpRows.map(cmpRowHtml).join("")}</tbody>
        </table>
      </section>` : ""}

      <section class="frn-apb-box-scoring-wrap">
        <div class="frn-apb-box-section-title">SCORING SUMMARY</div>
        <div class="frn-apb-box-scoring">${scoringHtml}</div>
      </section>
    </div>`;
  el.addEventListener("click", e => { if (e.target === el) _closeApbBoxScore(); });
  document.body.appendChild(el);
}

function _closeApbBoxScore() {
  const el = document.getElementById("frn-apb-box-modal");
  if (el) el.remove();
}

// ── Beat 1: SELECTIONS REVEAL ──────────────────────────────────────
// Hero "Pro Bowl Selections" → your team's selected players highlighted
// → 8 division teams mini-grid → bracket preview → kickoff CTA.
function _renderApbSelections(t) {
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const mySelections = [];
  for (const team of t.teams) {
    for (const m of (team.rosterMeta || [])) {
      if (m.srcTeamId === myId) mySelections.push({ ...m, allStarTeam: team });
    }
  }

  // Your-pro-bowlers card
  const stat = (name) => {
    const ts = franchise.seasonStats?.[myId];
    if (!ts) return "";
    const s = ts[name];
    if (!s) return "";
    if (s.pos === "QB") return `${s.pass_yds||0} pyds · ${s.pass_td||0} TD`;
    if (s.pos === "RB") return `${s.rush_yds||0} ryds · ${s.rush_td||0} TD`;
    if (s.pos === "WR" || s.pos === "TE") return `${s.rec_yds||0} recyds · ${s.rec_td||0} TD`;
    if (s.pos === "K")  return `${s.fg_made||0}/${s.fg_att||0} FG`;
    return `${s.tkl||0} TKL${s.sk?` · ${s.sk} SK`:""}${s.int_made?` · ${s.int_made} INT`:""}`;
  };
  const yourCard = mySelections.length ? `
    <div class="frn-apb-yours">
      <div class="frn-apb-yours-head">
        <span class="frn-apb-yours-eyebrow">YOUR PRO BOWLERS</span>
        <span class="frn-apb-yours-count">${mySelections.length} selected</span>
      </div>
      <div class="frn-apb-yours-grid">
        ${mySelections.map(m => `
          <div class="frn-apb-yours-row" style="--accent:${myTeam?.primary}">
            <span class="pos">${m.pos}</span>
            <span class="name">${_apbLink(m.name)}</span>
            <span class="div">→ ${m.allStarTeam.confDiv} All-Stars</span>
            <span class="stat">${stat(m.name)}</span>
          </div>`).join("")}
      </div>
    </div>` : `
    <div class="frn-apb-yours empty">
      <div class="frn-apb-yours-eyebrow">YOUR PRO BOWLERS</div>
      <div style="color:var(--blgray);font-style:italic;font-size:.72rem">No selections from ${myTeam?.city} ${myTeam?.name} this season.</div>
    </div>`;

  // 8 division mini-cards (top players preview)
  const teamGrid = t.teams.slice().sort((a, b) => a.seed - b.seed).map(team => {
    const topStarters = (team.rosterMeta || []).slice(0, 4);
    const myCount = (team.rosterMeta || []).filter(m => m.srcTeamId === myId).length;
    return `<div class="frn-apb-team-card" style="--accent:${team.primary}">
      <div class="frn-apb-team-card-head">
        <span class="seed">#${team.seed}</span>
        <span class="name">${team.confDiv} All-Stars</span>
        ${myCount > 0 ? `<span class="mine">${myCount} of yours</span>` : ""}
      </div>
      <div class="frn-apb-team-card-roster">
        ${topStarters.map(p => `<span class="role" title="${p.name}">
          <span class="pos">${p.pos}</span> ${p.name.split(" ").slice(-1)[0]}
          <span class="src" style="color:${p.srcTeamPrimary}">${p.srcTeamAbbr}</span>
        </span>`).join("")}
      </div>
    </div>`;
  }).join("");

  // Bracket preview (no scores)
  const bracketPreview = t.rounds[0].map((m, i) => {
    const home = _apbTeamById(m.homeId, t);
    const away = _apbTeamById(m.awayId, t);
    const userMatch = (home?.rosterMeta?.some(x => x.srcTeamId === myId))
      || (away?.rosterMeta?.some(x => x.srcTeamId === myId));
    return `<div class="frn-apb-bracket-prev ${userMatch?"mine":""}">
      <div class="side" style="--accent:${home?.primary}">
        <span class="seed">#${home?.seed}</span>
        <span class="name">${home?.confDiv}</span>
      </div>
      <div class="vs">vs</div>
      <div class="side" style="--accent:${away?.primary}">
        <span class="seed">#${away?.seed}</span>
        <span class="name">${away?.confDiv}</span>
      </div>
    </div>`;
  }).join("");

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1.2rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">PRO BOWL SELECTIONS · SEASON ${franchise.season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("AWARDS")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="renderFrnAwards()">‹ Back to Awards</button>
      </div>
      <div class="frn-apb-selections">
        <header class="frn-apb-hero">
          <div class="frn-apb-hero-eyebrow">🌟 EXHIBITION TOURNAMENT</div>
          <h1 class="frn-apb-hero-title">PRO BOWL SELECTIONS</h1>
          <div class="frn-apb-hero-sub">${t.teams.reduce((s, x) => s + (x.rosterMeta?.length||0), 0)} of the league's best · 8 division all-star squads · single-elimination</div>
        </header>

        ${yourCard}

        <section class="frn-apb-section">
          <div class="frn-apb-section-title">📋 ALL-STAR ROSTERS · 8 DIVISIONS</div>
          <div class="frn-apb-team-grid">${teamGrid}</div>
        </section>

        <section class="frn-apb-section">
          <div class="frn-apb-section-title">🎯 QUARTERFINAL BRACKET</div>
          <div class="frn-apb-bracket-prev-grid">${bracketPreview}</div>
        </section>

        <div class="frn-apb-cta-row">
          <button class="frn-apb-cta" onclick="frnApbKickoff()">▶ KICK OFF QUARTERFINALS</button>
        </div>
      </div>
    </div>`;
}

// ── Beat 3: CHAMPION CROWNING ──────────────────────────────────────
// Trophy banner + tournament MVP + top performers + your team's recap.
function _renderApbCrowning(t) {
  const myId = franchise.chosenTeamId;
  const champTeam = _apbTeamById(t.champion, t);
  const runnerUp  = _apbTeamById(t.runnerUp, t);
  if (!champTeam) { return _renderApbTournament(t); }

  // Apply champion stakes (idempotent)
  _apbApplyChampionStakes(t);

  // Tournament top performers — aggregate impact score AND raw stat
  // totals across every game so we can show actual stat lines (not
  // just an opaque score) and per-category leaders.
  const performerByName = new Map();
  const playerInfo = new Map();
  const ROUND_FOR_TEAM = new Map();  // teamId → deepest round index reached
  for (let ri = 0; ri < t.rounds.length; ri++) {
    for (const m of t.rounds[ri]) {
      if (!m.played || !m.stats) continue;
      // Track each team's deepest round for outcome chips
      if (m.homeId != null) ROUND_FOR_TEAM.set(m.homeId, Math.max(ROUND_FOR_TEAM.get(m.homeId) || 0, ri));
      if (m.awayId != null) ROUND_FOR_TEAM.set(m.awayId, Math.max(ROUND_FOR_TEAM.get(m.awayId) || 0, ri));
      const both = [
        ...Object.values(m.stats.home?.players || {}),
        ...Object.values(m.stats.away?.players || {}),
      ];
      for (const p of both) {
        const s = mvpScore(p);
        if (!playerInfo.has(p.name)) playerInfo.set(p.name, { name: p.name, pos: p.pos, totals: {}, gp: 0 });
        const info = playerInfo.get(p.name);
        info.gp += 1;
        for (const [k, v] of Object.entries(p)) {
          if (typeof v === "number" && k !== "gp") info.totals[k] = (info.totals[k] || 0) + v;
        }
        performerByName.set(p.name, (performerByName.get(p.name) || 0) + s);
      }
    }
  }
  const performers = [...performerByName.entries()]
    .map(([name, score]) => ({ ...playerInfo.get(name), score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  // Position-aware stat line — exposes what the impact score is actually
  // made of. Keeps each line tight so the row stays readable.
  const performerStatLine = (p) => {
    const s = p.totals || {};
    const parts = [];
    if (p.pos === "QB") {
      if (s.pass_yds) parts.push(`${s.pass_yds} PYDS`);
      if (s.pass_td) parts.push(`${s.pass_td} TD`);
      if (s.pass_int) parts.push(`${s.pass_int} INT`);
      if (s.rush_yds) parts.push(`${s.rush_yds} RYDS`);
      if (s.rush_td) parts.push(`${s.rush_td} rTD`);
    } else if (p.pos === "RB") {
      if (s.rush_yds) parts.push(`${s.rush_yds} RYDS`);
      if (s.rush_td) parts.push(`${s.rush_td} TD`);
      if (s.rec_yds) parts.push(`${s.rec_yds} recYDS`);
      if (s.rec_td) parts.push(`${s.rec_td} recTD`);
    } else if (p.pos === "WR" || p.pos === "TE") {
      if (s.rec) parts.push(`${s.rec} REC`);
      if (s.rec_yds) parts.push(`${s.rec_yds} YDS`);
      if (s.rec_td) parts.push(`${s.rec_td} TD`);
    } else if (p.pos === "K") {
      if (s.fg_made) parts.push(`${s.fg_made}/${s.fg_att||0} FG`);
      if (s.fg_long) parts.push(`LONG ${s.fg_long}`);
    } else {
      // Defense
      if (s.tkl) parts.push(`${s.tkl} TKL`);
      if (s.sk) parts.push(`${s.sk} SK`);
      if (s.int_made) parts.push(`${s.int_made} INT`);
      if (s.ff) parts.push(`${s.ff} FF`);
      if (s.def_td) parts.push(`${s.def_td} TD`);
    }
    return parts.join(" · ");
  };

  // Team-outcome chip — Champion / Final / Semis / QF exit / DNP.
  const outcomeChipFor = (playerName) => {
    // Find which all-star team this player is on
    let team = null;
    for (const tt of t.teams) {
      if (tt.rosterMeta?.some(x => x.name === playerName)) { team = tt; break; }
    }
    if (!team) return { label: "", cls: "" };
    if (team.id === t.champion) return { label: "🏆 CHAMPION", cls: "champ" };
    if (team.id === t.runnerUp) return { label: "FINAL", cls: "final" };
    const deepest = ROUND_FOR_TEAM.get(team.id);
    if (deepest === 1) return { label: "SEMIS", cls: "semis" };
    if (deepest === 0) return { label: "QF EXIT", cls: "qf" };
    return { label: "", cls: "" };
  };

  // Stat-leader strip — top passing / rushing / receiving / defender by
  // raw totals, regardless of impact score. Answers "who was the best X".
  const leaderOf = (predicate, sortKey, label) => {
    const candidates = [...playerInfo.values()].filter(predicate);
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.totals?.[sortKey] || 0) - (a.totals?.[sortKey] || 0));
    const top = candidates[0];
    if (!top || !top.totals?.[sortKey]) return null;
    return { ...top, leaderLabel: label, leaderStat: top.totals[sortKey] };
  };
  const defScore = (info) => (info.totals?.sk || 0) * 4 + (info.totals?.int_made || 0) * 6
    + (info.totals?.ff || 0) * 4 + (info.totals?.def_td || 0) * 6 + (info.totals?.tkl || 0);
  const defLeaderCandidates = [...playerInfo.values()]
    .filter(p => ["DL","LB","CB","S"].includes(p.pos) && defScore(p) > 0)
    .sort((a, b) => defScore(b) - defScore(a));
  const statLeaders = [
    leaderOf(p => p.pos === "QB" && (p.totals?.pass_yds || 0) > 0, "pass_yds", "Top Passer"),
    leaderOf(p => p.pos === "RB" && (p.totals?.rush_yds || 0) > 0, "rush_yds", "Top Rusher"),
    leaderOf(p => (p.pos === "WR" || p.pos === "TE") && (p.totals?.rec_yds || 0) > 0, "rec_yds", "Top Receiver"),
    defLeaderCandidates[0] ? { ...defLeaderCandidates[0], leaderLabel: "Top Defender" } : null,
  ].filter(Boolean);

  // Your-team recap
  const myAllPros = [];
  for (const team of t.teams) {
    for (const m of (team.rosterMeta || [])) {
      if (m.srcTeamId === myId) {
        const onChampTeam = team.id === t.champion;
        myAllPros.push({ ...m, onChampTeam, allStarTeam: team });
      }
    }
  }
  const myOnChamp = myAllPros.filter(x => x.onChampTeam).length;

  const sourceTagFor = (playerName) => {
    // Find player's source team for color/abbr
    for (const team of t.teams) {
      const m = team.rosterMeta?.find(x => x.name === playerName);
      if (m) return { primary: m.srcTeamPrimary, abbr: m.srcTeamAbbr };
    }
    return { primary: "var(--blgray)", abbr: "—" };
  };
  const isMine = (playerName) => {
    for (const team of t.teams) {
      const m = team.rosterMeta?.find(x => x.name === playerName);
      if (m) return m.srcTeamId === myId;
    }
    return false;
  };

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1.2rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">ALL-PRO BOWL · CHAMPIONS · SEASON ${franchise.season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("AWARDS")}</nav>
      </header>
      <div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
        <button class="bspn-back" onclick="renderFrnAwards()">‹ Back to Awards</button>
      </div>
      <div class="frn-apb-crowning">
        <header class="frn-apb-trophy" style="--accent:${champTeam.primary}">
          <div class="frn-apb-trophy-icon">🏆</div>
          <div class="frn-apb-trophy-eyebrow">SEASON ${franchise.season} ALL-PRO BOWL CHAMPIONS</div>
          <h1 class="frn-apb-trophy-name">${champTeam.confDiv.toUpperCase()} ALL-STARS</h1>
          ${runnerUp ? `<div class="frn-apb-trophy-sub">defeated ${runnerUp.confDiv} All-Stars in the final</div>` : ""}
        </header>

        ${t.mvp ? `
          <section class="frn-apb-mvp-card" style="--accent:${t.mvp.srcTeamPrimary || 'var(--blgold)'}">
            <div class="frn-apb-mvp-eyebrow">🌟 TOURNAMENT MVP</div>
            <div class="frn-apb-mvp-name">${_apbLink(t.mvp.name)}</div>
            <div class="frn-apb-mvp-meta">${t.mvp.pos} · <span style="color:${t.mvp.srcTeamPrimary||'var(--blgray)'}">${t.mvp.srcTeamAbbr || "?"}</span></div>
            <div class="frn-apb-mvp-line">${t.mvp.line}</div>
          </section>` : ""}

        ${statLeaders.length ? `
          <section class="frn-apb-section">
            <div class="frn-apb-section-title">📊 STAT LEADERS</div>
            <div class="frn-apb-leader-grid">
              ${statLeaders.map(l => {
                const src = sourceTagFor(l.name);
                const mine = isMine(l.name);
                const oc = outcomeChipFor(l.name);
                return `<div class="frn-apb-leader-card ${mine?"mine":""}" style="--accent:${src.primary}">
                  <div class="frn-apb-leader-label">${l.leaderLabel}</div>
                  <div class="frn-apb-leader-name">${_apbLink(l.name)}</div>
                  <div class="frn-apb-leader-meta">
                    <span class="pos">${l.pos}</span>
                    <span class="src" style="color:${src.primary}">${src.abbr}</span>
                    <span class="gp">${l.gp}gp</span>
                    ${oc.label?`<span class="outcome ${oc.cls}">${oc.label}</span>`:""}
                  </div>
                  <div class="frn-apb-leader-stat">${performerStatLine(l)}</div>
                </div>`;
              }).join("")}
            </div>
          </section>` : ""}

        <section class="frn-apb-section">
          <div class="frn-apb-section-title">⭐ TOURNAMENT TOP PERFORMERS <span style="font-size:.55rem;color:var(--blgray);font-weight:400;letter-spacing:1px;margin-left:.4rem">ranked by impact score</span></div>
          <div class="frn-apb-performers">
            ${performers.map((p, i) => {
              const src = sourceTagFor(p.name);
              const mine = isMine(p.name);
              const oc = outcomeChipFor(p.name);
              const sl = performerStatLine(p);
              return `<div class="frn-apb-performer-row ${mine?"mine":""}">
                <div class="frn-apb-performer-rank">${i+1}</div>
                <div class="frn-apb-performer-body">
                  <div class="frn-apb-performer-head">
                    <span class="name">${_apbLink(p.name)}</span>
                    <span class="pos">${p.pos}</span>
                    <span class="src" style="color:${src.primary}">${src.abbr}</span>
                    ${oc.label?`<span class="outcome ${oc.cls}">${oc.label}</span>`:""}
                  </div>
                  <div class="frn-apb-performer-stats">
                    <span class="line">${sl || "—"}</span>
                    <span class="gp">${p.gp} GP</span>
                    <span class="score">★ ${Math.round(p.score)}</span>
                  </div>
                </div>
              </div>`;
            }).join("")}
          </div>
        </section>

        ${myAllPros.length ? `
          <section class="frn-apb-section">
            <div class="frn-apb-section-title">⭐ YOUR TEAM'S RECAP</div>
            <div class="frn-apb-yourrecap">
              <div class="frn-apb-yourrecap-stat">
                <span class="lbl">PRO BOWLERS</span>
                <span class="val">${myAllPros.length}</span>
              </div>
              <div class="frn-apb-yourrecap-stat">
                <span class="lbl">CHAMPION-SIDE</span>
                <span class="val" style="color:${myOnChamp>0?"var(--blgold)":"var(--blgray)"}">${myOnChamp}</span>
              </div>
              ${t.mvp && isMine(t.mvp.name) ? `<div class="frn-apb-yourrecap-stat">
                <span class="lbl">TOURNAMENT MVP</span>
                <span class="val" style="color:var(--blgold)">✓ ${t.mvp.name.split(" ").slice(-1)[0]}</span>
              </div>` : ""}
            </div>
            ${myOnChamp>0 ? `<div class="frn-apb-yourrecap-note">🏆 Your ${myOnChamp} champion-side player${myOnChamp===1?"":"s"} earned a <b>Pro Bowl Champion</b> career accolade.</div>` : ""}
          </section>` : ""}

        <div class="frn-apb-cta-row">
          <button class="frn-apb-cta secondary" onclick="frnApbReviewTournament()">📋 Review Tournament</button>
          <button class="frn-apb-cta" onclick="frnApbProceedToOffseason()">▶ BEGIN OFFSEASON</button>
        </div>
      </div>
    </div>`;
}

// ── Beat 2: TOURNAMENT VIEW (existing bracket — kept lean) ─────────
function _renderApbTournament(t) {
  // Trophy card (only if user came back here AFTER crowning was dismissed)
  const champTeam = t.complete ? _apbTeamById(t.champion, t) : null;
  const trophyCard = (t.complete && champTeam) ? `
    <div class="bspnlive-apb-trophy-card">
      <div class="bspnlive-apb-trophy-icon">🏆</div>
      <div>
        <div class="bspnlive-apb-trophy-eyebrow">ALL-PRO BOWL CHAMPIONS · SEASON ${franchise.season}</div>
        <div class="bspnlive-apb-trophy-name">${champTeam.confDiv.toUpperCase()} ALL-STARS</div>
        ${t.mvp ? `<div class="bspnlive-apb-trophy-mvp">⭐ Tournament MVP: <b>${_apbLink(t.mvp.name)}</b> (${t.mvp.pos}) · <span style="color:${t.mvp.srcTeamPrimary}">${t.mvp.srcTeamAbbr || ""}</span> · ${t.mvp.line}</div>` : ""}
      </div>
    </div>` : "";

  const hero = `
    <div class="bspnlive-apb-hero">
      <div class="bspnlive-apb-hero-eyebrow">EXHIBITION TOURNAMENT · SEASON ${franchise.season}</div>
      <div class="bspnlive-apb-hero-title">ALL-PRO BOWL</div>
      <div class="bspnlive-apb-hero-sub">8 division all-star squads · single-elimination · 7 games to division supremacy</div>
    </div>`;

  const myId = franchise.chosenTeamId;
  const teamHasMine = (team) => team?.rosterMeta?.some(m => m.srcTeamId === myId);

  const teamCell = (id, score, isWinner, isLoser) => {
    const team = _apbTeamById(id, t);
    if (!team) return `<div class="bspnlive-apb-match-side"><span class="bspnlive-apb-seed">—</span><span class="bspnlive-apb-team" style="color:var(--blgray);font-style:italic">TBD</span><span class="bspnlive-apb-score"></span></div>`;
    const mineCount = (team.rosterMeta || []).filter(m => m.srcTeamId === myId).length;
    return `<div class="bspnlive-apb-match-side ${isWinner ? 'winner' : ''} ${isLoser ? 'loser' : ''}${mineCount?" mine":""}">
      <span class="bspnlive-apb-seed">#${team.seed}</span>
      <span class="bspnlive-apb-team"><span class="bspnlive-apb-team-stripe" style="background:${team.primary}"></span>${team.confDiv} All-Stars${mineCount?` <span class="bspnlive-apb-mine-pill">${mineCount}</span>`:""}</span>
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
      : (m.played)
      ? `<div class="bspnlive-apb-match-action"><button class="bspnlive-btn-outline" onclick="frnOpenApbBox(${ri},${mi})" style="font-size:.72rem;padding:.25rem .65rem">📋 Box Score</button></div>`
      : "";
    const mvpLine = (m.played && m.mvp)
      ? `<div style="margin-top:.25rem;color:var(--blgray);font-size:.62rem">⭐ ${_apbLink(m.mvp.name)} (${m.mvp.pos}) · ${m.mvp.line}</div>`
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

  const aliveTeams = t.teams.filter(team => {
    if (t.complete) return team.id === t.champion;
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
        <div class="bspnlive-allpro-block ${teamHasMine(team)?"has-mine":""}" style="border-top-color:${team.primary}">
          <div class="bspnlive-allpro-title">#${team.seed} · ${team.confDiv.toUpperCase()} ALL-STARS</div>
          <div class="bspnlive-apb-roster-grid">
            ${team.rosterMeta.slice(0, 18).map(p => `
              <div class="bspnlive-apb-roster-row ${p.srcTeamId===myId?"mine":""}">
                <span class="bspnlive-apb-roster-pos">${p.pos}</span>
                <span class="bspnlive-apb-roster-name">${_apbLink(p.name)}</span>
                <span class="bspnlive-apb-roster-tm" style="color:${p.srcTeamPrimary}">${p.srcTeamAbbr}</span>
              </div>`).join("")}
          </div>
        </div>`).join("")}
    </div>` : "";

  const hasUnplayedInCurrent = t.currentRound < t.rounds.length &&
    t.rounds[t.currentRound].some(m => !m.played && m.homeId != null && m.awayId != null);
  const actions = `
    <div class="bspnlive-awards-footer">
      ${hasUnplayedInCurrent ? `<button class="bspnlive-btn-gold" onclick="frnSimApbRound()">⏩ Sim ${t.roundLabels[t.currentRound]}</button>` : ""}
      ${!t.complete ? `<button class="bspnlive-btn-outline" onclick="frnSimApbAll()">⏭ Sim Tournament</button>` : ""}
      <button class="bspnlive-btn-outline" onclick="renderFrnAwards()">‹ Awards Ceremony</button>
      ${t.complete ? `<button class="bspnlive-btn-gold" onclick="frnApbReopenCrowning()">🏆 View Crowning</button>` : ""}
      ${t.complete ? `<button class="bspnlive-btn-gold" onclick="frnApbProceedToOffseason()">⏭ Begin Offseason</button>` : ""}
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

// Router — selections → tournament → crowning, based on tournament state.
function renderAllProBowl() {
  frnHoverTipHide && frnHoverTipHide();
  _frnHoverTipPgHide && _frnHoverTipPgHide();
  const t = franchise.allProBowlTournament;
  if (!t) { renderFrnAwards(); return; }

  // Pre-tournament selections reveal — until user kicks off
  const anyPlayed = t.rounds.some(round => round.some(m => m.played));
  if (!anyPlayed && !t._selectionsAcknowledged) {
    return _renderApbSelections(t);
  }

  // Post-tournament crowning — until user dismisses
  if (t.complete && !t._crowningDismissed) {
    return _renderApbCrowning(t);
  }

  return _renderApbTournament(t);
}

// ── Coaching chemistry ────────────────────────────────────────────────────────
// Each coaching role maps to a philosophy group. Neutral/wildcard traits return
// null and don't anchor an axis — they bend to whichever philosophy is strongest.
//   OFFENSE: Offensive Minded HC | Air Attack / Red Zone Genius / Run Architect / Trench General OC
//   DEFENSE: Defensive Minded HC | Pressure Package / Cover Scheme / Ball Hawk / Run Stopper DC
//   DEVELOP: Player Developer HC | QB Whisperer OC
//   null   : Motivator, Game Manager, Roster Builder HC | Balanced OC | Hybrid DC
function _chemGroup(role, trait) {
  if (role === "hc") {
    if (trait === "Offensive Minded") return "OFFENSE";
    if (trait === "Defensive Minded") return "DEFENSE";
    if (trait === "Player Developer") return "DEVELOP";
    return null;
  }
  if (role === "oc") {
    if (["Air Attack","Red Zone Genius","Run Architect","Trench General"].includes(trait)) return "OFFENSE";
    if (trait === "QB Whisperer") return "DEVELOP";
    return null;
  }
  if (role === "dc") {
    if (["Pressure Package","Cover Scheme","Ball Hawk","Run Stopper"].includes(trait)) return "DEFENSE";
    if (trait === "Film Mastermind") return "DEVELOP";
    return null;
  }
  return null;
}

// Returns net chemistry modifiers derived from the current `_chemistry` state.
//   offBonus / defBonus — integer bumps applied to team ratings before sim
//   devMul             — multiplicative modifier on all dev chances this offseason
//   chaotic            — high-variance ±2 swing flag for pre-game application
function _computeChemistryBonus(teamId) {
  const staff = franchise.coaches?.[teamId];
  if (!staff) return { offBonus:0, defBonus:0, devMul:1.0, chaotic:false };
  const hcG  = _chemGroup("hc", staff.hc?.specialtyTrait);
  const ocG  = _chemGroup("oc", staff.oc?.trait);
  const dcG  = _chemGroup("dc", staff.dc?.trait);
  const chem = staff._chemistry || {};
  const alYrs = chem.alignmentYears || 0;
  const frYrs = chem.frictionYears  || 0;
  let offBonus = 0, defBonus = 0, devMul = 1.0;
  // Pairwise synergy — bonus deepens after 2+ years of aligned philosophy
  if (hcG === "OFFENSE" && ocG === "OFFENSE") offBonus += alYrs >= 2 ? 1.5 : 1.0;
  if (hcG === "DEFENSE" && dcG === "DEFENSE") defBonus += alYrs >= 2 ? 1.5 : 1.0;
  if (hcG === "DEVELOP" && ocG === "DEVELOP") devMul   *= alYrs >= 2 ? 1.15 : 1.08;
  // Triple synergy: all three same group
  if (hcG && hcG === ocG && hcG === dcG) { offBonus += 1; defBonus += 1; devMul *= 1.10; }
  // Cross-friction: philosophically opposed roles — activates after 2+ friction years.
  // A neutral HC (null group) buffers OC-DC conflict by mediating; non-neutral HC amplifies it.
  const hasCrossFriction = (hcG === "OFFENSE" && dcG === "DEFENSE")
                        || (hcG === "DEFENSE" && ocG === "OFFENSE")
                        || (hcG !== null && ocG === "OFFENSE" && dcG === "DEFENSE");
  if (hasCrossFriction && frYrs >= 2) { offBonus -= 1; defBonus -= 1; }
  // Chaotic: all three non-null, all different groups, friction active
  const chaotic = !!(hcG && ocG && dcG
    && hcG !== ocG && hcG !== dcG && ocG !== dcG && frYrs >= 2);
  return { offBonus: Math.round(offBonus), defBonus: Math.round(defBonus), devMul, chaotic };
}

// Run once per offseason (after dev, before next season) to age the chemistry
// state for each team and check for QB-OC bond formation.
function _updateChemistryState() {
  for (const t of TEAMS) {
    const staff = franchise.coaches?.[t.id];
    if (!staff) continue;
    const hcG = _chemGroup("hc", staff.hc?.specialtyTrait);
    const ocG = _chemGroup("oc", staff.oc?.trait);
    const dcG = _chemGroup("dc", staff.dc?.trait);
    if (!staff._chemistry) staff._chemistry = { alignmentYears:0, frictionYears:0, qbOcBond:false };
    const chem = staff._chemistry;
    // Neutral HC (null group) mediates OC-DC conflict; non-neutral HC amplifies it.
    const hasFriction  = (hcG === "OFFENSE" && dcG === "DEFENSE")
                      || (hcG === "DEFENSE" && ocG === "OFFENSE")
                      || (hcG !== null && ocG === "OFFENSE" && dcG === "DEFENSE");
    const hasAlignment = (hcG && ocG && hcG === ocG) || (hcG && dcG && hcG === dcG);
    if (hasFriction) {
      chem.frictionYears  = (chem.frictionYears  || 0) + 1;
      chem.alignmentYears = 0;
    } else if (hasAlignment) {
      chem.alignmentYears = (chem.alignmentYears || 0) + 1;
      chem.frictionYears  = Math.max(0, (chem.frictionYears || 0) - 1);
    } else {
      chem.frictionYears  = Math.max(0, (chem.frictionYears  || 0) - 1);
      chem.alignmentYears = Math.max(0, (chem.alignmentYears || 0) - 1);
    }
    // QB-OC bond: forms with a young QB (≤25, 2+ systemYears) and persists until
    // the QB leaves the team or the OC is replaced — age alone doesn't break a bond.
    if (staff.oc?.trait === "QB Whisperer") {
      const roster = franchise.rosters[t.id] || [];
      if (chem.qbOcBond) {
        // Bond active — keep it unless the QB is no longer on the roster
        if (!roster.find(p => p.name === chem.qbOcBond && p.position === "QB")) {
          chem.qbOcBond = false;
        }
      } else {
        // No bond yet — try to form one with a qualifying young QB
        const youngQB = roster.find(p => p.position === "QB"
          && (p.age || 25) <= 25 && (p.systemYears || 0) >= 2);
        if (youngQB) {
          youngQB._awrCeiling = Math.min(99, (youngQB._awrCeiling || 80) + 8);
          chem.qbOcBond = youngQB.name;
          _pushNews({ type:"coach_bond",
            label: `🔗 QB-OC Bond: ${youngQB.name} + OC ${staff.oc.name} — chemistry locked in, AWR ceiling raised` });
        }
      }
    } else {
      chem.qbOcBond = false; // OC no longer QB Whisperer — bond ends
    }
  }
}

// Build the per-snap rotation target map the engine consumes. Maps the
// depth-chart slot keys whose positions actually rotate per-snap today
// to engine starter roles, expressed as 0..1 fractions.
function _buildSnapMap(teamId) {
  const ss = franchise.snapShares?.[teamId];
  if (!ss) return null;
  const frac = (slotKey) => {
    const pct = ss[slotKey]?.starterPct;
    return (pct != null) ? Math.max(0, Math.min(1, pct / 100)) : null;
  };
  const map = {};
  const set = (role, slotKey) => { const v = frac(slotKey); if (v != null) map[role] = v; };
  set("qb",  "QB");
  set("rb",  "RB1");
  set("wr1", "WR1");
  set("wr2", "WR2");
  set("te",  "TE1");
  return Object.keys(map).length ? map : null;
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
    { isRivalry,
      homeSnaps: _buildSnapMap(homeId),
      awaySnaps: _buildSnapMap(awayId) }
  );
  // Coaching trait bumps applied AFTER constructor so they layer on top of HFA.
  const hcHome = franchise.coaches?.[homeId]?.hc?.specialtyTrait;
  const hcAway = franchise.coaches?.[awayId]?.hc?.specialtyTrait;
  // HC specialty — Offensive/Defensive Minded = +2 in their phase
  if (hcHome === "Offensive Minded")  sim.homeR.offense += 2;
  if (hcHome === "Defensive Minded")  sim.homeR.defense += 2;
  if (hcAway === "Offensive Minded")  sim.awayR.offense += 2;
  if (hcAway === "Defensive Minded")  sim.awayR.defense += 2;
  // Philosophy-axis chemistry: aligned staffs build synergy over time; misaligned
  // staffs accumulate friction. Both tracked in franchise.coaches[id]._chemistry.
  const ocHome = franchise.coaches?.[homeId]?.oc?.trait;
  const ocAway = franchise.coaches?.[awayId]?.oc?.trait;
  const dcHome = franchise.coaches?.[homeId]?.dc?.trait;
  const dcAway = franchise.coaches?.[awayId]?.dc?.trait;
  const chemHome = _computeChemistryBonus(homeId);
  const chemAway = _computeChemistryBonus(awayId);
  sim.homeR.offense += chemHome.offBonus; sim.homeR.defense += chemHome.defBonus;
  sim.awayR.offense += chemAway.offBonus; sim.awayR.defense += chemAway.defBonus;
  // Chaotic chemistry (all 3 non-neutral, all different groups, 2+ friction years) → ±2 swing
  if (chemHome.chaotic) { const s = Math.random() < 0.5 ? 2 : -2; sim.homeR.offense += s; sim.homeR.defense += s; }
  if (chemAway.chaotic) { const s = Math.random() < 0.5 ? 2 : -2; sim.awayR.offense += s; sim.awayR.defense += s; }
  // DC trait boosts (defense rating)
  // Pressure Package: always-on pass rush pressure, regardless of opponent scheme.
  if (dcHome === "Pressure Package") sim.homeR.defense += 1;
  if (dcAway === "Pressure Package") sim.awayR.defense += 1;
  // Run Stopper: peaks vs run-heavy opponents — no bonus against passing teams.
  if (dcHome === "Run Stopper" && _getTeamOffScheme(awayId) === "SMASHMOUTH") sim.homeR.defense += 1;
  if (dcAway === "Run Stopper" && _getTeamOffScheme(homeId) === "SMASHMOUTH") sim.awayR.defense += 1;
  // Ball Hawk: always-on secondary pressure, forces tighter throwing windows.
  if (dcHome === "Ball Hawk") sim.homeR.defense += 1;
  if (dcAway === "Ball Hawk") sim.awayR.defense += 1;
  // Film Mastermind: scheme execution scales with defenders' average TEC.
  // Rewards teams that pair this trait with a development-focused staff —
  // the film work only translates if the players have the technique to execute it.
  const _filmBonus = (teamId) => {
    const def = (franchise.rosters[teamId] || []).filter(p => ["DL","LB","CB","S"].includes(p.position));
    if (!def.length) return 0;
    const top5 = def.map(p => p.stats?.[11] ?? 68).sort((a,b) => b-a).slice(0,5);
    const avg = top5.reduce((s,v) => s+v, 0) / top5.length;
    return avg >= 95 ? 3 : avg >= 85 ? 2 : avg >= 75 ? 1 : 0;
  };
  if (dcHome === "Film Mastermind") sim.homeR.defense += _filmBonus(homeId);
  if (dcAway === "Film Mastermind") sim.awayR.defense += _filmBonus(awayId);
  // Trench General OC running SMASHMOUTH: elite O-line coaching translates directly to run game power.
  if (ocHome === "Trench General" && _getTeamOffScheme(homeId) === "SMASHMOUTH") sim.homeR.offense += 1;
  if (ocAway === "Trench General" && _getTeamOffScheme(awayId) === "SMASHMOUTH") sim.awayR.offense += 1;
  // Red Zone Genius OC running WEST COAST: better TD conversion efficiency — shifts FG drives into TDs.
  if (ocHome === "Red Zone Genius" && _getTeamOffScheme(homeId) === "WEST COAST") sim.homeR.offense += 1;
  if (ocAway === "Red Zone Genius" && _getTeamOffScheme(awayId) === "WEST COAST") sim.awayR.offense += 1;
  // Coaching rating modifiers — tiered: <55=-1, 55-71=0, 72-82=+1, 83+=+2
  // HC affects both sides; OC affects offense only; DC affects defense only.
  const _cb = r => r >= 83 ? 2 : r >= 72 ? 1 : r >= 55 ? 0 : -1;
  const _hc = (id) => franchise.coaches?.[id]?.hc?.rating || 60;
  const _oc = (id) => franchise.coaches?.[id]?.oc?.rating || 60;
  const _dc = (id) => franchise.coaches?.[id]?.dc?.rating || 60;
  sim.homeR.offense += _cb(_hc(homeId)) + _cb(_oc(homeId));
  sim.homeR.defense += _cb(_hc(homeId)) + _cb(_dc(homeId));
  sim.awayR.offense += _cb(_hc(awayId)) + _cb(_oc(awayId));
  sim.awayR.defense += _cb(_hc(awayId)) + _cb(_dc(awayId));
  // Scheme matchup: OC's offensive scheme vs opponent DC's defensive scheme.
  // _schemeMatchup returns +ve = offense wins the schematic battle.
  // Scaled ×0.5 so the max swing (±3-4 OVR) stays comparable to chemistry bonuses.
  const homeOffScheme = _getTeamOffScheme(homeId);
  const awayOffScheme = _getTeamOffScheme(awayId);
  const homeDefScheme = _getTeamDefScheme(homeId);
  const awayDefScheme = _getTeamDefScheme(awayId);
  const homeSchemeMod = Math.round(_schemeMatchup(homeOffScheme, awayDefScheme) * 0.5);
  const awaySchemeMod = Math.round(_schemeMatchup(awayOffScheme, homeDefScheme) * 0.5);
  sim.homeR.offense += homeSchemeMod;
  sim.awayR.offense += awaySchemeMod;
  const r = sim.simulate();
  // Stamp gameday context onto the result so callers can persist it
  r.weather = sim.weather;
  r.isRivalry = isRivalry;
  mergeSeasonStats(homeId, awayId, r.stats, _gameMergeKey(homeId, awayId, isPlayoff));
  _updateSingleGameRecords(homeId, awayId, r.stats, franchise.week, isPlayoff);
  captureGameHighlights(homeId, awayId, r.plays, isPlayoff,
    isPlayoff ? `Playoff R${(franchise.playoffBracket?.roundIdx ?? 0) + 1}` : `W${franchise.week}`);
  return { homeScore: r.homeScore, awayScore: r.awayScore, full: r };
}

// Run a Joint Practice sim — same engine and coaching/scheme modifiers
// as frnSimOnce but no side effects (no season-stats merge, no
// single-game records, no season highlights). Practices are
// exhibitions: zero W/L, zero stat lines, just scouting intel + a
// report card.
function frnSimPractice(homeId, awayId) {
  const sim = new GameSimulator(
    getTeam(homeId), getTeam(awayId),
    franchise.rosters[homeId], franchise.rosters[awayId],
    { isRivalry: false, homeFieldAdv: false,
      homeSnaps: _buildSnapMap(homeId),
      awaySnaps: _buildSnapMap(awayId) }
  );
  // Same coaching/scheme overlays as frnSimOnce so a practice plays
  // the way the real matchup would.
  const hcHome = franchise.coaches?.[homeId]?.hc?.specialtyTrait;
  const hcAway = franchise.coaches?.[awayId]?.hc?.specialtyTrait;
  if (hcHome === "Offensive Minded") sim.homeR.offense += 2;
  if (hcHome === "Defensive Minded") sim.homeR.defense += 2;
  if (hcAway === "Offensive Minded") sim.awayR.offense += 2;
  if (hcAway === "Defensive Minded") sim.awayR.defense += 2;
  const chemHome = _computeChemistryBonus(homeId);
  const chemAway = _computeChemistryBonus(awayId);
  sim.homeR.offense += chemHome.offBonus; sim.homeR.defense += chemHome.defBonus;
  sim.awayR.offense += chemAway.offBonus; sim.awayR.defense += chemAway.defBonus;
  const ocHome = franchise.coaches?.[homeId]?.oc?.trait;
  const ocAway = franchise.coaches?.[awayId]?.oc?.trait;
  const dcHome = franchise.coaches?.[homeId]?.dc?.trait;
  const dcAway = franchise.coaches?.[awayId]?.dc?.trait;
  if (dcHome === "Pressure Package") sim.homeR.defense += 1;
  if (dcAway === "Pressure Package") sim.awayR.defense += 1;
  if (dcHome === "Ball Hawk") sim.homeR.defense += 1;
  if (dcAway === "Ball Hawk") sim.awayR.defense += 1;
  if (ocHome === "Trench General" && _getTeamOffScheme(homeId) === "SMASHMOUTH") sim.homeR.offense += 1;
  if (ocAway === "Trench General" && _getTeamOffScheme(awayId) === "SMASHMOUTH") sim.awayR.offense += 1;
  if (ocHome === "Red Zone Genius" && _getTeamOffScheme(homeId) === "WEST COAST") sim.homeR.offense += 1;
  if (ocAway === "Red Zone Genius" && _getTeamOffScheme(awayId) === "WEST COAST") sim.awayR.offense += 1;
  const _cb = r => r >= 83 ? 2 : r >= 72 ? 1 : r >= 55 ? 0 : -1;
  const _hc = (id) => franchise.coaches?.[id]?.hc?.rating || 60;
  const _oc = (id) => franchise.coaches?.[id]?.oc?.rating || 60;
  const _dc = (id) => franchise.coaches?.[id]?.dc?.rating || 60;
  sim.homeR.offense += _cb(_hc(homeId)) + _cb(_oc(homeId));
  sim.homeR.defense += _cb(_hc(homeId)) + _cb(_dc(homeId));
  sim.awayR.offense += _cb(_hc(awayId)) + _cb(_oc(awayId));
  sim.awayR.defense += _cb(_hc(awayId)) + _cb(_dc(awayId));
  const r = sim.simulate();
  r.weather = sim.weather;
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
  // Reg-season "faced your team" scouting bump on opposing players
  // who recorded a stat. ±5 noise, carries one season forward.
  _stampRegSeasonScouting(homeId, awayId, gameStats);
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
          scoreType: p.scoreType || null,
          scorer: p.scorer || null, passer: p.passer || null, kicker: p.kicker || null,
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

// AWR grows from game reps — pattern recognition and situational awareness
// compound over a season of live looks. Growth is FLAT-RATE regardless of
// archetype: a RAW_ATHLETE and HIGH_IQ player grow AWR at the same pace.
// The difference is where they START and what their ceiling is (_awrCeiling).
// Trench positions (OL/DL/LB/RB/TE) grow AWR too, but AWR feeds engine
// behavior for them (snap timing, gap reads, blitz pickup) rather than OVR.
function _inSeasonAwrGrowth() {
  const starterDepth = { QB:1, RB:2, WR:3, TE:2, OL:5, DL:4, LB:3, CB:3, S:2, K:1, P:1 };
  // AWR OVR weight by position — only these positions get an OVR nudge when AWR grows.
  // Accumulate fractionally; apply a +1 OVR only when the running total hits 1.0.
  const awrOvrWeight = { QB:0.21, WR:0.08, CB:0.08, S:0.08, K:0.42, P:0.42 };

  for (const t of TEAMS) {
    const roster = franchise.rosters[t.id] || [];
    const byPos = {};
    for (const p of roster) {
      if (!byPos[p.position]) byPos[p.position] = [];
      byPos[p.position].push(p);
    }
    for (const arr of Object.values(byPos)) arr.sort((a, b) => (b.overall||0) - (a.overall||0));
    // Hot-seat teams have a fractured locker room — AWR growth is
    // dampened until ownership resolves the coaching question.
    const hotSeatMul = (franchise.hotSeats?.[t.id] === franchise.season) ? 0.5 : 1.0;

    for (const p of roster) {
      const age = p.age || 25;
      if (age > 30) continue;

      const posGroup = byPos[p.position] || [];
      const depth    = starterDepth[p.position] || 2;
      const isStarter = posGroup.indexOf(p) < depth;
      const repRate   = isStarter ? 1.0 : 0.35;
      const sysMul    = (p.systemYears || 0) >= 1 ? 1.0 : 0.55;
      const ageMul    = age <= 22 ? 1.5 : age <= 25 ? 1.2 : age <= 28 ? 0.85 : 0.45;

      // Backfill _awrCeiling for any player that predates this system.
      if (p._awrCeiling == null) {
        p._awrCeiling = p.flavor === "HIGH_FOOTBALL_IQ" ? 82 + Math.floor(Math.random() * 14)
                      : p.flavor === "RAW_ATHLETE"       ? 55 + Math.floor(Math.random() * 18)
                      : 65 + Math.floor(Math.random() * 18);
      }

      if ((p.stats?.[3] ?? 70) >= p._awrCeiling) continue;

      // QB Whisperer OC boosts QB's in-season AWR development
      const ocTrait = franchise.coaches?.[t.id]?.oc?.trait;
      const awrBoost = (p.position === "QB" && ocTrait === "QB Whisperer") ? 1.3 : 1.0;

      if (Math.random() >= 0.25 * repRate * sysMul * ageMul * awrBoost * hotSeatMul) continue;

      p.stats[3] = Math.min(p._awrCeiling, (p.stats[3] ?? 70) + 1);

      // Nudge OVR for positions where AWR appears in the OVR formula.
      const w = awrOvrWeight[p.position];
      if (w) {
        p._awrOvrAccum = (p._awrOvrAccum || 0) + w;
        if (p._awrOvrAccum >= 1.0) {
          p.overall = Math.min(99, (p.overall || 60) + 1);
          p._awrOvrAccum -= 1.0;
        }
      }
    }
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
  // In-season AWR growth: game reps build pattern recognition and situational
  // awareness for all active-roster players. Flat rate regardless of archetype —
  // the starting AWR value is the differentiator, not the growth speed.
  _inSeasonAwrGrowth();
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

// Module-level pending votes for the voting page. _potwPendingVotesKey
// tracks which week/season the pending state belongs to, so re-renders
// triggered by card clicks preserve in-flight picks (only the first open
// of a new week re-seeds from saved votes).
let _potwPendingVotes = {};
let _potwPendingVotesKey = null;

function renderPotwVoting(week) {
  frnHoverTipHide(); _frnHoverTipPgHide && _frnHoverTipPgHide();
  const season = franchise.season;
  const candidates = franchise.potwCandidates?.[season]?.[week];
  if (!candidates) { showFranchiseDashboard(); return; }

  // Only seed pending votes from saved votes on first open of this week.
  // Re-renders during card selection must preserve the user's in-flight picks.
  if (_potwPendingVotesKey !== `${season}-${week}`) {
    const existingVotes = franchise.potwVotes?.[season]?.[week] || {};
    _potwPendingVotes = { ...existingVotes };
    _potwPendingVotesKey = `${season}-${week}`;
  }
  const existingVotes = franchise.potwVotes?.[season]?.[week] || {};

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
                       onclick="_potwSelect('${g.key}',${i},${week})"
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
        ? `<div class="potw-group-skip"><button class="bspn-back" onclick="_potwSelect('${g.key}',-1,${week})" style="font-size:.6rem">Clear vote</button></div>`
        : ""}
    </div>`;
  };

  const isRevote = Object.keys(existingVotes).length > 0;
  const picksSummary = `
    <div class="potw-picks-summary">
      <span class="potw-picks-summary-title">YOUR PICKS</span>
      ${GROUPS.map(g => {
        const name = _potwPendingVotes[g.key];
        return `<span class="potw-picks-summary-item">
          <span class="lbl">${g.icon} ${g.label.replace(" PLAYER","").replace("OFFENSIVE LINEMAN","OL").replace("SPECIAL TEAMS","ST")}</span>
          ${name ? `<b style="color:var(--blgold)">${name}</b>` : `<span class="none">— not picked —</span>`}
        </span>`;
      }).join("")}
    </div>`;
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
      <div style="padding:.8rem 1.4rem">
        ${picksSummary}
        ${GROUPS.map(renderGroup).join("")}
      </div>
      <div style="padding:.3rem 1.4rem 1rem;display:flex;gap:.8rem;align-items:center">
        <button class="frn-cap-btn" onclick="_potwSubmitVotes(${week})"
                style="padding:.55rem 1.6rem;font-size:.78rem;letter-spacing:1px">
          LOCK IN VOTES
        </button>
        <button class="bspn-back" onclick="showFranchiseDashboard()">Skip &amp; return</button>
      </div>
    </div>`;
}

function _potwSelect(group, idx, week) {
  const season = franchise.season;
  const candidates = franchise.potwCandidates?.[season]?.[week];
  if (!candidates) return;
  if (idx == null || idx < 0) delete _potwPendingVotes[group];
  else {
    const c = candidates[group]?.[idx];
    if (!c) return;
    _potwPendingVotes[group] = c.name;
  }
  renderPotwVoting(week);
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

// Generalized regular-season sim: runs from the current week up to and
// including targetWeek. Bails early if the phase transitions (cap
// over-spend forces fa_cuts, or the schedule completes and we land in
// playoffs_pending). Single source of truth — frnSimWeek and
// frnSimSeason are special-case wrappers around this.
function frnSimToWeek(targetWeek) {
  const target = Math.min(targetWeek, FRANCHISE_WEEKS);
  for (let w = franchise.week; w <= target; w++) {
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
    try { _runWeekEndResolution(); } catch(e) { console.error("[frnSimToWeek] resolution error (non-fatal):", e); }
    _bumpWeek();
    franchise.weekPending = false;
    if (franchise.phase === "fa_cuts" || franchise.phase === "playoffs_pending") break;
  }
  _flushSaveFranchise();
  showFranchiseDashboard();
}

// Sim regular season + auto-play through every playoff round to the
// championship. Lands on the awards/offseason screen.
function frnSimToEndOfSeason() {
  // Regular season
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
    try { _runWeekEndResolution(); } catch(e) { console.error("[frnSimToEndOfSeason] resolution error:", e); }
    _bumpWeek();
    franchise.weekPending = false;
    if (franchise.phase === "fa_cuts") {
      _flushSaveFranchise(); showFranchiseDashboard();
      return; // user has to handle the cap-overage cuts before continuing
    }
  }
  // Bracket setup (transitions phase to "playoffs")
  if (franchise.phase === "playoffs_pending") startFrnPlayoffs();
  // Loop every playoff round to championship
  let safety = 12;
  while (franchise.playoffBracket && safety-- > 0) {
    const pb = franchise.playoffBracket;
    if (pb.roundIdx >= pb.rounds.length) break;
    const rd = pb.rounds[pb.roundIdx];
    const isChampRound = pb.roundIdx === pb.rounds.length - 1;
    for (const m of rd) {
      if (!m.winnerId && m.homeId && m.awayId) {
        const r = frnSimOnce(m.homeId, m.awayId, /* isPlayoff */ true);
        m.homeScore = r.homeScore; m.awayScore = r.awayScore;
        m.winnerId  = r.homeScore >= r.awayScore ? m.homeId : m.awayId;
        m.stats = _stripGameStatsForStorage(r.full?.stats);
        m.scoring = _extractScoringTimeline(r.full?.plays, r.homeScore, r.awayScore);
        m.weather = r.full?.weather ? { label: r.full.weather.label, windStrength: r.full.weather.windStrength } : null;
        if (isChampRound) {
          franchise.superBowlGame = {
            homeId: m.homeId, awayId: m.awayId,
            homeScore: r.homeScore, awayScore: r.awayScore,
            stats: r.full.stats, winnerId: m.winnerId,
          };
        }
      }
    }
    const playoffWeek = FRANCHISE_WEEKS + pb.roundIdx + 1;
    try { _computePlayoffRoundPOTW(pb.roundIdx, playoffWeek); } catch(e) { console.error("[frnSimToEndOfSeason] POTW error:", e); }
    advancePlayoffRound();
    if (franchise.phase === "awards") break;
  }
  _flushSaveFranchise();
  showFranchiseDashboard();
}

// Confirm-wrapped UI entry points — every sim that advances time
// requires an explicit second click so a misclick can't burn weeks
// of franchise management.
function frnConfirmSimWeek() {
  const w = franchise.week;
  const games = franchise.schedule.filter(g => g.week === w && !g.played).length;
  if (!confirm(`Sim through Week ${w}? ${games} game${games===1?"":"s"} will play and the week will close.`)) return;
  _frnSimPanelOpen = false;
  frnSimWeek();
}
function frnConfirmSimToWeek(target) {
  const t = Math.max(franchise.week, Math.min(FRANCHISE_WEEKS, Number(target) || franchise.week));
  if (t <= franchise.week) return frnConfirmSimWeek();
  const weeks = t - franchise.week + 1;
  if (!confirm(`Sim through Week ${t}? That's ${weeks} weeks — you won't be able to make roster moves in the interim.`)) return;
  _frnSimPanelOpen = false;
  frnSimToWeek(t);
}
function frnConfirmSimToPlayoffs() {
  const t = FRANCHISE_WEEKS;
  const weeks = t - franchise.week + 1;
  if (weeks <= 0) return;
  if (!confirm(`Sim to end of regular season (Week ${t})? That's ${weeks} weeks. You'll land on the playoff bracket.`)) return;
  _frnSimPanelOpen = false;
  frnSimToWeek(t);
}
function frnConfirmSimToEndOfSeason() {
  const msg = "⚠ SIM TO END OF SEASON\n\n" +
              "This will:\n" +
              " • Sim every remaining regular-season game\n" +
              " • Auto-run the entire playoff bracket\n" +
              " • Land you on the awards / offseason screen\n\n" +
              "You'll lose all ability to manage your team this season.\n\n" +
              "Continue?";
  if (!confirm(msg)) return;
  _frnSimPanelOpen = false;
  frnSimToEndOfSeason();
}

// ── Two-click guards on phase-advance buttons ────────────────────────────
// Each underlying primitive (frnAdvanceWeek / startFrnPlayoffs / ...) is
// kept raw so programmatic chains (sim → auto-advance) still work without
// nagging the user. The frnConfirm* versions wrap with confirm() and are
// what the UI buttons route through, making every advance two-click.
function frnConfirmAdvanceWeek() {
  const nextW = (franchise.week || 0) + 1;
  if (!confirm(`Advance to Week ${nextW}? Week-end resolution (FA round, injuries, AWR growth) runs now.`)) return;
  frnAdvanceWeek();
}
function frnConfirmStartPlayoffs() {
  if (!confirm("Start the playoffs? The regular season closes and the bracket gets seeded.")) return;
  startFrnPlayoffs();
}
function frnConfirmAdvancePlayoffRound() {
  if (!confirm("Advance to the next playoff round?")) return;
  frnAdvancePlayoffRound();
}
function frnConfirmFAFinish() {
  if (!confirm("Lock in free agency and start Week 1? You won't be able to make further signings until the offseason.")) return;
  frnFAFinish();
}
function frnConfirmGoToDraft() {
  if (!confirm("Open the draft? Roster moves still happen in FA after, but this leaves the offseason home.")) return;
  frnGoToDraft();
}
function frnConfirmNewSeason() {
  const nextS = (franchise.season || 1) + 1;
  const msg = "⚠ BEGIN SEASON " + nextS + "\n\n" +
              "This will:\n" +
              " • Generate a fresh schedule and reset standings\n" +
              " • Wipe season stats, highlights, and weekly state\n" +
              " • Roll players' careers forward (age, retire, develop)\n" +
              " • Open a new free-agency window\n\n" +
              "Continue?";
  if (!confirm(msg)) return;
  frnNewSeason();
}
function frnConfirmDraftContinueToSeason() { frnConfirmNewSeason(); }

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

  const isRivalry = _areRivals(homeId, awayId);
  const sim = new GameSimulator(home, away, homeRoster, awayRoster,
    { isRivalry,
      homeSnaps: _buildSnapMap(homeId),
      awaySnaps: _buildSnapMap(awayId) });
  // Apply the same coaching + scheme boosts as frnSimOnce so live games
  // and auto-sims are driven by identical modifiers.
  const hcHome = franchise.coaches?.[homeId]?.hc?.specialtyTrait;
  const hcAway = franchise.coaches?.[awayId]?.hc?.specialtyTrait;
  if (hcHome === "Offensive Minded") sim.homeR.offense += 2;
  if (hcHome === "Defensive Minded") sim.homeR.defense += 2;
  if (hcAway === "Offensive Minded") sim.awayR.offense += 2;
  if (hcAway === "Defensive Minded") sim.awayR.defense += 2;
  const chemHome = _computeChemistryBonus(homeId);
  const chemAway = _computeChemistryBonus(awayId);
  sim.homeR.offense += chemHome.offBonus; sim.homeR.defense += chemHome.defBonus;
  sim.awayR.offense += chemAway.offBonus; sim.awayR.defense += chemAway.defBonus;
  if (chemHome.chaotic) { const s = Math.random() < 0.5 ? 2 : -2; sim.homeR.offense += s; sim.homeR.defense += s; }
  if (chemAway.chaotic) { const s = Math.random() < 0.5 ? 2 : -2; sim.awayR.offense += s; sim.awayR.defense += s; }
  const ocHome = franchise.coaches?.[homeId]?.oc?.trait;
  const ocAway = franchise.coaches?.[awayId]?.oc?.trait;
  const dcHome = franchise.coaches?.[homeId]?.dc?.trait;
  const dcAway = franchise.coaches?.[awayId]?.dc?.trait;
  if (dcHome === "Pressure Package") sim.homeR.defense += 1;
  if (dcAway === "Pressure Package") sim.awayR.defense += 1;
  if (dcHome === "Run Stopper" && _getTeamOffScheme(awayId) === "SMASHMOUTH") sim.homeR.defense += 1;
  if (dcAway === "Run Stopper" && _getTeamOffScheme(homeId) === "SMASHMOUTH") sim.awayR.defense += 1;
  if (dcHome === "Ball Hawk") sim.homeR.defense += 1;
  if (dcAway === "Ball Hawk") sim.awayR.defense += 1;
  const _filmBonus = (teamId) => {
    const def = (franchise.rosters[teamId] || []).filter(p => ["DL","LB","CB","S"].includes(p.position));
    if (!def.length) return 0;
    const top5 = def.map(p => p.stats?.[11] ?? 68).sort((a,b) => b-a).slice(0,5);
    const avg = top5.reduce((s,v) => s+v, 0) / top5.length;
    return avg >= 95 ? 3 : avg >= 85 ? 2 : avg >= 75 ? 1 : 0;
  };
  if (dcHome === "Film Mastermind") sim.homeR.defense += _filmBonus(homeId);
  if (dcAway === "Film Mastermind") sim.awayR.defense += _filmBonus(awayId);
  if (ocHome === "Trench General" && _getTeamOffScheme(homeId) === "SMASHMOUTH") sim.homeR.offense += 1;
  if (ocAway === "Trench General" && _getTeamOffScheme(awayId) === "SMASHMOUTH") sim.awayR.offense += 1;
  if (ocHome === "Red Zone Genius" && _getTeamOffScheme(homeId) === "WEST COAST") sim.homeR.offense += 1;
  if (ocAway === "Red Zone Genius" && _getTeamOffScheme(awayId) === "WEST COAST") sim.awayR.offense += 1;
  const _cb = r => r >= 83 ? 2 : r >= 72 ? 1 : r >= 55 ? 0 : -1;
  const _hc = (id) => franchise.coaches?.[id]?.hc?.rating || 60;
  const _oc = (id) => franchise.coaches?.[id]?.oc?.rating || 60;
  const _dc = (id) => franchise.coaches?.[id]?.dc?.rating || 60;
  sim.homeR.offense += _cb(_hc(homeId)) + _cb(_oc(homeId));
  sim.homeR.defense += _cb(_hc(homeId)) + _cb(_dc(homeId));
  sim.awayR.offense += _cb(_hc(awayId)) + _cb(_oc(awayId));
  sim.awayR.defense += _cb(_hc(awayId)) + _cb(_dc(awayId));
  const homeSchemeMod = Math.round(_schemeMatchup(_getTeamOffScheme(homeId), _getTeamDefScheme(awayId)) * 0.5);
  const awaySchemeMod = Math.round(_schemeMatchup(_getTeamOffScheme(awayId), _getTeamDefScheme(homeId)) * 0.5);
  sim.homeR.offense += homeSchemeMod;
  sim.awayR.offense += awaySchemeMod;
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
    mergeSeasonStats(homeId, awayId, gameResult.stats, _gameMergeKey(homeId, awayId, isPlayoff));
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
    // Queue the post-game recap if this was the user's matchup.
    if (pb && (homeId === franchise.chosenTeamId || awayId === franchise.chosenTeamId)) {
      const rd = pb.rounds?.[pb.roundIdx];
      const mi = rd?.findIndex(x =>
        (x.homeId === homeId && x.awayId === awayId) ||
        (x.homeId === awayId && x.awayId === homeId));
      if (mi != null && mi !== -1) {
        _frnPlayoffRecapPending = { roundIdx: pb.roundIdx, matchupIdx: mi };
      }
    }
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
        <span style="font-size:.68rem;color:var(--blwhite)">${_playerLinkSmart(l.name)}</span>
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

// ── Bracket tree (full visual tournament tree) ──────────────────────────────
// Renders the entire 8-team bracket as a 3-column tree. Each column is one
// round; pairs of feeder matchups visually align with their parent slot in
// the next column. Played games show scores, future slots show "TBD" or
// "Winner of X / Y". User's path glows gold across the tree.
function _renderBracketTree() {
  const pb = franchise.playoffBracket;
  if (!pb) return "";
  const { seeds, rounds, roundIdx, champion } = pb;
  const myId = franchise.chosenTeamId;
  const seedOf = id => seeds.find(s => s.teamId === id)?.seed;

  const isUserPath = (m) => {
    if (!m) return false;
    if (m.homeId === myId || m.awayId === myId) return true;
    if (m.winnerId === myId) return true;
    return false;
  };

  // Single-team row inside a bracket-tree card
  const teamRow = (teamId, score, isWinner, isLoser) => {
    if (teamId == null) {
      return `<div class="frn-bt-team empty">
        <span class="seed"></span>
        <span class="name">—</span>
        <span class="score"></span>
      </div>`;
    }
    const t = getTeam(teamId);
    const seed = seedOf(teamId);
    const isMine = teamId === myId;
    return `<div class="frn-bt-team ${isWinner?"win":""} ${isLoser?"loss":""} ${isMine?"mine":""}" style="--team-color:${t.primary}">
      <span class="seed">${seed||"?"}</span>
      <span class="name">${t.abbr || t.name.slice(0,3).toUpperCase()}</span>
      <span class="score">${score != null ? score : ""}</span>
    </div>`;
  };

  // Look up which teams could fill a future slot by walking the feeder
  // matchups in the previous round.
  const projectedTeamsForFuture = (ri, mi) => {
    if (ri === 0) return [null, null];
    const feederA = rounds[ri-1]?.[mi * 2];
    const feederB = rounds[ri-1]?.[mi * 2 + 1];
    const idA = feederA?.winnerId
      ?? (feederA?.homeId && feederA?.awayId ? null : null);
    const idB = feederB?.winnerId
      ?? (feederB?.homeId && feederB?.awayId ? null : null);
    return [idA, idB];
  };

  const matchupCardLite = (m, ri, mi) => {
    const played = m && m.winnerId != null;
    const isCurrent = ri === roundIdx && !played;
    const onUserPath = m && isUserPath(m);
    const tag = (ri === roundIdx && m && m.homeId && m.awayId && !played)
      ? `<div class="frn-bt-tag">${_playoffMatchupTag(m, seeds).replace(/^(.. )/,"")}</div>`
      : "";
    // Build the two team rows. For unplayed future slots, project from feeders.
    let homeId = m?.homeId, awayId = m?.awayId;
    let homeScore = m?.homeScore, awayScore = m?.awayScore;
    let projectedLine = "";
    if (!played && (!homeId || !awayId)) {
      // Future round — project from feeders
      const [pHome, pAway] = projectedTeamsForFuture(ri, mi);
      homeId = pHome; awayId = pAway;
      // If either side has multiple candidates, show "TBD"
      const feederA = rounds[ri-1]?.[mi * 2];
      const feederB = rounds[ri-1]?.[mi * 2 + 1];
      if (!homeId && feederA?.homeId && feederA?.awayId) {
        const hA = getTeam(feederA.homeId), aA = getTeam(feederA.awayId);
        projectedLine += `<div class="frn-bt-proj">Winner: ${hA?.abbr||"?"} / ${aA?.abbr||"?"}</div>`;
      }
      if (!awayId && feederB?.homeId && feederB?.awayId) {
        const hB = getTeam(feederB.homeId), aB = getTeam(feederB.awayId);
        projectedLine += `<div class="frn-bt-proj">Winner: ${hB?.abbr||"?"} / ${aB?.abbr||"?"}</div>`;
      }
    }
    const hWin = played && m.winnerId === homeId;
    const aWin = played && m.winnerId === awayId;
    const classes = [
      "frn-bt-card",
      played ? "played" : "",
      isCurrent ? "current" : "",
      onUserPath ? "user-path" : "",
      champion && played && m.winnerId === champion && ri === rounds.length - 1 ? "champion" : "",
    ].filter(Boolean).join(" ");
    const clickable = played
      ? `onclick="frnOpenPlayoffBox(${ri}, ${mi})" role="button" tabindex="0"`
      : "";
    return `<div class="${classes}" ${clickable}>
      ${tag}
      ${teamRow(homeId, homeScore, hWin, played && !hWin)}
      ${teamRow(awayId, awayScore, aWin, played && !aWin)}
      ${projectedLine}
    </div>`;
  };

  const roundLabels = ["WILD CARD", "DIVISIONAL", "CHAMPIONSHIP"];
  // Render each round column. Pairs of feeders share a "pair-wrap" so we
  // can visually group them (pseudo-element connectors line them up to
  // the next column's parent slot).
  const renderColumn = (ri) => {
    const round = rounds[ri] || [];
    const cards = [];
    // Pair them up: matchups 2k and 2k+1 feed into matchup k of next round.
    for (let mi = 0; mi < round.length; mi += 2) {
      const pair = round.slice(mi, mi + 2);
      cards.push(`<div class="frn-bt-pair">
        ${pair.map((m, j) => matchupCardLite(m, ri, mi + j)).join("")}
      </div>`);
    }
    const isCurrentRound = ri === roundIdx && !champion;
    return `<div class="frn-bt-col ${isCurrentRound?"current":""}">
      <div class="frn-bt-col-head">
        <span class="num">${ri+1}</span>
        <span class="lbl">${roundLabels[ri] || `ROUND ${ri+1}`}</span>
        ${isCurrentRound ? `<span class="now">NOW</span>` : ""}
      </div>
      <div class="frn-bt-col-cards">${cards.join("")}</div>
    </div>`;
  };

  return `<div class="frn-bracket-tree">
    ${rounds.map((_, ri) => renderColumn(ri)).join("")}
  </div>`;
}

// Module state — pregame breakdown is collapsed by default in the new
// playoff layout so the bracket stays the visual centerpiece.
let _frnPlayoffPregameExpanded = false;

// Pending post-game recap for the user's most recently played playoff
// matchup. Set by frnFinishGame / frnSimPlayoffGame, consumed and
// cleared by renderFrnPlayoffs (which routes to the recap takeover
// instead of the bracket on this pass).
let _frnPlayoffRecapPending = null; // { roundIdx, matchupIdx } | null
function frnDismissPlayoffRecap() {
  _frnPlayoffRecapPending = null;
  renderFrnPlayoffs();
}
function _frnTogglePlayoffPregame() {
  _frnPlayoffPregameExpanded = !_frnPlayoffPregameExpanded;
  renderFrnPlayoffs();
}

// ── Current game hub ─────────────────────────────────────────────────────────
// The "what you're doing this round" workspace. Three modes:
//   1. User's matchup unplayed → featured card + collapsible pregame
//   2. User played but round not done → progress + sim-remaining CTA
//   3. Round complete → big advance/crown ceremony block
function _renderCurrentGameHub(currentRound) {
  const pb = franchise.playoffBracket;
  if (!pb || pb.champion) return "";
  const myId = franchise.chosenTeamId;
  const roundNames = ["WILD CARD", "DIVISIONAL", "CHAMPIONSHIP"];
  const roundIdx = pb.roundIdx;
  const userStatus = _userPlayoffStatus();

  const userMatchup = currentRound?.find(m =>
    (m.homeId === myId || m.awayId === myId) && m.winnerId == null);
  const allRoundDone = currentRound && currentRound.every(m => m.winnerId != null);
  const pending = currentRound ? currentRound.filter(m => !m.winnerId && m.homeId && m.awayId) : [];

  // ── Mode 3: Round complete → advance ceremony ────────────────────────
  if (allRoundDone) {
    const isFinalRound = roundIdx >= pb.rounds.length - 1;
    const nextLabel = isFinalRound ? "Crown Champion" : `Advance to ${roundNames[roundIdx + 1] || "Next Round"}`;
    const subText = isFinalRound
      ? "The trophy is one click away."
      : "All games are final — the next round is set.";
    return `<div class="frn-playoff-hub advance">
      <div class="frn-playoff-hub-eyebrow">${roundNames[roundIdx]} COMPLETE</div>
      <div class="frn-playoff-hub-title">${nextLabel}</div>
      <div class="frn-playoff-hub-sub">${subText}</div>
      <button class="frn-playoff-hub-cta" onclick="frnConfirmAdvancePlayoffRound()">
        ${isFinalRound ? "🌟 CROWN CHAMPION" : "▶ ADVANCE ROUND"}
      </button>
    </div>`;
  }

  // ── Mode 2: User has nothing to play this round (already played and
  //          won, eliminated, or wasn't in playoffs at all). Show
  //          progress + a sim-remaining CTA. Sub-line depends on which.
  if (!userMatchup) {
    const playedCount = currentRound.filter(m => m.winnerId != null).length;
    const totalInRound = currentRound.length;
    // Did the user just play and win their game this round?
    const userJustAdvanced = currentRound.some(m =>
      (m.homeId === myId || m.awayId === myId) && m.winnerId === myId);
    const eliminated = userStatus.eliminatedRound != null;
    let elimText;
    if (userJustAdvanced) {
      elimText = "Your matchup is final — sim the rest of the round to see who's next.";
    } else if (eliminated) {
      elimText = `Your run ended in ${roundNames[userStatus.eliminatedRound] || "an earlier round"}.`;
    } else {
      elimText = "Watching from the couch this postseason.";
    }
    return `<div class="frn-playoff-hub spectate">
      <div class="frn-playoff-hub-eyebrow">${roundNames[roundIdx]} — IN PROGRESS</div>
      <div class="frn-playoff-hub-title">${playedCount} of ${totalInRound} games played</div>
      <div class="frn-playoff-hub-sub">${elimText}</div>
      <button class="frn-playoff-hub-cta" onclick="frnSimPlayoffRound()" ${pending.length===0?'disabled':''}>
        ⏩ SIM ${pending.length} REMAINING
      </button>
    </div>`;
  }

  // ── Mode 1: User has unplayed matchup → featured + pregame ───────────
  const m = userMatchup;
  const mi = currentRound.indexOf(m);
  const home = getTeam(m.homeId), away = getTeam(m.awayId);
  const homeSeed = pb.seeds.find(s => s.teamId === m.homeId)?.seed;
  const awaySeed = pb.seeds.find(s => s.teamId === m.awayId)?.seed;
  const isHome = m.homeId === myId;
  const oppId = isHome ? m.awayId : m.homeId;
  const opp = getTeam(oppId);
  const tag = _playoffMatchupTag(m, pb.seeds);
  const homeStand = franchise.standings?.[m.homeId] || { w:0, l:0 };
  const awayStand = franchise.standings?.[m.awayId] || { w:0, l:0 };

  const sideHtml = (team, seed, stand, isMine) => `
    <div class="frn-playoff-feat-side ${isMine?"mine":""}" style="--team-color:${team.primary}">
      <div class="frn-playoff-feat-seed">#${seed||"?"}</div>
      <div class="frn-playoff-feat-ascii">${typeof teamAscii==="function"?teamAscii(team):"🏈"}</div>
      <div class="frn-playoff-feat-name">${team.city}<br><b>${team.name.toUpperCase()}</b></div>
      <div class="frn-playoff-feat-rec">${stand.w}-${stand.l}${stand.t?`-${stand.t}`:""}</div>
    </div>`;

  // Collapsed pregame preview = single button. Expanded = call existing fn.
  const pregameHtml = _frnPlayoffPregameExpanded
    ? `<div class="frn-playoff-pregame-wrap">
        ${_renderPregamePreview(m, pb.seeds)}
        <button class="frn-playoff-pregame-toggle" onclick="_frnTogglePlayoffPregame()">▴ Hide pregame breakdown</button>
      </div>`
    : `<button class="frn-playoff-pregame-toggle collapsed" onclick="_frnTogglePlayoffPregame()">
        ▾ Show pregame breakdown <span style="color:var(--blgray);font-weight:400">· head-to-head · recent form · team film</span>
      </button>`;

  return `<div class="frn-playoff-hub featured">
    <div class="frn-playoff-hub-eyebrow">${roundNames[roundIdx]} · YOUR MATCHUP</div>
    ${tag ? `<div class="frn-playoff-hub-tag">${tag}</div>` : ""}
    <div class="frn-playoff-feat-matchup">
      ${sideHtml(home, homeSeed, homeStand, isHome)}
      <div class="frn-playoff-feat-vs">${isHome ? "vs" : "@"}<div class="atstad">AT ${home.city.toUpperCase()}</div></div>
      ${sideHtml(away, awaySeed, awayStand, !isHome)}
    </div>
    <div class="frn-playoff-feat-actions">
      <button class="frn-playoff-hub-cta primary" onclick="frnPlayGame(${m.homeId},${m.awayId},true)">▶ PLAY GAME</button>
      <button class="frn-playoff-hub-cta secondary" onclick="frnSimPlayoffGame(${m.homeId},${m.awayId})">⏩ SIM</button>
    </div>
    ${pregameHtml}
  </div>`;
}

// ── Other current-round matchups — compact horizontal strip ──────────────────
function _renderOtherMatchups(currentRound) {
  const pb = franchise.playoffBracket;
  if (!pb || pb.champion) return "";
  const myId = franchise.chosenTeamId;
  const roundIdx = pb.roundIdx;
  const others = currentRound.filter(m =>
    m.homeId !== myId && m.awayId !== myId);
  if (!others.length) return "";
  const mkChip = (m) => {
    const mi = currentRound.indexOf(m);
    const home = getTeam(m.homeId), away = getTeam(m.awayId);
    const hSeed = pb.seeds.find(s => s.teamId === m.homeId)?.seed || "?";
    const aSeed = pb.seeds.find(s => s.teamId === m.awayId)?.seed || "?";
    const played = m.winnerId != null;
    const hWin = played && m.winnerId === m.homeId;
    const aWin = played && m.winnerId === m.awayId;
    const actions = !played
      ? `<button class="frn-pl-otherchip-sim" onclick="frnSimPlayoffGame(${m.homeId},${m.awayId})">⏩ Sim</button>`
      : `<button class="frn-pl-otherchip-box" onclick="frnOpenPlayoffBox(${roundIdx},${mi})">📋 Box</button>`;
    return `<div class="frn-pl-otherchip ${played?"played":""}">
      <div class="frn-pl-otherchip-team ${hWin?"win":""} ${played&&!hWin?"loss":""}" style="--team-color:${home.primary}">
        <span class="seed">${hSeed}</span>
        <span class="abbr">${home.abbr || home.name.slice(0,3).toUpperCase()}</span>
        <span class="score">${m.homeScore != null ? m.homeScore : "—"}</span>
      </div>
      <div class="frn-pl-otherchip-team ${aWin?"win":""} ${played&&!aWin?"loss":""}" style="--team-color:${away.primary}">
        <span class="seed">${aSeed}</span>
        <span class="abbr">${away.abbr || away.name.slice(0,3).toUpperCase()}</span>
        <span class="score">${m.awayScore != null ? m.awayScore : "—"}</span>
      </div>
      ${actions}
    </div>`;
  };
  return `<div class="frn-pl-otherwrap">
    <div class="frn-pl-otherlbl">OTHER ${["WILD CARD","DIVISIONAL","CHAMPIONSHIP"][roundIdx] || ""} MATCHUPS</div>
    <div class="frn-pl-othergrid">${others.map(mkChip).join("")}</div>
  </div>`;
}

// ── Post-game recap (user's playoff matchup) ────────────────────────────────
// Full-screen takeover shown right after the user finishes a playoff game
// (sim or interactive). Surfaces the final score, advancement / elimination
// status, heroes from both sides, team-stat comparison, scoring timeline,
// and how the rest of the round shook out.
function _renderPlayoffGameRecap() {
  const ref = _frnPlayoffRecapPending;
  if (!ref) return "";
  const pb = franchise.playoffBracket;
  if (!pb) return "";
  const m = pb.rounds?.[ref.roundIdx]?.[ref.matchupIdx];
  if (!m || m.winnerId == null) return "";
  const myId = franchise.chosenTeamId;
  const isUserGame = m.homeId === myId || m.awayId === myId;
  if (!isUserGame) return "";
  const roundNames = ["WILD CARD", "DIVISIONAL", "CHAMPIONSHIP"];
  const roundName = roundNames[ref.roundIdx] || `ROUND ${ref.roundIdx + 1}`;
  const nextRoundName = roundNames[ref.roundIdx + 1];
  const isFinalRound = ref.roundIdx >= (pb.rounds.length - 1);

  // ── Score + framing ─────────────────────────────────────────────────
  const home = getTeam(m.homeId), away = getTeam(m.awayId);
  const myTeam = home.id === myId ? home : away;
  const oppTeam = home.id === myId ? away : home;
  const myScore = m.homeId === myId ? m.homeScore : m.awayScore;
  const oppScore = m.homeId === myId ? m.awayScore : m.homeScore;
  const userWon = m.winnerId === myId;
  const margin = myScore - oppScore;
  let headlineMain, headlineSub, statusClass;
  if (userWon) {
    statusClass = "win";
    if (isFinalRound) {
      headlineMain = "🏆 CHAMPIONS";
      headlineSub = `Season ${franchise.season} title — ${myTeam.city} ${myTeam.name}`;
    } else {
      headlineMain = "✓ ADVANCING";
      headlineSub = `On to the ${nextRoundName || "next round"}`;
    }
  } else {
    statusClass = "loss";
    headlineMain = "✗ ELIMINATED";
    headlineSub = `Season ends in the ${roundName.toLowerCase()}`;
  }

  // ── Heroes ──────────────────────────────────────────────────────────
  // Per-player game score. Higher = bigger impact. Position-aware so a
  // QB's 300 yds doesn't drown out a DB's 2-INT game.
  const scorePlayer = (p) => {
    const pos = p.pos || "";
    if (pos === "QB") {
      return (p.pass_yds || 0) * 0.04 + (p.pass_td || 0) * 4 - (p.pass_int || 0) * 2
        + (p.rush_yds || 0) * 0.1 + (p.rush_td || 0) * 6;
    }
    if (pos === "RB") {
      return (p.rush_yds || 0) * 0.1 + (p.rush_td || 0) * 6
        + (p.rec || 0) * 1 + (p.rec_yds || 0) * 0.1 + (p.rec_td || 0) * 6;
    }
    if (pos === "WR" || pos === "TE") {
      return (p.rec || 0) * 1 + (p.rec_yds || 0) * 0.1 + (p.rec_td || 0) * 6;
    }
    // Defense / OL
    return (p.tkl || 0) * 1 + (p.sk || 0) * 4 + (p.int_made || 0) * 6
      + (p.ff || 0) * 4 + (p.fr || 0) * 3 + (p.def_td || 0) * 6 + (p.pd || 0) * 1.5;
  };
  const statLine = (p) => {
    const pos = p.pos || "";
    if (pos === "QB") {
      const parts = [];
      if (p.pass_yds) parts.push(`${p.pass_yds} YDS`);
      if (p.pass_td) parts.push(`${p.pass_td} TD`);
      if (p.pass_int) parts.push(`${p.pass_int} INT`);
      if (p.rush_yds) parts.push(`${p.rush_yds} ryds`);
      if (p.rush_td) parts.push(`${p.rush_td} rTD`);
      return parts.join(" · ");
    }
    if (pos === "RB") {
      const parts = [];
      if (p.rush_yds) parts.push(`${p.rush_yds} YDS`);
      if (p.rush_td) parts.push(`${p.rush_td} TD`);
      if (p.rush_att) parts.push(`${p.rush_att} ATT`);
      if (p.rec) parts.push(`${p.rec} REC · ${p.rec_yds||0} YDS`);
      if (p.rec_td) parts.push(`${p.rec_td} recTD`);
      return parts.join(" · ");
    }
    if (pos === "WR" || pos === "TE") {
      const parts = [];
      if (p.rec) parts.push(`${p.rec}/${p.rec_tgt||p.rec} REC`);
      if (p.rec_yds) parts.push(`${p.rec_yds} YDS`);
      if (p.rec_td) parts.push(`${p.rec_td} TD`);
      return parts.join(" · ");
    }
    const parts = [];
    if (p.tkl) parts.push(`${p.tkl} TKL`);
    if (p.sk) parts.push(`${p.sk} SK`);
    if (p.int_made) parts.push(`${p.int_made} INT`);
    if (p.ff) parts.push(`${p.ff} FF`);
    if (p.pd) parts.push(`${p.pd} PD`);
    if (p.def_td) parts.push(`${p.def_td} TD`);
    return parts.join(" · ") || `${p.gp||1} game`;
  };
  const mySide = (m.homeId === myId) ? m.stats?.home : m.stats?.away;
  const oppSide = (m.homeId === myId) ? m.stats?.away : m.stats?.home;
  const mineRanked  = Object.values(mySide?.players || {})
    .map(p => ({ p, score: scorePlayer(p) }))
    .filter(x => x.score >= 5)
    .sort((a,b) => b.score - a.score);
  const oppRanked = Object.values(oppSide?.players || {})
    .map(p => ({ p, score: scorePlayer(p) }))
    .filter(x => x.score >= 5)
    .sort((a,b) => b.score - a.score);
  const heroes = mineRanked.slice(0, 3);
  const villain = oppRanked[0];

  const heroIcon = (pos) => pos === "QB" ? "🎯"
    : pos === "RB" ? "💨" : pos === "WR" || pos === "TE" ? "🪂"
    : "🛡";
  const heroCardHtml = (h, sideClass) => {
    const escName = (h.p.name || "").replace(/'/g, "\\'");
    const escPid  = (h.p.pid || "").replace(/'/g, "\\'");
    return `<div class="frn-prg-hero ${sideClass}">
      <div class="frn-prg-hero-icon">${heroIcon(h.p.pos)}</div>
      <div class="frn-prg-hero-body">
        <div class="frn-prg-hero-name">
          <span style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px"
                onclick="frnOpenPlayerCard('${escName}','${escPid}')">${h.p.name}</span>
          <span class="pos">${h.p.pos || ""}</span>
        </div>
        <div class="frn-prg-hero-stat">${statLine(h.p)}</div>
      </div>
    </div>`;
  };

  // ── Team stat comparison ────────────────────────────────────────────
  const mineT = mySide?.totals || {};
  const oppT  = oppSide?.totals || {};
  const cmpRows = [
    ["Total yards",   mineT.totalYds || 0, oppT.totalYds || 0],
    ["Passing",       mineT.passYds  || 0, oppT.passYds  || 0],
    ["Rushing",       mineT.rushYds  || 0, oppT.rushYds  || 0],
    ["First downs",   mineT.firstDowns || 0, oppT.firstDowns || 0],
    ["Turnovers",     mineT.turnovers || 0, oppT.turnovers || 0, /* lowerBetter */ true],
    ["Sacks",         mineT.sacks    || 0, oppT.sacks    || 0],
    ["Penalties",     mineT.penalties || 0, oppT.penalties || 0, true],
    ["Time of poss",  mineT.timeOfPoss || 0, oppT.timeOfPoss || 0],
  ].filter(r => (r[1] || 0) + (r[2] || 0) > 0);
  const fmtTOP = (sec) => {
    if (!sec) return "—";
    const mm = Math.floor(sec / 60), ss = sec % 60;
    return `${mm}:${String(ss).padStart(2,"0")}`;
  };
  const cmpRowHtml = ([label, mineV, oppV, lowerBetter]) => {
    const showMine = label === "Time of poss" ? fmtTOP(mineV) : mineV;
    const showOpp  = label === "Time of poss" ? fmtTOP(oppV)  : oppV;
    const winner = mineV === oppV ? "tie" : (lowerBetter ? (mineV < oppV ? "mine" : "opp") : (mineV > oppV ? "mine" : "opp"));
    return `<tr>
      <td class="v ${winner==='mine'?'win':''}">${showMine}</td>
      <td class="lbl">${label}</td>
      <td class="v opp ${winner==='opp'?'win':''}">${showOpp}</td>
    </tr>`;
  };

  // ── Scoring timeline (compact, score events only) ───────────────────
  const scoring = (m.scoring || []).filter(ev => ev.isScore);
  // Map "home"/"away" poss → teamId on this matchup.
  const teamIdForPoss = (poss) => poss === "home" ? m.homeId
    : poss === "away" ? m.awayId : null;
  // Build a readable label from whatever the extractor preserved.
  const scoreLabel = (ev) => {
    if (ev.desc && ev.desc.length > 1) return ev.desc;
    if (ev.scoreType) {
      if (ev.scoreType === "TD")      return `Touchdown${ev.scorer?` — ${ev.scorer}`:""}`;
      if (ev.scoreType === "FG")      return `Field goal${ev.kicker?` — ${ev.kicker}`:""}`;
      if (ev.scoreType === "XP")      return "Extra point";
      if (ev.scoreType === "2PT")     return "2-point conversion";
      if (ev.scoreType === "SAFETY")  return "Safety";
      return ev.scoreType;
    }
    if (ev.pts === 7 || ev.pts === 6) return "Touchdown";
    if (ev.pts === 3) return "Field goal";
    if (ev.pts === 2) return "Safety / 2-pt";
    if (ev.pts === 1) return "Extra point";
    return `+${ev.pts} pts`;
  };
  const fmtClock = (sec) => {
    if (sec == null) return "";
    const mm = Math.floor(sec / 60), ss = sec % 60;
    return `${mm}:${String(ss).padStart(2,"0")}`;
  };
  const scoringHtml = scoring.length ? `
    <div class="frn-prg-card">
      <div class="frn-prg-card-title">SCORING SUMMARY</div>
      <div class="frn-prg-scoring">
        ${scoring.map(ev => {
          const tId = teamIdForPoss(ev.poss);
          const t = tId ? getTeam(tId) : null;
          const isMine = tId === myId;
          const tAbbr = t ? (t.abbr || t.name.slice(0,3).toUpperCase()) : "—";
          return `<div class="frn-prg-scoring-row">
            <span class="q">Q${ev.qtr || "?"}</span>
            <span class="team" style="color:${t?.primary || 'var(--blwhite)'};font-weight:${isMine?700:400}">${tAbbr}</span>
            <span class="desc">${scoreLabel(ev)}${ev.clock != null ? ` <span style="color:var(--blgray);font-weight:400;font-size:.55rem">(${fmtClock(ev.clock)})</span>` : ""}</span>
            <span class="score">${ev.homeScore}-${ev.awayScore}</span>
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  // ── Around the playoffs (other matchups this round) ─────────────────
  const otherRoundResults = (pb.rounds[ref.roundIdx] || [])
    .filter((mm, i) => i !== ref.matchupIdx && mm.winnerId != null);
  const aroundHtml = otherRoundResults.length ? `
    <div class="frn-prg-card">
      <div class="frn-prg-card-title">AROUND THE ${roundName}</div>
      <div class="frn-prg-around">
        ${otherRoundResults.map(mm => {
          const winT = getTeam(mm.winnerId);
          const losId = mm.homeId === mm.winnerId ? mm.awayId : mm.homeId;
          const losT = getTeam(losId);
          const wScore = mm.winnerId === mm.homeId ? mm.homeScore : mm.awayScore;
          const lScore = mm.winnerId === mm.homeId ? mm.awayScore : mm.homeScore;
          return `<div class="frn-prg-around-row">
            <span style="color:${winT?.primary};font-weight:800">${winT?.abbr || winT?.name?.slice(0,3).toUpperCase()}</span>
            <span style="font-family:'IBM Plex Mono','JetBrains Mono',monospace;color:var(--blwhite);font-weight:700">${wScore}</span>
            <span style="color:var(--blgray)">def.</span>
            <span style="color:${losT?.primary};font-weight:600;opacity:.75">${losT?.abbr || losT?.name?.slice(0,3).toUpperCase()}</span>
            <span style="font-family:'IBM Plex Mono','JetBrains Mono',monospace;color:var(--blgray);text-decoration:line-through">${lScore}</span>
          </div>`;
        }).join("")}
      </div>
    </div>` : "";

  // ── CTA ─────────────────────────────────────────────────────────────
  const ctaLabel = isFinalRound && userWon ? "▶ TO THE AWARDS"
    : userWon ? "▶ TO THE BRACKET"
    : "▶ TO THE BRACKET";
  const ctaOnClick = isFinalRound && userWon
    ? `frnDismissPlayoffRecap();showFrnAwards();`
    : `frnDismissPlayoffRecap();`;

  // Full takeover layout
  return `<div class="frn-prg-wrap">
    <header class="frn-prg-hero-banner ${statusClass}" style="--my-color:${myTeam.primary}">
      <div class="frn-prg-round">${roundName}</div>
      <div class="frn-prg-score-row">
        <div class="frn-prg-score-side mine" style="--team-color:${myTeam.primary}">
          <div class="abbr">${myTeam.abbr || myTeam.name.slice(0,3).toUpperCase()}</div>
          <div class="city">${myTeam.city.toUpperCase()}</div>
          <div class="score">${myScore}</div>
        </div>
        <div class="frn-prg-score-divider">—</div>
        <div class="frn-prg-score-side opp" style="--team-color:${oppTeam.primary}">
          <div class="score">${oppScore}</div>
          <div class="city">${oppTeam.city.toUpperCase()}</div>
          <div class="abbr">${oppTeam.abbr || oppTeam.name.slice(0,3).toUpperCase()}</div>
        </div>
      </div>
      <div class="frn-prg-status">
        <div class="frn-prg-status-main">${headlineMain}</div>
        <div class="frn-prg-status-sub">${headlineSub} · ${userWon?"by":"lost by"} ${Math.abs(margin)}</div>
      </div>
    </header>

    <div class="frn-prg-grid">
      <div class="frn-prg-card frn-prg-heroes">
        <div class="frn-prg-card-title">🏈 HEROES <span class="sub">your difference-makers</span></div>
        ${heroes.length
          ? heroes.map(h => heroCardHtml(h, "mine")).join("")
          : `<div class="frn-prg-empty">Tough day — no standouts on your side.</div>`}
        ${villain ? `<div class="frn-prg-villain-divider">THEIR BEST</div>${heroCardHtml(villain, "opp")}` : ""}
      </div>

      <div class="frn-prg-card frn-prg-compare">
        <div class="frn-prg-card-title">MATCHUP STATS</div>
        <table class="frn-prg-cmp-table">
          <thead><tr><th>${myTeam.abbr || myTeam.name.slice(0,3).toUpperCase()}</th><th></th><th>${oppTeam.abbr || oppTeam.name.slice(0,3).toUpperCase()}</th></tr></thead>
          <tbody>${cmpRows.map(cmpRowHtml).join("")}</tbody>
        </table>
      </div>
    </div>

    ${scoringHtml}
    ${aroundHtml}

    <div class="frn-prg-cta-row">
      <button class="frn-prg-cta-secondary" onclick="frnOpenPlayoffBox(${ref.roundIdx},${ref.matchupIdx})">📋 Full Box Score</button>
      <button class="frn-prg-cta-primary" onclick="${ctaOnClick}">${ctaLabel}</button>
    </div>
  </div>`;
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
  const { rounds, roundIdx, champion } = playoffBracket;
  const userStatus = _userPlayoffStatus();
  const currentRound = !champion && roundIdx < rounds.length ? rounds[roundIdx] : null;

  // Post-game recap takeover — if the user just played/simmed a playoff
  // matchup, show the curated recap (heroes / stats / scoring / around
  // the round) before returning to the bracket. Cleared by the "▶ TO
  // THE BRACKET" button via frnDismissPlayoffRecap.
  if (_frnPlayoffRecapPending) {
    const recap = _renderPlayoffGameRecap();
    if (recap) {
      $("frnHomeContent").innerHTML = `<div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1.2rem">${recap}</div>`;
      return;
    }
    // Bad ref or empty render — drop the flag and fall through to the bracket.
    _frnPlayoffRecapPending = null;
  }

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

  // ── Header sub-bar (lean — main actions live in the hub now) ───────────
  const headerSubBar = `<div style="padding:.55rem 1.4rem;border-bottom:1px solid var(--blborder);display:flex;gap:.55rem;flex-wrap:wrap;align-items:center">
    <button class="bspn-back" onclick="showFranchiseDashboard()">‹ Return to Main Screen</button>
    ${champion ? `<button class="bspn-back" onclick="showFrnAwards()" style="border-color:var(--blgold);color:var(--blgold)">🌟 Awards</button>` : ""}
    <span style="color:var(--blgray);font-size:.7rem;letter-spacing:.5px;margin-left:.4rem">
      ${champion ? "Postseason complete — review awards" : `Round ${roundIdx+1} of ${rounds.length}`}
    </span>
  </div>`;

  // ── Your-run side rail (only when relevant) ────────────────────────────
  const yourRunRail =
    (userStatus.champion || userStatus.eliminatedRound != null) ? _renderYourRunRecap()
    : (userStatus.inBracket && userStatus.eliminatedRound == null && !userStatus.champion) ? _renderRoadToChampionship()
    : "";

  $("frnHomeContent").innerHTML = `
    <div class="bspnlive-root" style="margin:-1rem -1.5rem 0 -1.5rem;padding-bottom:1.2rem">
      <header class="bspnlive-header">
        <div>
          <div class="bspnlive-logo">BSPN</div>
          <div class="bspnlive-logo-sub">PLAYOFF BRACKET · SEASON ${franchise.season}</div>
        </div>
        <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${_bspnNavHtml("PLAYOFFS")}</nav>
      </header>
      ${headerSubBar}
      ${championBanner}
      <div style="padding:1rem 1.4rem;display:flex;flex-direction:column;gap:1rem">
        <!-- TOP: the bracket tree is the visual centerpiece -->
        ${_renderBracketTree()}
        <!-- MIDDLE: current game hub (featured matchup / advance ceremony / sim CTA) -->
        ${_renderCurrentGameHub(currentRound)}
        <!-- BOTTOM: your run + other matchups -->
        <div class="frn-pl-bottom-grid">
          ${yourRunRail ? `<div class="frn-pl-bottom-side">${yourRunRail}</div>` : ""}
          ${currentRound ? `<div class="frn-pl-bottom-main">${_renderOtherMatchups(currentRound)}</div>` : ""}
        </div>
      </div>
    </div>`;
}

function frnSimPlayoffGame(homeId, awayId) {
  // Guard against double-clicks / stale buttons triggering a sim on a
  // matchup that's already decided — silently no-op, no double scores.
  const pb = franchise.playoffBracket;
  const decided = pb?.rounds?.[pb.roundIdx]?.some(m =>
    m.homeId === homeId && m.awayId === awayId && m.winnerId != null);
  if (decided) { renderFrnPlayoffs(); return; }
  const r = frnSimOnce(homeId, awayId, /* isPlayoff */ true);
  // Persist stats + scoring on the matchup so the user can click into
  // the box score for any played playoff game (not just the final).
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
  // Queue the post-game recap if this was the user's matchup.
  if (homeId === franchise.chosenTeamId || awayId === franchise.chosenTeamId) {
    const rd = pb.rounds?.[pb.roundIdx];
    const mi = rd?.findIndex(x =>
      (x.homeId === homeId && x.awayId === awayId) ||
      (x.homeId === awayId && x.awayId === homeId));
    if (mi != null && mi !== -1) {
      _frnPlayoffRecapPending = { roundIdx: pb.roundIdx, matchupIdx: mi };
    }
  }
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
  // Scout-from-watching: stamp every player who recorded a stat in
  // this playoff game with their postseason depth, and stamp the
  // user's opponents with "faced in playoffs" if it was the user's
  // game. Carries one season forward for sharper scout reads.
  _stampPlayoffScouting(roundIdx, homeId, awayId, r.full?.stats);
}

// Stamp postseason scouting flags on live players who recorded stats
// in this playoff game. Records BOTH the "any role" depth and a
// separate "major role" depth (gated by _wasMajorRole). The band
// check uses major when available, minor (one band worse) otherwise.
function _stampPlayoffScouting(roundIdx, homeId, awayId, stats) {
  if (!stats || !franchise) return;
  const myId    = franchise.chosenTeamId;
  const season  = franchise.season;
  const myIsHome = homeId === myId;
  const myIsAway = awayId === myId;
  const isUserGame = myIsHome || myIsAway;
  const oppSide = myIsHome ? "away" : myIsAway ? "home" : null;

  for (const sideName of ["home", "away"]) {
    const players = stats[sideName]?.players || {};
    for (const playerName of Object.keys(players)) {
      const live = _findPlayer(playerName);
      if (!live) continue;
      const p = players[playerName];
      const isMajor = _wasMajorRole(p);

      // Any-role depth — track the deepest round the player reached
      const sameSeason = live._postseasonDepthSeason === season;
      const prevDepth = sameSeason ? (live._postseasonDepth ?? -1) : -1;
      if (roundIdx > prevDepth || !sameSeason) {
        live._postseasonDepth = roundIdx;
        live._postseasonDepthSeason = season;
      }

      // Major-role depth — deepest round where they had a major role
      if (isMajor) {
        const sameMajorSeason = live._postseasonMajorRoundSeason === season;
        const prevMajor = sameMajorSeason ? (live._postseasonMajorRound ?? -1) : -1;
        if (roundIdx > prevMajor || !sameMajorSeason) {
          live._postseasonMajorRound = roundIdx;
          live._postseasonMajorRoundSeason = season;
        }
      }

      // Faced-in-playoffs — only when the user's team was the opponent
      if (isUserGame && sideName === oppSide) {
        live._facedInPlayoffsSeason = season;
        if (isMajor) live._facedInPlayoffsMajor = season;
      }
    }
  }
}

// Stamp regular-season "faced your team" scouting on opposing players
// who recorded a stat. Major role gets the standard ±5 band; minor
// role bumps to ±6.
function _stampRegSeasonScouting(homeId, awayId, stats) {
  if (!stats || !franchise) return;
  const myId = franchise.chosenTeamId;
  if (homeId !== myId && awayId !== myId) return;
  const oppSide = homeId === myId ? "away" : "home";
  const season = franchise.season;
  const players = stats[oppSide]?.players || {};
  for (const playerName of Object.keys(players)) {
    const p = players[playerName];
    const live = _findPlayer(playerName);
    if (!live) continue;
    live._regSeasonFacedSeason = season;
    if (_wasMajorRole(p)) live._regSeasonFacedMajor = season;
  }
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

// ── Coach escalators ─────────────────────────────────────────────────────────
// End-of-season pass — triggers performance bonuses on each coach's
// contract. Winning-season escalators bump next year's base salary
// permanently; one-shots (division title, SB appearance, championship)
// book as one-year cap hits and are paid out of the coaching budget.
function _processCoachEscalators() {
  if (!franchise || !franchise.coaches) return [];
  const season  = franchise.season || 1;
  const champId = franchise.playoffBracket?.champion;
  const sbGame  = franchise.superBowlGame;
  const sbIds   = new Set([sbGame?.homeId, sbGame?.awayId].filter(x => x != null));
  // Compute division winners (best W% per division).
  const byDivision = {};
  for (const t of TEAMS) {
    const key = `${t.conference}-${t.division}`;
    const s = franchise.standings?.[t.id] || { w:0, l:0, t:0 };
    const pct = _winPct(s.w, s.l, s.t);
    if (!byDivision[key] || pct > byDivision[key].pct) {
      byDivision[key] = { id: t.id, pct };
    }
  }
  const divisionWinners = new Set(Object.values(byDivision).map(x => x.id));
  const triggered = [];
  const userId = franchise.chosenTeamId;
  const bumpCoach = (tId, role, coach) => {
    if (!coach || !Array.isArray(coach.escalators)) return;
    const s = franchise.standings?.[tId] || { w:0, l:0, t:0 };
    const pct = _winPct(s.w, s.l, s.t);
    for (const esc of coach.escalators) {
      // Each escalator fires at most once per season per contract iteration.
      if ((esc.triggered || []).some(t => t.season === season)) continue;
      let fired = false;
      if (esc.kind === "winRate" && esc.threshold && pct >= esc.threshold && esc.bumpAav) {
        // Bump the upcoming year's base salary by bumpAav. contractYears
        // has already been decremented for the season that just ended, so
        // yrsTotal - yrsLeft is the index of the year about to be played.
        const yrsLeft  = coach.contractYears || 0;
        const yrsTotal = coach.contractLength || yrsLeft;
        if (yrsLeft >= 1 && Array.isArray(coach.baseSalaries)) {
          const idx = Math.max(0, Math.min(coach.baseSalaries.length - 1, yrsTotal - yrsLeft));
          coach.baseSalaries[idx] = +((coach.baseSalaries[idx] || 0) + esc.bumpAav).toFixed(2);
          coach.aav    = +((coach.aav || coach.salary || 0) + esc.bumpAav).toFixed(2);
          coach.salary = coach.aav;
          fired = true;
        }
      } else if (esc.kind === "division" && divisionWinners.has(tId) && esc.bumpOnce) {
        fired = true;
      } else if (esc.kind === "sbAppearance" && sbIds.has(tId) && esc.bumpOnce) {
        fired = true;
      } else if (esc.kind === "championship" && tId === champId && esc.bumpOnce) {
        fired = true;
      }
      if (!fired) continue;
      esc.triggered = esc.triggered || [];
      esc.triggered.push({ season });
      // One-shots book as a single-year cap hit.
      if (esc.bumpOnce) {
        if (!franchise.refunds) franchise.refunds = [];
        franchise.refunds.push({
          kind: "coach_escalator",
          label: `Coach bonus (${role.toUpperCase()} ${coach.name}): ${esc.label || esc.kind}`,
          fromTeamId: tId, toTeamId: null,
          amount: +esc.bumpOnce.toFixed(2),
          yearsRemaining: 1,
        });
      }
      triggered.push({ tId, role, coach: coach.name, label: esc.label || esc.kind });
      if (tId === userId) {
        _pushNews({ type:"coach_hire",
          label: `🎯 ${role.toUpperCase()} ${coach.name} escalator hit: ${esc.label || esc.kind}` });
      }
    }
  };
  for (const t of TEAMS) {
    const staff = franchise.coaches[t.id];
    if (!staff) continue;
    bumpCoach(t.id, "hc", staff.hc);
    bumpCoach(t.id, "oc", staff.oc);
    bumpCoach(t.id, "dc", staff.dc);
  }
  return triggered;
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
  // One-time migration: existing saves where _stampSeasonAccolades ran
  // before _rollSeasonStatsToCareer have a placeholder row
  // ({ teamId: null, teamName: "—" }) for the current season with
  // accolades but no stats. Roll the season's stats now — the merge
  // path inside _rollSeasonStatsToCareer overwrites the placeholder
  // with real data, preserving the accolades on the same row.
  _rollSeasonStatsToCareer();
  if (champId && (!existing || isStale)) {
    // Tick coach records + tenure first (only on first entry — never on stale-refresh)
    if (!existing) {
      for (const t of TEAMS) {
        const staff = franchise.coaches?.[t.id];
        const hc = staff?.hc;
        if (!hc) continue;
        const s = franchise.standings?.[t.id] || { w:0, l:0 };
        hc.record = hc.record || { w:0, l:0, championships: 0 };
        hc.record.w += s.w || 0;
        hc.record.l += s.l || 0;
        hc.yearsWithTeam = (hc.yearsWithTeam || 0) + 1;
        hc.age = (hc.age || 50) + 1;
        if (hc.contractYears != null) hc.contractYears = Math.max(0, hc.contractYears - 1);
        if (t.id === champId) hc.record.championships = (hc.record.championships || 0) + 1;
        // Tick OC/DC age and tenure
        if (staff.oc) {
          staff.oc.yearsWithTeam = (staff.oc.yearsWithTeam || 0) + 1;
          staff.oc.age = (staff.oc.age || 40) + 1;
          if (staff.oc.contractYears != null) staff.oc.contractYears = Math.max(0, staff.oc.contractYears - 1);
        }
        if (staff.dc) {
          staff.dc.yearsWithTeam = (staff.dc.yearsWithTeam || 0) + 1;
          staff.dc.age = (staff.dc.age || 40) + 1;
          if (staff.dc.contractYears != null) staff.dc.contractYears = Math.max(0, staff.dc.contractYears - 1);
        }
      }
      // Performance escalators: triggers AFTER contract years have ticked,
      // so a winning-season bump lands on the (new) current-year base.
      _processCoachEscalators();
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
    // (_rollSeasonStatsToCareer already ran at the top of showFrnAwards — it
    // populates / merges the current-season row so accolades attach to real
    // stats, not a teamId-null placeholder.)
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
// the season. Walk-year leverage — they want their next deal NOW. Demands
// are tag-floored (a star would force the franchise tag if you wait, so
// their demand sits at least at tag-AAV). User has 4 weeks to extend, trade,
// counter, defer, or explicitly refuse. Auto-resolution after deadline =
// 1-game sit-out and demand expires.
const _MID_HOLDOUT_MIN_YEARS = 2;
const _MID_HOLDOUT_MAX_YEARS = 6;
const _MID_HOLDOUT_MAX_DEFERS = 2;

// Comp-pick estimate if a walk-year demand goes unresolved and the player
// signs elsewhere next FA period.
function _holdoutDemandCompPick(d) {
  const ovr = d.overall || 0;
  if (ovr >= 88) return "3rd-rd comp pick";
  if (ovr >= 83) return "4th-rd comp pick";
  if (ovr >= 78) return "5th-rd comp pick";
  return null;
}

// Average AAV of top-3 free agents at this position (a quick "expected
// market price" preview for the walk path). Falls back to market value
// if the FA pool isn't seeded yet.
function _holdoutDemandFAMarket(position, fallbackAAV) {
  const pool = (franchise.freeAgents || []).filter(p => p.position === position);
  if (!pool.length) return fallbackAAV;
  const top = pool.sort((a, b) => (b.demandedAAV || 0) - (a.demandedAAV || 0)).slice(0, 3);
  const avg = top.reduce((s, p) => s + (p.demandedAAV || 0), 0) / top.length;
  return Math.round(avg * 10) / 10;
}

function _checkHoldoutDemands() {
  const myId = franchise.chosenTeamId;
  const roster = franchise.rosters[myId] || [];
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  franchise.holdoutDemands = franchise.holdoutDemands || [];
  // New demand rolls — only for stars in their contract year, age ≤30
  for (const p of roster) {
    if (!p.contract || p.contract.remaining !== 1) continue;
    if ((p.overall || 0) < 85) continue;
    if ((p.age || 0) > 30) continue;
    if (p.injury?.weeksRemaining > 0) continue;
    if (franchise.holdoutDemands.some(d => d.name === p.name)) continue;
    if (Math.random() >= 0.04) continue;
    const market = computeMarketValue(p, cap);
    const tagFloor = _franchiseTagAAV({ position: p.position, name: p.name }, cap);
    // Tag-floored demand: walk-year stars know you could tag them next year
    // for tag-AAV, so they demand at least 95% of that as their floor.
    const demand = Math.round(Math.max(market, tagFloor * 0.95) * 10) / 10;
    const wantYears = (p.overall || 0) >= 88 ? 5 : 4;
    franchise.holdoutDemands.push({
      name: p.name, position: p.position,
      overall: p.overall || 70,
      age: p.age || 27,
      currentAAV: p.contract.aav || 0,
      currentRemaining: p.contract.remaining,
      marketValue: market,           // back-compat
      marketAAV: market,
      tagFloorAAV: tagFloor,
      demandedAAV: demand,
      demandedYears: wantYears,
      offer: demand,
      offerYears: wantYears,
      structure: _defaultStructure(p.age || 27, p.overall || 70),
      week: franchise.week, deadlineWeek: franchise.week + 4,
      defers: 0,
      resolved: null,
    });
    _pushNews({ type: "holdout_demand",
      label: `📣 ${p.position} ${p.name} wants $${demand.toFixed(1)}M/yr × ${wantYears}yr before his contract expires — extend by Week ${franchise.week + 4}` });
  }
  // Resolve expired demands → 1-game sit-out
  for (const d of franchise.holdoutDemands.slice()) {
    if (d.resolved) continue; // already handled via the modal
    if (d.deadlineWeek <= franchise.week) {
      const p = roster.find(r => r.name === d.name);
      if (p && !p.injury) {
        p.injury = { label: "holdout", weeksRemaining: 1 };
        p.unhappy = true;
        _pushNews({ type: "holdout",
          label: `🚫 ${p.position} ${p.name} is holding out — not playing this week` });
      }
      franchise.holdoutDemands = franchise.holdoutDemands.filter(x => x.name !== d.name);
    }
  }
}

// Back-fill helper for legacy holdoutDemands (just had name/position/week/
// deadlineWeek/marketValue). Restores the player's contract state so the
// modal can render its full row UI.
function _migrateHoldoutDemandShape(list) {
  if (!list || !list.length) return;
  const myId = franchise.chosenTeamId;
  const roster = franchise.rosters[myId] || [];
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  for (const d of list) {
    if (!d) continue;
    const live = roster.find(p => p.name === d.name);
    if (d.marketAAV == null)        d.marketAAV = d.marketValue ?? (live ? computeMarketValue(live, cap) : 1);
    if (d.tagFloorAAV == null)      d.tagFloorAAV = _franchiseTagAAV({ position: d.position, name: d.name }, cap);
    if (d.demandedAAV == null)      d.demandedAAV = Math.round(Math.max(d.marketAAV, d.tagFloorAAV * 0.95) * 10) / 10;
    if (d.demandedYears == null)    d.demandedYears = (live?.overall || 0) >= 88 ? 5 : 4;
    if (d.offer == null)            d.offer = d.demandedAAV;
    if (d.offerYears == null)       d.offerYears = d.demandedYears;
    if (d.structure == null)        d.structure = _defaultStructure(live?.age || 27, live?.overall || 70);
    if (d.overall == null)          d.overall = live?.overall ?? 85;
    if (d.age == null)              d.age = live?.age ?? 27;
    if (d.currentAAV == null)       d.currentAAV = live?.contract?.aav ?? 0;
    if (d.currentRemaining == null) d.currentRemaining = live?.contract?.remaining ?? 1;
    if (d.defers == null)           d.defers = 0;
    if (d.resolved === undefined)   d.resolved = null;
  }
}

// Pending = active demands that still need a decision.
function _pendingHoldoutDemands() {
  const week = franchise.week || 1;
  return (franchise.holdoutDemands || []).filter(d => d.deadlineWeek >= week && !d.resolved);
}

// ── Mid-season actions ─────────────────────────────────────────────────────
let _holdoutMidPreview = null;

function frnHoldoutMidExtend(name) {
  const list = franchise.holdoutDemands || [];
  _migrateHoldoutDemandShape(list);
  const d = list.find(x => x.name === name);
  if (!d) return;
  const myId = franchise.chosenTeamId;
  const player = (franchise.rosters[myId] || []).find(p => p.name === name);
  if (!player) return;
  const aav    = d.offer ?? d.demandedAAV;
  const years  = d.offerYears ?? d.demandedYears;
  const struct = d.structure || "BALANCED";
  const ovr    = player.overall || d.overall || 70;
  const { signingBonus, bonusProration, tradeKicker } = _signingBonusCalc(aav, years, ovr);
  const baseSalaries = _baseSalarySchedule(aav, years, struct, bonusProration);
  const odds = _holdoutAcceptOdds(aav, years, d.demandedAAV, d.demandedYears);
  if (odds < 0.5) player.unhappy = true;
  else delete player.unhappy;
  player.contract = {
    years, remaining: years, aav, structure: struct,
    baseSalaries, signingBonus, bonusProration, tradeKicker,
    guaranteedYears: _guaranteedYearsForLength(years),
    guaranteedAAV: aav, incentives: [], signedAav: aav,
  };
  _pushNews({ type: "extension",
    label: `🤝 Extended ${player.position} ${name} mid-season — ${years}yr / $${aav.toFixed(1)}M/yr` });
  franchise.holdoutDemands = list.filter(x => x.name !== name);
  _holdoutMidPreview = null;
  saveFranchise();
  frnRefreshHoldoutCenter();
}

function frnHoldoutMidCounter(name) {
  const list = franchise.holdoutDemands || [];
  _migrateHoldoutDemandShape(list);
  const d = list.find(x => x.name === name);
  if (!d) return;
  d.offer = Math.round(d.demandedAAV * 0.95 * 10) / 10;
  d.offerYears = Math.max(_MID_HOLDOUT_MIN_YEARS, Math.min(_MID_HOLDOUT_MAX_YEARS, d.demandedYears));
  saveFranchise();
  frnRefreshHoldoutCenter();
}

function frnHoldoutMidAdjustYears(name, delta) {
  const list = franchise.holdoutDemands || [];
  _migrateHoldoutDemandShape(list);
  const d = list.find(x => x.name === name);
  if (!d) return;
  const newYears = Math.max(_MID_HOLDOUT_MIN_YEARS, Math.min(_MID_HOLDOUT_MAX_YEARS, (d.offerYears || d.demandedYears) + delta));
  if (newYears === d.offerYears) return;
  d.offerYears = newYears;
  saveFranchise();
  frnRefreshHoldoutCenter();
}

function frnHoldoutMidSetStructure(name, struct) {
  const list = franchise.holdoutDemands || [];
  _migrateHoldoutDemandShape(list);
  const d = list.find(x => x.name === name);
  if (!d) return;
  d.structure = struct;
  saveFranchise();
  frnRefreshHoldoutCenter();
}

function frnHoldoutMidPreview(name) {
  _holdoutMidPreview = name;
  frnRefreshHoldoutCenter();
}
function frnHoldoutMidPreviewClose() {
  _holdoutMidPreview = null;
  frnRefreshHoldoutCenter();
}

function frnHoldoutMidTrade(name) {
  const list = franchise.holdoutDemands || [];
  const d = list.find(x => x.name === name);
  if (!d) return;
  // Marking resolved="trade-block" lets the inbox/ribbon drop the demand
  // from the active count. Player stays on the roster until the user
  // closes a real trade — the trade screen takes over from here.
  d.resolved = "trade-block";
  franchise._tradeProp = {
    targetTeamId: TEAMS.find(t => t.id !== franchise.chosenTeamId).id,
    youSend: [name],
    youReceive: [],
    result: null,
  };
  saveFranchise();
  frnCloseHoldoutCenter();
  renderFrnTrade();
}

function frnHoldoutMidDefer(name) {
  const list = franchise.holdoutDemands || [];
  _migrateHoldoutDemandShape(list);
  const d = list.find(x => x.name === name);
  if (!d) return;
  if ((d.defers || 0) >= _MID_HOLDOUT_MAX_DEFERS) {
    alert(`${name} won't accept another delay. He wants a deal or he sits.`);
    return;
  }
  d.defers = (d.defers || 0) + 1;
  d.deadlineWeek += 2;
  // Each defer raises the demand 3% — patience costs.
  d.demandedAAV = Math.round(d.demandedAAV * 1.03 * 10) / 10;
  d.offer = Math.max(d.offer || 0, d.demandedAAV);
  _pushNews({ type: "holdout_demand",
    label: `⏳ ${d.position} ${d.name} agreed to defer his demand — new deadline Week ${d.deadlineWeek}, asking $${d.demandedAAV.toFixed(1)}M/yr now` });
  saveFranchise();
  frnRefreshHoldoutCenter();
}

function frnHoldoutMidRefuse(name) {
  const list = franchise.holdoutDemands || [];
  const d = list.find(x => x.name === name);
  if (!d) return;
  const myId = franchise.chosenTeamId;
  const player = (franchise.rosters[myId] || []).find(p => p.name === name);
  if (player) {
    if (!player.injury) player.injury = { label: "holdout", weeksRemaining: 1 };
    player.unhappy = true;
  }
  _pushNews({ type: "holdout",
    label: `🚫 ${d.position} ${d.name} held out — not playing this week. Refused the team's stance.` });
  franchise.holdoutDemands = list.filter(x => x.name !== name);
  _holdoutMidPreview = null;
  saveFranchise();
  frnRefreshHoldoutCenter();
}

// ── Mid-season Holdout Center modal ────────────────────────────────────────
// One row per active demand (same UX as the offseason demands page,
// trimmed to mid-season actions: Extend / Counter / Trade / Defer /
// Refuse). Opens from the dashboard ribbon or the inbox CTA.
function _renderHoldoutCenterRow(d) {
  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId] || [];
  const live = myRoster.find(p => p.name === d.name);
  const escName = (d.name||"").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const cap = effectiveSalaryCap(myId);
  const ovr = live?.overall ?? d.overall ?? 70;
  const age = live?.age ?? d.age ?? "?";
  const struct = d.structure || "BALANCED";
  const offer = d.offer ?? d.demandedAAV;
  const offerYears = d.offerYears ?? d.demandedYears;
  const { bonusProration } = _signingBonusCalc(offer, offerYears, ovr);
  const deadTotal = bonusProration * offerYears;

  // ── Year-by-year preview before signing ──────────────────────────
  if (_holdoutMidPreview === d.name) {
    const bases = _baseSalarySchedule(offer, offerYears, struct, bonusProration);
    const yearPills = bases.map((base, i) => {
      const hit = Math.round((base + bonusProration) * 10) / 10;
      return `<div style="display:flex;justify-content:space-between;padding:.18rem .4rem;border-radius:4px;background:var(--bg3);font-size:.67rem;gap:.8rem">
        <span style="color:var(--gray)">Yr ${i+1}</span>
        <span>$${base.toFixed(1)}M base</span>
        <span style="color:var(--gray)">+$${bonusProration.toFixed(1)}M bonus</span>
        <span style="color:var(--gold);font-weight:700">= $${hit.toFixed(1)}M</span>
      </div>`;
    }).join("");
    return `<div class="frn-resign-row" style="border-color:var(--gold);background:rgba(200,169,0,.07)">
      <div class="frn-resign-info">
        <span style="font-weight:700;color:var(--gold)">${d.name}</span>
        <span style="color:var(--gray);font-size:.7rem">${d.position} · ${ovr} OVR · Age ${age}</span>
        <span style="font-size:.6rem;color:var(--gray);margin-top:.1rem">${struct} · $${offer.toFixed(1)}M/yr · ${offerYears}yr</span>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:.2rem;margin:0 .6rem">${yearPills}</div>
      <div class="frn-resign-btns" style="flex-direction:column;gap:.3rem">
        ${deadTotal >= 0.5 ? `<span style="color:#ff9090;font-size:.6rem;text-align:center">☠ Dead $${bonusProration.toFixed(1)}M×${offerYears}yr</span>` : ""}
        <button class="btn btn-gold" onclick="frnHoldoutMidExtend('${escName}')" style="white-space:nowrap">✓ Sign Extension</button>
        <button class="btn btn-outline" onclick="frnHoldoutMidPreviewClose()" style="font-size:.65rem">← Back</button>
      </div>
    </div>`;
  }

  const trend = _ovrTrend(live);
  const trendHtml = trend == null ? "" : trend > 0
    ? `<span style="color:var(--green-lt);font-size:.6rem">↑ +${trend} OVR</span>`
    : trend < 0 ? `<span style="color:var(--red);font-size:.6rem">↓ ${trend} OVR</span>`
    : `<span style="color:var(--gray);font-size:.6rem">→ flat</span>`;
  const curve = _ageCurveWarning(age === "?" ? null : age, offerYears);
  const isProne = typeof _isInjuryProne === "function" && _isInjuryProne(live);

  // Risk badges
  const risks = _resignRiskBadges(live, { overall: ovr }, curve, trend);
  const riskHtml = risks.map(b =>
    `<span class="frn-resign-risk" style="color:${b.color};border-color:${b.color}55">${b.label}</span>`
  ).join("");

  // Demand + accept odds
  const odds = _holdoutAcceptOdds(offer, offerYears, d.demandedAAV, d.demandedYears);
  const oddsColor = odds >= 0.85 ? "var(--green-lt)" : odds >= 0.5 ? "#e8a000" : "#ff8a8a";
  const demandHtml = `<div class="frn-resign-demand">
    <span class="lbl">Wants</span>
    <span class="num">$${d.demandedAAV.toFixed(1)}M × ${d.demandedYears}yr</span>
    <span class="lbl" style="margin-left:.5rem">Tag floor</span>
    <span class="num" style="color:var(--gray)">$${d.tagFloorAAV.toFixed(1)}M</span>
    <span class="lbl" style="margin-left:.5rem">Accept odds</span>
    <span class="num" style="color:${oddsColor}">${Math.round(odds * 100)}%</span>
  </div>`;

  // FA preview line — what happens if you let him walk
  const compPick = _holdoutDemandCompPick(d);
  const faMarket = _holdoutDemandFAMarket(d.position, d.marketAAV);
  const faMktDepth = _faMktDepth(d.position);
  const faPreviewHtml = `<div class="frn-resign-meta" style="border-top:1px dashed var(--border);padding-top:.25rem;margin-top:.25rem">
    <span style="color:var(--gray)">If he walks:</span>
    ${compPick ? `<span style="color:var(--gold)">🎁 ${compPick}</span>` : ""}
    <span style="color:var(--gray)">· FA market ~$${faMarket.toFixed(1)}M/yr</span>
    ${faMktDepth ? `<span style="color:var(--gray)">· ${faMktDepth} comp FAs avail</span>` : ""}
  </div>`;

  // Deadline countdown
  const wksLeft = Math.max(0, d.deadlineWeek - franchise.week);
  const deadlineColor = wksLeft <= 1 ? "var(--red)" : wksLeft <= 2 ? "#e8a000" : "var(--gray)";
  const deadlineHtml = `<div style="font-size:.6rem;color:${deadlineColor};margin-top:.15rem">
    ⏰ ${wksLeft === 0 ? "Deadline this week" : `${wksLeft} week${wksLeft===1?"":"s"} until deadline`}${d.defers ? ` · deferred ${d.defers}×` : ""}
  </div>`;

  const tradeVal = _holdoutTradeValue(d, live);
  const tier = _holdoutTier(d);

  return `<div class="frn-resign-row tier-${tier}">
    <div class="frn-resign-row-inner">
      <div class="frn-resign-info">
        <span style="font-weight:700;color:var(--white);font-size:.95rem">${d.name}</span>
        <span style="color:var(--gray);font-size:.7rem">${d.position} · ${ovr} OVR ${trendHtml} · Age ${age}</span>
        <span style="color:var(--gray);font-size:.6rem">Walk year · ${d.currentRemaining}yr left · current $${d.currentAAV.toFixed(1)}M/yr</span>
        ${riskHtml ? `<div class="frn-resign-risks">${riskHtml}</div>` : ""}
        ${demandHtml}
        ${faPreviewHtml}
        ${deadlineHtml}
      </div>
      <div class="frn-resign-offer">
        <span style="color:${offer > d.marketAAV * 1.1 ? 'var(--red)' : offer < d.marketAAV * 0.9 ? 'var(--green-lt)' : 'var(--gold)'};font-weight:700">$${offer.toFixed(1)}M/yr ${vsMarketCell(offer, d.marketAAV)}</span>
        <div style="display:flex;align-items:center;gap:.25rem;justify-content:flex-end;margin-top:.15rem">
          <button class="frn-resign-yrbtn"
            ${offerYears <= _MID_HOLDOUT_MIN_YEARS ? "disabled" : ""}
            onclick="frnHoldoutMidAdjustYears('${escName}', -1)">−</button>
          <span style="color:var(--gray);font-size:.7rem;min-width:2.5rem;text-align:center">${offerYears} yr</span>
          <button class="frn-resign-yrbtn"
            ${offerYears >= _MID_HOLDOUT_MAX_YEARS ? "disabled" : ""}
            onclick="frnHoldoutMidAdjustYears('${escName}', 1)">+</button>
        </div>
        <span style="color:var(--gray);font-size:.6rem;text-align:right">total $${(offer * offerYears).toFixed(1)}M</span>
        ${deadTotal < 0.5
          ? `<span style="color:var(--gray);font-size:.6rem">No dead cap</span>`
          : `<span style="color:#ff9090;font-size:.6rem;text-align:right">☠ Dead $${bonusProration.toFixed(1)}M×${offerYears}yr = $${deadTotal.toFixed(1)}M</span>`}
        <div style="display:flex;gap:.2rem;justify-content:flex-end;margin-top:.25rem;align-items:center;flex-wrap:wrap">
          <span style="color:var(--gray);font-size:.58rem">Structure:</span>
          ${["BALANCED","BACKLOADED","FRONTLOADED"].map(s => {
            const desc = s==="BALANCED"?"flat salaries":s==="BACKLOADED"?"cheap now, costly later":"costly now, cheap later";
            return `<button class="btn ${struct===s?"btn-gold":"btn-outline"}" onclick="frnHoldoutMidSetStructure('${escName}','${s}')" style="font-size:.55rem;padding:.1rem .3rem" title="${desc}">${s[0]+s.slice(1).toLowerCase()}</button>`;
          }).join("")}
        </div>
      </div>
      <div class="frn-resign-btns">
        <button class="btn frn-resign-btn accept-btn" onclick="frnHoldoutMidPreview('${escName}')">Review &amp; Extend</button>
        ${odds < 0.85 ? `<button class="btn frn-resign-btn accept-btn" style="border-color:var(--gold-lt);color:var(--gold-lt)" onclick="frnHoldoutMidCounter('${escName}')" title="Drop offer to 95% of demand">↻ Counter</button>` : ""}
        <button class="btn frn-resign-btn" style="border-color:var(--gold);color:var(--gold)" onclick="frnHoldoutMidTrade('${escName}')" title="Open trade screen with him pre-selected">🔀 Trade<span style="font-size:.5rem;display:block;color:var(--gold-lt)">${tradeVal}</span></button>
        ${(d.defers || 0) < _MID_HOLDOUT_MAX_DEFERS
          ? `<button class="btn frn-resign-btn" style="border-color:var(--blgray);color:var(--blgray)" onclick="frnHoldoutMidDefer('${escName}')" title="Push deadline +2 wks. Demand rises 3% each defer. Max ${_MID_HOLDOUT_MAX_DEFERS}×.">⏳ Defer<span style="font-size:.5rem;display:block;color:var(--blgray)">+2 wks · +3% AAV</span></button>`
          : `<button class="btn frn-resign-btn" disabled title="Already deferred max times" style="opacity:.4">⏳ Defer<span style="font-size:.5rem;display:block">max reached</span></button>`}
        <button class="btn frn-resign-btn decline-btn" onclick="frnHoldoutMidRefuse('${escName}')" title="Player sits this week and walks at expiry">✗ Refuse<span style="font-size:.5rem;display:block;color:#ff9090">sits 1 game</span></button>
      </div>
    </div>
  </div>`;
}

function frnOpenHoldoutCenter() {
  _migrateHoldoutDemandShape(franchise.holdoutDemands || []);
  const existing = document.getElementById("frn-holdout-center-modal");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "frn-holdout-center-modal";
  el.className = "frn-resign-recap-overlay";
  el.innerHTML = _holdoutCenterInnerHtml();
  el.addEventListener("click", e => { if (e.target === el) frnCloseHoldoutCenter(); });
  document.body.appendChild(el);
}

function frnCloseHoldoutCenter() {
  const el = document.getElementById("frn-holdout-center-modal");
  if (el) el.remove();
  _holdoutMidPreview = null;
}

// Re-render the modal in place after an action — keeps the user on the
// same screen instead of forcing a dashboard refresh that closes the modal.
function frnRefreshHoldoutCenter() {
  const el = document.getElementById("frn-holdout-center-modal");
  if (!el) return;
  el.innerHTML = _holdoutCenterInnerHtml();
}

function _holdoutCenterInnerHtml() {
  const pending = _pendingHoldoutDemands();
  if (!pending.length) {
    return `<div class="frn-resign-recap-card">
      <button class="frn-resign-recap-close" onclick="frnCloseHoldoutCenter()">×</button>
      <div class="frn-resign-recap-eyebrow">WEEK ${franchise.week} · HOLDOUT CENTER</div>
      <h2 class="frn-resign-recap-title">NO ACTIVE DEMANDS</h2>
      <p style="color:var(--blgray);text-align:center;margin:1rem 0">All walk-year extension demands have been resolved.</p>
      <div class="frn-resign-recap-cta"><button class="btn btn-gold-big" onclick="frnCloseHoldoutCenter()">✓ Close</button></div>
    </div>`;
  }
  const rows = pending.map(_renderHoldoutCenterRow).join("");
  return `<div class="frn-resign-recap-card" style="max-width:1100px">
    <button class="frn-resign-recap-close" onclick="frnCloseHoldoutCenter()">×</button>
    <div class="frn-resign-recap-eyebrow">WEEK ${franchise.week} · HOLDOUT CENTER</div>
    <h2 class="frn-resign-recap-title">🗣 ${pending.length} ACTIVE DEMAND${pending.length===1?"":"S"}</h2>
    <p style="color:var(--blgray);text-align:center;margin:.4rem 0 .8rem;font-size:.72rem">Walk-year stars demanding an extension. Tag-floored asks. Refuse → 1-game sit-out + flight risk. Defer → +2 weeks, +3% AAV (max 2×).</p>
    <div class="frn-resign-list" style="margin-top:.6rem">${rows}</div>
    <div class="frn-resign-recap-cta">
      <button class="btn btn-outline" onclick="frnCloseHoldoutCenter()">← Close</button>
    </div>
  </div>`;
}

// ── Back-compat shim ───────────────────────────────────────────────────────
// The inbox "Extend" CTA used to call frnExtendPlayer with a prompt() flow.
// Route it through the new Holdout Center modal instead. Old saves whose
// demands lack the enriched fields get migrated in _migrateHoldoutDemandShape.
function frnExtendPlayer(name) {
  // If the player has an active demand, open the center modal.
  const list = franchise.holdoutDemands || [];
  if (list.some(d => d.name === name && !d.resolved)) {
    frnOpenHoldoutCenter();
    return;
  }
  // No active demand — fall back to a simple inline extension prompt.
  const myId = franchise.chosenTeamId;
  const roster = franchise.rosters[myId] || [];
  const p = roster.find(r => r.name === name);
  if (!p) return;
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const baseMarket = computeMarketValue(p, cap);
  const years = parseInt(prompt(
    `Extend ${name}? Pick length (2-6 years):`, "4"
  ), 10);
  if (!years || years < 2 || years > 6) return;
  const aav = _resignAavForYears(baseMarket, years);
  if (!confirm(`Sign ${name} to ${years}yr / $${aav.toFixed(1)}M/yr ($${(aav*years).toFixed(1)}M total)?`)) return;
  const guaranteedYears = _guaranteedYearsForLength(years);
  p.contract = {
    years, remaining: years, aav,
    guaranteedYears, guaranteedAAV: aav,
    signedAav: aav,
  };
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

// ── Re-signings UX helpers ─────────────────────────────────────────────────
// Tier players into Foundation / Starters / Depth so the page can show
// big-stage decisions distinct from depth-piece churn.
function _resignTier(r) {
  const ovr = r.overall || 0;
  if (ovr >= 85) return "foundation";
  if (ovr >= 75) return "starter";
  return "depth";
}

// What the player wants — rough demand line scaled by ambition.
function _resignPlayerDemand(player, r, baseMarket) {
  const ovr = player?.overall ?? r?.overall ?? 70;
  const age = player?.age ?? r?.age ?? 27;
  let factor = 1.0, wantYears = 3;
  if (ovr >= 88)      { factor = 1.18; wantYears = 5; }
  else if (ovr >= 84) { factor = 1.12; wantYears = 4; }
  else if (ovr >= 78) { factor = 1.05; wantYears = 4; }
  else if (ovr >= 72) { factor = 1.00; wantYears = 3; }
  else                { factor = 0.92; wantYears = 2; }
  if (age >= 33)      { factor *= 0.93; wantYears = Math.max(1, wantYears - 1); }
  else if (age >= 30) { factor *= 0.97; }
  else if (age <= 24) { factor *= 1.04; }
  return {
    aav: Math.round(baseMarket * factor * 10) / 10,
    years: wantYears,
  };
}

// Likelihood (0..1) the player accepts your offer vs their demand.
function _resignAcceptOdds(offerAAV, offerYears, demand) {
  if (!demand) return 1;
  const aavGap   = (offerAAV - demand.aav) / Math.max(0.5, demand.aav);
  const yearGap  = offerYears - demand.years;
  let odds = 1 + Math.min(0, aavGap) * 2.0 + Math.min(0, yearGap) * 0.10;
  return Math.max(0, Math.min(1, odds));
}

// System recommendation per player.
function _resignRecommendation(r, depth, faMkt, ageWarn, isInjuryProne, trend) {
  const tier = _resignTier(r);
  if (tier === "foundation") {
    if (ageWarn?.level === "danger" || (trend != null && trend <= -3)) {
      return { action: "EVALUATE", color: "#e8a000",
        reason: "Franchise talent, but age / decline risk on a long deal" };
    }
    return { action: "RE-SIGN", color: "var(--green-lt)",
      reason: "Foundation player — irreplaceable" };
  }
  if (tier === "starter") {
    if (ageWarn?.level === "danger") {
      return { action: "LET WALK", color: "#ff8a8a",
        reason: `Age cliff at expiry · ${depth} other ${r.pos} ≥75 available` };
    }
    if (depth >= 2 && faMkt >= 4) {
      return { action: "EVALUATE", color: "#e8a000",
        reason: `${depth} starter-grade ${r.pos} on roster · ${faMkt} on FA market` };
    }
    if (isInjuryProne) {
      return { action: "EVALUATE", color: "#e8a000",
        reason: "Injury history makes a long deal risky" };
    }
    return { action: "RE-SIGN", color: "var(--green-lt)",
      reason: depth === 0 ? "Position need — keep them" : "Solid starter, hard to replace at market" };
  }
  if (depth >= 1 || faMkt >= 3) {
    return { action: "LET WALK", color: "#ff8a8a",
      reason: `Depth piece · ${depth} other ${r.pos} ≥75 OVR, ${faMkt} on FA market` };
  }
  return { action: "EVALUATE", color: "#e8a000",
    reason: "Thin at position — consider a cheap 1-2yr deal" };
}

// Risk badges — visible chips so red flags pop.
function _resignRiskBadges(player, r, ageWarn, trend) {
  const out = [];
  if (typeof _isInjuryProne === "function" && _isInjuryProne(player)) {
    out.push({ label: "🩹 INJURY-PRONE", color: "#ff8a8a" });
  }
  if (ageWarn?.level === "danger") {
    out.push({ label: `⏳ AGE ${ageWarn.endAge} AT EXPIRY`, color: "#ff8a8a" });
  } else if (ageWarn?.level === "caution") {
    out.push({ label: `⏳ AGE ${ageWarn.endAge} AT EXPIRY`, color: "#e8a000" });
  }
  if (trend != null && trend <= -3) {
    out.push({ label: `📉 DECLINING (${trend})`, color: "#e8a000" });
  } else if (trend != null && trend >= 4) {
    out.push({ label: `📈 RISING (+${trend})`, color: "var(--green-lt)" });
  }
  return out;
}

// Compensatory-pick estimate for letting a player walk. Uses the same
// AAV brackets as the actual comp pick computation in _computeCompPicks
// so the projection matches what's awarded.
function _resignCompPick(r) {
  const aav = r.baseMarket || 0;
  if (aav <= 0) return null;
  const round = _compPickRoundForAAV(aav);
  const labels = { 3: "3rd-rd", 4: "4th-rd", 5: "5th-rd", 6: "6th-rd", 7: "7th-rd" };
  return { round, label: `${labels[round]} comp pick projected` };
}

// Multi-year cap projection — sums existing kept contracts + accepted
// re-signings out to N years from now. Used by the team-wide cap
// timeline at the top of the page.
function _resignCapProjection(years = 4) {
  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId] || [];
  const out = new Array(years).fill(0);
  for (const p of myRoster) {
    if (!p.contract || p.contract.remaining <= 0) continue;
    const proration = p.contract.bonusProration || 0;
    const bases = p.contract.baseSalaries || [];
    const curIdx = (p.contract.years || 1) - (p.contract.remaining || 1);
    for (let i = 0; i < years && (curIdx + i) < bases.length; i++) {
      out[i] += (bases[curIdx + i] || 0) + proration;
    }
  }
  for (const r of (franchise._resignPending || [])) {
    if (r.decision !== "accept" && r.decision !== "tag") continue;
    const aav = r.decision === "tag" ? r.tagAAV : r.offer;
    const yrs = r.decision === "tag" ? 1 : r.offerYears;
    const { bonusProration } = _signingBonusCalc(aav, yrs, r.overall || 70);
    const struct = r.structure || "BALANCED";
    const bases = _baseSalarySchedule(aav, yrs, struct, bonusProration);
    for (let i = 0; i < years && i < bases.length; i++) {
      out[i] += bases[i] + bonusProration;
    }
  }
  return out.map(v => Math.round(v * 10) / 10);
}

function renderFrnResignings() {
  const { chosenTeamId } = franchise;
  const cap = effectiveSalaryCap(chosenTeamId);
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
  const _statLine = name => {
    const agg = _playerSeasonStatsAgg(name);
    return agg ? mvpStatLine(agg) : "";
  };

  // Multi-year cap projection across this + accepted re-signings
  const proj = _resignCapProjection(4);

  // Render one player row (full / collapsed / preview)
  const rowFor = (r, idx) => {
    const isAccept  = r.decision === "accept";
    const isDecline = r.decision === "decline";
    const isTagged  = r.decision === "tag";
    const isLocked  = isAccept || isDecline || isTagged;
    const struct = r.structure || "BALANCED";
    const { bonusProration } = _signingBonusCalc(r.offer, r.offerYears, r.overall || 70);
    const deadTotal = bonusProration * r.offerYears;

    // ── Completed decisions render as a one-line collapsed strip so
    //    pending decisions stay the focus ────────────────────────────
    if (isLocked) {
      const decisionLabel = isAccept
        ? `<span style="color:var(--green-lt);font-weight:700">✓ SIGNED</span> · $${r.offer.toFixed(1)}M × ${r.offerYears}yr`
        : isTagged
        ? `<span style="color:var(--gold);font-weight:700">🏷 TAGGED</span> · 1yr / $${r.tagAAV?.toFixed(1)}M guaranteed`
        : `<span style="color:#ff8a8a;font-weight:700">✗ WALK</span> · enters free agency`;
      return `
        <div class="frn-resign-collapsed ${isAccept?"accepted":isTagged?"tagged":"declined"}"
             onclick="frnResignReopen(${idx})" title="Click to reopen">
          <span class="name">${r.name}</span>
          <span class="meta">${r.pos} · ${r.overall} OVR · Age ${r.age}</span>
          <span class="decision">${decisionLabel}</span>
          <span class="reopen">↻ Reopen</span>
        </div>`;
    }

    // ── Signing preview panel (year-by-year breakdown before committing) ──
    if (_resignPreview === idx) {
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
    const depth = _posDepth(r.pos, r.name);
    const yrs = _yearsWithTeam(r.name);
    const faMkt = _faMktDepth(r.pos);
    const flightRisk = livePlayer?.unhappy;
    const isProne = typeof _isInjuryProne === "function" && _isInjuryProne(livePlayer);

    // ── System recommendation chip ─────────────────────────────────
    const rec = _resignRecommendation(r, depth, faMkt, curve, isProne, trend);
    const recChip = `<div class="frn-resign-rec" style="border-color:${rec.color};color:${rec.color}">
      <span class="action">${rec.action}</span>
      <span class="reason">${rec.reason}</span>
    </div>`;

    // ── Risk badges (loud chips) ───────────────────────────────────
    const risks = _resignRiskBadges(livePlayer, r, curve, trend);
    const riskHtml = risks.map(b =>
      `<span class="frn-resign-risk" style="color:${b.color};border-color:${b.color}55">${b.label}</span>`
    ).join("");

    // ── Player demand vs your offer ────────────────────────────────
    const demand = _resignPlayerDemand(livePlayer, r, r.baseMarket);
    const odds = _resignAcceptOdds(r.offer, r.offerYears, demand);
    const oddsColor = odds >= 0.85 ? "var(--green-lt)" : odds >= 0.5 ? "#e8a000" : "#ff8a8a";
    const demandHtml = `<div class="frn-resign-demand">
      <span class="lbl">Wants</span>
      <span class="num">$${demand.aav.toFixed(1)}M × ${demand.years}yr</span>
      <span class="lbl" style="margin-left:.5rem">Accept odds</span>
      <span class="num" style="color:${oddsColor}">${Math.round(odds * 100)}%</span>
    </div>`;

    // ── Comp pick preview on Let Walk ──────────────────────────────
    const compPick = _resignCompPick(r);

    // ── Background meta (depth / FA / years with team) — compact ──
    const metaBits = [];
    metaBits.push(`${depth} other ${r.pos} ≥75 OVR`);
    if (faMkt > 0) metaBits.push(`${faMkt} FA${r.pos}s avail`);
    if (yrs >= 1) metaBits.push(`${yrs}-yr veteran`);
    if (flightRisk) metaBits.push(`<span style="color:#ff8a8a">⚠ flight risk</span>`);
    const metaHtml = `<div class="frn-resign-meta">${metaBits.join(" · ")}</div>`;

    return `
      <div class="frn-resign-row tier-${_resignTier(r)}">
        ${recChip}
        <div class="frn-resign-row-inner">
          <div class="frn-resign-info">
            <span style="font-weight:700;color:var(--white);font-size:.95rem">${r.name}</span>
            <span style="color:var(--gray);font-size:.7rem">${r.pos} · ${r.overall} OVR ${trendHtml} · Age ${r.age}</span>
            ${_statLine(r.name) ? `<span style="color:var(--gray);font-size:.6rem;font-style:italic">${_statLine(r.name)}</span>` : ""}
            ${riskHtml ? `<div class="frn-resign-risks">${riskHtml}</div>` : ""}
            ${_contractContextBar(r.pos, r.baseMarket, cap)}
            ${demandHtml}
            ${metaHtml}
          </div>
          <div class="frn-resign-offer">
            <span style="color:${r.offer > r.baseMarket * 1.1 ? 'var(--red)' : r.offer < r.baseMarket * 0.9 ? 'var(--green-lt)' : 'var(--gold)'};font-weight:700">$${r.offer.toFixed(1)}M/yr ${vsMarketCell(r.offer, r.baseMarket)}</span>
            <div style="display:flex;align-items:center;gap:.25rem;justify-content:flex-end;margin-top:.15rem">
              <button class="frn-resign-yrbtn"
                ${r.offerYears <= _RESIGN_MIN_YEARS ? "disabled" : ""}
                onclick="frnResignAdjustYears(${idx}, -1)">−</button>
              <span style="color:var(--gray);font-size:.7rem;min-width:2.5rem;text-align:center">${r.offerYears} yr</span>
              <button class="frn-resign-yrbtn"
                ${r.offerYears >= _RESIGN_MAX_YEARS ? "disabled" : ""}
                onclick="frnResignAdjustYears(${idx}, 1)">+</button>
            </div>
            <span style="color:var(--gray);font-size:.6rem;text-align:right">total $${(r.offer * r.offerYears).toFixed(1)}M</span>
            ${deadTotal < 0.5 ? `<span style="color:var(--gray);font-size:.6rem">No dead cap</span>`
              : `<span style="color:#ff9090;font-size:.6rem;text-align:right" title="Prorated signing bonus — counts as dead cap if you release this player.">☠ Dead $${bonusProration.toFixed(1)}M×${r.offerYears}yr = $${deadTotal.toFixed(1)}M</span>`}
            <div style="display:flex;gap:.2rem;justify-content:flex-end;margin-top:.25rem;align-items:center;flex-wrap:wrap">
              <span style="color:var(--gray);font-size:.58rem">Structure:</span>
              ${["BALANCED","BACKLOADED","FRONTLOADED"].map(s => {
                const desc = s==="BALANCED"?"flat salaries":s==="BACKLOADED"?"cheap now, costly later":"costly now, cheap later";
                return `<button class="btn ${struct===s?"btn-gold":"btn-outline"}" onclick="frnResignSetStructure(${idx},'${s}')" style="font-size:.55rem;padding:.1rem .3rem" title="${desc}">${s[0]+s.slice(1).toLowerCase()}</button>`;
              }).join("")}
            </div>
          </div>
          <div class="frn-resign-btns">
            <button class="btn frn-resign-btn accept-btn" onclick="_resignPreview=${idx};_renderResignUIRefresh()">Review &amp; Sign</button>
            ${odds < 0.85 ? `<button class="btn frn-resign-btn accept-btn" style="border-color:var(--gold-lt);color:var(--gold-lt)" onclick="frnResignCounter(${idx})" title="Match their demand at 95% to close the gap">↻ Counter</button>` : ""}
            ${_franchiseTagAvailable() ? `<button class="btn frn-resign-btn accept-btn" style="border-color:var(--gold);color:var(--gold)"
              onclick="frnResignTag(${idx})" title="Franchise tag: 1yr fully guaranteed at top-5 position avg ($${_franchiseTagAAV({position: r.pos, name: r.name}, cap).toFixed(1)}M)">🏷 Tag</button>` : ""}
            <button class="btn frn-resign-btn decline-btn" onclick="frnResignDecide(${idx},'decline')" title="${compPick?compPick.label:''}">Let Walk${compPick?`<span style="font-size:.5rem;display:block;color:var(--gold-lt)">${compPick.label}</span>`:""}</button>
          </div>
        </div>
      </div>`;
  };

  // Group by tier for sectioned display
  const byTier = { foundation: [], starter: [], depth: [] };
  _resignPending.forEach((r, idx) => {
    byTier[_resignTier(r)].push({ r, idx });
  });

  const sectionFor = (title, list, eyebrow) => {
    if (!list.length) return "";
    return `<section class="frn-resign-section">
      <div class="frn-resign-section-head">
        <span class="title">${title}</span>
        <span class="eyebrow">${eyebrow} · ${list.length} player${list.length===1?"":"s"}</span>
      </div>
      <div class="frn-resign-list">${list.map(({ r, idx }) => rowFor(r, idx)).join("")}</div>
    </section>`;
  };

  const sectionsHtml = [
    sectionFor("⭐ Foundation",     byTier.foundation, "85+ OVR — franchise cornerstones"),
    sectionFor("🛡 Starters",       byTier.starter,    "75–84 OVR"),
    sectionFor("📋 Depth & Role",   byTier.depth,      "<75 OVR"),
  ].join("");

  const acceptedCost = _resignPending
    .filter(r => r.decision === "accept").reduce((s, r) => s + r.offer, 0);
  const finalCap = capCommitted + acceptedCost;
  const pending  = _resignPending.filter(r => r.decision === null).length;

  // Multi-year cap timeline (this year + 3) — visualizes commitment
  // load including accepted re-signings.
  const projHtml = `<div class="frn-resign-cap-timeline">
    ${proj.map((v, i) => {
      const pct = Math.min(100, (v / Math.max(1, cap)) * 100);
      const color = v > cap ? "var(--red)" : v > cap * 0.90 ? "#e8a000" : "var(--green-lt)";
      return `<div class="frn-resign-cap-year">
        <div class="lbl">Y${i+1}</div>
        <div class="bar"><div class="fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="num" style="color:${color}">$${v.toFixed(0)}M</div>
      </div>`;
    }).join("")}
  </div>`;

  // Decided summary chips
  const acceptedCount = _resignPending.filter(r => r.decision === "accept").length;
  const tagged = _resignPending.filter(r => r.decision === "tag").length;
  const declined = _resignPending.filter(r => r.decision === "decline").length;

  $("frnHomeContent").innerHTML = `
    <div class="frn-resign-hero">
      <div class="frn-resign-hero-eyebrow">SEASON ${franchise.season} OFFSEASON</div>
      <h1 class="frn-resign-hero-title">CONTRACT RE-SIGNINGS</h1>
      <div class="frn-resign-hero-sub">${myTeam.city} ${myTeam.name} · ${_resignPending.length} expiring contract${_resignPending.length===1?"":"s"}</div>
      <div class="frn-resign-hero-cap">
        Cap room after decisions: <b style="color:${cap-finalCap<0?"var(--red)":"var(--green-lt)"}">$${(cap-finalCap).toFixed(1)}M</b>
        of $${cap.toFixed(0)}M
      </div>
      <div class="frn-resign-hero-progress">
        <span class="chip green">✓ ${acceptedCount} signed</span>
        ${tagged?`<span class="chip gold">🏷 ${tagged} tagged</span>`:""}
        <span class="chip red">✗ ${declined} declined</span>
        <span class="chip neutral">${pending} pending</span>
      </div>
    </div>

    <div class="frn-resign-cap-wrap">
      <div class="frn-resign-cap-title">📊 PROJECTED CAP — NEXT 4 SEASONS</div>
      ${projHtml}
      <div class="frn-resign-cap-note">Includes existing kept contracts + accepted re-signings.</div>
    </div>

    <div class="frn-resign-bulk">
      <span class="lbl">Bulk:</span>
      ${_resignPending.some(r => r.decision === null && (r.offer || 0) <= 1.5)
        ? `<button class="frn-resign-bulk-btn" onclick="frnResignBulkSignUnder(1.5)">✓ Sign all ≤ $1.5M</button>` : ""}
      ${_resignPending.some(r => r.decision === null && (r.overall || 0) < 75)
        ? `<button class="frn-resign-bulk-btn" onclick="frnResignBulkDecline(75)">✗ Walk all &lt;75 OVR</button>` : ""}
      ${_resignPending.some(r => r.decision === null && (r.offer || 0) > 5)
        ? `<button class="frn-resign-bulk-btn" onclick="frnResignBulkDeclineOver(5)">✗ Walk all &gt; $5M</button>` : ""}
    </div>

    ${sectionsHtml}

    <div class="frn-actions" style="justify-content:center;margin-top:1.2rem;flex-wrap:wrap;gap:.5rem">
      ${pending > 0
        ? `<div style="color:var(--gray);font-size:.78rem">${pending} decision${pending>1?"s":""} remaining</div>`
        : `<button class="btn btn-gold" onclick="frnOpenResignRecap()">✓ Review &amp; Continue →</button>`}
    </div>`;
}

function _renderResignUIRefresh() {
  const cap = effectiveSalaryCap(franchise.chosenTeamId);
  const committed = (franchise.rosters[franchise.chosenTeamId] || [])
    .filter(p => p.contract && p.contract.remaining > 0)
    .reduce((s, p) => s + currentYearCapHit(p), 0);
  _renderResignUI(cap, committed);
}

// Click a collapsed completed row → reopen it for editing.
function frnResignReopen(idx) {
  const row = franchise._resignPending?.[idx];
  if (!row) return;
  if (row.decision === "tag") {
    // Tag uses up the team's franchise tag — return it on reopen.
    franchise.franchiseTagUsed = null;
    row.tagAAV = null;
  }
  row.decision = null;
  saveFranchise();
  _renderResignUIRefresh();
}

// End-of-flow recap modal — shown when user clicks "Review & Continue".
// Summarizes signings, declines, tags, projected cap, and comp picks.
function frnOpenResignRecap() {
  const myId = franchise.chosenTeamId;
  const pending = franchise._resignPending || [];
  const accepted = pending.filter(r => r.decision === "accept");
  const tagged   = pending.filter(r => r.decision === "tag");
  const declined = pending.filter(r => r.decision === "decline");
  const cap = effectiveSalaryCap(myId);
  const proj = _resignCapProjection(4);
  const compPicks = declined.map(r => _resignCompPick(r)).filter(Boolean);
  const totalSignedCost = accepted.reduce((s, r) => s + r.offer, 0)
                        + tagged.reduce((s, r) => s + (r.tagAAV || 0), 0);

  const projHtml = proj.map((v, i) => {
    const pct = Math.min(100, (v / Math.max(1, cap)) * 100);
    const color = v > cap ? "var(--red)" : v > cap * 0.90 ? "#e8a000" : "var(--green-lt)";
    return `<div class="frn-resign-cap-year">
      <div class="lbl">Y${i+1}</div>
      <div class="bar"><div class="fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="num" style="color:${color}">$${v.toFixed(0)}M</div>
    </div>`;
  }).join("");

  const compHtml = compPicks.length ? `
    <section class="frn-resign-recap-section">
      <div class="frn-resign-recap-section-title">🎁 PROJECTED COMP PICKS</div>
      <div style="font-size:.65rem;color:var(--blgray);margin-bottom:.35rem">Letting these players walk could yield compensatory picks next year:</div>
      ${compPicks.map((c, i) => `<div class="frn-resign-recap-row">
        <span style="color:var(--blwhite)">${declined[i].name}</span>
        <span style="color:var(--blgray)">${declined[i].pos}</span>
        <span style="color:var(--gold);font-weight:700;margin-left:auto">${c.label}</span>
      </div>`).join("")}
    </section>` : "";

  const existing = document.getElementById("frn-resign-recap-modal");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "frn-resign-recap-modal";
  el.className = "frn-resign-recap-overlay";
  el.innerHTML = `
    <div class="frn-resign-recap-card">
      <button class="frn-resign-recap-close" onclick="frnCloseResignRecap()">×</button>
      <div class="frn-resign-recap-eyebrow">REVIEW BEFORE CONTINUING</div>
      <h2 class="frn-resign-recap-title">RE-SIGNING SUMMARY</h2>

      <div class="frn-resign-recap-grid">
        <div class="frn-resign-recap-stat">
          <span class="lbl">SIGNED</span>
          <span class="val" style="color:var(--green-lt)">${accepted.length}</span>
          <span class="sub">$${accepted.reduce((s,r)=>s+r.offer,0).toFixed(1)}M / yr</span>
        </div>
        <div class="frn-resign-recap-stat">
          <span class="lbl">TAGGED</span>
          <span class="val" style="color:${tagged.length?"var(--blgold)":"var(--blgray)"}">${tagged.length}</span>
          <span class="sub">${tagged.length?`$${tagged.reduce((s,r)=>s+(r.tagAAV||0),0).toFixed(1)}M / yr`:"—"}</span>
        </div>
        <div class="frn-resign-recap-stat">
          <span class="lbl">DECLINED</span>
          <span class="val" style="color:${declined.length?"#ff8a8a":"var(--blgray)"}">${declined.length}</span>
          <span class="sub">to free agency</span>
        </div>
      </div>

      <section class="frn-resign-recap-section">
        <div class="frn-resign-recap-section-title">📊 PROJECTED CAP — NEXT 4 SEASONS</div>
        <div class="frn-resign-cap-timeline">${projHtml}</div>
        <div class="frn-resign-recap-note">Includes existing kept contracts + re-signings. Cap line: <b style="color:var(--blgold)">$${cap.toFixed(0)}M</b></div>
      </section>

      ${accepted.length ? `
      <section class="frn-resign-recap-section">
        <div class="frn-resign-recap-section-title">✓ YOU SIGNED</div>
        ${accepted.map(r => `<div class="frn-resign-recap-row">
          <span style="color:var(--blwhite);font-weight:700">${r.name}</span>
          <span style="color:var(--blgray)">${r.pos} · ${r.overall} OVR</span>
          <span style="color:var(--blgold);margin-left:auto">$${r.offer.toFixed(1)}M × ${r.offerYears}yr</span>
        </div>`).join("")}
      </section>` : ""}

      ${tagged.length ? `
      <section class="frn-resign-recap-section">
        <div class="frn-resign-recap-section-title">🏷 FRANCHISE-TAGGED</div>
        ${tagged.map(r => `<div class="frn-resign-recap-row">
          <span style="color:var(--blwhite);font-weight:700">${r.name}</span>
          <span style="color:var(--blgray)">${r.pos} · ${r.overall} OVR</span>
          <span style="color:var(--blgold);margin-left:auto">1yr / $${r.tagAAV?.toFixed(1)}M</span>
        </div>`).join("")}
      </section>` : ""}

      ${declined.length ? `
      <section class="frn-resign-recap-section">
        <div class="frn-resign-recap-section-title">✗ ENTERING FREE AGENCY</div>
        ${declined.map(r => `<div class="frn-resign-recap-row">
          <span style="color:var(--blwhite)">${r.name}</span>
          <span style="color:var(--blgray)">${r.pos} · ${r.overall} OVR</span>
          <span style="color:var(--blgray);margin-left:auto">market ~$${r.baseMarket.toFixed(1)}M</span>
        </div>`).join("")}
      </section>` : ""}

      ${compHtml}

      <div class="frn-resign-recap-cta">
        <button class="btn btn-outline" onclick="frnCloseResignRecap()">← Back to edit</button>
        <button class="btn btn-gold-big" onclick="frnCloseResignRecap();frnConfirmResignings()">✓ CONFIRM &amp; CONTINUE</button>
      </div>
    </div>`;
  el.addEventListener("click", e => { if (e.target === el) frnCloseResignRecap(); });
  document.body.appendChild(el);
}
function frnCloseResignRecap() {
  const el = document.getElementById("frn-resign-recap-modal");
  if (el) el.remove();
}

function frnResignBulkDecline(ovrThreshold) {
  if (!franchise._resignPending) return;
  for (const r of franchise._resignPending) {
    if (r.decision === null && (r.overall || 0) < ovrThreshold) r.decision = "decline";
  }
  _renderResignUIRefresh();
}

// Bulk-accept anything at or below the given AAV. Used for "cheap
// retention" — re-sign every depth piece under $1M with a click.
function frnResignBulkSignUnder(aavCap) {
  if (!franchise._resignPending) return;
  for (const r of franchise._resignPending) {
    if (r.decision !== null) continue;
    if ((r.offer || 0) <= aavCap) r.decision = "accept";
  }
  _renderResignUIRefresh();
}

// Bulk-decline anything that would cost more than X. Used for "free
// the cap" — let any pending player walk if their offer exceeds the
// threshold so you can sprint to FA with room.
function frnResignBulkDeclineOver(aavCap) {
  if (!franchise._resignPending) return;
  for (const r of franchise._resignPending) {
    if (r.decision !== null) continue;
    if ((r.offer || 0) > aavCap) r.decision = "decline";
  }
  _renderResignUIRefresh();
}

// Counter-offer flow — when the player's demand exceeds your offer,
// "Let Walk" gets an alternate "Counter offer" path. Adjusts offer by
// matching their demand at 95% so the deal is plausible.
function frnResignCounter(idx) {
  const row = franchise._resignPending?.[idx];
  if (!row || row.decision) return;
  const livePlayer = (franchise.rosters[franchise.chosenTeamId] || []).find(p => p.name === row.name);
  if (!livePlayer) return;
  const demand = _resignPlayerDemand(livePlayer, row, row.baseMarket);
  const newAav = Math.round(demand.aav * 0.95 * 10) / 10;
  const newYears = Math.max(_RESIGN_MIN_YEARS, Math.min(_RESIGN_MAX_YEARS, demand.years));
  row.offer = newAav;
  row.offerYears = newYears;
  saveFranchise();
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
  const cap = effectiveSalaryCap(franchise.chosenTeamId);
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
  const cap = effectiveSalaryCap(franchise.chosenTeamId);
  const committed = (franchise.rosters[franchise.chosenTeamId] || [])
    .filter(p => p.contract && p.contract.remaining > 0)
    .reduce((s, p) => s + p.contract.aav, 0);
  saveFranchise();
  _renderResignUI(cap, committed);
}

function frnConfirmResignings() {
  const { chosenTeamId, _resignPending } = franchise;
  const cap = effectiveSalaryCap(chosenTeamId);
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
      // Declined: remove from roster (enters FA — currently just lost).
      // Log as a qualifying loss for next-draft comp picks.
      const idx = myRoster.indexOf(player);
      if (idx !== -1) myRoster.splice(idx, 1);
      franchise._faLossesPending = franchise._faLossesPending || {};
      franchise._faLossesPending[chosenTeamId] = franchise._faLossesPending[chosenTeamId] || [];
      franchise._faLossesPending[chosenTeamId].push({
        name: r.name, pos: r.pos,
        marketAAV: r.baseMarket || computeMarketValue(player, cap),
        season: franchise.season,
      });
    }
  }
  franchise._resignPending = null;
  _resignPreview = null;
  saveFranchise();
  frnProceedToRosterChanges();
}

function frnProceedToRosterChanges() {
  _runCoachingCarousel();
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

  const link = (rec) => (rec && rec.name) ? _playerLinkSmart(rec.name) : "—";

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

  // Season Highlights — yearbook page. Hero card for the single biggest
  // moment, two columns below for your team's best year-end moments and
  // notable around-the-league plays. Deep links into the full highlight
  // reel via the dedicated highlights page.
  const allHL = (seasonHighlights || []).map((h, i) => ({ h, i }));
  const mineHL = allHL.filter(({ h }) =>
    h.homeId === chosenTeamId || h.awayId === chosenTeamId);
  const leagueHL = allHL.filter(({ h }) =>
    h.homeId !== chosenTeamId && h.awayId !== chosenTeamId);

  // Pick the absolute biggest moment of the season as the hero.
  const heroPick = allHL.slice().sort((a, b) => b.h.weight - a.h.weight)[0];

  // Pick a balanced trio of your moments: best offense + best defense +
  // best game capsule. Falls through to top-weight if a category is empty.
  const pickByType = (pool, type) => pool
    .filter(({ h }) => h.type === type && (heroPick == null || h !== heroPick.h))
    .sort((a, b) => b.h.weight - a.h.weight)[0];
  const fillRemaining = (pool, taken, target) => {
    const seen = new Set(taken.map(x => x?.i));
    const extras = pool
      .filter(({ i, h }) => !seen.has(i) && (heroPick == null || h !== heroPick.h))
      .sort((a, b) => b.h.weight - a.h.weight);
    const out = taken.filter(Boolean);
    for (const e of extras) { if (out.length >= target) break; out.push(e); }
    return out.slice(0, target);
  };

  const myCandidates = fillRemaining(mineHL, [
    pickByType(mineHL, "off"),
    pickByType(mineHL, "def"),
    pickByType(mineHL, "game"),
  ], 3);
  const leagueCandidates = fillRemaining(leagueHL, [], 3);

  const typeCfg = (h) => h.type === "def" ? { badge: h.isClutch ? "CLUTCH DEF" : "DEF", color: "#4dbdbd" }
    : h.type === "game" ? { badge: h.isClutch ? "OT" : "GAME", color: "#a78bfa" }
    : { badge: h.isClutch ? "CLUTCH" : "OFF", color: "#f5c542" };

  const hlMatchupLine = (h) => {
    const home = getTeam(h.homeId), away = getTeam(h.awayId);
    const hAbbr = home?.abbr || home?.name?.slice(0,3).toUpperCase();
    const aAbbr = away?.abbr || away?.name?.slice(0,3).toUpperCase();
    if (h.finalHome == null) return `${hAbbr} vs ${aAbbr}`;
    return `${hAbbr} ${h.finalHome}-${h.finalAway} ${aAbbr}`;
  };

  const hlCard = ({ h, i }, size) => {
    if (!h) return "";
    const { badge, color } = typeCfg(h);
    return `<button class="frn-awards-hl-card ${size || ""}"
        style="--accent:${color}" onclick="renderHighlightReplay(${i})">
      <div class="frn-awards-hl-meta">
        <span class="frn-awards-hl-badge" style="color:${color};border-color:${color}55">${badge}</span>
        <span class="frn-awards-hl-when">${h.week}${h.isPlayoff?" · PLAYOFF":""}</span>
      </div>
      <div class="frn-awards-hl-headline">${h.label}</div>
      <div class="frn-awards-hl-matchup">${hlMatchupLine(h)}</div>
      <div class="frn-awards-hl-watch">▶ Watch</div>
    </button>`;
  };

  const heroHtml = heroPick ? `
    <div class="frn-awards-hl-hero">
      <div class="frn-awards-hl-hero-eyebrow">🌟 THE BIG MOMENT</div>
      ${hlCard(heroPick, "hero")}
    </div>` : "";

  const myColHtml = myCandidates.length ? `
    <div class="frn-awards-hl-col">
      <div class="frn-awards-hl-col-title">⭐ YOUR TEAM'S YEAR</div>
      <div class="frn-awards-hl-col-cards">
        ${myCandidates.map(c => hlCard(c)).join("")}
      </div>
    </div>` : "";
  const leagueColHtml = leagueCandidates.length ? `
    <div class="frn-awards-hl-col">
      <div class="frn-awards-hl-col-title">🌐 AROUND THE LEAGUE</div>
      <div class="frn-awards-hl-col-cards">
        ${leagueCandidates.map(c => hlCard(c)).join("")}
      </div>
    </div>` : "";

  const hlSection = heroPick ? `
    <div class="bspnlive-section-title">⭐ SEASON HIGHLIGHTS</div>
    ${heroHtml}
    <div class="frn-awards-hl-grid">
      ${myColHtml}
      ${leagueColHtml}
    </div>
    <div class="frn-awards-hl-cta-row">
      <button class="frn-awards-hl-cta" onclick="renderFrnHighlightsAll()">
        🎬 View full highlight reel →
      </button>
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
            ${_playerLinkSmart(b["new"].playerName)}
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
// Resolutions: Extend (sign at current offer) · Counter (drop offer to 95% of
// demand) · Trade (move them) · Ignore (player becomes a flight risk).
const _HOLDOUT_MIN_YEARS = 1;
const _HOLDOUT_MAX_YEARS = 6;

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
    const demandAAV = Math.round(market * 10) / 10;
    const demandYrs = Math.max(p.contract.remaining + 2, 4);
    holdouts.push({
      name: p.name, position: p.position,
      overall: p.overall || 70,
      age: p.age || 27,
      currentAAV: aav,
      currentRemaining: p.contract.remaining,
      marketAAV: demandAAV,
      demandedAAV: demandAAV,
      demandedYears: demandYrs,
      offer: demandAAV,           // start matching their demand (100% accept)
      offerYears: demandYrs,
      structure: _defaultStructure(p.age || 27, p.overall || 70),
      resolved: null,
    });
  }
  franchise._holdouts = holdouts;
}

// Tier for visual sectioning (parallels _resignTier but the bar is higher
// because detectHoldouts already filters to grade ≥82 / A-).
function _holdoutTier(h) {
  const ovr = h.overall || 0;
  if (ovr >= 90) return "foundation";
  if (ovr >= 85) return "starter";
  return "depth";
}

// Odds the player accepts your current offer vs their demand. Same shape
// as _resignAcceptOdds — gap below demand cuts odds.
function _holdoutAcceptOdds(offerAAV, offerYears, demandAAV, demandYears) {
  if (!demandAAV) return 1;
  const aavGap   = (offerAAV - demandAAV) / Math.max(0.5, demandAAV);
  const yearGap  = offerYears - demandYears;
  let odds = 1 + Math.min(0, aavGap) * 2.0 + Math.min(0, yearGap) * 0.08;
  return Math.max(0, Math.min(1, odds));
}

// Quick trade-value heuristic so the Trade button shows what the player
// is worth in pick terms.
function _holdoutTradeValue(h, livePlayer) {
  const ovr = h.overall || 0;
  const age = livePlayer?.age ?? h.age ?? 28;
  if (ovr >= 90 && age <= 26) return "≈ 1st-rd + asset";
  if (ovr >= 90)              return "≈ 1st-rd pick";
  if (ovr >= 85 && age <= 28) return "≈ 1st-rd pick";
  if (ovr >= 85)              return "≈ 2nd-rd pick";
  if (ovr >= 82)              return "≈ 2nd-rd pick";
  return "≈ 3rd-rd pick";
}

// System recommendation for a demand. Mirrors _resignRecommendation but
// the actions are PAY / COUNTER / TRADE / IGNORE.
function _holdoutRecommendation(h, depth, faMkt, ageWarn, isInjuryProne, trend) {
  const ovr = h.overall || 0;
  const aboveMarket = h.demandedAAV > h.marketAAV * 1.10;
  const declining = trend != null && trend <= -3;
  const ageDanger = ageWarn?.level === "danger";

  if (ovr >= 90 && !ageDanger && !declining && !aboveMarket) {
    return { action: "PAY", color: "var(--green-lt)",
      reason: "Franchise cornerstone — extension before he gets unhappier" };
  }
  if (ageDanger || (declining && ovr >= 88)) {
    return { action: "COUNTER", color: "#e8a000",
      reason: "Age / decline risk on a long deal — counter shorter and cheaper" };
  }
  if (depth >= 2 && faMkt >= 3 && ovr < 90) {
    return { action: "TRADE", color: "var(--gold)",
      reason: `${depth} starter-grade ${h.position} on roster · flip for picks` };
  }
  if (isInjuryProne) {
    return { action: "COUNTER", color: "#e8a000",
      reason: "Injury history makes long money risky" };
  }
  if (aboveMarket) {
    return { action: "COUNTER", color: "#e8a000",
      reason: "Demand sits above market — counter at value" };
  }
  return { action: "PAY", color: "var(--green-lt)",
    reason: "Underpaid star — extension is the right move" };
}

// Multi-year cap projection — mirrors _resignCapProjection but extended
// demands REPLACE the player's existing contract (vs adding a new one).
function _holdoutCapProjection(years = 4) {
  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId] || [];
  const holdouts = franchise._holdouts || [];
  const extendedByName = new Map();
  for (const h of holdouts) {
    if (h.resolved === "extended") extendedByName.set(h.name, h);
  }
  const out = new Array(years).fill(0);
  for (const p of myRoster) {
    if (!p.contract || p.contract.remaining <= 0) continue;
    if (extendedByName.has(p.name)) continue; // replaced by the extension below
    const proration = p.contract.bonusProration || 0;
    const bases = p.contract.baseSalaries || [];
    const curIdx = (p.contract.years || 1) - (p.contract.remaining || 1);
    for (let i = 0; i < years && (curIdx + i) < bases.length; i++) {
      out[i] += (bases[curIdx + i] || 0) + proration;
    }
  }
  for (const h of extendedByName.values()) {
    const aav = h.offer ?? h.demandedAAV;
    const yrs = h.offerYears ?? h.demandedYears;
    const ovr = h.overall || 70;
    const { bonusProration } = _signingBonusCalc(aav, yrs, ovr);
    const struct = h.structure || "BALANCED";
    const bases = _baseSalarySchedule(aav, yrs, struct, bonusProration);
    for (let i = 0; i < years && i < bases.length; i++) {
      out[i] += bases[i] + bonusProration;
    }
  }
  return out.map(v => Math.round(v * 10) / 10);
}

// Preview index — which row is currently in "review year-by-year" mode.
let _holdoutPreview = null;

function frnHoldoutExtend(name) {
  const h = (franchise._holdouts || []).find(x => x.name === name);
  if (!h) return;
  const player = (franchise.rosters[franchise.chosenTeamId] || []).find(p => p.name === name);
  if (!player) return;
  const aav    = h.offer ?? h.demandedAAV;
  const years  = h.offerYears ?? h.demandedYears;
  const struct = h.structure || "BALANCED";
  const ovr    = player.overall || h.overall || 70;
  const { signingBonus, bonusProration, tradeKicker } = _signingBonusCalc(aav, years, ovr);
  const baseSalaries = _baseSalarySchedule(aav, years, struct, bonusProration);
  // Low accept odds → player is unhappy after signing.
  const odds = _holdoutAcceptOdds(aav, years, h.demandedAAV, h.demandedYears);
  if (odds < 0.5) player.unhappy = true;
  else delete player.unhappy;
  player.contract = {
    years, remaining: years, aav, structure: struct,
    baseSalaries, signingBonus, bonusProration, tradeKicker,
    guaranteedYears: _guaranteedYearsForLength(years),
    guaranteedAAV: aav, incentives: [], signedAav: aav,
  };
  h.resolved = "extended";
  _holdoutPreview = null;
  _pushNews({ type: "extension",
    label: `🤝 Extended ${player.position} ${name} — ${years}yr / $${aav.toFixed(1)}M/yr` });
  saveFranchise();
  renderFrnOffseason();
}

// Drop offer to 95% of demand — gives the user a one-click "below market"
// path that they can then refine with the year / structure pickers.
function frnHoldoutCounter(name) {
  const h = (franchise._holdouts || []).find(x => x.name === name);
  if (!h || h.resolved) return;
  h.offer = Math.round(h.demandedAAV * 0.95 * 10) / 10;
  h.offerYears = Math.max(_HOLDOUT_MIN_YEARS, Math.min(_HOLDOUT_MAX_YEARS, h.demandedYears));
  saveFranchise();
  renderFrnOffseason();
}

function frnHoldoutAdjustYears(name, delta) {
  const h = (franchise._holdouts || []).find(x => x.name === name);
  if (!h || h.resolved) return;
  const newYears = Math.max(_HOLDOUT_MIN_YEARS, Math.min(_HOLDOUT_MAX_YEARS, (h.offerYears || h.demandedYears) + delta));
  if (newYears === h.offerYears) return;
  h.offerYears = newYears;
  saveFranchise();
  renderFrnOffseason();
}

function frnHoldoutSetStructure(name, struct) {
  const h = (franchise._holdouts || []).find(x => x.name === name);
  if (!h || h.resolved) return;
  h.structure = struct;
  saveFranchise();
  renderFrnOffseason();
}

function frnHoldoutPreview(name) {
  _holdoutPreview = name;
  renderFrnOffseason();
}
function frnHoldoutPreviewClose() {
  _holdoutPreview = null;
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

// Click a collapsed completed row → reopen it for editing.
function frnHoldoutReopen(name) {
  const h = (franchise._holdouts || []).find(x => x.name === name);
  if (!h) return;
  // Undo side effects on the player record before clearing resolved.
  const player = (franchise.rosters[franchise.chosenTeamId] || []).find(p => p.name === name);
  if (h.resolved === "ignored" && player) delete player.unhappy;
  h.resolved = null;
  // Reset offer to match demand so re-opening starts from neutral.
  h.offer = h.demandedAAV;
  h.offerYears = h.demandedYears;
  saveFranchise();
  renderFrnOffseason();
}

// End-of-flow recap modal — shown when user clicks "Review Demands".
function frnOpenHoldoutRecap() {
  const list = franchise._holdouts || [];
  _migrateHoldoutShape(list);
  const extended = list.filter(h => h.resolved === "extended");
  const traded   = list.filter(h => h.resolved === "trade-block");
  const ignored  = list.filter(h => h.resolved === "ignored");
  const cap = effectiveSalaryCap(franchise.chosenTeamId);
  const proj = _holdoutCapProjection(4);

  const projHtml = proj.map((v, i) => {
    const pct = Math.min(100, (v / Math.max(1, cap)) * 100);
    const color = v > cap ? "var(--red)" : v > cap * 0.90 ? "#e8a000" : "var(--green-lt)";
    return `<div class="frn-resign-cap-year">
      <div class="lbl">Y${i+1}</div>
      <div class="bar"><div class="fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="num" style="color:${color}">$${v.toFixed(0)}M</div>
    </div>`;
  }).join("");

  const existing = document.getElementById("frn-holdout-recap-modal");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = "frn-holdout-recap-modal";
  el.className = "frn-resign-recap-overlay";
  el.innerHTML = `
    <div class="frn-resign-recap-card">
      <button class="frn-resign-recap-close" onclick="frnCloseHoldoutRecap()">×</button>
      <div class="frn-resign-recap-eyebrow">OFFSEASON DEMANDS</div>
      <h2 class="frn-resign-recap-title">DEMANDS SUMMARY</h2>

      <div class="frn-resign-recap-grid">
        <div class="frn-resign-recap-stat">
          <span class="lbl">EXTENDED</span>
          <span class="val" style="color:var(--green-lt)">${extended.length}</span>
          <span class="sub">${extended.length ? `$${extended.reduce((s,h)=>s+(h.offer||h.demandedAAV),0).toFixed(1)}M / yr` : "—"}</span>
        </div>
        <div class="frn-resign-recap-stat">
          <span class="lbl">TRADED</span>
          <span class="val" style="color:${traded.length?"var(--gold)":"var(--blgray)"}">${traded.length}</span>
          <span class="sub">${traded.length?"on trade block":"—"}</span>
        </div>
        <div class="frn-resign-recap-stat">
          <span class="lbl">IGNORED</span>
          <span class="val" style="color:${ignored.length?"#ff8a8a":"var(--blgray)"}">${ignored.length}</span>
          <span class="sub">${ignored.length?"flight risk":"—"}</span>
        </div>
      </div>

      <section class="frn-resign-recap-section">
        <div class="frn-resign-recap-section-title">📊 PROJECTED CAP — NEXT 4 SEASONS</div>
        <div class="frn-resign-cap-timeline">${projHtml}</div>
        <div class="frn-resign-recap-note">Includes extended demands. Cap line: <b style="color:var(--blgold)">$${cap.toFixed(0)}M</b></div>
      </section>

      ${extended.length ? `
      <section class="frn-resign-recap-section">
        <div class="frn-resign-recap-section-title">✓ EXTENDED</div>
        ${extended.map(h => `<div class="frn-resign-recap-row">
          <span style="color:var(--blwhite);font-weight:700">${h.name}</span>
          <span style="color:var(--blgray)">${h.position} · ${h.overall} OVR</span>
          <span style="color:var(--blgold);margin-left:auto">$${(h.offer||h.demandedAAV).toFixed(1)}M × ${h.offerYears||h.demandedYears}yr</span>
        </div>`).join("")}
      </section>` : ""}

      ${traded.length ? `
      <section class="frn-resign-recap-section">
        <div class="frn-resign-recap-section-title">🔀 ON TRADE BLOCK</div>
        ${traded.map(h => `<div class="frn-resign-recap-row">
          <span style="color:var(--blwhite)">${h.name}</span>
          <span style="color:var(--blgray)">${h.position} · ${h.overall} OVR</span>
          <span style="color:var(--blgray);margin-left:auto">${_holdoutTradeValue(h)}</span>
        </div>`).join("")}
      </section>` : ""}

      ${ignored.length ? `
      <section class="frn-resign-recap-section">
        <div class="frn-resign-recap-section-title">✗ IGNORED — FLIGHT RISK</div>
        ${ignored.map(h => `<div class="frn-resign-recap-row">
          <span style="color:var(--blwhite)">${h.name}</span>
          <span style="color:var(--blgray)">${h.position} · ${h.overall} OVR</span>
          <span style="color:#ff8a8a;margin-left:auto">walks at expiry</span>
        </div>`).join("")}
      </section>` : ""}

      <div class="frn-resign-recap-cta">
        <button class="btn btn-outline" onclick="frnCloseHoldoutRecap()">← Back to edit</button>
        <button class="btn btn-gold-big" onclick="frnCloseHoldoutRecap();frnConfirmGoToDraft()">📋 Continue to Draft →</button>
      </div>
    </div>`;
  el.addEventListener("click", e => { if (e.target === el) frnCloseHoldoutRecap(); });
  document.body.appendChild(el);
}
function frnCloseHoldoutRecap() {
  const el = document.getElementById("frn-holdout-recap-modal");
  if (el) el.remove();
}

// ── Coaching carousel ─────────────────────────────────────────────────────────
// Generates a pool of available coaches for AI hiring and player UI.

// Returns { teamId → rank } sorted by value. lowIsGood=true ranks lowest value as #1.
function _rankTeams(valueMap, lowIsGood) {
  const sorted = Object.entries(valueMap)
    .sort((a, b) => lowIsGood ? a[1] - b[1] : b[1] - a[1]);
  const ranks = {};
  sorted.forEach(([tId], i) => { ranks[Number(tId)] = i + 1; });
  return ranks;
}

// End-of-season coach performance evaluation. Runs before fire/hire decisions so
// a bad year erodes the coach's rating before the firing threshold is applied.
//   OC → ranked by points scored   (offensive output)
//   DC → ranked by points allowed  (defensive output)
//   HC → raw win total
// Bumps and declines are probabilistic — a good year doesn't guarantee growth,
// a bad year doesn't guarantee decline.
function _evaluateCoachPerformance() {
  const n = TEAMS.length;
  if (!n) return;

  // Aggregate regular-season points from the schedule
  const scored = {}, allowed = {};
  for (const g of (franchise.schedule || [])) {
    if (!g.played || g.homeScore == null) continue;
    scored[g.homeId]  = (scored[g.homeId]  || 0) + g.homeScore;
    scored[g.awayId]  = (scored[g.awayId]  || 0) + g.awayScore;
    allowed[g.homeId] = (allowed[g.homeId] || 0) + g.awayScore;
    allowed[g.awayId] = (allowed[g.awayId] || 0) + g.homeScore;
  }

  const offRanks = _rankTeams(scored,  false); // high points = low rank number = good
  const defRanks = _rankTeams(allowed, true);  // low points allowed = low rank number = good

  const top5    = Math.ceil(n * 5  / 32);
  const top11   = Math.ceil(n * 11 / 32);
  const bot11   = n - Math.ceil(n * 11 / 32) + 1; // rank threshold for bottom tier
  const champId = franchise.playoffBracket?.champion;
  const myId    = franchise.chosenTeamId;

  for (const t of TEAMS) {
    const tId  = t.id;
    const staff = franchise.coaches?.[tId];
    if (!staff) continue;
    const isMine = tId === Number(myId);

    // ── OC ──
    const oc = staff.oc;
    if (oc) {
      const rank = offRanks[tId] || n;
      const age  = oc.age || 45;
      const ageMul = age < 40 ? 1.2 : age > 60 ? 0.7 : 1.0;
      // Higher-rated OCs absorb knowledge faster; lower-rated ones have more friction.
      const ratingMul = (oc.rating || 60) >= 85 ? 1.20
                      : (oc.rating || 60) >= 75 ? 1.12
                      : (oc.rating || 60) >= 60 ? 1.00 : 0.85;
      const decayMul  = (oc.rating || 60) >= 85 ? 0.80
                      : (oc.rating || 60) >= 75 ? 0.90
                      : (oc.rating || 60) >= 60 ? 1.00 : 1.20;
      let ocGrew = false;

      if (rank <= top5) {
        const chance = 0.55 * ageMul * ratingMul;
        if (Math.random() < chance) {
          const bump = rank <= 3 ? 2 : 1;
          oc.rating = Math.min(89, (oc.rating || 60) + bump);
          ocGrew = true;
          if (isMine) {
            _pushNews({ type:"coach_grow",
              label: `📈 OC ${oc.name} rated up to ${oc.rating} — #${rank} offense in the league` });
          } else if (rank <= 3) {
            _pushNews({ type:"coach_grow",
              label: `📈 ${t.name} OC ${oc.name} earns league recognition after #${rank} offense` });
          }
        }
      } else if (rank <= top11) {
        if (Math.random() < 0.30 * ageMul * ratingMul) {
          oc.rating = Math.min(89, (oc.rating || 60) + 1);
          ocGrew = true;
          if (isMine) {
            _pushNews({ type:"coach_grow",
              label: `📈 OC ${oc.name} rated up to ${oc.rating} — top-${rank} offense` });
          }
        }
      } else if (rank >= bot11) {
        if (Math.random() < 0.25 * decayMul) {
          oc.rating = Math.max(30, (oc.rating || 60) - 1);
          if (isMine) {
            _pushNews({ type:"coach_decline",
              label: `📉 OC ${oc.name} rated down to ${oc.rating} — bottom-third offense` });
          }
        }
      }

      // Elite HC nudge: great coaches occasionally push solid coordinators one step further.
      // Fires only when the OC already grew this season — not a shortcut, a refinement.
      const hcRating = staff.hc?.rating || 60;
      if (ocGrew && hcRating >= 80 && (oc.rating || 60) >= 75 && Math.random() < 0.15) {
        oc.rating = Math.min(89, oc.rating + 1);
        if (isMine) {
          _pushNews({ type:"coach_grow",
            label: `📈 OC ${oc.name} pushed to ${oc.rating} under HC ${staff.hc.name}'s mentorship` });
        }
      }
    }

    // ── DC ──
    const dc = staff.dc;
    if (dc) {
      const rank = defRanks[tId] || n;
      const age  = dc.age || 45;
      const ageMul = age < 40 ? 1.2 : age > 60 ? 0.7 : 1.0;
      const ratingMul = (dc.rating || 60) >= 85 ? 1.20
                      : (dc.rating || 60) >= 75 ? 1.12
                      : (dc.rating || 60) >= 60 ? 1.00 : 0.85;
      const decayMul  = (dc.rating || 60) >= 85 ? 0.80
                      : (dc.rating || 60) >= 75 ? 0.90
                      : (dc.rating || 60) >= 60 ? 1.00 : 1.20;
      let dcGrew = false;

      if (rank <= top5) {
        const chance = 0.55 * ageMul * ratingMul;
        if (Math.random() < chance) {
          const bump = rank <= 3 ? 2 : 1;
          dc.rating = Math.min(89, (dc.rating || 60) + bump);
          dcGrew = true;
          if (isMine) {
            _pushNews({ type:"coach_grow",
              label: `📈 DC ${dc.name} rated up to ${dc.rating} — #${rank} defense in the league` });
          } else if (rank <= 3) {
            _pushNews({ type:"coach_grow",
              label: `📈 ${t.name} DC ${dc.name} earns league recognition after #${rank} defense` });
          }
        }
      } else if (rank <= top11) {
        if (Math.random() < 0.30 * ageMul * ratingMul) {
          dc.rating = Math.min(89, (dc.rating || 60) + 1);
          dcGrew = true;
          if (isMine) {
            _pushNews({ type:"coach_grow",
              label: `📈 DC ${dc.name} rated up to ${dc.rating} — top-${rank} defense` });
          }
        }
      } else if (rank >= bot11) {
        if (Math.random() < 0.25 * decayMul) {
          dc.rating = Math.max(30, (dc.rating || 60) - 1);
          if (isMine) {
            _pushNews({ type:"coach_decline",
              label: `📉 DC ${dc.name} rated down to ${dc.rating} — bottom-third defense` });
          }
        }
      }

      const hcRating = staff.hc?.rating || 60;
      if (dcGrew && hcRating >= 80 && (dc.rating || 60) >= 75 && Math.random() < 0.15) {
        dc.rating = Math.min(89, dc.rating + 1);
        if (isMine) {
          _pushNews({ type:"coach_grow",
            label: `📈 DC ${dc.name} pushed to ${dc.rating} under HC ${staff.hc.name}'s mentorship` });
        }
      }
    }

    // ── HC ──
    const hc = staff.hc;
    if (hc) {
      const wins  = franchise.standings?.[tId]?.w || 0;
      const age   = hc.age || 50;
      const ageMul = age < 40 ? 1.2 : age > 60 ? 0.7 : 1.0;

      if (tId === champId) {
        if (Math.random() < 0.70 * ageMul) {
          hc.rating = Math.min(89, (hc.rating || 60) + 2);
          if (isMine) _pushNews({ type:"coach_grow",
            label: `📈 HC ${hc.name} rated up to ${hc.rating} — championship season` });
        }
      } else if (wins >= 12) {
        if (Math.random() < 0.55 * ageMul) {
          hc.rating = Math.min(89, (hc.rating || 60) + 1);
          if (isMine) _pushNews({ type:"coach_grow",
            label: `📈 HC ${hc.name} rated up to ${hc.rating} — ${wins}-win season` });
        }
      } else if (wins >= 10) {
        if (Math.random() < 0.30 * ageMul) {
          hc.rating = Math.min(89, (hc.rating || 60) + 1);
          if (isMine) _pushNews({ type:"coach_grow",
            label: `📈 HC ${hc.name} rated up to ${hc.rating} — double-digit wins` });
        }
      } else if (wins <= 4) {
        if (Math.random() < 0.30) {
          hc.rating = Math.max(30, (hc.rating || 60) - 1);
          if (isMine) _pushNews({ type:"coach_decline",
            label: `📉 HC ${hc.name} rated down to ${hc.rating} — ${wins}-win season` });
        }
      }
    }
  }
}

function _generateCoachMarket() {
  if (!franchise._retiredPlayerPool) franchise._retiredPlayerPool = [];

  // Prune retired pool — remove entries older than 10 seasons
  const currentSeason = franchise.season || 1;
  franchise._retiredPlayerPool = franchise._retiredPlayerPool.filter(rp =>
    (currentSeason - (rp.retiredSeason || 1)) <= 10
  );
  // Position coach candidates age out faster — 5 seasons
  if (franchise._posCoachPool) {
    franchise._posCoachPool = franchise._posCoachPool.filter(rp =>
      (currentSeason - (rp.retiredSeason || 1)) <= 5
    );
  }

  const pool = [];

  // 1. Real coaches who were fired/departed this season
  const fa = franchise._coachFA || [];
  for (const c of fa) {
    if ((c.age || 50) < 72) pool.push({ ...c });
  }
  franchise._coachFA = [];

  // 2. Retired players surfacing as coach candidates (2-10 seasons out, peakOvr ≥ 72, 20% chance each)
  const eligible = franchise._retiredPlayerPool.filter(rp => {
    const yo = currentSeason - (rp.retiredSeason || 1);
    return yo >= 2 && yo <= 10 && (rp.peakOvr || 0) >= 72;
  }).sort(() => Math.random() - 0.5);

  let retiredAdded = 0;
  for (const rp of eligible) {
    if (retiredAdded >= 3) break;
    if (Math.random() < 0.20) {
      const candidate = _retiredPlayerToCoach(rp, currentSeason);
      if (candidate) {
        pool.push(candidate);
        retiredAdded++;
        _pushNews({ type:"coach_hire",
          label: `🏈 Former ${rp.pos} ${rp.name} enters coaching — available as ${candidate.type.toUpperCase()}` });
      }
    }
  }

  // 3. Fresh rolls to meet minimum pool size
  const hcN = pool.filter(c => c.type === "hc").length;
  const ocN = pool.filter(c => c.type === "oc").length;
  const dcN = pool.filter(c => c.type === "dc").length;
  for (let i = hcN; i < 6; i++) pool.push({ type:"hc", ..._rollCoach() });
  for (let i = ocN; i < 3; i++) pool.push({ type:"oc", ..._rollOC() });
  for (let i = dcN; i < 3; i++) pool.push({ type:"dc", ..._rollDC() });

  // Every HC candidate comes pre-packaged with their preferred staff tree.
  // Quality of proposed coords scales with the HC's prestige — elite coaches
  // have better networks and can attract better coordinators.
  for (const c of pool) {
    if (c.type === "hc" && !c.proposedOC) {
      const hcR = c.rating || 60;
      const coordBonus = hcR >= 85 ? 4 + Math.floor(Math.random() * 5)  // +4 to +8
                       : hcR >= 78 ? 2 + Math.floor(Math.random() * 4)  // +2 to +5
                       : hcR >= 68 ? Math.floor(Math.random() * 3)       // +0 to +2
                       :            -Math.floor(Math.random() * 3);       // -2 to 0
      const oc = _rollOC();
      oc.rating = Math.max(40, Math.min(85, oc.rating + coordBonus));
      _renewCoachAtMarket(oc, "oc", 1.0);
      c.proposedOC = oc;
      const dc = _rollDC();
      dc.rating = Math.max(40, Math.min(85, dc.rating + coordBonus));
      _renewCoachAtMarket(dc, "dc", 1.0);
      c.proposedDC = dc;
    }
  }

  // 40% of HC candidates bring a position coach from their network.
  // Tier scales with HC prestige — elite coaches attract better position coaches.
  for (const c of pool) {
    if (c.type === "hc" && !c.broughtPosCoach && Math.random() < 0.40) {
      const grp  = POSITION_COACH_GROUPS[Math.floor(Math.random() * POSITION_COACH_GROUPS.length)];
      const hcR  = c.rating || 60;
      const pcRoll = Math.random();
      const pcTier = hcR >= 82 ? (pcRoll < 0.45 ? "Elite" : pcRoll < 0.80 ? "Good" : "Journeyman")
                   : hcR >= 70 ? (pcRoll < 0.20 ? "Elite" : pcRoll < 0.60 ? "Good" : "Journeyman")
                   :              (pcRoll < 0.05 ? "Elite" : pcRoll < 0.30 ? "Good" : "Journeyman");
      c.broughtPosCoach = {
        name: `${pickFirstName()} ${pickLastName()}`,
        group: grp, tier: pcTier,
        age: 32 + Math.floor(Math.random() * 12),
        yearsWithTeam: 0,
        salary: POSITION_COACH_TIERS[pcTier].salary,
      };
    }
  }

  franchise._coachMarket = pool;
}

// Ensures a coaching market exists for mid-season HC vacancies.
// The end-of-season market (8 HCs) is generated by _runCoachingCarousel.
// If that hasn't run yet (early season or first year), generate a smaller
// emergency pool of mid-season candidates — slightly weaker on average since
// better coaches typically wait for the full offseason cycle.
function _ensureCoachMarket() {
  if (franchise._coachMarket?.length) return;
  const pool = [];
  // Drain real departed coaches first — same logic as _generateCoachMarket
  const fa = franchise._coachFA || [];
  for (const c of fa) {
    if ((c.age || 50) < 72) pool.push({ ...c });
  }
  franchise._coachFA = [];
  // Pad with fresh rolls; mid-season hires skew slightly weaker since elite coaches wait for the full offseason cycle
  const hcN = pool.filter(c => c.type === "hc").length;
  const ocN = pool.filter(c => c.type === "oc").length;
  const dcN = pool.filter(c => c.type === "dc").length;
  for (let i = hcN; i < 4; i++) {
    const hc = _rollCoach();
    hc.rating = Math.max(40, hc.rating - 8);
    pool.push({ type:"hc", ...hc });
  }
  for (let i = ocN; i < 2; i++) pool.push({ type:"oc", ..._rollOC() });
  for (let i = dcN; i < 2; i++) pool.push({ type:"dc", ..._rollDC() });
  // Attach proposed staff — same prestige scaling as _generateCoachMarket
  for (const c of pool) {
    if (c.type === "hc" && !c.proposedOC) {
      const hcR = c.rating || 60;
      const coordBonus = hcR >= 85 ? 4 + Math.floor(Math.random() * 5)
                       : hcR >= 78 ? 2 + Math.floor(Math.random() * 4)
                       : hcR >= 68 ? Math.floor(Math.random() * 3)
                       :            -Math.floor(Math.random() * 3);
      const oc = _rollOC();
      oc.rating = Math.max(40, Math.min(85, oc.rating + coordBonus));
      _renewCoachAtMarket(oc, "oc", 1.0);
      c.proposedOC = oc;
      const dc = _rollDC();
      dc.rating = Math.max(40, Math.min(85, dc.rating + coordBonus));
      _renewCoachAtMarket(dc, "dc", 1.0);
      c.proposedDC = dc;
    }
  }
  for (const c of pool) {
    if (c.type === "hc" && !c.broughtPosCoach && Math.random() < 0.40) {
      const grp  = POSITION_COACH_GROUPS[Math.floor(Math.random() * POSITION_COACH_GROUPS.length)];
      const hcR  = c.rating || 60;
      const pcRoll = Math.random();
      const pcTier = hcR >= 82 ? (pcRoll < 0.45 ? "Elite" : pcRoll < 0.80 ? "Good" : "Journeyman")
                   : hcR >= 70 ? (pcRoll < 0.20 ? "Elite" : pcRoll < 0.60 ? "Good" : "Journeyman")
                   :              (pcRoll < 0.05 ? "Elite" : pcRoll < 0.30 ? "Good" : "Journeyman");
      c.broughtPosCoach = {
        name: `${pickFirstName()} ${pickLastName()}`,
        group: grp, tier: pcTier,
        age: 32 + Math.floor(Math.random() * 12),
        yearsWithTeam: 0,
        salary: POSITION_COACH_TIERS[pcTier].salary,
      };
    }
  }
  franchise._coachMarket = pool;
}

// New HC installs their preferred staff. Called any time an HC changes.
// 75% chance the incoming HC replaces the OC with their own guy;
// 40% chance they also replace the DC. Generates news for each swap.
// Returns an array of news labels so callers can push them in context.
function _applyHcStaffSweep(staff, teamLabel) {
  const msgs = [];
  const hc = staff.hc;
  if (Math.random() < 0.75) {
    const old = staff.oc;
    const taken = _coordMayTakePosCoach(staff, "oc", teamLabel, old?.name);
    if (taken) msgs.push({ type:"coach_depart",
      label: `🚪 ${teamLabel}: departing OC ${old?.name || "?"} takes ${taken.group} coach ${taken.name}` });
    _coachFAAdd(staff.oc, "oc");
    staff.oc = hc?.proposedOC ? { ...hc.proposedOC } : _rollOC();
    msgs.push({ type:"coach_hire",
      label: `🏟 ${teamLabel}: new HC installs OC ${staff.oc.name}${old ? ` (replaces ${old.name})` : ""}` });
    if (staff._chemistry) staff._chemistry.qbOcBond = false;
  }
  if (Math.random() < 0.40) {
    const old = staff.dc;
    const taken = _coordMayTakePosCoach(staff, "dc", teamLabel, old?.name);
    if (taken) msgs.push({ type:"coach_depart",
      label: `🚪 ${teamLabel}: departing DC ${old?.name || "?"} takes ${taken.group} coach ${taken.name}` });
    _coachFAAdd(staff.dc, "dc");
    staff.dc = hc?.proposedDC ? { ...hc.proposedDC } : _rollDC();
    msgs.push({ type:"coach_hire",
      label: `🏟 ${teamLabel}: new HC installs DC ${staff.dc.name}${old ? ` (replaces ${old.name})` : ""}` });
  }
  // HC brings a position coach from their network
  if (hc?.broughtPosCoach) {
    if (!staff.positionStaff) staff.positionStaff = [];
    if (staff.positionStaff.length < 3) {
      staff.positionStaff.push({ ...hc.broughtPosCoach });
      msgs.push({ type:"coach_hire",
        label: `🏟 ${teamLabel}: ${hc.name} brings ${hc.broughtPosCoach.group} coach ${hc.broughtPosCoach.name}` });
    }
  }
  return msgs;
}

// When a coordinator departs, 35% chance they take a relevant position coach with them.
// Removed coach is added to _posCoachPool so other teams (including user) can hire them.
function _coordMayTakePosCoach(staff, slot) {
  if (!staff?.positionStaff?.length) return null;
  const groups = slot === "oc" ? ["QB","OL","Skill"] : ["DL","LB/DB"];
  const idx = staff.positionStaff.findIndex(pc => groups.includes(pc.group));
  if (idx === -1 || Math.random() >= 0.35) return null;
  const taken = staff.positionStaff.splice(idx, 1)[0];
  if (!franchise._posCoachPool) franchise._posCoachPool = [];
  franchise._posCoachPool.push({ ...taken, retiredSeason: franchise.season || 1 });
  return taken;
}

// End-of-season coaching changes for AI teams.
function _runCoachingCarousel() {
  // Evaluate performance first — ratings change before fire decisions are made,
  // so a coordinator who tanked their unit has a lower rating going into the
  // firing threshold check.
  _evaluateCoachPerformance();
  _generateCoachMarket();
  const champId = franchise.playoffBracket?.champion;
  const market  = franchise._coachMarket;

  // Track consecutive playoff misses per team
  if (!franchise._coachMissedPlayoffs) franchise._coachMissedPlayoffs = {};
  // Determine which teams made playoffs this season
  const playoffTeamIds = new Set(
    (franchise.playoffBracket?.rounds?.[0] || []).flatMap(g => [g.homeId, g.awayId])
  );

  for (const t of TEAMS) {
    const tId = t.id;
    if (tId === franchise.chosenTeamId) continue; // user manages their own staff
    const staff = franchise.coaches?.[tId];
    if (!staff) continue;
    const hc  = staff.hc;
    if (!hc) continue;

    // ── Coach retirement by age ──────────────────────────────────────────────
    const _retireProb = (age, isHC) => {
      if (age < 62) return 0;
      if (isHC) {
        if (age <= 65) return 0.04;
        if (age <= 69) return 0.12;
        if (age <= 73) return 0.28;
        return 0.50;
      } else {
        if (age <= 65) return 0.07;
        if (age <= 69) return 0.18;
        if (age <= 73) return 0.40;
        return 0.65;
      }
    };
    const isChamp = tId === champId;
    const hcRetProb = _retireProb(hc.age || 55, true)
      * (isChamp ? 0.5 : 1)
      * ((hc.rating || 60) >= 80 ? 0.7 : 1)
      * ((hc.rating || 60) <= 50 ? 1.3 : 1);
    if (hcRetProb > 0 && Math.random() < hcRetProb) {
      _coachFAAdd(hc, "hc");
      _pushNews({ type:"coach_depart",
        label: `🎓 ${t.name} HC ${hc.name} retires after ${hc.yearsWithTeam||0} season${(hc.yearsWithTeam||0)===1?"":"s"}` });
      const candidates = market.filter(c => c.type === "hc");
      if (candidates.length) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        staff.hc = { ...pick, yearsWithTeam:0, record:{ w:0, l:0, championships:0 } };
        delete staff.hc.type;
        for (const msg of _applyHcStaffSweep(staff, t.name)) _pushNews(msg);
        staff._chemistry = null;
      } else {
        staff.hc = _rollCoach();
      }
      franchise._coachMissedPlayoffs[tId] = 0;
      continue; // skip further processing for this team this carousel
    }
    if (staff.oc) {
      const ocRetProb = _retireProb(staff.oc.age || 45, false);
      if (ocRetProb > 0 && Math.random() < ocRetProb) {
        _pushNews({ type:"coach_depart",
          label: `🎓 ${t.name} OC ${staff.oc.name} retires` });
        _coachFAAdd(staff.oc, "oc");
        if (staff._chemistry) staff._chemistry.qbOcBond = false;
        staff.oc = _rollOC();
      }
    }
    if (staff.dc) {
      const dcRetProb = _retireProb(staff.dc.age || 45, false);
      if (dcRetProb > 0 && Math.random() < dcRetProb) {
        _pushNews({ type:"coach_depart",
          label: `🎓 ${t.name} DC ${staff.dc.name} retires` });
        _coachFAAdd(staff.dc, "dc");
        staff.dc = _rollDC();
      }
    }

    const s   = franchise.standings?.[tId] || { w:0, l:0 };
    const gp  = (s.w || 0) + (s.l || 0) + (s.t || 0);
    const pct = gp > 0 ? (s.w + (s.t || 0) * 0.5) / gp : 0;

    // Track consecutive playoff misses
    if (!playoffTeamIds.has(tId)) {
      franchise._coachMissedPlayoffs[tId] = (franchise._coachMissedPlayoffs[tId] || 0) + 1;
    } else {
      franchise._coachMissedPlayoffs[tId] = 0;
    }
    const missedRun = franchise._coachMissedPlayoffs[tId] || 0;

    // Champion team: HC stays unless ancient
    if (tId === champId && (hc.age || 55) <= 70) continue;

    let fireChance = 0;
    if (pct < 0.40 && (hc.yearsWithTeam || 0) >= 2) fireChance = 0.55;
    if (missedRun >= 3) fireChance = Math.max(fireChance, 0.75);
    if ((hc.age || 55) > 70) fireChance = Math.max(fireChance, 0.60);

    if (fireChance > 0 && Math.random() < fireChance) {
      // OC promotion: if OC has rating >= 75 and HC is fired, 50% chance to promote
      const oc = staff.oc;
      const promoted = oc && (oc.rating || 0) >= 75 && Math.random() < 0.50;
      if (promoted) {
        // OC promoted to HC — OC slot opens, promoted HC typically keeps the existing DC
        const promotedAav   = +(oc.salary * 1.5).toFixed(1);
        const promotedYears = 3 + Math.floor(Math.random() * 2);
        const promotedSb    = +(promotedAav * promotedYears * COACH_SB_PCT.hc * 0.8).toFixed(1);
        staff.hc = {
          name: oc.name,
          rating: Math.min(89, (oc.rating || 60) + Math.floor(Math.random() * 5)),
          cultureTrait: HC_CULTURE_TRAITS[Math.floor(Math.random() * HC_CULTURE_TRAITS.length)].key,
          specialtyTrait: "Offensive Minded",
          age: oc.age || 45,
          yearsWithTeam: 0,
          record: { w:0, l:0, championships:0 },
        };
        _coachApplyContract(staff.hc, promotedAav, promotedYears, promotedSb, "hc");
        _pushNews({ type:"coach_hire",
          label: `🏟 ${t.name} promote OC ${oc.name} to head coach` });
        // Promoted HC fills their old OC slot from their network (always — it's now open)
        staff.oc = _rollOC();
        _pushNews({ type:"coach_hire", label: `🏟 ${t.name} hire OC ${staff.oc.name}` });
        staff._chemistry = null;
      } else {
        // Hire from market — new HC installs their own preferred staff
        const candidates = market.filter(c => c.type === "hc");
        if (candidates.length) {
          _coachFAAdd(hc, "hc");
          const budgetRoom = 20 - (coachingBudgetUsed(tId) - (hc?.salary || 0));
          const affordable = candidates.filter(c => c.salary <= budgetRoom);
          const pickPool = affordable.length ? affordable : candidates;
          const pick = pickPool[Math.floor(Math.random() * pickPool.length)];
          staff.hc = { ...pick, yearsWithTeam: 0, record: { w:0, l:0, championships:0 } };
          delete staff.hc.type;
          _pushNews({ type:"coach_hire",
            label: `🏟 ${t.name} hire ${staff.hc.name} as new head coach` });
        }
        // New HC brings their preferred coordinator(s)
        for (const msg of _applyHcStaffSweep(staff, t.name)) _pushNews(msg);
        franchise._coachMissedPlayoffs[tId] = 0;
        staff._chemistry = null;
      }
    }

    // Occasional OC/DC turnover — check for internal promotion from position staff first
    if (Math.random() < 0.18) {
      const offGroups = ["QB","OL","Skill"];
      const internalPC = (staff.positionStaff||[])
        .filter(pc => offGroups.includes(pc.group) && (pc.rating||0) >= 68)
        .sort((a,b) => (b.rating||0) - (a.rating||0))[0];
      if (internalPC && Math.random() < 0.20) {
        const { type, coord } = _posCoachToCoord(internalPC, tId);
        if (type === "oc") {
          _coachFAAdd(staff.oc, "oc");
          staff.oc = { ...coord };
          staff.positionStaff = (staff.positionStaff||[]).filter(pc => pc !== internalPC);
          staff._chemistry = null;
          _pushNews({ type:"coach_hire",
            label: `🏟 ${t.name} promote ${internalPC.group} coach ${internalPC.name} to OC` });
        }
      } else {
        const candidates = market.filter(c => c.type === "oc");
        if (candidates.length) {
          const depName = staff.oc?.name;
          const taken = _coordMayTakePosCoach(staff, "oc");
          if (taken) _pushNews({ type:"coach_depart",
            label: `🚪 ${t.name} OC ${depName} departs, takes ${taken.group} coach ${taken.name}` });
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          staff.oc = { ...pick, yearsWithTeam: 0 };
          delete staff.oc.type;
        }
      }
    }
    if (Math.random() < 0.18) {
      const defGroups = ["DL","LB/DB"];
      const internalPC = (staff.positionStaff||[])
        .filter(pc => defGroups.includes(pc.group) && (pc.rating||0) >= 68)
        .sort((a,b) => (b.rating||0) - (a.rating||0))[0];
      if (internalPC && Math.random() < 0.20) {
        const { type, coord } = _posCoachToCoord(internalPC, tId);
        if (type === "dc") {
          _coachFAAdd(staff.dc, "dc");
          staff.dc = { ...coord };
          staff.positionStaff = (staff.positionStaff||[]).filter(pc => pc !== internalPC);
          staff._chemistry = null;
          _pushNews({ type:"coach_hire",
            label: `🏟 ${t.name} promote ${internalPC.group} coach ${internalPC.name} to DC` });
        }
      } else {
        const candidates = market.filter(c => c.type === "dc");
        if (candidates.length) {
          const depName = staff.dc?.name;
          const taken = _coordMayTakePosCoach(staff, "dc");
          if (taken) _pushNews({ type:"coach_depart",
            label: `🚪 ${t.name} DC ${depName} departs, takes ${taken.group} coach ${taken.name}` });
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          staff.dc = { ...pick, yearsWithTeam: 0 };
          delete staff.dc.type;
        }
      }
    }

    // Contract expirations — coordinators on expired deals may walk for better offers.
    // HC expiry handled as an additional fire-chance path above; coordinators depart
    // independently here since their market is separate from HC decisions.
    if ((staff.oc?.contractYears ?? 1) === 0) {
      const ocLoyal = staff.oc.developedByTeamId === tId;
      if (Math.random() < (ocLoyal ? 0.22 : 0.35)) {
        const depName = staff.oc.name;
        const taken = _coordMayTakePosCoach(staff, "oc");
        _coachFAAdd(staff.oc, "oc");
        staff.oc = _rollOC();
        if (tId === franchise.chosenTeamId) {
          _pushNews({ type:"coach_depart",
            label: `🚪 OC ${depName} departs — contract expired${taken ? `, took ${taken.group} coach ${taken.name}` : ""}` });
        }
      } else {
        _renewCoachAtMarket(staff.oc, "oc", ocLoyal ? 0.87 : 1.0);
        if (tId === franchise.chosenTeamId) {
          _pushNews({ type:"coach_hire", label: `📝 OC ${staff.oc.name} renewed${ocLoyal ? " (hometown discount)" : ""} — $${staff.oc.salary}M/yr` });
        }
      }
    } else if (staff.oc && (staff.oc.contractYears ?? 1) === 0) {
      _renewCoachAtMarket(staff.oc, "oc", 1.0);
      if (tId === franchise.chosenTeamId) {
        _pushNews({ type:"coach_hire", label: `📝 OC ${staff.oc.name} renewed — $${staff.oc.salary}M/yr` });
      }
    }
    if ((staff.dc?.contractYears ?? 1) === 0) {
      const dcLoyal = staff.dc.developedByTeamId === tId;
      if (Math.random() < (dcLoyal ? 0.22 : 0.35)) {
        const depName = staff.dc.name;
        const taken = _coordMayTakePosCoach(staff, "dc");
        _coachFAAdd(staff.dc, "dc");
        staff.dc = _rollDC();
        if (tId === franchise.chosenTeamId) {
          _pushNews({ type:"coach_depart",
            label: `🚪 DC ${depName} departs — contract expired${taken ? `, took ${taken.group} coach ${taken.name}` : ""}` });
        }
      } else {
        _renewCoachAtMarket(staff.dc, "dc", dcLoyal ? 0.87 : 1.0);
        if (tId === franchise.chosenTeamId) {
          _pushNews({ type:"coach_hire", label: `📝 DC ${staff.dc.name} renewed${dcLoyal ? " (hometown discount)" : ""} — $${staff.dc.salary}M/yr` });
        }
      }
    } else if (staff.dc && (staff.dc.contractYears ?? 1) === 0) {
      _renewCoachAtMarket(staff.dc, "dc", 1.0);
      if (tId === franchise.chosenTeamId) {
        _pushNews({ type:"coach_hire", label: `📝 DC ${staff.dc.name} renewed — $${staff.dc.salary}M/yr` });
      }
    }
    // HC on expired contract: chance to seek better situation unless champion
    if ((hc.contractYears ?? 1) === 0 && tId !== champId && Math.random() < 0.30) {
      const candidates = market.filter(c => c.type === "hc");
      if (candidates.length) {
        _coachFAAdd(hc, "hc");
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const depName = hc.name;
        staff.hc = { ...pick, yearsWithTeam: 0, record: { w:0, l:0, championships:0 } };
        delete staff.hc.type;
        for (const msg of _applyHcStaffSweep(staff, t.name)) _pushNews(msg);
        staff._chemistry = null;
        _pushNews({ type:"coach_depart",
          label: `🚪 ${t.name} HC ${depName} departs — contract expired` });
      }
    } else if ((hc.contractYears ?? 1) === 0) {
      _renewCoachAtMarket(staff.hc, "hc", 1.0);
      if (tId === franchise.chosenTeamId) {
        _pushNews({ type:"coach_hire", label: `📝 HC ${staff.hc.name} renewed — $${staff.hc.salary}M/yr` });
      }
    }
  }

  // ── User team: retirement checks ─────────────────────────────────────────────
  // AI carousel skips the user's team entirely, but coaches still age. Run a
  // separate retirement pass here and surface each event as an urgent news item
  // so the user knows they need to fill a vacancy.
  const _retireP = (age, isHC) => {
    if (age < 62) return 0;
    if (isHC) {
      if (age <= 65) return 0.04; if (age <= 69) return 0.12; if (age <= 73) return 0.28; return 0.50;
    } else {
      if (age <= 65) return 0.07; if (age <= 69) return 0.18; if (age <= 73) return 0.40; return 0.65;
    }
  };
  const uId    = franchise.chosenTeamId;
  const uStaff = franchise.coaches?.[uId];
  if (uStaff) {
    if (uStaff.hc) {
      const hcP = _retireP(uStaff.hc.age || 55, true)
        * (uId === champId ? 0.5 : 1)
        * ((uStaff.hc.rating || 60) >= 80 ? 0.7 : 1)
        * ((uStaff.hc.rating || 60) <= 50 ? 1.3 : 1);
      if (hcP > 0 && Math.random() < hcP) {
        _pushNews({ type:"coach_depart",
          label: `⚠️ YOUR HC ${uStaff.hc.name} has retired — HC vacancy on your staff, hire a replacement` });
        _coachFAAdd(uStaff.hc, "hc");
        uStaff.hc = null;
      }
    }
    if (uStaff.oc) {
      const ocP = _retireP(uStaff.oc.age || 45, false);
      if (ocP > 0 && Math.random() < ocP) {
        _pushNews({ type:"coach_depart",
          label: `⚠️ YOUR OC ${uStaff.oc.name} has retired — OC vacancy on your staff` });
        _coachFAAdd(uStaff.oc, "oc");
        if (uStaff._chemistry) uStaff._chemistry.qbOcBond = false;
        uStaff.oc = null;
      }
    }
    if (uStaff.dc) {
      const dcP = _retireP(uStaff.dc.age || 45, false);
      if (dcP > 0 && Math.random() < dcP) {
        _pushNews({ type:"coach_depart",
          label: `⚠️ YOUR DC ${uStaff.dc.name} has retired — DC vacancy on your staff` });
        _coachFAAdd(uStaff.dc, "dc");
        uStaff.dc = null;
      }
    }
  }

  // Age, grow, and retire position coaches for all teams, including user's.
  const _pcRetireProb = (age) =>
    age >= 72 ? 0.50 : age >= 65 ? 0.20 : age >= 60 ? 0.08 : 0;
  for (const t of TEAMS) {
    const pcStaff = franchise.coaches?.[t.id];
    if (!pcStaff?.positionStaff) continue;
    const isUser = t.id === franchise.chosenTeamId;
    pcStaff.positionStaff = pcStaff.positionStaff.filter(pc => {
      if (!pc.age) pc.age = 35 + Math.floor(Math.random() * 10);
      pc.age++;
      pc.yearsWithTeam = (pc.yearsWithTeam || 0) + 1;
      // Rating growth — slower at higher ratings
      if (!pc.rating) pc.rating = pc.tier === "Elite" ? 82 : pc.tier === "Good" ? 68 : 52;
      const growthChance = pc.rating < 65 ? 0.25 : pc.rating < 75 ? 0.18 : pc.rating < 82 ? 0.12 : 0.06;
      if (Math.random() < growthChance) {
        pc.rating = Math.min(90, pc.rating + 1);
        const newTier = _posCoachTierFromRating(pc.rating);
        if (newTier !== pc.tier) {
          pc.tier   = newTier;
          pc.salary = POSITION_COACH_TIERS[newTier].salary;
          if (isUser) _pushNews({ type:"coach_hire",
            label: `📈 Your ${pc.group} coach ${pc.name} has developed to ${newTier} tier (${pc.rating} rating)` });
        }
      }
      // Loyalty bond: 3+ years here stamps their home team
      if (pc.yearsWithTeam >= 3 && !pc.developedByTeamId) {
        pc.developedByTeamId = t.id;
      }
      const p = _pcRetireProb(pc.age);
      if (p > 0 && Math.random() < p) {
        if (isUser) _pushNews({ type:"coach_depart",
          label: `🎓 Your ${pc.group} coach ${pc.name} has retired (age ${pc.age}) — slot is open` });
        return false;
      }
      return true;
    });
  }
}

// Returns [primaryStatIdx, secondaryStatIdx] for OVR-growth stat allocation.
// Speed (0) and agility (2) are physical gifts excluded from coaching development.
function _devStatPool(pos, age) {
  switch (pos) {
    case "QB": return [4, 3];                                 // THR, AWR
    case "RB": return [5, age <= 26 ? 1 : 5];                // CAT, STR→CAT
    case "WR": return [5, 3];                                 // CAT, AWR
    case "TE": return [5, 6];                                 // CAT, BLK
    case "OL": return [6, age <= 27 ? 1 : 6];                // BLK, STR→BLK
    case "DL": return [7, age <= 27 ? 1 : 7];                // PRS, STR→PRS
    case "LB": return [9, Math.random() < 0.5 ? 8 : 7];     // TCK, COV/PRS
    case "CB": return [8, 3];                                 // COV, AWR
    case "S":  return [8, 9];                                 // COV, TCK
    default:   return [11, 11];                               // TEC only
  }
}

// At the end of each season, unlock accurate potential knowledge for:
//   active roster players (1 season = known)
//   practice squad players (2 seasons = known)
// Knowledge persists forever even if the player later leaves.
function _unlockSeasonKnowledge() {
  if (!franchise) return;
  const myId = franchise.chosenTeamId;
  franchise.knownPotentialPids = franchise.knownPotentialPids || [];
  franchise._psSeasons          = franchise._psSeasons         || {};
  const knownSet  = new Set(franchise.knownPotentialPids);
  const newlyKnown = [];

  for (const p of franchise.rosters[myId] || []) {
    if (!p.pid || knownSet.has(p.pid)) continue;
    knownSet.add(p.pid);
    newlyKnown.push(p);
  }

  for (const p of franchise.practiceSquads?.[myId] || []) {
    if (!p.pid || knownSet.has(p.pid)) continue;
    franchise._psSeasons[p.pid] = (franchise._psSeasons[p.pid] || 0) + 1;
    if (franchise._psSeasons[p.pid] >= 2) {
      knownSet.add(p.pid);
      newlyKnown.push(p);
    }
  }

  franchise.knownPotentialPids = [...knownSet];

  // Surface news items only for notable outcomes (HIGH CEILING / Bust risk)
  for (const p of newlyKnown) {
    const tag = potentialTag(p, { known: true });
    if (tag.includes("HIGH CEILING") || tag.includes("Bust risk")) {
      _pushNews({ type: "scout_reveal",
        label: `🔍 After a full season in your system, the read on ${p.name} is clear: ${tag}` });
    }
  }
}

function runFrnOffseason() {
  _unlockSeasonKnowledge();
  const changes  = [];
  const allNames = new Set();
  for (const r of Object.values(franchise.rosters)) r.forEach(p => allNames.add(p.name));

  for (const t of TEAMS) {
    const tId   = t.id;
    const roster = franchise.rosters[tId] || [];
    const keep   = [];
    const localNames = new Set(allNames);
    // Chemistry dev multiplier — reflects philosophy alignment built up over prior seasons.
    // Computed once per team per offseason; applied to all growth chances below.
    const chemBonus = _computeChemistryBonus(tId);

    // Coordinator rating → player dev: higher-rated OC lifts skill+OL positions,
    // higher-rated DC lifts defensive positions. Smooth ramp from 50→89 (0→+15%).
    // Elite HC (≥80) has a season-level 25% chance to amplify coord contributions 8%.
    const _tStaff     = franchise.coaches?.[tId] || {};
    const _ocDevBonus = Math.max(0, ((_tStaff.oc?.rating || 60) - 50) / 39 * 0.15);
    const _dcDevBonus = Math.max(0, ((_tStaff.dc?.rating || 60) - 50) / 39 * 0.15);
    const _hcCoordAmp = ((_tStaff.hc?.rating || 60) >= 80 && Math.random() < 0.25) ? 1.08 : 1.0;

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

      // Each player has a personal decline age — drawn from a normal
      // distribution per position. RBs decline early (high-contact),
      // QBs / K / P play longest. Iron-man tails still possible at any
      // position via the std-dev sampling.
      if (p.declineAge == null) {
        let u1 = Math.random(); if (u1 < 1e-10) u1 = 1e-10;
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
        const meanByPos = {
          RB: 28, WR: 30, TE: 30,
          QB: 33, OL: 31,
          DL: 30, LB: 30, CB: 30, S: 30,
          K: 36, P: 36,
        };
        const mean = meanByPos[p.position] ?? 30;
        p.declineAge = Math.max(25, Math.round(mean + 2 * z));
      }
      // Peak age — when growth stops but decline hasn't started. Between
      // peakAge and declineAge the player plateaus (no growth, no decay).
      // Position-aware: RBs peak earliest (25), QBs latest (28). Adds a
      // multi-year "in their prime" zone instead of an instant cliff.
      if (p.peakAge == null) {
        const peakByPos = {
          RB: 25, WR: 27, TE: 28,
          QB: 28, OL: 28,
          DL: 27, LB: 27, CB: 27, S: 27,
          K: 30, P: 30,
        };
        const basePeak = peakByPos[p.position] ?? 27;
        // Ensure peakAge < declineAge with at least a 2-year plateau.
        p.peakAge = Math.min(basePeak, Math.max(23, p.declineAge - 2));
      }
      if (p.age >= p.declineAge) {
        const yearsPast = p.age - p.declineAge;
        // Physical decay handled by _physicalPeak block below (SPD/AGI/STR).
        // This block adds a deeper STR chip for veterans well past their cliff.
        if (yearsPast >= 2 && Math.random() < 0.5) {
          p.stats[1] = Math.max(30, p.stats[1] - 1); // STR
        }
      }
      // Young progression: grow toward potential ceiling each offseason.
      // Hidden gems use a flat per-season rate toward their true ceiling;
      // normal players use the age-weighted percentage-of-gap approach.
      if (p.potential == null) p.potential = _rollPotential(p);
      let coachBoost = ((franchise.coaches?.[tId]?.hc?.specialtyTrait === "Player Developer"
                       || franchise.coaches?.[tId]?.hc?.trait === "Player Developer") ? 1.35 : 1.0)
                       * chemBonus.devMul;
      // Coachable trait: +25% growth from any coaching staff. Captures
      // real-world "high-floor player who maximizes the gift" — they
      // get more out of any coach.
      if (p.coachable) coachBoost *= 1.25;
      // Trade fresh-start boost: a player traded last season gets a
      // one-time growth amplifier next offseason (Tannehill / Stafford /
      // Mahomes-after-Smith arcs). Applies once, then clears.
      let tradeBoost = 1.0;
      if (p._tradedAtSeason != null && (franchise.season - p._tradedAtSeason) === 1) {
        tradeBoost = 1.20;
        delete p._tradedAtSeason; // one-time bonus
      }

      // Resolve gem ceiling — remove flag once reached
      if (p.hiddenGem && p.overall >= p.hiddenGem.ceiling) delete p.hiddenGem;

      if (p.hiddenGem && p.age <= 28) {
        p.potential = Math.max(p.potential, p.hiddenGem.ceiling);
        const growth = Math.max(0, Math.min(
          p.hiddenGem.ceiling - p.overall,
          Math.round(p.hiddenGem.growthRate * coachBoost * tradeBoost)
        ));
        if (growth > 0) {
          p.overall = Math.min(p.hiddenGem.ceiling, p.overall + growth);
          const [k1, k2] = _devStatPool(p.position, p.age);
          p.stats[k1] = Math.min(99, p.stats[k1] + Math.ceil(growth * 0.6));
          p.stats[k2] = Math.min(99, p.stats[k2] + Math.floor(growth * 0.4));
        }
        if (p.overall >= p.hiddenGem.ceiling) delete p.hiddenGem;
      } else if (!p.hiddenGem) {
        // Normal potential-based development. Peak-age plateau zone:
        // between peakAge and declineAge, players hold steady (no growth,
        // no decline). Growth resumes only for players who haven't
        // reached their peak.
        const gap = p.potential - p.overall;
        if (gap > 0 && p.age < (p.peakAge ?? 27) + 1) {
          const baseRate = p.age <= 22 ? 0.45 : p.age <= 24 ? 0.30 : p.age <= 26 ? 0.15 : 0.06;
          const growth = Math.max(0, Math.round(gap * baseRate * coachBoost * tradeBoost));
          if (growth > 0) {
            p.overall = Math.min(99, p.overall + growth);
            const [k1, k2] = _devStatPool(p.position, p.age);
            p.stats[k1] = Math.min(99, p.stats[k1] + Math.ceil(growth * 0.6));
            p.stats[k2] = Math.min(99, p.stats[k2] + Math.floor(growth * 0.4));
          }
        }
      }
      // Trade-boost news — only emit if applied AND player is on user's team
      if (tradeBoost > 1.0 && tId === franchise.chosenTeamId) {
        _pushNews({ type: "scout_reveal",
          label: `🔄 ${p.position} ${p.name} — fresh-start dev boost after trade` });
      }

      // Elite plateau — push decline age back for players who reach
      // OVR 90+ at age 28+. Position-specific so QB / K / P get the
      // biggest stretches and RBs barely any.
      if (typeof _maybeApplyElitePlateauBump === "function") {
        _maybeApplyElitePlateauBump(p);
      }

      // Rehab decay — restore OVR for players still recovering from a
      // structural injury last season. Spreads the lost OVR back over
      // 1-2 seasons so a torn ACL doesn't permanently nuke a career.
      if ((p._rehabRestore || 0) > 0 && (p._rehabSeasons || 0) > 0) {
        const restore = Math.ceil(p._rehabRestore / p._rehabSeasons);
        p.overall = Math.min(99, (p.overall || 60) + restore);
        p._rehabRestore -= restore;
        p._rehabSeasons -= 1;
        if (p._rehabRestore <= 0 || p._rehabSeasons <= 0) {
          delete p._rehabRestore; delete p._rehabSeasons;
          if (tId === franchise.chosenTeamId) {
            _pushNews({ type:"scout_reveal",
              label: `✅ ${p.position} ${p.name} — fully recovered, back to peak form` });
          }
        }
      }

      // Veteran resurgence — late-career renaissance for 30+ players who
      // haven't hit decline yet. Rare for average vets; significantly
      // amplified for elite (88+) vets who model real "Brady-at-40"
      // sustained-prime arcs.
      if (!p.hiddenGem && p.age >= 30 && p.age <= 42 && !preDeclineHit && (p.overall || 0) < 99) {
        const isElite = (p.overall || 0) >= 88;
        const surgeOdds = isElite
          ? (coachBoost > 1.0 ? 0.18 : 0.10)
          : (coachBoost > 1.0 ? 0.06 : 0.025);
        if (Math.random() < surgeOdds) {
          const surge = 1 + Math.floor(Math.random() * 2);
          p.overall = Math.min(99, p.overall + surge);
          if (p.stats) {
            const [k1, k2] = _devStatPool(p.position, p.age);
            p.stats[k1] = Math.min(99, p.stats[k1] + Math.ceil(surge * 0.6));
            p.stats[k2] = Math.min(99, p.stats[k2] + Math.floor(surge * 0.4));
          }
          if (tId === franchise.chosenTeamId) {
            _pushNews({ type: "scout_reveal",
              label: `📈 ${p.position} ${p.name} — ${isElite ? "elite form sustained" : "late-career resurgence"} (+${surge} OVR)` });
          }
        }
      }

      // TEC (technique) — position staff quality + HC specialty drive growth.
      // Age 30+ mechanics calcify and start to slip.
      if (p.stats) {
        const curTec = p.stats[11] ?? 68;
        const posStaff    = franchise.coaches?.[tId]?.positionStaff || [];
        const hcSpecialty = franchise.coaches?.[tId]?.hc?.specialtyTrait
                         || (franchise.coaches?.[tId]?.hc?.trait === "Player Developer" ? "Player Developer" : null);
        const ocTrait     = franchise.coaches?.[tId]?.oc?.trait;
        const dcTrait     = franchise.coaches?.[tId]?.dc?.trait;
        const hcDevMul    = (hcSpecialty === "Player Developer" ? 1.35 : 1.0) * chemBonus.devMul * _coachBudgetPenaltyMul(tId);

        const pGroup = p.position === "QB" ? "QB"
                     : p.position === "OL" ? "OL"
                     : ["WR","TE","RB"].includes(p.position) ? "Skill"
                     : p.position === "DL" ? "DL"
                     : ["LB","CB","S"].includes(p.position) ? "LB/DB" : null;
        const staffCoach = pGroup ? posStaff.find(s => s.group === pGroup) : null;
        const tierInfo   = staffCoach ? POSITION_COACH_TIERS[staffCoach.tier] : POSITION_COACH_TIERS["Journeyman"];
        const isOffPos    = ["QB","WR","RB","TE","OL"].includes(p.position);
        const isDefPos    = ["DL","LB","CB","S"].includes(p.position);
        const filmMul     = (dcTrait === "Film Mastermind" && isDefPos) ? (p.coachable ? 2.0 : 1.2) : 1.0;
        const coordDevMul = isOffPos ? (1 + _ocDevBonus * _hcCoordAmp)
                          : isDefPos ? (1 + _dcDevBonus * _hcCoordAmp)
                          : 1.0;
        const tecMul      = tierInfo.tecMul * hcDevMul * filmMul * coordDevMul;
        const effectiveTecMul = Math.min(5.0,
          // OC developer bonuses
          (p.position === "QB" && ocTrait === "QB Whisperer")    ? tecMul * 2.0 :
          (p.position === "OL" && ocTrait === "Trench General")   ? tecMul * 2.0 :
          (p.position === "RB" && ocTrait === "Run Architect")    ? tecMul * 1.5 :
          (p.position === "WR" && ocTrait === "Air Attack")       ? tecMul * 1.5 :
          (p.position === "TE" && ocTrait === "Air Attack")       ? tecMul * 1.3 :
          (p.position === "TE" && ocTrait === "Red Zone Genius")  ? tecMul * 1.5 :
          (p.position === "RB" && ocTrait === "Red Zone Genius")  ? tecMul * 1.2 :
          // DC developer bonuses
          (p.position === "DL" && dcTrait === "Pressure Package") ? tecMul * 1.5 :
          (p.position === "DL" && dcTrait === "Run Stopper")      ? tecMul * 1.2 :
          (p.position === "LB" && dcTrait === "Run Stopper")      ? tecMul * 1.3 :
          (p.position === "CB" && dcTrait === "Ball Hawk")        ? tecMul * 1.5 :
          (p.position === "S"  && dcTrait === "Ball Hawk")        ? tecMul * 1.3 :
          (p.position === "S"  && dcTrait === "Cover Scheme")     ? tecMul * 1.5 :
          (p.position === "LB" && dcTrait === "Cover Scheme")     ? tecMul * 1.3 : tecMul);

        const baseChance = 0.12;
        if ((p.age || 25) <= 30 && Math.random() < baseChance * effectiveTecMul) {
          const gain = 1 + Math.floor(Math.random() * 3);
          p.stats[11] = Math.min(99, curTec + gain);
          if (staffCoach?.tier === "Elite") {
            p._tecCeiling = Math.min(99, (p._tecCeiling || 90) + (tierInfo.tecCeilingBonus || 0));
          }
          p._tecOvrAccum = (p._tecOvrAccum || 0) + 0.15 * gain;
          if (p._tecOvrAccum >= 1.0) {
            p.overall = Math.min(99, (p.overall || 60) + 1);
            p._tecOvrAccum -= 1.0;
          }
        } else if ((p.age || 25) >= 30 && Math.random() < (p.coachable ? 0.12 : 0.25)) {
          // Coachable players halve their TEC decline rate (12% vs 25%).
          // Mental side of the game preserves longer for high-IQ players.
          p.stats[11] = Math.max(40, curTec - 1);
          p._tecOvrAccum = (p._tecOvrAccum || 0) - 0.15;
          if (p._tecOvrAccum <= -1.0) {
            p.overall = Math.max(40, (p.overall || 60) - 1);
            p._tecOvrAccum += 1.0;
          }
        }
        // OC QB Whisperer raises QB AWR ceiling
        if (p.position === "QB" && ocTrait === "QB Whisperer") {
          p._awrCeiling = Math.min(99, (p._awrCeiling || 80) + 5);
        }
      }

      // Physical decline — SPD/AGI/STR scale with years past each stat's onset age.
      // Pre-peak players have a small growth window. K/P excluded (stats irrelevant).
      if (p.position !== "K" && p.position !== "P" && p._physicalPeak && p.stats) {
        const age = p.age || 25;
        const pp  = p._physicalPeak;
        const _dc = (onset) => {
          const yrs = age - onset;
          return yrs <= 0 ? 0 : yrs === 1 ? 0.20 : yrs === 2 ? 0.30 : 0.40;
        };
        // SPD (0) — genetic; only very slow players see tiny pre-peak gains
        const spdD = _dc(pp.spd.onset);
        if      (spdD > 0 && Math.random() < spdD)                              p.stats[0] = Math.max(38, p.stats[0] - 1);
        else if (age < pp.spd.peak && p.stats[0] < 58 && Math.random() < 0.08) p.stats[0] = Math.min(57, p.stats[0] + 1);
        // STR (1) — weight room gains; grows until peak, fades after onset
        const strD = _dc(pp.str.onset);
        if      (strD > 0 && Math.random() < strD)          p.stats[1] = Math.max(38, p.stats[1] - 1);
        else if (age < pp.str.peak && Math.random() < 0.05) p.stats[1] = Math.min(99, p.stats[1] + 1);
        // AGI (2) — genetic; only very low-agility players see tiny pre-peak gains
        const agiD = _dc(pp.agi.onset);
        if      (agiD > 0 && Math.random() < agiD)                              p.stats[2] = Math.max(36, p.stats[2] - 1);
        else if (age < pp.agi.peak && p.stats[2] < 58 && Math.random() < 0.07) p.stats[2] = Math.min(57, p.stats[2] + 1);
        // Recalculate overall to reflect physical changes
        p.overall = calcOverall(p.position, p.stats);
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
      const hcCulture = franchise.coaches?.[tId]?.hc?.cultureTrait
                     || (franchise.coaches?.[tId]?.hc?.trait === "Hard-Ass" ? "Disciplinarian"
                       : franchise.coaches?.[tId]?.hc?.trait === "Players' Coach" ? "Players' Coach" : null);
      const stayBoost = hcCulture === "Players' Coach" ? 0.15
                      : hcCulture === "Disciplinarian" ? -0.10 : 0;
      for (const p of keep) {
        if (p.contract && p.contract.remaining <= 0) {
          let stayProb = p.overall >= 85 ? 0.85 : p.overall >= 75 ? 0.70 : 0.55;
          stayProb = Math.min(0.98, stayProb + stayBoost);
          // QB-OC bond: young QB bonded with QB Whisperer OC has strong pull to stay
          if (p.position === "QB" && franchise.coaches?.[tId]?._chemistry?.qbOcBond === p.name) {
            stayProb = Math.min(0.98, stayProb + 0.25);
          }
          if (Math.random() < stayProb) {
            p.contract = generateContract(p, franchise.salaryCap || SALARY_CAP_BASE);
          } else {
            // Declined — give a minimum deal so they don't disappear
            p.contract = { years: 1, remaining: 1, aav: 0.5, signedAav: 0.5 };
          }
        }
      }
    }

    franchise.rosters[tId] = keep;

    // Increment system familiarity for players staying with the team.
    for (const p of keep) p.systemYears = (p.systemYears || 0) + 1;

    // Practice squad development — they get coaching and install reps but
    // no live game action, so growth is 60% of the active-roster rate.
    // Gems still develop (this is exactly why teams stash them there), but
    // their progress stays off-radar: no wire alerts until promotion.
    const PS_DEV_MULT = 0.6;
    const psSquad = franchise.practiceSquads?.[tId] || [];
    for (const p of psSquad) {
      if (p.age == null) {
        p.age = (p.overall >= 85 ? 27 : p.overall >= 75 ? 24 : 22) + Math.floor(Math.random() * 6);
      }
      // Stamp declineAge now so it's ready when they're activated; PS players
      // don't take the stat-decay hit since they aren't playing meaningful snaps.
      if (p.declineAge == null) {
        let u1 = Math.random(); if (u1 < 1e-10) u1 = 1e-10;
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
        p.declineAge = Math.max(25, Math.round(30 + 2 * z));
      }
      if (p.potential == null) p.potential = _rollPotential(p);
      const psHcSpecialty = franchise.coaches?.[tId]?.hc?.specialtyTrait
                          || franchise.coaches?.[tId]?.hc?.trait;
      const psCoachBoost = (psHcSpecialty === "Player Developer" ? 1.35 : 1.0) * chemBonus.devMul;

      if (p.hiddenGem && p.overall >= p.hiddenGem.ceiling) delete p.hiddenGem;

      if (p.hiddenGem && p.age <= 28) {
        p.potential = Math.max(p.potential, p.hiddenGem.ceiling);
        const growth = Math.max(0, Math.min(
          p.hiddenGem.ceiling - p.overall,
          Math.round(p.hiddenGem.growthRate * psCoachBoost * PS_DEV_MULT)
        ));
        if (growth > 0) {
          p.overall = Math.min(p.hiddenGem.ceiling, p.overall + growth);
          const [k1, k2] = _devStatPool(p.position, p.age);
          p.stats[k1] = Math.min(99, p.stats[k1] + Math.ceil(growth * 0.6));
          p.stats[k2] = Math.min(99, p.stats[k2] + Math.floor(growth * 0.4));
        }
        if (p.overall >= p.hiddenGem.ceiling) delete p.hiddenGem;
      } else if (!p.hiddenGem) {
        const gap = p.potential - p.overall;
        if (gap > 0 && p.age <= 27) {
          const baseRate = p.age <= 22 ? 0.45 : p.age <= 24 ? 0.30 : p.age <= 26 ? 0.15 : 0.06;
          const growth = Math.max(0, Math.round(gap * baseRate * psCoachBoost * PS_DEV_MULT));
          if (growth > 0) {
            p.overall = Math.min(99, p.overall + growth);
            const [k1, k2] = _devStatPool(p.position, p.age);
            p.stats[k1] = Math.min(99, p.stats[k1] + Math.ceil(growth * 0.6));
            p.stats[k2] = Math.min(99, p.stats[k2] + Math.floor(growth * 0.4));
          }
        }
      }
    }
  }
  // Age chemistry state now that all dev + staff changes for this offseason are settled.
  // New alignment/friction counts take effect starting next season.
  _updateChemistryState();
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
    ${(() => {
      const list     = franchise._holdouts || [];
      const hasAny   = list.length > 0;
      const pending  = list.filter(h => !h.resolved).length;
      const decided  = list.length - pending;
      const extended = list.filter(h => h.resolved === "extended").length;
      const traded   = list.filter(h => h.resolved === "trade-block").length;
      const ignored  = list.filter(h => h.resolved === "ignored").length;

      // Subtitle / CTA shape depends on whether there are demands at all.
      let title, sub, cta;
      if (!hasAny) {
        title = "READY TO DRAFT?";
        sub   = "All offseason changes settled. The draft is up next.";
        cta   = `<button class="btn btn-gold-big" onclick="frnConfirmGoToDraft()">📋 Go to Draft →</button>`;
      } else if (pending > 0) {
        title = "READY TO ADVANCE?";
        const chips = [
          `<span class="chip green">✓ ${extended} extended</span>`,
          traded  ? `<span class="chip gold">🔀 ${traded} traded</span>` : "",
          ignored ? `<span class="chip red">✗ ${ignored} ignored</span>` : "",
          `<span class="chip neutral">${pending} pending</span>`,
        ].filter(Boolean).join("");
        sub = `<div style="display:flex;gap:.35rem;justify-content:center;flex-wrap:wrap;margin-bottom:.35rem">${chips}</div>
               <div style="color:#e8a000;font-size:.7rem">⚠ Proceeding will defer ${pending===1?"this demand":"these demands"} to next season as ${pending===1?"a flight risk":"flight risks"}.</div>`;
        cta = `<button class="btn btn-gold-big" onclick="frnOpenHoldoutRecap()">📋 Review &amp; Continue to Draft →</button>`;
      } else {
        title = "READY TO ADVANCE?";
        const chips = [
          extended ? `<span class="chip green">✓ ${extended} extended</span>` : "",
          traded   ? `<span class="chip gold">🔀 ${traded} traded</span>` : "",
          ignored  ? `<span class="chip red">✗ ${ignored} ignored</span>` : "",
        ].filter(Boolean).join("");
        sub = `<div style="display:flex;gap:.35rem;justify-content:center;flex-wrap:wrap">${chips}</div>`;
        cta = `<button class="btn btn-gold-big" onclick="frnOpenHoldoutRecap()">📋 Review &amp; Continue to Draft →</button>`;
      }

      return `<div class="frn-off-footer">
        <div class="frn-off-footer-title">${title}</div>
        <div class="frn-off-footer-sub">${sub}</div>
        <div class="frn-off-footer-cta">${cta}</div>
        <button class="frn-off-footer-abandon" onclick="frnAbandon()">× Abandon franchise</button>
      </div>`;
    })()}`;
}

// Migrate pre-existing holdout objects (created before the T1+T2 rebuild)
// to the new shape so old saves don't crash on the new UI.
function _migrateHoldoutShape(list) {
  if (!list || !list.length) return;
  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId] || [];
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  for (const h of list) {
    if (!h) continue;
    const live = myRoster.find(p => p.name === h.name);
    if (h.marketAAV == null)        h.marketAAV = h.demandedAAV;
    if (h.offer == null)            h.offer = h.demandedAAV;
    if (h.offerYears == null)       h.offerYears = h.demandedYears;
    if (h.structure == null)        h.structure = _defaultStructure(live?.age || 27, live?.overall || 70);
    if (h.overall == null)          h.overall = live?.overall ?? 70;
    if (h.age == null)              h.age = live?.age ?? 27;
    if (h.currentRemaining == null) h.currentRemaining = live?.contract?.remaining ?? 1;
  }
}

function _renderHoldoutsBlock() {
  const list = franchise._holdouts || [];
  if (!list.length) return "";
  _migrateHoldoutShape(list);
  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId] || [];
  const cap = effectiveSalaryCap(myId);

  const _statLine = name => {
    const agg = _playerSeasonStatsAgg(name);
    return agg ? mvpStatLine(agg) : "";
  };

  const rowFor = (h) => {
    const escName = (h.name||"").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const live = myRoster.find(p => p.name === h.name);
    const ovr = live?.overall ?? h.overall ?? 70;
    const age = live?.age ?? h.age ?? "?";

    // ── Locked / completed decision → collapsed strip ──────────────
    if (h.resolved) {
      const labels = {
        "extended":    { cls: "accepted", lbl: `<span style="color:var(--green-lt);font-weight:700">✓ EXTENDED</span> · $${(h.offer||h.demandedAAV).toFixed(1)}M × ${(h.offerYears||h.demandedYears)}yr` },
        "trade-block": { cls: "tagged",   lbl: `<span style="color:var(--gold);font-weight:700">🔀 TRADE BLOCK</span> · ${_holdoutTradeValue(h, live)}` },
        "ignored":     { cls: "declined", lbl: `<span style="color:#ff8a8a;font-weight:700">✗ IGNORED</span> · flight risk` },
      };
      const spec = labels[h.resolved] || { cls: "", lbl: h.resolved };
      return `<div class="frn-resign-collapsed ${spec.cls}"
           onclick="frnHoldoutReopen('${escName}')" title="Click to reopen">
        <span class="name">${h.name}</span>
        <span class="meta">${h.position} · ${ovr} OVR · Age ${age}</span>
        <span class="decision">${spec.lbl}</span>
        <span class="reopen">↻ Reopen</span>
      </div>`;
    }

    const struct = h.structure || "BALANCED";
    const offer  = h.offer ?? h.demandedAAV;
    const offerYears = h.offerYears ?? h.demandedYears;
    const { bonusProration } = _signingBonusCalc(offer, offerYears, ovr);
    const deadTotal = bonusProration * offerYears;

    // ── Year-by-year preview before signing ────────────────────────
    if (_holdoutPreview === h.name) {
      const bases = _baseSalarySchedule(offer, offerYears, struct, bonusProration);
      const yearPills = bases.map((base, i) => {
        const hit = Math.round((base + bonusProration) * 10) / 10;
        return `<div style="display:flex;justify-content:space-between;padding:.18rem .4rem;border-radius:4px;background:var(--bg3);font-size:.67rem;gap:.8rem">
          <span style="color:var(--gray)">Yr ${i+1}</span>
          <span>$${base.toFixed(1)}M base</span>
          <span style="color:var(--gray)">+$${bonusProration.toFixed(1)}M bonus</span>
          <span style="color:var(--gold);font-weight:700">= $${hit.toFixed(1)}M</span>
        </div>`;
      }).join("");
      return `<div class="frn-resign-row" style="border-color:var(--gold);background:rgba(200,169,0,.07)">
        <div class="frn-resign-info">
          <span style="font-weight:700;color:var(--gold)">${h.name}</span>
          <span style="color:var(--gray);font-size:.7rem">${h.position} · ${ovr} OVR · Age ${age}</span>
          <span style="font-size:.6rem;color:var(--gray);margin-top:.1rem">${struct} · $${offer.toFixed(1)}M/yr · ${offerYears}yr</span>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:.2rem;margin:0 .6rem">${yearPills}</div>
        <div class="frn-resign-btns" style="flex-direction:column;gap:.3rem">
          ${deadTotal >= 0.5 ? `<span style="color:#ff9090;font-size:.6rem;text-align:center">☠ Dead $${bonusProration.toFixed(1)}M×${offerYears}yr</span>` : ""}
          <button class="btn btn-gold" onclick="frnHoldoutExtend('${escName}')" style="white-space:nowrap">✓ Sign Extension</button>
          <button class="btn btn-outline" onclick="frnHoldoutPreviewClose()" style="font-size:.65rem">← Back</button>
        </div>
      </div>`;
    }

    const trend = _ovrTrend(live);
    const trendHtml = trend == null ? "" : trend > 0
      ? `<span style="color:var(--green-lt);font-size:.6rem">↑ +${trend} OVR</span>`
      : trend < 0 ? `<span style="color:var(--red);font-size:.6rem">↓ ${trend} OVR</span>`
      : `<span style="color:var(--gray);font-size:.6rem">→ flat</span>`;
    const curve = _ageCurveWarning(age === "?" ? null : age, offerYears);
    const depth = _posDepth(h.position, h.name);
    const faMkt = _faMktDepth(h.position);
    const yrsWith = _yearsWithTeam(h.name);
    const isProne = typeof _isInjuryProne === "function" && _isInjuryProne(live);

    // ── Recommendation chip ────────────────────────────────────────
    const rec = _holdoutRecommendation(h, depth, faMkt, curve, isProne, trend);
    const recChip = `<div class="frn-resign-rec" style="border-color:${rec.color};color:${rec.color}">
      <span class="action">${rec.action}</span>
      <span class="reason">${rec.reason}</span>
    </div>`;

    // ── Risk badges ────────────────────────────────────────────────
    const risks = _resignRiskBadges(live, { overall: ovr }, curve, trend);
    const riskHtml = risks.map(b =>
      `<span class="frn-resign-risk" style="color:${b.color};border-color:${b.color}55">${b.label}</span>`
    ).join("");

    // ── Demand line + accept odds ──────────────────────────────────
    const odds = _holdoutAcceptOdds(offer, offerYears, h.demandedAAV, h.demandedYears);
    const oddsColor = odds >= 0.85 ? "var(--green-lt)" : odds >= 0.5 ? "#e8a000" : "#ff8a8a";
    const demandHtml = `<div class="frn-resign-demand">
      <span class="lbl">Wants</span>
      <span class="num">$${h.demandedAAV.toFixed(1)}M × ${h.demandedYears}yr</span>
      <span class="lbl" style="margin-left:.5rem">Currently</span>
      <span class="num" style="color:var(--gray)">$${h.currentAAV.toFixed(1)}M</span>
      <span class="lbl" style="margin-left:.5rem">Accept odds</span>
      <span class="num" style="color:${oddsColor}">${Math.round(odds * 100)}%</span>
    </div>`;

    const tradeVal = _holdoutTradeValue(h, live);

    // ── Meta line ──────────────────────────────────────────────────
    const metaBits = [];
    metaBits.push(`${depth} other ${h.position} ≥75 OVR`);
    if (faMkt > 0) metaBits.push(`${faMkt} FA${h.position}s avail`);
    if (yrsWith >= 1) metaBits.push(`${yrsWith}-yr veteran`);
    metaBits.push(`${h.currentRemaining}yr left on current deal`);
    const metaHtml = `<div class="frn-resign-meta">${metaBits.join(" · ")}</div>`;

    return `<div class="frn-resign-row tier-${_holdoutTier(h)}">
      ${recChip}
      <div class="frn-resign-row-inner">
        <div class="frn-resign-info">
          <span style="font-weight:700;color:var(--white);font-size:.95rem">${h.name}</span>
          <span style="color:var(--gray);font-size:.7rem">${h.position} · ${ovr} OVR ${trendHtml} · Age ${age}</span>
          ${_statLine(h.name) ? `<span style="color:var(--gray);font-size:.6rem;font-style:italic">${_statLine(h.name)}</span>` : ""}
          ${riskHtml ? `<div class="frn-resign-risks">${riskHtml}</div>` : ""}
          ${_contractContextBar(h.position, h.marketAAV, cap)}
          ${demandHtml}
          ${metaHtml}
        </div>
        <div class="frn-resign-offer">
          <span style="color:${offer > h.marketAAV * 1.1 ? 'var(--red)' : offer < h.marketAAV * 0.9 ? 'var(--green-lt)' : 'var(--gold)'};font-weight:700">$${offer.toFixed(1)}M/yr ${vsMarketCell(offer, h.marketAAV)}</span>
          <div style="display:flex;align-items:center;gap:.25rem;justify-content:flex-end;margin-top:.15rem">
            <button class="frn-resign-yrbtn"
              ${offerYears <= _HOLDOUT_MIN_YEARS ? "disabled" : ""}
              onclick="frnHoldoutAdjustYears('${escName}', -1)">−</button>
            <span style="color:var(--gray);font-size:.7rem;min-width:2.5rem;text-align:center">${offerYears} yr</span>
            <button class="frn-resign-yrbtn"
              ${offerYears >= _HOLDOUT_MAX_YEARS ? "disabled" : ""}
              onclick="frnHoldoutAdjustYears('${escName}', 1)">+</button>
          </div>
          <span style="color:var(--gray);font-size:.6rem;text-align:right">total $${(offer * offerYears).toFixed(1)}M</span>
          ${deadTotal < 0.5
            ? `<span style="color:var(--gray);font-size:.6rem">No dead cap</span>`
            : `<span style="color:#ff9090;font-size:.6rem;text-align:right" title="Prorated signing bonus — counts as dead cap if you release this player.">☠ Dead $${bonusProration.toFixed(1)}M×${offerYears}yr = $${deadTotal.toFixed(1)}M</span>`}
          <div style="display:flex;gap:.2rem;justify-content:flex-end;margin-top:.25rem;align-items:center;flex-wrap:wrap">
            <span style="color:var(--gray);font-size:.58rem">Structure:</span>
            ${["BALANCED","BACKLOADED","FRONTLOADED"].map(s => {
              const desc = s==="BALANCED"?"flat salaries":s==="BACKLOADED"?"cheap now, costly later":"costly now, cheap later";
              return `<button class="btn ${struct===s?"btn-gold":"btn-outline"}" onclick="frnHoldoutSetStructure('${escName}','${s}')" style="font-size:.55rem;padding:.1rem .3rem" title="${desc}">${s[0]+s.slice(1).toLowerCase()}</button>`;
            }).join("")}
          </div>
        </div>
        <div class="frn-resign-btns">
          <button class="btn frn-resign-btn accept-btn" onclick="frnHoldoutPreview('${escName}')">Review &amp; Extend</button>
          ${odds < 0.85 ? `<button class="btn frn-resign-btn accept-btn" style="border-color:var(--gold-lt);color:var(--gold-lt)" onclick="frnHoldoutCounter('${escName}')" title="Drop offer to 95% of demand">↻ Counter</button>` : ""}
          <button class="btn frn-resign-btn" style="border-color:var(--gold);color:var(--gold)" onclick="frnHoldoutTrade('${escName}')" title="Flip him for assets">🔀 Trade<span style="font-size:.5rem;display:block;color:var(--gold-lt)">${tradeVal}</span></button>
          <button class="btn frn-resign-btn decline-btn" onclick="frnHoldoutIgnore('${escName}')" title="Player becomes a flight risk — likely walks at expiry">✗ Ignore<span style="font-size:.5rem;display:block;color:#ff9090">flight risk</span></button>
        </div>
      </div>
    </div>`;
  };

  // Group by tier so foundation stars sit at top
  const byTier = { foundation: [], starter: [], depth: [] };
  for (const h of list) byTier[_holdoutTier(h)].push(h);

  const sectionFor = (title, rows, eyebrow) => {
    if (!rows.length) return "";
    return `<section class="frn-resign-section">
      <div class="frn-resign-section-head">
        <span class="title">${title}</span>
        <span class="eyebrow">${eyebrow} · ${rows.length} player${rows.length===1?"":"s"}</span>
      </div>
      <div class="frn-resign-list">${rows.map(rowFor).join("")}</div>
    </section>`;
  };

  const sections = [
    sectionFor("⭐ Foundation Demands", byTier.foundation, "90+ OVR · franchise cornerstones"),
    sectionFor("🛡 Key Starter Demands", byTier.starter,   "85–89 OVR"),
    sectionFor("📋 Role Player Demands", byTier.depth,     "82–84 OVR"),
  ].join("");

  // Hero stats
  const extended = list.filter(h => h.resolved === "extended").length;
  const traded   = list.filter(h => h.resolved === "trade-block").length;
  const ignored  = list.filter(h => h.resolved === "ignored").length;
  const pending  = list.filter(h => !h.resolved).length;
  const decided  = extended + traded + ignored;
  const proj = _holdoutCapProjection(4);
  const projHtml = `<div class="frn-resign-cap-timeline">
    ${proj.map((v, i) => {
      const pct = Math.min(100, (v / Math.max(1, cap)) * 100);
      const color = v > cap ? "var(--red)" : v > cap * 0.90 ? "#e8a000" : "var(--green-lt)";
      return `<div class="frn-resign-cap-year">
        <div class="lbl">Y${i+1}</div>
        <div class="bar"><div class="fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="num" style="color:${color}">$${v.toFixed(0)}M</div>
      </div>`;
    }).join("")}
  </div>`;

  const heroSub = pending
    ? `${pending} demand${pending===1?"":"s"} need${pending===1?"s":""} a decision`
    : `All demands resolved`;

  return `
    <div class="frn-holdouts-block">
      <div class="frn-resign-hero" style="margin-top:1.2rem">
        <div class="frn-resign-hero-eyebrow">CONTRACT DEMANDS</div>
        <h1 class="frn-resign-hero-title" style="font-size:1.4rem">🗣 ${list.length} STAR${list.length===1?"":"S"} DEMANDING EXTENSION${list.length===1?"":"S"}</h1>
        <div class="frn-resign-hero-sub">${heroSub}</div>
        <div class="frn-resign-hero-progress">
          <span class="chip green">✓ ${extended} extended</span>
          ${traded?`<span class="chip gold">🔀 ${traded} traded</span>`:""}
          ${ignored?`<span class="chip red">✗ ${ignored} ignored</span>`:""}
          <span class="chip neutral">${pending} pending</span>
        </div>
      </div>

      <div class="frn-resign-cap-wrap">
        <div class="frn-resign-cap-title">📊 PROJECTED CAP — NEXT 4 SEASONS</div>
        ${projHtml}
        <div class="frn-resign-cap-note">Includes extended demands (replaces their current contract).</div>
      </div>

      ${sections}
    </div>`;
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
  franchise._mergedGameKeys = {};
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
  // Comp picks land at the end of their round, so they're worth a touch
  // less than a regular pick in the same round (≈80% of round value).
  const base = PICK_VALUE_BY_ROUND[pick.round] || 1;
  return pick.isComp ? Math.max(1, Math.round(base * 0.80)) : base;
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
  // 1. Non-linear OVR curve: top-end talent compresses, so the gap
  //    between OVR 95 and 99 is way bigger than 75 and 80.
  const ovrBase = Math.pow(Math.max(0, (p.overall || 60) - 50), 1.5) / 4;
  // 2. Position scarcity multiplier — QBs / pass rushers / blindside
  //    tackles cost more than RBs / kickers / punters.
  const posMul = POSITION_CHIP_MULT[p.position] || 1.0;
  // 3. Position-aware age curve: RBs cliff at 28, QBs play to 38.
  const ageMul = _ageCurveForPos(p.age || 27, p.position);
  // 4. Contract surplus or anchor — what's the player's actual deal
  //    relative to market. Rookie-deal stars carry massive surplus.
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const market = (typeof computeMarketValue === "function") ? computeMarketValue(p, cap) : (p.contract?.aav || 1);
  const remaining = p.contract?.remaining || 0;
  const surplusPerYr = market - (p.contract?.aav || 0);
  const contractDelta = surplusPerYr * remaining * 0.6;   // cap-$ → trade points
  // 5. Years-remaining bonus — more team control = more value.
  const yrsMul = remaining === 0 ? 0.5
    : remaining === 1 ? 0.85
    : remaining === 2 ? 0.95
    : remaining >= 4 ? 1.10
    : 1.0;
  // 6. Injury haircut.
  const injMul = (p.injury?.weeksRemaining > 0) ? 0.4 : 1.0;
  const v = (ovrBase * posMul * ageMul * yrsMul + contractDelta) * injMul;
  return Math.max(0.5, Math.round(v * 10) / 10);
}

// Trade-chip scarcity. Distinct from CAP_POS_RATE (which prices
// salaries) because some positions are worth more on the open market
// than their cap weight implies — e.g. a young franchise QB or
// premier edge rusher is rarely available at any price.
const POSITION_CHIP_MULT = {
  QB: 1.80, OL: 1.20, DL: 1.15, CB: 1.10,
  WR: 1.05, LB: 1.00, TE: 0.95, S:  0.95,
  RB: 0.80, K:  0.45, P:  0.45,
};

// Position-specific age curves. Returns a 0..1.10 multiplier vs prime.
function _ageCurveForPos(age, pos) {
  const peaks = {
    QB:  { peakLo: 26, peakHi: 35, decline: 0.04 },
    RB:  { peakLo: 22, peakHi: 27, decline: 0.10 },
    WR:  { peakLo: 24, peakHi: 30, decline: 0.06 },
    TE:  { peakLo: 25, peakHi: 31, decline: 0.06 },
    OL:  { peakLo: 26, peakHi: 32, decline: 0.04 },
    DL:  { peakLo: 24, peakHi: 30, decline: 0.06 },
    LB:  { peakLo: 23, peakHi: 29, decline: 0.07 },
    CB:  { peakLo: 23, peakHi: 29, decline: 0.08 },
    S:   { peakLo: 24, peakHi: 30, decline: 0.07 },
    K:   { peakLo: 25, peakHi: 38, decline: 0.02 },
    P:   { peakLo: 25, peakHi: 38, decline: 0.02 },
  };
  const p = peaks[pos] || { peakLo: 24, peakHi: 30, decline: 0.07 };
  if (age >= p.peakLo && age <= p.peakHi) return 1.0;
  if (age < p.peakLo) {
    // Young player approaching peak — 22yo gets ~0.92, peak gets 1.0
    const undershoot = p.peakLo - age;
    return Math.max(0.85, 1.0 - undershoot * 0.025);
  }
  const yearsPast = age - p.peakHi;
  return Math.max(0.30, 1.0 - yearsPast * p.decline);
}

// A team's stance on each of its own players: untouchable (won't move
// for any price), shopping (would deal at favorable ratio), or
// available (standard market). Computed on demand from roster + age
// + contract + draft pedigree; no per-team state required.
function _aiTeamPlayerStance(teamId, p) {
  const roster = franchise.rosters[teamId] || [];
  const sameByOvr = roster.filter(rp => rp.position === p.position)
    .sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const rank = sameByOvr.indexOf(p) + 1;  // 1 = top-of-position

  // FRANCHISE FACE — top of position + young / mid-career + on contract
  // at a premium position. These guys are not for sale at any price.
  const FRANCHISE_FACE_POS = new Set(["QB","DL","CB","OL","WR"]);
  const ovr = p.overall || 0;
  const age = p.age || 30;
  const yrsLeft = p.contract?.remaining || 0;
  if (rank === 1 && ovr >= 88 && age <= 30 && yrsLeft >= 1 && FRANCHISE_FACE_POS.has(p.position)) {
    return "untouchable";
  }
  // RECENT HIGH PICK — last two drafts, first round, still developing.
  if (p.draftRound === 1 && p.draftYear &&
      (franchise.season + new Date().getFullYear() - 1 - p.draftYear) <= 2 &&
      age <= 25) {
    return "untouchable";
  }

  // SHOPPING — aging, overpaid, redundant, or contract anchor.
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const market = (typeof computeMarketValue === "function") ? computeMarketValue(p, cap) : (p.contract?.aav || 0);
  const overpaid = (p.contract?.aav || 0) > market + 5;
  const redundant = rank >= 3 && ovr < ((sameByOvr[0]?.overall || 50) - 5);
  const aging = age >= 33 && ovr <= 78;
  const contractAnchor = (p.contract?.aav || 0) >= 18 && ovr <= 80;
  if (overpaid || redundant || aging || contractAnchor) return "shopping";

  return "available";
}

// AI acceptance threshold based on the stance of every player the user
// is asking for. Default is 0.97 (current). If everything is on the
// shopping list, drop to 0.85. Mix? Use 0.92. Untouchable in the list
// short-circuits to hard reject.
function _aiAcceptanceRatio(otherId, recvPlayers) {
  if (!recvPlayers.length) return 0.97;
  const stances = recvPlayers.map(p => _aiTeamPlayerStance(otherId, p));
  const untouchables = recvPlayers.filter((_, i) => stances[i] === "untouchable");
  if (untouchables.length) return { reject: true, untouchables };
  if (stances.every(s => s === "shopping")) return 0.85;
  if (stances.some(s => s === "shopping"))  return 0.92;
  return 0.97;
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

// Per-team positional needs profile — weakest + strongest unit groups,
// derived from buildRatings(). Used by the partner-picker grid to
// surface "they need this / they have depth here" at a glance.
const _TRADE_UNITS = [
  { key: "qb",  label: "QB" }, { key: "rb",  label: "RB" },
  { key: "wr",  label: "WR" }, { key: "ol",  label: "OL" },
  { key: "dl",  label: "DL" }, { key: "lb",  label: "LB" },
  { key: "cb",  label: "CB" }, { key: "saf", label: "S"  },
];
function _teamNeedsProfile(teamId) {
  const r = (typeof buildRatings === "function")
    ? buildRatings(franchise.rosters[teamId] || []) : null;
  if (!r) return { needs: [], strengths: [] };
  const ranked = _TRADE_UNITS.map(u => ({ ...u, val: Math.round(r[u.key] || 50) }))
    .sort((a, b) => a.val - b.val);
  return {
    needs: ranked.slice(0, 2),       // two weakest
    strengths: ranked.slice(-2).reverse(),  // two strongest
  };
}

// 0..100 partner-willingness score: how likely they'd be open to deal
// with YOU specifically. High when their weakest positions match the
// strongest positions on your roster (you have something they need).
function _partnerWillingness(myId, partnerId) {
  const myStrong = new Set(_teamNeedsProfile(myId).strengths.map(s => s.key));
  const theirNeeds = _teamNeedsProfile(partnerId).needs;
  let score = 35; // base
  for (const n of theirNeeds) {
    if (myStrong.has(n.key)) score += 25;
    // Even partial match — both teams thin at same unit means less willing
  }
  // Deadline urgency: bumps up as we approach the deadline
  const weeksLeft = Math.max(0, TRADE_DEADLINE_WEEK - franchise.week);
  if (weeksLeft <= 1) score += 10;
  else if (weeksLeft <= 2) score += 5;
  // Cap pressure — over-cap or near-cap teams more flexible
  const cap = effectiveSalaryCap(partnerId);
  const used = capUsedByTeam(partnerId);
  if (used > cap * 0.95) score += 10;
  // Cross-mode trade synergy: contender ↔ rebuilder pairs are the
  // natural trade partners (one has vets the other won't, one has
  // picks the other won't).
  const myMode    = _aiTeamMode(myId);
  const theirMode = _aiTeamMode(partnerId);
  if ((myMode === "win_now" && theirMode === "rebuild") ||
      (myMode === "rebuild" && theirMode === "win_now")) score += 10;
  return Math.max(5, Math.min(95, Math.round(score)));
}

// Count how many AI teams have a meaningful positional need for a
// specific blocked player. Used to surface "👀 N sniffing" badges.
function _aiInterestCount(player) {
  const myId = franchise.chosenTeamId;
  let n = 0;
  for (const t of TEAMS) {
    if (t.id === myId) continue;
    if (_aiTradeNeedBonus(t.id, [player]) >= 2) n++;
  }
  return n;
}

// On a borderline rejection (0.85 <= ratio < acceptThreshold), assemble
// the cheapest user assets that would close the gap and ship the
// result back as a counter-offer card in the inbox. Returns the
// counter description (added items) or null if no clean fix exists.
function _aiBuildCounter(myId, otherId, originalSendNames, originalRecvNames, originalSendPicks, originalRecvPicks, sendValue, recvValue, theirNeedForSend, tp, acceptanceRatio) {
  const myRoster = franchise.rosters[myId] || [];
  const usedPickKeys = new Set(originalSendPicks);
  const myPicksAvail = (franchise.picks || [])
    .filter(p => p.currentOwnerId === myId && !usedPickKeys.has(_tradePickKey(p)))
    .sort((a, b) => _pickValue(a) - _pickValue(b)); // smallest first
  const targetValue = recvValue * (acceptanceRatio || 0.97) - theirNeedForSend;
  const extraPicks = [];
  let runningValue = sendValue;
  for (const pick of myPicksAvail) {
    if (runningValue >= targetValue) break;
    extraPicks.push(pick);
    runningValue += _pickValue(pick);
    if (extraPicks.length >= 3) break; // don't ask for more than 3 extra picks
  }
  if (runningValue < targetValue || extraPicks.length === 0) return null;
  // Build the offer card. From the user's perspective the counter
  // looks like: "they give you [original recv]; they want [original
  // send + extras]". Same shape as _generateAIOffersForBlockedPlayer.
  if (!franchise.tradeOffers) franchise.tradeOffers = [];
  const offer = {
    id: `counter-${otherId}-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
    fromTeamId: otherId,
    theyGive: [...originalRecvNames],
    theyWant: [...originalSendNames],
    pickIdsGive:   [...originalRecvPicks],
    pickIdsWant:   [...originalSendPicks, ...extraPicks.map(_tradePickKey)],
    pickIds:       [...originalRecvPicks], // legacy single-list field expected by offer renderer
    absorb:        tp.theirAbsorb || 0,
    week: franchise.week,
    status: "pending",
    isCounter: true,
  };
  franchise.tradeOffers.push(offer);
  return {
    offerId: offer.id,
    extraPicks: extraPicks.map(p => `${p.year} R${p.round}`),
  };
}

// Team mode — "win_now" / "rebuild" / "balanced". Drives receiver
// bias: contenders pay premium for vets and discount picks; rebuilders
// pay premium for picks/young talent and offload vets cheap. Scored
// from win pct, cap pressure, top-22 avg age, and deadline urgency.
function _aiTeamMode(teamId) {
  const stand = franchise.standings?.[teamId] || { w: 0, l: 0, t: 0 };
  const games = stand.w + stand.l + (stand.t || 0);
  const pct = games > 0 ? stand.w / games : 0.5;
  const cap = effectiveSalaryCap(teamId);
  const used = capUsedByTeam(teamId);
  const capPressure = cap > 0 ? used / cap : 0;
  const roster = franchise.rosters[teamId] || [];
  const top22 = roster.slice().sort((a, b) => (b.overall || 0) - (a.overall || 0)).slice(0, 22);
  const avgAge = top22.length ? top22.reduce((s, p) => s + (p.age || 25), 0) / top22.length : 26;

  let score = 0;
  if      (pct >= 0.70) score += 30;
  else if (pct >= 0.55) score += 15;
  else if (pct <= 0.30) score -= 30;
  else if (pct <= 0.40) score -= 15;
  if      (capPressure > 0.95) score += 15;
  else if (capPressure < 0.80) score -= 5;
  if      (avgAge >= 29) score += 20;
  else if (avgAge <= 25) score -= 20;
  // Deadline urgency: last regular-season trade week everyone presses
  if ((TRADE_DEADLINE_WEEK - franchise.week) <= 1) score += 5;

  if (score >= 25)  return "win_now";
  if (score <= -25) return "rebuild";
  return "balanced";
}

const _AI_MODE_META = {
  win_now:  { icon: "🏆", label: "WIN-NOW",  col: "var(--gold)" },
  rebuild:  { icon: "🔨", label: "REBUILD",  col: "#7ac8e8" },
  balanced: { icon: "⚖", label: "BALANCED", col: "var(--gray)" },
};

// Tweaks the acceptance threshold based on what's in the package and
// the receiver's mode. Negative = receiver more eager (lower bar);
// positive = pickier. Clamped at ±0.15 so mode never overrides stance.
function _modeAcceptanceModifier(receiverId, sendPlayers, sendPicks, recvPlayers) {
  const mode = _aiTeamMode(receiverId);
  if (mode === "balanced") return 0;
  const pickV = sendPicks.reduce((s, p) => s + _pickValue(p), 0);
  const playerV = sendPlayers.reduce((s, p) => s + _playerTradeValue(p), 0);
  const totalV = playerV + pickV;
  const pickShare = totalV > 0 ? pickV / totalV : 0;
  let mod = 0;
  if (mode === "win_now") {
    mod += pickShare * 0.10;                                                          // pick-averse
    mod -= sendPlayers.filter(p => (p.age||25) >= 27 && (p.overall||0) >= 80).length * 0.05;  // proven vet
    mod -= recvPlayers.filter(p => (p.age||25) >= 31 && (p.overall||0) <= 85).length * 0.05;  // dump fading vets
  } else {  // rebuild
    mod -= pickShare * 0.10;                                                          // pick-loving
    mod -= sendPlayers.filter(p => (p.age||25) <= 24 && (p.overall||0) >= 70).length * 0.05;  // young talent
    mod -= recvPlayers.filter(p => (p.age||25) >= 29).length * 0.05;                          // dump vets
  }
  return Math.max(-0.15, Math.min(0.15, mod));
}

function frnOpenTrade(targetTeamId, tab) {
  if (franchise.week > TRADE_DEADLINE_WEEK && franchise.phase === "regular") {
    // Render a real panel instead of an alert+return — otherwise the
    // Front Office tab aggregator has nothing to wrap and prepends its
    // sub-nav onto stale content.
    $("frnHomeContent").innerHTML = `
      <div style="padding:2.2rem 1.5rem;text-align:center;max-width:560px;margin:0 auto">
        <div style="font-size:1.4rem;font-weight:900;color:var(--gold);margin-bottom:.5rem">🔀 TRADE DEADLINE PASSED</div>
        <div style="color:var(--gray);font-size:.85rem;line-height:1.5">
          The trade window closed after Week ${TRADE_DEADLINE_WEEK}. Trades will reopen during the offseason.
        </div>
        <div style="color:var(--blgray);font-size:.7rem;margin-top:.75rem">
          You're in Week ${franchise.week}. Free agency and waiver claims stay open year-round.
        </div>
      </div>`;
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
    p.systemYears = 0; // new system — familiarity resets
    p._tradedAtSeason = franchise.season; // fresh-start dev bonus
    const i = myRoster.indexOf(p); if (i !== -1) myRoster.splice(i, 1);
    theirRoster.push(p);
  }
  for (const p of receiving) {
    p.onTradeBlock = false;
    p.systemYears = 0; // new system — familiarity resets
    p._tradedAtSeason = franchise.season;
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
// Comp picks include their per-team-per-round index so two comps from
// the same team in the same round don't collide.
function _tradePickKey(p) {
  const suffix = p.isComp ? `_C${p.compIdx ?? 0}` : "";
  return `${p.year}_R${p.round}_T${p.originalTeamId}${suffix}`;
}
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

  // Stance-based acceptance: untouchables short-circuit to a hard
  // reject; shopping-list players accept at a favorable ratio.
  const accRule = _aiAcceptanceRatio(otherId, recvPlayers);
  if (accRule && accRule.reject) {
    const names = accRule.untouchables.map(p => `${p.position} ${p.name}`).join(", ");
    tp.result = {
      accepted: false,
      message: `Off-limits — ${getTeam(otherId)?.name} isn't moving ${names} for any package.`,
      untouchable: true,
    };
    saveFranchise();
    renderFrnTrade();
    return;
  }
  // Layer in receiver-mode bias (win-now / rebuild reweight the bar)
  const modeMod = _modeAcceptanceModifier(otherId, sendPlayers, sendPicks, recvPlayers);
  const acceptanceRatio = Math.max(0.55, Math.min(1.10, accRule + modeMod));
  const aiScore = (sendValue + theirNeedForSend) / Math.max(0.1, recvValue);
  const accepted = aiScore >= acceptanceRatio;

  if (accepted) {
    // NFL dead cap + trade kicker (must run before player objects are moved)
    _applyTradeMechanics(sendPlayers, recvPlayers, myId, otherId, tp.theirAbsorb || 0, tp.yourAbsorb || 0);
    // Players
    for (const p of sendPlayers) {
      const i = myRoster.indexOf(p);
      if (i !== -1) myRoster.splice(i, 1);
      theirRoster.push(p);
      p._tradedAtSeason = franchise.season;       // fresh-start dev bonus next offseason
    }
    for (const p of recvPlayers) {
      const i = theirRoster.indexOf(p);
      if (i !== -1) theirRoster.splice(i, 1);
      myRoster.push(p);
      p._tradedAtSeason = franchise.season;
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
    // Compute gap and pick suggestion so the user knows how to close it
    let gapLabel = null, suggestion = null;
    if (aiScore >= 0.60) {
      const gap = recvValue * acceptanceRatio - (sendValue + theirNeedForSend);
      if      (gap < 1.5)  gapLabel = "less than a late-round pick away";
      else if (gap < 3)    gapLabel = "~a 7th-round pick short";
      else if (gap < 5)    gapLabel = "~a 5th/6th-round pick short";
      else if (gap < 9)    gapLabel = "~a 3rd-round pick short";
      else if (gap < 16)   gapLabel = "~a 2nd-round pick short";
      else                 gapLabel = "~a 1st-round pick or more short";

      const sentKeys = new Set(tp.picksSend || []);
      const myPicks = (franchise.picks || [])
        .filter(p => p.currentOwnerId === myId && !sentKeys.has(_tradePickKey(p)))
        .sort((a, b) => _pickValue(a) - _pickValue(b));
      // Prefer the cheapest pick that fully covers the gap
      const exact = myPicks.find(p => _pickValue(p) >= gap);
      const best  = myPicks[myPicks.length - 1];
      const candidate = exact || best;
      if (candidate) {
        suggestion = {
          type: "pick",
          key: _tradePickKey(candidate),
          label: `${candidate.year} Round ${candidate.round} pick`,
          partial: !exact,
        };
      }
    }
    // Borderline rejection: build a counter-offer card from the
    // cheapest user assets that would close the gap and drop it into
    // the OFFERS inbox so the negotiation continues without the user
    // having to retype the deal.
    let counterRef = null;
    if (aiScore >= 0.85) {
      counterRef = _aiBuildCounter(myId, otherId,
        tp.youSend.slice(), tp.youReceive.slice(),
        (tp.picksSend || []).slice(), (tp.picksReceive || []).slice(),
        sendValue, recvValue, theirNeedForSend, tp, acceptanceRatio);
    }
    tp.result = {
      accepted: false,
      message: counterRef
        ? `Rejected — but ${getTeam(otherId)?.name} countered. See OFFERS.`
        : `Rejected. ${reason}.`,
      aiScore, gapLabel, suggestion,
      counter: counterRef,
    };
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

  // No partner locked yet → show the partner-picker grid as the front
  // door instead of the buried "click any player" pattern.
  if (!partnerId) return _renderTradePartnerPicker(myId, cap, myCapUsed);

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
    // Stance tag: ⛔ untouchable / 💸 on the partner's shopping list
    let stanceTag = "";
    if (partnerId) {
      const stance = _aiTeamPlayerStance(teamId, p);
      if (stance === "untouchable") stanceTag = `<span class="frn-trade-stance ut" title="${team.name} won't move this player — franchise face / recent high pick">⛔ OFF-LIMITS</span>`;
      else if (stance === "shopping") stanceTag = `<span class="frn-trade-stance sh" title="${team.name} is open to dealing this player at a favorable price">💸 SHOPPING</span>`;
    }
    return `<label class="frn-trade-player ${sel?"selected":""}">
      <input type="checkbox" ${sel?"checked":""}
        onchange="frnAddReceiveFromBrowse(${teamId},'${escName}')">
      <span class="frn-trade-pos">${p.position}</span>
      <span class="frn-trade-name-row">
        <span class="frn-trade-name" style="font-weight:${sel?700:400}">${p.name}</span>
        ${!partnerId ? `<span class="frn-trade-team">${team.name}</span>` : ""}
        ${stanceTag}
        ${kickerTag}
      </span>
      <span>${gradeBadge(p)}</span>
      <span class="frn-trade-age">${p.age||"?"}</span>
      <span class="frn-trade-aav">$${(p.contract?.aav||0).toFixed(0)}M</span>
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
      <span class="frn-trade-pos">${p.position}</span>
      <span class="frn-trade-name-row">
        <span class="frn-trade-name" style="font-weight:${sel?700:400}">${p.name}</span>
        ${blockTag}
        ${deadTag}
      </span>
      <span>${gradeBadge(p)}</span>
      <span class="frn-trade-age">${p.age||"?"}</span>
      <span class="frn-trade-aav">$${(p.contract?.aav||0).toFixed(0)}M</span>
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

  // ── Live trade-balance: same math the AI uses on submit, surfaced
  // so the user sees the deal getting closer (or further) as they
  // toggle items. Mirrors the cap bar visually below the summary.
  const sendPlayersLive = tp.youSend.map(n => myRoster.find(p => p.name === n)).filter(Boolean);
  const recvPlayersLive = tp.youReceive.map(n => theirRoster.find(p => p.name === n)).filter(Boolean);
  const sendPicksLive = (tp.picksSend || []).map(k => _tradePickFromKey(k, myId)).filter(Boolean);
  const recvPicksLive = (tp.picksReceive || []).map(k => _tradePickFromKey(k, partnerId)).filter(Boolean);
  const playerSendV = sendPlayersLive.reduce((s, p) => s + _playerTradeValue(p), 0);
  const playerRecvV = recvPlayersLive.reduce((s, p) => s + _playerTradeValue(p), 0);
  const pickSendV = sendPicksLive.reduce((s, p) => s + _pickValue(p), 0);
  const pickRecvV = recvPicksLive.reduce((s, p) => s + _pickValue(p), 0);
  const sendV = playerSendV + pickSendV + (tp.yourAbsorb || 0);
  const recvV = playerRecvV + pickRecvV + (tp.theirAbsorb || 0);
  const needBonus = _aiTradeNeedBonus(partnerId, sendPlayersLive);
  const balanceRatio = recvV > 0 ? (sendV + needBonus) / recvV : 0;
  const balanceVerdict = (sendV + recvV) < 0.5 ? "empty"
    : balanceRatio >= 0.97 ? "accept"
    : balanceRatio >= 0.85 ? "close"
    : balanceRatio >= 0.60 ? "thin"
    : "lopsided";
  const partnerMode = _aiTeamMode(partnerId);
  const modeAccMod = _modeAcceptanceModifier(partnerId, sendPlayersLive, sendPicksLive, recvPlayersLive);
  const balanceBarHtml = _renderTradeBalanceBar({
    sendV, recvV, needBonus, ratio: balanceRatio, verdict: balanceVerdict,
    partnerMode, modeAccMod,
  });
  const multiYearCapHtml = _renderMultiYearCapImpact(
    myId, partnerId, sendPlayersLive, recvPlayersLive, tp.yourAbsorb || 0, tp.theirAbsorb || 0
  );

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
    ${balanceBarHtml}
    ${multiYearCapHtml}
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
        ${!tp.result.accepted && tp.result.gapLabel ? `
          <div style="font-size:.62rem;color:var(--gray);margin-top:.25rem">You're ${tp.result.gapLabel}.</div>` : ""}
        ${!tp.result.accepted && tp.result.suggestion ? `
          <div style="margin-top:.35rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
            <span style="font-size:.63rem;color:var(--gray)">${tp.result.suggestion.partial ? "Closest pick you have:" : "Try adding:"}</span>
            <button class="btn" style="font-size:.63rem;padding:.2rem .5rem;background:var(--bg3);color:var(--gold);border:1px solid var(--gold)"
              onclick="frnToggleTradePick('send','${tp.result.suggestion.key}')">
              ➕ ${tp.result.suggestion.label}
            </button>
          </div>` : ""}
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

// Partner-picker grid — shown as the entry view when no partner is
// locked. Each card is one team with record, cap room, top 2 needs +
// top 2 strengths + a willingness pill. Click locks the partner.
function _renderTradePartnerPicker(myId, myCap, myCapUsed) {
  const myStrong = new Set(_teamNeedsProfile(myId).strengths.map(s => s.key));
  const myMode = _aiTeamMode(myId);
  const cards = TEAMS.filter(t => t.id !== myId).map(t => {
    const stand = franchise.standings?.[t.id] || { w: 0, l: 0, t: 0 };
    const cap = effectiveSalaryCap(t.id);
    const used = capUsedByTeam(t.id);
    const room = Math.max(0, cap - used);
    const overCap = used > cap;
    const profile = _teamNeedsProfile(t.id);
    const mode = _aiTeamMode(t.id);
    const willingness = _partnerWillingness(myId, t.id);
    const matched = profile.needs.filter(n => myStrong.has(n.key)).length;
    const crossMode = (myMode === "win_now" && mode === "rebuild") || (myMode === "rebuild" && mode === "win_now");
    return { t, stand, room, overCap, profile, mode, willingness, matched, crossMode };
  }).sort((a, b) => b.willingness - a.willingness);

  const verdictCol = (w) => w >= 70 ? "var(--green-lt)" : w >= 50 ? "var(--gold-lt)" : w >= 30 ? "#e8a000" : "#c08080";
  const verdictLbl = (w) => w >= 70 ? "EAGER" : w >= 50 ? "OPEN" : w >= 30 ? "COOL" : "ICY";
  const unitCell = (u, col) => `<span class="frn-tp-unit" style="color:${col}">${u.label} <b>${u.val}</b></span>`;

  const cardsHtml = cards.map(c => {
    const mm = _AI_MODE_META[c.mode];
    return `
    <button class="frn-tp-card" onclick="frnOpenTrade(${c.t.id},'propose')" style="--accent:${c.t.primary||'var(--gold)'}">
      <div class="frn-tp-card-head">
        <span class="frn-tp-team">${c.t.city} ${c.t.name}</span>
        <span class="frn-tp-rec">${c.stand.w}-${c.stand.l}${c.stand.t?`-${c.stand.t}`:""}</span>
      </div>
      <div class="frn-tp-mode-row">
        <span class="frn-tp-mode" title="${c.mode === "win_now" ? "Contender — pays premium for vets, discounts incoming picks" : c.mode === "rebuild" ? "Rebuilder — pays premium for picks / young talent, dumps vets cheap" : "Balanced — standard valuation across the board"}" style="color:${mm.col};border-color:${mm.col}55">${mm.icon} ${mm.label}</span>
        ${c.crossMode ? `<span class="frn-tp-cross" title="Cross-mode pair — you have what they want and vice versa">↔ NATURAL FIT</span>` : ""}
      </div>
      <div class="frn-tp-cap">
        <span style="color:var(--gray)">Cap room</span>
        <b style="color:${c.overCap?"var(--red)":c.room < 5 ? "#e8a000" : "var(--green-lt)"}">${c.overCap?"OVER":`$${c.room.toFixed(1)}M`}</b>
      </div>
      <div class="frn-tp-units">
        <div class="frn-tp-unit-row"><span class="frn-tp-unit-lbl">NEEDS</span>${c.profile.needs.map(u => unitCell(u, "#c08080")).join("")}</div>
        <div class="frn-tp-unit-row"><span class="frn-tp-unit-lbl">DEPTH</span>${c.profile.strengths.map(u => unitCell(u, "var(--green-lt)")).join("")}</div>
      </div>
      <div class="frn-tp-foot">
        ${c.matched ? `<span class="frn-tp-match" title="${c.matched} of their weak units overlap with your strengths">★ ${c.matched} fit</span>` : `<span class="frn-tp-match dim">no obvious fit</span>`}
        <span class="frn-tp-willing" style="color:${verdictCol(c.willingness)};border-color:${verdictCol(c.willingness)}55">${verdictLbl(c.willingness)} · ${c.willingness}%</span>
      </div>
    </button>`;
  }).join("");

  const overrideHtml = TEAMS.filter(t => t.id !== myId).map(t =>
    `<option value="${t.id}">${t.city} ${t.name}</option>`
  ).join("");

  return `
    <div class="frn-tp-header">
      <div>
        <div style="font-size:.95rem;font-weight:900;color:var(--gold);margin-bottom:.2rem">PICK A TRADE PARTNER</div>
        <div style="font-size:.66rem;color:var(--gray)">Sorted by deal-fit (needs ↔ strengths · cap pressure · deadline urgency · cross-mode synergy).</div>
        <div style="font-size:.62rem;margin-top:.18rem">Your team is <b style="color:${_AI_MODE_META[myMode].col}">${_AI_MODE_META[myMode].icon} ${_AI_MODE_META[myMode].label}</b> — ${myMode === "win_now" ? "you'll pay premium for proven vets and undervalue picks." : myMode === "rebuild" ? "you'll pay premium for picks / young talent and offload vets cheap." : "standard market valuation."}</div>
      </div>
      <div style="margin-left:auto;display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
        <span style="color:var(--gray);font-size:.62rem">Your cap: <b style="color:var(--gold)">$${myCapUsed.toFixed(1)}M</b> / $${myCap.toFixed(0)}M</span>
        <span style="color:var(--gray);font-size:.62rem">or skip to:</span>
        <select onchange="frnOpenTrade(this.value||null,'propose')" style="background:var(--bg3);color:var(--white);border:1px solid var(--border);padding:.2rem .35rem;font-family:inherit;font-size:.7rem">
          <option value="">— jump to team —</option>${overrideHtml}
        </select>
      </div>
    </div>
    <div class="frn-tp-grid">${cardsHtml}</div>`;
}

// Visual balance bar that mirrors the cap bar — send value vs receive
// value plus the partner's positional-need bonus, all in the same
// units the AI evaluator uses on submit. Updates every render.
function _renderTradeBalanceBar(b) {
  if (b.verdict === "empty") return "";
  const verdictCol = b.verdict === "accept" ? "var(--green-lt)"
    : b.verdict === "close"   ? "var(--gold-lt)"
    : b.verdict === "thin"    ? "#e8a000" : "#c08080";
  const verdictLbl = b.verdict === "accept" ? "✓ LIKELY ACCEPT"
    : b.verdict === "close"   ? "△ CLOSE — small sweetener"
    : b.verdict === "thin"    ? "✗ NOT ENOUGH"
                              : "✗ TOO LOPSIDED";
  // Bar layout: left chunk = your send total, right chunk = their recv
  // Width proportional, both clamped so a near-zero side is still readable.
  const total = Math.max(0.1, b.sendV + b.needBonus + b.recvV);
  const sendPct = Math.max(4, Math.round(((b.sendV + b.needBonus) / total) * 100));
  const recvPct = 100 - sendPct;
  const ratioPct = Math.round(Math.min(2, b.ratio) * 100);
  return `<div class="frn-trade-balance">
    <div class="frn-trade-balance-head">
      <span class="frn-trade-balance-title">DEAL VALUE</span>
      <span class="frn-trade-balance-verdict" style="color:${verdictCol};border-color:${verdictCol}55">${verdictLbl}</span>
      <span style="margin-left:auto;color:var(--gray);font-size:.62rem">accept threshold: 97%</span>
    </div>
    <div class="frn-trade-balance-bar">
      <div class="frn-trade-balance-send" style="flex:${sendPct}">
        <span class="frn-trade-balance-num">$${b.sendV.toFixed(1)}M</span>
        ${b.needBonus >= 0.5 ? `<span class="frn-trade-balance-need" title="Partner's positional need for the players you're offering">+ $${b.needBonus.toFixed(1)}M need</span>` : ""}
        <span class="frn-trade-balance-lbl">YOU SEND</span>
      </div>
      <div class="frn-trade-balance-recv" style="flex:${recvPct}">
        <span class="frn-trade-balance-num">$${b.recvV.toFixed(1)}M</span>
        <span class="frn-trade-balance-lbl">YOU RECEIVE</span>
      </div>
    </div>
    <div class="frn-trade-balance-ratio">
      Ratio: <b style="color:${verdictCol}">${ratioPct}%</b> · ${b.ratio >= 0.97
        ? "they should say yes"
        : b.ratio >= 0.85
        ? `add a small pick or sweetener to clear the threshold`
        : `you need to put more on your side`}
    </div>
    ${b.partnerMode && b.partnerMode !== "balanced" ? `<div class="frn-trade-balance-mode" style="color:${_AI_MODE_META[b.partnerMode].col}">
      ${_AI_MODE_META[b.partnerMode].icon} <b>${_AI_MODE_META[b.partnerMode].label}</b>: ${b.partnerMode === "win_now"
        ? `picks count less here, proven vets count extra`
        : `picks count extra here, vets get devalued`}${b.modeAccMod ? ` · threshold ${b.modeAccMod > 0 ? "+" : ""}${(b.modeAccMod * 100).toFixed(0)}%` : ""}
    </div>` : ""}
  </div>`;
}

// Year-by-year net cap impact for both sides of the proposed deal.
// Uses each contract's remaining years × AAV (offset by absorption /
// dead-cap / kickers in Year 1).
function _renderMultiYearCapImpact(myId, partnerId, sendPlayers, recvPlayers, yourAbsorb, theirAbsorb) {
  if (!sendPlayers.length && !recvPlayers.length) return "";
  const years = [1, 2, 3, 4];
  const impact = (myFirst, theirFirst) => years.map(yr => {
    // For YOUR side: -send AAVs (Y ≤ remaining) + recv AAVs (Y ≤ remaining)
    let myNet = 0, theirNet = 0;
    for (const p of sendPlayers) {
      const rem = p.contract?.remaining || 0;
      const aav = p.contract?.aav || 0;
      if (yr <= rem) { myNet -= aav; theirNet += aav; }
    }
    for (const p of recvPlayers) {
      const rem = p.contract?.remaining || 0;
      const aav = p.contract?.aav || 0;
      if (yr <= rem) { myNet += aav; theirNet -= aav; }
    }
    // Y1-only: dead cap on send, kicker on recv, absorption flows
    if (yr === 1) {
      for (const p of sendPlayers) {
        const dead = (p.contract?.bonusProration || 0) * (p.contract?.remaining || 0);
        const absorbed = Math.min(theirAbsorb, dead);
        myNet   += (dead - absorbed); // I eat what they don't absorb
        theirNet += absorbed;
      }
      for (const p of recvPlayers) {
        const kicker = p.contract?.tradeKicker || 0;
        myNet += kicker;
      }
      myNet   += yourAbsorb;
      theirNet -= yourAbsorb;
    }
    return { yr, myNet, theirNet };
  });
  const myRows  = impact().map(r => `<td style="text-align:center;color:${r.myNet > 0 ? "#ff8a8a" : r.myNet < 0 ? "var(--green-lt)" : "var(--gray)"}">${r.myNet === 0 ? "—" : (r.myNet > 0 ? "+" : "") + "$" + r.myNet.toFixed(1) + "M"}</td>`).join("");
  const theirRows = impact().map(r => `<td style="text-align:center;color:${r.theirNet > 0 ? "#ff8a8a" : r.theirNet < 0 ? "var(--green-lt)" : "var(--gray)"}">${r.theirNet === 0 ? "—" : (r.theirNet > 0 ? "+" : "") + "$" + r.theirNet.toFixed(1) + "M"}</td>`).join("");
  const myTeam = getTeam(myId), partnerTeam = getTeam(partnerId);
  return `<div class="frn-trade-multiyr">
    <div class="frn-trade-multiyr-title">MULTI-YEAR CAP IMPACT</div>
    <table class="frn-trade-multiyr-tbl">
      <thead><tr><th style="text-align:left">Team</th>${years.map(y => `<th>Y${y}</th>`).join("")}</tr></thead>
      <tbody>
        <tr><td style="text-align:left;color:var(--gold-lt)">${myTeam?.name}</td>${myRows}</tr>
        <tr><td style="text-align:left;color:var(--gray)">${partnerTeam?.name}</td>${theirRows}</tr>
      </tbody>
    </table>
    <div class="frn-trade-multiyr-foot">+ = added cap hit · − = freed cap · Y1 includes dead cap, trade kickers, and absorption flows</div>
  </div>`;
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
    const compTag = p.isComp ? `<span style="color:var(--gold-lt);font-size:.55rem;letter-spacing:.4px"> COMP</span>` : "";
    return `<label class="frn-trade-row" style="display:flex;gap:.4rem;align-items:center;padding:.18rem .25rem;cursor:pointer;${sel?"background:rgba(200,169,0,0.12)":""}">
      <input type="checkbox" ${sel?"checked":""} onchange="frnToggleTradePick('${isMine?"send":"receive"}','${key}')">
      <span style="color:var(--gold);font-weight:700;font-size:.65rem;min-width:2.2rem">${yearLabel(p.year)} R${p.round}${compTag}</span>
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
    const interestN = p.onTradeBlock ? _aiInterestCount(p) : 0;
    const interestTag = p.onTradeBlock
      ? (interestN
          ? `<div style="font-size:.6rem;color:var(--green-lt);margin-top:.12rem" title="${interestN} team${interestN===1?"":"s"} with a positional need for this player">👀 ${interestN} team${interestN===1?"":"s"} interested</div>`
          : `<div style="font-size:.6rem;color:var(--gray);margin-top:.12rem;font-style:italic">No team currently has a positional need here</div>`)
      : "";
    return `<tr class="${p.onTradeBlock?'frn-blocked':''}">
      <td style="color:var(--gold);font-size:.62rem">${p.position}</td>
      <td style="font-weight:700">${p.name}${askSummary}${interestTag}</td>
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
// ── College Profile System ────────────────────────────────────────────────────
function _nameHash(name, seed) {
  let h = seed | 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 53 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function _clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function _lerpR(a, b, t) { return Math.round(a + (b - a) * _clamp(t, 0, 1)); }

const _KNOCK_TYPES_BY_POS = {
  QB:  ["system_player","small_school","injury","one_year_wonder"],
  RB:  ["scheme_fit","durability","pass_blocking"],
  WR:  ["system_player","combine_flop","small_school","one_year_wonder"],
  TE:  ["system_player","technique","scheme_fit"],
  OL:  ["short_arms","medical","technique","converted"],
  DL:  ["weight_concern","production_drop","scheme_fit"],
  LB:  ["coverage","size","scheme_fit"],
  CB:  ["combine_flop","technique","small_school"],
  S:   ["range","box_only","combine_flop"],
  K:   ["accuracy","leg_strength"],
  P:   ["directional","consistency"],
};

function _selectKnock(p, round) {
  const knockList = _KNOCK_TYPES_BY_POS[p.position] || [];
  if (!knockList.length) return null;
  const expected = { 1:88,2:81,3:75,4:70,5:66,6:63,7:60,0:58 }[round] ?? 65;
  const isHighUpsideLate = (p.potential || 65) >= expected + 4 && round >= 4;
  const knockProb = { 1:0.12,2:0.12,3:0.30,4:0.55,5:0.55,6:0.70,7:0.70 }[round] ?? 0.50;
  const h = _nameHash(p.name, 97);
  if (!isHighUpsideLate && (h % 1000) / 1000 >= knockProb) return null;
  return knockList[(h >> 8) % knockList.length];
}

function _knockStr(knockType, pos, fortyTime) {
  const slow40 = parseFloat(fortyTime) > 4.60;
  const table = {
    system_player:   { QB:"Spread system QB — reads simplified; rarely worked under center",
                       WR:"System receiver — 90% of routes within 10 yds of LOS",
                       TE:"Air-raid TE — almost exclusively lined up in slot",
                       default:"Production inflated by scheme — fits one system" },
    small_school:    { QB:"Limited reps vs Power-5 pass rushers — competition level unclear",
                       WR:"Small-school corners exposed route-running limitations",
                       CB:"Small-school competition — rarely tested by top receivers",
                       default:"Small-school production — NFL competition level unknown" },
    injury:          { QB:"Shoulder strain history — two injury-shortened seasons",
                       RB:"Two injury-shortened seasons — durability is the main concern",
                       DL:"Knee scope sophomore year — missed half of junior season",
                       default:"Injury history — missed significant game time in college" },
    medical:         { OL:"Failed initial medical — ligament scar tissue in both knees",
                       default:"Medical red flag — multiple teams paused scouting" },
    one_year_wonder: { QB:"Breakout only in final season — prior years show inconsistency",
                       WR:"Single explosive year raises system-dependency concerns",
                       default:"Production concentrated in one season — trajectory unclear" },
    scheme_fit:      { RB:"Zone-specific back — struggles in gap/power looks",
                       TE:"Inline blocker only — won't contribute as a receiver early",
                       DL:"One-gap fit — production drops in two-gap schemes",
                       LB:"Strong-side only — range and coverage limit three-down value",
                       default:"Scheme-specific production — limited versatility" },
    durability:      { RB:"Carry load trending down each season — needs load management",
                       default:"Durability concern — wear showing on film" },
    pass_blocking:   { RB:"Pass protection near bottom of class — sub-package liability early",
                       default:"Pass protection technique needs NFL development" },
    combine_flop:    { WR:slow40 ? `${fortyTime}s 40 is a concern for his college alignment` : "Combine disappointed — separation questions at next level",
                       CB:slow40 ? `${fortyTime}s raised alarms for a press corner` : "Combine underwhelmed — relies on technique over athleticism",
                       S:"Combine was flat — range in coverage must develop",
                       default:"Combine measurables raised concern — athletic ceiling in question" },
    technique:       { TE:"Blocking footwork inconsistent — false steps against speed rushers",
                       OL:"Hand placement sloppy under pressure — needs technique overhaul",
                       CB:"Press technique breaks down vs physical receivers",
                       default:"Technique needs refinement — raw athleticism ahead of polish" },
    converted:       { OL:"Converted from DL — two years at tackle, one at guard",
                       default:"Positional convert — learning curve ahead" },
    short_arms:      { OL:`32¼" arm length — below threshold for tackle; interior project`,
                       default:"Arm length concern at the position" },
    weight_concern:  { DL:"Listed at 278 — scouts question gap integrity at NFL weight",
                       default:"Weight projection concern — body type questions" },
    production_drop: { DL:"Senior sack total dropped from 10.5 to 4.0 — opponents adjusted",
                       default:"Production declined in final season — questions remain" },
    coverage:        { LB:"Man coverage grade near bottom of class — base-down only",
                       default:"Coverage limitations — will be scheme-dependent" },
    size:            { LB:`Listed at 6'0" 225 — teams question gap integrity vs power backs`,
                       default:"Size concern at the position" },
    range:           { S:"Limited range — plays best within 8 yards of LOS on film",
                       default:"Range concerns in zone — struggles to cover ground" },
    box_only:        { S:"Box safety archetype — single-high and cover-2 expose limitations",
                       default:"Fits a limited role — versatility in question" },
    accuracy:        { K:"Strong inside 40 but percentage drops sharply on distance kicks",
                       default:"Accuracy concerns at distance" },
    leg_strength:    { K:"Consistent inside 45 but rarely attempted beyond — range development needed",
                       default:"Leg strength development needed" },
    directional:     { P:"Elite distance but directional hang time is inconsistent",
                       default:"Directional technique needs work" },
    consistency:     { P:"High game-to-game variance on film — boom or bust",
                       default:"Consistency is the key development area" },
  };
  const grp = table[knockType];
  if (!grp) return "Scouting concern";
  return grp[pos] || grp.default || "Scouting concern";
}

function _buildScoutKnockNote(knockType, isHighUpside) {
  const notes = {
    system_player:    { dismiss:"Film in 1-on-1 drills is pro-ready — routes aren't scheme-dependent",
                        confirm:"Scheme reliance confirmed — struggles vs press coverage in workout film" },
    small_school:     { dismiss:"Senior Bowl reps were exceptional — dominated Power-5 corners all week",
                        confirm:"Struggled vs first-round corner in Senior Bowl — athleticism gap is real" },
    injury:           { dismiss:"Team physician cleared him — structural MRI clean, no restrictions",
                        confirm:"Medical review flagged incomplete healing — Year 1 workload will be limited" },
    medical:          { dismiss:"Second opinion clean — initial concern overblown by combine staff",
                        confirm:"Three teams passed on medical — our physician agrees with the concern" },
    one_year_wonder:  { dismiss:"QB change unlocked him — prior years' production was scheme, not ability",
                        confirm:"1-on-1 drill film shows the breakout was coaching-driven, not repeatable" },
    scheme_fit:       { dismiss:"Private workout outstanding — footwork translates across schemes",
                        confirm:"Didn't recognize a single coverage adjustment in workout — one-system fit" },
    durability:       { dismiss:"Conditioning blew scouts away — fastest RB on the board at the combine",
                        confirm:"Showed fatigue in late-game carries junior year — load management needed" },
    pass_blocking:    { dismiss:"Sat through a full protection clinic — technique cleaned up noticeably",
                        confirm:"Failed to disengage from blitz twice in practice — third-down liability" },
    combine_flop:     { dismiss:"Pro day re-test significantly faster — combine surface was the factor",
                        confirm:"Pro day didn't move the needle — this is his athletic ceiling" },
    technique:        { dismiss:"Private workout shows dramatic improvement — extremely coachable",
                        confirm:"Footwork didn't improve in workout — needs intensive coaching from Day 1" },
    converted:        { dismiss:"Two years at position is enough — Senior Bowl showed NFL-ready technique",
                        confirm:"Technique gaps still visible — project as a reserve for at least a season" },
    short_arms:       { dismiss:"Compensates with exceptional anchor and hand speed — plays longer than measured",
                        confirm:"Arm length confirmed — gets pushed around by bull rushers with longer leverage" },
    weight_concern:   { dismiss:"Body fat at combine was elite — the weight is functional muscle",
                        confirm:"Asked to add 10 lbs — struggled to stay over 270; project to lose gap battles" },
    production_drop:  { dismiss:"Coaches schemed away from him — targeted by every OC in the conference",
                        confirm:"Motor seemed to dial back after sophomore year — needs a culture reset" },
    coverage:         { dismiss:"Zone instincts excellent in workout — two-down starter ceiling at worst",
                        confirm:"Third-down liability confirmed — will come off the field in dime packages" },
    size:             { dismiss:"Plays bigger than listed — elite pad level compensates at every level",
                        confirm:"Tested against power backs at Senior Bowl — got pushed off blocks twice" },
    range:            { dismiss:"Shrine Game shows deceptively fast closing burst — more range than timed speed",
                        confirm:"Range limitation confirmed in drills — best fit is strong safety in two-high shell" },
    box_only:         { dismiss:"Covered a TE down the seam in practice — more versatile than usage shows",
                        confirm:"Zone breaks down past 15 yards — center-field role not viable" },
    accuracy:         { dismiss:"Kicked in rain and wind at combine — controlled conditions show 90%+ inside 50",
                        confirm:"Beyond-50 accuracy didn't improve at pro day — situational kicker ceiling" },
    leg_strength:     { dismiss:"Building strength in the program — pro day leg was 5 yards longer than combine",
                        confirm:"Pro day didn't move the needle — realistic ceiling is 50 yards" },
    directional:      { dismiss:"Directional technique cleaned up at pro day — punted inside the 10 three times",
                        confirm:"Directional work inconsistent at pro day — distance is his only reliable tool" },
    consistency:      { dismiss:"Variance on film is game-context driven — bad program, not bad punter",
                        confirm:"Confirmed variance — three shank-level kicks in a 20-ball pro day session" },
  };
  const pair = notes[knockType];
  if (!pair) return null;
  return isHighUpside ? pair.dismiss : pair.confirm;
}

function _getScoutKnockNote(name) {
  return franchise.draftScoutReveals?.[name]?.knockNote || null;
}

function _buildCollegeProfile(p, round) {
  const pos = p.position;
  const s = p.stats || [];
  const [spd=50, str=50, agi=50, awr=50, thr=50, cat=50, blk=50, prs=50, cov=50, tck=50, kpw=50] = s;
  const h1 = _nameHash(p.name, 17);
  const h2 = _nameHash(p.name, 41);
  const h3 = _nameHash(p.name, 67);
  const nz  = (h, r) => (h % (r * 2 + 1)) - r;
  const scl1 = v => _clamp((v - 45) / 35, 0, 1);
  const scl2 = (a, b) => _clamp(((a + b) - 90) / 70, 0, 1);
  const rf   = round <= 2 ? 0.40 : round <= 4 ? 0.20 : 0.10;

  const knockType = _selectKnock(p, round);
  const knock     = knockType ? _knockStr(knockType, pos, combineMeasurables(p).fortyTime) : null;

  const injKnock = ["injury","medical","durability"].includes(knockType);
  const games    = Math.max(5, Math.min(15, (injKnock ? 7 : 13) + nz(h3, 2)));
  const sys      = knockType === "system_player" ? 1.25 : 1.0;

  let line = "";
  if (pos === "QB") {
    const t   = Math.max(rf, scl2(thr, awr));
    const yds = Math.round((_lerpR(1200, 3800, t) + nz(h1, 120)) * sys);
    const td  = Math.max(6,  _lerpR(8, 30, t) + nz(h2, 3));
    const cmp = _clamp(_lerpR(55, 70, t) + nz(h3, 3), 50, 76);
    if (knockType === "one_year_wonder") {
      const pYds = Math.round(yds * 0.38 + nz(h1 >> 3, 80));
      line = `Jr: ${pYds.toLocaleString()} YDS · ${Math.max(1,Math.round(td*0.37))} TD → Sr: ${yds.toLocaleString()} YDS · ${td} TD · ${cmp}%`;
    } else {
      line = `${yds.toLocaleString()} YDS · ${td} TD · ${cmp}% comp · ${games}G`;
    }
  } else if (pos === "RB") {
    const t   = Math.max(rf, scl2(spd, agi));
    const yds = Math.round((_lerpR(450, 1500, t) + nz(h1, 100)) * sys);
    const att = Math.max(60, _lerpR(100, 280, t) + nz(h2, 20));
    const td  = Math.max(3,  _lerpR(4, 15, t)  + nz(h3, 2));
    const ypc = (yds / att).toFixed(1);
    const recLine = cat > 52 && knockType !== "pass_blocking"
      ? ` · ${Math.max(5, _lerpR(12, 52, scl1(cat)) + nz(h3 >> 2, 5))} REC` : "";
    if (knockType === "one_year_wonder") {
      const pYds = Math.round(yds * 0.45 + nz(h1 >> 3, 60));
      line = `Jr: ${pYds} YDS · ${Math.max(1,Math.round(td*0.4))} TD → Sr: ${yds} YDS · ${td} TD · ${ypc} YPC`;
    } else {
      line = `${yds} YDS · ${td} TD · ${ypc} YPC${recLine} · ${games}G`;
    }
  } else if (pos === "WR") {
    const t   = Math.max(rf, scl2(spd, cat));
    const rec = Math.round((_lerpR(22, 88, t) + nz(h1, 8)) * sys);
    const yds = Math.round((_lerpR(280, 1350, t) + nz(h2, 80)) * sys);
    const td  = Math.max(2,  _lerpR(2, 13, t) + nz(h3, 2));
    const ypr = (yds / Math.max(1, rec)).toFixed(1);
    if (knockType === "one_year_wonder") {
      const pRec = Math.round(rec * 0.35 + nz(h1 >> 3, 5));
      const pYds = Math.round(yds * 0.35 + nz(h2 >> 3, 40));
      line = `Jr: ${pRec} REC · ${pYds} YDS → Sr: ${rec} REC · ${yds} YDS · ${td} TD`;
    } else {
      line = `${rec} REC · ${yds} YDS · ${td} TD · ${ypr} YPR · ${games}G`;
    }
  } else if (pos === "TE") {
    const t   = Math.max(rf, scl2(cat, blk));
    const rec = Math.round((_lerpR(14, 62, t) + nz(h1, 6)) * sys);
    const yds = Math.round((_lerpR(160, 820, t) + nz(h2, 60)) * sys);
    const td  = Math.max(1,  _lerpR(1, 10, t) + nz(h3, 2));
    line = `${rec} REC · ${yds} YDS · ${td} TD · ${games}G`;
  } else if (pos === "OL") {
    const t   = Math.max(rf, scl2(str, blk));
    const gs  = Math.max(8,  _lerpR(18, 50, t) + nz(h1, 5));
    const pbr = _clamp(_lerpR(72, 96, t) + nz(h2 % 100, 5), 60, 98);
    const hon = t > 0.82 ? (t > 0.92 ? " · 1st-Tm All-Conf" : " · 2nd-Tm All-Conf") : "";
    line = `${gs} GS${hon} · ${pbr}.${Math.abs(nz(h3,9))} pass block rtg`;
  } else if (pos === "DL") {
    const t   = Math.max(rf, scl2(prs, str));
    const skR = Math.max(5,  _lerpR(15, 140, t) + nz(h1, 15));
    const flR = Math.max(10, _lerpR(30, 190, t) + nz(h2, 20));
    const tkl = Math.max(12, _lerpR(22, 55, t)  + nz(h3, 6));
    const sk  = (skR / 10).toFixed(1);
    const tfl = (flR / 10).toFixed(1);
    if (knockType === "production_drop") {
      const priorSk = ((skR + 40 + nz(h1 >> 4, 10)) / 10).toFixed(1);
      line = `Jr: ${priorSk} SK → Sr: ${sk} SK · ${tfl} TFL · ${tkl} TKL`;
    } else {
      line = `${sk} SK · ${tfl} TFL · ${tkl} TKL · ${games}G`;
    }
  } else if (pos === "LB") {
    const t   = Math.max(rf, scl2(tck, prs));
    const tkl = Math.max(30, _lerpR(48, 128, t) + nz(h1, 10));
    const skR = Math.max(5,  _lerpR(10, 90, t)  + nz(h2, 10));
    const ints = Math.max(0, _lerpR(0, 5, scl1(cov)) + nz(h3 % 5, 1));
    line = `${tkl} TKL · ${(skR/10).toFixed(1)} SK · ${ints} INT · ${games}G`;
  } else if (pos === "CB") {
    const t   = Math.max(rf, scl2(cov, spd));
    const pds  = Math.max(2, _lerpR(4, 20, t) + nz(h1, 3));
    const ints = Math.max(0, _lerpR(0, 7, t)  + nz(h2, 2));
    const pRtg = _clamp(_lerpR(105, 50, t) + nz(h3, 8), 42, 118);
    line = `${pds} PD · ${ints} INT · ${pRtg} passer rtg allowed · ${games}G`;
  } else if (pos === "S") {
    const t   = Math.max(rf, scl2(tck, cov));
    const tkl  = Math.max(25, _lerpR(40, 115, t) + nz(h1, 10));
    const ints = Math.max(0,  _lerpR(0, 7, t)    + nz(h2, 2));
    const pds  = Math.max(0,  _lerpR(2, 14, t)   + nz(h3, 3));
    line = `${tkl} TKL · ${ints} INT · ${pds} PD · ${games}G`;
  } else if (pos === "K") {
    const t    = scl1(kpw);
    const made = Math.max(6,  _lerpR(12, 28, t) + nz(h1, 3));
    const att  = made + Math.max(1, _lerpR(2, 6, t) + nz(h2, 2));
    const lng  = Math.max(38, _lerpR(43, 60, t) + nz(h3, 3));
    line = `${made}/${att} FG · ${Math.round((made/att)*100)}% · ${lng}yd long`;
  } else if (pos === "P") {
    const t    = scl1(kpw);
    const net  = ((_lerpR(370, 460, t) + nz(h1, 12)) / 10).toFixed(1);
    const i20  = Math.max(6,  _lerpR(10, 26, t) + nz(h2, 3));
    const gross = (parseFloat(net) + 1.5 + (Math.abs(nz(h3 % 20, 8)) / 10)).toFixed(1);
    line = `${gross} gross · ${net} net · ${i20} inside-20`;
  }

  return { line, knock, knockType };
}

function frnGoToDraft() {
  const rookieYear = (new Date().getFullYear()) + (franchise.season || 1);
  _injectCompPicks(rookieYear);
  // Roll class themes first so the class generator can use them and we
  // can stamp them onto franchise.draft for the UI chips.
  const themes = _rollClassThemes();
  const positions = _buildClassPositionPool(themes);
  franchise.draft = {
    class: _buildDraftClass(rookieYear, themes, positions),
    pickOrder: _buildDraftPickOrder(),
    picks: [],
    currentIdx: 0,
    targets: [],
    boardFilter: "ALL",
    _targetGone: [],
    classThemes: { multipliers: themes, chips: _classThemeChips(themes) },
    udfaPhase: false,       // becomes true after the last draft pick
    udfaUserClaims: [],     // user's UDFA scramble picks
  };
  franchise.draftScouts = [];
  franchise.draftScoutReveals = {};
  franchise.phase = "draft";
  franchise._faLossesPending = {};
  franchise._faSignsPending  = {};
  saveFranchise();
  renderFrnDraft();
}

// ── Compensatory picks ──────────────────────────────────────────────────────
// Real-NFL rule (simplified): teams that lose more qualifying FAs than they
// sign get bonus picks at the end of rounds 3-7. Pick quality scales with
// AAV of the departed player. Per-team cap 4; league cap 32.
const _COMP_PICK_AAV_BRACKETS = [
  { minAAV: 25, round: 3 },
  { minAAV: 15, round: 4 },
  { minAAV:  8, round: 5 },
  { minAAV:  3, round: 6 },
  { minAAV:  0, round: 7 },
];
const _COMP_PICK_PER_TEAM_CAP = 4;
const _COMP_PICK_LEAGUE_CAP = 32;

function _compPickRoundForAAV(aav) {
  for (const b of _COMP_PICK_AAV_BRACKETS) if (aav >= b.minAAV) return b.round;
  return 7;
}

// User comp pick allocations from the current offseason's tracked
// losses/signings. AI teams get hash-based allocations so the league
// still has natural comp-pick variance without us simulating their FA.
function _computeCompPicks(forDraftYear) {
  const out = [];
  const myId = franchise.chosenTeamId;
  const losses = (franchise._faLossesPending?.[myId] || []).slice()
    .sort((a, b) => (b.marketAAV || 0) - (a.marketAAV || 0));
  const signs  = (franchise._faSignsPending?.[myId] || []).slice()
    .filter(s => (s.aav || 0) >= 3)
    .sort((a, b) => (b.aav || 0) - (a.aav || 0));
  // Each qualifying signing offsets the lowest-AAV remaining loss
  // (NFL's "net loss" rule). Take top _COMP_PICK_PER_TEAM_CAP after offsets.
  const netLossCount = Math.max(0, losses.length - signs.length);
  const netLosses = losses.slice(0, Math.min(netLossCount, _COMP_PICK_PER_TEAM_CAP));
  for (const loss of netLosses) {
    out.push({
      teamId: myId,
      round:  _compPickRoundForAAV(loss.marketAAV || 0),
      playerName: loss.name,
      aav: loss.marketAAV || 0,
    });
  }
  // AI teams: deterministic hash-based allocation keyed on (season, team)
  // so a given league still gets consistent comp picks across renders.
  const seed = ((franchise.season || 0) * 73) ^ ((forDraftYear || 0) * 19);
  for (const t of TEAMS) {
    if (t.id === myId) continue;
    let h = seed ^ ((t.id + 1) * 2654435761) | 0;
    h = Math.abs(h);
    // 35% chance 1 pick · 15% chance 2 picks · 5% chance 3 picks · else 0
    const r0 = h % 100;
    const count = r0 < 5 ? 3 : r0 < 20 ? 2 : r0 < 55 ? 1 : 0;
    for (let i = 0; i < count; i++) {
      // Per-pick AAV from a different bit slice — 0-28M range
      const aavSeed = ((h >>> (i * 5)) & 0x3f) / 64;
      const aav = +(aavSeed * 28).toFixed(1);
      out.push({
        teamId: t.id,
        round:  _compPickRoundForAAV(aav),
        playerName: null,
        aav,
      });
    }
  }
  // Trim to league cap, dropping the lowest-AAV comps first.
  out.sort((a, b) => (b.aav || 0) - (a.aav || 0));
  return out.slice(0, _COMP_PICK_LEAGUE_CAP);
}

function _injectCompPicks(forDraftYear) {
  franchise._compPicksInjected = franchise._compPicksInjected || {};
  if (franchise._compPicksInjected[forDraftYear]) return;
  franchise.picks = franchise.picks || [];
  const comps = _computeCompPicks(forDraftYear);
  // Per-team-per-round counter so comp picks have unique trade keys
  // (a team can land two comps in the same round).
  const idxKey = new Map();
  for (const c of comps) {
    const key = `${c.teamId}-${c.round}`;
    const compIdx = idxKey.get(key) || 0;
    idxKey.set(key, compIdx + 1);
    franchise.picks.push({
      year: forDraftYear, round: c.round,
      originalTeamId: c.teamId, currentOwnerId: c.teamId,
      isComp: true, compIdx,
      compFor: c.playerName ? { playerName: c.playerName, aav: c.aav } : { aav: c.aav },
    });
  }
  franchise._compPicksInjected[forDraftYear] = comps.length;
  // News wire — only flag the user's awarded comps
  const myId = franchise.chosenTeamId;
  for (const c of comps) {
    if (c.teamId === myId) {
      const label = c.playerName
        ? `🎁 Awarded R${c.round} compensatory pick (for ${c.playerName})`
        : `🎁 Awarded R${c.round} compensatory pick`;
      _pushNews({ type: "draft", label });
    }
  }
}

// Per-year position-depth multipliers. Couples skill / trenches /
// secondary so years feel thematic ("passing class", "trench-heavy")
// rather than identically random. Returns multipliers in roughly
// [0.6, 1.6]; >1 = deep, <1 = thin.
function _rollClassThemes() {
  const r = () => 0.6 + Math.random() * 1.0;
  const skill     = r();   // QB · WR · TE move together
  const trenches  = r();   // OL · DL move together
  const secondary = r();   // CB · S move together
  return {
    QB: skill * (0.95 + Math.random() * 0.10),
    WR: skill * (0.95 + Math.random() * 0.10),
    TE: skill * (0.90 + Math.random() * 0.15),
    RB: 0.75 + Math.random() * 0.75,    // semi-independent
    OL: trenches * (0.95 + Math.random() * 0.10),
    DL: trenches * (0.95 + Math.random() * 0.10),
    LB: 0.85 + Math.random() * 0.45,    // semi-independent
    CB: secondary * (0.95 + Math.random() * 0.10),
    S:  secondary * (0.90 + Math.random() * 0.15),
    K:  0.90 + Math.random() * 0.30,
    P:  0.90 + Math.random() * 0.30,
  };
}

// Build the weighted position pool for one class. Base weights mirror
// roster needs (QB:3 RB:4 WR:6 OL:8 etc.) multiplied by the per-year
// theme. The returned array is what each pick samples from uniformly.
function _buildClassPositionPool(themes) {
  // Base weights track roster needs (QB:3 RB:4 WR:6 OL:9 etc.) so the class
  // produces ~proportional volume per position. Bumped CB/S/OL to match the
  // expanded ROSTER_SLOTS.
  const baseUnits = { QB:3, RB:4, WR:6, TE:3, OL:9, DL:5, LB:4, CB:5, S:3, K:1, P:1 };
  const pool = [];
  for (const pos of Object.keys(baseUnits)) {
    const count = Math.max(1, Math.round(baseUnits[pos] * (themes[pos] || 1)));
    for (let i = 0; i < count; i++) pool.push(pos);
  }
  return pool;
}

// Human-readable strength chips derived from the multipliers. Top-2
// boosted positions get a "Deep" chip; bottom-2 nerfed positions get a
// "Thin" chip. If nothing meaningfully diverges from the mean, returns
// a single "Balanced class" chip.
function _classThemeChips(themes) {
  const entries = Object.entries(themes).sort((a, b) => b[1] - a[1]);
  const deep = entries.filter(([, v]) => v >= 1.15).slice(0, 2).map(([p]) => p);
  const thin = entries.filter(([, v]) => v <= 0.85).slice(-2).map(([p]) => p);
  const chips = [];
  if (deep.length) chips.push({ text: `🔥 Deep at ${deep.join("/")}`, color: "var(--green-lt)" });
  if (thin.length) chips.push({ text: `⚠ Thin at ${thin.join("/")}`,  color: "#e8a000" });
  if (!chips.length) chips.push({ text: "— Balanced class", color: "var(--gray)" });
  return chips;
}

const _CLASS_DRAFTED_SIZE = 224;   // 7 rounds × 32 picks
const _CLASS_UDFA_SIZE    = 56;    // ~24% UDFA-tier prospects below the drafted slice

function _buildDraftClass(rookieYear, themesArg, positionsArg) {
  const allTaken = new Set();
  for (const r of Object.values(franchise.rosters)) r.forEach(p => allTaken.add(p.name));

  // Per-year themes drive position depth + show as class-strength chips.
  // Caller can pass pre-rolled themes/pool (frnGoToDraft does, so the
  // chips it stamps on franchise.draft match the actual class).
  const themes    = themesArg    || _rollClassThemes();
  const positions = positionsArg || _buildClassPositionPool(themes);

  const tierByRound = {
    1: () => Math.random() < 0.35 ? "elite" : "good",
    2: () => Math.random() < 0.20 ? "good"  : "average",
    3: () => Math.random() < 0.40 ? "average" : "poor",
    4: () => "poor", 5: () => "poor", 6: () => "poor", 7: () => "poor",
  };

  const cls = [];

  // Drafted-tier prospects: 7 rounds × 32 picks.
  for (let round = 1; round <= 7; round++) {
    for (let pick = 1; pick <= 32; pick++) {
      let pos = positions[Math.floor(Math.random() * positions.length)];
      // Specialists (K/P) almost never go in early rounds in real NFL.
      // Re-roll if a K/P was drawn for rounds 1-4 — push them into the
      // late rounds where the dropoff in OVR is invisible anyway.
      if ((pos === "K" || pos === "P") && round <= 4) {
        pos = positions[Math.floor(Math.random() * positions.length)];
        if ((pos === "K" || pos === "P") && round <= 4) {
          // Two K/P rolls in a row — replace with a high-volume position
          pos = ["WR","DL","OL","CB"][Math.floor(Math.random() * 4)];
        }
      }
      // K/P also cap at "good" max tier — even when they land in R1
      // (very rare), they don't roll elite stats. Real specialists are
      // OVR 70-78 in their prime, not 85+.
      let tier = tierByRound[round]();
      if ((pos === "K" || pos === "P") && tier === "elite") tier = "good";
      const p = genUniquePlayer(pos, tier, allTaken);
      allTaken.add(p.name);
      p.age = 21 + Math.floor(Math.random() * 3);
      p.draftYear = rookieYear;
      p.draftSeason = (franchise?.season || 1) + 1;
      p.isProspect = true;
      p._generatedRound = round;
      p.draftRound = round;
      p.potential = _rollPotential(p);
      p.collegeProfile = _buildCollegeProfile(p, round);
      p.careerHistory = []; p.careerStats = {}; p.career = []; p.careerTotals = {};
      p.proBowls = 0; p.allPros = 0; p.sbRings = 0;
      p.mvps = 0; p.opoys = 0; p.dpoys = 0; p.roys = 0; p.records = [];
      cls.push(p);
    }
  }

  // UDFA-tier prospects: another 56 below the draftable line. They're
  // scoutable + targetable during the draft, surface via the "UDFA" filter
  // tab, and feed the post-draft UDFA Scramble screen. Marked with
  // _generatedRound: 0 so existing potentialTag math treats them as UDFA
  // pedigree.
  for (let i = 0; i < _CLASS_UDFA_SIZE; i++) {
    const pos = positions[Math.floor(Math.random() * positions.length)];
    const p = genUniquePlayer(pos, "poor", allTaken);
    allTaken.add(p.name);
    p.age = 22;
    p.draftYear = rookieYear;
    p.draftSeason = (franchise?.season || 1) + 1;
    p.isProspect = true;
    p._generatedRound = 0;
    p.draftRound = 0;
    p.potential = _rollPotential(p);
    p.collegeProfile = _buildCollegeProfile(p, 7); // late-round-style knock notes
    p.careerHistory = []; p.careerStats = {}; p.career = []; p.careerTotals = {};
    p.proBowls = 0; p.allPros = 0; p.sbRings = 0;
    p.mvps = 0; p.opoys = 0; p.dpoys = 0; p.roys = 0; p.records = [];
    cls.push(p);
  }

  cls.sort((a, b) => (b.overall || 0) - (a.overall || 0));
  return cls;
}

// ── Draft order helpers ─────────────────────────────────────────────────────
// NFL-style playoff tier — teams that went deeper in the playoffs are
// pushed to the back of the round. Lower rank = picks earlier.
const _DRAFT_PLAYOFF_TIER = {
  "non_playoff": 0,
  "wc_loser":    1,
  "div_loser":   2,
  "sb_loser":    3,
  "champion":    4,
};

// Inspects franchise.playoffBracket to determine how a team finished.
// Returns one of: "champion" · "sb_loser" · "div_loser" · "wc_loser" ·
// "non_playoff". If the bracket isn't built yet (e.g. mid-season call),
// every team returns "non_playoff" so order falls back to pure
// reverse-standings.
function _teamPlayoffFinish(teamId) {
  const pb = franchise.playoffBracket;
  if (!pb || !pb.rounds) return "non_playoff";
  if (pb.champion === teamId) return "champion";
  const sb = pb.rounds[2]?.[0];
  if (sb && sb.winnerId && sb.winnerId !== teamId &&
      (sb.homeId === teamId || sb.awayId === teamId)) return "sb_loser";
  for (const g of (pb.rounds[1] || [])) {
    if (g.winnerId && g.winnerId !== teamId &&
        (g.homeId === teamId || g.awayId === teamId)) return "div_loser";
  }
  for (const g of (pb.rounds[0] || [])) {
    if (g.winnerId && g.winnerId !== teamId &&
        (g.homeId === teamId || g.awayId === teamId)) return "wc_loser";
  }
  return "non_playoff";
}

// Strength of schedule = average win-percentage of opponents played this
// season (weighted by how many times you played them). Used as the NFL
// tiebreaker: lower SOS = you played weaker teams and still got this
// record, so you pick earlier.
function _strengthOfSchedule(teamId) {
  const oppGameCount = new Map();
  for (const g of (franchise.schedule || [])) {
    if (!g.played) continue;
    let oppId;
    if (g.homeId === teamId)      oppId = g.awayId;
    else if (g.awayId === teamId) oppId = g.homeId;
    else continue;
    oppGameCount.set(oppId, (oppGameCount.get(oppId) || 0) + 1);
  }
  let weightedWin = 0;
  let totalGames = 0;
  for (const [oppId, gc] of oppGameCount) {
    const s = franchise.standings?.[oppId] || { w: 0, l: 0, t: 0 };
    const total = (s.w || 0) + (s.l || 0) + (s.t || 0);
    if (total <= 0) continue;
    const winPct = ((s.w || 0) + (s.t || 0) * 0.5) / total;
    weightedWin += winPct * gc;
    totalGames  += gc;
  }
  return totalGames > 0 ? weightedWin / totalGames : 0;
}

function _buildDraftPickOrder() {
  // Pick slot order = NFL-style:
  //  · Non-playoff teams (1..N-8) sorted reverse standings, SOS tiebreaker
  //  · Wild Card losers (N-7..N-4) sorted same way
  //  · Divisional losers (N-3..N-2)
  //  · SB loser (N-1), SB winner (N)
  // The actual team making the pick is the CURRENT owner of that pick
  // (whoever traded for it); the slot position is set by the ORIGINAL
  // owner's reverse-standings rank.
  const sorted = TEAMS.slice().sort((a, b) => {
    const tierA = _DRAFT_PLAYOFF_TIER[_teamPlayoffFinish(a.id)] ?? 0;
    const tierB = _DRAFT_PLAYOFF_TIER[_teamPlayoffFinish(b.id)] ?? 0;
    if (tierA !== tierB) return tierA - tierB;
    const sa = franchise.standings?.[a.id] || { w:0, l:0, pf:0, pa:0 };
    const sb = franchise.standings?.[b.id] || { w:0, l:0, pf:0, pa:0 };
    const wlA = sa.w - sa.l;
    const wlB = sb.w - sb.l;
    if (wlA !== wlB) return wlA - wlB;
    // NFL tiebreaker: strength of schedule — lower opponent win% picks
    // first (you faced an easier road and still ended with this record).
    const sosA = _strengthOfSchedule(a.id);
    const sosB = _strengthOfSchedule(b.id);
    if (Math.abs(sosA - sosB) > 0.001) return sosA - sosB;
    // Final fallback: point differential (worse pick first), keeps the
    // sort deterministic when SOS is identical.
    const diffA = (sa.pf||0) - (sa.pa||0);
    const diffB = (sb.pf||0) - (sb.pa||0);
    return diffA - diffB;
  });
  // Use upcoming draft year (season + 1 in real-clock terms)
  const draftYear = (new Date().getFullYear()) + (franchise.season || 1);
  _ensurePicksForYear(draftYear);
  const order = [];
  const reverseIdx = (tId) => sorted.findIndex(t => t.id === tId);
  for (let r = 1; r <= 7; r++) {
    let inRound = 0;
    // Regular picks — 32 per round, slot position by reverse-standings of
    // the ORIGINAL owner.
    for (const origTeam of sorted) {
      const pick = (franchise.picks || []).find(p =>
        p.year === draftYear && p.round === r && p.originalTeamId === origTeam.id && !p.isComp);
      const ownerId = pick?.currentOwnerId ?? origTeam.id;
      inRound += 1;
      order.push({
        round: r, teamId: ownerId, originalTeamId: origTeam.id,
        year: draftYear, isComp: false, pickInRound: inRound,
      });
    }
    // Compensatory picks — appended to end of rounds 3-7, sorted by
    // recipient team's reverse-standings (worst comp-recipient picks
    // first among the comp tier).
    if (r >= 3) {
      const comps = (franchise.picks || []).filter(p =>
        p.year === draftYear && p.round === r && p.isComp);
      comps.sort((a, b) => reverseIdx(a.originalTeamId) - reverseIdx(b.originalTeamId));
      for (const cp of comps) {
        inRound += 1;
        order.push({
          round: r, teamId: cp.currentOwnerId, originalTeamId: cp.originalTeamId,
          year: draftYear, isComp: true, pickInRound: inRound,
          compFor: cp.compFor,
        });
      }
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
    // After the last pick: hand off to the UDFA Scramble screen (new
    // saves) or fall back to immediate finalize (legacy saves with no
    // UDFA pool prepared).
    if (d.udfaPhase !== true && d.class.some(p => p._generatedRound === 0 && !d.picks.some(pk => pk.prospectName === p.name))) {
      d.udfaPhase = true;
      saveFranchise();
      renderFrnUDFAScramble();
      return;
    }
    if (d.udfaPhase === true) {
      renderFrnUDFAScramble();
      return;
    }
    const myPicksFinal = d.picks.filter(pk => pk.teamId === myId);
    _draftFinalize();
    _renderPostDraftGrade(myPicksFinal);
    return;
  }
  if (aiAdvanced > 0) _flushSaveFranchise();

  const currentSlot = d.pickOrder[d.currentIdx];
  const round = currentSlot.round;
  const pickInRound = currentSlot.pickInRound || ((d.currentIdx % 32) + 1);
  const isCurrentComp = !!currentSlot.isComp;
  const dayLabel = round <= 2 ? "DAY 1 · PRIMETIME" : round === 3 ? "DAY 2" : "DAY 3";
  const filter = d.boardFilter || "ALL";

  // Build available pool — sort by stable consensus score so scouting a
  // player doesn't shuffle them off the visible board. UDFA-tier
  // prospects (_generatedRound === 0) are hidden from the regular
  // filters and only appear under the "UDFA" filter tab.
  const taken = new Set(d.picks.map(p => p.prospectName));
  const draftablePool = d.class.filter(p => !taken.has(p.name) && p._generatedRound !== 0)
    .sort((a,b) => _draftBoardScore(b) - _draftBoardScore(a));
  const udfaPool = d.class.filter(p => !taken.has(p.name) && p._generatedRound === 0)
    .sort((a,b) => _draftBoardScore(b) - _draftBoardScore(a));
  const allAvail = filter === "UDFA" ? udfaPool : draftablePool;
  const filtered = filter === "UDFA" ? udfaPool
    : filter === "K/P" ? draftablePool.filter(p => p.position==="K"||p.position==="P")
    : filter === "ALL" ? draftablePool
    : draftablePool.filter(p => p.position === filter);
  // Scouted prospects live in their own visible lane above the main
  // board (filtered out of the main board to avoid dupes). Guarantees
  // they're always visible regardless of consensus rank.
  const scoutedSet = new Set(franchise.draftScouts || []);
  // Sort scouted by consensus too so they're stable.
  const scoutedLane = (filter === "ALL" || filter === "UDFA")
    ? d.class.filter(p => !taken.has(p.name) && scoutedSet.has(p.name))
        .sort((a, b) => _draftBoardScore(b) - _draftBoardScore(a))
    : filtered.filter(p => scoutedSet.has(p.name));
  const board = filtered.filter(p => !scoutedSet.has(p.name)).slice(0, 45);
  const targets = new Set(d.targets || []);
  _migrateDraftScouts();
  const scoutsList = franchise.draftScouts || [];
  const slotsUsed  = _draftScoutSlotsUsed();

  // Collect and clear target-gone alerts
  const gone = (d._targetGone || []).splice(0);

  // Position run
  const posRun = _draftPositionRun(d.picks);

  // ── Filter tabs ──────────────────────────────────────────────────────────
  const TABS = ["ALL","QB","RB","WR","TE","OL","DL","LB","CB","S","K/P","UDFA"];
  const filterHtml = TABS.map(f => {
    const cnt = f==="ALL"  ? draftablePool.length
      : f==="UDFA"         ? udfaPool.length
      : f==="K/P"          ? draftablePool.filter(p=>p.position==="K"||p.position==="P").length
      :                      draftablePool.filter(p=>p.position===f).length;
    let cls = f === "UDFA" ? "frn-draft-filter-btn udfa" : "frn-draft-filter-btn";
    if (cnt === 0) cls += " empty";
    if (f === filter) cls += " active";
    return `<button class="${cls}" onclick="frnDraftSetFilter('${f}')">${f} <span style="opacity:.55;font-size:.52rem">${cnt}</span></button>`;
  }).join("");

  // ── Class strengths chips (per-year theme display) ───────────────────────
  const chips = d.classThemes?.chips || [];
  const chipsHtml = chips.length
    ? `<div class="frn-draft-class-chips">${chips.map(c =>
        `<span style="color:${c.color};border-color:${c.color}55">${c.text}</span>`
      ).join("")}</div>`
    : "";

  // ── Prospect board ───────────────────────────────────────────────────────
  _migrateDraftScouts();
  const slotsUsedCats = _draftScoutSlotsUsed();
  const renderProspectCard = (p, displayRank) => {
    const esc = (p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const needLvl = _draftNeedLevel(myId, p.position);
    const needBadge = needLvl===2 ? `<span class="frn-draft-need-crit">❗NEED</span>`
                    : needLvl===1 ? `<span class="frn-draft-need-need">⚠ NEED</span>` : "";
    const isTargeted    = targets.has(p.name);
    const scoutedCats   = _draftScoutCategories(p.name);
    const isScouted     = scoutedCats.length > 0;
    const scoutRevealed = isScouted && _isDraftScoutRevealed(p.name);
    const slotsLeft     = DRAFT_SCOUT_SLOTS - slotsUsedCats;
    const potTag = potentialTag(p, { known: false, scoutRevealed });
    const comp = _draftNFLComp(p);
    const arch = _archetypeLabel(p) || "—";
    const meta = comp ? `${arch} · ${comp}` : arch;
    const knockCat = p.collegeProfile?.knockType ? _DRAFT_KNOCK_CATEGORY[p.collegeProfile.knockType] : null;
    // Projected-round badge — derived from where this prospect was
    // generated. UDFA-tier (round 0) labels as "~UDFA".
    const genR = p._generatedRound;
    const projRoundLabel = genR === 0 ? "~UDFA" : genR ? `~R${genR}` : "";

    // 4-category scout cluster
    const catButtons = DRAFT_SCOUT_CATEGORIES.map(c => {
      const meta = DRAFT_SCOUT_CAT_META[c];
      const has = scoutedCats.includes(c);
      const canAdd = !has && slotsLeft > 0;
      const disabled = !has && !canAdd;
      return `<button class="frn-dp-cat-btn${has?" active":""}" data-cat="${c}"
        onclick="frnDraftScoutCategory('${esc}','${c}')"
        title="${has?`Remove ${meta.label} scout`:disabled?"Scout slots full":`${meta.label} scout · ${meta.desc} · ${slotsLeft-1} slots left`}"
        ${disabled ? 'disabled style="opacity:.3;cursor:not-allowed"' : ''}
        style="${has?`color:${meta.color};border-color:${meta.color}aa;background:${meta.color}15`:""}">${meta.icon}</button>`;
    }).join("");

    // Per-category intel reveals — only show what's been scouted
    const intelBits = [];
    const rev = franchise.draftScoutReveals?.[p.name];
    if (scoutedCats.includes("medical")) {
      const risk = _draftScoutMedicalRisk(p);
      const note = rev?.knockNotes?.medical;
      intelBits.push(`<span style="color:${risk.color}">🏥 Medical risk <b>${risk.label}</b></span>${note?` · <span style="color:var(--green-lt)">${note}</span>`:""}`);
    }
    if (scoutedCats.includes("film")) {
      const note = rev?.knockNotes?.film;
      const reveal = rev?.revealed ? " · <span style=\"color:var(--gold-lt)\">potential confirmed</span>" : "";
      intelBits.push(`<span style="color:var(--gold-lt)">🎬 Film study</span>${note?` · <span style="color:var(--green-lt)">${note}</span>`:""}${reveal}`);
    }
    if (scoutedCats.includes("interview")) {
      const fit = _draftScoutSchemeFit(p);
      const note = rev?.knockNotes?.interview;
      intelBits.push(`<span style="color:#aaffaa">🗣 Scheme fit <b style="color:${fit.color}">${fit.label}</b></span>${note?` · <span style="color:var(--green-lt)">${note}</span>`:""}`);
    }
    if (scoutedCats.includes("workout")) {
      const line = _draftScoutWorkoutLine(p);
      const note = rev?.knockNotes?.workout;
      intelBits.push(`<span style="color:#aaccff">🎯 Workout</span> · ${line}${note?` · <span style="color:var(--green-lt)">${note}</span>`:""}`);
    }
    const intelHtml = intelBits.length
      ? `<div class="frn-dp-intel">${intelBits.map(b => `<div class="frn-dp-intel-row">${b}</div>`).join("")}</div>`
      : "";

    const knockHint = p.collegeProfile?.knock
      ? `<div style="font-size:.58rem;color:#e8a000;margin-top:.06rem">⚠ ${p.collegeProfile.knock}${knockCat?`<span style="color:var(--gray);font-weight:400"> · ${DRAFT_SCOUT_CAT_META[knockCat].icon} ${DRAFT_SCOUT_CAT_META[knockCat].label} can resolve</span>`:""}</div>`
      : "";

    return `<div class="frn-draft-prospect${isTargeted?" targeted":""}${isScouted?" scouted":""}">
      <div class="frn-dp-rank">${displayRank}</div>
      <div class="frn-dp-body">
        <div class="frn-dp-top">
          <span class="frn-dp-name">${p.name}</span>
          ${_posPillHtml(p.position)}
          ${needBadge}
          ${gradeBadge(p)}
          ${projRoundLabel ? `<span style="font-size:.55rem;color:var(--gold-lt);letter-spacing:.3px;font-weight:700">${projRoundLabel}</span>` : ""}
          ${isScouted ? `<span style="font-size:.52rem;color:var(--green-lt);font-weight:700;letter-spacing:.3px">SCOUTED ${scoutedCats.length}/4</span>` : ""}
          ${potTag?`<span style="font-size:.56rem;color:var(--gold-lt)">${potTag}</span>`:""}
          <span style="color:var(--gray);font-size:.56rem">Age ${p.age}</span>
        </div>
        <div class="frn-dp-bottom">
          <span class="frn-dp-meta">${meta}</span>
          <span class="frn-dp-combine"> · ${_draftCombineStr(p)}</span>
        </div>
        ${p.collegeProfile?.line ? `<div style="font-size:.58rem;color:var(--gray);margin-top:.1rem">${p.collegeProfile.line}</div>` : ""}
        ${knockHint}
        ${intelHtml}
      </div>
      <div class="frn-dp-actions">
        <button class="frn-draft-target-btn${isTargeted?" active":""}" onclick="frnDraftToggleTarget('${esc}')" title="${isTargeted?"Remove target":"Mark as target"}">★</button>
        <div class="frn-dp-cat-cluster">${catButtons}</div>
        <button class="btn btn-gold" style="padding:.2rem .5rem;font-size:.6rem" onclick="frnDraftPick('${esc}')">DRAFT</button>
      </div>
    </div>`;
  };
  const boardHtml = board.length
    ? board.map((p, i) => renderProspectCard(p, `#${i+1}`)).join("")
    : `<div style="color:var(--gray);font-size:.7rem;padding:.5rem">No ${filter!=="ALL"?filter:""} prospects available</div>`;

  // ── Scouted lane (your prospects, always visible) ────────────────────────
  const scoutedLaneHtml = scoutedLane.length
    ? `<div class="frn-draft-scouted-lane">
        <div class="frn-draft-scouted-header">🔍 YOUR SCOUTED PROSPECTS · ${scoutedLane.length}</div>
        ${scoutedLane.map(p => renderProspectCard(p, "🔍")).join("")}
      </div>`
    : "";

  // ── Live ticker ──────────────────────────────────────────────────────────
  const tickerHtml = d.picks.length ? d.picks.slice().reverse().slice(0,30).map(pk => {
    const team = getTeam(pk.teamId);
    const isMe = pk.teamId === myId;
    return `<div class="frn-draft-ticker-item${isMe?" my-pick":""}">
      <span class="frn-draft-ticker-pick-no">${pk.round}.${pk.pickInRound ?? (((pk.pick-1)%32)+1)}${pk.isComp ? "c" : ""}</span>
      <span><span style="font-weight:700">${pk.prospectName}</span><span style="color:var(--gray);font-size:.57rem"> · ${pk.pos}</span></span>
      <span style="color:var(--gray);font-size:.6rem">${team?.name||"?"}</span>
    </div>`;
  }).join("") : `<div style="color:var(--gray);font-size:.64rem;font-style:italic">No picks yet</div>`;

  // ── Team needs ───────────────────────────────────────────────────────────
  const NEED_POSITIONS = ["QB","RB","WR","TE","OL","DL","LB","CB","S"];
  const needLevels = {};
  for (const pos of NEED_POSITIONS) needLevels[pos] = _draftNeedLevel(myId, pos);
  const needsHtml = NEED_POSITIONS.map(pos => {
    const top = (franchise.rosters[myId]||[]).filter(p=>p.position===pos).sort((a,b)=>b.overall-a.overall)[0];
    const lvl = needLevels[pos];
    const badge = lvl===2 ? `<span style="color:#ff9090;font-size:.53rem;font-weight:700">CRITICAL</span>`
      : lvl===1 ? `<span style="color:var(--gold);font-size:.53rem;font-weight:700">NEED</span>`
      : `<span style="color:var(--gray);font-size:.53rem">OK</span>`;
    return `<div class="frn-draft-need-row">
      <span style="font-weight:700;font-size:.64rem;min-width:2rem">${pos}</span>
      <span style="color:var(--gray);font-size:.58rem">${top?`OVR ${top.overall}`:"—"}</span>
      <span style="margin-left:auto">${badge}</span>
    </div>`;
  }).join("");

  // ── Best at need ────────────────────────────────────────────────────────
  // Top-ranked available prospect at each of your top 3 position needs.
  // Reduces filter-tab clicking when you have a clear hole to fill.
  const needPositions = NEED_POSITIONS
    .filter(pos => needLevels[pos] > 0)
    .sort((a, b) => needLevels[b] - needLevels[a])
    .slice(0, 3);
  const bestAtNeedRows = needPositions.map(pos => {
    const best = draftablePool.find(p => p.position === pos);
    if (!best) return `<div class="frn-draft-best-row">
      <span style="font-weight:700;font-size:.64rem;min-width:2rem">${pos}</span>
      <span style="color:var(--gray);font-size:.58rem;font-style:italic">none left</span>
    </div>`;
    const sg = scoutGrade(best);
    const lvl = needLevels[pos];
    const lvlColor = lvl === 2 ? "#ff9090" : "var(--gold)";
    return `<div class="frn-draft-best-row" onclick="frnDraftSetFilter('${pos}')" title="Filter to ${pos}">
      <span style="font-weight:700;font-size:.64rem;min-width:2rem;color:${lvlColor}">${pos}</span>
      <span style="font-size:.62rem;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${best.name}</span>
      <span style="color:var(--gray);font-size:.55rem">${sg}</span>
    </div>`;
  }).join("");
  const bestAtNeedHtml = bestAtNeedRows ? `<div class="frn-draft-info-card">
    <div class="frn-card-title" style="margin-bottom:.25rem">⚡ BEST AT NEED</div>
    ${bestAtNeedRows}
  </div>` : "";

  // ── Your class ───────────────────────────────────────────────────────────
  const myPicks = d.picks.filter(pk=>pk.teamId===myId);
  const myPicksHtml = myPicks.length ? myPicks.map(pk=>`
    <div class="frn-draft-ticker-item my-pick">
      <span class="frn-draft-ticker-pick-no">R${pk.round}.${pk.pickInRound ?? (((pk.pick-1)%32)+1)}${pk.isComp ? "c" : ""}</span>
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
    ${chipsHtml}
    ${posRun?`<div class="frn-draft-run-alert">🔥 ${posRun.pos} RUN — ${posRun.cnt} taken in last 6 picks · value elsewhere</div>`:""}
    ${alertsHtml}
    <div style="display:grid;grid-template-columns:1fr 270px;gap:.65rem;align-items:start">
      <div>
        <div class="frn-draft-clock-card">
          <div>
            <div style="font-size:.58rem;color:var(--gold);letter-spacing:.6px">ROUND ${round} · PICK ${pickInRound}${isCurrentComp ? `<span style="color:var(--gold-lt);margin-left:.3rem">· COMP</span>` : ""}</div>
            <div style="font-size:1.15rem;font-weight:900;color:var(--gold-lt)">YOU ARE ON THE CLOCK</div>
            <div style="color:var(--gray);font-size:.73rem">${myTeam?.city} ${myTeam?.name}</div>
          </div>
          <button class="btn btn-outline" style="font-size:.6rem;padding:.22rem .55rem;white-space:nowrap"
            onclick="frnSimRound()">⏭ Sim Rest of R${round}</button>
        </div>
        <div class="frn-draft-filters">${filterHtml}</div>
        ${scoutedLaneHtml}
        <div class="frn-draft-board">${boardHtml}</div>
      </div>
      <div class="frn-draft-info-panel">
        <div class="frn-draft-info-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem">
            <div class="frn-card-title">TEAM NEEDS</div>
            <div style="font-size:.6rem;color:${slotsUsed>=DRAFT_SCOUT_SLOTS?"var(--red)":"var(--green-lt)"}">
              🔍 ${slotsUsed}/${DRAFT_SCOUT_SLOTS} scouts
            </div>
          </div>
          ${needsHtml}
        </div>
        ${bestAtNeedHtml}
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

const DRAFT_SCOUT_SLOTS = 8;
const DRAFT_SCOUT_CATEGORIES = ["medical", "film", "interview", "workout"];
const DRAFT_SCOUT_CAT_META = {
  medical:   { icon: "🏥", label: "Medical",   color: "#ff9090",
               desc: "Medical risk dial · resolves injury/durability concerns" },
  film:      { icon: "🎬", label: "Film",      color: "var(--gold-lt)",
               desc: "50% potential reveal · resolves scheme/technique concerns" },
  interview: { icon: "🗣", label: "Interview", color: "#aaffaa",
               desc: "Scheme fit · resolves character/production concerns" },
  workout:   { icon: "🎯", label: "Workout",   color: "#aaccff",
               desc: "Sharpened measurables · resolves combine concerns" },
};
// Which scout category resolves each knock type. Categories also produce
// generic intel even when the prospect's knock isn't in their domain.
const _DRAFT_KNOCK_CATEGORY = {
  injury: "medical", medical: "medical", durability: "medical",
  short_arms: "medical", weight_concern: "medical",
  system_player: "film", scheme_fit: "film", technique: "film",
  converted: "film", pass_blocking: "film", coverage: "film",
  size: "film", range: "film", box_only: "film",
  one_year_wonder: "interview", production_drop: "interview",
  combine_flop: "workout", small_school: "workout",
  accuracy: "workout", leg_strength: "workout",
  directional: "workout", consistency: "workout",
};

function _draftScoutSlotsUsed() {
  let n = 0;
  const reveals = franchise.draftScoutReveals || {};
  for (const r of Object.values(reveals)) {
    if (r?.categories?.length) n += r.categories.length;
    else if (r) n += 1; // legacy single-scout entry
  }
  return n;
}

function _draftScoutHasCategory(name, cat) {
  const rev = franchise.draftScoutReveals?.[name];
  if (rev?.categories) return rev.categories.includes(cat);
  if (rev && cat === "film") return true; // legacy treated as film scout
  return false;
}

// Returns true if film-category scouting unlocked the full-potential reveal
// (50% odds, set once per film-cat assignment and stable).
function _isDraftScoutRevealed(name) {
  const val = franchise.draftScoutReveals?.[name];
  if (!val) return false;
  if (typeof val === "boolean") return val; // legacy saves
  return !!(val.revealed);
}

// Stable per-prospect hash for category-specific deterministic intel.
function _draftProspectHash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Medical risk dial — combines knock type + age + a stable hash so the
// dial is consistent across re-renders. Returns { level: "low"|"med"|"high", label, color }.
function _draftScoutMedicalRisk(prospect) {
  const knock = prospect?.collegeProfile?.knockType || "";
  const isMed = _DRAFT_KNOCK_CATEGORY[knock] === "medical";
  const age = prospect?.age || 22;
  const h = _draftProspectHash(prospect?.name || "");
  let score = (h % 100);            // 0-99
  if (isMed) score += 30;            // medical knock = much more likely high
  if (age >= 23) score += 10;
  if (score >= 75) return { level: "high", label: "HIGH",  color: "#ff8a8a" };
  if (score >= 45) return { level: "med",  label: "MED",   color: "#e8a000" };
  return                   { level: "low",  label: "LOW",   color: "var(--green-lt)" };
}

// Scheme fit — hashed per (prospect, your team OC philosophy if any).
// Returns { fit: "good"|"neutral"|"poor", label, color }.
function _draftScoutSchemeFit(prospect) {
  const myId = franchise.chosenTeamId;
  const oc   = franchise.coaches?.[myId]?.oc;
  const ocStyle = oc?.style || "balanced";
  const h = _draftProspectHash((prospect?.name || "") + "::" + ocStyle);
  const score = h % 100;
  if (score >= 70) return { fit: "good",    label: "✓ GOOD",    color: "var(--green-lt)" };
  if (score >= 30) return { fit: "neutral", label: "— NEUTRAL", color: "var(--gray)" };
  return                   { fit: "poor",    label: "✗ POOR",    color: "#ff8a8a" };
}

// Workout reveal — sharpens combine measurables by un-fuzzing the listed
// 40-yard time. For now we surface the 40 time and a brief "athleticism
// score" derived from speed+agility ratings.
function _draftScoutWorkoutLine(prospect) {
  const m = (typeof combineMeasurables === "function") ? combineMeasurables(prospect) : {};
  const fortyTime = m.fortyTime || "—";
  const stats = prospect.stats || [];
  const [spd=50, str=50, agi=50] = stats;
  const ath = Math.round((spd * 0.5 + agi * 0.35 + str * 0.15));
  const ag = ath >= 85 ? "★ ELITE" : ath >= 78 ? "↗ STRONG" : ath >= 68 ? "— SOLID" : "▾ BELOW AVG";
  const agColor = ath >= 85 ? "var(--gold-lt)" : ath >= 78 ? "var(--green-lt)" : ath >= 68 ? "var(--gray)" : "#e8a000";
  return `40-yd <b>${fortyTime}</b>s · Athleticism <b style="color:${agColor}">${ag}</b>`;
}

// One-time migration to the new shape. Legacy: `draftScouts[name]` only,
// `draftScoutReveals[name] = { revealed, knockNote }`. New: each reveal
// stores a categories array + per-category notes.
function _migrateDraftScouts() {
  if (!franchise.draftScouts || !franchise.draftScoutReveals) return;
  if (franchise._draftScoutsMigrated) return;
  for (const name of franchise.draftScouts) {
    const rev = franchise.draftScoutReveals[name];
    if (rev && !rev.categories) {
      // Convert legacy "one scout" → film category (closest analog).
      rev.categories = ["film"];
      rev.knockNotes = rev.knockNote ? { film: rev.knockNote } : {};
      delete rev.knockNote;
    }
  }
  franchise._draftScoutsMigrated = true;
}

// Add or remove a scout category for a prospect. Each category costs 1
// slot. Toggling the same category clears it.
function frnDraftScoutCategory(name, cat) {
  if (!franchise.draft) return;
  if (!DRAFT_SCOUT_CATEGORIES.includes(cat)) return;
  _migrateDraftScouts();
  franchise.draftScouts       = franchise.draftScouts || [];
  franchise.draftScoutReveals = franchise.draftScoutReveals || {};
  let rev = franchise.draftScoutReveals[name];
  if (!rev) {
    rev = { categories: [], knockNotes: {}, revealed: false };
    franchise.draftScoutReveals[name] = rev;
  } else if (!rev.categories) {
    rev.categories = []; rev.knockNotes = rev.knockNotes || {};
  }
  const has = rev.categories.includes(cat);
  if (has) {
    rev.categories = rev.categories.filter(c => c !== cat);
    delete rev.knockNotes[cat];
    if (cat === "film") rev.revealed = false;
    if (!rev.categories.length) {
      delete franchise.draftScoutReveals[name];
      const idx = franchise.draftScouts.indexOf(name);
      if (idx !== -1) franchise.draftScouts.splice(idx, 1);
    }
  } else {
    if (_draftScoutSlotsUsed() >= DRAFT_SCOUT_SLOTS) return;
    rev.categories.push(cat);
    if (!franchise.draftScouts.includes(name)) franchise.draftScouts.push(name);
    const prospect   = franchise.draft.class.find(q => q.name === name);
    const knockType  = prospect?.collegeProfile?.knockType || null;
    const knockCat   = knockType ? _DRAFT_KNOCK_CATEGORY[knockType] : null;
    // If this category resolves the prospect's actual knock, generate the
    // dismiss/confirm note. Otherwise the category-specific intel
    // (medical risk dial / scheme fit / etc.) carries the value.
    if (knockType && knockCat === cat) {
      const r       = prospect?._generatedRound || 5;
      const expPot  = { 1:88,2:81,3:75,4:70,5:66,6:63,7:60,0:58 }[r] ?? 65;
      const isHiUp  = (prospect?.potential || 65) >= expPot + 4;
      rev.knockNotes[cat] = _buildScoutKnockNote(knockType, isHiUp);
    }
    // Film category triggers the potential-reveal roll (50% odds).
    if (cat === "film") rev.revealed = rev.revealed || (Math.random() < 0.50);
  }
  saveFranchise();
  renderFrnDraft();
}

// Back-compat shim — old callers used frnDraftScout(name). Route to the
// film category so existing UI paths keep working until everything is
// migrated.
function frnDraftScout(name) {
  frnDraftScoutCategory(name, "film");
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
      <span class="frn-draft-ticker-pick-no">R${pk.round}.${pk.pickInRound ?? (((pk.pick-1)%32)+1)}${pk.isComp ? "c" : ""}</span>
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
        <button class="btn btn-gold-big" onclick="frnConfirmDraftContinueToSeason()">▶ BEGIN NEW SEASON</button>
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
    pickInRound: slot.pickInRound, isComp: !!slot.isComp,
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
  // Carryover — pre-draft scouting persists into the rookie's first season
  // on your roster (one-year window via _playerNoiseBand's `within` helper).
  const scoutedCats = _draftScoutCategories(prospect.name);
  if (scoutedCats.length > 0) {
    prospect._scoutedAtDraftSeason = franchise.season;
    prospect._scoutedAtDraftCats   = scoutedCats.length;
  }
  franchise.rosters[slot.teamId].push(prospect);
  d.picks.push({
    pick: d.currentIdx + 1, round: slot.round,
    teamId: slot.teamId, prospectName: prospect.name, pos: prospect.position,
    pickInRound: slot.pickInRound, isComp: !!slot.isComp,
  });
  d.currentIdx++;
  saveFranchise();
  const pickLabel = `R${slot.round}.${slot.pickInRound}${slot.isComp ? "c" : ""}`;
  _pushNews({ type:"draft", label: `📋 You drafted ${prospect.name} (${prospect.position}) — ${pickLabel}` });
  renderFrnDraft();
}

// Finalize a UDFA-tier prospect into a signed player on a team. Mirrors
// the legacy synthetic-UDFA fields so the resulting roster entry is
// indistinguishable from a freshly-generated UDFA.
function _signUdfaTo(roster, prospect, rookieYear) {
  prospect.age = prospect.age || 22;
  prospect.draftRound = 0;
  prospect.draftPick = null;
  prospect.draftYear = rookieYear;
  prospect.draftSeason = (franchise?.season || 1) + 1;
  prospect.careerEarnings = 0;
  prospect.careerHistory = []; prospect.careerStats = {};
  prospect.career = []; prospect.careerTotals = {};
  prospect.proBowls = 0; prospect.allPros = 0; prospect.sbRings = 0;
  prospect.mvps = 0; prospect.opoys = 0; prospect.dpoys = 0;
  prospect.roys = 0; prospect.records = [];
  _rollHiddenGem(prospect);
  prospect.contract = rookieContract(prospect, franchise.salaryCap || SALARY_CAP_BASE);
  delete prospect.isProspect;
  roster.push(prospect);
}

function _draftFinalize() {
  const rookieYear = (new Date().getFullYear()) + (franchise.season || 1);
  const d = franchise.draft;
  // Pull from the in-class UDFA pool first (these were generated as part
  // of the draft class and have college profiles, knock notes, potential
  // rolls — much richer than the legacy synthetic UDFAs). When the pool
  // is exhausted, fall back to genUniquePlayer for the remaining gaps.
  const drafted = new Set((d?.picks || []).map(pk => pk.prospectName));
  const userClaimed = new Set(d?.udfaUserClaims || []);
  const claimedByAi = new Set(d?.udfaAiClaims?.map(c => c.name) || []);
  const remainingPool = (d?.class || []).filter(p =>
    p._generatedRound === 0 && !drafted.has(p.name) && !userClaimed.has(p.name) && !claimedByAi.has(p.name)
  );
  for (const t of TEAMS) {
    const roster = franchise.rosters[t.id];
    const taken = new Set(roster.map(p => p.name));
    for (const [pos, needed] of Object.entries(ROSTER_SLOTS)) {
      const have = roster.filter(p => p.position === pos).length;
      for (let i = have; i < needed; i++) {
        // Try to pull from the remaining UDFA pool first
        const poolIdx = remainingPool.findIndex(p => p.position === pos && !taken.has(p.name));
        let udfa;
        if (poolIdx !== -1) {
          udfa = remainingPool.splice(poolIdx, 1)[0];
        } else {
          udfa = genUniquePlayer(pos, "poor", taken);
        }
        _signUdfaTo(roster, udfa, rookieYear);
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

// ── UDFA Scramble ──────────────────────────────────────────────────────────
// After the last draft pick (incl. comp picks), the user is given a
// brief window to sign up to 3 priority UDFAs from the in-class pool.
// AI teams then claim 1-2 UDFAs each based on positional need, and the
// remaining roster gaps are filled by _draftFinalize.
const UDFA_USER_CLAIM_CAP = 3;

function frnDraftClaimUDFA(name) {
  const d = franchise.draft;
  if (!d?.udfaPhase) return;
  d.udfaUserClaims = d.udfaUserClaims || [];
  if (d.udfaUserClaims.includes(name)) return;
  if (d.udfaUserClaims.length >= UDFA_USER_CLAIM_CAP) {
    alert(`You can claim at most ${UDFA_USER_CLAIM_CAP} UDFAs.`);
    return;
  }
  d.udfaUserClaims.push(name);
  saveFranchise();
  renderFrnUDFAScramble();
}
function frnDraftUnclaimUDFA(name) {
  const d = franchise.draft;
  if (!d?.udfaPhase) return;
  d.udfaUserClaims = (d.udfaUserClaims || []).filter(n => n !== name);
  saveFranchise();
  renderFrnUDFAScramble();
}
function frnDraftSetUdfaFilter(pos) {
  if (!franchise.draft) return;
  franchise.draft.udfaFilter = pos;
  renderFrnUDFAScramble();
}

// AI teams scan the remaining pool and grab top-OVR UDFAs at positions
// where they have the biggest gap vs ROSTER_SLOTS.
function _runUdfaAiClaims() {
  const d = franchise.draft;
  if (!d) return;
  const myId = franchise.chosenTeamId;
  const claimedSet = new Set(d.udfaUserClaims || []);
  // Working pool — sorted by board score, mutable
  const pool = d.class.filter(p =>
    p._generatedRound === 0 && !claimedSet.has(p.name)
  ).sort((a, b) => _draftBoardScore(b) - _draftBoardScore(a));
  const aiClaims = [];
  for (const t of TEAMS) {
    if (t.id === myId) continue;
    const roster = franchise.rosters[t.id] || [];
    // Top 2 position needs
    const needs = [];
    for (const [pos, needed] of Object.entries(ROSTER_SLOTS)) {
      const have = roster.filter(p => p.position === pos).length;
      if (have < needed) needs.push({ pos, gap: needed - have });
    }
    needs.sort((a, b) => b.gap - a.gap);
    // Claim 1-2 UDFAs at the top need positions
    const claimsThisTeam = 1 + (Math.random() < 0.40 ? 1 : 0);
    for (let i = 0; i < claimsThisTeam && i < needs.length; i++) {
      const need = needs[i];
      const idx = pool.findIndex(p => p.position === need.pos);
      if (idx === -1) continue;
      const pick = pool.splice(idx, 1)[0];
      aiClaims.push({ teamId: t.id, name: pick.name, pos: pick.position });
    }
  }
  d.udfaAiClaims = aiClaims;
}

function frnDraftFinishScramble() {
  const d = franchise.draft;
  if (!d) return;
  const myId = franchise.chosenTeamId;
  const myRoster = franchise.rosters[myId];
  const rookieYear = (new Date().getFullYear()) + (franchise.season || 1);

  // Sign user's claimed UDFAs to their roster
  for (const name of (d.udfaUserClaims || [])) {
    const prospect = d.class.find(p => p.name === name);
    if (!prospect) continue;
    _signUdfaTo(myRoster, prospect, rookieYear);
  }

  // AI claims (computed once, persisted on the draft state for the recap)
  if (!d.udfaAiClaims) _runUdfaAiClaims();
  for (const c of (d.udfaAiClaims || [])) {
    const prospect = d.class.find(p => p.name === c.name);
    if (!prospect) continue;
    const roster = franchise.rosters[c.teamId] || [];
    _signUdfaTo(roster, prospect, rookieYear);
  }

  // Finalize fills remaining deficits and clears franchise.draft
  const myPicksFinal = d.picks.filter(pk => pk.teamId === myId);
  _draftFinalize();
  _renderPostDraftGrade(myPicksFinal);
}

function renderFrnUDFAScramble() {
  const d = franchise.draft;
  const myId = franchise.chosenTeamId;
  const myTeam = getTeam(myId);
  const myRoster = franchise.rosters[myId] || [];
  const claims = new Set(d.udfaUserClaims || []);
  const drafted = new Set(d.picks.map(pk => pk.prospectName));
  const filter = d.udfaFilter || "ALL";

  // Available pool — not drafted, not user-claimed, UDFA tier only
  const pool = d.class
    .filter(p => p._generatedRound === 0 && !drafted.has(p.name) && !claims.has(p.name))
    .sort((a, b) => _draftBoardScore(b) - _draftBoardScore(a));
  const filtered = filter === "K/P" ? pool.filter(p => p.position==="K"||p.position==="P")
    : filter === "ALL" ? pool : pool.filter(p => p.position === filter);

  // Position deficits on the user's roster (informational sidebar)
  const deficits = [];
  for (const [pos, needed] of Object.entries(ROSTER_SLOTS)) {
    const have = myRoster.filter(p => p.position === pos).length;
    if (have < needed) deficits.push({ pos, deficit: needed - have });
  }
  deficits.sort((a, b) => b.deficit - a.deficit);

  const claimedRows = (d.udfaUserClaims || []).map(name => {
    const p = d.class.find(q => q.name === name);
    if (!p) return "";
    return `<div class="frn-udfa-claim-row">
      <span style="font-weight:700">${p.name}</span>
      ${_posPillHtml(p.position)}
      ${gradeBadge(p)}
      <button class="btn btn-outline" onclick="frnDraftUnclaimUDFA('${(p.name||'').replace(/'/g,"\\'")}')">× Remove</button>
    </div>`;
  }).join("");

  const TABS = ["ALL","QB","RB","WR","TE","OL","DL","LB","CB","S","K/P"];
  const filterHtml = TABS.map(f => {
    const cnt = f==="ALL" ? pool.length
      : f==="K/P" ? pool.filter(p=>p.position==="K"||p.position==="P").length
      : pool.filter(p=>p.position===f).length;
    return `<button class="frn-draft-filter-btn${filter===f?" active":""}" onclick="frnDraftSetUdfaFilter('${f}')">${f} <span style="opacity:.55;font-size:.52rem">${cnt}</span></button>`;
  }).join("");

  const poolHtml = filtered.slice(0, 40).map((p, i) => {
    const esc = (p.name||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    const needLvl = _draftNeedLevel(myId, p.position);
    const needBadge = needLvl===2 ? `<span class="frn-draft-need-crit">❗NEED</span>`
                    : needLvl===1 ? `<span class="frn-draft-need-need">⚠ NEED</span>` : "";
    const arch = _archetypeLabel(p) || "—";
    const canClaim = claims.size < UDFA_USER_CLAIM_CAP;
    return `<div class="frn-draft-prospect">
      <div class="frn-dp-rank">#${i+1}</div>
      <div class="frn-dp-body">
        <div class="frn-dp-top">
          <span class="frn-dp-name">${p.name}</span>
          ${_posPillHtml(p.position)}
          ${needBadge}
          ${gradeBadge(p)}
          <span style="color:var(--gray);font-size:.56rem">Age ${p.age}</span>
        </div>
        <div class="frn-dp-bottom">
          <span class="frn-dp-meta">${arch}</span>
          <span class="frn-dp-combine"> · ${_draftCombineStr(p)}</span>
        </div>
        ${p.collegeProfile?.line ? `<div style="font-size:.58rem;color:var(--gray);margin-top:.1rem">${p.collegeProfile.line}</div>` : ""}
      </div>
      <div class="frn-dp-actions">
        <button class="btn btn-gold" ${canClaim?"":"disabled style=\"opacity:.35;cursor:not-allowed\""} onclick="frnDraftClaimUDFA('${esc}')">+ SIGN</button>
      </div>
    </div>`;
  }).join("") || `<div style="color:var(--gray);font-style:italic;text-align:center;padding:1rem">No UDFAs in this filter.</div>`;

  $("frnHomeContent").innerHTML = `
    <div class="frn-udfa-hero">
      <div class="frn-udfa-eyebrow">SEASON ${franchise.season + 1} · DRAFT COMPLETE</div>
      <h1 class="frn-udfa-title">🏷 UDFA SCRAMBLE</h1>
      <div class="frn-udfa-sub">Sign up to ${UDFA_USER_CLAIM_CAP} priority undrafted free agents before they're claimed by other teams.</div>
      <div class="frn-udfa-progress">${claims.size}/${UDFA_USER_CLAIM_CAP} signed</div>
    </div>

    ${claimedRows ? `<div class="frn-udfa-claimed-wrap">
      <div class="frn-card-title">✓ Signed</div>
      ${claimedRows}
    </div>` : ""}

    ${deficits.length ? `<div class="frn-udfa-deficit">
      <span style="color:var(--gold);font-weight:700;font-size:.7rem">Roster gaps:</span>
      ${deficits.map(n => `<span style="font-size:.65rem;color:#ff9090;margin-left:.5rem">${n.pos} (-${n.deficit})</span>`).join("")}
    </div>` : ""}

    <div style="display:grid;grid-template-columns:1fr;gap:.5rem;margin-top:.5rem">
      <div>
        <div class="frn-draft-filters">${filterHtml}</div>
        <div class="frn-draft-board">${poolHtml}</div>
      </div>
    </div>

    <div class="frn-off-footer" style="margin-top:1.2rem">
      <div class="frn-off-footer-title">READY TO FINISH?</div>
      <div class="frn-off-footer-sub">AI teams will claim 1-2 UDFAs each, then remaining roster gaps auto-fill.</div>
      <div class="frn-off-footer-cta">
        <button class="btn btn-gold-big" onclick="frnDraftFinishScramble()">✓ FINISH DRAFT →</button>
      </div>
    </div>`;
}

// Roll this season's per-game-aggregated stats into each player's
// career totals + season-by-season log. Idempotent — safe to call
// multiple times within a season; second call is a no-op.
function _rollSeasonStatsToCareer() {
  if (franchise._statsRolledForSeason === franchise.season) return;
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
      // Accumulate every numeric stat field. "Long" stats are maxima
      // not totals, so take max across seasons instead of summing.
      const MAX_STATS = new Set(["pass_long","rush_long","rec_long","fg_long","int_long","punt_long","kr_long","pr_long"]);
      for (const [k, v] of Object.entries(st)) {
        if (typeof v !== "number") continue;
        if (MAX_STATS.has(k)) {
          player.careerStats[k] = Math.max(player.careerStats[k] || 0, v);
        } else {
          player.careerStats[k] = (player.careerStats[k] || 0) + v;
        }
      }
      // RB cumulative wear tracking — feed the retirement curve's wear bump
      if (player.position === "RB") {
        const touches = (st.rush_att || 0) + (st.rec || 0);
        if (touches > 0) {
          player._careerTouches = (player._careerTouches || 0) + touches;
        }
      }
      // Snapshot this season as a row. If a placeholder row already
      // exists for this season (e.g. _stampSeasonAccolades pre-empted
      // us in an older code path or a re-render), merge the real stats
      // into it instead of pushing a duplicate. Otherwise push fresh.
      const existing = player.careerHistory.find(h => h.season === franchise.season);
      if (existing) {
        existing.teamId = teamId;
        existing.teamName = teamName;
        existing.overall = player.overall;
        existing.ovr = player.overall;
        existing.age = player.age;
        for (const [k, v] of Object.entries(st)) {
          if (typeof v === "number" || k === "pos") existing[k] = v;
        }
      } else {
        const yearRow = { season: franchise.season, teamId, teamName, overall: player.overall,
                          ovr: player.overall, age: player.age };
        for (const [k, v] of Object.entries(st)) {
          if (typeof v === "number" || k === "pos") yearRow[k] = v;
        }
        player.careerHistory.push(yearRow);
        if (player.careerHistory.length > 20) player.careerHistory = player.careerHistory.slice(-20);
      }
    }
  }
  franchise._statsRolledForSeason = franchise.season;
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
