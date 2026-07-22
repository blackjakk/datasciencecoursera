"""THE DRAFT SHEET — a BeerSheets-style one-page draft board.

The Room Card is intel and the Doctrine Card is strategy; this is the
BOARD: every draftable player in four position columns, tier-banded by
VBD cliffs, priced in our rounds with the room's paper round alongside,
edges badged (see legend), predicted keepers already stripped from the
pool, Brian's live picks across the top.

One Letter-landscape page, banknote chrome, 1-page enforced. All facts
read live from the pipeline's JSONs; regenerates weekly and at keeper
lock (actual keepers auto-replace predictions).

Output: data/MONEYLEAGUE_DRAFT_SHEET.pdf
"""
from __future__ import annotations

import html as _html
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from design.tokens import report_base_css  # noqa: E402
from scripts import build_power_rankings as bpr  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_DRAFT_SHEET.pdf"
MY_ROSTER_ID = 9

# players per position column (shrink ladder trims these)
DEPTH = {"QB": 26, "RB": 48, "WR": 54, "TE": 20}
# VBD drop between consecutive players that opens a new tier
TIER_GAP = {"QB": 22, "RB": 18, "WR": 16, "TE": 14}

MISSING: list[str] = []


def esc(s) -> str:
    return _html.escape(str(s), quote=False)


def load_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        MISSING.append(path.name)
        return None


def build_html(font_pt: float, depth_scale: float) -> str:
    helper = load_json(ROOT / "docs/draft_helper/data.json") or {}
    keepers = load_json(ROOT / "data/keepers_2026.json") or []
    screen = load_json(ROOT / "data/research/market_screen.json") or {}

    kept = {k["player_name"] for k in keepers if isinstance(k, dict)
            and k.get("status") == "carryover"}
    mvp = screen.get("model_vs_paper") or {}
    sleep = {r["name"] for r in mvp.get("sheets_sleep") or []}
    love = {r["name"] for r in mvp.get("sheets_love") or []}

    # ---- Brian's picks strip (keeper-consumed rounds parenthesised) ----
    managers = helper.get("managers") or []
    me = next((m for m in managers if m.get("roster_id") == MY_ROSTER_ID), None)
    keeper_rounds = {k.get("effective_forfeit_round") or k.get("forfeit_round")
                     for k in keepers
                     if k.get("roster_id") == MY_ROSTER_ID
                     and k.get("status") == "carryover"}
    picks_line = ""
    if me and helper.get("schedule"):
        parts = []
        for s in helper["schedule"]:
            if s["team_idx"] != me["team_idx"]:
                continue
            n = f'#{s["overall"]}'
            parts.append(f"({n})" if s["round"] in keeper_rounds else n)
        picks_line = " ".join(parts)
    else:
        MISSING.append("draft schedule (roster 9)")

    # ---- position pools ----
    pools: dict[str, list[dict]] = {p: [] for p in DEPTH}
    kdst: list[dict] = []
    for p in helper.get("players") or []:
        if p.get("name") in kept:
            continue
        pos = p.get("pos")
        if pos in pools:
            pools[pos].append(p)
        elif pos in ("K", "DEF"):
            kdst.append(p)          # ADP is 999 for K/DST — rank by proj
    for pos in pools:
        pools[pos].sort(key=lambda p: -(p.get("vbd") or -999))
    kdst.sort(key=lambda p: -(p.get("proj") or 0))

    def rows(pos: str) -> str:
        out, tier = [], 1
        lst = pools[pos][: int(DEPTH[pos] * depth_scale)]
        prev_vbd = None
        for p in lst:
            vbd = p.get("vbd") or 0.0
            if prev_vbd is not None and prev_vbd - vbd >= TIER_GAP[pos]:
                tier += 1
                out.append(f'<tr class="tier"><td colspan="4">'
                           f"TIER {tier}</td></tr>")
            prev_vbd = vbd
            our_r = max(1, round((p.get("adp") or 999) / 12))
            model_r = p.get("model_round")
            badge = ("▲" if p["name"] in sleep else
                     "▼" if p["name"] in love else "")
            bcls = ("up" if badge == "▲" else "dn" if badge == "▼" else "")
            out.append(
                f'<tr><td class="ml-num">R{our_r}</td>'
                f'<td class="nm">{esc(p["name"])}</td>'
                f'<td class="tm">{esc(p.get("team") or "")}</td>'
                f'<td class="bg {bcls}">{badge}</td></tr>')
        return "".join(out)

    kdst_line = " · ".join(
        f'{esc(p["name"])} <span class="tm">{esc(p.get("team") or "")}</span>'
        for p in kdst[:10])

    h = ['<html data-theme="light"><head><meta charset="utf-8"><style>'
         + report_base_css() + bpr.banknote_css() + f"""
    * {{ box-sizing: border-box; margin: 0; }}
    body {{ font-size: {font_pt}pt; line-height: 1.18; padding: 5px 12px; }}
    h1 {{ font-size: 14pt; letter-spacing: 1px; }}
    .bn-mast .bn-sub {{ font-size: {font_pt}pt; }}
    .cols {{ display: grid; grid-template-columns: 1fr 1.08fr 1.08fr 1fr;
             gap: 5px; align-items: start; }}
    .ml-card {{ padding: 3px 5px; }}
    .ml-h-label {{ margin-bottom: 1px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    td {{ padding: 0 3px; font-size: {font_pt}pt; white-space: nowrap; }}
    .nm {{ overflow: hidden; text-overflow: ellipsis; max-width: 11em; }}
    .tm {{ color: var(--ml-muted); font-size: {max(font_pt - 0.8, 5.2):.1f}pt; }}
    .bg {{ width: 1em; font-weight: 700; }}
    .up {{ color: var(--ml-success); }}
    .dn {{ color: var(--ml-danger); }}
    .tier td {{ border-top: 1px solid var(--ml-border-strong);
                color: var(--ml-muted); font-size: {max(font_pt - 1, 5):.1f}pt;
                letter-spacing: 1px; padding-top: 1px; }}
    .picks {{ font-size: {font_pt + 0.4:.1f}pt; margin-bottom: 4px;
              display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }}
    .picks .ml-num {{ letter-spacing: .3px; font-weight: 700; }}
    .kdst {{ margin-top: 4px; font-size: {font_pt}pt; }}
    .bn-foot {{ margin-top: 4px; padding-top: 2px; font-size: 6pt; }}
    </style></head><body>"""]

    h.append(bpr.banknote_masthead(
        "THE DRAFT SHEET",
        "the board · tiers by VBD cliff · keepers stripped · "
        f"generated {date.today():%b %d, %Y}", compact=True))
    if picks_line:
        h.append('<div class="ml-banner picks">'
                 '<span class="ml-h-label">MY PICKS · SEAT 6</span>'
                 f'<span class="ml-num">{esc(picks_line)}</span>'
                 '<span class="ml-fineprint">(#) = keeper-consumed · '
                 'R = ADP round · ▲ paper sleeps (value slides) · '
                 '▼ paper overpays (let them)</span></div>')
    h.append('<div class="cols">')
    for pos, label in (("QB", "QUARTERBACKS (2 by R6 — the room exploit)"),
                       ("RB", "RUNNING BACKS"),
                       ("WR", "WIDE RECEIVERS"),
                       ("TE", "TIGHT ENDS (the paper's blind spot)")):
        h.append(f'<div class="ml-card"><div class="ml-h-label">'
                 f'{label}</div><table>{rows(pos)}</table>')
        if pos == "TE":
            h.append(f'<div class="kdst"><span class="ml-h-label">'
                     f'K / DST (stream — last two rounds only)</span><br>'
                     f'{kdst_line}</div>')
        h.append("</div>")
    h.append("</div>")

    gen = (f"Generated {date.today():%b %d, %Y} · rounds = market ADP; "
           "tiers break on VBD cliffs (draft the tier, not the name); "
           "▲/▼ from the model-vs-paper screen; predicted keepers "
           "excluded — regenerates at keeper lock")
    if MISSING:
        gen += " · missing at build: " + "; ".join(sorted(set(MISSING)))
    h.append(bpr.banknote_fineprint(gen))
    h.append("</body></html>")
    return "\n".join(h)


def render(html: str, out: Path) -> None:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=bpr.CHROMIUM_EXEC,
                              args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = b.new_context(viewport={"width": 1400, "height": 1000}).new_page()
        page.set_content(html, wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.pdf(path=str(out), format="Letter", landscape=True,
                 margin={"top": "0.18in", "bottom": "0.18in",
                         "left": "0.22in", "right": "0.22in"},
                 print_background=True)
        b.close()


def page_count(path: Path) -> int | None:
    try:
        from pypdf import PdfReader
        return len(PdfReader(str(path)).pages)
    except ImportError:
        return None


def main() -> None:
    attempts = [(6.6, 1.0), (6.0, 0.9), (5.6, 0.78)]
    n_pages = None
    for font_pt, scale in attempts:
        MISSING.clear()
        render(build_html(font_pt, scale), PDF_OUT)
        n_pages = page_count(PDF_OUT)
        if n_pages is None or n_pages == 1:
            break
        print(f"  {n_pages} pages at {font_pt}pt — shrinking…")
    if n_pages is not None and n_pages != 1:
        raise SystemExit(f"ERROR: draft sheet rendered {n_pages} pages")
    print(f"Wrote {PDF_OUT.relative_to(ROOT)} "
          f"({n_pages if n_pages is not None else '?'} page, "
          f"{PDF_OUT.stat().st_size / 1024:.0f} KB)")
    if MISSING:
        print("Missing data noted in fineprint: "
              + "; ".join(sorted(set(MISSING))))


if __name__ == "__main__":
    main()
