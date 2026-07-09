# Brian's 2026 MONEYLEAGUE Draft Helper

Single-page draft assistant. Open `index.html` in any browser — works offline.

## Live URL (after GitHub Pages enable)

`https://blackjakk.github.io/MONEYLEAGUE/draft_helper/`

## Features

- **Live click-as-they-go**: click a player to mark them drafted; auto-advances to the next pick
- **Brian-tuned**: slot 6, your 4 keepers (Loveland R8, Burden R9, Pierce R14, Watson R15) auto-placed
- **Smart recommendations**: top 3 picks for Brian based on positional need + VBD + age/rookie keeper-future bonus
- **Roster tracker**: live position counts vs targets (3 QB / 5 RB / 6 WR / 2 TE / 1 K / 1 DEF)
- **State persisted in URL hash** — refresh-safe, share-able mid-draft
- **Undo last pick** button for fat fingers
- **Search + position filter** on the player pool
- **Rookies tagged** (R badge), young players highlighted, FP-overlay ADP

## Updating projections

When projections change (Sleeper / FantasyPros refresh), rebuild the bundle:

```bash
python3 scripts/build_draft_helper_data.py
```

That regenerates `data.json` from the current state of `data/players_2026.csv`,
`data/keepers_2026.json`, `data/rankings_fantasypros.json`, and
`data/manager_tendencies.json`.

## Enabling GitHub Pages

In the repo settings → Pages → set source to `main` branch, `/docs` folder.
The URL above will be live within a minute.

## During the draft

1. Open the page on phone/tablet
2. Watch Sleeper for each pick that happens
3. Click that player in the player list — they're marked drafted
4. When it's your turn, the recommendations panel highlights your top 3
5. Click your chosen player → it's locked in, advances to next pick

If you misclick, hit "undo last".
