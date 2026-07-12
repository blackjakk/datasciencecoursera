"""R3 — Market Inefficiency Screen: where the room's price diverges from
the experts' price.

The room drafts on Sleeper, so Sleeper's superflex ADP (adp_2qb) IS the
price MONEYLEAGUE actually pays. FantasyPros' superflex (OP) half-PPR
consensus is what 59 experts think the asset is worth. Both live on the
same overall-pick scale, so:

    gap = sleeper_adp - fp_consensus_pick

  gap > 0  → the room is LATE  (experts higher → your value window)
  gap < 0  → the room is EARLY (the room reaches → let them pay it)

Pipeline position: research layer. No network — on-disk caches only.
  Inputs:
    - data/sleeper_projections_2026.json  (raw Sleeper feed; same cache
      scripts/build_players_csv.py reads, parsed with the same code —
      fantasy_draft.projections with scoring="superflex" → adp_2qb)
    - data/rankings_fantasypros.json      (scripts/fetch_fantasypros.py)
  Outputs:
    - data/research/market_screen.json    (findings, machine-readable)
    - data/research/market_screen.html    (one <section> fragment,
      ml.css classes only — consumed by build_research_desk.py)

Also imported by scripts/build_weekly_movers.py (summary_lines) so the
weekly MARKET REPORT and the research desk share one computation.
"""
from __future__ import annotations

import html
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fantasy_draft.projections import load_projections_from_cache  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SLEEPER_CACHE = ROOT / "data" / "sleeper_projections_2026.json"
FP_PATH = ROOT / "data" / "rankings_fantasypros.json"
FP_1QB_PATH = ROOT / "data" / "rankings_fantasypros_1qb.json"
OUT_DIR = ROOT / "data" / "research"

TEAMS = 12               # league size → 12 picks per round
MAX_ADP = 180            # ignore the undrafted tail (spec: exclude ADP>180)
TOP_N = 12               # divergences reported per direction

# FP's OP (superflex) consensus covers QB/RB/WR/TE only — K/DEF cannot be
# screened and are excluded by construction.
_SUFFIX = re.compile(r"\s+(jr|sr|ii|iii|iv|v)$")


def _norm(s: str) -> str:
    """Name key, same shape as build_draft_helper_data._norm plus suffix
    stripping (FP says 'Marvin Harrison Jr.', Sleeper says 'Marvin
    Harrison' — 19 of the top-180 differ only by suffix)."""
    s = s.lower().replace(".", "").replace("'", "").replace("-", " ").strip()
    return _SUFFIX.sub("", s)


def _round_of(pick: float) -> int:
    return int((max(pick, 1.0) - 1) // TEAMS) + 1


def _round_label(pick: float) -> str:
    """Overall pick → 'R3.04' (round + pick-within-round)."""
    p = max(pick, 1.0)
    return f"R{_round_of(p)}.{int((p - 1) % TEAMS) + 1:02d}"


def _read_phrase(entry: dict) -> str:
    fr, sr = entry["fp_round"], entry["sleeper_round"]
    if entry["gap"] > 0:
        return f"experts see R{fr} · the room pays R{sr}"
    return f"the room pays R{sr} · experts see R{fr}"


def _kept_names() -> set[str]:
    """Names off the board before pick 1: every carryover keeper league-wide
    (Christian Watson is Brian's keeper — he slides to nobody)."""
    try:
        keepers = json.loads((ROOT / "data" / "keepers_2026.json")
                             .read_text(encoding="utf-8"))
    except FileNotFoundError:
        return set()
    return {_norm(k["player_name"]) for k in keepers
            if k.get("status") == "carryover"}


def compute_screen(top_n: int = TOP_N) -> dict:
    """The single source of truth for the screen. Returns
    {meta, room_late, room_early} with entries sorted by |gap| desc."""
    players = load_projections_from_cache(SLEEPER_CACHE, scoring="superflex")
    fp = json.loads(FP_PATH.read_text(encoding="utf-8"))
    fp_by_key: dict[tuple[str, str], dict] = {}
    for p in fp.get("players", []):
        if p.get("fp_rank_overall") is None:
            continue  # spec: exclude fp_rank missing
        fp_by_key.setdefault((_norm(p["name"]), p["position"].upper()), p)

    screened, rows = 0, []
    kept = _kept_names()
    for pl in players:
        if pl.adp > MAX_ADP:          # spec: exclude ADP>180 (room's price)
            continue
        if _norm(pl.name) in kept:    # kept players never reach the board
            continue
        f = fp_by_key.get((_norm(pl.name), pl.position.upper()))
        if f is None:
            continue
        try:  # consensus pick: average expert rank, already pick-scale
            fp_pick = float(f.get("fp_adp_avg") or f["fp_rank_overall"])
        except (TypeError, ValueError):
            fp_pick = float(f["fp_rank_overall"])
        screened += 1
        gap = round(pl.adp - fp_pick, 1)
        rows.append({
            "name": pl.name,
            "position": pl.position,
            "team": pl.team,
            "sleeper_adp": round(pl.adp, 1),
            "sleeper_round": _round_of(pl.adp),
            "sleeper_slot": _round_label(pl.adp),
            "fp_pick": round(fp_pick, 1),
            "fp_rank": f["fp_rank_overall"],
            "fp_round": _round_of(fp_pick),
            "fp_slot": _round_label(fp_pick),
            "gap": gap,
            "gap_rounds": round(gap / TEAMS, 1),
        })
    for r in rows:
        r["read"] = _read_phrase(r)

    late = sorted((r for r in rows if r["gap"] > 0), key=lambda r: -r["gap"])
    early = sorted((r for r in rows if r["gap"] < 0), key=lambda r: r["gap"])
    return {
        "meta": {
            "generated": date.today().isoformat(),
            "sleeper_source": "adp_2qb (superflex), data/sleeper_projections_2026.json",
            "fp_source": (f"FantasyPros OP half-PPR consensus, "
                          f"{fp.get('total_experts', '?')} experts, "
                          f"updated {fp.get('last_updated', '?')}"),
            "players_screened": screened,
            "max_adp": MAX_ADP,
            "teams": TEAMS,
            "convention": "gap = sleeper_adp - fp_consensus_pick; "
                          ">0 room late (value), <0 room early (avoid)",
        },
        "room_late": late[:top_n],
        "room_early": early[:top_n],
    }


def compute_model_vs_paper(top_n: int = TOP_N) -> dict:
    """MODEL vs THE ROOM'S PAPER — this league drafts live, in person, and
    rivals bring popular printed rankings in SUPERFLEX/2QB form (they're
    not bringing 1QB sheets). So the room's paper is, to first order, the
    FantasyPros OP consensus itself. The exploitable edge is therefore
    where OUR league-specific model (superflex VBD board) disagrees with
    the paper everyone else is holding:

        gap = fp_rank - model_rank

      gap > 0 → the sheets sleep on him (our board is higher) → he
                slides past the room to you
      gap < 0 → the sheets love him more than our model does → let the
                room pay the paper price
    """
    helper = json.loads((ROOT / "docs" / "draft_helper" / "data.json")
                        .read_text(encoding="utf-8"))
    kept = _kept_names()
    board = [(pl["name"], pl["pos"], pl["vbd"]) for pl in helper["players"]
             if pl.get("pos") not in ("K", "DEF", "DST")
             and pl.get("vbd") is not None]
    board.sort(key=lambda t: -t[2])
    model_rank = {(_norm(n), pos.upper()): i + 1
                  for i, (n, pos, _) in enumerate(board)}

    fp = json.loads(FP_PATH.read_text(encoding="utf-8"))
    rows = []
    for p in fp.get("players", []):
        r_fp = p.get("fp_rank_overall")
        if r_fp is None or r_fp > 150:
            continue
        key = (_norm(p["name"]), p["position"].upper())
        if key[0] in kept:
            continue  # keepers never reach the board — no edge to trade on
        r_model = model_rank.get(key)
        if r_model is None or r_model > 200:
            continue
        gap = r_fp - r_model
        rows.append({
            "name": p["name"], "position": p["position"],
            "team": p.get("team", ""),
            "model_rank": r_model, "model_round": _round_of(r_model),
            "fp_rank": r_fp, "fp_round": _round_of(r_fp),
            "gap": gap,
            "read": (f"our board R{_round_of(r_model)} · "
                     f"their paper R{_round_of(r_fp)}"),
        })
    return {
        "meta": {
            "generated": date.today().isoformat(),
            "model_source": "helper data.json superflex VBD board (K/DEF excluded)",
            "paper_source": (f"FP OP consensus ({fp.get('total_experts', '?')} "
                             "experts) — the room brings superflex paper"),
            "players_compared": len(rows),
        },
        "sheets_sleep": sorted((r for r in rows if r["gap"] > 0),
                               key=lambda r: -r["gap"])[:top_n],
        "sheets_love": sorted((r for r in rows if r["gap"] < 0),
                              key=lambda r: r["gap"])[:top_n],
    }


def summary_lines(result: dict | None = None, top_n: int = 5) -> list[str]:
    """Compact text section for the weekly MARKET REPORT
    (build_weekly_movers.py). Same computation, print-tape voice."""
    if result is None:
        result = compute_screen()
    meta = result["meta"]
    lines = ["", "INEFFICIENCY SCREEN (Sleeper room price vs FantasyPros "
                 f"consensus, {meta['players_screened']} assets)"]

    def block(title, entries):
        out = [title]
        if not entries:
            out.append("- none — the room and the experts are aligned.")
            return out
        for e in entries[:top_n]:
            out.append(
                f"- {e['name']} ({e['position']}): {e['read']} "
                f"(FP {e['fp_pick']:.0f} vs ADP {e['sleeper_adp']:.0f}, "
                f"{e['gap']:+.0f} picks)")
        return out

    lines += block("UNDERPRICED — the room is late (your window):",
                   result["room_late"])
    lines += [""]
    lines += block("OVERPRICED — the room is early (let them reach):",
                   result["room_early"])
    try:
        mvp = compute_model_vs_paper()
        lines += ["", "MODEL vs THE ROOM'S PAPER (rivals bring superflex "
                      "consensus — edge = where our board disagrees):"]
        for e in mvp["sheets_sleep"][:3]:
            lines.append(f"- {e['name']} ({e['position']}): {e['read']} "
                         f"(+{e['gap']} ranks, slides to you)")
        for e in mvp["sheets_love"][:2]:
            lines.append(f"- {e['name']} ({e['position']}): {e['read']} "
                         f"({e['gap']} ranks, let them pay it)")
    except FileNotFoundError:
        pass  # players csv missing — screen still valid
    return lines


# ---------------------------------------------------------------- fragment
def _badge(pos: str) -> str:
    return (f'<span class="ml-badge ml-badge--{pos.lower()}">'
            f'{html.escape(pos)}</span>')


def _table(entries: list[dict], gap_cls: str) -> str:
    head = ("<tr><th>Asset</th><th>Pos</th>"
            '<th class="ml-num">Experts</th><th class="ml-num">The room</th>'
            '<th class="ml-num">Gap</th></tr>')
    body = []
    for e in entries:
        nm = html.escape(e["name"])
        tm = html.escape(e["team"] or "FA")
        body.append(
            "<tr>"
            f'<td>{nm} <span class="ml-note">{tm}</span></td>'
            f"<td>{_badge(e['position'])}</td>"
            f'<td class="ml-num">{e["fp_pick"]:.0f} · {e["fp_slot"]}</td>'
            f'<td class="ml-num">{e["sleeper_adp"]:.0f} · {e["sleeper_slot"]}</td>'
            f'<td class="ml-num {gap_cls}">{e["gap"]:+.0f}</td>'
            "</tr>")
    if not body:
        body = ['<tr><td colspan="5" class="ml-empty">No divergences '
                "here — the room and the experts are aligned.</td></tr>"]
    return ('<table class="ml-table ml-table--compact">'
            f"<thead>{head}</thead><tbody>{''.join(body)}</tbody></table>")


def _mvp_table(entries: list[dict], gap_cls: str) -> str:
    head = ("<tr><th>Asset</th><th>Pos</th>"
            '<th class="ml-num">Our board</th>'
            '<th class="ml-num">Their paper</th>'
            '<th class="ml-num">Gap</th></tr>')
    body = []
    for e in entries:
        body.append(
            "<tr>"
            f'<td>{html.escape(e["name"])} '
            f'<span class="ml-note">{html.escape(e["team"] or "FA")}</span></td>'
            f"<td>{_badge(e['position'])}</td>"
            f'<td class="ml-num">#{e["model_rank"]} · R{e["model_round"]}</td>'
            f'<td class="ml-num">#{e["fp_rank"]} · R{e["fp_round"]}</td>'
            f'<td class="ml-num {gap_cls}">{e["gap"]:+d}</td>'
            "</tr>")
    if not body:
        body = ['<tr><td colspan="5" class="ml-empty">Our board and the '
                "paper agree — no edges here.</td></tr>"]
    return ('<table class="ml-table ml-table--compact">'
            f"<thead>{head}</thead><tbody>{''.join(body)}</tbody></table>")


def build_model_block() -> str:
    """MODEL vs THE ROOM'S PAPER — the headline block. The room brings
    superflex consensus paper (user-confirmed), so the edge is where OUR
    board disagrees with it."""
    try:
        mvp = compute_model_vs_paper(top_n=10)
    except FileNotFoundError:
        return ""
    m = mvp["meta"]
    return "\n".join([
        '<div class="ml-h-label">Model vs the room\u2019s paper '
        "(they bring superflex consensus \u2014 this is the real edge)</div>",
        '<div class="ml-h-label">The sheets sleep on \u2014 slides to you</div>',
        _mvp_table(mvp["sheets_sleep"], "ml-sv-hi"),
        '<div class="ml-h-label">The sheets love \u2014 let them pay the paper price</div>',
        _mvp_table(mvp["sheets_love"], "ml-sv-lo"),
        '<p class="ml-fineprint">This league drafts live and in person, and '
        "rivals bring printed superflex/2QB rankings \u2014 assume every seat "
        "sees what FantasyPros sees. The exploitable edge is therefore where "
        "our league-specific board (superflex VBD + keeper context) departs "
        "from that consensus: positive gap = the paper ranks him later than "
        "we do, so he should reach your pick; negative gap = the paper is "
        f"higher than our board, so someone else will pay it. Sources: "
        f"{html.escape(m['model_source'])} vs {html.escape(m['paper_source'])}; "
        f"{m['players_compared']} players compared.</p>",
    ]) + "\n"


def build_fragment(result: dict) -> str:
    meta = result["meta"]
    late, early = result["room_late"], result["room_early"]
    hero_late = (f"{late[0]['name']}: {late[0]['read']}" if late
                 else "the room and the experts are aligned")
    parts = [
        '<section class="ml-panel" id="market-screen">',
        "<h2>Market Inefficiency Screen</h2>",
        f'<p class="ml-serial">SLEEPER ADP_2QB vs FANTASYPROS OP CONSENSUS '
        f'· {meta["players_screened"]} ASSETS · '
        f'{html.escape(meta["generated"])}</p>',
        f"<p>Top of the tape — {html.escape(hero_late)}.</p>",
        '<div class="ml-h-label">Underpriced — the room is late '
        "(your value window)</div>",
        _table(late, "ml-sv-hi"),
        '<div class="ml-h-label">Overpriced — the room is early '
        "(let them reach)</div>",
        _table(early, "ml-sv-lo"),
        build_model_block(),
        '<p class="ml-fineprint">How to read: the room drafts on Sleeper, '
        "so Sleeper superflex ADP is the price MONEYLEAGUE actually pays; "
        "FantasyPros is what the experts say the asset is worth. When the "
        "experts are higher (positive gap, in picks), that’s your "
        "window ONLY if that seat drafts off online ADP — in THIS room, "
        "everyone reads the paper, so treat these gaps as market context, "
        "not guaranteed slides (the model-vs-paper block above is the real edge). "
        f"Sources: {html.escape(meta['fp_source'])}; Sleeper adp_2qb, "
        f"assets priced inside pick {meta['max_adp']} only (K/DEF not "
        "covered by the consensus). Consensus disagreement, injuries and "
        "keeper withdrawals can all masquerade as inefficiency — "
        "check the disclosures before trading on this page.</p>",
        "</section>",
    ]
    return "\n".join(parts) + "\n"


def main() -> None:
    result = compute_screen()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    jpath = OUT_DIR / "market_screen.json"
    hpath = OUT_DIR / "market_screen.html"
    jpath.write_text(json.dumps(result, indent=2), encoding="utf-8")
    hpath.write_text(build_fragment(result), encoding="utf-8")

    meta = result["meta"]
    print(f"[market_screen] screened {meta['players_screened']} assets "
          f"(ADP ≤ {meta['max_adp']}, FP-ranked)")
    for label, key in (("room late ", "room_late"),
                       ("room early", "room_early")):
        top = result[key][0] if result[key] else None
        if top:
            print(f"  #1 {label}: {top['name']} ({top['position']}) "
                  f"{top['gap']:+.0f} picks — {top['read']}")
    print(f"  Wrote {jpath.relative_to(ROOT)} and {hpath.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
