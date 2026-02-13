// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MyGovernor
 * @author Optimized AI Engineer
 * @notice A governance contract supporting both Standard (1 Token 1 Vote) and Quadratic Voting (QV).
 * @dev Optimized for gas efficiency using custom errors and adhering to professional NatSpec standards.
 */
contract MyGovernor is 
    Governor, 
    GovernorSettings, 
    GovernorCountingSimple, 
    GovernorVotes, 
    GovernorVotesQuorumFraction,
    ReentrancyGuard,
    Pausable,
    Ownable
{
    /**
     * @notice Types of voting mechanisms supported by the protocol.
     */
    enum VotingType { Standard, Quadratic }

    /* Custom Errors for Gas Optimization */
    error MyGovernor__BelowProposalThreshold(uint256 votes, uint256 threshold);
    error MyGovernor__InvalidVotingType(uint256 proposalId);
    error MyGovernor__ZeroVotesCast();
    error MyGovernor__InsufficientVotingPower(uint256 cost, uint256 available);

    /**
     * @notice Storage to track the voting mechanism assigned to each proposal.
     */
    mapping(uint256 => VotingType) public proposalVotingTypes;
    
    /**
     * @notice Minimum voting power (delegated) required to submit a proposal.
     */
    uint256 public immutable minProposalTokens;
    
    /**
     * @dev Tracks the accumulation of votes cast per user per proposal in QV mode.
     */
    mapping(uint256 => mapping(address => uint256)) private _quadraticVotesUsed;

    /**
     * @dev Tracks the accumulated voting power (cost) consumed per user per proposal in QV mode.
     */
    mapping(uint256 => mapping(address => uint256)) private _quadraticCostUsed;

    /**
     * @param _tokenVotes The ERC20Votes compatible token used for governance.
     */
    constructor(IVotes _tokenVotes)
        Governor("MyGovernor")
        GovernorSettings(
            0,              // voting delay: 0 blocks
            50400,          // voting period: ~1 week
            1000 * 10**18   // proposal threshold: 1000 tokens
        )
        GovernorVotes(_tokenVotes)
        GovernorVotesQuorumFraction(4) // 4% Quorum requirement
        Ownable(msg.sender)
    {
        minProposalTokens = 1000 * 10**18;
    }

    /**
     * @notice Submits a proposal with a designated voting mechanism.
     * @param targets Target addresses for proposal execution.
     * @param values Ether values for execution.
     * @param calldatas Encoded function calls.
     * @param description Text description of the proposal.
     * @param votingType The mechanism to use (Standard or Quadratic).
     * @return proposalId Unique identifier of the created proposal.
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        VotingType votingType
    ) public whenNotPaused returns (uint256) {
        uint256 playerVotes = getVotes(msg.sender, block.number - 1);
        if (playerVotes < minProposalTokens) {
            revert MyGovernor__BelowProposalThreshold(playerVotes, minProposalTokens);
        }
        
        uint256 proposalId = super.propose(targets, values, calldatas, description);
        proposalVotingTypes[proposalId] = votingType;
        return proposalId;
    }

    /**
     * @notice Overridden propose function defaulting to Standard voting mechanism.
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(Governor) whenNotPaused returns (uint256) {
        uint256 playerVotes = getVotes(msg.sender, block.number - 1);
        if (playerVotes < minProposalTokens) {
            revert MyGovernor__BelowProposalThreshold(playerVotes, minProposalTokens);
        }
        
        uint256 proposalId = super.propose(targets, values, calldatas, description);
        proposalVotingTypes[proposalId] = VotingType.Standard;
        return proposalId;
    }

    /**
     * @notice Performs Quadratic Voting where cost = (votes * votes) / 1e18.
     * @dev Uses voting power snapshots; no actual token transfers occur.
     * @param proposalId ID of the active proposal.
     * @param support Against (0), For (1), or Abstain (2).
     * @param numVotes Number of votes (in 1e18 units) to cast.
     */
    function castQuadraticVote(
        uint256 proposalId,
        uint8 support,
        uint256 numVotes
    ) external nonReentrant whenNotPaused returns (uint256) {
        if (proposalVotingTypes[proposalId] != VotingType.Quadratic) {
            revert MyGovernor__InvalidVotingType(proposalId);
        }
        if (numVotes == 0) {
            revert MyGovernor__ZeroVotesCast();
        }
        
        address account = _msgSender();
        
        // Mathematical Model: Cost = (Votes^2) / Precision
        uint256 cost = (numVotes * numVotes) / 1e18;
        
        uint256 totalPower = getVotes(account, proposalSnapshot(proposalId));
        uint256 alreadyUsed = _quadraticCostUsed[proposalId][account];
        
        if (alreadyUsed + cost > totalPower) {
            revert MyGovernor__InsufficientVotingPower(cost, totalPower - alreadyUsed);
        }
        
        _quadraticVotesUsed[proposalId][account] += numVotes;
        _quadraticCostUsed[proposalId][account] += cost;
        
        bytes memory params = abi.encode(numVotes);
        return _castVote(proposalId, account, support, "", params);
    }

    /**
     * @dev Overridden to incorporate Quadratic Voting weights.
     */
    function _countVote(
        uint256 proposalId,
        address account,
        uint8 support,
        uint256 weight,
        bytes memory params
    ) internal override(Governor, GovernorCountingSimple) returns (uint256) {
        uint256 countedWeight = weight;

        if (proposalVotingTypes[proposalId] == VotingType.Quadratic && params.length > 0) {
            countedWeight = abi.decode(params, (uint256));
        }

        return super._countVote(proposalId, account, support, countedWeight, params);
    }
    
    /**
     * @notice Returns the proposal threshold in 1e18 units.
     */
    function proposalThreshold() public view override(Governor, GovernorSettings) returns (uint256) {
        return minProposalTokens;
    }
    
    /**
     * @notice Provides detailed data regarding a user's QV power consumption.
     * @return remaining Unused voting power.
     * @return used Power already consumed in cost increments.
     * @return total Total snapshot-based power.
     */
    function getQuadraticVotingPower(uint256 proposalId, address account) external view returns (uint256 remaining, uint256 used, uint256 total) {
        total = getVotes(account, proposalSnapshot(proposalId));
        used = _quadraticCostUsed[proposalId][account];
        remaining = total > used ? total - used : 0;
    }

    /**
     * @notice Emergency administrative pause.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Resume protocol operations.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Core voting internal logic protected by Pausable.
     */
    function _castVote(
        uint256 proposalId,
        address account,
        uint8 support,
        string memory reason,
        bytes memory params
    ) internal override whenNotPaused returns (uint256) {
        return super._castVote(proposalId, account, support, reason, params);
    }
}
