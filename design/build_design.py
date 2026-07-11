"""Generate the design-system artifacts from design/tokens.json.

    python3 design/build_design.py

Emits (commit all of these together):
  design/ml.css    — component library + CSS custom properties (dark + light)
  design/tokens.py — Python constants + report_base_css() + mpl_style()

Both files carry DO-NOT-EDIT headers; they are build products.
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
T = json.loads((HERE / "tokens.json").read_text())

POS = T["color"]["position"]
SEM = T["color"]["semantic"]
DARK = T["color"]["surface"]["dark"]
LIGHT = T["color"]["surface"]["light"]
BAN = T["color"]["banner"]
CHART = T["color"]["chart"]
BRAND = T["color"]["brand"]
TYPE = T["typography"]
RAD = T["radius"]


def build_css() -> str:
    pos_vars_dark = "\n".join(f"  --ml-pos-{k.lower()}: {v};" for k, v in POS.items())
    sem_dark = "\n".join(f"  --ml-{k}: {v['dark']};" for k, v in SEM.items())
    sem_light = "\n".join(f"  --ml-{k}: {v['light']};" for k, v in SEM.items())
    surf = lambda s: "\n".join(f"  --ml-{k}: {v};" for k, v in s.items())

    pos_badges = "\n".join(
        f'.ml-badge--{k.lower()} {{ background: var(--ml-pos-{k.lower()}); color: #fff; }}'
        for k in POS)
    pos_text = "\n".join(
        f'.ml-pos-{k.lower()} {{ color: var(--ml-pos-{k.lower()}); }}' for k in POS)
    pos_filters = "\n".join(
        f'.ml-filter--{k.lower()}.active {{ background: var(--ml-pos-{k.lower()});'
        f' border-color: var(--ml-pos-{k.lower()}); color: #fff; }}'
        for k in POS)

    return f"""/* ============================================================
   MONEYLEAGUE design system — GENERATED from design/tokens.json.
   DO NOT EDIT BY HAND: run  python3 design/build_design.py
   ============================================================ */

:root, [data-theme="dark"] {{
{surf(DARK)}
{pos_vars_dark}
{sem_dark}
  --ml-banner-warn-bg: #2a2115;
  --ml-banner-warn-border: #7c5a2b;
  --ml-font-display: {TYPE['display']};
  --ml-font-body: {TYPE['body']};
  --ml-r-sm: {RAD['sm']}; --ml-r-md: {RAD['md']}; --ml-r-lg: {RAD['lg']};
  --ml-brand-a: {BRAND['header_a']}; --ml-brand-b: {BRAND['header_b']};
}}
[data-theme="light"] {{
{surf(LIGHT)}
{sem_light}
  --ml-banner-warn-bg: {BAN['warn_bg']};
  --ml-banner-warn-border: {BAN['warn_border']};
}}

/* ---------- primitives ---------- */
.ml-panel {{ background: var(--ml-panel); border: 1px solid var(--ml-border);
  border-radius: var(--ml-r-lg); padding: 10px; }}
.ml-panel > h2, .ml-h-label {{ margin: 0 0 8px; font-size: 12px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1px; color: var(--ml-muted); }}
.ml-card {{ border: 1px solid var(--ml-border); border-radius: var(--ml-r-md);
  padding: 4px 7px; background: var(--ml-panel); break-inside: avoid; }}
.ml-display {{ font-family: var(--ml-font-display); letter-spacing: .5px; }}

/* ---------- badges & chips ---------- */
.ml-badge {{ display: inline-block; padding: 1px 5px; border-radius: var(--ml-r-sm);
  font-size: 10px; font-weight: 700; color: #fff; min-width: 24px; text-align: center; }}
{pos_badges}
.ml-badge--dst {{ background: var(--ml-pos-def); color: #fff; }}
.ml-badge--keeper {{ background: var(--ml-keeper); color: #000; padding: 1px 4px;
  font-size: 9px; min-width: 0; }}
.ml-badge--rookie {{ background: var(--ml-warn); color: #000; padding: 1px 4px;
  font-size: 9px; min-width: 0; }}
.ml-badge--injury {{ background: var(--ml-danger); color: #fff; padding: 1px 4px;
  font-size: 9px; min-width: 0; }}
{pos_text}
.ml-stat {{ background: var(--ml-panel2); padding: 3px 8px; border-radius: 4px;
  font-size: 11px; color: var(--ml-muted); }}
.ml-stat strong {{ color: var(--ml-text); }}

/* ---------- buttons & inputs ---------- */
.ml-btn {{ background: var(--ml-panel2); border: 1px solid var(--ml-border);
  color: var(--ml-text); padding: 4px 10px; border-radius: var(--ml-r-md);
  cursor: pointer; font-size: 12px; }}
.ml-btn:hover {{ filter: brightness(1.2); }}
.ml-btn--hdr {{ background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.3);
  color: #fff; padding: 6px 12px; font-weight: 700; letter-spacing: .5px; }}
.ml-btn--on {{ background: var(--ml-danger); border-color: var(--ml-danger);
  color: #fff; animation: ml-pulse 1.4s infinite; }}
.ml-input {{ background: var(--ml-panel2); border: 1px solid var(--ml-border);
  color: var(--ml-text); padding: 6px 10px; border-radius: var(--ml-r-md);
  font-size: 14px; }}
.ml-filter {{ background: var(--ml-panel2); border: 1px solid var(--ml-border);
  color: var(--ml-text); padding: 4px 9px; border-radius: var(--ml-r-md);
  cursor: pointer; font-size: 12px; font-weight: 700; }}
.ml-filter.active {{ background: var(--ml-success); color: #000;
  border-color: var(--ml-success); }}
{pos_filters}

/* ---------- status / clock ---------- */
@keyframes ml-pulse {{ 0%,100% {{ box-shadow: 0 0 0 0 rgba(74,222,128,.6); }}
  50% {{ box-shadow: 0 0 0 8px rgba(74,222,128,0); }} }}
.ml-clock {{ font-weight: 700; font-size: 13px; padding: 6px 10px;
  border-radius: 6px; background: rgba(0,0,0,0.35); }}
.ml-clock--me {{ background: var(--ml-success); color: #000;
  animation: ml-pulse 1.4s infinite; }}
.ml-clock--soon {{ background: var(--ml-warn); color: #000;
  animation: ml-pulse 1.4s infinite; }}
.ml-sv-hi {{ color: var(--ml-success); font-weight: 700; }}
.ml-sv-mid {{ color: var(--ml-warn); font-weight: 700; }}
.ml-sv-lo {{ color: var(--ml-danger); font-weight: 700; }}

/* ---------- tables ---------- */
.ml-table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
.ml-table th {{ text-align: left; padding: 4px 6px; color: var(--ml-muted);
  font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
  border-bottom: 1px solid var(--ml-border); position: sticky; top: 0;
  background: var(--ml-panel); z-index: 1; }}
.ml-table td {{ padding: 6px; border-bottom: 1px solid var(--ml-row); }}
.ml-table--compact {{ font-size: 7.6pt; }}
.ml-table--compact td {{ padding: 1px 2px; }}

/* ---------- banners & notes ---------- */
.ml-banner {{ background: var(--ml-panel2); border-radius: var(--ml-r-md);
  padding: 4px 8px; }}
.ml-banner--warn {{ background: var(--ml-banner-warn-bg);
  border: 1px solid var(--ml-banner-warn-border); border-radius: var(--ml-r-md);
  padding: 4px 8px; }}
.ml-note {{ color: var(--ml-muted); font-size: .85em; }}
.ml-urgent {{ color: var(--ml-danger); font-weight: 700; }}
"""


def build_py() -> str:
    return f'''"""GENERATED from design/tokens.json — DO NOT EDIT BY HAND.
Regenerate with:  python3 design/build_design.py

Single import point for every Python UI surface:
    from design.tokens import POS_COLORS, MANAGER_COLORS, PALETTE
    from design.tokens import report_base_css, mpl_style
"""
from __future__ import annotations

POS_COLORS = {json.dumps(POS, indent=4)}
POS_COLORS["DST"] = POS_COLORS["DEF"]

MANAGER_COLORS = {json.dumps(T["color"]["manager"], indent=4)}

PALETTE = {json.dumps(T["color"]["palette"], indent=4)}

SEMANTIC_LIGHT = {json.dumps({k: v["light"] for k, v in SEM.items()}, indent=4)}
SEMANTIC_DARK = {json.dumps({k: v["dark"] for k, v in SEM.items()}, indent=4)}

SURFACE_LIGHT = {json.dumps(LIGHT, indent=4)}
SURFACE_DARK = {json.dumps(DARK, indent=4)}

BANNER = {json.dumps(BAN, indent=4)}
CHART = {json.dumps(CHART, indent=4)}
BRAND = {json.dumps(BRAND, indent=4)}

FONT_DISPLAY = {json.dumps(TYPE["display"])}
FONT_BODY = {json.dumps(TYPE["body"])}
FONT_DIR = {json.dumps(TYPE["font_dir"])}


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
body {{ font-family: var(--ml-font-body); color: var(--ml-text); }}
h1, h2, h3 {{ font-family: var(--ml-font-display); letter-spacing: .5px; }}
.page-break {{ page-break-after: always; }}
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
    plt.rcParams.update({{
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
    }})
'''


def main() -> None:
    css = build_css()
    py = build_py()
    (HERE / "ml.css").write_text(css)
    (HERE / "tokens.py").write_text(py)
    (HERE / "__init__.py").write_text(
        '"""MONEYLEAGUE design system (generated artifacts inside)."""\n')
    print(f"Wrote design/ml.css ({len(css):,} bytes), design/tokens.py "
          f"({len(py):,} bytes)")


if __name__ == "__main__":
    main()
