// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./PlayerNFT.sol";
import "./TeamNFT.sol";
import "./GridironToken.sol";

/// @notice Annual player draft — worst team picks first, 7 rounds
contract DraftSystem is Ownable {
    PlayerNFT     public immutable playerNFT;
    TeamNFT       public immutable teamNFT;
    GridironToken public immutable grid;

    uint256 public constant ROUNDS    = 7;
    uint256 public constant TEAMS     = 32;
    uint256 public constant PICK_FEE  = 50 * 10 ** 18; // 50 GRID per pick activation

    // ─── State ───────────────────────────────────────────────────────────────

    uint256 public currentSeason;
    bool    public draftOpen;

    uint256[32] public draftOrder;           // teamIds worst→best
    uint256[]   public prospects;            // playerNFT ids available this season

    struct Pick {
        uint256 teamId;
        uint8   round;
        uint8   slot;       // 1-32 within the round
        uint256 playerId;   // 0 = not yet used
        bool    used;
    }

    // season → flat array of 224 picks (7 rounds × 32 teams)
    mapping(uint256 => Pick[]) public picks;
    // season → teamId → pick indices in picks[]
    mapping(uint256 => mapping(uint256 => uint256[])) public teamPickIndices;
    // season → prospectIndex → taken flag
    mapping(uint256 => mapping(uint256 => bool)) public prospectTaken;

    event DraftOpened(uint256 indexed season, uint256 prospects);
    event DraftClosed(uint256 indexed season);
    event PickMade(uint256 indexed season, uint256 indexed teamId, uint256 indexed playerId, uint8 round, uint8 slot);
    event TradeExecuted(uint256 teamA, uint256 pickIdxA, uint256 teamB, uint256 pickIdxB);

    constructor(address _player, address _team, address _token) Ownable(msg.sender) {
        playerNFT = PlayerNFT(_player);
        teamNFT   = TeamNFT(_team);
        grid      = GridironToken(_token);
    }

    // ─── Commissioner controls ────────────────────────────────────────────────

    function setDraftOrder(uint256[32] calldata order) external onlyOwner {
        draftOrder = order;
    }

    function openDraft(uint256 season, uint256[] calldata prospectIds) external onlyOwner {
        require(!draftOpen, "Draft: already open");
        currentSeason = season;
        draftOpen     = true;
        delete prospects;
        for (uint256 i; i < prospectIds.length; i++) prospects.push(prospectIds[i]);

        // Build pick board
        for (uint8 r = 1; r <= ROUNDS; r++) {
            for (uint8 s = 1; s <= TEAMS; s++) {
                uint256 teamId = draftOrder[s - 1];
                uint256 idx    = picks[season].length;
                picks[season].push(Pick({ teamId: teamId, round: r, slot: s, playerId: 0, used: false }));
                teamPickIndices[season][teamId].push(idx);
            }
        }
        emit DraftOpened(season, prospectIds.length);
    }

    function closeDraft() external onlyOwner {
        draftOpen = false;
        emit DraftClosed(currentSeason);
    }

    // ─── Team actions ─────────────────────────────────────────────────────────

    /// @param pickIdx  index in picks[currentSeason]
    /// @param prospectIdx index in prospects[]
    function selectPlayer(uint256 pickIdx, uint256 prospectIdx) external {
        require(draftOpen, "Draft: not open");
        Pick storage p = picks[currentSeason][pickIdx];
        require(teamNFT.ownerOf(p.teamId) == msg.sender, "Draft: not your team");
        require(!p.used, "Draft: pick used");
        require(prospectIdx < prospects.length, "Draft: bad prospect idx");
        require(!prospectTaken[currentSeason][prospectIdx], "Draft: prospect gone");

        grid.transferFrom(msg.sender, address(this), PICK_FEE);
        prospectTaken[currentSeason][prospectIdx] = true;

        uint256 pid = prospects[prospectIdx];
        p.used     = true;
        p.playerId = pid;

        // Sign to team on a 4-year rookie deal
        playerNFT.sign(pid, p.teamId, 4, playerNFT.getPlayer(pid).salary);
        teamNFT.addToRoster(p.teamId, pid);

        emit PickMade(currentSeason, p.teamId, pid, p.round, p.slot);
    }

    /// @notice Two teams can swap picks (both must consent in one tx — use a multi-sig or front-end approval flow)
    function tradePicks(
        uint256 teamAId, uint256 pickIdxA,
        uint256 teamBId, uint256 pickIdxB
    ) external {
        require(
            teamNFT.ownerOf(teamAId) == msg.sender || teamNFT.ownerOf(teamBId) == msg.sender,
            "Draft: not involved"
        );
        Pick storage pA = picks[currentSeason][pickIdxA];
        Pick storage pB = picks[currentSeason][pickIdxB];
        require(!pA.used && !pB.used, "Draft: pick used");
        require(pA.teamId == teamAId && pB.teamId == teamBId, "Draft: wrong teams");

        pA.teamId = teamBId;
        pB.teamId = teamAId;
        emit TradeExecuted(teamAId, pickIdxA, teamBId, pickIdxB);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getProspects() external view returns (uint256[] memory) {
        return prospects;
    }

    function getTeamPicks(uint256 season, uint256 teamId) external view returns (Pick[] memory out) {
        uint256[] memory idxs = teamPickIndices[season][teamId];
        out = new Pick[](idxs.length);
        for (uint256 i; i < idxs.length; i++) out[i] = picks[season][idxs[i]];
    }

    function getRoundPicks(uint256 season, uint8 round) external view returns (Pick[] memory out) {
        Pick[] storage all = picks[season];
        uint256 cnt;
        for (uint256 i; i < all.length; i++) if (all[i].round == round) cnt++;
        out = new Pick[](cnt);
        uint256 j;
        for (uint256 i; i < all.length; i++) if (all[i].round == round) out[j++] = all[i];
    }

    // Commissioner can withdraw pick fees for prize pool / operations
    function withdrawFees(address to) external onlyOwner {
        grid.transfer(to, grid.balanceOf(address(this)));
    }
}
