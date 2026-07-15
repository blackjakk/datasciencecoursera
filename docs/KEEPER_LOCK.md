# KEEPER LOCK — runbook (August 2026)

Five-minute, mistake-proof procedure for turning the league's real keeper
declarations into `data/keepers_2026_actual.json`, the file the whole
pipeline regrades from. The derive stage (`scripts/refresh_all.sh`,
`do_derive`) copies it over `data/keepers_2026.json` whenever it exists,
so every downstream consumer works unchanged.

## The 5 steps

1. **Copy the template**

   ```bash
   cp data/keepers_2026_actual.TEMPLATE.json data/keepers_2026_actual.json
   ```

2. **Fill it in** — one entry per ACTUAL declared keeper, league-wide
   (all 12 teams, not just Brian's). Delete the placeholder entries.
   Only three fields are required per entry:

   | field | meaning |
   |---|---|
   | `player_name` | full name (Sleeper spelling; suffixes/punctuation forgiven) |
   | `roster_id` | 1–12, same ids as `data/keepers_2026.json` |
   | `prior_round` | the round the player cost in 2025; **waiver/undrafted pickup = 17** |

   Optional overrides when the predicted file is wrong: `years_kept`
   (years kept BEFORE 2026), `position` (only needed to disambiguate two
   players with the same name), `is_waiver`. Everything else
   (forfeit_round, effective seat, adp, vbd fields) is derived.

3. **Validate**

   ```bash
   python3 scripts/lock_keepers.py data/keepers_2026_actual.json
   ```

   Prints a per-team summary (manager, keepers, seats, bumps) and an
   OK/FAIL verdict listing every violation. On OK it rewrites
   `data/keepers_2026_actual.json` schema-complete (`status="carryover"`).
   Add `--dry-run` to validate without writing anything. Exit code 0
   only on OK, so it's safe to chain: `... && scripts/refresh_all.sh …`.

4. **Refresh the pipeline**

   ```bash
   scripts/refresh_all.sh derive sim reports verify
   ```

5. **Read the regraded verdicts** (all automatic once step 4 runs):

   - **Stack Screen XI** (`scripts/build_keeper_stack_screen.py`, in the
     Research Desk + weekly movers briefing) — title watch, war chest
     ranks, and the 2027 expiry board regrade on real declarations.
   - **Taxed keeper optimizer** — `python3 scripts/optimize_my_keepers.py`
     re-ranks Brian's keeper sets against the room's now-known keeps.
   - **Research Desk** — `data/MONEYLEAGUE_RESEARCH_DESK.pdf` (market
     screen reach%, pick squeeze, keeper sensitivity all rebuild).
   - **Draft helper** — run the `helper` stage too if the draft board at
     https://blackjakk.github.io/MONEYLEAGUE/draft_helper/ should show
     locked keepers before the next weekly workflow syncs it.

## Rules the validator enforces (user-confirmed — it will not bend)

- Cost escalates **2 rounds/yr**: `forfeit_round = prior_round − 2`.
- **3-year cap**: `years_kept` counts years before 2026, so
  `years_kept ≥ 3` is INELIGIBLE (e.g. Jordan Love — he re-enters the
  draft pool, do not list him).
- **R1/R2 forfeits ineligible**: `forfeit_round < 3` is an error (so
  `prior_round ≤ 4` can never be kept).
- **Seat ownership + bump-up house rule**: the seat must be a round the
  team actually OWNS in the 2026 schedule (trades applied, from
  `docs/draft_helper/data.json`). If the exact round is consumed by
  another of that team's keepers or was traded away, the keeper seats at
  the next EARLIER owned free round (never earlier than R3). A keeper is
  only impossible if no earlier owned round is free — the cost of a
  missing seat is the BUMP TAX, not the keeper.
- **Max 4 keepers per team**; no player declared twice; K/DEF ineligible.

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `'X': not found in players_nfl.json. Closest names: …` | name typo / non-Sleeper spelling | use one of the three suggested names |
| `INELIGIBLE — years_kept=3 hits the 3-year cap` | player at the cap (clock follows the player, even through trades) | remove the entry — the league can't keep them; if the count is wrong, set `years_kept` explicitly (then check the xlsx: user corrections have found real data bugs) |
| `INELIGIBLE — forfeit round R2 … R1/R2 forfeits are not allowed` | `prior_round` ≤ 4 | if the round is right, the keep is illegal — remove it; if wrong, fix `prior_round` |
| `BUMP-UP — R13 taken by another keeper; seated at R12` (warning) | two keepers priced into one owned pick, or the round was traded away | expected behavior — verify the seat matches what the league office rules; no action needed |
| `IMPOSSIBLE SEAT — no owned free round at R… or earlier` | team traded away the cheap rounds and stacked keepers | the declaration is invalid as entered; re-check who really owns the picks |
| `prior_round N differs from predicted file (M) — using YOUR value` (warning) | your entry disagrees with the model's draft history | your value wins; if unsure, check `data/historical/MONEY_LEAGUE.xlsx` — the xlsx is the source of truth |
| `ambiguous — … add a "position" field` | two NFL players share the name | add `"position": "WR"` (etc.) to the entry |
| results look stale after OK | forgot step 4 | run `scripts/refresh_all.sh derive sim reports verify` |

Notes: vbd/adp fields for a surprise keep that isn't in the predicted
file are written as `null` (downstream tolerates it; derive's rebuild
order copies the actual file AFTER the predictor runs, so predictions
never overwrite it). Never hand-edit `data/keepers_2026.json` directly —
it is regenerated every derive run; the actual file is the override.
