"""Brian's Round-by-Round Menu — one-page draft cheat sheet.

For each of Brian's 13 live picks (keepers occupy R8/R9/R14/R15), shows:
  - the sim's most-frequent call at that slot (from 300-sim Monte Carlo)
  - the realistic menu: top-VBD players likely to be available, with
    P(available at THIS pick) from the survival quantiles
  - one "if he falls" long shot worth watching

Output: data/MONEYLEAGUE_2026_ROUND_MENU.pdf (landscape letter, 1 page).
"""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from design.tokens import PALETTE, POS_COLORS, report_base_css  # noqa: E402
from scripts import build_power_rankings as bpr  # noqa: E402  (CHROMIUM_EXEC)

ROOT = Path(__file__).resolve().parent.parent
HELPER_DATA = ROOT / "docs" / "draft_helper" / "data.json"
MC = ROOT / "data" / "mc_summary_all.json"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_2026_ROUND_MENU.pdf"


def survival_at(svq: list[int] | None, overall: int) -> float:
    """P(available at pick `overall`) from draft-position quantiles."""
    if not svq:
        return 1.0
    if overall <= svq[0]:
        return 1.0
    if overall > svq[10]:
        return 0.0
    for i in range(1, 11):
        if overall <= svq[i]:
            span = (svq[i] - svq[i - 1]) or 1
            f = (i - 1 + (overall - svq[i - 1]) / span) / 10
            return max(0.0, min(1.0, 1 - f))
    return 0.0


def main():
    data = json.loads(HELPER_DATA.read_text())
    mc = json.loads(MC.read_text())
    my_ti = data["my_team_idx"]
    players = data["players"]

    # Brian's live picks: his schedule slots minus keeper-consumed rounds.
    keeper_rounds = set()
    for k in data["keepers"]:
        if k["roster_id"] == 9:
            keeper_rounds.add(k.get("effective_forfeit_round") or k["forfeit_round"])
    my_picks = [s for s in data["schedule"]
                if s["team_idx"] == my_ti and s["round"] not in keeper_rounds]

    # Sim's modal call per round for Brian.
    rep = {r["round"]: r for r in
           mc["per_team"][str(my_ti)].get("representative_roster", [])}

    # Positional deadlines: median pick by which the Nth-best player at each
    # position is GONE (last of the top-N to leave, median across sims).
    # Players kept in most scenarios have median 0 and rank among the top-N
    # as "gone from the start" — correct for deadline purposes.
    survival = mc.get("survival", {})
    my_overalls = {pk["overall"]: pk["round"] for pk in my_picks}
    deadlines = []
    for pos, marks in [("QB", [6, 12, 18, 24]), ("RB", [6, 12, 24]),
                       ("WR", [12, 24, 36]), ("TE", [3, 6])]:
        ranked = sorted(
            (p for p in players if p["pos"] == pos and p["vbd"] > -60),
            key=lambda p: -p["vbd"])
        chips = []
        for m in marks:
            if m > len(ranked):
                continue
            medians = [survival.get(p["name"], [999]*11)[5] for p in ranked[:m]]
            gone = max(md for md in medians if md < 900) if any(md < 900 for md in medians) else None
            if gone is None or gone < 1:
                continue
            rnd = (gone - 1) // 12 + 1
            # Flag when the deadline lands near one of Brian's picks
            near = next((f" ≈ your R{r}" for o, r in my_overalls.items()
                         if abs(o - gone) <= 6), "")
            chips.append((f"{pos}{m}", gone, rnd, near))
        deadlines.append((pos, chips))

    cards = []
    for pk in my_picks:
        overall, rnd = pk["overall"], pk["round"]
        avail = []
        for p in players:
            if p["pos"] in ("K", "DEF") and rnd < 15:
                continue
            if p["pos"] not in ("K", "DEF") and rnd >= 16:
                continue
            sv = survival_at(p.get("svq"), overall)
            if sv >= 0.25 and p["vbd"] > -40:
                avail.append((p, sv))
        avail.sort(key=lambda t: -(t[0]["vbd"]))
        menu = avail[:5]

        # Long shot: best-VBD player with 5-25% survival (the faller to watch)
        shots = [(p, survival_at(p.get("svq"), overall)) for p in players
                 if p["pos"] not in ("K", "DEF")]
        shots = [(p, s) for p, s in shots if 0.05 <= s < 0.25]
        shots.sort(key=lambda t: -t[0]["vbd"])
        long_shot = shots[0] if shots and rnd < 15 else None

        sim_call = rep.get(rnd)
        keep = f"keep '27 @ R{rnd-2}" if rnd > 2 else "no keeper value"
        cards.append((pk, menu, long_shot, sim_call, keep))

    # ---------- HTML ----------
    # Page-specific rules only; palette + components (ml-card, ml-table,
    # ml-banner, ml-sv-*, ml-urgent) come from report_base_css()/ml.css.
    h = ['<html data-theme="light"><head><meta charset="utf-8"><style>'
         + report_base_css() + """
    * { box-sizing: border-box; margin: 0; }
    body { font-size: 8pt; line-height: 1.2; padding: 14px 18px; }
    h1 { font-size: 21pt; letter-spacing: 1px; }
    .sub { color: var(--ml-muted); font-size: 8pt; margin: 2px 0 8px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
    .ml-card { padding: 3px 6px; }
    .ml-card h2 { font-size: 11.5pt; display: flex; justify-content: space-between; align-items: baseline; }
    .ml-card h2 .keep { font-family: var(--ml-font-body); font-size: 6.5pt; color: var(--ml-muted); font-weight: 400; }
    .sim { font-size: 7pt; color: var(--ml-info); margin: 1px 0 3px; }
    .pos { font-weight: 700; width: 22px; }
    .vbd { text-align: right; color: var(--ml-muted); width: 28px; }
    .sv { text-align: right; font-weight: 700; width: 30px; }
    .shot { font-size: 7pt; color: var(--ml-warn); margin-top: 2px; font-style: italic; }
    .legend { font-size: 7.5pt; color: var(--ml-muted); margin-top: 8px; }
    .kbanner { font-size: 8pt; margin-bottom: 5px; }
    .deadlines { font-size: 7.6pt; margin-bottom: 7px; }
    </style></head><body>"""]
    h.append(f"<h1>BRIAN'S ROUND-BY-ROUND MENU · 2026</h1>")
    h.append(f'<div class="sub">P(available) at YOUR exact pick, from 300 keeper-scenario Monte Carlo sims · '
             f'slot 6 · generated {date.today():%b %d, %Y} · regenerates weekly</div>')
    h.append('<div class="ml-banner kbanner"><b>Keepers (locked):</b> Colston Loveland R8 · Luther Burden R9 · '
             'Alec Pierce R14 · Christian Watson R15 &nbsp;|&nbsp; '
             '<b>Doctrine:</b> RB/QB early → Price R5-R6 → BPA mid → rookie stashes R16-R17, stream K/DEF</div>')
    # Deadline strip
    h.append('<div class="ml-banner--warn deadlines"><b>POSITION DEADLINES</b> (median pick the Nth-best is GONE): ')
    strip_bits = []
    for pos, chips in deadlines:
        c = POS_COLORS.get(pos, PALETTE["gray"])
        chip_txt = " · ".join(
            f'{label} by <b>#{gone} (R{rnd})</b>'
            f'{f"<span class=ml-urgent>{near}</span>" if near else ""}'
            for label, gone, rnd, near in chips)
        strip_bits.append(f'<span style="color:{c};font-weight:700">{pos}</span> {chip_txt}')
    h.append(" &nbsp;|&nbsp; ".join(strip_bits))
    h.append('</div>')
    h.append('<div class="grid">')
    for pk, menu, long_shot, sim_call, keep in cards:
        h.append(f'<div class="ml-card"><h2>R{pk["round"]} · #{pk["overall"]}'
                 f'<span class="keep">{keep}</span></h2>')
        if sim_call:
            h.append(f'<div class="sim">sim\'s call: <b>{sim_call["player"]}</b> ({sim_call["pct"]:.0f}%)</div>')
        h.append('<table class="ml-table ml-table--compact">')
        for p, sv in menu:
            pct = round(sv * 100)
            cls = "ml-sv-hi" if pct >= 70 else ("ml-sv-mid" if pct >= 40 else "ml-sv-lo")
            c = POS_COLORS.get(p["pos"], PALETTE["gray"])
            nm = p["name"]
            if len(nm) > 20:
                f_, l_ = nm.split(" ", 1)
                nm = f"{f_[0]}. {l_}"
            h.append(f'<tr><td class="pos" style="color:{c}">{p["pos"]}</td>'
                     f'<td>{nm}</td><td class="vbd">{p["vbd"]:+.0f}</td>'
                     f'<td class="sv {cls}">{pct}%</td></tr>')
        h.append("</table>")
        if long_shot:
            p, sv = long_shot
            h.append(f'<div class="shot">if he falls: {p["name"]} '
                     f'({p["pos"]}, VBD {p["vbd"]:+.0f}, {round(sv*100)}%)</div>')
        h.append("</div>")
    h.append("</div>")
    h.append('<div class="legend"><b>Reading it:</b> VBD = points above replacement (superflex math). '
             '<span class="ml-sv-hi"><b>Green %</b></span> = will be there, safe to wait · '
             '<span class="ml-sv-mid"><b>amber</b></span> = coin flip, take if he\'s your guy · '
             '<span class="ml-sv-lo"><b>red</b></span> = now or never. '
             'K/DEF appear only at R16-R17 (stream all season). Keeper cost = draft round − 2.</div>')
    h.append("</body></html>")

    import os
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=bpr.CHROMIUM_EXEC,
                              args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = b.new_context(viewport={"width": 1400, "height": 1000}).new_page()
        page.set_content("\n".join(h), wait_until="networkidle")
        page.pdf(path=str(PDF_OUT), format="Letter", landscape=True,
                 margin={"top": "0.2in", "bottom": "0.2in",
                         "left": "0.25in", "right": "0.25in"},
                 print_background=True)
        b.close()
    print(f"Wrote {PDF_OUT.relative_to(ROOT)} ({len(cards)} live picks)")


if __name__ == "__main__":
    main()
