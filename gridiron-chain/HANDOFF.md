# GridironChain — Session Handoff

## Project Goal
Vanilla HTML/CSS/JS football franchise simulation game. No build tools. All state in `localStorage`. Runs directly from a single HTML file served via rawcdn.

## Live Link (always use commit-pinned rawcdn — branch URL is cached)
```
https://rawcdn.githack.com/blackjakk/datasciencecoursera/6ff0f112aa189df4649d70029d3f12bde5947de4/gridiron-chain/play.html
```

## Repo
- **Repo:** `blackjakk/datasciencecoursera`
- **Branch:** `claude/football-sim-blockchain-game-b3sdq`
- **PR:** https://github.com/blackjakk/datasciencecoursera/pull/1
- **Latest commit:** `6ff0f112aa189df4649d70029d3f12bde5947de4`

---

## Key Files
| File | Purpose |
|------|---------|
| `gridiron-chain/play.html` | Entry point |
| `gridiron-chain/play.css` | All styles (no build) |
| `gridiron-chain/play-franchise-core.js` | Engine: cap, contracts, depth chart init, PS, FA AI |
| `gridiron-chain/play-franchise-season.js` | Season UI: FA screens, negotiations, PS tab, scout |
| `gridiron-chain/play-franchise-stats.js` | Stats UI: depth chart, regular season dashboard |
| `gridiron-chain/play-franchise-offseason.js` | Offseason UI: re-signs, draft room |

---

## Architecture
- All modules load as globals (no imports/exports)
- `franchise` object = entire save state, persisted via `saveFranchise()` → `localStorage`
- `franchise.depthChart[teamId][slotKey]` = `{ starter: pid, backup: pid, flex, snapFloor, snapCeil }`
- `franchise.snapShares[teamId][slotKey]` = `{ starterPct, manual }`
- `franchise.faNegotiations[negKey]` = in-season FA bidding state
- `franchise.freeAgents[]` = preseason FA pool (emptied when season starts)
- `franchise.rosters[teamId][]` = player objects with `.pid`, `.position`, `.overall`, `.contract`, `.injury`

### CSS Variables
`--gold`, `--bg`, `--bg2`, `--bg3`, `--border`, `--gray`, `--blgray`, `--red`, `--green-lt`, `--gold-lt`, `--blwhite`

### CSS Class Namespaces
- `frn-dc-*` — depth chart table layout (current)
- `frn-depth2-*` — previous depth chart cards (kept for compatibility)
- `frn-fa-*` — FA pool and negotiations screens
- `frn-depth-*` — original depth chart (legacy, still referenced in CSS)

---

## Key Constants & Functions

```js
// core.js
DEPTH_CHART_SLOTS        // slot definitions: { key, pos, flex, snapFloor, snapCeil }
_initDepthChart(teamId)  // two-pass cascade init — starters first, then backups
_optimizeSnapShares(teamId) // recalc snap % after roster changes
deadCapOnRelease(p)      // returns { perYear, years }
potentialTag(p, {known}) // returns ceiling/bust label string
psCostForTeam(teamId)    // PS cap hit

// stats.js
DEPTH_POS_GROUPS         // visual grouping array for renderer
renderFrnDepthChart()    // main depth chart page
frnDepthSwap(posKey, idx)    // reorder slots within position group
frnDepthSwapInSlot(slotKey)  // swap starter↔backup within one slot
frnDepthAutoSetOVR()         // delete + reinit chart by OVR order
gradeBadge(p)            // colored grade pill HTML
frnTeamRating(teamId)    // returns { off, def }

// offseason.js
_draftNeedLevel(teamId, pos) // 0=fine / 1=thin / 2=need
_posPillHtml(pos)            // colored position pill HTML

// season.js
renderFrnFA(selectedKey)         // preseason FA pool screen
renderFrnFANegotiations(name)    // in-season FA negotiations screen (3-col layout)
frnFACapLiveUpdate(aav)          // live cap bar update without full re-render
_scoutNeedsBar(myId)             // horizontal needs pill bar
_faNeedsSnippet(teamId, pos)     // vertical needs list for FA sidebar
```

---

## What Was Built This Session

### 1. Depth Chart — Full Visual Redesign
**Layout:** Table-row format. Each slot = one full-width row:
`SLOT LABEL | ★ STARTER | snap bar | ▸ BACKUP | controls`

**Features:**
- Unit strength strip at top (9 units: QB/RB/WR/TE/OL/DL/LB/CB/S)
- Per-group headers with ELITE/STRONG/SOLID/AVG/THIN badge (color-coded by avg starter OVR)
- Vertical snap-share bar (gradient fill) between starter and backup columns
- Alternating row tints on long groups (WR×4, OL×5, DL×4)
- EXP badge (contract.remaining ≤ 1), potential tag, injury badge, trade block badge
- Unassigned panel at bottom for players not placed in any slot
- `⟳ AUTO-SET OVR` button resets entire chart

**Cascade backup logic** (the key insight):
For sequential multi-slot groups (WR, OL, DL, LB, CB, TE):
```
slot[i].backup = slot[i+1].starter
```
WR1's backup IS the WR2 starter — they slide up on injury. The WR4 slot (last) gets a true dedicated backup from remaining roster. SS/FS remain independent (distinct roles).

Cascade slots display a teal **⤴ WR2** badge. No ▲ promote button (already a starter elsewhere).

**Two-pass init fix:** Pass 1 fills ALL starter slots before any backups → RG, RT, DL4, NB etc. get starters even with thin rosters.

### 2. FA Screen Fix
- FA Negotiations checklist item on weekly dashboard now always visible
- Previously only showed when `activeNegs.length > 0` — now always present with "Browse free agents" subtitle when idle

### 3. Earlier This Session (already committed)
- Depth chart redesigned first as two-deep card grid (then replaced by table-row design above)
- `frnDepthSwapInSlot` and `frnDepthAutoSetOVR` functions added

### 4. Previous Session (already committed, stable)
- `renderFrnFANegotiations` fully rewritten — 3-column layout matching preseason FA screen
- FA bid results 2-line card (fixed text clipping on destination)
- Player name clicks fixed in scout table, roster tab rows, threat cards
- Scout MY NEEDS horizontal pill bar (`_scoutNeedsBar`)
- Live cap math on AAV input (`frnFACapLiveUpdate`)
- Practice Squad tab (`_buildPSTab`, `frnPSPromote`, `frnPSStash`)
- Hover tooltip event delegation fix

---

## Hard Constraints

1. **No build tools** — pure vanilla JS, edit files directly
2. **Syntax check before every commit:**
```bash
node -e "const fs=require('fs');const src=fs.readFileSync('gridiron-chain/play-franchise-stats.js','utf8');try{new Function(src);console.log('OK')}catch(e){console.log('Error: '+e.message)}"
```
3. **Large replacements** fail with the Edit tool (old_string not found on multi-hundred-line blocks) → use Python:
```python
python3 - <<'PYEOF'
with open('gridiron-chain/play-franchise-stats.js', 'r') as f:
    lines = f.readlines()
with open('/tmp/replacement.js', 'r') as f:
    replacement = f.read()
before = lines[:LINE_START]   # 0-indexed
after  = lines[LINE_END:]
open('gridiron-chain/play-franchise-stats.js', 'w').write(''.join(before) + replacement + '\n' + ''.join(after))
PYEOF
```
4. **Stop hook** enforces no uncommitted changes — commit immediately after edits
5. **Push command:** `git push -u origin claude/football-sim-blockchain-game-b3sdq`
6. **Always provide commit-pinned rawcdn link** after every push:
```
https://rawcdn.githack.com/blackjakk/datasciencecoursera/{FULL_40_CHAR_SHA}/gridiron-chain/play.html
```
Get full SHA with: `git rev-parse HEAD`

---

## Reusable System Prompt for New Chat

> We're working on **GridironChain** — a vanilla HTML/CSS/JS football franchise sim, no build tools, all state in localStorage. Branch `claude/football-sim-blockchain-game-b3sdq` on `blackjakk/datasciencecoursera`. Key files: `play-franchise-core.js` (engine), `play-franchise-season.js` (season UI), `play-franchise-stats.js` (stats/depth chart UI), `play-franchise-offseason.js` (offseason UI), `play.css`. Always syntax-check with `node -e "new Function(src)"` before committing. Use Python for large string replacements. Push to the branch after every change and provide a commit-pinned rawcdn link: `https://rawcdn.githack.com/blackjakk/datasciencecoursera/{SHA}/gridiron-chain/play.html`. Latest commit: `6ff0f112aa189df4649d70029d3f12bde5947de4`.

---

## Possible Next Steps (not yet started)
- Snap share editor UI polish (`renderFrnSnapShares` exists)
- Mid-season FA pool (cut players available to sign during regular season)
- Drag-to-reorder slots instead of ↑↓ buttons on depth chart
- Any other screens the user flags
