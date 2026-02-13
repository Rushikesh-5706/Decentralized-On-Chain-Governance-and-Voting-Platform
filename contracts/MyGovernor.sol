// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MyGovernor
 * @dev Governor contract supporting both Standard (1T1V) and Quadratic Voting (QV).
 */
contract MyGovernor is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction {
    
    enum VotingType { Standard, Quadratic }
    
    /// @notice Mapping from proposalId to its VotingType
    mapping(uint256 => VotingType) public proposalVotingTypes;

    constructor(IVotes _token)
        Governor("MyGovernor")
        GovernorSettings(0, 50400, 0) // Delay 0 (immediate), Period 1 week, Threshold 0
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4) // 4% Quorum
    {}

    /**
     * @dev Create a proposal with a specific VotingType.
     * @param votingType The mechanism to use (Standard or Quadratic).
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        VotingType votingType
    ) public returns (uint256) {
        uint256 proposalId = super.propose(targets, values, calldatas, description);
        proposalVotingTypes[proposalId] = votingType;
        return proposalId;
    }

    /**
     * @dev Override standard propose to default to Standard voting.
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(Governor) returns (uint256) {
        return this.propose(targets, values, calldatas, description, VotingType.Standard);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    /**
     * @dev Internal function to cast a vote.
     * Overridden to implement Quadratic Voting logic.
     */
    function _castVote(
        uint256 proposalId,
        address account,
        uint8 support,
        string memory reason,
        bytes memory params
    ) internal override returns (uint256) {
        VotingType vType = proposalVotingTypes[proposalId];

        if (vType == VotingType.Standard) {
            return super._castVote(proposalId, account, support, reason, params);
        } else {
            // Quadratic Voting Logic
            
            // Check if user has already voted to prevent vote splitting exploit
            // GovernorCountingSimple tracks hasVoted[account]
            // We rely on _countVote to revert if already voted.
            
            require(params.length > 0, "MyGovernor: QV requires params (vote weight)");
            
            // Decode weight. Assuming weight is raw units.
            uint256 weight = abi.decode(params, (uint256));
            require(weight > 0, "MyGovernor: Vote weight must be greater than 0");

            // Calculate cost: votes^2
            uint256 cost = weight * weight;

            // Transfer cost from voter to this contract
            // The user must approve this contract to spend their tokens beforehand.
            bool success = IERC20(address(token())).transferFrom(account, address(this), cost);
            require(success, "MyGovernor: QV token transfer failed");

            // Count the vote
            // This will revert if account has already voted on this proposal
            _countVote(proposalId, account, support, weight, params);

            // Emit event manually since we are bypassing super._castVote logic partly
            emit VoteCast(account, proposalId, support, weight, reason);

            return weight;
        }
    }
}
