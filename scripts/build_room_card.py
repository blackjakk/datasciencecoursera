"""ROOM CARD — the printed one-pager Brian holds at the live draft.

One Letter-landscape page, banknote chrome, three columns:
  THE ROOM (rival tendencies) · REACHABLE EDGES / LET THEM PAY
  (model vs the room's paper) · KEEPER MATH + FORWARD MARKET.
All facts read live from the pipeline's JSONs — nothing hardcoded.

Output: data/MONEYLEAGUE_ROOM_CARD.pdf (exactly 1 page, verified).
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
TENDENCIES = ROOT / "data" / "manager_tendencies.json"
MARKET_SCREEN = ROOT / "data" / "research" / "market_screen.json"
STASH_CURVE = ROOT / "data" / "research" / "stash_curve.json"
STACK_SCREEN = ROOT / "data" / "research" / "keeper_stack_screen.json"
HELPER_DATA = ROOT / "docs" / "draft_helper" / "data.json"
KEEPERS = ROOT / "data" / "keepers_2026.json"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_ROOM_CARD.pdf"

MY_ROSTER_ID = 9

# Data fields that were missing/empty at build time (disclosed in fineprint,
# never invented).
MISSING: list[str] = []


def esc(s) -> str:
    return _html.escape(str(s), quote=False)


def load_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        MISSING.append(path.name)
        return None


def pos_cell(pos: str) -> str:
    """Position text in its identity hue (ml-pos-* class from ml.css)."""
    p = str(pos).upper()
    return f'<span class="ml-pos-{p.lower()}"><b>{esc(p)}</b></span>'


# ---------------------------------------------------------------- THE ROOM

def fingerprint_text(v) -> str | None:
    """Render the measured fingerprint schema (reach medians, ADP-capped;
    rookie/2nd-yr appetite vs league base; age) as one compact line.
    Strings/lists tolerated for forward compatibility."""
    if isinstance(v, str) and v.strip():
        return v.strip()
    if isinstance(v, list) and v:
        return " · ".join(str(x) for x in v if str(x).strip())
    if not isinstance(v, dict):
        return None
    bits = []
    for pos, r in sorted((v.get("reach") or {}).items(),
                         key=lambda kv: -abs(kv[1].get("median") or 0)):
        if pos == "ALL" or not isinstance(r, dict):
            continue
        med = r.get("median")
        if med is None or abs(med) < 0.8 or r.get("n", 0) < 4:
            continue
        word = "over mkt" if med > 0 else "under mkt"
        bits.append(f"{pos} {abs(med):.1f}rd {word}")   # plain text — row is escaped
    rk, y2 = v.get("rookie_share"), v.get("yr2_share")
    if rk is not None and abs(rk - 0.16) >= 0.08:
        bits.append(f"rookies {rk:.0%}")
    if y2 is not None and abs(y2 - 0.15) >= 0.08:
        bits.append(f"2nd-yr {y2:.0%}")
    age = v.get("age_at_draft")
    if age is not None and abs(age - 25.5) >= 1.2:
        bits.append(f"drafts {'old' if age > 25.5 else 'young'} ({age:.1f})")
    if not bits:
        return "no strong lean — drafts the market"
    return " · ".join(bits[:4])


def tendency_text(t: dict, max_bits: int) -> str:
    """Compact bias line from per-position delta_rounds
    (negative = takes that position EARLIER than the league)."""
    bits = []
    for pos, st in sorted(t.items(),
                          key=lambda kv: -abs(kv[1].get("delta_rounds") or 0)):
        d = st.get("delta_rounds")
        if d is None or abs(d) < 0.5:
            continue
        word = "early" if d < 0 else "late"
        bits.append(f"{pos_cell(pos)} {abs(d):.1f}rd {word}")
    if not bits:
        return '<span class="ml-note">no strong lean — drafts the market</span>'
    return " · ".join(bits[:max_bits])


def room_rows(tend_data, rivals: list[dict], max_bits: int) -> list[str]:
    fps = (tend_data or {}).get("fingerprints") or {}
    tends = (tend_data or {}).get("tendencies") or {}
    rows = []
    for m in rivals:
        mid = m["id"]
        txt = fingerprint_text(fps.get(mid))
        if txt:
            txt = esc(txt[:90])
        else:
            txt = tendency_text(tends.get(mid, {}), max_bits)
        rows.append(
            f'<tr><td class="mgr">{esc(mid)}</td><td>{txt}</td></tr>')
    return rows


# --------------------------------------------------------------- sections

def build_html(font_pt: float, max_bits: int, sleep_rows: int) -> str:
    tend = load_json(TENDENCIES)
    screen = load_json(MARKET_SCREEN) or {}
    stash = load_json(STASH_CURVE) or {}
    stacks = load_json(STACK_SCREEN) or {}
    helper = load_json(HELPER_DATA) or {}
    keepers = load_json(KEEPERS) or []

    # ---- Brian's picks (live from the helper schedule) ----
    managers = helper.get("managers") or []
    me = next((m for m in managers if m.get("roster_id") == MY_ROSTER_ID), None)
    rivals = sorted((m for m in managers if m.get("roster_id") != MY_ROSTER_ID),
                    key=lambda m: m.get("slot", 99))
    keeper_rounds = set()
    for k in keepers:
        if k.get("roster_id") == MY_ROSTER_ID and k.get("status") == "carryover":
            r = k.get("effective_forfeit_round") or k.get("forfeit_round")
            if r:
                keeper_rounds.add(r)
    picks_line = ""
    if me is not None and helper.get("schedule"):
        ti = me["team_idx"]
        parts = []
        for s in helper["schedule"]:
            if s["team_idx"] != ti:
                continue
            n = f'#{s["overall"]}'
            parts.append(f"({n})" if s["round"] in keeper_rounds else n)
        picks_line = " ".join(parts)
    else:
        MISSING.append("draft schedule (roster 9)")

    keeper_note = ""
    if keeper_rounds:
        keeper_note = ("(#) = keeper-consumed R"
                       + "/R".join(str(r) for r in sorted(keeper_rounds)))

    # ---- Reachable edges / let them pay ----
    mvp = (screen.get("model_vs_paper") or {})
    sleep = [r for r in (mvp.get("sheets_sleep") or [])
             if (r.get("reach_pct") or 0) >= 40][:sleep_rows]
    love = (mvp.get("sheets_love") or [])[:5]
    if not sleep:
        MISSING.append("market_screen sheets_sleep")
    if not love:
        MISSING.append("market_screen sheets_love")

    # ---- Keeper math ----
    tiers = (stash.get("keeper_tiers") or {})
    formula = tiers.get("formula") or ""
    if not formula:
        MISSING.append("keeper_tiers.formula")
    mega = next((t for t in (tiers.get("by_discount") or [])
                 if "7+" in str(t.get("tier", ""))), None)
    if mega is None:
        MISSING.append("keeper_tiers mega-discount tier")
    curve = [c for c in (stash.get("curve") or [])
             if 9 <= (c.get("round") or 0) <= 17]
    option_line = " ".join(
        f'R{c["round"]}+{c["option_value"]:.0f}' for c in curve)
    if not option_line:
        MISSING.append("stash_curve R9-17 options")

    # ---- Forward market ----
    watch = (stacks.get("watch") or {})
    war_top = sorted((stacks.get("stacks") or []),
                     key=lambda s: -(s.get("war_chest") or 0))[:3]
    sellers = ((stacks.get("expiry") or {}).get("forced_sellers")) or []
    if not stacks.get("stacks"):
        MISSING.append("keeper_stack_screen stacks")

    # ------------------------------------------------------------- HTML
    h = ['<html data-theme="light"><head><meta charset="utf-8"><style>'
         + report_base_css() + bpr.banknote_css() + f"""
    * {{ box-sizing: border-box; margin: 0; }}
    body {{ font-size: {font_pt}pt; line-height: 1.25; padding: 6px 14px; }}
    h1 {{ font-size: 15pt; letter-spacing: 1px; }}
    .bn-mast .bn-sub {{ font-size: {font_pt}pt; }}
    .cols {{ display: grid; grid-template-columns: 1.15fr 1fr 1fr;
             gap: 6px; align-items: start; }}
    .col {{ display: flex; flex-direction: column; gap: 6px; }}
    .ml-card {{ padding: 4px 7px; }}
    .ml-h-label {{ margin-bottom: 2px; }}
    .ml-table td, .ml-table th {{ padding: 1px 4px; font-size: {font_pt}pt; }}
    .ml-table th {{ font-size: {max(font_pt - 0.6, 5.6):.1f}pt; }}
    .mgr {{ font-weight: 700; white-space: nowrap; }}
    .picks {{ font-size: {font_pt + 0.4:.1f}pt; margin-bottom: 6px;
              display: flex; gap: 8px; align-items: baseline;
              flex-wrap: wrap; }}
    .picks .ml-num {{ letter-spacing: .3px; font-weight: 700; }}
    .strip {{ font-size: {font_pt}pt; }}
    .strip p {{ margin: 1px 0; }}
    .note {{ color: var(--ml-muted); }}
    .watchline {{ color: var(--ml-warn); font-weight: 700; }}
    .bn-foot {{ margin-top: 5px; padding-top: 3px; font-size: 6.2pt; }}
    </style></head><body>"""]

    h.append(bpr.banknote_masthead(
        "ROOM CARD",
        f"draft-day intel · seat 6 · generated {date.today():%b %d, %Y}",
        compact=True))

    # Picks strip (full width, right under the masthead)
    if picks_line:
        h.append('<div class="ml-banner picks">'
                 '<span class="ml-h-label">MY PICKS · SEAT 6</span>'
                 f'<span class="ml-num">{esc(picks_line)}</span>'
                 f'<span class="ml-fineprint">{esc(keeper_note)}</span></div>')

    h.append('<div class="cols">')

    # ---------- column 1: THE ROOM ----------
    h.append('<div class="col"><div class="ml-card">'
             '<div class="ml-h-label">THE ROOM — 11 RIVALS'
             '<span class="note"> · rd vs league avg first-take</span></div>'
             '<table class="ml-table ml-table--compact">')
    if tend and rivals:
        h.extend(room_rows(tend, rivals, max_bits))
    else:
        MISSING.append("manager_tendencies")
        h.append('<tr><td class="note">tendency data unavailable</td></tr>')
    h.append('</table>'
             '<div class="ml-fineprint">early = takes that position sooner '
             'than the room; measured, not stated fandom (no fan tax exists)'
             '</div></div></div>')

    # ---------- column 2: EDGES ----------
    h.append('<div class="col">')
    h.append('<div class="ml-card">'
             '<div class="ml-h-label">REACHABLE EDGES — OUR BOARD vs THEIR PAPER</div>'
             '<table class="ml-table ml-table--compact">'
             '<tr><th>PLAYER</th><th>POS</th><th class="ml-num">OURS</th>'
             '<th class="ml-num">PAPER</th><th class="ml-num">REACH</th></tr>')
    for r in sleep:
        pct = r.get("reach_pct") or 0
        cls = "ml-sv-hi" if pct >= 70 else "ml-sv-mid"
        h.append(f'<tr><td>{esc(r["name"])}</td><td>{pos_cell(r["position"])}</td>'
                 f'<td class="ml-num">R{r["model_round"]}</td>'
                 f'<td class="ml-num">R{r["fp_round"]}</td>'
                 f'<td class="ml-num {cls}"><b>{pct:.0f}%</b></td></tr>')
    if not sleep:
        h.append('<tr><td class="note" colspan="5">no reachable edges on file</td></tr>')
    h.append('</table>'
             '<div class="ml-fineprint">reach = P(survives to my seat at/after '
             'their paper round)</div></div>')

    h.append('<div class="ml-card">'
             '<div class="ml-h-label">LET THEM PAY — PAPER OVERRATES</div>'
             '<table class="ml-table ml-table--compact">')
    for r in love:
        h.append(f'<tr><td>{esc(r["name"])}</td><td>{pos_cell(r["position"])}</td>'
                 f'<td class="ml-num">ours R{r["model_round"]}</td>'
                 f'<td class="ml-num ml-sv-lo"><b>paper R{r["fp_round"]}</b></td></tr>')
    if not love:
        h.append('<tr><td class="note">no overpriced names on file</td></tr>')
    h.append('</table>'
             '<div class="ml-fineprint">never draft these at paper price — '
             'someone else will</div></div>')
    h.append('</div>')  # /col 2

    # ---------- column 3: KEEPER MATH + FORWARD MARKET ----------
    h.append('<div class="col">')
    h.append('<div class="ml-card strip"><div class="ml-h-label">KEEPER MATH</div>')
    if formula:
        h.append(f'<p>{esc(formula)}</p>')
    if mega:
        h.append(f'<p><b>{esc(mega["tier"])}</b>: '
                 f'<span class="ml-num">{mega["net"]:+.0f}</span>/keeper net · '
                 f'<span class="ml-num">{mega["hit"]}%</span> hit · '
                 f'<span class="ml-num">{mega["smash"]}%</span> smash '
                 f'<span class="note">(n={mega["n"]})</span></p>')
    if option_line:
        h.append('<p><span class="ml-h-label">2027 OPTION VALUE R9+</span> '
                 f'<span class="ml-num">{esc(option_line)}</span></p>')
    h.append('</div>')

    h.append('<div class="ml-card strip"><div class="ml-h-label">FORWARD MARKET</div>')
    if watch:
        if watch.get("fired"):
            proven = watch.get("top_proven_share")
            proven_txt = f' · {proven * 100:.0f}% proven' if proven is not None else ""
            h.append(f'<p><span class="watchline">TITLE WATCH: {esc(watch.get("top"))}</span> '
                     f'<span class="ml-num">surplus {watch.get("top_surplus", 0):.0f}</span>'
                     f'{proven_txt} · but war-chest rank '
                     f'<span class="ml-num">{watch.get("top_war_rank", "?")}</span></p>')
        else:
            h.append('<p class="note">title watch: not fired this year</p>')
    if war_top:
        chest = " · ".join(
            f'{esc(s["manager"])} <span class="ml-num">{s["war_chest"]:.0f}</span>'
            for s in war_top)
        h.append(f'<p><b>WAR CHEST TOP 3</b>: {chest}</p>')
    if sellers:
        for s in sellers:
            assets = ", ".join(esc(a) for a in s.get("assets", []))
            h.append(f'<p><b>FORCED SELLER</b> {esc(s["manager"])}: {assets}</p>')
        h.append('<p class="note">expiring keepers = rentals · buy window W9-11</p>')
    h.append('</div>')
    h.append('</div>')  # /col 3
    h.append('</div>')  # /cols

    gen = f"Generated {date.today():%b %d, %Y}"
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
    # Shrink ladder: (font pt, max bias chips per rival, sleep rows)
    attempts = [(7.4, 4, 8), (6.8, 3, 8), (6.2, 2, 6)]
    n_pages = None
    for font_pt, max_bits, sleep_rows in attempts:
        MISSING.clear()
        render(build_html(font_pt, max_bits, sleep_rows), PDF_OUT)
        n_pages = page_count(PDF_OUT)
        if n_pages is None or n_pages == 1:
            break
        print(f"  {n_pages} pages at {font_pt}pt — shrinking…")
    if n_pages is not None and n_pages != 1:
        raise SystemExit(f"ERROR: room card rendered {n_pages} pages — must be 1")
    size = PDF_OUT.stat().st_size
    print(f"Wrote {PDF_OUT.relative_to(ROOT)} "
          f"({n_pages if n_pages is not None else '?'} page, {size / 1024:.0f} KB)")
    if MISSING:
        print("Missing data noted in fineprint: " + "; ".join(sorted(set(MISSING))))


if __name__ == "__main__":
    main()
