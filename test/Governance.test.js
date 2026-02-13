const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Governance Platform - ALL REQUIREMENTS", function () {
    async function deployGovernanceFixture() {
        const [owner, user1, user2, user3] = await ethers.getSigners();

        const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
        const token = await GovernanceToken.deploy();
        await token.waitForDeployment();
        const tokenAddress = await token.getAddress();

        const MyGovernor = await ethers.getContractFactory("MyGovernor");
        const governor = await MyGovernor.deploy(tokenAddress);
        await governor.waitForDeployment();
        const governorAddress = await governor.getAddress();

        await token.transfer(user1.address, ethers.parseEther("10000"));
        await token.transfer(user2.address, ethers.parseEther("5000"));
        await token.transfer(user3.address, ethers.parseEther("500"));

        await token.connect(owner).delegate(owner.address);
        await token.connect(user1).delegate(user1.address);
        await token.connect(user2).delegate(user2.address);
        await token.connect(user3).delegate(user3.address);

        return { token, governor, owner, user1, user2, user3, tokenAddress, governorAddress };
    }

    describe("Requirement #5: Proposal Threshold", function () {
        it("Should reject proposals from users below threshold", async function () {
            const { governor, token, user3, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [user3.address, 0]);

            await expect(
                governor.connect(user3)["propose(address[],uint256[],bytes[],string)"](
                    [tokenAddress],
                    [0],
                    [calldata],
                    "Test"
                )
            ).to.be.revertedWith("Governor: proposer balance below threshold");
        });

        it("Should allow proposals from users with sufficient tokens", async function () {
            const { governor, token, user1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [user1.address, 0]);

            await expect(
                governor.connect(user1)["propose(address[],uint256[],bytes[],string)"](
                    [tokenAddress],
                    [0],
                    [calldata],
                    "Test"
                )
            ).to.emit(governor, "ProposalCreated");
        });
    });

    describe("Requirement #9: Quadratic Voting", function () {
        it("Should calculate votes correctly (sqrt formula)", async function () {
            const { governor, token, user1, tokenAddress, governorAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [user1.address, 0]);
            const tx = await governor.connect(user1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress],
                [0],
                [calldata],
                "QV test",
                1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "ProposalCreated");
            const proposalId = event.args[0];

            await time.increase(1);

            // 9 tokens -> 3 votes (sqrt(9) = 3)
            const cost = ethers.parseEther("9");
            await token.connect(user1).approve(governorAddress, cost);
            await governor.connect(user1).castQuadraticVote(proposalId, 1, cost);

            const votes = await governor.proposalVotes(proposalId);
            expect(votes[1]).to.equal(ethers.parseEther("3")); // Should be 3 votes, not 81!
        });

        it("Should reject non-perfect-square costs", async function () {
            const { governor, token, user1, tokenAddress, governorAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [user1.address, 0]);
            const tx = await governor.connect(user1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress],
                [0],
                [calldata],
                "QV non-square test",
                1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "ProposalCreated");
            const proposalId = event.args[0];

            await time.increase(1);

            const cost = ethers.parseEther("5"); // 5 is not a perfect square
            await token.connect(user1).approve(governorAddress, cost);

            await expect(
                governor.connect(user1).castQuadraticVote(proposalId, 1, cost)
            ).to.be.revertedWith("Governor: cost must be perfect square");
        });

        it("Should transfer tokens when voting", async function () {
            const { governor, token, user1, tokenAddress, governorAddress } = await loadFixture(deployGovernanceFixture);

            const initialBalance = await token.balanceOf(user1.address);

            const calldata = token.interface.encodeFunctionData("transfer", [user1.address, 0]);
            const tx = await governor.connect(user1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress],
                [0],
                [calldata],
                "QV transfer test",
                1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "ProposalCreated");
            const proposalId = event.args[0];

            await time.increase(1);

            const cost = ethers.parseEther("4");
            await token.connect(user1).approve(governorAddress, cost);
            await governor.connect(user1).castQuadraticVote(proposalId, 1, cost);

            const newBalance = await token.balanceOf(user1.address);
            expect(initialBalance - newBalance).to.equal(cost);
            expect(await token.balanceOf(governorAddress)).to.equal(cost);
        });
    });

    // Add more tests for all 15 requirements...
    // (snapshot, quorum, delegation, events, etc.)
});
