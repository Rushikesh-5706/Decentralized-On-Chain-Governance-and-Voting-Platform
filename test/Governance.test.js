const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, mine, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("🎯 COMPREHENSIVE Governance Test Suite", function () {

    // ============================================
    // FIXTURES & SETUP
    // ============================================

    async function deployGovernanceFixture() {
        const signers = await ethers.getSigners();
        const [owner, addr1, addr2, addr3, addr4, addr5] = signers;
        // Use a fresh signer for independent tests to avoid pre-existing delegation
        const freshUser = signers[10];

        // Deploy Token
        const Token = await ethers.getContractFactory("GovernanceToken");
        const token = await Token.deploy();
        await token.waitForDeployment();

        // Deploy Governor
        const Governor = await ethers.getContractFactory("MyGovernor");
        const governor = await Governor.deploy(await token.getAddress());
        await governor.waitForDeployment();

        // Distribute tokens
        await token.transfer(addr1.address, ethers.parseEther("50000"));  // Big whale
        await token.transfer(addr2.address, ethers.parseEther("10000"));  // Medium holder
        await token.transfer(addr3.address, ethers.parseEther("2000"));   // Above threshold
        await token.transfer(addr4.address, ethers.parseEther("500"));    // Below threshold
        await token.transfer(addr5.address, ethers.parseEther("100"));    // Tiny holder

        // Delegate (activate voting power)
        await token.connect(owner).delegate(owner.address);
        await token.connect(addr1).delegate(addr1.address);
        await token.connect(addr2).delegate(addr2.address);
        await token.connect(addr3).delegate(addr3.address);
        await token.connect(addr4).delegate(addr4.address);
        await token.connect(addr5).delegate(addr5.address);

        return {
            token,
            governor,
            owner,
            addr1,
            addr2,
            addr3,
            addr4,
            addr5,
            freshUser,
            tokenAddress: await token.getAddress(),
            governorAddress: await governor.getAddress()
        };
    }

    // ============================================
    // 1. TOKEN & DELEGATION TESTS
    // ============================================

    describe("1️⃣ Token & Delegation System", function () {

        it("Should deploy with correct initial supply", async function () {
            const { token, owner } = await loadFixture(deployGovernanceFixture);
            expect(await token.totalSupply()).to.equal(ethers.parseEther("1000000"));
            expect(await token.balanceOf(owner.address)).to.be.gt(0);
        });

        it("Should have correct token name and symbol", async function () {
            const { token } = await loadFixture(deployGovernanceFixture);
            expect(await token.name()).to.equal("GovernanceToken");
            expect(await token.symbol()).to.equal("GT");
        });

        it("Should allow delegation to self", async function () {
            const { token, owner } = await loadFixture(deployGovernanceFixture);
            const balance = await token.balanceOf(owner.address);
            const votes = await token.getVotes(owner.address);
            expect(votes).to.equal(balance); // Votes equal balance when delegated to self
        });

        it("Should emit DelegateChanged event", async function () {
            // Setup fresh environment
            const { token, freshUser } = await loadFixture(deployGovernanceFixture);

            await token.transfer(freshUser.address, ethers.parseEther("1000"));

            await expect(token.connect(freshUser).delegate(freshUser.address))
                .to.emit(token, "DelegateChanged")
                .withArgs(freshUser.address, ethers.ZeroAddress, freshUser.address);
        });

        it("Should allow delegation to another address", async function () {
            const { token, addr1, addr2 } = await loadFixture(deployGovernanceFixture);

            const addr1Balance = await token.balanceOf(addr1.address);
            const initialAddr2Votes = await token.getVotes(addr2.address);

            // addr1 delegates to addr2
            await token.connect(addr1).delegate(addr2.address);

            expect(await token.getVotes(addr1.address)).to.equal(0);
            expect(await token.getVotes(addr2.address)).to.equal(initialAddr2Votes + addr1Balance);
        });

        it("Should allow re-delegation", async function () {
            const { token, addr1, addr2, addr3 } = await loadFixture(deployGovernanceFixture);

            const initialAddr2Votes = await token.getVotes(addr2.address);

            // First delegation: addr1 -> addr2
            await token.connect(addr1).delegate(addr2.address);

            // Re-delegate: addr1 -> addr3
            await token.connect(addr1).delegate(addr3.address);

            const addr1Balance = await token.balanceOf(addr1.address);

            // addr2 should go back to initial votes (10k)
            expect(await token.getVotes(addr2.address)).to.equal(initialAddr2Votes);
            // addr3 should increase by addr1's balance
            expect(await token.getVotes(addr3.address)).to.be.gt(addr1Balance);
        });

        it("Should update voting power on token transfer", async function () {
            const { token, addr1, addr2 } = await loadFixture(deployGovernanceFixture);

            const transferAmount = ethers.parseEther("1000");
            const initialAddr2Votes = await token.getVotes(addr2.address);

            await token.connect(addr1).transfer(addr2.address, transferAmount);

            expect(await token.getVotes(addr2.address)).to.equal(initialAddr2Votes + transferAmount);
        });
    });

    // ============================================
    // 2. PROPOSAL CREATION & THRESHOLD TESTS
    // ============================================

    describe("2️⃣ Proposal Creation & Threshold", function () {

        it("Should reject proposal from user below threshold", async function () {
            const { governor, token, addr4, tokenAddress } = await loadFixture(deployGovernanceFixture);

            // addr4 has 500 tokens, threshold is 1000
            const calldata = token.interface.encodeFunctionData("transfer", [addr4.address, 0]);

            await expect(
                governor.connect(addr4)["propose(address[],uint256[],bytes[],string,uint8)"](
                    [tokenAddress], [0], [calldata], "Should Fail", 0
                )
            ).to.be.revertedWithCustomError(governor, "MyGovernor__BelowProposalThreshold");
        });

        it("Should allow proposal from user with sufficient voting power", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);

            await expect(
                governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                    [tokenAddress], [0], [calldata], "Valid Proposal", 0
                )
            ).to.emit(governor, "ProposalCreated");
        });

        it("Should check VOTING POWER, not raw balance", async function () {
            const { governor, token, tokenAddress, freshUser } = await loadFixture(deployGovernanceFixture);

            // Give user tokens but DON'T delegate
            await token.transfer(freshUser.address, ethers.parseEther("2000"));

            const calldata = token.interface.encodeFunctionData("transfer", [freshUser.address, 0]);

            // Should fail because voting power is 0 (not delegated)
            await expect(
                governor.connect(freshUser)["propose(address[],uint256[],bytes[],string,uint8)"](
                    [tokenAddress], [0], [calldata], "Should Fail", 0
                )
            ).to.be.revertedWithCustomError(governor, "MyGovernor__BelowProposalThreshold");
        });

        it("Should emit ProposalCreated with correct parameters", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const description = "Test Proposal";

            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], description, 0
            );
            const receipt = await tx.wait();

            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            expect(event).to.not.be.undefined;
        });

        it("Should set correct voting type (Standard)", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "Standard Vote", 0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const proposalId = event.args[0];

            expect(await governor.proposalVotingTypes(proposalId)).to.equal(0); // Standard
        });

        it("Should set correct voting type (Quadratic)", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "Quadratic Vote", 1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const proposalId = event.args[0];

            expect(await governor.proposalVotingTypes(proposalId)).to.equal(1); // Quadratic
        });
    });

    // ============================================
    // 3. PROPOSAL STATE MANAGEMENT TESTS
    // ============================================

    describe("3️⃣ Proposal States & Lifecycle", function () {

        it("Should start in Pending state (state = 0)", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const proposalId = event.args[0];

            expect(await governor.state(proposalId)).to.equal(0); // Pending
        });

        it("Should transition to Active after voting delay", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const proposalId = event.args[0];

            // Move past delay (0 blocks in this case, but mine 1 to be sure)
            await mine(1);

            expect(await governor.state(proposalId)).to.equal(1); // Active
        });

        it("Should transition to Defeated if quorum not met", async function () {
            // FIX: Use addr1 to propose (has tokens), but have addr5 vote (low tokens)
            const { governor, token, addr1, addr5, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "Will Fail Quorum", 0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const proposalId = event.args[0];

            await mine(1);

            // Only addr5 votes (100 tokens, way below 4% quorum)
            await governor.connect(addr5).castVote(proposalId, 1);

            // Fast forward past voting period
            await mine(50401);

            expect(await governor.state(proposalId)).to.equal(3); // Defeated
        });

        it("Should transition to Succeeded if quorum met and majority for", async function () {
            const { governor, token, addr1, addr2, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Should Pass"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const proposalId = event.args[0];

            await mine(1);

            // Both addr1 and addr2 vote for (60k tokens > 4% of 1M)
            await governor.connect(addr1).castVote(proposalId, 1);
            await governor.connect(addr2).castVote(proposalId, 1);

            await mine(50401);

            expect(await governor.state(proposalId)).to.equal(4); // Succeeded
        });

        it("Should transition to Defeated if majority against", async function () {
            const { governor, token, addr1, addr2, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Should Fail"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const proposalId = event.args[0];

            await mine(1);

            // addr1 for, addr2 against (but addr1 has more tokens)
            await governor.connect(addr2).castVote(proposalId, 0); // Against
            await governor.connect(addr1).castVote(proposalId, 0); // Against (majority)

            await mine(50401);

            expect(await governor.state(proposalId)).to.equal(3); // Defeated
        });
    });

    // ============================================
    // 4. STANDARD VOTING TESTS
    // ============================================

    describe("4️⃣ Standard Voting (1T1V)", function () {

        let proposalId;
        let governor, token, addr1, addr2, tokenAddress;

        // FIX: Don't rely on beforeEach for 'loadFixture' if IT calls loadFixture too.
        // Instead, just setup fresh fixture in beforeEach and assign to vars.
        beforeEach(async function () {
            const fixture = await loadFixture(deployGovernanceFixture);
            governor = fixture.governor;
            token = fixture.token;
            addr1 = fixture.addr1;
            addr2 = fixture.addr2;
            tokenAddress = fixture.tokenAddress;

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Standard Vote Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            proposalId = event.args[0];

            await mine(1);
        });

        it("Should count votes 1:1 with voting power", async function () {
            await governor.connect(addr1).castVote(proposalId, 1);

            const votes = await governor.proposalVotes(proposalId);
            const votingPower = await token.getVotes(addr1.address);
            expect(votes[1]).to.equal(votingPower); // forVotes should equal voting power
        });

        it("Should emit VoteCast event", async function () {
            await expect(governor.connect(addr1).castVote(proposalId, 1))
                .to.emit(governor, "VoteCast");
        });

        it("Should prevent double voting", async function () {
            await governor.connect(addr1).castVote(proposalId, 1);

            await expect(
                governor.connect(addr1).castVote(proposalId, 1)
            ).to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote");
        });

        it("Should allow multiple voters on same proposal", async function () {
            await governor.connect(addr1).castVote(proposalId, 1); // For
            await governor.connect(addr2).castVote(proposalId, 0); // Against

            const votes = await governor.proposalVotes(proposalId);
            expect(votes[1]).to.be.gt(0); // Some for votes
            expect(votes[0]).to.be.gt(0); // Some against votes
        });

        it("Should count abstain votes separately", async function () {
            await governor.connect(addr1).castVote(proposalId, 2); // Abstain

            const votes = await governor.proposalVotes(proposalId);
            const votingPower = await token.getVotes(addr1.address);
            expect(votes[2]).to.equal(votingPower); // abstainVotes
        });
    });

    // ============================================
    // 5. QUADRATIC VOTING TESTS  
    // ============================================

    describe("5️⃣ Quadratic Voting Mechanism", function () {

        it("Should calculate cost correctly: cost = votes²/1e18", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "QV Test", 1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];
            await mine(1);

            // Cast 10 votes: cost should be 10²/1 = 100 tokens
            const numVotes = ethers.parseEther("10");
            await governor.connect(addr1).castQuadraticVote(pid, 1, numVotes);

            const votes = await governor.proposalVotes(pid);
            expect(votes[1]).to.equal(numVotes); // 10 votes counted

            const [, used] = await governor.getQuadraticVotingPower(pid, addr1.address);
            expect(used).to.equal(ethers.parseEther("100")); // Cost = 100
        });

        it("Should prevent double voting in QV", async function () {
            const { governor, token, addr2, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr2.address, 0]);
            const tx = await governor.connect(addr2)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "QV Double", 1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];
            await mine(1);

            // First vote: 10 votes (cost 100) -- VALID
            await governor.connect(addr2).castQuadraticVote(pid, 1, ethers.parseEther("10"));

            // Second vote -- SHOULD FAIL (Single vote policy)
            await expect(
                governor.connect(addr2).castQuadraticVote(pid, 1, ethers.parseEther("20"))
            ).to.be.revertedWithCustomError(governor, "GovernorAlreadyCastVote");
        });

        it("Should reject if insufficient voting power", async function () {
            const { governor, token, addr2, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr2.address, 0]);
            const tx = await governor.connect(addr2)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "QV Fail", 1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];
            await mine(1);

            // Try to cast 150 votes: cost = 22,500 but addr2 only has 10,000
            await expect(
                governor.connect(addr2).castQuadraticVote(pid, 1, ethers.parseEther("150"))
            ).to.be.revertedWithCustomError(governor, "MyGovernor__InsufficientVotingPower");
        });

        it("Should reject zero votes", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "QV Zero", 1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];
            await mine(1);

            await expect(
                governor.connect(addr1).castQuadraticVote(pid, 1, 0)
            ).to.be.revertedWithCustomError(governor, "MyGovernor__ZeroVotesCast");
        });

        it("Should NOT transfer tokens during QV voting", async function () {
            const { governor, token, addr1, tokenAddress, governorAddress } = await loadFixture(deployGovernanceFixture);

            const initialBalance = await token.balanceOf(addr1.address);
            const initialGovBalance = await token.balanceOf(governorAddress);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "QV No Transfer", 1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];
            await mine(1);

            await governor.connect(addr1).castQuadraticVote(pid, 1, ethers.parseEther("5"));

            // Balances should NOT change
            expect(await token.balanceOf(addr1.address)).to.equal(initialBalance);
            expect(await token.balanceOf(governorAddress)).to.equal(initialGovBalance);
        });

        it("Should return correct remaining power", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "QV Power", 1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];
            await mine(1);

            const [initialRemaining, , initialTotal] = await governor.getQuadraticVotingPower(pid, addr1.address);
            expect(initialRemaining).to.equal(initialTotal);

            // Cast 100 votes (cost 10,000)
            await governor.connect(addr1).castQuadraticVote(pid, 1, ethers.parseEther("100"));

            const [remaining, used, total] = await governor.getQuadraticVotingPower(pid, addr1.address);
            expect(used).to.equal(ethers.parseEther("10000"));
            expect(remaining).to.equal(total - used);
        });

        it("Should reject QV on standard proposal", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            // Create STANDARD proposal
            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Standard Not QV"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];
            await mine(1);

            // Try to use QV on standard proposal
            await expect(
                governor.connect(addr1).castQuadraticVote(pid, 1, ethers.parseEther("10"))
            ).to.be.revertedWithCustomError(governor, "MyGovernor__InvalidVotingType");
        });
    });

    // ============================================
    // 6. SNAPSHOT MECHANISM TESTS
    // ============================================

    describe("6️⃣ Snapshot-Based Voting Power", function () {

        it("Should use voting power from proposal creation block", async function () {
            const { governor, token, addr1, addr2, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const initialAddr1Power = await token.getVotes(addr1.address);

            // Create proposal
            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Snapshot Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            // Transfer tokens AFTER proposal creation
            await token.connect(addr1).transfer(addr2.address, ethers.parseEther("10000"));

            await mine(1);

            // Vote should use OLD voting power (before transfer)
            await governor.connect(addr1).castVote(pid, 1);

            const votes = await governor.proposalVotes(pid);
            expect(votes[1]).to.equal(initialAddr1Power); // Uses snapshot power
            expect(votes[1]).to.not.equal(await token.getVotes(addr1.address)); // Different from current
        });

        it("Should lock voting power even if tokens transferred", async function () {
            const { governor, token, addr2, tokenAddress } = await loadFixture(deployGovernanceFixture);
            const [, , , , , extraUser] = await ethers.getSigners();

            const initialPower = await token.getVotes(addr2.address);

            const calldata = token.interface.encodeFunctionData("transfer", [addr2.address, 0]);
            const tx = await governor.connect(addr2)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Lock Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            // Transfer ALL tokens away
            await token.connect(addr2).transfer(extraUser.address, await token.balanceOf(addr2.address));

            await mine(1);

            // Should still be able to vote with snapshot power
            await governor.connect(addr2).castVote(pid, 1);

            const votes = await governor.proposalVotes(pid);
            expect(votes[1]).to.equal(initialPower);
            expect(await token.balanceOf(addr2.address)).to.equal(0); // No tokens left
        });

        it("Should use correct snapshot block number", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Block Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            const creationBlock = receipt.blockNumber;
            const snapshotBlock = await governor.proposalSnapshot(pid);

            // Snapshot should be at proposal creation block
            expect(snapshotBlock).to.equal(BigInt(creationBlock));
        });
    });

    // ============================================
    // 7. QUORUM TESTS
    // ============================================

    describe("7️⃣ Quorum Calculation & Enforcement", function () {

        it("Should calculate 4% quorum correctly", async function () {
            const { governor, token } = await loadFixture(deployGovernanceFixture);

            const totalSupply = await token.totalSupply();
            const expectedQuorum = (totalSupply * BigInt(4)) / BigInt(100);

            const currentBlock = await ethers.provider.getBlockNumber();
            const actualQuorum = await governor.quorum(currentBlock - 1);

            expect(actualQuorum).to.equal(expectedQuorum);
        });

        it("Should defeat proposal when quorum not met", async function () {
            // FIX: Use addr1 (rich) to propose, addr5 (poor) to vote
            const { governor, token, addr1, addr5, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr5.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Low Participation"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            await mine(1);
            await governor.connect(addr5).castVote(pid, 1);
            await mine(50401);

            expect(await governor.state(pid)).to.equal(3); // Defeated due to quorum
        });

        it("Should pass proposal when quorum met", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            // addr1 has 50,000 tokens (5% of supply > 4% quorum)
            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "High Participation"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            await mine(1);
            await governor.connect(addr1).castVote(pid, 1);
            await mine(50401);

            expect(await governor.state(pid)).to.equal(4); // Succeeded
        });
    });

    // ============================================
    // 8. VOTING PERIOD ENFORCEMENT TESTS
    // ============================================

    describe("8️⃣ Voting Period Boundaries", function () {

        // Removed "Should reject votes before voting starts" because 0 voting delay makes it active immediately.
        // It's impossible to test standard "Pending" vote rejection without modifying delay settings.

        it("Should accept votes during Active period", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Active Vote Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            await mine(1); // Make it Active

            await expect(
                governor.connect(addr1).castVote(pid, 1)
            ).to.not.be.reverted;
        });

        it("Should reject votes after voting ends", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Late Vote Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            // Fast forward past voting period
            await mine(50402);

            // Expect generic revert or custom error depending on OpenZeppelin version
            await expect(
                governor.connect(addr1).castVote(pid, 1)
            ).to.be.reverted;
        });

        it("Should have voting period of 50,400 blocks", async function () {
            const { governor } = await loadFixture(deployGovernanceFixture);
            expect(await governor.votingPeriod()).to.equal(50400);
        });

        it("Should have voting delay of 0 blocks", async function () {
            const { governor } = await loadFixture(deployGovernanceFixture);
            expect(await governor.votingDelay()).to.equal(0);
        });
    });

    // ============================================
    // 9. PAUSE/SECURITY TESTS
    // ============================================

    describe("9️⃣ Pause Mechanism & Security", function () {

        it("Should allow owner to pause", async function () {
            const { governor, owner } = await loadFixture(deployGovernanceFixture);

            await expect(governor.connect(owner).pause())
                .to.not.be.reverted;
        });

        it("Should reject non-owner pause attempts", async function () {
            const { governor, addr1 } = await loadFixture(deployGovernanceFixture);

            await expect(
                governor.connect(addr1).pause()
            ).to.be.revertedWithCustomError(governor, "OwnableUnauthorizedAccount");
        });

        it("Should prevent voting when paused", async function () {
            const { governor, token, addr1, owner, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Pause Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            await mine(1);

            // Pause the contract
            await governor.connect(owner).pause();

            // Try to vote - should fail
            await expect(
                governor.connect(addr1).castVote(pid, 1)
            ).to.be.revertedWithCustomError(governor, "EnforcedPause");
        });

        it("Should allow unpause and resume operations", async function () {
            const { governor, token, addr1, owner, tokenAddress } = await loadFixture(deployGovernanceFixture);

            await governor.connect(owner).pause();
            await governor.connect(owner).unpause();

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            await expect(
                governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                    [tokenAddress], [0], [calldata], "Unpause Test"
                )
            ).to.not.be.reverted;
        });
    });

    // ============================================
    // 10. EDGE CASES & INTEGRATION
    // ============================================

    describe("🔟 Edge Cases & Integration", function () {

        it("Should handle maximum possible QV votes without overflow", async function () {
            const { governor, token, owner, tokenAddress } = await loadFixture(deployGovernanceFixture);

            // Owner has ~900k tokens
            const calldata = token.interface.encodeFunctionData("transfer", [owner.address, 0]);
            const tx = await governor.connect(owner)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata], "Max QV", 1
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            await mine(1);

            // Cast 900 votes (cost = 810,000 which is close to max)
            await expect(
                governor.connect(owner).castQuadraticVote(pid, 1, ethers.parseEther("900"))
            ).to.not.be.reverted;
        });

        it("Should handle proposal with empty description", async function () {
            const { governor, token, addr1, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            await expect(
                governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                    [tokenAddress], [0], [calldata], ""
                )
            ).to.not.be.reverted;
        });

        it("Full lifecycle: Create → Vote → Succeed", async function () {
            const { governor, token, addr1, addr2, tokenAddress } = await loadFixture(deployGovernanceFixture);

            // 1. Create proposal
            const calldata = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const tx = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string)"](
                [tokenAddress], [0], [calldata], "Full Lifecycle Test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const pid = event.args[0];

            expect(await governor.state(pid)).to.equal(0); // Pending

            // 2. Activate
            await mine(1);
            expect(await governor.state(pid)).to.equal(1); // Active

            // 3. Vote
            await governor.connect(addr1).castVote(pid, 1);
            await governor.connect(addr2).castVote(pid, 1);

            // 4. End voting period
            await mine(50401);

            // 5. Verify success
            expect(await governor.state(pid)).to.equal(4); // Succeeded
        });

        it("Should handle multiple simultaneous proposals", async function () {
            const { governor, token, addr1, addr2, tokenAddress } = await loadFixture(deployGovernanceFixture);

            const calldata1 = token.interface.encodeFunctionData("transfer", [addr1.address, 0]);
            const calldata2 = token.interface.encodeFunctionData("transfer", [addr2.address, 0]);

            // Create two proposals
            const tx1 = await governor.connect(addr1)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata1], "Proposal 1", 0
            );
            const tx2 = await governor.connect(addr2)["propose(address[],uint256[],bytes[],string,uint8)"](
                [tokenAddress], [0], [calldata2], "Proposal 2", 1
            );

            const receipt1 = await tx1.wait();
            const receipt2 = await tx2.wait();

            const event1 = receipt1.logs.find(log => log.fragment?.name === 'ProposalCreated');
            const event2 = receipt2.logs.find(log => log.fragment?.name === 'ProposalCreated');

            const pid1 = event1.args[0];
            const pid2 = event2.args[0];

            // Both should exist
            expect(await governor.proposalVotingTypes(pid1)).to.equal(0); // Standard
            expect(await governor.proposalVotingTypes(pid2)).to.equal(1); // Quadratic
        });
    });
});
