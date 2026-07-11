# /goal — MONEYLEAGUE Design System

**End-to-end goal**: every UI surface in this repo (draft helper SPA, 4
PDF report builders, matplotlib charts) consumes ONE design system —
single-sourced tokens, a reusable component library, zero duplicated
palettes or style blocks — with an enforcement check that makes bypassing
impossible and a review skill that keeps future UI honest. Complete =
architecture + implementation + tests + review all landed on master,
validated end-to-end in a real browser and in regenerated PDFs.

## Architecture

```
design/tokens.json          ← THE single source (colors, type, radii, spacing)
design/build_design.py      ← generator (run via refresh pipeline)
        ├→ design/ml.css    ← component library for HTML surfaces (dark+light)
        └→ design/tokens.py ← Python constants + report_base_css() + mpl_style()
```

Consumers:
- `docs/draft_helper/index.html` links `ml.css`; standalone builder inlines it
- `scripts/build_{power_rankings,preseason_2026,mock_draft_report,round_menu}.py`
  import `design.tokens` (POS_COLORS, MANAGER_COLORS, report_base_css, mpl_style)
- `scripts/check_design_system.py` fails verify on raw hex / duplicate palettes
  outside `design/`
- `.claude/skills/design-review/` reviews future UI diffs for compliance

## Workstream goals (one agent each)

### Agent A — helper migration
Deliverable: index.html restyled onto ml.css classes/vars (behavior JS
untouched), build_standalone_helper.py inlines ml.css, page-specific CSS
< 40 lines. Verification: Playwright — init (4 keepers, 200 players),
click-pick, undo, search, pos filter, CEILING toggle, full PRACTICE draft
+ grade + exit-restore, zero JS errors. Standard: all flows pass, no raw
hex colors left in index.html outside var() references.

### Agent B — report migration
Deliverable: 4 builders import design.tokens; local POS_COLORS/PALETTE/
MANAGER_COLORS/_setup_mpl deleted; <style> blocks reduced to page-specific
rules on top of report_base_css(). Verification: all 4 PDFs regenerate
non-trivially (>100KB, round menu stays 1 page), scripts/verify_outputs.py
passes. Standard: `grep -c '#[0-9a-f]\{6\}'` in the 4 scripts ≈ 0 outside
imports/comments.

### Agent C — enforcement + review skill
Deliverable: scripts/check_design_system.py (scans helper + report scripts
for raw hex literals, duplicate palette dicts, missing ml.css link),
wired into verify_outputs.py; .claude/skills/design-review/SKILL.md
(review checklist: tokens only, components used, both themes, contrast);
docs/DESIGN_SYSTEM.md (tokens reference, component catalog, usage rules,
"all new UI goes through the library — no bypassing"). Verification:
check passes on the migrated tree and FAILS when a raw hex is planted in
a consumer file (self-test). Standard: check runs in refresh_all verify.

## Integration standard (orchestrator)
- No conflicts between agent outputs; single coherent commit series
- `scripts/refresh_all.sh sim reports verify` green (includes new check)
- Browser click-through of every helper flow on the migrated build
- PDFs visually sane (screenshot spot-check)
- Merged to master, pushed, helper synced to Pages branch
