# Decentralized On-Chain Governance Platform

A full-stack DApp for decentralized governance, supporting both **Standard (1T1V)** and **Quadratic Voting** mechanisms. Built with Hardhat, Next.js, and Docker.

## Features
- **ERC-20 Governance Token**: With delegation and snapshot support (OpenZeppelin).
- **Dual Voting Mechanisms**:
    - **Standard**: 1 Token = 1 Vote.
    - **Quadratic**: Cost = Votes², allowing minority voices to have impact.
- **Proposal Lifecycle**: Create, view, and vote on proposals.
- **Real-time Updates**: Connect MetaMask and interact directly with the local blockchain.
- **Dockerized**: One-command setup.

## Prerequisites
- Docker & Docker Compose
- MetaMask (Browser Extension)

## Quick Start

1. **Clone & Setup Environment**
   ```bash
   git clone <repo>
   cd "Decentralized On-Chain Governance and Voting Platform"
   cp .env.example .env
   ```

2. **Run Application**
   ```bash
   docker-compose up --build
   ```
   - **Frontend**: [http://localhost:3000](http://localhost:3000)
   - **Hardhat Node**: [http://localhost:8545](http://localhost:8545)

3. **Connect Wallet**
   - Import the Hardhat test account into MetaMask:
     - **Private Key**: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
   - Switch permissions to network `Localhost 8545`.
     - RPG URL: `http://localhost:8545`
     - Chain ID: `31337`

4. **Interact**
   - **Delegate**: Click "Delegate to Self" to activate your voting power.
   - **Propose**: Create a new proposal (Standard or Quadratic).
   - **Vote**: Cast your vote on active proposals.

## Architecture
- **/contracts**: Solidity Smart Contracts.
  - `GovernanceToken.sol`: ERC20Votes token.
  - `MyGovernor.sol`: Logic for proposal management and voting.
- **/frontend**: Next.js App Router application.
- **/scripts**: Deployment scripts.
- **/test**: Hardhat tests.

## Development
- **Run Tests**: `npx hardhat test`
- **Deploy Locally**: `npx hardhat run scripts/deploy.js --network localhost`

## License
MIT
