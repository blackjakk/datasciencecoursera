"""MONEYLEAGUE Research Desk — the analyst report.

Assembles the four research fragments (built by their own scripts into
data/research/) under the shared banknote chrome:

  market_screen          scripts/build_market_screen.py
  trade_ledger           scripts/build_trade_ledger.py
  counterparty_dossiers  scripts/build_trade_ledger.py
  autopsy_2025           scripts/build_autopsy_2025.py

Output: data/MONEYLEAGUE_RESEARCH_DESK.pdf (portrait letter, multipage).
Fragments are self-contained <section>s styled only with ml.css classes —
this script owns the page chrome and layout, never the analysis.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from design.tokens import report_base_css  # noqa: E402
from scripts import build_power_rankings as bpr  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RESEARCH = ROOT / "data" / "research"
PDF_OUT = ROOT / "data" / "MONEYLEAGUE_RESEARCH_DESK.pdf"

SECTIONS = [
    ("market_screen", "I. Market Inefficiency Screen"),
    ("trade_ledger", "II. Trade Ledger — the book, 2023–25"),
    ("counterparty_dossiers", "III. Counterparty Dossiers"),
    ("pick_squeeze", "IV. Pick Squeeze"),
    ("autopsy_2025", "V. The 2025 Autopsy"),
    ("stash_curve", "VI. The Option Book — what late picks really pay"),
    ("keeper_sensitivity", "VII. Keeper Sensitivity — declarations worth probing"),
    ("survival_calibration", "VIII. Survival Calibration — the model audits itself"),
    ("timing_study", "IX. The Timing Study — trading against the calendar"),
    ("champion_profile", "X. The Champion Profile — what finals teams do differently"),
    ("keeper_stack_screen", "XI. The Stack Screen — keeper firepower, priced honestly"),
]

PAGE_CSS = """
  * { box-sizing: border-box; margin: 0; }
  body { font-size: 9pt; line-height: 1.35; padding: 22px 26px; }
  .desk-section { margin: 14px 0 8px; page-break-inside: auto; }
  .desk-section + .desk-section { page-break-before: always; }
  .desk-h { font-family: var(--ml-font-engraving); font-size: 13pt;
            letter-spacing: 1px; margin: 0 0 8px;
            border-bottom: 1px solid var(--ml-border-strong);
            padding-bottom: 4px; }
  .desk-section table { page-break-inside: auto; }
  .desk-section tr { page-break-inside: avoid; }
  .desk-section .ml-card { page-break-inside: avoid; margin-bottom: 6px; }
"""


def main() -> None:
    parts: list[str] = []
    missing: list[str] = []
    for name, title in SECTIONS:
        frag = RESEARCH / f"{name}.html"
        parts.append(f'<div class="desk-section"><h2 class="desk-h">{title}</h2>')
        if frag.exists():
            parts.append(frag.read_text())
        else:
            missing.append(name)
            parts.append('<div class="ml-empty">Section pending — its builder '
                         'has not produced a fragment yet.</div>')
        parts.append("</div>")

    html = (
        '<html data-theme="light"><head><meta charset="utf-8"><style>'
        + report_base_css() + bpr.banknote_css() + PAGE_CSS
        + "</style></head><body>"
        + bpr.banknote_masthead(
            "RESEARCH DESK",
            "Trade intelligence · market inefficiencies · the 2025 autopsy — "
            f"generated {date.today():%b %d, %Y}, refreshed weekly")
        + "".join(parts)
        + bpr.banknote_fineprint()
        + "</body></html>"
    )

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=bpr.CHROMIUM_EXEC,
                              args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = b.new_context(viewport={"width": 1200, "height": 1400}).new_page()
        page.set_content(html, wait_until="networkidle")
        page.pdf(path=str(PDF_OUT), format="Letter",
                 margin={"top": "0.35in", "bottom": "0.35in",
                         "left": "0.4in", "right": "0.4in"},
                 print_background=True)
        b.close()

    note = f" (pending: {', '.join(missing)})" if missing else ""
    print(f"Wrote {PDF_OUT.relative_to(ROOT)} — "
          f"{len(SECTIONS) - len(missing)}/{len(SECTIONS)} sections{note}")
    if missing:
        sys.exit(f"ERROR: missing fragments: {missing}")


if __name__ == "__main__":
    main()
