"""DOCTRINE CARD — the 15-year laws and the 2026 operating calendar,
on one page.

The Room Card is what Brian holds AT THE DRAFT TABLE; this is what he
reads before making any season decision: the measured laws (points-for,
the trade axis, the star rule, the elite-buy payoff, keeper economics,
room behavior), the week-by-week operating calendar they imply, and the
2026 board (call-sheet targets, sharks, Brian's own leak list, assets).

One Letter-landscape page, banknote chrome, three columns. Live numbers
read from the pipeline's JSONs wherever they can regrade (call sheet,
elite buys, keeper tiers, forced sellers, war chest); the settled laws
carry their recorded stats. Missing inputs are disclosed in the
fineprint, never invented.

Output: data/MONEYLEAGUE_DOCTRINE.pdf (exactly 1 page, verified).
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
RESEARCH = ROOT / "data" / "research"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_DOCTRINE.pdf"
ME = "brian_bigguap"

MISSING: list[str] = []


def esc(s) -> str:
    return _html.escape(str(s), quote=False)


def load_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        MISSING.append(path.name)
        return None


def law(title: str, body: str) -> str:
    return (f'<p class="law"><span class="ml-h-label">{title}</span> '
            f'{body}</p>')


def cal(when: str, what: str) -> str:
    return (f'<tr><td class="when">{when}</td><td>{what}</td></tr>')


def build_html(font_pt: float, n_targets: int) -> str:
    targets = load_json(RESEARCH / "trade_targets.json") or {}
    elite = targets.get("elite") or load_json(
        RESEARCH / "elite_buy_payoff.json") or {}
    stash = load_json(RESEARCH / "stash_curve.json") or {}
    stacks = load_json(RESEARCH / "keeper_stack_screen.json") or {}

    # live pieces
    t3 = next((t for t in elite.get("tiers", []) if t["top_n"] == 3), None)
    t10 = next((t for t in elite.get("tiers", []) if t["top_n"] == 10), None)
    if not t3:
        MISSING.append("elite_buy_payoff tiers")
    tiers = (stash.get("keeper_tiers") or {})
    mega = next((t for t in (tiers.get("by_discount") or [])
                 if "7+" in str(t.get("tier", ""))), None)
    if mega is None:
        MISSING.append("keeper_tiers mega-discount tier")
    sellers = ((stacks.get("expiry") or {}).get("forced_sellers")) or []
    if not sellers:
        MISSING.append("forced sellers")
    my_stack = next((s for s in stacks.get("stacks", [])
                     if s.get("manager") == ME), None)
    war_rank_me = None
    if stacks.get("stacks"):
        order = sorted(stacks["stacks"], key=lambda s: -s["war_chest"])
        war_rank_me = next((i + 1 for i, s in enumerate(order)
                            if s["manager"] == ME), None)
    board = targets.get("targets") or []
    if not board:
        MISSING.append("trade_targets board")
    sharks = [r["manager"] for r in board
              if "shark" in r["verdict"].lower()]

    h = ['<html data-theme="light"><head><meta charset="utf-8"><style>'
         + report_base_css() + bpr.banknote_css() + f"""
    * {{ box-sizing: border-box; margin: 0; }}
    body {{ font-size: {font_pt}pt; line-height: 1.3; padding: 6px 14px; }}
    h1 {{ font-size: 15pt; letter-spacing: 1px; }}
    .bn-mast .bn-sub {{ font-size: {font_pt}pt; }}
    .cols {{ display: grid; grid-template-columns: 1.12fr 1fr 1fr;
             gap: 6px; align-items: start; }}
    .col {{ display: flex; flex-direction: column; gap: 6px; }}
    .ml-card {{ padding: 4px 7px; }}
    .ml-h-label {{ margin-bottom: 2px; }}
    .law {{ margin: 2px 0 4px; }}
    .law .ml-h-label {{ display: block; }}
    .ml-table td, .ml-table th {{ padding: 1px 4px; font-size: {font_pt}pt; }}
    .when {{ font-weight: 700; white-space: nowrap;
             font-family: var(--ml-font-engraving); }}
    .mgr {{ font-weight: 700; white-space: nowrap; }}
    .note {{ color: var(--ml-muted); }}
    .no {{ color: var(--ml-danger); font-weight: 700; }}
    .bn-foot {{ margin-top: 5px; padding-top: 3px; font-size: 6.2pt; }}
    </style></head><body>"""]

    h.append(bpr.banknote_masthead(
        "THE DOCTRINE",
        "fifteen years of this league, one page · laws / calendar / board"
        f" · generated {date.today():%b %d, %Y}", compact=True))
    h.append('<div class="cols">')

    # ---------------- column 1: THE LAWS ----------------
    h.append('<div class="col"><div class="ml-card">'
             '<div class="ml-h-label">THE LAWS — measured, both eras'
             ' (2011-25)</div>')
    h.append(law(
        "1 · POINTS-FOR QUALIFIES, VARIANCE CROWNS",
        "champion median scoring rank #1 over 15 titles (8 were the top "
        "scorer). Every upset was ONE bad week, never a better roster — "
        "so maximize season points, then accept the bracket coin. "
        "December roster &gt; season-long roster."))
    h.append(law(
        "2 · BE THE STRONGER SIDE",
        "the team ahead in points-for when a deal closes wins "
        "mixed-strength trades +44/deal (n=342 sides); equal-strength "
        "trades wash to 0. Trade DOWN the table, never up from weakness."))
    h.append(law(
        "3 · TAKE THE DEAL'S BEST PLAYER",
        "finalists captured the single best rest-of-season player on 54% "
        "of their trade sides; the field 28%; Brian career 22% — the leak."))
    elite_txt = ""
    if t3 and t10:
        elite_txt = (f'top-3 rest-of-season buy &rarr; '
                     f'<b>{t3["title_rate"]:.0%} title / '
                     f'{t3["finals_rate"]:.0%} finals</b> (base 8%/17%); '
                     f'top-10 &rarr; {t10["title_rate"]:.0%}/'
                     f'{t10["finals_rate"]:.0%}. '
                     f'{elite.get("champions_with_top10_buy", "?")} of '
                     f'{elite.get("champions_total", "?")} champions made a '
                     'top-10 buy in their title year. Conditions: already '
                     'top-half, pay in picks.')
    h.append(law("4 · BUY ELITE WHEN CONTENDING",
                 elite_txt or "elite-buy table unavailable"))
    keeper_txt = ("keeper profit = locked discount &minus; regression tax "
                  "(QB 0 / RB 14 / WR 14 / TE 25). ")
    if mega:
        keeper_txt += (f'7+ round discounts: <b>{mega["net"]:+.0f}/keeper, '
                       f'{mega["hit"]}% hit</b>; ')
    keeper_txt += ("&lt;4 rounds = ceremony (~0). Champions carry +230 "
                   "keeper surplus vs field +14; every ring was built on a "
                   "&ge;5-round-discount keeper found late the YEAR BEFORE.")
    h.append(law("5 · KEEPERS: DISCOUNT MINUS TAX", keeper_txt))
    h.append(law(
        "6 · THE ROOM REPEATS",
        "burned owners change nothing (n=103 transitions, null even with "
        "capital and injury excuses); no fan/alumni tax exists; 2QB-by-R6 "
        "is a THIS-room exploit (67% playoff rate vs 38%), not a superflex "
        "law — it failed outside and pre-2023."))
    h.append('</div></div>')

    # ---------------- column 2: THE CALENDAR ----------------
    h.append('<div class="col"><div class="ml-card">'
             '<div class="ml-h-label">THE 2026 OPERATING CALENDAR</div>'
             '<table class="ml-table ml-table--compact">')
    h.append(cal("AUG · LOCK",
                 "declare keepers via the runbook (lock_keepers.py "
                 "validates cap/floor/bump). Tax-aware verdict: Burden R9 "
                 "+ Watson R15 is the #1 set; Loveland/Pierce grade as "
                 "ceremony keeps."))
    h.append(cal("DRAFT",
                 "2 QBs by R6 (the room's QB-late minority never learns); "
                 "never pay the paper price — Room Card in hand; R9+ picks "
                 "carry real 2027 keeper option value (R9 +30)."))
    h.append(cal("W1-5 · HOLD",
                 '<span class="no">NO DEALS.</span> Early swaps are '
                 "history's most lopsided window and Brian's worst "
                 "(&minus;62/deal). Watch POINTS, not record — champions "
                 "have started 1-3 (coop '17) and PF#10 (Trevor '20); "
                 "early wins with bottom-half scoring are a lie."))
    h.append(cal("W6-10 · WINDOW",
                 "the market opens (60% of all trades, every era) and the "
                 "W6 scoring table is decision-grade — THE FORK: "
                 "<b>top-3 PF &rarr; buy with conviction</b> (69/40/33% "
                 "finals rates); <b>bottom-3 PF &rarr; sell with "
                 "conviction</b> — 0 finalists in 43 team-seasons ever, "
                 "and mid-season sells are the best-paid (+33/deal); "
                 "ranks 4-9 &rarr; force the answer by W8 (bottom-half at "
                 "W8 &asymp; dead; the one escape was Ankur '22, who "
                 "BOUGHT his way out)."))
    seller_txt = ("rental shelf opens — expiring keepers are pure rentals "
                  "to any buyer (the 3-yr clock follows the player). ")
    if sellers:
        seller_txt += "Forced sellers: " + "; ".join(
            f'<b>{esc(s["manager"])}</b> ({", ".join(esc(a) for a in s["assets"][:3])})'
            for s in sellers) + ". Pay in PICKS only."
    h.append(cal("W9-11 · RENT", seller_txt))
    h.append(cal("W12+ · DEADLINE",
                 "deadline buys run ~free (&minus;2.7/deal historic); "
                 "last cheap shot at December ceiling."))
    h.append(cal("W15-17 · BRACKET",
                 "variance owns the bracket (a title was once decided by "
                 "0.02). Points got you here; start the ceiling."))
    h.append('</table></div></div>')

    # ---------------- column 3: THE BOARD ----------------
    h.append('<div class="col">')
    h.append('<div class="ml-card">'
             '<div class="ml-h-label">THE BOARD — CALL SHEET TOP '
             f'{n_targets}</div>'
             '<table class="ml-table ml-table--compact">')
    for r in board[:n_targets]:
        verdict = r["verdict"].split(" · ")[0]
        h.append(f'<tr><td class="mgr">{esc(r["manager"])}</td>'
                 f'<td>{esc(verdict)}</td></tr>')
    if not board:
        h.append('<tr><td class="note">call sheet unavailable</td></tr>')
    h.append('</table>')
    if sharks:
        h.append(f'<p><span class="no">SELL-ONLY SHARKS:</span> '
                 f'{esc(", ".join(sharks))}</p>')
    h.append('<div class="ml-fineprint">full board: Research Desk XII or '
             'trade_advisor.py --partners</div></div>')

    h.append('<div class="ml-card">'
             '<div class="ml-h-label">BRIAN\'S LEAK LIST — the do-nots</div>'
             '<p class="no">Never swap for a QB (&minus;51/deal over 14).</p>'
             '<p class="no">Never deal before W6 (&minus;62/deal).</p>'
             '<p class="no">Never accept the second-best piece '
             '(career star-buy 22% vs finalists 54%).</p>'
             '<p class="no">Never deal with Trevor without the advisor '
             '(pair book &minus;686 over 11).</p></div>')

    assets_txt = ("Zero expiring keepers (all fresh) + the FULL 2027 pick "
                  "set — the exact currency every forced seller needs. ")
    if my_stack and war_rank_me:
        assets_txt += (f'War chest {my_stack["war_chest"]:.0f} '
                       f'(rank #{war_rank_me} of 12).')
    h.append('<div class="ml-card">'
             '<div class="ml-h-label">2026 ASSETS &amp; THE PLAY</div>'
             f'<p>{assets_txt}</p>'
             '<p>The play: draft the structure, hold W1-5, be top-half by '
             'W9, then rent the best expiring asset on the shelf with '
             'picks. That is law 1 + 2 + 4 stacked — the highest-'
             'percentage title path this league has ever recorded.</p>'
             '</div>')
    h.append('</div>')  # /col 3
    h.append('</div>')  # /cols

    gen = (f"Generated {date.today():%b %d, %Y} · sources: decade + Sleeper "
           "ledgers (342 graded sides), elite-buy payoff, keep-side tier "
           "book, stack screen, call sheet — all regrade weekly")
    if MISSING:
        gen += " · missing at build: " + "; ".join(sorted(set(MISSING)))
    h.append(bpr.banknote_fineprint(gen))
    h.append('</body></html>')
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
                 margin={"top": "0.2in", "bottom": "0.2in",
                         "left": "0.25in", "right": "0.25in"},
                 print_background=True)
        b.close()


def page_count(path: Path) -> int | None:
    try:
        from pypdf import PdfReader
        return len(PdfReader(str(path)).pages)
    except ImportError:
        return None


def main() -> None:
    attempts = [(7.4, 6), (6.8, 5), (6.2, 4)]   # (font pt, board rows)
    n_pages = None
    for font_pt, n_targets in attempts:
        MISSING.clear()
        render(build_html(font_pt, n_targets), PDF_OUT)
        n_pages = page_count(PDF_OUT)
        if n_pages is None or n_pages == 1:
            break
        print(f"  {n_pages} pages at {font_pt}pt — shrinking…")
    if n_pages is not None and n_pages != 1:
        raise SystemExit(f"ERROR: doctrine card rendered {n_pages} pages "
                         "— must be 1")
    size = PDF_OUT.stat().st_size
    print(f"Wrote {PDF_OUT.relative_to(ROOT)} "
          f"({n_pages if n_pages is not None else '?'} page, "
          f"{size / 1024:.0f} KB)")
    if MISSING:
        print("Missing data noted in fineprint: "
              + "; ".join(sorted(set(MISSING))))


if __name__ == "__main__":
    main()
