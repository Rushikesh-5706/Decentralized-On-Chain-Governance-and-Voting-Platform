"use client";

import { useState, useEffect } from "react";
import { ethers, BrowserProvider, Contract } from "ethers";
import { Copy, Vote, ExternalLink, Loader2, Plus, Wallet } from "lucide-react";
import clsx from "clsx";
import addresses from "../src/artifacts/addresses.json";
import GovernanceTokenABI from "../src/artifacts/contracts/GovernanceToken.json";
import MyGovernorABI from "../src/artifacts/contracts/MyGovernor.json";

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
  state: number; // 0:Pending, 1:Active, 2:Canceled, 3:Defeated, 4:Succeeded, 5:Queued, 6:Expired, 7:Executed
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  votingType: number; // 0: Standard, 1: Quadratic (Custom logic needed to fetch)
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
  const [blockNumber, setBlockNumber] = useState(0);

  // Form states
  const [desc, setDesc] = useState("");
  const [votingType, setVotingType] = useState(0); // 0 Standard, 1 Quadratic

  useEffect(() => {
    if (window.ethereum) {
      const p = new ethers.BrowserProvider(window.ethereum);
      setProvider(p);
    }
  }, []);

  const connectWallet = async () => {
    if (!provider) return;
    try {
      const accounts = await provider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);

      const signer = await provider.getSigner();
      const govContract = new ethers.Contract(addresses.governor, MyGovernorABI.abi, signer);
      const tokenContract = new ethers.Contract(addresses.token, GovernanceTokenABI.abi, signer);

      setGovernor(govContract);
      setToken(tokenContract);

      refreshData(govContract, tokenContract, accounts[0]);
    } catch (err) {
      console.error(err);
    }
  };

  const refreshData = async (gov: Contract, tok: Contract, user: string) => {
    setLoading(true);
    try {
      const bn = await provider!.getBlockNumber();
      setBlockNumber(bn);

      const power = await tok.getVotes(user);
      setVotingPower(ethers.formatEther(power));

      // Fetch proposals - simplified simulation as Graph/Events needed for full history in standard generic governor
      // In a real app we query events. Here we assume we fetch recent ProposalCreated events.
      const filter = gov.filters.ProposalCreated();
      const events = await gov.queryFilter(filter, 0, "latest");

      const fetchedProposals: Proposal[] = [];
      for (const event of events.reverse()) {
        if ('args' in event) {
          const args = event.args;
          // args: proposalId, proposer, targets, values, signatures, calldatas, startBlock, endBlock, description
          const id = args[0];
          const state = await gov.state(id);
          const votes = await gov.proposalVotes(id);
          // Fetch voting type (custom mapping)
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
            againstVotes: votes[2],
            abstainVotes: votes[0],
            votingType: Number(vType)
          });
        }
      }
      setProposals(fetchedProposals);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const createProposal = async () => {
    if (!governor || !token) return;
    try {
      setLoading(true);
      // Simple proposal: Self-transfer 0 tokens (dummy)
      const encodedFunction = token.interface.encodeFunctionData("transfer", [account, 0]);
      // Overloaded propose for QV support in ABI?
      // MyGovernor has propose(..., type).
      // Ethers might need explicit signature

      if (votingType === 1) { // QV
        const tx = await governor["propose(address[],uint256[],bytes[],string,uint8)"](
          [addresses.token],
          [0],
          [encodedFunction],
          desc,
          1
        );
        await tx.wait();
      } else {
        const tx = await governor["propose(address[],uint256[],bytes[],string)"](
          [addresses.token],
          [0],
          [encodedFunction],
          desc
        );
        await tx.wait();
      }

      await refreshData(governor, token, account!);
      setDesc("");
    } catch (e) {
      console.error(e);
      alert("Failed to create proposal");
    }
    setLoading(false);
  }

  const castVote = async (proposalId: string, support: number, isQV: boolean) => {
    if (!governor) return;
    try {
      if (isQV) {
        // Ask for weight
        const weightStr = prompt("Enter vote weight (cost = weight^2 tokens):", "1");
        if (!weightStr) return;
        const weight = BigInt(weightStr);
        const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [weight]);
        const cost = weight * weight;

        // Approve first
        const txApprove = await token!.approve(addresses.governor, cost);
        await txApprove.wait();

        const tx = await governor.castVoteWithReasonAndParams(proposalId, support, "QV Vote", params);
        await tx.wait();
      } else {
        const tx = await governor.castVote(proposalId, support);
        await tx.wait();
      }
      await refreshData(governor, token!, account!);
    } catch (e) {
      console.error(e);
      alert("Vote failed");
    }
  }

  const delegate = async () => {
    if (!token) return;
    try {
      const tx = await token.delegate(account);
      await tx.wait();
      await refreshData(governor!, token, account!);
    } catch (e) {
      console.error(e);
    }
  }

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
          {account && (
            <div className="text-right">
              <p data-testid="user-address" className="text-sm font-mono text-slate-300">{account.substring(0, 6)}...{account.substring(38)}</p>
              <p className="text-xs text-slate-500">Voting Power: {parseFloat(votingPower).toFixed(2)} GT</p>
            </div>
          )}
          <button
            data-testid="connect-wallet-button"
            onClick={connectWallet}
            disabled={!!account}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
          >
            <Wallet size={18} />
            {account ? "Connected" : "Connect Wallet"}
          </button>
        </div>
      </header>

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
                    className={clsx("flex-1 py-2 rounded-lg text-sm border transition-all", votingType === 0 ? "bg-blue-600/20 border-blue-500 text-blue-400" : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750")}
                  >
                    Standard (1T1V)
                  </button>
                  <button
                    onClick={() => setVotingType(1)}
                    className={clsx("flex-1 py-2 rounded-lg text-sm border transition-all", votingType === 1 ? "bg-purple-600/20 border-purple-500 text-purple-400" : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750")}
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

              {!account && <p className="text-center text-xs text-red-400">Connect wallet to propose</p>}
            </div>
          </section>

          <section className="bg-slate-900 rounded-xl p-6 border border-slate-800">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            <button onClick={delegate} disabled={!account || loading} className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 py-2 rounded-lg text-sm transition-colors">
              Delegate to Self
            </button>
            <p className="text-xs text-slate-500 mt-2 text-center">Required to activate voting power</p>
          </section>
        </div>

        {/* Right Column: Proposals List */}
        <div className="lg:col-span-2">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <Vote className="text-purple-400" /> Active Proposals
          </h2>

          <div className="space-y-4">
            {proposals.length === 0 ? (
              <div className="text-center py-12 text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed">
                No proposals found
              </div>
            ) : (
              proposals.map(p => (
                <div key={p.id} data-testid="proposal-list-item" className="bg-slate-900 rounded-xl p-6 border border-slate-800 hover:border-slate-700 transition-colors shadow-lg">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className={clsx("px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider",
                          p.state === 1 ? "bg-green-500/20 text-green-400" :
                            p.state === 3 ? "bg-red-500/20 text-red-400" :
                              p.state === 4 ? "bg-blue-500/20 text-blue-400" : "bg-slate-700 text-slate-400"
                        )}>
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
                      <div className="text-xs text-slate-500">Ends Block: {p.endBlock.toString()}</div>
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
                      <div style={{ width: `${Number(p.forVotes) / (Number(p.forVotes + p.againstVotes + p.abstainVotes) || 1) * 100}%` }} className="bg-green-500" />
                      <div style={{ width: `${Number(p.againstVotes) / (Number(p.forVotes + p.againstVotes + p.abstainVotes) || 1) * 100}%` }} className="bg-red-500" />
                      <div style={{ width: `${Number(p.abstainVotes) / (Number(p.forVotes + p.againstVotes + p.abstainVotes) || 1) * 100}%` }} className="bg-slate-500" />
                    </div>
                  </div>

                  {/* Actions */}
                  {p.state === 1 && account && (
                    <div className="flex gap-2 border-t border-slate-800 pt-4">
                      <button data-testid="vote-for-button" onClick={() => castVote(p.id, 1, p.votingType === 1)} className="flex-1 bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-800/50 py-2 rounded-lg text-sm font-medium transition-colors">
                        Vote For
                      </button>
                      <button data-testid="vote-against-button" onClick={() => castVote(p.id, 0, p.votingType === 1)} className="flex-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 py-2 rounded-lg text-sm font-medium transition-colors">
                        Vote Against
                      </button>
                      <button data-testid="vote-abstain-button" onClick={() => castVote(p.id, 2, p.votingType === 1)} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 py-2 rounded-lg text-sm font-medium transition-colors">
                        Abstain
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
