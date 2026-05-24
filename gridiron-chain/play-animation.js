// Cinematic big-hit / ejection overlay. AAA-style — letterbox bars,
const _bigHitCinema = (() => {
  let activeId = null;
  function _mechLabel(m) {
    return m === "head_on" ? "HEAD-ON COLLISION"
         : m === "high"    ? "HIGH HIT"
         : m === "low"     ? "LOW HIT"
         : m === "side"    ? "SIDE HIT"
         : m === "behind"  ? "BLINDSIDE"
         : (m || "CONTACT").toUpperCase();
  }
  function _toneFor(force, isEject) {
    if (isEject) return { accent: "#ff3a3a", glow: "rgba(255,40,40,.55)", label: "EJECTION" };
    if (force >= 1.85) return { accent: "#ff2a2a", glow: "rgba(255,40,40,.50)", label: "💥 MASSIVE HIT" };
    if (force >= 1.65) return { accent: "#ff5a2a", glow: "rgba(255,100,40,.45)", label: "💥 HEAVY HIT" };
    return { accent: "#ffa83a", glow: "rgba(255,180,60,.35)", label: "💥 BIG HIT" };
  }
  function _bodyRegion(mech, eventType) {
    if (eventType === "sack") return "back";
    if (mech === "high" || mech === "head_on") return "head";
    if (mech === "low") return "knee";
    if (mech === "side") return "shoulder";
    if (mech === "behind") return "back";
    return "torso";
  }
  function _bodySVG(region, accent) {
    const REGIONS = {
      head:     { cx: 60, cy: 22,  r: 14 },
      torso:    { cx: 60, cy: 60,  r: 18 },
      shoulder: { cx: 78, cy: 44,  r: 8  },
      knee:     { cx: 54, cy: 108, r: 7  },
      back:     { cx: 60, cy: 60,  r: 18 },
    };
    const r = REGIONS[region] || REGIONS.torso;
    return `<svg viewBox="0 0 120 140" width="100" height="120" style="display:block">
      <ellipse cx="60" cy="22" rx="14" ry="16" fill="#222" stroke="#555" stroke-width="1.5"/>
      <path d="M44,40 L76,40 L82,72 L74,108 L78,135 L70,135 L62,108 L58,108 L50,135 L42,135 L46,108 L38,72 Z"
            fill="#222" stroke="#555" stroke-width="1.5"/>
      <path d="M44,40 L26,80" stroke="#555" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M76,40 L94,80" stroke="#555" stroke-width="6" fill="none" stroke-linecap="round"/>
      <circle cx="${r.cx}" cy="${r.cy}" r="${r.r + 4}" fill="${accent}" opacity="0.25"/>
      <circle cx="${r.cx}" cy="${r.cy}" r="${r.r}" fill="${accent}" opacity="0.45">
        <animate attributeName="opacity" values="0.3;0.85;0.3" dur="0.9s" repeatCount="indefinite"/>
      </circle>
      <circle cx="${r.cx}" cy="${r.cy}" r="${Math.max(2, r.r - 4)}" fill="none" stroke="${accent}" stroke-width="2"/>
    </svg>`;
  }
  function _attackerArch(play) {
    if (typeof franchise === "undefined" || !play.tackler) return "";
    for (const tid in (franchise.rosters || {})) {
      const p = franchise.rosters[tid].find(x => x.name === play.tackler);
      if (p) return p.archetype || "";
    }
    return "";
  }
  return {
    show(play, isEject) {
      const playId = `${play.kind}-${play.tackler || ""}-${play.carrier || play.victim || ""}-${play.force || 0}`;
      const fieldWrap = document.querySelector(".bspnlive-field-wrap")
                     || document.querySelector(".field-wrap")
                     || document.getElementById("field")?.parentElement;
      if (!fieldWrap) return;
      if (activeId !== playId) {
        this.clear();
        activeId = playId;
        const tone = _toneFor(play.force, isEject);
        const mech = _mechLabel(play.mechanism);
        const force = Number(play.force);
        const arch = _attackerArch(play);
        const region = _bodyRegion(play.mechanism, play.eventType);
        const attacker = play.tackler || play.offender || "Defender";
        const victim = play.carrier || play.victim || "Player";
        const el = document.createElement("div");
        el.className = "bighit-cinema";
        el.id = "bighit-cinema-overlay";
        el.style.setProperty("--accent", tone.accent);
        el.style.setProperty("--glow", tone.glow);
        el.innerHTML = `
          <div class="bighit-letter top"></div>
          <div class="bighit-letter bottom"></div>
          <div class="bighit-content">
            <div class="bighit-body-col">
              ${_bodySVG(region, tone.accent)}
              <div class="bighit-region-lbl">${region.toUpperCase()}</div>
            </div>
            <div class="bighit-text-col">
              <div class="bighit-eyebrow">${tone.label}</div>
              ${isEject ? "" : `<div class="bighit-force">${(force || 0).toFixed(2)}</div><div class="bighit-force-lbl">FORCE</div>`}
              <div class="bighit-mech">${mech}</div>
              <div class="bighit-players">
                <span class="bighit-attacker">${attacker}${arch ? ` <span class="bighit-arch">${arch.replace(/_/g," ")}</span>` : ""}</span>
                <span class="bighit-arrow">→</span>
                <span class="bighit-victim">${victim}</span>
              </div>
              ${isEject ? `<div class="bighit-ejection">🚫 DISQUALIFIED — REST OF GAME</div>` : ""}
            </div>
          </div>`;
        const cs = getComputedStyle(fieldWrap);
        if (cs.position === "static") fieldWrap.style.position = "relative";
        fieldWrap.appendChild(el);
      }
    },
    clear() {
      const el = document.getElementById("bighit-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// Substitution ticker — a stack of chips in the upper-right of the
// field-wrap. Each chip slides in, sits 4s, slides out. Adds idempotency
// so re-renders during the same animation don't duplicate.
const _subTicker = (() => {
  const seen = new Set();
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  function _container() {
    const wrap = _wrap();
    if (!wrap) return null;
    let c = wrap.querySelector(".sub-ticker");
    if (!c) {
      c = document.createElement("div");
      c.className = "sub-ticker";
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      wrap.appendChild(c);
    }
    return c;
  }
  return {
    add(play) {
      const key = `${play.side || ""}:${play.out || ""}:${play.in || ""}:${play.reason || ""}:${play.time || play.quarter || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 200) {
        // Trim — keep it small
        const arr = [...seen]; for (let i = 0; i < 100; i++) seen.delete(arr[i]);
      }
      const c = _container();
      if (!c) return;
      const teamColor = play.side === "home"
        ? (gameResult?.homeTeam?.primary || "#888")
        : (gameResult?.awayTeam?.primary || "#888");
      const reasonStyle = {
        injury:   { color: "#ff5050", icon: "🩹", label: "INJURY"   },
        fatigue:  { color: "#e8a000", icon: "💨", label: "FATIGUE"  },
        snap_plan:{ color: "#7ec8e3", icon: "📋", label: "SNAP PLAN"},
      }[play.reason] || { color: "#aaa", icon: "↺", label: "SUB" };
      const chip = document.createElement("div");
      chip.className = "sub-ticker-chip";
      chip.style.setProperty("--accent", reasonStyle.color);
      chip.style.setProperty("--team", teamColor);
      const sevTag = play.catastrophic ? `<span class="sub-chip-cata">SEASON-END</span>` : "";
      chip.innerHTML = `
        <div class="sub-chip-eyebrow"><span style="background:var(--team)"></span>${reasonStyle.icon} ${reasonStyle.label}${sevTag}</div>
        <div class="sub-chip-body">
          <div class="sub-chip-out">
            <span class="sub-chip-role">${(play.position || "").toUpperCase()}</span>
            <span class="sub-chip-name out">${play.out || "—"}</span>
            ${play.injuryLabel ? `<span class="sub-chip-injury">${play.injuryLabel}</span>` : ""}
          </div>
          <div class="sub-chip-arrow">↓</div>
          <div class="sub-chip-in">
            <span class="sub-chip-role-in">IN</span>
            <span class="sub-chip-name in">${play.in || "—"}</span>
          </div>
        </div>`;
      c.appendChild(chip);
      // Trim oldest if too many stacked
      while (c.children.length > 3) c.removeChild(c.firstChild);
      // Auto-remove after 4s (CSS handles the slide-out animation)
      setTimeout(() => {
        chip.classList.add("leaving");
        setTimeout(() => chip.remove(), 420);
      }, 4000);
    },
    clearAll() {
      const c = _wrap()?.querySelector(".sub-ticker");
      if (c) c.innerHTML = "";
      seen.clear();
    },
  };
})();

// Touchdown cinematic — full-field team-color flood + giant TOUCHDOWN
// text + scorer chip. Fires when the play hold begins on a TD.
// Auto-clears at next play start. The existing canvas-drawn TOUCHDOWN
// text remains as a sub-element; this overlay layers above it.
const _touchdownCinema = (() => {
  let activeId = null;
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  return {
    show(play) {
      const id = `${play.kind}-${play.endYard}-${play.receiver || play.rusher}-${play.startYard}`;
      if (activeId === id) return;
      this.clear();
      activeId = id;
      const wrap = _wrap();
      if (!wrap) return;
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      // Determine scoring team — poss is on the play, gameResult has teams.
      const poss = play.poss;
      const team = (poss === "home" ? gameResult?.homeTeam : gameResult?.awayTeam)
                || (poss === "away" ? gameResult?.awayTeam : gameResult?.homeTeam);
      const teamColor = team?.primary || "#f5c542";
      const teamSec   = team?.secondary || "#fff";
      const scorer = play.receiver || play.rusher || play.passer || "—";
      const passer = play.kind === "complete" ? play.passer : null;
      const yds = play.yards ?? 0;
      const playLabel = play.kind === "complete"
        ? `${yds}-YD CATCH${passer ? ` · ${passer} → ${scorer}` : ""}`
        : play.isScramble
        ? `${yds}-YD SCRAMBLE · ${scorer}`
        : `${yds}-YD RUSH · ${scorer}`;
      const el = document.createElement("div");
      el.className = "td-cinema";
      el.id = "td-cinema-overlay";
      el.style.setProperty("--team", teamColor);
      el.style.setProperty("--team-sec", teamSec);
      el.innerHTML = `
        <div class="td-flood"></div>
        <div class="td-bars">
          <div class="td-bar top"></div>
          <div class="td-bar bot"></div>
        </div>
        <div class="td-content">
          <div class="td-eyebrow">${team?.city || ""} ${team?.name || ""}</div>
          <div class="td-headline">TOUCHDOWN</div>
          <div class="td-scorer">${scorer}</div>
          <div class="td-detail">${playLabel}</div>
          <div class="td-sparks">
            ${Array.from({length: 12}).map((_,i) =>
              `<span class="td-spark" style="--n:${i}"></span>`).join("")}
          </div>
        </div>`;
      wrap.appendChild(el);
    },
    clear() {
      const el = document.getElementById("td-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// HC decision overlay — fires on engine-emitted hc_decision plays
// (4th-down go-for-it, 2-pt try). Coach name + trait badge + decision
// + rationale, slide-in from bottom of the field. ~1.6s beat.
const _hcDecisionCinema = (() => {
  let activeId = null;
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  function _traitColor(trait) {
    return trait === "Riverboat Gambler" ? "#ff8c4d"
         : trait === "Conservative"      ? "#7ec8e3"
         : trait === "Game Manager"      ? "#9bd0ff"
         : trait === "Motivator"         ? "#e8a000"
         : "#f5c542";
  }
  function _traitIcon(trait) {
    return trait === "Riverboat Gambler" ? "🎲"
         : trait === "Conservative"      ? "🛡"
         : trait === "Game Manager"      ? "📋"
         : trait === "Motivator"         ? "🔥"
         : "🎩";
  }
  return {
    show(play) {
      const id = `${play.coachName}-${play.decision}-${play.ytg}-${play.fieldPos}`;
      if (activeId === id) return;
      this.clear();
      activeId = id;
      const wrap = _wrap();
      if (!wrap) return;
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      const accent = _traitColor(play.trait);
      const icon = _traitIcon(play.trait);
      const headline = play.decision === "go_4th" ? "GOING FOR IT" : (play.decision || "DECISION").toUpperCase();
      const el = document.createElement("div");
      el.className = "hc-cinema";
      el.id = "hc-cinema-overlay";
      el.style.setProperty("--accent", accent);
      el.innerHTML = `
        <div class="hc-card">
          <div class="hc-icon">${icon}</div>
          <div class="hc-body">
            <div class="hc-eyebrow">HEAD COACH${play.trait ? ` · ${play.trait.toUpperCase()}` : ""}</div>
            <div class="hc-name">${play.coachName || "—"}</div>
            <div class="hc-decision">${headline}</div>
            <div class="hc-detail">
              <span class="hc-meta">4TH &amp; ${play.ytg ?? "?"}</span>
              ${play.inFGRange ? `<span class="hc-meta hc-fg">FG range — passing on the kick</span>` : ""}
            </div>
            ${play.rationale ? `<div class="hc-rationale">"${play.rationale}"</div>` : ""}
          </div>
        </div>`;
      wrap.appendChild(el);
    },
    clear() {
      const el = document.getElementById("hc-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// Segment cinema — full-screen card for end-of-quarter / halftime /
// overtime / two-minute warning. Replaces the old plain-text canvas
// overlay. Score-by-quarter table on halftime + EOQ. ~2s beat,
// auto-fades. (Timeouts kept on the simple canvas treatment — less
// disruptive, more frequent.)
const _segmentCinema = (() => {
  let activeId = null;
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  function _meta(play) {
    if (play.kind === "halftime")        return { headline: "HALFTIME", sub: "End of 2nd Quarter", accent: "#f5c542" };
    if (play.kind === "ot")              return { headline: "OVERTIME", sub: "Tied — sudden death", accent: "#ff5a4a" };
    if (play.kind === "two_min_warning") return { headline: "2-MINUTE WARNING", sub: "", accent: "#e8a000" };
    if (play.kind === "quarter") {
      // play.desc has the "End of Q1" type info. Try to parse.
      const m = /Q(\d)/i.exec(play.desc || "");
      const q = m ? Number(m[1]) : null;
      return {
        headline: q ? `END OF Q${q}` : "QUARTER",
        sub: q === 1 ? "1st quarter complete"
            : q === 2 ? "Half time approaching"
            : q === 3 ? "Final quarter begins"
            : "Quarter complete",
        accent: "#9bd0ff",
      };
    }
    return null;
  }
  function _quarterScoresHTML(play) {
    // Walk back through plays to compute Q1..Q4 running scores.
    if (!gameResult?.plays) return "";
    const qScores = { 1:{h:0,a:0}, 2:{h:0,a:0}, 3:{h:0,a:0}, 4:{h:0,a:0} };
    const playIdx = gameResult.plays.indexOf(play);
    const upto = playIdx >= 0 ? playIdx + 1 : gameResult.plays.length;
    for (let i = 0; i < upto; i++) {
      const p = gameResult.plays[i];
      if (p?.kind === "score" && p.pts && p.poss) {
        const q = Math.min(4, Math.max(1, p.quarter || 1));
        const side = p.poss === "home" ? "h" : "a";
        qScores[q][side] += p.pts;
      }
    }
    const homeT = gameResult?.homeTeam, awayT = gameResult?.awayTeam;
    const homeTotal = qScores[1].h + qScores[2].h + qScores[3].h + qScores[4].h;
    const awayTotal = qScores[1].a + qScores[2].a + qScores[3].a + qScores[4].a;
    return `<table class="seg-qtable">
      <thead><tr>
        <th></th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th class="seg-qtotal">T</th>
      </tr></thead>
      <tbody>
        <tr style="--team:${awayT?.primary || "#fff"}">
          <td class="seg-qabbr">${awayT?.abbr || "A"}</td>
          <td>${qScores[1].a}</td><td>${qScores[2].a}</td><td>${qScores[3].a}</td><td>${qScores[4].a}</td>
          <td class="seg-qtotal">${awayTotal}</td>
        </tr>
        <tr style="--team:${homeT?.primary || "#fff"}">
          <td class="seg-qabbr">${homeT?.abbr || "H"}</td>
          <td>${qScores[1].h}</td><td>${qScores[2].h}</td><td>${qScores[3].h}</td><td>${qScores[4].h}</td>
          <td class="seg-qtotal">${homeTotal}</td>
        </tr>
      </tbody>
    </table>`;
  }
  return {
    show(play) {
      const meta = _meta(play);
      if (!meta) return;
      const id = `${play.kind}-${play.quarter || 0}-${play.time || 0}`;
      if (activeId === id) return;
      this.clear();
      activeId = id;
      const wrap = _wrap();
      if (!wrap) return;
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      const showTable = play.kind === "halftime" || play.kind === "quarter";
      const el = document.createElement("div");
      el.className = "seg-cinema";
      el.id = "seg-cinema-overlay";
      el.style.setProperty("--accent", meta.accent);
      el.innerHTML = `
        <div class="seg-flood"></div>
        <div class="seg-content">
          <div class="seg-eyebrow">${play.kind === "halftime" ? "GRIDIRON CHAIN" : ""}</div>
          <div class="seg-headline">${meta.headline}</div>
          ${meta.sub ? `<div class="seg-sub">${meta.sub}</div>` : ""}
          ${showTable ? `<div class="seg-table-wrap">${_quarterScoresHTML(play)}</div>` : ""}
        </div>`;
      wrap.appendChild(el);
    },
    clear() {
      const el = document.getElementById("seg-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// Big-play moment cinemas — INT (incl. PICK SIX), FUMBLE RECOVERY,
// SACK (force ≥ 1.5). Card slides up from field bottom on the play
// hold, ~1.4s beat, auto-clear on next play.
const _momentCinema = (() => {
  let activeId = null;
  function _wrap() {
    return document.querySelector(".bspnlive-field-wrap")
        || document.querySelector(".field-wrap")
        || document.getElementById("field")?.parentElement;
  }
  function _kindMeta(play) {
    if (play.kind === "int") {
      if (play.isPickSix) return {
        headline: "PICK SIX",  icon: "🚀", accent: "#ffd54d",
        sub: `${play.defender || "Defender"} returns ${play.intReturnYds || 0} yds for SIX`,
      };
      if (play.isTouchback) return {
        headline: "INTERCEPTION", icon: "🦅", accent: "#9bd0ff",
        sub: `${play.defender || "Defender"} picks it off — touchback`,
      };
      return {
        headline: "INTERCEPTION", icon: "🦅", accent: "#9bd0ff",
        sub: `${play.defender || "Defender"} picks off ${play.passer || "QB"}${play.intReturnYds ? ` · ${play.intReturnYds}-yd return` : ""}`,
      };
    }
    if (play.kind === "fumble") {
      const isDefRecov = play.recoveredBy === "def";
      const isReturnTD = play.isReturnTD;
      if (isReturnTD) return {
        headline: "FUMBLE-SIX", icon: "💥", accent: "#ffd54d",
        sub: `${play.defender || "Defender"} scoops it up — TOUCHDOWN`,
      };
      if (isDefRecov) return {
        headline: "TURNOVER", icon: "🔄", accent: "#ff8a4a",
        sub: `Fumble recovered by ${play.defender || "the defense"}${play.forcedBy ? ` · forced by ${play.forcedBy}` : ""}`,
      };
      return {
        headline: "FUMBLE RECOVERY", icon: "🤲", accent: "#9be09b",
        sub: `Offense recovers their own${play.forcedBy ? ` · forced by ${play.forcedBy}` : ""}`,
      };
    }
    return null;
  }
  return {
    show(play) {
      const meta = _kindMeta(play);
      if (!meta) return;
      const id = `${play.kind}-${play.startYard}-${play.defender || play.recoveredBy}-${play.intReturnYds || 0}`;
      if (activeId === id) return;
      this.clear();
      activeId = id;
      const wrap = _wrap();
      if (!wrap) return;
      const cs = getComputedStyle(wrap);
      if (cs.position === "static") wrap.style.position = "relative";
      const el = document.createElement("div");
      el.className = "moment-cinema";
      el.id = "moment-cinema-overlay";
      el.style.setProperty("--accent", meta.accent);
      el.innerHTML = `
        <div class="moment-card">
          <div class="moment-icon">${meta.icon}</div>
          <div class="moment-body">
            <div class="moment-eyebrow">BIG PLAY</div>
            <div class="moment-headline">${meta.headline}</div>
            <div class="moment-sub">${meta.sub}</div>
          </div>
        </div>`;
      wrap.appendChild(el);
    },
    clear() {
      const el = document.getElementById("moment-cinema-overlay");
      if (el) el.remove();
      activeId = null;
    },
  };
})();

// ─── Per-play animation engine ─────────────────────────────────────────────
function buildAnimForPlay(play, prevPlay) {
  // Returns { duration, render(t01) }
  // t01 = 0..1 progress
  const homeTeam = gameResult.homeTeam, awayTeam = gameResult.awayTeam;

  // ── SUBSTITUTION TICKER ─────────────────────────────────────────
  // Injured-starter swaps fire as their own visual plays. Short duration
  // (800ms), no field action — the ticker chip slides in and stacks
  // alongside any prior subs. Auto-fades after 4s.
  if (play.kind === "substitution") {
    return { duration: 700, kind: "substitution", render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      _subTicker.add(play);
    }};
  }

  // ── HC DECISION CALLOUT ────────────────────────────────────────
  // Engine emits kind:"hc_decision" when the coach defies the analytics
  // chart (Riverboat Gambler 4th-down go, Conservative HC desperation
  // go, etc.). Renders a coach card with trait + rationale.
  if (play.kind === "hc_decision") {
    return { duration: 1600, kind: "hc_decision", render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      _hcDecisionCinema.show(play);
    }};
  }

  // ── CINEMATIC BIG-HIT TREATMENT ─────────────────────────────────
  // big_hit (and ejection) plays get a 2-second AAA-style overlay
  // injected over the field. Force value, mechanism, attacker/victim,
  // archetype chip, body-part hit indicator. Field stays as backdrop.
  if (play.kind === "big_hit" || play.kind === "ejection") {
    const isEject = play.kind === "ejection";
    const force = Number(play.force) || 1.4;
    const dur = isEject ? 2400 : 2000;
    return { duration: dur, kind: play.kind, render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      // Maintain a single DOM overlay; create on first frame, refresh
      // content if missing, remove when play exits.
      _bigHitCinema.show(play, isEject);
    }};
  }

  if (["halftime", "ot", "quarter", "two_min_warning", "timeout"].includes(play.kind)) {
    const isTimeout = play.kind === "timeout";
    // Timeouts stay on the simple canvas treatment (frequent, less major).
    // Quarter ends / halftime / OT / 2-min warning get the cinematic.
    if (isTimeout) {
      const dur = 1400;
      return { duration: dur, kind: play.kind, render: (t, ctx) => {
        drawField(ctx, homeTeam, awayTeam, null);
        ctx.fillStyle = "rgba(20,30,50,0.65)";
        ctx.fillRect(0, 0, FIELD.W, FIELD.H);
        ctx.fillStyle = "#9bd0ff";
        ctx.font = "bold 36px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(play.desc, FIELD.W / 2, FIELD.H / 2);
        if (play.timeoutsRemaining) {
          ctx.font = "bold 14px sans-serif";
          ctx.fillStyle = "#cccccc";
          const h = play.timeoutsRemaining.home, a = play.timeoutsRemaining.away;
          ctx.fillText(`${homeTeam.name} ${h} TO  ·  ${awayTeam.name} ${a} TO`, FIELD.W / 2, FIELD.H / 2 + 40);
        }
      }};
    }
    const dur = play.kind === "halftime" ? 2400 : play.kind === "ot" ? 2200 : 1800;
    return { duration: dur, kind: play.kind, render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      _segmentCinema.show(play);
    }};
  }

  if (play.kind === "kickoff") {
    // Receiving team derived from the next play's poss
    const kickoffIdx = gameResult.plays.indexOf(play);
    let recvPoss = "home";
    for (let i = kickoffIdx + 1; i < gameResult.plays.length; i++) {
      if (gameResult.plays[i].poss != null) { recvPoss = gameResult.plays[i].poss; break; }
    }
    const recvTeam = recvPoss === "home" ? homeTeam : awayTeam;
    const kickTeam = recvPoss === "home" ? awayTeam : homeTeam;
    const kickPoss = recvPoss === "home" ? "away" : "home";
    const recvDir  = recvPoss === "home" ? 1 : -1;   // direction returner runs
    // Key x coordinates
    const kickerLineX = yardToAbsX(35, kickPoss);   // kicking team at their own 35
    const catchX     = yardToAbsX(15, recvPoss);    // returner catches at his 15
    const finalX     = yardToAbsX(25, recvPoss);    // tackle at his 25
    const cy = (FIELD.TOP + FIELD.BOT) / 2;
    // Lane positions for 10 kicking-team coverage players (skipping kicker).
    // Spread vertically across the field.
    const NUM_COVER = 10;
    const coverLanes = [];
    for (let i = 0; i < NUM_COVER; i++) {
      coverLanes.push(cy + ((i - (NUM_COVER - 1) / 2) * (FIELD.BOT - FIELD.TOP - 80) / NUM_COVER));
    }
    // Lane positions for 10 receiving-team blockers (returner is the 11th, deeper).
    const NUM_BLOCKERS = 10;
    const blockerLanes = [];
    for (let i = 0; i < NUM_BLOCKERS; i++) {
      blockerLanes.push(cy + ((i - (NUM_BLOCKERS - 1) / 2) * (FIELD.BOT - FIELD.TOP - 100) / NUM_BLOCKERS));
    }
    // Blockers start ~20 yds in front of the returner, spread across.
    const blockerStartX = yardToAbsX(40, recvPoss);   // receiving team's 40
    // Per-kickoff deterministic hash — drives all the "this kickoff is
    // different from the last one" variation (which coverage player makes
    // the tackle, blocker assignments, tackle style, final-point jitter).
    const ksHash = ((kickoffIdx + 1) * 2654435761) >>> 0;
    const tackleStyle = ksHash % 5;
    // Jitter the final tackle point so the returner doesn't always go
    // down at the exact same spot (±20 px ≈ ±1.3 yds).
    // Note: use >>> (unsigned shift) — `>>` would interpret ksHash as
    // signed when the high bit is set, producing negative array indices.
    const tackleJitter = (((ksHash >>> 4) % 11) - 5) * 4;
    const localFinalX = finalX + tackleJitter;
    // The primary tackler — coverage player who arrives at the returner
    // first and makes the hit. Other coverage players support / pile in
    // based on the tackle style.
    const primaryTacklerIdx = (ksHash >>> 8) % NUM_COVER;
    // Secondary tackler (used for two-man / pile-up styles).
    const secondaryTacklerIdx = (primaryTacklerIdx + 1 + ((ksHash >>> 11) % (NUM_COVER - 1))) % NUM_COVER;
    // Blocker assignments — each receiving-team blocker targets a specific
    // coverage opponent. About 1 in 4 blockers whiff their block entirely.
    const blockerAssignments = [];
    for (let i = 0; i < NUM_BLOCKERS; i++) {
      const targetCov = (i + ((ksHash >>> 14) % NUM_COVER)) % NUM_COVER;
      const fails = ((ksHash >>> (16 + i)) & 3) === 0;
      blockerAssignments.push({ targetCov, fails });
    }
    return { duration: 3200, kind: "kickoff", render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
      const FLIGHT_END = 0.40;
      const RETURN_END = 0.82;
      // ── Ball + returner positions ──
      let ballX, ballY, returnerX = catchX, returnerY = cy;
      let returnerPose = "stance";
      let returnerT = (t * 3) % 1;
      let returnerFacing = recvDir;
      if (t < FLIGHT_END) {
        const ft = t / FLIGHT_END;
        ballX = kickerLineX + (catchX - kickerLineX) * ft;
        ballY = cy - Math.sin(ft * Math.PI) * 130;
        returnerX = catchX;
        returnerY = cy;
        returnerPose = ft > 0.85 ? "reach" : "stance";
      } else if (t < RETURN_END) {
        const rt = (t - FLIGHT_END) / (RETURN_END - FLIGHT_END);
        const sm = rt * rt * (3 - 2 * rt);
        returnerX = catchX + (localFinalX - catchX) * sm;
        returnerY = cy + Math.sin(rt * Math.PI * 1.5) * 5;
        ballX = returnerX;
        ballY = returnerY;
        returnerPose = "carry";
      } else {
        returnerX = localFinalX;
        returnerY = cy;
        ballX = returnerX;
        ballY = returnerY;
        returnerPose = "tackled";
        returnerT = Math.min(1, (t - RETURN_END) / (1 - RETURN_END));
        // Spin-tackle variant: returner is hit hard and pivots before
        // hitting the ground — flip facing so the fall rotates the other way.
        if (tackleStyle === 2) returnerFacing = -recvDir;
      }

      // ── Compute kicking-team coverage positions (no draw yet) ──
      // Stored so blockers can target a specific coverage opponent.
      const coverPos = [];
      for (let i = 0; i < NUM_COVER; i++) {
        let cx, cy_;
        if (t < FLIGHT_END) {
          const ft = t / FLIGHT_END;
          cx = kickerLineX + (catchX - kickerLineX) * ft * 0.55;
          cy_ = coverLanes[i];
        } else if (t < RETURN_END) {
          const rt = (t - FLIGHT_END) / (RETURN_END - FLIGHT_END);
          const sprintFromX = kickerLineX + (catchX - kickerLineX) * 0.55;
          // Primary tackler runs straight at the returner; secondary
          // arrives from a side angle; the rest spread out to contain.
          const isPrimary   = i === primaryTacklerIdx;
          const isSecondary = i === secondaryTacklerIdx;
          let targetX, targetY;
          if (isPrimary) {
            targetX = returnerX + recvDir * 2;       // meet head-on
            targetY = returnerY;
          } else if (isSecondary && tackleStyle >= 1) {
            targetX = returnerX - recvDir * 6;       // wrap from behind/side
            targetY = returnerY + (i % 2 === 0 ? 8 : -8);
          } else {
            targetX = returnerX - recvDir * (12 + (i % 4) * 8);
            targetY = coverLanes[i] + (returnerY - coverLanes[i]) * 0.6;
          }
          cx = sprintFromX + (targetX - sprintFromX) * Math.min(1, rt * 1.3);
          cy_ = coverLanes[i] + (targetY - coverLanes[i]) * Math.min(1, rt * 1.2);
        } else {
          // Tackle phase — primary stays on the returner; secondary
          // arrives at the pile; pile-up style brings 3-4 defenders in.
          const tk = (t - RETURN_END) / (1 - RETURN_END);
          const isPrimary   = i === primaryTacklerIdx;
          const isSecondary = i === secondaryTacklerIdx;
          const inPile      = tackleStyle === 3 && (i % 2 === 0 || isPrimary || isSecondary);
          let px, py;
          if (isPrimary) {
            px = returnerX; py = returnerY;
          } else if (isSecondary && tackleStyle >= 1) {
            px = returnerX - recvDir * 4; py = returnerY + ((i & 1) ? 6 : -6);
          } else if (inPile) {
            px = returnerX - recvDir * (4 + (i % 3) * 3);
            py = returnerY + ((i % 3) - 1) * 5;
          } else {
            px = returnerX - recvDir * (10 + (i % 4) * 6);
            py = returnerY + ((i % 3) - 1) * 7;
          }
          cx = returnerX + (px - returnerX) * (1 - Math.min(1, tk * 2) * 0.7);
          cy_ = returnerY + (py - returnerY) * (1 - Math.min(1, tk * 2) * 0.5);
        }
        coverPos.push({ x: cx, y: cy_ });
      }

      // ── Compute blocker positions (track assigned coverage opponent) ──
      const blockerPos = [];
      for (let i = 0; i < NUM_BLOCKERS; i++) {
        const baseY = blockerLanes[i];
        const { targetCov, fails } = blockerAssignments[i];
        const targetPos = coverPos[targetCov];
        let bx, by_;
        if (t < FLIGHT_END) {
          bx = blockerStartX;
          by_ = baseY;
        } else {
          // Sprint toward their assigned coverage opponent's current
          // position. Failed blockers track 30% as fast — they "miss".
          const rt = (Math.min(t, RETURN_END) - FLIGHT_END) / (RETURN_END - FLIGHT_END);
          const closeRate = Math.min(1, rt * (fails ? 0.5 : 1.6));
          bx = blockerStartX + (targetPos.x - blockerStartX) * closeRate;
          by_ = baseY + (targetPos.y - baseY) * closeRate;
        }
        blockerPos.push({ x: bx, y: by_ });
      }

      // ── Determine engagement state per coverage player ──
      // A coverage player is "blocked" (engage pose) if a non-failing
      // blocker is within contact distance of them AND that coverage
      // player isn't the one tackling the returner.
      const covBlocked = new Array(NUM_COVER).fill(false);
      for (let i = 0; i < NUM_BLOCKERS; i++) {
        const { targetCov, fails } = blockerAssignments[i];
        if (fails) continue;
        if (targetCov === primaryTacklerIdx) continue;   // primary breaks through
        const dist = Math.hypot(blockerPos[i].x - coverPos[targetCov].x,
                                blockerPos[i].y - coverPos[targetCov].y);
        if (dist < 18) covBlocked[targetCov] = true;
      }

      // ── Draw coverage ──
      for (let i = 0; i < NUM_COVER; i++) {
        const cpos = coverPos[i];
        let cPose, cT;
        if (t < FLIGHT_END) {
          cPose = "run";
          cT = (t * 3 + i * 0.11) % 1;
        } else if (t < RETURN_END) {
          if (covBlocked[i]) {
            cPose = "engage";
            cT = (t * 3 + i * 0.13) % 1;
          } else {
            cPose = "run";
            cT = (t * 3 + i * 0.11) % 1;
          }
        } else {
          // Tackle phase: primary always tackles; secondary on style >= 1;
          // pile-up brings the close ones down too.
          const isPrimary   = i === primaryTacklerIdx;
          const isSecondary = i === secondaryTacklerIdx;
          const closeEnough = Math.hypot(cpos.x - returnerX, cpos.y - returnerY) < 16;
          const tackles =
            isPrimary ||
            (isSecondary && tackleStyle >= 1) ||
            (tackleStyle === 3 && closeEnough);
          if (tackles) {
            cPose = "tackled";
            cT = Math.min(1, (t - RETURN_END) / (1 - RETURN_END));
          } else if (closeEnough) {
            cPose = "engage";
            cT = (t * 3 + i * 0.13) % 1;
          } else {
            cPose = "run";
            cT = (t * 3 + i * 0.11) % 1;
          }
        }
        drawPlayer(ctx, cpos.x, cpos.y, kickTeam.primary, kickTeam.secondary, "",
                   cPose, cT, -recvDir);
      }

      // ── Kicker — stays back near his 35 throughout the play ──
      drawPlayer(ctx, kickerLineX - recvDir * 4, cy, kickTeam.primary, kickTeam.secondary,
                 "K", t < FLIGHT_END * 0.4 ? "kick" : "idle",
                 t < FLIGHT_END * 0.4 ? Math.min(1, t / (FLIGHT_END * 0.4)) : 0, -recvDir);

      // ── Draw blockers ──
      for (let i = 0; i < NUM_BLOCKERS; i++) {
        const bpos = blockerPos[i];
        const { targetCov, fails } = blockerAssignments[i];
        const engaged = !fails && covBlocked[targetCov];
        let bPose, bT;
        if (t < FLIGHT_END) {
          bPose = "stance";
        } else if (engaged) {
          bPose = "engage";
        } else {
          bPose = "run";
        }
        bT = (t * 3 + i * 0.17) % 1;
        drawPlayer(ctx, bpos.x, bpos.y, recvTeam.primary, recvTeam.secondary, "",
                   bPose, bT, recvDir);
      }

      // ── Returner (last so he draws on top) ──
      drawPlayer(ctx, returnerX, returnerY, recvTeam.primary, recvTeam.secondary,
                 "", returnerPose, returnerT, returnerFacing);

      // Ball — only show if not held by the returner pose
      drawBall(ctx, ballX, ballY, 1 + (t < FLIGHT_END ? Math.sin((t/FLIGHT_END) * Math.PI) * 0.3 : 0));
    }};
  }

  if (!play.startYard && play.startYard !== 0) {
    // Score-only play (extra point, etc.) - just hold
    return { duration: 600, kind: play.kind, render: (t, ctx) => {
      drawField(ctx, homeTeam, awayTeam, null);
    }};
  }

  const poss = play.poss;
  const dir = poss === "home" ? 1 : -1; // offense moves direction
  const losX = yardToAbsX(play.startYard, poss);
  const cy = (FIELD.TOP + FIELD.BOT) / 2;
  const formation = makeFormation(losX, poss, {
    twoBack: !!play.isTwoBack,
    isGoalLine: (play.startYard ?? 0) >= 95,
    personnel: play.personnel,
    defPackage: play.defPackage,
  });
  const team = poss === "home" ? homeTeam : awayTeam;
  const oppTeam = poss === "home" ? awayTeam : homeTeam;
  const possColor = team.primary;
  const oppColor = oppTeam.primary;
  // Attach per-player runStyle + celebStyle + jersey# from both rosters
  const offStarters = poss === "home" ? gameResult.homeRatings.starters : gameResult.awayRatings.starters;
  const defStarters = poss === "home" ? gameResult.awayRatings.starters : gameResult.homeRatings.starters;
  attachPlayerStyles(formation, offStarters, defStarters, gameResult.playerLookup);

  // ── DEFENDER INDEX HELPERS ──
  // The defense array is [...DL, ...LB, ...CB(+nickel+dime), S1, S2]. With
  // personnel-based subs (NICKEL drops 1 LB for a CB, DIME drops 2 LBs for
  // 2 DBs, QUARTER drops all 3 LBs), the indices for the safeties / corners
  // shift. Compute them once so pass-rush / coverage / pick logic works
  // regardless of defensive package.
  const _dlN = formation.dline.length;
  const _lbN = formation.lbs.length;
  const _cbN = (formation.cb1 ? 1 : 0) + (formation.cb2 ? 1 : 0) + (formation.cb3 ? 1 : 0) + (formation.cb4 ? 1 : 0) + (formation.cb5 ? 1 : 0);
  const idxLB1   = _dlN;
  const idxLBmid = _dlN + Math.floor(_lbN / 2);
  const idxLB3   = _dlN + Math.max(0, _lbN - 1);
  const idxCB1   = _dlN + _lbN;
  const idxCB2   = idxCB1 + 1;
  const idxNB    = idxCB1 + 2;
  const idxS1    = idxCB1 + _cbN;
  const idxS2    = idxS1 + 1;

  // First down marker abs X
  let firstDownAbs = null;
  if (play.down > 0) {
    const fdYard = clamp(play.startYard + play.ytg, 0, 100);
    firstDownAbs = yardToAbsX(fdYard, poss);
  }

  const fieldState = { los: losX, firstDownAbs, possColor };

  function drawPlayers(off, def) {
    for (const p of off) drawPlayer(ctx, p.x, p.y, possColor, team.secondary, p.label, p.pose, p.t, p.facing ?? (dir), p);
    for (const p of def) drawPlayer(ctx, p.x, p.y, oppColor, oppTeam.secondary, p.label, p.pose, p.t, p.facing ?? (-dir), p);
  }

  let ctx = null;

  // Audible — smart QBs (high AWR) sometimes change the play pre-snap.
  // Deterministic per play so the playback doesn't flicker on rewind.
  const qbPlayer = gameResult.playerLookup && offStarters ? gameResult.playerLookup.get(offStarters.qb) : null;
  const qbAwr = qbPlayer?.stats?.[3] ?? 70;   // index 3 = AWR
  // Inline aggression (mirrors _qbAggression — can't call Sim method here).
  const _qbThrAud = qbPlayer?.stats?.[4] ?? 70;
  const _qbArchAud = qbPlayer?.archetype;
  const _qbArchModAud = _qbArchAud === "GUNSLINGER" ? 20 : _qbArchAud === "DUAL_THREAT" ? 10 : _qbArchAud === "GAME_MANAGER" ? -15 : 0;
  const qbAgg = clamp(_qbThrAud * 0.40 + qbAwr * 0.30 + _qbArchModAud, 20, 99);
  // Aggressive QBs audible more often — cap raised to 0.38 for high-agg QBs.
  const audibleChance = clamp(((qbAwr - 60) / 180) * (1 + (qbAgg - 50) / 100), 0, 0.38);
  const audibleSeed = (((play.startYard * 31) ^ ((play.time || 0) * 7)) >>> 0) % 1000 / 1000;
  const isAudible = audibleSeed < audibleChance;
  // Extra pre-snap time when audibling (gives the play call space to breathe)
  // PRE will be computed per-play once dur is known (PRE = PRE_MS / dur)
  let PRE = 0.24;

  // ── PRE-SNAP MOTION ──
  // ~22% of plays put a receiver/TE in motion across the formation. Motion
  // takes place in the back half of pre-snap; the player settles into a new
  // y-coordinate by the snap. Routes start from the post-motion position.
  const motionSeed = (((play.startYard * 23) ^ ((play.targetDepth || 0) * 13) ^ ((play.time || 0) * 11)) >>> 0) % 1000 / 1000;
  const hasMotion  = motionSeed < 0.22 && play.kind !== "kickoff";
  let motionRole = null, motionStartY = 0, motionEndY = 0;
  if (hasMotion) {
    // Pick from receivers actually on the field for this personnel.
    const motionPool = [];
    if (formation.wr1) motionPool.push("wr1");
    if (formation.wr2) motionPool.push("wr2");
    if (formation.wr3) motionPool.push("wr3");
    if (formation.wr4) motionPool.push("wr4");
    if (formation.te)  motionPool.push("te");
    if (motionPool.length) {
      motionRole = motionPool[Math.floor(motionSeed * 9999) % motionPool.length];
      const target = motionRole === "wr1" ? formation.wr1
                   : motionRole === "wr2" ? formation.wr2
                   : motionRole === "wr3" ? formation.wr3
                   : motionRole === "wr4" ? formation.wr4
                   :                        formation.te;
      motionStartY = target.y;
      // Motion across into the slot (or to the opposite side for TE).
      motionEndY = motionRole === "wr1" ? cy - 50
                : motionRole === "wr2" ? cy + 50
                : motionRole === "wr3" ? cy + 30
                : motionRole === "wr4" ? cy - 30
                :                        cy - 78;
      target.y = motionEndY;
    }
  }
  // Returns the y-offset to apply to the motion player vs his post-motion home.
  // 0 means he's at his new home y. Positive/negative means he's still
  // traveling there during the motion window.
  const motionYOffset = (tNow) => {
    if (!hasMotion || tNow >= PRE) return 0;
    const preT = tNow / PRE;
    if (preT < 0.40) return (motionStartY - motionEndY);
    if (preT < 0.88) {
      const mp = (preT - 0.40) / 0.48;
      const sm = mp * mp * (3 - 2 * mp);
      return (motionStartY - motionEndY) * (1 - sm);
    }
    return 0;
  };
  // Returns true when the motion player is actively jogging across.
  const isInMotionNow = (tNow) => {
    if (!hasMotion || tNow >= PRE) return false;
    const preT = tNow / PRE;
    return preT >= 0.40 && preT < 0.88;
  };

  // ── DEFENSIVE PRE-SNAP MOVEMENT ─────────────────────────────────────
  // ~35% of plays, one defender shifts pre-snap (LB walks up to show blitz,
  // safety rotates from deep, DL slides). Picks an index 0-10 (defense
  // array) deterministically per play.
  // ~55% of plays, one defender (usually a LB or S) is the "POINTER" —
  // pre-snap point pose calling out the offense. Different player than
  // the shifter to avoid stacking.
  const defShiftSeed = (((play.startYard * 31) ^ ((play.targetDepth || 0) * 19) ^ ((play.time || 0) * 7)) >>> 0) % 1000 / 1000;
  const hasDefShift  = defShiftSeed < 0.35;
  // LB indices in formation.defense are 4,5,6 (after 4 DL); S are 9,10
  const shiftIdx = hasDefShift
    ? [4, 5, 6, 9, 10][Math.floor(defShiftSeed * 999) % 5]
    : -1;
  // Shift offsets — small position deltas applied during pre-snap window
  const shiftDX = hasDefShift ? (Math.floor(defShiftSeed * 999 + 7) % 2 ? -1 : 1) * (10 + (Math.floor(defShiftSeed * 999) % 12)) : 0;
  const shiftDY = hasDefShift ? (Math.floor(defShiftSeed * 999 + 11) % 2 ? -1 : 1) * (8 + (Math.floor(defShiftSeed * 999) % 10)) : 0;
  const defShiftXY = (idx, tNow) => {
    if (idx !== shiftIdx || tNow >= PRE) return { dx: 0, dy: 0 };
    const preT = tNow / PRE;
    if (preT < 0.30) return { dx: 0, dy: 0 };
    if (preT < 0.78) {
      const mp = (preT - 0.30) / 0.48;
      const sm = mp * mp * (3 - 2 * mp);
      return { dx: shiftDX * sm, dy: shiftDY * sm };
    }
    return { dx: shiftDX, dy: shiftDY };
  };
  const isDefShifting = (idx, tNow) => {
    if (idx !== shiftIdx || tNow >= PRE) return false;
    const preT = tNow / PRE;
    return preT >= 0.30 && preT < 0.78;
  };

  const defPointSeed = (((play.startYard * 13) ^ ((play.time || 0) * 23)) >>> 0) % 1000 / 1000;
  const hasDefPoint  = defPointSeed < 0.55;
  // Pointer is usually MLB (5) or SS/FS (9 or 10) — defenders in coverage
  // calling out the offense
  const pointerIdx = hasDefPoint
    ? [5, 5, 5, 9, 10][Math.floor(defPointSeed * 999) % 5]
    : -1;
  const isDefPointer = (idx) => idx === pointerIdx && idx !== shiftIdx;

  // Defender pursuit speed cap — tuned to a fast NFL defender (~9 yds/s).
  // Carrier runs slightly faster, so on breakaways defenders visibly trail.
  const PURSUIT_PX_MS = (FIELD.PX_PER_YARD * 9) / 1000;
  // ── Ragdoll physics — kinematic rigid-body. On impact, initialize
  // velocity + angular velocity from the hit vector. Each frame, integrate
  // with gravity, damping, and a ground bounce. State persists on the
  // formation player object (d._ragdoll) so it survives across frames
  // within a play and resets when a new play / formation is created.
  // Render uses style._ragdoll via the "ragdoll" pose case.
  const RAG_GRAVITY = 480;       // px/s² downward
  const RAG_DAMP_X  = 0.96;      // per-step velocity damping
  const RAG_DAMP_Y  = 0.99;
  const RAG_DAMP_W  = 0.94;      // angular damping
  function initRagdoll(player, hitDirX, hitDirY, force, nowMs, seed) {
    // hitDirX/Y is the unit vector FROM the hitter TO the victim — that's
    // the direction the victim flies. Force is impulse magnitude (px/s).
    const dist = Math.hypot(hitDirX, hitDirY) || 1;
    const ux = hitDirX / dist;
    const uy = hitDirY / dist;
    // Tackle PILE — bodies collapse, they don't explode. Spin and upward
    // kick capped so players fall in place with slight tumble instead
    // of flying apart. Per-seed jitter keeps each ragdoll a little
    // different without anyone going airborne.
    const seedF = (seed >>> 0);
    const spinSign = (seedF & 1) ? -1 : 1;
    const forceScale = Math.min(1.1, Math.max(0.5, force / 200));
    const spinMag = (2 + ((seedF >>> 1) & 5)) * forceScale;     // 1-7 rad/s
    const upKick  = (15 + ((seedF >>> 4) & 25)) * forceScale;   // 7-44 px/s
    player._ragdoll = {
      vx: ux * force,
      vy: uy * force - upKick,
      angVel: spinSign * spinMag,
      dx: 0, dy: 0, rot: 0,
      life: 0,
      onGround: false,
      lastMs: nowMs,
    };
  }
  function stepRagdoll(player, nowMs, groundDy) {
    const r = player._ragdoll;
    if (!r) return;
    const dt = Math.min(0.05, Math.max(0, (nowMs - r.lastMs) / 1000));
    r.lastMs = nowMs;
    if (dt <= 0) return;
    r.vy += RAG_GRAVITY * dt;
    r.dx += r.vx * dt;
    r.dy += r.vy * dt;
    r.rot += r.angVel * dt;
    if (r.dy >= groundDy) {
      // Landed — bounce a bit, then stick
      if (r.vy > 30) {
        r.dy = groundDy;
        r.vy = -r.vy * 0.20;
        r.angVel *= 0.5;
        r.vx *= 0.55;
      } else {
        r.dy = groundDy;
        r.vy = 0;
        r.angVel *= 0.6;
        r.vx *= 0.7;
      }
      r.onGround = true;
    }
    r.vx *= RAG_DAMP_X;
    r.vy *= RAG_DAMP_Y;
    r.angVel *= RAG_DAMP_W;
    r.life = Math.min(1, r.life + dt * 1.4);
  }
  // INCREMENTAL pursuit. Previously this computed "where would d be at
  // time elapsedMs if it traveled from d.x to (tx, ty) at constant
  // velocity", recomputing the path from d.x EVERY frame. When the
  // target shifted between frames (carrier juke, dodged stale-target
  // snap, sack pocket collapse, truck anchor), the entire path
  // re-drew from the origin and the defender appeared to teleport —
  // because the SAME elapsed time aimed at a NEW target lands at a
  // new fraction along a new line. Now mutates per-defender state
  // (_cx, _cy, _lastMs) so each call advances by dt FROM the last
  // known position; target changes only affect the direction of the
  // next small step.
  const pursue = (d, tx, ty, elapsedMs, factor = 1.0) => {
    if (d._cx == null) { d._cx = d.x; d._cy = d.y; d._lastMs = 0; }
    const dt = Math.max(0, elapsedMs - d._lastMs);
    d._lastMs = elapsedMs;
    const dx = tx - d._cx, dy = ty - d._cy;
    const dist = Math.hypot(dx, dy);
    const maxMove = PURSUIT_PX_MS * dt * factor;
    let actualMove;
    if (dist <= maxMove) {
      d._cx = tx; d._cy = ty;
      actualMove = dist;
    } else {
      const f = maxMove / Math.max(0.001, dist);
      d._cx += dx * f; d._cy += dy * f;
      actualMove = maxMove;
    }
    // moved = did the defender actually translate enough this frame to
    // justify a running leg-cycle. Below threshold (e.g., already at
    // target, target isn't moving) we'll freeze the legs in the caller.
    return { x: d._cx, y: d._cy, moved: actualMove > 0.15 };
  };
  // Action duration scales with yardage. Rebalanced based on cruise-speed
  // math: with runPacing's cruise covering 86% of distance in 56% of time,
  // the OLD formula produced 18 yd/s (~36 mph) cruise on 80-yard plays
  // (real NFL top speed is ~23 mph) and 2.2 yd/s on 2-yard stuffs (walking
  // pace). New curve: faster floor for short plays, steeper slope for long
  // plays so cruise lands near a realistic 12 yd/s.
  //   2yd → 920ms,  5yd → 1250ms,  10yd → 1800ms,  20yd → 2900ms,
  //   50yd → 6200ms,  80yd → 9500ms,  100yd → 11000ms (capped)
  function scaledDuration(yds) {
    return clamp(700 + Math.abs(yds || 0) * 110, 1000, 11000);
  }
  // Pre-snap timing — ~3 seconds of huddle break, line set, audible, "HUT HUT"
  // before the center snaps. Audibles add an extra ~600 ms.
  const PRE_MS = isAudible ? 3600 : 3000;
  // Realistic run pacing: handoff mesh → read the hole → burst → sustained → tackle.
  // Replaces the old eased-cubic linear blend that made the RB shoot to the end zone
  // in the first 30% of the play. Now the carrier hangs near the LOS for the early
  // mesh/read frames before exploding through the hole.
  //
  // cruiseEnd was a fixed 0.78, so 22% of action time was "ragdoll" wait at the
  // tackle spot. Fine at short durations (~300ms). After bumping scaledDuration
  // for long plays, 22% became 2+ seconds of the carrier standing still waiting
  // to be tackled — "teleport then wait" feel. Now adaptive: cap ragdoll
  // wall-time at ~1000ms by pushing cruiseEnd up on big plays.
  function runPacing(runT, actionMs) {
    const meshEnd = 0.10;     // QB-RB exchange + first step
    const readEnd = 0.22;     // reading the blocks, building speed
    const cruiseEnd = actionMs
      ? Math.max(0.78, Math.min(0.94, 1 - 1000 / actionMs))
      : 0.78;
    const meshDist  = 0.04;
    const readDist  = 0.14;
    const cruiseDist = 1.0;
    if (runT < meshEnd) {
      const t = runT / meshEnd;
      return t * meshDist;
    }
    if (runT < readEnd) {
      const t = (runT - meshEnd) / (readEnd - meshEnd);
      const eased = t * t;
      return meshDist + (readDist - meshDist) * eased;
    }
    if (runT < cruiseEnd) {
      const t = (runT - readEnd) / (cruiseEnd - readEnd);
      return readDist + (cruiseDist - readDist) * t;
    }
    return cruiseDist;                // RB has stopped; tackle / ragdoll
  }

  // Pre-snap callouts: only AUDIBLE (when relevant) + the "BALL SNAPPED!"
  // flash at the moment of the snap. No SET/DOWN/HUT cadence text.
  function drawPreSnapCallouts(c, t, dur) {
    // Broadcast camera: route all banners/text to the upright overlay
    // canvas so they don't tilt with the field plane.
    if (typeof cameraMode !== "undefined" && cameraMode === "broadcast"
        && typeof _uprightCtx !== "undefined" && _uprightCtx) {
      c = _uprightCtx;
    }
    // Snap flash window — anchored to ~750ms wall time (not a fixed fraction
    // of action), so short plays still get a visible flash.
    const snapFlashWindow = Math.min(0.5, 750 / (dur || 2400));
    if (t > PRE && t < PRE + snapFlashWindow) {
      const flashT = (t - PRE) / snapFlashWindow;
      const fade   = flashT < 0.2 ? flashT / 0.2 : (1 - (flashT - 0.2) / 0.80);
      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = `rgba(0,0,0,${0.62 * fade})`;
      c.fillRect(0, 24, FIELD.W, 72);
      // Big jagged banner — "HIKE!" reads more cinematic than "BALL SNAPPED!"
      c.fillStyle = `rgba(240, 204, 48, ${fade})`;
      c.font = "900 64px Impact, Arial Black, sans-serif";
      c.fillText("HIKE!", FIELD.W / 2, 60);
      // Thin outline for legibility against any field
      c.strokeStyle = `rgba(0,0,0,${0.85 * fade})`;
      c.lineWidth = 2;
      c.strokeText("HIKE!", FIELD.W / 2, 60);
      c.restore();
      return;
    }
    if (t > PRE) return;
    const tt = t / PRE;
    // ── PRE-SNAP UI — Madden-style formation + cadence overlay ────
    // Top-left: personnel + formation chip (offense)
    // Top-right: defensive package chip
    // Bottom-center: down + distance + yardline summary
    // Bottom: animated cadence text (READY → SET → HUT)
    // Faded out at the very end of pre-snap so the snap flash takes over.
    const uiFade = tt < 0.10 ? tt / 0.10 : tt > 0.88 ? (1 - tt) / 0.12 : 1;
    if (uiFade > 0.02) {
      c.save();
      // Personnel chip (top-left)
      const personnel = play.personnel || "BASE";
      const personnelLabel = personnel === "TRIPS"   ? "11 · TRIPS"
                          : personnel === "SPREAD"   ? "10 · SPREAD"
                          : personnel === "EMPTY"    ? "00 · EMPTY"
                          : personnel === "HEAVY"    ? "12 · HEAVY"
                          : personnel === "SMASH"    ? "21 · SMASH"
                          : personnel === "I_FORM"   ? "21 · I-FORM"
                          : personnel === "GOAL_LINE" ? "23 · GOAL LINE"
                          : `${personnel}`;
      const chipPadX = 14, chipPadY = 7;
      c.font = "900 18px sans-serif";
      const persW = c.measureText(personnelLabel).width + chipPadX * 2;
      c.globalAlpha = uiFade * 0.92;
      c.fillStyle = "rgba(0,0,0,0.78)";
      c.fillRect(16, 92, persW, 28);
      c.fillStyle = "#ffd54d";
      c.fillRect(16, 92, 4, 28);  // accent stripe
      c.fillStyle = "#fff";
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.fillText(personnelLabel, 28, 106);
      // Defensive package chip (top-right)
      const defPkg = play.defPackage || "BASE_43";
      const defLabel = defPkg === "BASE_43" ? "4-3 BASE"
                     : defPkg === "BASE_34" ? "3-4 BASE"
                     : defPkg === "NICKEL"  ? "NICKEL"
                     : defPkg === "DIME"    ? "DIME"
                     : defPkg === "BLITZ_46" ? "46 BLITZ"
                     : defPkg === "PREVENT" ? "PREVENT"
                     : String(defPkg).replace(/_/g," ");
      const defW = c.measureText(defLabel).width + chipPadX * 2;
      c.fillStyle = "rgba(0,0,0,0.78)";
      c.fillRect(FIELD.W - defW - 16, 92, defW, 28);
      c.fillStyle = "#ff8a4a";
      c.fillRect(FIELD.W - 20, 92, 4, 28);
      c.fillStyle = "#fff";
      c.textAlign = "right";
      c.fillText(defLabel, FIELD.W - 28, 106);
      // Cadence text (bottom-center) — READY → SET → HUT timed across pre-snap
      const cadenceY = FIELD.H - 50;
      const cadenceLabel = tt < 0.35 ? "READY"
                        : tt < 0.65 ? "SET"
                        : tt < 0.92 ? "HUT"
                        : null;
      if (cadenceLabel) {
        c.textAlign = "center";
        c.textBaseline = "middle";
        // Pulse on each cadence beat
        const beatT = cadenceLabel === "READY" ? (tt - 0)    / 0.35
                    : cadenceLabel === "SET"   ? (tt - 0.35) / 0.30
                    :                            (tt - 0.65) / 0.27;
        const beatPulse = Math.min(1, Math.sin(beatT * Math.PI) * 1.2);
        const cadFade = uiFade * (0.5 + beatPulse * 0.5);
        c.globalAlpha = cadFade;
        c.font = `900 ${Math.round(28 + beatPulse * 6)}px Impact, Arial Black, sans-serif`;
        c.strokeStyle = "rgba(0,0,0,0.85)";
        c.lineWidth = 3;
        c.fillStyle = cadenceLabel === "HUT" ? "#ffd54d" : "#fff";
        c.strokeText(cadenceLabel, FIELD.W / 2, cadenceY);
        c.fillText(cadenceLabel, FIELD.W / 2, cadenceY);
      }
      c.restore();
    }
    // MOTION! callout — flashes while the receiver is actually jogging across
    if (hasMotion && tt >= 0.40 && tt < 0.78 && !isAudible) {
      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.fillRect(0, 30, FIELD.W, 40);
      c.fillStyle = "#9bd0ff";
      c.font = "900 22px sans-serif";
      c.fillText("MOTION!", FIELD.W / 2, 50);
      c.restore();
    }
    // Audible callout — only shown when the QB is actually changing the play.
    if (isAudible && tt >= 0.30 && tt < 0.78) {
      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "rgba(0,0,0,0.55)";
      c.fillRect(0, 30, FIELD.W, 56);
      c.fillStyle = "#f0cc30";
      c.font = "900 28px sans-serif";
      c.fillText("AUDIBLE!", FIELD.W / 2, 50);
      c.fillStyle = "#fff";
      c.font = "bold 13px sans-serif";
      c.fillText(`${lastNameUpper(offStarters?.qb || "QB")} changes the play at the line`, FIELD.W / 2, 72);
      c.restore();
    }
  }

  if (play.kind === "run") {
    const endX = yardToAbsX(play.endYard, poss);
    const yards = play.yards ?? 0;
    const isTD = (play.endYard ?? 0) >= 100;
    // Extra time at the end. Non-TDs get a tackle-ragdoll window; TDs
    // get a celebration window where the scorer raises arms + a banner
    // flashes. Big-play TDs get more celebration time — let it breathe.
    const RUN_TACKLE_MS = isTD ? Math.round(1500 + Math.min(Math.abs(yards), 80) * 8) : 1000;
    const actionDur = scaledDuration(yards) + RUN_TACKLE_MS;
    const dur = actionDur + PRE_MS;
    PRE = PRE_MS / dur;
    // Play-side picks for run concepts — hoisted out of the RB block so
    // they're also available to the OL/FB renders. counterSide/stretchSide/
    // pitchSide use the same hash formulas as the existing RB code so the
    // sides agree.
    const _counterSide = ((play.startYard * 11) % 2) === 0 ? 1 : -1;
    const _stretchSide = ((play.startYard * 17) % 2) === 0 ? 1 : -1;
    const _pitchSide   = ((play.startYard * 13) % 2) === 0 ? 1 : -1;
    return { duration: dur, kind: "run", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      const rb = { ...formation.rb };
      const qb = { ...formation.qb };
      const isScramble = !!play.isScramble;
      const isQBRun = !!play.isQBRun;
      const isQBCarry = isScramble || isQBRun;
      const runT = t < PRE ? 0 : (t - PRE) / (1 - PRE);
      // Pre-snap: ball sits at the CENTER (front of the OL).
      // Snap window (runT 0 - 0.04): ball travels back to the QB.
      // Post-snap: ball follows the carrier, sliding from backfield to LOS lane.
      const snapMotionRT = 0.04;
      const centerX = losX - dir * 2;
      let ballX, ballY;
      // Speed-option dual-sprite tracking — when set, the rendering swap
      // below uses these to draw the QB and RB sprites at their parallel
      // sprint positions. Null otherwise (normal one-carrier rendering).
      let optQbX = null, optQbY = null;
      let optRbX = null, optRbY = null;
      if (t < PRE) {
        ballX = centerX;
        ballY = cy;
      } else if (runT < snapMotionRT) {
        // Snap from center back to QB
        const snapT = runT / snapMotionRT;
        const sm = snapT * snapT * (3 - 2 * snapT);
        ballX = centerX + (formation.qb.x - centerX) * sm;
        ballY = cy + (cy - cy) * sm;
      } else if (isScramble) {
        // SCRAMBLE: QB drops back, reads the field briefly, then tucks
        // and runs. Three phases, but the "hesitate" window used to
        // oscillate ±4-6px which read as "shaking" — replaced with a
        // small ONE-TIME side-step (QB looks, plants a foot, takes off).
        //   Phase A (0 - 0.18): clean dropback to ~5 yds behind LOS
        //   Phase B (0.18 - 0.30): brief read — single lateral step, no wiggle
        //   Phase C (0.30 - end): tuck and sprint forward to endX
        const dropBackX = qb.x - dir * 5 * FIELD.PX_PER_YARD;
        if (runT < 0.18) {
          const dropT = runT / 0.18;
          const sm = dropT * dropT * (3 - 2 * dropT);
          ballX = qb.x + (dropBackX - qb.x) * sm;
          rb.x = ballX;
          rb.y = cy;
        } else if (runT < 0.30) {
          // Single read step — one easeout sidestep, then settles
          const hesT = (runT - 0.18) / 0.12;
          const sm = hesT * (2 - hesT);   // easeOut — peaks at the end
          ballX = dropBackX + dir * 2 * sm;   // small forward read step
          rb.x = ballX;
          rb.y = cy + dir * 3 * Math.sin(sm * Math.PI);  // gentle one-time sway
        } else {
          // Tuck and run — smooth pacing curve from the read spot to endX
          const tuckT = (runT - 0.30) / 0.70;
          const readSpotX = dropBackX + dir * 2;
          ballX = readSpotX + (endX - readSpotX) * tuckT;
          rb.x = ballX;
          rb.y = cy;
        }
      } else if (play.isSpeedOption) {
        // SPEED OPTION — QB and RB sprint parallel to the option side.
        // At the pitch read (PITCH_T), the QB either KEEPS or PITCHES to
        // the trailing RB. Both sprites are actively animated — the
        // dual-sprite positions are stored in optQbX/Y and optRbX/Y
        // which the rendering pass uses to draw both players.
        const optSide = ((play.startYard * 19) >>> 0) % 2 === 0 ? 1 : -1;
        const PITCH_T = 0.28;
        const PITCH_FLY = 0.06;
        const isPitchPlay = !!play.isPitch;
        // The edge target — the corner the option attacks toward
        const edgeX = qb.x + dir * 3 * FIELD.PX_PER_YARD;
        const edgeY = cy + optSide * 50;
        const rbTrailDx = -dir * 2 * FIELD.PX_PER_YARD;
        const rbTrailDy = optSide * 18;
        // QB sprint path
        let qbCurX, qbCurY;
        if (runT < PITCH_T) {
          const sm = runT / PITCH_T;
          const eased = sm * sm * (3 - 2 * sm);
          qbCurX = qb.x + (edgeX - qb.x) * eased;
          qbCurY = cy + (edgeY - cy) * eased;
        } else if (isPitchPlay) {
          // After pitching, the QB slows and drifts toward the sideline
          const after = (runT - PITCH_T) / (1 - PITCH_T);
          qbCurX = edgeX + dir * 6 * after;
          qbCurY = edgeY + optSide * 8 * after;
        } else {
          // Keep — QB continues forward toward endX
          const progress = runPacing(runT, actionDur);
          const after = (runT - PITCH_T) / (1 - PITCH_T);
          qbCurX = qb.x + (endX - qb.x) * progress;
          qbCurY = edgeY + (cy + optSide * 25 - edgeY) * Math.min(1, after);
        }
        // RB pitch-back path
        let rbCurX, rbCurY;
        if (runT < PITCH_T) {
          const sm = runT / PITCH_T;
          const eased = sm * sm * (3 - 2 * sm);
          const tx = edgeX + rbTrailDx;
          const ty = edgeY + rbTrailDy;
          rbCurX = formation.rb.x + (tx - formation.rb.x) * eased;
          rbCurY = formation.rb.y + (ty - formation.rb.y) * eased;
        } else if (isPitchPlay) {
          // RB takes the pitch and sprints upfield
          const rbStartX = edgeX + rbTrailDx;
          const rbStartY = edgeY + rbTrailDy;
          const after = (runT - PITCH_T) / (1 - PITCH_T);
          const easeOut = after * (2 - after);
          rbCurX = rbStartX + (endX - rbStartX) * easeOut;
          rbCurY = rbStartY + (cy + optSide * 20 - rbStartY) * easeOut;
        } else {
          // QB keeps — RB peels off the option lane as a decoy
          const after = (runT - PITCH_T) / (1 - PITCH_T);
          rbCurX = edgeX + rbTrailDx + dir * 8 * after;
          rbCurY = edgeY + rbTrailDy + optSide * 22 * after;
        }
        // Assign rb (carrier sprite slot) and stash the OTHER sprite's pos
        if (isPitchPlay) {
          rb.x = rbCurX; rb.y = rbCurY;          // RB is the carrier
          optQbX = qbCurX; optQbY = qbCurY;      // QB sprite separate
        } else {
          rb.x = qbCurX; rb.y = qbCurY;          // QB-as-carrier (isQBCarry override)
          optRbX = rbCurX; optRbY = rbCurY;      // RB sprite separate
        }
        // Ball position — with QB pre-pitch, in flight during pitch arc,
        // with RB post-pitch (or with QB throughout for keeps)
        if (runT < PITCH_T) {
          ballX = qbCurX; ballY = qbCurY;
        } else if (isPitchPlay && runT < PITCH_T + PITCH_FLY) {
          const flyT = (runT - PITCH_T) / PITCH_FLY;
          ballX = edgeX + (rbCurX - edgeX) * flyT;
          ballY = edgeY + (rbCurY - edgeY) * flyT - Math.sin(flyT * Math.PI) * 10;
        } else if (isPitchPlay) {
          ballX = rbCurX; ballY = rbCurY;
        } else {
          ballX = qbCurX; ballY = qbCurY;
        }
      } else if (isQBRun) {
        // DESIGNED QB RUN / OPTION KEEPER — the QB sprite (rendered at
        // rb.x/rb.y by the qbCarrier swap below) sprints from his stance
        // position straight to endX using the standard run-pacing curve.
        // The real RB is drawn separately in the backfield as a decoy.
        // Previously this was split into a 0-0.16 "option fake" lerp +
        // a 0.16-end runPacing lerp — the two phases didn't agree on
        // distance, so the carrier teleported BACKWARDS by ~2.5 yds at
        // the seam (rb.x jumped from qb.x+3yd to ~qb.x+0.3yd at runT=0.16).
        // A single curve from qb.x → endX eliminates the teleport, the
        // stall, and the ball-going-backwards-then-forward shudder.
        const progress = runPacing(runT, actionDur);
        rb.x = qb.x + (endX - qb.x) * progress;
        // Slight lateral sway during the mesh window (0-0.20) shows the
        // option look; QB then straightens out for the sprint.
        const meshSway = runT < 0.20
          ? Math.sin((runT / 0.20) * Math.PI) * 4
          : 0;
        rb.y = cy - dir * meshSway;
        ballX = rb.x;
      } else if (play.isReverse) {
        // REVERSE — RB sprints laterally to one sideline, then the lateral
        // handoff "reverses" the carrier across the field to the opposite side.
        // Visualized as a single carrier whose lateral direction flips at the
        // handoff moment, gaining yards toward endX in the back half.
        const reverseSide = ((play.startYard * 7) % 2) === 0 ? 1 : -1;   // top or bottom sideline
        const lateralMax = 90;   // pixels of lateral travel before the handoff
        if (runT < 0.18) {
          // Sprint laterally to one side, ~0 forward progress
          const p = runT / 0.18;
          rb.x = qb.x;
          rb.y = cy + reverseSide * p * lateralMax;
        } else if (runT < 0.30) {
          // Lateral handoff — carrier slows, then reverses direction
          const p = (runT - 0.18) / 0.12;
          rb.x = qb.x + Math.sin(p * Math.PI * 0.5) * 4;
          rb.y = cy + reverseSide * lateralMax;
        } else {
          // The "WR" now carries — sprints back across the field and forward to endX
          const p = (runT - 0.30) / 0.42;          // 0 → 1 over the rest of cruise
          const eased = Math.min(1, p);
          rb.x = qb.x + (endX - qb.x) * eased;
          // Lateral position swings from the start sideline back across to the other
          rb.y = cy + reverseSide * lateralMax * (1 - eased) + (-reverseSide) * lateralMax * 0.3 * eased;
        }
        ballX = rb.x;
      } else if (play.runType === "counter") {
        // COUNTER — RB takes a false step opposite the intended direction
        // (~0.10), then cuts BACK and follows the pulling guard's gap. Looks
        // like "step right, run left" misdirection.
        const counterSide = ((play.startYard * 11) % 2) === 0 ? 1 : -1;
        if (runT < 0.10) {
          // False step away from the play
          const p = runT / 0.10;
          rb.x = qb.x - dir * p * 8;
          rb.y = cy + 28 - counterSide * p * 14;
        } else if (runT < 0.22) {
          // Plant + cut back across
          const p = (runT - 0.10) / 0.12;
          rb.x = qb.x - dir * (8 - p * 6);
          rb.y = cy + 28 + counterSide * p * 18 - counterSide * 14;
        } else {
          // Burst through the gap toward endX, slight angle in counterSide direction
          const p = (runT - 0.22) / 0.50;
          const eased = Math.min(1, p);
          rb.x = qb.x + (endX - qb.x) * eased;
          rb.y = cy + 28 - counterSide * (1 - eased) * 4 + counterSide * eased * 10;
        }
        ballX = rb.x;
      } else if (play.runType === "stretch") {
        // STRETCH / OUTSIDE ZONE — RB attacks the edge laterally first, then
        // cuts upfield when a gap opens. Sustained sideways flow along the LOS.
        const stretchSide = ((play.startYard * 17) % 2) === 0 ? 1 : -1;
        const lateralMax = 70;
        if (runT < 0.30) {
          // Pure lateral run along the LOS
          const p = runT / 0.30;
          rb.x = qb.x + dir * p * 1 * FIELD.PX_PER_YARD;
          rb.y = cy + 28 + stretchSide * p * lateralMax;
        } else {
          // Cut upfield — toward endX while maintaining the lateral offset
          const p = (runT - 0.30) / 0.42;
          const eased = Math.min(1, p);
          const lateralStart = cy + 28 + stretchSide * lateralMax;
          rb.x = qb.x + dir * FIELD.PX_PER_YARD + (endX - qb.x - dir * FIELD.PX_PER_YARD) * eased;
          rb.y = lateralStart + (cy + 28 + stretchSide * 30 - lateralStart) * eased;
        }
        ballX = rb.x;
      } else if (play.runType === "pitch") {
        // PITCH — QB tosses the ball laterally to the RB on the move, who
        // sprints to the edge.
        const pitchSide = ((play.startYard * 13) % 2) === 0 ? 1 : -1;
        const pitchTargetX = qb.x;
        const pitchTargetY = cy + 28 + pitchSide * 50;
        if (runT < 0.12) {
          // Ball in flight from QB to RB (lateral pitch)
          const p = runT / 0.12;
          ballX = qb.x + (pitchTargetX - qb.x) * p;
          // RB sprinting laterally to catch
          rb.x = qb.x;
          rb.y = cy + 28 + pitchSide * p * 50;
          // Ball Y interpolates from QB → catching RB along a small arc
          ballY = cy + (rb.y - cy) * p - Math.sin(p * Math.PI) * 8;
        } else if (runT < 0.20) {
          // RB has the ball, still moving laterally before turning upfield
          const p = (runT - 0.12) / 0.08;
          rb.x = qb.x + dir * p * 4;
          rb.y = pitchTargetY + pitchSide * p * 8;
          ballX = rb.x;
        } else {
          // Burst toward endX along the sideline
          const p = (runT - 0.20) / 0.52;
          const eased = Math.min(1, p);
          rb.x = qb.x + dir * 4 + (endX - qb.x - dir * 4) * eased;
          rb.y = pitchTargetY + pitchSide * 8 + (cy + 28 + pitchSide * 60 - pitchTargetY - pitchSide * 8) * eased;
          ballX = rb.x;
        }
      } else {
        // Realistic pacing: mesh (slow) → read (ramp) → cruise (linear) → tackle.
        // The RB now lingers near the LOS for the early frames before exploding.
        const progress = runPacing(runT, actionDur);
        ballX = qb.x + (endX - qb.x) * progress;
        rb.x = qb.x + (endX - qb.x) * progress;
        // RB stays in the backfield until the read phase ends, then merges to the LOS lane.
        // Use the same progress curve so the lateral merge tracks the forward burst.
        rb.y = cy + (1 - progress) * 18;
      }
      // ── BALL FOLLOWS CARRIER ──
      // If a variant didn't explicitly set ballY (it sets ballX = rb.x but
      // forgets ballY), default it to the carrier's y. Previously ballY
      // was initialized to cy + (1 - runT) * 18, which decoupled the ball
      // from the carrier on plays where rb.y diverged from that formula
      // (stretch, pitch, reverse, etc.) — visually the ball ended up on
      // the ground while the carrier ran somewhere else.
      if (ballY === undefined) ballY = rb.y;
      // (rbLateral added after pose decision below)
      // Carrier pose & move signature — drives juke/spin/hurdle/stiff/truck visibly.
      // Each move triggers a lateral side-step (or shoulder lower) AND makes the
      // nearest defender briefly overshoot, so the play LOOKS like a broken tackle.
      // Pose by phase: idle (pre-snap) → reach (mesh, taking the ball)
      // → run (read, looking for the hole) → carry (cruise / sustained)
      // SCRAMBLE has its own pose timeline: throw-look → throw-look → carry
      // OPTION KEEPER: reach → carry
      let rbPose;
      if (t < PRE) {
        rbPose = "idle";
      } else if (isScramble) {
        if (runT < 0.34)        rbPose = "throw";   // looking downfield, ball cocked
        else                     rbPose = "carry";
      } else if (isQBRun) {
        if (runT < 0.16)        rbPose = "reach";
        else                     rbPose = "carry";
      } else {
        if (runT < 0.14)        rbPose = "reach";
        else if (runT < 0.30)   rbPose = "run";
        else                     rbPose = "carry";
      }
      let rbT = (t * 3) % 1;
      let rbLateral = 0;
      let dodgeIdx = -1;
      let moveCallout = null;
      const rbArch = formation.rb.archetype;
      // Use two independent seeds so we can roll two moves per play
      const seedA = ((play.startYard * 17 + (play.yards || 0) * 53) >>> 0) % 100 / 100;
      const seedB = ((play.startYard * 41 + (play.yards || 0) * 29 + 7) >>> 0) % 100 / 100;
      // Pre-pick which pursuer is the primary tackler (gets the visible
      // "hit" or "dive" pose at the tackle moment). Hashed off the play
      // so the same play picks the same tackler every render. Range is
      // the LB/CB/S pursuit pool (i>=4); DL stay engaged at LOS.
      const tacklerHash = (((play.startYard * 31) ^ ((play.yards||0) * 17) ^ ((play.time||0) * 13)) >>> 0);
      const numPursuers = Math.max(1, formation.defense.length - 4);
      const primaryTacklerIdx = 4 + (tacklerHash % numPursuers);
      // Tackler-arrives-via-dive odds. Mechanism overrides the random
      // pick: "low" tackles (cut/shoestring) are ALWAYS dive; "behind"
      // tackles (chase-down) are NEVER dive; others use the per-play
      // hash for 30% dive variety.
      const _mechHint = play.mechanism || "head-on";
      const primaryTacklerDives = _mechHint === "low"    ? true
                                : _mechHint === "behind" ? false
                                : ((tacklerHash >>> 6) % 100) < 30;
      // Most plays display a move; broken tackles ALWAYS show one (forces probabilities to 1)
      const bt = play.brokenTackles || 0;
      const eluciveProb = bt > 0 ? 1.0 : (rbArch === "ELUSIVE" ? 0.95 : rbArch === "SPEED" ? 0.65 : 0.55);
      const powerProb   = bt > 0 ? 1.0 : (rbArch === "POWER"   ? 0.90 : rbArch === "WORKHORSE" ? 0.55 : 0.35);
      const inWindow = (a, b) => runT > a && runT < b;
      // Tackle window — start at runT 0.72 (~28% of action devoted to tackle
      // + ragdoll roll-around) so the play doesn't end the instant the
      // carrier is touched.
      if (runT > 0.72 && yards < 90 && !isTD) {
        // Carrier ragdoll. The impact FEEL comes from the player's own
        // motion (launch + spin) plus brief time dilation, NOT dust/
        // shake noise. force scales the launch velocity and a slow-mo
        // window so the impact frame is held briefly.
        const nowMs = t * dur;
        if (!formation.rb._ragdoll) {
          const force = play.force || 0;
          const mech = play.mechanism || "head-on";
          // Mechanism drives the FALL SHAPE — high/low/side/behind each
          // produce a distinct ragdoll trajectory.
          //   head-on / high: carrier topples BACKWARD (-dir)
          //   low: feet stop, upper body continues FORWARD (+dir), spinout
          //   side: lateral tumble (perpendicular jolt)
          //   behind: shoved FORWARD (+dir), low spin, face-first fall
          const sideSign = ((play.startYard * 23) >>> 0) & 1 ? 1 : -1;
          let hvx, hvy, fbase, spinBoost;
          if (mech === "low") {
            hvx =  dir * 0.4;          // upper body forward
            hvy = sideSign * 0.3;
            fbase = 70 + Math.min(80, force * 5);
            spinBoost = 1.8;           // tumble forward (high spin)
          } else if (mech === "side") {
            hvx = -dir * 0.25;
            hvy = sideSign * 1.0;      // mostly lateral
            fbase = 55 + Math.min(75, force * 5);
            spinBoost = 1.2;
          } else if (mech === "behind") {
            hvx =  dir * 0.8;          // shoved forward
            hvy = sideSign * 0.2;
            fbase = 40 + Math.min(70, force * 5);
            spinBoost = 0.5;           // less spin, more belly-flop
          } else if (mech === "high") {
            hvx = -dir * 0.9;          // toppled back hard
            hvy = sideSign * 0.2;
            fbase = 60 + Math.min(95, force * 6);
            spinBoost = 1.0;
          } else {
            // head-on / default — backward shove with light angle
            hvx = -dir;
            hvy = sideSign * 0.4;
            fbase = 50 + Math.min(90, force * 6);
            spinBoost = 0.9;
          }
          initRagdoll(formation.rb, hvx, hvy, fbase, nowMs,
                      (play.startYard * 11 + (play.yards||0)) >>> 0);
          // Apply mechanism-specific spin boost on top of the base spin
          if (formation.rb._ragdoll) {
            formation.rb._ragdoll.angVel *= spinBoost;
          }
          // Cinematic slow-mo at impact — duration & depth scale with
          // force. Bigger hits get held longer / slower. Read by tick().
          if (typeof animState !== "undefined" && animState) {
            const slowMs = 100 + Math.min(220, force * 22);
            animState.slowMoUntil = performance.now() + slowMs;
            animState.slowMoMul = Math.max(0.20, 0.50 - force * 0.025);
          }
        }
        stepRagdoll(formation.rb, nowMs, 8);
        rbPose = "ragdoll";
      } else if (runT > 0.72 && isTD) {
        // TD CELEBRATION — arms up, bouncing in the end zone
        rbPose = "celebrate";
        rbT = Math.min(1, (runT - 0.72) / 0.28);
      }
      // EARLY CRUISE: ELUSIVE → juke; POWER → truck stick at/just past the line.
      // Moves happen during cruise (0.22 - 0.72) since tackle now starts at 0.72.
      else if (yards >= 2 && inWindow(0.28, 0.44)) {
        const wantsJuke = rbArch === "ELUSIVE" || rbArch === "RECEIVING" || (rbArch !== "POWER" && seedA < 0.55);
        const wantsTruck = rbArch === "POWER" && seedA < powerProb;
        if (wantsTruck) {
          rbPose = "truck";
          moveCallout = "TRUCK!";
          dodgeIdx = 4;
        } else if (wantsJuke && seedA < eluciveProb) {
          rbPose = "juke";
          const cutDir = seedA < eluciveProb / 2 ? 1 : -1;
          const within = (runT - 0.34) / 0.18;
          rbLateral = cutDir * Math.sin(within * Math.PI) * 22;
          dodgeIdx = 4;
          moveCallout = "JUKE!";
        }
      }
      // MID CRUISE: spin (ELUSIVE/WORKHORSE) on plays ≥ 5 yds
      else if (yards >= 5 && inWindow(0.44, 0.58) && (rbArch === "ELUSIVE" || rbArch === "WORKHORSE" || seedB < 0.4)) {
        rbPose = "spin";
        rbT = (runT - 0.44) / 0.14;
        const cutDir = seedB < 0.5 ? 1 : -1;
        const within = (runT - 0.44) / 0.14;
        rbLateral = cutDir * Math.sin(within * Math.PI) * 14;
        dodgeIdx = 6;
        moveCallout = "SPIN!";
      }
      // LATE CRUISE: stiff arm / hurdle on plays ≥ 6 yds
      else if (yards >= 6 && inWindow(0.55, 0.70)) {
        if ((rbArch === "POWER" || rbArch === "WORKHORSE") && seedB > 0.55) {
          rbPose = "hurdle";
          dodgeIdx = 9;
          moveCallout = "HURDLE!";
        } else {
          rbPose = "stiff";
          dodgeIdx = 7;
          moveCallout = "STIFF ARM!";
        }
      }
      rb.pose = rbPose; rb.t = rbT; rb.facing = dir;
      // Expose ragdoll state to the renderer via style. The spread copy
      // of formation.rb at the top of the frame may not have captured
      // _ragdoll if init happened later this frame, so re-attach.
      if (formation.rb._ragdoll) rb._ragdoll = formation.rb._ragdoll;
      rb.y += rbLateral;
      ballY += rbLateral;
      // Determine which DL "wins" his rep — for big runs, the OL is winning at every gap
      // (we ALSO need at least one DL to break free if the run is short / for losses)
      const dlBreaksFree = yards < 2 ? 1 : 0;  // on stuffs, one rusher penetrates
      // Defense: DL get locked up at LOS (engaged with OL); LBs/DBs pursue
      const def = formation.defense.map((d, i) => {
        const dd = { ...d };
        if (t < PRE) {
          const sh = defShiftXY(i, t);
          dd.x = d.x + sh.dx;
          dd.y = d.y + sh.dy;
          dd.pose = isDefShifting(i, t) ? "run" : (isDefPointer(i) ? "point" : "stance");
          dd.t = (t * 3) % 1;
          dd.facing = -dir;
          return dd;
        }
        const tt = runT;
        // ── SPEED OPTION DEFENSE ──────────────────────────────────────
        // The playside edge defender and playside safety divide the QB
        // and pitch responsibilities. Whichever the EDGE plays (QB or
        // pitch), the SAFETY plays the other. This forces a real read
        // for the QB — the carrier with the correct read wins.
        if (play.isSpeedOption && play.optionRead) {
          const opt = play.optionRead;
          const isPlaysideEdge = (opt.optSide === 1 && i === 3) || (opt.optSide === -1 && i === 0);
          const isPlaysideSafety = (opt.optSide === 1 && i === idxS2) || (opt.optSide === -1 && i === idxS1);
          if (isPlaysideEdge || isPlaysideSafety) {
            // Locate the two ball-paths. For a keep: rb.x/y is the QB,
            // optRbX/Y is the trailing pitch back. For a pitch: rb.x/y
            // is the RB, optQbX/Y is the QB sprite.
            const qbPosX = play.isPitch ? (optQbX ?? rb.x) : rb.x;
            const qbPosY = play.isPitch ? (optQbY ?? rb.y) : rb.y;
            const rbPosX = play.isPitch ? rb.x : (optRbX ?? rb.x);
            const rbPosY = play.isPitch ? rb.y : (optRbY ?? rb.y);
            // Edge gets QB if defAttacksQb; safety gets the OPPOSITE.
            const attacksQb = opt.defAttacksQb ? isPlaysideEdge : isPlaysideSafety;
            // Edge defender attacking QB crashes hard; defender on the
            // pitch keeps outside leverage (slower, contain track).
            const tx = attacksQb ? qbPosX + dir * 2 : rbPosX - dir * 2;
            const ty = attacksQb ? qbPosY            : rbPosY + opt.optSide * 4;
            const factor = attacksQb ? 1.05 : 0.78;
            const elapsedMs = Math.max(0, (t - PRE) * dur);
            const np = elapsedMs > 0 ? pursue(d, tx, ty, elapsedMs, factor) : { x: d.x, y: d.y, moved: false };
            dd.x = np.x; dd.y = np.y;
            dd.pose = "run";
            dd.t = np.moved ? (t * 3 + i * 0.13) % 1 : 0;
            dd.facing = -dir;
            // Tackle at the end if right on the carrier (the real ball-carrier
            // is rb.x/y by convention here regardless of pitch/keep).
            if (runT > 0.72 && Math.hypot(rb.x - dd.x, rb.y - dd.y) < 26) {
              dd.pose = "tackled";
              dd.t = Math.min(1, (runT - 0.72) / 0.28);
            }
            return dd;
          }
        }
        if (i < 4) {
          // DL paired with OL — held up at the LOS. The "winning" DL pushes through.
          const wobble = Math.sin(tt * Math.PI * 4 + d.y * 0.09) * 1.3;
          if (i === dlBreaksFree && tt > 0.3) {
            // This DL penetrates and chases the carrier (speed-capped)
            const elapsedMs = Math.max(0, (t - (PRE + (1 - PRE) * 0.3)) * dur);
            const np = pursue(d, rb.x + dir * 2, rb.y, elapsedMs, 0.85);
            dd.x = np.x; dd.y = np.y;
            dd.pose = "run";
            dd.t = np.moved ? (t * 3) % 1 : 0;
          } else {
            // Stuck at LOS — hold position with jitter. Old code moved
            // the DL by -dir*tt*4 which (despite the "pushed back"
            // comment) was actually moving them TOWARD the offense's
            // home — combined with the OL also moving toward the DL,
            // the bodies crossed straight through each other. Now both
            // sides hold their initial line and engage at the LOS.
            dd.x = d.x + Math.sin(tt * Math.PI * 6 + i * 0.4) * 1.5;
            dd.y = d.y + wobble;
            dd.pose = "engage";
            dd.t = tt;
          }
          dd.facing = -dir;
          return dd;
        }
        // LBs (4-6), CBs (7-8), Safeties (9-10) — pursue with imperfect angles.
        // Each defender targets a point slightly OFF the carrier (lane discipline)
        // and reacts on a small delay so they don't laser-lock. The "dodged"
        // defender keeps the PRE-MOVE rb position as their target — so when the
        // carrier cuts they shoot past where the carrier WAS.
        const lane = ((i - 4) % 5) - 2;
        const reactDelay = 0.04 + ((i * 13) % 8) / 100;  // 40-110 ms reaction lag
        const isDodged = i === dodgeIdx && rbLateral !== 0;
        // TRUCK STICK — the targeted defender gets bowled over (ragdolled)
        const isTrucked = i === dodgeIdx && rbPose === "truck";
        const txBase = isDodged
          ? rb.x + dir * 4                              // overshoots toward old line
          : rb.x + dir * (4 + ((i - 4) % 3) * 3);
        const tyBase = isDodged
          ? (rb.y - rbLateral) + lane * 8               // chases stale position
          : rb.y + lane * 8;
        const elapsedMs = Math.max(0, (t - PRE - reactDelay) * dur);
        // Pursuit speed: DBs slightly faster than LBs; ELUSIVE backs leave LBs behind
        const carrierFast = (rbArch === "SPEED" || rbArch === "ELUSIVE") ? 0.92 : 1.0;
        const factor = (i >= idxCB1 ? 1.02 : (i === idxS1 || i === idxS2 ? 1.0 : 0.92)) * carrierFast;
        const np = elapsedMs > 0 ? pursue(d, txBase, tyBase, elapsedMs, factor) : { x: d.x, y: d.y, moved: false };
        dd.x = np.x; dd.y = np.y;
        if (isTrucked) {
          // Trucked defender ragdolls — anchor to carrier position and fall
          dd.x = rb.x + dir * 6;
          dd.y = rb.y + 2;
          dd.pose = "tackled";
          // Fall progress over the truck window (cruise 0.34-0.52)
          const truckT = Math.min(1, Math.max(0, (runT - 0.34) / 0.20));
          dd.t = truckT;
        } else {
          dd.pose = "run";
          // Freeze the leg cycle when the defender hasn't translated this
          // frame — caught up to the carrier / target isn't moving. Old
          // code kept the run-cycle going regardless, so a stationary
          // defender looked like they were sprinting in place.
          dd.t = np.moved ? (t * 3 + i * 0.13) % 1 : 0;
        }
        // Face the CARRIER, not just -dir. With -dir, a defender chasing
        // a runner laterally always faced the LOS (toward the endzone),
        // even when sprinting sideways. Now they turn to face where the
        // ball actually is. Fallback to -dir when carrier is at the same
        // x as defender (lateral-only chase moment).
        dd.facing = (rb.x > dd.x) ? 1 : (rb.x < dd.x ? -1 : -dir);
        // Tackle pose — variety. PRIMARY tackler drives in (hit) or dives
        // (big-hit dive); pile-on defenders RAGDOLL with physics; the
        // DODGED defender (juked) flies past in a missed-dive pose.
        if (!isTrucked && yards < 90 && tt > 0.72 && Math.hypot(rb.x - dd.x, rb.y - dd.y) < 28) {
          if (i === primaryTacklerIdx) {
            dd.pose = primaryTacklerDives ? "dive" : "hit";
            dd.t = Math.min(1, (tt - 0.72) / 0.28);
          } else {
            // Pile-on defender — collapses ON the pile, doesn't ricochet.
            // Hit vector aims slightly TOWARD the carrier so the
            // defender falls inward, not outward. Tiny lateral jitter
            // per defender so they don't all land in the same spot.
            const nowMs = t * dur;
            if (!d._ragdoll) {
              const inX = -Math.sign((dd.x - rb.x) || 1) * 0.4;   // toward carrier
              const inY = -Math.sign((dd.y - rb.y) || 1) * 0.4;
              const jitter = ((tacklerHash + i * 17) % 7) - 3;
              const hvx = inX + jitter * 0.1;
              const hvy = inY + ((i * 13) % 7 - 3) * 0.1;
              initRagdoll(d, hvx, hvy, 35 + (i * 5 % 25), nowMs, tacklerHash + i * 7);
            }
            stepRagdoll(d, nowMs, 8);   // groundDy ~= 8 below body origin
            dd._ragdoll = d._ragdoll;   // expose state to renderer via style
            dd.pose = "ragdoll";
          }
        } else if (isDodged && tt > 0.34 && tt < 0.58) {
          // Juked defender dives at the carrier's PRE-move position and
          // misses. Lands flat after the dive arc completes.
          dd.pose = "dive";
          dd.t = Math.min(1, (tt - 0.34) / 0.24);
        }
        return dd;
      });
      // OL fire out and engage DL at the LOS
      const off = formation.offense.filter(p => p.role !== "RB").map((p, idx) => {
        // Pre-snap motion for the chosen player
        if (hasMotion && t < PRE) {
          const isMotion = (motionRole === "wr1" && p === formation.wr1)
                        || (motionRole === "wr2" && p === formation.wr2)
                        || (motionRole === "te" && p === formation.te);
          if (isMotion) {
            const yOff = motionYOffset(t);
            const moving = isInMotionNow(t);
            // Retreat behind the QB during active motion so the path runs
            // BEHIND the line, not through it. WRs are placed at losX
            // (right on the LOS) — without this offset, motion drags the
            // player across the offensive line at OL depth, visually
            // clipping through the linemen. Real NFL motion goes behind
            // both the OL (-dir*2) and the QB (-dir*6).
            const xOff = moving ? -dir * 10 : 0;
            return { ...p, x: p.x + xOff, y: p.y + yOff,
                     pose: moving ? "run" : "stance",
                     t: (t * 3) % 1, facing: dir };
          }
        }
        if (t < PRE) return { ...p, pose: "stance" };
        const tt = runT;
        if (p.role === "OL") {
          // Blocking pattern by runType. Slot is the OL's lateral seat
          // (-2 leftmost guard ... +2 rightmost). Defines who pulls,
          // who reaches, etc.
          const slot = (p.y - cy) / 14;
          const wobble = Math.sin(tt * Math.PI * 5 + slot * 1.7) * 1.5;
          const rt = play.runType || "inside";
          // counter: ONE guard (opposite the play side) pulls across to
          //   lead the carrier into the cutback gap. Other OL fire fwd.
          // stretch: ALL OL flow lateral toward the play side ("zone
          //   step") — synchronous slide before engaging.
          // pitch: outside OL on the play side reaches out toward the
          //   sideline; backside OL drives forward.
          // inside (default): straight-ahead drive.
          let driveX = dir * Math.min(tt * 6, 3);
          let driveY = 0;
          if (rt === "counter") {
            const pullSlot = -_counterSide * 1;     // guard opposite play side pulls
            const isPuller = Math.round(slot) === pullSlot;
            if (isPuller) {
              // Pull across the formation in the play-side direction
              const pullT = Math.min(1, tt * 1.7);
              driveX = dir * 1.5;
              driveY = _counterSide * pullT * 18;
            }
          } else if (rt === "stretch") {
            // Whole line flows toward the play side before engagement
            const flowT = Math.min(1, tt * 1.4);
            driveX = dir * Math.min(tt * 3.5, 2);
            driveY = _stretchSide * flowT * 5;
          } else if (rt === "pitch") {
            const isPlaySideOuter = Math.sign(slot) === Math.sign(_pitchSide) && Math.abs(slot) >= 1.5;
            if (isPlaySideOuter) {
              const reachT = Math.min(1, tt * 1.6);
              driveX = dir * 1.0;
              driveY = _pitchSide * reachT * 12;
            }
          }
          return { ...p, x: p.x + driveX, y: p.y + wobble + driveY, pose: "engage", t: tt, facing: dir };
        }
        if (p.role === "TE") {
          // TE seals the edge — engage a defender to the side, doesn't run free
          return { ...p, x: p.x + dir * tt * 12, y: p.y - dir * tt * 6, pose: "engage", t: tt, facing: dir };
        }
        if (p.role === "FB") {
          // FB lead-block: sprint forward to the 2nd level (LB area) and engage.
          // Travels roughly 7-10 yds forward in the first half of the play,
          // then engages a linebacker. Slight inside cut to seal the gap.
          const fbProg = Math.min(1, tt / 0.55);
          const fbXJump = 9 * FIELD.PX_PER_YARD * fbProg;
          const fbYMerge = (cy - p.y) * 0.35 * fbProg;
          const fbPose = tt < 0.50 ? "run" : "engage";
          return { ...p, x: p.x + dir * fbXJump, y: p.y + fbYMerge,
                   pose: fbPose, t: fbPose === "run" ? (t * 3) % 1 : tt, facing: dir };
        }
        // WRs RUN-BLOCK on run plays — sprint at their CB then drive-block.
        // First ~30% of the play they release straight downfield, then they
        // close on the nearest CB and adopt the "engage" pose. The TE handles
        // its edge block above; here we only deal with wide receivers.
        if (p.role === "WR1" || p.role === "WR2" || p.role === "WR3" || p.role === "WR4" || p.role === "WR5") {
          // Find the closest CB on the same side of the field
          const sameSide = (def && def.length) ? def.filter(d => Math.sign(d.y - cy) === Math.sign(p.y - cy) && (d.role === "CB" || d.role === "NB" || d.role === "DB")) : [];
          // Fallback target — sprint downfield if no CB found
          let tgtX = p.x + dir * 18, tgtY = p.y;
          if (sameSide.length) {
            // Pick the nearest CB
            const tgt = sameSide.reduce((best, d) => {
              const dist = Math.hypot(d.x - p.x, d.y - p.y);
              return (best == null || dist < best.dist) ? { d, dist } : best;
            }, null);
            if (tgt) { tgtX = tgt.d.x - dir * 4; tgtY = tgt.d.y; }
          }
          // Release downfield first, then close on the CB
          const releaseT = Math.min(1, tt / 0.30);
          const closeT   = Math.max(0, (tt - 0.30) / 0.70);
          const baseX = p.x + (tgtX - p.x) * Math.min(1, releaseT * 0.45 + closeT * 0.85);
          const baseY = p.y + (tgtY - p.y) * Math.min(1, closeT * 0.85);
          const isEngaged = tt > 0.35;
          return { ...p, x: baseX, y: baseY,
                   pose: isEngaged ? "engage" : "run",
                   t: isEngaged ? closeT : (t * 3 + 0.5) % 1,
                   facing: dir };
        }
        // WRs release downfield (run block on screens/runs) — fallback for any
        // role string we didn't catch above.
        return { ...p, x: p.x + dir * tt * 14, pose: "run", t: (t * 3 + 0.5) % 1, facing: dir };
      });
      // For scrambles / option keepers the QB is the actual ball carrier — so
      // we render the QB sprite at the carrier position with the carrier pose,
      // and the RB sits in the backfield as a check-down blocker.
      let off2;
      let carrierToDraw;
      if (isQBCarry) {
        const qbCarrier = {
          ...formation.qb,
          x: rb.x, y: rb.y,
          pose: rbPose, t: rbT, facing: dir,
        };
        off2 = off.map(p => p.role === "QB" ? qbCarrier : p);
        // Real RB — on a speed option KEEP, the RB sprints alongside as
        // a live pitch threat. On other QB-carry plays, he sits in the
        // backfield as a check-down blocker.
        carrierToDraw = (optRbX !== null)
          ? { ...formation.rb, x: optRbX, y: optRbY,
              pose: "run", t: (t * 3) % 1, facing: dir }
          : { ...formation.rb,
              x: formation.rb.x + dir * Math.min(8, runT * 18),
              y: formation.rb.y - dir * Math.min(0, runT * 4),
              pose: t < PRE ? "idle" : "block",
              t: runT,
              facing: dir };
      } else {
        // Standard handoff: QB stays in stance pre-snap (auto-stance via "idle"),
        // briefly does a handoff motion right after the snap, then idles.
        // For a speed-option PITCH, the QB sprite actively sprints to the
        // option side, then peels off after the pitch — driven by optQbX/Y.
        off2 = off.map(p => {
          if (p.role !== "QB") return p;
          if (optQbX !== null) {
            return { ...p, x: optQbX, y: optQbY,
                     pose: "run", t: (t * 3) % 1, facing: dir };
          }
          const handoffPose = t < PRE
            ? "idle"                                  // stance pre-snap
            : (t < PRE + (1 - PRE) * 0.10 ? "throw"  // brief handoff motion
            : "idle");                                // back to neutral after
          return { ...p, pose: handoffPose, t, facing: dir };
        });
        carrierToDraw = rb;
      }
      drawPlayers([...off2, carrierToDraw], def);
      // RUN TRAIL — dotted breadcrumbs from the LOS to the current ball
      // position. Only after the snap-and-handoff phase so it doesn't
      // smear out from the center pre-snap.
      if (runT > 0.10 && typeof drawRunTrail === "function") {
        const teamColor = (poss === "home" ? gameResult?.homeTeam : gameResult?.awayTeam)?.primary || "#f5c542";
        // Convert hex team color to rgba for the trail; fall back to gold
        const rgba = (() => {
          if (!teamColor || teamColor[0] !== "#" || teamColor.length !== 7) return "rgba(245,197,66,0.55)";
          const r = parseInt(teamColor.slice(1,3),16), g = parseInt(teamColor.slice(3,5),16), b = parseInt(teamColor.slice(5,7),16);
          return `rgba(${r},${g},${b},0.55)`;
        })();
        drawRunTrail(ctx, centerX, cy, ballX, ballY, runT, rgba);
      }
      drawBall(ctx, ballX, ballY);
      // SPEED OPTION banner — shows the play call. Once the read fires
      // (after PITCH_T), a secondary line shows whether the QB made the
      // RIGHT or WRONG read of the edge defender's commit.
      if (play.isSpeedOption && runT > 0 && runT < 0.55) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 22px sans-serif";
        const opt = play.optionRead;
        const showRead = opt && runT > 0.30;
        const bannerH = showRead ? 48 : 30;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(FIELD.W/2 - 150, 8, 300, bannerH);
        ctx.fillStyle = "#ffd54d";
        ctx.fillText(play.isPitch ? "SPEED OPTION — PITCH" : "SPEED OPTION — KEEP", FIELD.W / 2, 23);
        if (showRead) {
          ctx.font = "bold 12px sans-serif";
          ctx.fillStyle = opt.goesCorrect ? "#86d56d" : "#e87878";
          const defLabel = opt.defAttacksQb ? "EDGE ATTACKED QB" : "EDGE PLAYED PITCH";
          const readLabel = opt.goesCorrect ? "RIGHT READ" : "WRONG READ";
          ctx.fillText(`${defLabel} · ${readLabel}`, FIELD.W / 2, 42);
        }
        ctx.restore();
      }
      // REVERSE banner — shows for the first 30% of action so viewers see it's a trick
      if (play.isReverse && runT < 0.55) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 24px sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(FIELD.W/2 - 120, 8, 240, 32);
        ctx.fillStyle = "#ffd54d";
        ctx.fillText("🔄 REVERSE", FIELD.W / 2, 24);
        ctx.restore();
      }
      // Big bold callout for jukes / spins / trucks / stiff arms / hurdles
      if (moveCallout) {
        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "900 24px sans-serif";
        const lblX = rb.x + dir * 16;
        const lblY = rb.y - 22;
        // Outline for legibility on any field background
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(moveCallout, lblX, lblY);
        ctx.fillStyle = "#f0cc30";
        ctx.fillText(moveCallout, lblX, lblY);
        ctx.restore();
      }
      // TD CELEBRATION BANNER — pulses in the end zone once the carrier
      // crosses the goal line.
      if (isTD && runT > 0.72) {
        const cT = Math.min(1, (runT - 0.72) / 0.28);
        const pulse = 1 + Math.sin(cT * Math.PI * 8) * 0.04;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(FIELD.W/2 - 220, FIELD.H/2 - 38, 440, 76);
        ctx.font = `900 ${Math.round(56 * pulse)}px sans-serif`;
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText("TOUCHDOWN!", FIELD.W / 2, FIELD.H / 2);
        ctx.fillStyle = "#ffd54d";
        ctx.fillText("TOUCHDOWN!", FIELD.W / 2, FIELD.H / 2);
        ctx.restore();
      }
      drawPreSnapCallouts(ctx, t, dur);
    }};
  }

  if (play.kind === "spike") {
    // Quick spike-the-ball play. Total duration ~1.6s: pre-snap → snap →
    // QB spikes ball into the ground → ball bounces → CLOCK STOPPED banner.
    const actionDur = 1100;
    const dur = actionDur + PRE_MS;
    PRE = PRE_MS / dur;
    const centerX = losX - dir * 2;
    return { duration: dur, kind: "spike", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      const qb = { ...formation.qb };
      const aT = t < PRE ? 0 : (t - PRE) / (1 - PRE);
      // Action phases:
      //   0.00 - 0.05  ball snap (C → QB)
      //   0.05 - 0.45  QB cocks the spike (arm raises briefly)
      //   0.45 - 0.55  QB spikes — ball goes from QB hand to ground
      //   0.55 - 1.00  ball bounces in front of the QB, settles
      let ballX = centerX, ballY = cy;
      let qbPose = "idle", qbT = 0;
      if (t < PRE) {
        qbPose = "idle";
      } else if (aT < 0.05) {
        // Snap travel
        const s = aT / 0.05;
        ballX = centerX + (qb.x - centerX) * s;
        ballY = cy;
        qbPose = "idle";
      } else if (aT < 0.45) {
        // Cock
        ballX = qb.x;
        ballY = cy - 6;
        qbPose = "throw";
        qbT = (aT - 0.05) / 0.40 * 0.40;          // run throw pose up to its cock peak (~0.40)
      } else if (aT < 0.55) {
        // Spike — ball drops from QB hand height down to the ground
        const s = (aT - 0.45) / 0.10;
        ballX = qb.x + dir * 4;
        ballY = (cy - 14) + (cy + 4 - (cy - 14)) * s;  // hand height → ground
        qbPose = "throw";
        qbT = 0.55 + s * 0.20;                     // through release portion
      } else {
        // Ball bounces, settles in front of QB. Bounce decays.
        const s = (aT - 0.55) / 0.45;
        ballX = qb.x + dir * (4 + s * 4);
        const bounce = Math.abs(Math.sin(s * Math.PI * 2)) * 6 * (1 - s);
        ballY = cy + 4 - bounce;
        qbPose = "idle";
      }
      // Build a minimal offense + defense — everyone stays in stance.
      // (No real play happens, so no need for line-engagement animations.)
      const off = [
        ...formation.offense.filter(p => p.role !== "QB" && p.role !== "RB"),
        { ...formation.rb, pose: "stance", t: 0, facing: dir },
        { ...formation.qb, pose: qbPose, t: qbT, facing: dir },
      ];
      const def = formation.defense.map((d, i) => ({
        ...d, pose: "stance", t: (t * 3) % 1, facing: -dir,
      }));
      drawPlayers(off, def);
      drawBall(ctx, ballX, ballY);
      // Banner: "SPIKE — CLOCK STOPPED!" once the ball hits the ground.
      if (aT >= 0.55) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 22px sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(FIELD.W/2 - 140, 8, 280, 30);
        ctx.fillStyle = "#ffd54d";
        ctx.fillText("SPIKE — CLOCK STOPPED", FIELD.W / 2, 23);
        ctx.restore();
      }
      drawPreSnapCallouts(ctx, t, dur);
    }};
  }

  if (play.kind === "complete" || play.kind === "incomplete" || play.kind === "int") {
    const isScreen = !!play.isScreen;
    // The catch can't happen past the goal line — otherwise the WR catches
    // it past the back of the endzone, then "runs back" to score, which
    // looks ridiculous. Cap catchDepth at distance to the goal.
    const rawCatchDepth = play.catchDepth ?? play.targetDepth ?? 10;
    const catchDepth = Math.min(rawCatchDepth, 100 - play.startYard - 0.5);
    const targetX = losX + dir * catchDepth * FIELD.PX_PER_YARD;
    // Incomplete subtypes — the ball lands somewhere DIFFERENT from the
    // intended target, telling the viewer WHY it was incomplete:
    //   overthrown    → ball sails past receiver (offsetX forward, offsetY up)
    //   underthrown   → ball lands short (offsetX backward, offsetY down)
    //   throwaway     → ball goes WAY off to the sideline
    //   batted        → ball stops near the LOS, drops fast
    //   offtarget     → ball lands a few yards off to the side
    let incOffsetX = 0, incOffsetY = 0, incArcMul = 1.0, incDropFast = false;
    if (play.kind === "incomplete" && play.incReason) {
      const r = play.incReason;
      const sideSign = ((play.startYard * 23) >>> 0) % 2 === 0 ? 1 : -1;
      if (r === "overthrown") {
        incOffsetX = dir * 50;
        incOffsetY = -8;       // ball stays high — overshoot
        incArcMul = 1.20;      // bigger arc
      } else if (r === "underthrown") {
        incOffsetX = -dir * 40;
        incOffsetY = 12;
        incArcMul = 0.75;      // shorter arc
      } else if (r === "throwaway") {
        // Lateral throw to the sideline near the LOS — straight out of bounds
        incOffsetX = -dir * 10;
        incOffsetY = sideSign * 220;
        incArcMul = 0.55;
      } else if (r === "batted") {
        // Stopped at the LOS — ball drops short and fast
        incOffsetX = -dir * (catchDepth * FIELD.PX_PER_YARD - FIELD.PX_PER_YARD * 1.5);
        incOffsetY = 0;
        incArcMul = 0.25;
        incDropFast = true;
      } else if (r === "offtarget") {
        incOffsetX = dir * 15;
        incOffsetY = sideSign * 30;
        incArcMul = 1.0;
      }
    }
    // Pick receiver lane deterministically per play (screens always go to the RB)
    const wrRoll = ((play.startYard * 13 + (play.time||0)) >>> 0) % 100 / 100;
    const wrChoice = isScreen ? "rb"
                   : wrRoll < 0.45 ? "wr1"
                   : wrRoll < 0.78 ? "wr2"
                   : wrRoll < 0.92 ? "te"
                   :                  "rb";
    // Screen RB releases to the strong-side flat; normal receivers run their lane
    const screenSide = ((play.startYard * 17) >>> 0) % 2 ? 1 : -1;
    const targetY = isScreen ? cy + screenSide * 50
                  : wrChoice === "wr1" ? cy - 70
                  : wrChoice === "wr2" ? cy + 65
                  : wrChoice === "te"  ? cy + 28
                  :                       cy - 10;
    const isComplete = play.kind === "complete";
    const endX = isComplete ? yardToAbsX(play.endYard, poss) : targetX;
    // Which defender picks off the pass on an INT — match the receiver's side
    // 7=cb1 (top), 8=cb2 (bottom), 9=s1 (top safety), 10=s2 (bottom safety)
    const intDefIdx = wrChoice === "wr1" ? idxCB1
                    : wrChoice === "wr2" ? idxCB2
                    : wrChoice === "te"  ? (targetY < cy ? idxS1 : idxS2)
                    :                       (targetY < cy ? idxLB3 : idxLB1);  // LB for RB checkdown
    const yac = isComplete ? (play.yac ?? Math.max(0, (play.yards ?? 0) - catchDepth)) : 0;
    // Final Y where YAC ends — receiver may drift back toward middle if running upfield
    const finalY = targetY + (cy - targetY) * Math.min(0.5, yac / 40);
    // Pass plays — base duration covers drop + ball flight. Tack on
    // POST_CATCH time for YAC + tackle so the play doesn't end the
    // instant the receiver catches it.
    //
    // SCREEN bug: previously basePass used max(targetDepth, yards, 8)
    // which on a 40-yd screen allocated 5.1s of "flight" for a 2-yd
    // toss behind the LOS, plus a fixed 1.7s POST_CATCH meant the RB
    // had to cover 40 yards in 1.5s. Ball appeared to crawl, then RB
    // teleported downfield. Fix: screens use a SHORT ball flight
    // (~5 yd) and POST_CATCH scaled to actual YAC distance so the
    // post-catch run gets proportional time.
    const passYards = (play.yards ?? 0) + ((play.targetDepth ?? 0) > (play.yards ?? 0) ? 0 : 0);
    const basePass  = isScreen
      ? scaledDuration(5)
      : scaledDuration(Math.max(play.targetDepth ?? 0, play.yards ?? 0, 8));
    // Receiving TDs get extra post-catch time for the celebration banner.
    const isPassTD = play.kind === "complete" && (play.endYard ?? 0) >= 100;
    const screenYacMs = isScreen ? scaledDuration(Math.abs(play.yards || 0)) + 600 : 0;
    const POST_CATCH_MS = isPassTD                  ? Math.max(2400, screenYacMs + 600)
                        : isScreen && play.kind === "complete"  ? screenYacMs
                        : play.kind === "complete"  ? 1700
                        : play.kind === "int"       ? 1500
                        : play.kind === "incomplete" ? 600
                        : 1000;
    const actionDur = basePass + POST_CATCH_MS;
    const dur = actionDur + PRE_MS;
    PRE = PRE_MS / dur;
    return { duration: dur, kind: play.kind, render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      // dropPhase / throwPhase are absolute t values within the full play.
      // The throwPhase now corresponds to the END of the pre-catch portion;
      // remaining action time is YAC + tackle.
      // Use the natural basePass/actionDur ratio for everything. The old
      // hardcoded `throwFrac = 0.78` for screens compounded the basePass
      // bug — it told the play that 78% of action was pre-catch even
      // when basePass was reduced for screens, leaving only 22% for the
      // RB to cover all the YAC.
      const dropFrac  = (basePass * 0.42) / actionDur;
      const throwFrac = basePass / actionDur;
      const dropPhase  = PRE + (1 - PRE) * dropFrac;
      const throwPhase = PRE + (1 - PRE) * throwFrac;
      // ACTION-relative time — 0 at snap, 1 at end of play. Use this for any
      // post-snap movement so nobody moves during the pre-snap window.
      // aTRaw is true action time from snap. For flea flickers we delay all of
      // the normal pass-play flow by FLICKER_END so aT (used everywhere else)
      // is the time AFTER the trick has played out.
      const FLICKER_END = 0.25;
      const aTRaw = Math.max(0, (t - PRE) / (1 - PRE));
      const aT = play.isFleaFlicker
        ? Math.max(0, (aTRaw - FLICKER_END) / (1 - FLICKER_END))
        : aTRaw;
      const qb = { ...formation.qb };
      let ballX, ballY = cy;
      let arc = 0;
      // Default ball orientation. Set to the velocity vector during the
      // FLIGHT phase below so the football points where it's going
      // (visible spiral / nose-forward), not stuck in a fixed tilt.
      let ballAngle = -0.35;

      const dropDepth = isScreen ? 2 : 5;
      const dropAmt = aT > 0
        ? Math.min(1, aT / dropFrac) * dropDepth * FIELD.PX_PER_YARD
        : 0;
      qb.x -= dir * dropAmt;
      // FLEA FLICKER — during the trick phase the QB shuffles slightly back
      // and pretends to hand off, then catches the pitch back.
      if (play.isFleaFlicker && aTRaw < FLICKER_END) {
        const fT = aTRaw / FLICKER_END;
        qb.x -= dir * fT * 3 * FIELD.PX_PER_YARD;   // small backward shuffle
        qb.y = cy + Math.sin(fT * Math.PI * 0.5) * 4;   // slight body turn toward RB
      }
      // PLAY-ACTION fake — only during the early action portion (post-snap).
      // Skip if this is a flea flicker — the trick play has its own fake.
      if (play.isPlayAction && !play.isFleaFlicker && aT > 0 && aT < dropFrac * 0.65) {
        const paT = aT / (dropFrac * 0.65);
        const fakeBack = Math.sin(paT * Math.PI) * 6;
        qb.x += dir * fakeBack;
        qb.y = cy + fakeBack;
      }
      // THROW ON THE RUN — QB drifts laterally before/during the throw
      if (play.isTOR && aT > 0) {
        const torT = Math.min(1, aT / throwFrac);
        const lateral = Math.sin(torT * Math.PI * 0.7) * 36;
        qb.y += lateral * (targetY < cy ? -1 : 1);
        qb.x -= dir * 4 * torT;
      }
      // POCKET PRESENCE — composed, high-AWR QBs visibly STEP UP in the
      // pocket and slide off the closing rusher to buy time. Magnitude
      // scales directly with AWR so the on-screen movement matches the
      // sim's qbPocketBonus / qbAwrSackMul advantages a smart QB enjoys:
      //   AWR 65 → 0 yds step (statue, takes the hit)
      //   AWR 80 → ~1.0 yd step + tiny lateral slide
      //   AWR 95 → ~1.8 yd step + visible slide to avoid the rusher
      // Skip on throw-on-the-run (already moving) and flea flicker (handoff
      // animation), and only during the window when the rusher is closing.
      if (!play.isTOR && !play.isFleaFlicker && aT > 0.30 && aT < throwFrac + 0.05) {
        const pocketFactor = clamp((qbAwr - 65) / 30, 0, 1);
        if (pocketFactor > 0.02) {
          const stepWindow = clamp((aT - 0.30) / 0.32, 0, 1);
          const sm = stepWindow * stepWindow * (3 - 2 * stepWindow);
          // Step-up (forward, toward the LOS) — buys time by stepping into
          // the pocket lane the OL has cleared
          qb.x += dir * sm * pocketFactor * 1.8 * FIELD.PX_PER_YARD;
          // Lateral micro-slide — only kicks in for AWR > 78. Direction
          // is deterministic per play so the QB doesn't shimmy randomly.
          const slideFactor = clamp((qbAwr - 78) / 17, 0, 1);
          if (slideFactor > 0) {
            const slideSeed = (((play.startYard * 13) ^ ((play.time || 0) * 5)) >>> 0) & 1;
            const slideDir  = slideSeed ? 1 : -1;
            qb.y += slideDir * sm * slideFactor * 0.55 * FIELD.PX_PER_YARD;
          }
        }
      }

      // Receiver runs route — starts AT the snap, reaches catch point by throwPhase
      const wrBase = wrChoice === "wr1" ? formation.wr1
                   : wrChoice === "wr2" ? formation.wr2
                   : wrChoice === "te"  ? formation.te
                   :                       formation.rb;
      const wr = { ...wrBase };
      // Route progression: 0 → 1 from snap to throwPhase (action-relative)
      const routeT = aT > 0 ? Math.min(1, aT / throwFrac) : 0;
      const wrPathX0 = wrBase.x;
      const wrPathY0 = wrBase.y;
      // Route SHAPE varies by play.concept. Old code was a single linear
      // lerp from start to target regardless of concept — every route
      // looked the same. Now each concept has a 2-segment path through
      // a CONTROL POINT, so slants break diagonally inside, digs go
      // straight then 90° break, drags run shallow + lateral, etc.
      // All concepts still end at (targetX, targetY) so the ball lands
      // where it should.
      const _conc = play.concept || "VERTICAL";
      // Control point as fraction of (path depth, path lateral) — defines
      // where the receiver is at the BREAK point of the route.
      const ctrl =
            _conc === "QUICK_GAME"   ? { breakT: 0.30, depthF: 0.40, latF: 0.0 }   // slant: 4-step then break IN
          : _conc === "DRAG_MESH"    ? { breakT: 0.30, depthF: 0.20, latF: -0.5 }  // shallow + cross toward midfield
          : _conc === "INTERMEDIATE" ? { breakT: 0.72, depthF: 1.0,  latF: 0.0 }   // vertical stem, sharp break
          : _conc === "VERTICAL"     ? { breakT: 0.95, depthF: 0.95, latF: 0.0 }   // straight line
          : _conc === "PA_SHOT"      ? { breakT: 0.95, depthF: 0.95, latF: 0.0 }
          : _conc === "SCREEN"       ? null
          :                            { breakT: 0.95, depthF: 0.95, latF: 0.0 };
      if (ctrl) {
        const midX = wrPathX0 + (targetX - wrPathX0) * ctrl.depthF;
        // latF interpolates between (start Y = 0) and (cy = 1, midfield).
        const midY = wrPathY0 + (cy - wrPathY0) * ctrl.latF;
        if (routeT < ctrl.breakT) {
          const p = routeT / ctrl.breakT;
          wr.x = wrPathX0 + (midX - wrPathX0) * p;
          wr.y = wrPathY0 + (midY - wrPathY0) * p;
        } else {
          const p = (routeT - ctrl.breakT) / (1 - ctrl.breakT);
          wr.x = midX + (targetX - midX) * p;
          wr.y = midY + (targetY - midY) * p;
        }
      } else {
        // SCREEN — keep the existing linear handling
        wr.x = wrPathX0 + (targetX - wrPathX0) * routeT;
        wr.y = wrPathY0 + (targetY - wrPathY0) * routeT;
      }

      // Throw style — TOUCH lobs high+slow, ZIP fires low+fast, DEEP arcs even higher
      const throwType = play.throwType || (isScreen ? "CHECKDOWN" : "TOUCH");
      const arcHeight = isScreen ? 12
                      : throwType === "ZIP"       ? 18
                      : throwType === "CHECKDOWN" ? 22
                      : throwType === "DEEP"      ? 95
                      : 55;  // TOUCH default
      // ZIP throws compress the throw window so the ball arrives faster
      const flightCurve = throwType === "ZIP" ? (x => x * x) : (x => x);
      // Action time and key moments (all 0-1 within action portion).
      // These align with the QB pose timeline above — all scaled by throwFrac
      // so hands and ball stay synced when the catch happens earlier in action.
      // Use the flicker-aware aT so ball/QB phases stay synced when flea
      // flicker delays the normal throw flow.
      const at = aT;
      const snapMotionAT = 0.04;             // ball travels C→QB in first 4% of action
      const dropEndAT  = throwFrac * 0.29;   // dropback ends here
      const cockHoldAT = throwFrac * 0.65;   // ball reaches the ear, "held cocked"
      const releaseAT  = throwFrac * 0.73;   // ball leaves the hand
      const throwEndAT = throwFrac;          // ball arrives at WR
      // Ball-in-hand positions
      const releaseX = qb.x + dir * 1.5;
      const releaseY = cy - 14;
      const cradleX = qb.x;
      const cradleY = cy - 3;
      // Center position (front of OL) — where the ball is pre-snap
      const centerX = losX - dir * 2;
      const centerY = cy;
      // RB position during the flea flicker — runs forward, pivots, pitches back
      const rbBase = formation.rb;
      const rbForwardMax = rbBase.x + dir * 5 * FIELD.PX_PER_YARD;
      let flickerRBX = rbBase.x, flickerRBY = rbBase.y;
      if (play.isFleaFlicker && aTRaw < FLICKER_END) {
        const fT = aTRaw / FLICKER_END;
        if (fT < 0.40) {
          // RB sprints toward the LOS
          const p = fT / 0.40;
          flickerRBX = rbBase.x + (rbForwardMax - rbBase.x) * p;
          flickerRBY = cy;
        } else if (fT < 0.60) {
          // RB plants at max forward, pivots
          flickerRBX = rbForwardMax;
          flickerRBY = cy;
        } else {
          // RB stays as a decoy
          flickerRBX = rbForwardMax;
          flickerRBY = cy;
        }
      }
      if (t < PRE) {
        // Pre-snap: ball sits in the center's hands, ready to be snapped
        ballX = centerX; ballY = centerY;
      } else if (play.isFleaFlicker && aTRaw < FLICKER_END) {
        // FLEA FLICKER ball path: C→QB (snap) → QB→RB (handoff) → RB carries
        // forward → RB→QB (pitch back) → QB cradles.
        const fT = aTRaw / FLICKER_END;
        if (fT < 0.08) {
          // Snap from center to QB
          const sm = (fT / 0.08);
          ballX = centerX + (cradleX - centerX) * sm;
          ballY = centerY + (cradleY - centerY) * sm;
        } else if (fT < 0.30) {
          // Handoff: ball travels from QB to RB
          const p = (fT - 0.08) / 0.22;
          const sm = p * p * (3 - 2 * p);
          ballX = cradleX + (flickerRBX - cradleX) * sm;
          ballY = cradleY + (flickerRBY - cradleY) * sm;
        } else if (fT < 0.50) {
          // Ball with RB as he runs forward
          ballX = flickerRBX;
          ballY = flickerRBY - 1;
        } else if (fT < 0.80) {
          // Pitch back: ball travels back from RB to QB
          const p = (fT - 0.50) / 0.30;
          const sm = p * p * (3 - 2 * p);
          ballX = flickerRBX + (cradleX - flickerRBX) * sm;
          // High lateral arc
          ballY = flickerRBY + (cradleY - flickerRBY) * sm - Math.sin(p * Math.PI) * 8;
        } else {
          // QB cradles the pitch
          ballX = cradleX;
          ballY = cradleY;
        }
      } else if (at < snapMotionAT) {
        // SNAP! Ball travels from center back to the QB
        const snapT = at / snapMotionAT;
        const sm = snapT * snapT * (3 - 2 * snapT);
        ballX = centerX + (cradleX - centerX) * sm;
        ballY = centerY + (cradleY - centerY) * sm;
      } else if (at < dropEndAT) {
        // Dropback: ball cradled at chest with both hands
        ballX = cradleX;
        ballY = cradleY;
      } else if (at < cockHoldAT) {
        // COCK: ball rises from chest up-behind-helmet to the cocked ear position
        const cockT = (at - dropEndAT) / (cockHoldAT - dropEndAT);
        const sm = cockT * cockT * (3 - 2 * cockT);
        ballX = cradleX + sm * (releaseX - cradleX);
        ballY = cradleY + sm * (releaseY - cradleY);
      } else if (at < releaseAT) {
        // HOLD AT EAR — ball locked at the cocked position (Brady frame)
        ballX = releaseX;
        ballY = releaseY;
      } else if (at < throwEndAT) {
        // FLIGHT: from cocked hand position out to the target. For
        // incompletes the actual flight target is offset (overthrown
        // sails long, underthrown lands short, throwaway flies OOB,
        // batted barely makes it past the LOS).
        const ttRaw = (at - releaseAT) / (throwEndAT - releaseAT);
        const tt = flightCurve(ttRaw);
        const flightTX = targetX + incOffsetX;
        const flightTY = targetY + incOffsetY;
        ballX = releaseX + (flightTX - releaseX) * tt;
        // Arc lands at HAND/HEAD height, not feet. Original parabola
        // dropped to 0 at catch, so the ball arrived at the receiver's
        // chest. NFL catches are at HAND HEIGHT (above the head), so
        // we add a linear ascent term that ramps the ball UP to ~14px
        // above field-y by tt=1 — matches the receiver's reach-arm
        // tip position. Reduced for batted / underthrown so those land
        // at the right (low) height.
        const handElev = incDropFast ? 0 : (incOffsetY < 0 ? 18 : 14);
        arc = Math.sin(tt * Math.PI) * arcHeight * incArcMul + tt * handElev;
        ballY = releaseY + (flightTY - releaseY) * tt - arc;
        // Spiral orientation — ball nose points along the velocity vector.
        // The flight ball is drawn with its LONG AXIS ALONG Y (ellipse
        // 8x14, ry>rx), so the tip sits at (0, ±ry) before rotation.
        // To align tip with velocity (vx,vy), rotate by atan2(vx, -vy)
        // (not atan2(vy, vx) — that aligned the SHORT axis with velocity,
        // which is why the ball came out sideways).
        const vx = flightTX - releaseX;
        const vy = (flightTY - releaseY) - Math.cos(tt * Math.PI) * Math.PI * arcHeight * incArcMul - handElev;
        ballAngle = Math.atan2(vx, -vy);
      } else {
        const tt = (t - throwPhase) / (1 - throwPhase);
        if (play.kind === "complete") {
          // After catch: ball + receiver travel together to (endX, finalY).
          // For big YAC plays, blend toward LINEAR motion so the receiver
          // doesn't snap forward and stand still — matches the run play fix.
          const yacYds = Math.abs((endX - targetX) / FIELD.PX_PER_YARD);
          const linearW = Math.min(1, Math.max(0, (yacYds - 6) / 18));  // 0 at 6 yds, 1 at 24+
          const eased = easeOutCubic(tt);
          const ramp = tt < 0.10 ? (tt / 0.10) * (tt / 0.10) * 0.10 : tt;
          const progress = eased * (1 - linearW) + ramp * linearW;
          ballX = targetX + (endX - targetX) * progress;
          ballY = targetY + (finalY - targetY) * progress;
          // Receiver carries the ball — keep them locked together
          wr.x = ballX;
          wr.y = ballY;
        } else if (play.kind === "incomplete") {
          // Ball CONTINUES past the catch point on its trajectory, then
          // falls. Previously it stopped at the receiver position and
          // slowly drifted down (25px over the whole post-throw window),
          // which looked like the receiver caught it and dropped it.
          // Now: continues forward AND drops faster, so the ball clearly
          // leaves the catch zone like a real incomplete pass.
          const fallVy = incDropFast ? 90 : 65;
          ballX = targetX + incOffsetX + dir * tt * 35;
          ballY = targetY + incOffsetY + tt * fallVy;
          // Tumbling spiral — ball keeps pointing in its motion direction
          ballAngle = Math.atan2(dir * 35, -fallVy);
        } else {
          // INT — defender catches the ball. Return distance varies:
          // ~55% short (0-2 yds, WR tackles immediately), 30% medium (3-12 yds),
          // 15% long return (13-30 yds, defender gets loose)
          const seed = ((play.startYard * 7 + (play.targetDepth||0)) >>> 0) % 100;
          const retDistYds = seed < 55 ? (seed % 3)
                           : seed < 85 ? 3 + (seed % 10)
                           :             13 + (seed % 18);
          const retEndX = targetX - dir * retDistYds * FIELD.PX_PER_YARD;
          const retEndY = targetY + (targetY < cy ? -10 : 10);
          ballX = targetX + (retEndX - targetX) * easeOutCubic(tt);
          ballY = targetY + (retEndY - targetY) * easeOutCubic(tt);
          // WR converges on the picking defender to make the tackle
          const wrTackleX = ballX + dir * 6;  // WR arrives just in front of defender
          const wrTackleY = ballY + (targetY < cy ? 4 : -4);
          wr.x = targetX + (wrTackleX - targetX) * Math.min(1, tt * 1.4);
          wr.y = targetY + (wrTackleY - targetY) * Math.min(1, tt * 1.4);
        }
      }

      // Defense: rush + DBs cover (and one closes on the ball-carrier post-catch)
      // On a sack/pressure (we don't know that here without checking play.kind), 1 DL breaks through.
      // For incomplete/INT, DL stay engaged with OL.
      const breakingRusher = play.kind === "complete" && (play.yards ?? 0) > 5 ? -1
                           : play.kind === "incomplete" ? -1
                           : 1;  // one rusher breaks through on tight throws/INTs
      const def = formation.defense.map((d, i) => {
        const dd = { ...d };
        dd.t = (t * 3 + i * 0.13) % 1;
        dd.facing = -dir;
        // Pre-snap: hold stance + apply coverage-aware depth alignment.
        // play.coverage was unused beyond the broadcast UI label. Now
        // drives CB / S depth so each coverage VISUALLY differs:
        //   C0_BLITZ:  CBs press (2yd), Ss walked up (5yd)
        //   C1_MAN:    CBs press, 1S deep (14yd) + 1S box (6yd)
        //   C2_ZONE:   CBs at 4yd, both Ss deep wide (12yd)
        //   TAMPA_2:   like C2 but MLB drops post-snap (still 12/4)
        //   C3_ZONE:   CBs off 8yd, 1S deep middle 14yd, 1S 8yd
        //   C4_QUARTERS: CBs deep 10yd, both Ss deep 12yd
        if (t < PRE) {
          const sh = defShiftXY(i, t);
          let dx = sh.dx, dy = sh.dy;
          const cov = play.coverage;
          if (cov && (d.role === "CB" || d.role === "S" || d.role === "NB")) {
            const pxPerYd = FIELD.PX_PER_YARD;
            const baseX = losX;
            const cbDepth =
                  (cov === "C0_BLITZ" || cov === "C1_MAN") ? 2
                : (cov === "C2_ZONE"  || cov === "TAMPA_2") ? 4
                : (cov === "C3_ZONE")     ? 8
                : (cov === "C4_QUARTERS") ? 10
                : null;
            const safDepth = (idxS) => {
              if (cov === "C0_BLITZ") return 5;
              if (cov === "C1_MAN")   return (i === idxS1) ? 14 : 6;
              if (cov === "C2_ZONE" || cov === "TAMPA_2") return 12;
              if (cov === "C3_ZONE")     return (i === idxS1) ? 14 : 8;
              if (cov === "C4_QUARTERS") return 12;
              return null;
            };
            if (d.role === "CB" && cbDepth != null) {
              dx = (baseX + dir * cbDepth * pxPerYd) - d.x;
            } else if (d.role === "S") {
              const depth = safDepth(i);
              if (depth != null) dx = (baseX + dir * depth * pxPerYd) - d.x;
            }
          }
          dd.x = d.x + dx;
          dd.y = d.y + dy;
          dd.pose = isDefShifting(i, t) ? "run" : (isDefPointer(i) ? "point" : "stance");
          return dd;
        }
        dd.pose = "run";
        if (i < 4) {
          // Breaking rusher chases the QB throughout — DON'T cut him off at
          // the throw, or his position snaps back to the original DL spot
          // (the "teleport" bug). Other DL only animate through the rush
          // phase, since they're held up at the LOS and barely move anyway.
          const tt = Math.min(1, aT / 0.55);
          if (i === breakingRusher) {
            // Path shape varies by dlMove — the rusher's PATH to the QB
            // reflects HOW they beat the OL. play.dlMove was sitting
            // unused beyond a text callout; now drives the actual chase
            // geometry. 5 visual categories pulled from the 15 archetype
            // moves.
            const move = play.dlMove || "";
            const moveCat = /SPEED|GET-OFF|GHOST/.test(move) ? "SPEED"
                          : /SWIM|ARM-OVER|CROSS/.test(move)  ? "SWIM"
                          : /SPIN|COUNTER/.test(move)         ? "SPIN"
                          : /DIP|CLUB/.test(move)             ? "DIP"
                          : "BULL";   // bull rush / long arm / stab / pierce / hand fight (default)
            const baseX = d.x + (qb.x - d.x) * tt * 0.85;
            const baseY = d.y + (qb.y - d.y) * tt * 0.6;
            let pathDX = 0, pathDY = 0;
            if (moveCat === "SPEED") {
              // Wide outside arc — peel AWAY from QB lateral first, swing in late.
              const arc = Math.sin(tt * Math.PI);
              const outSide = (d.y > qb.y ? 1 : -1);
              pathDY = outSide * arc * 14;
            } else if (moveCat === "SWIM") {
              // Brief lateral bump during the engagement phase only
              const eng = tt < 0.35 ? Math.sin((tt / 0.35) * Math.PI) : 0;
              pathDY = (d.y > qb.y ? -1 : 1) * eng * 9;
            } else if (moveCat === "SPIN") {
              // Zigzag laterally — spinning past the OL
              pathDY = Math.sin(tt * Math.PI * 2.5) * 7 * (1 - tt * 0.5);
            } else if (moveCat === "DIP") {
              // Lower, tighter line — drops the body and rips through
              pathDY = -Math.sin(tt * Math.PI * 0.8) * 4;
            }
            // BULL: no offset, straight bull-line through the OL
            dd.x = baseX + pathDX;
            dd.y = baseY + pathDY;
            // After release, the rusher arrives in the QB's face and engages
            dd.pose = aT > throwFrac ? "engage" : "run";
          } else if (aT < throwFrac + 0.05) {
            // DL stuck at LOS engaged with OL — hold position with jitter.
            // Old code moved them -dir*4*tt (toward the offense) which
            // crossed straight through the retreating OL. Now both hold
            // the line and look like a real LOS engagement.
            const wobble = Math.sin(tt * Math.PI * 6 + d.y * 0.08) * 1.2;
            dd.x = d.x + wobble * 0.6;
            dd.y = d.y + wobble;
            dd.pose = "engage";
            dd.t = tt;
          }
        }
        // CB / WR interaction varies by coverage. In MAN (C0/C1) the CB
        // follows his WR downfield. In ZONE (C2/C3/C4/TAMPA_2) the CB
        // settles at his zone depth and reads the QB. Was always
        // following WR regardless of coverage, which made man and zone
        // visually indistinguishable.
        if (i >= idxCB1) {
          const tt = Math.min(1, aT / 0.55);
          const cov = play.coverage;
          const isMan = !cov || cov === "C0_BLITZ" || cov === "C1_MAN";
          if (i === idxCB1 || i === idxCB2) {
            if (isMan) {
              dd.x += dir * tt * (catchDepth) * FIELD.PX_PER_YARD * 0.85;
            } else {
              // Zone — small forward bail / read-step only
              dd.x += dir * Math.min(tt * 4, 4);
            }
          }
        }
        if (play.kind === "complete" && t > throwPhase) {
          // Safeties + CBs + key LBs pursue the ball after the catch
          const isCB  = i === idxCB1 || i === idxCB2;
          const isSaf = i === idxS1  || i === idxS2;
          const isLB  = i === idxLB1 || i === idxLBmid;
          if (isCB || isSaf || isLB) {
            const elapsedMs = Math.max(0, (t - throwPhase) * dur);
            const factor = isCB ? 1.05 : isSaf ? 1.0 : 0.95;
            const np = pursue(dd, ballX - dir * 4, ballY, elapsedMs, factor);
            dd.x = np.x; dd.y = np.y;
          }
        }
        // GUARANTEED TACKLER — the assigned coverage defender arrives at the
        // carrier's final position by the tackle window. Without this, big YAC
        // plays would show the WR getting "tackled" by no one (the slow pursue
        // function couldn't close 30+yd gaps before the tackle pose kicked in).
        if (play.kind === "complete" && i === intDefIdx && t > throwPhase) {
          // Where the cover defender was at the catch moment
          const cbStartX = d.x + dir * catchDepth * 0.85 * FIELD.PX_PER_YARD;
          const cbStartY = d.y;
          // Tackle spot — just behind & lateral to the carrier (so the hit is visible)
          const tackleX = endX - dir * 5;
          const tackleY = finalY + 4;
          // Progress from catch → tackle moment
          const tackleStartT = PRE + (1 - PRE) * 0.78;  // matches TACKLE_START_AT
          const arrProgress = clamp((t - throwPhase) / Math.max(0.001, tackleStartT - throwPhase), 0, 1);
          dd.x = cbStartX + (tackleX - cbStartX) * easeOutCubic(arrProgress);
          dd.y = cbStartY + (tackleY - cbStartY) * easeOutCubic(arrProgress);
          dd.pose = arrProgress > 0.92 ? "tackle" : "run";
          dd.facing = -dir;
        }
        // INT — the picking defender races to the catch spot, then carries the ball back
        if (play.kind === "int" && i === intDefIdx) {
          if (t < throwPhase) {
            const tt = Math.min(1, aT / (throwFrac));
            dd.x = d.x + (targetX - d.x) * easeOutCubic(tt);
            dd.y = d.y + (targetY - d.y) * easeOutCubic(tt);
          } else {
            dd.x = ballX;
            dd.y = ballY;
            dd.facing = -dir;
            dd.pose = aT > 0.92 ? "tackled" : "run";
          }
        }
        return dd;
      });

      // QB pose timeline — scaled by throwFrac so the throw motion lines up with
      // when the ball arrives. Sub-phases (in fractions of throwFrac):
      //   0   - 0.29: dropback (run)
      //   0.29 - 0.65: cradle → cock
      //   0.65 - 0.73: hold at cocked ear (Tom Brady frame)
      //   0.73 - 0.85: snap (release ~0.78)
      //   0.85 - 1.00: follow-through
      //   >throwFrac: idle / watching the play
      let qbPose, qbT;
      if (t < PRE) {
        qbPose = "idle";
        qbT = 0;
      } else if (play.isFleaFlicker && aTRaw < FLICKER_END) {
        // FLEA FLICKER QB pose: handoff → watch → reach for pitch → cradle
        const fT = aTRaw / FLICKER_END;
        if (fT < 0.30) {
          qbPose = "throw";   // pretending to hand off
          qbT = fT / 0.30 * 0.18;   // partial throw motion (cradle stage)
        } else if (fT < 0.55) {
          qbPose = "idle";    // empty-handed, watching the RB
          qbT = 0;
        } else if (fT < 0.85) {
          qbPose = "reach";   // arms out for the pitch back
          qbT = 0;
        } else {
          qbPose = "carry";   // got the ball, holding it
          qbT = (t * 3) % 1;
        }
      } else {
        const at = aT;   // flicker-aware action time
        const tf = throwFrac;
        // QB pose timeline (post-rebalance). Old code spent 36% of the throw
        // window in cradle+cock — that was 846ms for a 15-yard pass when
        // real NFL cock-back is ~200ms. Cock now compressed to 10% of tf,
        // with dropback expanded to absorb the slack (more "scanning the
        // field" time, like a real QB). Also skip the cradle sub-phase
        // (qbT 0→0.18) because it's just "stand still with ball at chest" —
        // visually identical to the dropback pose, so it reads as a dead
        // beat where the throw should be starting.
        //   0    - 0.55 tf: dropback (carry pose)
        //   0.55 - 0.65 tf: cock-back (qbT 0.18→0.42, fast wind-up)
        //   0.65 - 0.73 tf: hold at cocked ear (qbT 0.42→0.48)
        //   0.73 - 0.85 tf: snap / release (qbT 0.48→0.68, release ~0.55)
        //   0.85 - 1.00 tf: follow-through (qbT 0.68→1.0)
        if (at < tf * 0.55) {
          qbPose = "carry";
          qbT = (t * 3 + 0.5) % 1;
        } else if (at < tf * 0.65) {
          qbPose = "throw";
          qbT = 0.18 + (at - tf * 0.55) / (tf * 0.10) * (0.42 - 0.18);
        } else if (at < tf * 0.73) {
          qbPose = "throw";
          qbT = 0.42 + (at - tf * 0.65) / (tf * 0.08) * 0.06;
        } else if (at < tf * 0.85) {
          qbPose = "throw";
          qbT = 0.48 + (at - tf * 0.73) / (tf * 0.12) * 0.20;
        } else if (at < tf * 1.0) {
          qbPose = "throw";
          qbT = 0.68 + (at - tf * 0.85) / (tf * 0.15) * 0.32;
        } else {
          qbPose = "idle";
          qbT = 0;
        }
      }
      const qbWithPose = { ...qb, pose: qbPose, t: qbT, facing: dir };
      // Target receiver pose — reach during the catch window, then carry the ball downfield
      const isCatching = t > throwPhase - 0.05 && t < throwPhase + 0.10;
      const isPostCatch = play.kind === "complete" && t > throwPhase + 0.10;
      // On an INT, the WR briefly reacts ("reach") then chases ("run") toward the defender,
      // facing the opposite direction since they're now playing defense.
      const wrIntPose = play.kind === "int" && t > throwPhase + 0.02
        ? (t > 0.92 ? "tackled" : "run")
        : null;
      // RARE WR JUKE — when play.wrJuke is set, the receiver makes a move on the
      // closest defender immediately after the catch. ~0.16-0.32 of total play.
      const isWRJuke = !!play.wrJuke;
      const inWRJukeWindow = isWRJuke && t > throwPhase + 0.04 && t < throwPhase + 0.22;
      // Lateral cut during the juke (then drift back to original path)
      const wrJukeLateral = inWRJukeWindow
        ? ((targetY < cy ? -1 : 1) * Math.sin(((t - throwPhase - 0.04) / 0.18) * Math.PI) * 26)
        : 0;
      if (inWRJukeWindow) {
        wr.y += wrJukeLateral;
        ballY += wrJukeLateral;
      }
      // LEAP / NEAR-MISS — for deep catches (or near-miss incompletes), the
      // receiver leaps for the ball. Leap window covers the catch frame.
      const isLeapingCatch = !!play.isLeapingCatch;
      const isLeapMiss = !!play.isLeapMiss;
      const inLeapWindow = (isLeapingCatch || isLeapMiss) && t > throwPhase - 0.10 && t < throwPhase + 0.08;
      const leapInternalT = inLeapWindow ? Math.max(0.001, (t - (throwPhase - 0.10)) / 0.18) : 0;
      // For near-miss leaps, the ball sails OVER the receiver's hand — nudge
      // ballY upward during the leap window so it visibly clears them.
      if (isLeapMiss && inLeapWindow) {
        ballY -= 6 + Math.sin(leapInternalT * Math.PI) * 4;
      }
      // Tackle window: after catch we let the carrier run YAC, then a few
      // tenths in the defenders close in. Start of tackle = TackleFrac of
      // action time; ragdoll plays out from there to the end.
      const TACKLE_START_AT = 0.78;   // 22% of action time devoted to tackle+ragdoll
      const passIsTD = (play.endYard ?? 0) >= 100;
      const wrPose = t < PRE
        ? "idle"   // hold stance pre-snap (auto-flips to role stance via drawPlayer)
        : (wrIntPose
        || (inWRJukeWindow ? "juke"
        :  (inLeapWindow ? "leap"
        :  (isCatching ? "reach"
        :  (isPostCatch && aT > TACKLE_START_AT && passIsTD ? "celebrate"
        :  (isPostCatch && aT > TACKLE_START_AT && (play.yards ?? 0) < 90 ? "tackled"
        :  (isPostCatch ? "carry"
        :   "run")))))));
      // For the tackled fall, pass fall-progress (not stride cycle) so the
      // ragdoll animation actually animates from "just hit" → "flat".
      // For run/carry, the stride cycle rate must scale to PLAY DURATION,
      // not be a flat fraction of t. (t*3)%1 = only 3 strides across the
      // whole play. On a 12-second play that's 4 seconds per stride — way
      // too slow, reads as the receiver sliding/gliding. Real jog is
      // ~2 strides/sec. Drive cycle off elapsed wall time instead.
      const strideHz = 2.0;
      const wrIsTackled = wrPose === "tackled";
      const wrTackleT = wrIsTackled ? Math.min(1, (aT - TACKLE_START_AT) / (1 - TACKLE_START_AT))
                       : inLeapWindow ? leapInternalT
                       : ((t * (dur / 1000)) * strideHz) % 1;
      const wrWithPose = { ...wr,
        pose: wrPose,
        t: wrTackleT,
        facing: (play.kind === "int" && t > throwPhase + 0.05) ? -dir : dir,
      };
      const off = formation.offense.map(p => {
        if (p.role === "QB") return qbWithPose;
        // FLEA FLICKER — RB takes the fake handoff, runs forward, pitches back
        if (play.isFleaFlicker && p === formation.rb && aTRaw < FLICKER_END) {
          const fT = aTRaw / FLICKER_END;
          let rbPose = "carry";
          if (fT < 0.30) rbPose = "reach";              // taking the handoff
          else if (fT < 0.50) rbPose = "carry";          // sprinting forward
          else if (fT < 0.80) rbPose = "throw";          // pitching back (cradle/cock)
          else rbPose = "stance";                        // settled, decoy
          return { ...p, x: flickerRBX, y: flickerRBY,
                   pose: rbPose, t: rbPose === "throw" ? Math.min(0.30, (fT - 0.50) / 0.30 * 0.30) : (t * 3) % 1,
                   facing: dir };
        }
        // Pre-snap motion: the motion player jogs across the formation
        if (hasMotion && t < PRE) {
          const isMotion = (motionRole === "wr1" && p === formation.wr1)
                        || (motionRole === "wr2" && p === formation.wr2)
                        || (motionRole === "te" && p === formation.te);
          if (isMotion) {
            const yOff = motionYOffset(t);
            const moving = isInMotionNow(t);
            const facingMotion = (motionEndY > motionStartY) ? 1 : -1;
            return { ...p, y: p.y + yOff,
                     pose: moving ? "run" : "idle",
                     t: (t * 3) % 1, facing: dir };
          }
        }
        if (p === formation.wr1 && wrChoice === "wr1") return wrWithPose;
        if (p === formation.wr2 && wrChoice === "wr2") return wrWithPose;
        if (p === formation.te && wrChoice === "te") return wrWithPose;
        if (p === formation.rb && wrChoice === "rb") return wrWithPose;
        if (p.role === "OL" && aT > 0) {
          if (isScreen) {
            if (aT < 0.2) {
              return { ...p, x: p.x, y: p.y, pose: "engage", t: aT, facing: dir };
            }
            const tt = Math.min(1, (aT - 0.2) / 0.6);
            const downfield = dir * tt * 32;
            const driftY = (p.y - cy) * (1 - tt * 0.4) + tt * (cy + screenSide * 35 - p.y) * 0.4;
            return { ...p, x: p.x + downfield, y: cy + driftY, pose: "run", t: (t * 3) % 1, facing: dir };
          }
          const tt = Math.min(1, aT / 0.55);
          const dropBack = 3 * tt;
          const wobble = Math.sin(tt * Math.PI * 6 + p.y * 0.05) * 1.3;
          return { ...p, x: p.x - dir * dropBack, y: p.y + wobble, pose: "engage", t: tt, facing: dir };
        }
        // Non-targeted receivers run REAL routes (decoys clear coverage).
        // Was capped at ~6 yards downfield with the slow (t*3)%1 leg
        // cycle, so they looked stationary next to the one targeted WR
        // running 15+ yards. Now they cover catchDepth-relative ground
        // at a real jog cadence so multiple receivers are visibly
        // running on every pass play.
        if ((p.role === "WR1" || p.role === "WR2" || p.role === "WR3" || p.role === "WR4" || p.role === "WR5" || p.role === "TE1" || p.role === "TE" || p.role === "TE2") && aT > 0) {
          const tt = Math.min(1, aT / Math.max(0.1, throwFrac));
          const idHash = ((p.y * 7 + (p.x * 3)) >>> 0) % 100 / 100;
          // Decoy depth varies per receiver (60-120% of targeted depth)
          // so the field isn't a 4-WR conga line. Angle drifts toward
          // the lateral side they started on.
          const decoyDepth = catchDepth * (0.6 + idHash * 0.6);
          const lateralOff = (idHash - 0.5) * 36;
          const strideHz = 2.0;
          return { ...p, x: p.x + dir * tt * decoyDepth * FIELD.PX_PER_YARD,
                   y: p.y + Math.sin(tt * Math.PI * 0.6) * lateralOff,
                   pose: "run",
                   t: ((t * (dur / 1000)) * strideHz) % 1,
                   facing: dir };
        }
        return { ...p, pose: "idle", facing: dir };
      });
      drawPlayers(off, def);
      // Draw the standalone ball during pre-snap (at the center) and the
      // C→QB snap window, then suppress while the QB cradles/cocks (his hand
      // draws it), then resume once the ball is released and in flight.
      const showStandalone = (t < PRE) || (at < snapMotionAT) || (at >= releaseAT);
      // PASS TRAIL — once the ball is in flight, draw a fading parabolic
      // dotted trail from release point to current ball position. Persists
      // through catch + YAC so the user can see the throw retroactively.
      if (at >= releaseAT && typeof drawBallTrail === "function") {
        const flightProg = Math.min(1, (at - releaseAT) / Math.max(0.0001, throwEndAT - releaseAT));
        drawBallTrail(ctx, releaseX, releaseY, ballX, ballY, flightProg, { arcHeight: arcHeight * 0.85 });
      }
      if (showStandalone) drawBall(ctx, ballX, ballY, arc > 30 ? 1.3 : 1, { angle: ballAngle });
      // Play-action / Flea-flicker / Throw-on-run banner at the top of the field
      if ((play.isPlayAction || play.isTOR || play.isFleaFlicker) && t < throwPhase + 0.08) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 20px sans-serif";
        const lbl = play.isFleaFlicker ? "🎪 FLEA FLICKER"
                  : play.isTOR ? "🏃 THROW ON THE RUN"
                  : "🎭 PLAY-ACTION";
        const lblColor = play.isFleaFlicker ? "#ffd54d"
                       : play.isTOR ? "#ffb060"
                       : "#c890ff";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(FIELD.W/2 - 140, 8, 280, 28);
        ctx.fillStyle = lblColor;
        ctx.fillText(lbl, FIELD.W / 2, 22);
        ctx.restore();
      }
      // Throw-type callout — small label near the QB during the throw window
      if (play.throwType && play.throwType !== "CHECKDOWN" && t > dropPhase && t < throwPhase + 0.05) {
        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "900 16px sans-serif";
        const lbl = play.throwType === "ZIP"   ? "🎯 ZIPPED IT"
                  : play.throwType === "DEEP"  ? "🚀 DEEP BALL"
                  : play.throwType === "TOR"   ? "🏃 ON THE RUN"
                  :                              "🪶 TOUCH";
        const lblX = qb.x + dir * 14;
        const lblY = qb.y - 18;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(lbl, lblX, lblY);
        ctx.fillStyle = play.throwType === "ZIP" ? "#ffb060" : "#9be09b";
        ctx.fillText(lbl, lblX, lblY);
        ctx.restore();
      }
      // WR juke callout — fires during the juke window with a big yellow flash
      if (play.wrJuke && t > throwPhase + 0.02 && t < throwPhase + 0.30) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 26px sans-serif";
        const lbl = "🔥 CATCH & JUKE!";
        const lblX = (wr.x + (qb.x + dir * 60)) / 2;
        const lblY = wr.y - 26;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(lbl, lblX, lblY);
        ctx.fillStyle = "#f0cc30";
        ctx.fillText(lbl, lblX, lblY);
        ctx.restore();
      }
      // TD CELEBRATION BANNER for pass TDs
      if (passIsTD && isPostCatch && aT > 0.78) {
        const cT = Math.min(1, (aT - 0.78) / 0.22);
        const pulse = 1 + Math.sin(cT * Math.PI * 8) * 0.04;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(FIELD.W/2 - 220, FIELD.H/2 - 38, 440, 76);
        ctx.font = `900 ${Math.round(56 * pulse)}px sans-serif`;
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText("TOUCHDOWN!", FIELD.W / 2, FIELD.H / 2);
        ctx.fillStyle = "#ffd54d";
        ctx.fillText("TOUCHDOWN!", FIELD.W / 2, FIELD.H / 2);
        ctx.restore();
      }
      drawPreSnapCallouts(ctx, t, dur);
    }};
  }

  if (play.kind === "sack") {
    const endX = yardToAbsX(play.endYard, poss);
    const actionDur = scaledDuration(8 + Math.abs(play.sackLoss || 0));
    const dur = actionDur + PRE_MS;
    PRE = PRE_MS / dur;
    // Per-sack variation seed — no two sacks look the same.
    const sackSeed = ((play.startYard * 17) ^ ((play.sackLoss || 0) * 53) ^ ((play.time || 0) * 7)) >>> 0;
    const r = (i) => ((sackSeed >> (i * 3)) & 0xff) / 256;  // pseudorandom 0-1 from seed bits
    // Each sack picks: who's the primary rusher, when contact happens,
    // dance frequency/intensity, fall direction, second-chaser presence.
    const primaryIdx = Math.floor(r(0) * 4);         // 0-3 (which DL gets there first)
    const contactT = 0.62 + r(1) * 0.26;             // sack contact at 0.62-0.88
    const danceFreq = 3.5 + r(2) * 4.5;              // pocket wiggle frequency
    const danceAmpY = 4 + r(3) * 12;                 // Y wiggle amplitude
    const danceAmpX = 2 + r(4) * 8;                  // X drift amplitude
    const xDir = r(5) > 0.5 ? 1 : -1;                // QB drifts which way?
    const yFlavor = r(6) > 0.5 ? 1 : -1;             // initial drift direction
    const secondChaser = r(7) > 0.55;                // does a 2nd DL get in?
    const secondIdx = (primaryIdx + 1 + Math.floor(r(8) * 3)) % 4;
    const fallTilt = -0.6 + r(9) * 1.2;              // tackle fall angle bias (left/right)
    const dropDepth = 4 + r(10) * 3;                 // how deep the QB drops (4-7 yds)
    return { duration: dur, kind: "sack", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      const qb = { ...formation.qb };
      let qbPose = "idle";
      if (t > PRE) {
        const tt = (t - PRE) / (1 - PRE);
        // Base drop varies by seed: some sacks the QB barely drops, others he gets deep
        const dropFrac = Math.min(1, tt / 0.30);
        qb.x = formation.qb.x - dir * dropFrac * dropDepth * FIELD.PX_PER_YARD;
        qb.y = cy;
        // Pocket dance — frequency and amplitude vary per play
        if (tt > 0.12 && tt < contactT) {
          const danceT = (tt - 0.12) / (contactT - 0.12);
          const wigY = Math.sin(tt * Math.PI * danceFreq + (sackSeed % 11)) * danceAmpY * (0.4 + danceT * 0.6);
          const wigX = Math.cos(tt * Math.PI * (danceFreq - 1) + (sackSeed % 5)) * danceAmpX * danceT * xDir;
          qb.y += wigY * yFlavor;
          qb.x += wigX;
        }
        // Final takedown — fall point shifts based on flavor
        if (tt > contactT) {
          const fallT = (tt - contactT) / (1 - contactT);
          qb.x = qb.x + (endX - qb.x) * fallT;
          qb.y = qb.y + fallTilt * fallT * 4;
          qbPose = "tackled";
        } else {
          qbPose = "run";
        }
      }
      const def = formation.defense.map((d, i) => {
        const dd = { ...d, pose: t < PRE ? "stance" : "run", t: (t * 3 + i * 0.13) % 1, facing: -dir };
        if (t < PRE) {
          const sh = defShiftXY(i, t);
          dd.x = d.x + sh.dx;
          dd.y = d.y + sh.dy;
          dd.pose = isDefShifting(i, t) ? "run" : (isDefPointer(i) ? "point" : "stance");
          return dd;
        }
        if (t <= PRE) return dd;
        const tt = (t - PRE) / (1 - PRE);
        if (i < 4) {
          const isPrimary = i === primaryIdx;
          const isSecondary = secondChaser && i === secondIdx;
          // Primary closes fast; secondary trails slightly; others get held up.
          let speedFactor;
          if (isPrimary) speedFactor = 1.05;
          else if (isSecondary) speedFactor = 0.88;
          else speedFactor = 0.70;
          const elapsedMs = Math.max(0, tt) * dur * speedFactor;
          // Approach angle varies — some come from outside, some from inside.
          const angleOffset = isPrimary ? 0 : (i - primaryIdx) * 4;
          const np = pursue(d, qb.x + dir * 2 + angleOffset, qb.y + (isSecondary ? 6 : 0), elapsedMs, isPrimary ? 1.0 : 0.85);
          dd.x = np.x; dd.y = np.y;
          if (!np.moved) dd.t = 0;   // freeze legs when not moving
          if (isPrimary && tt > contactT + 0.03) dd.pose = "sack";
          if (isSecondary && tt > contactT + 0.05) dd.pose = "sack";
        } else if (i >= 4 && i <= 6) {
          // LBs spy the QB but stay disciplined — drift toward him slowly
          const elapsedMs = Math.max(0, tt) * dur * 0.55;
          const np = pursue(d, qb.x + dir * 6, qb.y + (i - 5) * 12, elapsedMs, 0.7);
          dd.x = np.x; dd.y = np.y;
          if (!np.moved) dd.t = 0;
        }
        return dd;
      });
      const off = formation.offense.map(p => {
        if (p.role === "QB") return { ...qb, pose: qbPose, t: (t * 3 + 0.4) % 1, facing: dir };
        if (p.role === "OL" && t > PRE) {
          const tt = (t - PRE) / (1 - PRE);
          const slotDepth = Math.abs((p.y - cy) / 14);
          // OL get pushed back into the pocket — looks like they're losing
          return { ...p, x: p.x - dir * (6 + slotDepth * 3) * tt, y: p.y + Math.sin(tt * Math.PI * 5 + p.y) * 2.5, pose: "engage", facing: dir };
        }
        if ((p.role === "WR1" || p.role === "WR2" || p.role === "TE") && t > PRE) {
          // Receivers ran routes but are now standing around (no one to throw to)
          const tt = (t - PRE) / (1 - PRE);
          return { ...p, x: p.x + dir * tt * 80, pose: tt > 0.8 ? "idle" : "run", t: (t * 3 + 0.5) % 1, facing: dir };
        }
        return { ...p, pose: "idle", facing: dir };
      });
      drawPlayers(off, def);
      drawBall(ctx, qb.x, qb.y);
      // Pressure indicator — pulsing red ring around QB during the dance
      const sackT = Math.max(0, (t - PRE) / (1 - PRE));
      if (sackT > 0.20 && sackT < 0.86) {
        const ringAlpha = 0.15 + Math.sin(sackT * Math.PI * 6) * 0.10;
        ctx.strokeStyle = `rgba(214,90,90,${ringAlpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(qb.x, qb.y, 18 + sackT * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Burst at sack contact
      if (sackT > 0.85) {
        const burstT = (sackT - 0.85) / 0.15;
        ctx.strokeStyle = `rgba(255,200,0,${0.8 - burstT * 0.8})`;
        ctx.lineWidth = 3;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const inner = 14 + burstT * 8;
          const outer = 26 + burstT * 12;
          ctx.beginPath();
          ctx.moveTo(qb.x + Math.cos(ang) * inner, qb.y + Math.sin(ang) * inner);
          ctx.lineTo(qb.x + Math.cos(ang) * outer, qb.y + Math.sin(ang) * outer);
          ctx.stroke();
        }
      }
      // "PRESSURE!" callout when the pocket starts collapsing
      if (sackT > 0.25 && sackT < 0.55) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 18px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 3;
        ctx.strokeText("PRESSURE!", qb.x, qb.y - 26);
        ctx.fillStyle = "#d65a5a";
        ctx.fillText("PRESSURE!", qb.x, qb.y - 26);
        ctx.restore();
      }
      drawPreSnapCallouts(ctx, t, dur);
    }};
  }

  if (play.kind === "fumble") {
    // Real fumble sequence — the carrier loses the ball at the spot, ball
    // rolls forward bouncing, and the on-field players collapse on it. No
    // more "circle of strangers" scene; uses the actual formation.
    const recoveredBy = play.recoveredBy || "def";
    const fumYards = play.yards || 0;
    const fumX = losX + dir * fumYards * FIELD.PX_PER_YARD;
    const fumY = cy;
    // Ball drifts forward as it rolls, ending up ~3-5 yards past the spot
    const restX = fumX + dir * 50;
    const restY = fumY + ((((play.startYard * 13) >>> 0) % 21) - 10);
    return { duration: 2600, kind: "fumble", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);

      // Ball physics — pop loose → roll forward bouncing → settle
      let ballX, ballY, ballScale;
      if (t < 0.12) {
        const pt = t / 0.12;
        ballX = fumX + dir * pt * 12;
        ballY = fumY - Math.sin(pt * Math.PI) * 16;
        ballScale = 1.0 + Math.sin(pt * Math.PI) * 0.25;
      } else if (t < 0.65) {
        const pt = (t - 0.12) / 0.53;
        const sm = pt * pt * (3 - 2 * pt);
        ballX = fumX + dir * 12 + (restX - fumX - dir * 12) * sm + Math.sin(pt * Math.PI * 6) * 4;
        ballY = fumY + (restY - fumY) * sm - Math.abs(Math.sin(pt * Math.PI * 5)) * 7;
        ballScale = 0.9 + Math.abs(Math.cos(pt * Math.PI * 5)) * 0.2;
      } else {
        ballX = restX;
        ballY = restY;
        ballScale = 0.85;
      }

      // The on-field formation collapsing on the ball. Defenders sprint at
      // full speed; OL lumber; carrier collapses at the fumble spot.
      const offPlayers = [...formation.offense];
      const defPlayers = [...formation.defense];
      const rusherName = play.rusher;
      const matchesCarrier = (p) =>
        (p.role === "RB" || p.role === "QB") && rusherName;

      // play.scrumMisses tells us HOW MANY failed dive attempts before
      // the recovery. We pick the N closest non-carrier players and give
      // them staggered DIVE poses during the scrum window so the user
      // actually SEES the missed dives, instead of one generic pile.
      const scrumMisses = Math.min(4, play.scrumMisses || 0);
      const allNonCarriers = [...offPlayers, ...defPlayers].filter(p => !(p.role === "RB" || p.role === "QB"));
      allNonCarriers.sort((a, b) =>
        Math.hypot(a.x - fumX, a.y - fumY) - Math.hypot(b.x - fumX, b.y - fumY));
      const missers = new Set(allNonCarriers.slice(0, scrumMisses));

      const renderConverging = (players, isOff) => {
        const color = isOff ? possColor : oppColor;
        const sec = isOff ? team.secondary : oppTeam.secondary;
        for (const p of players) {
          const carrier = isOff && matchesCarrier(p);
          let pX, pY, pPose, pT = (t * 3) % 1;
          if (carrier) {
            // Carrier collapses at the fumble spot, ragdoll
            const collapseT = Math.min(1, t / 0.18);
            pX = p.x + (fumX - p.x) * collapseT;
            pY = p.y + (fumY + 6 - p.y) * collapseT;
            pPose = "tackled";
          } else if (missers.has(p)) {
            // Designated misser — sprints toward the ball, then DIVES
            // in their assigned window. Each misser gets a unique
            // staggered timing so they dive in succession.
            const myIdx = [...missers].indexOf(p);
            const diveStart = 0.34 + myIdx * 0.10;
            const diveEnd   = diveStart + 0.16;
            const isOL = p.role === "OL";
            const speedMul = isOL ? 0.45 : 1.0;
            const dx = ballX - p.x, dy = ballY - p.y;
            const dist = Math.hypot(dx, dy);
            const maxMove = Math.min(t, diveStart) * 360 * speedMul;
            const moveFrac = Math.min(1, maxMove / Math.max(1, dist));
            pX = p.x + dx * moveFrac;
            pY = p.y + dy * moveFrac;
            if (t >= diveStart && t < diveEnd) {
              pPose = "dive";
              pT = (t - diveStart) / 0.16;
            } else if (t >= diveEnd) {
              pPose = "tackled";   // landed flat after missing
            } else {
              pPose = "run";
            }
          } else {
            // OL drag (slow), DL/LB/CB/S/WR sprint
            const isOL = p.role === "OL";
            const speedMul = isOL ? 0.45 : (p.role === "WR1" || p.role === "WR2" || p.role === "TE") ? 0.70 : 1.0;
            const dx = ballX - p.x, dy = ballY - p.y;
            const dist = Math.hypot(dx, dy);
            const maxMove = t * 360 * speedMul;
            const moveFrac = Math.min(1, maxMove / Math.max(1, dist));
            pX = p.x + dx * moveFrac;
            pY = p.y + dy * moveFrac;
            // Once close enough, dive into the pile
            const newDist = Math.hypot(ballX - pX, ballY - pY);
            if (newDist < 38 && t > 0.55) {
              pPose = "tackled";
            } else if (newDist < 38) {
              pPose = "tackled";
            } else {
              pPose = "run";
            }
          }
          drawPlayer(ctx, pX, pY, color, sec, p.label || "", pPose, pT, isOff ? dir : -dir, p);
        }
      };
      renderConverging(offPlayers, true);
      renderConverging(defPlayers, false);

      // Ball drawn on top of everyone EXCEPT after the pile has formed (then
      // it's buried under the dogpile)
      if (t < 0.78) drawBall(ctx, ballX, ballY, ballScale);

      // "FUMBLE!" callout
      if (t < 0.32) {
        const fadeIn = Math.min(1, t / 0.10);
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 38px monospace";
        ctx.fillStyle = `rgba(214,90,90,${fadeIn})`;
        ctx.strokeStyle = `rgba(0,0,0,${fadeIn * 0.85})`;
        ctx.lineWidth = 4;
        ctx.strokeText("FUMBLE!", FIELD.W / 2, 60);
        ctx.fillText("FUMBLE!", FIELD.W / 2, 60);
        ctx.restore();
      }
      // "LOOSE BALL!" during the scrum
      if (t > 0.32 && t < 0.75) {
        const pulse = 0.5 + Math.sin(t * Math.PI * 8) * 0.5;
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 22px monospace";
        ctx.fillStyle = `rgba(255,200,80,${0.6 + pulse * 0.4})`;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 3;
        ctx.strokeText("LOOSE BALL — DIVE!", FIELD.W / 2, 60);
        ctx.fillText("LOOSE BALL — DIVE!", FIELD.W / 2, 60);
        ctx.restore();
      }
      // Recovery callout
      if (t > 0.82) {
        const fadeT = Math.min(1, (t - 0.82) / 0.10);
        const isRecOff = recoveredBy === "off";
        const lbl = isRecOff
          ? `${(poss === "home" ? homeTeam : awayTeam).name.toUpperCase()} RECOVERS!`
          : `${(poss === "home" ? awayTeam : homeTeam).name.toUpperCase()} RECOVERS!`;
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = "900 26px sans-serif";
        ctx.fillStyle = isRecOff ? `rgba(155,224,155,${fadeT})` : `rgba(240,204,48,${fadeT})`;
        ctx.strokeStyle = `rgba(0,0,0,${fadeT * 0.85})`;
        ctx.lineWidth = 4;
        ctx.strokeText(lbl, FIELD.W / 2, 60);
        ctx.fillText(lbl, FIELD.W / 2, 60);
        ctx.restore();
      }
    }};
  }

  if (play.kind === "fg_good" || play.kind === "fg_miss" || play.kind === "fg_blocked") {
    const isGood = play.kind === "fg_good";
    const isBlocked = play.kind === "fg_blocked";
    const isReturned = !!play.isReturned;
    const isReturnTD = !!play.isReturnTD;
    const missRoll = ((play.startYard * 17 + (play.time || 0)) >>> 0) % 100 / 100;
    const missType = isGood ? "good" : (missRoll < 0.5 ? (missRoll < 0.25 ? "wide_l" : "wide_r") : "short");
    const HASH_HALF = 40;
    const goalX = poss === "home" ? FIELD.W - FIELD.EZ_PX * 0.4 : FIELD.EZ_PX * 0.4;
    // Special-teams positions
    const holderX = losX - dir * 7 * FIELD.PX_PER_YARD;
    const holderY = cy;
    const kickerX = holderX - dir * 18;     // slightly behind & to the side of the holder
    const kickerY = cy + 12;
    // Block deflection point (just past the LOS)
    const blockX = losX + dir * 8;
    const blockY = cy + (((play.startYard * 7) >>> 0) % 11) - 5;
    const recoverX = isBlocked
      ? losX - dir * (8 + ((play.startYard * 11) >>> 0) % 14)
      : losX - dir * 4;
    const returnEndX = isReturnTD
      ? (poss === "home" ? FIELD.EZ_PX * 0.5 : FIELD.W - FIELD.EZ_PX * 0.5)
      : holderX - dir * 6;
    const dur = (isBlocked || isReturned) ? (isReturnTD ? 4200 : 3200) : 2600;
    return { duration: dur, kind: play.kind, render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      drawGoalposts(ctx, goalX, cy);

      // ── Special-teams formation (drawn instead of regular formation) ──
      // 9-man protection along the LOS, holder kneeling, kicker offset.
      const olY = [-50, -36, -22, -8, 6, 20, 34, 48, 62];
      for (let i = 0; i < 9; i++) {
        const olXOff = (i === 0 || i === 8) ? -dir * 4 : 0;   // wings slightly back
        drawPlayer(ctx, losX - dir * 1 + olXOff, cy + olY[i], possColor, team.secondary, "", "stance", t, dir, { role: "OL", bodyType: "BIG" });
      }
      // Defense — pass-rush formation (5 DL + 2 LBs crashing)
      const defLineY = [-30, -10, 10, 30];
      for (let i = 0; i < 4; i++) {
        // Defenders surge toward the kicker on rush
        const surgeT = Math.min(1, t / 0.18);
        const dxRush = -dir * 30 * surgeT;
        drawPlayer(ctx, losX + dir * 2 + dxRush, cy + defLineY[i], oppColor, oppTeam.secondary, "", t < 0.20 ? "stance" : "run", t, -dir, { role: "DL" });
      }

      // Ball + kicker animation
      let ballX, ballY, arc = 0, ballScale = 1, ballHidden = false;
      const showBlocker = isBlocked && t > 0.22 && t < 0.36;

      // Kicker pose progression: stance → approach → kick → follow
      let kickerPoseX = kickerX, kickerPoseY = kickerY, kickerPose = "stance";
      if (t < 0.10) { kickerPose = "stance"; }
      else if (t < 0.22) {
        // Run-up — approach the ball from behind
        const ap = (t - 0.10) / 0.12;
        kickerPoseX = kickerX + (holderX - kickerX) * ap * 0.85;
        kickerPoseY = kickerY + (holderY - kickerY) * ap * 0.85;
        kickerPose = "run";
      } else {
        kickerPoseX = holderX - dir * 4;
        kickerPoseY = holderY + 4;
        kickerPose = "kick";
      }
      drawPlayer(ctx, kickerPoseX, kickerPoseY, possColor, team.secondary, "", kickerPose, t, dir, { role: "K" });

      // Holder kneeling at the spot (drawn behind ball during placement)
      if (t < 0.85) {
        drawPlayer(ctx, holderX + dir * 2, holderY + 6, possColor, team.secondary, "", "stance", t, -dir, { role: "RB" });
      }

      // Ball: snap → placed → kick → flight → result
      if (t < 0.06) {
        // Snap travels back to holder
        const sp = t / 0.06;
        ballX = losX + (holderX - losX) * sp;
        ballY = cy;
      } else if (t < 0.22) {
        // Ball held at the spot
        ballX = holderX; ballY = holderY;
      } else if (isBlocked && t < 0.36) {
        // Ball gets a few yards then deflects backward off a blocker
        const bp = (t - 0.22) / 0.14;
        if (bp < 0.5) {
          // Forward into the block
          ballX = holderX + (blockX - holderX) * (bp / 0.5);
          ballY = holderY;
          arc = Math.sin((bp / 0.5) * Math.PI * 0.6) * 25;
        } else {
          // Wobble back toward recovery spot
          const wp = (bp - 0.5) / 0.5;
          ballX = blockX + (recoverX - blockX) * wp;
          ballY = blockY + (Math.sin(wp * Math.PI * 3) * 6);
          arc = Math.max(0, 25 - wp * 25) + Math.abs(Math.sin(wp * Math.PI * 4)) * 8;
        }
        ballScale = 0.9;
      } else if (!isBlocked && t < 0.78) {
        // Normal kick flight
        const kt = (t - 0.22) / 0.56;
        if (missType === "short") {
          const reach = 0.78;
          ballX = holderX + (goalX - holderX) * kt * reach;
          ballY = holderY;
          arc = Math.sin(kt * Math.PI) * 50;
        } else {
          let goalY = cy;
          if (missType === "wide_l") goalY = cy - HASH_HALF - 8;
          else if (missType === "wide_r") goalY = cy + HASH_HALF + 8;
          ballX = holderX + (goalX - holderX) * kt;
          ballY = holderY + (goalY - holderY) * kt;
          arc = Math.sin(kt * Math.PI) * 90;
        }
      } else if (isBlocked && t < 1.0) {
        // Defender picks up ball and returns
        const rt = (t - 0.36) / 0.64;
        ballX = recoverX + (returnEndX - recoverX) * rt;
        ballY = blockY;
        arc = 0;
        // Returning defender (drawn at the ball)
        drawPlayer(ctx, ballX, ballY, oppColor, oppTeam.secondary, "", "carry", t, -dir, { role: "DL" });
        ballHidden = true;  // ball is in the carrier's hands
      } else if (isReturned && t > 0.78) {
        // Returner picks it up after a short miss & returns
        const rt = (t - 0.78) / 0.22;
        ballX = (poss === "home" ? FIELD.W - 90 : 90);
        ballX = ballX + (returnEndX - ballX) * rt;
        ballY = cy + 18 - rt * 20;
        drawPlayer(ctx, ballX, ballY, oppColor, oppTeam.secondary, "", "carry", t, -dir, { role: "S" });
        ballHidden = true;
      }

      if (!ballHidden) drawBall(ctx, ballX, ballY - arc, ballScale + (arc / 250));

      // ── Callouts ──
      if (t > 0.82 && !isBlocked && !isReturned) {
        const banT = Math.min(1, (t - 0.82) / 0.14);
        ctx.save();
        ctx.globalAlpha = banT;
        ctx.fillStyle = isGood ? "#f0cc30" : "#e07070";
        ctx.font = "900 44px monospace";
        ctx.textAlign = "center";
        ctx.fillText(isGood ? "IT'S GOOD!" : missType === "short" ? "SHORT!" : missType === "wide_l" ? "WIDE LEFT!" : "WIDE RIGHT!", FIELD.W / 2, 60);
        ctx.restore();
      }
      if (isBlocked && t > 0.22 && t < 0.50) {
        const fadeT = Math.min(1, (t - 0.22) / 0.06);
        ctx.save();
        ctx.globalAlpha = fadeT;
        ctx.fillStyle = "#e07070";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 4;
        ctx.font = "900 46px monospace";
        ctx.textAlign = "center";
        ctx.strokeText("BLOCKED!", FIELD.W / 2, 60);
        ctx.fillText("BLOCKED!", FIELD.W / 2, 60);
        ctx.restore();
      }
      if ((isBlocked || isReturned) && isReturnTD && t > 0.85) {
        const fadeT = Math.min(1, (t - 0.85) / 0.10);
        ctx.save();
        ctx.globalAlpha = fadeT;
        ctx.fillStyle = "#f0cc30";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 4;
        ctx.font = "900 40px monospace";
        ctx.textAlign = "center";
        ctx.strokeText("TOUCHDOWN!", FIELD.W / 2, 60);
        ctx.fillText("TOUCHDOWN!", FIELD.W / 2, 60);
        ctx.restore();
      }
    }};
  }

  if (play.kind === "punt") {
    const landYardAbs = play.landYard ?? play.endYard ?? play.startYard;
    const landX = yardToAbsX(landYardAbs, poss);
    const endX  = yardToAbsX(play.endYard ?? landYardAbs, poss);
    const returnerY = cy + (((play.startYard * 23 + (play.time || 0)) >>> 0) % 80) - 40;
    const returnYards = play.returnYards || 0;
    const isTouchback = !!play.isTouchback;
    const isFairCatch = !!play.isFairCatch;
    const isReturnTD  = !!play.isReturnTD;
    // Duration scales with the return so big returns have time to develop
    // (no more teleporting across the field in 1 second).
    const dur = (isTouchback || isFairCatch)
              ? 2400
              : Math.round(2800 + Math.min(returnYards, 70) * 38);
    // Phase boundaries — return phase is now ~46% of the animation
    const PH_WIND_END  = 0.18;
    const PH_AIR_END   = 0.46;
    const PH_FIELD_END = 0.54;
    const RET_LEN      = 1 - PH_FIELD_END;
    return { duration: dur, kind: "punt", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      const startX = losX - dir * 12 * FIELD.PX_PER_YARD;
      let ballX, ballY, arc = 0;
      let phase = "snap";
      if (t < 0.08) { ballX = losX; ballY = cy; phase = "snap"; }
      else if (t < PH_WIND_END) { ballX = losX + (startX - losX) * ((t - 0.08) / (PH_WIND_END - 0.08)); ballY = cy; phase = "wind"; }
      else if (t < PH_AIR_END) {
        const tt = (t - PH_WIND_END) / (PH_AIR_END - PH_WIND_END);
        ballX = startX + (landX - startX) * tt;
        arc = Math.sin(tt * Math.PI) * 170;
        ballY = cy - arc + (returnerY - cy) * tt;
        phase = "air";
      } else if (t < PH_FIELD_END) {
        ballX = landX; ballY = returnerY; phase = "field";
      } else {
        const tt = (t - PH_FIELD_END) / RET_LEN;
        if (isTouchback || isFairCatch) {
          ballX = landX; ballY = returnerY;
        } else {
          // Linear-with-mild-easeIn motion — no more easeOutCubic teleport.
          // First 15% accelerates from catch, then steady run to endX.
          const eased = tt < 0.15
                      ? (tt * tt) / 0.30
                      : 0.075 + ((tt - 0.15) / 0.85) * 0.925;
          ballX = landX + (endX - landX) * eased;
          ballY = returnerY + Math.sin(tt * 6) * 5;
        }
        phase = "return";
      }
      // Punter — actually punts the ball. Was rendered as "idle" while
      // the football magically flew away. Now uses the "kick" pose with
      // t advancing through the windup/strike during the snap+wind phase
      // and following through during early air phase.
      //   0    - 0.08: idle (receiving the snap)
      //   0.08 - 0.18: kick pose, kickT 0 → 0.5 (windup + plant + strike)
      //   0.18 - 0.30: kick pose, kickT 0.5 → 1.0 (follow-through)
      //   0.30+      : stiff (watching the ball)
      let punterPose, punterT;
      if (t < 0.08)        { punterPose = "idle";  punterT = 0; }
      else if (t < 0.18)   { punterPose = "kick";  punterT = (t - 0.08) / 0.10 * 0.5; }
      else if (t < 0.30)   { punterPose = "kick";  punterT = 0.5 + (t - 0.18) / 0.12 * 0.5; }
      else                 { punterPose = "stiff"; punterT = 0; }
      drawPlayer(ctx, startX, cy, possColor, team.secondary, "", punterPose, punterT, dir);
      // ── 4 COVERAGE PLAYERS — 3 get engaged by blockers, 1 stays free for the tackle ──
      const laneYs = [returnerY - 38, returnerY - 14, returnerY + 14, returnerY + 38];
      const chaserPositions = [];
      for (let i = 0; i < 4; i++) {
        const isOutside = (i === 0 || i === 3);
        const chaserStartX = losX + dir * (isOutside ? 14 : 2);
        const sprintT = Math.min(1, t * (isOutside ? 1.7 : 1.3));
        let cx_ = chaserStartX + (landX - chaserStartX) * sprintT;
        let cy_ = laneYs[i] + (returnerY - laneYs[i]) * Math.min(1, t * 1.0) * 0.65;
        const isFree = (i === 3);  // outside gunner is the free pursuer / eventual tackler
        if (phase === "return") {
          const tt = (t - PH_FIELD_END) / RET_LEN;
          if (isFree) {
            // Free pursuer takes a closing angle on the returner — arrives near the end
            cx_ = landX + (ballX - landX) * (0.35 + tt * 0.65);
            cy_ = laneYs[i] + (ballY - laneYs[i]) * Math.min(1, tt * 1.3);
          } else {
            // Engaged chaser — locked up by blocker. Stays AHEAD of the returner in
            // his running direction (-dir), creating the visible wedge.
            const aheadOffset = -dir * (24 - i * 4);
            cx_ = ballX + aheadOffset + Math.sin(tt * 5 + i) * 2;
            cy_ = laneYs[i] * 0.4 + returnerY * 0.6;
          }
        }
        chaserPositions.push({ x: cx_, y: cy_, isFree });
        const isEngaged = phase === "return" && !isFree;
        const pose = isEngaged ? "engage" : "run";
        const facing = isEngaged ? -dir : dir;  // engaged chasers face the blocker / returner
        drawPlayer(ctx, cx_, cy_, possColor, team.secondary, "", pose, (t * 3 + i * 0.2) % 1, facing);
      }
      // ── 3 RETURN-TEAM BLOCKERS — each glued to their assigned chaser during the return ──
      for (let i = 0; i < 3; i++) {
        const targetChaser = chaserPositions[i];
        let bx, by;
        if (phase === "snap" || phase === "wind") {
          bx = landX - dir * 22;
          by = laneYs[i] * 0.4 + returnerY * 0.6;
        } else if (phase === "air") {
          const tt = (t - PH_WIND_END) / (PH_AIR_END - PH_WIND_END);
          const setupX = (targetChaser.x + landX) / 2;
          const setupY = targetChaser.y * 0.5 + returnerY * 0.5;
          bx = (landX - dir * 22) + (setupX - (landX - dir * 22)) * tt;
          by = (laneYs[i] * 0.4 + returnerY * 0.6) + (setupY - (laneYs[i] * 0.4 + returnerY * 0.6)) * tt;
        } else if (phase === "field") {
          bx = (targetChaser.x + landX) / 2;
          by = (targetChaser.y + returnerY) / 2;
        } else {
          // RETURN — stick to the chaser, on the returner side. Visible engagement.
          bx = targetChaser.x + dir * 7;
          by = targetChaser.y + (returnerY - targetChaser.y) * 0.10;
        }
        const blockerPose = (phase === "return" || phase === "field") ? "engage" : "run";
        const facing = dir;  // blockers face the chasers coming from the punt direction
        drawPlayer(ctx, bx, by, oppColor, oppTeam.secondary, "", blockerPose, (t * 3 + i * 0.15) % 1, facing);
      }
      // Returner (with ball after fielding)
      const returnerX = phase === "return" ? ballX : landX;
      const returnerDrawY = phase === "return" ? ballY : returnerY;
      const returnerPose = phase === "return" ? "carry"
                         : (phase === "field" ? "catch" : "idle");
      const returnerFacing = phase === "return" ? -dir : dir;  // turns around to run back
      drawPlayer(ctx, returnerX, returnerDrawY, oppColor, oppTeam.secondary, "", returnerPose, (t * 3) % 1, returnerFacing);
      drawBall(ctx, ballX, ballY, 1 + arc / 200);
      // Callouts
      if (phase === "field" || (phase === "return" && t < PH_FIELD_END + RET_LEN * 0.25)) {
        ctx.save();
        ctx.fillStyle = isTouchback ? "#cccccc" : isFairCatch ? "#9bd0ff" : "#9be09b";
        ctx.font = "900 22px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(isTouchback ? "TOUCHBACK" : isFairCatch ? "FAIR CATCH" : "FIELDED!", landX, returnerY - 24);
        ctx.restore();
      }
      if (phase === "return" && returnYards >= 20 && t > 0.88) {
        ctx.save();
        ctx.fillStyle = "#f0cc30";
        ctx.font = "900 32px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(returnYards >= 40 ? "HOUSE CALL!" : "BIG RETURN!", FIELD.W / 2, 50);
        ctx.restore();
      }
      if (isReturnTD && t > 0.95) {
        ctx.save();
        ctx.fillStyle = "#f0cc30";
        ctx.font = "900 38px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("TOUCHDOWN!", FIELD.W / 2, 90);
        ctx.restore();
      }
    }};
  }

  if (play.kind === "score") {
    return { duration: 1200, kind: "score", render: (t, c) => {
      ctx = c;
      drawField(ctx, homeTeam, awayTeam, fieldState);
      // Big banner
      ctx.fillStyle = `rgba(26,51,0,${0.4 + t * 0.4})`;
      ctx.fillRect(0, FIELD.H / 2 - 50, FIELD.W, 100);
      ctx.fillStyle = "#f0cc30";
      ctx.font = "bold 38px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🏈 " + play.desc, FIELD.W / 2, FIELD.H / 2);
    }};
  }

  // Default: just show the field with formation
  return { duration: 800, kind: play.kind, render: (t, c) => {
    ctx = c;
    drawField(c, homeTeam, awayTeam, fieldState);
    drawPlayers(formation.offense, formation.defense);
  }};
}

function drawKickoffFormation(ctx, homeTeam, awayTeam) {
  const cy = (FIELD.TOP + FIELD.BOT) / 2;
  // Kicking team (away) at their 35
  const kx = absYardToX(65);
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    drawPlayer(ctx, kx, cy + i * 12, awayTeam.primary, awayTeam.secondary);
  }
  drawPlayer(ctx, kx - 10, cy, awayTeam.primary, awayTeam.secondary, "K");
  // Receiving team (home) deep
  const rx = absYardToX(15);
  for (let i = -3; i <= 3; i++) {
    drawPlayer(ctx, rx, cy + i * 16, homeTeam.primary, homeTeam.secondary);
  }
  drawPlayer(ctx, absYardToX(8), cy, homeTeam.primary, homeTeam.secondary, "R");
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── CINEMA VIEW (side-camera, pixel-art sprites) ──────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

// Pixel codes: H=helmet, L=helmet stripe, F=facemask grille, J=jersey,
// N=back number, S=skin (arms/hands), P=pants, C=cleats, B=ball.
// Clean retro silhouette — minimal shading, lots of negative space.
const SPRITE_W = 20, SPRITE_H = 26;

// Anatomy-driven sprite system.
// Each frame combines a HEAD (rows 0-7), a TORSO (rows 8-16), and LEGS (rows 17-25).
// H=helmet, h=helmet-shade, L=stripe, F=facemask, V=visor-eye, J=jersey,
// j=jersey-shade, N=number, S=skin, s=skin-shade, P=pants, p=pants-shade,
// C=cleats, B=ball. Dots are transparent.

// Standard upright head — helmet with depth, facemask, visor eye holes, neck.
const _HEAD = [
  "......HHHHHHHH......",  // crown top
  ".....HhHHHHHHhH.....",  // crown with side shading
  "....HhhHHHHHHhhH....",  // widest part of helmet
  "....HLLLLLLLLLLH....",  // team-color stripe across top
  "....HFFFVFFVFFFH....",  // facemask + 2 visor pupils (eyes)
  "....HFFFFFFFFFFH....",  // lower facemask
  ".....HHHHHHHHHH.....",  // helmet base / jaw
  ".......SSSSSS.......",  // neck
];

// Torso: arms relaxed at sides, jersey w/ number on chest
const _TORSO_IDLE = [
  "....JJJJJJJJJJJJ....",  // shoulder pads top
  "...JJJJJJJJJJJJJJ...",  // shoulder pads spread
  "..SSJJJNNNNNNJJJSS..",  // upper arms (skin) + number on chest
  "..SSJJJNNNNNNJJJSS..",
  "..SSJJJNNNNNNJJJSS..",
  "..SSJJJJJJJJJJJJSS..",  // arms continue past number
  "..SSJJJJJJJJJJJJSS..",
  "...SSJJJJJJJJJJSS...",  // forearms taper in toward jersey
  "....JJJJJJJJJJJJ....",  // jersey hem / waist
];

// Standing legs — straight down, even stance
const _LEGS_STAND = [
  "....pPPPPPPPPPPp....",  // waistband shading
  "....PPP......PPP....",  // legs split
  "....PPP......PPP....",
  "....PPP......PPP....",
  "....PPP......PPP....",
  "....PPP......PPP....",
  "...PPPP......PPPP...",  // calves flare slightly
  "...CCC........CCC...",  // cleats
  "..CCC..........CCC..",  // cleat heels
];

const SPRITE_FRAMES = {
  // Idle — standing, arms at sides
  idle: [..._HEAD, ..._TORSO_IDLE, ..._LEGS_STAND],

  // Run A — back leg lifted (left), front leg planted (right side)
  run_a: [
    ..._HEAD,
    ..._TORSO_IDLE,
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP.......PP....",  // right leg drifts back, lifting
    "...PPP.........PP...",
    "..PPP..........PP...",
    ".PPP...........PPP..",
    "PPP............PPP..",
    "CCC.............CCC.",  // left cleat planted forward
    "CC...............CC.",
  ],

  // Run B — opposite stride, back leg lifted (right), front leg planted (left)
  run_b: [
    ..._HEAD,
    ..._TORSO_IDLE,
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PP.......PPP....",
    "...PP.........PPP...",
    "...PP..........PPP..",
    "..PPP...........PPP.",
    "..PPP............PPP",
    ".CCC.............CCC",
    ".CC...............CC",
  ],
  // Juke — whole sprite leans right (planted on left foot)
  // Juke — body leans right with the planted left foot
  juke: [
    "........HHHHHHHH....",
    ".......HhHHHHHHhH...",
    "......HhhHHHHHHhhH..",
    "......HLLLLLLLLLLH..",
    "......HFFFVFFVFFFH..",
    "......HFFFFFFFFFFH..",
    ".......HHHHHHHHHH...",
    ".........SSSSSS.....",
    "......JJJJJJJJJJJJ..",
    ".....JJJJJJJJJJJJJJ.",
    "....SSJJJNNNNNNJJJSS",
    "....SSJJJNNNNNNJJJSS",
    "....SSJJJNNNNNNJJJSS",
    "....SSJJJJJJJJJJJJSS",
    "....SSJJJJJJJJJJJJSS",
    ".....SSJJJJJJJJJJSS.",
    "......JJJJJJJJJJJJ..",
    "...pPPPPPPPPPPp.....",
    "..PPP........PPP....",
    "..PPP.........PPP...",
    ".PPP...........PPP..",
    ".PPP............PPP.",
    "PPP..............PP.",
    "PPP...............PP",
    "CCC...............CC",
    "CC.................C",
  ],

  // Stiff arm — right arm extends out at shoulder height
  stiff: [
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJSSS",
    "..SSJJJNNNNNNJJJSSSS",
    "..SSJJJNNNNNNJJJSSSS",
    "..SSJJJNNNNNNJJJSS..",
    "..SSJJJJJJJJJJJJSS..",
    "..SSJJJJJJJJJJJJSS..",
    "...SSJJJJJJJJJJSS...",
    "....JJJJJJJJJJJJ....",
    ..._LEGS_STAND,
  ],

  // Tackled — body crumpled on the ground (helmet at top, legs splayed below)
  tackled: [
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    "....JJJJJJJJJJJJ....",
    "...SJJJNNNNNNJJJS...",
    "...SJJJJJJJJJJJJS...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPPPPPPPPPPP....",
    "...CC..CC..CC..CC...",
    "....................",
    "....................",
    "....................",
    "....................",
  ],

  // Catch — both arms reaching up overhead (head shifts down to make room)
  catch: [
    "SS................SS",
    ".SS..............SS.",
    "..SS............SS..",
    "...SS..........SS...",
    "....SS........SS....",
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "...JJJJNNNNNNJJJJ...",
    "...JJJJJJJJJJJJJJ...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
  ],

  // Celebrate — both arms in a wide V
  celebrate: [
    "SS................SS",
    "SS................SS",
    ".SS..............SS.",
    "..SS............SS..",
    "...SS..........SS...",
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "...JJJJNNNNNNJJJJ...",
    "...JJJJJJJJJJJJJJ...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
  ],

  // Leap — diving reach: right arm extended way up-right, body tilted
  leap: [
    "................SSSS",
    "..............SSSS..",
    "............SSSS....",
    "..........SSSS......",
    "........SSSS........",
    "......HHHHHHHH......",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "..SSJJJNNNNNNJJJJ...",
    "..SSJJJNNNNNNJJJJ...",
    "..SSJJJJJJJJJJJJ....",
    "...SSJJJJJJJJJJ.....",
    "....pPPPPPPPPp......",
    "...PPP......PPP.....",
    "..PPP......PPP......",
    ".PPP......PPP.......",
    "PPP......PPP........",
    "CCC.......CCC.......",
    "CC.........CC.......",
  ],

  // Fist pump A — arm cocked back at shoulder height
  fist_a: [
    ..._HEAD,
    "....JJJJJJJJJJJJ....",
    "SSSJJJJJJJJJJJJJJ...",
    "SSSJJJNNNNNNJJJSS...",
    "SSSJJJNNNNNNJJJSS...",
    "..SJJJNNNNNNJJJSS...",
    "...JJJJJJJJJJJJSS...",
    "...SSJJJJJJJJJJSS...",
    "....JJJJJJJJJJJJ....",
    "....JJJJJJJJJJJJ....",
    ..._LEGS_STAND,
  ],

  // Fist pump B — fist punched up next to the head
  fist_b: [
    ".....SS.HHHHHHHH....",
    ".....SS.HhHHHHHHhH..",
    ".....SS.HhhHHHHHHhhH",
    "......SSHLLLLLLLLLLH",
    "........HFFFVFFVFFFH",
    "........HFFFFFFFFFFH",
    "........HHHHHHHHHH..",
    "..........SSSSSS....",
    ".......JJJJJJJJJJJJ.",
    "......JJJJJJJJJJJJJJ",
    ".....SSJJJNNNNNNJJJS",
    ".....SSJJJNNNNNNJJJS",
    ".....SSJJJNNNNNNJJJS",
    ".....SSJJJJJJJJJJJJS",
    "......SSJJJJJJJJJJS.",
    ".......JJJJJJJJJJJJ.",
    ".......pPPPPPPPPPPp.",
    ".......PPP......PPP.",
    ".......PPP......PPP.",
    ".......PPP......PPP.",
    ".......PPP......PPP.",
    ".......PPP......PPP.",
    "......PPPP......PPPP",
    "......CCC........CCC",
    ".....CCC..........CC",
    "....................",
  ],

  // Ref TD signal — both arms straight up
  ref_signal: [
    "SS..............SS..",
    "SS..............SS..",
    "SS..............SS..",
    "SS..............SS..",
    "SS....HHHHHHHH..SS..",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "...JJJJNNNNNNJJJJ...",
    "...JJJJNNNNNNJJJJ...",
    "....JJJJJJJJJJJJ....",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
    "....................",
  ],

  // Spike — football raised overhead, ready to slam
  spike: [
    "...........BBB......",
    "..........BBBBB.....",
    "..........BBBBB.....",
    "........SSBBB.......",
    "......HHSS..........",
    ".....HhHHHHHHhH.....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "..SSJJJNNNNNNJJJSS..",
    "..SSJJJNNNNNNJJJSS..",
    "...SSJJJJJJJJJJSS...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
  ],

  // Point sky — index finger raised straight up
  point_sky: [
    "........SS..........",
    "........SS..........",
    "........SS..........",
    ".......SSS..........",
    ".......SSHHHHHH.....",
    "......HHHHHHHHhH....",
    "....HhhHHHHHHhhH....",
    "....HLLLLLLLLLLH....",
    "....HFFFVFFVFFFH....",
    "....HFFFFFFFFFFH....",
    ".....HHHHHHHHHH.....",
    ".......SSSSSS.......",
    "....JJJJJJJJJJJJ....",
    "...JJJJJJJJJJJJJJ...",
    "..SSJJJNNNNNNJJJSS..",
    "..SSJJJNNNNNNJJJSS..",
    "...SSJJJJJJJJJJSS...",
    "....JJJJJJJJJJJJ....",
    "....pPPPPPPPPPPp....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "....PPP......PPP....",
    "...PPPP......PPPP...",
    "...CCC........CCC...",
    "..CCC..........CCC..",
  ],
};

// Pre-render sprite frames to offscreen canvases per team palette (cached)
const SPRITE_CACHE = new Map();
const SPRITE_SCALE = 5; // each sprite pixel = 5 canvas pixels (90×90 final)

function shade(color, factor) {
  if (color[0] !== "#") return color;
  const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
  return `rgb(${Math.min(255,(r*factor)|0)},${Math.min(255,(g*factor)|0)},${Math.min(255,(b*factor)|0)})`;
}

function getSpriteCanvas(team, frameKey, flipped, dimmed = false) {
  const cacheKey = `${team.primary}|${team.secondary}|${frameKey}|${flipped ? "L" : "R"}|${dimmed ? "d" : "n"}`;
  if (SPRITE_CACHE.has(cacheKey)) return SPRITE_CACHE.get(cacheKey);
  const grid = SPRITE_FRAMES[frameKey];
  const SCALE = SPRITE_SCALE;
  const cv = document.createElement("canvas");
  cv.width = SPRITE_W * SCALE;
  cv.height = SPRITE_H * SCALE;
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = false;
  const dim = (color) => dimmed ? shade(color, 0.78) : color;
  const helmet = dim(team.primary);
  const helmetShade = dim(shade(team.primary, 0.78));
  const stripe = dim(team.secondary);
  const jersey = dim(team.primary);
  const jerseyShade = dim(shade(team.primary, 0.82));
  const number = dim(team.secondary);
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === "." || ch === " ") continue;
      let color;
      switch (ch) {
        case "H": color = helmet; break;
        case "h": color = helmetShade; break;       // helmet shadow side
        case "L": color = stripe; break;             // helmet center stripe
        case "F": color = "#3a3f48"; break;          // facemask / visor (dark tint)
        case "V": color = "#1a1e26"; break;          // deeper visor band
        case "J": color = jersey; break;
        case "j": color = jerseyShade; break;        // jersey shadow side
        case "N": color = number; break;             // jersey number
        case "S": color = "#d6a878"; break;          // skin
        case "s": color = "#a87a52"; break;          // skin shadow
        case "P": color = "#f1f1f1"; break;          // pants
        case "p": color = "#bcbcbc"; break;          // pants shadow
        case "C": color = "#15151a"; break;          // cleats
        case "B": color = "#6b3416"; break;          // ball
        default:  color = jersey;
      }
      c.fillStyle = color;
      const drawCol = flipped ? (line.length - 1 - col) : col;
      c.fillRect(drawCol * SCALE, row * SCALE, SCALE, SCALE);
    }
  }
  SPRITE_CACHE.set(cacheKey, cv);
  return cv;
}

// Pre-rendered black silhouette of the sprite, used for the outline halo
function getSpriteSilhouette(frameKey, flipped) {
  const key = `__silh|${frameKey}|${flipped ? "L" : "R"}`;
  if (SPRITE_CACHE.has(key)) return SPRITE_CACHE.get(key);
  const grid = SPRITE_FRAMES[frameKey];
  const SCALE = SPRITE_SCALE;
  const cv = document.createElement("canvas");
  cv.width = SPRITE_W * SCALE;
  cv.height = SPRITE_H * SCALE;
  const c = cv.getContext("2d");
  c.imageSmoothingEnabled = false;
  c.fillStyle = "#08080c";
  for (let row = 0; row < grid.length; row++) {
    const line = grid[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === "." || ch === " ") continue;
      const drawCol = flipped ? (line.length - 1 - col) : col;
      c.fillRect(drawCol * SCALE, row * SCALE, SCALE, SCALE);
    }
  }
  SPRITE_CACHE.set(key, cv);
  return cv;
}

// In TOP-DOWN view, sprites are anchored at their vertical center on (x, y).
// `faceSeed`: optional 0..1 — when provided, draws a generated face + sunglasses.
function drawSprite(ctx, x, y, team, frameKey, flipped, dimmed, faceSeed) {
  const cv = getSpriteCanvas(team, frameKey, flipped, dimmed);
  const sx = Math.round(x - cv.width / 2);
  const sy = Math.round(y - cv.height / 2);
  // Ground shadow at player's feet (just below sprite center)
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(Math.round(x), Math.round(y) + cv.height * 0.35, 26, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // 4-direction outline stamp for crisp silhouette against grass
  const sil = getSpriteSilhouette(frameKey, flipped);
  ctx.drawImage(sil, sx - 2, sy);
  ctx.drawImage(sil, sx + 2, sy);
  ctx.drawImage(sil, sx, sy - 2);
  ctx.drawImage(sil, sx, sy + 2);
  ctx.drawImage(cv, sx, sy);
  if (faceSeed != null) drawFace(ctx, x, y, faceSeed, flipped);
}

// Sort sprites by their lateral Y so further-back players draw first
function drawSpriteList(ctx, sprites) {
  sprites.sort((a, b) => (a.sortY ?? a.y) - (b.sortY ?? b.y));
  for (const s of sprites) {
    drawSprite(ctx, s.x, s.y, s.team, s.frame, s.flipped, s.dimmed, s.faceSeed);
  }
}

// ─── Top-down field rendering ──────────────────────────────────────────────
const CINEMA = {
  fieldTop: 50,         // top sideline screen Y
  fieldBot: 390,        // bottom sideline screen Y
  fieldCenterY: 220,    // mid-field screen Y
  lateralPxPerYard: 6.0, // 53.3 yds × 6 = 320 px (fits)
  pxPerYard: 24,        // horizontal yards
  // groundY kept as alias for any legacy plays that draw "center field"
  get groundY() { return this.fieldCenterY; },
};

let cinemaCamX = 0;     // camera world-X (in yards × pxPerYard)
let cinemaCalloutTimeout = null;

// World X (in pixels, where 0 = home goal line) → screen X
function worldToScreenX(wx) {
  return wx - cinemaCamX + FIELD.W / 2;
}
function yardToWorldX(yard) { return yard * CINEMA.pxPerYard; }
// Lateral position in yards (0 = mid-field, ±26.6 = sidelines) → screen Y
function lateralToScreenY(lat) { return CINEMA.fieldCenterY + lat * CINEMA.lateralPxPerYard; }

function drawCinemaField(ctx, homeTeam, awayTeam, fieldState) {
  // Out-of-bounds (dark band above/below the field)
  ctx.fillStyle = "#0c0c10";
  ctx.fillRect(0, 0, FIELD.W, FIELD.H);
  // Painted sideline pad — off-white strip just past the top chalk so the
  // sideline reads as the edge of a painted surface, not a line floating
  // against the dark cinematic frame. Only the top is painted; the area
  // below CINEMA.fieldBot is the cinematic player-sprite zone (cinema
  // mode draws player bodies extending downward from the field), where a
  // pad would clash with the sprites.
  {
    const padDepth = 30;
    ctx.fillStyle = "#d9cfb9";
    ctx.fillRect(0, CINEMA.fieldTop - padDepth, FIELD.W, padDepth);
    const topGrad = ctx.createLinearGradient(0, CINEMA.fieldTop - padDepth, 0, CINEMA.fieldTop);
    topGrad.addColorStop(0, "rgba(0,0,0,0.55)");
    topGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, CINEMA.fieldTop - padDepth, FIELD.W, padDepth);
  }
  // Grass field
  const fieldGrad = ctx.createLinearGradient(0, CINEMA.fieldTop, 0, CINEMA.fieldBot);
  fieldGrad.addColorStop(0, "#1e5a2c");
  fieldGrad.addColorStop(0.5, "#247536");
  fieldGrad.addColorStop(1, "#1e5a2c");
  ctx.fillStyle = fieldGrad;
  ctx.fillRect(0, CINEMA.fieldTop, FIELD.W, CINEMA.fieldBot - CINEMA.fieldTop);
  // Mowed alternating bands (every 5 yards)
  for (let yard = -10; yard < 110; yard += 5) {
    const x = worldToScreenX(yardToWorldX(yard));
    if (x < -60 || x > FIELD.W + 60) continue;
    if ((Math.floor(yard / 5)) % 2 === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(x, CINEMA.fieldTop, 5 * CINEMA.pxPerYard, CINEMA.fieldBot - CINEMA.fieldTop);
    }
  }
  // End zones — colored team panels
  const homeEZx = worldToScreenX(yardToWorldX(0));
  const awayEZx = worldToScreenX(yardToWorldX(100));
  ctx.fillStyle = homeTeam.primary + "d0";
  ctx.fillRect(homeEZx - 10 * CINEMA.pxPerYard, CINEMA.fieldTop, 10 * CINEMA.pxPerYard, CINEMA.fieldBot - CINEMA.fieldTop);
  ctx.fillStyle = awayTeam.primary + "d0";
  ctx.fillRect(awayEZx, CINEMA.fieldTop, 10 * CINEMA.pxPerYard, CINEMA.fieldBot - CINEMA.fieldTop);
  // End zone wordmarks (sideways like real fields)
  ctx.save();
  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = homeTeam.secondary;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.translate(homeEZx - 5 * CINEMA.pxPerYard, CINEMA.fieldCenterY);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(homeTeam.name.toUpperCase(), 0, 0);
  ctx.restore();
  ctx.save();
  ctx.font = "bold 30px sans-serif";
  ctx.fillStyle = awayTeam.secondary;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.translate(awayEZx + 5 * CINEMA.pxPerYard, CINEMA.fieldCenterY);
  ctx.rotate(Math.PI / 2);
  ctx.fillText(awayTeam.name.toUpperCase(), 0, 0);
  ctx.restore();
  // Goal lines (thick white)
  for (const gx of [homeEZx, awayEZx]) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(gx, CINEMA.fieldTop);
    ctx.lineTo(gx, CINEMA.fieldBot);
    ctx.stroke();
  }
  // Sidelines
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, CINEMA.fieldTop); ctx.lineTo(FIELD.W, CINEMA.fieldTop);
  ctx.moveTo(0, CINEMA.fieldBot); ctx.lineTo(FIELD.W, CINEMA.fieldBot);
  ctx.stroke();
  // Yard lines (vertical, full lateral field span)
  for (let yard = 0; yard <= 100; yard += 5) {
    const x = worldToScreenX(yardToWorldX(yard));
    if (x < -10 || x > FIELD.W + 10) continue;
    const isMajor = yard % 10 === 0;
    ctx.strokeStyle = isMajor ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)";
    ctx.lineWidth = isMajor ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, CINEMA.fieldTop);
    ctx.lineTo(x, CINEMA.fieldBot);
    ctx.stroke();
    if (isMajor && yard > 0 && yard < 100) {
      const label = yard <= 50 ? yard : 100 - yard;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, CINEMA.fieldTop + 22);
      ctx.fillText(label, x, CINEMA.fieldBot - 22);
    }
  }
  // Hash marks (small ticks at every yard, in two rows)
  const hashTop = CINEMA.fieldCenterY - CINEMA.lateralPxPerYard * 6.5;
  const hashBot = CINEMA.fieldCenterY + CINEMA.lateralPxPerYard * 6.5;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  for (let yard = 1; yard < 100; yard++) {
    if (yard % 5 === 0) continue;
    const x = worldToScreenX(yardToWorldX(yard));
    if (x < 0 || x > FIELD.W) continue;
    ctx.beginPath();
    ctx.moveTo(x, hashTop - 4); ctx.lineTo(x, hashTop + 4);
    ctx.moveTo(x, hashBot - 4); ctx.lineTo(x, hashBot + 4);
    ctx.stroke();
  }
  // LOS marker (blue vertical)
  if (fieldState && fieldState.losYard !== undefined) {
    const lx = worldToScreenX(yardToWorldX(fieldState.losYard));
    ctx.strokeStyle = "rgba(60,180,255,0.85)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(lx, CINEMA.fieldTop);
    ctx.lineTo(lx, CINEMA.fieldBot);
    ctx.stroke();
  }
  // First-down marker (yellow vertical)
  if (fieldState && fieldState.fdYard !== undefined && fieldState.fdYard >= 0 && fieldState.fdYard <= 100) {
    const fx = worldToScreenX(yardToWorldX(fieldState.fdYard));
    ctx.strokeStyle = "rgba(255,200,40,0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(fx, CINEMA.fieldTop);
    ctx.lineTo(fx, CINEMA.fieldBot);
    ctx.stroke();
  }
}

function showCallout(text) {
  const el = document.getElementById("cinemaCallout");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  if (cinemaCalloutTimeout) clearTimeout(cinemaCalloutTimeout);
  cinemaCalloutTimeout = setTimeout(() => el.classList.remove("show"), 900);
}

function clearCallout() {
  const el = document.getElementById("cinemaCallout");
  if (el) el.classList.remove("show");
}

// Draw a chunky football icon at (x,y). Used to "enlarge the hand" on catches.
function drawBigFootball(ctx, x, y, size = 24) {
  ctx.save();
  // Drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 2, size, size * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // Dark outline
  ctx.fillStyle = "#2a1408";
  ctx.beginPath();
  ctx.ellipse(x, y, size + 2, size * 0.62 + 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body
  ctx.fillStyle = "#8a4520";
  ctx.beginPath();
  ctx.ellipse(x, y, size, size * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // Top highlight
  ctx.fillStyle = "#b06030";
  ctx.beginPath();
  ctx.ellipse(x - size * 0.25, y - size * 0.18, size * 0.55, size * 0.18, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Laces
  ctx.strokeStyle = "#fafafa";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - size * 0.42, y);
  ctx.lineTo(x + size * 0.42, y);
  for (let i = -2; i <= 2; i++) {
    ctx.moveTo(x + i * size * 0.16, y - 4);
    ctx.lineTo(x + i * size * 0.16, y + 4);
  }
  ctx.stroke();
  ctx.restore();
}

// Draw a pop-up callout above a player ("CAUGHT!", "PICK!", etc.)
function drawHeadCallout(ctx, x, y, text, color, scale = 1) {
  ctx.save();
  const fontSize = Math.round(26 * scale);
  ctx.font = `900 ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padX = 12 * scale;
  const w = ctx.measureText(text).width + padX * 2;
  const h = fontSize + 12;
  const cy = y - h - 4;
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  roundedRect(ctx, x - w / 2, cy - h / 2, w, h, 6);
  ctx.fill();
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundedRect(ctx, x - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1, 6);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillText(text, x, cy + 1);
  // Tail pointer below the pill
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.beginPath();
  ctx.moveTo(x - 7, cy + h / 2);
  ctx.lineTo(x + 7, cy + h / 2);
  ctx.lineTo(x, cy + h / 2 + 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Helper: pseudo-random bool from a play & seed number
function playSeed(play, salt) {
  const s = ((play.startYard ?? 0) * 31 + (play.quarter ?? 0) * 17 + (play.time ?? 0) + salt) | 0;
  return ((Math.sin(s) + 1) / 2) % 1;
}

// Hash a player name to a stable 0..1 for face-pattern selection
function nameSeed(name, salt = 0) {
  if (!name) return 0;
  let h = salt | 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return ((h >>> 0) % 10000) / 10000;
}

// Draw a generated face with COOL SUNGLASSES over the sprite's helmet area.
// (x, y) = sprite center; faceSeed = 0..1 deterministic per player
function drawFace(ctx, x, y, faceSeed, flipped) {
  // Helmet face opening is roughly at the top-center of the sprite, slightly
  // forward of center. With SCALE 5 and SPRITE_W=18/H=18, sprite spans ±45px.
  // Face sits in the upper third.
  const cx = x + (flipped ? -6 : 6);
  const cy = y - 20;
  const sx = flipped ? -1 : 1;
  ctx.save();
  // Skin patch peeking through helmet (subtle, just adds variation)
  const skinTones = ["#e8b890", "#c9905e", "#8a5a3a", "#5d3b22"];
  const skin = skinTones[Math.floor(faceSeed * skinTones.length) % skinTones.length];
  // Sunglasses style (8 variations)
  const style = Math.floor(faceSeed * 8) % 8;
  ctx.translate(cx, cy);
  // Different sunglass shapes (drawn relative to face center)
  // The "lens" colors mostly black, sometimes mirrored / colored
  const lensColors = ["#0a0a10", "#0a0a10", "#101820", "#1a0a1a", "#0a1010"];
  const lensColor = lensColors[Math.floor(faceSeed * 100) % lensColors.length];
  ctx.fillStyle = lensColor;
  ctx.strokeStyle = "#15151a";
  ctx.lineWidth = 1.5;
  switch (style) {
    case 0: { // Aviators (teardrop)
      ctx.beginPath(); ctx.ellipse(-7 * sx, 0, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(+7 * sx, 0, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#888"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-1 * sx, -1); ctx.lineTo(1 * sx, -1); ctx.stroke();
      break;
    }
    case 1: { // Wayfarers (wide rectangles)
      ctx.fillRect(-14, -4, 11, 8);
      ctx.fillRect(+3, -4, 11, 8);
      ctx.fillStyle = "#222";
      ctx.fillRect(-3, -2, 6, 2);
      // glint
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      ctx.fillRect(-12, -3, 2, 2);
      ctx.fillRect(+5, -3, 2, 2);
      break;
    }
    case 2: { // Round Lennon
      ctx.beginPath(); ctx.arc(-7 * sx, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(+7 * sx, 0, 5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 3: { // Sport visor wraparound (single band)
      ctx.fillRect(-14, -3, 28, 7);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(-12, -3, 6, 2);
      break;
    }
    case 4: { // Tiny round mafia shades
      ctx.beginPath(); ctx.arc(-6 * sx, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(+6 * sx, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 5: { // Oversized squares
      ctx.fillRect(-16, -6, 13, 11);
      ctx.fillRect(+3, -6, 13, 11);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(-14, -5, 3, 3);
      ctx.fillRect(+5, -5, 3, 3);
      break;
    }
    case 6: { // Cat-eye (sloped)
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-14, 1); ctx.lineTo(-2, -2); ctx.lineTo(-2, 4); ctx.lineTo(-14, 5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(14, 1); ctx.lineTo(2, -2); ctx.lineTo(2, 4); ctx.lineTo(14, 5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      break;
    }
    case 7: { // Mirrored chrome
      ctx.fillStyle = "#666";
      ctx.fillRect(-14, -4, 11, 9);
      ctx.fillRect(+3, -4, 11, 9);
      ctx.fillStyle = "#bbb";
      ctx.fillRect(-13, -4, 11, 3);
      ctx.fillRect(+4, -4, 11, 3);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(-11, -3, 2, 1);
      ctx.fillRect(+6, -3, 2, 1);
      break;
    }
  }
  // Optional facial hair (33% chance)
  if (faceSeed > 0.66) {
    ctx.fillStyle = "#1a1208";
    if (faceSeed > 0.85) {
      // Full beard
      ctx.fillRect(-7, 6, 14, 4);
    } else {
      // Goatee / chinstrap
      ctx.fillRect(-3, 7, 6, 3);
    }
  }
  ctx.restore();
}

// Top-down goalposts at (cx, cy) — the goal line cross-bar and uprights span lateral Y.
// In top-down view, the goalposts look like an H with the crossbar running along the
// goal line vertically (in screen Y), and the uprights extending into the end zone (X).
function drawTopDownGoalposts(ctx, cx, cy) {
  const POST_LAT = CINEMA.lateralPxPerYard * 3.1; // ~3.1 yds from center to each upright
  const POST_BACK = 60;                            // how far behind goal line the uprights extend
  ctx.save();
  ctx.strokeStyle = "#ffe048";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255,224,72,0.5)";
  ctx.shadowBlur = 6;
  // Crossbar (between uprights, along Y axis)
  ctx.beginPath();
  ctx.moveTo(cx, cy - POST_LAT);
  ctx.lineTo(cx, cy + POST_LAT);
  ctx.stroke();
  // Two uprights extending back from crossbar
  ctx.beginPath();
  ctx.moveTo(cx, cy - POST_LAT); ctx.lineTo(cx + POST_BACK, cy - POST_LAT);
  ctx.moveTo(cx, cy + POST_LAT); ctx.lineTo(cx + POST_BACK, cy + POST_LAT);
  ctx.stroke();
  // Support pole (front of crossbar, lateral center)
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - 14, cy);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Base disc
  ctx.fillStyle = "#ffe048";
  ctx.beginPath();
  ctx.arc(cx - 16, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Draw a TD-style firework burst at (x, y)
function drawFirework(ctx, x, y, t01, hue) {
  // t01: 0 → 1 expansion. Particle radius grows; alpha fades.
  if (t01 < 0 || t01 > 1) return;
  const N = 14;
  const maxR = 90;
  const r = maxR * t01;
  const alpha = 1 - t01 * t01;
  ctx.save();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    const sparkSize = 4 - t01 * 2;
    ctx.fillStyle = `hsla(${hue + (i * 7)}, 95%, ${70 - t01 * 30}%, ${alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, sparkSize), 0, Math.PI * 2);
    ctx.fill();
    // Trailing dot
    const px2 = x + Math.cos(a) * r * 0.7;
    const py2 = y + Math.sin(a) * r * 0.7;
    ctx.fillStyle = `hsla(${hue + (i * 7)}, 95%, ${85 - t01 * 30}%, ${alpha * 0.55})`;
    ctx.beginPath();
    ctx.arc(px2, py2, Math.max(0.8, sparkSize * 0.55), 0, Math.PI * 2);
    ctx.fill();
  }
  // Central flash
  if (t01 < 0.25) {
    ctx.fillStyle = `rgba(255,255,255,${(1 - t01 * 4) * 0.7})`;
    ctx.beginPath();
    ctx.arc(x, y, 10 * (1 - t01 * 4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Multiple staggered fireworks over the field
function drawFireworksShow(ctx, ageMs) {
  const seeds = [
    { x: 200, y: 130, hue: 50,  delay: 0    },
    { x: 800, y: 110, hue: 0,   delay: 220  },
    { x: 500, y: 90,  hue: 270, delay: 400  },
    { x: 320, y: 160, hue: 120, delay: 700  },
    { x: 680, y: 140, hue: 200, delay: 950  },
    { x: 150, y: 180, hue: 30,  delay: 1200 },
    { x: 850, y: 190, hue: 320, delay: 1400 },
    { x: 500, y: 130, hue: 60,  delay: 1700 },
  ];
  const lifetime = 900; // ms per burst
  for (const s of seeds) {
    const localT = (ageMs - s.delay) / lifetime;
    drawFirework(ctx, s.x, s.y, localT, s.hue);
  }
}

// Draw little floating "taunt" emote text rising above (x, y)
function drawTaunt(ctx, x, y, text, color, t01) {
  const rise = 30 * t01;
  const alpha = t01 < 0.15 ? t01 / 0.15 : (t01 > 0.7 ? (1 - t01) / 0.3 : 1);
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.font = "900 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, x, y - rise);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y - rise);
  ctx.restore();
}

// Stable per-play taunt pick
function pickTaunt(play, salt = 0) {
  const opts = ["LET'S GOOO!", "TOO EASY", "ALL DAY!", "SIX!!", "CAN'T STOP ME", "GIVE ME MY MONEY", "TALK TO ME NOW", "WHO?!", "BIG TIME", "CASH IT IN"];
  const seed = ((play.startYard ?? 0) * 31 + (play.time ?? 0) + salt) | 0;
  return opts[((seed >>> 0) % opts.length)];
}

// ─── Celebration animation system ─────────────────────────────────────────
// A celebration is a sequence of frames the player cycles through, plus an
// optional MvC-style portrait popup with grinning face.
const CELEBRATIONS = {
  FIST_PUMP:  { frames: ["fist_a", "fist_b", "fist_a", "fist_b"], shoutWords: ["YESSSS!", "C'MON!", "LIGHT IT UP!"] },
  REF_SIGNAL: { frames: ["ref_signal", "celebrate", "ref_signal", "celebrate"], shoutWords: ["TOUCHDOWN!", "REFS CAN'T STOP ME", "SIX MORE!"] },
  SPIKE:      { frames: ["spike", "spike", "celebrate", "fist_b"], shoutWords: ["SPIKE IT!", "BOOM!", "PUT IT DOWN"] },
  POINT_SKY:  { frames: ["point_sky", "point_sky", "celebrate", "point_sky"], shoutWords: ["BLESSED!", "THANK YOU LORD", "UP THERE!"] },
  DANCE:      { frames: ["juke", "stiff", "juke", "celebrate"], shoutWords: ["GET BUCKETS!", "WHO?!", "TOO EASY"] },
};
const CELEBRATION_NAMES = Object.keys(CELEBRATIONS);

function pickCelebration(play, salt = 0) {
  const seed = ((play.startYard ?? 0) * 41 + (play.time ?? 0) + salt) | 0;
  return CELEBRATION_NAMES[((seed >>> 0) % CELEBRATION_NAMES.length)];
}
function pickShout(celebKey, play, salt = 0) {
  const c = CELEBRATIONS[celebKey];
  const seed = ((play.startYard ?? 0) * 53 + (play.time ?? 0) + salt) | 0;
  return c.shoutWords[((seed >>> 0) % c.shoutWords.length)];
}
function getCelebFrame(celebKey, t01) {
  const c = CELEBRATIONS[celebKey];
  const idx = Math.min(c.frames.length - 1, Math.floor(t01 * c.frames.length));
  return c.frames[idx];
}

// MvC-style portrait popup of the celebrating player. (x, y) = anchor;
// portrait slides in from off-screen, bounces, and slides out.
//   t01: 0 → 1 over the popup lifetime
//   side: "left" or "right" — which side of the screen the portrait sits
//   team: the player's team (for jersey color), faceSeed: for the face
//   playerName: appears in the nameplate
function drawPortraitPopup(ctx, t01, side, team, faceSeed, playerName, shoutText) {
  if (t01 < 0 || t01 > 1) return;
  const W = 220, H = 200;
  const targetX = side === "left" ? 30 : FIELD.W - W - 30;
  const targetY = 40;
  // Slide in (0..0.18), hold (0.18..0.78), slide out (0.78..1)
  let slideT;
  if (t01 < 0.18) slideT = t01 / 0.18;
  else if (t01 < 0.78) slideT = 1;
  else slideT = 1 - (t01 - 0.78) / 0.22;
  const startX = side === "left" ? -W - 20 : FIELD.W + 20;
  const x = startX + (targetX - startX) * easeOutCubic(slideT);
  const y = targetY;
  // Pulse scale during hold (subtle breathing)
  const holdPhase = (t01 > 0.18 && t01 < 0.78) ? (t01 - 0.18) / 0.6 : 0;
  const pulse = 1 + Math.sin(holdPhase * Math.PI * 3) * 0.025;
  ctx.save();
  ctx.translate(x + W / 2, y + H / 2);
  ctx.scale(pulse, pulse);
  ctx.translate(-W / 2, -H / 2);
  // Speed-line backdrop — diagonal slashes radiating from center
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  const cxBg = W / 2, cyBg = H / 2;
  const lineCount = 18;
  for (let i = 0; i < lineCount; i++) {
    const ang = (i / lineCount) * Math.PI * 2 + t01 * 0.5;
    const hue = (i * 18 + t01 * 90) % 360;
    ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 0.5)`;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(cxBg, cyBg);
    ctx.lineTo(cxBg + Math.cos(ang) * 400, cyBg + Math.sin(ang) * 400);
    ctx.stroke();
  }
  // Dark vignette so face pops
  const grad = ctx.createRadialGradient(cxBg, cyBg, 30, cxBg, cyBg, 140);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  // Frame border (comic-book style)
  ctx.lineWidth = 5;
  ctx.strokeStyle = team.secondary || "#f0cc30";
  ctx.strokeRect(2, 2, W - 4, H - 4);
  ctx.lineWidth = 2;
  ctx.strokeStyle = team.primary || "#000";
  ctx.strokeRect(6, 6, W - 12, H - 12);
  // BIG portrait of the player — draw the celebrate sprite scaled up to fill the frame
  const cv = getSpriteCanvas(team, "celebrate", false, false);
  const portraitScale = (H - 40) / cv.height * 1.4;  // crop helmet area
  const pw = cv.width * portraitScale;
  const ph = cv.height * portraitScale;
  ctx.save();
  ctx.beginPath(); ctx.rect(10, 10, W - 20, H - 50); ctx.clip();
  // Show only the upper portion (head + shoulders)
  ctx.drawImage(cv, W / 2 - pw / 2, H / 2 - ph / 2 - 10);
  // Big grinning face overlaid on top of the helmet area
  drawFace(ctx, W / 2 + 3, H / 2 - ph * 0.28, faceSeed, false);
  // Add a grin (white teeth)
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(W / 2 - 8, H / 2 - ph * 0.18, 16, 4);
  ctx.fillStyle = "#000";
  for (let i = 0; i < 4; i++) ctx.fillRect(W / 2 - 6 + i * 4, H / 2 - ph * 0.18, 1, 4);
  ctx.restore();
  // Nameplate at bottom
  ctx.fillStyle = team.primary || "#000";
  ctx.fillRect(10, H - 42, W - 20, 30);
  ctx.lineWidth = 2;
  ctx.strokeStyle = team.secondary || "#fff";
  ctx.strokeRect(10, H - 42, W - 20, 30);
  ctx.fillStyle = team.secondary || "#fff";
  ctx.font = "900 16px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText((playerName || "STAR").toUpperCase(), W / 2, H - 27);
  // Shout bubble at top
  if (shoutText) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    const shoutW = 130, shoutH = 26;
    roundedRect(ctx, W / 2 - shoutW / 2, -8, shoutW, shoutH, 6);
    ctx.fill();
    ctx.strokeStyle = "#f0cc30";
    ctx.lineWidth = 2;
    roundedRect(ctx, W / 2 - shoutW / 2 + 0.5, -8 + 0.5, shoutW - 1, shoutH - 1, 6);
    ctx.stroke();
    ctx.fillStyle = "#f0cc30";
    ctx.font = "900 14px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(shoutText, W / 2, 6);
    ctx.restore();
  }
  ctx.restore();
}

// Decide if a juke fires this play, weighted by hidden athleticism.
// Without career hidden stats wired in, fall back to a base rate.
function decideMoves(play, offRatings, defRatings) {
  const moves = []; // [{ at: t01, kind: "JUKE" | "STIFF_ARM" | "BROKEN_TACKLE" }]
  if (play.kind !== "run" && play.kind !== "complete") return moves;
  const yards = play.yards ?? 0;
  // Big runs more likely to feature a move
  const bigPlay = yards >= 10;
  const r = playSeed(play, 11);
  const r2 = playSeed(play, 23);
  const r3 = playSeed(play, 41);
  if (yards >= 6 && r < (bigPlay ? 0.55 : 0.22)) {
    moves.push({ at: 0.40 + r2 * 0.15, kind: "JUKE" });
  }
  if (yards >= 8 && r2 < 0.22) {
    moves.push({ at: 0.55 + r3 * 0.1, kind: "STIFF ARM" });
  }
  if (bigPlay && r3 < 0.30) {
    moves.push({ at: 0.62 + r * 0.1, kind: "BROKEN TACKLE" });
  }
  return moves;
}

// ─── Cinema animation builder ─────────────────────────────────────────────

function buildCinemaAnim(play, prevPlay) {
  const homeTeam = gameResult.homeTeam, awayTeam = gameResult.awayTeam;

  // Markers
  if (["halftime", "ot", "quarter"].includes(play.kind)) {
    return { duration: 1200, kind: play.kind, render: (t, ctx) => {
      drawCinemaField(ctx, homeTeam, awayTeam, null);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, FIELD.W, FIELD.H);
      ctx.fillStyle = "#f0cc30";
      ctx.font = "bold 42px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(play.desc, FIELD.W / 2, FIELD.H / 2);
    }};
  }

  if (play.kind === "score") {
    const isTD = (play.desc || "").toLowerCase().includes("touchdown");
    const isFG = (play.desc || "").toLowerCase().includes("fg");
    return { duration: isTD ? 2200 : 1200, kind: "score", render: (t, ctx) => {
      drawCinemaField(ctx, homeTeam, awayTeam, null);
      ctx.fillStyle = `rgba(10,16,4,${0.55 + t * 0.3})`;
      ctx.fillRect(0, FIELD.H / 2 - 60, FIELD.W, 120);
      ctx.fillStyle = isTD ? "#f0cc30" : isFG ? "#9be09b" : "#ffffff";
      ctx.font = "900 44px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🏈 " + play.desc, FIELD.W / 2, FIELD.H / 2);
      if (isTD) {
        const ageMs = t * 2200;
        drawFireworksShow(ctx, ageMs);
      }
    }};
  }

  // play.startYard is already possession-relative (0 = offense's own goal, 100 = defense EZ).
  // Cinema view always orients offense → right.
  const poss = play.poss;
  const offTeam = poss === "home" ? homeTeam : awayTeam;
  const defTeam = poss === "home" ? awayTeam : homeTeam;
  const offRatings = poss === "home" ? gameResult.homeRatings : gameResult.awayRatings;
  const defRatings = poss === "home" ? gameResult.awayRatings : gameResult.homeRatings;
  const startYardAbs = play.startYard;
  const endYardAbs = play.endYard ?? play.startYard;
  const fdYardAbs = play.down > 0 ? clamp(startYardAbs + play.ytg, 0, 100) : -1;
  const losWX = yardToWorldX(startYardAbs);
  const endWX = yardToWorldX(endYardAbs);

  // Camera follows the ball carrier, slightly leading the action
  function setCamFromCarrier(carrierWX) {
    const lead = (endWX - losWX) * 0.15;
    cinemaCamX = carrierWX + lead;
  }

  const moves = decideMoves(play, offRatings, defRatings);

  // ── RUN PLAY (top-down) ───────────────────────────────────────────────
  if (play.kind === "run") {
    const yards = play.yards ?? 0;
    const isTD = (play.endYard ?? 0) >= 100;
    const isBig = yards >= 15;
    const rusherSeed = nameSeed(play.rusher);
    const qbSeed = nameSeed(play.passer || "QB");
    // Scale cinema duration with the run so big plays have time to develop
    // (was a flat 2400ms — 80-yd TDs covered the field in ~2 seconds).
    const cinDur = Math.round(clamp(1800 + Math.abs(yards) * 70, 1900, 7500) + (isTD ? 1000 : 600));
    return { duration: cinDur, kind: "run", render: (t, ctx) => {
      const PRE = 0.14;
      let carrierWX, runT = 0;
      const carrierStartWX = losWX - 7 * CINEMA.pxPerYard;
      if (t < PRE) {
        carrierWX = carrierStartWX;
      } else {
        runT = (t - PRE) / (1 - PRE);
        // Linear-with-mild-easeIn — no more easeOutCubic teleport on big plays.
        const eased = runT < 0.12
                    ? (runT * runT) / 0.24
                    : 0.06 + ((runT - 0.12) / 0.88) * 0.94;
        carrierWX = carrierStartWX + (endWX - carrierStartWX) * Math.min(1, eased * 1.05);
      }
      // Determine active "move" (juke / stiff / broken tackle)
      let activeMove = null;
      for (const m of moves) { if (Math.abs(t - m.at) < 0.05) { activeMove = m; break; } }
      // Lateral wobble for carrier (more for juke)
      let carrierLat = activeMove?.kind === "JUKE" ? Math.sin(t * 24) * 3 : Math.sin(t * 4) * 0.6;
      setCamFromCarrier(carrierWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs, fdYard: fdYardAbs });

      // Collect all player sprites, sort by lateral Y for proper layering
      const sprites = [];
      // OL — 5 across LOS, lateralY -4.5 .. +4.5
      const olLats = [-4.5, -2.2, 0, 2.2, 4.5];
      for (let i = 0; i < 5; i++) {
        const surge = t < PRE ? 0 : runT * 22;
        const olWX = losWX - 0.7 * CINEMA.pxPerYard + surge + Math.sin(t * 6 + i) * 2;
        const frame = t < PRE ? "idle" : (Math.floor(t * 7 + i) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(olWX), y: lateralToScreenY(olLats[i]), team: offTeam, frame, flipped: false, faceSeed: nameSeed("OL", i) });
      }
      // TE on the right
      sprites.push({ x: worldToScreenX(losWX - 0.7 * CINEMA.pxPerYard), y: lateralToScreenY(7), team: offTeam, frame: t < PRE ? "idle" : "run_a", flipped: false, faceSeed: nameSeed("TE") });
      // WR1 (left wide), WR2 (right wide) — they run downfield blocking
      sprites.push({ x: worldToScreenX(losWX + (t < PRE ? 0 : runT * 30)), y: lateralToScreenY(-22), team: offTeam, frame: t < PRE ? "idle" : "run_b", flipped: false, faceSeed: nameSeed("WR1") });
      sprites.push({ x: worldToScreenX(losWX + (t < PRE ? 0 : runT * 30)), y: lateralToScreenY(20), team: offTeam, frame: t < PRE ? "idle" : "run_a", flipped: false, faceSeed: nameSeed("WR2") });
      // QB — hands off then trails
      const qbWX = losWX - 5 * CINEMA.pxPerYard;
      const qbFrame = t < PRE ? "idle" : "stiff";
      sprites.push({ x: worldToScreenX(qbWX), y: lateralToScreenY(0.5), team: offTeam, frame: qbFrame, flipped: false, faceSeed: qbSeed });
      // Carrier (RB)
      let carrierFrame;
      if (t < PRE) carrierFrame = "idle";
      else if (activeMove) {
        if (activeMove.kind === "JUKE") carrierFrame = "juke";
        else if (activeMove.kind === "STIFF ARM") carrierFrame = "stiff";
        else carrierFrame = "run_a";
        if (!play._calloutsFired) play._calloutsFired = new Set();
        if (!play._calloutsFired.has(activeMove.kind)) {
          play._calloutsFired.add(activeMove.kind);
          showCallout(activeMove.kind);
        }
      } else carrierFrame = (Math.floor(t * 10) % 2 === 0) ? "run_a" : "run_b";
      if (runT > 0.88 && yards < 90 && !isTD) carrierFrame = "tackled";
      // TD celebration on the carrier
      if (isTD && runT > 0.85) carrierFrame = "celebrate";
      sprites.push({ x: worldToScreenX(carrierWX), y: lateralToScreenY(carrierLat), team: offTeam, frame: carrierFrame, flipped: false, faceSeed: rusherSeed });

      // Defenders — DL, LB, S, CB
      const dlLats = [-3.8, -1.3, 1.3, 3.8];
      for (let i = 0; i < 4; i++) {
        const dlStartWX = losWX + 0.8 * CINEMA.pxPerYard;
        const dWX = dlStartWX + (t > PRE ? Math.min(1, runT * 1.3) * (carrierWX - dlStartWX) * 0.85 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(dlLats[i] + (carrierLat - dlLats[i]) * Math.min(0.5, runT * 0.5)), team: defTeam, frame, flipped: true, faceSeed: nameSeed("DL", i) });
      }
      const lbLats = [-5, 0, 5];
      for (let i = 0; i < 3; i++) {
        const lbStartWX = losWX + 5 * CINEMA.pxPerYard;
        const dWX = lbStartWX + (t > PRE ? Math.min(1, runT * 1.0) * (carrierWX - lbStartWX) * 0.95 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i + 4) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(lbLats[i] + (carrierLat - lbLats[i]) * Math.min(0.6, runT * 0.7)), team: defTeam, frame, flipped: true, faceSeed: nameSeed("LB", i) });
      }
      // Safeties (deep)
      for (let i = 0; i < 2; i++) {
        const sLat = i === 0 ? -9 : 9;
        const sStartWX = losWX + 12 * CINEMA.pxPerYard;
        const dWX = sStartWX + (t > PRE && yards > 5 ? Math.min(1, runT) * (carrierWX - sStartWX) * 0.7 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i + 8) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(sLat + (carrierLat - sLat) * Math.min(0.4, runT * 0.5)), team: defTeam, frame, flipped: true, faceSeed: nameSeed("S", i) });
      }
      // Corners on the wide receivers
      for (const [lat, salt] of [[-22, 0], [20, 1]]) {
        sprites.push({ x: worldToScreenX(losWX + 4 * CINEMA.pxPerYard + (t > PRE ? runT * 20 : 0)), y: lateralToScreenY(lat), team: defTeam, frame: t < PRE ? "idle" : "run_b", flipped: true, faceSeed: nameSeed("CB", salt) });
      }

      drawSpriteList(ctx, sprites);

      // BIG PLAY taunt floating above the carrier
      if (isBig && runT > 0.70 && runT < 0.96 && !isTD) {
        const tauntT = (runT - 0.70) / 0.26;
        drawTaunt(ctx, worldToScreenX(carrierWX), lateralToScreenY(carrierLat) - 60, pickTaunt(play, 0), "#f0cc30", tauntT);
      }
      // TD fireworks
      if (isTD && runT > 0.82) {
        const ageMs = (runT - 0.82) * 2400;
        drawFireworksShow(ctx, ageMs);
      }

      // Reset callouts at start of next play
      if (t < 0.05 && play._calloutsFired) play._calloutsFired = null;
    }};
  }

  // ── PASS PLAYS (complete / incomplete / int) ──────────────────────────
  if (play.kind === "complete" || play.kind === "incomplete" || play.kind === "int") {
    const isComplete = play.kind === "complete";
    const isInt      = play.kind === "int";
    const targetDepth = play.targetDepth || 10;
    const targetWX_view = losWX + targetDepth * CINEMA.pxPerYard;
    // Pick a target receiver lateral position deterministically (WR1 left, WR2 right, TE slot, RB short)
    // Use the play seed to keep it stable.
    const recRoll = playSeed(play, 99);
    const recLat = recRoll < 0.4 ? -20 : recRoll < 0.7 ? 18 : recRoll < 0.88 ? 7 : -3;
    // "Highlight" catches get a longer freeze + CAUGHT! callout
    const yardsGained = play.yards ?? 0;
    const isDeep      = targetDepth >= 18;
    const isBigCatch  = yardsGained >= 25;
    const isTD        = isComplete && (play.endYard ?? 0) >= 100;
    const isHighlight = isComplete && (isDeep || isBigCatch || isTD);
    const FREEZE_MS = isComplete ? (isHighlight ? 850 : 280) : (isInt ? 700 : 0);
    // Scale cinema pass duration with depth/yards so deep balls + big YAC
    // catches don't teleport (was a flat 2400ms for everything).
    const passSpan  = Math.max(targetDepth, yardsGained, 8);
    const baseDur   = Math.round(clamp(1800 + passSpan * 55, 2000, 6500) + (isTD ? 800 : 0));
    const totalDur  = baseDur + FREEZE_MS;
    const ARRIVE = 0.62;
    const F1 = (ARRIVE * baseDur) / totalDur;
    const F2 = (ARRIVE * baseDur + FREEZE_MS) / totalDur;
    const mapT = FREEZE_MS === 0 ? (x => x) : (x => {
      if (x <= F1) return x * ARRIVE / F1;
      if (x <= F2) return ARRIVE;
      return ARRIVE + (x - F2) * (1 - ARRIVE) / (1 - F2);
    });
    const passerSeed = nameSeed(play.passer);
    const rcvrSeed   = nameSeed(play.receiver || play.intended);
    return { duration: totalDur, kind: play.kind, render: (tNew, ctx) => {
      const t = mapT(tNew);
      const inFreeze = FREEZE_MS > 0 && tNew > F1 && tNew < F2;
      const freezePhase = inFreeze ? (tNew - F1) / (F2 - F1) : 0;
      const PRE = 0.16, DROP = 0.34;
      let qbWX = losWX - 5 * CINEMA.pxPerYard, ballWX, ballArc = 0;
      let ballLat = 0;  // lateral position of ball
      let carrierWX = losWX - 1 * CINEMA.pxPerYard, carrierLat = recLat;
      // Ball animation
      if (t < PRE) { ballWX = qbWX; ballLat = 0.5; }
      else if (t < DROP) {
        const tt = (t - PRE) / (DROP - PRE);
        qbWX = losWX - 5 * CINEMA.pxPerYard - tt * 3.2 * CINEMA.pxPerYard;
        ballWX = qbWX; ballLat = 0.5;
      } else if (t < ARRIVE) {
        const tt = (t - DROP) / (ARRIVE - DROP);
        qbWX = losWX - 7.7 * CINEMA.pxPerYard;
        ballWX = qbWX + (targetWX_view - qbWX) * tt;
        ballLat = 0.5 + (recLat - 0.5) * tt;
        ballArc = Math.sin(tt * Math.PI) * 95;
      } else {
        const tt = (t - ARRIVE) / (1 - ARRIVE);
        qbWX = losWX - 7.7 * CINEMA.pxPerYard;
        if (isComplete) {
          ballWX = targetWX_view + (endWX - targetWX_view) * easeOutCubic(tt);
          carrierWX = ballWX;
        } else if (isInt) {
          // The defender (interceptor) takes the ball back the OTHER direction
          ballWX = targetWX_view - tt * 60;
          ballLat = recLat + (0 - recLat) * tt; // drifts to mid-field
        } else {
          ballWX = targetWX_view;
          ballLat = recLat;
        }
      }
      if (inFreeze) setCamFromCarrier(targetWX_view);
      else setCamFromCarrier(t < ARRIVE ? (qbWX + targetWX_view) / 2 : carrierWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs, fdYard: fdYardAbs });
      if (inFreeze) {
        const vignette = Math.sin(freezePhase * Math.PI) * 0.28;
        ctx.fillStyle = `rgba(0,0,0,${vignette})`;
        ctx.fillRect(0, 0, FIELD.W, FIELD.H);
      }

      const sprites = [];
      // OL — pass-block, slight retreat
      const olLats = [-4.5, -2.2, 0, 2.2, 4.5];
      for (let i = 0; i < 5; i++) {
        const olWX = losWX - 0.7 * CINEMA.pxPerYard - Math.min(t, 0.5) * 22 + Math.sin(t * 5 + i) * 2;
        const frame = "idle";
        sprites.push({ x: worldToScreenX(olWX), y: lateralToScreenY(olLats[i]), team: offTeam, frame, flipped: false, faceSeed: nameSeed("OL", i) });
      }
      // QB
      const qbFrame = t < PRE ? "idle" : (t < DROP ? "run_b" : (t < ARRIVE ? "stiff" : (isInt && t > ARRIVE + 0.1 ? "tackled" : "idle")));
      sprites.push({ x: worldToScreenX(qbWX), y: lateralToScreenY(0.5), team: offTeam, frame: qbFrame, flipped: false, faceSeed: passerSeed });
      // Receivers — WR1 (-20), WR2 (+18), TE (+7), RB (-3 shallow)
      const routes = [
        { lat: -20, depth: targetDepth + 2, faceSeed: nameSeed("WR1"), isTarget: Math.abs(recLat - (-20)) < 5 },
        { lat: 18,  depth: targetDepth + 1, faceSeed: nameSeed("WR2"), isTarget: Math.abs(recLat - 18)  < 5 },
        { lat: 7,   depth: Math.min(targetDepth, 12), faceSeed: nameSeed("TE"), isTarget: Math.abs(recLat - 7) < 5 },
        { lat: -3,  depth: 4, faceSeed: nameSeed("RB"), isTarget: Math.abs(recLat - (-3)) < 5 },
      ];
      const catchWindow = (t > ARRIVE - 0.08 && t < ARRIVE + 0.05) || inFreeze;
      for (const route of routes) {
        const routeProgress = Math.min(1, t / ARRIVE);
        const wrWX = losWX + 4 + routeProgress * route.depth * CINEMA.pxPerYard;
        let wx = wrWX, lat = route.lat;
        let frame;
        if (route.isTarget) {
          if (t < PRE) frame = "idle";
          else if (inFreeze && isComplete) frame = isHighlight ? "leap" : "catch";
          else if (catchWindow && isComplete) frame = isHighlight ? "leap" : "catch";
          else if (catchWindow && isInt) frame = "tackled";
          else if (t > ARRIVE && isComplete) { wx = carrierWX; lat = recLat; frame = (Math.floor(t * 10) % 2 === 0) ? "run_a" : "run_b"; }
          else if (isTD && t > 0.92) frame = "celebrate";
          else frame = (Math.floor(t * 10) % 2 === 0) ? "run_a" : "run_b";
        } else {
          if (t < PRE) frame = "idle";
          else frame = (Math.floor(t * 10) % 2 === 0) ? "run_a" : "run_b";
        }
        sprites.push({ x: worldToScreenX(wx), y: lateralToScreenY(lat), team: offTeam, frame, flipped: false, faceSeed: route.faceSeed });
      }
      // Defenders — DL rush, LB drops, CB on WRs, S deep
      const dlLats = [-3.5, -1.2, 1.2, 3.5];
      for (let i = 0; i < 4; i++) {
        const dlStartWX = losWX + 0.8 * CINEMA.pxPerYard;
        const dWX = dlStartWX + Math.min(1, t / ARRIVE) * (qbWX - dlStartWX) * 0.85;
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(dlLats[i]), team: defTeam, frame, flipped: true, faceSeed: nameSeed("DL", i) });
      }
      const lbLats = [-5, 0, 5];
      for (let i = 0; i < 3; i++) {
        const lbStartWX = losWX + 4.5 * CINEMA.pxPerYard;
        const dWX = lbStartWX + (t > PRE ? Math.min(1, t / ARRIVE) * 18 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i + 4) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(lbLats[i]), team: defTeam, frame, flipped: true, faceSeed: nameSeed("LB", i) });
      }
      // Corners on WRs
      for (const [lat, salt] of [[-20, 0], [18, 1]]) {
        const cbStartWX = losWX + 4 * CINEMA.pxPerYard;
        let cbX = cbStartWX + Math.min(1, t / ARRIVE) * targetDepth * CINEMA.pxPerYard * 0.82;
        let cbLat = lat;
        // If this CB is the interceptor (closest to recLat), they GRAB the ball
        const isInterceptor = isInt && Math.abs(lat - recLat) < 5;
        if (isInterceptor && t > ARRIVE - 0.05) {
          // Move toward the ball pickup point, then run back the other way
          if (t < ARRIVE) {
            cbX = targetWX_view - 18;
            cbLat = recLat + 2;
          } else {
            const tt = (t - ARRIVE) / (1 - ARRIVE);
            cbX = targetWX_view - 18 - tt * 80;
            cbLat = recLat + 2;
          }
        }
        const cbFrame = isInterceptor && catchWindow ? "catch" : (Math.floor(t * 10 + salt) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(cbX), y: lateralToScreenY(cbLat), team: defTeam, frame: cbFrame, flipped: !isInterceptor || t < ARRIVE, faceSeed: nameSeed("CB", salt) });
      }
      // Safeties (deep)
      for (let i = 0; i < 2; i++) {
        const sLat = i === 0 ? -9 : 9;
        const sStartWX = losWX + 12 * CINEMA.pxPerYard;
        const dWX = sStartWX + (t > PRE && isComplete && t > ARRIVE ? Math.min(1, t - ARRIVE) * (carrierWX - sStartWX) * 0.8 : 0);
        const frame = t < PRE ? "idle" : (Math.floor(t * 9 + i + 8) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(sLat), team: defTeam, frame, flipped: true, faceSeed: nameSeed("S", i) });
      }

      drawSpriteList(ctx, sprites);

      // Ball indicator (not during freeze unless incomplete — then big football)
      if (!inFreeze) {
        // Shadow on field beneath ball
        const ballScreenX = worldToScreenX(ballWX);
        const ballGroundY = lateralToScreenY(ballLat);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(ballScreenX, ballGroundY, 5, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        // Ball
        ctx.fillStyle = "#8a4520";
        ctx.beginPath();
        ctx.ellipse(ballScreenX, ballGroundY - ballArc, 7, 4.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillRect(ballScreenX - 2, ballGroundY - ballArc - 1, 4, 1);
      } else if (isComplete) {
        const wrScreenX = worldToScreenX(carrierWX);
        const wrScreenY = lateralToScreenY(recLat);
        const popScale = 1 + Math.sin(freezePhase * Math.PI) * 0.45;
        const handY = wrScreenY - 50;
        drawBigFootball(ctx, wrScreenX + (isHighlight ? 30 : 0), handY, 26 * popScale);
        if (isHighlight) {
          const cScale = 0.85 + Math.sin(Math.min(1, freezePhase * 2.5) * Math.PI * 0.5) * 0.35;
          drawHeadCallout(ctx, wrScreenX, wrScreenY - 88, "CAUGHT!", "#f0cc30", cScale);
        } else if (freezePhase < 0.55) {
          drawHeadCallout(ctx, wrScreenX, wrScreenY - 80, "CATCH", "#9be09b", 0.75);
        }
      } else if (isInt) {
        // Ball secured by the DB — show big football at interceptor's hands + giant PICK! callout
        const interceptorLat = recLat + 2;
        const intX = worldToScreenX(targetWX_view - 18);
        const intY = lateralToScreenY(interceptorLat);
        const popScale = 1 + Math.sin(freezePhase * Math.PI) * 0.45;
        drawBigFootball(ctx, intX + 12, intY - 48, 26 * popScale);
        const cScale = 0.85 + Math.sin(Math.min(1, freezePhase * 2.5) * Math.PI * 0.5) * 0.4;
        drawHeadCallout(ctx, intX, intY - 92, "PICK!", "#e07070", cScale);
      }

      // TD fireworks
      if (isTD && t > 0.88 && !inFreeze) {
        const ageMs = (t - 0.88) * totalDur;
        drawFireworksShow(ctx, ageMs);
      }
      // BIG PLAY taunt
      if (isComplete && !isTD && yardsGained >= 20 && t > ARRIVE + 0.18 && t < 0.96) {
        const tauntT = (t - (ARRIVE + 0.18)) / (0.96 - (ARRIVE + 0.18));
        drawTaunt(ctx, worldToScreenX(carrierWX), lateralToScreenY(recLat) - 70, pickTaunt(play, 1), "#f0cc30", tauntT);
      }

      // Move callouts on YAC
      if (isComplete && t > ARRIVE && !inFreeze) {
        const yacT = (t - ARRIVE) / (1 - ARRIVE);
        for (const m of moves) {
          const localAt = (m.at - ARRIVE) / (1 - ARRIVE);
          if (Math.abs(yacT - localAt) < 0.04) {
            if (!play._calloutsFired) play._calloutsFired = new Set();
            if (!play._calloutsFired.has(m.kind)) {
              play._calloutsFired.add(m.kind);
              showCallout(m.kind);
            }
          }
        }
      }
      if (tNew < 0.05 && play._calloutsFired) play._calloutsFired = null;
    }};
  }

  // ── SACK (top-down) ───────────────────────────────────────────────────
  if (play.kind === "sack") {
    const passerSeed = nameSeed(play.passer);
    return { duration: 1700, kind: "sack", render: (t, ctx) => {
      const qbWX = losWX - 5 * CINEMA.pxPerYard - Math.min(1, t * 1.5) * 60;
      setCamFromCarrier(qbWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs, fdYard: fdYardAbs });

      const sprites = [];
      const olLats = [-4.5, -2.2, 0, 2.2, 4.5];
      for (let i = 0; i < 5; i++) {
        const olWX = losWX - 0.7 * CINEMA.pxPerYard - Math.min(t * 1.5, 0.7) * 25 + Math.sin(t * 6 + i) * 2;
        sprites.push({ x: worldToScreenX(olWX), y: lateralToScreenY(olLats[i]), team: offTeam, frame: "idle", flipped: false, faceSeed: nameSeed("OL", i) });
      }
      const qbFrame = t > 0.85 ? "tackled" : (t > 0.4 ? "stiff" : "run_b");
      sprites.push({ x: worldToScreenX(qbWX), y: lateralToScreenY(0.5), team: offTeam, frame: qbFrame, flipped: false, faceSeed: passerSeed });
      // Pass rusher (from edge, closes on QB)
      const rusherStart = losWX + 4 * CINEMA.pxPerYard;
      const rusherWX = rusherStart + (qbWX - rusherStart) * easeOutCubic(t);
      const rusherLat = 3 + (0.5 - 3) * easeOutCubic(t);
      const rFrame = t > 0.85 ? "tackled" : (Math.floor(t * 10) % 2 === 0 ? "run_a" : "run_b");
      sprites.push({ x: worldToScreenX(rusherWX), y: lateralToScreenY(rusherLat), team: defTeam, frame: rFrame, flipped: true, faceSeed: nameSeed("DL", 7) });
      // Other DL contributing pressure
      const dlLats = [-3.5, -1.2, 1.2];
      for (let i = 0; i < 3; i++) {
        const dWX = losWX + 0.8 * CINEMA.pxPerYard + Math.min(1, t * 1.3) * (qbWX - losWX) * 0.6;
        const frame = (Math.floor(t * 9 + i) % 2 === 0) ? "run_a" : "run_b";
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(dlLats[i]), team: defTeam, frame, flipped: true, faceSeed: nameSeed("DL", i) });
      }
      drawSpriteList(ctx, sprites);
      // Show the pass-rush move callout BEFORE the sack lands (mid-rush)
      if (t > 0.55 && t < 0.85 && play.dlMove && !play._moveFired) {
        play._moveFired = true;
        showCallout(`💥 ${play.dlMove}!`);
      }
      if (t > 0.85 && !play._sackFired) {
        play._sackFired = true;
        showCallout("SACK!");
      }
      if (t < 0.05) { play._sackFired = false; play._moveFired = false; }
    }};
  }

  // ── FG / PUNT / FUMBLE / KICKOFF — top-down ───────────────────────────
  if (play.kind === "fg_good" || play.kind === "fg_miss") {
    const isGood = play.kind === "fg_good";
    const kickerSeed = nameSeed(play.kicker);
    // Determine miss type deterministically
    const missRoll = playSeed(play, 77);
    const missType = isGood ? "good" : (missRoll < 0.5 ? (missRoll < 0.25 ? "wide_l" : "wide_r") : "short");
    return { duration: 2600, kind: play.kind, render: (t, ctx) => {
      const holderWX = losWX - 7 * CINEMA.pxPerYard;
      const goalWX = yardToWorldX(110); // goalpost back of end zone
      let ballWX, ballArc = 0, ballLat = 0;
      if (t < 0.22) { ballWX = holderWX; }
      else {
        const tt = (t - 0.22) / 0.78;
        let reach = 1;
        if (missType === "wide_l") ballLat = -3.5 * Math.min(1, tt * 1.2);
        else if (missType === "wide_r") ballLat = 3.5 * Math.min(1, tt * 1.2);
        else if (missType === "short") { reach = 0.72; }
        ballWX = holderWX + (goalWX - holderWX) * tt * reach;
        ballArc = Math.sin(tt * Math.PI) * 200 * (missType === "short" ? 0.6 : 1);
      }
      setCamFromCarrier((holderWX + goalWX) / 2);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs });
      // Big top-down goalposts (drawn in screen coords past the goal line).
      // In broadcast cam the stadium goalposts are already drawn standing
      // up on the upright overlay; skip the flat H here to avoid doubling.
      if (cameraMode !== "broadcast") {
        drawTopDownGoalposts(ctx, worldToScreenX(goalWX), lateralToScreenY(0));
      }
      const sprites = [];
      sprites.push({ x: worldToScreenX(holderWX), y: lateralToScreenY(0), team: offTeam, frame: t > 0.3 ? "stiff" : "idle", flipped: false, faceSeed: kickerSeed });
      sprites.push({ x: worldToScreenX(holderWX - 25), y: lateralToScreenY(0.5), team: offTeam, frame: "tackled", flipped: false, faceSeed: nameSeed("Holder") });
      const lineLats = [-4, -2, 0, 2, 4];
      for (let i = 0; i < 5; i++) {
        sprites.push({ x: worldToScreenX(losWX - 0.7 * CINEMA.pxPerYard), y: lateralToScreenY(lineLats[i]), team: offTeam, frame: "idle", flipped: false, faceSeed: nameSeed("OL", i) });
      }
      const dLats = [-3, 0, 3];
      for (let i = 0; i < 3; i++) {
        sprites.push({ x: worldToScreenX(losWX + 1 * CINEMA.pxPerYard + Math.min(t, 0.4) * 20), y: lateralToScreenY(dLats[i]), team: defTeam, frame: t > 0.3 ? "leap" : "idle", flipped: true, faceSeed: nameSeed("DL", i) });
      }
      drawSpriteList(ctx, sprites);
      // Ball
      const bsX = worldToScreenX(ballWX);
      const bsY = lateralToScreenY(ballLat) - ballArc;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(bsX, lateralToScreenY(ballLat), 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a4520";
      ctx.beginPath(); ctx.ellipse(bsX, bsY, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(bsX - 2, bsY - 1, 4, 1);
      // Result banner
      if (t > 0.82) {
        const banT = Math.min(1, (t - 0.82) / 0.18);
        ctx.save();
        ctx.globalAlpha = banT;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(0, 18, FIELD.W, 64);
        ctx.fillStyle = isGood ? "#f0cc30" : "#e07070";
        ctx.font = "900 44px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(isGood ? "IT'S GOOD!" : missType === "short" ? "NO GOOD — SHORT!" : missType === "wide_l" ? "NO GOOD — WIDE LEFT" : "NO GOOD — WIDE RIGHT", FIELD.W / 2, 50);
        ctx.restore();
        if (isGood && t > 0.92) {
          const ageMs = (t - 0.92) * 2600;
          drawFireworksShow(ctx, ageMs);
        }
      }
    }};
  }

  if (play.kind === "punt") {
    const punterSeed = nameSeed(play.kicker || play.passer);
    const returnerLat = (playSeed(play, 51) - 0.5) * 14;
    const landYardAbs = play.landYard ?? play.endYard ?? play.startYard;
    const landWX = yardToWorldX(landYardAbs);
    const returnYards = play.returnYards || 0;
    const isTouchback = !!play.isTouchback;
    const isFairCatch = !!play.isFairCatch;
    const isReturnTD  = !!play.isReturnTD;
    // The return goes BACK toward the punting team's end zone (away from landWX)
    const finalWX = yardToWorldX(play.endYard ?? landYardAbs);
    // Direction returner is running, normalized (-1 or +1 in world coords)
    const runSign = Math.sign(finalWX - landWX) || -1;
    // Scale duration with return yards so big returns have time to develop
    const dur = isTouchback ? 2400
              : isFairCatch ? 2400
              : Math.round(3000 + Math.min(returnYards, 70) * 40);
    return { duration: dur, kind: "punt", render: (t, ctx) => {
      const punterWX = losWX - 12 * CINEMA.pxPerYard;
      // Phases — return now gets ~46% of the animation (no more 28% teleport)
      const PHASE_AIR_START = 0.18;
      const PHASE_AIR_END   = 0.46;
      const PHASE_FIELD_END = 0.54;
      const RET_LEN = 1 - PHASE_FIELD_END;
      let ballWX, ballArc = 0, ballLat = 0;
      let carrierWX = landWX, carrierLat = returnerLat;
      let phase = "snap";
      if (t < PHASE_AIR_START) {
        ballWX = punterWX; phase = "snap";
      } else if (t < PHASE_AIR_END) {
        const tt = (t - PHASE_AIR_START) / (PHASE_AIR_END - PHASE_AIR_START);
        ballWX = punterWX + (landWX - punterWX) * tt;
        ballArc = Math.sin(tt * Math.PI) * 220;
        ballLat = returnerLat * tt;
        phase = "air";
      } else if (t < PHASE_FIELD_END) {
        ballWX = landWX; ballLat = returnerLat;
        phase = "field";
      } else {
        const tt = (t - PHASE_FIELD_END) / RET_LEN;
        if (isTouchback || isFairCatch) {
          ballWX = landWX; ballLat = returnerLat;
        } else {
          // Linear-with-mild-easeIn — no more easeOutCubic teleport.
          const eased = tt < 0.15
                      ? (tt * tt) / 0.30
                      : 0.075 + ((tt - 0.15) / 0.85) * 0.925;
          carrierWX = landWX + (finalWX - landWX) * eased;
          carrierLat = returnerLat + Math.sin(tt * 6) * 1.8;
          ballWX = carrierWX; ballLat = carrierLat;
        }
        phase = "return";
      }
      setCamFromCarrier(phase === "return" ? carrierWX : ballWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs });

      const sprites = [];
      // Punter
      // Punter actually punts — kick pose during snap+wind+early air,
      // follow-through during air, stiff after the ball is gone.
      let pframe = "idle", pT = 0;
      if (t < 0.08)        { pframe = "idle";  pT = 0; }
      else if (t < 0.18)   { pframe = "kick";  pT = (t - 0.08) / 0.10 * 0.5; }
      else if (t < 0.30)   { pframe = "kick";  pT = 0.5 + (t - 0.18) / 0.12 * 0.5; }
      else                 { pframe = "stiff"; pT = 0; }
      sprites.push({ x: worldToScreenX(punterWX), y: lateralToScreenY(0), team: offTeam, frame: pframe, frameT: pT, flipped: false, faceSeed: punterSeed });
      // Punter's protection
      const lineLats = [-4, -2, 0, 2, 4];
      for (let i = 0; i < 5; i++) {
        sprites.push({ x: worldToScreenX(losWX - 0.7 * CINEMA.pxPerYard), y: lateralToScreenY(lineLats[i]), team: offTeam, frame: "idle", flipped: false, faceSeed: nameSeed("OL", i) });
      }
      // Gunners (coverage team) — sprint downfield. 3 will be picked up by
      // blockers, 1 stays free as the eventual tackler.
      const gunnerPositions = [];
      for (let i = 0; i < 4; i++) {
        const gStartWX = losWX + (i - 1.5) * 18;
        const isFree = (i === 3);
        let gWX, gLat;
        if (phase !== "return") {
          const gT = Math.min(1, t * 1.1);
          gWX = gStartWX + (landWX - gStartWX) * gT;
          gLat = (i - 1.5) * 6 + (returnerLat - ((i - 1.5) * 6)) * Math.min(1, t * 1.2) * 0.6;
        } else {
          const tt = (t - PHASE_FIELD_END) / RET_LEN;
          if (isFree) {
            // Free gunner closes on the returner — pursuit angle, arrives at end
            gWX = landWX + (carrierWX - landWX) * (0.35 + tt * 0.65);
            gLat = (i - 1.5) * 6 + (carrierLat - (i - 1.5) * 6) * Math.min(1, tt * 1.3);
          } else {
            // Engaged gunner — held by blocker, AHEAD of returner in run direction
            const aheadOffset = runSign * (22 - i * 3) * CINEMA.pxPerYard / 3;
            gWX = carrierWX + aheadOffset + Math.sin(tt * 5 + i) * 1.4;
            gLat = (i - 1.5) * 5 + (carrierLat - (i - 1.5) * 5) * 0.4;
          }
        }
        gunnerPositions.push({ wx: gWX, lat: gLat, isFree });
        const isEngagedG = phase === "return" && !isFree;
        const frame = isEngagedG ? "stiff" : ((Math.floor(t * 11 + i) % 2 === 0) ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(gWX), y: lateralToScreenY(gLat), team: offTeam, frame, flipped: isEngagedG, faceSeed: nameSeed("G", i) });
      }
      // Blockers for the returner — engaged with their assigned gunner during return
      const numBlockers = 3;
      for (let i = 0; i < numBlockers; i++) {
        const target = gunnerPositions[i];
        let bWX, bLat;
        if (phase === "snap" || phase === "air") {
          const angle = (i / numBlockers - 0.5);
          bWX = landWX + 14 + i * 6;
          bLat = returnerLat + angle * 8;
        } else if (phase === "field") {
          bWX = (target.wx + landWX) / 2;
          bLat = (target.lat + returnerLat) / 2;
        } else {
          // RETURN — glue to the gunner, on the returner side (visible engagement)
          bWX = target.wx - runSign * (CINEMA.pxPerYard * 0.6);
          bLat = target.lat + (carrierLat - target.lat) * 0.10;
        }
        const frame = (phase === "return" || phase === "field") ? "stiff" : "idle";
        sprites.push({ x: worldToScreenX(bWX), y: lateralToScreenY(bLat), team: defTeam, frame, flipped: false, faceSeed: nameSeed("Blocker", i) });
      }
      // Returner
      let returnerFrame;
      if (phase === "snap" || phase === "air") returnerFrame = "idle";
      else if (phase === "field") returnerFrame = "catch";
      else if (isReturnTD && t > 0.92) returnerFrame = "celebrate";
      else returnerFrame = (Math.floor(t * 11) % 2 === 0) ? "run_a" : "run_b";
      sprites.push({ x: worldToScreenX(carrierWX), y: lateralToScreenY(carrierLat), team: defTeam, frame: returnerFrame, flipped: true, faceSeed: nameSeed("Returner") });

      drawSpriteList(ctx, sprites);
      // Ball
      const bsX = worldToScreenX(ballWX);
      const bsY = lateralToScreenY(ballLat) - ballArc;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(bsX, lateralToScreenY(ballLat), 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a4520";
      ctx.beginPath(); ctx.ellipse(bsX, bsY, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(bsX - 2, bsY - 1, 4, 1);

      // Callouts
      if (phase === "field" && !play._catchFired) {
        play._catchFired = true;
        if (isTouchback) showCallout("TOUCHBACK");
        else if (isFairCatch) showCallout("FAIR CATCH");
        else showCallout("FIELDED!");
      }
      if (phase === "return" && returnYards >= 20 && t > 0.85 && !play._bigRetFired) {
        play._bigRetFired = true;
        showCallout(returnYards >= 40 ? "TAKE IT TO THE HOUSE!" : "BIG RETURN!");
      }
      if (isReturnTD && t > 0.94) {
        const ageMs = (t - 0.94) * dur;
        drawFireworksShow(ctx, ageMs);
      }
      if (t < 0.05) { play._catchFired = false; play._bigRetFired = false; }
    }};
  }

  if (play.kind === "kickoff") {
    return { duration: 1800, kind: "kickoff", render: (t, ctx) => {
      const kickerWX = yardToWorldX(35);
      const landWX = yardToWorldX(75);
      const ballWX = kickerWX + (landWX - kickerWX) * t;
      const arc = Math.sin(t * Math.PI) * 220;
      setCamFromCarrier(ballWX);
      drawCinemaField(ctx, homeTeam, awayTeam, null);
      drawSprite(ctx, worldToScreenX(kickerWX), lateralToScreenY(0), awayTeam, t > 0.2 ? "stiff" : "idle", false, false, nameSeed("Kicker"));
      const bsX = worldToScreenX(ballWX);
      const bsY = lateralToScreenY(0) - arc;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(bsX, lateralToScreenY(0), 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a4520";
      ctx.beginPath(); ctx.ellipse(bsX, bsY, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
    }};
  }

  if (play.kind === "fumble") {
    const rusherSeed = nameSeed(play.rusher);
    return { duration: 1900, kind: "fumble", render: (t, ctx) => {
      setCamFromCarrier(losWX);
      drawCinemaField(ctx, homeTeam, awayTeam, { losYard: startYardAbs });
      // Ball bounces around wildly
      const wobX = losWX + 30 + Math.sin(t * 18) * 26;
      const wobLat = Math.cos(t * 12) * 4;
      const bsX = worldToScreenX(wobX);
      const bsY = lateralToScreenY(wobLat) - Math.abs(Math.sin(t * 12)) * 22;
      const sprites = [];
      // Fumbling player (collapsed)
      sprites.push({ x: worldToScreenX(losWX), y: lateralToScreenY(0), team: offTeam, frame: "tackled", flipped: false, faceSeed: rusherSeed });
      // Defenders piling in
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2;
        const dWX = losWX + Math.cos(angle) * 40 * (1 - t * 0.8);
        const dLat = Math.sin(angle) * 5 * (1 - t * 0.8);
        const frame = t > 0.6 ? "tackled" : (Math.floor(t * 12 + i) % 2 === 0 ? "run_a" : "run_b");
        sprites.push({ x: worldToScreenX(dWX), y: lateralToScreenY(dLat), team: defTeam, frame, flipped: true, faceSeed: nameSeed("D", i) });
      }
      drawSpriteList(ctx, sprites);
      // Bouncing ball
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.ellipse(bsX, lateralToScreenY(wobLat), 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8a4520";
      ctx.beginPath(); ctx.ellipse(bsX, bsY, 8, 5, Math.sin(t * 8), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(bsX - 2, bsY - 1, 4, 1);
      // Giant FUMBLE! callout
      if (t > 0.25) {
        const cT = Math.min(1, (t - 0.25) / 0.2);
        const cScale = 0.7 + cT * 0.6;
        ctx.save();
        ctx.globalAlpha = cT;
        drawHeadCallout(ctx, FIELD.W / 2, 70, "FUMBLE!", "#e07070", cScale);
        ctx.restore();
      }
      if (t > 0.6 && !play._fumbleFired) {
        play._fumbleFired = true;
        showCallout("RECOVERED!");
      }
      if (t < 0.05) play._fumbleFired = false;
    }};
  }

  // Fallback: scoreboard hold
  return { duration: 600, kind: play.kind, render: (t, ctx) => {
    drawCinemaField(ctx, homeTeam, awayTeam, null);
  }};
}

// ═══════════════════════════════════════════════════════════════════════════
// Play-result digest card — big banner that holds for ~1.4s after each play
// ═══════════════════════════════════════════════════════════════════════════
const RESULT_HOLD_MS = 2100;

// "Tom Brady" → "BRADY" (last token, uppercased).
function lastNameUpper(name) {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1].toUpperCase();
}

function formatPlayResult(play) {
  if (!play) return null;
  const yards = play.yards ?? 0;
  const passer = lastNameUpper(play.passer);
  const rusher = lastNameUpper(play.rusher);
  const rcvr   = lastNameUpper(play.receiver);
  const kicker = lastNameUpper(play.kicker);
  const intended = lastNameUpper(play.intended);
  switch (play.kind) {
    case "run": {
      const isTD = (play.endYard ?? 0) >= 100;
      const isFirstDown = !isTD && play.down > 0 && yards >= (play.ytg ?? 0);
      const verb = play.isScramble ? "scrambles" : play.isQBRun ? "keeps it" : "runs";
      const noun = play.isScramble ? "SCRAMBLE" : play.isQBRun ? "QB KEEPER" : "RUN";
      const carryLabel = play.isScramble ? "Scramble" : play.isQBRun ? "Keeper" : "Carry";
      if (isTD) {
        const tdSub = play.isScramble ? `${yards}-yard scramble by ${rusher}`
                   : play.isQBRun     ? `${yards}-yard QB keeper from ${rusher}`
                   :                    `${yards} yards on the ground from ${rusher}`;
        return { title: "TOUCHDOWN!", sub: tdSub, color: "#f0cc30", big: true };
      }
      if (yards < 0)   return { title: "TACKLE FOR LOSS", sub: `${rusher} stopped for ${yards}`, color: "#e07070" };
      if (yards === 0) return { title: "NO GAIN", sub: `${rusher} stuffed at the line`, color: "#cccccc" };
      if (isFirstDown) return { title: "FIRST DOWN", sub: `${yards}-yard ${verb} by ${rusher}`, color: "#9be09b" };
      return { title: `${yards}-YARD ${noun}`, sub: `${carryLabel} by ${rusher}`, color: "#ffffff" };
    }
    case "complete": {
      const isTD = (play.endYard ?? 0) >= 100;
      const isFirstDown = !isTD && play.down > 0 && yards >= (play.ytg ?? 0);
      if (isTD)        return { title: "TOUCHDOWN!", sub: `${yards} yards from ${passer} to ${rcvr}`, color: "#f0cc30", big: true };
      if (yards >= 25) return { title: "BIG PLAY!", sub: `${yards} yards from ${passer} to ${rcvr}`, color: "#9be09b", big: true };
      if (isFirstDown) return { title: "FIRST DOWN", sub: `${yards} yards from ${passer} to ${rcvr}`, color: "#9be09b" };
      return { title: `COMPLETE +${yards}`, sub: `${passer} to ${rcvr}`, color: "#ffffff" };
    }
    case "incomplete": {
      if (play.isDrop) {
        return { title: "DROP!", sub: intended ? `${intended} can't hang on` : `Receiver drops it`, color: "#e07070" };
      }
      // Use the specific incomplete reason for the banner sub-text so
      // the viewer knows WHAT happened, not just that the pass was
      // incomplete. Maps incReason → human-readable phrase.
      const reasonMap = {
        overthrown:  intended ? `${passer} overthrows ${intended}`       : `Pass sails high`,
        underthrown: intended ? `${passer} throws short of ${intended}`   : `Pass falls short`,
        throwaway:   `${passer} throws it away — out of bounds`,
        batted:      `Batted down at the line`,
        offtarget:   intended ? `${passer} off-target to ${intended}`     : `Pass off-target`,
      };
      const sub = reasonMap[play.incReason]
        || (intended ? `${passer} pass to ${intended} hits the turf`
                     : `${passer} pass hits the turf`);
      return { title: "INCOMPLETE", sub, color: "#cccccc" };
    }
    case "int":
      return { title: "INTERCEPTION!", sub: `${passer} picked off — turnover`, color: "#e07070", big: true };
    case "sack": {
      const dlName = lastNameUpper(play.dlName);
      const move = play.dlMove;
      const sub = dlName && move
        ? `${dlName} with the ${move} — ${passer} dropped for −${play.sackLoss ?? 0}`
        : `${passer} dropped for −${play.sackLoss ?? 0} in the backfield`;
      return { title: "SACK!", sub, color: "#e07070" };
    }
    case "fumble":
      return { title: "FUMBLE!", sub: rusher ? `${rusher} cough it up — defense recovers` : "Defense recovers the loose ball", color: "#e07070", big: true };
    case "fg_good":
      return { title: "FIELD GOAL!", sub: `${kicker} drills it from ${play.fgDist}`, color: "#f0cc30" };
    case "fg_miss":
      return { title: "NO GOOD", sub: `${kicker} misses from ${play.fgDist}`, color: "#e07070" };
    case "punt": {
      if (play.isReturnTD)   return { title: "RETURNED FOR SIX!", sub: `${play.returnYards}-yard punt return TD`, color: "#f0cc30", big: true };
      if (play.isTouchback)  return { title: "PUNT", sub: `${play.puntYards}-yard punt — touchback`, color: "#cccccc" };
      if (play.isFairCatch)  return { title: "PUNT", sub: `${play.puntYards}-yard punt — fair catch`, color: "#cccccc" };
      if ((play.returnYards ?? 0) >= 20) return { title: `${play.returnYards}-YD RETURN!`, sub: `${play.puntYards}-yard punt, brought back ${play.returnYards}`, color: "#9be09b", big: true };
      const rty = play.returnYards ?? 0;
      return { title: "PUNT", sub: rty > 0 ? `${play.puntYards}-yard punt, returned ${rty}` : `${play.puntYards}-yard punt — change of possession`, color: "#cccccc" };
    }
    case "score": {
      const d = (play.desc || "").toLowerCase();
      if (d.includes("touchdown")) return null;
      if (d.includes("fg")) return null;
      if (d.includes("extra point")) return { title: "EXTRA POINT  ✓", sub: "Good — +1", color: "#9be09b" };
      if (d.includes("2-point")) return { title: "2-PT CONVERSION!", sub: "Good — +2", color: "#f0cc30" };
      return null;
    }
    case "kickoff":
    case "halftime":
    case "quarter":
    case "ot":
    case "two_min_warning":
    case "timeout":
      return null;
    default: return null;
  }
}

// Celebration overlay — animates the scoring player + a portrait popup
function drawCelebrationOverlay(ctx, play, celebrate, holdT) {
  if (!celebrate || viewMode !== "cinema") return;
  const celeb = CELEBRATIONS[celebrate.celebKey];
  if (!celeb) return;
  // Pick the player who deserves the celebration
  const heroName = play.receiver || play.rusher || play.kicker || play.passer || "STAR";
  const offTeam = play.poss === "home" ? gameResult.homeTeam : gameResult.awayTeam;
  const faceSeed = nameSeed(heroName);
  // Cycle through celebration frames
  const cycleT = (holdT * 2) % 1;
  const frameKey = getCelebFrame(celebrate.celebKey, cycleT);
  // Find a good on-field anchor: end zone for TDs, end-yard for big plays
  const isTD = celebrate.kind === "TD";
  const endYardAbs = play.endYard ?? play.startYard ?? 50;
  const heroYard = isTD ? (play.poss === "home" ? 100 : 0) : endYardAbs;
  const heroWX  = yardToWorldX(heroYard);
  const heroLat = 0;
  // Pan camera to the celebration (only do this if we still want to update cam)
  if (isTD) cinemaCamX = heroWX - 60;
  // Re-render field beneath the celebration so we can frame it freshly
  drawCinemaField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  // Subtle vignette
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(0, 0, FIELD.W, FIELD.H);
  // Confetti / sparkle field for TDs (drifts down across the field)
  if (isTD) {
    const ageMs = holdT * 2400;
    drawFireworksShow(ctx, ageMs);
    drawConfettiRain(ctx, holdT, offTeam);
  }
  // The hero, jumping / fist-pumping, with a small bobbing motion
  const bob = Math.sin(holdT * Math.PI * 6) * 4;
  const heroX = worldToScreenX(heroWX);
  const heroY = lateralToScreenY(heroLat) + bob;
  drawSprite(ctx, heroX, heroY, offTeam, frameKey, false, false, faceSeed);
  // A few teammates around them, also fist-pumping
  const buddies = [
    { dx: -50, dy: -28, frame: "fist_a" },
    { dx:  60, dy: -22, frame: "fist_b" },
    { dx: -80, dy:  18, frame: "celebrate" },
    { dx:  90, dy:  22, frame: "fist_a" },
  ];
  for (let i = 0; i < buddies.length; i++) {
    const b = buddies[i];
    const bx = heroX + b.dx + Math.sin(holdT * Math.PI * 4 + i) * 3;
    const by = heroY + b.dy + Math.cos(holdT * Math.PI * 5 + i * 1.3) * 3;
    const f = (holdT * 2 + i * 0.4) % 1 < 0.5 ? "fist_a" : "fist_b";
    drawSprite(ctx, bx, by, offTeam, f, i % 2 === 1, false, nameSeed("Buddy", i));
  }
  // Portrait popup (slides in/out)
  if (holdT > 0.05 && holdT < 0.95) {
    const popT = (holdT - 0.05) / 0.90;
    const side = (nameSeed(heroName, 1) > 0.5) ? "right" : "left";
    const shout = pickShout(celebrate.celebKey, play, 0);
    drawPortraitPopup(ctx, popT, side, offTeam, faceSeed, heroName, shout);
  }
  // Rising celebration text near the hero
  if (holdT > 0.1 && holdT < 0.7) {
    const taunt = pickTaunt(play, 9);
    const tT = (holdT - 0.1) / 0.6;
    drawTaunt(ctx, heroX, heroY - 80, taunt, "#f0cc30", tT);
  }
}

// Confetti falling across the field — colored by the scoring team
function drawConfettiRain(ctx, holdT, team) {
  const colors = [team.primary, team.secondary, "#f0cc30", "#ffffff", "#e07070"];
  const N = 60;
  const fallH = FIELD.H + 80;
  for (let i = 0; i < N; i++) {
    const seed = i * 37;
    const startX = ((seed * 89) % FIELD.W) + Math.sin(holdT * 2 + i) * 12;
    const delay = ((seed * 13) % 1000) / 1000;
    const localT = (holdT * 1.4 - delay) % 1;
    if (localT < 0) continue;
    const y = -10 + localT * fallH;
    const color = colors[(seed) % colors.length];
    ctx.save();
    ctx.translate(startX, y);
    ctx.rotate((holdT * 8 + i) * 0.5);
    ctx.fillStyle = color;
    ctx.fillRect(-3, -1.5, 6, 3);
    ctx.restore();
  }
}

function drawResultCard(ctx, play, holdT) {
  const result = formatPlayResult(play);
  if (!result) return;
  // Broadcast cam: route the banner to the flat upright overlay so it
  // doesn't get perspective-warped with the tilted field plane. Anchored
  // to the "sky" zone above the field tilt so the action below stays
  // unobstructed.
  const isBroadcast = (typeof cameraMode !== "undefined" && cameraMode === "broadcast"
                       && typeof _uprightCtx !== "undefined" && _uprightCtx);
  if (isBroadcast) ctx = _uprightCtx;
  // Card delayed so the post-play scene is visible for ~600ms before the
  // banner overlays. User feedback: "animation ends abruptly" — old code
  // popped the card at holdT*5 (full opacity by ~280ms), which cut the
  // post-tackle moment off. Now holds the action frame alone for 30% of
  // the hold window, then fades the card in.
  const fadeIn = Math.max(0, Math.min(1, (holdT - 0.30) / 0.22));
  const fadeOut = holdT > 0.88 ? Math.max(0, 1 - (holdT - 0.88) / 0.12) : 1;
  const opacity = fadeIn * fadeOut;
  const slideY = (1 - fadeIn) * -24;

  const titleSize = result.big ? 52 : 38;
  const subSize = 18;
  const padX = 36;
  ctx.save();
  ctx.font = `900 ${titleSize}px sans-serif`;
  const titleW = ctx.measureText(result.title).width;
  ctx.font = `600 ${subSize}px sans-serif`;
  const subW = result.sub ? ctx.measureText(result.sub).width : 0;
  const bannerW = Math.max(titleW, subW) + padX * 2;
  const bannerH = result.sub ? titleSize + subSize + 28 : titleSize + 24;
  const bannerX = (FIELD.W - bannerW) / 2;
  // Broadcast: sit between the LED ad ribbon and the tilted field plane
  // (the perspective "sky" zone). Out of the action, never clipped by
  // the scrubber chrome at the bottom of the wrap.
  const bannerY = isBroadcast
    ? 32 + slideY
    : 34 + slideY;

  ctx.globalAlpha = opacity;
  // Backdrop
  ctx.fillStyle = "rgba(8, 12, 18, 0.90)";
  roundedRect(ctx, bannerX, bannerY, bannerW, bannerH, 8);
  ctx.fill();
  // Left accent bar
  ctx.fillStyle = result.color;
  ctx.fillRect(bannerX, bannerY, 6, bannerH);
  // Border / glow for big plays
  if (result.big) {
    ctx.shadowColor = result.color;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = result.color;
    ctx.lineWidth = 2.5;
    roundedRect(ctx, bannerX + 1.5, bannerY + 1.5, bannerW - 3, bannerH - 3, 8);
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    roundedRect(ctx, bannerX + 0.5, bannerY + 0.5, bannerW - 1, bannerH - 1, 8);
    ctx.stroke();
  }
  // Title
  ctx.fillStyle = result.color;
  ctx.font = `900 ${titleSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const titleCenterY = result.sub ? bannerY + 14 + titleSize / 2 : bannerY + bannerH / 2;
  ctx.fillText(result.title, bannerX + bannerW / 2, titleCenterY);
  // Subtitle
  if (result.sub) {
    ctx.fillStyle = "#e8eaef";
    ctx.font = `600 ${subSize}px sans-serif`;
    ctx.fillText(result.sub, bannerX + bannerW / 2, bannerY + bannerH - subSize / 2 - 10);
  }
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ═══════════════════════════════════════════════════════════════════════════
// View toggle wiring
// ═══════════════════════════════════════════════════════════════════════════
let viewMode = "tactical"; // 'tactical' | 'cinema'

// Broadcast camera — field canvas gets CSS perspective + rotateX; a
// parallel upright overlay canvas (#field-uprights) draws player sprites
// at projected positions so they stay billboarded (upright) rather than
// foreshortened with the field plane.
let cameraMode = "broadcast"; // 'topdown' | 'broadcast' — broadcast is the default for that "watching it on TV" feel
let _uprightCtx = null;      // set per frame by _frameStartBroadcast()
let _spriteQueue = [];        // deferred sprite draws (player/ball) for depth sort
const BROADCAST_TILT_DEG = 38;
const BROADCAST_PERSPECTIVE_PX = 1100;

// Called by the tick loop before each render(). Clears the upright
// overlay canvas and sets _uprightCtx so drawPlayer/drawBall route
// there in broadcast mode.
function _frameStartBroadcast() {
  if (cameraMode !== "broadcast") {
    _uprightCtx = null;
    _spriteQueue.length = 0;
    return;
  }
  const upr = document.getElementById("field-uprights");
  if (!upr) { _uprightCtx = null; return; }
  _uprightCtx = upr.getContext("2d");
  _uprightCtx.clearRect(0, 0, upr.width, upr.height);
  // Stadium goalposts at both end zones — drawn behind sprites so a
  // player crossing in front of one occludes it correctly.
  try { drawStadiumGoalposts(_uprightCtx); } catch (e) { /* defensive */ }
  _spriteQueue.length = 0;
  // Phase 3.2 — bump the PIXI player frame marker so sprites not
  // refreshed by drawPlayer this frame get hidden at frame end.
  if (typeof GCPlayer !== "undefined") GCPlayer.frameStart();
}

// Y-shaped stadium goalposts at the back of each end zone, drawn on the
// flat upright overlay so they stand UP in broadcast cam (canvas2D #field
// is CSS rotateX'd which would lay an H flat against the ground).
function drawStadiumGoalposts(ctx) {
  if (!ctx || cameraMode !== "broadcast") return;
  const yMid = (FIELD.TOP + FIELD.BOT) / 2;
  // Back of each end zone (a few px in from the canvas edge so the post
  // base reads as inside the playing surface).
  _drawOneGoalpost(ctx, 18, yMid);
  _drawOneGoalpost(ctx, FIELD.W - 18, yMid);
}
function _drawOneGoalpost(ctx, fieldX, fieldYMid) {
  const PXY = 15; // FIELD.PX_PER_YARD
  const halfLat = 3 * PXY;  // crossbar half-width: ~3yd from center each side
  const baseC = projectBroadcast(fieldX, fieldYMid);
  const baseL = projectBroadcast(fieldX, fieldYMid - halfLat);
  const baseR = projectBroadcast(fieldX, fieldYMid + halfLat);
  if (!baseC || baseC.scale <= 0) return;
  const s = baseC.scale;
  const sinθ = Math.sin(BROADCAST_TILT_DEG * Math.PI / 180);
  // Vertical pixel heights for crossbar + uprights at this perspective scale.
  // 3yd crossbar height, 12yd upright extension above the crossbar.
  const crossbarH = 3 * PXY * sinθ * s;
  const uprightH  = 12 * PXY * sinθ * s;
  const crossbarL_y = baseL.y - crossbarH;
  const crossbarR_y = baseR.y - crossbarH;
  const crossbarC_y = baseC.y - crossbarH;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Thin dark stroke first (silhouette / depth), then yellow on top.
  const drawStrokes = (color, widthMul) => {
    ctx.strokeStyle = color;
    // Support pole
    ctx.lineWidth = Math.max(2, 4.5 * s * widthMul);
    ctx.beginPath();
    ctx.moveTo(baseC.x, baseC.y);
    ctx.lineTo(baseC.x, crossbarC_y);
    ctx.stroke();
    // Crossbar
    ctx.lineWidth = Math.max(2, 3.8 * s * widthMul);
    ctx.beginPath();
    ctx.moveTo(baseL.x, crossbarL_y);
    ctx.lineTo(baseR.x, crossbarR_y);
    ctx.stroke();
    // Two vertical uprights
    ctx.beginPath();
    ctx.moveTo(baseL.x, crossbarL_y);
    ctx.lineTo(baseL.x, crossbarL_y - uprightH);
    ctx.moveTo(baseR.x, crossbarR_y);
    ctx.lineTo(baseR.x, crossbarR_y - uprightH);
    ctx.stroke();
  };
  drawStrokes("rgba(0,0,0,0.55)", 1.45);
  drawStrokes("#ffe048", 1.0);
  // Small flag/wind sock at the top of each upright (visual flourish that
  // makes the posts read as part of a real stadium, not a wireframe).
  ctx.fillStyle = "#ff7a3a";
  const flagH = Math.max(4, 8 * s);
  const flagW = Math.max(6, 12 * s);
  ctx.fillRect(baseL.x, crossbarL_y - uprightH - flagH, flagW, flagH);
  ctx.fillRect(baseR.x - flagW, crossbarR_y - uprightH - flagH, flagW, flagH);
  ctx.restore();
}

// Called by the tick loop after render(). Sorts queued sprite draws
// by depth (smaller projected Y = further away = drawn first) so
// closer players occlude farther ones on pile-ups.
function _frameEndBroadcast() {
  if (cameraMode === "broadcast" && _uprightCtx && _spriteQueue.length) {
    _spriteQueue.sort((a, b) => a.screenY - b.screenY);
    for (const item of _spriteQueue) {
      try { item.run(); } catch (e) { console.error("sprite flush err", e); }
    }
  }
  _spriteQueue.length = 0;
  // Phase 3.2 — flush PIXI player layer: hide stale sprites + render
  // the WebGL stage. Runs even when canvas2D _spriteQueue is empty
  // (which happens when ALL players route to PIXI).
  if (typeof GCPlayer !== "undefined") GCPlayer.frameEnd();
}

function setCameraMode(mode) {
  cameraMode = (mode === "broadcast") ? "broadcast" : "topdown";
  _bcastGeom = null;   // wrap dimensions change with the broadcast-cam class
  // Apply / remove the perspective transform on the field-wrap
  const wrap = document.querySelector(".bspnlive-field-wrap")
            || document.querySelector(".field-wrap")
            || document.getElementById("field")?.parentElement;
  const canvas = document.getElementById("field");
  const canvasPixi = document.getElementById("field-pixi");
  if (cameraMode === "broadcast") {
    if (wrap) {
      wrap.classList.add("broadcast-cam");
      wrap.style.perspective = BROADCAST_PERSPECTIVE_PX + "px";
      wrap.style.perspectiveOrigin = "50% 80%";
    }
    if (canvas) {
      // Scale Y to keep the rotated field filling vertical space the same.
      // rotateX(38°) compresses the projected height by ~cos(38°) ≈ 0.79;
      // counter-scale ~1.27 brings it back to original visual height.
      canvas.style.transform = `rotateX(${BROADCAST_TILT_DEG}deg) scaleY(${1 / Math.cos(BROADCAST_TILT_DEG * Math.PI / 180)})`;
      canvas.style.transformOrigin = "50% 100%";
    }
    if (canvasPixi) {
      // PIXI field canvas tracks #field's transform exactly so it stays
      // aligned with the canvas2D layer above it.
      canvasPixi.style.transform = `rotateX(${BROADCAST_TILT_DEG}deg) scaleY(${1 / Math.cos(BROADCAST_TILT_DEG * Math.PI / 180)})`;
      canvasPixi.style.transformOrigin = "50% 100%";
    }
  } else {
    if (wrap) {
      wrap.classList.remove("broadcast-cam");
      wrap.style.perspective = "";
      wrap.style.perspectiveOrigin = "";
    }
    if (canvas) {
      canvas.style.transform = "";
      canvas.style.transformOrigin = "";
    }
    if (canvasPixi) {
      canvasPixi.style.transform = "";
      canvasPixi.style.transformOrigin = "";
    }
  }
  // Update the button states (if those buttons exist on the page yet)
  const tdBtn = document.getElementById("camTopdownBtn");
  const bdBtn = document.getElementById("camBroadcastBtn");
  if (tdBtn) tdBtn.classList.toggle("active", cameraMode === "topdown");
  if (bdBtn) bdBtn.classList.toggle("active", cameraMode === "broadcast");
  // Repaint
  if (typeof renderBSPNLive === "function") renderBSPNLive();
}

// Cached wrap/field geometry for projectBroadcast — rebuilt on camera mode
// change and window resize.
let _bcastGeom = null;
function _updateBroadcastGeom() {
  const wrap = document.querySelector(".bspnlive-field-wrap");
  if (!wrap) { _bcastGeom = null; return; }
  const cs = getComputedStyle(wrap);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const wrapW = wrap.clientWidth;
  const wrapH = wrap.clientHeight;
  // Field's CSS width = wrap content width (assumes symmetric horizontal padding).
  // Height comes from the canvas aspect ratio (FIELD.H / FIELD.W) because the
  // canvas CSS rule is width:100%; height:auto.
  const fieldW = Math.max(1, wrapW - 2 * padL);
  const fieldH = fieldW * (FIELD.H / FIELD.W);
  const θ = BROADCAST_TILT_DEG * Math.PI / 180;
  _bcastGeom = {
    wrapW, wrapH, padL, padT, fieldW, fieldH,
    ox: padL + fieldW / 2,   // #field transformOrigin x in wrap CSS
    oy: padT + fieldH,        // #field transformOrigin y in wrap CSS (50%, 100%)
    cosθ: Math.cos(θ),
    sinθ: Math.sin(θ),
    sY: 1 / Math.cos(θ),
    P: BROADCAST_PERSPECTIVE_PX,
    Px: wrapW / 2,            // perspective-origin x (50%)
    Py: wrapH * 0.8,          // perspective-origin y (80%)
  };
}
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => { _bcastGeom = null; });
}

// Project a canvas-space (x, y) point through the broadcast camera's
// perspective+rotateX+scaleY transform to get the equivalent upright-canvas
// internal (x, y) and the perspective scale. Replicates the full CSS pipeline
// applied to #field (scaleY then rotateX, origin 50% 100%) and to the wrap
// (perspective P, origin 50% 80%), then maps the screen-space result back
// into the upright canvas's internal coords (since the upright canvas spans
// the full wrap padding box via inset:0).
function projectBroadcast(x, y) {
  if (cameraMode !== "broadcast") return { x, y, scale: 1 };
  if (!_bcastGeom) _updateBroadcastGeom();
  if (!_bcastGeom) return { x, y, scale: 1 };
  const g = _bcastGeom;

  // Canvas-internal → #field pre-transform CSS coords (within wrap)
  const Cx = g.padL + (x / FIELD.W) * g.fieldW;
  const Cy = g.padT + (y / FIELD.H) * g.fieldH;

  // Distance from #field transformOrigin (50%, 100%)
  const dx = Cx - g.ox;
  const dy = Cy - g.oy;       // <= 0 for points above the bottom-center origin

  // Apply scaleY(1/cosθ) then rotateX(θ).
  // For (x, y, 0) after rotateX(θ) the rotation matrix gives:
  //   y' = y*cosθ  ;  z' = y*sinθ
  // Pre-scaled by sY, so y becomes dy*sY (more negative above origin).
  const sdy = dy * g.sY;
  const y3d = sdy * g.cosθ;
  const z3d = sdy * g.sinθ;    // negative for above-origin → further from viewer

  // Wrap CSS coords + depth after transform
  const fx = g.ox + dx;
  const fy = g.oy + y3d;
  const fz = z3d;

  // Wrap perspective (P=1100, origin 50% 80%). fz < 0 → scale < 1.
  const persScale = g.P / (g.P - fz);
  const screenX = g.Px + (fx - g.Px) * persScale;
  const screenY = g.Py + (fy - g.Py) * persScale;

  // Wrap CSS → upright canvas internal coords. Upright canvas covers the
  // wrap's padding box (clientW × clientH) via inset:0, so:
  const uX = screenX * (FIELD.W / g.wrapW);
  const uY = screenY * (FIELD.H / g.wrapH);

  return { x: uX, y: uY, scale: persScale };
}

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById("viewTacticalBtn").classList.toggle("active", mode === "tactical");
  document.getElementById("viewCinemaBtn").classList.toggle("active", mode === "cinema");
  clearCallout();
  // Rebuild the current play with the new view, restarting from t=0.
  if (gameResult && playHead > 0 && playHead <= gameResult.plays.length) {
    const play = gameResult.plays[playHead - 1];
    const builder = mode === "cinema" ? buildCinemaAnim : buildAnimForPlay;
    const anim = builder(play, null);
    animState = { play, anim, startTime: performance.now(), duration: anim.duration / speedMul };
    if (!playing) {
      // Render one frame so user sees the new view immediately
      const ctx = $("field").getContext("2d");
      anim.render(0, ctx);
    }
  } else if (gameResult) {
    // Pre-game: redraw whatever field
    const ctx = $("field").getContext("2d");
    if (mode === "cinema") {
      cinemaCamX = yardToWorldX(50);
      drawCinemaField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
    } else {
      drawField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
    }
  }
}

document.getElementById("viewTacticalBtn")?.addEventListener("click", () => setViewMode("tactical"));
document.getElementById("viewCinemaBtn")?.addEventListener("click", () => setViewMode("cinema"));

// Click the field during the result-hold to advance to the next play immediately.
// The #field canvas is created lazily by renderGameLayout(), so attach via
// event delegation on the document instead of directly on the element.
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "field") {
    if (animState && animState.holdStart != null) animState.skipHold = true;
  }
});

// Brief "jog up to the new line of scrimmage" animation between plays.
// Returns null if no transition is appropriate (kickoff, halftime, score-only,
// turnover, or first play). Otherwise returns { duration, render(t01, ctx) }.
function buildJogTransition(prevPlay, nextPlay) {
  if (!prevPlay || !nextPlay) return null;
  if (nextPlay.startYard == null || prevPlay.startYard == null) return null;
  const skipKinds = ["halftime", "ot", "quarter", "two_min_warning", "timeout",
                     "kickoff", "punt", "fg_good", "fg_miss", "fg_blocked", "int", "fumble",
                     "fourth_go", "to_downs"];
  if (skipKinds.includes(nextPlay.kind) || skipKinds.includes(prevPlay.kind)) return null;
  // Turnovers swap which team is on offense — the formation identity changes,
  // so we can't smoothly jog. Skip and let the next play snap into place.
  if (prevPlay.poss && nextPlay.poss && prevPlay.poss !== nextPlay.poss) return null;
  const newPoss = nextPlay.poss;
  // Formation was lined up at the PREVIOUS play's startYard. After the play,
  // the new LOS is the next play's startYard. That's the distance to jog.
  const newLosX  = yardToAbsX(nextPlay.startYard, newPoss);
  const prevLosX = yardToAbsX(prevPlay.startYard, newPoss);
  const xOffset = prevLosX - newLosX;
  if (Math.abs(xOffset) < 6) return null;   // <~½ yard, no jog needed

  const homeTeam = gameResult.homeTeam, awayTeam = gameResult.awayTeam;
  const team    = newPoss === "home" ? homeTeam : awayTeam;
  const oppTeam = newPoss === "home" ? awayTeam : homeTeam;
  const possColor = team.primary;
  const oppColor  = oppTeam.primary;
  const dir = newPoss === "home" ? 1 : -1;

  const formation = makeFormation(newLosX, newPoss);
  const offStarters = newPoss === "home" ? gameResult.homeRatings.starters : gameResult.awayRatings.starters;
  const defStarters = newPoss === "home" ? gameResult.awayRatings.starters : gameResult.homeRatings.starters;
  attachPlayerStyles(formation, offStarters, defStarters, gameResult.playerLookup);

  let firstDownAbs = null;
  if (nextPlay.down > 0) {
    const fdYard = clamp(nextPlay.startYard + nextPlay.ytg, 0, 100);
    firstDownAbs = yardToAbsX(fdYard, newPoss);
  }
  const fieldState = { los: newLosX, firstDownAbs, possColor };

  // Faster jog for longer distances so players don't drag. ~9 yds/s sprint speed.
  const yardsToCover = Math.abs(xOffset) / FIELD.PX_PER_YARD;
  // Accelerated tempo: 1.4× regular running so jogs feel snappy between plays.
  const sprintSpeed = 9 * 1.4;   // yds/s
  const duration = clamp(yardsToCover / sprintSpeed * 1000, 350, 1400);

  // Players jog toward the new LOS. Direction of motion is (newLosX - cur).
  // facingMotion = sign of motion direction (-1 left, +1 right).
  const motionSign = xOffset > 0 ? -1 : 1;

  return {
    duration,
    render: (t01, ctx) => {
      drawField(ctx, homeTeam, awayTeam, fieldState);
      const eased = t01 * t01 * (3 - 2 * t01);
      const curOffset = xOffset * (1 - eased);
      // Cycle the run animation faster than wall time so the legs visibly churn.
      const runCycle = (t01 * 4.5) % 1;
      const renderAll = (arr, color, sec, facing) => {
        for (const p of arr) {
          drawPlayer(ctx, p.x + curOffset, p.y, color, sec, p.label, "run", runCycle, facing, p);
        }
      };
      renderAll(formation.offense, possColor, team.secondary, motionSign);
      renderAll(formation.defense, oppColor, oppTeam.secondary, motionSign);
      // Small "HUDDLE BREAK" / jog hint near the LOS
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("...", newLosX, 26);
      ctx.restore();
    },
  };
}

function startNextPlay() {
  if (!gameResult) return;
  if (playHead >= gameResult.plays.length) {
    playing = false;
    renderStaticEnd();
    updateButtons();
    const pb = document.getElementById("hudScrubPlay");
    if (pb) pb.textContent = "▶";
    if (typeof GCAudio !== "undefined") {
      GCAudio.play("whistle");                // final whistle
      setTimeout(() => GCAudio.play("cheer"), 220);
      // Fade ambient crowd a moment later (after the final cheer settles)
      setTimeout(() => GCAudio.crowd.stop(), 1800);
    }
    if (typeof GCFx !== "undefined") {
      GCFx.bigText("FINAL", 0xf5c542, 3200);
      GCFx.lensFlare(1100, 850, 360);
    }
    return;
  }
  const play = gameResult.plays[playHead];
  const prev = playHead > 0 ? gameResult.plays[playHead - 1] : null;
  // ── Audio cues for this play.
  // Ambient crowd hum runs continuously while plays are advancing; SFX
  // layer on top for individual events.
  const _kind = play.kind;
  const _isTD   = _kind === "score" || _kind === "td" || _kind === "rush_td" ||
                  _kind === "pass_td" || _kind === "kr_td" || _kind === "pr_td" ||
                  _kind === "fum_td" || _kind === "int_td" || _kind === "two_pt_good" ||
                  _kind === "fg_good" || _kind === "xp_good";
  const _isHit  = _kind === "big_hit" || _kind === "ejection" ||
                  _kind === "fumble" || _kind === "sack";
  const _isSeg  = _kind === "halftime" || _kind === "quarter" ||
                  _kind === "ot" || _kind === "two_min_warning";
  const _isGroan = _kind === "incomplete" || _kind === "fg_miss" ||
                   _kind === "xp_miss"   || _kind === "to_downs" ||
                   _kind === "interception";
  const _isBigPlay = _kind === "int_no_td" || _kind === "interception" ||
                     _kind === "fumble"    || _kind === "long_run" ||
                     _kind === "long_pass" || _kind === "sack";
  if (typeof GCAudio !== "undefined") {
    GCAudio.crowd.start();
    if (_isTD) GCAudio.play("cheer");
    else if (_isHit) {
      GCAudio.play("hit");
      // Big-play crowd swell layered with the hit thud — bigger moments
      // get both the impact and the reaction.
      if (_kind === "fumble" || _kind === "sack") GCAudio.play("bigplay");
    }
    else if (_isSeg) {
      GCAudio.play("whistle");
      if (typeof GCFx !== "undefined") {
        const seg = _kind === "halftime"        ? "HALFTIME"
                  : _kind === "two_min_warning" ? "TWO-MINUTE WARNING"
                  : _kind === "ot"              ? "OVERTIME"
                  : _kind === "quarter"
                      ? `END OF Q${(play.quarter || 1) - 1 || 4}`
                      : "QUARTER BREAK";
        GCFx.bigText(seg, 0xf5c542, 2200);
      }
    }
    else if (_isGroan) GCAudio.play("groan");
    else if (_isBigPlay) GCAudio.play("bigplay");
    else if (_kind !== "hc_decision") GCAudio.play("snap");
  }
  // Visual FX hooks — screen shake on big hits, confetti on TDs. Particle
  // origin is the canvas center for now; the per-play render code can call
  // GCFx.dust(x,y) at specific player positions for richer FX in the future.
  if (typeof GCFx !== "undefined") {
    if (_isHit) {
      GCFx.shake(11, 350);
      GCFx.hitBurst(FIELD.W / 2, (FIELD.TOP + FIELD.BOT) / 2);
      GCFx.flash("#ffe6c0", 200, 0.18);   // warm camera flash on collisions
    } else if (_isTD) {
      const teamColor = (play.team === "home"
        ? gameResult.homeTeam.primary
        : gameResult.awayTeam.primary);
      GCFx.shake(5, 220);
      // Triple confetti burst — center + two endzone bursts so the
      // celebration feels like a full stadium reaction.
      GCFx.confetti(FIELD.W / 2,      FIELD.TOP + 40, teamColor, 32);
      GCFx.confetti(FIELD.W * 0.18,   FIELD.TOP + 40, teamColor, 18);
      GCFx.confetti(FIELD.W * 0.82,   FIELD.TOP + 40, teamColor, 18);
      GCFx.flash(teamColor, 320, 0.22);
      GCFx.lensFlare(700);
      GCFx.celebration(1400);
      // Big celebration text — context-aware banner.
      const isFG = _kind === "fg_good";
      const isXP = _kind === "xp_good";
      const is2P = _kind === "two_pt_good";
      const banner = isFG ? "FIELD GOAL!"
                   : isXP ? "EXTRA POINT"
                   : is2P ? "TWO-POINT CONVERSION!"
                   : "TOUCHDOWN!";
      GCFx.bigText(banner, teamColor, 1700);
      // Player highlight chyron — name the scorer + a short tag.
      const scorer = play.receiver || play.rusher || play.passer || play.returner;
      if (scorer && !isXP) {
        const tag = isFG ? `${play.fgYds || ""} YD FIELD GOAL`.trim()
                  : is2P ? "2-POINT CONVERSION"
                  : play.kind === "pass_td" ? "PASSING TD"
                  : play.kind === "rush_td" ? "RUSHING TD"
                  : play.kind === "kr_td"   ? "KICKOFF RETURN TD"
                  : play.kind === "pr_td"   ? "PUNT RETURN TD"
                  : play.kind === "int_td"  ? "PICK SIX"
                  : play.kind === "fum_td"  ? "FUMBLE RETURN TD"
                  : "TOUCHDOWN";
        GCFx.chyron(scorer, tag, teamColor, 3400);
      }
    } else if (_kind === "drive_summary") {
      // Drive recap chyron — shows plays / yards / TOP / result.
      const plays = play.drivePlays || 0;
      const yds   = play.driveYards != null ? play.driveYards : 0;
      const ts    = play.driveTime != null
        ? `${Math.floor(play.driveTime / 60)}:${String(Math.floor(play.driveTime % 60)).padStart(2, "0")}`
        : "";
      const result = (play.driveResult || "").toUpperCase();
      const title = result || "DRIVE";
      const sub   = `${plays} PLAYS · ${yds} YDS${ts ? " · " + ts : ""}`;
      GCFx.chyron(title, sub, null, 3200);
    } else if (_isBigPlay && play.kind === "sack") {
      const sacker = play.tackler || play.sackBy;
      if (sacker) GCFx.chyron(sacker, "SACK", null, 2800);
    } else if (_isBigPlay && (play.kind === "interception" || play.kind === "int_no_td")) {
      const picker = play.defender || play.intercepter;
      if (picker) GCFx.chyron(picker, "INTERCEPTION", null, 2800);
    }
  }
  // Clear the big-hit cinematic when the play isn't one
  if (play.kind !== "big_hit" && play.kind !== "ejection") {
    if (typeof _bigHitCinema !== "undefined") _bigHitCinema.clear();
  }
  // Clear HC decision overlay when leaving its play
  if (play.kind !== "hc_decision") {
    if (typeof _hcDecisionCinema !== "undefined") _hcDecisionCinema.clear();
  }
  // Touchdown cinema clears on every new play start (it was shown by the
  // PREVIOUS play's hold phase; advance = it's over)
  if (typeof _touchdownCinema !== "undefined") _touchdownCinema.clear();
  // Same for big-play moment cinema
  if (typeof _momentCinema !== "undefined") _momentCinema.clear();
  // Clear segment cinema when leaving a quarter/halftime/2-min/OT play
  if (play.kind !== "halftime" && play.kind !== "ot" &&
      play.kind !== "quarter" && play.kind !== "two_min_warning") {
    if (typeof _segmentCinema !== "undefined") _segmentCinema.clear();
  }
  const builder = viewMode === "cinema" ? buildCinemaAnim : buildAnimForPlay;
  const anim = builder(play, prev);
  animState = {
    play,
    anim,
    startTime: performance.now(),
    duration: anim.duration / speedMul,
  };
  // Update side panels
  renderScoreboard(play);
  renderPlayLog();
  renderProgress();
  renderBoxScore();
  setCaption(play);
  setFieldStatus(play);
  rafId = requestAnimationFrame(tick);
}

// ── Scrubbable timeline ───────────────────────────────────────────────
// Injects a slim play/pause + drag-to-scrub timeline into the field-wrap on
// first tick. Lets the user drag through the current play's animation in
// real time, jump back to t=0 to re-watch, or pause on a frame.
function _ensureScrubber() {
  if (document.getElementById("hudScrubber")) return;
  const wrap = document.querySelector(".bspnlive-field-wrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.id = "hudScrubber";
  el.className = "hud-scrubber";
  el.innerHTML = `
    <button class="hud-scrub-btn" id="hudScrubPlay" title="Play / Pause">⏸</button>
    <button class="hud-scrub-btn" id="hudScrubRestart" title="Restart this play">↺</button>
    <div class="hud-scrub-track" id="hudScrubTrack">
      <div class="hud-scrub-fill" id="hudScrubFill"></div>
      <div class="hud-scrub-knob" id="hudScrubKnob"></div>
    </div>
    <div class="hud-scrub-time" id="hudScrubTime">0.00s</div>`;
  wrap.appendChild(el);
  document.getElementById("hudScrubPlay").addEventListener("click", _scrubToggle);
  document.getElementById("hudScrubRestart").addEventListener("click", _scrubRestart);
  document.getElementById("hudScrubTrack").addEventListener("pointerdown", _scrubStart);
}

function _scrubToggle() {
  if (!animState) return;
  if (playing) {
    // Pause — remember elapsed so resume picks up here
    if (animState.startTime != null) {
      animState._pausedElapsed = performance.now() - animState.startTime;
    }
    playing = false;
  } else {
    if (animState._pausedElapsed != null) {
      animState.startTime = performance.now() - animState._pausedElapsed;
      animState._pausedElapsed = null;
    }
    playing = true;
    rafId = requestAnimationFrame(tick);
  }
  const btn = document.getElementById("hudScrubPlay");
  if (btn) btn.textContent = playing ? "⏸" : "▶";
}

function _scrubRestart() {
  if (!animState) return;
  animState.startTime = performance.now();
  animState.holdStart = null;
  animState._pausedElapsed = null;
  animState.skipHold = false;
  if (!playing) {
    playing = true;
    const btn = document.getElementById("hudScrubPlay");
    if (btn) btn.textContent = "⏸";
    rafId = requestAnimationFrame(tick);
  }
}

function _scrubStart(ev) {
  if (!animState) return;
  ev.preventDefault();
  const wasPlaying = playing;
  playing = false;  // hold while dragging
  const track = ev.currentTarget;
  const onMove = e => _scrubTo(e, track);
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    if (wasPlaying) {
      playing = true;
      rafId = requestAnimationFrame(tick);
    } else {
      // Remember the new elapsed for resume
      if (animState && animState.startTime != null) {
        animState._pausedElapsed = performance.now() - animState.startTime;
      }
    }
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  _scrubTo(ev, track);
}

function _scrubTo(ev, track) {
  if (!animState) return;
  const rect = track.getBoundingClientRect();
  let frac = (ev.clientX - rect.left) / rect.width;
  frac = Math.max(0, Math.min(1, frac));
  // Re-anchor startTime so elapsed = frac * duration
  animState.startTime = performance.now() - frac * animState.duration;
  animState.holdStart = null;
  animState.skipHold = false;
  // Render the new frame immediately so the scrub feels live
  const ctx = $("field").getContext("2d");
  _frameStartBroadcast();
  try {
    animState.anim.render(frac, ctx);
    _frameEndBroadcast();
  } catch (e) { console.error("Scrub render error", e); }
  _updateScrubberUI(frac);
}

function _updateScrubberUI(frac) {
  const fill = document.getElementById("hudScrubFill");
  const knob = document.getElementById("hudScrubKnob");
  const time = document.getElementById("hudScrubTime");
  if (fill) fill.style.width = (frac * 100) + "%";
  if (knob) knob.style.left = (frac * 100) + "%";
  if (time && animState) {
    time.textContent = ((animState.duration * frac) / 1000).toFixed(2) + "s";
  }
}

function tick(now) {
  _ensureScrubber();
  if (!playing || !animState) return;
  // Inter-play jog transition — animate players trotting up to the new LOS.
  if (animState.transition) {
    const ctx = $("field").getContext("2d");
    const tElapsed = now - animState.transitionStart;
    const tT = Math.min(1, tElapsed / animState.transitionDur);
    try {
      animState.transition.render(tT, ctx);
    } catch (e) {
      console.error('Jog transition render error', e);
    }
    if (tT >= 1) {
      playHead++;
      animState = null;
      if (playing) startNextPlay();
      return;
    }
    rafId = requestAnimationFrame(tick);
    return;
  }
  // Cinematic slow-mo at tackle impact — set by initRagdoll for the
  // carrier. While now < slowMoUntil, burn (1 - slowMoMul) * frameDt
  // back into startTime so play-elapsed grows at (slowMoMul)x of real
  // time. Result: a brief slow-mo hold on the impact frame.
  if (animState.slowMoUntil && now < animState.slowMoUntil) {
    const frameDt = animState.lastTickAt ? (now - animState.lastTickAt) : 0;
    const mul = animState.slowMoMul || 0.30;
    animState.startTime += frameDt * (1 - mul);
  }
  const elapsed = now - animState.startTime;
  const t = Math.min(1, elapsed / animState.duration);
  const ctx = $("field").getContext("2d");
  // FX particle update — advance dust/debris/confetti every frame.
  if (typeof GCFx !== "undefined") {
    const dt = animState.lastTickAt ? (now - animState.lastTickAt) : 16.7;
    animState.lastTickAt = now;
    GCFx.tick(dt);
  }
  _frameStartBroadcast();
  try {
    animState.anim.render(t, ctx);
    _frameEndBroadcast();
    // Particles draw on top of the upright sprites overlay (broadcast cam)
    // or on the field canvas itself (topdown). _uprightCtx is set by
    // _frameStartBroadcast in broadcast mode; null in topdown.
    if (typeof GCFx !== "undefined") {
      const fxCtx = (typeof _uprightCtx !== "undefined" && _uprightCtx) ? _uprightCtx : ctx;
      GCFx.draw(fxCtx);
    }
  } catch (e) {
    console.error('Render error on play', animState.play, e);
  }
  _updateScrubberUI(t);
  if (t >= 1) {
    // Hold the final frame and overlay a result card so the play can be digested.
    if (animState.holdStart == null) {
      animState.holdStart = now;
      const play = animState.play;
      const hasCard = !!formatPlayResult(play);
      // Celebrations: longer hold so the player can dance + portrait shows
      const isTD = (play.endYard ?? 0) >= 100 && (play.kind === "run" || play.kind === "complete");
      const isBigPlay = !isTD && (
        (play.kind === "complete" && (play.yards ?? 0) >= 25) ||
        (play.kind === "run" && (play.yards ?? 0) >= 20) ||
        play.kind === "int" || play.kind === "fumble"
      );
      animState.celebrate = isTD ? { kind: "TD", celebKey: pickCelebration(play, 0) }
                          : isBigPlay ? { kind: "BIG", celebKey: pickCelebration(play, 7) }
                          : null;
      // AAA touchdown spectacle — team-color flood overlay on the field
      // for the duration of the TD hold.
      if (isTD && typeof _touchdownCinema !== "undefined") _touchdownCinema.show(play);
      // Big-play moment card — INT (incl. pick six), FUMBLE recovery
      if ((play.kind === "int" || play.kind === "fumble") && typeof _momentCinema !== "undefined") {
        _momentCinema.show(play);
      }
      const baseHold = hasCard ? RESULT_HOLD_MS : 90;
      const extraHold = isTD ? 1600 : isBigPlay ? 700 : 0;
      animState.holdDur = (baseHold + extraHold) / speedMul;
    }
    const holdElapsed = now - animState.holdStart;
    const holdT = Math.min(1, holdElapsed / animState.holdDur);
    // Celebration overlay BEFORE the result card so the card sits on top
    if (animState.celebrate) {
      drawCelebrationOverlay(ctx, animState.play, animState.celebrate, holdT);
    }
    drawResultCard(ctx, animState.play, holdT);
    if (holdElapsed >= animState.holdDur || animState.skipHold) {
      // Build a jog transition into the NEXT play (if applicable) so players
      // visibly trot up to the new LOS instead of instacutting.
      const nextIdx = playHead + 1;
      const nextPlay = nextIdx < gameResult.plays.length ? gameResult.plays[nextIdx] : null;
      const jog = (viewMode === "tactical" && !animState.skipHold)
        ? buildJogTransition(animState.play, nextPlay) : null;
      if (jog) {
        animState = {
          transition: jog,
          transitionStart: now,
          transitionDur: jog.duration / speedMul,
        };
        rafId = requestAnimationFrame(tick);
        return;
      }
      playHead++;
      animState = null;
      if (playing) startNextPlay();
      return;
    }
  }
  rafId = requestAnimationFrame(tick);
}

function renderStaticEnd() {
  const ctx = $("field").getContext("2d");
  if (viewMode === "cinema") {
    cinemaCamX = yardToWorldX(50);
    drawCinemaField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  } else {
    drawField(ctx, gameResult.homeTeam, gameResult.awayTeam, null);
  }
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, FIELD.W, FIELD.H);
  ctx.fillStyle = "#f0cc30";
  ctx.font = "bold 48px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("FINAL", FIELD.W / 2, FIELD.H / 2 - 24);
  ctx.font = "bold 32px sans-serif";
  ctx.fillStyle = "#fff";
  ctx.fillText(`${gameResult.homeTeam.name} ${gameResult.homeScore} — ${gameResult.awayScore} ${gameResult.awayTeam.name}`, FIELD.W / 2, FIELD.H / 2 + 22);
  // Stars of the game — top performers from both teams, shown with their key
  // stat line. Drawn beneath the FINAL banner before the scoreboard refresh.
  drawStarsOfGame(ctx);
  renderScoreboard();
  renderPlayLog();
  renderProgress();
  renderBoxScore();
}

// Compute the top 3 individual performances of the game (offense + defense).
// Score formula weighs TDs heavily, then yards/sacks/INTs/picks. Returns up
// to 3 player rows, each labeled with team + stat line.
function pickStarsOfGame() {
  const stats = (gameResult.plays.length && gameResult.plays[gameResult.plays.length - 1].statsSnap) || gameResult.stats;
  if (!stats) return [];
  const collect = (sideKey) => {
    const team = sideKey === "home" ? gameResult.homeTeam : gameResult.awayTeam;
    return Object.values(stats[sideKey].players || {}).map(p => ({ ...p, sideKey, teamName: team.name }));
  };
  const all = [...collect("home"), ...collect("away")];
  const scored = all.map(p => {
    let score = 0;
    let line = "";
    // QB
    if (p.pos === "QB") {
      score += (p.pass_td || 0) * 22 + (p.pass_yds || 0) * 0.10 + (p.pass_comp || 0) * 1.0
             - (p.pass_int || 0) * 14 - (p.sk_taken || 0) * 1;
      line = `${p.pass_comp || 0}/${p.pass_att || 0}, ${p.pass_yds || 0} yds, ${p.pass_td || 0} TD${(p.pass_int||0) ? `, ${p.pass_int} INT` : ""}`;
    }
    // RB
    if (p.rush_att > 0) {
      score += (p.rush_td || 0) * 18 + (p.rush_yds || 0) * 0.12 + (p.broken_tackles || 0) * 1.5
             - (p.fumbles_lost || 0) * 12;
      if (!line) line = `${p.rush_att || 0} car, ${p.rush_yds || 0} yds, ${p.rush_td || 0} TD`;
    }
    // Receiver
    if (p.rec > 0 || p.rec_tgt > 0) {
      const recScore = (p.rec_td || 0) * 18 + (p.rec_yds || 0) * 0.18 + (p.rec || 0) * 1.5;
      if (recScore > score) {
        score = recScore;
        line = `${p.rec || 0}/${p.rec_tgt || 0}, ${p.rec_yds || 0} yds, ${p.rec_td || 0} TD`;
      }
    }
    // Defender
    const defScore = (p.tkl || 0) * 1.5 + (p.sk || 0) * 8 + (p.int_made || 0) * 16
                   + (p.pd || 0) * 3 + (p.ff || 0) * 6 + (p.fr || 0) * 4 + (p.def_td || 0) * 24;
    if (defScore > score) {
      score = defScore;
      const parts = [];
      if (p.tkl)      parts.push(`${p.tkl} TKL`);
      if (p.sk)       parts.push(`${p.sk.toFixed(1)} SK`);
      if (p.int_made) parts.push(`${p.int_made} INT`);
      if (p.pd)       parts.push(`${p.pd} PD`);
      if (p.ff)       parts.push(`${p.ff} FF`);
      if (p.def_td)   parts.push(`${p.def_td} DEF TD`);
      line = parts.join(", ");
    }
    // Kicker
    if (p.fg_att > 0 && (p.fg_made || 0) >= 2) {
      const kScore = (p.fg_made || 0) * 6 + (p.fg_long || 0) * 0.10;
      if (kScore > score) { score = kScore; line = `${p.fg_made}/${p.fg_att} FG (long ${p.fg_long || 0})`; }
    }
    return { ...p, score, line };
  })
  .filter(p => p.score > 8 && p.line)
  .sort((a, b) => b.score - a.score)
  .slice(0, 3);
  return scored;
}

function drawStarsOfGame(ctx) {
  const stars = pickStarsOfGame();
  if (!stars.length) return;
  const baseY = FIELD.H / 2 + 60;
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#f0cc30";
  ctx.fillText("⭐ STARS OF THE GAME ⭐", FIELD.W / 2, baseY);
  ctx.font = "600 14px sans-serif";
  stars.forEach((s, i) => {
    const isHome = s.sideKey === "home";
    ctx.fillStyle = isHome ? "#9be09b" : "#9bd0ff";
    const y = baseY + 26 + i * 22;
    ctx.fillText(`${i + 1}. ${s.name} (${s.teamName}) — ${s.line}`, FIELD.W / 2, y);
  });
}

function setCaption(play) {
  const cap = $("playCaption");
  cap.className = "play-caption " + play.kind;
  cap.textContent = play.desc;
}

function setFieldStatus(play) {
  if (!play) return;
  const fs = $("fieldStatus");
  const qc = $("quarterClock");
  let possLabel = "";
  if (play.poss) {
    const team = play.poss === "home" ? gameResult.homeTeam : gameResult.awayTeam;
    possLabel = ` · ${teamAscii(team)} ${team.name} ball`;
  }
  let dd = "";
  if (play.down > 0) {
    const dStr = `${play.down}${["st","nd","rd","th"][play.down-1]} & ${play.ytg}`;
    const fieldDesc = play.poss === "home"
      ? (play.yardLine < 50 ? `own ${play.yardLine}` : play.yardLine === 50 ? "midfield" : `opp ${100 - play.yardLine}`)
      : (play.yardLine < 50 ? `own ${play.yardLine}` : play.yardLine === 50 ? "midfield" : `opp ${100 - play.yardLine}`);
    dd = ` · ${dStr} at ${fieldDesc}`;
  }
  fs.textContent = `${quarterLabel(play.quarter, play.time || 0)}${possLabel}${dd}`;
  qc.textContent = "";
}

function renderScoreboard(curPlay) {
  if (!gameResult) return;
  // Phase 1: when the BSPN broadcast layout is mounted, the new
  // panels own all per-play rendering. The legacy helper would
  // overwrite the new scoreboard if we let it run.
  if (document.querySelector(".bspnlive-root")) { renderBSPNLive(); return; }
  const last = curPlay || (playHead > 0 ? gameResult.plays[playHead - 1] : gameResult.plays[0]);
  const homeScore = last?.homeScore ?? 0;
  const awayScore = last?.awayScore ?? 0;
  const ended = playHead >= gameResult.plays.length;
  const winner = ended ? gameResult.winner : null;
  const sb = $("scoreboard");
  if (!sb) return;
  const pbBadge = team => {
    const pb = getPlaybook(team);
    if (pb.id === "AIR_RAID")         return `<span class="badge badge-air">AIR RAID</span>`;
    if (pb.id === "GROUND_AND_POUND") return `<span class="badge badge-gnp">G&amp;P</span>`;
    if (pb.id === "DUAL_THREAT")      return `<span class="badge badge-dt">DUAL THREAT</span>`;
    if (pb.id === "OPTION")           return `<span class="badge badge-opt">READ OPTION</span>`;
    return "";
  };
  const toDots = (count) => {
    const dots = [];
    for (let i = 0; i < 3; i++) dots.push(i < (count ?? 3) ? "●" : "○");
    return `<div class="timeout-dots" title="Timeouts remaining">${dots.join("")}</div>`;
  };
  const tos = last?.timeouts || { home: 3, away: 3 };
  sb.innerHTML = `
    <div class="score-team">
      <div class="score-team-emoji">${teamAscii(gameResult.homeTeam)}</div>
      <div class="score-team-full">${gameResult.homeTeam.city}</div>
      <div class="score-team-name">${gameResult.homeTeam.name}</div>
      ${pbBadge(gameResult.homeTeam)}
      <div class="score-num ${winner === "home" ? "win" : ""}">${homeScore}</div>
      ${toDots(tos.home)}
      ${last?.poss === "home" && !ended ? `<div class="poss-indicator">🏈 POSS</div>` : ""}
    </div>
    <div class="score-mid">
      <div class="score-status ${ended ? "final" : "live"}">
        ${ended ? (winner === "tie" ? "FINAL · TIE" : winner === "home" ? "🏆 HOME WIN" : "🏆 AWAY WIN") : "● LIVE"}
      </div>
      <div class="quarter-clock">${last ? quarterLabel(last.quarter, last.time || 0) : "—"}</div>
      ${last?.down > 0 && !ended ? `<div class="down-distance">${last.down}${["st","nd","rd","th"][last.down-1]} & ${last.ytg}</div>` : ""}
    </div>
    <div class="score-team">
      <div class="score-team-emoji">${teamAscii(gameResult.awayTeam)}</div>
      <div class="score-team-full">${gameResult.awayTeam.city}</div>
      <div class="score-team-name">${gameResult.awayTeam.name}</div>
      ${pbBadge(gameResult.awayTeam)}
      <div class="score-num ${winner === "away" ? "win" : ""}">${awayScore}</div>
      ${toDots(tos.away)}
      ${last?.poss === "away" && !ended ? `<div class="poss-indicator">🏈 POSS</div>` : ""}
    </div>
  `;
}

function renderProgress() {
  $("progLabel").textContent = `Play ${playHead} / ${gameResult.plays.length}`;
  $("progFill").style.width = `${(playHead / gameResult.plays.length) * 100}%`;
}

// Walk back from playHead to find the latest snapshot (kickoff/markers don't carry one)
function currentStats() {
  for (let i = Math.min(playHead, gameResult.plays.length) - 1; i >= 0; i--) {
    const s = gameResult.plays[i].statsSnap;
    if (s) return s;
  }
  // Pre-game: all zeros
  return gameResult.stats && {
    home: { team: emptyTeamTotals(), players: {} },
    away: { team: emptyTeamTotals(), players: {} },
  };
}

function emptyTeamTotals() {
  return { plays: 0, totalYds: 0, passYds: 0, rushYds: 0, pass_att: 0, pass_comp: 0,
           rush_att: 0, sacks: 0, sacks_allowed: 0, turnovers: 0, takeaways: 0,
           firstDowns: 0, thirdAtt: 0, thirdConv: 0, fourthAtt: 0, fourthConv: 0 };
}

function renderBoxScore() {
  // BSPN broadcast: the new layout owns the box-score panel.
  if (document.querySelector(".bspnlive-root")) { renderBSPNLive(); return; }
  const el = $("boxScore"); if (!el) return;
  const stats = currentStats();
  const hT = stats.home.team, aT = stats.away.team;
  const hP = stats.home.players, aP = stats.away.players;
  const homeName = gameResult.homeTeam.name, awayName = gameResult.awayTeam.name;

  if (boxTab === "totals") {
    const row = (lbl, h, a, fmt = v => v) => `
      <div class="team-totals">
        <div class="h">${fmt(h)}</div>
        <div class="lbl">${lbl}</div>
        <div class="a">${fmt(a)}</div>
      </div>`;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:.5rem;font-size:.7rem;color:var(--gray);padding-bottom:.3rem;border-bottom:1px solid var(--border);">
        <div style="text-align:right;color:var(--green-lt);font-weight:700">${homeName}</div>
        <div></div>
        <div style="text-align:left;color:var(--gold);font-weight:700">${awayName}</div>
      </div>
      ${row("TOTAL YDS", hT.totalYds, aT.totalYds)}
      ${row("PASS YDS", hT.passYds, aT.passYds)}
      ${row("RUSH YDS", hT.rushYds, aT.rushYds)}
      ${row("CMP / ATT", `${hT.pass_comp}/${hT.pass_att}`, `${aT.pass_comp}/${aT.pass_att}`)}
      ${row("RUSH ATT", hT.rush_att, aT.rush_att)}
      ${row("FIRST DOWNS", hT.firstDowns, aT.firstDowns)}
      ${row("3RD DOWN", `${hT.thirdConv}/${hT.thirdAtt}`, `${aT.thirdConv}/${aT.thirdAtt}`)}
      ${row("SACKS", hT.sacks, aT.sacks)}
      ${row("TURNOVERS", hT.turnovers, aT.turnovers)}
    `;
    return;
  }

  const sideStats = boxTab === "home" ? stats.home : stats.away;
  const teamLabel = boxTab === "home" ? gameResult.homeTeam : gameResult.awayTeam;
  const players = sideStats.players;
  const byPos = pos => Object.values(players).filter(p => p.pos === pos);

  const passingRows = byPos("QB").map(p =>
    `<tr>
      <td class="pos">QB</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.pass_comp}/${p.pass_att}</td>
      <td>${p.pass_yds}</td>
      <td>${p.pass_yds && p.pass_att ? (p.pass_yds / p.pass_att).toFixed(1) : "0.0"}</td>
      <td>${p.pass_td}</td>
      <td>${p.pass_int}</td>
      <td>${p.pass_long}</td>
    </tr>`).join("");

  const rushingRows = Object.values(players).filter(p => p.rush_att > 0).map(p =>
    `<tr>
      <td class="pos">${p.pos}</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.rush_att}</td>
      <td>${p.rush_yds}</td>
      <td>${p.rush_att ? (p.rush_yds / p.rush_att).toFixed(1) : "0.0"}</td>
      <td>${p.rush_td}</td>
      <td>${p.broken_tackles || 0}</td>
      <td>${(p.fumbles || 0) + (p.fumbles_lost ? `/${p.fumbles_lost}` : "")}</td>
      <td>${p.rush_long}</td>
    </tr>`).join("");

  const recRows = Object.values(players).filter(p => p.rec_tgt > 0).map(p =>
    `<tr>
      <td class="pos">${p.pos}</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.rec}/${p.rec_tgt}</td>
      <td>${p.rec_yds}</td>
      <td>${p.rec ? (p.rec_yds / p.rec).toFixed(1) : "0.0"}</td>
      <td>${p.rec_td}</td>
      <td>${p.rec_drops || 0}</td>
      <td>${p.rec_long}</td>
    </tr>`).join("");

  const kickRows = byPos("K").filter(p => p.fg_att + p.xp_att > 0).map(p =>
    `<tr>
      <td class="pos">K</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.fg_made}/${p.fg_att}</td>
      <td>${p.fg_long || "—"}</td>
      <td>${p.xp_made}/${p.xp_att}</td>
    </tr>`).join("");

  // Defense — any player with any defensive stat > 0. Includes def_td
  // (pick-six, fumble return TD, blocked-FG return TD).
  const defRows = Object.values(players)
    .filter(p => ["DE","DT","LB","CB","FS","SS"].includes(p.pos))
    .filter(p => (p.tkl || p.sk || p.int_made || p.pd || p.ff || p.fr || p.def_td) > 0)
    .sort((a, b) => (b.tkl + b.sk * 2 + b.int_made * 3 + b.pd + (b.def_td || 0) * 6) - (a.tkl + a.sk * 2 + a.int_made * 3 + a.pd + (a.def_td || 0) * 6))
    .map(p => `<tr>
      <td class="pos">${p.pos}</td>
      <td class="name">${nameSpan(p.name)}</td>
      <td>${p.tkl || 0}</td>
      <td>${p.sk ? p.sk.toFixed(1) : "0.0"}</td>
      <td>${p.int_made || 0}</td>
      <td>${p.pd || 0}</td>
      <td>${p.ff || 0}</td>
      <td>${p.fr || 0}</td>
      <td>${p.def_td || 0}</td>
    </tr>`).join("");

  const empty = `<tr><td colspan="9" style="color:var(--gray);text-align:center;padding:.4rem">—</td></tr>`;

  el.innerHTML = `
    <div style="font-size:.7rem;color:var(--gold);font-weight:700;letter-spacing:.4px;margin-bottom:.4rem;">${teamAscii(teamLabel)} ${teamLabel.city.toUpperCase()} ${teamLabel.name.toUpperCase()}</div>
    <div class="boxscore-section">
      <h4>PASSING</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>C/A</th><th>YDS</th><th>AVG</th><th>TD</th><th>INT</th><th>LNG</th></tr></thead>
        <tbody>${passingRows || empty}</tbody>
      </table>
      <h4>RUSHING</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>ATT</th><th>YDS</th><th>AVG</th><th>TD</th><th>BTK</th><th>FUM</th><th>LNG</th></tr></thead>
        <tbody>${rushingRows || empty}</tbody>
      </table>
      <h4>RECEIVING</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>R/T</th><th>YDS</th><th>AVG</th><th>TD</th><th>DRP</th><th>LNG</th></tr></thead>
        <tbody>${recRows || empty}</tbody>
      </table>
      <h4>DEFENSE</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>TKL</th><th>SK</th><th>INT</th><th>PD</th><th>FF</th><th>FR</th><th>TD</th></tr></thead>
        <tbody>${defRows || empty}</tbody>
      </table>
      <h4>KICKING</h4>
      <table class="boxscore-table">
        <thead><tr><th></th><th></th><th>FG</th><th>LNG</th><th>XP</th></tr></thead>
        <tbody>${kickRows || empty}</tbody>
      </table>
    </div>
  `;
}

function renderPlayLog() {
  // BSPN broadcast: the new pbp panel handles this through the adapter.
  if (document.querySelector(".bspnlive-root")) { renderBSPNLive(); return; }
  const log = $("playLog");
  const visible = gameResult.plays.slice(0, playHead);
  log.innerHTML = visible.map(p => playEntry(p)).join("");
  log.scrollTop = log.scrollHeight;
}

function quarterLabel(q, t) {
  if (q === 5) return `OT ${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`;
  return `Q${q} ${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`;
}

function highlightPlayerNamesInPlay(p) {
  let out = escapeHtml(p.desc || "");
  // ALL name-bearing fields on a play object — offense AND defense. Anyone
  // mentioned in the description should be a hoverable .player-name span,
  // not raw text (which is why defenders like tacklers / sackers / forced-
  // fumblers used to be unhoverable).
  const players = [
    p.passer, p.rusher, p.receiver, p.kicker, p.intended,
    p.tackler, p.defender, p.sacker, p.forcedBy, p.interceptor,
    p.returner, p.muffedBy,
  ].filter(Boolean);
  // Sort longest first so "Marcus Smith" wins over "Marcus"
  players.sort((a, b) => b.length - a.length);
  const placeholders = [];
  for (let i = 0; i < players.length; i++) {
    const name = players[i];
    const escName = escapeHtml(name);
    if (out.includes(escName)) {
      const ph = `\x00P${i}\x00`;
      out = out.split(escName).join(ph);
      placeholders[i] = nameSpan(name);
    }
  }
  for (let i = 0; i < placeholders.length; i++) {
    if (placeholders[i]) out = out.split(`\x00P${i}\x00`).join(placeholders[i]);
  }
  return out;
}

function playEntry(p) {
  const isMarker = ["halftime","ot","quarter","kickoff","two_min_warning","timeout","drive_summary"].includes(p.kind);
  if (isMarker) return `<div class="play-entry ${p.kind}">${escapeHtml(p.desc)}</div>`;
  // ── BIOMECHANICS-AWARE ENTRIES (Wave 1 — Live Game Viewer) ────────
  // Big hits, ejections, and UR-flag-driven penalties get an inline
  // chip strip showing what the engine knows about the contact: hit
  // mechanism, force, tackler archetype, body-part impact.
  if (p.kind === "big_hit") {
    const chips = [];
    if (p.mechanism) {
      const mechColor = p.mechanism === "high" ? "#e6373a"
                     : p.mechanism === "head_on" ? "#ed6a3a"
                     : p.mechanism === "low" ? "#f0a93a"
                     : p.mechanism === "behind" ? "#d4dc5a"
                     : "#90c4ec";
      const mechLbl = p.mechanism === "head_on" ? "HEAD-ON"
                    : p.mechanism === "high"    ? "HIGH"
                    : p.mechanism === "low"     ? "LOW"
                    : p.mechanism === "side"    ? "SIDE"
                    : p.mechanism === "behind"  ? "BLINDSIDE"
                    : p.mechanism.toUpperCase();
      chips.push(`<span style="background:${mechColor};color:#000;font-size:.55rem;letter-spacing:.6px;font-weight:800;padding:.05rem .3rem;border-radius:2px;margin:0 .15rem">${mechLbl}</span>`);
    }
    if (p.force != null) {
      const fColor = p.force >= 1.9 ? "#e6373a" : p.force >= 1.7 ? "#ed6a3a" : "#f0a93a";
      chips.push(`<span style="color:${fColor};font-size:.6rem;font-weight:700;letter-spacing:.4px;margin:0 .15rem">⚡ ${p.force.toFixed(2)}</span>`);
    }
    if (p.eventType === "sack") chips.push(`<span style="color:#90c4ec;font-size:.55rem;letter-spacing:.6px;font-weight:700;padding:.05rem .3rem;border:1px solid #90c4ec;border-radius:2px;margin:0 .15rem">SACK</span>`);
    return `<div class="play-entry big-hit" style="background:rgba(230,55,58,.08);border-left:3px solid #e6373a;padding:.35rem .55rem;margin:.2rem 0;border-radius:2px">
      <span style="font-size:.7rem;font-weight:700">${highlightPlayerNamesInPlay(p)}</span>
      <div style="margin-top:.2rem">${chips.join("")}</div>
    </div>`;
  }
  if (p.kind === "ejection") {
    return `<div class="play-entry ejection" style="background:rgba(230,55,58,.18);border:2px solid #e6373a;padding:.45rem .6rem;margin:.3rem 0;border-radius:4px;font-weight:800;color:#ec9090;letter-spacing:.5px">${highlightPlayerNamesInPlay(p)}</div>`;
  }
  // Field-position phrase: own 30 / opp 35 / midfield. startYard is from
  // the offense's perspective (0 = own goal, 100 = opp goal).
  const fp = p.startYard;
  const fieldPos = (typeof fp === "number")
    ? (fp === 50 ? "midfield"
      : fp < 50  ? `own ${fp}`
      :            `opp ${100 - fp}`)
    : null;
  const downStr = p.down > 0
    ? `${p.down}${["st","nd","rd","th"][p.down-1]} & ${p.ytg}` + (fieldPos ? ` at ${fieldPos}` : "")
    : "";
  const meta = `Q${p.quarter} ${Math.floor(p.time/60)}:${String(p.time%60).padStart(2,"0")}`
             + (downStr ? ` · ${downStr}` : "");
  const icon = p.kind === "score" ? "🏈 "
             : p.kind === "int" || p.kind === "fumble" ? "⚠️ "
             : p.kind === "fg_good" ? "✅ "
             : p.kind === "fg_miss" ? "❌ "
             : "";
  return `<div class="play-entry ${p.kind}"><span class="meta">${meta}</span>${icon}${highlightPlayerNamesInPlay(p)}</div>`;
}

function renderRatings() {
  const r = gameResult; if (!r) return;
  const row = (label, h, a) => {
    const winner = h > a ? "h" : a > h ? "a" : null;
    return `<tr>
      <td class="home ${winner === "h" ? "winner" : ""}">${Math.round(h)}</td>
      <td class="lbl">${label}</td>
      <td class="away ${winner === "a" ? "winner" : ""}">${Math.round(a)}</td>
    </tr>`;
  };
  // Starter rows — show name (hoverable) + OVR for each side's top player at the slot
  const topAt = (roster, pos, idx = 0) => {
    const list = roster.filter(p => p.position === pos).sort((a, b) => b.overall - a.overall);
    return list[idx] || null;
  };
  const starterRow = (label, hP, aP) => {
    if (!hP || !aP) return "";
    const winner = hP.overall > aP.overall ? "h" : aP.overall > hP.overall ? "a" : null;
    return `<tr class="starter-row">
      <td class="home ${winner === "h" ? "winner" : ""}">${nameSpan(hP.name)} <span class="ovr-pill">${hP.overall}</span></td>
      <td class="lbl">${label}</td>
      <td class="away ${winner === "a" ? "winner" : ""}"><span class="ovr-pill">${aP.overall}</span> ${nameSpan(aP.name)}</td>
    </tr>`;
  };
  $("ratings").innerHTML = `
    <thead><tr>
      <th class="home" style="color:var(--gold);font-size:.78rem">${r.homeTeam.name}</th>
      <th class="lbl"></th>
      <th class="away" style="color:var(--gold);font-size:.78rem">${r.awayTeam.name}</th>
    </tr></thead>
    <tbody>
      ${row("OFFENSE", r.homeRatings.offense, r.awayRatings.offense)}
      ${row("DEFENSE", r.homeRatings.defense, r.awayRatings.defense)}
      ${starterRow("QB",  topAt(r.homeRoster, "QB"), topAt(r.awayRoster, "QB"))}
      ${starterRow("RB",  topAt(r.homeRoster, "RB"), topAt(r.awayRoster, "RB"))}
      ${starterRow("WR1", topAt(r.homeRoster, "WR", 0), topAt(r.awayRoster, "WR", 0))}
      ${starterRow("WR2", topAt(r.homeRoster, "WR", 1), topAt(r.awayRoster, "WR", 1))}
      ${starterRow("TE",  topAt(r.homeRoster, "TE"), topAt(r.awayRoster, "TE"))}
      ${row("OL",  r.homeRatings.ol,  r.awayRatings.ol)}
      ${row("DL",  r.homeRatings.dl,  r.awayRatings.dl)}
      ${row("LB",  r.homeRatings.lb,  r.awayRatings.lb)}
      ${row("CB",  r.homeRatings.cb,  r.awayRatings.cb)}
      ${row("S",   r.homeRatings.saf, r.awayRatings.saf)}
      ${starterRow("K",   topAt(r.homeRoster, "K"), topAt(r.awayRoster, "K"))}
    </tbody>
  `;
}

