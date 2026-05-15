// ─── BSPN live broadcast layer ──────────────────────────────────────────────
// Phase 1: presentation only. Consumes the same gameResult / playHead as
// the existing engine but re-shapes via toBSPNLiveGameState() so the
// markup never reaches into raw simulator internals.
//
// Architecture:
//   • Pure helpers (_bspnLive*) compute derived values from raw state.
//   • toBSPNLiveGameState(gameResult, playHead) is the only place that
//     reads from the engine. It returns a BSPNLiveGameState contract
//     consumed by every component.
//   • Each component (BSPNHeader, BSPNScoreboard, AsciiFieldViewer,
//     BoxScoreMiniPanel, TeamStatsMiniPanel, LastPlayPanel,
//     DriveSummaryPanel, NextUpPanel, PlayByPlayPanel,
//     TopPerformersPanel, BSPNBottomTicker, ScoreNumeral) is a pure
//     function with `.render(props)` returning an HTML string, plus
//     `.update(state)` for per-play in-place refresh.
//   • BSPNGameScreen composes all of the above into the full layout.
//
// TODO when engine exposes more data:
//   - play.formationSnap (per-play positions) would let AsciiFieldViewer
//     drop the static formation derivation.
//   - play.firstDownYardLine would replace the down+ytg derivation.
//   - play.shortLabel + play.resultText would let LastPlayPanel skip
//     the regex name highlighter.

function _bspnLiveAbbr(team) {
  if (!team) return "TBD";
  const c = (team.city || "").trim();
  const n = (team.name || "").trim();
  if (c && n) return (c[0] + n.slice(0, 2)).toUpperCase();
  return (n || "TBD").slice(0, 3).toUpperCase();
}
function _bspnLiveQuarterLabel(q) {
  if (q == null) return "—";
  if (q === 5) return "OT";
  return ["1ST","2ND","3RD","4TH"][q - 1] || `Q${q}`;
}
function _bspnLiveClock(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
}
function _bspnLiveDownLabel(play) {
  if (!play || !play.down || play.down < 1) return "";
  const ord = ["1ST","2ND","3RD","4TH"][play.down - 1] || `${play.down}TH`;
  return `${ord} & ${play.ytg ?? "—"}`;
}
function _bspnLiveYardLabel(play, homeT, awayT) {
  // play.yardLine is from the offense's perspective (0..100). We surface
  // a quick "MEM 28" style label using the possession team's abbr +
  // current ball spot.
  if (play?.yardLine == null) return "";
  const possT = play.poss === "home" ? homeT : awayT;
  const otherT = play.poss === "home" ? awayT : homeT;
  if (!possT) return "";
  const yl = play.yardLine;
  const abbr = yl > 50 ? _bspnLiveAbbr(otherT) : _bspnLiveAbbr(possT);
  const spot = yl > 50 ? (100 - yl) : yl;
  return `${abbr} ${spot}`;
}

// Compute a top-N performers list for either side from the latest
// statsSnap on `gameResult.plays`. Used by renderBSPN_TopPerformers.
function _bspnLiveTopPerformers(stats, side) {
  const players = Object.values(stats?.[side]?.players || {});
  if (!players.length) return [];
  const score = p =>
    (p.pass_yds||0) * 1.0 + (p.pass_td||0) * 25 - (p.pass_int||0) * 10 +
    (p.rush_yds||0) * 1.0 + (p.rush_td||0) * 18 +
    (p.rec_yds||0) * 1.0 + (p.rec_td||0) * 18 +
    (p.tkl||0) * 1.5 + (p.sk||0) * 6 + (p.int_made||0) * 12 +
    (p.fg_made||0) * 4;
  return players
    .map(p => ({ p, s: score(p) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map(x => {
      const p = x.p;
      let line = "";
      if (p.pos === "QB" && (p.pass_att||0) > 0) {
        line = `${p.pass_comp||0}-${p.pass_att||0}, ${p.pass_yds||0} YDS, ${p.pass_td||0} TD`;
      } else if (p.pos === "RB" || (p.rush_att||0) > 0) {
        line = `${p.rush_att||0} CAR, ${p.rush_yds||0} YDS${p.rush_td?`, ${p.rush_td} TD`:""}`;
      } else if (p.rec || p.rec_yds) {
        line = `${p.rec||0} REC, ${p.rec_yds||0} YDS${p.rec_td?`, ${p.rec_td} TD`:""}`;
      } else if (p.tkl || p.sk) {
        line = `${p.tkl||0} TKL${p.sk?`, ${p.sk} SK`:""}${p.int_made?`, ${p.int_made} INT`:""}`;
      } else if (p.fg_made || p.xp_made) {
        line = `${p.fg_made||0}/${p.fg_att||0} FG${p.xp_made?`, ${p.xp_made}/${p.xp_att||0} XP`:""}`;
      }
      return { name: p.name, pos: p.pos, statLine: line };
    });
}

// Derive a static 11v11 formation centered on the line of scrimmage.
// The engine doesn't expose per-frame player positions yet, so this
// supplies position data for any future HTML-rendered field overlay.
// AsciiFieldViewer currently leans on the canvas for live sprite
// rendering and only uses fieldPlayers for labels.
// TODO: once GameSimulator stamps play.formationSnap with real
// per-snap positions, replace this derivation with the snapshot.
function _bspnLiveFieldPlayers(curPlay, homeT, awayT, gr) {
  // Some play kinds (kickoff, halftime, quarter markers) don't carry
  // poss/yardLine. Walk back to the most recent snap-like play so the
  // field always has a positionable formation between drives.
  let snap = curPlay;
  if (!snap || snap.poss == null || snap.yardLine == null) {
    const plays = gr?.plays || [];
    for (let i = plays.length - 1; i >= 0; i--) {
      const p = plays[i];
      if (p.poss != null && p.yardLine != null) { snap = p; break; }
    }
  }
  if (!snap || snap.poss == null || snap.yardLine == null) return [];
  const losAbs = _bspnLiveAbsoluteYardLine(snap);
  const possTeam   = snap.poss === "home" ? homeT : awayT;
  const otherTeam  = snap.poss === "home" ? awayT : homeT;
  // Direction of attack: home drives toward yard 100, away toward yard 0.
  const dir = snap.poss === "home" ? +1 : -1;
  // Look up roster starters via gameResult.playerLookup if available.
  const findStarter = (team, pos) => {
    if (!gr?.homeRatings || !gr?.awayRatings) return null;
    const side = team === homeT ? "home" : "away";
    const r = side === "home" ? gr.homeRatings : gr.awayRatings;
    const st = r?.starters;
    if (!st) return null;
    return st[pos] || null;
  };
  const playerByName = name => gr?.playerLookup?.get?.(name) || null;
  const mkOffense = (role, dx, dy, posLabel, name) => ({
    id: `off-${role}`,
    playerId: playerByName(name)?.id ?? null,
    teamId: possTeam?.id ?? null,
    name: name || "",
    position: posLabel,
    jerseyNumber: playerByName(name)?.number || "",
    x: Math.max(0, Math.min(100, losAbs + dx * dir)),
    y: dy,
    role: "offense",
    hasBall: role === "QB",
    highlighted: false,
    spriteState: "ready",
    facing: dir > 0 ? "right" : "left",
  });
  const mkDefense = (role, dx, dy, posLabel) => ({
    id: `def-${role}`,
    playerId: null,
    teamId: otherTeam?.id ?? null,
    name: "",
    position: posLabel,
    jerseyNumber: "",
    x: Math.max(0, Math.min(100, losAbs + dx * dir)),
    y: dy,
    role: "defense",
    hasBall: false,
    highlighted: false,
    spriteState: "ready",
    facing: dir > 0 ? "left" : "right",
  });
  const out = [];
  // Offense — generic 11-man set
  out.push(mkOffense("QB",  -5, 0,      "QB", findStarter(possTeam, "qb")));
  out.push(mkOffense("RB",  -8, -0.4,   "RB", findStarter(possTeam, "rb")));
  out.push(mkOffense("WR1",  0, -0.85,  "WR", findStarter(possTeam, "wr1")));
  out.push(mkOffense("WR2",  0,  0.85,  "WR", findStarter(possTeam, "wr2")));
  out.push(mkOffense("WR3", -2, -0.65,  "WR", findStarter(possTeam, "wr3")));
  out.push(mkOffense("TE",   0,  0.55,  "TE", findStarter(possTeam, "te")));
  for (let i = 0; i < 5; i++) {
    out.push(mkOffense(`OL${i+1}`, 0, -0.4 + i * 0.2, "OL", null));
  }
  // Defense — generic 4-3 base
  for (let i = 0; i < 4; i++) {
    out.push(mkDefense(`DL${i+1}`, 1, -0.35 + i * 0.23, "DL"));
  }
  for (let i = 0; i < 3; i++) {
    out.push(mkDefense(`LB${i+1}`, 5, -0.45 + i * 0.45, "LB"));
  }
  out.push(mkDefense("CB1", 6, -0.85, "CB"));
  out.push(mkDefense("CB2", 6,  0.85, "CB"));
  out.push(mkDefense("S1", 12, -0.30, "S"));
  out.push(mkDefense("S2", 12,  0.30, "S"));
  return out;
}

// Convert offense-perspective yard line (0..100) to absolute from home
// goal line, so downstream consumers don't need to know whose offense
// is on the field.
function _bspnLiveAbsoluteYardLine(play) {
  if (!play || play.yardLine == null) return 50;
  // play.yardLine is from the offense's perspective: 0 = own goal,
  // 100 = opponent's goal. Convert to absolute (0 = home goal).
  return play.poss === "home" ? play.yardLine : (100 - play.yardLine);
}

// Derive first-down line in absolute coordinates from ytg + direction.
// TODO: drop once engine stamps play.firstDownYardLine.
function _bspnLiveFirstDownLine(play) {
  if (!play || play.yardLine == null || play.ytg == null) return null;
  const losAbs = _bspnLiveAbsoluteYardLine(play);
  const dir = play.poss === "home" ? +1 : -1;
  const fd = losAbs + (play.ytg * dir);
  return Math.max(0, Math.min(100, fd));
}

// Compact currentPlay block consumed by AsciiFieldViewer/LastPlayPanel.
function _bspnLiveCurrentPlay(curPlay, homeT, awayT) {
  if (!curPlay) return null;
  const losAbs = _bspnLiveAbsoluteYardLine(curPlay);
  const fd = _bspnLiveFirstDownLine(curPlay);
  // Short label = play kind in caps; result text = best-effort suffix
  // pulled from desc. TODO: read play.shortLabel + play.resultText if
  // the engine starts emitting them.
  const shortLabel = (curPlay.kind || "").toUpperCase().replace(/_/g, " ");
  let resultText = "";
  const desc = curPlay.desc || "";
  const m = desc.match(/for ([+-]?\d+ ?yards?)/i);
  if (m) resultText = `+${m[1].replace(/ ?yards?$/i, " yds")}`;
  return {
    id: `play-${curPlay.quarter}-${curPlay.time}-${curPlay.poss || "x"}`,
    description: desc,
    shortLabel,
    resultText,
    ballX: losAbs,
    ballY: 0,
    lineOfScrimmage: losAbs,
    firstDownLine: fd,
    paths: null,  // TODO: surface route/run paths once engine emits them
  };
}

/** Adapter: gameResult + playHead → BSPNLiveGameState. */
function toBSPNLiveGameState(gr, head) {
  if (!gr) return null;
  head = Math.max(0, Math.min(head ?? 0, gr.plays.length));
  // Walk back from head for the latest snapshot (kickoff/markers don't
  // carry one). Mirrors currentStats() but local to keep the adapter
  // self-contained.
  // `curPlay` here = most-recently-shown play (used for last-play
  // description, score, clock, drive accounting). The next-snap
  // situation (down/dist/yardLine/poss) lives on `nextSnapPlay`,
  // computed below — engine snapshots play.down/ytg as the PRE-snap
  // state of that play, so the next play's pre-snap fields are what
  // the scoreboard should show after a play completes.
  let snap = null;
  let curPlay = null;
  for (let i = head - 1; i >= 0; i--) {
    const p = gr.plays[i];
    if (!curPlay) curPlay = p;
    if (p.statsSnap) { snap = p.statsSnap; break; }
  }
  if (!snap) snap = { home: { team: {}, players: {} }, away: { team: {}, players: {} } };
  const homeT = gr.homeTeam, awayT = gr.awayTeam;
  const ended = head >= gr.plays.length;
  const last = curPlay || gr.plays[0];
  const homeScore = last?.homeScore ?? 0;
  const awayScore = last?.awayScore ?? 0;
  const winner = ended ? gr.winner : null;
  // The play whose pre-snap fields drive the scoreboard. Walk forward
  // from `head` skipping any non-snap markers (quarter / halftime /
  // 2-min warning / timeout / kickoff / fg_good / fg_miss / score)
  // until we find the next true snap. If the game has ended or there
  // is no upcoming snap, fall back to the most recently shown play.
  const NON_SNAP = new Set(["quarter","halftime","ot","two_min_warning","timeout","kickoff","fg_good","fg_miss","score","punt"]);
  let nextSnapPlay = null;
  for (let i = head; i < gr.plays.length; i++) {
    const p = gr.plays[i];
    if (p.poss != null && p.yardLine != null && p.down) { nextSnapPlay = p; break; }
  }
  // For situation display (down/dist/yardLine/poss), prefer the next
  // snap; if there isn't one (mid-marker, end of game), fall back to
  // the last completed play.
  const sitPlay = ended ? last : (nextSnapPlay || last);

  // Quarter scores: tally points per quarter from scoring events up to head.
  const qs = { 1: { home:0, away:0 }, 2: { home:0, away:0 }, 3: { home:0, away:0 }, 4: { home:0, away:0 } };
  for (let i = 0; i < head; i++) {
    const p = gr.plays[i];
    if (p.kind === "score" && p.poss && p.pts) {
      const q = Math.min(4, Math.max(1, p.quarter || 1));
      qs[q][p.poss] += p.pts;
    }
  }

  // Current drive — count plays + yards + clock since last drive
  // boundary. A drive boundary is any play whose kind ends a drive
  // (kickoff, score, punt, int, fumble, fg_good, fg_miss), or the
  // first play after one. Catches turnovers/punts/missed FGs that the
  // earlier "kickoff || score" heuristic missed.
  const DRIVE_END = new Set(["kickoff","score","punt","int","fumble","fg_good","fg_miss","halftime","ot"]);
  let driveStartIdx = 0;
  for (let i = head - 1; i >= 0; i--) {
    const p = gr.plays[i];
    if (DRIVE_END.has(p.kind)) {
      // If this very play IS a drive-end, the current drive started
      // AFTER it. If it's a regular play with a drive-end immediately
      // before it, the drive started AT this index.
      driveStartIdx = (i === head - 1) ? i : i + 1;
      break;
    }
  }
  const driveSlice = gr.plays.slice(driveStartIdx, head);
  const drivePlays = driveSlice.filter(p =>
    !["kickoff","quarter","halftime","ot","two_min_warning","timeout"].includes(p.kind)).length;
  const driveYards = driveSlice.reduce((s, p) => s + (p.yards || 0), 0);
  // Time elapsed since drive start (clock counts DOWN, so subtract)
  const startT = driveSlice[0]?.time ?? last?.time ?? 0;
  const endT   = last?.time ?? 0;
  const driveTimeSec = Math.max(0, startT - endT);

  // Play-by-play rows from the current drive (latest first)
  const pbpRows = [];
  for (let i = head - 1; i >= 0 && pbpRows.length < 12; i--) {
    const p = gr.plays[i];
    if (p.kind === "kickoff") {
      pbpRows.push({ kind: "drive-start", desc: "— DRIVE START —" });
      break;
    }
    if (["quarter","halftime","ot","two_min_warning"].includes(p.kind)) continue;
    const possT = p.poss === "home" ? homeT : awayT;
    pbpRows.push({
      kind: p.kind, q: `Q${p.quarter || "?"}`,
      t: _bspnLiveClock(p.time),
      poss: p.poss,
      teamAbbr: possT ? _bspnLiveAbbr(possT)[0] : "",
      teamColor: possT?.primary,
      dd: p.down ? `${p.down}-${p.ytg ?? "?"}` : "",
      ydLabel: _bspnLiveYardLabel(p, homeT, awayT),
      desc: p.desc || "",
    });
  }
  pbpRows.reverse();

  // Records / abbrev — use franchise if available, else first 3 chars
  const findRec = team => {
    if (!team) return null;
    const s = (typeof franchise !== "undefined" && franchise?.standings) ? franchise.standings[team.id] : null;
    if (!s) return null;
    return `${s.w||0}-${s.l||0}${s.t?`-${s.t}`:""}`;
  };

  // Last-play summary
  const lastPlayBlock = curPlay ? {
    desc: curPlay.desc || "",
    downLabel: _bspnLiveDownLabel(curPlay),
    yardLabel: _bspnLiveYardLabel(curPlay, homeT, awayT),
    poss: curPlay.poss,
    teamColor: curPlay.poss === "home" ? homeT?.primary : awayT?.primary,
    kind: curPlay.kind,
  } : null;

  // Next-up: derived from current state (down/distance/yard line)
  // NextUp panel shows the same upcoming-snap state as the scoreboard
  // (sitPlay), not the just-played one.
  let nextUp = null;
  if (sitPlay && !ended && sitPlay.down) {
    nextUp = {
      downLabel: _bspnLiveDownLabel(sitPlay),
      yardLabel: _bspnLiveYardLabel(sitPlay, homeT, awayT),
    };
  }

  // Top performers per side
  const topHome = _bspnLiveTopPerformers(snap, "home");
  const topAway = _bspnLiveTopPerformers(snap, "away");

  // Ticker items — accumulate notable events as the game progresses
  const tickerItems = [];
  for (let i = 0; i < head; i++) {
    const p = gr.plays[i];
    if (p.kind === "score" && p.pts >= 6) {
      const possT = p.poss === "home" ? homeT : awayT;
      tickerItems.push({ label: `${possT?.name || ""} TD`, text: p.desc || "Touchdown" });
    } else if (p.kind === "int" || p.kind === "fumble") {
      tickerItems.push({ label: "TURNOVER", text: p.desc || (p.kind === "int" ? "Interception" : "Fumble") });
    }
  }
  // Cap to last 8 to keep ticker tight
  while (tickerItems.length > 8) tickerItems.shift();

  // Bottom-line marquee text
  const leaderSide = homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : null;
  const bottomLine = ended
    ? (winner === "tie"
      ? `FINAL · ${homeT.name} ${homeScore} – ${awayT.name} ${awayScore} — TIE`
      : `FINAL · ${(winner === "home" ? homeT : awayT).name.toUpperCase()} WIN ${homeScore}-${awayScore}`)
    : leaderSide
      ? `${(leaderSide === "home" ? homeT : awayT).name.toUpperCase()} LEAD ${Math.max(homeScore,awayScore)}-${Math.min(homeScore,awayScore)} · ${_bspnLiveQuarterLabel(last?.quarter)} ${_bspnLiveClock(last?.time)}`
      : `${homeT.name} & ${awayT.name} TIED ${homeScore}-${homeScore} · ${_bspnLiveQuarterLabel(last?.quarter)} ${_bspnLiveClock(last?.time)}`;

  // Canonical BSPNLiveGameState. Legacy aliases (homeScore, awayScore,
  // quarterLabel, downLabel, yardLabel, poss, drive, boxScore, ticker)
  // kept alongside the new spec fields so old call sites don't break.
  const homeTeamObj = {
    id: homeT.id, name: homeT.name, city: homeT.city,
    abbr: _bspnLiveAbbr(homeT),
    primary: homeT.primary, secondary: homeT.secondary,
    record: findRec(homeT),
    asciiMark: typeof teamAscii === "function" ? teamAscii(homeT) : "",
  };
  const awayTeamObj = {
    id: awayT.id, name: awayT.name, city: awayT.city,
    abbr: _bspnLiveAbbr(awayT),
    primary: awayT.primary, secondary: awayT.secondary,
    record: findRec(awayT),
    asciiMark: typeof teamAscii === "function" ? teamAscii(awayT) : "",
  };
  // Situation fields come from `sitPlay` (next snap pre-state), not
  // `last` (just-completed play). Engine snapshots play.down/ytg as
  // pre-snap so the next play's pre-snap is what the scoreboard
  // should show after the current play wraps up.
  const possessionTeamId = sitPlay?.poss === "home" ? homeT.id : sitPlay?.poss === "away" ? awayT.id : null;
  const losAbs = _bspnLiveAbsoluteYardLine(sitPlay);
  const fdLine = _bspnLiveFirstDownLine(sitPlay);
  const yardLineText = _bspnLiveYardLabel(sitPlay, homeT, awayT);
  const downLabel = _bspnLiveDownLabel(sitPlay);

  return {
    // — Identity —
    gameId: `live-${homeT.id}-${awayT.id}`,

    // — Teams —
    homeTeam: homeTeamObj,
    awayTeam: awayTeamObj,

    // — Score —
    score: { home: homeScore, away: awayScore },

    // — Clock / quarter / status —
    quarter: _bspnLiveQuarterLabel(last?.quarter),
    clock: _bspnLiveClock(last?.time),
    status: ended ? "FINAL" : "LIVE",
    ended, winner,
    timeouts: last?.timeouts || { home: 3, away: 3 },

    // — Possession + situation — pulled from sitPlay (next snap)
    possessionTeamId,
    down: sitPlay?.down ?? null,
    distance: sitPlay?.ytg ?? null,
    downLabel,
    yardLineText,
    absoluteYardLine: losAbs,
    lineOfScrimmage: losAbs,
    firstDownLine: fdLine,

    // — Aggregates —
    quarterScores: [1,2,3,4].map(q => ({ q: `${q}`, home: qs[q].home, away: qs[q].away })),
    teamStats: {
      home: snap.home?.team || {},
      away: snap.away?.team || {},
    },

    // — Field —
    fieldPlayers: _bspnLiveFieldPlayers(sitPlay, homeT, awayT, gr),

    // — Plays —
    currentPlay: _bspnLiveCurrentPlay(sitPlay, homeT, awayT),
    lastPlay: lastPlayBlock,
    driveSummary: { plays: drivePlays, yards: driveYards, timeSec: driveTimeSec, resultText: null },
    nextUpText: nextUp ? `${nextUp.downLabel}${nextUp.yardLabel ? ` ON ${nextUp.yardLabel}` : ""}` : "",
    playByPlay: pbpRows,

    // — Stats & ticker —
    topPerformers: { home: topHome, away: topAway },
    tickerItems,
    bottomLine,
    weather: gr.weather || null,

    // — Legacy aliases (kept for now; remove once all callers migrate) —
    homeScore, awayScore,
    quarterLabel: _bspnLiveQuarterLabel(last?.quarter),
    yardLabel: yardLineText,
    poss: sitPlay?.poss || null,
    nextUp,
    drive: { plays: drivePlays, yards: driveYards, timeSec: driveTimeSec },
    boxScore: {
      home: { team: snap.home?.team || {}, players: snap.home?.players || {} },
      away: { team: snap.away?.team || {}, players: snap.away?.players || {} },
    },
    ticker: tickerItems,
  };
}

// ─── Components ─────────────────────────────────────────────────────────────
// Each component:
//   • render(props)  → HTML string. Pure, no DOM access.
//   • update(state)  → in-place innerHTML refresh of its mount target.
// All consume slices of BSPNLiveGameState (or sub-props) — never reach
// into raw gameResult internals.

const ScoreNumeral = {
  render({ value, color, muted }) {
    const cls = "bspnlive-score-num bspnlive-num" + (muted ? " muted" : "");
    const style = color && !muted ? ` style="color:${color}"` : "";
    return `<span class="${cls}"${style}>${value ?? 0}</span>`;
  },
};

const BSPNHeader = {
  render() {
    // PLAY-BY-PLAY is the implicit context during live game; show the
    // unified nav (SCORECENTER/STANDINGS/STATS/LEGACY/WIRE) so the user
    // can jump out of the game to a league surface. The dashboard
    // launcher will yank them back into the live view anyway.
    const navHtml = (typeof _bspnNavHtml === "function")
      ? _bspnNavHtml("PLAY-BY-PLAY")
      : "";
    return `<header class="bspnlive-header">
      <div>
        <div class="bspnlive-logo">BSPN</div>
        <div class="bspnlive-logo-sub">BALL. STRATEGY. PASSION. NOW.</div>
      </div>
      <nav class="bspnlive-nav" style="flex-wrap:wrap;gap:.7rem .9rem">${navHtml}</nav>
    </header>`;
  },
};

const BSPNScoreboard = {
  _teamBlock({ team, score, isWinner, otherWon, showPoss, right }) {
    const recHtml = team.record ? `<div class="bspnlive-score-record">(${team.record})</div>` : "";
    const possHtml = showPoss
      ? `<div class="bspnlive-score-poss" style="color:${team.primary};border-color:${team.primary}">● POSS</div>`
      : "";
    const muted = !isWinner && otherWon;
    return `<div class="bspnlive-score-team${right ? " right" : ""}" style="--team-color:${team.primary}">
      <pre class="bspnlive-score-mark">${team.asciiMark || ""}</pre>
      <div class="bspnlive-score-team-meta">
        <div class="bspnlive-score-rank"><span class="bspnlive-num">${team.abbr || ""}</span></div>
        <div class="bspnlive-score-name">${team.city || ""} ${team.name || ""}</div>
        ${recHtml}
        ${possHtml}
      </div>
      ${ScoreNumeral.render({ value: score, muted })}
    </div>`;
  },
  render(state) {
    const homeWon = state.winner === "home";
    const awayWon = state.winner === "away";
    const possHome = !state.ended && state.possessionTeamId === state.homeTeam.id;
    const possAway = !state.ended && state.possessionTeamId === state.awayTeam.id;
    const center = state.ended
      ? `<div class="bspnlive-score-meta">${state.status}</div>`
      : `<div class="bspnlive-score-quarter">${state.quarter} QTR</div>
         <div class="bspnlive-score-clock">${state.clock}</div>
         ${state.downLabel
            ? `<div class="bspnlive-score-down"><span class="bspnlive-num">${state.downLabel}</span><span class="bspnlive-score-down-sep">·</span><span class="bspnlive-num">${state.yardLineText || ""}</span></div>`
            : ""}`;
    return `<div id="scoreboard" class="bspnlive-score-strip">
      ${this._teamBlock({ team: state.awayTeam, score: state.score.away, isWinner: awayWon, otherWon: homeWon, showPoss: possAway })}
      <div class="bspnlive-score-center">
        <div class="bspnlive-score-meta">BSPN SATURDAY NIGHT FOOTBALL</div>
        ${center}
      </div>
      ${this._teamBlock({ team: state.homeTeam, score: state.score.home, isWinner: homeWon, otherWon: awayWon, showPoss: possHome, right: true })}
    </div>`;
  },
  update(state) {
    const el = document.getElementById("scoreboard");
    if (!el) return;
    el.outerHTML = this.render(state);
  },
};

const AsciiFieldViewer = {
  // Renders the field wrap with the engine's canvas as the live frame.
  // The canvas-based renderer continues to paint sprites; this component
  // owns the surrounding chrome + play caption.
  render(state) {
    return `<main class="bspnlive-center">
      <div class="bspnlive-field-title">WATCH LIVE</div>
      <div class="bspnlive-field-wrap field-wrap">
        <canvas id="field" width="${FIELD.W}" height="${FIELD.H}"></canvas>
        <div class="cinema-callout" id="cinemaCallout"></div>
        <div class="bspnlive-field-overlay field-overlay">
          <div class="field-status" id="fieldStatus">Pre-game</div>
          <div id="quarterClock">—</div>
        </div>
      </div>
      <div id="playCaption" class="bspnlive-play-caption play-caption">Game starting…</div>
      <div class="bspnlive-progress-label">
        <span id="progLabel">Play 0/0</span>
        <span id="quarterLabel"></span>
      </div>
      <div class="bspnlive-progress progress-bar">
        <div class="bspnlive-progress-fill progress-fill" id="progFill" style="width:0%"></div>
      </div>
    </main>`;
  },
  update(state) {
    // Caption text is owned by the play-animation loop (#playCaption).
    // No-op here — the canvas + caption are refreshed per frame, not
    // per BSPNGameScreen.update().
  },
};

const BoxScoreMiniPanel = {
  render(state) {
    return `<div id="bspnlive-boxscore">${this._body(state)}</div>`;
  },
  _body(state) {
    const qs = state.quarterScores || [];
    const head = qs.map(q => `<th>${q.q}</th>`).join("") + `<th>T</th>`;
    const aRow = qs.map(q => `<td>${q.away}</td>`).join("") + `<td><b>${state.score.away}</b></td>`;
    const hRow = qs.map(q => `<td>${q.home}</td>`).join("") + `<td><b>${state.score.home}</b></td>`;
    return `<table class="bspnlive-mini-table">
      <thead><tr><th></th>${head}</tr></thead>
      <tbody>
        <tr class="team-a"><td>${state.awayTeam.abbr}</td>${aRow}</tr>
        <tr class="team-h"><td>${state.homeTeam.abbr}</td>${hRow}</tr>
      </tbody>
    </table>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-boxscore");
    if (el) el.innerHTML = this._body(state);
  },
};

const TeamStatsMiniPanel = {
  render(state) {
    return `<div id="bspnlive-teamstats">${this._body(state)}</div>`;
  },
  _body(state) {
    const hT = state.teamStats?.home || {};
    const aT = state.teamStats?.away || {};
    const fmtTOP = v => `${Math.floor((v||0)/60)}:${String((v||0)%60).padStart(2,"0")}`;
    const rows = [
      ["1ST DOWNS",     hT.firstDowns, aT.firstDowns],
      ["RUSH YARDS",    hT.rushYds,    aT.rushYds],
      ["PASS YARDS",    hT.passYds,    aT.passYds],
      ["TOTAL YARDS",   hT.totalYds,   aT.totalYds],
      ["TURNOVERS",     hT.turnovers,  aT.turnovers],
      ["TIME OF POSS",  fmtTOP(hT.timeOfPoss), fmtTOP(aT.timeOfPoss)],
    ];
    return `<table class="bspnlive-mini-table">
      <thead><tr>
        <th></th>
        <th style="color:${state.awayTeam.primary}">${state.awayTeam.abbr}</th>
        <th style="color:${state.homeTeam.primary}">${state.homeTeam.abbr}</th>
      </tr></thead>
      <tbody>
        ${rows.map(([label, h, a]) => `<tr>
          <td>${label}</td>
          <td>${a ?? "0"}</td>
          <td>${h ?? "0"}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-teamstats");
    if (el) el.innerHTML = this._body(state);
  },
};

const LastPlayPanel = {
  render(state) {
    return `<div id="bspnlive-lastplay">${this._body(state)}</div>`;
  },
  _body(state) {
    if (!state.lastPlay) {
      return `<div class="bspnlive-lastplay-text" style="color:var(--blgray);font-style:italic">Waiting for first play…</div>`;
    }
    const p = state.lastPlay;
    // Highlight a leading "X. Lastname" so the player name pops as the
    // scorer/actor. TODO: drop once play.shortLabel is engine-stamped.
    const desc = (p.desc || "").replace(/^([A-Z]\. [A-Z][a-z]+)/, '<span class="scorer">$1</span>');
    return `
      <div class="bspnlive-lastplay-text">${desc}</div>
      ${p.downLabel
        ? `<div class="bspnlive-lastplay-down"><span class="bspnlive-num">${p.downLabel}</span>${p.yardLabel ? ` <span style="color:var(--blgray)">ON</span> <span class="bspnlive-num">${p.yardLabel}</span>` : ""}</div>`
        : ""}
    `;
  },
  update(state) {
    const el = document.getElementById("bspnlive-lastplay");
    if (el) el.innerHTML = this._body(state);
  },
};

const DriveSummaryPanel = {
  render(state) {
    return `<div id="bspnlive-drive">${this._body(state)}</div>`;
  },
  _body(state) {
    const d = state.driveSummary || { plays: 0, yards: 0, timeSec: 0 };
    return `<div class="bspnlive-stat-grid">
      <div class="k">PLAYS</div><div class="k">YARDS</div><div class="k">TIME</div>
      <div class="v">${d.plays}</div>
      <div class="v">${d.yards}</div>
      <div class="v">${_bspnLiveClock(d.timeSec)}</div>
    </div>${d.resultText ? `<div style="margin-top:.4rem;text-align:center;color:var(--blgold);font-size:.65rem;letter-spacing:1px">${d.resultText}</div>` : ""}`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-drive");
    if (el) el.innerHTML = this._body(state);
  },
};

const NextUpPanel = {
  render(state) {
    return `<div id="bspnlive-nextup">${this._body(state)}</div>`;
  },
  _body(state) {
    if (!state.nextUpText) {
      return `<div class="bspnlive-nextup" style="color:var(--blgray)">—</div>`;
    }
    return `<div class="bspnlive-nextup"><span class="bspnlive-num">${state.nextUpText}</span></div>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-nextup");
    if (el) el.innerHTML = this._body(state);
  },
};

const PlayByPlayPanel = {
  render(state) {
    return `<div id="bspnlive-pbp" class="bspnlive-pbp-list">${this._body(state)}</div>`;
  },
  _body(state) {
    const rows = (state.playByPlay || []).map(r => {
      if (r.kind === "drive-start") {
        return `<div class="bspnlive-pbp-row drive-start">${r.desc}</div>`;
      }
      return `<div class="bspnlive-pbp-row">
        <span class="q">${r.q} ${r.t}</span>
        <span class="t" style="color:${r.teamColor||"var(--blgreen)"}">${r.teamAbbr||""}</span>
        <span class="dd">${r.dd} ${r.ydLabel||""}</span>
        <span class="desc">${_bspnEsc(r.desc)}</span>
      </div>`;
    }).join("");
    return rows || `<div style="color:var(--blgray);font-style:italic;font-size:.7rem">Play-by-play will appear here.</div>`;
  },
  update(state) {
    const el = document.getElementById("bspnlive-pbp");
    if (!el) return;
    el.innerHTML = this._body(state);
    el.scrollTop = el.scrollHeight;
  },
};

const TopPerformersPanel = {
  render(state) {
    return `<div id="bspnlive-perf-body">${this._body(state)}</div>`;
  },
  _body(state) {
    const block = (team, list) => `
      <div class="bspnlive-perf-team" style="--team-color:${team.primary}">${team.city.toUpperCase()}</div>
      ${list.length
        ? list.map(p =>
            `<div class="bspnlive-perf-row">
              <span class="name">${_bspnEsc(p.name)}</span>
              <span class="stat">${_bspnEsc(p.statLine || "")}</span>
            </div>`).join("")
        : `<div style="color:var(--blgray);font-size:.7rem;font-style:italic">No stats yet.</div>`}`;
    return block(state.awayTeam, state.topPerformers?.away || []) +
           block(state.homeTeam, state.topPerformers?.home || []);
  },
  update(state) {
    const el = document.getElementById("bspnlive-perf-body");
    if (el) el.innerHTML = this._body(state);
  },
};

const BSPNBottomTicker = {
  render(state) {
    return `<div class="bspnlive-ticker-wrap">
      <span class="bspnlive-ticker-label">BSPN BOTTOM LINE</span>
      <div class="bspnlive-ticker">
        <div class="bspnlive-ticker-inner" id="bspnlive-ticker-inner">${this._body(state)}</div>
      </div>
      <span class="bspnlive-ticker-corner">[SCORES] · [SCHEDULE] · [SETTINGS]</span>
    </div>`;
  },
  _body(state) {
    const items = (state.tickerItems && state.tickerItems.length)
      ? state.tickerItems
      : [{ label: "BSPN", text: state.bottomLine || "GRIDIRON. CODE. GLORY." }];
    return items.map(it =>
      `<span class="bspnlive-ticker-item"><span class="lbl">${_bspnEsc(it.label)}:</span>${_bspnEsc(it.text)}</span>`
    ).join("");
  },
  update(state) {
    const el = document.getElementById("bspnlive-ticker-inner");
    if (el) el.innerHTML = this._body(state);
  },
};

const BSPNGameScreen = {
  render(state) {
    return `<div class="bspnlive-root" style="--away-color:${state.awayTeam.primary};--home-color:${state.homeTeam.primary}">
      ${BSPNHeader.render()}
      ${BSPNScoreboard.render(state)}
      <div class="bspnlive-body">
        <aside class="bspnlive-side left">
          <div class="bspnlive-panel">
            <div class="bspnlive-panel-title">BOX SCORE</div>
            ${BoxScoreMiniPanel.render(state)}
          </div>
          <div class="bspnlive-panel">
            <div class="bspnlive-panel-title">TEAM STATS</div>
            ${TeamStatsMiniPanel.render(state)}
          </div>
        </aside>
        ${AsciiFieldViewer.render(state)}
        <aside class="bspnlive-side right">
          <div class="bspnlive-panel">
            <div class="bspnlive-panel-title">LAST PLAY</div>
            ${LastPlayPanel.render(state)}
          </div>
          <div class="bspnlive-panel">
            <div class="bspnlive-panel-title">DRIVE SUMMARY</div>
            ${DriveSummaryPanel.render(state)}
          </div>
          <div class="bspnlive-panel">
            <div class="bspnlive-panel-title">NEXT UP</div>
            ${NextUpPanel.render(state)}
          </div>
        </aside>
      </div>
      <div class="bspnlive-bottom">
        <div class="bspnlive-pbp">
          <div class="bspnlive-panel-title bspnlive-pbp-title">PLAY-BY-PLAY</div>
          ${PlayByPlayPanel.render(state)}
          <div id="playLog" class="play-log" style="display:none"></div>
        </div>
        <aside class="bspnlive-perf">
          <div class="bspnlive-panel-title bspnlive-perf-title">TOP PERFORMERS</div>
          ${TopPerformersPanel.render(state)}
        </aside>
      </div>
      ${BSPNBottomTicker.render(state)}
      <!-- Hidden legacy nodes kept so existing render helpers don't blow up -->
      <div id="boxScore" style="display:none"></div>
      <table id="ratings" style="display:none"></table>
      <div id="driveLog" style="display:none"></div>
    </div>`;
  },
  update(state) {
    if (!document.querySelector(".bspnlive-root")) return;
    BSPNScoreboard.update(state);
    BoxScoreMiniPanel.update(state);
    TeamStatsMiniPanel.update(state);
    LastPlayPanel.update(state);
    DriveSummaryPanel.update(state);
    NextUpPanel.update(state);
    PlayByPlayPanel.update(state);
    TopPerformersPanel.update(state);
    BSPNBottomTicker.update(state);
  },
};

// Per-play refresh — called from the existing animation loop via the
// legacy renderScoreboard/renderBoxScore/renderPlayLog hooks.
function renderBSPNLive() {
  if (!gameResult || !document.querySelector(".bspnlive-root")) return;
  const state = toBSPNLiveGameState(gameResult, playHead);
  if (!state) return;
  BSPNGameScreen.update(state);
}

function renderGameLayout() {
  gameArea.classList.remove("empty");
  boxTab = "totals";
  // Compose the BSPN broadcast layout via named components. Initial state
  // is derived from the engine — same per-play state used by .update().
  const state = toBSPNLiveGameState(gameResult, playHead);
  gameArea.innerHTML = state ? BSPNGameScreen.render(state) : "";
  // Initial field draw — engine continues to own the canvas.
  const ctx = $("field").getContext("2d");
  if (viewMode === "cinema") {
    cinemaCamX = yardToWorldX(50);
    drawCinemaField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  } else {
    drawField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  }
}

