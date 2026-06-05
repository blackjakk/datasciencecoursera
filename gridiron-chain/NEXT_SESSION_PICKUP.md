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

## Detector floor — now DETERMINISTIC (seeded)

The capture is now seeded (`_teleport_capture.js` overrides `Math.random` with a
mulberry32 stream in its eval scope only — the shipped engine stays stochastic).
Same seed → byte-identical battery → reproducible count. One command:

```bash
cd /home/user/datasciencecoursera/gridiron-chain
./_teleport_gate.sh          # capture(seed=1337,4 games) → detect → compare baseline
```

**Reproducible floor: 11 egregious / 336 plays** on the seed=1337 battery
(`_teleport_baseline.json`). The gate exits 0 if ≤ baseline, 1 on regression.

> ⚠️ The old "floor is 6, alarm if >10" was a SINGLE UNSEEDED draw. On identical
> code the unseeded count ranged **4–13** run-to-run, so that gate would have
> false-alarmed on its own committed code. 11 is not a regression — it's the same
> code measured honestly. See `REFACTOR_POSITION_CONTRACT.md` § "Determinism".

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

1. **Finish wiring the gate into CI / pre-commit.** The deterministic gate
   itself now exists: `_teleport_gate.sh` (seeded capture → detect → compare
   `_teleport_baseline.json`, exit 1 on regression). What remains is the
   *trigger*: a pre-commit hook (cheap) and/or a GitHub Action. NOTE the
   detector hardcodes the Playwright path `/opt/node22/...`; a GH-Actions
   workflow must install Playwright + browsers and a static server first, so
   that's a real (small) design step, not a copy-paste.
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
