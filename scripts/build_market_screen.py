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
    for pl in players:
        if pl.adp > MAX_ADP:          # spec: exclude ADP>180 (room's price)
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


def compute_room_sheet(top_n: int = TOP_N) -> dict:
    """THE SHEET THE ROOM BRINGS — this league drafts live, in person, and
    rivals typically print popular (Reddit-circulated) rankings, which are
    overwhelmingly STANDARD 1QB lists. Compare FantasyPros 1QB consensus
    (their sheet) against superflex consensus (this league's truth):

        sheet_gap = rank_1qb - rank_superflex

      gap > 0 → their sheet BURIES him (QBs, mostly) → he slides to you
      gap < 0 → their sheet INFLATES him → the room reaches, let them
    """
    sf = json.loads(FP_PATH.read_text(encoding="utf-8"))
    q1 = json.loads(FP_1QB_PATH.read_text(encoding="utf-8"))
    q1_by_key = {(_norm(p["name"]), p["position"].upper()): p
                 for p in q1.get("players", [])
                 if p.get("fp_rank_overall") is not None}
    rows = []
    for p in sf.get("players", []):
        r_sf = p.get("fp_rank_overall")
        if r_sf is None or r_sf > 150:
            continue
        o = q1_by_key.get((_norm(p["name"]), p["position"].upper()))
        if o is None:
            continue
        gap = o["fp_rank_overall"] - r_sf
        rows.append({
            "name": p["name"], "position": p["position"],
            "team": p.get("team", ""),
            "rank_sf": r_sf, "round_sf": _round_of(r_sf),
            "rank_1qb": o["fp_rank_overall"],
            "round_1qb": _round_of(o["fp_rank_overall"]),
            "sheet_gap": gap,
            "read": (f"their sheet says R{_round_of(o['fp_rank_overall'])} · "
                     f"superflex truth R{_round_of(r_sf)}"),
        })
    qb_gaps = [r["sheet_gap"] for r in rows if r["position"] == "QB"]
    return {
        "meta": {
            "generated": date.today().isoformat(),
            "sf_source": f"FP OP consensus ({sf.get('total_experts', '?')} experts)",
            "q1_source": f"FP standard 1QB consensus ({q1.get('total_experts', '?')} experts)",
            "players_compared": len(rows),
            "qb_avg_discount_ranks": (round(sum(qb_gaps) / len(qb_gaps), 1)
                                      if qb_gaps else None),
            "qb_count": len(qb_gaps),
        },
        "sheet_buries": sorted((r for r in rows if r["sheet_gap"] > 0),
                               key=lambda r: -r["sheet_gap"])[:top_n],
        "sheet_inflates": sorted((r for r in rows if r["sheet_gap"] < 0),
                                 key=lambda r: r["sheet_gap"])[:top_n],
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
        sheet = compute_room_sheet()
        disc = sheet["meta"]["qb_avg_discount_ranks"]
        lines += ["", "THE SHEET THE ROOM BRINGS (in-person draft; rivals "
                      "print 1QB rankings):"]
        if disc is not None:
            lines.append(f"- QBs sit {disc:+.0f} ranks deeper on their sheet "
                         f"than superflex truth (avg, {sheet['meta']['qb_count']} QBs)")
        for e in sheet["sheet_buries"][:3]:
            lines.append(f"- {e['name']} ({e['position']}): {e['read']} "
                         f"({e['sheet_gap']:+d} ranks)")
    except FileNotFoundError:
        pass  # 1QB consensus not fetched yet — screen still valid
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


def _sheet_table(entries: list[dict], gap_cls: str) -> str:
    head = ("<tr><th>Asset</th><th>Pos</th>"
            '<th class="ml-num">Superflex truth</th>'
            '<th class="ml-num">Their sheet</th>'
            '<th class="ml-num">Gap</th></tr>')
    body = []
    for e in entries:
        body.append(
            "<tr>"
            f'<td>{html.escape(e["name"])} '
            f'<span class="ml-note">{html.escape(e["team"] or "FA")}</span></td>'
            f"<td>{_badge(e['position'])}</td>"
            f'<td class="ml-num">#{e["rank_sf"]} · R{e["round_sf"]}</td>'
            f'<td class="ml-num">#{e["rank_1qb"]} · R{e["round_1qb"]}</td>'
            f'<td class="ml-num {gap_cls}">{e["sheet_gap"]:+d}</td>'
            "</tr>")
    return ('<table class="ml-table ml-table--compact">'
            f"<thead>{head}</thead><tbody>{''.join(body)}</tbody></table>")


def build_sheet_block() -> str:
    try:
        sheet = compute_room_sheet(top_n=10)
    except FileNotFoundError:
        return ""
    m = sheet["meta"]
    disc = m["qb_avg_discount_ranks"]
    disc_line = (f"QBs sit an average of <strong>{disc:+.0f} ranks</strong> "
                 f"deeper on their sheet than superflex truth "
                 f"({m['qb_count']} QBs compared)." if disc is not None else "")
    return "\n".join([
        '<div class="ml-h-label">The sheet the room brings '
        "(in-person draft · popular 1QB rankings)</div>",
        f"<p>{disc_line}</p>",
        '<div class="ml-h-label">Their sheet buries — he slides to you</div>',
        _sheet_table(sheet["sheet_buries"], "ml-sv-hi"),
        '<div class="ml-h-label">Their sheet inflates — let them reach</div>',
        _sheet_table(sheet["sheet_inflates"], "ml-sv-lo"),
        '<p class="ml-fineprint">MONEYLEAGUE drafts live and in person; '
        "rivals typically bring popular (Reddit-circulated) printed "
        "rankings, which are standard 1QB lists. Gap = the player's rank "
        "on the 1QB consensus minus his superflex rank — the pull their "
        "reference material exerts. Tempered in practice: three seasons of "
        "history show this room DOES draft QBs early, so treat the top of "
        f"the QB board as efficient and hunt the middle. Sources: "
        f"{html.escape(m['sf_source'])} vs {html.escape(m['q1_source'])}.</p>",
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
        build_sheet_block(),
        '<p class="ml-fineprint">How to read: the room drafts on Sleeper, '
        "so Sleeper superflex ADP is the price MONEYLEAGUE actually pays; "
        "FantasyPros is what the experts say the asset is worth. When the "
        "experts are higher (positive gap, in picks), that’s your "
        "window — the room will let the asset fall to you. When the "
        "room is higher, let someone else pay the reach. "
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
