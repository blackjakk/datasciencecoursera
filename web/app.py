"""Streamlit web tool for a live fantasy football mock draft.

Run locally:
    pip install -r requirements.txt
    streamlit run web/app.py

Three tabs:
  - Setup: load your league config + players CSV + Sleeper dump (if any).
  - Keeper Predictions: each team's optimal 4 keepers given last year's draft.
  - Live Draft: interactive draft board with VBD recommendations, opportunity-
    cost ranking, and availability forecasts at your next pick.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import streamlit as st

# Make the project importable when running `streamlit run web/app.py` from repo root.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fantasy_draft.draft import Draft  # noqa: E402
from fantasy_draft.keeper_predict import predict_keepers_for_league  # noqa: E402
from fantasy_draft.keepers import Keeper, apply_keepers, load_keepers_file  # noqa: E402
from fantasy_draft.league import LeagueConfig  # noqa: E402
from fantasy_draft.players import load_players  # noqa: E402
from fantasy_draft.predict import score_candidates_for_team  # noqa: E402
from fantasy_draft.recommend import recommend  # noqa: E402
from fantasy_draft.simulate import availability_distribution  # noqa: E402
from fantasy_draft.sleeper_offline import (  # noqa: E402
    history_from_offline,
    league_from_offline,
    current_rosters_from_offline,
    traded_away_rounds_from_offline,
)
from fantasy_draft.sleeper_live import (  # noqa: E402
    fetch_draft_picks,
    find_2026_draft,
    sync_draft_from_sleeper,
)
from fantasy_draft.trades import apply_trades, load_trades_from_sleeper_dump  # noqa: E402

import json as _json  # noqa: E402
from fantasy_draft.vbd import compute_vbd_post_keepers  # noqa: E402
from fantasy_draft.history import consolidate_years_kept, detect_keepers_by_adp, overlay_xlsx_keepers  # noqa: E402

st.set_page_config(page_title="Fantasy Draft Tool", layout="wide")
st.title("Fantasy Football Draft Tool")


# ------------------------------------------------------------------------
# Session state setup
# ------------------------------------------------------------------------

def _init_state():
    s = st.session_state
    s.setdefault("league", None)
    s.setdefault("players", None)
    s.setdefault("draft", None)
    s.setdefault("by_season", {})            # historical picks by year
    s.setdefault("predicted_keepers", {})    # {team_id: [KeeperPrediction]}
    s.setdefault("applied_keepers", [])      # actual keepers used in this draft
    s.setdefault("real_keepers_records", [])  # raw records from keepers_2026.json
    s.setdefault("current_rosters", {})      # team_id -> [(player_name, position)]
    s.setdefault("traded_picks", [])         # list[TradedPick]
    s.setdefault("team_names", None)         # optional list[str], one per team_idx
    # Default to Brian / Big Guap (rid 9 -> team_idx 8) per the league
    # identity map. Override via the Setup tab's "Your team" selector.
    s.setdefault("my_team_idx", 8)
    s.setdefault("sleeper_dump_path", str(ROOT / "data" / "sleeper"))
    s.setdefault("league_path", str(ROOT / "configs" / "superflex_12.json"))
    s.setdefault("players_path", str(ROOT / "data" / "players_2026.csv"))
    s.setdefault("keepers_path", str(ROOT / "data" / "keepers_2026.json"))
    # Live-sync state -- the 2026 MONEYLEAGUE draft on Sleeper.
    s.setdefault("live_draft_id", "1364055104721788928")
    s.setdefault("live_last_sync", None)     # timestamp string
    s.setdefault("live_last_count", 0)       # total Sleeper picks seen


_init_state()


(tab_setup, tab_keepers, tab_draft, tab_insights, tab_positions,
 tab_tendencies, tab_history, tab_assets, tab_trade, tab_charts) = st.tabs([
    "1. Setup", "2. Keeper Predictions", "3. Live Draft",
    "4. Historical Insights", "5. Position-by-Round",
    "6. Team Tendencies", "7. League History",
    "8. Pre-Draft Assets", "9. Trade Evaluator", "10. Charts",
])


# ------------------------------------------------------------------------
# Tab 1: Setup
# ------------------------------------------------------------------------

with tab_setup:
    st.header("League Setup")

    st.subheader("🏆 MONEYLEAGUE 2026 preset")
    st.caption(
        "One click: load the league config from the Sleeper dump, 2026 "
        "projections from the cached Sleeper fetch, and the 41 real keepers "
        "(38 carryovers + 3 forced-drops at the 3-year cap) parsed from "
        "MONEY_LEAGUE.xlsx."
    )
    if st.button("Load MONEYLEAGUE 2026", type="primary", key="load_moneyleague"):
        try:
            dump_path = Path(st.session_state.sleeper_dump_path)
            cfg = league_from_offline(
                str(dump_path),
                round_penalty=2, max_years_consecutive=3,
            )
            # 2026 draft slot lottery: based on the pattern from prior years,
            # the prior-year CHAMPION drafts last (slot 12) and the RUNNER-UP
            # drafts at slot 11. Other slots are randomized within the
            # bottom-half (places 7-12 -> slots 1-6) and top-half-excluding-
            # finalists (places 3-6 -> slots 7-10). 2025 results:
            #   champ      = roster 11 (BergerBoy Brigade)   -> slot 12
            #   runner-up  = roster 10 (Wi1dboy)             -> slot 11
            # Remaining 10 rosters: best-guess by roster_id until the lottery
            # is drawn.
            champ_rid, runnerup_rid = 11, 10  # 2025 results
            others = [rid for rid in range(1, cfg.num_teams + 1)
                      if rid not in (champ_rid, runnerup_rid)]
            order_rids = others + [runnerup_rid, champ_rid]   # slots 1..12
            cfg.draft_order = [rid - 1 for rid in order_rids]
            players = load_players(str(ROOT / "data" / "players_2026.csv"))
            from fantasy_draft.players import enrich_with_injuries
            n_injured = enrich_with_injuries(
                players, str(ROOT / "data" / "sleeper" / "players_nfl.json"))
            records = _json.loads((ROOT / "data" / "keepers_2026.json").read_text(encoding="utf-8"))

            # Build team names from rosters.json + users.json so the draft
            # board shows "TBreswick" etc. instead of "Team 1".
            league_dir = dump_path / f"league_{cfg.name and ''}"  # placeholder; we re-derive
            # Find the most-recent league dir (the only one we have for now).
            league_dirs = sorted(
                d for d in dump_path.iterdir()
                if d.is_dir() and d.name.startswith("league_")
            )
            team_names: list[str] = [f"Team {i+1}" for i in range(cfg.num_teams)]
            if league_dirs:
                ldir = league_dirs[-1]
                rosters_path = ldir / "rosters.json"
                users_path = ldir / "users.json"
                if rosters_path.exists() and users_path.exists():
                    users = {u["user_id"]: u for u in _json.loads(users_path.read_text(encoding="utf-8"))}
                    for r in _json.loads(rosters_path.read_text(encoding="utf-8")):
                        rid = int(r["roster_id"])
                        owner = users.get(r.get("owner_id") or "", {})
                        meta = owner.get("metadata") or {}
                        nm = meta.get("team_name") or owner.get("display_name") or f"Roster {rid}"
                        if 1 <= rid <= cfg.num_teams:
                            team_names[rid - 1] = nm

            # 2026 traded picks - both keepers_2026.json and trades use
            # roster_id - 1 as team_idx so they line up.
            trades_all = load_trades_from_sleeper_dump(str(dump_path))
            trades_2026 = [t for t in trades_all if t.season == 2026]

            st.session_state.league = cfg
            st.session_state.players = players
            st.session_state.real_keepers_records = records
            st.session_state.team_names = team_names
            st.session_state.traded_picks = trades_2026
            # Reset any in-progress draft so the new league/keepers take effect.
            st.session_state.draft = None
            st.session_state.applied_keepers = []

            n_carry = sum(1 for r in records if r["status"] == "carryover")
            n_drop = sum(1 for r in records if r["status"] == "forced_drop")
            st.success(
                f"Loaded **{cfg.name}** ({cfg.num_teams} teams, {cfg.rounds} rounds), "
                f"{len(players)} 2026 projections, {len(records)} keepers "
                f"({n_carry} carryover, {n_drop} forced drops), and "
                f"{len(trades_2026)} traded 2026 picks."
            )
            st.caption(
                f"2026 draft order: champ ({team_names[champ_rid-1]}) = slot 12, "
                f"runner-up ({team_names[runnerup_rid-1]}) = slot 11. "
                f"Other 10 slots are best-guess by roster_id until the lottery "
                f"is drawn — override in code or rerun once known."
            )
        except FileNotFoundError as e:
            st.error(
                f"Missing file: {e}. Run `scripts/fetch_sleeper.sh` to refresh "
                f"the dump and `python3 scripts/build_2026_keepers.py` to "
                f"rebuild keepers_2026.json."
            )
        except Exception as e:
            st.error(f"Load failed: {e}")

    st.divider()
    st.subheader("Or: load each piece manually")
    col1, col2 = st.columns(2)

    with col1:
        st.subheader("Source")
        source = st.radio(
            "Where should we load your league config from?",
            ["Sleeper dump (offline)", "JSON config file"],
            help="Sleeper dump is produced by scripts/fetch_sleeper.sh. "
                 "JSON config is one of the files under configs/.",
        )

        if source == "Sleeper dump (offline)":
            st.session_state.sleeper_dump_path = st.text_input(
                "Path to Sleeper dump dir", st.session_state.sleeper_dump_path,
            )
            if st.button("Load from Sleeper dump", type="primary"):
                try:
                    cfg = league_from_offline(
                        st.session_state.sleeper_dump_path,
                        round_penalty=2, max_years_consecutive=3,
                    )
                    by_season = history_from_offline(st.session_state.sleeper_dump_path)
                    rosters = current_rosters_from_offline(st.session_state.sleeper_dump_path)
                    trades = load_trades_from_sleeper_dump(st.session_state.sleeper_dump_path)
                    st.session_state.league = cfg
                    st.session_state.by_season = by_season
                    st.session_state.current_rosters = rosters
                    st.session_state.traded_picks = trades
                    st.success(
                        f"Loaded **{cfg.name}** with {len(by_season)} season(s) of history, "
                        f"{sum(len(r) for r in rosters.values())} players across rosters, "
                        f"{len(trades)} traded picks."
                    )
                except FileNotFoundError as e:
                    st.error(f"Couldn't find the dump: {e}. "
                             f"Run `scripts/fetch_sleeper.sh` first.")
                except Exception as e:
                    st.error(f"Load failed: {e}")
        else:
            st.session_state.league_path = st.text_input(
                "Path to league config JSON", st.session_state.league_path,
            )
            if st.button("Load JSON config", type="primary"):
                try:
                    cfg = LeagueConfig.load(st.session_state.league_path)
                    st.session_state.league = cfg
                    st.success(f"Loaded **{cfg.name}**")
                except Exception as e:
                    st.error(f"Load failed: {e}")

    with col2:
        st.subheader("Players")
        st.session_state.players_path = st.text_input(
            "Path to players CSV (needs projection & ADP)", st.session_state.players_path,
        )
        if st.button("Load players"):
            try:
                players = load_players(st.session_state.players_path)
                st.session_state.players = players
                st.success(f"Loaded {len(players)} players")
            except Exception as e:
                st.error(f"Load failed: {e}")

    st.divider()
    cfg = st.session_state.league
    if cfg:
        st.subheader(f"Current league: {cfg.name}")
        c1, c2, c3 = st.columns(3)
        c1.metric("Teams", cfg.num_teams)
        c2.metric("Rounds", cfg.rounds)
        c3.metric("PPR", cfg.scoring.reception)
        st.write("**Roster:** " + ", ".join(f"{s.count} {s.name}" for s in cfg.roster))
        if cfg.keepers.enabled:
            k = cfg.keepers
            st.write(f"**Keepers:** max {k.max_keepers_per_team}/team, "
                     f"{k.round_penalty}-round penalty, max {k.max_years_consecutive} years")

    if st.session_state.players:
        n_injured = sum(1 for p in st.session_state.players if p.injury_status)
        msg = f"Player pool: {len(st.session_state.players)} loaded"
        if n_injured:
            msg += f" ({n_injured} flagged with injury status)"
        st.success(msg)

    # --- Your team selector ---
    if cfg and st.session_state.team_names:
        st.divider()
        st.subheader("Your team")
        st.caption(
            "Used for the `🟢 YOUR PICK` badge in Live Draft and as the default "
            "team when a tab needs one. Doesn't affect keepers, trades, or "
            "recommendations — those are team-agnostic."
        )
        names = st.session_state.team_names
        cur = st.session_state.my_team_idx
        if not (0 <= cur < len(names)):
            cur = 0
        choice = st.selectbox(
            "Which team are you?",
            options=list(range(len(names))),
            format_func=lambda i: f"{i+1}. {names[i]}",
            index=cur,
            key="user_team_select",
        )
        st.session_state.my_team_idx = int(choice)


# ------------------------------------------------------------------------
# Tab 2: Keeper Predictions
# ------------------------------------------------------------------------

with tab_keepers:
    st.header("Keepers")

    league = st.session_state.league
    players = st.session_state.players
    by_season = st.session_state.by_season
    real_records = st.session_state.real_keepers_records

    if not (league and players):
        st.info("Load a league and players CSV in tab 1 first.")
    elif real_records:
        st.caption(
            "Real 2026 keepers parsed from MONEY_LEAGUE.xlsx. Each team's prior "
            "keeper status (yr1/yr2/yr3) determines whether they can keep this "
            "year — yr3 hits the cap and is force-dropped back into the pool."
        )
        n_carry = sum(1 for r in real_records if r["status"] == "carryover")
        n_drop_rec = sum(1 for r in real_records if r["status"] == "drop_recommended")
        n_forced = sum(1 for r in real_records if r["status"] == "forced_drop")
        trades_2026 = st.session_state.traded_picks
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("2025 keepers (xlsx)", len(real_records))
        c2.metric("Carryover → 2026", n_carry,
                  help="Net VBD ≥ 0; team should re-keep.")
        c3.metric("Drop-recommended", n_drop_rec,
                  help="Net VBD < 0; team would do better drafting fresh with that pick.")
        c4.metric("Forced drops (yr3 cap)", n_forced)
        c5.metric("Traded 2026 picks", len(trades_2026))

        if trades_2026:
            with st.expander(f"2026 traded picks ({len(trades_2026)})"):
                tnames = st.session_state.team_names or [f"Team {i+1}" for i in range(league.num_teams)]
                trade_rows = []
                for t in sorted(trades_2026, key=lambda x: (x.original_team_idx, x.round_num)):
                    orig = tnames[t.original_team_idx] if 0 <= t.original_team_idx < len(tnames) else f"idx{t.original_team_idx}"
                    new = tnames[t.new_team_idx] if 0 <= t.new_team_idx < len(tnames) else f"idx{t.new_team_idx}"
                    if t.original_team_idx == t.new_team_idx:
                        continue  # net no-op (traded out and back)
                    trade_rows.append({
                        "Round": t.round_num,
                        "Original owner": orig,
                        "Current owner": new,
                    })
                st.dataframe(pd.DataFrame(trade_rows), use_container_width=True, hide_index=True)

        # Group by team_idx for display, ordered by draft slot.
        by_team: dict[int, list[dict]] = {}
        for r in real_records:
            by_team.setdefault(int(r["team_idx"]), []).append(r)

        tnames = st.session_state.team_names or [f"Team {i+1}" for i in range(league.num_teams)]
        for tidx in sorted(by_team):
            recs = sorted(by_team[tidx], key=lambda x: x["prior_round"])
            n_keep = sum(1 for r in recs if r["status"] == "carryover")
            team_name = tnames[tidx] if 0 <= tidx < len(tnames) else f"Team {tidx+1}"
            st.subheader(f"{team_name} — {n_keep} keeper(s)")
            rows = []
            # Load pick value chart so we can label each keeper's
            # "what would they trade for" round equivalent.
            pv_blind_local: dict[int, float] = {}
            pv_p = ROOT / "data" / "pick_value.json"
            if pv_p.exists():
                _pv = _json.loads(pv_p.read_text(encoding="utf-8"))
                pv_blind_local = {int(rr): d["mean_vbd"]
                                   for rr, d in _pv["by_round"].items()}

            def _round_equiv(raw_vbd: float) -> str:
                """Find round R where pv_blind[R] is closest to raw_vbd."""
                if not pv_blind_local or raw_vbd is None:
                    return "—"
                best_r, best_diff = None, float("inf")
                for rr, vv in pv_blind_local.items():
                    d = abs(vv - raw_vbd)
                    if d < best_diff:
                        best_diff, best_r = d, rr
                return f"~R{best_r}" if best_r else "—"

            for r in recs:
                natural = r["prior_round"] - league.keepers.round_penalty
                eff = r.get("effective_forfeit_round")
                tag = {
                    "carryover": "★ KEEP",
                    "drop_recommended": "↓ DROP (better to draft)",
                    "forced_drop": "✕ FORCED DROP (yr3 cap)",
                }.get(r["status"], r["status"])
                if natural <= 0:
                    cost_str = "n/a"
                elif eff is not None and int(eff) != natural:
                    cost_str = f"R{eff}↑ (nat R{natural}, bumped — same-round collision)"
                else:
                    cost_str = f"R{natural}"
                row = {
                    "Status": tag,
                    "Player": r["player_name"],
                    "Pos": r.get("position", ""),
                    "2025 Round": r["prior_round"],
                    "2026 Cost": cost_str,
                    "Yrs Kept (prior)": r["years_kept"],
                }
                if r.get("net_vbd") is not None:
                    row["Net VBD"] = f"{r['net_vbd']:+.1f}"
                if r.get("raw_vbd") is not None:
                    row["Trade value"] = _round_equiv(r["raw_vbd"])
                rows.append(row)
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
    elif not by_season:
        st.info(
            "No real keepers or draft history loaded. Use the MONEYLEAGUE preset "
            "in tab 1, or load a Sleeper dump to run the keeper predictor."
        )
    else:
        st.caption(
            "For each team, we rank their roster by **net value** = "
            "player VBD − expected VBD of the player they could have drafted "
            "in the round they'd forfeit. Top 4 = predicted keepers."
        )
        # Pick the season whose keepers we're predicting (= the season FOLLOWING
        # the most-recently-completed draft).
        last_season = max(by_season)
        st.write(f"Predicting keepers for **{last_season + 1}** "
                 f"based on the {last_season} draft.")

        # Run keeper detection on the historical drafts, then consolidate
        # years_kept so the cap can fire.
        with st.spinner("Detecting historical keepers and computing VBD..."):
            # Source-of-truth precedence:
            #   1. MONEY_LEAGUE.xlsx (authoritative; hand-tagged keeper
            #      comments) -- overlay first.
            #   2. Sleeper is_keeper flags (partial -- many seasons missing).
            #   3. ADP-anomaly heuristic (last resort for picks not in xlsx).
            xlsx_path = ROOT / "data" / "historical" / "MONEY_LEAGUE.xlsx"
            if xlsx_path.exists():
                n_overlaid = overlay_xlsx_keepers(by_season, str(xlsx_path))
                st.caption(
                    f"📊 Overlaid **{n_overlaid}** keeper tags from "
                    f"MONEY_LEAGUE.xlsx (the authoritative source). Remaining "
                    f"picks fall through to the ADP-anomaly heuristic."
                )
            for s, picks in by_season.items():
                detect_keepers_by_adp(picks, players, num_teams=league.num_teams,
                                       round_threshold=1.5)
            consolidate_years_kept(by_season)
            # Compute VBD (no current keepers known yet — that's what we're
            # predicting). Use the standard VBD pass on all players.
            from fantasy_draft.vbd import compute_vbd
            compute_vbd(players, league)
            # Build traded-away-rounds map for THIS year (after the last
            # completed draft, picks have been swapped via trades).
            traded_away: dict[str, set[int]] = {}
            for t in st.session_state.traded_picks:
                if t.original_team_idx == t.new_team_idx:
                    continue
                team_id = str(t.original_team_idx + 1)
                traded_away.setdefault(team_id, set()).add(t.round_num)

            preds = predict_keepers_for_league(
                by_season[last_season], players, league,
                max_keepers=league.keepers.max_keepers_per_team or 4,
                current_rosters=st.session_state.current_rosters or None,
                traded_away_rounds=traded_away or None,
            )
            st.session_state.predicted_keepers = preds

        n_keep = league.keepers.max_keepers_per_team or 4
        for team_id, candidates in sorted(preds.items()):
            if not candidates:
                continue
            team_name = candidates[0].team_name
            st.subheader(f"{team_name}")
            rows = []
            for i, c in enumerate(candidates):
                tag = "KEEP" if i < n_keep else ""
                rows.append({
                    "Rank": i + 1,
                    "Keep?": tag,
                    "Player": c.player_name,
                    "Pos": c.position,
                    "Prior R": c.prior_round,
                    "Forfeit R": c.forfeit_round,
                    "Yrs Kept": c.years_kept,
                    "VBD": round(c.player_vbd, 1),
                    "Round VBD": round(c.expected_vbd_at_forfeit, 1),
                    "Net": round(c.net_value, 1),
                    "Conf": f"{c.confidence*100:.0f}%" if c.confidence else "",
                })
            df = pd.DataFrame(rows)
            st.dataframe(df, use_container_width=True, hide_index=True)


# ------------------------------------------------------------------------
# Tab 3: Live Draft
# ------------------------------------------------------------------------

with tab_draft:
    st.header("Live Draft")

    league = st.session_state.league
    players = st.session_state.players

    if not (league and players):
        st.info("Load a league and players CSV in tab 1 first.")
        st.stop()

    # --- Initialize or reset draft ---
    team_names_dbg = st.session_state.team_names or [f"Team {i+1}" for i in range(league.num_teams)]
    my_label = team_names_dbg[st.session_state.my_team_idx] if 0 <= st.session_state.my_team_idx < len(team_names_dbg) else "?"
    st.caption(f"Your team: **{my_label}** (slot {st.session_state.my_team_idx + 1}). "
               f"Change in Setup tab.")
    col_a, col_b, col_c = st.columns([1, 1, 2])
    with col_a:
        pass
    with col_b:
        if st.button("New draft", help="Reset board, apply trades, then keepers"):
            team_names = st.session_state.get("team_names") or None
            draft = Draft.new(league, team_names=team_names)
            # Apply traded picks BEFORE keepers, so keeper walk-forward sees
            # the correct ownership state.
            for line in apply_trades(draft, st.session_state.traded_picks):
                st.text(line)

            applied: list[Keeper] = []
            real_records = st.session_state.real_keepers_records
            if real_records:
                # Real xlsx-truth keepers (MONEYLEAGUE 2026 preset). Only
                # apply status == "carryover" -- forced_drop (yr3 cap) and
                # drop_recommended (net VBD < 0; team is better off drafting
                # someone else with that pick) records are documentation only.
                for r in real_records:
                    if r.get("status") != "carryover":
                        continue
                    applied.append(Keeper(
                        team_idx=int(r["team_idx"]),
                        player_name=r["player_name"],
                        prior_round=int(r["prior_round"]),
                        years_kept=int(r["years_kept"]),
                    ))
            else:
                # Fall back to the predictor (non-MONEYLEAGUE leagues).
                preds = st.session_state.predicted_keepers
                n_keep = league.keepers.max_keepers_per_team or 4
                team_ids = sorted(preds.keys())
                for idx, tid in enumerate(team_ids):
                    if idx >= league.num_teams:
                        break
                    for c in preds[tid][:n_keep]:
                        applied.append(Keeper(
                            team_idx=idx,
                            player_name=c.player_name,
                            prior_round=c.prior_round,
                            years_kept=c.years_kept,
                        ))
            log = apply_keepers(draft, players, applied)
            st.session_state.draft = draft
            st.session_state.applied_keepers = applied
            for line in log:
                st.text(line)
            # Compute VBD with these keepers removed.
            kept = {p.player.name for p in draft.picks if p.is_keeper and p.player}
            compute_vbd_post_keepers(players, league, keeper_names=kept)
            st.rerun()

    draft = st.session_state.draft
    if not draft:
        st.info("Click **New draft** to start.")
        st.stop()

    # --- Live sync with Sleeper ---
    with st.expander("🔴 Live Sleeper sync (pull picks from the actual draft)",
                     expanded=False):
        st.caption(
            "Pulls picks from the Sleeper draft endpoint and applies any new "
            "ones to the board so VBD, recommendations, and availability "
            "forecasts reflect what's actually happening."
        )
        sc1, sc2, sc3 = st.columns([3, 1, 1])
        with sc1:
            st.session_state.live_draft_id = st.text_input(
                "Sleeper draft_id",
                st.session_state.live_draft_id,
                help="2026 MONEYLEAGUE = 1364055104721788928",
            )
        with sc2:
            if st.button("Sync now", type="primary"):
                import datetime as _dt
                try:
                    live = fetch_draft_picks(st.session_state.live_draft_id)
                    n_new, log_lines = sync_draft_from_sleeper(draft, players, live)
                    st.session_state.live_last_sync = _dt.datetime.now().strftime("%H:%M:%S")
                    st.session_state.live_last_count = len(live)
                    # Recompute VBD now that more players are off the board.
                    kept_or_drafted = {
                        p.player.name for p in draft.picks if p.player is not None
                    }
                    compute_vbd_post_keepers(players, league,
                                              keeper_names=kept_or_drafted)
                    st.success(
                        f"Synced {n_new} new pick(s). Sleeper has "
                        f"{len(live)} pick(s) total."
                    )
                    if log_lines:
                        with st.expander("Sync log", expanded=False):
                            for line in log_lines[-30:]:
                                st.text(line)
                    st.rerun()
                except Exception as e:
                    st.error(f"Sync failed: {e}")
        with sc3:
            if st.session_state.live_last_sync:
                st.metric("Last sync", st.session_state.live_last_sync,
                          delta=f"{st.session_state.live_last_count} picks")
            else:
                st.caption("(not synced yet)")

        auto_refresh = st.checkbox(
            "🔁 Auto-sync every 10 seconds",
            value=False,
            help="Poll Sleeper continuously while the draft runs. Note: while "
                 "auto-sync is on, the UI pauses for 10 seconds between "
                 "refreshes -- toggle off if you need to interact with the "
                 "page.",
        )
        st.caption(
            "💡 Heads-up: the draft order isn't known until Sleeper assigns "
            "slot_to_roster_id (after live draft starts). Until then, local "
            "team names follow roster_id order, which may not match the "
            "actual draft slot order. Click \"New draft\" again once the "
            "order is set to re-align."
        )

        if auto_refresh:
            import time as _time
            try:
                live = fetch_draft_picks(st.session_state.live_draft_id)
                n_new, _ = sync_draft_from_sleeper(draft, players, live)
                if n_new:
                    kept_or_drafted = {p.player.name for p in draft.picks
                                       if p.player is not None}
                    compute_vbd_post_keepers(players, league,
                                              keeper_names=kept_or_drafted)
                    import datetime as _dt
                    st.session_state.live_last_sync = _dt.datetime.now().strftime("%H:%M:%S")
                    st.session_state.live_last_count = len(live)
            except Exception as e:
                st.warning(f"Auto-sync error (will retry): {e}")
            _time.sleep(10)
            st.rerun()

    # --- Board view ---
    pick = draft.on_the_clock
    if pick is None:
        st.success("Draft complete!")
        _show_final(draft)
        st.stop()

    # Advance past pre-assigned keeper picks until we hit an open one.
    while pick is not None and pick.is_keeper and pick.player is not None:
        draft.cursor += 1
        pick = draft.on_the_clock
    if pick is None:
        st.success("Draft complete!")
        st.stop()

    # --- Recent picks stream (most useful during a live draft) ---
    completed = [p for p in draft.picks if p.player is not None]
    if completed:
        st.markdown("### Recent picks")
        n_recent = 10
        recent = completed[-n_recent:][::-1]   # newest first
        my_idx = st.session_state.my_team_idx
        rec_rows = []
        for p in recent:
            tname = draft.teams[p.team_idx].name
            marker = ""
            if p.team_idx == my_idx:
                marker = "🎯 "
            elif p.is_keeper:
                marker = "★ "
            rec_rows.append({
                "Pick": f"R{p.round_num}.{p.pick_in_round} (#{p.overall})",
                "Team": marker + tname,
                "Player": p.player.name,
                "Pos": p.player.position,
                "NFL": p.player.team,
                "Type": "KEEPER" if p.is_keeper else "draft",
            })
        st.dataframe(pd.DataFrame(rec_rows), use_container_width=True, hide_index=True)
        st.caption(
            f"Showing last {len(recent)} of {len(completed)} completed pick(s). "
            f"Sync more in via the Live Sleeper sync expander above."
        )

    team = draft.teams[pick.team_idx]
    is_me = pick.team_idx == st.session_state.my_team_idx
    header = (f"On the clock: **R{pick.round_num}.{pick.pick_in_round}** "
              f"(overall {pick.overall}) — {team.name}")
    if is_me:
        header += "  🎯 YOU"
    st.subheader(header)

    available = draft.available(players)
    candidates = score_candidates_for_team(
        team, league, available, pick.overall, top_n=20,
    )

    left, right = st.columns([2, 1])

    with left:
        st.markdown("### Top candidates")
        rows = [{
            "Rank": i + 1,
            "Player": c.player.name,
            "Pos": c.player.position,
            "Team": c.player.team,
            "ADP": c.player.adp,
            "Proj": c.player.projection,
            "VBD": round(c.player.vbd, 1),
            "Score": round(c.score, 2),
            "Reason": c.reason,
        } for i, c in enumerate(candidates)]
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

        pick_box, btn_box = st.columns([3, 1])
        with pick_box:
            chosen_name = st.selectbox(
                "Make a pick",
                [c.player.name for c in candidates] + ["(type a name)"],
                key=f"pick_select_{pick.overall}",
            )
            free_text = st.text_input(
                "Or type a player name", key=f"pick_text_{pick.overall}",
            )
        with btn_box:
            st.write("")  # vertical spacer
            if st.button("Submit pick", type="primary", key=f"submit_{pick.overall}"):
                name = free_text.strip() or chosen_name
                if name == "(type a name)" or not name:
                    st.warning("Choose a player.")
                else:
                    match = next(
                        (p for p in available if p.name.lower() == name.lower()),
                        None,
                    )
                    if match is None:
                        matches = [p for p in available if name.lower() in p.name.lower()]
                        if len(matches) == 1:
                            match = matches[0]
                        elif matches:
                            st.error(f"Ambiguous: {[p.name for p in matches[:6]]}")
                        else:
                            st.error(f"No available player matching '{name}'")
                    if match is not None:
                        draft.make_pick(match)
                        st.rerun()

    with right:
        st.markdown("### Your roster")
        my_team = draft.teams[st.session_state.my_team_idx]
        if my_team.roster:
            roster_df = pd.DataFrame([{
                "Pos": p.position, "Player": p.name, "Team": p.team,
                "VBD": round(p.vbd, 1),
            } for p in sorted(my_team.roster, key=lambda x: (x.position, -x.vbd))])
            st.dataframe(roster_df, use_container_width=True, hide_index=True)
        else:
            st.caption("(empty)")

    # --- Advisor (only on your pick) ---
    if is_me:
        st.divider()
        st.markdown("### Advisor")

        col_rec, col_av = st.columns(2)

        with col_rec:
            n_rec_sims = st.slider("Opp-cost sims per candidate", 20, 300, 80, 20,
                                   key=f"rec_sims_{pick.overall}")
            if st.button("Run opportunity-cost recommendation",
                         key=f"run_rec_{pick.overall}"):
                with st.spinner(f"Running {n_rec_sims} sims for each of 6 candidates..."):
                    recs = recommend(
                        draft, players, st.session_state.my_team_idx,
                        top_k_candidates=6, n_sims_per_candidate=n_rec_sims,
                    )
                best = recs[0].expected_total_vbd if recs else 0
                rec_rows = [{
                    "Rank": i + 1,
                    "Player": r.player.name,
                    "Pos": r.player.position,
                    "E[total VBD]": round(r.expected_total_vbd, 1),
                    "Now": round(r.immediate_vbd, 1),
                    "Future": round(r.expected_future_vbd, 1),
                    "Opp-cost": f"{best - r.expected_total_vbd:+.1f}",
                } for i, r in enumerate(recs)]
                st.dataframe(pd.DataFrame(rec_rows), use_container_width=True, hide_index=True)

        with col_av:
            n_avail_sims = st.slider("Availability sims", 100, 1000, 300, 100,
                                     key=f"av_sims_{pick.overall}")
            if st.button("Forecast availability at your next pick",
                         key=f"run_av_{pick.overall}"):
                with st.spinner(f"Running {n_avail_sims} sims..."):
                    reports = availability_distribution(
                        draft, players, st.session_state.my_team_idx,
                        n_sims=n_avail_sims,
                    )
                if len(reports) >= 2:
                    nxt = reports[1]
                    st.caption(f"At your next pick (overall {nxt.your_pick_overall}):")
                    av_rows = [
                        {"Probability": f"{p*100:.0f}%", "Player": name}
                        for name, p in nxt.top(15) if p > 0.10
                    ]
                    st.dataframe(pd.DataFrame(av_rows), use_container_width=True, hide_index=True)
                else:
                    st.info("No future picks of yours to forecast.")

    # --- Stash candidates: injured-but-talented late-ADP players who'd be
    # cheap keepers next year. Shown so the user sees them even though their
    # 2026 projection (and therefore VBD) is suppressed by the injury.
    from fantasy_draft.players import is_stash_candidate
    stash_pool = [p for p in available if is_stash_candidate(p)]
    if stash_pool:
        with st.expander(f"💉 Stash candidates ({len(stash_pool)}) — "
                          f"injured-but-talented late picks for next-year keeper value",
                          expanded=False):
            st.caption(
                "Late-ADP players with serious injuries (IR / Out / surgery-flagged). "
                "Their 2026 VBD is low because they're hurt, but drafting them in R15-17 "
                "lets you keep them in 2027 at a discounted forfeit round."
            )
            stash_pool.sort(key=lambda p: p.adp)
            stash_rows = []
            for p in stash_pool[:40]:
                # Implied 2027 forfeit round if drafted this round and kept.
                drafted_round = max(1, int((p.adp - 1) // league.num_teams) + 1)
                forfeit_2027 = max(1, drafted_round - league.keepers.round_penalty)
                stash_rows.append({
                    "Player": p.name,
                    "Pos": p.position,
                    "Team": p.team,
                    "ADP": round(p.adp, 1),
                    "Likely round (2026)": f"R{drafted_round}",
                    "2027 cost if kept": f"R{forfeit_2027}",
                    "Injury": p.injury_status,
                    "Body part": p.injury_body_part,
                    "Notes": p.injury_notes[:50],
                })
            st.dataframe(pd.DataFrame(stash_rows),
                          use_container_width=True, hide_index=True)

    # --- Full board (collapsed) ---
    with st.expander("Full draft log"):
        log_rows = []
        for p in draft.picks[: draft.cursor]:
            log_rows.append({
                "R": p.round_num,
                "Pick": p.pick_in_round,
                "Overall": p.overall,
                "Team": draft.teams[p.team_idx].name,
                "Player": p.player.name if p.player else "",
                "Pos": p.player.position if p.player else "",
                "Keeper?": "★" if p.is_keeper else "",
            })
        st.dataframe(pd.DataFrame(log_rows), use_container_width=True, hide_index=True)


# ------------------------------------------------------------------------
# Tab 4: Historical Insights (from 11 years of MONEY_LEAGUE.xlsx)
# ------------------------------------------------------------------------

with tab_insights:
    st.header("Historical Insights")
    st.caption(
        "Aggregates from 11 years of MONEY_LEAGUE history. "
        "Regenerate with `python3 scripts/run_analysis.py`."
    )

    insights_path = ROOT / "data" / "historical_insights.json"
    if not insights_path.exists():
        st.warning(
            "No insights file yet. Run `python3 scripts/run_analysis.py` "
            "from the repo root."
        )
    else:
        try:
            data = _json.loads(insights_path.read_text(encoding="utf-8"))
        except Exception as e:
            st.error(f"Couldn't read {insights_path.name}: {e}")
            data = {}

        st.caption(f"Generated {data.get('generated_at', '?')} from {data.get('source', '?')}")

        # All section accesses use .get() with sensible defaults so a stale
        # JSON schema (older or newer than this code) degrades gracefully
        # instead of taking the whole tab down with a KeyError.
        ret = data.get("retention_by_position", {})
        dropoff = data.get("post_cap_dropoff", {})
        forced = data.get("forced_drops_2026", [])

        st.subheader("Keeper retention by position")
        st.caption(
            "Of all yr1 keepers at this position, what % became yr2 keepers? "
            "Same for yr2→yr3. Higher retention = the position holds value "
            "across years, so paying the round-penalty premium pays off. "
            "Most-recent year (e.g. 2025) is excluded from yr1/yr2 transitions "
            "because next-year fate is unknowable until the next draft happens."
        )
        ret_rows = []
        for pos in ("QB", "RB", "WR", "TE"):
            d = ret.get(pos) or {}
            y12 = d.get("yr1_to_yr2_pct")
            y23 = d.get("yr2_to_yr3_pct")
            ret_rows.append({
                "Pos": pos,
                "Yr1 keepers (n)": d.get("yr1_count", 0),
                "Yr1 → Yr2": f"{y12:.0f}%" if y12 is not None else "—",
                "Yr2 keepers (n)": d.get("yr2_count", 0),
                "Yr2 → Yr3": f"{y23:.0f}%" if y23 is not None else "—",
                "Hit cap (yr3)": d.get("hit_cap_count", 0),
            })
        st.dataframe(pd.DataFrame(ret_rows), use_container_width=True, hide_index=True)

        st.subheader("What happens after the 3-year cap")
        fates = dropoff.get("fates", {})
        total_capped = dropoff.get("total_capped", 0)
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Capped players", total_capped)
        c2.metric("Re-drafted EARLIER", fates.get("redrafted_earlier", 0))
        c3.metric("Same round", fates.get("redrafted_same_round", 0))
        c4.metric("Re-drafted later", fates.get("redrafted_later", 0))
        c5.metric("Undrafted next year", fates.get("undrafted_next_year", 0))
        earlier_n = fates.get("redrafted_earlier", 0)
        if total_capped:
            st.markdown(
                f"**{100 * earlier_n / total_capped:.0f}%** of forced-out "
                f"players came back in an *earlier* round the next year — "
                f"forced drops are typically high-value early-round targets, "
                f"not discards."
            )
        rounds = dropoff.get("earlier_round_distribution") or []
        if rounds:
            median = rounds[len(rounds) // 2]
            st.caption(
                f"Re-draft round distribution (for the {len(rounds)} who came "
                f"back earlier): min R{rounds[0]}, median R{median}, max R{rounds[-1]}."
            )
        examples = dropoff.get("examples_redrafted_earlier") or []
        if examples:
            with st.expander(f"Recent examples ({len(examples)})"):
                ex_rows = [{
                    "Year capped": e.get("year"),
                    "Player": e.get("player"),
                    "Pos": e.get("position", "?"),
                    "Kept at": f"R{e.get('kept_round')}",
                    "Re-drafted at": f"R{e.get('next_year_round')}",
                } for e in examples]
                st.dataframe(pd.DataFrame(ex_rows), use_container_width=True, hide_index=True)

        if forced:
            st.subheader("2026 forced drops — re-draft prior")
            st.caption(
                "This year's forced drops (yr3 cap), with the historical "
                "prior for where post-cap players tend to land. Plan to "
                "draft these early — most teams will."
            )
            fd_rows = [{
                "Player": f.get("player"),
                "Pos": f.get("position", "?"),
                "2025 round": f"R{f.get('prior_round', '?')}",
                "P(redrafted earlier)": f"{f.get('historical_redraft_earlier_pct', 0):.0f}%",
                "P(undrafted)": f"{f.get('historical_undrafted_pct', 0):.0f}%",
                "Median earlier round": (f"R{f['median_earlier_round']}"
                                          if f.get("median_earlier_round") else "—"),
            } for f in forced]
            st.dataframe(pd.DataFrame(fd_rows), use_container_width=True, hide_index=True)


# ------------------------------------------------------------------------
# Tab 5: Position-by-Round (which position pays off best in each round?)
# ------------------------------------------------------------------------

with tab_positions:
    st.header("Position-by-Round ROI")
    st.caption(
        "Mean season fantasy points scored by players drafted at each "
        "(round, position) across all completed Sleeper seasons. "
        "Regenerate with `python3 scripts/run_position_analysis.py`."
    )

    pos_path = ROOT / "data" / "position_by_round.json"
    if not pos_path.exists():
        st.warning(
            "No position-by-round data yet. Run "
            "`python3 scripts/run_position_analysis.py` from the repo root."
        )
    else:
        try:
            pdata = _json.loads(pos_path.read_text(encoding="utf-8"))
        except Exception as e:
            st.error(f"Couldn't read {pos_path.name}: {e}")
            pdata = {}

        seasons = pdata.get("seasons_covered") or []
        st.caption(
            f"Generated {pdata.get('generated_at', '?')} | "
            f"seasons {seasons} | "
            f"{pdata.get('n_picks', 0)} draft picks analyzed."
        )

        league = st.session_state.get("league")
        if league and any("super_flex" in s.name.lower() or s.name.lower() == "qb"
                          for s in league.roster):
            n_qb = sum(s.count for s in league.roster
                        if s.name.lower() in ("qb", "super_flex"))
            if n_qb >= 2:
                st.info(
                    f"This is a **{n_qb}-QB starting league** (superflex), "
                    f"which is why QBs dominate the mean-points table at "
                    f"every round. Plan accordingly."
                )

        st.subheader("Best position per round")
        st.caption("Position with the highest mean season-points scored, "
                   "minimum 2 samples in that (round, position) bucket.")
        best = pdata.get("best_position_per_round") or []
        best_rows = [{
            "Round": b["round"],
            "Best position": b["best_position"],
            "Mean points": b["mean_points"],
            "Sample size": b["n_samples"],
            "Advantage over 2nd": (f"+{b['advantage_over_2nd']:.0f} vs {b['second_best']}"
                                    if b.get("advantage_over_2nd") and b.get("second_best")
                                    else "—"),
        } for b in best]
        st.dataframe(pd.DataFrame(best_rows), use_container_width=True, hide_index=True)

        st.subheader("Full breakdown — mean points by (round, position)")
        brp = pdata.get("by_round_position") or {}
        # Build a wide table: rows = rounds, columns = positions.
        rounds = sorted(int(r) for r in brp)
        positions = ("QB", "RB", "WR", "TE", "K", "DEF")
        full_rows = []
        for rnd in rounds:
            r = {"Round": f"R{rnd}"}
            for pos in positions:
                d = (brp.get(str(rnd)) or {}).get(pos)
                if d:
                    r[pos] = f"{d['mean']:.0f} (n={d['n']})"
                else:
                    r[pos] = "—"
            full_rows.append(r)
        st.dataframe(pd.DataFrame(full_rows), use_container_width=True, hide_index=True)


# ------------------------------------------------------------------------
# Tab 6: Team Tendencies (per-team keeper habits from MONEY_LEAGUE.xlsx)
# ------------------------------------------------------------------------

with tab_tendencies:
    st.header("Team Tendencies")
    st.caption(
        "Per-team keeper habits across 11 years of MONEY_LEAGUE history. "
        "Use this to predict what opponents will keep / how aggressive "
        "they'll be in the early rounds."
    )

    tend_path = ROOT / "data" / "team_tendencies.json"
    if not tend_path.exists():
        st.warning(
            "No tendencies data yet. Run "
            "`python3 scripts/run_team_tendencies.py` from the repo root."
        )
    else:
        try:
            tdata = _json.loads(tend_path.read_text(encoding="utf-8"))
        except Exception as e:
            st.error(f"Couldn't read {tend_path.name}: {e}")
            tdata = {}

        st.caption(f"Generated {tdata.get('generated_at', '?')}")

        teams = tdata.get("teams") or []
        if not teams:
            st.info("No team data found.")
        else:
            rows = [{
                "Team": t["team_name"],
                "Seasons": t["seasons_in_league"],
                "Total keepers": t["total_keepers"],
                "Avg keepers/yr": f"{t['avg_keepers_per_year']:.1f}",
                "Avg keeper round": (f"R{t['avg_keeper_round']:.1f}"
                                      if t["avg_keeper_round"] else "—"),
                "Most-kept pos": t.get("most_kept_position") or "—",
                "Yr3 caps hit": t["yr3_caps_hit"],
            } for t in teams]
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

            st.subheader("Position mix kept per team")
            mix_rows = []
            for t in teams:
                mix = t.get("position_counts") or {}
                row = {"Team": t["team_name"]}
                for pos in ("QB", "RB", "WR", "TE", "K", "DEF"):
                    row[pos] = mix.get(pos, 0)
                mix_rows.append(row)
            st.dataframe(pd.DataFrame(mix_rows), use_container_width=True, hide_index=True)


# ------------------------------------------------------------------------
# Tab 7: League History (standings + champions per season)
# ------------------------------------------------------------------------

with tab_history:
    st.header("League History")
    st.caption(
        "Standings, champions, and per-season highlights pulled from "
        "Sleeper. Years prior to 2023 lived on Yahoo and don't have "
        "results data we can fetch."
    )

    # Manager identity — links Yahoo team names, xlsx nicknames, and Sleeper
    # display names to a single person. Edit data/team_identity.json to fix.
    from fantasy_draft.team_identity import all_managers  # noqa: E402
    with st.expander("Manager identity (Yahoo ↔ xlsx ↔ Sleeper)", expanded=False):
        st.caption(
            "Map each league member's Yahoo team names (pre-2023) to their "
            "current Sleeper roster + xlsx nickname. Confidence flagged per "
            "row. Edit `data/team_identity.json` to correct."
        )
        ident_rows = []
        for m in all_managers():
            yahoo_names = m.get("yahoo_team_names", {})
            yrs = sorted(yahoo_names) if yahoo_names else []
            ident_rows.append({
                "Manager": m["canonical_name"],
                "Sleeper rid": m.get("sleeper_roster_id"),
                "Sleeper display": m.get("sleeper_display_name"),
                "xlsx nick": ", ".join(m.get("xlsx_nicknames", [])),
                "Yahoo names": " | ".join(
                    f"{y}: {yahoo_names[y]}" for y in yrs
                ) or "—",
                "Confidence": m.get("confidence", ""),
            })
        st.dataframe(pd.DataFrame(ident_rows), use_container_width=True, hide_index=True)

    from fantasy_draft.results import load_all_seasons  # noqa: E402

    try:
        seasons = load_all_seasons(ROOT / "data" / "sleeper")
    except Exception as e:
        st.error(f"Couldn't load season results: {e}")
        seasons = {}

    if not seasons:
        st.info("No Sleeper season data. Run `scripts/fetch_sleeper.sh` first.")
    else:
        st.subheader("Champions")
        champ_rows = []
        for yr, s in sorted(seasons.items()):
            champ_rid = s.get("champion_roster_id")
            champ = s["rosters"].get(champ_rid, {}).get("team_name", "—") if champ_rid else "—"
            champ_rows.append({
                "Year": yr,
                "League name": s.get("name") or "—",
                "Champion": champ,
                "Teams": s.get("num_teams", 0),
            })
        st.dataframe(pd.DataFrame(champ_rows), use_container_width=True, hide_index=True)

        st.subheader("Standings by year")
        for yr in sorted(seasons, reverse=True):
            s = seasons[yr]
            with st.expander(f"{yr} {s.get('name') or ''}", expanded=(yr == max(seasons))):
                rows = []
                champ_rid = s.get("champion_roster_id")
                for rid, r in sorted(s["rosters"].items(),
                                      key=lambda x: (-x[1]["wins"], -x[1]["fpts"])):
                    badge = "🏆 " if rid == champ_rid else ""
                    rows.append({
                        "Team": badge + r["team_name"],
                        "W": r["wins"],
                        "L": r["losses"],
                        "T": r["ties"],
                        "Points For": round(r["fpts"], 1),
                        "Points Against": round(r["fpts_against"], 1),
                        "Margin": round(r["fpts"] - r["fpts_against"], 1),
                    })
                st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

        # --- Trade history (retroactively valued) ---
        from fantasy_draft.results import load_all_trades, summarize_trade  # noqa: E402
        try:
            trades = load_all_trades(ROOT / "data" / "sleeper")
        except Exception:
            trades = []
        if trades:
            st.subheader(f"Trade history — retroactive value ({len(trades)} trades)")
            st.caption(
                "Each trade scored after the fact: players = season points "
                "actually scored, picks = mean VBD historically delivered at "
                "that round. Positive net = this team won the trade in hindsight."
            )
            # Build lookups.
            roster_team_name = {}
            pts_by_season: dict[int, dict[str, float]] = {}
            for ss in seasons.values():
                for rid, rr in ss["rosters"].items():
                    roster_team_name[rid] = rr["team_name"]
                pts_by_season[ss["season"]] = ss["player_total_points"]
            try:
                catalog = _json.loads(
                    (ROOT / "data" / "sleeper" / "players_nfl.json").read_text(encoding="utf-8"))
            except Exception:
                catalog = {}
            pv_blind_t: dict[int, float] = {}
            pv_p = ROOT / "data" / "pick_value.json"
            if pv_p.exists():
                _pv = _json.loads(pv_p.read_text(encoding="utf-8"))
                pv_blind_t = {int(rr): d["mean_vbd"]
                              for rr, d in _pv["by_round"].items()}

            # Render per season descending.
            seasons_with_trades = sorted({t["_season"] for t in trades}, reverse=True)
            for yr in seasons_with_trades:
                yr_trades = [t for t in trades if t["_season"] == yr]
                with st.expander(f"{yr}: {len(yr_trades)} trade(s)"):
                    summary_rows = []
                    for t in yr_trades:
                        sides = summarize_trade(t, roster_team_name, catalog,
                                                pts_by_season, pv_blind_t)
                        # Show one row per side, paired together by week.
                        for side in sides:
                            verdict = ("🏆" if side["net"] > 20
                                       else "👍" if side["net"] > 0
                                       else "👎" if side["net"] < -20 else "≈")
                            summary_rows.append({
                                "Week": side["week"],
                                "Team": f"{verdict} {side['team']}",
                                "Received": side["received"][:80],
                                "Gave": side["given"][:80],
                                "Net value": f"{side['net']:+.0f}",
                            })
                    st.dataframe(pd.DataFrame(summary_rows),
                                  use_container_width=True, hide_index=True)

            st.subheader("All-time trade scorecard")
            st.caption("Aggregate net value per team across all trades. "
                       "Positive total = consistently wins trades by retroactive value.")
            from collections import defaultdict as _dd
            tally = _dd(lambda: {"team": "", "n": 0, "net": 0.0, "wins": 0, "losses": 0})
            for t in trades:
                sides = summarize_trade(t, roster_team_name, catalog,
                                        pts_by_season, pv_blind_t)
                for s in sides:
                    e = tally[s["team"]]
                    e["team"] = s["team"]
                    e["n"] += 1
                    e["net"] += s["net"]
                    if s["net"] > 20: e["wins"] += 1
                    elif s["net"] < -20: e["losses"] += 1
            score_rows = sorted(tally.values(), key=lambda r: -r["net"])
            sc_rows = [{
                "Team": e["team"],
                "Trades": e["n"],
                "Wins (+20 VBD)": e["wins"],
                "Losses (-20 VBD)": e["losses"],
                "Net value": round(e["net"], 1),
                "Net per trade": round(e["net"] / max(1, e["n"]), 1),
            } for e in score_rows]
            st.dataframe(pd.DataFrame(sc_rows), use_container_width=True, hide_index=True)


# ------------------------------------------------------------------------
# Tab 8: Pre-Draft Assets (every team's total draft capital in VBD)
# ------------------------------------------------------------------------

with tab_assets:
    st.header("Pre-Draft Team Assets")
    st.caption(
        "Each team's total draft capital before the draft starts: pick "
        "value (empirical, from historical drafts) + keeper VBD. Picks "
        "they forfeit to declare keepers are removed; traded picks are "
        "reassigned to the new owner."
    )

    pv_path = ROOT / "data" / "pick_value.json"
    kp_path = ROOT / "data" / "keepers_2026.json"
    if not (pv_path.exists() and kp_path.exists()):
        st.warning("Missing data/pick_value.json or data/keepers_2026.json. "
                   "Run scripts/build_pick_value.py and "
                   "scripts/build_2026_keepers.py.")
    else:
        league = st.session_state.league
        team_names = (st.session_state.get("team_names")
                      or [f"Team {i+1}" for i in range(league.num_teams)]
                      if league else None)
        if not (league and team_names):
            st.info("Load the league in Tab 1 first.")
        else:
            from fantasy_draft.draft import Draft as _Draft  # noqa: E402
            from fantasy_draft.trades import apply_trades as _apply_trades  # noqa: E402

            pv = _json.loads(pv_path.read_text(encoding="utf-8"))
            pv_blind = {int(r): d["mean_vbd"] for r, d in pv["by_round"].items()}
            keeper_records = _json.loads(kp_path.read_text(encoding="utf-8"))

            # Build a fresh draft to determine pick ownership (apply trades, then
            # mark forfeited rounds via the keepers themselves).
            asset_draft = _Draft.new(league, team_names=team_names)
            for _ln in _apply_trades(asset_draft, st.session_state.traded_picks or []):
                pass
            # Mark forfeited rounds per team_idx from the carryover keepers.
            forfeit_by_team: dict[int, list[int]] = {}
            keeper_vbd_by_team: dict[int, float] = {}
            keepers_by_team: dict[int, list[str]] = {}
            for r in keeper_records:
                if r.get("status") != "carryover":
                    continue
                tidx = int(r["team_idx"])
                eff = int(r.get("effective_forfeit_round") or r["forfeit_round"])
                nat = int(r["forfeit_round"])
                forfeit_by_team.setdefault(tidx, []).append(eff)
                keeper_vbd_by_team[tidx] = keeper_vbd_by_team.get(tidx, 0.0) + (r.get("net_vbd") or 0)
                bump = "↑" if eff != nat else ""
                keepers_by_team.setdefault(tidx, []).append(
                    f"{r['player_name']} (R{eff}{bump}, {(r.get('net_vbd') or 0):+.0f})"
                )

            rows = []
            for tidx, team in enumerate(asset_draft.teams):
                # Picks the team owns post-trades, excluding forfeited rounds.
                forfeited = set(forfeit_by_team.get(tidx, []))
                own_picks = [p for p in asset_draft.picks
                              if p.team_idx == tidx and p.round_num not in forfeited]
                pick_value_total = sum(pv_blind.get(p.round_num, 0.0) for p in own_picks)
                keeper_value = keeper_vbd_by_team.get(tidx, 0.0)
                total = pick_value_total + keeper_value
                rows.append({
                    "Team": team.name,
                    "Picks owned": len(own_picks),
                    "Pick value (VBD)": round(pick_value_total, 1),
                    "Keepers": len(keepers_by_team.get(tidx, [])),
                    "Keeper VBD": round(keeper_value, 1),
                    "TOTAL VBD": round(total, 1),
                })
            rows.sort(key=lambda r: -r["TOTAL VBD"])
            df = pd.DataFrame(rows)
            st.dataframe(df, use_container_width=True, hide_index=True)
            st.caption(
                "**TOTAL VBD** is the sum of (empirical mean VBD per pick "
                "the team owns) + (net VBD of each kept player). Higher = "
                "stronger draft position."
            )

            with st.expander("Per-team keeper details"):
                for r in sorted(rows, key=lambda x: -x["TOTAL VBD"]):
                    tidx = next(i for i, t in enumerate(asset_draft.teams) if t.name == r["Team"])
                    kps = keepers_by_team.get(tidx, [])
                    forfeited = sorted(forfeit_by_team.get(tidx, []))
                    st.markdown(
                        f"**{r['Team']}** — {len(kps)} keeper(s), "
                        f"forfeit rounds: {forfeited or '(none)'}"
                    )
                    if kps:
                        for k in kps:
                            st.text(f"  • {k}")


# ------------------------------------------------------------------------
# Tab 9: Trade Evaluator (compare two sides in pick + player VBD)
# ------------------------------------------------------------------------

with tab_trade:
    st.header("Trade Evaluator")
    st.caption(
        "Sum picks + players on each side in VBD. Picks use the empirical "
        "round-mean from historical drafts (position-blind); players use "
        "their current 2026 VBD. Threshold for a 'fair' trade is ±20 VBD."
    )

    pv_path = ROOT / "data" / "pick_value.json"
    if not pv_path.exists():
        st.warning("Run scripts/build_pick_value.py first.")
    else:
        league = st.session_state.league
        players = st.session_state.players
        if not (league and players):
            st.info("Load the league + players in Tab 1 first.")
        else:
            pv = _json.loads(pv_path.read_text(encoding="utf-8"))
            pv_blind = {int(r): d["mean_vbd"] for r, d in pv["by_round"].items()}

            # Recompute VBD without any keepers removed (baseline view).
            from fantasy_draft.vbd import compute_vbd as _compute_vbd  # noqa: E402
            _compute_vbd(players, league)
            player_lookup = {p.name: p for p in sorted(players, key=lambda x: -x.vbd)}
            player_options = ["(select)"] + list(player_lookup.keys())[:300]  # top 300 by VBD

            pick_options = [f"R{r}" for r in range(1, league.rounds + 1)]

            colA, colB = st.columns(2)

            def _side_inputs(label: str, key_prefix: str):
                """UI for one side of the trade. Returns (picks_total, players_total, items)."""
                st.subheader(label)
                n_picks = st.number_input(
                    f"# picks", min_value=0, max_value=8, value=0,
                    key=f"{key_prefix}_n_picks",
                )
                picks_total = 0.0
                pick_items = []
                for i in range(int(n_picks)):
                    rnd_label = st.selectbox(
                        f"Pick {i+1}", pick_options,
                        key=f"{key_prefix}_pick_{i}",
                    )
                    rnd = int(rnd_label[1:])
                    v = pv_blind.get(rnd, 0.0)
                    picks_total += v
                    pick_items.append(f"{rnd_label} = {v:+.0f} VBD")
                n_players = st.number_input(
                    f"# players", min_value=0, max_value=6, value=0,
                    key=f"{key_prefix}_n_players",
                )
                players_total = 0.0
                player_items = []
                for i in range(int(n_players)):
                    nm = st.selectbox(
                        f"Player {i+1}", player_options,
                        key=f"{key_prefix}_player_{i}",
                    )
                    if nm and nm != "(select)":
                        p = player_lookup.get(nm)
                        if p:
                            players_total += p.vbd
                            player_items.append(f"{p.name} ({p.position}) = {p.vbd:+.1f} VBD")
                total = picks_total + players_total
                st.metric(f"{label} total", f"{total:+.1f} VBD")
                with st.expander(f"{label} itemized"):
                    for it in pick_items + player_items:
                        st.text(f"  • {it}")
                return total, pick_items + player_items

            with colA:
                total_a, items_a = _side_inputs("Side A", "trade_a")
            with colB:
                total_b, items_b = _side_inputs("Side B", "trade_b")

            st.divider()
            delta = total_a - total_b
            abs_d = abs(delta)
            if abs_d <= 20:
                verdict = "✅ **FAIR TRADE** (within ±20 VBD)"
                color = "green"
            elif abs_d <= 50:
                winner = "Side A" if delta > 0 else "Side B"
                verdict = f"⚖️ **Slight edge to {winner}** ({abs_d:.0f} VBD)"
                color = "blue"
            else:
                winner = "Side A" if delta > 0 else "Side B"
                verdict = f"🚨 **LOPSIDED — {winner} wins** ({abs_d:.0f} VBD)"
                color = "red"
            st.markdown(f"### {verdict}")
            st.caption(
                f"Side A: {total_a:+.1f} VBD  |  "
                f"Side B: {total_b:+.1f} VBD  |  "
                f"Delta: {delta:+.1f}"
            )


# ------------------------------------------------------------------------
# Tab 10: Charts (11 visualizations across the full dataset)
# ------------------------------------------------------------------------

with tab_charts:
    import altair as alt  # noqa: E402

    st.header("Charts & insights")
    st.caption("Visualizations across 11 seasons of MONEY_LEAGUE history.")

    # ---------- shared data loads ----------
    pv_path = ROOT / "data" / "pick_value.json"
    pbr_path = ROOT / "data" / "position_by_round.json"

    @st.cache_data
    def _load_chart_data():
        from fantasy_draft.results import (  # noqa: E402
            load_all_seasons, load_draft_picks_with_points, load_all_trades,
            summarize_trade,
        )
        from fantasy_draft.xlsx_history import load_all_keepers, normalize_name  # noqa: E402
        from fantasy_draft.name_aliases import resolve_xlsx_name  # noqa: E402

        pv = _json.loads(pv_path.read_text(encoding="utf-8")) if pv_path.exists() else {}
        pbr = _json.loads(pbr_path.read_text(encoding="utf-8")) if pbr_path.exists() else {}

        try:
            catalog = _json.loads(
                (ROOT / "data" / "sleeper" / "players_nfl.json").read_text(encoding="utf-8"))
        except Exception:
            catalog = {}

        seasons = load_all_seasons(ROOT / "data" / "sleeper")
        picks = load_draft_picks_with_points(ROOT / "data" / "sleeper")
        trades = load_all_trades(ROOT / "data" / "sleeper")

        roster_team_name: dict[int, str] = {}
        for ss in seasons.values():
            for rid, rr in ss["rosters"].items():
                roster_team_name[rid] = rr["team_name"]
        pts_by_season = {ss["season"]: ss["player_total_points"]
                         for ss in seasons.values()}
        pv_blind = {int(r): d["mean_vbd"]
                    for r, d in (pv.get("by_round") or {}).items()}

        # All trades summarized.
        trade_rows = []
        for t in trades:
            for s in summarize_trade(t, roster_team_name, catalog,
                                      pts_by_season, pv_blind):
                trade_rows.append(s)

        # xlsx keepers (years_kept history).
        try:
            xlsx_by_year = load_all_keepers(
                ROOT / "data" / "historical" / "MONEY_LEAGUE.xlsx")
        except Exception:
            xlsx_by_year = {}

        return {
            "pv": pv, "pbr": pbr, "catalog": catalog, "seasons": seasons,
            "picks": picks, "trades": trades, "trade_rows": trade_rows,
            "xlsx_by_year": xlsx_by_year, "pv_blind": pv_blind,
            "roster_team_name": roster_team_name,
            "pts_by_season": pts_by_season,
        }

    try:
        D = _load_chart_data()
    except Exception as e:
        st.error(f"Couldn't load chart data: {e}")
        D = None

    if D:
        # ============================================================
        # 1. Pick value decay curve
        # ============================================================
        st.subheader("1. Pick value decay curve (empirical)")
        st.caption("Mean VBD delivered per round across 3 Sleeper seasons. "
                   "R1-R2 are the premium picks; R9+ trend toward replacement.")
        pv_rows = [{"Round": int(r), "Mean VBD": d["mean_vbd"],
                    "Median VBD": d["median_vbd"]}
                   for r, d in (D["pv"].get("by_round") or {}).items()]
        pv_df = pd.DataFrame(pv_rows).sort_values("Round")
        chart = (alt.Chart(pv_df).mark_line(point=True)
                  .encode(x=alt.X("Round:O"),
                          y=alt.Y("Mean VBD:Q", title="Mean VBD"),
                          tooltip=["Round", "Mean VBD", "Median VBD"])
                  .properties(height=260))
        st.altair_chart(chart, use_container_width=True)

        # ============================================================
        # 2. Position × round heatmap
        # ============================================================
        st.subheader("2. Position × round heatmap (mean season pts)")
        st.caption("Color = mean season pts scored by players drafted at that "
                   "(round, position). QBs blaze across every round in this superflex.")
        pbr_rows = []
        for rnd, per_pos in (D["pbr"].get("by_round_position") or {}).items():
            for pos, d in per_pos.items():
                pbr_rows.append({"Round": int(rnd), "Position": pos,
                                  "Mean pts": d["mean"], "n": d["n"]})
        pbr_df = pd.DataFrame(pbr_rows)
        if not pbr_df.empty:
            heat = (alt.Chart(pbr_df).mark_rect()
                    .encode(x=alt.X("Round:O"),
                            y=alt.Y("Position:O",
                                     sort=["QB", "RB", "WR", "TE", "K", "DEF"]),
                            color=alt.Color("Mean pts:Q",
                                             scale=alt.Scale(scheme="viridis")),
                            tooltip=["Round", "Position", "Mean pts", "n"])
                    .properties(height=220))
            st.altair_chart(heat, use_container_width=True)

        # ============================================================
        # 3. Champion DNA — roster composition by draft round
        # ============================================================
        st.subheader("3. Champion DNA — where did winners get their points?")
        st.caption("For each season's champion, breakdown of season points by "
                   "the ROUND of their roster's drafted players.")
        champ_data = []
        for yr, s in sorted(D["seasons"].items()):
            champ_rid = s.get("champion_roster_id")
            if not champ_rid:
                continue
            for p in D["picks"]:
                if p["season"] == yr and p["roster_id"] == champ_rid:
                    champ_data.append({
                        "Year": yr,
                        "Round": p["round"],
                        "Player": p["player_name"],
                        "Position": p["position"],
                        "Points": p["season_points"],
                    })
        if champ_data:
            cdf = pd.DataFrame(champ_data)
            champ_chart = (alt.Chart(cdf).mark_bar()
                            .encode(x=alt.X("Round:O"),
                                    y=alt.Y("sum(Points):Q",
                                             title="Total season points"),
                                    color=alt.Color("Position:N"),
                                    column=alt.Column("Year:O"),
                                    tooltip=["Year", "Round", "Position",
                                             "Player", "Points"])
                            .properties(height=240))
            st.altair_chart(champ_chart, use_container_width=False)

        # ============================================================
        # 4. Manager trade scorecard
        # ============================================================
        st.subheader("4. Manager trade scorecard (net retroactive value)")
        st.caption("Sum of trade-value delta across all 45 trades. "
                   "Positive = consistent trade winner in hindsight.")
        from collections import defaultdict as _dd
        tally = _dd(lambda: {"team": "", "n": 0, "net": 0.0})
        for s in D["trade_rows"]:
            e = tally[s["team"]]
            e["team"] = s["team"]
            e["n"] += 1
            e["net"] += s["net"]
        tdf = pd.DataFrame(list(tally.values()))
        if not tdf.empty:
            tdf = tdf.sort_values("net", ascending=False)
            ts_chart = (alt.Chart(tdf).mark_bar()
                          .encode(x=alt.X("net:Q", title="Net trade value"),
                                  y=alt.Y("team:N", sort="-x"),
                                  color=alt.condition("datum.net > 0",
                                                       alt.value("#2ca02c"),
                                                       alt.value("#d62728")),
                                  tooltip=["team", "n", "net"])
                          .properties(height=320))
            st.altair_chart(ts_chart, use_container_width=True)

        # ============================================================
        # 5. Draft capital vs wins
        # ============================================================
        st.subheader("5. Draft capital realized vs final wins")
        st.caption("Each dot = (team, season). X = sum of season points from "
                   "drafted players; Y = wins. Does drafting better correlate "
                   "with winning in a keeper league?")
        dvw_rows = []
        for yr, s in D["seasons"].items():
            for rid, r in s["rosters"].items():
                team_pick_pts = sum(p["season_points"] for p in D["picks"]
                                     if p["season"] == yr and p["roster_id"] == rid)
                dvw_rows.append({
                    "Year": yr,
                    "Team": r["team_name"],
                    "Draft pts": round(team_pick_pts, 1),
                    "Wins": r["wins"],
                    "PF": round(r["fpts"], 1),
                })
        ddf = pd.DataFrame(dvw_rows)
        if not ddf.empty:
            scatter = (alt.Chart(ddf).mark_circle(size=120)
                        .encode(x=alt.X("Draft pts:Q",
                                         title="Total points from drafted players"),
                                y=alt.Y("Wins:Q"),
                                color=alt.Color("Year:N"),
                                tooltip=["Year", "Team", "Draft pts", "Wins", "PF"])
                        .properties(height=320))
            trend = (alt.Chart(ddf).mark_line(color="grey",
                                                strokeDash=[3, 3])
                       .transform_regression("Draft pts", "Wins")
                       .encode(x="Draft pts:Q", y="Wins:Q"))
            st.altair_chart(scatter + trend, use_container_width=True)

        # ============================================================
        # 6. ADP vs actual pick (reachers and value-finders)
        # ============================================================
        st.subheader("6. ADP vs actual pick number")
        st.caption("Above the diagonal = team reached (took a player earlier "
                   "than ADP). Below = grabbed value. Recent season only "
                   "(matched to current ADP).")
        # Use latest projections ADP for 2025 picks.
        adp_lookup: dict[str, float] = {}
        try:
            from fantasy_draft.results import load_all_seasons  # already imported
            from fantasy_draft.xlsx_history import normalize_name as _norm  # noqa: E402
            adp_proj = _json.loads(
                (ROOT / "data" / "sleeper_projections_2026.json").read_text(encoding="utf-8"))
            for entry in adp_proj:
                meta = entry.get("player") or {}
                nm = meta.get("full_name") or (
                    f"{meta.get('first_name', '')} {meta.get('last_name', '')}".strip())
                if not nm:
                    continue
                adp = (entry.get("stats") or {}).get("adp_half_ppr")
                if adp and adp < 500:
                    adp_lookup[_norm(nm)] = float(adp)
        except Exception:
            pass
        adp_rows = []
        for p in D["picks"]:
            if p["season"] != max(D["seasons"]):
                continue
            from fantasy_draft.xlsx_history import normalize_name as _nm2
            adp = adp_lookup.get(_nm2(p["player_name"]))
            if adp is None:
                continue
            adp_rows.append({
                "Team": p["team_name"],
                "Player": p["player_name"],
                "ADP": adp,
                "Actual": p["overall_pick"],
                "Position": p["position"],
            })
        adp_df = pd.DataFrame(adp_rows)
        if not adp_df.empty:
            line = (alt.Chart(pd.DataFrame({"x": [0, 200], "y": [0, 200]}))
                      .mark_line(strokeDash=[2, 2], color="grey")
                      .encode(x="x:Q", y="y:Q"))
            scatter = (alt.Chart(adp_df).mark_circle(size=80, opacity=0.7)
                        .encode(x=alt.X("ADP:Q"),
                                y=alt.Y("Actual:Q", title="Actual pick #"),
                                color="Team:N",
                                tooltip=["Team", "Player", "Position", "ADP", "Actual"])
                        .properties(height=400))
            st.altair_chart(line + scatter, use_container_width=True)

        # ============================================================
        # 7. Keeper hit rate by position (from xlsx)
        # ============================================================
        st.subheader("7. Keeper retention by position")
        st.caption("For each position, % of yr1 keepers that became yr2 "
                   "(blue) and % of yr2 that became yr3 (orange). From "
                   "historical_insights.json — already shown numerically in tab 4.")
        try:
            ret = _json.loads(
                (ROOT / "data" / "historical_insights.json").read_text(encoding="utf-8")
            )["retention_by_position"]
        except Exception:
            ret = {}
        kr_rows = []
        for pos in ("QB", "RB", "WR", "TE"):
            d = ret.get(pos, {})
            if d.get("yr1_to_yr2_pct") is not None:
                kr_rows.append({"Position": pos, "Transition": "yr1→yr2",
                                "Pct": d["yr1_to_yr2_pct"],
                                "Sample": d["yr1_count"]})
            if d.get("yr2_to_yr3_pct") is not None:
                kr_rows.append({"Position": pos, "Transition": "yr2→yr3",
                                "Pct": d["yr2_to_yr3_pct"],
                                "Sample": d["yr2_count"]})
        if kr_rows:
            krdf = pd.DataFrame(kr_rows)
            krchart = (alt.Chart(krdf).mark_bar()
                        .encode(x=alt.X("Position:N"),
                                y=alt.Y("Pct:Q", title="Retention %"),
                                color="Transition:N",
                                xOffset="Transition:N",
                                tooltip=["Position", "Transition", "Pct", "Sample"])
                        .properties(height=240))
            st.altair_chart(krchart, use_container_width=True)

        # ============================================================
        # 8. Best/worst keepers ever (retroactive)
        # ============================================================
        st.subheader("8. Best & worst keepers, retroactive")
        st.caption("For every keeper tagged in xlsx 2023-2025 history, how "
                   "did they actually score that year vs. an average pick at "
                   "their keeper cost round?")
        keeper_results = []
        for yr, recs in (D["xlsx_by_year"] or {}).items():
            pts_for_year = D["pts_by_season"].get(yr, {})
            # Need to look up player_id by name -> season points.
            # Build a quick name->pid index per year from picks.
            year_pts_by_name = {}
            for p in D["picks"]:
                if p["season"] == yr:
                    year_pts_by_name[normalize_name(p["player_name"])] = (
                        p["season_points"], p["round"], p["team_name"])
            for k in recs:
                from fantasy_draft.xlsx_history import normalize_name as _n3
                canon = resolve_xlsx_name(k.player_name) or k.player_name
                key = _n3(canon)
                row = year_pts_by_name.get(key)
                if not row:
                    continue
                pts, drafted_round, team = row
                forfeit = max(1, k.round_num - 2)
                pv_at_forfeit = (D["pv"].get("by_round") or {}).get(
                    str(forfeit), {}).get("mean_points", 0)
                keeper_results.append({
                    "Year": yr, "Player": canon, "Team": team,
                    "Kept at": f"R{k.round_num}",
                    "Cost (forfeit)": f"R{forfeit}",
                    "Actual pts": round(pts, 0),
                    "Avg pts at cost R": round(pv_at_forfeit, 0),
                    "Surplus": round(pts - pv_at_forfeit, 0),
                })
        kdf = pd.DataFrame(keeper_results)
        if not kdf.empty:
            best = kdf.nlargest(10, "Surplus")
            worst = kdf.nsmallest(10, "Surplus")
            c1, c2 = st.columns(2)
            with c1:
                st.markdown("**Top 10 keeper hits**")
                st.dataframe(best, use_container_width=True, hide_index=True)
            with c2:
                st.markdown("**Bottom 10 keeper busts**")
                st.dataframe(worst, use_container_width=True, hide_index=True)

        # ============================================================
        # 9. Trade activity timeline
        # ============================================================
        st.subheader("9. Trade activity by week")
        st.caption("When in the season do trades happen? Spike near the "
                   "trade deadline?")
        ta_rows = []
        for t in D["trades"]:
            ta_rows.append({"Season": t["_season"], "Week": t["_week"]})
        tadf = pd.DataFrame(ta_rows)
        if not tadf.empty:
            timeline = (alt.Chart(tadf).mark_bar()
                          .encode(x=alt.X("Week:O"),
                                  y=alt.Y("count()", title="Trades"),
                                  color="Season:N",
                                  tooltip=["Season", "Week", "count()"])
                          .properties(height=240))
            st.altair_chart(timeline, use_container_width=True)

        # ============================================================
        # 10. Manager-pair affinity (who trades with whom)
        # ============================================================
        st.subheader("10. Manager-pair trade affinity")
        st.caption("How often each pair of managers traded with each other "
                   "(across all 45 trades). Heatmap; brighter = more trades.")
        pair_counts: dict[tuple[str, str], int] = {}
        for t in D["trades"]:
            rosters = sorted(t.get("roster_ids") or [])
            for i in range(len(rosters)):
                for j in range(i + 1, len(rosters)):
                    a = D["roster_team_name"].get(int(rosters[i]),
                                                  f"R{rosters[i]}")
                    b = D["roster_team_name"].get(int(rosters[j]),
                                                  f"R{rosters[j]}")
                    pair_counts[(a, b)] = pair_counts.get((a, b), 0) + 1
        if pair_counts:
            pairs_data = []
            teams_seen = set()
            for (a, b), n in pair_counts.items():
                pairs_data.append({"A": a, "B": b, "Count": n})
                pairs_data.append({"A": b, "B": a, "Count": n})  # mirror
                teams_seen.update([a, b])
            for t in teams_seen:
                pairs_data.append({"A": t, "B": t, "Count": 0})  # diagonal
            pdf2 = pd.DataFrame(pairs_data)
            heatmap = (alt.Chart(pdf2).mark_rect()
                        .encode(x=alt.X("A:N", sort=sorted(teams_seen)),
                                y=alt.Y("B:N", sort=sorted(teams_seen)),
                                color=alt.Color("Count:Q",
                                                 scale=alt.Scale(scheme="blues")),
                                tooltip=["A", "B", "Count"])
                        .properties(height=400))
            st.altair_chart(heatmap, use_container_width=True)

        # ============================================================
        # 11. Year-over-year roster stability
        # ============================================================
        st.subheader("11. Year-over-year roster stability")
        st.caption("% of each team's roster retained from previous season. "
                   "100% = no churn, 0% = totally rebuilt.")
        stab_rows = []
        years_sorted = sorted(D["seasons"])
        for i in range(1, len(years_sorted)):
            prev_yr, cur_yr = years_sorted[i - 1], years_sorted[i]
            prev = D["seasons"][prev_yr]["rosters"]
            cur = D["seasons"][cur_yr]["rosters"]
            # Need rosters' player_id sets per team. Re-read from raw JSON.
            prev_dir = (ROOT / "data" / "sleeper" /
                         f"league_{D['seasons'][prev_yr]['league_id']}")
            cur_dir = (ROOT / "data" / "sleeper" /
                        f"league_{D['seasons'][cur_yr]['league_id']}")
            try:
                prev_rosters_raw = _json.loads(
                    (prev_dir / "rosters.json").read_text(encoding="utf-8"))
                cur_rosters_raw = _json.loads(
                    (cur_dir / "rosters.json").read_text(encoding="utf-8"))
            except Exception:
                continue
            prev_pid_by_rid = {int(r["roster_id"]):
                                set(str(p) for p in (r.get("players") or []))
                                for r in prev_rosters_raw}
            cur_pid_by_rid = {int(r["roster_id"]):
                                set(str(p) for p in (r.get("players") or []))
                                for r in cur_rosters_raw}
            for rid in cur_pid_by_rid:
                team = cur.get(rid, {}).get("team_name", f"R{rid}")
                pset = prev_pid_by_rid.get(rid, set())
                cset = cur_pid_by_rid.get(rid, set())
                if pset:
                    pct = 100 * len(pset & cset) / len(pset)
                else:
                    pct = 0
                stab_rows.append({"Year": cur_yr, "Team": team,
                                   "Retention %": round(pct, 1)})
        sdf = pd.DataFrame(stab_rows)
        if not sdf.empty:
            stab_chart = (alt.Chart(sdf).mark_bar()
                            .encode(x=alt.X("Team:N", sort="-y"),
                                    y=alt.Y("Retention %:Q"),
                                    color="Year:N",
                                    xOffset="Year:N",
                                    tooltip=["Team", "Year", "Retention %"])
                            .properties(height=320))
            st.altair_chart(stab_chart, use_container_width=True)


def _show_final(draft: Draft):
    rows = []
    for team in draft.teams:
        for p in sorted(team.roster, key=lambda x: (x.position, -x.vbd)):
            rows.append({"Team": team.name, "Pos": p.position, "Player": p.name})
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
