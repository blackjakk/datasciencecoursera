"""Parse historical drafts from MONEY_LEAGUE.xlsx using cell fill colors.

Each FF<year> sheet has:
- A draft grid: rows 0-16 = R1-R17, cols B-M = slot 1-12
- A team-color legend at rows 20-31: col A = nickname, col B = color swatch

A cell's BACKGROUND COLOR identifies the manager who actually owned that
pick (post-Yahoo-trade), independent of the original slot. This is the
only reliable source of pick attribution for pre-2024 seasons since the
Sleeper migration lost Yahoo's pick trades.

Public API:
  load_xlsx_drafts(xlsx_path) -> dict[year, list[XlsxPick]]
  XlsxPick = {year, round, slot, player_name, manager_nickname}

To resolve manager_nickname → Sleeper roster_id, use
fantasy_draft.team_identity.manager_for_xlsx_nickname().
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import openpyxl


@dataclass
class XlsxPick:
    year: int
    round: int
    slot: int            # original 1-12 draft slot
    player_name: str
    manager_nickname: str  # actual drafter per cell color (post-trade)


def _cell_color(cell) -> str | None:
    f = cell.fill
    if f and f.fgColor and f.fgColor.type == "rgb":
        return f.fgColor.rgb
    return None


def _team_color_map(ws) -> dict[str, str]:
    """Build {color_hex: manager_nickname} from rows 20-31 of an FF sheet."""
    out: dict[str, str] = {}
    for row_idx in range(20, 32):  # 0-indexed rows 20..31
        nick = ws.cell(row=row_idx + 1, column=1).value
        color = _cell_color(ws.cell(row=row_idx + 1, column=2))
        if nick and color:
            out[color] = str(nick).strip()
    return out


def load_xlsx_drafts(
    xlsx_path: str | Path = "data/historical/MONEY_LEAGUE.xlsx",
    years: list[int] | None = None,
) -> dict[int, list[XlsxPick]]:
    """Return {year: [XlsxPick]} for all FF<year> sheets that have a color
    legend at rows 20-31. Skips sheets where the legend is missing."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    out: dict[int, list[XlsxPick]] = {}
    for sheet in wb.sheetnames:
        if not sheet.startswith("FF"):
            continue
        try:
            year = int(sheet[2:])
        except ValueError:
            continue
        if years and year not in years:
            continue
        ws = wb[sheet]
        color_map = _team_color_map(ws)
        if len(color_map) < 8:
            # Older sheets (pre-2018) have a different layout — skip.
            continue
        picks: list[XlsxPick] = []
        # Draft grid: rows 0..16 (R1..R17), cols B..M (slots 1..12).
        # Some legacy sheets only have rounds up to R10.
        for r in range(17):
            for c in range(12):
                cell = ws.cell(row=r + 1, column=c + 2)
                player = cell.value
                if not player:
                    continue
                color = _cell_color(cell)
                if color not in color_map:
                    continue  # cell with no team color (header, empty)
                picks.append(XlsxPick(
                    year=year,
                    round=r + 1,
                    slot=c + 1,
                    player_name=str(player).strip(),
                    manager_nickname=color_map[color],
                ))
        if picks:
            out[year] = picks
    return out
