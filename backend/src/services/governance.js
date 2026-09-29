/**
 * Governance Service (#982)
 *
 * Helper functions to read governance state, proposal history, voting weight,
 * and build unsigned Soroban transactions for governance operations.
 * Reuses the standard Soroban RPC interaction patterns from backend/src/stellar.js.
 */
import StellarSdk from "@stellar/stellar-sdk";
import {
  server,
  networkPassphrase,
  withTimeout,
  retryBuildTx,
  addressToScVal,
  i128ToScVal,
  _config,
} from "../stellar.js";
import logger from "../logger.js";

const { Contract, Account, TransactionBuilder, BASE_FEE, SorobanRpc, scValToNative, nativeToScVal } =
  StellarSdk;

const DUMMY_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

/**
 * Execute a read-only simulation against the contract.
 * @param {string} contractId
 * @param {string} method
 * @param {Array} args
 * @returns {Promise<any>} native decoded return value or null
 */
async function simulateReadOnly(contractId, method, args = []) {
  try {
    const contract = new Contract(contractId);
    const dummyAccount = new Account(DUMMY_ACCOUNT, "0");
    const tx = new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await withTimeout(
      server.simulateTransaction(tx),
      _config.SOROBAN_RPC_TIMEOUT_MS,
      `simulate ${method}`
    );

    if (SorobanRpc.Api.isSimulationError(sim)) {
      return null;
    }

    if (!sim.result?.retval) {
      return null;
    }

    return scValToNative(sim.result.retval);
  } catch (err) {
    logger.warn?.(`Simulation failed for ${method}`, {
      contractId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Convert a JS GovProposalAction object into Soroban ScVal
 * @param {Object} action
 * @returns {xdr.ScVal}
 */
export function encodeGovProposalAction(action) {
  if (!action || typeof action !== "object") {
    throw new Error("Invalid proposal action");
  }

  const type = action.type;
  switch (type) {
    case "ChangeRoyaltyRate":
      return nativeToScVal({ ChangeRoyaltyRate: Number(action.rate) });
    case "SetTokenFeeOverride":
      return nativeToScVal({
        SetTokenFeeOverride: [new StellarSdk.Address(action.token), Number(action.feeBps)],
      });
    case "PauseContract":
      return nativeToScVal({ PauseContract: null });
    case "UnpauseContract":
      return nativeToScVal({ UnpauseContract: null });
    case "RemoveCollaborator":
      return nativeToScVal({
        RemoveCollaborator: new StellarSdk.Address(action.collaborator),
      });
    case "AllocateBudget":
      return nativeToScVal({
        AllocateBudget: [
          new StellarSdk.Address(action.token),
          new StellarSdk.Address(action.recipient),
          BigInt(action.amount),
        ],
      });
    default:
      throw new Error(`Unknown proposal action type: ${type}`);
  }
}

/**
 * Get total supply of governance tokens.
 * @param {string} contractId
 * @returns {Promise<bigint>}
 */
export async function getGovTotalSupply(contractId) {
  const res = await simulateReadOnly(contractId, "gov_total_supply");
  return res != null ? BigInt(res) : 0n;
}

/**
 * Get governance token balance for an address.
 * @param {string} contractId
 * @param {string} address
 * @returns {Promise<bigint>}
 */
export async function getGovBalance(contractId, address) {
  const res = await simulateReadOnly(contractId, "gov_balance", [addressToScVal(address)]);
  return res != null ? BigInt(res) : 0n;
}

/**
 * Get effective voting power for an address taking delegation into account.
 * @param {string} contractId
 * @param {string} address
 * @returns {Promise<bigint>}
 */
export async function getEffectiveGovVotes(contractId, address) {
  const res = await simulateReadOnly(contractId, "get_effective_gov_votes", [
    addressToScVal(address),
  ]);
  return res != null ? BigInt(res) : 0n;
}

/**
 * Get delegate address if user has delegated their votes.
 * @param {string} contractId
 * @param {string} address
 * @returns {Promise<string|null>}
 */
export async function getGovDelegate(contractId, address) {
  const res = await simulateReadOnly(contractId, "get_gov_delegate", [addressToScVal(address)]);
  return res || null;
}

/**
 * Get total number of governance proposals.
 * @param {string} contractId
 * @returns {Promise<number>}
 */
export async function getGovProposalCount(contractId) {
  const res = await simulateReadOnly(contractId, "get_gov_proposal_count");
  return res != null ? Number(res) : 0;
}

/**
 * Get single governance proposal by ID.
 * @param {string} contractId
 * @param {number|bigint} proposalId
 * @returns {Promise<Object|null>}
 */
export async function getGovProposal(contractId, proposalId) {
  const res = await simulateReadOnly(contractId, "get_gov_proposal", [
    nativeToScVal(BigInt(proposalId), { type: "u64" }),
  ]);
  if (!res) return null;

  return {
    id: Number(res.id),
    proposer: res.proposer,
    title: res.title,
    description: res.description,
    action: res.action,
    yesVotes: BigInt(res.yes_votes ?? res.yesVotes ?? 0n),
    noVotes: BigInt(res.no_votes ?? res.noVotes ?? 0n),
    quorumVotes: BigInt(res.quorum_votes ?? res.quorumVotes ?? 0n),
    createdAt: Number(res.created_at ?? res.createdAt ?? 0),
    votingEndsAt: Number(res.voting_ends_at ?? res.votingEndsAt ?? 0),
    executed: Boolean(res.executed),
    rejected: Boolean(res.rejected),
    executedAt: Number(res.executed_at ?? res.executedAt ?? 0),
  };
}

/**
 * List governance proposals with status summaries.
 * @param {string} contractId
 * @param {Object} [options]
 * @param {number} [options.limit=20]
 * @param {number} [options.offset=0]
 * @returns {Promise<{ proposals: Array, total: number }>}
 */
export async function listGovProposals(contractId, options = {}) {
  const total = await getGovProposalCount(contractId);
  const limit = options.limit || 20;
  const offset = options.offset || 0;

  const proposals = [];
  const startId = Math.max(1, total - offset);
  const endId = Math.max(1, startId - limit + 1);

  for (let id = startId; id >= endId; id--) {
    const prop = await getGovProposal(contractId, id);
    if (prop) {
      const totalVotes = prop.yesVotes + prop.noVotes;
      const meetsQuorum = totalVotes >= prop.quorumVotes;
      const isMajority = prop.yesVotes > prop.noVotes;
      const now = Math.floor(Date.now() / 1000);
      const isVotingOpen = now < prop.votingEndsAt && !prop.executed && !prop.rejected;

      proposals.push({
        ...prop,
        totalVotes,
        meetsQuorum,
        isMajority,
        isVotingOpen,
        canExecute: !isVotingOpen && !prop.executed && !prop.rejected && meetsQuorum && isMajority,
      });
    }
  }

  return {
    proposals,
    total,
  };
}

/**
 * Check if a voter has voted on a proposal.
 * @param {string} contractId
 * @param {number|bigint} proposalId
 * @param {string} voterAddress
 * @returns {Promise<boolean>}
 */
export async function hasVotedGovProposal(contractId, proposalId, voterAddress) {
  const res = await simulateReadOnly(contractId, "has_voted_gov_proposal", [
    nativeToScVal(BigInt(proposalId), { type: "u64" }),
    addressToScVal(voterAddress),
  ]);
  return Boolean(res);
}

/**
 * Fetch comprehensive governance overview for a user.
 * @param {string} contractId
 * @param {string} [userAddress]
 * @returns {Promise<Object>}
 */
export async function getGovernanceSummary(contractId, userAddress = null) {
  const [totalSupply, proposalCount] = await Promise.all([
    getGovTotalSupply(contractId),
    getGovProposalCount(contractId),
  ]);

  let userBalance = 0n;
  let effectiveVotes = 0n;
  let delegate = null;

  if (userAddress) {
    [userBalance, effectiveVotes, delegate] = await Promise.all([
      getGovBalance(contractId, userAddress),
      getEffectiveGovVotes(contractId, userAddress),
      getGovDelegate(contractId, userAddress),
    ]);
  }

  return {
    contractId,
    totalSupply: totalSupply.toString(),
    proposalCount,
    user: userAddress
      ? {
          address: userAddress,
          balance: userBalance.toString(),
          effectiveVotes: effectiveVotes.toString(),
          delegate,
        }
      : null,
  };
}

// ── Transaction Builders ──────────────────────────────────────────────────

/**
 * Build unsigned XDR for minting governance tokens.
 */
export async function buildGovMintTx(callerAddress, contractId, toAddress, amount) {
  return retryBuildTx(callerAddress, contractId, "gov_mint", [
    addressToScVal(toAddress),
    i128ToScVal(amount),
  ]);
}

/**
 * Build unsigned XDR for transferring governance tokens.
 */
export async function buildGovTransferTx(callerAddress, contractId, toAddress, amount) {
  return retryBuildTx(callerAddress, contractId, "gov_transfer", [
    addressToScVal(callerAddress),
    addressToScVal(toAddress),
    i128ToScVal(amount),
  ]);
}

/**
 * Build unsigned XDR for delegating governance votes.
 */
export async function buildDelegateGovVotesTx(callerAddress, contractId, delegateeAddress) {
  return retryBuildTx(callerAddress, contractId, "delegate_gov_votes", [
    addressToScVal(callerAddress),
    addressToScVal(delegateeAddress),
  ]);
}

/**
 * Build unsigned XDR for revoking delegation.
 */
export async function buildRevokeGovDelegationTx(callerAddress, contractId) {
  return retryBuildTx(callerAddress, contractId, "revoke_gov_delegation", [
    addressToScVal(callerAddress),
  ]);
}

/**
 * Build unsigned XDR for creating a governance proposal.
 */
export async function buildCreateGovProposalTx(callerAddress, contractId, proposalData) {
  const { title, description, action, votingPeriodSeconds } = proposalData;
  return retryBuildTx(callerAddress, contractId, "create_gov_proposal", [
    addressToScVal(callerAddress),
    nativeToScVal(title, { type: "string" }),
    nativeToScVal(description, { type: "string" }),
    encodeGovProposalAction(action),
    nativeToScVal(BigInt(votingPeriodSeconds), { type: "u64" }),
  ]);
}

/**
 * Build unsigned XDR for voting on a governance proposal.
 */
export async function buildVoteGovProposalTx(callerAddress, contractId, proposalId, support) {
  return retryBuildTx(callerAddress, contractId, "vote_gov_proposal", [
    addressToScVal(callerAddress),
    nativeToScVal(BigInt(proposalId), { type: "u64" }),
    nativeToScVal(Boolean(support), { type: "bool" }),
  ]);
}

/**
 * Build unsigned XDR for executing an approved governance proposal.
 */
export async function buildExecuteGovProposalTx(callerAddress, contractId, proposalId) {
  return retryBuildTx(callerAddress, contractId, "execute_gov_proposal", [
    nativeToScVal(BigInt(proposalId), { type: "u64" }),
  ]);
}
