import { createPublicClient, createWalletClient, custom } from "viem";
import type { Address, Hash, TransactionReceipt } from "viem";

import { UZHETH_CHAIN, UZHETH_CHAIN_ID_DECIMAL } from "../config/chain";
import { RPS_ABI, RPS_CONTRACT_ADDRESS } from "../config/contract";

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

function asAddress(value: string): Address {
  if (!value.startsWith("0x") || value.length !== 42) {
    throw new Error("Invalid wallet address.");
  }

  return value as Address;
}

export async function readNextGameId(): Promise<bigint> {
  const client = createRpsPublicClient();

  return client.readContract({
    address: RPS_CONTRACT_ADDRESS,
    abi: RPS_ABI,
    functionName: "nextGameId",
  }) as Promise<bigint>;
}

export async function readGame(gameId: bigint): Promise<readonly unknown[]> {
  const client = createRpsPublicClient();

  return client.readContract({
    address: RPS_CONTRACT_ADDRESS,
    abi: RPS_ABI,
    functionName: "getGame",
    args: [gameId],
  }) as Promise<readonly unknown[]>;
}

export async function readCommitments(
  gameId: bigint
): Promise<readonly unknown[]> {
  const client = createRpsPublicClient();

  return client.readContract({
    address: RPS_CONTRACT_ADDRESS,
    abi: RPS_ABI,
    functionName: "getCommitments",
    args: [gameId],
  }) as Promise<readonly unknown[]>;
}

export async function readReveals(gameId: bigint): Promise<readonly unknown[]> {
  const client = createRpsPublicClient();

  return client.readContract({
    address: RPS_CONTRACT_ADDRESS,
    abi: RPS_ABI,
    functionName: "getReveals",
    args: [gameId],
  }) as Promise<readonly unknown[]>;
}

export async function createGame(senderAddress: string): Promise<Hash> {
  const walletClient = createRpsWalletClient();

  return walletClient.writeContract({
    address: RPS_CONTRACT_ADDRESS,
    abi: RPS_ABI,
    functionName: "createGame",
    account: asAddress(senderAddress),
  });
}

export async function joinGame(
  gameId: bigint,
  senderAddress: string
): Promise<Hash> {
  const walletClient = createRpsWalletClient();

  return walletClient.writeContract({
    address: RPS_CONTRACT_ADDRESS,
    abi: RPS_ABI,
    functionName: "joinGame",
    args: [gameId],
    account: asAddress(senderAddress),
  });
}

export async function waitForTransaction(
  txHash: Hash
): Promise<TransactionReceipt> {
  const client = createRpsPublicClient();
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success") {
    throw new Error(`Transaction failed: ${txHash}`);
  }

  return receipt;
}

export async function assertCorrectChain(): Promise<void> {
  const client = createRpsPublicClient();
  const chainId = await client.getChainId();

  if (chainId !== UZHETH_CHAIN_ID_DECIMAL) {
    throw new Error(
      `Wrong chain. Expected ${UZHETH_CHAIN_ID_DECIMAL}, got ${chainId}.`
    );
  }
}
