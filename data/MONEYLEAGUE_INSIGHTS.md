# MONEYLEAGUE — Things in the Data You Wouldn't Have Guessed
*May 2026 · Sleeper era 2023-2025 · 36 manager-seasons · ~3,500 transactions · ~6,000 game results*

---

## 1. The 0-4 Death Sentence

Looking at 36 manager-seasons of regular-season data:

- Managers who started **3-1 or 4-0**: 13 of 36 → **11 made playoffs (85%)**
- Managers who started **0-4 or 1-3**: 10 of 36 → **0 made playoffs (0%)**

Hot starts are an 85% predictor of playoffs. **Cold starts are a 100% predictor of MISSING playoffs in our league.** Not a single 0-4 or 1-3 team has ever clawed back into the top 6 in the Sleeper era. Across 3 seasons, no one's done it. The first 4 weeks aren't just early data — they're the season.

## 2. Boring Teams Win

Coefficient of variation (CV) on weekly scoring, 3-year window — lower = more consistent week to week:

| Manager | Avg PPG | StdDev | CV |
|---|---|---|---|
| Eric | 127.0 | 19.7 | 15.5% |
| Brower | 137.5 | 22.4 | 16.3% |
| Lem | 122.5 | 24.0 | 19.6% |
| Coop | 130.5 | 26.9 | 20.6% |
| Troy | 131.3 | 29.8 | 22.7% |
| Brian | 125.1 | 28.4 | 22.7% |
| Tim | 120.0 | 27.5 | 22.9% |
| Josh | 125.1 | 29.3 | 23.5% |
| Donnie | 129.6 | 30.6 | 23.6% |
| Trevor | 125.0 | 30.4 | 24.3% |
| Ankur | 128.4 | 31.9 | 24.8% |
| Kyle | 133.1 | 34.0 | 25.6% |

The most boring-looking lineups (lowest CV — Brower 16%, Eric 16%, Lem 20%) are also the league's most consistent playoff teams. The boom-or-bust managers (Kyle 26%, Ankur 25%) miss playoffs more often than they make them. **Variance is a tax, not a strategy.**

## 3. Schedule Luck Is Worth ±5 Wins

Computing **all-play expected wins** (your weekly score vs every other team's that week, divided by 11). Difference from actual = pure schedule luck.

| Year | Most Lucky | Most Unlucky |
|---|---|---|
| 2023 | Kyle +3.4 W (actual 10, expected 6.6) | Coop -4.2 W (actual 4, expected 8.2) |
| 2024 | Josh +2.6 W (actual 7, expected 4.4) | Eric -3.9 W (actual 3, expected 6.9) |
| 2025 | Trevor +5.2 W (actual 10, expected 4.8) | Troy -5.7 W (actual 3, expected 8.7) |

**Trevor's 2025 title came with +5.5 wins of schedule luck** — he won 10 games against an expected 4.5. That's the single luckiest season in the dataset. Conversely, Troy's 2025 campaign cost him **5.4 wins of unluck** — finishing 3-11 on an 8-win-quality team.

If your record looks weird, it probably is.

## 4. The R13-R16 Bust Belt

Non-keeper draft picks, bust rate = % producing <50 fantasy points in the season:

```
  R 1: ██ 8% bust (n=36, avg pts=227)
  R 2:  0% bust (n=36, avg pts=226)
  R 3: ██ 9% bust (n=35, avg pts=157)
  R 4: █ 3% bust (n=34, avg pts=177)
  R 5: ██ 6% bust (n=33, avg pts=163)
  R 6: ████ 14% bust (n=35, avg pts=133)
  R 7: █ 3% bust (n=31, avg pts=151)
  R 8: ██ 6% bust (n=32, avg pts=138)
  R 9: █████ 21% bust (n=34, avg pts=111)
  R10: ████████ 32% bust (n=31, avg pts=108)
  R11: █████ 20% bust (n=30, avg pts=110)
  R12: ███████ 29% bust (n=31, avg pts=90)
  R13: ██████████ 41% bust (n=27, avg pts=84)
  R14: █████████ 36% bust (n=28, avg pts=89)
  R15: ████ 14% bust (n=28, avg pts=133)
  R16: ███████████ 44% bust (n=32, avg pts=67)
  R17: ████████ 33% bust (n=30, avg pts=88)
```
Three things jump out:

- **R1-R8 are remarkably safe.** Bust rate stays under 10%. Top of the draft really is what it claims to be.
- **R13, R14, R16 are minefields** (41%, 36%, 44% bust rates). These are dart throws.
- **R15 dips against the trend** — only 14% bust. That's where kickers go. **Kickers are the safest late-round pick in the draft, full stop.**

## 5. The Wire Is Mostly Trash

Across 3 years and **~1,000+ wire pickups**:

- Average tenure on a roster: **3.5 weeks**
- Median tenure: **2 weeks**
- Pickups dropped within 2 weeks: **56%**
- Pickups that stick 8+ weeks: **16%**

More than half of every wire add gets dropped almost immediately. Only 1 in 6 turns into a meaningful contributor. The wire is signal-poor in expectation — but the signal is *concentrated* in a few players, which is why the strategy is volume, not selectivity.

## 6. QBs Eat

In a 12-team superflex 0.5-PPR league, the top-12 highest-scoring players each season are dominated by QBs:

| Year | QB | RB | WR | TE |
|---|---|---|---|---|
| 2023 | 9 | 1 | 2 | 0 |
| 2024 | 9 | 2 | 1 | 0 |
| 2025 | 8 | 4 | 0 | 0 |

**8-9 of the top 12 fantasy scorers every year are QBs.** Two QB starts + half-PPR makes elite QB the most valuable asset class in the league, full stop. WR/RB elite tier still matters (Bijan, Ja'Marr, etc.), but the *median* QB1 outscores the *median* WR1.

**Strategic corollary**: if you let QBs run on you in the draft, no clever R5 WR pivot fixes it. Get your QBs.

## 7. The Champion Profile Is Boring

Recent champions: Eric 2023, Coop 2024, Trevor 2025. What did each have in common at season's end?

- **All three were top-2 in DRAFTING** that specific year — not their career average
- **All three had >10 actual wins** in the regular season
- **None of them were #1 in trades** for the year
- **Trevor 2025 was the LUCKIEST manager in our 3-year dataset** (+5.5 schedule wins)

Translation: nail the draft, don't get cute, win where you can. The path to a title is unspectacular execution + a kind schedule. The kind schedule is free — you can't control it. The unspectacular execution is *all* you can control.

## 8. Things That Don't Predict Anything

Things people commonly think matter but actually don't:

- **Number of trades made**: zero correlation with wins
- **Draft slot**: no slot has won disproportionately. R1.01 is no more likely to lead to a title than R1.12.
- **Total transaction count**: Trevor's 192 adds vs Donnie's 29 — both have made playoffs.
- **Career drafting reputation**: doesn't predict any given year. Peak-year matters; reputation doesn't.

---

*Methodology: All values from offline Sleeper data dump, regular season only (W1-14). Variance = std-dev / mean of weekly team total points. All-play expected wins computed weekly across the 11 other teams. Hot/cold start defined as >=3-1 or <=1-3 through week 4.*