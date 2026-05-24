# MONEYLEAGUE — A First-Principles Look at What Wins
*An analytical post for the league · May 24, 2026*

This is an attempt to look at 10 years of our draft history (2015-2024, restored from the spreadsheet's cell colors) and 3 years of full Sleeper transaction/matchup data (2023-2025) to figure out — from first principles — what actually makes people win in our league. Findings are league-neutral; everyone shows up in the data.

---

## 1. The Win Equation (first principles)

Championship odds break down into roughly:

```
P(title) = P(make playoffs) × P(win 3 playoff games)
         = f(points scored, schedule luck) × f(matchup variance)
```

**Points scored** is the only thing you control. It's a sum of:

- **Draft VBD** (17 picks set ~70% of your roster baseline)
- **Wire VBD** (volume × hit-rate over 17 weeks)
- **Trade VBD** (rare, net-zero across the league by definition)
- **Lineup decisions** (small but non-zero — start/sit calls)

**Uncontrollable**: weekly H2H matchup, injuries, playoff seeding RNG. Each of those is large-magnitude noise. Over a 14-game regular season, schedule luck swings 2-3 wins routinely.

**The implication**: the things you can actually control are draft, wire, and (occasionally) trade. Everything else is noise to be endured. The data below quantifies how much each lever matters.

## 2. The 10-Year Cast

Nine managers have been here for all 10 seasons (2015-2024). The rest have come and gone — here's the roster lineage:

| Era | Joined | Left |
|---|---|---|
| 2015 (Yahoo, 10-team) | Nine of the current core | — |
| 2017 (Yahoo expansion to 10) | One new owner | One departed |
| 2019 (Yahoo, 12-team) | Two new owners | — |
| 2020 | One slot turned over | — |
| 2021 | One slot turned over | — |
| 2023 (Sleeper migration) | — | — |
| 2025 | One slot turned over | — |

Different drafters topped each scoring era — and the league has had three distinct scoring eras:

- **Standard era** (2015-18): 10-team, 0 PPR, 2QB
- **Half-PPR Yahoo** (2019-22): 12-team, 0.5 PPR, 2QB
- **Superflex Sleeper** (2023-24): 12-team, 0.5 PPR, superflex

**Per-era top-3 drafters (by VBD/season):**

| Era | #1 | #2 | #3 |
|---|---|---|---|
| Superflex Sleeper (2023-24) | Brian (+642/yr) | Troy (+621/yr) | Brower (+499/yr) |

Earlier eras had completely different top-3s — the leaderboard resets when scoring changes. The lesson: **what worked in one format doesn't automatically carry forward.** This is most relevant if/when we ever tweak scoring again.

*Note: K and DEF picks excluded from this analysis (no historical data — neutral for everyone). Player names cross-matched against public nflverse season stats.*

## 3. Lever #1 — Drafting (the biggest controllable signal)

A 17-round draft gives you 17 high-leverage decisions in a single day. The spread between the best and worst draft in a given year is routinely **±500-1,000 VBD points** — roughly 30-60 points/week of expected scoring edge before any wire moves. That's the difference between a 10-4 team and a 4-10 team *before luck even enters the picture*.

**Things the data confirms:**

1. **Era matters more than ability.** The #1 drafter of the 2QB Yahoo era (2019-22) crashed to #11 in superflex. The #13 drafter of that era jumped to #4 in superflex. Format change = reset.
2. **Peak year > 3-year average.** Every champion of the Sleeper era (Eric 2023, Coop 2024, Trevor 2025) was top-2 in DRAFTING that specific year, even when their 3-year average was middle of the pack. **The goal isn't to be a consistently good drafter — it's to nail one year.**
3. **K/DEF in the late rounds is free money.** A R15 K (Aubrey, Boswell, Fairbairn) routinely returns +130-155 VBD. That's more than most R3 picks return above replacement. Almost no one drafts kickers strategically.

## 4. Lever #2 — The Wire Game (under-exploited)

The wire is the most under-played lever in the league. Big hits show up *every single year* — here are the top 10 from the Sleeper era:

| Year | Wk | Pos | Player | Pts produced | Drafter |
|---|---|---|---|---|---|
| 2023 | W3 | QB | **Josh Allen** | +350 | Troy |
| 2025 | W3 | RB | **Jahmyr Gibbs** | +282 | Josh |
| 2023 | W3 | WR | **DJ Moore** | +213 | Troy |
| 2024 | W10 | QB | **Josh Allen** | +202 | Troy |
| 2024 | W9 | QB | **Jayden Daniels** | +197 | Brian |
| 2023 | W3 | RB | **Kyren Williams** | +197 | Brower |
| 2023 | W3 | WR | **Keenan Allen** | +187 | Brower |
| 2023 | W5 | RB | **Rachaad White** | +185 | Tim |
| 2025 | W5 | RB | **Rico Dowdle** | +176 | Troy |
| 2023 | W2 | WR | **DeVonta Smith** | +173 | Donnie |

**Volume vs hit-rate per manager (2023-2025):**

| Manager | Total adds | >50 pt hits | Hit rate | Total wire pts |
|---|---|---|---|---|
| Trevor | 192 | 15 | 8% | +3021 |
| Brower | 149 | 20 | 13% | +3001 |
| Troy | 100 | 14 | 14% | +2999 |
| Josh | 97 | 17 | 18% | +2565 |
| Brian | 105 | 19 | 18% | +2475 |
| Coop | 50 | 18 | 36% | +2214 |
| Kyle | 84 | 14 | 17% | +2138 |
| Lem | 78 | 11 | 14% | +2000 |
| Ankur | 84 | 13 | 15% | +1994 |
| Eric | 56 | 11 | 20% | +1782 |
| Tim | 43 | 10 | 23% | +1444 |
| Donnie | 29 | 11 | 38% | +1388 |

Two distinct successful styles:

- **High volume / lower hit-rate** (Trevor 192 adds, Brower 149, Brian 105): spray-and-pray. More darts = more chances of hitting.
- **Low volume / high hit-rate** (Donnie 29 adds at 38% hit-rate, Coop 50 at 36%): selective tactical. Each pickup is researched.

Both work. What *doesn't* work: mid-volume with low hit-rate (Ankur, Kyle, Lem in the 80-100 range with 13-15% hit-rate). **If you're going to play the wire, commit to one style.**

**Pickup yield by position (Sleeper era):**

| Position | Total adds | Avg pts/add | >100 pt hits |
|---|---|---|---|
| QB | 143 | 31 | 16 |
| RB | 232 | 25 | 18 |
| WR | 243 | 29 | 21 |
| TE | 131 | 25 | 5 |
| DEF | 192 | 19 | 4 |
| K | 126 | 22 | 3 |

**QB and RB pickups yield the most per-attempt.** WR/TE adds have the worst average return — the WR3 who had a good Sunday is almost always a trap. **If you're picking up a WR, it should be a rookie with a target share spike, not a veteran who just scored a TD.**

**When the big hits happen (>100 pt pickups, by week):**

```
  W 2: ████████ (8)
  W 3: ███████████ (11)
  W 4: █ (1)
  W 5: ███████ (7)
  W 6: ████████ (8)
  W 7: ████████ (8)
  W 8: ████ (4)
  W 9: ██ (2)
  W10: ██████████████ (14)
  W11: ███ (3)
  W13: █ (1)
```
Three clear peaks:

- **W2-W3**: workhorse-RB injury wave (when handcuffs become starters)
- **W5-W7**: second-wave RB and early QB benchings
- **W10**: trade-deadline drops + bye-week QB streaming — the single biggest wire week of the year

## 5. Lever #3 — Trades (the net-zero category)

Trade VBD nets to ~zero across the league by mathematical definition: one side's gain is the other side's loss. Over the 3-year Sleeper window, individual trade scorecards range from +400 to -400 VBD, but the league-wide sum is near zero.

**Implications:**

1. **Don't trade unless you're confident you're EV+.** The average trade is a coin flip. Bad trades are how you give away the season.
2. **Mid-season trades for stars favor the buyer of recent performance, not the seller.** A common pattern: someone trades for a hot QB in W8, the QB stays hot, but the trade itself still moves only ~150 VBD because half the season is already scored.
3. **Future picks are wildly under-priced.** Future R2 picks rarely command R5 current-year value, but historically a R2 delivers +100 VBD on average. Sellers of future picks are leaving value on the table.

## 6. Lever #4 — Lineup Decisions (small but free)

Across the 12-team league, the spread between optimal-lineup and actual-lineup totals is typically ±20-50 points per season — less than 1.5 points/week. Most managers leave 30-40 points on the bench per year. It's small, but it's also free: research matchups, check inactives an hour before kickoff. Better lineup discipline alone is worth roughly 1 extra win across a 14-game season.

## 7. The Noise — Luck and Schedule

**All-play expected wins** (your weekly score vs every other manager's score that week) is a better measure of true team strength than your actual record. Across 3 years, the spread between most-lucky and least-lucky manager is ~4 wins — huge.

**The takeaway:**

- If your **PF is high but record is bad**, you're probably running good and just unlucky. Be patient. Don't blow up the team chasing a bad start.
- If your **PF is low but record is good**, you're getting lucky. Trade from a position of perceived strength while you can.
- **Luck regresses.** The unluckiest 2023-2025 manager is extremely likely to outperform their record in 2026, and vice versa.

## 8. What Champions Have in Common

Looking at the three Sleeper-era champions:

- **Eric (2023)**: top-2 drafter that year + top-2 in trades
- **Coop (2024)**: top-2 drafter + top-2 in wire + top-2 in trades — total dominance
- **Trevor (2025)**: top-2 drafter + top-2 in wire — won despite mediocre trades and bad luck

**The single common thread**: top-2 in DRAFTING that year. Every other category is variable across champions. **The path to a title runs through nailing one specific year's draft, not through being a consistently good drafter.**

This also means: don't get cute. Don't engineer your draft around your keepers when the keepers don't pencil. Don't chase fades. A clean, BPA draft with good positional balance is what's actually winning.

## 9. A 2026 Tactical Calendar

- **Pre-draft**: Lock in your keepers. Decide WR vs RB-first before draft day. Don't make format changes in-room.
- **W1-W2**: Watch usage, not stats. Snap counts > yardage.
- **W2-W3 — RB INJURY HUNT**: Workhorse handcuffs become starters. Top historical hits: Kyren Williams W3, Breece Hall W6, D'Andre Swift W3, Woody Marks W3.
- **W5-W7 — SECOND-WAVE PICKUPS**: rookie WR after target spike, RB rotations sorting out. Most cheap leverage of the season.
- **W7-W10 — QB SHUFFLE**: Benchings + injuries + byes mean starter-quality QBs hit the wire constantly. Highest yield position by avg pts/add.
- **W10 — TRADE DEADLINE WEEK**: The biggest wire week of the year. Camp the wire. Other managers drop assets to clear playoff roster spots.
- **W11-W13 — PLAYOFF RUN**: Stop speculating. Add only direct contributors. Lock in matchups, not theories.
- **W14+ — PLAYOFFS**: Stream DEF and K against bad offenses. Trust your starters. Don't bench based on one bad game.

## 10. Six Principles (TL;DR)

1. **The draft is 70% of your team.** Peak-year matters more than career skill. Don't get cute — BPA wins.
2. **The wire is the biggest under-exploited margin.** Either commit to high volume or high selectivity. Mid-volume + low hit-rate is the worst zone.
3. **Trade only when you're clearly EV+.** Most trades are coin-flips. Future picks are under-priced.
4. **Lineups are free points.** Check inactives. Use FAAB discipline. Bank ~30 points/year that most managers leave on the bench.
5. **Don't trade against the wire when the wire is hot.** Weeks 3-6 and 10 are when the league's biggest pickups happen. Trade in dead weeks.
6. **Believe in regression.** High-PF + low-W = next year you. Low-PF + high-W = next year not you.

---

*Methodology: 10 years of draft attribution from the league spreadsheet (cell-color overlay used for Yahoo-era pick trades). Sleeper-era VBD computed against era-appropriate replacement ranks (10-team 0PPR for 2015-18, 12-team 2QB 0.5PPR for 2019-22, 12-team SF 0.5PPR for 2023+). Player stats from the public nflverse data release for 2015-2024, live Sleeper data for 2025. Full underlying numbers + per-manager awards report available separately.*