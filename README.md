# MONEYLEAGUE Analytics

Fantasy football analytics for a 12-team superflex 0.5-PPR keeper league
(Yahoo 2011-2022 → Sleeper 2023-). Everything rebuilds from one command:

```bash
pip install -r requirements.txt
scripts/refresh_all.sh          # fetch -> derive -> sim -> reports -> verify
```

**Start here: [docs/PIPELINE.md](docs/PIPELINE.md)** — pipeline diagram,
per-script reference, year-rollover guide, troubleshooting.

## Artifacts

| Output | What it is |
|---|---|
| `data/MONEYLEAGUE_2026_PRESEASON.pdf` | Preseason GUAP power rankings (assets + skill) |
| `data/MONEYLEAGUE_2026_MOCK.pdf` | Simulated 2026 draft: board, Monte Carlo, steals/reaches |
| `data/MONEYLEAGUE_POWER_RANKINGS.pdf` | 15-year all-time league analysis |
| `docs/draft_helper/` | Live draft assistant (GO LIVE auto-syncs from the Sleeper draft API) |

A GitHub Actions workflow refreshes everything weekly (Tuesdays) and is
gated by `scripts/verify_outputs.py` — 22 invariant checks that block any
push of broken artifacts.

*(Historical note: this repo began as a Coursera data science class repo;
the fantasy football project took over master in July 2026. The
`gridiron-chain` game lives on its own branch and shares the GitHub Pages
deployment.)*
