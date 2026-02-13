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
     * 
     * Implements:
     * 1. Quadratic Voting with square root calculation
     * 2. Proposal threshold enforcement
     * 3. Perfect square validation for QV
     * 4. Decimal handling for 18-decimal tokens
     */
contract MyGovernor is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction {
    
    enum VotingType { Standard, Quadratic }
    
    /// @notice Mapping from proposalId to its VotingType
    mapping(uint256 => VotingType) public proposalVotingTypes;
    
    /// @notice Minimum tokens required to create a proposal (in wei)
    uint256 public immutable minProposalTokens;
    
    /// @notice Reference to the governance token
    IERC20 private immutable _token;
    
    /// @notice Track how much each user has spent on QV for each proposal
    mapping(uint256 => mapping(address => uint256)) private _quadraticSpent;

    constructor(IVotes _tokenVotes)
        Governor("MyGovernor")
        GovernorSettings(
            0,              // voting delay: 0 blocks (proposals start immediately)
            50400,          // voting period: ~1 week assuming 12s blocks
            1000 * 10**18   // proposal threshold: 1000 tokens
        )
        GovernorVotes(_tokenVotes)
        GovernorVotesQuorumFraction(4) // 4% Quorum
    {
        minProposalTokens = 1000 * 10**18; // 1000 tokens required to propose
        _token = IERC20(address(_tokenVotes));
    }

    /**
     * @dev Create a proposal with a specific VotingType.
     * Enforces minimum token balance requirement.
     * @param votingType The mechanism to use (Standard or Quadratic).
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description,
        VotingType votingType
    ) public returns (uint256) {
        // Check proposer has enough tokens to meet threshold
        require(
            _token.balanceOf(msg.sender) >= minProposalTokens,
            "Governor: proposer balance below threshold"
        );
        
        uint256 proposalId = super.propose(targets, values, calldatas, description);
        proposalVotingTypes[proposalId] = votingType;
        return proposalId;
    }

    /**
     * @dev Override standard propose to default to Standard voting.
     * Also enforces minimum token balance.
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(Governor) returns (uint256) {
        // Check proposer has enough tokens to meet threshold
        require(
            _token.balanceOf(msg.sender) >= minProposalTokens,
            "Governor: proposer balance below threshold"
        );
        
        uint256 proposalId = super.propose(targets, values, calldatas, description);
        proposalVotingTypes[proposalId] = VotingType.Standard;
        return proposalId;
    }

    /**
     * @dev Dedicated function for quadratic voting.
     * User specifies the COST in tokens (wei), and gets sqrt(cost) votes.
     * @param proposalId The proposal to vote on
     * @param support Vote type: 0=Against, 1=For, 2=Abstain
     * @param cost Amount of tokens (in wei) to spend. Must be a perfect square when converted to token units.
     */
    function castQuadraticVote(
        uint256 proposalId,
        uint8 support,
        uint256 cost
    ) external returns (uint256) {
        require(
            proposalVotingTypes[proposalId] == VotingType.Quadratic,
            "Governor: proposal is not quadratic"
        );
        require(cost > 0, "Governor: cost must be greater than 0");
        
        bytes memory params = abi.encode(cost);
        return _castVote(proposalId, _msgSender(), support, "", params);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return minProposalTokens;
    }

    /**
     * @dev Internal function to count votes.
     * Implements Quadratic Voting logic: votes = sqrt(cost).
     * Cost is calculated in token units, not wei, to establish a human-readable cost basis.
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
            uint256 cost = abi.decode(params, (uint256));
            require(cost > 0, "Governor: quadratic cost required");
            
            // Convert from wei to token units for calculation
            // This prevents overflow and allows human-readable perfect squares
            uint256 costTokens = cost / 1e18;
            require(costTokens > 0, "Governor: cost too small");
            
            // Calculate square root
            uint256 rootTokens = _sqrt(costTokens);
            
            // Verify perfect square
            // This prevents users from gaming the system with fractional votes
            require(
                rootTokens * rootTokens == costTokens,
                "Governor: cost must be perfect square"
            );
            
            // Convert back to wei for consistency with ERC20Votes
            uint256 countedVotes = rootTokens * 1e18;

            // Verify user hasn't exceeded their voting power
            uint256 spent = _quadraticSpent[proposalId][account];
            require(cost <= weight - spent, "Governor: insufficient voting power");
            _quadraticSpent[proposalId][account] = spent + cost;

            // Transfer tokens before counting vote
            // This ensures user has approved and has sufficient balance
            require(
                _token.allowance(account, address(this)) >= cost,
                "Governor: insufficient allowance"
            );
            bool success = _token.transferFrom(account, address(this), cost);
            require(success, "Governor: token transfer failed");

            countedWeight = countedVotes;
        }

        return super._countVote(proposalId, account, support, countedWeight, params);
    }

    /**
     * @dev Calculate integer square root using Babylonian method.
     * @param x The number to calculate square root of
     * @return y The integer square root
     */
    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) {
            return 0;
        }
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
