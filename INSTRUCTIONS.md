# 🚀 Run Instructions

Here are the exact commands to run and interact with the Decentralized On-Chain Governance Platform.

## 1️⃣ Terminal Setup

Open your terminal and run the following commands strictly in order:

```bash
# 1. Navigate to the project directory
cd "/Users/rushikesh/Decentralized On-Chain Governance and Voting Platform"

# 2. Ensure a clean slate (stops any running containers)
docker-compose down -v

# 3. Start the application (Contracts + Frontend)
#    This will:
#    - Start a local Hardhat node
#    - Deploy contracts and scripts
#    - Start the Next.js frontend
docker-compose up --build
```

**Wait** until you see logs indicating `Next.js` is ready and `GovernanceToken deployed to: ...`.

---

## 2️⃣ Wallet Setup (MetaMask)

1.  Open **MetaMask** in your browser.
2.  **Network Configuration**:
    -   Add/Switch to **Network**: `Localhost 8545`
    -   **RPC URL**: `http://localhost:8545`
    -   **Chain ID**: `31337`
    -   **Currency Symbol**: `ETH`
3.  **Import Account**:
    -   Click **Account Icon** -> **Import Account** -> **Private Key**.
    -   Enter: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
    -   *(This is the Hardhat Account #0, owners of the deployed contracts)*.

---

## 3️⃣ Frontend Interaction

1.  **Open Browser**: Go to [http://localhost:3000](http://localhost:3000).
2.  **Connect Wallet**:
    -   Click the **"Connect Wallet"** button in the top right.
    -   Approve the connection in MetaMask.
3.  **Delegate Votes**:
    -   **Crucial Step**: You must delegate voting power to yourself to vote.
    -   Click the **"Delegate to Self"** button on the left panel.
    -   Confirm the transaction.
    -   *Verify*: Voting Power should update to `1000000.00 GT`.

---

## 4️⃣ Governance Workflow

### Create Proposal
1.  Enter a description: *"Proposal #1: Community Grant"*
2.  Select **Voting Mechanism**:
    -   **Standard**: 1 Token = 1 Vote.
    -   **Quadratic**: Cost = (Votes)².
3.  Click **"Submit Proposal"**.
4.  Confirm transaction.

### Vote
1.  The new proposal will appear in the "Active Proposals" list.
2.  **Standard Proposal**:
    -   Click "Vote For", "Vote Against", or "Abstain".
3.  **Quadratic Proposal**:
    -   Click a vote option.
    -   Enter **Vote Weight** (e.g., `10` votes).
    -   **Approve Spend**: Confirm the token approval transaction (Cost = 10² = 100 GT).
    -   **Cast Vote**: Confirm the vote transaction.

---

## 5️⃣ Verification
-   **Check Logs**: The terminal running Docker will show `VoteCast` events.
-   **Check UI**: The progress bars will update with the new vote counts.
