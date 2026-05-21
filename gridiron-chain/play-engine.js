// ─── Game simulator ───────────────────────────────────────────────────────
function normal(mean, sd) {
  const u1 = Math.random() || 0.0001, u2 = Math.random();
  return Math.round(mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sd);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function buildRatings(roster) {
  // Injured players (`weeksRemaining > 0`) are unavailable — exclude
  // them from depth-chart ratings so missing your QB1 actually hurts.
  const byPos = {};
  for (const p of roster) {
    if (p.injury && p.injury.weeksRemaining > 0) continue;
    (byPos[p.position] ||= []).push(p);
  }
  for (const k in byPos) byPos[k].sort((a,b) => b.overall - a.overall);
  // Flat top-n average — used only when one player matters (QB, K).
  const g = (pos, n) => {
    const arr = (byPos[pos] || []).slice(0, n);
    return arr.length ? arr.reduce((s,p) => s + p.overall, 0) / arr.length : 50;
  };
  // Weighted top-n average — best players matter more, so a single
  // superstar at OL/DL/CB actually moves the team's rating instead of
  // getting diluted by the bottom of the depth chart. Weight pattern:
  //   [3.5, 2.5, 1.5, 1.0, 0.5]  (best to 5th)
  // For OL n=5: best player carries ~39% of the rating; 5th player ~6%.
  // For DL n=4 / LB n=3 we slice the same weight array.
  const W = [3.5, 2.5, 1.5, 1.0, 0.5];
  const gw = (pos, n) => {
    const arr = (byPos[pos] || []).slice(0, n);
    if (!arr.length) return 50;
    const ws = W.slice(0, arr.length);
    const wSum = ws.reduce((a,b) => a+b, 0);
    return arr.reduce((s,p,i) => s + p.overall * ws[i], 0) / wSum;
  };
  return {
    offense: g("QB",1)*0.30 + gw("RB",2)*0.15 + gw("WR",4)*0.25 + g("TE",1)*0.10 + gw("OL",5)*0.20,
    defense: gw("DL",4)*0.30 + gw("LB",3)*0.30 + gw("CB",2)*0.25 + gw("S",2)*0.15,
    qb: g("QB",1), rb: gw("RB",2), wr: gw("WR",4), ol: gw("OL",5),
    dl: gw("DL",4), lb: gw("LB",3), cb: gw("CB",2), saf: gw("S",2),
    k:  g("K",1),
    starters: {
      qb:  (byPos.QB?.[0])?.name || "QB",
      rb:  (byPos.RB?.[0])?.name || "RB",
      rb2: (byPos.RB?.[1])?.name || null,    // second back — null if no viable depth
      wr1: (byPos.WR?.[0])?.name || "WR1",
      wr2: (byPos.WR?.[1])?.name || "WR2",
      // 3rd / 4th WR for 3-WR (TRIPS) and 4-WR (SPREAD/EMPTY) personnel.
      // Fall back to depth WRs (or wr2/wr1) if the team is thin at WR.
      wr3: (byPos.WR?.[2])?.name || (byPos.WR?.[1])?.name || (byPos.WR?.[0])?.name || "WR3",
      wr4: (byPos.WR?.[3])?.name || (byPos.WR?.[2])?.name || (byPos.WR?.[1])?.name || "WR4",
      te:  (byPos.TE?.[0])?.name || "TE",
      // 2nd TE for HEAVY (12) personnel.
      te2: (byPos.TE?.[1])?.name || (byPos.TE?.[0])?.name || "TE2",
      k:   (byPos.K?.[0])?.name  || "K",
      p:   (byPos.P?.[0])?.name  || (byPos.K?.[0])?.name || "P",  // Punter (fallback to K if missing)
      de1: byPos.DL?.[0]?.name || "LDE",
      dt1: byPos.DL?.[1]?.name || "LDT",
      dt2: byPos.DL?.[2]?.name || "RDT",
      de2: byPos.DL?.[3]?.name || "RDE",
      lb1: byPos.LB?.[0]?.name || "WLB",
      lb2: byPos.LB?.[1]?.name || "MLB",
      lb3: byPos.LB?.[2]?.name || "SLB",
      cb1: byPos.CB?.[0]?.name || "CB1",
      cb2: byPos.CB?.[1]?.name || "CB2",
      // Nickel/dime DBs for sub-package defense vs 3+ WR sets.
      cb3: (byPos.CB?.[2])?.name || (byPos.CB?.[1])?.name || (byPos.CB?.[0])?.name || "NB",
      cb4: (byPos.CB?.[3])?.name || (byPos.CB?.[2])?.name || (byPos.CB?.[1])?.name || "DB4",
      fs:  byPos.S?.[0]?.name  || "FS",
      ss:  byPos.S?.[1]?.name  || "SS",
    }
  };
}

class GameSimulator {
  constructor(home, away, hRoster, aRoster, opts) {
    this.home = home; this.away = away;
    this.hRoster = hRoster; this.aRoster = aRoster;
    // Optional gameday context: rivalry flag, home-field advantage.
    // Weather still auto-rolls in the constructor below; opts.weather
    // can override post-construction if a caller wants to force it.
    this.opts = opts || {};
    this.isRivalry = !!this.opts.isRivalry;
    this.homeFieldAdv = this.opts.homeFieldAdv !== false; // default on
    // Per-snap rotation targets, keyed by engine starter role
    // (qb/rb/wr1/wr2/te). Each value is the starter's intended
    // share as a 0..1 fraction; absent keys fall back to the legacy
    // touches-based rotation.
    this.homeSnaps = this.opts.homeSnaps || null;
    this.awaySnaps = this.opts.awaySnaps || null;
    this._playerByName = new Map();
    for (const p of hRoster) this._playerByName.set(p.name, p);
    for (const p of aRoster) this._playerByName.set(p.name, p);
    this.homePlaybook = getPlaybook(home); this.awayPlaybook = getPlaybook(away);
    this.homeDefPlaybook = getDefPlaybook(home); this.awayDefPlaybook = getDefPlaybook(away);
    this.homeR = buildRatings(hRoster); this.awayR = buildRatings(aRoster);
    // Home-field advantage: small bump to the home team's offense and
    // defense ratings — narrative small but cumulatively meaningful
    // across a 14-game season. Tunable; ~+1.5 each side.
    if (this.homeFieldAdv !== false) {
      this.homeR.offense += 1.5;
      this.homeR.defense += 1.5;
    }
    // Extract archetypes for the starting unit. Injured players (weeksRemaining > 0)
    // are excluded — same rule as buildRatings — so an injured top-5 OL doesn't
    // get a ghost 0-line in the box score and an injured top-2 WR doesn't keep
    // donating its archetype bonus to the offense from the sidelines.
    const archetypesByPos = (roster, pos, n) => roster
      .filter(p => p.position === pos && !(p.injury && p.injury.weeksRemaining > 0))
      .sort((a, b) => b.overall - a.overall)
      .slice(0, n)
      .map(p => ({ name: p.name, archetype: p.archetype, overall: p.overall, stats: p.stats }));
    // Assigns LT/LG/C/RG/RT slots to the top-5 OL based on archetype + stats.
    // Tackles: best AGI / ATHLETIC. Center: best AWR / TECHNICIAN. Guards:
    // best STR / MAULER / PLUG / ANCHOR. Greedy: claim the best fit for
    // each slot in order.
    const assignOLPositions = (olList) => {
      if (!olList || olList.length === 0) return olList;
      const slots = ["LT", "LG", "C", "RG", "RT"];
      const scoreFor = (p, slot) => {
        const agi = p.stats?.[2] || 70;
        const str = p.stats?.[1] || 70;
        const awr = p.stats?.[3] || 70;
        const blk = p.stats?.[6] || 70;
        if (slot === "LT" || slot === "RT")
          return agi * 1.5 + blk * 0.8 + (p.archetype === "ATHLETIC" ? 22 : 0)
                                       + (p.archetype === "TECHNICIAN" ? 8 : 0);
        if (slot === "C")
          return awr * 1.5 + blk * 0.9 + (p.archetype === "TECHNICIAN" ? 18 : 0)
                                       + (p.archetype === "ANCHOR" ? 10 : 0);
        // LG / RG
        return str * 1.4 + blk * 0.8 + (p.archetype === "MAULER" ? 22 : 0)
                                     + (p.archetype === "PLUG"   ? 14 : 0)
                                     + (p.archetype === "ANCHOR" ? 10 : 0);
      };
      const used = new Set();
      const assigned = {};
      for (const slot of slots) {
        let bestP = null, bestScore = -Infinity;
        for (const p of olList) {
          if (used.has(p.name)) continue;
          const s = scoreFor(p, slot);
          if (s > bestScore) { bestScore = s; bestP = p; }
        }
        if (bestP) { assigned[slot] = bestP; used.add(bestP.name); }
      }
      return olList.map(p => {
        for (const slot of slots) {
          if (assigned[slot]?.name === p.name) return { ...p, subPos: slot };
        }
        return p;
      });
    };
    // Same idea for DL — LDE / LDT / RDT / RDE. SPEED archetypes →
    // edge; POWER / PLUG / PENETRATOR → interior.
    const assignDLPositions = (dlList) => {
      if (!dlList || dlList.length === 0) return dlList;
      const slots = ["LDE", "LDT", "RDT", "RDE"];
      const scoreFor = (p, slot) => {
        const spd = p.stats?.[0] || 70;
        const str = p.stats?.[1] || 70;
        const prs = p.stats?.[7] || 70;
        if (slot === "LDE" || slot === "RDE")
          return spd * 1.4 + prs * 1.0 + (p.archetype === "SPEED" ? 22 : 0)
                                       + (p.archetype === "TWEENER" ? 8 : 0);
        // LDT / RDT
        return str * 1.4 + prs * 0.7 + (p.archetype === "POWER" ? 18 : 0)
                                     + (p.archetype === "PLUG"  ? 14 : 0)
                                     + (p.archetype === "PENETRATOR" ? 12 : 0);
      };
      const used = new Set();
      const assigned = {};
      for (const slot of slots) {
        let bestP = null, bestScore = -Infinity;
        for (const p of dlList) {
          if (used.has(p.name)) continue;
          const s = scoreFor(p, slot);
          if (s > bestScore) { bestScore = s; bestP = p; }
        }
        if (bestP) { assigned[slot] = bestP; used.add(bestP.name); }
      }
      return dlList.map(p => {
        for (const slot of slots) {
          if (assigned[slot]?.name === p.name) return { ...p, subPos: slot };
        }
        return p;
      });
    };
    this.homeDL = assignDLPositions(archetypesByPos(hRoster, "DL", 4));
    this.awayDL = assignDLPositions(archetypesByPos(aRoster, "DL", 4));
    this.homeOL = assignOLPositions(archetypesByPos(hRoster, "OL", 5));
    this.awayOL = assignOLPositions(archetypesByPos(aRoster, "OL", 5));
    // Skill + secondary archetypes (used for per-play modifiers)
    const collectArch = (roster) => ({
      QB:  archetypesByPos(roster, "QB", 1)[0],
      RB:  archetypesByPos(roster, "RB", 1)[0],
      WR1: archetypesByPos(roster, "WR", 2)[0],
      WR2: archetypesByPos(roster, "WR", 2)[1],
      TE:  archetypesByPos(roster, "TE", 1)[0],
      LB:  archetypesByPos(roster, "LB", 3),
      CB:  archetypesByPos(roster, "CB", 2),
      S:   archetypesByPos(roster, "S",  2),
    });
    this.homeArch = collectArch(hRoster);
    this.awayArch = collectArch(aRoster);
    this.score = { home: 0, away: 0 };
    this.quarter = 1; this.time = 900;
    // ── WEATHER ── chosen once per game, affects passing/kicking/fumbles.
    //   CLEAR (60%) — no effect
    //   WINDY (15%) — deep ball + FG harder
    //   RAIN  (15%) — fumbles up, comp down, slight YAC bump
    //   SNOW  (5%)  — combined wind + rain, FG range crushed
    //   HOT   (5%)  — minor fatigue late
    {
      const r = Math.random();
      let label;
      if      (r < 0.60) label = "CLEAR";
      else if (r < 0.75) label = "WINDY";
      else if (r < 0.90) label = "RAIN";
      else if (r < 0.95) label = "SNOW";
      else               label = "HOT";
      // Wind direction (-1 = toward home goal, +1 = toward away goal).
      // Only meaningful for WINDY / SNOW.
      const windDir = Math.random() < 0.5 ? -1 : 1;
      // Wind strength 0..1 (only used for WINDY/SNOW)
      const windStrength = label === "WINDY" ? 0.5 + Math.random() * 0.5
                         : label === "SNOW"  ? 0.4 + Math.random() * 0.4
                         : 0;
      this.weather = { label, windDir, windStrength };
    }
    this.poss = Math.random() < 0.5 ? "home" : "away";
    this.yardLine = 25; this.down = 1; this.ytg = 10;
    this.plays = []; this.drives = [];
    // Timeouts: each team gets 3 per half. Reset at halftime.
    this.timeouts = { home: 3, away: 3 };
    this._twoMinWarned = { half1: false, half2: false };  // ensure we only push the marker once
    this.stats = {
      home: this._buildTeamStats(this.homeR.starters),
      away: this._buildTeamStats(this.awayR.starters),
    };
    // Register OL players so pancakes / sacks_allowed accumulate per-player
    for (const [side, olArr] of [["home", this.homeOL], ["away", this.awayOL]]) {
      for (const p of olArr || []) {
        if (p?.name && !this.stats[side].players[p.name])
          this.stats[side].players[p.name] = { name: p.name, pos: p.subPos || "OL", pid: p.pid || null, ...this._emptyLine() };
      }
    }
    this._lastBallCarrier = null; // who got the ball on the last positive play
    this._lastBallType = null;    // 'pass' | 'rush'
    // Save base starters so per-snap rotation can always sub back to
    // the depth-chart No. 1 unless the current context (fatigue / garbage
    // time) calls for a backup. `homeR.starters` mutates per snap; this
    // snapshot is the source of truth for "who's the official starter."
    this._baseStarters = {
      home: { ...this.homeR.starters },
      away: { ...this.awayR.starters },
    };
  }
  // True if the team with the ball is in 2-minute drill mode:
  // < 2:00 left in Q2 or Q4, and either trailing or tied (and 4th-quarter).
  _isTwoMinDrill() {
    if (this.time > 120) return false;
    if (this.quarter !== 2 && this.quarter !== 4) return false;
    const offScore = this.score[this.poss];
    const defScore = this.score[this.poss === "home" ? "away" : "home"];
    if (this.quarter === 2) return offScore <= defScore + 14;   // end of half — go for points
    return offScore <= defScore;   // 4th quarter — only if tied or behind
  }
  // AI decides whether to burn a timeout. Returns the team that called it, or null.
  // Called between plays in _drive(). Only fires when the clock would keep running.
  _maybeCallTimeout(prevResult) {
    if (this.time > 150 || this.time <= 5) return null;          // only late in halves
    if (this.quarter !== 2 && this.quarter !== 4) return null;
    if (prevResult?.incomplete || prevResult?.turnover) return null;  // clock already stopped
    if (prevResult?.endDrive) return null;
    const offTeam = this.poss;
    const defTeam = this.poss === "home" ? "away" : "home";
    const offScore = this.score[offTeam];
    const defScore = this.score[defTeam];
    const diff = offScore - defScore;
    // Offense calls TO if behind and clock running out
    if (this.timeouts[offTeam] > 0 && diff <= 0 && this.time < 120) {
      this.timeouts[offTeam]--;
      this.plays.push({
        kind: "timeout",
        desc: `Timeout — ${this[offTeam].city} ${this[offTeam].name}`,
        team: offTeam, quarter: this.quarter, time: this.time,
        timeoutsRemaining: { ...this.timeouts },
        homeScore: this.score.home, awayScore: this.score.away,
      });
      return offTeam;
    }
    // Defense calls TO if trailing big and worried opponent will run clock out
    if (this.timeouts[defTeam] > 0 && diff >= 1 && diff <= 16 && this.time < 130) {
      this.timeouts[defTeam]--;
      this.plays.push({
        kind: "timeout",
        desc: `Timeout — ${this[defTeam].city} ${this[defTeam].name} (defense)`,
        team: defTeam, quarter: this.quarter, time: this.time,
        timeoutsRemaining: { ...this.timeouts },
        homeScore: this.score.home, awayScore: this.score.away,
      });
      return defTeam;
    }
    return null;
  }
  // ── Rotation ──────────────────────────────────────────────────────────
  // Per-snap depth-chart rotation. Triggers:
  //   - Garbage time (game out of reach late) — both teams sub
  //   - Fatigue: starter accumulates touches over the game and rests
  // Starts each snap from this._baseStarters (depth-chart No. 1) and
  // optionally mutates this.offR.starters before the play runs so the
  // existing read sites (no plumbing changes) see the active player.
  _isGarbageTime() {
    const diff = Math.abs(this.score.home - this.score.away);
    if (this.quarter === 4 && this.time <= 600 && diff >= 17) return "heavy";
    if (this.quarter === 4 && diff >= 14) return "mild";
    if (this.quarter >= 3 && diff >= 28) return "mild";
    return null;
  }
  _pickBackup(side, position, excludeNames) {
    const roster = side === "home" ? this.hRoster : this.aRoster;
    const set = new Set(excludeNames);
    const candidates = roster.filter(p => p.position === position && !set.has(p.name))
      .sort((a, b) => (b.overall || 0) - (a.overall || 0));
    return candidates[0]?.name || null;
  }
  _ensurePlayerStat(side, name, pos) {
    if (!name) return;
    const players = this.stats[side].players;
    if (!players[name]) {
      const pid = this._playerByName?.get(name)?.pid || null;
      players[name] = { name, pos, pid, ...this._emptyLine() };
    }
  }
  _touchesFor(side, name) {
    const line = this.stats[side].players[name];
    if (!line) return 0;
    return (line.rush_att || 0) + (line.rec_tgt || 0);
  }
  _rotateForSnap() {
    const side = this.poss;
    // Always reset to base depth chart first, then optionally sub.
    Object.assign(this.offR.starters, this._baseStarters[side]);
    const garbage = this._isGarbageTime();
    const snapMap = side === "home" ? this.homeSnaps : this.awaySnaps;
    const trySub = (role, position) => {
      const cur = this.offR.starters[role];
      if (!cur) return;
      // Per-snap sub probability. Base comes from the user-set snap share
      // when present (1 - starterPct); garbage time + accumulated touches
      // can boost it but never lower it.
      const targetStarterPct = snapMap?.[role];
      let p = (targetStarterPct != null) ? Math.max(0, 1 - targetStarterPct) : 0;
      if (garbage === "heavy") p = Math.max(p, 0.55);
      else if (garbage === "mild") p = Math.max(p, 0.25);
      const t = this._touchesFor(side, cur);
      if (t >= 20)      p = Math.max(p, 0.40);
      else if (t >= 15) p = Math.max(p, 0.25);
      else if (t >= 10) p = Math.max(p, 0.12);
      if (p <= 0 || Math.random() > p) return;
      const exclude = Object.values(this.offR.starters);
      const backup = this._pickBackup(side, position, exclude);
      if (backup) {
        this.offR.starters[role] = backup;
        this._ensurePlayerStat(side, backup, position);
      }
    };
    trySub("rb",  "RB");
    trySub("wr1", "WR");
    trySub("wr2", "WR");
    trySub("te",  "TE");
    // QB only rotates in heavy garbage time — never on fatigue alone.
    if (garbage === "heavy" && Math.random() < 0.35) {
      const exclude = Object.values(this.offR.starters);
      const backup = this._pickBackup(side, "QB", exclude);
      if (backup) {
        this.offR.starters.qb = backup;
        this._ensurePlayerStat(side, backup, "QB");
      }
    }
  }

  _buildTeamStats(starters) {
    const players = {};
    const add = (name, pos) => { if (name && !players[name]) { const pid = this._playerByName?.get(name)?.pid || null; players[name] = { name, pos, pid, ...this._emptyLine() }; } };
    add(starters.qb, "QB");
    add(starters.rb, "RB");
    add(starters.wr1, "WR");
    add(starters.wr2, "WR");
    add(starters.te, "TE");
    add(starters.k,  "K");
    // Defensive starters get rows too
    add(starters.de1, "DE"); add(starters.de2, "DE");
    add(starters.dt1, "DT"); add(starters.dt2, "DT");
    add(starters.lb1, "LB"); add(starters.lb2, "LB"); add(starters.lb3, "LB");
    add(starters.cb1, "CB"); add(starters.cb2, "CB");
    add(starters.fs,  "FS"); add(starters.ss,  "SS");
    return {
      team: {
        plays: 0, totalYds: 0, passYds: 0, rushYds: 0,
        pass_att: 0, pass_comp: 0, rush_att: 0,
        sacks: 0, sacks_allowed: 0, turnovers: 0, takeaways: 0,
        firstDowns: 0, thirdAtt: 0, thirdConv: 0, fourthAtt: 0, fourthConv: 0,
        timeOfPoss: 0, penalties: 0, penaltyYds: 0,
      },
      players,
    };
  }
  _emptyLine() {
    return {
      pass_att: 0, pass_comp: 0, pass_yds: 0, pass_td: 0, pass_int: 0, pass_long: 0,
      sacks_taken: 0, sack_yds: 0,
      rush_att: 0, rush_yds: 0, rush_td: 0, rush_long: 0, broken_tackles: 0,
      fumbles: 0, fumbles_lost: 0,
      rec_tgt: 0, rec: 0, rec_yds: 0, rec_td: 0, rec_long: 0, rec_drops: 0,
      fg_made: 0, fg_att: 0, fg_long: 0, xp_made: 0, xp_att: 0,
      // Defensive stats
      tkl: 0, sk: 0, sk_yds: 0, int_made: 0, int_yds: 0, int_long: 0, int_td: 0,
      pd: 0, ff: 0, fr: 0, def_td: 0, missed_tkl: 0,
      // OL-specific
      pancakes: 0, sacks_allowed: 0,
    };
  }
  // Pick a defender (weighted by position) and credit a stat field
  _creditDefStat(field, weights) {
    const def = this.defStats;
    if (!def) return;
    const defStarters = this.defR.starters;
    // weights = { LB: 0.4, S: 0.3, DL: 0.15, CB: 0.15 }
    const pool = [];
    const addCandidate = (name, w) => { if (name) pool.push({ name, w }); };
    if (weights.LB) {
      addCandidate(defStarters.lb1, weights.LB);
      addCandidate(defStarters.lb2, weights.LB);
      addCandidate(defStarters.lb3, weights.LB);
    }
    if (weights.S) {
      addCandidate(defStarters.fs, weights.S);
      addCandidate(defStarters.ss, weights.S);
    }
    if (weights.DL) {
      addCandidate(defStarters.de1, weights.DL);
      addCandidate(defStarters.de2, weights.DL);
      addCandidate(defStarters.dt1, weights.DL);
      addCandidate(defStarters.dt2, weights.DL);
    }
    if (weights.CB) {
      addCandidate(defStarters.cb1, weights.CB);
      addCandidate(defStarters.cb2, weights.CB);
    }
    if (!pool.length) return null;
    const total = pool.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * total;
    let chosen = pool[pool.length - 1];
    for (const c of pool) { r -= c.w; if (r <= 0) { chosen = c; break; } }
    const p = def.players[chosen.name];
    if (p) p[field] = (p[field] || 0) + 1;
    return chosen.name;
  }
  get offR()       { return this.poss === "home" ? this.homeR : this.awayR; }
  get defR()       { return this.poss === "home" ? this.awayR : this.homeR; }
  get offPlaybook(){ return this.poss === "home" ? this.homePlaybook : this.awayPlaybook; }
  get defPlaybook(){ return this.poss === "home" ? this.awayDefPlaybook : this.homeDefPlaybook; }
  // Situational override: PREVENT defense when leading by 2+ scores late.
  // Falls back to the team's base scheme otherwise.
  get currentDefPlaybook() {
    const baseDef = this.defPlaybook;
    const offKey = this.poss, defKey = offKey === "home" ? "away" : "home";
    const defLead = this.score[defKey] - this.score[offKey];
    const lateGame = (this.quarter === 4 && this.time < 240) || this.quarter >= 5;
    if (lateGame && defLead >= 9) return DEF_PLAYBOOKS.PREVENT;
    // MLB AGGRESSION TILT — the MLB is the defense's playcaller. An aggressive
    // MLB (BLITZER, high PRS+TCK) overrides the team's base scheme on key downs:
    //   ≥80 → BLITZ_46 on 3rd-and-medium / 3rd-and-long
    //   ≤30 → DIME on obvious passing downs
    // Otherwise keep the team base.
    const agg = this._mlbAggression();
    const isPassingDown = (this.down === 3 && this.ytg >= 5) || (this.down === 4 && this.ytg >= 4);
    if (isPassingDown && agg >= 80) return DEF_PLAYBOOKS.BLITZ_46;
    if (isPassingDown && agg <= 30) return DEF_PLAYBOOKS.DIME;
    return baseDef;
  }
  get offOL()      { return this.poss === "home" ? this.homeOL : this.awayOL; }
  get defDL()      { return this.poss === "home" ? this.awayDL : this.homeDL; }
  get offArch()    { return this.poss === "home" ? this.homeArch : this.awayArch; }
  get defArch()    { return this.poss === "home" ? this.awayArch : this.homeArch; }
  // Pick a DL rep + OL rep for this play, weighted toward higher-rated guys
  _pickTrenchRep() {
    const dlList = this.defDL || [];
    const olList = this.offOL || [];
    const pickWeighted = (list) => {
      if (!list.length) return null;
      // Weights tilt toward higher overall; ^1.6 sharpens the bias
      const weights = list.map(p => Math.pow(Math.max(1, p.overall - 40), 1.6));
      const sum = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * sum;
      for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
      return list[list.length - 1];
    };
    // ── POSITION-AWARE MATCHUP ──
    // Prefer to use the actual SUB-POSITION assignments (LT/LG/C/RG/RT
    // vs LDE/LDT/RDT/RDE) — DEs face tackles, DTs face guards/center.
    // Falls back to archetype-lane filtering if sub-positions aren't set
    // (legacy roster compatibility).
    const isEdgeSlot = s => s === "LDE" || s === "RDE";
    const dl = pickWeighted(dlList);
    let olCandidates = olList;
    if (dl?.subPos) {
      // Edge DLs face tackles; interior DLs face guards / center.
      const wantSlots = isEdgeSlot(dl.subPos)
        ? new Set(["LT", "RT"])
        : new Set(["LG", "C", "RG"]);
      const matching = olList.filter(p => p.subPos && wantSlots.has(p.subPos));
      if (matching.length) olCandidates = matching;
    } else {
      // Archetype-lane fallback (older sims)
      const dlLane = t => t === "SPEED" ? "EDGE"
                        : (t === "POWER" || t === "PENETRATOR" || t === "PLUG") ? "INTERIOR"
                        : null;
      const olLane = t => t === "ATHLETIC" ? "EDGE"
                        : (t === "MAULER" || t === "ANCHOR" || t === "PLUG") ? "INTERIOR"
                        : null;
      const targetLane = dlLane(dl?.archetype);
      if (targetLane) {
        const matching = olList.filter(p => olLane(p.archetype) === targetLane);
        if (matching.length) olCandidates = matching;
      }
    }
    const ol = pickWeighted(olCandidates);
    return {
      dl, ol,
      dlType: dl?.archetype || "POWER",
      olType: ol?.archetype || "ANCHOR",
    };
  }
  get possTeam() { return this.poss === "home" ? this.home : this.away; }
  get offStats() { return this.stats[this.poss]; }
  get defStats() { return this.stats[this.poss === "home" ? "away" : "home"]; }
  _pushVisual(data) {
    this.plays.push({
      ...data,
      // Personnel + defensive package — selected once per snap in _play.
      // Pre-snap visuals (kickoff/score/punt) inherit the last selection.
      personnel: data.personnel || this._currentPersonnel || "BASE",
      defPackage: data.defPackage || this._currentDefPackage || "BASE_43",
      poss: this.poss,
      quarter: this.quarter,
      time: this.time,
      down: this.down,
      ytg: this.ytg,
      yardLine: this.yardLine,
      homeScore: this.score.home,
      awayScore: this.score.away,
      timeouts: { ...this.timeouts },
      statsSnap: JSON.parse(JSON.stringify(this.stats)),
    });
  }
  _score(pts, type) {
    this.score[this.poss] += pts;
    // Capture scorer for box-score display
    const scorer = (pts === 6 || pts === 2) ? (this._lastBallCarrier || null) : null;
    const passer = (pts === 6 && this._lastBallType === "pass") ? (this.offR.starters.qb || null) : null;
    const kicker = (type.includes("FG") || type === "Extra Point") ? (this.offR.starters.k || null) : null;
    this._pushVisual({
      kind: "score",
      desc: `${this.possTeam.city} ${this.possTeam.name} — ${type} (+${pts})`,
      scoreType: type,
      scorer, passer, kicker,
      poss: this.poss, pts,
      quarter: this.quarter,
      clockAfter: this.clock,
      homeScore: this.score.home,
      awayScore: this.score.away,
    });
  }
  // ── PLAYCALLER AGGRESSION ──────────────────────────────────────────────
  // The offense's QB and the defense's MLB call the plays in this league.
  // Their AGGRESSION rating drives 4th-down decisions, 2-pt try rate, deep
  // shots, audibles, blitz rate, etc. Derived from existing stats so we
  // don't have to extend the roster generator.
  //   QB aggression = 0.40 × THR + 0.30 × AWR + archetype delta
  //   LB aggression = 0.40 × PRS + 0.30 × TCK + archetype delta
  // Range ~20-99. 50 = neutral, 80+ = "go for it" risk-taker.
  _qbAggression() {
    const qb = this._playerByName.get(this.offR.starters.qb);
    if (!qb) return 50;
    const thr  = qb.stats?.[4] ?? 70;
    const awr  = qb.stats?.[3] ?? 70;
    const arch = qb.archetype;
    const archMod = arch === "GUNSLINGER"   ?  20
                  : arch === "DUAL_THREAT"  ?  10
                  : arch === "POCKET"       ?   0
                  : arch === "GAME_MANAGER" ? -15
                  : 0;
    return clamp(thr * 0.40 + awr * 0.30 + archMod, 20, 99);
  }
  _mlbAggression() {
    const lbName = this.defR.starters.lb2;  // MLB
    if (!lbName) return 50;
    const lb = this._playerByName.get(lbName);
    if (!lb) return 50;
    const prs = lb.stats?.[7] ?? 70;
    const tck = lb.stats?.[9] ?? 70;
    const arch = lb.archetype;
    const archMod = arch === "BLITZER" ?  20
                  : arch === "THUMPER" ?  10
                  : arch === "SIGNAL"  ?   0
                  : arch === "COVER"   ? -10
                  : 0;
    return clamp(prs * 0.40 + tck * 0.30 + archMod, 20, 99);
  }
  // Tilt multiplier centered on 50. Aggressive = >1.0, conservative = <1.0
  // Used to scale base probabilities (e.g. base * tilt). Aggression 80 → 1.30
  _aggTilt(agg) { return 1 + (agg - 50) / 100; }   // 20 → 0.70, 80 → 1.30
  // Handles the kickoff after any score (TD or FG). Decides whether the
  // kicking team should attempt an onside kick (trailing late) and sets
  // possession / yardLine accordingly. Pushes a kickoff visual either way.
  _kickoffAfterScore(scoringTeamKey) {
    const receivingKey = scoringTeamKey === "home" ? "away" : "home";
    const scoreDiff = this.score[scoringTeamKey] - this.score[receivingKey];
    const lateGame  = (this.quarter === 4 && this.time < 240) || this.quarter >= 5;
    const desperate = (this.quarter === 4 && this.time < 30)  || this.quarter >= 5;
    // Kicking team only tries an onside if they're STILL behind (or just
    // tied with little time), since recovering an onside is rare and a
    // failed onside hands the opponent great field position.
    const tryOnside = (lateGame  && scoreDiff <  0)
                   || (desperate && scoreDiff <= 0 && this.time < 60);
    if (tryOnside) {
      const recovered = Math.random() < 0.13;     // ~13% under modern rules
      const kicker = this[scoringTeamKey];
      const receiver = this[receivingKey];
      if (recovered) {
        this._pushVisual({
          kind: "kickoff",
          desc: `ONSIDE KICK — RECOVERED by ${kicker.name}! Ball at midfield.`,
          startYard: 35, endYard: 50,
          isOnside: true, onsideRecovered: true,
          poss: scoringTeamKey,
        });
        this.poss = scoringTeamKey;
        this.yardLine = 50;            // kicking team starts at the 50
      } else {
        this._pushVisual({
          kind: "kickoff",
          desc: `Onside kick attempt — recovered by ${receiver.name} at midfield`,
          startYard: 35, endYard: 50,
          isOnside: true, onsideRecovered: false,
          poss: receivingKey,
        });
        this.poss = receivingKey;
        this.yardLine = 50;            // receiving team starts at the 50
      }
    } else {
      // Standard kickoff. Modern NFL touchback rate is ~70-75% (the
      // 2024 dynamic kickoff rules cut touchbacks but most still go
      // to the EZ). Of returned kicks: average return ~22 yards,
      // with a long-tail chance of a big return or kickoff-return TD
      // (~0.3% of kickoffs become TDs in modern NFL).
      this.poss = receivingKey;
      const ret = this._resolveKickoffReturn(scoringTeamKey, receivingKey);
      this.yardLine = ret.endYL;
      if (ret.isTD) {
        // Kickoff returned for a TD — score it, then the kicking team
        // kicks AGAIN (per NFL rule).
        this._score(6, "Kickoff Return Touchdown!");
        const k = this.offR.starters.k, kStats = this.offStats.players[k];
        if (Math.random() < 0.92) {
          if (kStats) kStats.xp_att++;
          if (Math.random() < 0.94) { this._score(1, "Extra Point"); if (kStats) kStats.xp_made++; }
        }
        this._kickoffAfterScore(this.poss);
        return;
      }
    }
    this.down = 1; this.ytg = 10;
  }

  // Resolve a kickoff return when NOT a touchback. Returns the end
  // yardline + whether it went all the way for a TD.
  //   Touchback rate    ~ 70% → endYL 25
  //   Returned median   ~ 22 yards from the goal line (so endYL ~22)
  //   Returned long-tail ~ 0.3% of kickoffs are returned for a TD
  // The receiving team's KR (or RB1 / WR1 fallback) gets the return.
  _resolveKickoffReturn(kickerKey, receiverKey) {
    if (Math.random() < 0.72) return { endYL: 25, isTD: false };
    // Returned — pick a returner. The roster's KR-tagged player would
    // be ideal but most rosters don't tag one, so we use RB1 / WR1.
    const receiverR = receiverKey === "home" ? this.homeR : this.awayR;
    const receiverStats = this.stats[receiverKey];
    const returnerName = receiverR.starters?.kr
                       || receiverR.starters?.rb
                       || receiverR.starters?.wr1
                       || "Returner";
    // Base ~22 yards + noise. ~10% chance of a 40+ yard return; ~0.3%
    // chance the return goes the distance (75+ yards to a TD).
    let ret = 18 + Math.floor(Math.random() * 12);   // 18-29 (mean ~23.5)
    if (Math.random() < 0.10) ret += Math.floor(Math.random() * 20); // 10% chance to add 0-19 more
    // Credit KR stats — kr_yds + kr_td fields are referenced in HoF +
    // accolade tracking (play-franchise-season.js HoF, offseason
    // accolade thresholds), so we must update them or career returner
    // leaders go silently unrecorded. TD branch overrides with full
    // return distance (kick at 35 → 100 yards from kick spot).
    const rStats = receiverStats?.players?.[returnerName];
    if (Math.random() < 0.003) {
      // Touchdown return — credit FULL return distance, not the partial
      // 18-49 yd `ret` (which represents only the routine-return
      // distribution). 100 - 35 = 65 yds from the kick spot.
      if (rStats) {
        rStats.kr_yds = (rStats.kr_yds || 0) + 65;
        rStats.kr_td  = (rStats.kr_td  || 0) + 1;
      }
      this._pushVisual({
        kind: "kickoff",
        desc: `${returnerName} returns the kickoff ALL THE WAY — TOUCHDOWN!`,
        startYard: 35, endYard: 100,
        kicker: kickerKey, returner: returnerName,
        isReturnTD: true,
      });
      return { endYL: 100, isTD: true };
    }
    if (rStats) rStats.kr_yds = (rStats.kr_yds || 0) + ret;
    const endYL = Math.min(50, ret);
    this._pushVisual({
      kind: "kickoff",
      desc: `${returnerName} returns the kick to the own ${endYL}`,
      startYard: 35, endYard: endYL,
      kicker: kickerKey, returner: returnerName,
      retYds: ret,
    });
    return { endYL, isTD: false };
  }
  // Attempt an extra point (or rarely a 2-pt) for the DEFENSIVE team after
  // they score on a pick-six / fumble-six / blocked-FG TD / missed-FG TD.
  // Pushes a visual either way so the user sees the kick or the miss/2pt.
  _defScoreXP() {
    const scoringSide = this.poss === "home" ? "away" : "home";
    const scoringTeam = scoringSide === "home" ? this.home : this.away;
    const defStats = this.stats[scoringSide];
    const k = this.defR.starters.k;
    const kStats = defStats?.players?.[k];
    if (Math.random() < 0.92) {
      if (kStats) kStats.xp_att++;
      if (Math.random() < 0.94) {
        this.score[scoringSide] += 1;
        if (kStats) kStats.xp_made++;
        // poss + pts required so the broadcast quarter-scoreboard
        // aggregator (sums kind:"score" with poss+pts) picks up the
        // point. Without these, defensive-TD XP scores were silently
        // dropped from the quarter totals.
        this._pushVisual({ kind: "score", desc: `${scoringTeam.city} ${scoringTeam.name} — Extra Point (+1)`, poss: scoringSide, pts: 1, scoreType: "Extra Point" });
      } else {
        this._pushVisual({ kind: "fg_miss", desc: `${scoringTeam.city} ${scoringTeam.name} — Extra Point MISSED` });
      }
    } else {
      if (Math.random() < 0.48) {
        this.score[scoringSide] += 2;
        this._pushVisual({ kind: "score", desc: `${scoringTeam.city} ${scoringTeam.name} — 2-Point Conversion (+2)`, poss: scoringSide, pts: 2, scoreType: "2-Point Conversion" });
      } else {
        this._pushVisual({ kind: "incomplete", desc: `${scoringTeam.city} ${scoringTeam.name} — 2-Point Conversion NO GOOD` });
      }
    }
  }
  _play() {
    // Depth-chart rotation: sub starters based on garbage time / fatigue
    // BEFORE any reads of this.offR.starters.X. Restores from base depth
    // chart at the top, then optionally swaps in backups.
    this._rotateForSnap();
    // Snap counts: bump for offensive skill players actually on the
    // field this snap (after rotation). Lets the post-game stats show
    // "played 89% of snaps" — fantasy managers care about this more
    // than raw touch totals.
    {
      const side = this.poss;
      const starters = this.offR.starters;
      for (const role of ["qb", "rb", "wr1", "wr2", "te"]) {
        const name = starters[role];
        if (!name) continue;
        const pl = this.stats[side].players[name];
        if (pl) pl.snaps = (pl.snaps || 0) + 1;
      }
      this.stats[side].team.snaps = (this.stats[side].team.snaps || 0) + 1;
    }
    // ── COACHING TRAIT LOOKUPS ────────────────────────────────────────────────
    // Determine offensive/defensive team IDs for franchise.coaches lookups.
    const _offTeamId = this.poss === "home" ? this.home.id : this.away.id;
    const _defTeamId = this.poss === "home" ? this.away.id : this.home.id;
    const _ocTrait   = (typeof franchise !== "undefined") ? franchise.coaches?.[_offTeamId]?.oc?.trait  : null;
    const _dcTrait   = (typeof franchise !== "undefined") ? franchise.coaches?.[_defTeamId]?.dc?.trait  : null;
    const _hcSpec    = (typeof franchise !== "undefined") ? franchise.coaches?.[_offTeamId]?.hc?.specialtyTrait : null;
    // HC Motivator: +1 offense rating when trailing by ≤7 in Q4
    const _offScore = this.score[this.poss];
    const _defScore2= this.score[this.poss === "home" ? "away" : "home"];
    const _trailDiff= _defScore2 - _offScore;
    const _motivatorBoost = (_hcSpec === "Motivator" && this.quarter >= 4 && _trailDiff >= 1 && _trailDiff <= 7) ? 1 : 0;

    const adv = (this.offR.offense + _motivatorBoost - this.defR.defense) / 100;

    // AWR in the trenches — affects engine behavior, not OVR.
    // DL snap timing: smart rushers read the center's weight shift and get a
    // half-step jump. Small but compounding over 60+ snaps a game.
    const defDLList = this.defArch?.DL || [];
    const dlAwrAvg = defDLList.length
      ? defDLList.reduce((s, p) => s + (this._playerByName.get(p?.name)?.stats?.[3] ?? 70), 0) / defDLList.length
      : 70;
    const snapTimingBonus = (dlAwrAvg - 70) / 250; // AWR 85 → +0.06, AWR 55 → -0.06

    // OL blitz pickup: high-AWR linemen make correct protection calls vs stunts
    // and blitzes, keeping the QB clean even under exotic pressure packages.
    const offOLList = (this.poss === "home" ? this.homeOL : this.awayOL) || [];
    const olAwrAvg = offOLList.length
      ? offOLList.reduce((s, p) => s + (this._playerByName.get(p?.name)?.stats?.[3] ?? 70), 0) / offOLList.length
      : 70;
    const blitzPickupBonus = (70 - olAwrAvg) / 280; // high OL AWR reduces pressure

    // Trench matchup: positive = DL is winning vs OL (offense in trouble)
    // -1.0 ≈ OL dominates, 0 ≈ even, +1.0 ≈ DL crushes OL, +1.5 = absolute mismatch
    const basePressure = clamp((this.defR.dl - this.offR.ol) / 35 + snapTimingBonus + blitzPickupBonus, -1.2, 1.5);
    // Pick the DL rep + OL rep for THIS play, look up the matchup multiplier
    const reps = this._pickTrenchRep();
    const passMul = (PASS_MATCHUP[reps.dlType]?.[reps.olType]) ?? 1.0;
    const runMul  = (RUN_MATCHUP [reps.dlType]?.[reps.olType]) ?? 1.0;
    // Effective pressure for THIS play accounts for the archetype matchup
    const pressure = clamp(basePressure * passMul, -1.5, 1.9);
    // Two-minute drill: offense down by ≤16, < 2:00 left in half/game.
    // Reduces play clock (no-huddle) and bumps pass rate.
    const inTwoMin = this._isTwoMinDrill();
    const dtMean = inTwoMin ? 13 : 33;
    const dtSd   = inTwoMin ? 4  : 9;
    const dtMin  = inTwoMin ? 6  : 12;
    const dtMax  = inTwoMin ? 24 : 55;
    const dt = clamp(normal(dtMean, dtSd), dtMin, dtMax);
    this.time -= dt;
    if (this.time < 0) this.time = 0;
    // Time of possession: every snap's elapsed clock counts toward the
    // offense's TOP. Surfaces in team-stats comparison + box score.
    this.stats[this.poss].team.timeOfPoss = (this.stats[this.poss].team.timeOfPoss || 0) + dt;
    const startYard = this.yardLine;
    const off = this.offStats, def = this.defStats;
    const QB = this.offR.starters.qb, RB = this.offR.starters.rb, K = this.offR.starters.k;
    const isThird = this.down === 3, isFourth = this.down === 4;
    // PERSONNEL selection — picked once per snap. Long-yardage tilts toward
    // SPREAD/EMPTY; goal-line toward HEAVY/I_FORM. Stored on `this` so
    // _pushVisual auto-attaches it to every play visual this snap.
    const offPb = getPlaybook(this.possTeam);
    const isLongYardage = (isThird || isFourth) && this.ytg >= 8;
    const isNearGL      = (100 - this.yardLine) <= 5;
    this._currentPersonnel = pickPersonnel(offPb, { isLongYardage, isGoalLine: isNearGL, down: this.down, ytg: this.ytg });
    this._currentDefPackage = packageForPersonnel(this._currentPersonnel);

    if (this.down === 4) {
      const toEZ = 100 - this.yardLine;
      const inFGRange  = toEZ <= 40;   // realistic FG attempt (57-yd max)
      const isGoalLine = toEZ <= 3;    // 4th & goal at the 3 or in
      const isShortYTG = this.ytg <= 2;
      // QB AGGRESSION tilts the go-for-it rate. A risk-taking QB (high THR
      // + AWR + GUNSLINGER) elevates every "go" decision; a conservative
      // GAME_MANAGER passes the ball off to the kicker / punter more often.
      const goTilt = this._aggTilt(this._qbAggression());   // 0.70-1.30
      // Decide between FG / punt / go-for-it
      let action;
      if (isGoalLine) {
        // Goal line — usually go for the TD, sometimes chip-shot FG
        action = Math.random() < clamp(0.62 * goTilt, 0.35, 0.92) ? "go" : "fg";
      } else if (inFGRange) {
        // In FG range — kick the FG unless 4th & 1-2 (sometimes go for it)
        action = (isShortYTG && Math.random() < clamp(0.22 * goTilt, 0.08, 0.55)) ? "go" : "fg";
      } else {
        // Out of FG range — punt unless 4th & short OR midfield 4th-and-manageable
        const goBase = isShortYTG ? 0.35 : (this.ytg <= 4 && toEZ <= 55 ? 0.12 : 0);
        action = Math.random() < clamp(goBase * goTilt, 0, 0.75) ? "go" : "punt";
      }
      if (action === "fg") {
        const dist = toEZ + 17;
        // ── ICE THE KICKER ──
        // Late game, defense burns a TO right before a tying / lead-changing FG.
        // Has a small accuracy effect (kicker has time to overthink).
        const defKey = this.poss === "home" ? "away" : "home";
        const offScore = this.score[this.poss], defScore = this.score[defKey];
        const fgWouldTieOrLead = (offScore + 3) >= defScore;
        const lateGameClose = this.time < 90 && this.quarter >= 4 && Math.abs(offScore - defScore) <= 4;
        const isIcable = lateGameClose && fgWouldTieOrLead && dist >= 30 && this.timeouts[defKey] > 0;
        let isIced = false;
        if (isIcable && Math.random() < 0.55) {
          this.timeouts[defKey]--;
          isIced = true;
          this.plays.push({
            kind: "timeout",
            desc: `🧊 ICE THE KICKER — ${this[defKey].city} ${this[defKey].name}`,
            team: defKey, quarter: this.quarter, time: this.time,
            timeoutsRemaining: { ...this.timeouts },
            personnel: this._currentPersonnel || "BASE",
            defPackage: this._currentDefPackage || "BASE_43",
            poss: this.poss, down: this.down, ytg: this.ytg, yardLine: this.yardLine,
            homeScore: this.score.home, awayScore: this.score.away,
          });
        }
        // Weather effects on FG: wind helps when kicking with it, hurts
        // against it; snow crushes range; rain costs ~3% on long kicks.
        // Wind direction is in world coords; the kicking team's goal is at
        // dir>0 if home (kicking right) — we tilt the math based on poss.
        const wKick = this.weather || { label: "CLEAR", windDir: 0, windStrength: 0 };
        const teamKickDir = this.poss === "home" ? 1 : -1;
        // windWith = +1 if wind is at the kicker's back, -1 if into his face
        const windWith = wKick.windStrength * (wKick.windDir === teamKickDir ? 1 : -1);
        let wxPenalty = 0;
        if (wKick.label === "WINDY") wxPenalty = (dist - 30) * 0.012 * (-windWith);   // ~10-15% penalty into a strong wind from 50yds
        else if (wKick.label === "SNOW")  wxPenalty = 0.10 + (dist - 25) * 0.008 * (-windWith);
        else if (wKick.label === "RAIN")  wxPenalty = Math.max(0, (dist - 35)) * 0.004;
        // K archetype tilts FG math: LEG = more range less accuracy, PRECISION =
        // less range more accuracy, CLUTCH = bonus in 4th Q tight games, BALANCED = neutral.
        const kPlayer = this._playerByName.get(K);
        const kArch = kPlayer?.archetype;
        const kpw   = kPlayer?.stats?.[10] ?? 70;
        const isClutchMoment = (this.quarter >= 4 && this.time < 300 && Math.abs(this.score.home - this.score.away) <= 8);
        let archAccMod = 0, archRangeMod = 0;
        if (kArch === "LEG")       { archAccMod = -0.025; archRangeMod = (dist - 35) * 0.0035; }
        else if (kArch === "PRECISION") { archAccMod = +0.035; archRangeMod = -Math.max(0, dist - 45) * 0.006; }
        else if (kArch === "CLUTCH")    { archAccMod = isClutchMoment ? +0.05 : -0.005; }
        // KPW above 75 adds a small extra range bonus regardless of archetype
        const kpwBonus = Math.max(0, kpw - 75) * 0.001;
        // Ice the kicker — small accuracy hit when defense burned a TO before the snap.
        const iceMod = isIced ? -0.04 : 0;
        const fgPct = clamp(0.96 - (dist - 20) * 0.020 + (this.offR.k - 60) / 250
                          + archAccMod + archRangeMod + kpwBonus + iceMod - wxPenalty, 0.15, 0.99);
        const kStats = off.players[K]; if (kStats) { kStats.fg_att++; }
        off.team.fourthAtt++;
        // Block chance — slightly higher on long attempts
        const blockPct = clamp(0.025 + Math.max(0, dist - 40) * 0.0015, 0.025, 0.06);
        if (Math.random() < blockPct) {
          // Blocked! Defender picks up the ball. ~12% chance the recovery
          // becomes a TD return; otherwise the defense gets the ball at the
          // recovery spot (3-15 yards behind the LOS).
          const isReturnTD = Math.random() < 0.12;
          let recoveryYard;
          if (isReturnTD) recoveryYard = 0;  // they take it all the way
          else {
            // Pick up between -3 and 0 (own end zone is 0 here for offense's POV)
            const losingYards = Math.floor(Math.random() * 13) - 3;
            recoveryYard = Math.max(0, startYard - losingYards);
          }
          this._pushVisual({
            kind: "fg_blocked",
            desc: isReturnTD
              ? `BLOCKED — RETURNED ${100 - startYard} YARDS FOR A TOUCHDOWN!`
              : `BLOCKED — recovered by defense at the ${recoveryYard}`,
            startYard, endYard: recoveryYard, fgDist: dist, kicker: this.offR.starters.k,
            isReturnTD,
          });
          if (isReturnTD) {
            // Defense scores 6, then attempts XP — flip possession after.
            const defScore = this.poss === "home" ? "away" : "home";
            this.score[defScore] += 6;
            // Credit the def_td to a defender (DL most likely on a block)
            const blockerName = this._creditDefStat("def_td", { DL: 0.65, LB: 0.20, S: 0.10, CB: 0.05 });
            const def = this.stats[defScore];
            if (def) def.team.def_td = (def.team.def_td || 0) + 1;
            // XP attempt for the defensive team (with visual)
            this._defScoreXP();
          }
          return { endDrive: true, blockedFG: true, returnedTD: isReturnTD };
        }
        if (Math.random() < fgPct) {
          if (kStats) { kStats.fg_made++; if (dist > kStats.fg_long) kStats.fg_long = dist; }
          this._score(3, `${dist}-yd FG`);
          this._pushVisual({ kind: "fg_good", desc: `${this.offR.starters.k} drills it from ${dist} yds!`, startYard, endYard: 100, fgDist: dist, kicker: this.offR.starters.k });
          return { endDrive: true, fgGood: true };
        } else {
          // Long missed FGs (>50 yd attempts) can be returned by the defense
          // — the spot is behind the LOS where the defender catches the ball.
          const isReturnable = dist > 50 && Math.random() < 0.18;
          if (isReturnable) {
            const isReturnTD = Math.random() < 0.05;
            const recoveryYard = isReturnTD ? 0 : Math.max(0, startYard - 8 - Math.floor(Math.random() * 12));
            this._pushVisual({
              kind: "fg_miss",
              desc: isReturnTD
                ? `MISSED — RETURNED FOR TOUCHDOWN!`
                : `${this.offR.starters.k} misses from ${dist} — returned to the ${recoveryYard}`,
              startYard, endYard: recoveryYard, fgDist: dist, kicker: this.offR.starters.k,
              isReturnTD, isReturned: true,
            });
            if (isReturnTD) {
              const defScore = this.poss === "home" ? "away" : "home";
              this.score[defScore] += 6;
              // Credit the def_td — usually a DB on a missed-FG return
              this._creditDefStat("def_td", { S: 0.55, CB: 0.30, LB: 0.10, DL: 0.05 });
              const def = this.stats[defScore];
              if (def) def.team.def_td = (def.team.def_td || 0) + 1;
              this._defScoreXP();
            }
          } else {
            this._pushVisual({ kind: "fg_miss", desc: `${this.offR.starters.k} misses from ${dist} — no good`, startYard, endYard: startYard, fgDist: dist, kicker: this.offR.starters.k });
          }
        }
        return { endDrive: true };
      }
      if (action === "go") {
        // Going for it: bump the fourthAtt counter, then fall through to the
        // normal play logic below (run or pass). Drive-flow code will
        // convert a successful first down into ytg=10, otherwise turnover-on-downs.
        off.team.fourthAtt++;
        // Mark this conversion attempt — _drive() will check `r.yards >= ytg`
        // and credit fourthConv on success.
        this._pushVisual({ kind: "fourth_go", desc: `${this.possTeam.name} GOES FOR IT — 4th & ${this.ytg}!`, startYard, endYard: startYard });
        // Fall through to normal play (do NOT return)
      } else {
        // Punt — distance, hang time, and return resolution are all driven by
        // the PUNTER (separate from the kicker). Archetype + KPW shape it.
        off.team.fourthAtt++;
        const P = this.offR.starters.p;
        const pPlayer = this._playerByName.get(P);
        const pArch = pPlayer?.archetype;
        const pKpw  = pPlayer?.stats?.[10] ?? 65;
        const pAwr  = pPlayer?.stats?.[3]  ?? 65;
        const pSpd  = pPlayer?.stats?.[0]  ?? 60;
        const pAgi  = pPlayer?.stats?.[2]  ?? 60;
        // ── FAKE PUNT ──
        // ATHLETIC punters can fake on 4th-and-short in plus territory. Roll
        // is tilted by QB aggression (aggressive playcallers gamble more).
        const fakeShortYTG = this.ytg <= 4;
        const fakeMidfield = this.yardLine >= 40 && this.yardLine <= 75;
        const fakeEligible = pArch === "ATHLETE" && fakeShortYTG && fakeMidfield;
        if (fakeEligible) {
          const aggTilt = this._aggTilt(this._qbAggression());
          const fakeChance = clamp(0.18 * aggTilt, 0.06, 0.32);
          if (Math.random() < fakeChance) {
            // FAKE PUNT! Decide run (60%) vs pass (40%) — heavier on run since
            // punters aren't really QBs. Run uses SPD+AGI, pass uses AWR.
            const isPass = Math.random() < 0.40;
            if (isPass) {
              const compPct = clamp(0.42 + (pAwr - 65) / 180, 0.22, 0.78);
              const isComp = Math.random() < compPct;
              const tgtName = this.offR.starters.te || this.offR.starters.rb2 || this.offR.starters.rb;
              const fakeYards = isComp ? clamp(Math.round(normal(11, 5)), -2, 38) : 0;
              const success = isComp && fakeYards >= this.ytg;
              this._pushVisual({
                kind: isComp ? "complete" : "incomplete",
                desc: isComp
                  ? `🎩 FAKE PUNT! ${P} throws to ${tgtName} for ${fakeYards} — ${success ? "FIRST DOWN!" : "stopped short"}`
                  : `🎩 FAKE PUNT! ${P} throws — INCOMPLETE`,
                startYard,
                endYard: clamp(startYard + (isComp ? fakeYards : 0), 0, 100),
                isFakePunt: true,
                passer: P,
                receiver: tgtName,
                yards: isComp ? fakeYards : 0,
                targetDepth: 10,
              });
              return { yards: isComp ? fakeYards : 0, incomplete: !isComp };
            } else {
              const fakeMean = 4 + (pSpd - 65) * 0.07 + (pAgi - 65) * 0.05;
              const fakeYards = clamp(Math.round(normal(fakeMean, 4)), -3, 35);
              const success = fakeYards >= this.ytg;
              this._pushVisual({
                kind: "run",
                desc: `🎩 FAKE PUNT! ${P} runs for ${fakeYards} yds — ${success ? "FIRST DOWN!" : "stopped short"}`,
                startYard,
                endYard: clamp(startYard + fakeYards, 0, 100),
                isFakePunt: true,
                rusher: P,
                yards: fakeYards,
              });
              return { yards: fakeYards };
            }
          }
        }
        // Base distance scales with KPW: 60 KPW ≈ 42 yds, 90 KPW ≈ 52 yds
        let puntMean = 38 + (pKpw - 50) * 0.32;
        let puntSd   = 7;
        // Archetype tilts on top of stats
        let fairCatchBonus = 0;     // shifts return distribution toward fair catches
        let bigReturnSuppress = 0;  // shifts away from big returns (hang time)
        let touchbackRisk = 0;      // extra chance the boomer outkicks coverage
        if (pArch === "BOOMER")       { puntMean += 4; puntSd = 8;  touchbackRisk = 0.06; }
        else if (pArch === "DIRECTIONAL") { puntMean -= 3; puntSd = 4;  fairCatchBonus = 0.18; }
        else if (pArch === "HANG_TIME")   { puntMean += 1; puntSd = 5;  bigReturnSuppress = 0.55; fairCatchBonus = 0.08; }
        // AWR over 75 trims SD (more consistent placement)
        if (pAwr > 75) puntSd = Math.max(3, puntSd - (pAwr - 75) * 0.04);
        const punt = clamp(normal(puntMean, puntSd), 24, 72);
      const landYard = clamp(startYard + punt, 0, 100);
      // Touchback / fair catch / return resolution — biased by archetype.
      let returnYards = 0, isTouchback = false, isFairCatch = false;
      if (landYard >= 100 || (touchbackRisk > 0 && Math.random() < touchbackRisk)) {
        isTouchback = true;
      } else {
        const r = Math.random() - fairCatchBonus;  // shift the cutpoints up
        if (r < 0.18) { isFairCatch = true; }
        else if (r < 0.55) returnYards = rand(0, 6);
        else if (r < 0.85) returnYards = rand(4, 14);
        else if (r < 0.96) returnYards = rand(12, 28);
        else                returnYards = rand(30, 70);
        // Hang-time punters suppress the longest returns — if a big return rolled
        // and the archetype kills it, knock it down to a modest return.
        if (returnYards >= 20 && Math.random() < bigReturnSuppress) {
          returnYards = rand(4, 14);
        }
      }
      // Final spot after return (or fixed touchback at receiver's 20)
      const finalLand = isTouchback ? 80 : clamp(landYard - returnYards, 1, 99);
      const effectivePunt = finalLand - startYard;
      // If they brought it all the way back: TD for the receiving team
      const isReturnTD = !isTouchback && finalLand <= 0;
      this._pushVisual({
        kind: "punt",
        desc: isTouchback ? `${this.possTeam.name} punts ${punt} yds — touchback`
            : isFairCatch ? `${this.possTeam.name} punts ${punt} yds — fair catch`
            : returnYards > 20 ? `${this.possTeam.name} punt RETURNED ${returnYards} yds!`
            : `${this.possTeam.name} punts ${punt} yds, returned ${returnYards}`,
        startYard, puntYards: punt, landYard, returnYards,
        isTouchback, isFairCatch, isReturnTD,
        endYard: finalLand,
        kicker: P,
        punterArch: pArch,
      });
        return { endDrive: true, punt: effectivePunt, isReturnTD };
      }
      // (falls through to a regular play below when action === "go")
    }
    const isLong = this.ytg >= 8, isShort = this.ytg <= 2;
    const pb = this.offPlaybook;
    let passProb = isLong ? pb.passProb.long : isShort ? pb.passProb.short : pb.passProb.mid;
    if (inTwoMin) passProb = Math.min(0.96, passProb + 0.25);   // hurry-up = pass-heavy
    const playType = Math.random() < passProb ? "pass" : "run";

    // ── PENALTY ROLL ──
    // ~6.3% combined chance per play (NFL averages ~12 accepted penalties
    // per game / ~130 plays = ~9%, slightly undershooting to leave room
    // for play-style variance). Penalties consume ~8s of clock for the
    // flag and either replay the down (most) or trigger an automatic
    // first (defensive holding, PI, roughing). yardLine + ytg are
    // adjusted INSIDE this block; _drive sees isPenalty and skips its
    // normal down/yardLine progression.
    {
      const penR = Math.random();
      let pen = null;
      if      (penR < 0.012) pen = { type: "False Start",            on: "off", yds: 5,  autoFirst: false };
      else if (penR < 0.020) pen = { type: "Offsides",               on: "def", yds: 5,  autoFirst: false };
      else if (penR < 0.027) pen = { type: "Delay of Game",          on: "off", yds: 5,  autoFirst: false };
      else if (penR < 0.040) pen = { type: "Holding (Offense)",      on: "off", yds: 10, autoFirst: false };
      else if (penR < 0.044) pen = { type: "Holding (Defense)",      on: "def", yds: 5,  autoFirst: true };
      // Pass-only penalties (roughing the passer, PI). DPI = spot foul,
      // averaged at 15 yards (real-world range 5-50+, mode ~12).
      else if (playType === "pass") {
        if      (penR < 0.052) pen = { type: "Roughing the Passer",  on: "def", yds: 15, autoFirst: true };
        else if (penR < 0.060) pen = { type: "Pass Interference (D)", on: "def", yds: 15, autoFirst: true };
        else if (penR < 0.063) pen = { type: "Pass Interference (O)", on: "off", yds: 10, autoFirst: false };
      }
      if (pen) {
        const flaggedKey = pen.on === "off" ? this.poss : (this.poss === "home" ? "away" : "home");
        const flaggedStats = this.stats[flaggedKey];
        flaggedStats.team.penalties   = (flaggedStats.team.penalties   || 0) + 1;
        flaggedStats.team.penaltyYds  = (flaggedStats.team.penaltyYds  || 0) + pen.yds;
        // Yardage direction relative to OFFENSE: offensive penalty moves
        // the ball backward (away from opponent EZ); defensive penalty
        // moves forward.
        const dir = pen.on === "off" ? -1 : +1;
        const newYL = clamp(this.yardLine + dir * pen.yds, 1, 99);
        this.yardLine = newYL;
        if (pen.autoFirst) {
          this.down = 1;
          this.ytg = 10;
        } else {
          // Replay down — adjust ytg by penalty yards
          this.ytg = clamp(this.ytg + (pen.on === "off" ? pen.yds : -pen.yds), 1, 99);
        }
        const dt = 8;
        this.time = Math.max(0, this.time - dt);
        this._pushVisual({
          kind: "penalty",
          desc: `🚩 ${pen.type} on ${this[flaggedKey].name} — ${pen.yds} yds${pen.autoFirst ? ", automatic first down" : ""}`,
          yds: pen.yds,
          onTeam: flaggedKey,
          penType: pen.type,
        });
        return { yards: 0, incomplete: false, isPenalty: true };
      }
    }

    // Count the play AFTER the penalty roll — a flagged pre-snap penalty
    // is officially "no play" in NFL stats (doesn't count as a play or
    // a 3rd-down attempt). Replays of 3rd-down with multiple flags also
    // should only count one attempt when the down eventually completes.
    off.team.plays++;
    if (isThird) off.team.thirdAtt++;

    // ── VICTORY FORMATION / KNEEL-DOWN ──
    // Winning team in Q4 kneels to run out the clock when the math
    // works. Each kneel burns ~40s of play clock + ~5s for the snap.
    // Opponent timeouts cost ~30s each (forces a quicker snap). The
    // offense has (5 - this.down) downs remaining; if time_left fits
    // within those kneels minus opponent timeout burn, victory.
    {
      const oppKey = this.poss === "home" ? "away" : "home";
      const lead = this.score[this.poss] - this.score[oppKey];
      const oppTimeouts = this.timeouts[oppKey] || 0;
      const remainingDowns = 5 - this.down;  // 1st = 4 downs available, 4th = 1
      const kneelMargin = remainingDowns * 40 - oppTimeouts * 30;
      const canKneelOut = lead > 0
        && this.quarter === 4
        && this.time <= kneelMargin
        && this.time > 0;
      if (canKneelOut) {
        const qbStats = off.players[QB];
        if (qbStats) qbStats.rush_att++;
        off.team.rush_att++;
        // Time math: the snap-to-snap dt was already deducted at the top
        // of _play. Adjust so the kneel burns exactly ~40s NET (real
        // play clock + the kneel itself), not 40s on top of the regular
        // 12-55s dt. Previous version double-burned clock.
        const intendedKneelTime = 40;
        this.time = Math.max(0, this.time + dt - intendedKneelTime);
        // Safety guard — a kneel at own 1 would trigger the safety
        // detection in _drive (yards: -1 → proposedYL <= 0). Clamp the
        // loss so the ball never crosses the goal line.
        const yardLoss = Math.min(1, startYard - 1);  // 0 if at the 1, else 1
        this._pushVisual({
          kind: "kneel",
          desc: `${QB} takes a knee — victory formation`,
          startYard, endYard: Math.max(1, startYard - yardLoss),
          passer: QB,
        });
        return { yards: -yardLoss };
      }
    }

    // ── QB SPIKE ──
    // Burn a down to stop the clock when it makes sense. Conditions:
    //   • <30s left in Q2/Q4, but >3s (don't spike with the gun about to fire)
    //   • Down 1 or 2 — never spike on 3rd (waste a play that could convert)
    //     or 4th (turnover on downs)
    //   • Out of timeouts (otherwise call a timeout instead)
    //   • Q2: in FG range — spike to set up a halftime field goal
    //   • Q4: trailing or tied — need to score
    {
      const oppKey = this.poss === "home" ? "away" : "home";
      const trailingOrTied = this.score[this.poss] <= this.score[oppKey];
      const myTimeouts = this.timeouts[this.poss];
      const inFGRange = this.yardLine >= 58;                 // ~60+ yds to score → make-able FG
      const canSpike = this.time <= 30 && this.time > 3
                    && this.down <= 2
                    && myTimeouts === 0
                    && (
                      (this.quarter === 2 && inFGRange) ||
                      (this.quarter === 4 && trailingOrTied)
                    );
      if (canSpike && Math.random() < 0.65) {
        const qbStats = off.players[QB];
        if (qbStats) qbStats.pass_att++;
        off.team.pass_att++;
        // Spike takes ~3 seconds total — restore most of dt we already
        // deducted (since the spike is a no-huddle quick play, not a full
        // snap-clock-out play).
        const spikeTime = 3;
        this.time += Math.max(0, dt - spikeTime);
        this._pushVisual({
          kind: "spike",
          desc: `${QB} spikes the ball to stop the clock`,
          startYard, endYard: startYard,
          passer: QB,
        });
        return { yards: 0, incomplete: true };
      }
    }

    if (playType === "pass") {
      const qbStats = off.players[QB];
      const qbArch = this.offArch.QB?.archetype;
      const qbPlayer = this._playerByName.get(QB);
      const qbAwr = qbPlayer?.stats?.[3] ?? 70;
      const qbAgi = qbPlayer?.stats?.[2] ?? 65;
      const qbThr = qbPlayer?.stats?.[4] ?? 75;
      // QB archetype effects on the dropback
      // GUNSLINGER: more INTs, deeper throws, less accurate
      // GAME_MANAGER: fewer INTs, shorter throws, more accurate
      // POCKET: slightly more accurate
      // FIELD_GENERAL: fewer INTs, slightly more accurate
      // DUAL_THREAT: bonus scramble rate (added on top of playbook)
      let qbCompMod = 0, qbIntMod = 0, qbAirMod = 0, qbScrambleBonus = 0, qbBigPlayBonus = 0;
      switch (qbArch) {
        case "POCKET":        qbCompMod = +0.025; qbIntMod = -0.005; qbAirMod = -0.3; break;
        case "GUNSLINGER":    qbCompMod = -0.040; qbIntMod = +0.020; qbAirMod = +1.5; qbBigPlayBonus = 0.10; break;
        case "GAME_MANAGER":  qbCompMod = +0.040; qbIntMod = -0.012; qbAirMod = -1.4; break;
        case "FIELD_GENERAL": qbCompMod = +0.020; qbIntMod = -0.015; break;
        case "DUAL_THREAT":   qbScrambleBonus = 0.10; break;
      }
      // PLAY-ACTION — fakes the handoff to freeze LBs/safeties. Effectiveness
      // scales with the offense's run-game threat (defense has to respect it)
      // and the QB's AWR/THR (sells the fake). Costs a longer dropback → +sack risk.
      let paCompMod = 0, paAirMod = 0, paSackMul = 1.0;
      const runThreat = clamp((this.offR.rb - 65) / 35, 0, 1);   // 0-1 based on RB room
      const paQbSkill = clamp((qbAwr + qbThr - 140) / 80, 0, 1); // 0-1 based on QB
      const paBaseRate = 0.16 + runThreat * 0.10 - (isThird && this.ytg >= 7 ? 0.10 : 0);
      const isPlayAction = !isShort && Math.random() < paBaseRate;
      // FLEA FLICKER — rare trick play, only on PA setups in good run threat.
      // RB takes the fake handoff, then pitches the ball BACK to the QB who
      // throws deep. Big play upside, big-time risk if it breaks down.
      const isFleaFlicker = isPlayAction && runThreat > 0.35 && (this.ytg >= 6 || !isThird) && Math.random() < 0.06;
      if (isPlayAction) {
        paCompMod = 0.025 + paQbSkill * 0.030;     // up to +5.5% comp
        paAirMod  = 1.5  + paQbSkill * 2.5 + runThreat * 1.5;  // up to +5 air yds
        paSackMul = 1.25;                           // longer dropback → more sacks
      }
      if (isFleaFlicker) {
        // Flea flicker forces a deeper target + bigger sack risk
        paAirMod  += 4.0;
        paSackMul *= 1.35;
      }
      // QB SCRAMBLE — dual-threat QB sometimes takes off instead of throwing
      const scramblePct = (pb.qbScramblePct || 0) + qbScrambleBonus;
      if (scramblePct > 0 && Math.random() < scramblePct) {
        // Mobile QB scramble — modest gain when coverage is locked
        // Scramble yardage softened — elite LBs/safeties don't let QBs walk for 8 yds every time.
        // Subtracts a small amount based on linebacker tackling rating.
        const lbTk = (this.defR.lb - 65) / 25;   // 0 at avg LB, +1.2 at elite
        let yards = clamp(normal(4 + adv * 1.5 + Math.max(0, pressure) * 0.6 - lbTk, 6.5), -4, 50);
        if (yards > 0) yards = Math.min(yards, 100 - startYard);
        if (qbStats) {
          qbStats.rush_att = (qbStats.rush_att || 0) + 1;
          qbStats.rush_yds = (qbStats.rush_yds || 0) + yards;
          if (yards > (qbStats.rush_long || 0)) qbStats.rush_long = yards;
        }
        off.team.rush_att++; off.team.rushYds += yards; off.team.totalYds += yards;
        this._lastBallCarrier = QB; this._lastBallType = "rush";
        this._pushVisual({
          kind: "run", desc: `${QB} scrambles for ${yards} yds`,
          startYard, yards, endYard: clamp(startYard + yards, 0, 100),
          rusher: QB, isScramble: true
        });
        return { yards };
      }
      // Ball-hawk DBs add to the INT chance; shutdown corners suppress passing entirely
      const defArch = this.defArch;
      const ballHawkBonus =
        ((defArch.CB || []).filter(c => c?.archetype === "BALL_HAWK").length * 0.010) +
        ((defArch.S  || []).filter(s => s?.archetype === "BALL_HAWK").length * 0.012);
      // Pressured QBs throw more INTs (rushed/forced throws). QB archetype tilts this too.
      // Bad QBs (low OVR) make poor reads → significantly more INTs.
      const qbIntFromOvr = (75 - this.offR.qb) / 800;  // QB 60 → +0.019, QB 90 → -0.019
      // Defensive backs matter — but the modifiers HALVED below were
      // previously stacking to a 20% per-attempt INT cap, yielding ~5%
      // league INT rate (real NFL is ~2.5%). Median career INT-made
      // for top-20 DBs was 1.3/g, way over NFL leader 0.82/g.
      let defIntMod = (this.defR.cb - 65) / 1400;        // halved from /700
      const safIntNames = [this.defR.starters.fs, this.defR.starters.ss];
      const safIntPlayers = safIntNames.map(n => this._playerByName?.get?.(n)).filter(Boolean);
      if (safIntPlayers.length) {
        const avgSafCov = safIntPlayers.reduce((s,p) => s + (p.stats?.[8] || 65), 0) / safIntPlayers.length;
        defIntMod += (avgSafCov - 65) / 2200;            // halved from /1100
      }
      const qbAggIntMod = (this._aggTilt(this._qbAggression()) - 1) * 0.008;
      const dcBallHawkMul  = _dcTrait  === "Ball Hawk"    ? 1.025 : 1.0;
      const hcGameMgrIntMul= _hcSpec   === "Game Manager" ? 0.88  : 1.0;
      // INT rate: NFL league avg ~2.4%/attempt, worst-case stacks ~3.5%.
      // Prior tune capped at 6% with 0.022 base — produced 4.6× NFL INTs
      // across the 500-season sim. Base 0.022 → 0.014 (closer to league
      // avg), pressure mul 0.012 → 0.006 (half-stack), cap 0.06 → 0.035.
      const intPct = clamp((0.014 - adv * 0.008 + defIntMod + pressure * 0.006 + ballHawkBonus + qbIntMod + qbIntFromOvr + qbAggIntMod) * dcBallHawkMul * hcGameMgrIntMul, 0.002, 0.035);
      if (Math.random() < intPct) {
        const targetDepth = clamp(normal(11, 7), 2, 35);
        if (qbStats) { qbStats.pass_att++; qbStats.pass_int++; }
        off.team.pass_att++; off.team.turnovers++;
        def.team.takeaways++;
        // Credit INT to a DB (CB or S)
        const intBy = this._creditDefStat("int_made", { CB: 0.55, S: 0.35, LB: 0.10 });
        // Interception return yardage — bursty distribution. Most are
        // short (0-5), some medium (6-15), occasional house-call (16-50+).
        const retSeed = Math.random();
        let retYds;
        if (retSeed < 0.45)      retYds = Math.floor(Math.random() * 4);            // 0-3
        else if (retSeed < 0.80) retYds = 4 + Math.floor(Math.random() * 9);         // 4-12
        else if (retSeed < 0.96) retYds = 13 + Math.floor(Math.random() * 18);       // 13-30
        else                      retYds = 30 + Math.floor(Math.random() * 50);       // 30-80 (rare big one)
        // INT spot — approximately where the ball gets picked. Allowed to
        // exceed 100 so we can detect end-zone catches (touchbacks).
        const intSpotYL = clamp(startYard + Math.round(targetDepth / 2), 1, 110);
        // TOUCHBACK — defender picks the ball IN the end zone (intSpotYL ≥ 100)
        // and either kneels or gets tackled before breaking it out (retYds<5).
        // Ball moves to the new offense's 20-yard-line.
        const isTouchback = intSpotYL >= 100 && retYds < 5;
        // Pick-six — the defender runs BACK toward yard 0 (the offense's
        // own end zone, which is the defender's scoring end zone), so the
        // distance they have to cover equals the INT spot's yard line.
        // Earlier the gate was 100 - intSpotYL, the distance FORWARD to the
        // OFFENSE's end zone — backwards from the defender's path — which
        // made any throw into the end zone an instant pick-six.
        const isPickSix = !isTouchback && retYds >= intSpotYL;
        const finalRetYds = isPickSix ? intSpotYL : (isTouchback ? 0 : retYds);
        // Credit return yards to the picking defender
        if (intBy) {
          const intDef = def.players[intBy];
          if (intDef) {
            intDef.int_yds = (intDef.int_yds || 0) + finalRetYds;
            if (finalRetYds > (intDef.int_long || 0)) intDef.int_long = finalRetYds;
            if (isPickSix) { intDef.int_td = (intDef.int_td || 0) + 1; intDef.def_td = (intDef.def_td || 0) + 1; }
          }
        }
        if (isPickSix) {
          this.score[this.poss === "home" ? "away" : "home"] += 6;
          def.team.def_td = (def.team.def_td || 0) + 1;
        }
        this._pushVisual({
          kind: "int", desc: isPickSix
            ? `PICK SIX! ${intBy} returns it ${finalRetYds} yds for a touchdown!`
            : isTouchback
              ? `INTERCEPTION! ${intBy} picks it off in the end zone — touchback`
              : finalRetYds > 0
                ? `INTERCEPTION! ${intBy} picks off ${this.offR.starters.qb} and returns ${finalRetYds} yds`
                : `INTERCEPTION! ${this.offR.starters.qb} picked off!`,
          startYard, targetDepth, endYard: startYard,
          passer: this.offR.starters.qb, defender: intBy,
          intReturnYds: finalRetYds, isPickSix, isTouchback, intSpotYL,
          isPlayAction, isFleaFlicker,
        });
        if (isPickSix) this._defScoreXP();
        return { turnover: true, retYds: finalRetYds, isPickSix, isTouchback, intSpotYL };
      }
      // Sacks: heavily driven by the OL-vs-DL trench matchup (pressure).
      // Play-action holds the ball longer → more sack risk.
      const sackPb = (pb.sackMul || 1.0) * paSackMul;
      // Composed QB sack reduction: high-AWR QBs slide in the pocket and
      // throw the ball away rather than absorbing the sack. AWR 95 → ~50%
      // fewer sacks; AWR 60 → +20% (jittery, holds it too long).
      const qbAwrSackMul = clamp(1 - (qbAwr - 70) / 60, 0.50, 1.30);
      // BLITZER LBs and SLOT_CBs add small but additive sack bonuses — more
      // bodies bringing the heat ups the odds even when the trench loses.
      const defArchPre = this.defArch;
      const blitzerLBs = (defArchPre.LB || []).filter(l => l?.archetype === "BLITZER").length;
      const slotBlitzCBs = (defArchPre.CB || []).filter(c => c?.archetype === "SLOT_CB").length;
      const archSackBonus = blitzerLBs * 0.025 + slotBlitzCBs * 0.012;
      // Defensive playbook tilts: blitz schemes ramp the sack chance up,
      // dime / prevent schemes drop it.
      const defPbCurrent = this.currentDefPlaybook;
      // MLB aggression tilts the pass-rush effort — blitz-happy MLBs dial up
      // pressure even when the OL matchup doesn't favor it.
      const mlbAggMul = this._aggTilt(this._mlbAggression()); // BLITZER MLB →  up to 1.30
      // Sack rate: NFL league avg ~7%/dropback, elite pass rush vs bad OL
      // tops out ~13-14%. Base/pressure tuned to hit ~5-7%/dropback after
      // multipliers stack (sackPb playbook + AWR + def scheme + MLB agg).
      const sackPct = clamp((0.07 + pressure * 0.08 - adv * 0.02 + archSackBonus) * sackPb * qbAwrSackMul * defPbCurrent.sackMul * mlbAggMul, 0.015, 0.17);
      if (Math.random() < sackPct) {
        // THROW ON THE RUN — mobile QBs with high AGI sometimes escape pressure
        // and throw on the move instead of taking the sack. Lower comp / air
        // (it's an off-platform throw), but no sack loss. POCKET QBs never roll.
        const torSkill = clamp((qbAgi + qbThr - 130) / 100, 0, 1);  // 0-1
        const archMul = qbArch === "DUAL_THREAT" ? 1.4 : qbArch === "POCKET" ? 0.1 : qbArch === "GUNSLINGER" ? 0.9 : 1.0;
        // Was 0.35 * archMul (up to 0.45) — let mobile QBs escape too easily.
        // Now most pressure plays still end in a sack even for DT QBs.
        const torChance = clamp(torSkill * 0.22 * archMul, 0, 0.30);
        if (Math.random() < torChance) {
          // Roll the TOR completion check — meaningfully worse than a pocket throw
          const torComp = clamp(0.40 + (qbAgi - 60) / 200 + (qbThr - 70) / 220 - pressure * 0.05, 0.18, 0.72);
          const torRoll = Math.random();
          if (torRoll < torComp) {
            // Completed on the run — shorter / less accurate throw
            const airYds = clamp(normal(7 - pressure * 1.5, 5.5), 1, 35);
            const targetDepth = Math.max(1, Math.round(airYds));
            const yac = airYds >= 5 ? rand(0, Math.max(1, Math.floor(airYds * 0.4))) : 0;
            const yards = Math.min(Math.max(1, targetDepth + yac), 100 - startYard);
            const rcvr = pickReceiver(pb, this.offR.starters, this._currentPersonnel);
            const rcvrStats = off.players[rcvr];
            if (qbStats) { qbStats.pass_att++; qbStats.pass_comp++; qbStats.pass_yds += yards; if (yards > qbStats.pass_long) qbStats.pass_long = yards; }
            if (rcvrStats) { rcvrStats.rec_tgt++; rcvrStats.rec++; rcvrStats.rec_yds += yards; if (yards > rcvrStats.rec_long) rcvrStats.rec_long = yards; }
            off.team.pass_att++; off.team.pass_comp++; off.team.passYds += yards; off.team.totalYds += yards;
            this._lastBallCarrier = rcvr; this._lastBallType = "pass";
            const isTorTD = clamp(startYard + yards, 0, 100) >= 100;
            const tacklerName = (yards > 0 && !isTorTD) ? this._creditDefStat("tkl", { LB: 0.35, S: 0.30, CB: 0.25, DL: 0.10 }) : null;
            const torEndTag = isTorTD ? " — TOUCHDOWN!" : tacklerName ? `, tackled by ${tacklerName}` : "";
            this._pushVisual({
              kind: "complete", desc: `${this.offR.starters.qb} throws on the run to ${rcvr} for ${yards} yds${torEndTag}`,
              startYard, targetDepth, catchDepth: targetDepth, yac, yards,
              endYard: clamp(startYard + yards, 0, 100), receiver: rcvr, passer: this.offR.starters.qb,
              tackler: tacklerName, throwType: "TOR", isTOR: true,
            });
            return { yards };
          } else {
            // Incomplete on the run — throwaway
            if (qbStats) qbStats.pass_att++;
            off.team.pass_att++;
            this._pushVisual({
              kind: "incomplete", desc: `${this.offR.starters.qb} throws it away on the run`,
              startYard, targetDepth: 8, endYard: startYard,
              passer: this.offR.starters.qb, isTOR: true,
            });
            return { yards: 0, incomplete: true };
          }
        }
        // SACK EVASION → RUN — agile QBs sometimes escape the pocket and
        // turn the would-be sack into a positive-yardage scramble. Tied
        // to AGI (with AWR helping a bit) and archetype. Pocket passers
        // basically can't do this; dual-threats can do it often.
        const evadeSkill = clamp((qbAgi - 65) / 30, 0, 1);              // 0 at AGI 65, 1 at AGI 95
        const archMulEvade = qbArch === "DUAL_THREAT" ? 1.6
                            : qbArch === "POCKET"     ? 0.08
                            : qbArch === "GUNSLINGER" ? 0.55
                            :                             1.0;
        const awrAssist = clamp((qbAwr - 70) / 80, 0, 0.25);            // small AWR boost
        const evadeChance = clamp((evadeSkill * 0.18 + awrAssist) * archMulEvade, 0, 0.32);
        if (Math.random() < evadeChance) {
          // Escape successful — generate yards, biased by AGI. Most
          // are short (2-6 yds), a few are explosive (Lamar-style).
          const yardsRaw = normal(4 + (qbAgi - 70) / 11, 5);
          let yards = clamp(Math.round(yardsRaw), -2, 35);
          if (yards > 0) yards = Math.min(yards, 100 - startYard);
          if (qbStats) {
            qbStats.rush_att = (qbStats.rush_att || 0) + 1;
            qbStats.rush_yds = (qbStats.rush_yds || 0) + yards;
            if (yards > (qbStats.rush_long || 0)) qbStats.rush_long = yards;
          }
          off.team.rush_att++; off.team.rushYds += yards; off.team.totalYds += yards;
          this._lastBallCarrier = QB; this._lastBallType = "rush";
          const isEvadeTD = clamp(startYard + yards, 0, 100) >= 100;
          const tacklerName = (yards > -2 && !isEvadeTD)
            ? this._creditDefStat("tkl", { LB: 0.30, S: 0.30, CB: 0.25, DL: 0.15 })
            : null;
          const endTag = isEvadeTD
            ? " — TOUCHDOWN!"
            : tacklerName ? `, tackled by ${tacklerName}` : "";
          this._pushVisual({
            kind: "run",
            desc: `${this.offR.starters.qb} escapes pressure for ${yards} yds${endTag}`,
            startYard, yards,
            endYard: clamp(startYard + yards, 0, 100),
            rusher: QB, isScramble: true,
            tackler: tacklerName,
          });
          return { yards };
        }
        const loss = rand(3, 11);
        if (qbStats) { qbStats.sacks_taken++; qbStats.sack_yds += loss; }
        off.team.sacks_allowed++; def.team.sacks++;
        // Credit the sack to the DL who won the rep (also count as tackle)
        if (reps.dl?.name && def.players[reps.dl.name]) {
          def.players[reps.dl.name].sk = (def.players[reps.dl.name].sk || 0) + 1;
          def.players[reps.dl.name].sk_yds = (def.players[reps.dl.name].sk_yds || 0) + loss;
          def.players[reps.dl.name].tkl = (def.players[reps.dl.name].tkl || 0) + 1;
        }
        // Charge the sack to the OL who lost the rep
        if (reps.ol?.name && off.players[reps.ol.name])
          off.players[reps.ol.name].sacks_allowed = (off.players[reps.ol.name].sacks_allowed || 0) + 1;
        // Pick a move from the DL's archetype toolkit
        const moves = DL_ARCHETYPES[reps.dlType]?.moves || ["SACK"];
        const move = moves[Math.floor(Math.random() * moves.length)];
        this._pushVisual({
          kind: "sack", desc: `${this.offR.starters.qb} sacked for -${loss} yds`,
          startYard, sackLoss: loss, endYard: clamp(startYard - loss, 1, 99),
          passer: this.offR.starters.qb,
          dlName: reps.dl?.name, dlType: reps.dlType, dlMove: move,
          olName: reps.ol?.name, olType: reps.olType,
          isPlayAction, isFleaFlicker,
        });
        // Return negative yardage and let _drive() handle the down progression.
        // (Previously we mutated this.yardLine/down/ytg directly which double-counted
        // the down increment in _drive(), turning a 3rd-down sack into a phantom
        // turnover-on-downs.)
        return { yards: -loss };
      }
      // Pressure disrupts comp% (QB rushed, throw-aways, contested catches)
      const compPbMul = pb.compMul || 1.0;
      // Shutdown CBs suppress comp%; possession WRs boost it slightly
      const shutdownPenalty = (defArch.CB || []).filter(c => c?.archetype === "SHUTDOWN").length * 0.025;
      const offArch = this.offArch;
      const possessionBonus = ((offArch.WR1?.archetype === "POSSESSION") ? 0.020 : 0)
                            + ((offArch.WR2?.archetype === "POSSESSION") ? 0.012 : 0);
      // Screen passes — about 8% of called passes are screens. High comp rate, modest YAC.
      // Skip on 3rd & long (screens get blown up by overzealous blitzers).
      const isScreenCall = !(isThird && this.ytg >= 9) && Math.random() < 0.085;
      if (isScreenCall) {
        const rcvr = this.offR.starters.rb;
        const rcvrStats = off.players[rcvr];
        if (Math.random() < 0.84) {
          // Completed screen
          const airYds = rand(-1, 1);
          const baseYac = rand(2, 7);
          const bigYac = Math.random() < 0.16 ? rand(8, 22) : 0;
          const yac = baseYac + bigYac;
          const yards = Math.min(clamp(airYds + yac, -3, 95), 100 - startYard);
          if (qbStats) { qbStats.pass_att++; qbStats.pass_comp++; qbStats.pass_yds += yards; if (yards > qbStats.pass_long) qbStats.pass_long = yards; }
          if (rcvrStats) { rcvrStats.rec_tgt++; rcvrStats.rec++; rcvrStats.rec_yds += yards; if (yards > rcvrStats.rec_long) rcvrStats.rec_long = yards; }
          off.team.pass_att++; off.team.pass_comp++; off.team.passYds += yards; off.team.totalYds += yards;
          this._lastBallCarrier = rcvr; this._lastBallType = "pass";
          const isScreenTD = clamp(startYard + yards, 0, 100) >= 100;
          const tacklerName = (yards > 0 && !isScreenTD) ? this._creditDefStat("tkl", { LB: 0.30, S: 0.25, CB: 0.25, DL: 0.20 }) : null;
          const screenEndTag = isScreenTD ? " — TOUCHDOWN!" : tacklerName ? `, tackled by ${tacklerName}` : "";
          this._pushVisual({
            kind: "complete", desc: `Screen to ${rcvr} for ${yards} yds${screenEndTag}`,
            startYard, targetDepth: airYds, catchDepth: airYds, yac, yards,
            endYard: clamp(startYard + yards, 0, 100), receiver: rcvr,
            passer: this.offR.starters.qb, tackler: tacklerName, isScreen: true,
          });
          return { yards };
        } else {
          // Screen got blown up — incomplete (timing was off, defender read it)
          if (qbStats) qbStats.pass_att++;
          if (rcvrStats) rcvrStats.rec_tgt++;
          off.team.pass_att++;
          this._pushVisual({
            kind: "incomplete", desc: `Screen broken up — incomplete`,
            startYard, targetDepth: -1, endYard: startYard,
            passer: this.offR.starters.qb, intended: rcvr, isScreen: true,
          });
          return { yards: 0, incomplete: true };
        }
      }
      // Pick the targeted receiver up front so their CAT/archetype affect the completion roll.
      // (Previously the receiver was picked AFTER the comp roll, so a 39-CAT WR had
      // the same comp% as a 95-CAT one — that's no longer true.)
      const rcvr = pickReceiver(pb, this.offR.starters, this._currentPersonnel);
      const rcvrStats = off.players[rcvr];
      const rcvrPlayer = this._playerByName?.get?.(rcvr) || null;
      const rcvrCat = rcvrPlayer?.stats?.[5] ?? 70;
      const rcvrAwr = rcvrPlayer?.stats?.[3] ?? 65;
      // CAT swings comp% meaningfully — a 95-CAT WR catches everything thrown his way,
      // a 60-CAT WR is a question mark on every throw.
      const catCompMod = (rcvrCat - 70) / 130;       // CAT 95 → +0.192; CAT 60 → -0.077
      const awrCompMod = (rcvrAwr - 65) / 280;       // route-running bump
      // ── WR ARCHETYPE EFFECTS on this throw ──
      // Bonuses/penalties to comp% based on the targeted receiver's
      // archetype. DEEP_THREAT trades catch% for big plays; POSSESSION
      // is a chain-mover; ROUTE_RUNNER beats coverage; RED_ZONE only
      // matters near the end zone.
      const rcvrArch = rcvrPlayer?.archetype;
      const isRedZone = startYard >= 80;
      let archCompMod = 0;
      if      (rcvrArch === "POSSESSION")   archCompMod = 0.045;
      else if (rcvrArch === "ROUTE_RUNNER") archCompMod = 0.030;
      else if (rcvrArch === "SLOT")         archCompMod = 0.025;
      else if (rcvrArch === "DEEP_THREAT")  archCompMod = -0.040;
      else if (rcvrArch === "RED_ZONE")     archCompMod = isRedZone ? 0.055 : -0.010;
      // OC Red Zone Genius: +8% comp in the red zone
      const ocRZGeniusMod = (isRedZone && _ocTrait === "Red Zone Genius") ? 0.08 : 0;
      archCompMod += ocRZGeniusMod;
      // CB MATCHUP — the specific covering CB's COV stat is a major factor.
      // Top WR (wr1) is covered by top CB (cb1); WR2 by CB2. TE/RB get LBs.
      // Plus a small safety-help term so a great deep safety helps overall.
      let cbCoverMod = 0;
      const wrSlotKey = rcvr === this.offR.starters.wr1 ? "cb1"
                      : rcvr === this.offR.starters.wr2 ? "cb2"
                      : null;
      if (wrSlotKey) {
        const cbName = this.defR.starters[wrSlotKey];
        const cbPlayer = cbName ? this._playerByName?.get?.(cbName) : null;
        const cbCov = cbPlayer?.stats?.[8] ?? 65;
        cbCoverMod = -(cbCov - 65) / 170;            // COV 95 → -0.176; COV 45 → +0.118
        // Safety help — average COV of the 2 starting safeties tightens things up
        const safNames = [this.defR.starters.fs, this.defR.starters.ss];
        const safPlayers = safNames.map(n => this._playerByName?.get?.(n)).filter(Boolean);
        if (safPlayers.length) {
          const avgSafCov = safPlayers.reduce((s,p) => s + (p.stats?.[8] || 65), 0) / safPlayers.length;
          cbCoverMod -= (avgSafCov - 65) / 480;       // up to ~-0.063 from elite safety duo
        }
      }
      // QB OVR matters a lot for completion %: a 60-OVR scrub completes far less than a 90-OVR star
      // (swing of ~0.20 across 30 OVR points, centered around 75 OVR baseline)
      // OVR completion boost compressed: was (OVR-75)/150 giving a 99
      // OVR a +16pp swing — too extreme. Real NFL elite vs average is
      // ~5pp gap. Halved to (OVR-75)/300 → 99-OVR = +8pp swing.
      const qbCompFromOvr = (this.offR.qb - 75) / 300;
      // ── COMPOSED-QB POCKET BONUS ──────────────────────────────────────
      // Smart, cool-headed QBs (high AWR) extend plays in the pocket — they
      // step up, slide, hold the ball longer, and wait for the deep route
      // to open. They take fewer sacks AND find the favorable matchup. The
      // edge scales with AWR: 60 → -0.20 (jittery), 75 → +0.10, 95 → +0.50.
      const qbPocketBonus = clamp((qbAwr - 70) / 50, -0.20, 0.50);
      // Speed-vs-coverage mismatch: when our targeted WR is meaningfully
      // faster than the covering CB, a smart QB sees the step + lets it
      // develop. Bonus only applies when the QB is composed enough to wait.
      let mismatchBonus = 0;
      if (wrSlotKey && qbPocketBonus > 0) {
        const cbName2 = this.defR.starters[wrSlotKey];
        const cbPlayer2 = cbName2 ? this._playerByName?.get?.(cbName2) : null;
        const cbCov2 = cbPlayer2?.stats?.[8] ?? 65;
        const wrSpd  = rcvrPlayer?.stats?.[0] ?? 70;
        const speedAdv = wrSpd - cbCov2;   // positive when WR has the step
        if (speedAdv > 6) {
          mismatchBonus = qbPocketBonus * 0.45 * Math.min(1, (speedAdv - 6) / 14);
        }
      }
      // ── DEFENSIVE ARCHETYPE EFFECTS ─────────────────────────────────────
      //  COVER LB        → reduces TE/RB completion %
      //  SIGNAL LB       → smart play recognition, mild comp% suppression
      //  ZONE CB         → caps WR juke / explosive YAC (handled below)
      //  PHYSICAL CB     → jams the WR — reduces speed mismatch bonus
      //  SLOT_CB         → better vs SLOT WR (handled at slot matchup)
      //  CENTER_FIELD S  → caps deep passing (reduces air yards on deep throws)
      const isTeRbTarget = rcvr === this.offR.starters.te || rcvr === this.offR.starters.rb;
      const coverLBs = (defArch.LB || []).filter(l => l?.archetype === "COVER").length;
      const signalLBs = (defArch.LB || []).filter(l => l?.archetype === "SIGNAL").length;
      const coverLbMod = -(coverLBs * (isTeRbTarget ? 0.040 : 0.012));
      const signalLbMod = -(signalLBs * 0.012);
      // Physical CB jam — kills the speed mismatch if our targeted WR is on
      // a press corner. Only applies when the targeted slot matches.
      let physicalJamMod = 0;
      if (wrSlotKey) {
        const cbName3 = this.defR.starters[wrSlotKey];
        const cbPlayer3 = cbName3 ? this._playerByName?.get?.(cbName3) : null;
        if (cbPlayer3?.archetype === "PHYSICAL") {
          physicalJamMod = -0.025;
          // Also zero out the mismatchBonus when the WR was getting beat off the line
          mismatchBonus *= 0.4;
        }
      }
      // ZONE CB caps the post-catch chunk play. Stored for the YAC section
      // below.
      const zoneCB = wrSlotKey ? (this.defR.starters[wrSlotKey]
        ? this._playerByName?.get?.(this.defR.starters[wrSlotKey])?.archetype === "ZONE"
        : false) : false;
      // Weather: slippery ball (rain/snow) drops completion %, wind hurts
      // deep passes (caught further below in airMean adjustment).
      const wxPass = this.weather || { label: "CLEAR" };
      const wxCompMod = wxPass.label === "RAIN" ? -0.05
                      : wxPass.label === "SNOW" ? -0.08
                      : 0;
      // Defensive-scheme tilt: nickel / dime tighten pass coverage, 46 blitz leaves windows open.
      // DC Cover Scheme: -3% completion rate for the offense
      const dcCoverSchemeMul = _dcTrait === "Cover Scheme" ? 0.97 : 1.0;
      const compPct = clamp((0.62 + adv * 0.12 + qbCompFromOvr - pressure * 0.11 - shutdownPenalty + possessionBonus + qbCompMod + paCompMod + catCompMod + awrCompMod + cbCoverMod + mismatchBonus + coverLbMod + signalLbMod + physicalJamMod + wxCompMod + archCompMod) * compPbMul * defPbCurrent.passMul * dcCoverSchemeMul, 0.12, 0.84);
      if (Math.random() < compPct) {
        // Air yards drop when pressure shortens the QB's reads (check-downs / dump-offs)
        // Weaker QBs also throw shorter — they can't push the ball downfield reliably.
        // Composed QBs (high AWR) push the ball further by extending the play
        // and waiting for the deep route to break open.
        // Air-yards boost from OVR halved: was /12 giving 99-OVR +2.0
        // air-yards. Combined with the higher base airYdsMean (7.5)
        // and YAC layer this produced ~13-15 yd avg completions for
        // elites — too high. /24 keeps the elite advantage but
        // compresses to ~+1.0yd at 99 OVR.
        const qbAirFromOvr = (this.offR.qb - 75) / 24;
        const qbPocketAirBonus = Math.max(0, qbPocketBonus) * 3.5;   // up to +1.75 yds at AWR 95
        // CENTER_FIELD safety caps deep passing — pulls the air mean down
        // when a rangy single-high safety is on the field.
        const centerFieldS = (defArch.S || []).filter(s => s?.archetype === "CENTER_FIELD").length;
        const centerFieldCap = -centerFieldS * 1.2;
        // Weather: wind crushes deep balls into the headwind, rain/snow
        // make all throws slightly shorter (slippery ball).
        const teamPassDir = this.poss === "home" ? 1 : -1;
        const passWindWith = wxPass.windStrength
          ? wxPass.windStrength * (wxPass.windDir === teamPassDir ? 1 : -1)
          : 0;
        const wxAirMod = wxPass.label === "WINDY" ? passWindWith * 2.5
                       : wxPass.label === "SNOW"  ? passWindWith * 2.0 - 1.5
                       : wxPass.label === "RAIN"  ? -1.0
                       : 0;
        // Defensive scheme: prevent shells crush deep balls, blitz looks
        // leave them open. deepCovMul > 1 means the offense gets MORE
        // deep yards (defense gives them up).
        const defDeepBonus = (defPbCurrent.deepCovMul - 1) * 4.5;   // -2 for prevent, +0.7 for blitz_46
        // WR archetype tilts air yards. Deep threats push the ball
        // downfield; possession / slot / RZ trade air for shorter, surer
        // routes.
        const archAirMod = rcvrArch === "DEEP_THREAT"  ?  3.0
                         : rcvrArch === "POSSESSION"   ? -1.5
                         : rcvrArch === "SLOT"         ? -2.0
                         : rcvrArch === "RED_ZONE"     ? -1.2
                         : rcvrArch === "ROUTE_RUNNER" ?  0.5
                         : 0;
        // Aggressive QBs call more deep shots — tilts target depth up/down.
        const qbAggAirMod = (this._aggTilt(this._qbAggression()) - 1) * 3.0; // agg=80→+0.9yds, agg=20→-0.9yds
        // OC Air Attack: +1.0 to air yards mean
        const ocAirAttackMod = _ocTrait === "Air Attack" ? 1.0 : 0;
        const airMean = (pb.airYdsMean ?? 7.5) - pressure * 2.8 + qbAirMod + qbAirFromOvr + paAirMod + qbPocketAirBonus + centerFieldCap + wxAirMod + defDeepBonus + archAirMod + qbAggAirMod + ocAirAttackMod;
        const airSd   = (pb.airYdsSd   ?? 6) * (qbArch === "GUNSLINGER" ? 1.25 : 1.0);
        const airYds  = clamp(normal(airMean + adv * 2, airSd), -2, 55);
        // YAC distribution — short catches / screens get more YAC potential.
        // Tuned to land NFL-average ~5.5 yds YAC per completion.
        let yac = 0;
        if (airYds >= 1) {
          const r = Math.random();
          if (r < 0.28) yac = 0;
          else if (r < 0.65) yac = rand(1, Math.max(3, Math.floor(airYds * 0.5)) + 2);
          else if (r < 0.90) yac = rand(3, Math.max(6, Math.floor(airYds * 0.9)) + 3);
          else                yac = rand(5, 16) + Math.floor(airYds * 0.5); // big YAC run
        }
        // YAC archetype tilt: SLOT and POSSESSION are YAC monsters on
        // short routes; RED_ZONE is a low-YAC big body (catches and gets
        // tackled in place); DEEP_THREAT doesn't get many YAC chances
        // (already running with the ball, defenders converge).
        const yacArchMul = rcvrArch === "SLOT"        ? 1.45
                         : rcvrArch === "POSSESSION"  ? 1.25
                         : rcvrArch === "ROUTE_RUNNER" ? 1.10
                         : rcvrArch === "RED_ZONE"    ? 0.55
                         : rcvrArch === "DEEP_THREAT" ? 0.85
                         : 1.0;
        yac = Math.round(yac * yacArchMul);
        // RARE WR JUKE — elite-handed, agile receivers occasionally catch and
        // immediately put a move on the closest defender for a phat YAC chunk.
        // Requires CAT >= 80 AND AGI >= 80; both at 90+ triggers more often.
        let wrJuke = false;
        const rcvrP = this._playerByName.get(rcvr);
        if (rcvrP && airYds >= 3 && airYds <= 30) {
          const rcat = rcvrP.stats?.[5] ?? 60;
          const ragi = rcvrP.stats?.[2] ?? 60;
          if (rcat >= 80 && ragi >= 80) {
            const eliteFactor = Math.max(0, ((rcat + ragi) / 2 - 80) / 19);   // 0 at 80, 1 at 99
            const archMul = rcvrP.archetype === "SLOT" ? 1.5
                          : rcvrP.archetype === "ROUTE_RUNNER" ? 1.2
                          : rcvrP.archetype === "POSSESSION" ? 0.6
                          : 1.0;
            // ZONE CB caps the post-catch chunk by ~50% — disciplined
            // defenders break on the ball quickly + don't get juked.
            const zoneMul = zoneCB ? 0.5 : 1.0;
            const wrJukeChance = clamp(0.04 + eliteFactor * 0.10, 0, 0.18) * archMul * zoneMul;
            if (Math.random() < wrJukeChance) {
              wrJuke = true;
              yac += rand(6, 16);   // post-catch chunk
            }
          }
        }
        const targetDepth = Math.max(1, Math.round(airYds));
        // Cap at distance to end zone so a 3-yd goal-line catch doesn't get reported as a 25-yd TD
        const yards = Math.min(clamp(targetDepth + yac, -2, 95), 100 - startYard);
        // (receiver was picked above, before the comp roll)
        // Throw type — QB picks based on situation + archetype:
        //  CHECKDOWN (≤4 yds): low arc, fast — short outlet
        //  ZIP (5-18 yds, tight window): low arc + max velocity — threading the needle
        //  TOUCH (5-18 yds, soft route): higher arc + slower — gentle drop-in
        //  DEEP (≥19 yds): big arc, max distance
        const throwTypeRoll = Math.random();
        let throwType;
        if (airYds <= 4) {
          throwType = "CHECKDOWN";
        } else if (airYds >= 19) {
          throwType = "DEEP";
        } else {
          // Mid-range: pick TOUCH vs ZIP based on QB archetype + situation
          const zipBias = qbArch === "GUNSLINGER" ? 0.65
                       : qbArch === "GAME_MANAGER" ? 0.20
                       : qbArch === "POCKET" ? 0.40
                       : qbArch === "FIELD_GENERAL" ? 0.45
                       : 0.50;
          // Tight windows (3rd-and-medium, red zone) favor ZIP
          const tightBoost = (isThird && this.ytg >= 5) ? 0.15 : 0;
          throwType = throwTypeRoll < (zipBias + tightBoost) ? "ZIP" : "TOUCH";
        }
        // CATCH RADIUS — combined CAT + AGI + AWR + a body-size bump determines
        // how big a window the receiver can pluck the ball from. Drives high-
        // point catch ability on deep / contested throws.
        const rcat = rcvrPlayer?.stats?.[5] ?? 65;
        const ragi = rcvrPlayer?.stats?.[2] ?? 65;
        const rawr = rcvrPlayer?.stats?.[3] ?? 65;
        const bodyBonus = rcvrPlayer?.bodyType === "BROAD" ? 4
                        : rcvrPlayer?.bodyType === "TALL_HEAVY" ? 6
                        : rcvrPlayer?.bodyType === "LEAN" ? 2 : 0;
        const catchRadius = rcat * 0.4 + ragi * 0.35 + rawr * 0.25 + bodyBonus;  // 0-100ish
        // Deep / high passes trigger a LEAP — receiver gets airborne to high-point
        // the ball. We mark this as cosmetic since the comp/incomp decision
        // was already made above (this branch is the COMPLETED case).
        const isLeapingCatch = airYds >= 16 && (
          catchRadius >= 75 || (catchRadius >= 60 && Math.random() < 0.5)
        );
        if (qbStats) { qbStats.pass_att++; qbStats.pass_comp++; qbStats.pass_yds += yards; if (yards > qbStats.pass_long) qbStats.pass_long = yards; }
        if (rcvrStats) { rcvrStats.rec_tgt++; rcvrStats.rec++; rcvrStats.rec_yds += yards; if (yards > rcvrStats.rec_long) rcvrStats.rec_long = yards; }
        off.team.pass_att++; off.team.pass_comp++; off.team.passYds += yards; off.team.totalYds += yards;
        this._lastBallCarrier = rcvr; this._lastBallType = "pass";
        // Tackle credit on the catch — DBs / LBs make most tackles in the open field
        const isTD = clamp(startYard + yards, 0, 100) >= 100;
        const tacklerName = (yards > 0 && !isTD) ? this._creditDefStat("tkl", { LB: 0.35, S: 0.30, CB: 0.25, DL: 0.10 }) : null;
        const flavorTag = wrJuke ? " (CATCH AND JUKE!)"
                        : isLeapingCatch ? " (HIGH POINTED!)" : "";
        const endTag = isTD ? " — TOUCHDOWN!"
                     : tacklerName ? `, tackled by ${tacklerName}` : "";
        this._pushVisual({
          kind: "complete",
          desc: `${this.offR.starters.qb} → ${rcvr} for ${yards} yds${flavorTag}${endTag}`,
          startYard, targetDepth, catchDepth: targetDepth, yac, yards,
          endYard: clamp(startYard + yards, 0, 100), receiver: rcvr, passer: this.offR.starters.qb,
          tackler: tacklerName, throwType, isPlayAction, isFleaFlicker, wrJuke, isLeapingCatch, catchRadius,
        });
        return { yards };
      }
      const targetDepth = clamp(normal(13, 8), 3, 45);
      // (rcvr/rcvrStats/rcvrPlayer/rcvrCat already in scope from the outer pass block)
      if (qbStats) qbStats.pass_att++;
      if (rcvrStats) rcvrStats.rec_tgt++;
      off.team.pass_att++;
      // Drop chance — on a missed-comp, was this a drop or off-target? Lower-CAT
      // receivers are way more likely to be the drop side of the equation.
      const archMul = rcvrPlayer?.archetype === "POSSESSION" ? 0.55
                    : rcvrPlayer?.archetype === "DEEP_THREAT" ? 1.25
                    : 1.0;
      const dropBase = clamp((90 - rcvrCat) / 220 + 0.035, 0.02, 0.30) * archMul;
      const isDrop = Math.random() < dropBase;
      let pdName = null;
      if (isDrop) {
        if (rcvrStats) rcvrStats.rec_drops = (rcvrStats.rec_drops || 0) + 1;
        off.team.drops = (off.team.drops || 0) + 1;
      } else {
        // 55% of non-drop incompletions are pass deflections (overthroughs,
        // throwways, bad releases account for the other ~45%)
        pdName = Math.random() < 0.55 ? this._creditDefStat("pd", { CB: 0.55, S: 0.30, LB: 0.15 }) : null;
      }
      // CATCH RADIUS / NEAR-MISS LEAP — for deep throws, the receiver leaps
      // and the ball flies past their fingertips. Cosmetic flag for the animation.
      const incRagi = rcvrPlayer?.stats?.[2] ?? 60;
      const incRawr = rcvrPlayer?.stats?.[3] ?? 60;
      const incCatchRadius = rcvrCat * 0.4 + incRagi * 0.35 + incRawr * 0.25;
      const isLeapMiss = !isDrop && targetDepth >= 18 && incCatchRadius >= 55;
      // ── INCOMPLETE REASON ──
      // Drop / leap-miss / PD are already determined above. For anything
      // else, pick a more specific reason so the animation actually shows
      // what happened instead of one generic falling-ball clip.
      let incReason = null;
      let incDesc = `${this.offR.starters.qb} pass incomplete`;
      if (isDrop) {
        incReason = "drop";
        incDesc = `DROP! ${rcvr} can't hang on`;
      } else if (isLeapMiss) {
        incReason = "leapmiss";
        incDesc = `${this.offR.starters.qb}'s pass sails through ${rcvr}'s hands`;
      } else if (pdName) {
        incReason = "pd";
        incDesc = `${this.offR.starters.qb} pass broken up by ${pdName}`;
      } else {
        // Generic incompletion — pick a specific reason. Weighting depends
        // on context (pressure, throw depth, QB stats).
        const qbThrLocal = qbPlayer?.stats?.[4] ?? 75;
        const isMobile = qbAgi >= 75;
        const wThrowaway  = (pressure > 0.5 && isMobile) ? 30 : 4;     // mobile QB under pressure
        const wBatted     = targetDepth < 8 ? 12 : 3;                  // short throws get tipped at LOS
        const wOverthrown = 25 + (pressure > 0 ? 15 : 0) + (qbThrLocal < 70 ? 12 : 0) + (targetDepth >= 15 ? 12 : 0);
        const wUndertrown = 16 + (pressure > 0 ? 8 : 0) + (qbThrLocal < 70 ? 10 : 0);
        const wOffTarget  = 20;
        const totalW = wThrowaway + wBatted + wOverthrown + wUndertrown + wOffTarget;
        let pick = Math.random() * totalW;
        const QB = this.offR.starters.qb;
        if      ((pick -= wThrowaway)  < 0) { incReason = "throwaway"; incDesc = `${QB} throws it away under pressure`; }
        else if ((pick -= wBatted)     < 0) { incReason = "batted"; const dl = this._creditDefStat("pd", { DL: 0.80, LB: 0.20 }); pdName = dl; incDesc = `${QB}'s pass batted down at the line${dl ? ` by ${dl}` : ""}`; }
        else if ((pick -= wOverthrown) < 0) { incReason = "overthrown"; incDesc = `${QB} OVERTHROWS ${rcvr}`; }
        else if ((pick -= wUndertrown) < 0) { incReason = "underthrown"; incDesc = `${QB}'s pass UNDERTHROWN — ${rcvr} can't reach it`; }
        else                                { incReason = "offtarget"; incDesc = `${QB}'s pass off-target — ${rcvr} can't get there`; }
      }
      this._pushVisual({
        kind: "incomplete",
        desc: incDesc,
        startYard, targetDepth, endYard: startYard,
        passer: this.offR.starters.qb, intended: rcvr, defender: pdName,
        isDrop, isPlayAction, isFleaFlicker, isLeapMiss, incReason,
      });
      return { yards: 0, incomplete: true };
    }
    // Fumble chance — based on carrier's grip (STR + AWR), pressure, and archetype.
    // POWER backs cough it up more (carrying through contact); ELUSIVE less (rarely take direct hits).
    const optionMul = pb.qbRushFumbleMul || 1.0;
    const rbArch = this.offArch.RB?.archetype;
    const rbPlayer = this._playerByName.get(RB);
    const grip = rbPlayer ? ((rbPlayer.stats[1] || 70) + (rbPlayer.stats[3] || 70)) / 2 : 70;
    const gripMod = (75 - grip) / 600;    // grip 95 → -0.033; grip 55 → +0.033
    const archFumbleMul = rbArch === "POWER" ? 1.35 : rbArch === "ELUSIVE" ? 0.75 : 1.0;
    // Weather: rain/snow makes the ball slippery → more fumbles.
    const wxFum = this.weather || { label: "CLEAR" };
    const wxFumMod = wxFum.label === "RAIN" ? 0.006
                   : wxFum.label === "SNOW" ? 0.010
                   : 0;
    const fumblePct = clamp((0.011 + gripMod + Math.max(0, pressure) * 0.013 + wxFumMod) * optionMul * archFumbleMul, 0.004, 0.085);
    if (Math.random() < fumblePct) {
      // Scrum-based recovery — the ball bounces in a pile of converging players.
      // Defense has a slight edge in open field (1-3 dive attempts each muff the ball
      // until someone secures it). About 58% defense recovery overall.
      const muffRolls = rand(2, 4);
      let recoveredBy = null;
      let muffs = 0;
      for (let i = 0; i < muffRolls; i++) {
        if (Math.random() < 0.55) {        // 55% chance someone secures it this dive
          recoveredBy = Math.random() < 0.58 ? "def" : "off";
          break;
        }
        muffs++;
      }
      if (!recoveredBy) recoveredBy = Math.random() < 0.58 ? "def" : "off";
      const ffBy = this._creditDefStat("ff", { LB: 0.35, DL: 0.40, S: 0.20, CB: 0.05 });
      // Credit the FUMBLE to the carrier (separate from "lost" — recovered own fumble still counts).
      const carrierFumStats = off.players[RB];
      if (carrierFumStats) carrierFumStats.fumbles = (carrierFumStats.fumbles || 0) + 1;
      off.team.fumbles = (off.team.fumbles || 0) + 1;
      // FUMBLE SPOT — fumbles don't all happen at the snap. Estimate a
      // realistic spot somewhere along the projected gain (so a RB rumbling
      // 8 yds before getting stripped recovers the ball downfield).
      // Distribution biased toward shorter gains: most strips happen
      // early in the run, before the carrier breaks free.
      const projectedYds = Math.max(0, Math.round(normal(2.5, 3.2)));
      const fumbleAdvance = Math.min(projectedYds, Math.max(0, 100 - startYard - 1));
      const fumbleSpotYL = clamp(startYard + fumbleAdvance, 1, 99);
      if (recoveredBy === "def") {
        off.team.turnovers++; def.team.takeaways++;
        off.team.fumbles_lost = (off.team.fumbles_lost || 0) + 1;
        if (carrierFumStats) carrierFumStats.fumbles_lost = (carrierFumStats.fumbles_lost || 0) + 1;
        // Carrier gets credit for the rushing yards UP TO the fumble.
        if (carrierFumStats && fumbleAdvance > 0) {
          carrierFumStats.rush_att++;
          carrierFumStats.rush_yds += fumbleAdvance;
        }
        off.team.rush_att++; off.team.rushYds += fumbleAdvance; off.team.totalYds += fumbleAdvance;
        const frBy = this._creditDefStat("fr", { LB: 0.35, DL: 0.35, S: 0.20, CB: 0.10 });
        const spotDesc = fumbleAdvance > 0 ? ` (lost at the ${fumbleSpotYL <= 50 ? `own ${fumbleSpotYL}` : `opp ${100 - fumbleSpotYL}`})` : "";
        this._pushVisual({
          kind: "fumble",
          desc: `FUMBLE! Recovered by ${this[this.poss === "home" ? "away" : "home"].name} defense — ${ffBy ? `forced by ${ffBy}` : `loose ball`}!${spotDesc}`,
          startYard, endYard: fumbleSpotYL,
          rusher: RB, defender: frBy, forcedBy: ffBy, recoveredBy: "def", muffs,
          fumbleSpotYL,
        });
        return { turnover: true, fumbleSpotYL };
      } else {
        // Offense recovers — ball stays with them. Credit the yards UP to
        // the fumble, then subtract 2-6 yards for the dive (lost on the pile).
        const lossYds = rand(2, 6);
        const netYds = fumbleAdvance - lossYds;
        const carrierStats = off.players[RB];
        if (carrierStats) {
          carrierStats.rush_att++;
          carrierStats.rush_yds += netYds;
        }
        off.team.rush_att++; off.team.rushYds += netYds; off.team.totalYds += netYds;
        const finalYL = clamp(fumbleSpotYL - lossYds, 1, 99);
        this._pushVisual({
          kind: "fumble",
          desc: `FUMBLE! ${this.possTeam.name} recovers their own — ${netYds >= 0 ? "" : "net "}${netYds}-yd ${netYds >= 0 ? "gain" : "loss"} on the dive`,
          startYard, endYard: finalYL,
          rusher: RB, forcedBy: ffBy, recoveredBy: "off", muffs,
          yards: netYds,
        });
        return { yards: netYds };
      }
    }
    const rushMean = pb.rushYdsMean ?? 4.3;
    const rushSd   = pb.rushYdsSd   ?? 5.5;
    // ── TWO-BACK FORMATION DECISION ────────────────────────────────────
    // Only when there's a viable second back on the roster. Probability
    // tilts by playbook (GROUND_AND_POUND uses it the most), and short
    // yardage / goal line bumps it.
    const hasRB2 = !!this.offR.starters.rb2;
    let useTwoBack = false;
    if (hasRB2) {
      let twoBackPct = 0.16;       // balanced default
      if (pb.id === "GROUND_AND_POUND") twoBackPct = 0.35;
      else if (pb.id === "AIR_RAID")    twoBackPct = 0.04;
      else if (pb.id === "OPTION")      twoBackPct = 0.22;
      if (this.ytg <= 2) twoBackPct += 0.20;     // power short yardage
      if (startYard >= 95) twoBackPct += 0.15;   // goal line
      useTwoBack = Math.random() < twoBackPct;
    }
    // FB lead-block bonus — bumps rush yardage, reduces stuff risk
    const fbBoost = useTwoBack ? 0.9 : 0;
    const fbStuffReduction = useTwoBack ? 0.4 : 0;   // subtracts from trench loss
    // Read-option / RPO schemes give some carries to the QB
    const qbRushPct = pb.qbRushPct || 0;
    let isQBRun = qbRushPct > 0 && Math.random() < qbRushPct;
    // SPEED OPTION — a subset of QB-run calls where the RB trails the QB
    // as a live pitch threat. The QB sprints to the option side and either
    // KEEPS the ball or PITCHES to the trailing back. Option-heavy
    // playbooks call it most.
    let isSpeedOption = false;
    let isPitch = false;
    let optionRead = null;       // {defAttacksQb, goesCorrect, optSide} when speed option fires
    if (isQBRun && this.offR.starters.rb) {
      const speedOptPct = pb.id === "OPTION"       ? 0.40
                        : pb.id === "DUAL_THREAT" ? 0.22
                        : 0.10;
      if (Math.random() < speedOptPct) {
        isSpeedOption = true;
        // Deterministic play-side (matches the animation's optSide).
        const optSide = ((startYard * 19) >>> 0) % 2 === 0 ? 1 : -1;
        // ── EDGE READ DEFENDER ────────────────────────────────────────
        // The playside DE / OLB defines the option's outcome. Aggregate
        // the team's edge tendencies: aggressive front-7 archetypes push
        // toward COMMITTING to the QB; disciplined LBs stay on the pitch.
        const defArchSO = this.defArch;
        const aggressive = (defArchSO.LB || []).filter(l =>
          l?.archetype === "BLITZER" || l?.archetype === "THUMPER").length
          + (defArchSO.DL || []).filter(d =>
              d?.archetype === "SPEED" || d?.archetype === "POWER").length * 0.5;
        const disciplined = (defArchSO.LB || []).filter(l =>
          l?.archetype === "COVER" || l?.archetype === "SIGNAL").length;
        // Use a specific edge defender's AWR for the commit roll (one of
        // the LBs — defaults to LB1).
        const edgeLb = (defArchSO.LB || [])[optSide === 1 ? 2 : 0]
                     || (defArchSO.LB || [])[0];
        const edgeAwr = edgeLb ? (this._playerByName?.get?.(edgeLb.name)?.stats?.[3] ?? 70) : 70;
        let defAttacksQbChance = 0.50 + (aggressive - disciplined) * 0.08;
        // High-AWR edges READ the play and adjust (slight bias toward the
        // correct commit). For simplicity we just add small noise here.
        defAttacksQbChance += (edgeAwr - 70) / 600;
        defAttacksQbChance = clamp(defAttacksQbChance, 0.20, 0.82);
        const defAttacksQb = Math.random() < defAttacksQbChance;
        // ── QB READ ACCURACY ──────────────────────────────────────────
        // Sharp QBs (high AWR) make the correct give vs keep most of the
        // time. The CORRECT read is "pitch if defender attacks QB" or
        // "keep if defender plays the pitch back". Look up QB AWR locally
        // since the option play is on the run-side branch, where the
        // pass-play scope (which defines qbAwr) isn't reachable.
        const _optQbPlayer = this._playerByName?.get?.(QB);
        const _optQbAwr    = _optQbPlayer?.stats?.[3] ?? 70;
        const qbReadAccuracy = clamp((_optQbAwr - 55) / 50, 0.30, 0.94);
        const goesCorrect = Math.random() < qbReadAccuracy;
        const correctRead = defAttacksQb;   // true = correct read says PITCH
        isPitch = goesCorrect ? correctRead : !correctRead;
        optionRead = { defAttacksQb, goesCorrect, optSide };
        // If the RB carries (pitch), isQBRun flips so the rest of the sim
        // (carrier, stats, animation routing) routes through the RB.
        if (isPitch) isQBRun = false;
      }
    }
    // REVERSE — rare trick play, ~1.5% of non-QB runs. RB takes the handoff
    // and runs laterally, then pitches to a crossing WR who runs the other way.
    // High variance: bigger gains AND bigger losses if it gets read.
    // Never on two-back — fullbacks don't run reverses.
    const isReverse = !isQBRun && !useTwoBack && !isSpeedOption && Math.random() < 0.015;
    // ── RUN-PLAY VARIANTS (counter / stretch / pitch) ──────────────────
    // Pick a runType for the non-reverse, non-QB runs. Distribution favors
    // GROUND_AND_POUND and OPTION schemes for counter / pitch, AIR_RAID
    // teams stick mostly to inside zone.
    let runType = "inside";   // default
    if (!isQBRun && !isReverse && !isSpeedOption) {
      const r = Math.random();
      if (pb.id === "GROUND_AND_POUND") {
        if      (r < 0.18) runType = "counter";
        else if (r < 0.36) runType = "stretch";
        else if (r < 0.42) runType = "pitch";
      } else if (pb.id === "OPTION") {
        if      (r < 0.12) runType = "counter";
        else if (r < 0.24) runType = "stretch";
        else if (r < 0.36) runType = "pitch";
      } else if (pb.id === "AIR_RAID") {
        if      (r < 0.05) runType = "counter";
        else if (r < 0.10) runType = "stretch";
      } else {  // BALANCED + others
        if      (r < 0.10) runType = "counter";
        else if (r < 0.22) runType = "stretch";
        else if (r < 0.26) runType = "pitch";
      }
    }
    // Per-variant yardage tuning — counter = boom/bust, stretch needs
    // athletic OL, pitch = chunk upside with TFL risk if read.
    let runVarMean = 0, runVarSd = 1.0;
    if (runType === "counter") {
      runVarMean = (this.offR.ol >= 78 ? 1.2 : 0.2);   // counters die against bad OL
      runVarSd   = 1.35;
    } else if (runType === "stretch") {
      runVarMean = (this.offR.ol >= 80 ? 1.4 : -0.6);  // stretch demands athletic OL
      runVarSd   = 1.15;
    } else if (runType === "pitch") {
      runVarMean = 0.6;                                 // get on the edge fast
      runVarSd   = 1.45;                                // big plays + big losses
    }
    // SPEED OPTION yardage — now driven by whether the QB made the
    // CORRECT read of the edge defender. A correct read means the defense
    // is wrong-footed: the carrier has an open lane (chunk play). A wrong
    // read means the defender is right there at the mesh point (stuff).
    if (isSpeedOption) {
      if (optionRead?.goesCorrect) {
        // Right read — chunk
        if (isPitch) { runVarMean = 1.8; runVarSd = 1.50; }
        else          { runVarMean = 1.4; runVarSd = 1.35; }
      } else {
        // Wrong read — defender meets the carrier near the LOS
        if (isPitch) { runVarMean = -2.5; runVarSd = 0.85; }
        else          { runVarMean = -1.8; runVarSd = 0.90; }
      }
    }
    const carrier = isQBRun ? QB : RB;
    // QB runs break for chunks slightly more often — defense had to honor pass first
    const carrierBoost = isQBRun ? 0.8 : 0;
    // RB archetype effects on the rush: POWER drives short yardage, SPEED is boom/bust,
    // ELUSIVE breaks for slightly more big plays, RECEIVING is a worse pure runner
    let rbBoost = 0, rbSdMul = 1.0;
    if (!isQBRun) {
      switch (rbArch) {
        case "POWER":     rbBoost = 0.5;  rbSdMul = 0.85; break;  // less variance, sturdier
        case "SPEED":     rbBoost = 0.3;  rbSdMul = 1.30; break;  // boom/bust
        case "ELUSIVE":   rbBoost = 0.4;  rbSdMul = 1.10; break;
        case "WORKHORSE": rbBoost = 0.2;  rbSdMul = 0.95; break;
        case "RECEIVING": rbBoost = -0.6; rbSdMul = 1.0;  break;
      }
    }
    // Box safety adds some stuffing power; thumper LB does too
    const defArchRun = this.defArch;
    const boxSafetyStuff = ((defArchRun.S || []).filter(s => s?.archetype === "BOX").length * 0.2);
    const thumperStuff   = ((defArchRun.LB || []).filter(l => l?.archetype === "THUMPER").length * 0.18);
    // LB gap recognition: high-AWR linebackers read the run key pre-snap and fill
    // the right gap — smart LBs are in the right place before the RB gets there.
    const lbRunList = defArchRun.LB || [];
    const lbAwrAvg = lbRunList.length
      ? lbRunList.reduce((s, p) => s + (this._playerByName.get(p?.name)?.stats?.[3] ?? 70), 0) / lbRunList.length
      : 70;
    const lbGapRead = (lbAwrAvg - 70) / 300; // AWR 85 → +0.05 yds stuffed, AWR 55 → -0.05
    // RB gap vision: aware backs find the right crease without hesitation.
    const rbAwr = rbPlayer?.stats?.[3] ?? 70;
    const rbGapVision = (rbAwr - 70) / 280; // AWR 85 → +0.054 yds gained, AWR 55 → -0.054
    // Trench pressure drives run efficiency: elite DL stuffs runs at/near the LOS
    const trenchYds = -pressure * 1.9;   // dominant DL = average lost ~2 yds per carry
    const lbTackle  = (this.defR.lb - 60) / 60;  // strong LBs add minor stuffing
    // Run-blocking matchup tilts the gap — apply runMul to the trench effect
    const runTrenchYds = trenchYds * (2 - runMul); // runMul<1 (DL wins) → bigger negative
    // REVERSE — big-play upside but bigger variance and a real chance of TFL.
    // The lateral hand-off and direction change make it boom-or-bust.
    const reverseBonus = isReverse ? (Math.random() < 0.45 ? -5 + Math.random() * 3 : 4 + Math.random() * 10) : 0;
    const reverseSdMul = isReverse ? 1.6 : 1.0;
    // Defensive scheme tilt for run defense: 46 blitz stuffs runs, dime
    // gets gashed.
    const defPbRun = this.currentDefPlaybook;
    // OC Run Architect: +0.3 to variant mean; DC Run Stopper: -0.4 to run mean
    const ocRunArchBonus    = _ocTrait === "Run Architect" ? 0.3  : 0;
    const dcRunStopperMalus = _dcTrait === "Run Stopper"  ? -0.4 : 0;
    let yards = clamp(normal((rushMean + rbBoost + fbBoost + runVarMean + adv * 1.4 + runTrenchYds + fbStuffReduction - lbTackle * 0.5 - boxSafetyStuff - thumperStuff - lbGapRead + rbGapVision + carrierBoost + reverseBonus + ocRunArchBonus + dcRunStopperMalus) * defPbRun.runMul, rushSd * rbSdMul * runVarSd * reverseSdMul), -8, 75);
    // Cap at distance to end zone so a 1-yd goal-line carry doesn't get reported as a 17-yd TD
    if (yards > 0) yards = Math.min(yards, 100 - startYard);
    // Broken tackles — carrier physicality vs defender tackle rating.
    // POWER backs break with STR, ELUSIVE with AGI, SPEED with raw SPD.
    // We compare against the AVG TCK of the LB room (primary tacklers on most runs).
    // Capped at ONE broken tackle per carry to keep RBs from being OP.
    let brokenTackles = 0;
    let bonusYards = 0;
    if (!isQBRun && yards > 0) {
      const cp = this._playerByName.get(carrier);
      const cstr = cp?.stats?.[1] ?? 70;
      const cspd = cp?.stats?.[0] ?? 70;
      const cagi = cp?.stats?.[2] ?? 70;
      let breakStat;
      if (rbArch === "POWER")        breakStat = cstr;
      else if (rbArch === "ELUSIVE") breakStat = (cagi * 0.7 + cstr * 0.3);
      else if (rbArch === "SPEED")   breakStat = (cspd * 0.7 + cstr * 0.3);
      else                            breakStat = (cstr + cagi) / 2;
      const lbList = this.defArch.LB || [];
      const lbPlayers = lbList.map(l => this._playerByName.get(l?.name)).filter(Boolean);
      const avgTck = lbPlayers.length
        ? lbPlayers.reduce((s,p) => s + (p.stats[9] || 60), 0) / lbPlayers.length
        : this.defR.lb;
      // Break chance compressed: previously a 99 STR back vs 60 LB room
      // hit a 26.7% break per carry — NFL elite is ~12-15%. Halved the
      // stat-gap scaling AND tightened the upper clamp.
      const baseBreak = rbArch === "POWER" ? 0.04 : 0.02;
      const breakChance = clamp((breakStat - avgTck) / 280 + baseBreak, 0.005, 0.16);
      if (Math.random() < breakChance) {
        brokenTackles = 1;
        bonusYards = rand(3, 8);
        yards = Math.min(yards + bonusYards, 100 - startYard);
      }
    }
    const carrierStats = off.players[carrier];
    if (carrierStats) {
      carrierStats.rush_att++;
      carrierStats.rush_yds += yards;
      if (yards > carrierStats.rush_long) carrierStats.rush_long = yards;
      if (brokenTackles) {
        carrierStats.broken_tackles = (carrierStats.broken_tackles || 0) + brokenTackles;
        // Credit a missed tackle to the defender who whiffed
        this._creditDefStat("missed_tkl", yards >= 10
          ? { S: 0.40, CB: 0.20, LB: 0.30, DL: 0.10 }
          : { LB: 0.45, DL: 0.30, S: 0.15, CB: 0.10 });
      }
    }
    off.team.rush_att++; off.team.rushYds += yards; off.team.totalYds += yards;
    // Award a pancake block to a random OL on quality runs (≥5 yards, not a QB scramble)
    if (yards >= 5 && !isQBRun) {
      const olArr = this.offOL || [];
      if (olArr.length && Math.random() < 0.38) {
        const blocker = olArr[Math.floor(Math.random() * olArr.length)];
        if (blocker?.name && off.players[blocker.name])
          off.players[blocker.name].pancakes = (off.players[blocker.name].pancakes || 0) + 1;
      }
    }
    this._lastBallCarrier = carrier; this._lastBallType = "rush";
    const brokeNote = brokenTackles > 0 ? ` (${brokenTackles} broken tackle${brokenTackles > 1 ? "s" : ""}!)` : "";
    const runVariantTag = runType === "counter" ? "counter" :
                          runType === "stretch" ? "stretch" :
                          runType === "pitch"   ? "pitch"   : "";
    const isRushTD = clamp(startYard + yards, 0, 100) >= 100;
    // Tackle credit on runs — LBs and DLs make most tackles at the LOS;
    // safeties get more credit on big breakaways. No tackler on a TD run.
    const tacklerName = isRushTD ? null
      : (yards > 0
        ? (yards >= 10 ? this._creditDefStat("tkl", { S: 0.40, CB: 0.20, LB: 0.30, DL: 0.10 })
                       : this._creditDefStat("tkl", { LB: 0.45, DL: 0.30, S: 0.15, CB: 0.10 }))
        : this._creditDefStat("tkl", { DL: 0.50, LB: 0.35, S: 0.10, CB: 0.05 }));
    const rushEndTag = isRushTD ? " — TOUCHDOWN!"
                     : tacklerName ? `, tackled by ${tacklerName}` : "";
    const desc = isSpeedOption
      ? (isPitch
          ? `${QB} pitches to ${this.offR.starters.rb} on the speed option for ${yards} yds${brokeNote}${rushEndTag}`
          : `${QB} keeps on the speed option for ${yards} yds${brokeNote}${rushEndTag}`)
      : isQBRun
        ? `${QB} keeps it for ${yards} yds${brokeNote}${rushEndTag}`
        : runVariantTag
          ? `${this.offR.starters.rb} ${runVariantTag} for ${yards} yds${brokeNote}${rushEndTag}`
          : `${this.offR.starters.rb} runs for ${yards} yds${brokeNote}${rushEndTag}`;
    this._pushVisual({ kind: "run", desc, startYard, yards, endYard: clamp(startYard + yards, 0, 100), rusher: carrier, isQBRun, isReverse, runType, isSpeedOption, isPitch, optionRead, tackler: tacklerName, brokenTackles, isTwoBack: useTwoBack, fb: useTwoBack ? this.offR.starters.rb2 : null });
    return { yards };
  }
  _drive() {
    const start = this.poss; let plays = 0;
    // Track drive metadata for the end-of-drive summary card.
    const driveStartYL   = this.yardLine;
    const driveStartTime = this.time;
    const driveStartQ    = this.quarter;
    const driveStartTeam = this[start].name;
    const pushDriveSummary = (result, opts = {}) => {
      const yardsGained = (opts.endYL ?? this.yardLine) - driveStartYL;
      // Time elapsed (handle quarter wrap)
      let elapsedSec = (driveStartTime - this.time);
      if (this.quarter > driveStartQ) elapsedSec += (this.quarter - driveStartQ) * 900;
      const m = Math.floor(Math.max(0, elapsedSec) / 60);
      const s = Math.floor(Math.max(0, elapsedSec) % 60);
      const ts = `${m}:${String(s).padStart(2, "0")}`;
      const fpStart = driveStartYL <= 50 ? `own ${driveStartYL}` : `opp ${100 - driveStartYL}`;
      this.plays.push({
        kind: "drive_summary",
        desc: `═ ${driveStartTeam}: ${plays}-play, ${yardsGained >= 0 ? yardsGained : yardsGained} yds, ${ts} — starting ${fpStart} → ${result.toUpperCase()} ═`,
        quarter: this.quarter, time: this.time,
        homeScore: this.score.home, awayScore: this.score.away,
        driveResult: result,
        drivePlays: plays,
        driveYards: yardsGained,
        driveTime: elapsedSec,
        driveStartYL,
      });
    };
    while (this.time > 0 && plays < 22) {
      plays++;
      const r = this._play();
      // 2-minute warning marker (Q2 + Q4) — push once per half right AFTER
      // the play that crossed 2:00, so it appears in the log before any
      // timeout that the trailing team might call on the same dead ball.
      const halfKey = this.quarter <= 2 ? "half1" : "half2";
      if (this.time <= 120 && !this._twoMinWarned[halfKey]
          && (this.quarter === 2 || this.quarter === 4)) {
        this._twoMinWarned[halfKey] = true;
        this.plays.push({
          kind: "two_min_warning",
          desc: this.quarter === 2 ? "⏱ TWO-MINUTE WARNING (Q2)" : "⏱ TWO-MINUTE WARNING (Q4)",
          quarter: this.quarter, time: this.time,
          homeScore: this.score.home, awayScore: this.score.away,
        });
      }
      // After the play (and after the warning if any), the team that's
      // behind may call timeout to preserve time.
      this._maybeCallTimeout(r);
      // Penalty handled inside _play — yardLine/down/ytg already set;
      // _drive should not run its normal yards/down/first-down logic.
      if (r.isPenalty) continue;
      if (r.endDrive) {
        if (r.isReturnTD) {
          // Punt returned for a TD by the receiving team
          this.poss = this.poss === "home" ? "away" : "home";
          this.yardLine = 100;
          this._score(6, "Punt Return Touchdown!");
          const k = this.offR.starters.k, kStats = this.offStats.players[k];
          if (Math.random() < 0.92) {
            if (kStats) kStats.xp_att++;
            if (Math.random() < 0.94) { this._score(1, "Extra Point"); if (kStats) kStats.xp_made++; }
          }
          pushDriveSummary("PUNT RETURN TD", { endYL: 100 });
          this.drives.push({ team: start, result: "PUNT-RTN-TD", homeScore: this.score.home, awayScore: this.score.away });
          this._kickoffAfterScore(this.poss);
          return;
        }
        if (r.fgGood) {
          // Made FG — kickoff to the receiving team (with onside option).
          this._kickoffAfterScore(this.poss);
          break;
        }
        if (r.punt !== undefined) {
          this.poss = this.poss === "home" ? "away" : "home";
          this.yardLine = clamp(100 - (this.yardLine + r.punt), 1, 99);
        } else {
          // Missed/blocked FG: opponent gets the ball at the SPOT OF THE
          // KICK (LOS + 7). NFL rule also prevents the kicking team's
          // miss from pinning the opponent inside their own 20 — even a
          // short missed FG gives the opponent the ball at the 20 minimum
          // (per the 2014+ rule). Previously this mirrored the LOS, which
          // gave the opponent ~7 free yards of field position vs the rule.
          this.poss = this.poss === "home" ? "away" : "home";
          const kickSpot = this.yardLine + 7;
          const mirror = 100 - kickSpot;
          this.yardLine = Math.max(20, clamp(mirror, 1, 99));
        }
        this.down = 1; this.ytg = 10; break;
      }
      if (r.turnover) {
        // Drive summary BEFORE flipping possession.
        const turnoverEndYL = r.intSpotYL || r.fumbleSpotYL || this.yardLine;
        const turnoverResult = r.isPickSix ? "PICK SIX"
                              : r.isTouchback ? "INT (TOUCHBACK)"
                              : r.intSpotYL  ? "INTERCEPTION"
                              : r.fumbleSpotYL ? "FUMBLE"
                              :                 "TURNOVER";
        pushDriveSummary(turnoverResult, { endYL: turnoverEndYL });
        this.poss = this.poss === "home" ? "away" : "home";
        if (r.isTouchback) {
          // End-zone INT, defender didn't break it out — ball at the 20.
          this.yardLine = 20;
        } else if (r.intSpotYL != null) {
          // Use the actual INT spot (not the LOS) to mirror into the new
          // offense's coordinates, then add the return yards. Without this,
          // the new offense got the LOS mirrored, which gave them ~target
          // depth yards of FREE field position on every downfield INT.
          const mirror = clamp(100 - r.intSpotYL, 1, 99);
          this.yardLine = clamp(mirror + (r.retYds || 0), 1, 99);
        } else if (r.fumbleSpotYL != null) {
          // Same idea as the INT — defense recovers at the strip spot,
          // not at the snap.
          const mirror = clamp(100 - r.fumbleSpotYL, 1, 99);
          this.yardLine = clamp(mirror + (r.retYds || 0), 1, 99);
        } else {
          // Any turnover without a spot — fall back to LOS mirror.
          const mirror = clamp(100 - this.yardLine, 5, 95);
          this.yardLine = clamp(mirror + (r.retYds || 0), 5, 99);
        }
        // Pick-six TD + XP attempt are already handled in _play (_defScoreXP
        // pushes the XP visual). The "this.poss" we just flipped above is the
        // team that intercepted, so they're the SCORING team — they kick off.
        if (r.isPickSix) {
          this._kickoffAfterScore(this.poss);
          break;
        }
        this.down = 1; this.ytg = 10; break;
      }
      const yards = r.yards || 0;
      // SAFETY — ball carrier tackled in his own end zone. Detect BEFORE
      // the clamp (which would hide the negative yardLine and treat it
      // as a 0-yard line play). Sacks losing more yards than the offense
      // had to give, runs into own end zone after a deep-EZ snap, etc.
      // Awards 2 pts to the defense and triggers a free kick from the
      // OFFENSE's 20-yard line (simplified to a standard kickoff visual
      // landing at the receiving team's 25).
      const proposedYL = this.yardLine + yards;
      if (!r.incomplete && yards < 0 && proposedYL <= 0) {
        const defKey = this.poss === "home" ? "away" : "home";
        this.score[defKey] += 2;
        this._pushVisual({
          kind: "safety",
          desc: `SAFETY — 2 points for ${this[defKey].name}`,
          scoringTeam: defKey,
        });
        // Also push a kind:"score" entry so the quarter-by-quarter
        // scoreboard aggregator (play-broadcast.js sums `kind==="score"
        // && p.pts`) picks up the 2 points. Without this the scoreboard
        // would be 2 points short whenever a safety occurred.
        this._pushVisual({
          kind: "score",
          desc: `${this[defKey].city} ${this[defKey].name} — Safety (+2)`,
          scoreType: "Safety",
          poss: defKey,
          pts: 2,
        });
        pushDriveSummary("SAFETY", { endYL: 0 });
        this.drives.push({ team: start, result: "SAFETY", homeScore: this.score.home, awayScore: this.score.away });
        // Free kick from the offense's 20. Possession flips to the
        // scoring team (the defense that just got the safety).
        this.poss = defKey;
        this.yardLine = 25;
        this.down = 1; this.ytg = 10;
        this._pushVisual({
          kind: "kickoff",
          desc: `Free kick after safety — ${this[defKey].name} receives at the 25`,
          startYard: 20, endYard: 25,
        });
        return;
      }
      if (!r.incomplete) this.yardLine = clamp(this.yardLine + yards, 0, 100);
      const wasThird = (this.down === 3);
      if (this.yardLine >= 100) {
        // Credit TD to last ball carrier
        const off = this.stats[this.poss];
        if (this._lastBallCarrier && off.players[this._lastBallCarrier]) {
          if (this._lastBallType === "pass") {
            off.players[this._lastBallCarrier].rec_td++;
            const qb = this.offR.starters.qb;
            if (off.players[qb]) off.players[qb].pass_td++;
          } else if (this._lastBallType === "rush") {
            off.players[this._lastBallCarrier].rush_td++;
          }
        }
        if (wasThird) off.team.thirdConv++;
        off.team.firstDowns++;
        this._score(6, "Touchdown!");
        const k = this.offR.starters.k, kStats = off.players[k];
        // ── 2-POINT CONVERSION AI ──
        // Decision based on the score MARGIN AFTER the TD (the +6 is
        // already applied by _score above). Standard chart values
        // cover: down 5, down 2, down 1, tied, up 1, up 4, up 5, up 12.
        // Late game (Q4 <10:00 or OT) flips MUCH more aggressive.
        const myKey = this.poss;
        const oppKey = myKey === "home" ? "away" : "home";
        const diff = this.score[myKey] - this.score[oppKey];
        const lateGame = (this.quarter === 4 && this.time < 600) || this.quarter >= 5;
        let twoPtChance = 0.04;        // default: just kick
        switch (diff) {
          case -5: twoPtChance = lateGame ? 0.80 : 0.30; break;  // down 5 → need 7
          case -2: twoPtChance = lateGame ? 0.95 : 0.45; break;  // down 2 → tie immediately
          case -1: twoPtChance = lateGame ? 0.35 : 0.08; break;  // down 1 → lead-by-1 vs tie
          case  0: twoPtChance = lateGame ? 0.20 : 0.04; break;  // tied → usually kick
          case  1: twoPtChance = lateGame ? 0.55 : 0.18; break;  // up 1 → up 3 (2-score buffer)
          case  4: twoPtChance = lateGame ? 0.75 : 0.18; break;  // up 4 → up 6 (forces TD to lose)
          case  5: twoPtChance = lateGame ? 0.92 : 0.35; break;  // up 5 → up 7
          case 12: twoPtChance = lateGame ? 0.80 : 0.45; break;  // up 12 → up 14 (2-score with FG)
        }
        // Desperation: down by ≥9 late = go for 2 most of the time
        if (lateGame && diff <= -9) twoPtChance = Math.max(twoPtChance, 0.65);
        // QB AGGRESSION tilts the 2-pt rate. Risk-taking QBs go for 2 more
        // often even in non-chart situations.
        twoPtChance = clamp(twoPtChance * this._aggTilt(this._qbAggression()), 0, 0.97);
        if (Math.random() < twoPtChance) {
          // 2-point try
          if (Math.random() < 0.48) this._score(2, "2-Point Conversion");
          else this._pushVisual({ kind: "xp_miss", desc: `2-pt conversion fails — no good` });
        } else {
          // Kick XP
          if (kStats) kStats.xp_att++;
          if (Math.random() < 0.94) { this._score(1, "Extra Point"); if (kStats) kStats.xp_made++; }
          else this._pushVisual({ kind: "xp_miss", desc: `Extra point — no good` });
        }
        pushDriveSummary("TOUCHDOWN", { endYL: 100 });
        this.drives.push({ team: start, result: "TD", homeScore: this.score.home, awayScore: this.score.away });
        this._kickoffAfterScore(this.poss);
        return;
      }
      const wasFourth = (this.down === 4);
      if (r.incomplete) this.down++;
      else if (yards >= this.ytg) {
        this.stats[this.poss].team.firstDowns++;
        if (wasThird) this.stats[this.poss].team.thirdConv++;
        if (wasFourth) this.stats[this.poss].team.fourthConv++;
        this.down = 1; this.ytg = 10;
      }
      else { this.down++; this.ytg -= yards; }
      // Turnover on downs — failed 4th-down conversion gives ball to defense
      if (wasFourth && this.down > 4) {
        this._pushVisual({ kind: "to_downs", desc: `Turnover on downs!`, startYard: this.yardLine, endYard: this.yardLine });
        pushDriveSummary("TURNOVER ON DOWNS");
        this.drives.push({ team: start, result: "TURNOVER_ON_DOWNS", homeScore: this.score.home, awayScore: this.score.away });
        this.poss = this.poss === "home" ? "away" : "home";
        this.yardLine = clamp(100 - this.yardLine, 1, 99);
        this.down = 1; this.ytg = 10;
        return;
      }
    }
    // Quarter-break continuity: if the while-loop exited because time hit
    // 0 mid-drive AT THE END OF Q1 OR Q3 (not halftime, not end-of-game),
    // the drive CONTINUES into the next quarter at the same down/distance.
    // Skip the drive summary push so the same drive doesn't get logged
    // twice. simulate() will bump the quarter, reset time to 900, and
    // call _drive() again with the preserved state.
    const isInterQuarterBreak = (this.time <= 0)
      && (this.quarter === 1 || this.quarter === 3)
      && plays > 0;
    if (isInterQuarterBreak) return;

    // Determine drive result from the most recent play's kind. By this
    // point all the special early-return cases (TD, turnover, etc.) have
    // already pushed their own summary. This catch-all covers FG good/miss/
    // blocked, punts, and end-of-half timeouts.
    let finalResult = "END OF DRIVE";
    const lastPlay = this.plays[this.plays.length - 1];
    if (lastPlay) {
      if      (lastPlay.kind === "fg_good")    finalResult = "FIELD GOAL";
      else if (lastPlay.kind === "fg_miss")    finalResult = "MISSED FG";
      else if (lastPlay.kind === "fg_blocked") finalResult = "FG BLOCKED";
      else if (lastPlay.kind === "punt")       finalResult = "PUNT";
      else if (this.time <= 0)                  finalResult = "END OF HALF";
    }
    pushDriveSummary(finalResult);
    this.drives.push({ team: start, result: "FG/Punt/TO", homeScore: this.score.home, awayScore: this.score.away });
  }
  simulate() {
    // Opening kickoff — track who receives so we can give the OTHER team
    // the ball at halftime (NFL rule). The team currently in this.poss
    // (set randomly in the constructor) is the receiver; the kicker is
    // the other side. Previously the visual hardcoded "away kicks off"
    // even when home actually had been randomly assigned the kick role.
    this.openingKickReceiver = this.poss;
    const openingKicker = this.poss === "home" ? "away" : "home";
    this._pushVisual({
      kind: "kickoff",
      desc: `${this[openingKicker].city} ${this[openingKicker].name} kicks off to ${this[this.openingKickReceiver].name}`,
      startYard: 35, endYard: 25,
    });
    while (this.quarter <= 4) {
      if (this.time <= 0) {
        if (this.quarter === 2) {
          // Halftime — possession goes to the team that did NOT receive
          // the opening kickoff. Previously this just flipped whoever
          // was last on offense, which could be wrong depending on how
          // Q2 ended.
          this.timeouts = { home: 3, away: 3 };
          this.plays.push({ kind: "halftime", desc: "═══ HALFTIME ═══", quarter: 2, time: 0, homeScore: this.score.home, awayScore: this.score.away });
          const halfKicker = this.openingKickReceiver;
          const halfReceiver = this.openingKickReceiver === "home" ? "away" : "home";
          this.poss = halfReceiver;
          this.yardLine = 25; this.down = 1; this.ytg = 10;
          this._pushVisual({
            kind: "kickoff",
            desc: `${this[halfKicker].city} ${this[halfKicker].name} kicks off to start the second half`,
            startYard: 35, endYard: 25,
          });
        }
        // Q1↔Q2 and Q3↔Q4: drive state (poss, yardLine, down, ytg) is
        // preserved on `this` — the next _drive() call continues the
        // in-progress drive at the same down/distance. _drive's tail
        // detects "time ran out mid-drive between quarters" and skips
        // the END-OF-HALF summary so the drive remains one logical unit.
        this.quarter++;
        if (this.quarter <= 4) {
          this.plays.push({ kind: "quarter", desc: `─── Start of Q${this.quarter} ───`, quarter: this.quarter, time: 900, homeScore: this.score.home, awayScore: this.score.away });
        }
        this.time = 900;
        continue;
      }
      this._drive();
    }
    if (this.score.home === this.score.away) {
      // Modern NFL regular-season overtime (2025 rule): both teams ALWAYS
      // get at least one possession, regardless of what happens on the
      // first drive (TD/FG/safety/punt). After both possessions, sudden
      // death applies. If still tied when the 10-minute clock expires,
      // the game ends in a tie (no more coin-flip-FG fallback).
      this.plays.push({ kind: "ot", desc: "═══ OVERTIME ═══", quarter: 5, time: 600, homeScore: this.score.home, awayScore: this.score.away });
      this.quarter = 5; this.time = 600;
      this.poss = Math.random() < 0.5 ? "home" : "away";
      this.yardLine = 25; this.down = 1; this.ytg = 10;
      const otReceiver = this.poss;
      const otKicker = this.poss === "home" ? "away" : "home";
      this._pushVisual({
        kind: "kickoff",
        desc: `${this[otKicker].city} ${this[otKicker].name} kicks off to open overtime`,
        startYard: 35, endYard: 25,
      });
      // First possession
      if (this.time > 0) this._drive();
      // Per modern NFL rule, a SAFETY on the first OT drive ends the
      // game immediately — the defense scored, no second possession.
      // (TDs and FGs DON'T end OT under the 2025 rule; both teams
      // always get a possession unless this safety case fires.)
      const lastDrive = this.drives[this.drives.length - 1];
      const otSafetyEnded = lastDrive && lastDrive.result === "SAFETY";
      // Second possession — guaranteed unless OT-safety just ended things.
      // If a score happened on drive 1, _drive's TD/FG branch already
      // triggered _kickoffAfterScore so this.poss is already flipped.
      // If drive 1 ended in a punt/turnover-on-downs/turnover,
      // this.poss already flipped.
      if (!otSafetyEnded && this.time > 0) this._drive();
      // Sudden death — any score by either team wins. Safety cap at 8
      // drives to prevent pathological infinite loops if drives somehow
      // burn no clock.
      let sd = 0;
      while (this.score.home === this.score.away && this.time > 0 && sd < 8) {
        this._drive();
        sd++;
      }
      // If tied at end of OT, regular-season game ends in a tie. No
      // random FG fallback (previously line 2330-2332 would coin-flip
      // award 3 points to one team, which is not a rule).
    }
    // Build a player lookup map for hover tooltips
    const lookup = new Map();
    for (const p of this.hRoster) lookup.set(p.name, { ...p, team: "home" });
    for (const p of this.aRoster) lookup.set(p.name, { ...p, team: "away" });
    return {
      homeTeam: this.home, awayTeam: this.away,
      homeScore: this.score.home, awayScore: this.score.away,
      homeRatings: this.homeR, awayRatings: this.awayR,
      homeRoster: this.hRoster, awayRoster: this.aRoster,
      playerLookup: lookup,
      plays: this.plays, drives: this.drives,
      stats: this.stats,
      weather: this.weather,
      winner: this.score.home > this.score.away ? "home" : this.score.away > this.score.home ? "away" : "tie",
    };
  }
}

