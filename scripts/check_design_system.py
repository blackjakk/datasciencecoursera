"""MONEYLEAGUE design-system enforcement. Run standalone or via verify_outputs.

Rules (each prints per-violation `file:line` detail; exit 1 on any violation):

  RAW HEX            docs/draft_helper/index.html and the 4 report builders
                     must not contain hex color literals (#rgb / #rrggbb,
                     case-insensitive). Allowed exceptions: a hex used as a
                     var(--ml-..., #hex) fallback, hex inside a quoted SVG
                     data-URI (favicon), and hex inside comments.
  DUPLICATE PALETTES no scripts/*.py may define POS_COLORS / MANAGER_COLORS /
                     PALETTE dict literals — they must import design.tokens.
                     (design/ itself is the only place palettes live.)
  DRIFT              design/ml.css and design/tokens.py must be byte-identical
                     to a fresh regeneration from design/tokens.json (catches
                     hand-edits to generated files and forgotten regens).
  HELPER LINK        docs/draft_helper/index.html must link ml.css and carry a
                     data-theme attribute.

Usage:
    python3 scripts/check_design_system.py                  # full check
    python3 scripts/check_design_system.py --only drift     # one rule
    python3 scripts/check_design_system.py --fixture-selftest
"""
from __future__ import annotations

import argparse
import io
import re
import shutil
import subprocess
import sys
import tempfile
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Files subject to the RAW HEX scan (the design-system consumers, plus
# DESIGN.md — the intent doc references tokens by NAME so it can't fork
# from tokens.json the way prose design docs usually rot).
HEX_SCAN_TARGETS = [
    "DESIGN.md",
    "docs/hq/index.html",
    "docs/draft_helper/index.html",
    "scripts/build_power_rankings.py",
    "scripts/build_preseason_2026.py",
    "scripts/build_mock_draft_report.py",
    "scripts/build_round_menu.py",
    "scripts/build_room_card.py",
    "scripts/build_market_screen.py",
    "scripts/build_trade_ledger.py",
    "scripts/build_autopsy_2025.py",
    "scripts/build_pick_squeeze.py",
    "scripts/stash_curve.py",
    "scripts/build_keeper_sensitivity.py",
    "scripts/backtest_survival_calibration.py",
    "scripts/build_timing_study.py",
    "scripts/build_benchmark_validation.py",
    "scripts/build_champion_profile.py",
    "scripts/build_keeper_stack_screen.py",
    "scripts/build_research_desk.py",
]

# #rgb / #rrggbb, not followed by another word char (so "#defied", anchors
# like "#board", and 8-digit strings don't fire).
HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?![0-9a-fA-F])")

# var(--ml-x, #hex) fallbacks are the ONE sanctioned inline-hex form.
VAR_FALLBACK_RE = re.compile(r"var\(\s*--ml-[\w-]+\s*,[^)]*\)")

# Quoted SVG data-URIs (favicons) may embed fill colors.
SVG_URI_RE = re.compile(r"([\"'])data:image/svg\+xml.*?\1")

HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
CSS_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)

# Palette dict literals (optionally type-annotated) at statement level.
PALETTE_DICT_RE = re.compile(
    r"^\s*(POS_COLORS|MANAGER_COLORS|PALETTE)\s*(?::[^=]*)?=\s*\{")


# ---------------------------------------------------------------- helpers

def _blank(match: re.Match) -> str:
    """Replace a span with spaces, preserving newlines => line numbers."""
    return re.sub(r"[^\n]", " ", match.group(0))


def _strip_py_comments(text: str) -> str:
    """Blank COMMENT tokens. Tolerates broken files (best-effort blanking)."""
    lines = text.splitlines(keepends=True)
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type == tokenize.COMMENT:
                (row, c0), (_, c1) = tok.start, tok.end
                line = lines[row - 1]
                lines[row - 1] = line[:c0] + " " * (c1 - c0) + line[c1:]
    except (tokenize.TokenizeError, IndentationError, SyntaxError, ValueError):
        pass  # mid-edit file: scan what we could blank so far
    return "".join(lines)


# ------------------------------------------------------------------ rules

def scan_hex(text: str, kind: str, name: str) -> list[str]:
    """Return RAW HEX violations for one file's content.
    kind: 'html' or 'py'."""
    if kind == "html":
        text = HTML_COMMENT_RE.sub(_blank, text)
        text = CSS_COMMENT_RE.sub(_blank, text)
    else:
        text = _strip_py_comments(text)
    text = SVG_URI_RE.sub(_blank, text)
    text = VAR_FALLBACK_RE.sub(_blank, text)
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        for m in HEX_RE.finditer(line):
            out.append(f"RAW HEX {name}:{i}: {m.group(0)}")
    return out


def scan_palette(text: str, name: str) -> list[str]:
    """Return DUPLICATE PALETTE violations for one python file's content."""
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        m = PALETTE_DICT_RE.match(line)
        if m:
            out.append(
                f"DUPLICATE PALETTE {name}:{i}: {m.group(1)} dict literal "
                f"(import it from design.tokens instead)")
    return out


def scan_helper_link(text: str, name: str) -> list[str]:
    out = []
    if not re.search(r"<link[^>]*ml\.css", text):
        out.append(f"HELPER LINK {name}: no <link> referencing ml.css")
    if not re.search(r"data-theme\s*=", text):
        out.append(f"HELPER LINK {name}: no data-theme attribute "
                   f"(themes cannot switch without it)")
    return out


def check_raw_hex() -> list[str]:
    out = []
    for rel in HEX_SCAN_TARGETS:
        p = ROOT / rel
        if not p.exists():
            out.append(f"RAW HEX {rel}: file missing")
            continue
        kind = "py" if p.suffix == ".py" else "html"  # .md scans as html
        out.extend(scan_hex(p.read_text(), kind, rel))
    return out


def check_duplicate_palettes() -> list[str]:
    out = []
    for p in sorted((ROOT / "scripts").glob("*.py")):
        out.extend(scan_palette(p.read_text(), f"scripts/{p.name}"))
    return out


def check_drift() -> list[str]:
    """Regenerate from tokens.json in a temp dir; diff against committed."""
    design = ROOT / "design"
    out = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        shutil.copy(design / "tokens.json", tmp / "tokens.json")
        shutil.copy(design / "build_design.py", tmp / "build_design.py")
        r = subprocess.run([sys.executable, "build_design.py"], cwd=tmp,
                           capture_output=True, text=True)
        if r.returncode != 0:
            return [f"DRIFT design/build_design.py failed to run: "
                    f"{(r.stderr or r.stdout).strip()[:300]}"]
        for gen in ("ml.css", "tokens.py"):
            committed = design / gen
            if not committed.exists():
                out.append(f"DRIFT design/{gen}: missing — run "
                           f"python3 design/build_design.py and commit")
                continue
            if (tmp / gen).read_text() != committed.read_text():
                out.append(
                    f"DRIFT design/{gen}: differs from regeneration of "
                    f"design/tokens.json — either a generated file was "
                    f"hand-edited or tokens.json changed without rerunning "
                    f"python3 design/build_design.py")
    return out


def check_helper_link() -> list[str]:
    rel = "docs/draft_helper/index.html"
    p = ROOT / rel
    if not p.exists():
        return [f"HELPER LINK {rel}: file missing"]
    return scan_helper_link(p.read_text(), rel)


RULES = {
    "hex": ("RAW HEX", check_raw_hex),
    "palette": ("DUPLICATE PALETTES", check_duplicate_palettes),
    "drift": ("DRIFT", check_drift),
    "helper": ("HELPER LINK", check_helper_link),
}


# --------------------------------------------------------------- selftest
# Fixtures model the FINAL (design-system compliant) and violating states.
# Palette-dict lines are assembled by string concatenation so this file
# never itself matches PALETTE_DICT_RE.

GOOD_HTML = """<!DOCTYPE html>
<!-- legacy palette note: #ff0000 was the old danger red -->
<html lang="en" data-theme="dark">
<link rel="stylesheet" href="ml.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">
<link rel="icon" href="data:image/svg+xml;utf8,<svg><text fill='#f59e0b'>$</text></svg>">
<style>
/* was: border 1px solid #262b33 */
.hdr { background: linear-gradient(135deg, var(--ml-brand-a), var(--ml-brand-b)); }
.warn { color: var(--ml-warn, #f59e0b); background: var(--ml-panel); }
</style>
<a href="#board">board</a>
"""

BAD_HTML = """<style>
.x { color: #dc2626; }
.y { background: #fff; }
.z { border-color: #ABC; }
</style>
"""

GOOD_PY = """from design.tokens import POS_COLORS, MANAGER_COLORS, PALETTE
from design.tokens import report_base_css, mpl_style
# the old header teal #14b8a6 now lives in tokens.json
CSS = report_base_css() + "h1 { color: var(--ml-info, #0369a1); }"
"""

BAD_PY = (
    "HEADER_COLOR = '#0891b2'\n"
    "CSS = 'body { background: #f1f5f9; }'\n"
)

BAD_PALETTE_PY = (
    "POS_" + "COLORS = {\n"
    "    'QB': 'red',\n"
    "}\n"
    "MANAGER_" + "COLORS: dict = {}\n".replace("{}", "{ }")
    + "PALE" + "TTE = { 'gold': 'gold' }\n"
)

GOOD_PALETTE_PY = (
    "from design.tokens import POS_COLORS, MANAGER_COLORS, PALETTE\n"
    "MY_PALETTE_VIEW = dict(PALETTE)\n"
)

BAD_LINK_HTML = "<html><head><title>x</title></head><body></body></html>\n"


def selftest() -> int:
    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        print(f"  [{'ok ' if ok else 'FAIL'}] {name}"
              + (f" — {detail}" if detail and not ok else ""))
        if not ok:
            failures.append(name)

    print("fixture selftest:")
    v = scan_hex(GOOD_HTML, "html", "good.html")
    check("good HTML (comments, var fallback, svg uri) passes", not v, str(v))

    v = scan_hex(BAD_HTML, "html", "bad.html")
    check("bad HTML flags 3 raw hexes", len(v) == 3, str(v))
    check("bad HTML reports file:line",
          [x.split(":")[1] for x in v] == ["2", "3", "4"], str(v))
    check("bad HTML catches #rgb and case-insensitive",
          any("#ABC" in x for x in v) and any("#fff" in x for x in v), str(v))

    v = scan_hex(GOOD_PY, "py", "good.py")
    check("good py (comment hex, var fallback) passes", not v, str(v))

    v = scan_hex(BAD_PY, "py", "bad.py")
    check("bad py flags hex in strings (2)", len(v) == 2, str(v))

    v = scan_palette(GOOD_PALETTE_PY, "good.py")
    check("palette imports pass", not v, str(v))

    v = scan_palette(BAD_PALETTE_PY, "bad.py")
    check("all 3 palette dict literals flagged", len(v) == 3, str(v))

    v = scan_helper_link(GOOD_HTML, "good.html")
    check("helper with ml.css link + data-theme passes", not v, str(v))

    v = scan_helper_link(BAD_LINK_HTML, "bad.html")
    check("helper missing link and data-theme flags both", len(v) == 2, str(v))

    check("this checker file itself defines no palette dicts",
          not scan_palette(Path(__file__).read_text(),
                           "scripts/check_design_system.py"))

    print()
    if failures:
        print(f"selftest: {len(failures)} assertion(s) FAILED")
        return 1
    print("selftest: all assertions passed")
    return 0


# ------------------------------------------------------------------- main

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fixture-selftest", action="store_true",
                    help="validate the scanner against embedded fixtures")
    ap.add_argument("--only", action="append", choices=sorted(RULES),
                    help="run only the named rule(s)")
    args = ap.parse_args(argv)

    if args.fixture_selftest:
        return selftest()

    selected = args.only or list(RULES)
    all_violations: list[str] = []
    for key in RULES:
        if key not in selected:
            continue
        label, fn = RULES[key]
        violations = fn()
        print(f"{label}: {len(violations)} violation(s)")
        for v in violations:
            print(f"  FAIL {v}")
        all_violations.extend(violations)

    print()
    if all_violations:
        print(f"✗ design-system check FAILED with {len(all_violations)} "
              f"violation(s). Fix: use --ml-* vars / ml-* classes, import "
              f"design.tokens, and regenerate via design/build_design.py.")
        return 1
    print("✓ design-system check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
