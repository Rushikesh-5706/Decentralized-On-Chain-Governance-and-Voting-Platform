"use client";

import { useState, useEffect } from "react";
import { ethers, BrowserProvider, Contract } from "ethers";
import { Copy, Vote, ExternalLink, Loader2, Plus, Wallet, AlertCircle } from "lucide-react";
import clsx from "clsx";

const addresses = require("../src/artifacts/addresses.json");
const GovernanceTokenABI = require("../src/artifacts/contracts/GovernanceToken.sol/GovernanceToken.json");
const MyGovernorABI = require("../src/artifacts/contracts/MyGovernor.sol/MyGovernor.json");

// Types
type Proposal = {
  id: string;
  proposer: string;
  targets: string[];
  values: string[];
  signatures: string[];
  calldatas: string[];
  startBlock: bigint;
  endBlock: bigint;
  description: string;
  state: number;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  votingType: number;
};

const ProposalState = ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"];

export default function Home() {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [governor, setGovernor] = useState<Contract | null>(null);
  const [token, setToken] = useState<Contract | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [votingPower, setVotingPower] = useState("0");
  const [balance, setBalance] = useState("0");
  const [blockNumber, setBlockNumber] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  // Form states
  const [desc, setDesc] = useState("");
  const [votingType, setVotingType] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.ethereum) {
      const p = new ethers.BrowserProvider(window.ethereum);
      setProvider(p);

      // Listener for network changes
      window.ethereum.on("chainChanged", (chainId: string) => {
        console.log("Network changed to:", chainId);
        window.location.reload();
      });

      // Listener for account changes
      window.ethereum.on("accountsChanged", (accounts: string[]) => {
        console.log("Account changed:", accounts[0]);
        setAccount(accounts[0] || null);
        window.location.reload();
      });
    } else {
      setError("MetaMask not detected. Please install MetaMask to use this app.");
    }

    return () => {
      // Cleanup listeners if component unmounts (optional but good practice)
      if (typeof window !== "undefined" && window.ethereum && window.ethereum.removeListener) {
        window.ethereum.removeAllListeners("chainChanged");
        window.ethereum.removeAllListeners("accountsChanged");
      }
    };
  }, []);

  const connectWallet = async () => {
    if (!provider) {
      setError("MetaMask not available");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Request accounts
      const accounts = await provider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);

      // Check network
      const network = await provider.getNetwork();
      const currentChainId = Number(network.chainId);
      setChainId(currentChainId);

      // Check if on correct network (Hardhat = 31337)
      if (currentChainId !== 31337) {
        setError(`Wrong network! Please connect to Hardhat network (Chain ID: 31337). Current: ${currentChainId}`);
        setLoading(false);
        return;
      }

      // Check if contracts are deployed
      if (!addresses.token || !addresses.governor) {
        setError("Contracts not deployed. Please wait for hardhat node to deploy contracts.");
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();
      const govContract = new ethers.Contract(addresses.governor, MyGovernorABI.abi, signer);
      const tokenContract = new ethers.Contract(addresses.token, GovernanceTokenABI.abi, signer);

      // Verify contracts are actually deployed
      try {
        await govContract.name();
        await tokenContract.name();
      } catch (e) {
        setError("Contracts not properly deployed at the specified addresses.");
        setLoading(false);
        return;
      }

      setGovernor(govContract);
      setToken(tokenContract);

      await refreshData(govContract, tokenContract, accounts[0]);
    } catch (err: any) {
      console.error("Connection error:", err);
      setError(err.message || "Failed to connect wallet");
    } finally {
      setLoading(false);
    }
  };

  const refreshData = async (gov: Contract, tok: Contract, user: string) => {
    try {
      const bn = await provider!.getBlockNumber();
      setBlockNumber(bn);

      // Get voting power (must delegate first)
      const power = await tok.getVotes(user);
      setVotingPower(ethers.formatEther(power));

      // Get balance
      const bal = await tok.balanceOf(user);
      setBalance(ethers.formatEther(bal));

      // Fetch proposals
      const filter = gov.filters.ProposalCreated();
      const events = await gov.queryFilter(filter, 0, "latest");

      const fetchedProposals: Proposal[] = [];
      for (const event of events.reverse()) {
        if ('args' in event) {
          const args = event.args;
          const id = args[0];
          const state = await gov.state(id);
          const votes = await gov.proposalVotes(id);
          const vType = await gov.proposalVotingTypes(id);

          fetchedProposals.push({
            id: id.toString(),
            proposer: args[1],
            targets: args[2],
            values: args[3],
            signatures: args[4],
            calldatas: args[5],
            startBlock: args[6],
            endBlock: args[7],
            description: args[8],
            state: Number(state),
            forVotes: votes[1],
            againstVotes: votes[0],
            abstainVotes: votes[2],
            votingType: Number(vType)
          });
        }
      }
      setProposals(fetchedProposals);
    } catch (e: any) {
      console.error("Refresh error:", e);
      setError("Failed to fetch data: " + e.message);
    }
  };

  const createProposal = async () => {
    if (!governor || !token || !account) return;

    try {
      setLoading(true);
      setError(null);

      const [threshold, userBalance] = await Promise.all([
        governor.proposalThreshold(),
        token.balanceOf(account)
      ]);

      if (userBalance < threshold) {
        setError(`Insufficient voting power. Required: ${ethers.formatEther(threshold)} GT`);
        setLoading(false);
        return;
      }

      const calldata = token.interface.encodeFunctionData("transfer", [account, 0]);

      const tx = (votingType === 1)
        ? await governor["propose(address[],uint256[],bytes[],string,uint8)"]([addresses.token], [0], [calldata], desc, 1)
        : await governor["propose(address[],uint256[],bytes[],string)"]([addresses.token], [0], [calldata], desc);

      await tx.wait();
      await refreshData(governor, token, account);
      setDesc("");
      alert("Proposal submitted to the governance protocol.");
    } catch (e: any) {
      console.error("Proposal error:", e);
      setError(e.reason || e.message);
    } finally {
      setLoading(false);
    }
  };

  const castVote = async (proposalId: string, support: number, isQV: boolean) => {
    if (!governor || !token || !account) return;

    try {
      setLoading(true);
      setError(null);

      let tx;
      if (isQV) {
        const input = prompt("Enter number of votes to cast (Quadratic Cost = Votes²):");
        if (!input) return;

        const numVotes = parseFloat(input);
        if (isNaN(numVotes) || numVotes <= 0) {
          setError("Invalid vote quantity");
          return;
        }

        const cost = numVotes * numVotes;
        const available = parseFloat(votingPower);

        if (cost > available) {
          setError(`Insufficient voting power budget. Cost: ${cost} | Available: ${available}`);
          return;
        }

        tx = await governor.castQuadraticVote(proposalId, support, ethers.parseEther(numVotes.toString()));
      } else {
        tx = await governor.castVote(proposalId, support);
      }

      await tx.wait();
      alert("Vote successfully recorded on-chain.");
      await refreshData(governor, token, account);
    } catch (e: any) {
      console.error("Vote error:", e);
      // Attempt to parse custom errors from the contract
      const errorMsg = e.reason || e.data?.message || e.message;
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const delegate = async () => {
    if (!token || !account) return;

    try {
      setLoading(true);
      setError(null);

      const tx = await token.delegate(account);
      await tx.wait();

      await refreshData(governor!, token, account);
      alert("Voting power activated! You can now vote and create proposals.");
    } catch (e: any) {
      console.error("Delegate error:", e);
      setError("Failed to delegate: " + (e.reason || e.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans p-8">
      <header className="flex justify-between items-center mb-12 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            On-Chain Governance
          </h1>
          <p className="text-slate-400 text-sm mt-1">Decentralized Voting Platform</p>
        </div>

        <div className="flex items-center gap-4">
          {account && chainId && (
            <div className="text-right">
              <p data-testid="user-address" className="text-sm font-mono text-slate-300">
                {account.substring(0, 6)}...{account.substring(38)}
              </p>
              <p className="text-xs text-slate-500">
                Balance: {parseFloat(balance).toFixed(2)} GT |
                Power: {parseFloat(votingPower).toFixed(2)} GT
              </p>
              <p className="text-xs text-slate-600">Chain ID: {chainId}</p>
            </div>
          )}
          <button
            data-testid="connect-wallet-button"
            onClick={connectWallet}
            disabled={!!account || loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Wallet size={18} />
            {account ? "Connected" : "Connect Wallet"}
          </button>
        </div>
      </header>

      {/* Error Display */}
      {error && (
        <div className="mb-6 bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="text-red-400 flex-shrink-0 mt-0.5" size={20} />
          <div className="flex-1">
            <p className="text-red-400 text-sm whitespace-pre-wrap">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-300 text-xs mt-2 underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Create Proposal & Actions */}
        <div className="lg:col-span-1 space-y-8">
          <section className="bg-slate-900 rounded-xl p-6 border border-slate-800 shadow-xl">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Plus className="text-blue-400" /> Create Proposal
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Description</label>
                <textarea
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  rows={3}
                  value={desc}
                  onChange={e => setDesc(e.target.value)}
                  placeholder="What should we vote on?"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Voting Mechanism</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setVotingType(0)}
                    className={clsx(
                      "flex-1 py-2 rounded-lg text-sm border transition-all",
                      votingType === 0
                        ? "bg-blue-600/20 border-blue-500 text-blue-400"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750"
                    )}
                  >
                    Standard (1T1V)
                  </button>
                  <button
                    onClick={() => setVotingType(1)}
                    className={clsx(
                      "flex-1 py-2 rounded-lg text-sm border transition-all",
                      votingType === 1
                        ? "bg-purple-600/20 border-purple-500 text-purple-400"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750"
                    )}
                  >
                    Quadratic
                  </button>
                </div>
              </div>

              <button
                onClick={createProposal}
                disabled={!account || loading || !desc}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 rounded-lg shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="animate-spin mx-auto" /> : "Submit Proposal"}
              </button>

              {!account && (
                <p className="text-center text-xs text-red-400">Connect wallet to propose</p>
              )}
              {account && parseFloat(votingPower) === 0 && (
                <p className="text-center text-xs text-yellow-400">
                  Delegate to self first to activate voting power
                </p>
              )}
            </div>
          </section>

          <section className="bg-slate-900 rounded-xl p-6 border border-slate-800">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            <button
              onClick={delegate}
              disabled={!account || loading || parseFloat(votingPower) > 0}
              className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {parseFloat(votingPower) > 0 ? "Already Delegated" : "Delegate to Self"}
            </button>
            <p className="text-xs text-slate-500 mt-2 text-center">
              Required to activate voting power and create proposals
            </p>
          </section>
        </div>

        {/* Right Column: Proposals List */}
        <div className="lg:col-span-2">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <Vote className="text-purple-400" />
            {proposals.length > 0 ? `Proposals (${proposals.length})` : "Active Proposals"}
          </h2>

          <div className="space-y-4">
            {proposals.length === 0 ? (
              <div className="text-center py-12 text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed">
                <p className="mb-2">No proposals found</p>
                <p className="text-xs">Create the first proposal to get started!</p>
              </div>
            ) : (
              proposals.map(p => (
                <div
                  key={p.id}
                  data-testid="proposal-list-item"
                  className="bg-slate-900 rounded-xl p-6 border border-slate-800 hover:border-slate-700 transition-colors shadow-lg"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span
                          className={clsx(
                            "px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider",
                            p.state === 1
                              ? "bg-green-500/20 text-green-400"
                              : p.state === 3
                                ? "bg-red-500/20 text-red-400"
                                : p.state === 4
                                  ? "bg-blue-500/20 text-blue-400"
                                  : "bg-slate-700 text-slate-400"
                          )}
                        >
                          {ProposalState[p.state]}
                        </span>
                        <span className="text-xs text-slate-500 border border-slate-700 px-2 py-0.5 rounded">
                          {p.votingType === 1 ? "Quadratic" : "Standard"}
                        </span>
                        <span className="text-xs text-slate-500">ID: {p.id}</span>
                      </div>
                      <h3 className="text-lg font-medium text-slate-200">{p.description}</h3>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Ends: Block {p.endBlock.toString()}</div>
                      <div className="text-xs text-slate-500">Current: {blockNumber}</div>
                    </div>
                  </div>

                  {/* Votes Visualization */}
                  <div className="mb-6 bg-slate-950 rounded-lg p-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-green-400">For: {ethers.formatEther(p.forVotes)}</span>
                      <span className="text-red-400">Against: {ethers.formatEther(p.againstVotes)}</span>
                      <span className="text-slate-400">Abstain: {ethers.formatEther(p.abstainVotes)}</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden flex">
                      <div
                        style={{
                          width: `${Number(p.forVotes) /
                            (Number(p.forVotes + p.againstVotes + p.abstainVotes) || 1) *
                            100
                            }%`
                        }}
                        className="bg-green-500"
                      />
                      <div
                        style={{
                          width: `${Number(p.againstVotes) /
                            (Number(p.forVotes + p.againstVotes + p.abstainVotes) || 1) *
                            100
                            }%`
                        }}
                        className="bg-red-500"
                      />
                      <div
                        style={{
                          width: `${Number(p.abstainVotes) /
                            (Number(p.forVotes + p.againstVotes + p.abstainVotes) || 1) *
                            100
                            }%`
                        }}
                        className="bg-slate-500"
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  {p.state === 1 && account && (
                    <div className="flex gap-2 border-t border-slate-800 pt-4">
                      <button
                        data-testid="vote-for-button"
                        onClick={() => castVote(p.id, 1, p.votingType === 1)}
                        disabled={loading}
                        className="flex-1 bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-800/50 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        Vote For
                      </button>
                      <button
                        data-testid="vote-against-button"
                        onClick={() => castVote(p.id, 0, p.votingType === 1)}
                        disabled={loading}
                        className="flex-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        Vote Against
                      </button>
                      <button
                        data-testid="vote-abstain-button"
                        onClick={() => castVote(p.id, 2, p.votingType === 1)}
                        disabled={loading}
                        className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        Abstain
                      </button>
                    </div>
                  )}
                  {p.state === 1 && !account && (
                    <p className="text-center text-sm text-slate-500 border-t border-slate-800 pt-4">
                      Connect wallet to vote
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {/* Network Warning with Auto-Switch */}
      {chainId && chainId !== 31337 && (
        <div className="fixed bottom-4 right-4 bg-red-900/90 border border-red-700 rounded-lg p-4 max-w-sm shadow-2xl z-50">
          <p className="text-white font-bold mb-1 flex items-center gap-2">
            <AlertCircle size={16} /> Wrong Network
          </p>
          <p className="text-red-200 text-xs mb-3">
            Expected: Hardhat (31337)<br />
            Detected: {chainId}
          </p>
          <button
            onClick={async () => {
              try {
                await window.ethereum.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: '0x7A69' }], // 31337 in hex
                });
              } catch (switchError: any) {
                // This error code 4902 means the chain has not been added to MetaMask.
                if (switchError.code === 4902) {
                  try {
                    await window.ethereum.request({
                      method: 'wallet_addEthereumChain',
                      params: [
                        {
                          chainId: '0x7A69',
                          chainName: 'Hardhat Local',
                          rpcUrls: ['http://localhost:8545'], // Try localhost first
                          nativeCurrency: {
                            name: 'GO Token',
                            symbol: 'GO', // Symbol match user pref
                            decimals: 18,
                          },
                        },
                      ],
                    });
                  } catch (addError) {
                    console.error("Failed to add network:", addError);
                    alert("Failed to add network automatically. Please add http://localhost:8545 manually.");
                  }
                } else {
                  console.error("Network switch failed:", switchError);
                }
              }
            }}
            className="w-full bg-white text-red-900 font-bold text-sm py-2 rounded hover:bg-red-50 transition-colors"
          >
            Fix Network Now
          </button>
        </div>
      )}
    </div>
  );
}
