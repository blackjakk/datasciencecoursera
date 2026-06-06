# Draft Rework — "the crown jewel"

*Goal: turn the draft from a click-to-pick board into a live, on-the-clock event
with real trade-down, designed so multiplayer is an extension — not a rewrite.*

Status: **DESIGN.** No production code changed by this doc.

---

## 1. What already exists (we build ON this, not from scratch)

The foundation is surprisingly complete — the rework is mostly *integrate + add a
clock + abstract the controller*, not a ground-up build.

| Piece | Where | Reuse for |
|---|---|---|
| Sequential draft state machine | `franchise.draft = { class, pickOrder, picks, currentIdx, … }` (`offseason.js:18297`) | The turn loop — `pickOrder[currentIdx]` IS "on the clock" |
| Draft board + pick flow | `renderFrnDraft` (21429), `frnDraftPick(name)` (22579), `frnAutoPickThisSlot` (22260), `_draftFinalize` (22716) | The pick action + AI pick |
| **Tradeable pick assets** | `franchise.picks` = `[{ year, round, …, currentOwnerId }]` (`_initFranchisePicks` 14591) | Trade-down: picks change `currentOwnerId` |
| **Pick value chart** | `_pickValue(pick)` (14625) | Trade-down valuation (already analytics-tuned) |
| **Full trade engine** | offseason: `_tradePickKey`/`_tradePickFromKey`, `_playerTradeValue`, suggested-target value (~16469), AI willingness | Trade-down: reuse the SAME valuation + AI accept logic, in-draft |
| "Until you're on the clock" | 18654 / 18748 | Already counts picks to the user's slot — just not a live clock |

**The gap** between this and the user's vision is exactly three things:
1. **On the clock** — there's no live timer; you pick whenever, AI picks resolve
   instantly. Needs a countdown + paced AI + auto-pick on expiry.
2. **Trade DOWN** — the trade engine is offseason-only; it isn't wired into the
   live board. Needs AI teams below offering to move up, and the user able to
   shop/accept while on the clock.
3. **Multiplayer** — doesn't exist. Needs an architecture (below) so it's an
   addition.

---

## 2. The core model — an action-sourced turn state machine

Refactor the draft loop (even for single-player) into a tiny, deterministic state
machine. This is the single most important decision: it's what makes trade-down
clean AND makes multiplayer a controller/transport addition instead of a rewrite.

**State** (mostly already in `franchise.draft`):
```
draft = {
  class,                 // prospects
  pickOrder: [teamId…],  // resolves live from franchise.picks ownership (so trades reorder it)
  currentIdx,            // whose turn
  picks: [{ pick, teamId, prospectId }],
  clock: { endsAt, paused, bankMs },   // NEW — live timer
  pendingTrades: [],     // NEW — open trade-down offers for the on-clock team
}
```

**Actions** (serializable — this is the MP-enabling part):
- `MAKE_PICK(teamId, prospectId)`
- `PROPOSE_TRADE(fromTeam, toTeam, picksOut, picksIn)`
- `ACCEPT_TRADE(tradeId)` / `DECLINE_TRADE(tradeId)`
- `CLOCK_EXPIRE(teamId)` → auto-pick best-available-by-need

**Reducer**: `applyDraftAction(state, action) → state` — pure, deterministic.
`MAKE_PICK` pushes the pick + advances `currentIdx`; `ACCEPT_TRADE` swaps pick
ownership in `franchise.picks` and **recomputes `pickOrder`** so the board reorders.

**Controller** — *who produces the next action for the on-clock team*:
```
controllerFor(teamId) → "user" | "ai" | "human:<seat>" | "remote:<peer>"
```
- SP: user's team → `"user"`, all others → `"ai"`.
- The loop: resolve on-clock team → its controller → `"user"`/`"human"` shows the
  on-the-clock UI + clock; `"ai"` schedules an auto-pick after a pace delay;
  `"remote"` awaits a transport message.

Build SP with this shape. MP then = *more controllers + (for networked) a
transport that relays actions and syncs `currentIdx`.* No rewrite.

---

## 3. On the clock (Stage 1 — single-player)

- **Clock**: per-pick countdown (default ~45s user / faster AI), shown as a bar +
  mm:ss. A **time bank** option (NFL-style) is a nice-to-have. On expiry →
  `CLOCK_EXPIRE` → auto-pick (the user's pinned target if still available, else
  best-by-need via existing `frnAutoPickThisSlot` logic).
- **Paced AI**: AI picks resolve on a short staggered delay (e.g. 600–1500ms,
  faster late) via the existing render loop + `setTimeout`, so the board *ticks*
  pick-by-pick instead of jumping. A "▶▶ sim to my pick" control skips the wait.
- **Live board chrome**: who's on the clock (highlighted), countdown, a recent-
  picks ticker, the user's big board / pinned targets, "N picks away."
- Pure timing/UI — no engine, no realism metrics. The teleport/audit gates don't
  apply; verify with `_ux_snapshot.js`.

## 4. Trade down (Stage 2)

Wire the existing trade engine into the live board:
- When the user is **on the clock**, AI teams below generate **move-up offers**
  for a specific prospect (their need × prospect value), valued with `_pickValue`
  — the user gets a small list: *"PHI offers picks 12 + 78 to move up to your #6."*
- The user can also **shop the pick** (solicit) or **decline and pick**.
- `ACCEPT_TRADE` → reuse the offseason swap logic on `franchise.picks` (change
  `currentOwnerId`), recompute `pickOrder`, advance — the user slides down to
  their new pick and is back on the clock later with extra capital.
- AI willingness reuses the offseason `_playerTradeValue`/target logic, so values
  stay consistent league-wide. **Trade up** (user moves up) is the mirror: same
  engine, user is the one sending capital.

## 5. Multiplayer (Stages 3–4)

Designed-for, built incrementally. The game has **no backend** (localStorage/IDB),
so the realistic ladder:

- **Stage 3 — hot-seat (pure client-side, achievable now).** At draft start the
  user picks which teams are **human-controlled** (`"human:<seat>"`). When a human
  team is on the clock, show *"Team X — you're on the clock"* + the clock + that
  team's board; the device passes between humans. The clock, trade-down, and
  reducer are identical to SP — only `controllerFor` changes. This delivers real
  multiplayer drafting with zero infrastructure.
- **Stage 4 — networked (needs infra; future).** `"remote:<peer>"` controllers +
  a transport that broadcasts each **action** and syncs `currentIdx`. Because the
  state machine is deterministic and action-sourced, the transport only relays
  actions (+ a periodic state-hash check) — it doesn't re-implement draft logic.
  Options when infra is on the table: a thin WebSocket relay, or peer-to-peer
  (WebRTC) with one host authoritative on `currentIdx`. **Out of scope until a
  backend exists — but the SP build above does not preclude it.**

**Why this ordering:** every stage ships standalone value, and stages 1–3 need
*no server*. The action-sourced reducer (Stage 1) is the one upfront investment
that pays off at every later stage.

---

## 6. Staged plan (each independently shippable)

| Stage | What | Server? | Gate |
|---|---|---|---|
| 1 | Action-sourced reducer + on-the-clock timer + paced AI + sim-to-my-pick | no | `_ux_snapshot` |
| 2 | Trade-down/up on the clock (reuse `_pickValue` + offseason trade engine) | no | `_ux_snapshot`; spot-check pick-value balance |
| 3 | Hot-seat MP — human-controlled teams via `controllerFor`, seat-pass UI | no | `_ux_snapshot` |
| 4 | Networked MP — `"remote"` controller + transport | **yes** | (future) |

**Risks / guards:**
- The on-the-clock refactor touches `renderFrnDraft` + the pick flow — keep it
  behind the existing draft-render guard (already wrapped by `_frnInstallRenderGuards`).
- The draft is in the fragile `play-franchise-offseason.js` (1.2MB). Stage per
  commit, screenshot-verify each.
- Trade-down values must reconcile with offseason values (same `_pickValue`) so a
  pick isn't worth 100 in the draft and 60 in October.
- Don't break the existing UDFA/grade flow downstream of the board.

**First concrete step:** extract `applyDraftAction` + `controllerFor` and route the
*existing* pick/auto-pick through them (behavior-neutral), so Stage 1's clock has a
clean seam to hang on. Verify the draft still plays identically, then add the clock.
