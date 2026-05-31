# GridironChain — Talent Model, From First Principles

> Written before retuning, after the 100-season audit showed the league
> over-inflates (90+ share **14.7%** vs NFL ~2-3%, roster mean **80.8**), R1 picks
> **never bust** (0% / 95% Pro Bowl), and QBs **never** emerge as late-round
> legends while safeties over-emerge. These are not three bugs — they're three
> symptoms of one mis-balanced **talent economy**. This doc reasons about how
> that economy *should* work, so we tune flows toward an equilibrium instead of
> chasing knobs. Mechanics are mapped against the real code (file:line).

---

## The central principle: the league is a stock-and-flow system at steady state

Over many seasons the league OVR distribution converges to an **equilibrium**
set by the balance of *flows*, not by the starting rosters. For any OVR tier
(say 90+), at steady state:

> **rate IN (players developing up into the tier) = rate OUT (players declining
> + retiring out of it).**

If IN > OUT, the tier grows every year — that's our **14.7% at 90+** (the audit's
*DRIFT BY DECADE* should be flat; it rises). So the goal of any retune is to
balance the flows so the distribution holds decade over decade — **not** to
tweak one number until a single season looks right.

There are exactly **six valves** on this economy. Three set how talent ENTERS
the top, three set how it LEAVES. We have to move them *together*.

---

## The six valves (principle → current → gap)

### 1. Generation — how many players are *capable* of elite (the source)
- **Principle:** a draft class should yield a *handful* of future stars; most
  prospects top out as roleplayers. Real NFL: maybe 2-5 future 90+ players per
  class.
- **Current:** the `HiddenOracle` ceiling roll puts **16% of prospects at an
  88+ ceiling** (offseason ~19057). Over a ~210-prospect class that's **~34
  future 88+ players minted every single year.**
- **Gap:** ~5-8× too generous. This is the **primary inflation source** — too
  many high ceilings created. Target ~2-4% at 88+ (a class yields ~4-8 future
  stars, not 34).

### 2. Scouting / draft evaluation — the bust↔gem SYMMETRY (the missing tail)
- **Principle:** teams draft on **perceived** value = true ability + scouting
  error. Busts and gems are the two *symmetric tails* of that error: a R1 busts
  when his true ceiling is **below** where he was drafted; a R7 gem hits when his
  true ceiling is **above**. Bust rate ≈ gem rate ≈ the scouting-error rate.
- **Current:** rookies enter the NFL at their **true current OVR** (offseason
  ~21840); only the *ceiling* carries perception noise. Hidden **gems exist**
  (late picks with high hidden ceilings) but there is **no bust side** — no early
  picks with hidden *low* ceilings. The model only generates *positive*
  surprises.
- **Gap:** the negative tail is missing. **This is exactly why R1 bust = 0%.**
  Some R1/R2 picks must have true ceilings *below* their draft slot (overrated →
  bust). Symmetry is the structural fix, independent of inflation.

### 3. Development — how *reliably* the ceiling is realized (the spread)
- **Principle:** growth toward ceiling should be *uncertain* — real variance and
  regression risk, so even high-ceiling players sometimes stall or wash out. The
  realized-OVR distribution should be **wider** than the ceiling distribution
  (a few over-realize, many under-realize).
- **Current:** regression fires rarely (**2%/yr** for ceiling ≥ 80) and softly
  (1-3 OVR), so high-ceiling players climb almost deterministically
  (`_developNflPlayer`, offseason ~10801). `peakMult`/`devMult` cap how *far*,
  never *whether*.
- **Gap:** downside too thin → everyone reaches their ceiling → no busts, dense
  top tier. Need fatter, more frequent stalls so realization spreads out.

### 4. Peak / decline — the top-tier OUTFLOW (the drain)
- **Principle:** post-peak decline should turn the top over — a 90+ player should
  shed back toward ~85 within 2-3 years of peak and be roster-fringe within ~5.
  Decline is the **main drain** on the 90+ stock.
- **Current:** **1-2 OVR/yr** decline with late onset ages and small per-stat
  drops (offseason ~11228) — vs a realistic **3-5/yr** cliff (worse for RB).
- **Gap:** decline is ~2× too shallow, so 90+ players *linger* in the tier for
  years and the stock piles up. **The most direct lever to drain 90+.**

### 5. Retirement / attrition — the depth OUTFLOW
- **Principle:** ~25-30% annual turnover; a *few* elites get real longevity
  (Brady/Brees), the rest age out on schedule.
- **Current:** ~35-50% attrition (`_processSeasonEndRetirements`, stats ~9074) —
  actually *higher* than NFL, so volume isn't the problem. But the
  **accolade-longevity bonus** keeps *elite* vets around to 38-40, which
  specifically preserves the 90+ stock.
- **Gap:** minor. Attrition is fine/high; only the elite-longevity protection
  mildly props up the top. A secondary lever at most.

### 6. OVR formula — per-position reachability of the ceiling (the QB/S skew)
- **Principle:** every position should mint legends at a rate scaled to real-NFL
  scarcity — and **QB is *the* Brady position**, so "0 QB late-round legends in
  100 yrs" is wrong.
- **Current:** QB OVR is **42% THR** (player.js:851); a late-round QB rarely has
  elite THR and can't reach 96+ without near-max THR. Safety OVR spreads across
  SPD/COV/TCK/AWR/TEC and tops out more easily → **all 3 late-round legends were
  safeties.**
- **Gap:** the 96+ threshold is differentially reachable by position. Either
  normalize reachability, or let dev push the *signature* stat (THR for QB) hard
  enough that a high-ceiling late QB can actually get there.

---

## The three observed problems → which valves own them

| Observed (100-season) | Root valve(s) | Direction |
|---|---|---|
| 90+ share 14.7% (vs 2-3%), mean 80.8 | **1 (ceilings)** + **4 (decline)** | fewer born elite + drain faster |
| R1 bust 0% / PB 95% | **2 (scouting symmetry)** + **3 (dev spread)** | add the bust tail + widen realization |
| QB never a late legend; S over-emerges | **6 (per-position reachability)** | let the signature stat reach the bar |

**Key coupling:** valves 1 and 4 *jointly* set the 90+ equilibrium and must move
**together** — steepen decline alone and legends decline before they peak (too
few stars); cut ceilings alone and the few stars still linger (weak decline).
Busts (valve 2) are a *separate, structural* addition — the model currently has
only the upside tail of scouting error.

---

## The north star (how we'll know the retune is right)

Run `_brady_audit` long and check **equilibrium**, not single seasons:
1. **DRIFT BY DECADE is flat** (the league isn't inflating).
2. **90+ ≈ 2-3%, 95+ ≈ 0.5-1%**, roster mean ~74-76.
3. **R1 bust ≈ 25-30%**, PB% ≈ 50-60% (R1s are good bets, not locks).
4. **Legends emerge across positions** at NFL-like rates — including **QB**.
5. **Brady cadence:** QB late-round legend ~1 per 60-100 yrs; all-position
   late-round legend more frequent but not safety-only.

Tune the *flows* to hit that steady state; don't chase any single metric.

---

## Proposed retune order (once we agree on the framework — NOT done yet)

1. **Ceiling distribution (valve 1):** pull the 88+ ceiling share from 16% →
   ~3-4%; reshape the curve so most prospects top out 70-82.
2. **Decline (valve 4):** steepen post-peak to ~3-4 OVR/yr, earlier onset for
   speed positions (RB cliff).
3. *Re-run, confirm 90+ heads toward 2-3% and drift flattens, then:*
4. **Scouting symmetry (valve 2):** give a fraction of early picks hidden
   ceilings *below* their slot (busts), mirroring the existing gem mechanic.
5. **Dev spread (valve 3):** modestly raise regression frequency/severity so
   realization widens (more partial busts).
6. **Per-position (valve 6):** ensure QB dev can push THR to the legend bar;
   check S isn't structurally easiest.

Each step re-runs the long audit and reads the equilibrium, not one season.

---

## Queued findings (post-retune)

Tracked here so they're not lost; **do not tune until the talent retune settles**
(otherwise we'd be calibrating against a moving target).

### HoF position multipliers are over-corrected (stale 500-season rebalance)
At 100 seasons of the pre-retune sim:

| pos | inductees | % of HoF | NFL target | verdict |
|---|---|---|---|---|
| LB | 135 | 23.9% | ~8% | **way over** (1.15× mul + tackle volume) |
| QB | 128 | 22.7% | ~10-12% | over (counting bonus too generous given hot sim stats) |
| OL | 83 | 14.7% | ~17% | OK |
| DL | 78 | 13.8% | ~12% | OK |
| K  | 46 | 8.1%  | ~1% | **way over** (counting-only + no accolades) |
| RB | 32 | 5.7%  | ~6% | OK |
| P  | 23 | 4.1%  | ~0.5% | **way over** |
| WR | 22 | 3.9%  | ~12% | **way under** |
| TE | 17 | 3.0%  | ~5% | under |
| CB | 1  | 0.18% | ~9% | **catastrophically under** |
| S  | 0  | 0%    | ~6% | **broken** (4 in-sim 96+ LEGENDS were all safeties, but ZERO inducted) |

`_hofPositionMul` (`play-franchise-season.js:1604`) currently has CB/S at 0.85×
and K/P at 1.30-1.45×. The 0.85 over-corrected DBs from 25.7% (pre-rebalance) to
~0%. Re-tune **against the post-retune 100-season equilibrium** (sim stat rates
will have shifted by then) — adjust mults toward NFL shares.

### S-only legend bias (per-position reachability — already valve 6)
4 of 4 legend (96+) emergences in 100 seasons were **safeties** — confirms the
position-formula bias flagged in valve 6. S OVR = `SPD×21 + COV×30 + TCK×26 +
AWR×8 + TEC×15`: COV and TCK are both heavily developable through the gem path,
so 56% of the formula is "easy growth." Compare QB OVR = `THR×42` — needs near-
max THR specifically to clear 96+, and the gem grind doesn't push THR fast
enough. Fix is structural (per-position dev stat selection in `_gemDevStats`,
not multipliers).

### Star-tier ("near-legend") tracking gap — **DONE**
~~`LEGEND CAREERS` only tracks peak OVR ≥ 96.~~ Added **STAR CAREERS** to
`_brady_audit.js`: parallel `starPlayers` map captures every player whose peak
OVR reaches ≥ 90 regardless of gem status; dumped after LEGEND CAREERS, top 15
by peak OVR, with archetype on the header line and an 8-season window centered
on the peak for long careers. RB stat-cols also expanded to include receiving
(rec / rec_yds) so Nasser-tier dual-threat backs show their full role. Next
audit produces the data; doesn't affect engine.

### Dev-curve shape — sharkfin gaps (do AFTER level retune settles)
The ascent is already quasi-sharkfin via gap-driven exponential taper (year-1
~6 OVR, year-5 ~1.5 OVR for a high-ceiling player). Two real gaps remain:

**1. No rookie year-1 burst.** Mahomes/Lamar/Stroud-style year-1-to-year-2
jumps are bigger than the gap math alone produces. Currently `intensity` weights
(`4.0/1.8/1.0` at `0.2/0.3/0.5`) are constant by year. Fix: bias year-1 toward
the burst tail (`0.5/0.3/0.2`). Concrete impl: `HiddenOracle.roll.intensity(p,
year)` — special-case `yearsInLeague <= 1` to use rookie-burst weights.

**2. Decline isn't tied to usage (wear).** The wear system already tracks
accumulated punishment (`p._wear`, 0-100) from snaps + hits, but it's only
plumbed into in-game Q4 effective-OVR (≤−7%) and injury rate (up to 1.6×) — NOT
persistent decline. Current `_dc(onset)` = `35/55/70%` is purely age-based.
**Preferred fix: wear-driven decline scalar.** A workhorse RB with 320 carries
should cliff at 27; a committee back stays starter-grade at 30; Brady avoids
hits → plays at 43. Implement as a `wearMul` on `_dc`:

```js
const wear = p._wear || 0;
const wearMul = wear >= 70 ? 1.5
              : wear >= 50 ? 1.20
              : wear >= 30 ? 1.0
              : 0.80;
const _dc = (onset) => {
  const yrs = age - onset;
  const base = yrs <= 0 ? 0 : yrs === 1 ? 0.35 : yrs === 2 ? 0.55 : 0.70;
  return base * wearMul;
};
```

This **subsumes** the position-differentiated decline idea: RB cliff = emergent
(high carries → high wear → fast decline), QB plateau = emergent (low hits
absorbed → low wear → slow decline), without hard-coded position rules. Smart
usage = career extension. *Fallback only if wear data is too noisy*: position-
aware `_dc` tables — RB `60/80/90`, WR/CB/S `35/55/70`, QB/OL/TE `20/35/50`.

Both changes are **shape, not level** — they shouldn't materially shift the 90+
equilibrium (rookie burst pushes some R1s to 90+ year-1 = small +; RB cliff
shortens dwell time at peak = small −; roughly washes). Do AFTER the current
level retune so the signals don't muddle.

### RB mileage system — "tread on the tires" (queued, RB-only)
Distinct from wear (which is per-season beating that mostly resets, ×0.10 each
offseason). Mileage is **career-cumulative, mostly sticky, occasionally
rejuvenated** — what real NFL fans mean by "tread."

| layer | timescale | recovers | drives |
|---|---|---|---|
| wear (exists) | season | ~90% each offseason | Q4 fatigue + injury + (queued) decline scalar |
| **mileage (new)** | career | ~3-7%/offseason, rare 12% rejuv | RB peakAge/declineAge shift + cliff steepness |

**What it tracks:** `p._mileage` (RB only initially). Weighted per touch:
- rush_att: +0.5 base
- inside-run / short-yardage: +0.3 (extra contact)
- broken-tackle event: +0.1
- reception (RB only): +0.3 (catches over the middle absorbed)

**Career tiers** (target the "tread point" at ~2,500-3,000 touches):

| mileage | effect |
|---|---|
| < 1,500 | no effect (most RBs never hit this) |
| 1,500-2,000 | `declineAge -1` (subtle erosion) |
| 2,000-2,500 | `declineAge -2`, `peakAge -1` (cliff edge) |
| 2,500-3,000 | `declineAge -3`, `peakAge -2`, `_dc` scalar × 1.3 |
| 3,000+ | `_dc` scalar × 1.5 (every step is painful) |

**Rejuvenation logic** (the "mostly not" part):

| season usage | offseason mileage decay |
|---|---|
| light (<150 touches) | ×0.93 (small recovery) |
| IR or ≥8 missed games | ×0.88 (Lynch sit-out) |
| default (150-300) | ×0.97 (tread is sticky) |
| heavy (>300) | ×1.00 (no recovery) |

Floor: mileage never drops below 50% of accumulated peak — cartilage / joints
don't regrow.

**Hidden:** user-facing surface is the *manifest* effects (earlier decline,
worse year), not the raw number. Restores scouting tension on aging RBs.

**RB only first:** cleanest test case; position with the most empirical "cliff"
data. Extensible to WR (deep balls absorbed), CB/S (collisions on screens) if
the mechanism proves out.

**Sequencing:** **after** wear-driven decline lands. Wear handles the general
usage→aging mechanism for all positions; mileage adds the RB-specific career-arc
refinement. If wear gets 90+ share in band, mileage is polish + RB narrative
flavor; if wear doesn't close the gap, mileage is the closer.
