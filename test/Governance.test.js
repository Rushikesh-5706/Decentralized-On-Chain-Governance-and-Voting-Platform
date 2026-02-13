const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("Governance Protocol - Integration Suite", function () {
    let Token, token;
    let Governor, governor;
    let owner, addr1, addr2, addr3, addr4;

    const MIN_PROPOSAL_VOTES = ethers.parseEther("1000"); // 1000 tokens
    const TOTAL_SUPPLY = ethers.parseEther("1000000"); // 1M tokens
    const QUORUM_FRACTION = 4; // 4%
    const VOTING_DELAY = 0;
    const VOTING_PERIOD = 50400; // ~1 week

    beforeEach(async function () {
        [owner, addr1, addr2, addr3, addr4] = await ethers.getSigners();

        // Deploy Core Assets
        Token = await ethers.getContractFactory("GovernanceToken");
        token = await Token.deploy();
        await token.waitForDeployment();

        Governor = await ethers.getContractFactory("MyGovernor");
        governor = await Governor.deploy(await token.getAddress());
        await governor.waitForDeployment();

        // Seed Accounts & Delegate Power
        await token.transfer(addr1.address, ethers.parseEther("50000"));
        await token.transfer(addr2.address, ethers.parseEther("10000"));
        await token.transfer(addr3.address, ethers.parseEther("2000"));
        await token.transfer(addr4.address, ethers.parseEther("100"));

        // Delegation is prerequisite for voting power snapshots
        await token.connect(owner).delegate(owner.address);
        await token.connect(addr1).delegate(addr1.address);
        await token.connect(addr2).delegate(addr2.address);
        await token.connect(addr4).delegate(addr4.address);
    });

    describe("Proposal Validation (Threshold Enforcement)", function () {
        it("reverts if proposer power is below threshold", async function () {
            await expect(
                governor.connect(addr4)["propose(address[],uint256[],bytes[],string,uint8)"](
                    [await token.getAddress()], [0], ["0x"], "Proposal 1", 0
                )
            ).to.be.revertedWithCustomError(governor, "MyGovernor__BelowProposalThreshold");
        });

        it("allows submission when power meets threshold", async function () {
            await expect(
                governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                    [await token.getAddress()], [0], ["0x"], "Proposal 2", 0
                )
            ).to.emit(governor, "ProposalCreated");
        });

        it("factors delegated votes only (ignores raw balance)", async function () {
            // addr3 has 2000 tokens but 0 delegated votes
            await expect(
                governor.connect(addr3)["propose(address[],uint256[],bytes[],string,uint8)"](
                    [await token.getAddress()], [0], ["0x"], "Proposal 3", 0
                )
            ).to.be.revertedWithCustomError(governor, "MyGovernor__BelowProposalThreshold");
        });
    });

    describe("Quadratic Voting Mechanism", function () {
        let proposalId;

        beforeEach(async function () {
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [await token.getAddress()], [0], ["0x"], "QV Core Proposal", 1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment && log.fragment.name === 'ProposalCreated');
            proposalId = event.args.proposalId;
            await mine(1); // Advance to voting block
        });

        it("calculates cost accurately for 10 vote units (cost = 100 power)", async function () {
            const numVotes = ethers.parseEther("10");
            await governor.connect(addr1).castQuadraticVote(proposalId, 1, numVotes);

            const votes = await governor.proposalVotes(proposalId);
            expect(votes.forVotes).to.equal(numVotes);

            const [, used] = await governor.getQuadraticVotingPower(proposalId, addr1.address);
            expect(used).to.equal(ethers.parseEther("100"));
        });

        it("reverts on insufficient voting power budget", async function () {
            const unaffordableVotes = ethers.parseEther("300"); // 300^2 = 90,000 > 50,000 balance
            await expect(
                governor.connect(addr1).castQuadraticVote(proposalId, 1, unaffordableVotes)
            ).to.be.revertedWithCustomError(governor, "MyGovernor__InsufficientVotingPower");
        });
    });

    describe("Protocol Governance & State", function () {
        it("Owner can pause and unpause operations", async function () {
            await governor.connect(owner).pause();
            await expect(
                governor.connect(addr1).castVote(0, 1) // Mock PID
            ).to.be.revertedWithCustomError(governor, "EnforcedPause");

            await governor.connect(owner).unpause();
            // Should not revert with EnforcedPause now (but might with other errors like non-existent proposal)
        });

        it("Proposal succeeds upon meeting quorum and majority", async function () {
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [await token.getAddress()], [0], ["0x"], "Standard Majority Prop", 0
            );
            const receipt = await tx.wait();
            const pid = receipt.logs[0].args.proposalId;
            await mine(1);

            await governor.connect(addr1).castVote(pid, 1);
            await mine(VOTING_PERIOD + 1);

            expect(await governor.state(pid)).to.equal(4); // Succeeded
        });
    });
});
