# Decentralized On-Chain Governance Platform

A robust, localized Decentralized Autonomous Organization (DAO) platform enabling secure proposal creation, delegation, and voting via **ERC-20 Governance Tokens**. Built with **Next.js**, **Hardhat**, and **OpenZeppelin**, featuring both **Standard (1T1V)** and **Quadratic Voting** mechanisms.

![Dashboard Preview](./voting-interface.png)
*The main dashboard displaying active proposals, user voting power, and wallet connection status. Users can easily toggle between Standard and Quadratic voting modes during proposal creation.*

## 🚀 Key Features

*   **🗳️ Dual Voting Mechanisms**:
    *   **Standard Voting**: Traditional 1 Token = 1 Vote system.
    *   **Quadratic Voting**: Equitable voting where Cost = (Votes)², protecting against whale dominance.
*   **📜 Full Proposal Lifecycle**: Create, queue, execute, and track proposals through standard OpenZeppelin Governor states (Pending, Active, Defeated, Succeeded, Queued, Executed).
*   **🔐 Secure Delegation**: Token holders can delegate voting power to themselves or others, a prerequisite for participation.
*   **⚖️ Automatic Quorum & Thresholds**: Enforces minimum token thresholds for submitting proposals and percentage-based quorums for passing them.
*   **🐳 Dockerized Environment**: One-click setup for the entire stack (Blockchain Node + Frontend).
*   **⚡ Real-Time Updates**: Auto-refreshing UI with optimistic updates and block synchronization.

## 🛠️ Technology Stack

*   **Blockchain**: Hardhat (Local Node), Solidity 0.8.20
*   **Smart Contracts**: OpenZeppelin Governor, ERC20Votes, TimelockController
*   **Frontend**: Next.js 14, React, Tailwind CSS, Ethers.js v6
*   **Infrastructure**: Docker, Docker Compose

## 📋 Prerequisites

Ensure you have the following installed:

*   **Docker Desktop**: [Download Here](https://www.docker.com/products/docker-desktop/)
*   **Node.js (v18+)**: Protected by Docker, but useful for local scripts.
*   **MetaMask**: Browser extension for wallet interaction.

## 🚀 Quick Start (Recommended)

The entire application is containerized. You can spin it up with a single command.

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/your-username/decentralized-governance.git
    cd decentralized-governance
    ```

2.  **Start the Application**
    ```bash
    docker-compose up --build
    ```

    *   **Hardhat Node**: Runs on `http://localhost:8545` (Chain ID: 31337)
    *   **Frontend**: Accessible at `http://localhost:3000`

    *Note: The setup automatically deploys contracts and generates 1,000,000 tokens for the deployer account.*

## 🦊 Wallet Setup (MetaMask)

To interact with the local blockchain, configure MetaMask:

1.  **Open MetaMask** -> **Settings** -> **Networks** -> **Add Network** -> **Add a network manually**.
2.  **Network Name**: `Hardhat Local`
3.  **RPC URL**: `http://127.0.0.1:8545`
4.  **Chain ID**: `31337`
5.  **Currency Symbol**: `GO`
6.  **Save**.

**Import Test Account:**
Use the default Hardhat private key to get instant access to tokens:
*   **Private Key**: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
*   **Balance**: 10,000 ETH (Testnet)

## 🧪 Running Tests

To run the comprehensive test suite verifying the governance logic:

```bash
# Run tests inside the container
docker-compose exec hardhat-node npx hardhat test

# OR run locally (requires dependencies)
npm install
npx hardhat test
```

## 📖 Usage Guide

### 1. Delegate Votes
Upon connecting your wallet, click **"Delegate to Self"**. This is required to "activate" your raw token balance into voting power.

### 2. Create a Proposal
*   Click **"Create Proposal"**.
*   Enter a description (e.g., "Should we increase the grant pool?").
*   Select **Standard** or **Quadratic** voting.
*   Submit the transaction.

### 3. Vote
*   **Important**: On a local blockchain, blocks only advance when transactions occur.
*   After creating a proposal, it may be in a **Pending** state.
*   Create another transaction (or use a script) to mine a block and make the proposal **Active**.
*   Vote **For**, **Against**, or **Abstain**.

![Transaction Request](./transaction-request.png)
*Metamask transaction confirmation for a proposal. The interface clearly shows the function being called and the status of the interaction.*

## 📂 Project Structure

```
├── contracts/          # Solidity Smart Contracts
│   ├── GovernanceToken.sol
│   └── MyGovernor.sol
├── frontend/           # Next.js Application
│   ├── app/            # React Pages & Components
│   └── public/         # Static Assets
├── scripts/            # Deployment & Verification Scripts
├── test/               # Hardhat Test Suite
├── docker-compose.yml  # Orchestration
└── hardhat.config.js   # Blockchain Configuration
```

## 📄 License
This project is licensed under the MIT License.
