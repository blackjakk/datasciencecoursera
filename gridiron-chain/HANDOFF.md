# GridironChain — Handover Document

## 1. Project overview

**What we're building**
GridironChain is a vanilla HTML/CSS/JS football franchise simulation (no build tools). State persists in localStorage + IndexedDB under `gc_franchise_v1_slot_<id>`. The codebase is large (~44k lines across the main play-franchise-*.js files) and has evolved through dozens of major features.

**Main user goal**
A deep, realistic NFL franchise GM experience: drafting, contracts, FA, holdouts, coaching, awards, HOF, season simulation. The user iterates on UX polish + sim realism across multiple sessions.

**Current state**
Mature mid-game polish phase. Most major systems exist; recent work has focused on contract/extension screens, the offseason gains sheet, awards voting, player card decoration (tier system, nicknames, legacy/HOF rendering), and migration repair for save corruption from past bug fixes.

---

## 2. Repository / environment

- **Repo path**: `/home/user/datasciencecoursera/gridiron-chain/`
- **Active branch**: `claude/football-sim-blockchain-game-b3sdq` (the user's instruction file says `claude/gridiron-chain-dev-nz0h2`, but all work is on the `b3sdq` branch — stay there)
- **Stack**: vanilla JS, no bundler. Files concatenated via `<script src>` in `play.html` in this order: `play-data.js` → `play-franchise-core.js` → `play-franchise-season.js` → `play-franchise-stats.js` → `play-franchise-offseason.js`. Top-level `const`/`function` declarations are cross-file accessible.
- **Lint/test**: `node -c <file>.js` for syntax checks (no other tests). User views via CDN: `https://rawcdn.githack.com/blackjakk/datasciencecoursera/<commit>/gridiron-chain/play.html`
- **Save layer**: `_idbPut`/`_idbGet` is primary; localStorage is the fast mirror. Auto-trim at 4MB via `_trimFranchiseForStorage`. Diagnostic: `frnSaveDiagnostics()` from devtools.

---

## 3. Files changed or discussed

### `play-franchise-offseason.js` (~12.5k lines)
- **Contract creation sites** (5): now all stamp `contract.startSeason` + `contract.signedOvr` for cooldown gates and "money's worth" math
- **`_renderHoldoutCenterRow`** (mid-season holdout) — portrait + clickable name + raise math + hover preview + pitch
- **`_renderResignUI` `rowFor`** (offseason re-sign) — same treatment
- **`_renderHoldoutsBlock`** (offseason demands) — same treatment + underpay math + split-fill cap bars
- **`_buildExtensionPitch(ctx, live, cap)`** — data-driven pitch widget. Takes normalized ctx, renders THE CASE block (season prod, career, honors, trajectory, league rank, availability, window, money's worth, market, comp $, verdict). Called from all three contract screens.
- **`_detectHoldouts`** — offseason demand trigger. Cooldown bumped to `startSeason + 2`, underpay threshold tightened to 0.70, 35% probability roll
- **`_checkHoldoutDemands`** — mid-season demand trigger. Cooldown gate via `startSeason`. Both functions backfill `startSeason` on legacy contracts.
- **`frnHoldoutIgnore`** — now applies real consequences: -2 OVR, dev freeze flag, 40% trade-request roll, flight-risk flag, wire entries
- **`_resignPlayerDemand`** — +25% premium when player has `flightRisk` / `_ignoredDemandSeason`
- **`_resignPendingHitsByYear` + `_resignHoverIn/_resignHoverOut`** — hover preview overlays on cap projection bars
- **`_holdoutCapProjectionDetail`** — returns `{ baseline, signed, total }` for the split-fill cap bars
- **`_cpuVoteWeeklyPOTW`** — CPU casts weighted-random weekly POTW votes for every category so POTY races have full-season data
- **`_generateAIvsAITrades`** — flurry tuning (35% → 80% as deadline closes) + one-shot wire summary
- **`_buildOffseasonGainsSheet`** — comprehensive sheet: net Δ, biggest gainer/dropper, hidden-gem hero, re-sign priority block, gainers/holding/decliners tables, stat-delta chips, ceiling cells, contract cells, position filter chips
- **`runFrnOffseason`** — instruments per-player change records into `franchise._offChanges` (pre-stats snapshot, post-update reason inference, stat deltas, potential bump, contract years left, archetype)
- **`_rollSeasonStatsToCareer`** — dedupes by season, ticks `careerEarnings`, doesn't overwrite age/ovr on existing rows
- **`_dedupCareerHistory`** — defensive helper

### `play-franchise-season.js` (~4.9k lines)
- **`_repairCareerHistoryAndEarnings_v3`** — SOFTENED: no longer strips calendar-year rows (was over-aggressive)
- **`_restorePriorCareerHistories_v4`** — NEW: reconstructs prior-team rows for vets whose history v3 stripped
- **`_buildPlayerDetailPanel`** — tier-styled hero name + legal-name subtitle ("né LegalName") + nickname origin lore + locker-room banner (-2 OVR, dev freeze, trade request, flight risk)
- **`_buildCareerCard`** — trim hint ("(of ~9 played) · + ~7 earlier seasons trimmed"), reconstructed-row italic dim styling
- **`_buildSeasonStatsBlock`** — FPTS lookup falls back to nickname + seasonStats aggregation
- **`_fantasyPositionRank`** — qualifying thresholds + dedup by name
- **HOF system** (`_addHOFCandidate`, `_runHOFVoting`, `_computeHOFScore`, `_hofPositionMul`) — annual class-based voting replacing direct enshrinement
- **FA-signing contracts** — `startSeason` + `signedOvr` stamp at 2 sites

### `play-franchise-stats.js` (~9k lines)
- **`playerLegendTier(p)`** — LEGEND / ICON / ELITE / PRO tier ladder
- **`playerLink(p)`** — emits tier-class span + glyph + nickname display
- **`_playerLinkSmart(name)`** — falls back to HOF synth for retired players
- **`_findRetiredPlayer(name)` + `_frnOpenRetiredPlayerModal`** — clicking retired/historical names opens a minimal HOF/RETIRED-badged modal
- **`_processSeasonEndRetirements`** — adds retirees to `_hofEligible` pool (not direct HOF)
- **`_legacyHOF`** — reorganized by Class of Sxx with first-ballot badges + active ballot section
- **`renderFrnStandings`** + **`_playoffClinchStatus`** — CLINCHED / IN HUNT / ELIMINATED pills
- **`renderFrnLeaders`** — added FG ACCURACY, KICK RETURN YDS, PUNT RETURN YDS
- **`_selectAllPros` / `_computeROY` / `computeLeagueMVP`** — `_reconcileOrphanSeasonStats` defensive call + nickname fallback for name-keyed lookups

### `play-franchise-core.js` (~3.2k lines)
- **`potentialTag`** — vets past peak show "Hit ceiling" / "Fell short" instead of "HIGH CEILING"
- **`frnSaveDiagnostics`** — devtools-callable size-breakdown helper

### `play-player.js` (~1.8k lines)
- **`assignLeagueNicknames`** — fully rewritten:
  - Pool of 230 unique entries across 14 themed categories (HEAVY, FAST, SURGEON, TRICKSTER, CLOSER, HANDS, LOCK, HAWK, HUNTER, MISTER, WEATHER, ANIMAL, FREAK, ICONIC)
  - Gate: OVR ≥ 85 AND (1+ MVP OR 1+ All-Pro OR 2+ Pro Bowls), top-5 per position, 70% acquisition
  - Iconic single-name flag is 3% of qualifiers with ≥3 Pro Bowls
  - **DOES NOT rewrite `p.name`** — only sets `p.nickname` + `p.goesByNicknameOnly` flag (fixes the old lookup-break bug)
- **`NICKNAME_ORIGINS` + `_nicknamePoolKey` + `_pickNicknameOrigin`** — themed origin stories per pool, deterministic via name-hash seed

### `play-render.js`
- **`nameDisplay`** at line ~1758 — handles `goesByNicknameOnly` properly

### `play.css`
- `.frn-pname-t-*` tier classes + `.frn-pname-hero-*` styles
- `.frn-resign-portrait` + portrait alignment
- `.frn-resign-cap-year` updated to position:relative, bar height 7px, `.fill-preview` striped overlay, `.fill-signed` gold extension overlay

---

## 4. Current implementation state

**Working & shipped:**
- All three contract screens have portraits, clickable tier-styled names, raise math, hover-preview cap bars, pitch blocks
- Offseason demands: cooldown gate (3 seasons + 35% probability), underpay math, money's worth, comparable contracts, real ignore consequences
- Offseason gains sheet with reason chips, stat deltas, ceiling, contract, hidden-gem hero, re-sign priority
- HOF voting (annual class, first-ballot badges, active ballot)
- Standings clinch tags, leaders polish, AI trade flurry, CPU weekly POTW voting
- Player legacy tier system (LEGEND/ICON/ELITE/PRO) wired through `playerLink` everywhere
- Nickname rewrite bug fixed; lookups never break
- Nickname origin lore on player card
- Locker-room banner on player card for ignored-extension players
- Retired-player click-through to minimal modal
- Career card trim hint
- v3/v4 career history repair migrations
- Split-fill cap bars showing baseline vs newly-signed extensions

**Partially implemented / open opportunities** (from the reassessment list):
- **#2 Counter-offer flexibility** — currently single "↻ Counter" button drops to 95%. No custom AAV slider, no "match years, cut AAV" variants.
- **#6 AI inquiries for unhappy stars** — `tradeRequested` flag exists but no AI side responds. Would generate inbound trade offers for unhappy players.
- **#7 Comp pick value math** — "Let walk" shows a comp pick label but doesn't quantify surplus value vs the deal cost.
- **#8 Demand-system unification** — `_checkHoldoutDemands` (walk-year) vs `_detectHoldouts` (mid-contract) are two code paths with subtly different rules; not differentiated to the user.
- **#9 Price-aware verdict** — pitch verdict logic doesn't factor in whether the demand AAV is reasonable.

**Unverified:**
- Reconstructed v4 history rows render correctly across all save shapes — only tested logic, not seen in user save yet
- The 168% availability fix relied on `careerHistory`-only math; if a player has weird in-progress states this might display oddly

**Known cosmetic issues** (low priority):
- Some "vs OPP" cells in game logs show blank when team color renders near-invisible on dark bg
- Player card displays still vary slightly across surfaces (some use `_buildPlayerDetailPanel`, some don't)

---

## 5. Key decisions made

**Design:**
- **`p.name` is sacred** for lookups. Never rewrite. Use `p.nickname` + `p.goesByNicknameOnly` flag. Display layer reads both.
- **Tier system** uses any-of clauses for thresholds (a single MVP jumps you to ICON; a single ring jumps you to ELITE). Simpler than weighted scores.
- **Cooldown via `contract.startSeason`** rather than per-player flags. Stamped at every contract creation site. Legacy contracts backfilled from `years - remaining`.
- **Pitch block takes a normalized `ctx`** — `{ position, marketAAV, demandedAAV, demandedYears }` — so all three contract screens map their row shape into the same signature.
- **Migrations are version-flagged** (`_careerHistoryRepaired_v3`, `_careerHistoryRestored_v4`, etc.) and run once per save.

**Architecture:**
- All player-name surfaces go through `playerLink(p)` or `_playerLinkSmart(name)` so tier styling + click delegation propagate automatically.
- `_findPlayer` now falls through to `_findRetiredPlayer` (HOF + alumni snapshots) so historical names don't dead-end on click.
- Cap bars use `data-cap-year` / `data-cap-used` attributes so the hover-preview JS can find them without re-rendering.

**UI/UX:**
- Pitch block always rendered (no toggle) — user explicitly asked to be "convinced with data"
- Split-fill cap bars over single-fill — makes "what did this signing add?" obvious
- Reconstructed history rows render dimmed/italic with `~estimated` note so users know what's synthesized

**Explicitly rejected:**
- **Pruning save data** — user wants full data fidelity. Auto-trim only kicks in at 4MB pressure.
- **Recovering lost calendar-year rows perfectly** — data is gone, reconstruction is even-distribution approximation
- **Counter-offer custom slider** — discussed, not yet built

---

## 6. Bugs / issues discovered

| Symptom | Cause | Status |
|---|---|---|
| QB demanding ext after just signing | `_detectHoldouts` had no cooldown | Fixed via `startSeason` gate |
| 168% availability | `careerStats.gp` polluted by phantom rows | Fixed: use careerHistory only, cap at 100% |
| Career table "2 seasons" / 12k yds | v3 over-stripped calendar-year rows | Fixed v3 + added v4 reconstruction |
| Marv Rossi click does nothing | `_findPlayer` only searched active rosters | Fixed via `_findRetiredPlayer` + retired modal |
| WR missed Pro Bowl | nickname rewrite split per-game stats across two name keys | Fixed: `_reconcileOrphanSeasonStats` + nickname fallback in lookups |
| FPTS = 0.0 | per-game lookup keyed only by `p.name` | Fixed: tries nickname too, falls back to seasonStats |
| HIGH CEILING on a 31-yr-old vet | `potentialTag` didn't gate on age vs peak | Fixed: vets past peak get realized-state tags |
| Cap bars seemed unchanged after signing | bars DID update but visual was a single fill snap with no callout | Fixed: split fill + delta callouts + summary line |

**Logs/errors**: console outputs `[career repair v3] cleaned X player histories` and `[career repair v4] reconstructed prior history for X player(s)` on first save load.

---

## 7. ENGINE + PHYSICS LAYER (added in current session)

This session built a comprehensive biomechanical model on top of the existing engine. All major NFL stat categories now land in NFL elite bands after the work.

### Wear + stress (`play-engine.js` + `play-franchise-offseason.js`)

- **`p._wear` (0-100)** — cumulative micro-damage that persists between games and decays during rest. Per-snap accumulation via `_FATIGUE_COST` / `_WEAR_PER_SNAP`; per-touch from `_bumpHitWear`.
- **`p._stress` (0-100)** — parallel non-contact load (sprints, cuts, route depth). Drives the non-contact injury path.
- **`p._bodyWear` (21 regions)** — per-region wear: head, neck, chest, back, groin, L/R shoulders/hips/hamstrings/knees/calves/achilles/ankles/hands. Initialized lazily via `_ensureBodyWear`. Updates on every injury via `_bumpBodyPart` with 70% recurrence-bias on the worse side.
- **`_accumulateWeeklyStress(w)` + `_decayWeeklyStress(w)` + `_decayWeeklyWear(w)` + `_decayBodyPartWear(p)`** — all called from `_runWeekEndResolution`. Bye -35, IR -25, scratch -22, normal starter -4 (wear) / -2 (stress).
- **Force-scaled hit wear** — `_bumpHitWear(carrier, base, tackler, opts)` computes `wear = base × tacklerForce × carrierVulnerability + extras`. Tackler gets 25% reciprocal wear (action-reaction).
- **Age coupling** — 30+ recover slower; 33+ +25% stress per snap; injury rate +10/25/45/65% by age band.

### Injury system (`play-franchise-season.js`)

- **Contact path** (`_rollGameInjuries`) — weekly per-player roll, position-weighted, wear×age multipliers stacking on top.
- **Non-contact path** (`_rollNonContactInjuries`) — separate per-game roll, stress-banded rate (0.002-0.033), pool: hamstring/calf/groin/achilles/knee/ankle.
- **Bimodal ACL spike** — W1-4 conditioning multiplier (2.0x → 1.0x) with veteran/Ironman/Sports-Sci mitigation up to -60%. Late-season spike via stress accumulation.
- **Concussion engine** — `_concussionsThisSeason` + `_concussionsLifetime` + `_lastConcussionWeek`. Second Impact recency multiplier (≤3 wks → 3.5x catastrophic chance), CTE arc (4+ lifetime → independent CE roll per concussion).
- **Catastrophic variants** — torn ACL, chronic concussion syndrome, labrum tear, Lisfranc fracture, torn achilles, chronic hamstring. Each with their own CE chance + duration.
- **Big-hit instant injury** — fires inside `_bumpHitWear` for force ≥ 1.1, additive to weekly roll. Uses `_triggerBigHitInjury` with force-scaled severity + body-part assignment.

### Play context (`play-engine.js`)

- **`_tackleWeightsForContext(ctx)`** — first-principles tackle attribution. Different position weights + assist rates per play type:
  - Run inside / outside / breakaway / stuff
  - Pass short-middle / short-outside / mid / deep
  - Goal-line, screen, scramble, TOR
  - Each ctx returns the appropriate `{weights, assistRate}` so a deep pass is overwhelmingly a safety tackle, etc.
- All 6 main tackle call sites pass `ctx` (rush, main pass, TOR, screen, scramble, sack hit).
- **MLB-biased LB picker** — `_creditDefStat` weights `lb2 (MLB) × 1.15`, `lb1 × 0.95`, `lb3 × 0.85` so an alpha tackler emerges (Bobby Wagner pattern).

### Hit mechanism (`play-engine.js`)

- **`_pickHitMechanism(tackler, opts)`** — returns `head_on / side / low / high / behind`. Weighted by tackler archetype (HEADHUNTER → head_on/high; DESPERATION → low cut blocks; BLITZER edge sack → behind blindside; WRAP_UP → square fundamental hit) and play context (sack → behind; deep pass → head_on/high; outside run → low; goal-line → head_on / no behind).
- Mechanism stamped onto injuryHistory + CE log, shown in Vitals timeline ("low / cut", "blindside", "high hit").
- `_triggerBigHitInjury` uses mechanism to bias injury type after the play-context bias (e.g., mech=high + force ≥1.3 → 80% override to concussion).

### Discipline (`play-engine.js` + `play-franchise-offseason.js`)

- **`_maybeFlagURForHit`** — fires UR flag after big-hit roll. Chance scales with mechanism (high → 55%) × HEADHUNTER × defenseless context (deep pass / crossing route ×1.35).
- **Ejection roll** — rare (~1.6/season league-wide vs NFL ~1-3). High mech + force ≥1.7 → +18%, 2nd UR same game → +35%, 3rd → +50%. Ejected player gets `_ejectedThisGame=true` and is skipped by `_creditDefStat`. Career counter `p.ejections` persists.
- **`_processWeeklyDiscipline(w)`** — runs in `_runWeekEndResolution`. Auto-suspension cascade: 2nd ejection same season → 1 game; 3rd career → 1 game; 4+ career → 2 games. Otherwise fine (news only). Uses `p.injury` with `label:"suspension"` so engine subs them out. `franchise._ejectionLog[season]` is array of records, `franchise.news` gets `type:"discipline"` entries.

### Vitals UI (`play-franchise-season.js`)

- **`_buildVitalsBlock(p)`** — drop-in section in the player modal:
  - **`_buildVitalsBodyDiagram(p)`** — Vitruvian-style line-art human silhouette (240×520 viewBox), position-scaled per `_VITALS_BODY_PROFILES` + player height/weight. Sepia/parchment palette. Anatomical inner lines (collarbone, sternum, pec divides, ab segments, hip V, quad inseams, knee caps, calf muscle hints, deltoid). 21 wearable regions overlaid as translucent paths colored by `_vitalsColor(v)` (green/yellow/orange/red).
  - **Overall health score** — `100 - max(wear, stress)`, color-coded bar
  - **STATUS** — active injury card with severity/cause/OVR penalty
  - **CONCERNS** — top 4 worn body parts (≥20 wear) with risk-multiplier tag
  - **RECOVERY GUIDANCE** — auto-recs ("Sit this week — wear critical", "CTE watchlist", etc.)
  - **RISK FACTORS** — career concussions, RB touches, prior injuries, age curve, career ejections
  - **INJURY HISTORY** — last 6 with cause chip (N-C / HIT / SACK / WK), body-part chip, mechanism tag

### Stat outcomes — all in NFL elite bands

After all tuning passes (last commit `ce54166`):

| Category | Audit | NFL elite |
|---|---|---|
| Top sacker / season | 22, 21, 21, 21, 20 | 15-22 ✓ |
| Top rusher / season | 2055, 1874, 1833 yds | 1800-2100 ✓ |
| Top WR / season | 1776, 1713, 1662 yds | 1700-1964 ✓ |
| Top tackler / season | 190, 182, 180 | 150-195 ✓ |
| Top QB / season | 5338, 5227, 4931 yds | 4500-5500 ✓ |
| Total injuries / team | 10.7-13.8 | 12-15 IR ✓ |
| Catastrophic % | 7-8% | ~8% ✓ |
| Career-ending / season | 2.6 | 5-10 (slightly under) |
| Ejections / season | 1.6 (5-season avg) | 1-3 ✓ |
| Avg injury duration | 4.0 wks | 4-6 ✓ |

### Personnel mix modernization (`play-data.js`)

NFL 2024 uses 11 personnel (TRIPS) on ~62% of plays. Updated all five playbooks (BALANCED, AIR_RAID, GROUND_AND_POUND, DUAL_THREAT, OPTION) to bump TRIPS share and trim BASE (which modern NFL barely uses). Side effect: WR3 / slot CB now see realistic snap shares.

### Target mix tuning (`play-data.js`)

Final WR1 / WR2 / TE / RB target shares per playbook after multiple audit passes:
- BALANCED: 38 / 24 / 22 / 16
- AIR_RAID: 32 / 26 / 20 / 22
- GROUND_AND_POUND: 32 / 20 / 30 / 18
- DUAL_THREAT: 33 / 24 / 21 / 22
- OPTION: 32 / 22 / 26 / 20

---

## 8. Next steps (prioritized)

The major OPEN item from the engine roadmap:

1. **Phase 5 — Smart pickers / player contracts**: replace flat snap-share % with three goal modes per slot: `share` ("65% of relevant snaps"), `count` ("55 snaps if game flow allows"), `touches` ("18 carries / 8 targets target"). Multi-file refactor: extend snapShares data model, modify `_rotateForSnap` + `pickRusher` + `pickReceiver` to consult mode/target, add auto-manage policies (Balanced / Ride starters / Playoff push), expose modes in the UI.

Smaller follow-ups after Phase 5:

2. **Auto-manage UI for rest/sit decisions** — surface wear/stress with recommended sub policy per game.
3. **Live game viewer enhancements** — show mechanism / UR / ejection visuals in real-time play log.
4. **Career-ending injury rate bump** — currently 2.6/season vs NFL 5-10. Could raise catastrophic upgrade chance slightly.
5. **Non-contact share** — currently 25% vs NFL ~40%. Stress accumulation works; rate could lift further.
6. **Multi-game suspension news on dashboard** — Currently just `franchise.news` entries; could surface as banner.
7. **Pace tuning** — slightly too many plays per game (was 70 vs NFL 62 in an earlier audit; may have shifted).

From the prior contract/extension reassessment (still open):

8. **#6 AI inquiries for unhappy stars** — when `tradeRequested=true`, generate weekly inbound trade offers.
9. **#2 Counter-offer flexibility** — custom AAV slider, "match years cut AAV" variants.
10. **#9 Price-aware verdict** — factor demand AAV vs market into pitch verdict.
11. **#7 Comp pick surplus value math**.
12. **#8 Unify mid-season vs offseason demand systems**.

Do NOT do at this stage unless user asks:
- Counter-offer slider UI redesign (touches a lot of layout)
- Save data pruning (user wants full fidelity)
- Coaching carousel expansion (already comprehensive)

---

## 8. Instructions for the next Claude Code chat

You're continuing mid-session work on GridironChain. Read this carefully:

- **Do not redo completed work.** Everything in section 3 is shipped and committed on branch `claude/football-sim-blockchain-game-b3sdq`. Check `git log --oneline -30` to see recent commits before starting.
- **Inspect files before editing.** Files are large (offseason.js is 12k+ lines). Use `grep -n` to find functions; don't try to read whole files. Key entry points: `_buildExtensionPitch`, `_holdoutCapProjectionDetail`, `playerLink`, `_findPlayer`, `_renderHoldoutsBlock`, `runFrnOffseason`, `_buildOffseasonGainsSheet`.
- **Preserve existing patterns.** Tier system goes through `playerLink`. Cap-bar hover uses `data-resign-hits` / `data-resign-cap` + `_resignHoverIn/Out`. Migrations are flag-gated (`franchise._xxxRepaired_vN = true`). Contracts must stamp `startSeason` + `signedOvr` at every creation site (currently 7 sites).
- **`p.name` is sacred** — never rewrite for nicknames. Use `p.nickname` + `p.goesByNicknameOnly`.
- **Verify with `node -c <file>.js`** after edits. There's no formal test suite.
- **Commit + push each logical change** with a clear commit message. The user iterates fast and likes the audit trail.
- **Ask before broad architectural changes** — especially merging the two demand systems (`_checkHoldoutDemands` vs `_detectHoldouts`) or restructuring the contract screens further.
- **The user prefers data-driven, persuasive UX** — when adding info, frame it as evidence the GM can act on, not raw stats.
- **CDN delivery**: after every push, give them `https://rawcdn.githack.com/blackjakk/datasciencecoursera/<commit>/gridiron-chain/play.html` so they can test on the actual deployed file.

---

## 9. Compact context (paste this as the opening message)

> Continuing work on **GridironChain**, a vanilla JS NFL franchise simulation at `/home/user/datasciencecoursera/gridiron-chain/`. Active branch: `claude/football-sim-blockchain-game-b3sdq`. The game is a mature, deeply-featured franchise sim; recent sessions focused on contract/extension UX, awards voting, HOF system, offseason gains sheet, player card decoration, and migration fixes for save corruption from past bug fixes.
>
> **Files**: `play-franchise-core.js`, `play-franchise-season.js`, `play-franchise-stats.js`, `play-franchise-offseason.js`, `play-player.js`, `play-render.js`, `play.css`. Concatenated via `<script src>` in `play.html` — top-level `const`/`function` declarations are cross-file accessible. No build step. Syntax check with `node -c <file>.js`. After commit + push, share `https://rawcdn.githack.com/blackjakk/datasciencecoursera/<commit>/gridiron-chain/play.html`.
>
> **Recent ships (latest commit `9f44460`):** all three contract screens (offseason re-sign, mid-season holdout center, offseason demand) have portraits, tier-styled clickable names, raise/premium math, hover-preview cap bars, and the `_buildExtensionPitch` data block ("THE CASE" — season prod, career, honors, trajectory, league rank, availability, window, money's worth, market, comp $, verdict). The demanding-extensions cap bars now render as split-fill (baseline + signed extension segments in gold) with per-year delta callouts. Offseason gains sheet shows per-player OVR Δ with reason chips, ceiling cell, contract cell, hidden-gem hero, re-sign priority. HOF voting runs annually with first-ballot badges. CPU casts weekly POTW votes. Player legacy tier system (LEGEND/ICON/ELITE/PRO) wired through `playerLink` everywhere. Nicknames are flag-only (never rewrite `p.name`) with themed origin lore. `_findPlayer` falls through to HOF/alumni so retired-name links open a minimal modal.
>
> **Recent fixes**: contract demand cooldown via `contract.startSeason` (stamped at all 7 creation sites, backfilled from `years - remaining` for legacy contracts). Demand probability 35% with 0.70 underpay threshold (3 seasons cooldown). Ignored-extension consequences: -2 OVR + dev freeze flag + 40% trade-request roll + 25% demand premium at FA + locker-room banner on player card. Availability % uses `careerHistory` only (caps at 100%). v3 migration softened to dedup-by-season-key (not strip calendar-years); v4 reconstructs prior-team rows where v3 over-stripped. FPTS lookup tries nickname + falls back to seasonStats. `potentialTag` shows "Hit ceiling" / "Fell short" for vets past peak.
>
> **Pending priorities** (from a reassessment the user asked for): #2 better counter-offer levers (custom AAV, year/$ trade variants); #6 AI inbound trade offers for unhappy/trade-requested stars; #7 comp pick surplus value vs deal cost; #9 price-aware pitch verdict; #8 audit mid-season vs offseason demand systems.
>
> **Conventions**: never rewrite `p.name` for nicknames. Tier system goes through `playerLink(p)` / `_playerLinkSmart(name)`. Migrations are version-flagged on `franchise.*`. Contract objects must include `startSeason` and `signedOvr`. Verify edits with `node -c`. Commit + push each change with descriptive message. The user prefers data-driven persuasive UX over abstract stats. Ask before any broad architectural change.
