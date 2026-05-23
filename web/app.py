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
from fantasy_draft.keepers import Keeper, apply_keepers  # noqa: E402
from fantasy_draft.league import LeagueConfig  # noqa: E402
from fantasy_draft.players import load_players  # noqa: E402
from fantasy_draft.predict import score_candidates_for_team  # noqa: E402
from fantasy_draft.recommend import recommend  # noqa: E402
from fantasy_draft.simulate import availability_distribution  # noqa: E402
from fantasy_draft.sleeper_offline import history_from_offline, league_from_offline  # noqa: E402
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
    s.setdefault("my_team_idx", 0)
    s.setdefault("sleeper_dump_path", str(ROOT / "data" / "sleeper"))
    s.setdefault("league_path", str(ROOT / "configs" / "superflex_12.json"))
    s.setdefault("players_path", str(ROOT / "data" / "players_sample.csv"))


_init_state()


tab_setup, tab_keepers, tab_draft = st.tabs(
    ["1. Setup", "2. Keeper Predictions", "3. Live Draft"]
)


# ------------------------------------------------------------------------
# Tab 1: Setup
# ------------------------------------------------------------------------

with tab_setup:
    st.header("League Setup")

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
                    st.session_state.league = cfg
                    st.session_state.by_season = by_season
                    st.success(f"Loaded **{cfg.name}** with {len(by_season)} season(s) of history")
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
    st.header("Predicted Keepers")
    st.caption(
        "For each team, we rank their roster by **net value** = "
        "player VBD − expected VBD of the player they could have drafted "
        "in the round they'd forfeit. Top 4 = predicted keepers."
    )

    league = st.session_state.league
    players = st.session_state.players
    by_season = st.session_state.by_season

    if not (league and players):
        st.info("Load a league and players CSV in tab 1 first.")
    elif not by_season:
        st.info(
            "No draft history loaded. Load a Sleeper dump in tab 1 to get past "
            "drafts (needed to know who each team owns and at what cost)."
        )
    else:
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
            preds = predict_keepers_for_league(
                by_season[last_season], players, league,
                max_keepers=league.keepers.max_keepers_per_team or 4,
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
        if st.button("New draft", help="Reset board and apply predicted keepers"):
            draft = Draft.new(league)
            # Use predicted keepers if available; otherwise empty.
            preds = st.session_state.predicted_keepers
            applied: list[Keeper] = []
            n_keep = league.keepers.max_keepers_per_team or 4
            # Map team_id (Sleeper roster_id) to team_idx (0..N-1) by enumerating
            # the predicted team ids in sorted order.
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


def _show_final(draft: Draft):
    rows = []
    for team in draft.teams:
        for p in sorted(team.roster, key=lambda x: (x.position, -x.vbd)):
            rows.append({"Team": team.name, "Pos": p.position, "Player": p.name})
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
