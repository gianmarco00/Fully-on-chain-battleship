import { createPublicClient, createWalletClient, custom } from "viem";
import type { Address, Hash, TransactionReceipt } from "viem";

import { UZHETH_CHAIN, UZHETH_CHAIN_ID_DECIMAL } from "../config/chain";
import { RPS_ABI, RPS_CONTRACT_ADDRESS } from "../config/contract";
import { devLog, devTrace } from "./devLog";

// Match the Python backend's safe transaction gas limit.
const DEFAULT_WRITE_GAS_LIMIT = 250_000n;

function getEthereumProvider() {
  if (!window.ethereum) {
    throw new Error("No Ethereum wallet provider found.");
  }

  return window.ethereum;
}

export function createRpsPublicClient() {
  return createPublicClient({
    chain: UZHETH_CHAIN,
    transport: custom(getEthereumProvider()),
  });
}

function createRpsWalletClient() {
  return createWalletClient({
    chain: UZHETH_CHAIN,
    transport: custom(getEthereumProvider()),
  });
}

export function asAddress(value: string): Address {
  if (!value.startsWith("0x") || value.length !== 42) {
    throw new Error("Invalid wallet address.");
  }

  return value as Address;
}

export async function readNextGameId(): Promise<bigint> {
  devLog("contract:nextGameId:start", { contract: RPS_CONTRACT_ADDRESS });
  const client = createRpsPublicClient();

  try {
    const value = (await client.readContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "nextGameId",
    })) as bigint;

    devLog("contract:nextGameId:success", { value });
    return value;
  } catch (error) {
    devLog("contract:nextGameId:error", { error });
    throw error;
  }
}

export async function readGame(gameId: bigint): Promise<readonly unknown[]> {
  devTrace("contract:getGame:start", { gameId });
  const client = createRpsPublicClient();

  try {
    const game = (await client.readContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "getGame",
      args: [gameId],
    })) as readonly unknown[];

    devTrace("contract:getGame:success", { gameId, game });
    return game;
  } catch (error) {
    devLog("contract:getGame:error", { gameId, error });
    throw error;
  }
}

export async function readCommitments(
  gameId: bigint
): Promise<readonly unknown[]> {
  devTrace("contract:getCommitments:start", { gameId });
  const client = createRpsPublicClient();

  try {
    const commitments = (await client.readContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "getCommitments",
      args: [gameId],
    })) as readonly unknown[];

    devTrace("contract:getCommitments:success", { gameId, commitments });
    return commitments;
  } catch (error) {
    devLog("contract:getCommitments:error", { gameId, error });
    throw error;
  }
}

export async function readReveals(gameId: bigint): Promise<readonly unknown[]> {
  devTrace("contract:getReveals:start", { gameId });
  const client = createRpsPublicClient();

  try {
    const reveals = (await client.readContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "getReveals",
      args: [gameId],
    })) as readonly unknown[];

    devTrace("contract:getReveals:success", { gameId, reveals });
    return reveals;
  } catch (error) {
    devLog("contract:getReveals:error", { gameId, error });
    throw error;
  }
}

export async function createGame(senderAddress: string): Promise<Hash> {
  devLog("contract:createGame:start", {
    senderAddress,
    contract: RPS_CONTRACT_ADDRESS,
  });
  const walletClient = createRpsWalletClient();

  try {
    const hash = await walletClient.writeContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "createGame",
      account: asAddress(senderAddress),
    });

    devLog("contract:createGame:txSent", { senderAddress, hash });
    return hash;
  } catch (error) {
    devLog("contract:createGame:error", { senderAddress, error });
    throw error;
  }
}

export async function joinGame(
  gameId: bigint,
  senderAddress: string
): Promise<Hash> {
  devLog("contract:joinGame:start", { gameId, senderAddress });
  const walletClient = createRpsWalletClient();

  try {
    const hash = await walletClient.writeContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "joinGame",
      args: [gameId],
      account: asAddress(senderAddress),
    });

    devLog("contract:joinGame:txSent", { gameId, senderAddress, hash });
    return hash;
  } catch (error) {
    devLog("contract:joinGame:error", { gameId, senderAddress, error });
    throw error;
  }
}

export async function commitMove(
  gameId: bigint,
  commitment: Hash,
  senderAddress: string
): Promise<Hash> {
  devLog("contract:commitMove:start", { gameId, senderAddress, commitment });
  const walletClient = createRpsWalletClient();

  try {
    const hash = await walletClient.writeContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "commitMove",
      args: [gameId, commitment],
      account: asAddress(senderAddress),
      gas: DEFAULT_WRITE_GAS_LIMIT,
    });

    devLog("contract:commitMove:txSent", { gameId, senderAddress, hash });
    return hash;
  } catch (error) {
    devLog("contract:commitMove:error", { gameId, senderAddress, error });
    throw error;
  }
}

export async function simulateCommitMove(
  gameId: bigint,
  commitment: Hash,
  senderAddress: string
): Promise<void> {
  devLog("contract:commitMove:simulate:start", {
    gameId,
    senderAddress,
    commitment,
  });
  const client = createRpsPublicClient();

  try {
    await client.simulateContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "commitMove",
      args: [gameId, commitment],
      account: asAddress(senderAddress),
    });

    devLog("contract:commitMove:simulate:success", {
      gameId,
      senderAddress,
    });
  } catch (error) {
    devLog("contract:commitMove:simulate:error", {
      gameId,
      senderAddress,
      error,
    });
    throw error;
  }
}

export async function revealMove(
  gameId: bigint,
  move: number,
  salt: Hash,
  senderAddress: string
): Promise<Hash> {
  devLog("contract:revealMove:start", { gameId, senderAddress });
  const walletClient = createRpsWalletClient();

  try {
    const hash = await walletClient.writeContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "revealMove",
      args: [gameId, move, salt],
      account: asAddress(senderAddress),
      gas: DEFAULT_WRITE_GAS_LIMIT,
    });

    devLog("contract:revealMove:txSent", { gameId, senderAddress, hash });
    return hash;
  } catch (error) {
    devLog("contract:revealMove:error", { gameId, senderAddress, error });
    throw error;
  }
}

export async function simulateRevealMove(
  gameId: bigint,
  move: number,
  salt: Hash,
  senderAddress: string
): Promise<void> {
  devLog("contract:revealMove:simulate:start", { gameId, senderAddress });
  const client = createRpsPublicClient();

  try {
    await client.simulateContract({
      address: RPS_CONTRACT_ADDRESS,
      abi: RPS_ABI,
      functionName: "revealMove",
      args: [gameId, move, salt],
      account: asAddress(senderAddress),
    });

    devLog("contract:revealMove:simulate:success", { gameId, senderAddress });
  } catch (error) {
    devLog("contract:revealMove:simulate:error", {
      gameId,
      senderAddress,
      error,
    });
    throw error;
  }
}

export async function waitForTransaction(
  txHash: Hash
): Promise<TransactionReceipt> {
  devLog("contract:waitForTransaction:start", { txHash });
  const client = createRpsPublicClient();
  try {
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });

    devLog("contract:waitForTransaction:receipt", {
      txHash,
      status: receipt.status,
      from: receipt.from,
      to: receipt.to,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    });

    if (receipt.status !== "success") {
      throw new Error(`Transaction failed: ${txHash}`);
    }

    return receipt;
  } catch (error) {
    devLog("contract:waitForTransaction:error", { txHash, error });
    throw error;
  }
}

export async function assertCorrectChain(): Promise<void> {
  devLog("contract:assertCorrectChain:start");
  const client = createRpsPublicClient();
  const chainId = await client.getChainId();

  devLog("contract:assertCorrectChain:read", {
    expected: UZHETH_CHAIN_ID_DECIMAL,
    actual: chainId,
  });

  if (chainId !== UZHETH_CHAIN_ID_DECIMAL) {
    throw new Error(
      `Wrong chain. Expected ${UZHETH_CHAIN_ID_DECIMAL}, got ${chainId}.`
    );
  }
}
