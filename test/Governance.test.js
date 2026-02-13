const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("Governance System", function () {
    let GovernanceToken, MyGovernor;
    let token, governor;
    let owner, addr1, addr2, addr3;
    let tokenAddress, governorAddress;

    beforeEach(async function () {
        [owner, addr1, addr2, addr3] = await ethers.getSigners();

        GovernanceToken = await ethers.getContractFactory("GovernanceToken");
        token = await GovernanceToken.deploy();
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        MyGovernor = await ethers.getContractFactory("MyGovernor");
        governor = await MyGovernor.deploy(tokenAddress);
        await governor.waitForDeployment();
        governorAddress = await governor.getAddress();

        // Mint tokens to addr1 and addr2
        // Owner has 1M from constructor
        await token.transfer(addr1.address, ethers.parseEther("1000")); // 1000 GT
        await token.transfer(addr2.address, ethers.parseEther("1000")); // 1000 GT

        // Delegate
        await token.connect(owner).delegate(owner.address);
        await token.connect(addr1).delegate(addr1.address);
        await token.connect(addr2).delegate(addr2.address);
    });

    it("Should allow Standard Voting (1 token = 1 vote)", async function () {
        const grantAmount = ethers.parseEther("100");
        const transferCalldata = token.interface.encodeFunctionData("transfer", [addr3.address, grantAmount]);

        // Create standard proposal
        // description: "Proposal #1: Give grant"
        const tx = await governor.propose(
            [tokenAddress],
            [0],
            [transferCalldata],
            "Proposal #1: Give grant" // Standard default
        );
        const receipt = await tx.wait();

        // Get proposalId from event
        const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'ProposalCreated');
        const proposalId = event.args[0];

        // Mine blocks to reach voting start
        // Governor settings: delay 0? check constructor
        // GovernorSettings(0, 50400, 0) -> delay 0
        // Voting period starts immediately or next block?
        // Proposal snapshot is created at current block. Voting starts at snapshot + votingDelay.
        // If delay is 0, voting starts at propose block? 
        // OpenZeppelin 5.x: snapshot is `point` in time. 
        // Usually need to advance 1 block to be safe.
        await mine(1);

        // Cast vote - Standard
        // Addr1 has 1000 tokens. Weight should be 1000e18.
        // Vote For = 1
        await governor.connect(addr1).castVote(proposalId, 1);

        // Check votes
        // GovernorCountingSimple: proposalVotes(proposalId) returns (for, against, abstain)
        const votes = await governor.proposalVotes(proposalId);
        expect(votes[1]).to.equal(ethers.parseEther("1000")); // For votes
    });

    it("Should allow Quadratic Voting (Cost = Votes^2)", async function () {
        const grantAmount = ethers.parseEther("100");
        const transferCalldata = token.interface.encodeFunctionData("transfer", [addr3.address, grantAmount]);

        // Create QV proposal
        // Need to call the overloaded propose with VotingType.Quadratic = 1
        const tx = await governor["propose(address[],uint256[],bytes[],string,uint8)"](
            [tokenAddress],
            [0],
            [transferCalldata],
            "Proposal #2: QV Grant",
            1 // Quadratic
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'ProposalCreated');
        const proposalId = event.args[0];

        await mine(1);

        // Addr1 wants to cast 10 votes (weight = 10). Cost = 100 tokens (wei comparison carefully)
        // Actually our tokens have 18 decimals. 
        // If we want 10 "units" of weight?
        // The contract logic:
        // uint256 weight = abi.decode(params, (uint256));
        // cost = weight * weight;
        // token.transferFrom(account, this, cost);
        //
        // If weight is in Wei (e.g. 1e18), then cost = 1e36. That is HUGE.
        // User only has 1000e18.
        // So weight must be "small" number of units?
        // Or weight is token-wei?
        // If I want 1 vote (1e18 weight), cost is (1e18)^2 = 1e36.
        // This implies QV mechanism treats "1 vote" as "1 wei of vote weight" OR the formula should be normalized.
        // Standard voting: 1 token (1e18) = 1e18 votes.
        // If we want to be comparable, we probably want weight to be in 1e18 units too.
        // But then cost is squared 1e18... 
        // 
        // Implementation in MyGovernor.sol:
        // cost = weight * weight;
        // transferFrom(..., cost);
        //
        // If I pass weight = 10 (raw units, 10 wei), cost = 100 wei.
        // Addr1 has 1000e18 wei. Can easily pay 100 wei.
        // But 10 wei vote weight is tiny compared to 1000e18 (standard).
        // So for QV to make sense, maybe inputs are smaller? OR tokens are just raw numbers.
        // In this test, we accept raw units.

        const weight = 10n; // 10 units
        const cost = weight * weight; // 100 units
        const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [weight]);

        // Approve governor to spend tokens
        await token.connect(addr1).approve(governorAddress, cost);

        // Balance before
        const balBefore = await token.balanceOf(addr1.address);

        await governor.connect(addr1).castVoteWithReasonAndParams(
            proposalId,
            1, // For
            "I love QV",
            params
        );

        const balAfter = await token.balanceOf(addr1.address);
        expect(balBefore - balAfter).to.equal(cost);

        const votes = await governor.proposalVotes(proposalId);
        expect(votes[1]).to.equal(weight);
    });

    it("Should enforce Quorum", async function () {
        const grantAmount = ethers.parseEther("100");
        const transferCalldata = token.interface.encodeFunctionData("transfer", [addr3.address, grantAmount]);

        // Create Standard Proposal
        const tx = await governor.propose(
            [tokenAddress],
            [0],
            [transferCalldata],
            "Proposal #3: Quorum Test"
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'ProposalCreated');
        const proposalId = event.args[0];

        await mine(1);

        // Quorum is 4% of supply. Supply = 1,000,000 + 2000 = 1,002,000 (roughly 1M).
        // 4% of 1M = 40,000.
        // Addr1 has 1000. Not enough.
        // Owner has ~1M.

        // If Addr1 votes, state should still be Active (or Defeated if period ends).
        await governor.connect(addr1).castVote(proposalId, 1);

        // Advance time to end
        // Period = 50400 blocks (1 week).
        // We can use mine(blocks) or increase time? 
        // Governor check block number.
        await mine(50401);

        // Check state. 
        // enum ProposalState { Pending, Active, Canceled, Defeated, Succeeded, Queued, Expired, Executed }
        // 0: Pending, 1: Active, 2: Canceled, 3: Defeated, 4: Succeeded
        const state = await governor.state(proposalId);
        expect(state).to.equal(3); // Defeated due to quorum failure (only 1000 votes < 40000)
    });

    it("Should prevent double voting in QV to enforce cost logic", async function () {
        const grantAmount = ethers.parseEther("100");
        const transferCalldata = token.interface.encodeFunctionData("transfer", [addr3.address, grantAmount]);

        // Create QV Proposal
        const tx = await governor["propose(address[],uint256[],bytes[],string,uint8)"](
            [tokenAddress],
            [0],
            [transferCalldata],
            "Proposal #4: Double Vote Test",
            1 // Quadratic
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'ProposalCreated');
        const proposalId = event.args[0];

        await mine(1);

        const weight = 5n;
        const cost = weight * weight; // 25
        const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [weight]);

        await token.connect(addr1).approve(governorAddress, cost * 2n);

        // Vote 1
        await governor.connect(addr1).castVoteWithReasonAndParams(proposalId, 1, "Vote 1", params);

        // Vote 2 (Should fail)
        await expect(
            governor.connect(addr1).castVoteWithReasonAndParams(proposalId, 1, "Vote 2", params)
        ).to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote")
            .withArgs(addr1.address);
    });
});
