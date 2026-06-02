import { createPublicClient, createWalletClient, custom, http } from "viem";
import type { Address, Hash, TransactionReceipt } from "viem";

import {
  UZHETH_CHAIN,
  UZHETH_CHAIN_ID_DECIMAL,
  UZHETH_CHAIN_ID_HEX,
  UZHETH_RPC_URL,
} from "../config/chain";
import {
  BATTLESHIP_ABI,
  BATTLESHIP_CONTRACT_ADDRESS,
} from "../config/contract";
import { devLog } from "./devLog";

const DEFAULT_WRITE_GAS_LIMIT = 250_000n;
const FAST_POLLING_INTERVAL_MS = 500;

function getEthereumProvider() {
  if (!window.ethereum) {
    throw new Error("No Ethereum wallet provider found.");
  }

  return window.ethereum;
}

export function createBattleshipPublicClient() {
  return createPublicClient({
    chain: UZHETH_CHAIN,
    transport: http(UZHETH_RPC_URL),
    pollingInterval: FAST_POLLING_INTERVAL_MS,
  });
}

function createBattleshipWalletClient() {
  devLog("contract:walletClient:create:start");

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
  devLog("contract:nextGameId:start", {
    contract: BATTLESHIP_CONTRACT_ADDRESS,
  });

  const client = createBattleshipPublicClient();

  try {
    const value = (await client.readContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      functionName: "nextGameId",
    })) as bigint;

    devLog("contract:nextGameId:success", { value });
    return value;
  } catch (error) {
    devLog("contract:nextGameId:error", { error });
    throw error;
  }
}

export async function readContractCodeBytes(): Promise<number> {
  devLog("contract:code:start", { contract: BATTLESHIP_CONTRACT_ADDRESS });

  const client = createBattleshipPublicClient();

  try {
    const bytecode = await client.getBytecode({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
    });
    const byteCount = bytecode ? (bytecode.length - 2) / 2 : 0;

    devLog("contract:code:success", { byteCount });
    return byteCount;
  } catch (error) {
    devLog("contract:code:error", { error });
    throw error;
  }
}

export async function createGame(senderAddress: string): Promise<Hash> {
  devLog("contract:createGame:start", {
    senderAddress,
    contract: BATTLESHIP_CONTRACT_ADDRESS,
  });

  try {
    const provider = getEthereumProvider();
    const [chainId, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);

    devLog("contract:createGame:providerSnapshot", {
      expectedChainId: UZHETH_CHAIN_ID_HEX,
      actualChainId: chainId,
      accounts,
      senderAddress,
    });

    const walletClient = createBattleshipWalletClient();
    devLog("contract:createGame:writeContract:request", {
      senderAddress,
      contract: BATTLESHIP_CONTRACT_ADDRESS,
      functionName: "createGame",
      gas: DEFAULT_WRITE_GAS_LIMIT,
    });

    const hash = await walletClient.writeContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      functionName: "createGame",
      account: asAddress(senderAddress),
      gas: DEFAULT_WRITE_GAS_LIMIT,
    });

    devLog("contract:createGame:txSent", { senderAddress, hash });
    return hash;
  } catch (error) {
    devLog("contract:createGame:error", { senderAddress, error });
    throw error;
  }
}

export async function waitForTransaction(
  txHash: Hash
): Promise<TransactionReceipt> {
  devLog("contract:waitForTransaction:start", { txHash });
  const client = createBattleshipPublicClient();

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
  const chainId = String(
    await getEthereumProvider().request({ method: "eth_chainId" })
  );

  devLog("contract:assertCorrectChain:read", {
    expectedDecimal: UZHETH_CHAIN_ID_DECIMAL,
    expectedHex: UZHETH_CHAIN_ID_HEX,
    actual: chainId,
  });

  if (chainId.toLowerCase() !== UZHETH_CHAIN_ID_HEX.toLowerCase()) {
    throw new Error(
      `Wrong chain. Expected ${UZHETH_CHAIN_ID_HEX}, got ${chainId}.`
    );
  }

  devLog("contract:assertCorrectChain:success", { chainId });
}
