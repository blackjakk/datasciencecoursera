"""Overlay external superflex-aware rankings (FantasyPros consensus,
FantasyCalc trade values) onto the Sleeper-projection-based Player
objects.

Adds these fields when an overlay matches a player by name+position:
  fp_rank_overall    FantasyPros ECR (38-expert consensus)
  fp_rank_pos        FantasyPros position rank
  fp_tier            FantasyPros tier
  fp_adp_avg         FantasyPros average ADP
  fc_value           FantasyCalc trade value (0-10000, superflex 2QB)
  fc_overall_rank    FantasyCalc overall rank
  fc_position_rank   FantasyCalc position rank
  fc_trend_30day     FantasyCalc 30-day trend (positive = rising)

Also blends ranks: each player's `rank_overall` is replaced with a
weighted average of (sleeper-projection rank, FP rank, FC rank) when
all three are available. This gives the recommender a superflex-aware
ordering rather than the half-PPR-projection rank.
"""
from __future__ import annotations

import json
from pathlib import Path

from .players import Player


def _norm(name: str) -> str:
    return "".join(c.lower() for c in (name or "") if c.isalnum())


def overlay_rankings(
    players: list[Player],
    fp_path: str | Path = "data/rankings_fantasypros.json",
    fc_path: str | Path = "data/rankings_fantasycalc.json",
    blend_weights: tuple[float, float, float] = (0.3, 0.5, 0.2),
) -> dict:
    """Merge external rankings into the Player objects.

    blend_weights = (sleeper_projection_rank, fp_rank, fc_rank).
    Defaults emphasize FantasyPros' 38-expert consensus (the sharpest
    redraft signal we have access to), then projection, then FC trade
    value as a sanity check.

    Returns a stats dict: {fp_matched, fc_matched, blended}.
    """
    fp_path = Path(fp_path)
    fc_path = Path(fc_path)
    fp_data = json.loads(fp_path.read_text(encoding="utf-8")) if fp_path.exists() else {"players": []}
    fc_data = json.loads(fc_path.read_text(encoding="utf-8")) if fc_path.exists() else {"players": []}

    fp_by_key: dict[tuple[str, str], dict] = {}
    for r in fp_data["players"]:
        fp_by_key[(_norm(r["name"]), r["position"].upper())] = r

    fc_by_key: dict[tuple[str, str], dict] = {}
    for r in fc_data["players"]:
        fc_by_key[(_norm(r["name"]), r["position"].upper())] = r

    fp_matched = fc_matched = blended = 0
    for p in players:
        key = (_norm(p.name), p.position.upper())
        fp = fp_by_key.get(key)
        fc = fc_by_key.get(key)
        if fp:
            p.fp_rank_overall = fp.get("fp_rank_overall")
            p.fp_rank_pos = fp.get("fp_rank_pos")
            p.fp_tier = fp.get("fp_tier")
            p.fp_adp_avg = fp.get("fp_adp_avg")
            fp_matched += 1
        if fc:
            p.fc_value = fc.get("fc_value")
            p.fc_overall_rank = fc.get("fc_overall_rank")
            p.fc_position_rank = fc.get("fc_position_rank")
            p.fc_trend_30day = fc.get("fc_trend_30day")
            fc_matched += 1

        # Blended rank: weighted average across the three sources where
        # available. Drops sources with no signal so a player only in FP
        # still gets a clean blended rank.
        ranks = []
        if p.rank_overall and p.rank_overall < 999:
            ranks.append(("sleeper", p.rank_overall, blend_weights[0]))
        if fp and fp.get("fp_rank_overall"):
            ranks.append(("fp", fp["fp_rank_overall"], blend_weights[1]))
        if fc and fc.get("fc_overall_rank"):
            ranks.append(("fc", fc["fc_overall_rank"], blend_weights[2]))
        if ranks:
            tw = sum(w for _, _, w in ranks)
            p.rank_overall = round(sum(r * w for _, r, w in ranks) / tw)
            blended += 1

    return {
        "fp_matched": fp_matched,
        "fc_matched": fc_matched,
        "blended": blended,
        "fp_total": len(fp_data["players"]),
        "fc_total": len(fc_data["players"]),
    }
