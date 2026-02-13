const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Deploy Governance Token
    const GovernanceToken = await hre.ethers.getContractFactory("GovernanceToken");
    const token = await GovernanceToken.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("GovernanceToken deployed to:", tokenAddress);

    // Deploy Governor
    const MyGovernor = await hre.ethers.getContractFactory("MyGovernor");
    const governor = await MyGovernor.deploy(tokenAddress);
    await governor.waitForDeployment();
    const governorAddress = await governor.getAddress();
    console.log("MyGovernor deployed to:", governorAddress);

    // Delegate votes to deployer to enable proposal creation immediately
    await token.delegate(deployer.address);
    console.log("Delegated votes to deployer");

    // Output for frontend
    const addresses = {
        token: tokenAddress,
        governor: governorAddress
    };
    console.log("Writing addresses:", addresses);

    // Determine path. If mapping works, defaults to ../frontend/src/artifacts relative to scripts/
    // In Docker, we mount ./frontend/src/artifacts to /app/frontend/src/artifacts
    // The script runs in /app/scripts or /app depending on CWD.
    // Hardhat runs from /app.
    // So relative path from project root is frontend/src/artifacts.
    const artifactsDir = path.join(hre.config.paths.root, "frontend/src/artifacts");

    if (!fs.existsSync(artifactsDir)) {
        console.log("Creating artifacts directory:", artifactsDir);
        fs.mkdirSync(artifactsDir, { recursive: true });
    }

    fs.writeFileSync(
        path.join(artifactsDir, "addresses.json"),
        JSON.stringify(addresses, null, 2)
    );
    console.log("Addresses written to addresses.json");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
