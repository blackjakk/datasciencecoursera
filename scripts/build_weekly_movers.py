"""Summarize what moved since the last commit: ADP risers/fallers and
keeper-prediction changes. Written to data/WEEKLY_MOVERS.md so the weekly
refresh bot can use it as its commit body — turning "Weekly refresh: <date>"
into a readable briefing.

Compares the WORKING TREE against HEAD, so run it after the pipeline
refreshes data but before committing.
"""
from __future__ import annotations

import csv
import io
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "WEEKLY_MOVERS.md"

TOP_N = 8
MIN_ADP_SHIFT = 12       # picks (one full round)
RELEVANT_ADP = 220       # ignore movement in the undrafted tail


def _git_show(path: str) -> str | None:
    try:
        r = subprocess.run(["git", "show", f"HEAD:{path}"],
                           capture_output=True, text=True, cwd=ROOT)
        return r.stdout if r.returncode == 0 else None
    except OSError:
        return None


def _adp_map(csv_text: str) -> dict[str, float]:
    out = {}
    for row in csv.DictReader(io.StringIO(csv_text)):
        try:
            adp = float(row["adp"])
        except (KeyError, ValueError):
            continue
        if adp < 999:
            out[f'{row["name"]}|{row["position"]}'] = adp
    return out


def adp_movers() -> list[str]:
    old_text = _git_show("data/players_2026.csv")
    if old_text is None:
        return ["- ADP baseline unavailable (players csv not in HEAD)"]
    new_text = (ROOT / "data" / "players_2026.csv").read_text(encoding="utf-8")
    old, new = _adp_map(old_text), _adp_map(new_text)

    deltas = []
    for key, new_adp in new.items():
        old_adp = old.get(key)
        if old_adp is None or min(old_adp, new_adp) > RELEVANT_ADP:
            continue
        d = old_adp - new_adp  # positive = rising (earlier pick)
        if abs(d) >= MIN_ADP_SHIFT:
            name, pos = key.split("|")
            deltas.append((d, name, pos, old_adp, new_adp))
    if not deltas:
        return ["- No ADP moves of a round or more this week."]
    deltas.sort(key=lambda x: -abs(x[0]))
    lines = []
    for d, name, pos, o, n in deltas[:TOP_N]:
        arrow = "▲" if d > 0 else "▼"
        lines.append(f"- {arrow} {name} ({pos}): ADP {o:.0f} → {n:.0f} ({d:+.0f})")
    return lines


def keeper_changes() -> list[str]:
    old_text = _git_show("data/keepers_2026.json")
    if old_text is None:
        return []
    try:
        old = json.loads(old_text)
    except json.JSONDecodeError:
        return []
    new = json.loads((ROOT / "data" / "keepers_2026.json").read_text())

    def per_team(recs):
        m = {}
        for k in recs:
            if k.get("status") == "carryover":
                m.setdefault(k["roster_id"], set()).add(k["player_name"])
        return m

    o, n = per_team(old), per_team(new)
    lines = []
    for rid in sorted(set(o) | set(n)):
        added = n.get(rid, set()) - o.get(rid, set())
        dropped = o.get(rid, set()) - n.get(rid, set())
        if added or dropped:
            bits = []
            if added:
                bits.append("now keeps " + ", ".join(sorted(added)))
            if dropped:
                bits.append("no longer " + ", ".join(sorted(dropped)))
            lines.append(f"- roster {rid}: " + "; ".join(bits))
    return (["", "Keeper prediction changes:"] + lines) if lines else []


def main() -> None:
    lines = ["ADP movers (FantasyPros/Sleeper blend, ≥1 round):"]
    lines += adp_movers()
    lines += keeper_changes()
    body = "\n".join(lines) + "\n"
    OUT.write_text(body, encoding="utf-8")
    print(body)
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
