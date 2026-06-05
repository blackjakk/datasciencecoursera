# Next-session pickup message

Paste this verbatim into the next chat to resume.

---

## Repo + state

- Repo: `/home/user/datasciencecoursera/gridiron-chain/`
- Branch: `claude/charming-brown-b18u2` (pushed, working tree clean as of `ba248ad`)
- Read `HANDOFF.md` § 3 for full context. Read `REFACTOR_POSITION_CONTRACT.md`
  for the position-contract refactor's complete execution log.
- Two skills are at user-level (`~/.claude/skills/`): `stage-gated-refactor`
  (general methodology) and `teleport-check` (regression gate for this repo).
  Both trigger automatically on the right phrases.

## What just shipped (last session)

Position-contract refactor, Stages 0-11. Egregious teleport plays:
**138 → 6 (96% reduction)**. Runs structurally clean (0 / 6 flagged).
22 commits total: 4 pre-refactor + 11 stage commits + 5 stage docs commits +
1 trace tool + 1 chore. Stage 8 was superseded by Stage 9 — both kept in
git history with the supersession recorded in the contract doc.

## Detector floor (Stage 11)

```bash
cd /home/user/datasciencecoursera/gridiron-chain
node _teleport_capture.js 4
nohup npx --yes http-server -p 5173 -c-1 -s . > /tmp/dev-server.log 2>&1 &
sleep 3
node _teleport_detect.js tactical
pgrep -f "http-server -p 5173" | xargs -r kill 2>/dev/null
```

Expected: **~6 egregious plays out of ~300**. If more than ~10, regression
investigate. Use the `teleport-check` skill.

## What's open (6 remaining egregious plays, scattered)

Two patterns, both timing-window per-play edge cases not class issues:

1. **TD-celebration window `complete/wr1`** × 3 plays at f452+ (worst 15.7 yd).
   Likely interacts with `animState.slowMoUntil` slow-mo window at the
   celebration transition. Worth instrumenting via `_inc_trace.js` at the
   next user report — point it at TD complete plays.
2. **`complete/rb` checkdown + `complete/wr2` outliers** × 3 plays
   (7-10 yd). Per-play handoff timing.

Both fall under "per-instance trace via `_inc_trace.js`, then targeted
source-of-truth fix." Documented in `REFACTOR_POSITION_CONTRACT.md` under
"What's NOT closed yet (after Stage 11)".

## Suggested next moves (in priority order)

1. **Wire the detector into CI / pre-commit** (contract doc Stage 6
   — explicitly unfinished). Without a regression gate, the 96% can
   erode silently. One bash script + a hook. The `teleport-check` skill
   describes the exact command.
2. **Close one or two of the remaining 6 plays** if a user reports
   them in-game. Use `_inc_trace.js`, follow the source-of-truth pattern
   from any prior stage as a template.
3. **TypeScript pass on `play-animation.js`** (10k lines, no types).
   The Stage 4 `_lastRenderedX` vs `formation.x` family-A bug would be
   caught statically with distinct `RenderedPosition` / `FormationSlot`
   types. Long but high-value.
4. **Sprite / animation polish** continues from the prior session's
   arc (§ 3A in HANDOFF.md). Independent of the position refactor.

## What NOT to do without checking

- Don't add hardcoded position constants to `play-animation.js`. The
  Family-A pattern always reappears: whoever adds `dd.x = d.x + ...`
  re-creates a snap teleport.
- Don't touch `_wrLastX` updating without re-reading Stage 8 → Stage 9
  in the contract doc. The route's projection must NOT update
  `_wrLastX` post-throwPhase.
- Don't change the engine's `play.motion.tracks` waypoint format
  (`{ t, dxYd, dyYd }`) without updating `_alignT0` in `play-animation.js`
  and the renderer's track-sampling sites.

---

That's it. Ask me what you'd like to pick up. Or just say "run the
teleport check" to verify the floor.
