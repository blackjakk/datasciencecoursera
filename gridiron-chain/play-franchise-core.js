// ─── FRANCHISE MODE ────────────────────────────────────────────────────────
// Full multi-season career mode. Pick a team, play 14-game regular season,
// 8-team playoffs, end-of-season awards, basic offseason (age/retire/rookies).
// State persisted in localStorage so it survives page reloads.

const FRANCHISE_KEY   = "gc_franchise_v1";
const FRANCHISE_WEEKS = 14;
const PLAYOFF_TEAMS   = 8;
const SALARY_CAP_BASE = 200; // $M — grows ~5-9% each offseason

// Inline confirmation state — avoids browser confirm()/alert() dialogs.
let _restructurePending = null; // {teamId,name,pos,currentBase,newProration,freed,remaining}
let _releasePending     = null; // {name,pos,deadPerYr,deadYrs,deadTotal}
let _resignPreview      = null; // idx of resign row showing year-by-year signing preview

// ── Practice squad system ────────────────────────────────────────────────────
// Each team carries a 6-spot PS roster of young players (≤2 yrs exp, age ≤24).
// Per-spot cost ($0.5M) loads against the cap separately from active roster.
// Players get a weekly "flash roll" — small chance of showing breakout
// upside. Other teams can scout your PS to reveal hidden potential, then
// poach the gem. Auto-spend lets the user burn unused visits at week
// advance so they're not wasted.
const PS_SLOTS         = 6;
const PS_COST_PER_SLOT = 0.5;     // $M
const PS_MAX_AGE       = 24;
const PS_MAX_YEARS_EXP = 2;
const SCOUT_VISITS_PER_WEEK = 2;
const WORKOUT_SLOTS_PER_FA_SEASON = 5;
// Weekly flash probabilities per PS player.
const PS_FLASH_PROBS = {
  small: 0.03,    // +0-1 OVR
  wow:   0.005,   // +3-5 OVR + wire alert
  gem:   0.001,   // +8+ OVR + big wire alert
};

// ── Salary cap helpers ───────────────────────────────────────────────────────
// Per-position rate: fraction of cap that a 100-OVR player would earn.
const CAP_POS_RATE = {
  QB: 0.25, RB: 0.08, WR: 0.12, TE: 0.07, OL: 0.06,
  DL: 0.065, LB: 0.065, CB: 0.09, S: 0.055, K: 0.025, P: 0.022,
};

// Render the inner HTML for an "AAV vs current market" cell. A clear
// signal — overpaid is red, bargain is green, within $1M is "≈ Market".
// Caller wraps the result in <td>.
function vsMarketCell(aav, market) {
  const diff = +(aav - market).toFixed(1);
  const cls  = "font-size:.65rem";
  if (Math.abs(diff) < 1.0) {
    return `<span style="color:var(--gray);${cls}">≈ Market</span>`;
  }
  const sign = diff > 0 ? "+" : "−";
  const color = diff > 2 ? "var(--red)" : diff < -2 ? "var(--green-lt)" : "var(--gray)";
  const label = diff > 0 ? "over" : "value";
  return `<span style="color:${color};${cls}">${sign}$${Math.abs(diff).toFixed(1)}M ${label}</span>`;
}

function computeMarketValue(player, cap) {
  const ovr  = player.overall || 70;
  const pos  = player.position;
  const rate = CAP_POS_RATE[pos] || 0.06;
  const capRef = cap || SALARY_CAP_BASE;
  // Base scales from 0 at OVR 55 to rate×cap at OVR 100
  let val = capRef * rate * Math.max(0, (ovr - 55) / 45);
  // Age adjustment
  const age = player.age || 27;
  if (age <= 25)      val *= 1.10;
  else if (age >= 34) val *= 0.75;
  else if (age >= 31) val *= 0.90;
  return Math.max(0.5, Math.round(val * 10) / 10);
}

// Deterministic per-player negotiation factor (0.82–1.22). Drives the
// realistic variance you see on the "vs Market" column — agents,
// leverage, draft pedigree, timing all push real contracts off the
// theoretical market value. Hashed from the player name so the value
// is stable across renders.
function negotiationFactor(p) {
  let h = 0;
  const s = String(p?.name || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  // 41 buckets in [-0.20, +0.20], shifted to [0.82, 1.22] with a
  // small tilt: 1st-round picks negotiate harder (skew up),
  // undrafted skew slightly down.
  const base = ((Math.abs(h) % 41) - 20) / 100;
  let tilt = 0;
  if (p?.draftRound === 1) tilt += 0.03;
  else if (p?.draftRound >= 5) tilt -= 0.02;
  else if (p?.draftRound === 0) tilt -= 0.04;
  return Math.max(0.78, Math.min(1.25, 1 + base + tilt));
}

// ── Contract structure helpers ──────────────────────────────────────────────
// Signing bonus as a % of total contract value, prorated over min(years,5).
// Stars get bigger bonuses (more dead cap risk), backups get nothing.
function _signingBonusCalc(aav, years, ovr) {
  let pct = 0;
  if      (ovr >= 90) pct = 0.40;
  else if (ovr >= 85) pct = 0.28;
  else if (ovr >= 80) pct = 0.16;
  else if (ovr >= 75) pct = 0.08;
  const prorationYears = Math.min(years, 5);
  const signingBonus = Math.round(aav * years * pct * 10) / 10;
  const bonusProration = signingBonus > 0
    ? Math.round(signingBonus / prorationYears * 10) / 10
    : 0;
  return { signingBonus, bonusProration };
}

// Per-year base salaries (cap hit = base + bonusProration each year).
// BACKLOADED: ramps from ~65% to ~135% of average base — cheap now, expensive later.
// FRONTLOADED: opposite — player secures money early.
// BALANCED: flat.
function _baseSalarySchedule(aav, years, structure, bonusProration) {
  const basePerYear = aav - bonusProration;
  if (years <= 1 || structure === "BALANCED") {
    return Array(years).fill(Math.round(basePerYear * 10) / 10);
  }
  const spread = 0.35;
  const raw = [];
  for (let i = 0; i < years; i++) {
    const t = i / Math.max(1, years - 1);
    const scale = structure === "BACKLOADED"
      ? 1 - spread / 2 + spread * t
      : 1 + spread / 2 - spread * t;
    raw.push(scale);
  }
  const mean = raw.reduce((s, x) => s + x, 0) / years;
  return raw.map(s => Math.max(0.5, Math.round(basePerYear * (s / mean) * 10) / 10));
}

// Default structure: veterans lean backloaded (team-friendly now),
// young stars tend frontloaded (player secures early money).
function _defaultStructure(age, ovr) {
  if (age <= 25 && ovr >= 82) return "FRONTLOADED";
  if (age >= 30)               return "BACKLOADED";
  return "BALANCED";
}

function generateContract(player, cap, structureOverride) {
  const ovr = player.overall || 70;
  const age = player.age || 25;

  // Fix 1: Minimum salary for low-OVR players — 1yr, no signing bonus, zero dead cap.
  // These are the easy "camp cut" candidates that give GMs roster flexibility.
  if (ovr < 70) {
    const minAav = Math.max(0.8, Math.round((0.8 + Math.random() * 0.7) * 10) / 10);
    return {
      years: 1, remaining: 1, aav: minAav, structure: "BALANCED",
      baseSalaries: [minAav], signingBonus: 0, bonusProration: 0,
      guaranteedYears: 0, guaranteedAAV: minAav, incentives: [], signedAav: minAav,
    };
  }

  const market = computeMarketValue(player, cap);
  const factor = negotiationFactor(player);
  const aav = Math.max(0.5, Math.round(market * factor * 10) / 10);

  // Fix 4: Backup contract length cap — lower-OVR players get shorter deals
  // so there's always a pool of cuttable contracts without long dead-cap tails.
  let minYr = 2, maxYr = 5;
  if (age <= 23)      { minYr = 4; maxYr = 4; }
  else if (ovr >= 88) { minYr = 4; maxYr = 7; }
  else if (ovr >= 82) { minYr = 3; maxYr = 6; }
  else if (ovr >= 76) { minYr = 2; maxYr = 3; } // solid backups: 2-3yr max
  else                { minYr = 1; maxYr = 2; } // fringe starters: 1-2yr only
  maxYr = Math.min(maxYr, Math.max(1, 38 - age));
  const years = Math.max(1, Math.min(10, minYr + Math.floor(Math.random() * (maxYr - minYr + 1))));
  const structure = structureOverride || _defaultStructure(age, ovr);
  const { signingBonus, bonusProration } = _signingBonusCalc(aav, years, ovr);
  const baseSalaries = _baseSalarySchedule(aav, years, structure, bonusProration);
  return {
    years, remaining: years, aav, structure,
    baseSalaries, signingBonus, bonusProration,
    guaranteedYears: _guaranteedYearsForLength(years),
    guaranteedAAV: aav, incentives: [], signedAav: aav,
  };
}

// NFL-style rookie wage scale (slotted). AAV is anchored on draft
// round + pick, with a small position multiplier so QB / OL / EDGE
// see a premium and K/P see a discount. Deliberately decoupled from
// the player's OVR — a 4th-round QB who happens to be good still
// only signs a 4th-round-money deal.
const _ROOKIE_AAV_BY_ROUND = {
  1: 0.045,    // R1: 4.5% of cap base
  2: 0.018,
  3: 0.012,
  4: 0.008,
  5: 0.0055,
  6: 0.0045,
  7: 0.0038,
  0: 0.0035,   // UDFA — close to league minimum
};
const _ROOKIE_POS_MUL = {
  QB: 1.30, OL: 1.10, DL: 1.05, CB: 1.05, WR: 1.05,
  LB: 1.00, S: 0.95, TE: 0.95, RB: 0.92, K: 0.70, P: 0.70,
};
function rookieContract(player, cap) {
  const round  = player.draftRound ?? 0;
  const pick   = player.draftPick  ?? 1;
  const capRef = cap || SALARY_CAP_BASE;
  const baseRate = _ROOKIE_AAV_BY_ROUND[round] ?? _ROOKIE_AAV_BY_ROUND[7];
  const pickPos = Math.max(0, (pick || 1) - 1);
  const decay = round === 1 ? 1 - (pickPos / 32) * 0.40
              : round === 2 ? 1 - (pickPos / 32) * 0.25
              : round <= 4  ? 1 - (pickPos / 32) * 0.15
              :               1 - (pickPos / 32) * 0.10;
  const posMul = _ROOKIE_POS_MUL[player.position] ?? 1.0;
  const aav = Math.max(0.5, Math.round(capRef * baseRate * decay * posMul * 10) / 10);
  const years = round === 0 ? 3 : 4;
  // Rookies always get balanced/slotted deals — no signing bonus for UDFA,
  // small bonus for drafted players (R1 gets meaningful proration).
  const ovr = player.overall || 70;
  const { signingBonus, bonusProration } = _signingBonusCalc(aav, years, ovr);
  const baseSalaries = _baseSalarySchedule(aav, years, "BALANCED", bonusProration);
  return {
    years, remaining: years, aav, structure: "BALANCED",
    baseSalaries, signingBonus, bonusProration,
    guaranteedYears: _guaranteedYearsForLength(years),
    guaranteedAAV: aav,
    incentives: [],
  };
}

function assignContracts(rosters, cap) {
  const capTarget = (cap || SALARY_CAP_BASE) * 0.90; // Fix 2: target 90% of cap per roster
  for (const roster of Object.values(rosters)) {
    const freshPlayers = [];
    for (const p of roster) {
      if (!p.contract) {
        p.contract = generateContract(p, cap);
        if ((p.age || 25) > 23) {
          p.contract.remaining = Math.max(1, Math.ceil(Math.random() * p.contract.years));
        }
        freshPlayers.push(p);
      }
    }

    // Fix 2: Cap-aware normalization for fresh rosters.
    // If total cap hit exceeds 90% of cap, scale down lower-OVR players first,
    // then proportionally scale everyone until we're within budget.
    if (freshPlayers.length >= roster.length * 0.8) {
      let totalHit = roster.reduce((s, p) => s + currentYearCapHit(p), 0);
      if (totalHit > capTarget) {
        // First pass: convert OVR<75 players to minimum deals if still over
        for (const p of roster) {
          if (totalHit <= capTarget) break;
          if ((p.overall || 70) < 75 && p.contract && p.contract.bonusProration > 0) {
            const oldHit = currentYearCapHit(p);
            const minAav = Math.max(0.8, Math.round((0.8 + Math.random() * 0.5) * 10) / 10);
            p.contract = { years:1, remaining:1, aav:minAav, structure:"BALANCED",
              baseSalaries:[minAav], signingBonus:0, bonusProration:0,
              guaranteedYears:0, guaranteedAAV:minAav, incentives:[], signedAav:minAav };
            totalHit -= (oldHit - minAav);
          }
        }
        // Second pass: proportional scale-down of everyone if still over
        totalHit = roster.reduce((s, p) => s + currentYearCapHit(p), 0);
        if (totalHit > capTarget) {
          const scale = capTarget / totalHit;
          for (const p of roster) {
            if (!p.contract) continue;
            p.contract.aav = Math.max(0.5, Math.round(p.contract.aav * scale * 10) / 10);
            const { signingBonus, bonusProration } = _signingBonusCalc(p.contract.aav, p.contract.years || 1, p.overall || 70);
            p.contract.signingBonus   = signingBonus;
            p.contract.bonusProration = bonusProration;
            p.contract.baseSalaries   = _baseSalarySchedule(p.contract.aav, p.contract.years || 1, p.contract.structure || "BALANCED", bonusProration);
          }
        }
      }
      // Mark all as having been through the new system
      for (const p of roster) if (p.contract) p.contract.signedAav = p.contract.aav;
      continue;
    }

    // Retrofit older saves: apply negotiation variance, normalise so AAV total is preserved.
    const needsRetrofit = roster.some(p => p.contract && p.contract.signedAav == null);
    if (!needsRetrofit) {
      // Backfill signing-bonus fields for saves that pre-date this feature.
      for (const p of roster) {
        if (!p.contract) continue;
        if (p.contract.bonusProration == null) {
          const { signingBonus, bonusProration } = _signingBonusCalc(p.contract.aav, p.contract.years || 1, p.overall || 70);
          p.contract.signingBonus   = signingBonus;
          p.contract.bonusProration = bonusProration;
        }
        if (!p.contract.structure) {
          p.contract.structure = _defaultStructure(p.age || 27, p.overall || 70);
        }
        if (!p.contract.baseSalaries) {
          p.contract.baseSalaries = _baseSalarySchedule(
            p.contract.aav, p.contract.years || 1,
            p.contract.structure, p.contract.bonusProration
          );
        }
        if (!p.contract.incentives) p.contract.incentives = [];
      }
      continue;
    }
    let oldTotal = 0, newTotal = 0;
    for (const p of roster) {
      if (!p.contract) continue;
      p.contract.signedAav = p.contract.aav;
      oldTotal += p.contract.aav;
      const tentative = Math.max(0.5, Math.round(computeMarketValue(p, cap) * negotiationFactor(p) * 10) / 10);
      p.contract.aav = tentative;
      newTotal += tentative;
    }
    if (newTotal > 0 && oldTotal > 0 && Math.abs(newTotal - oldTotal) > 0.01) {
      const scale = oldTotal / newTotal;
      for (const p of roster) {
        if (!p.contract) continue;
        p.contract.aav = Math.max(0.5, Math.round(p.contract.aav * scale * 10) / 10);
      }
    }
    // Now backfill bonus/structure on the retrofitted contracts too.
    for (const p of roster) {
      if (!p.contract) continue;
      if (p.contract.bonusProration == null) {
        const { signingBonus, bonusProration } = _signingBonusCalc(p.contract.aav, p.contract.years || 1, p.overall || 70);
        p.contract.signingBonus   = signingBonus;
        p.contract.bonusProration = bonusProration;
      }
      if (!p.contract.structure) p.contract.structure = _defaultStructure(p.age || 27, p.overall || 70);
      if (!p.contract.baseSalaries) {
        p.contract.baseSalaries = _baseSalarySchedule(
          p.contract.aav, p.contract.years || 1,
          p.contract.structure, p.contract.bonusProration
        );
      }
      if (!p.contract.incentives) p.contract.incentives = [];
    }
  }
}

// Cap hit for the current contract year = base salary for this year + bonus proration.
// Falls back to flat AAV for old saves that haven't been backfilled yet.
function currentYearCapHit(player) {
  const c = player.contract;
  if (!c) return 0;
  if (!c.baseSalaries || c.bonusProration == null) return (c.aav || 0) + _ltbeIncentivesTotal(player);
  const yearIndex = Math.max(0, (c.years || 1) - (c.remaining || 1));
  const base = c.baseSalaries[yearIndex] ?? (c.aav - (c.bonusProration || 0));
  return Math.round((base + (c.bonusProration || 0) + _ltbeIncentivesTotal(player)) * 10) / 10;
}

// Dead cap owed if the player is released right now = prorated bonus remaining.
// For old saves without bonusProration, falls back to the old guaranteedYears model.
function deadCapOnRelease(player) {
  const c = player.contract;
  if (!c) return { perYear: 0, years: 0 };
  const remaining = c.remaining || 0;
  if (c.bonusProration > 0) {
    return { perYear: c.bonusProration, years: remaining };
  }
  // Legacy fallback
  const gYrs = Math.min(remaining, c.guaranteedYears || 0);
  return { perYear: c.guaranteedAAV ?? c.aav ?? 0, years: gYrs };
}

function capUsedByTeam(teamId) {
  const roster = (franchise?.rosters || {})[teamId] || [];
  let used = roster.reduce((s, p) => s + currentYearCapHit(p), 0);
  // Practice squad: each PS spot costs PS_COST_PER_SLOT, charged to cap.
  used += psCostForTeam(teamId);
  // Salary refunds: outgoing refunds count against the sender's cap
  // (dead money for the years left on the original deal); incoming
  // refunds offset the receiver's cap.
  for (const r of (franchise?.refunds || [])) {
    if (!r.yearsRemaining || r.yearsRemaining <= 0) continue;
    if (r.fromTeamId === teamId) used += r.amount;
    else if (r.toTeamId === teamId) used -= r.amount;
  }
  return Math.round(used * 10) / 10;
}

// Summary of a team's outgoing/incoming refunds for display.
function refundsForTeam(teamId) {
  const out = (franchise?.refunds || []).filter(r => r.yearsRemaining > 0 && r.fromTeamId === teamId);
  const inc = (franchise?.refunds || []).filter(r => r.yearsRemaining > 0 && r.toTeamId === teamId);
  return {
    outgoing: out, outgoingTotal: out.reduce((s,r) => s + r.amount, 0),
    incoming: inc, incomingTotal: inc.reduce((s,r) => s + r.amount, 0),
  };
}

function currentCap() {
  return franchise?.salaryCap || SALARY_CAP_BASE;
}

// ── Incentive clause system ─────────────────────────────────────────────────
// Contracts carry 0-3 performance bonuses. LTBE (Likely To Be Earned) bonuses
// count against the cap now because the player hit the threshold last season.
// NLTBE bonuses don't count until earned; if earned they hit next year's cap.
const INCENTIVE_TEMPLATES = {
  QB:  [
    { label:"4500+ Pass Yds", stat:"pass_yds", threshold:4500, bonus:1.0 },
    { label:"4000+ Pass Yds", stat:"pass_yds", threshold:4000, bonus:0.75 },
    { label:"35+ Pass TDs",   stat:"pass_td",  threshold:35,   bonus:1.0 },
    { label:"30+ Pass TDs",   stat:"pass_td",  threshold:30,   bonus:0.75 },
    { label:"Pro Bowl",       stat:"pro_bowl", threshold:1,    bonus:1.5 },
  ],
  RB:  [
    { label:"1400+ Rush Yds", stat:"rush_yds", threshold:1400, bonus:1.0 },
    { label:"1200+ Rush Yds", stat:"rush_yds", threshold:1200, bonus:0.75 },
    { label:"1000+ Rush Yds", stat:"rush_yds", threshold:1000, bonus:0.5 },
    { label:"12+ Rush TDs",   stat:"rush_td",  threshold:12,   bonus:0.75 },
    { label:"Pro Bowl",       stat:"pro_bowl", threshold:1,    bonus:1.0 },
  ],
  WR:  [
    { label:"1400+ Rec Yds",  stat:"rec_yds", threshold:1400, bonus:1.0 },
    { label:"1200+ Rec Yds",  stat:"rec_yds", threshold:1200, bonus:0.75 },
    { label:"1000+ Rec Yds",  stat:"rec_yds", threshold:1000, bonus:0.5 },
    { label:"100+ Receptions",stat:"rec",     threshold:100,  bonus:0.75 },
    { label:"Pro Bowl",       stat:"pro_bowl", threshold:1,    bonus:1.0 },
  ],
  TE:  [
    { label:"900+ Rec Yds",  stat:"rec_yds", threshold:900, bonus:0.75 },
    { label:"700+ Rec Yds",  stat:"rec_yds", threshold:700, bonus:0.5 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1,   bonus:1.0 },
  ],
  DL:  [
    { label:"12+ Sacks",     stat:"sk",      threshold:12, bonus:1.0 },
    { label:"10+ Sacks",     stat:"sk",      threshold:10, bonus:0.75 },
    { label:"8+ Sacks",      stat:"sk",      threshold:8,  bonus:0.5 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1,  bonus:1.0 },
  ],
  LB:  [
    { label:"100+ Tackles",  stat:"tkl",     threshold:100, bonus:0.75 },
    { label:"8+ Sacks",      stat:"sk",      threshold:8,   bonus:0.75 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1,   bonus:1.0 },
  ],
  CB:  [
    { label:"6+ INTs",       stat:"int_made",threshold:6, bonus:1.0 },
    { label:"4+ INTs",       stat:"int_made",threshold:4, bonus:0.75 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1, bonus:1.0 },
  ],
  S:   [
    { label:"4+ INTs",       stat:"int_made",threshold:4, bonus:0.75 },
    { label:"80+ Tackles",   stat:"tkl",     threshold:80, bonus:0.5 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1, bonus:1.0 },
  ],
  OL:  [{ label:"Pro Bowl",  stat:"pro_bowl",threshold:1, bonus:1.0 }],
  K:   [
    { label:"30+ FG Made",   stat:"fg_made", threshold:30, bonus:0.5 },
    { label:"Pro Bowl",      stat:"pro_bowl",threshold:1,  bonus:0.75 },
  ],
};

function _getLastSeasonStat(player, stat) {
  if (stat === "pro_bowl") return 0; // Pro Bowl determined separately
  for (const teamStats of Object.values(franchise?.seasonStats || {})) {
    const row = teamStats[player.name];
    if (row) return row[stat] || 0;
  }
  return 0;
}

function _playerIncentiveWillingness(player) {
  const ovr = player.overall || 70;
  const age = player.age || 27;
  if (ovr >= 88) return 0.04;
  if (ovr >= 82) return 0.10;
  if (age >= 32) return 0.25;
  if (ovr >= 76) return 0.18;
  return 0.22;
}

function _generateIncentives(player, aav) {
  const templates = INCENTIVE_TEMPLATES[player.position] || [];
  if (!templates.length) return [];
  const willingness = _playerIncentiveWillingness(player);
  if (willingness < 0.05) return [];
  const maxVal = aav * willingness;
  const incentives = [];
  let total = 0;
  for (const tmpl of templates) {
    if (total + tmpl.bonus > maxVal + 0.1) continue;
    const lastStat = _getLastSeasonStat(player, tmpl.stat);
    const type = lastStat >= tmpl.threshold ? "LTBE" : "NLTBE";
    incentives.push({ label: tmpl.label, stat: tmpl.stat, threshold: tmpl.threshold, bonus: tmpl.bonus, type });
    total += tmpl.bonus;
    if (incentives.length >= 3) break;
  }
  return incentives;
}

function _ltbeIncentivesTotal(player) {
  return (player.contract?.incentives || [])
    .filter(inc => inc.type === "LTBE")
    .reduce((s, inc) => s + (inc.bonus || 0), 0);
}

// ── Cap projections ─────────────────────────────────────────────────────────
function projectPlayerCapHit(player, yearsAhead) {
  const c = player.contract;
  if (!c) return 0;
  const futureRemaining = (c.remaining || 0) - yearsAhead;
  if (futureRemaining <= 0) return 0;
  const yearIndex = Math.max(0, (c.years || 1) - futureRemaining);
  if (!c.baseSalaries || yearIndex >= c.baseSalaries.length) return c.aav || 0;
  const base = c.baseSalaries[yearIndex] ?? (c.aav - (c.bonusProration || 0));
  return Math.round((base + (c.bonusProration || 0)) * 10) / 10;
}

function projectTeamCap(teamId, yearsAhead) {
  const roster = (franchise?.rosters || {})[teamId] || [];
  return Math.round(roster.reduce((s, p) => s + projectPlayerCapHit(p, yearsAhead), 0) * 10) / 10;
}

// ── Trade value classification ───────────────────────────────────────────────
function _tradeValueTag(player, cap) {
  if (!player.contract) return null;
  const hit = currentYearCapHit(player);
  const market = computeMarketValue(player, cap);
  const remaining = player.contract.remaining || 0;
  if (remaining < 2) return null;
  if (hit < market - 2.5) return "asset";
  if (hit > market + 3.5 && remaining >= 3) return "blocker";
  return null;
}

// ── Contract advisor ─────────────────────────────────────────────────────────
// Returns 2-3 structured contract suggestions for a given player + goal.
function _contractAdvisor(player, goal, cap) {
  const market = computeMarketValue(player, cap || SALARY_CAP_BASE);
  const age = player.age || 27;
  const suggestions = [];
  const struct = _defaultStructure(age, player.overall || 70);

  if (goal === "flex") {
    suggestions.push({
      label:"2yr Flexible", years:2, aav: Math.round(market*1.05*10)/10, structure:"BALANCED",
      note:`Low dead cap — hit FA again in 2 years while still productive`,
    });
    suggestions.push({
      label:"3yr + Voidable", years:3, aav: Math.round(market*0.97*10)/10, structure:"BALANCED",
      teamOption:{ year:3 },
      note:`Slightly below market — you control whether year 3 happens`,
    });
  } else if (goal === "capnow") {
    suggestions.push({
      label:"4yr Backloaded", years:4, aav: Math.round(market*0.95*10)/10, structure:"BACKLOADED",
      note:`Cheap cap hits years 1-2, escalates later — good if you expect future space`,
    });
    suggestions.push({
      label:"3yr Backloaded", years:3, aav: Math.round(market*0.93*10)/10, structure:"BACKLOADED",
      note:`Below market to offset back-heavy structure — shortest backload option`,
    });
  } else if (goal === "lockup") {
    suggestions.push({
      label:"5yr Max", years:5, aav: Math.round(market*1.10*10)/10, structure:"FRONTLOADED",
      note:`Premium to lock him in — high dead cap risk if he declines`,
    });
    suggestions.push({
      label:"4yr Bridge+", years:4, aav: Math.round(market*1.03*10)/10, structure:"FRONTLOADED",
      note:`Player gets paid up front — can extend again when you see how he develops`,
    });
  } else { // lowrisk
    suggestions.push({
      label:"2yr Prove-It", years:2, aav: Math.round(market*0.90*10)/10, structure:"BALANCED",
      note:`Below market, minimal signing bonus — nearly zero dead cap if you cut`,
    });
    suggestions.push({
      label:"1yr Show Deal", years:1, aav: Math.round(market*1.02*10)/10, structure:"BALANCED",
      note:`Zero dead cap commitment — he earns a real deal next offseason`,
    });
  }
  return suggestions;
}

// ── Contract options processing ──────────────────────────────────────────────
// Called at offseason start. Handles expiring team/player options.
// Player options: auto-resolved by market vs option value.
// Team options on user's roster: flagged as _teamOptionPending for UI decision.
function _processContractOptions() {
  if (!franchise) return [];
  const cap = franchise.salaryCap || SALARY_CAP_BASE;
  const alerts = [];
  for (const [tidStr, roster] of Object.entries(franchise.rosters || {})) {
    const teamId = Number(tidStr);
    for (const p of roster) {
      const c = p.contract;
      if (!c) continue;
      if (c.playerOption && c.remaining === c.playerOption.year) {
        const market = computeMarketValue(p, cap);
        if (market > c.playerOption.value * 1.08) {
          c.remaining = 0; // Will be caught as expiring
          alerts.push({ type:"playerOpt", teamId, name:p.name, pos:p.position,
            label:`${p.name} opted out — market ($${market.toFixed(1)}M) beat option ($${c.playerOption.value.toFixed(1)}M)` });
        } else {
          alerts.push({ type:"playerOptStay", teamId, name:p.name,
            label:`${p.name} accepted player option ($${c.playerOption.value.toFixed(1)}M)` });
        }
      }
      if (c.teamOption && c.remaining === c.teamOption.year) {
        if (teamId === franchise.chosenTeamId) {
          c._teamOptionPending = true;
        } else {
          const market = computeMarketValue(p, cap);
          if (market < c.teamOption.value * 0.80) c.remaining = 0; // AI declines if player is overpaid
        }
      }
    }
  }
  return alerts;
}


// Converts the current year's base salary into a new signing bonus, prorated
// over remaining years. Frees cap space now; increases dead cap if cut later.
// Limited to once per player per offseason (restructuredSeason guard).
// Uses inline confirmation instead of browser confirm() dialog.
function frnRestructure(teamId, name, pos) {
  // Toggle off if clicking the same player again.
  if (_restructurePending?.name === name && _restructurePending?.pos === pos) {
    _restructurePending = null;
    renderFrnAnalytics("mysheet");
    return;
  }
  const roster = franchise?.rosters?.[teamId];
  if (!roster) return;
  const p = roster.find(q => q.name === name && q.position === pos);
  if (!p?.contract) return;
  const c = p.contract;
  const remaining = c.remaining || 0;
  if (remaining < 2) return;
  if (c.restructuredSeason === franchise.season) return;
  const yearIndex = Math.max(0, (c.years || 1) - remaining);
  const currentBase = c.baseSalaries?.[yearIndex] ?? (c.aav - (c.bonusProration || 0));
  if (currentBase < 2.0) return;
  const newProration = Math.round(currentBase / remaining * 10) / 10;
  const freed = Math.round((currentBase - newProration) * 10) / 10;
  _restructurePending = { teamId, name, pos, currentBase, newProration, freed, remaining };
  renderFrnAnalytics("mysheet");
}

function frnRestructureConfirm() {
  if (!_restructurePending) return;
  const { teamId, name, pos, currentBase, newProration, freed } = _restructurePending;
  const roster = franchise?.rosters?.[teamId];
  const p = roster?.find(q => q.name === name && q.position === pos);
  if (!p?.contract) { _restructurePending = null; return; }
  const c = p.contract;
  const remaining = c.remaining || 0;
  const yearIndex = Math.max(0, (c.years || 1) - remaining);
  if (c.baseSalaries) c.baseSalaries[yearIndex] = 0;
  c.bonusProration     = Math.round(((c.bonusProration || 0) + newProration) * 10) / 10;
  c.signingBonus       = Math.round(((c.signingBonus   || 0) + currentBase) * 10) / 10;
  c.restructuredSeason = franchise.season;
  _restructurePending  = null;
  saveFranchise();
  _pushNews({ type: "restructure",
    label: `🔀 Restructured ${p.position} ${name} — freed $${freed.toFixed(1)}M, added $${newProration.toFixed(1)}M/yr dead` });
  renderFrnAnalytics("mysheet");
}

function frnRestructureCancel() {
  _restructurePending = null;
  renderFrnAnalytics("mysheet");
}

// ── Release player (two-step: prompt then confirm) ──────────────────────────
function frnReleasePlayer(name, pos) {
  // If already pending this same player, cancel (toggle).
  if (_releasePending?.name === name && _releasePending?.pos === pos) {
    _releasePending = null;
    renderFrnPreseason("roster");
    return;
  }
  const teamId = franchise.chosenTeamId;
  const roster = franchise.rosters[teamId];
  const p = roster?.find(q => q.name === name && q.position === pos);
  if (!p) return;
  const { perYear: deadPerYr, years: deadYrs } = deadCapOnRelease(p);
  const deadTotal = deadPerYr * deadYrs;
  _releasePending = { name, pos, deadPerYr, deadYrs, deadTotal };
  renderFrnPreseason("roster");
}

function frnReleasePlayerConfirm() {
  if (!_releasePending) return;
  const { name, pos, deadPerYr, deadYrs, deadTotal } = _releasePending;
  const teamId = franchise.chosenTeamId;
  const roster = franchise.rosters[teamId];
  const idx = roster.findIndex(p => p.name === name && p.position === pos);
  if (idx === -1) { _releasePending = null; renderFrnPreseason("roster"); return; }
  roster.splice(idx, 1);
  if (deadTotal > 0) {
    franchise.refunds = franchise.refunds || [];
    franchise.refunds.push({
      kind: "dead_cap", fromTeamId: teamId, toTeamId: null,
      amount: deadPerYr, yearsRemaining: deadYrs, label: `Dead cap: ${name}`,
    });
  }
  _releasePending = null;
  saveFranchise();
  renderFrnPreseason("roster");
}

function frnReleasePlayerCancel() {
  _releasePending = null;
  renderFrnPreseason("roster");
}

// ── Scouting representation: never expose raw OVR. Players are shown to the
// user via a letter "scout grade" (A+ … F) that approximates perceived
// talent. The grade is deliberately fuzzed against the underlying overall
// so the user can't reverse-engineer the simulator's numbers — it's an
// observer's estimate, not the truth.
function scoutGrade(p) {
  let score = p.overall || 60;
  // Stable per-player noise (-8..+8) from a hash of the name.
  // If the user has scouted this player's team (joint practice this
  // season), the noise band shrinks dramatically — sharper view.
  let h = 0;
  const name = p.name || "";
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const scouted = _isPlayerScouted(p);
  const noise = scouted
    ? ((Math.abs(h) % 5) - 2)      // ±2 with intel
    : ((Math.abs(h) % 17) - 8);    // ±8 without
  score += noise;
  // Draft pedigree tilt — recency bias in real scouting
  const r = p.draftRound;
  if (r === 1)      score += 3;
  else if (r === 2) score += 1;
  else if (r >= 5)  score -= 2;
  else if (r === 0) score -= 4;
  // Age cliff penalty in perceived grade
  const age = p.age || 25;
  if (age >= 34)      score -= 6;
  else if (age >= 32) score -= 3;
  return Math.max(20, Math.min(99, Math.round(score)));
}

// Has the user scouted this player's team this season (via scrimmage)?
function _isPlayerScouted(p) {
  if (!franchise?.scoutingIntel) return false;
  const myId = franchise.chosenTeamId;
  // Find which team currently owns this player
  for (const [tid, roster] of Object.entries(franchise.rosters || {})) {
    if (Number(tid) === myId) continue;          // your own roster is always known
    if (!roster.includes(p)) continue;
    const intel = franchise.scoutingIntel[tid];
    return intel && intel.season === franchise.season;
  }
  return false;
}

// ── Workout system ────────────────────────────────────────────────────────────
// During the FA pool phase the user can spend workout slots to bring a player
// in for a week-long tryout. The workout strips most of the scout-grade noise
// and reveals one position-specific trait — confirming a diamond or exposing
// a workout warrior.

const _WORKOUT_TRAITS = {
  QB:  { pos: ["Elite pocket poise","Quick release","Strong football IQ","Exceptional arm talent"],
         neg: ["Happy feet in the pocket","Slow progression reads","Struggles under pressure","Poor off-platform throws"] },
  RB:  { pos: ["Explosive burst & acceleration","Elite pass protection","Reliable receiver out of backfield","Great vision & patience"],
         neg: ["Fumble concerns noted","Limited receiving ability","One-gear runner","Struggles vs speed in coverage"] },
  WR:  { pos: ["Elite hands — zero drops","Sharp route running","Excellent YAC ability","Quick separation"],
         neg: ["Inconsistent hands — drops noted","Struggles vs press coverage","Limited route tree","Fails to separate at top"] },
  TE:  { pos: ["Versatile inline blocker","Reliable hands in traffic","Surprising athleticism","Runs precise routes"],
         neg: ["Blocking effort inconsistent","Struggles vs athletic ends","Limited route running","Hands need work"] },
  OL:  { pos: ["Excellent pass protection footwork","Nasty in run game","Great line communication","Strong anchor strength"],
         neg: ["Gets beaten by speed rushers","Pass protection concerns","Technique breaks down late","Struggles in space"] },
  DL:  { pos: ["Motor never stops","Elite initial burst","Great hand technique","Finishes every play"],
         neg: ["Effort issues observed","Gets washed out in run game","Limited pass rush plan","Tires quickly"] },
  LB:  { pos: ["Elite instincts & diagnosis","Excellent in coverage","Sideline-to-sideline range","Great blitz timing"],
         neg: ["Slow to diagnose plays","Coverage limitations","Gets lost in zone schemes","Takes poor angles"] },
  CB:  { pos: ["Sticky in man coverage","Great ball skills","Excellent press technique","Smooth transitions"],
         neg: ["Struggles in zone coverage","Too physical — flag risk","False steps at snap","Limited recovery speed"] },
  S:   { pos: ["Exceptional range","Elite run support","Natural ball hawk","Great secondary communication"],
         neg: ["Box skills only — no range","Caught peeking at QB","Inconsistent tackling","Struggles in coverage"] },
  K:   { pos: ["Legitimate leg strength","Elite touch on short kicks","Clutch under pressure"],
         neg: ["Accuracy is a real concern","Distance falls short","Shows nerves in big moments"] },
  P:   { pos: ["Elite hang time","Directional kicking ability","Strong net average"],
         neg: ["Inconsistent in bad weather","Hang time average at best","Directional limitations"] },
};

function _workoutSlotsUsed() {
  const w = franchise._faWorkoutSlots;
  if (!w || w.faPhase !== franchise.season) return 0;
  return w.used || 0;
}
function _workoutSlotsRemaining() {
  return Math.max(0, WORKOUT_SLOTS_PER_FA_SEASON - _workoutSlotsUsed());
}
function _consumeWorkoutSlot() {
  if (!franchise._faWorkoutSlots || franchise._faWorkoutSlots.faPhase !== franchise.season) {
    franchise._faWorkoutSlots = { faPhase: franchise.season, used: 0 };
  }
  franchise._faWorkoutSlots.used += 1;
}

// Compute the sharp grade shown after a workout (±1 noise instead of ±8).
function _computeSharpGrade(p) {
  let score = p.overall || 60;
  let h = 0;
  const name = p.name || "";
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  score += ((Math.abs(h) % 3) - 1);
  const r = p.draftRound;
  if (r === 1)      score += 3;
  else if (r === 2) score += 1;
  else if (r >= 5)  score -= 2;
  else if (r === 0) score -= 4;
  const age = p.age || 25;
  if (age >= 34)      score -= 6;
  else if (age >= 32) score -= 3;
  return Math.max(20, Math.min(99, Math.round(score)));
}

function frnFAInviteWorkout(name) {
  if (_workoutSlotsRemaining() <= 0) {
    alert(`No workout slots left this offseason (${WORKOUT_SLOTS_PER_FA_SEASON} total).`);
    return;
  }
  const fa = (franchise.freeAgents || []).find(p => p.name === name);
  if (!fa) return;

  _consumeWorkoutSlot();
  franchise._faWorkoutResults = franchise._faWorkoutResults || {};

  const ovr = fa.overall || 60;
  const traits = _WORKOUT_TRAITS[fa.position] || _WORKOUT_TRAITS.DL;

  // Result tier — probability driven by true overall so diamonds trend Standout
  const r = Math.random();
  let result;
  if      (ovr >= 85) result = r < 0.50 ? "standout" : r < 0.85 ? "solid" : r < 0.97 ? "mixed" : "bombed";
  else if (ovr >= 75) result = r < 0.25 ? "standout" : r < 0.65 ? "solid" : r < 0.90 ? "mixed" : "bombed";
  else if (ovr >= 65) result = r < 0.10 ? "standout" : r < 0.40 ? "solid" : r < 0.80 ? "mixed" : "bombed";
  else                result = r < 0.03 ? "standout" : r < 0.18 ? "solid" : r < 0.53 ? "mixed" : "bombed";

  const posPool = traits.pos;
  const negPool = traits.neg;
  const posTrait = posPool[Math.floor(Math.random() * posPool.length)];
  const negTrait = negPool[Math.floor(Math.random() * negPool.length)];

  const sharpGrade   = _computeSharpGrade(fa);
  const demandBefore = fa.demandedAAV;

  // Demand shifts: Standout players feel the market, bombers get desperate
  let demandDeltaPct = 0;
  if (result === "standout") demandDeltaPct = +(5 + Math.random() * 8).toFixed(1);
  else if (result === "bombed") demandDeltaPct = -(10 + Math.random() * 12).toFixed(1);
  if (demandDeltaPct !== 0) {
    fa.demandedAAV = Math.max(0.5, +(fa.demandedAAV * (1 + demandDeltaPct / 100)).toFixed(1));
  }

  franchise._faWorkoutResults[name] = { result, posTrait, negTrait, sharpGrade, demandBefore, demandDeltaPct };

  if (result === "standout") {
    fa._workoutHot = true;
    _pushNews({ type: "workout", label: `👀 ${fa.position} ${name}'s workout impresses — rival teams taking notice` });
  }

  saveFranchise();
  renderFrnFA(name);
}

function gradeLabel(score) {
  if (score >= 92) return "A+";
  if (score >= 87) return "A";
  if (score >= 82) return "A-";
  if (score >= 77) return "B+";
  if (score >= 72) return "B";
  if (score >= 67) return "B-";
  if (score >= 62) return "C+";
  if (score >= 55) return "C";
  if (score >= 48) return "C-";
  if (score >= 38) return "D";
  return "F";
}

function gradeClass(score) {
  if (score >= 82) return "elite";
  if (score >= 70) return "good";
  if (score >= 55) return "average";
  return "poor";
}

function gradeBadge(p) {
  const s = scoutGrade(p);
  return `<span class="tt-ovr tier-${gradeClass(s)}" title="Scout grade — not exact ability">${gradeLabel(s)}</span>`;
}

// Years-in-league is what the user actually cares about. Calendar years
// don't map cleanly because a real-world year sees multiple in-game
// seasons. Prefer "Yr 3 · R1 #5" over "2026 R1 #5".
function _yearsInLeague(p) {
  if (p?.draftSeason != null && franchise?.season != null) {
    return Math.max(0, (franchise.season - p.draftSeason));
  }
  return Math.max(0, (p?.age || 22) - 22);
}
function draftStr(p) {
  if (!p?.draftRound && !p?.draftYear) return "—";
  // _yearsInLeague returns seasons COMPLETED. "Yr N" here is read as
  // "N years of experience" — matches the career history table (a
  // player with 1 finished season has 1 row labeled "Yr 1"). 0
  // completed seasons → still in his rookie year.
  const yrs = _yearsInLeague(p);
  const yrTag = yrs === 0 ? "Rookie" : `Yr ${yrs}`;
  if (p.draftRound === 0) return `${yrTag} · UDFA`;
  return `${yrTag} · R${p.draftRound} #${p.draftPick}`;
}

function careerEarningsStr(p) {
  return `$${(p.careerEarnings || 0).toFixed(1)}M`;
}

// Convert hidden internal stats into combine-style measurables that the
// user can see without exposing the raw 0-99 rating. These are stable
// per player (function of p.stats) and read like real combine results.
function combineMeasurables(p) {
  const [spd=50, str=50, agi=50, /*awr*/, /*thr*/, /*cat*/, /*blk*/, /*prs*/, /*cov*/, /*tck*/, kpw=50] = p.stats || [];
  const fortyTime  = (5.15 - (spd - 40) * 0.0135).toFixed(2);
  const benchReps  = Math.max(2, Math.round(6 + (str - 40) * 0.42));
  const coneTime   = (8.10 - (agi - 40) * 0.026).toFixed(2);
  const verticalIn = Math.max(20, Math.round(26 + (spd + agi - 80) * 0.16));
  return { fortyTime, benchReps, coneTime, verticalIn, kpw };
}

// Assign draft pedigree + career earnings to any roster player missing them.
// At franchise start we retroactively give every player a "draft history"
// based on their age and (hidden) overall, with realistic noise. Rookies
// generated each offseason set their own draftYear via runFrnOffseason.
function assignDraftInfo(rosters, currentYear) {
  for (const roster of Object.values(rosters)) {
    for (const p of roster) {
      if (p.draftYear == null) {
        const yearsInLeague = Math.max(0, (p.age || 22) - 22);
        p.draftYear = currentYear - yearsInLeague;
        // Negative draftSeason — drafted before franchise S1.
        p.draftSeason = (franchise?.season || 1) - yearsInLeague;
        const ovr = p.overall || 70;
        const expectedPick = Math.max(1, Math.min(224,
          Math.round(260 - (ovr - 50) * 4.8 + (Math.random() - 0.5) * 80)
        ));
        if (Math.random() < 0.05 && ovr < 82) {
          p.draftRound = 0; p.draftPick = null;
        } else {
          p.draftRound = Math.min(7, Math.ceil(expectedPick / 32));
          p.draftPick  = ((expectedPick - 1) % 32) + 1;
        }
      }
      if (p.careerEarnings == null) {
        const yearsInLeague = Math.max(0, (p.age || 22) - 22);
        const aav = p.contract?.aav || 1;
        p.careerEarnings = Math.round(yearsInLeague * aav * 0.65 * 10) / 10;
      }
      if (p.potential == null) p.potential = _rollPotential(p);
    }
  }
}

// Hidden ceiling — a player's max OVR. Veterans get a small bump
// above current; rookies and young players get a noisy roll keyed off
// their draft slot. Some 1st-rounders bust (potential < current OVR
// even), some late picks/UDFAs have huge ceilings.
function _rollPotential(p) {
  const age = p.age || 22;
  const ovr = p.overall || 70;
  // Vets (25+): potential = current + 0-3 bump (peak players)
  if (age >= 25) return Math.min(99, ovr + Math.floor(Math.random() * 4));
  // Young (22-24): draft pedigree drives mean
  const r = p.draftRound || 7;
  const meanByRound = { 1: 88, 2: 81, 3: 75, 4: 70, 5: 66, 6: 63, 7: 60, 0: 58 };
  const stdByRound  = { 1: 5,  2: 6,  3: 7,  4: 7,  5: 7,  6: 7,  7: 7,  0: 8 };
  const mean = meanByRound[r] ?? 65;
  const std = stdByRound[r] ?? 7;
  // Box-Muller-ish noise
  let u = Math.random() || 1e-9, v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  let potential = Math.round(mean + std * z);
  // Floor at current OVR-2 (so an 80 OVR rookie isn't capped at 70)
  potential = Math.max(ovr - 2, Math.min(99, potential));
  return potential;
}

// Public-ish scouting hint (single word) derived from draft slot vs
// hidden potential. Returns short phrase or "" for boring middle.
function potentialTag(p) {
  if (p.potential == null) return "";
  const r = p.draftRound || 7;
  const pot = p.potential;
  // Pretend the draft slot's "expected" ceiling is the round's mean
  const expected = { 1: 88, 2: 81, 3: 75, 4: 70, 5: 66, 6: 63, 7: 60, 0: 58 }[r] ?? 65;
  const delta = pot - expected;
  if (delta >= 8)  return "⭐ HIGH CEILING";
  if (delta >= 4)  return "↗ Late bloomer";
  if (delta <= -8) return "⚠ Bust risk";
  if (delta <= -4) return "▾ Capped";
  return "";
}

// ── Coaching staff ────────────────────────────────────────────────────────────
// Each team has a head coach with one trait that biases sim / dev /
// roster outcomes. Coaches are fired or extended in the offseason.
const COACH_TRAITS = [
  { key:"Player Developer",     desc:"Young player growth +35%" },
  { key:"Offensive Guru",       desc:"+2 team offense rating" },
  { key:"Defensive Mastermind", desc:"+2 team defense rating" },
  { key:"Hard-Ass",             desc:"−20% injury chance for your team" },
  { key:"Players' Coach",       desc:"+15% re-signing acceptance" },
];

function _rollCoach() {
  const first = pickFirstName();
  const last  = pickLastName();
  const trait = COACH_TRAITS[Math.floor(Math.random() * COACH_TRAITS.length)];
  return {
    name: `${first} ${last}`,
    trait: trait.key,
    age: 42 + Math.floor(Math.random() * 22),
    yearsWithTeam: 0,
    record: { w: 0, l: 0, championships: 0 },
  };
}

function _initCoachingStaff() {
  if (!franchise.coaches) franchise.coaches = {};
  for (const t of TEAMS) {
    if (!franchise.coaches[t.id]) franchise.coaches[t.id] = { hc: _rollCoach() };
  }
}

// ── Practice squad helpers ───────────────────────────────────────────────────
// Eligibility rule: ≤PS_MAX_YEARS_EXP years in league AND ≤PS_MAX_AGE old.
function _psEligible(p) {
  if (!p) return false;
  const yrs = _yearsInLeague(p);
  return yrs <= PS_MAX_YEARS_EXP && (p.age || 22) <= PS_MAX_AGE;
}
// PS cap cost (separate from active roster AAVs).
function psCostForTeam(teamId) {
  const ps = franchise?.practiceSquads?.[teamId] || [];
  return Math.round(ps.length * PS_COST_PER_SLOT * 10) / 10;
}
// Build initial PS rosters from each team's bench (low-OVR young
// players who aren't starters). Called at franchise creation; gives
// AI teams plausible PS depth without changing the active roster.
function _seedPracticeSquads() {
  if (!franchise.practiceSquads) franchise.practiceSquads = {};
  for (const t of TEAMS) {
    if (franchise.practiceSquads[t.id]?.length) continue;
    const roster = (franchise.rosters[t.id] || []).slice();
    // Find young low-OVR players to seed the PS — by design these are
    // raw prospects who didn't make the active roster cut.
    const candidates = roster
      .filter(p => _psEligible(p) && (p.overall || 0) < 72)
      .sort((a, b) => (a.overall || 0) - (b.overall || 0));
    const ps = [];
    for (let i = 0; i < PS_SLOTS && i < candidates.length; i++) {
      const p = candidates[i];
      // Move them off the active roster onto PS.
      const idx = roster.indexOf(p);
      if (idx !== -1) roster.splice(idx, 1);
      // Stamp PS metadata for the flash log + cap math.
      p._psFlashLog = [];
      p._psStashedSeason = franchise.season || 1;
      ps.push(p);
    }
    franchise.practiceSquads[t.id] = ps;
    franchise.rosters[t.id] = roster;
  }
}
// Tick down scouted-info expirations (intel lasts a season). Called
// at offseason boundary.
function _expireScoutingIntel() {
  if (!franchise.scoutedPS) franchise.scoutedPS = {};
  for (const name of Object.keys(franchise.scoutedPS)) {
    const info = franchise.scoutedPS[name];
    if (info.season !== franchise.season) delete franchise.scoutedPS[name];
  }
}
// Reset weekly scout visits at advance-week.
function _resetWeeklyScoutVisits() {
  franchise.scoutVisits = franchise.scoutVisits || {};
  franchise.scoutVisits[franchise.chosenTeamId] = {
    week: franchise.week, used: 0, max: SCOUT_VISITS_PER_WEEK,
  };
}
function _scoutVisitsRemaining(teamId) {
  const v = franchise.scoutVisits?.[teamId];
  if (!v || v.week !== franchise.week) return SCOUT_VISITS_PER_WEEK;
  return Math.max(0, (v.max || SCOUT_VISITS_PER_WEEK) - (v.used || 0));
}
function _consumeScoutVisit(teamId) {
  const v = franchise.scoutVisits = franchise.scoutVisits || {};
  if (!v[teamId] || v[teamId].week !== franchise.week) {
    v[teamId] = { week: franchise.week, used: 0, max: SCOUT_VISITS_PER_WEEK };
  }
  v[teamId].used += 1;
}
// Weekly flash roll for every PS player on every team. Splits into
// three tiers and stamps the flash log + emits wire alerts. The
// poach pass uses the flash count to weight rival interest.
function _psWeeklyFlashRoll() {
  const myId = Number(franchise.chosenTeamId);
  for (const [tIdStr, ps] of Object.entries(franchise.practiceSquads || {})) {
    const tId = Number(tIdStr);
    const team = getTeam(tId);
    for (const p of ps) {
      if (!p) continue;
      const r = Math.random();
      let kind = null, ovrBoost = 0;
      if (r < PS_FLASH_PROBS.gem) {
        kind = "gem";
        ovrBoost = 8 + Math.floor(Math.random() * 4);
      } else if (r < PS_FLASH_PROBS.gem + PS_FLASH_PROBS.wow) {
        kind = "wow";
        ovrBoost = 3 + Math.floor(Math.random() * 3);
      } else if (r < PS_FLASH_PROBS.gem + PS_FLASH_PROBS.wow + PS_FLASH_PROBS.small) {
        kind = "small";
        ovrBoost = Math.random() < 0.5 ? 1 : 0;
      }
      if (!kind) continue;
      p.overall = Math.min(99, (p.overall || 50) + ovrBoost);
      p._psFlashLog = p._psFlashLog || [];
      p._psFlashLog.push({ week: franchise.week, season: franchise.season, kind, ovrBoost });
      if (p._psFlashLog.length > 12) p._psFlashLog = p._psFlashLog.slice(-12);
      // Wire alert: only big flashes hit the wire (otherwise it's noise).
      if (kind === "gem") {
        const isMine = tId === myId;
        if (isMine) {
          _pushNews({ type:"ps_gem",
            label: `💎 PRACTICE SQUAD GEM: ${p.position} ${p.name} (${p.overall} OVR) — could push for active reps soon` });
        } else {
          // Only league-wide news if we've scouted them (otherwise it's not
          // visible to us in-fiction).
          const intel = franchise.scoutedPS?.[p.name];
          if (intel && intel.byTeamId === myId) {
            _pushNews({ type:"ps_gem",
              label: `💎 ${team?.name} PS gem ${p.position} ${p.name} — grading way up after this week's flash` });
          }
        }
      } else if (kind === "wow") {
        const isMine = tId === myId;
        if (isMine) {
          _pushNews({ type:"ps_flash",
            label: `⭐ Your PS ${p.position} ${p.name} burning starters in practice (+${ovrBoost} OVR)` });
        }
      }
    }
  }
}
// AI poach pass: any team that has scouted a rival's gem can attempt
// to sign him directly to their active roster, forcing the original
// team to either promote (within 1 week) or lose him.
function _psPoachPass() {
  franchise.psPoachAlerts = franchise.psPoachAlerts || [];
  const myId = Number(franchise.chosenTeamId);
  for (const [tIdStr, ps] of Object.entries(franchise.practiceSquads || {})) {
    const ownerId = Number(tIdStr);
    if (ownerId === myId) {
      // Only build alerts on the USER's PS (otherwise spam). AI
      // teams quietly handle rival poaches by promoting their gems.
      for (const p of ps) {
        const hasFlashed = (p._psFlashLog || []).some(f =>
          f.season === franchise.season && (f.kind === "wow" || f.kind === "gem"));
        if (!hasFlashed) continue;
        if ((p.overall || 50) < 70) continue;
        // Roll for rival interest — weighted by need at position
        for (const t of TEAMS) {
          if (t.id === ownerId) continue;
          // Skip teams without a positional need
          const myStarters = (franchise.rosters[t.id] || [])
            .filter(rp => rp.position === p.position);
          const topOvr = myStarters[0]?.overall || 50;
          if (topOvr >= 80) continue;
          const chance = 0.04 + Math.max(0, (75 - topOvr)) * 0.005;
          if (Math.random() >= chance) continue;
          // Existing pending alert? Skip dupes.
          if (franchise.psPoachAlerts.some(a => a.playerName === p.name && a.deadlineWeek > franchise.week)) continue;
          franchise.psPoachAlerts.push({
            playerName: p.name, position: p.position,
            ownerTeamId: ownerId, suitorTeamId: t.id,
            deadlineWeek: franchise.week + 1,
            ovrSnapshot: p.overall,
          });
          _pushNews({ type:"ps_poach",
            label: `⚠️ ${t.name} interested in your PS ${p.position} ${p.name} — promote by end of week ${franchise.week + 1} or lose him` });
          break;  // one alert per gem
        }
      }
    } else {
      // AI side — silently promote their own gems if a rival is sniffing.
      for (const p of ps.slice()) {
        const isGem = (p.overall || 50) >= 78 && (p._psFlashLog || []).some(f =>
          (f.kind === "wow" || f.kind === "gem"));
        if (!isGem) continue;
        if (Math.random() < 0.25) {
          _psPromote(ownerId, p, { silent: true });
        }
      }
    }
  }
  // Expire stale alerts
  franchise.psPoachAlerts = franchise.psPoachAlerts.filter(a => a.deadlineWeek >= franchise.week);
  // If user's alert deadline has passed without promotion, the player walks.
  for (const a of franchise.psPoachAlerts.slice()) {
    if (a.deadlineWeek < franchise.week) {
      // Sign him to the suitor's roster on a minimum deal
      const ps = franchise.practiceSquads[a.ownerTeamId] || [];
      const idx = ps.findIndex(p => p.name === a.playerName);
      if (idx !== -1) {
        const player = ps.splice(idx, 1)[0];
        player.contract = { years: 2, remaining: 2, aav: 1.0,
          guaranteedYears: 1, guaranteedAAV: 1.0 };
        (franchise.rosters[a.suitorTeamId] || []).push(player);
        _pushNews({ type:"ps_lost",
          label: `❌ Lost ${player.position} ${player.name} — signed by ${getTeam(a.suitorTeamId)?.name} off your PS` });
      }
    }
  }
  franchise.psPoachAlerts = franchise.psPoachAlerts.filter(a => a.deadlineWeek >= franchise.week);
}
// Promote a PS player to the active roster.
function _psPromote(teamId, player, opts = {}) {
  const ps = franchise.practiceSquads[teamId] || [];
  const idx = ps.indexOf(player);
  if (idx === -1) return false;
  ps.splice(idx, 1);
  // Sign to a 2-year minimum deal — user can extend later via re-sign flow.
  player.contract = {
    years: 2, remaining: 2, aav: 1.0,
    guaranteedYears: 1, guaranteedAAV: 1.0,
  };
  delete player._psFlashLog; delete player._psStashedSeason;
  (franchise.rosters[teamId] || []).push(player);
  // Cancel any pending poach alert for this player.
  if (franchise.psPoachAlerts) {
    franchise.psPoachAlerts = franchise.psPoachAlerts.filter(a => a.playerName !== player.name);
  }
  if (!opts.silent) {
    const team = getTeam(teamId);
    _pushNews({ type:"ps_promote",
      label: `⬆️ Promoted ${player.position} ${player.name} to ${team?.name || "active"} roster` });
  }
  return true;
}
// Scout a rival PS player — reveals potential and tightens grade noise.
function _psScout(scoutingTeamId, playerName) {
  if (_scoutVisitsRemaining(scoutingTeamId) <= 0) return false;
  _consumeScoutVisit(scoutingTeamId);
  franchise.scoutedPS = franchise.scoutedPS || {};
  franchise.scoutedPS[playerName] = {
    byTeamId: scoutingTeamId,
    season: franchise.season,
    week: franchise.week,
    fidelity: "standard",
  };
  return true;
}
// Auto-spend unused visits when the user advances the week. Picks the
// most flash-y, highest-rated unscouted rival PS players first.
function _psAutoSpendVisits() {
  const myId = Number(franchise.chosenTeamId);
  let remaining = _scoutVisitsRemaining(myId);
  if (remaining <= 0) return 0;
  const targets = [];
  for (const [tIdStr, ps] of Object.entries(franchise.practiceSquads || {})) {
    const tId = Number(tIdStr);
    if (tId === myId) continue;
    for (const p of ps) {
      if (franchise.scoutedPS?.[p.name]) continue;
      const flashCount = (p._psFlashLog || [])
        .filter(f => f.kind === "wow" || f.kind === "gem").length;
      const score = (p.overall || 50) + flashCount * 10;
      targets.push({ p, score });
    }
  }
  targets.sort((a, b) => b.score - a.score);
  let scouted = 0;
  for (let i = 0; i < remaining && i < targets.length; i++) {
    if (_psScout(myId, targets[i].p.name)) scouted++;
  }
  if (scouted > 0) {
    _pushNews({ type:"ps_scout",
      label: `🔍 Auto-scouted ${scouted} PS player${scouted === 1 ? "" : "s"} this week` });
  }
  return scouted;
}

let franchise = null;
// Temporary "draft" league generated when the user clicks New Game.
// Lets the team picker show real per-team data (ratings, scout
// bullets, depth charts) before they commit to a team. Cleared once
// they pick or start fresh.
let franchiseDraft = null;

// ── Persistence ──────────────────────────────────────────────────────────────
// ── Save slots ────────────────────────────────────────────────────────────────
// Multiple named franchises. Slot metadata (id, name, timestamp, summary)
// lives at FRANCHISE_SLOTS_KEY; each slot's actual data lives at
// gc_franchise_v1_slot_<id>. The original single-save key is migrated to
// slot 1 the first time a multi-slot session sees it.
const FRANCHISE_SLOTS_KEY = "gc_franchise_slots_v1";

function _readSlotsMeta() {
  try {
    return JSON.parse(localStorage.getItem(FRANCHISE_SLOTS_KEY))
      || { slots: [], activeSlotId: null };
  } catch { return { slots: [], activeSlotId: null }; }
}
function _writeSlotsMeta(meta) {
  try { localStorage.setItem(FRANCHISE_SLOTS_KEY, JSON.stringify(meta)); } catch {}
}
function _slotDataKey(id) { return `gc_franchise_v1_slot_${id}`; }

function _migrateLegacySave() {
  const meta = _readSlotsMeta();
  if (meta.slots.length > 0) return;
  let raw = null;
  try { raw = localStorage.getItem(FRANCHISE_KEY); } catch {}
  if (!raw) return;
  try {
    const id = 1;
    localStorage.setItem(_slotDataKey(id), raw);
    localStorage.removeItem(FRANCHISE_KEY);
    const parsed = JSON.parse(raw);
    const team = TEAMS.find(t => t.id === parsed.chosenTeamId);
    meta.slots.push({
      id, name: team ? `${team.city} ${team.name}` : "Slot 1",
      lastSaved: Date.now(),
      summary: { season: parsed.season, week: parsed.week, teamId: parsed.chosenTeamId, phase: parsed.phase },
    });
    meta.activeSlotId = id;
    _writeSlotsMeta(meta);
  } catch {}
}

let _saveFranchiseTimer = null;
function saveFranchise() {
  if (!franchise) return;
  if (_saveFranchiseTimer) clearTimeout(_saveFranchiseTimer);
  _saveFranchiseTimer = setTimeout(_flushSaveFranchise, 600);
}
function _flushSaveFranchise() {
  _saveFranchiseTimer = null;
  if (!franchise) return;
  const meta = _readSlotsMeta();
  let activeId = meta.activeSlotId;
  if (!activeId) {
    activeId = (meta.slots.reduce((m,s)=>Math.max(m,s.id),0) || 0) + 1;
    meta.slots.push({ id: activeId, name: "New Franchise", lastSaved: Date.now(), summary: {} });
    meta.activeSlotId = activeId;
  }
  const slot = meta.slots.find(s => s.id === activeId);
  if (!slot) { meta.activeSlotId = null; _writeSlotsMeta(meta); return; }
  const team = getTeam(franchise.chosenTeamId);
  const standing = franchise.standings?.[franchise.chosenTeamId];
  slot.lastSaved = Date.now();
  slot.summary = {
    season: franchise.season, week: franchise.week,
    teamId: franchise.chosenTeamId,
    teamName: team ? `${team.city} ${team.name}` : "?",
    phase: franchise.phase,
    record: standing ? `${standing.w}-${standing.l}${standing.t?`-${standing.t}`:""}` : "0-0",
  };
  if ((slot.name === "New Franchise" || slot.name === "Untitled") && team) {
    slot.name = `${team.city} ${team.name}`;
  }
  _writeSlotsMeta(meta);
  try { localStorage.setItem(_slotDataKey(activeId), JSON.stringify(franchise)); } catch {}
}
window.addEventListener("beforeunload", () => { if (_saveFranchiseTimer) _flushSaveFranchise(); });

function loadFranchise() {
  _migrateLegacySave();
  const meta = _readSlotsMeta();
  if (!meta.activeSlotId) { franchise = null; return; }
  try {
    const raw = localStorage.getItem(_slotDataKey(meta.activeSlotId));
    if (raw) {
      franchise = JSON.parse(raw);
      if (franchise && franchise.pendingFranchiseGame) franchise.pendingFranchiseGame = null;
    } else {
      franchise = null;
    }
  } catch { franchise = null; }
}

function frnSwitchSlot(id) {
  const meta = _readSlotsMeta();
  if (!meta.slots.find(s => s.id === id)) return;
  meta.activeSlotId = id;
  _writeSlotsMeta(meta);
  loadFranchise();
  if (franchise) showFranchiseDashboard();
  else renderFrnStartScreen();
}

function frnDeleteSlot(id) {
  const meta = _readSlotsMeta();
  const slot = meta.slots.find(s => s.id === id);
  if (!slot) return;
  if (!confirm(`Delete "${slot.name}"? This save will be permanently erased.`)) return;
  meta.slots = meta.slots.filter(s => s.id !== id);
  if (meta.activeSlotId === id) {
    meta.activeSlotId = null;
    franchise = null;
  }
  _writeSlotsMeta(meta);
  try { localStorage.removeItem(_slotDataKey(id)); } catch {}
  renderFrnStartScreen();
}

function frnRenameSlot(id) {
  const meta = _readSlotsMeta();
  const slot = meta.slots.find(s => s.id === id);
  if (!slot) return;
  const newName = prompt("Rename franchise:", slot.name);
  if (!newName || !newName.trim()) return;
  slot.name = newName.trim().slice(0, 40);
  _writeSlotsMeta(meta);
  renderFrnStartScreen();
}

// ── Schedule — Berger circle method (14 of 31 rounds for 32 teams) ───────────
function generateFranchiseSchedule() {
  const arr = TEAMS.map(t => t.id);
  const n   = arr.length; // 32
  const schedule = [];
  for (let week = 1; week <= FRANCHISE_WEEKS; week++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      const homeId = (i + week) % 2 === 0 ? a : b;
      const awayId = homeId === a ? b : a;
      schedule.push({ week, homeId, awayId, homeScore: null, awayScore: null, played: false });
    }
    // Rotate arr[1..n-1] right by 1 position (arr[0] is fixed)
    const last = arr.pop();
    arr.splice(1, 0, last);
  }
  return schedule;
}

// ── Standings helpers ────────────────────────────────────────────────────────
function initStandings() {
  return Object.fromEntries(TEAMS.map(t => [t.id, { w: 0, l: 0, t: 0, pf: 0, pa: 0 }]));
}
// Compute per-team division + conference + head-to-head records from
// franchise.schedule. NFL-style tiebreakers: when two teams have the
// same W-L%, prefer the one with the better division record, then
// conference record, then head-to-head, then point differential.
function _detailedRecord(teamId) {
  const team = getTeam(teamId);
  if (!team) return null;
  const out = {
    divW: 0, divL: 0, divT: 0,
    confW: 0, confL: 0, confT: 0,
    pointDiff: 0,
    h2h: {},   // { otherTeamId: [w, l, t] }
  };
  for (const g of (franchise.schedule || [])) {
    if (!g.played) continue;
    let me, them, myScore, themScore, themId;
    if (g.homeId === teamId)      { me = team; themId = g.awayId; myScore = g.homeScore; themScore = g.awayScore; }
    else if (g.awayId === teamId) { me = team; themId = g.homeId; myScore = g.awayScore; themScore = g.homeScore; }
    else continue;
    them = getTeam(themId);
    if (!them) continue;
    const won = myScore > themScore;
    const tied = myScore === themScore;
    out.pointDiff += myScore - themScore;
    if (them.division === me.division) {
      if (won) out.divW++; else if (tied) out.divT++; else out.divL++;
    }
    if (them.conference === me.conference) {
      if (won) out.confW++; else if (tied) out.confT++; else out.confL++;
    }
    out.h2h[themId] = out.h2h[themId] || [0, 0, 0];
    if (won) out.h2h[themId][0]++;
    else if (tied) out.h2h[themId][2]++;
    else out.h2h[themId][1]++;
  }
  return out;
}
function _winPct(w, l, t) {
  const total = (w + l + t);
  return total ? (w * 2 + t) / (total * 2) : 0;
}
function standingsSorted() {
  return Object.entries(franchise.standings)
    .map(([id, s]) => {
      const detailed = _detailedRecord(+id);
      return { id: +id, team: getTeam(+id), ...s, detailed };
    })
    .sort((a, b) => {
      const pA = _winPct(a.w, a.l, a.t);
      const pB = _winPct(b.w, b.l, b.t);
      if (pA !== pB) return pB - pA;
      // Division record
      const aDiv = _winPct(a.detailed?.divW || 0, a.detailed?.divL || 0, a.detailed?.divT || 0);
      const bDiv = _winPct(b.detailed?.divW || 0, b.detailed?.divL || 0, b.detailed?.divT || 0);
      if (aDiv !== bDiv) return bDiv - aDiv;
      // Conference record
      const aConf = _winPct(a.detailed?.confW || 0, a.detailed?.confL || 0, a.detailed?.confT || 0);
      const bConf = _winPct(b.detailed?.confW || 0, b.detailed?.confL || 0, b.detailed?.confT || 0);
      if (aConf !== bConf) return bConf - aConf;
      // Head-to-head (only meaningful for the two teams being compared)
      const h2hA = a.detailed?.h2h?.[b.id];
      const h2hB = b.detailed?.h2h?.[a.id];
      if (h2hA && h2hB) {
        const aPct = _winPct(h2hA[0], h2hA[1], h2hA[2]);
        const bPct = _winPct(h2hB[0], h2hB[1], h2hB[2]);
        if (aPct !== bPct) return bPct - aPct;
      }
      // Point differential, then raw wins.
      return (b.detailed?.pointDiff || 0) - (a.detailed?.pointDiff || 0) || b.w - a.w;
    });
}
function recordFranchiseResult(homeId, awayId, homeScore, awayScore) {
  const h = franchise.standings[homeId], a = franchise.standings[awayId];
  if (!h || !a) return;
  h.pf += homeScore; h.pa += awayScore;
  a.pf += awayScore; a.pa += homeScore;
  if (homeScore > awayScore)      { h.w++; a.l++; }
  else if (awayScore > homeScore) { a.w++; h.l++; }
  else                            { h.t++; a.t++; }
  // Roll injuries for both teams
  _rollGameInjuries(homeId);
  _rollGameInjuries(awayId);
  // News: blowouts and upsets
  const home = getTeam(homeId), away = getTeam(awayId);
  if (!home || !away) return;
  const diff = Math.abs(homeScore - awayScore);
  const winner  = homeScore > awayScore ? home : away;
  const loser   = homeScore > awayScore ? away : home;
  const winScore = Math.max(homeScore, awayScore);
  const loseScore= Math.min(homeScore, awayScore);
  if (diff >= 24) {
    _pushNews({ type:"blowout", label: `🔥 ${winner.name} blow out ${loser.name} ${winScore}-${loseScore}` });
  }
  // Upset = team rated 10+ lower won
  const winRtg = frnTeamRating(winner.id), lossRtg = frnTeamRating(loser.id);
  const winPower = winRtg.off + winRtg.def, lossPower = lossRtg.off + lossRtg.def;
  if (lossPower - winPower >= 14 && diff >= 7) {
    _pushNews({ type:"upset", label: `⚡ UPSET: ${winner.name} (${winRtg.off}/${winRtg.def}) over ${loser.name} (${lossRtg.off}/${lossRtg.def}) ${winScore}-${loseScore}` });
  }
}

// ── Assign initial ages to all franchise rosters ─────────────────────────────
function assignFranchiseAges(rosters) {
  for (const roster of Object.values(rosters)) {
    for (const p of roster) {
      if (p.age == null) {
        const base = p.overall >= 85 ? 26 : p.overall >= 75 ? 24 : 22;
        p.age = base + Math.floor(Math.random() * 7);
      }
    }
  }
}

// ── Realistic team-by-team roster generation ─────────────────────────────────
// Each franchise universe assigns every team a "talent tier": a handful of
// powerhouses with stacked rosters, a tier of solid contenders, an average
// middle pack, and a few rebuilders short on talent. Per-slot tier rolls
// (elite/good/average/poor) are drawn from a distribution that depends on
// both the team's tier and the depth-chart slot — so a powerhouse's starter
// is much more likely to be elite, a rebuilder's 3rd-stringer is usually a
// scrub, etc. Playbook bias still bumps the starter at the team's identity
// positions (Air Raid → QB/WR, Ground & Pound → RB/OL, etc).

// Distribution table: SLOT_TIER_DIST[slotIdx][teamTier] = {tier: prob}
// slotIdx is clamped to [0..3] — slot 0 = starter, 1 = 2nd-string,
// 2 = 3rd-string, 3+ = deep depth.
const SLOT_TIER_DIST = {
  0: {
    powerhouse: { elite:0.45, good:0.40, average:0.13, poor:0.02 },
    contender:  { elite:0.18, good:0.55, average:0.22, poor:0.05 },
    average:    { elite:0.06, good:0.42, average:0.42, poor:0.10 },
    rebuilding: { elite:0.02, good:0.22, average:0.46, poor:0.30 },
  },
  1: {
    powerhouse: { elite:0.05, good:0.40, average:0.45, poor:0.10 },
    contender:  { elite:0.02, good:0.28, average:0.50, poor:0.20 },
    average:    { elite:0.01, good:0.18, average:0.48, poor:0.33 },
    rebuilding: { elite:0.00, good:0.08, average:0.38, poor:0.54 },
  },
  2: {
    powerhouse: { elite:0.00, good:0.18, average:0.48, poor:0.34 },
    contender:  { elite:0.00, good:0.10, average:0.42, poor:0.48 },
    average:    { elite:0.00, good:0.06, average:0.36, poor:0.58 },
    rebuilding: { elite:0.00, good:0.03, average:0.27, poor:0.70 },
  },
  3: {
    powerhouse: { elite:0.00, good:0.06, average:0.40, poor:0.54 },
    contender:  { elite:0.00, good:0.04, average:0.34, poor:0.62 },
    average:    { elite:0.00, good:0.02, average:0.28, poor:0.70 },
    rebuilding: { elite:0.00, good:0.01, average:0.20, poor:0.79 },
  },
};

function weightedTierPick(dist) {
  const total = (dist.elite||0) + (dist.good||0) + (dist.average||0) + (dist.poor||0);
  let r = Math.random() * total;
  if ((r -= dist.elite   || 0) < 0) return "elite";
  if ((r -= dist.good    || 0) < 0) return "good";
  if ((r -= dist.average || 0) < 0) return "average";
  return "poor";
}

// 32 teams: 4 powerhouses, 10 contenders, 12 average, 6 rebuilding.
function assignTeamTiers() {
  const tiers = [
    ...Array(4 ).fill("powerhouse"),
    ...Array(10).fill("contender"),
    ...Array(12).fill("average"),
    ...Array(6 ).fill("rebuilding"),
  ];
  // Fisher-Yates shuffle
  for (let i = tiers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
  }
  const out = {};
  TEAMS.forEach((t, i) => out[t.id] = tiers[i]);
  return out;
}

function genFranchiseRoster(team, blockNames, teamTier) {
  const pb = getPlaybook(team);
  const used = new Set(blockNames || []);
  const r = [];

  for (const [pos, count] of Object.entries(ROSTER_SLOTS)) {
    const pbBias = pb.tierBias?.[pos]; // "elite" or "good" or undefined

    for (let i = 0; i < count; i++) {
      const slotIdx = Math.min(i, 3);
      const dist = { ...SLOT_TIER_DIST[slotIdx][teamTier] };

      // Starter at a playbook-favored position gets bumped toward the top
      if (i === 0) {
        if (pbBias === "elite") {
          dist.elite   = (dist.elite   || 0) + 0.20;
          dist.poor    = (dist.poor    || 0) * 0.3;
          dist.average = (dist.average || 0) * 0.6;
        } else if (pbBias === "good") {
          dist.elite   = (dist.elite   || 0) + 0.06;
          dist.good    = (dist.good    || 0) + 0.10;
          dist.poor    = (dist.poor    || 0) * 0.6;
        }
      }

      const tier   = weightedTierPick(dist);
      const player = genUniquePlayer(pos, tier, used);
      used.add(player.name);
      r.push(player);
    }
  }
  assignTeamJerseyNumbers(r);
  return r;
}

// ── Mode switching ───────────────────────────────────────────────────────────
// Two top-level modes: "franchise" (default, the polished career UI) and
// "testing" (legacy team-selector + sim/debug tools). Tab buttons drive this.
function setAppMode(mode) {
  try {
    document.body.classList.remove("mode-franchise", "mode-testing");
    document.body.classList.add(`mode-${mode}`);
    $("franchiseHome").style.display = mode === "franchise" ? "block" : "none";
    $("testingPanel").style.display  = mode === "testing"   ? "block" : "none";
    $("modeFranchiseBtn").classList.toggle("active", mode === "franchise");
    $("modeTestingBtn").classList.toggle("active",   mode === "testing");
    if (mode === "franchise") showFranchiseHome();
  } catch (err) {
    console.error("setAppMode error:", err);
  }
}

// ── Show franchise home ──────────────────────────────────────────────────────
// Always lands on the start screen so the user can explicitly choose New or
// Load. From there we render either the dashboard or the team picker.
function showFranchiseHome() {
  $("franchiseHome").style.display = "block";
  loadFranchise();
  renderFrnStartScreen();
}

// Build a summary string for a saved franchise (shown on the Load button)
function frnSaveSummary() {
  if (!franchise) return null;
  const team  = getTeam(franchise.chosenTeamId);
  const s     = franchise.standings?.[franchise.chosenTeamId] || { w:0, l:0 };
  const phase = franchise.phase || "regular";
  const phaseLabel =
    phase === "regular"   ? `Season ${franchise.season} · Week ${franchise.week} of ${FRANCHISE_WEEKS}` :
    phase === "playoffs"  ? `Season ${franchise.season} · Playoffs` :
    phase === "awards"    ? `Season ${franchise.season} · Awards` :
    phase === "offseason" ? `Season ${franchise.season} · Offseason` :
    `Season ${franchise.season}`;
  const name = team ? `${team.city} ${team.name}` : "—";
  return `${name} · ${phaseLabel} · ${s.w}-${s.l}`;
}

// Start screen — landing UI listing all saved franchises (multi-slot)
function renderFrnStartScreen() {
  _migrateLegacySave();
  const meta = _readSlotsMeta();
  const slots = (meta.slots || []).slice().sort((a,b) => (b.lastSaved||0) - (a.lastSaved||0));

  const slotsHtml = slots.length ? slots.map(s => {
    const sm = s.summary || {};
    const phaseLabel = sm.phase === "preseason" ? "Preseason"
                     : sm.phase === "free_agency" ? "Free Agency"
                     : sm.phase === "regular" ? `W${sm.week||"?"}`
                     : sm.phase === "playoffs" ? "Playoffs"
                     : sm.phase === "awards" ? "Awards"
                     : sm.phase === "offseason" ? "Offseason"
                     : sm.phase || "—";
    const isActive = meta.activeSlotId === s.id;
    return `<div class="frn-slot ${isActive?"active":""}">
      <div class="frn-slot-info">
        <div class="frn-slot-name">${s.name}</div>
        <div class="frn-slot-summary">
          ${sm.teamName ? sm.teamName + " · " : ""}Season ${sm.season || 1} · ${phaseLabel}
          ${sm.record ? " · " + sm.record : ""}
        </div>
        <div class="frn-slot-time">${s.lastSaved ? new Date(s.lastSaved).toLocaleString() : ""}</div>
      </div>
      <div class="frn-slot-actions">
        <button class="btn btn-gold" onclick="frnSwitchSlot(${s.id})">▶ Load</button>
        <button class="btn btn-outline" onclick="frnRenameSlot(${s.id})">✎</button>
        <button class="btn btn-outline" onclick="frnDeleteSlot(${s.id})" style="color:var(--red)">✗</button>
      </div>
    </div>`;
  }).join("") : `<div style="color:var(--gray);font-size:.78rem;padding:.75rem;text-align:center;font-style:italic">
      No franchises yet. Start a new one below.</div>`;

  $("frnHomeContent").innerHTML = `
    <div class="frn-welcome">
      <div class="frn-welcome-title">🏈 GRIDIRON CHAIN</div>
      <div class="frn-welcome-sub">Multi-season football career mode</div>
      <div class="frn-welcome-feats">
        <div class="frn-welcome-feat"><strong>14</strong> regular-season games</div>
        <div class="frn-welcome-feat"><strong>8-team</strong> playoff bracket</div>
        <div class="frn-welcome-feat">Real <strong>MVP awards</strong></div>
        <div class="frn-welcome-feat">FA bidding wars</div>
        <div class="frn-welcome-feat">Career stats + HOF</div>
      </div>
    </div>

    <div class="frn-card-title" style="margin-top:1rem">📂 YOUR FRANCHISES (${slots.length})</div>
    <div class="frn-slots-list">${slotsHtml}</div>

    <div style="margin-top:1rem">
      <button class="frn-start-btn frn-start-new" onclick="frnStartNew()" style="width:100%">
        <div class="frn-start-icon">＋</div>
        <div class="frn-start-title">START NEW FRANCHISE</div>
        <div class="frn-start-sub">Pick a team and begin a fresh career</div>
      </button>
    </div>
  `;
}

// "New Game" handler — clears active slot so the next saveFranchise()
// allocates a new one. Existing franchises are untouched.
function frnStartNew() {
  const meta = _readSlotsMeta();
  meta.activeSlotId = null;
  _writeSlotsMeta(meta);
  franchise = null;
  franchiseDraft = _buildDraftLeague();
  renderFrnTeamPicker();
}

// Build a fresh candidate league: rosters, ages, contracts, team tiers.
// Used by the picker so hover/detail screens show real data, and reused
// by startFranchise() if the user goes through and commits.
function _buildDraftLeague() {
  const rosters = {};
  const usedNames = new Set();
  const teamTiers = assignTeamTiers();
  for (const t of TEAMS) {
    const roster = genFranchiseRoster(t, usedNames, teamTiers[t.id]);
    roster.forEach(p => usedNames.add(p.name));
    rosters[t.id] = roster;
  }
  assignFranchiseAges(rosters);
  assignContracts(rosters, SALARY_CAP_BASE);
  const currentYear = new Date().getFullYear();
  assignDraftInfo(rosters, currentYear);
  // Stamp the player's current team into their pre-existing career
  // history so veterans show realistic team logos / city names per
  // season (with occasional former-team trades for ~25% of vets).
  assignCareerTeams(rosters);
  return { rosters, teamTiers };
}

// Reroll the draft league while staying on the picker.
function frnRerollLeague() {
  if (!confirm("Reroll the entire league? Every team's roster will be regenerated.")) return;
  franchiseDraft = _buildDraftLeague();
  renderFrnTeamPicker();
}

// "Load Game" handler — opens the saved franchise dashboard
function frnLoadGame() {
  loadFranchise();
  if (!franchise) {
    alert("No saved franchise found.");
    renderFrnStartScreen();
    return;
  }
  showFranchiseDashboard();
}

// Backwards-compat shims — old code paths still call these names
function openFranchiseModal()  { setAppMode("franchise"); showFranchiseHome(); }
function closeFranchiseModal() { /* no-op: franchise is inline now */ }

// ── Initialize new franchise ─────────────────────────────────────────────────
function startFranchise(teamId) {
  // If the user came through the picker, the draft already has fresh rosters,
  // ages, and contracts. Reuse them so the detail-page preview is exactly
  // what they get. Otherwise (legacy entry points) generate fresh.
  const draft = franchiseDraft || _buildDraftLeague();
  franchise = {
    chosenTeamId: teamId,
    season:  1,
    week:    1,
    phase:   "preseason",
    rosters:        draft.rosters,
    teamTiers:      draft.teamTiers,
    salaryCap:      SALARY_CAP_BASE,
    schedule:       generateFranchiseSchedule(),
    standings:      initStandings(),
    playoffBracket: null,
    history:        [],
    pendingFranchiseGame: null,
    _offChanges:    null,
    seasonStats:    {},
    seasonHighlights: [],
    superBowlGame:  null,
  };
  franchiseDraft = null;
  _initFranchisePicks();
  _initCoachingStaff();
  _seedPracticeSquads();
  saveFranchise();
  showFranchiseDashboard();
}

