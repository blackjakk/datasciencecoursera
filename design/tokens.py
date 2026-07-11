"""GENERATED from design/tokens.json — DO NOT EDIT BY HAND.
Regenerate with:  python3 design/build_design.py

Single import point for every Python UI surface:
    from design.tokens import POS_COLORS, MANAGER_COLORS, PALETTE
    from design.tokens import report_base_css, mpl_style
"""
from __future__ import annotations

POS_COLORS = {
    "QB": "#dc2626",
    "RB": "#0e7490",
    "WR": "#15803d",
    "TE": "#f59e0b",
    "K": "#9a3412",
    "DEF": "#6b6b6b"
}
POS_COLORS["DST"] = POS_COLORS["DEF"]

MANAGER_COLORS = {
    "trevor_bergerboy": "#2d6a4f",
    "coop": "#1f3a5f",
    "dave_aka_wang": "#8b1e3f",
    "kyle_figgy": "#f59e0b",
    "brower_barry": "#0891b2",
    "ankur_patel": "#7c3aed",
    "eric_m": "#dc2626",
    "troy_mullings": "#15803d",
    "brian_bigguap": "#1e40af",
    "lem": "#65a30d",
    "donnie": "#9a3412",
    "tim_breswick": "#0f172a",
    "josh_wildboy": "#a855f7",
    "nark": "#78716c",
    "jp_former": "#525252",
    "nick_lewis_left": "#737373",
    "notebooks_left": "#a3a3a3"
}

PALETTE = {
    "gold": "#d4a017",
    "navy": "#0a3d62",
    "teal": "#1f7a8c",
    "emerald": "#2d6a4f",
    "orange": "#dd6e42",
    "crimson": "#a23737",
    "slate": "#3d405b",
    "cream": "#f7f4ea",
    "ink": "#1a1d24",
    "gray": "#6b7280"
}

SEMANTIC_LIGHT = {
    "success": "#15803d",
    "warn": "#b45309",
    "danger": "#c81e1e",
    "info": "#0369a1",
    "keeper": "#0369a1",
    "focus": "#0369a1"
}
SEMANTIC_DARK = {
    "success": "#4ade80",
    "warn": "#f59e0b",
    "danger": "#f87171",
    "info": "#60a5fa",
    "keeper": "#60a5fa",
    "focus": "#7dd3fc"
}

SURFACE_LIGHT = {
    "bg": "#ffffff",
    "panel": "#ffffff",
    "panel2": "#f1f5f9",
    "border": "#d8dce2",
    "border_strong": "#767f8b",
    "row": "#f0f2f5",
    "text": "#1a1d24",
    "muted": "#5d6673"
}
SURFACE_DARK = {
    "bg": "#0b0d10",
    "panel": "#14171c",
    "panel2": "#1c2027",
    "border": "#262b33",
    "border_strong": "#66707d",
    "row": "#1a1d22",
    "text": "#e8eaee",
    "muted": "#8a93a0"
}

HIGHLIGHT = {
    "target": {
        "dark": "rgba(74,222,128,.16)",
        "light": "rgba(21,128,61,.10)"
    },
    "mine": {
        "dark": "rgba(74,222,128,.18)",
        "light": "rgba(21,128,61,.12)"
    }
}

BANNER = {
    "warn_bg": "#fff7ed",
    "warn_border": "#fed7aa"
}
CHART = {
    "grid": "#e5e7eb",
    "grid_strong": "#d1d5db"
}
BRAND = {
    "header_a": "#0f766e",
    "header_b": "#0e7490",
    "on_brand": "#ffffff"
}

FONT_DISPLAY = "'Bebas Neue', 'Arial Narrow', sans-serif"
FONT_BODY = "'Inter', -apple-system, 'Segoe UI', sans-serif"
FONT_DIR = "data/fonts"


def mgr_color(mid: str | None) -> str:
    """Manager brand color (stable across every chart and report)."""
    return MANAGER_COLORS.get(mid or "", PALETTE["gray"])


def report_base_css() -> str:
    """Shared CSS base for the PDF report builders (light theme). Report
    scripts append only page-specific rules after this."""
    from pathlib import Path
    css = (Path(__file__).parent / "ml.css").read_text()
    return (
        css
        + """
/* report defaults (light) */
body { font-family: var(--ml-font-body); color: var(--ml-text); }
h1, h2, h3 { font-family: var(--ml-font-display); letter-spacing: .5px; }
.page-break { page-break-after: always; }
"""
    )


_MPL_DONE = False


def mpl_style() -> None:
    """Register league fonts + apply the standard chart style. Replaces the
    per-script _setup_mpl() copies. Safe to call repeatedly."""
    global _MPL_DONE
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.font_manager as fm
    import matplotlib.pyplot as plt
    from pathlib import Path
    if not _MPL_DONE:
        root = Path(__file__).resolve().parent.parent
        for f in (root / FONT_DIR).glob("*.ttf"):
            try:
                fm.fontManager.addfont(str(f))
            except Exception:
                pass
        _MPL_DONE = True
    plt.rcParams.update({
        "font.family": ["Inter", "DejaVu Sans"],
        "font.size": 10,
        "axes.facecolor": SURFACE_LIGHT["bg"],
        "figure.facecolor": SURFACE_LIGHT["bg"],
        "axes.edgecolor": PALETTE["gray"],
        "axes.labelcolor": PALETTE["ink"],
        "axes.titleweight": "bold",
        "axes.titlesize": 13,
        "axes.titlecolor": PALETTE["ink"],
        "axes.spines.top": False,
        "axes.spines.right": False,
        "xtick.color": PALETTE["gray"],
        "ytick.color": PALETTE["gray"],
        "grid.color": CHART["grid"],
        "grid.alpha": 0.7,
    })
