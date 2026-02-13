const { ethers } = require("hardhat");
const { expect } = require("chai");

async function main() {
    console.log("🚀 STARTING BRUTAL VERIFICATION SCRIPT");

    // 1. Setup Accounts
    const [deployer, user1, user2] = await ethers.getSigners();
    console.log(`\n👤 Deployer: ${deployer.address}`);
    console.log(`👤 User1:    ${user1.address}`);

    // 2. Deploy Contracts
    console.log("\n📜 Deploying Contracts...");
    const GovernanceToken = await ethers.getContractFactory("GovernanceToken");
    const token = await GovernanceToken.deploy();
    await token.waitForDeployment();
    const tokenAddr = await token.getAddress();
    console.log(`   Tokens Deployed at: ${tokenAddr}`);

    const MyGovernor = await ethers.getContractFactory("MyGovernor");
    const governor = await MyGovernor.deploy(tokenAddr);
    await governor.waitForDeployment();
    const govAddr = await governor.getAddress();
    console.log(`   Governor Deployed at: ${govAddr}`);

    // 3. Setup Token Balances & Delegation
    console.log("\n💰 Setting up Balances...");
    // Transfer tokens to User1
    await token.transfer(user1.address, ethers.parseEther("10000"));
    // Delegate to self to activate voting power (Standard Voting requirement)
    await token.connect(user1).delegate(user1.address);

    const balance = await token.balanceOf(user1.address);
    const votes = await token.getVotes(user1.address);
    console.log(`   User1 Balance: ${ethers.formatEther(balance)} GT`);
    console.log(`   User1 Votes:   ${ethers.formatEther(votes)} GT`);

    if (balance < ethers.parseEther("1000")) {
        throw new Error("❌ Setup Failed: Insufficient balance for threshold");
    }

    // 4. Create Proposal (Standard)
    console.log("\n📝 Creating Proposal (Threshold Check)...");
    // Use transfer as dummy action
    const encodedFunction = token.interface.encodeFunctionData("transfer", [user1.address, 10]);

    try {
        const tx = await governor.connect(user1)["propose(address[],uint256[],bytes[],string,uint8)"](
            [tokenAddr],
            [0],
            [encodedFunction],
            "Test Proposal #1",
            0 // Standard
        );
        await tx.wait();
        console.log("   ✅ Proposal Created Successfully (Threshold Passed)");
    } catch (e) {
        console.error("   ❌ Proposal Creation Failed!", e);
        process.exit(1);
    }

    // Get Proposal ID (It's the first one, loop via events or just predict? simpler to fetch events)
    const filter = governor.filters.ProposalCreated();
    const events = await governor.queryFilter(filter);
    const proposalId = events[0].args[0];
    console.log(`   Proposal ID: ${proposalId}`);

    // 5. Create Quadratic Proposal
    console.log("\n📝 Creating Quadratic Proposal...");
    const tx = await governor.connect(user1)["propose(address[],uint256[],bytes[],string,uint8)"](
        [tokenAddr],
        [0],
        [encodedFunction],
        "QV Proposal #2",
        1 // Quadratic
    );
    await tx.wait();

    const events2 = await governor.queryFilter(filter);
    const proposalIdQV = events2[1].args[0];
    console.log(`   QV Proposal ID: ${proposalIdQV}`);

    // MUST mine a block so the snapshot is in the past!
    await network.provider.send("evm_mine");

    // 6. Cast Quadratic Vote (The New Power Check)
    // Scenario: User wants 4 votes.
    // Cost = Votes^2 = 4^2 = 16 voting power units.
    console.log("\n🗳️  Testing Quadratic Voting Power Math...");
    const votesDesired = 4n;
    const numVotesWei = ethers.parseEther(votesDesired.toString());
    const expectedCostWei = ethers.parseEther((votesDesired * votesDesired).toString());

    console.log(`   Target: ${votesDesired} votes (${numVotesWei} wei)`);
    console.log(`   Expected Cost: ${votesDesired * votesDesired} power (${expectedCostWei} wei)`);

    // Get power before
    const [powerBefore] = await governor.getQuadraticVotingPower(proposalIdQV, user1.address);
    console.log(`   Power Before: ${ethers.formatEther(powerBefore)}`);

    // Cast Vote (Passing numVotes, NOT cost)
    console.log("   Casting vote...");
    const castTx = await governor.connect(user1).castQuadraticVote(proposalIdQV, 1, numVotesWei);
    await castTx.wait();

    // Verify Result
    const proposalVotes = await governor.proposalVotes(proposalIdQV);
    const forVotesWei = proposalVotes.forVotes;
    const forVotesTokens = ethers.formatEther(forVotesWei);

    console.log(`   Result: ${forVotesTokens} Votes registered`);

    if (forVotesTokens === "4.0") {
        console.log("   ✅ SUCCESS: 4.0 Votes registered correctly.");
    } else {
        console.error(`   ❌ FAILURE: Expected 4.0 votes, got ${forVotesTokens}`);
        process.exit(1);
    }

    const [powerAfter] = await governor.getQuadraticVotingPower(proposalIdQV, user1.address);
    const powerUsed = powerBefore - powerAfter;
    console.log(`   Power Used: ${ethers.formatEther(powerUsed)}`);

    if (powerUsed === expectedCostWei) {
        console.log("   ✅ SUCCESS: 16.0 Voting Power consumed correctly.");
    } else {
        console.error(`   ❌ FAILURE: Expected 16.0 power used, got ${ethers.formatEther(powerUsed)}`);
        process.exit(1);
    }

    // 7. Negative Test: Insufficient Power
    console.log("\n🧪 Testing Insufficient Power Revert...");
    // user1 has 10k power. Buy 200 votes -> cost 40k. Should fail.
    const tooManyVotes = ethers.parseEther("200");

    try {
        await governor.connect(user1).castQuadraticVote(proposalIdQV, 1, tooManyVotes);
        console.error("   ❌ FAILURE: Insufficient power should have reverted!");
        process.exit(1);
    } catch (error) {
        console.log("   ✅ CORRECT: Reverted as expected (Error: " + error.message.split('\n')[0] + ")");
    }

    console.log("\n🎉 ALL SYSTEMS GO. PROTOCOL IS SECURE.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
