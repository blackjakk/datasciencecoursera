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
from fantasy_draft.trades import apply_trades, load_trades_from_sleeper_dump  # noqa: E402

import json as _json  # noqa: E402
from fantasy_draft.vbd import compute_vbd_post_keepers  # noqa: E402
from fantasy_draft.history import consolidate_years_kept, detect_keepers_by_adp  # noqa: E402

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
    s.setdefault("my_team_idx", 0)
    s.setdefault("sleeper_dump_path", str(ROOT / "data" / "sleeper"))
    s.setdefault("league_path", str(ROOT / "configs" / "superflex_12.json"))
    s.setdefault("players_path", str(ROOT / "data" / "players_2026.csv"))
    s.setdefault("keepers_path", str(ROOT / "data" / "keepers_2026.json"))


_init_state()


tab_setup, tab_keepers, tab_draft, tab_insights = st.tabs(
    ["1. Setup", "2. Keeper Predictions", "3. Live Draft", "4. Historical Insights"]
)


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
            players = load_players(str(ROOT / "data" / "players_2026.csv"))
            records = _json.loads((ROOT / "data" / "keepers_2026.json").read_text())

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
                    users = {u["user_id"]: u for u in _json.loads(users_path.read_text())}
                    for r in _json.loads(rosters_path.read_text()):
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
                "Note: 2026 draft slots haven't been drawn yet — team_idx is "
                "keyed by roster_id, so the snake order matches roster IDs 1..12. "
                "Reorder once slots are set."
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
        st.success(f"Player pool: {len(st.session_state.players)} loaded")


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
        n_drop = sum(1 for r in real_records if r["status"] == "forced_drop")
        trades_2026 = st.session_state.traded_picks
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Total xlsx keepers (2025)", len(real_records))
        c2.metric("Carryover → 2026", n_carry)
        c3.metric("Forced drops (yr3 cap)", n_drop)
        c4.metric("Traded 2026 picks", len(trades_2026))

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
            for r in recs:
                forfeit = r["prior_round"] - league.keepers.round_penalty
                tag = "★ KEEP" if r["status"] == "carryover" else "✕ FORCED DROP"
                rows.append({
                    "Status": tag,
                    "Player": r["player_name"],
                    "Pos": r.get("position", ""),
                    "2025 Round": r["prior_round"],
                    "2026 Cost": f"R{forfeit}" if forfeit > 0 else "n/a",
                    "Yrs Kept (prior)": r["years_kept"],
                })
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
    col_a, col_b, col_c = st.columns([1, 1, 2])
    with col_a:
        my_idx = st.number_input(
            "Your team slot (0-indexed)", min_value=0,
            max_value=league.num_teams - 1, value=st.session_state.my_team_idx, step=1,
        )
        st.session_state.my_team_idx = int(my_idx)
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
                # Real xlsx-truth keepers (MONEYLEAGUE 2026 preset). Pass the
                # forced-drops through too; apply_keepers will reject them via
                # max_years_consecutive=3 and surface a clear log line.
                for r in real_records:
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
        data = _json.loads(insights_path.read_text())
        st.caption(f"Generated {data.get('generated_at', '?')} from {data.get('source', '?')}")

        st.subheader("Keeper retention by position")
        st.caption(
            "Of all yr1 keepers at this position, what % became yr2 keepers? "
            "Same for yr2→yr3. Higher retention = the position holds value "
            "across years, so paying the round-penalty premium pays off."
        )
        ret = data["retention_by_position"]
        ret_rows = []
        for pos in ("QB", "RB", "WR", "TE"):
            d = ret.get(pos, {})
            ret_rows.append({
                "Pos": pos,
                "Yr1 keepers (n)": d.get("yr1_count", 0),
                "Yr1 → Yr2": f"{d['yr1_to_yr2_pct']:.0f}%" if d.get("yr1_to_yr2_pct") is not None else "—",
                "Yr2 keepers (n)": d.get("yr2_count", 0),
                "Yr2 → Yr3": f"{d['yr2_to_yr3_pct']:.0f}%" if d.get("yr2_to_yr3_pct") is not None else "—",
                "Hit cap (yr3)": d.get("hit_cap_count", 0),
            })
        st.dataframe(pd.DataFrame(ret_rows), use_container_width=True, hide_index=True)

        st.subheader("What happens after the 3-year cap")
        d = data["post_cap_dropoff"]
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Capped players (11 yrs)", d["total_capped"])
        c2.metric("Re-drafted EARLIER", d["fates"].get("redrafted_earlier", 0))
        c3.metric("Re-drafted later", d["fates"].get("redrafted_later", 0))
        c4.metric("Undrafted next year", d["fates"].get("undrafted_next_year", 0))
        earlier_n = d["fates"].get("redrafted_earlier", 0)
        total = d["total_capped"] or 1
        st.markdown(
            f"**{100 * earlier_n / total:.0f}%** of forced-out players came back "
            f"in an *earlier* round the next year — forced drops are typically "
            f"high-value early-round targets, not discards."
        )
        if d["earlier_round_distribution"]:
            rounds = d["earlier_round_distribution"]
            median = rounds[len(rounds) // 2]
            st.caption(
                f"Re-draft round distribution (for the {len(rounds)} who came "
                f"back earlier): min R{rounds[0]}, median R{median}, max R{rounds[-1]}."
            )
        with st.expander(f"Recent examples ({len(d['examples_redrafted_earlier'])})"):
            ex_rows = [{
                "Year capped": e["year"],
                "Player": e["player"],
                "Pos": e["position"],
                "Kept at": f"R{e['kept_round']}",
                "Re-drafted at": f"R{e['next_year_round']}",
            } for e in d["examples_redrafted_earlier"]]
            st.dataframe(pd.DataFrame(ex_rows), use_container_width=True, hide_index=True)

        st.subheader("2026 forced drops — re-draft prior")
        st.caption(
            "This year's 3 forced drops (yr3 cap), with the historical prior "
            "for where post-cap players tend to land. Plan to draft these "
            "early — most teams will."
        )
        fd_rows = [{
            "Player": f["player"],
            "Pos": f["position"],
            "2025 round": f"R{f['prior_round']}",
            "P(redrafted earlier)": f"{f['historical_redraft_earlier_pct']:.0f}%",
            "P(undrafted)": f"{f['historical_undrafted_pct']:.0f}%",
            "Median earlier round": f"R{f['median_earlier_round']}" if f["median_earlier_round"] else "—",
        } for f in data["forced_drops_2026"]]
        st.dataframe(pd.DataFrame(fd_rows), use_container_width=True, hide_index=True)


def _show_final(draft: Draft):
    rows = []
    for team in draft.teams:
        for p in sorted(team.roster, key=lambda x: (x.position, -x.vbd)):
            rows.append({"Team": team.name, "Pos": p.position, "Player": p.name})
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
