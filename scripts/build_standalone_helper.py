"""Rebuild docs/draft_helper/standalone.html from index.html + data.json.

The standalone variant inlines data.json as a JS constant so the helper works
from file://, htmlpreview.github.io, or any host that can't serve a sibling
data.json. Fails LOUDLY if index.html's structure drifted and the string
replacements no longer match — a silent no-op here would ship a standalone
that still tries to fetch("data.json") and breaks off-server.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "docs" / "draft_helper"

DATA_DECL = 'const DATA_URL = "data.json";\nlet DATA = null;'
FETCH_INIT = """(async function init() {
  const resp = await fetch(DATA_URL);
  DATA = await resp.json();"""
INLINE_INIT = """(async function init() {
  DATA = EMBEDDED_DATA;"""


def main() -> None:
    html = (HELPER / "index.html").read_text()
    data = (HELPER / "data.json").read_text()

    if DATA_DECL not in html:
        sys.exit("ERROR: index.html no longer contains the DATA_URL declaration "
                 "this script expects — update DATA_DECL in "
                 "scripts/build_standalone_helper.py to match.")
    if FETCH_INIT not in html:
        sys.exit("ERROR: index.html's init() block changed — update FETCH_INIT "
                 "in scripts/build_standalone_helper.py to match.")

    html = html.replace(
        DATA_DECL,
        f"const EMBEDDED_DATA = {data};\nconst DATA_URL = null;\nlet DATA = null;",
    )
    html = html.replace(FETCH_INIT, INLINE_INIT)

    assert "EMBEDDED_DATA" in html
    assert "await fetch(DATA_URL)" not in html, "fetch call survived the inline"

    out = HELPER / "standalone.html"
    out.write_text(html)
    print(f"Wrote {out.relative_to(ROOT)} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
