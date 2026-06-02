import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  numberToHex,
} from "viem";
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

export async function readGame(gameId: bigint): Promise<readonly unknown[]> {
  devLog("contract:getGame:start", { gameId });
  const client = createBattleshipPublicClient();

  try {
    const game = (await client.readContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      functionName: "getGame",
      args: [gameId],
    })) as readonly unknown[];

    devLog("contract:getGame:success", { gameId, game });
    return game;
  } catch (error) {
    devLog("contract:getGame:error", { gameId, error });
    throw error;
  }
}

export async function readBoardRoots(
  gameId: bigint
): Promise<readonly unknown[]> {
  devLog("contract:getBoardRoots:start", { gameId });
  const client = createBattleshipPublicClient();

  try {
    const boardRoots = (await client.readContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      functionName: "getBoardRoots",
      args: [gameId],
    })) as readonly unknown[];

    devLog("contract:getBoardRoots:success", { gameId, boardRoots });
    return boardRoots;
  } catch (error) {
    devLog("contract:getBoardRoots:error", { gameId, error });
    throw error;
  }
}

export async function readHitMasks(gameId: bigint): Promise<readonly unknown[]> {
  devLog("contract:getHitMasks:start", { gameId });
  const client = createBattleshipPublicClient();

  try {
    const hitMasks = (await client.readContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      functionName: "getHitMasks",
      args: [gameId],
    })) as readonly unknown[];

    devLog("contract:getHitMasks:success", { gameId, hitMasks });
    return hitMasks;
  } catch (error) {
    devLog("contract:getHitMasks:error", { gameId, error });
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
    const data = encodeFunctionData({
      abi: BATTLESHIP_ABI,
      functionName: "createGame",
    });

    devLog("contract:createGame:sendTransaction:request", {
      senderAddress,
      contract: BATTLESHIP_CONTRACT_ADDRESS,
      functionName: "createGame",
      gas: DEFAULT_WRITE_GAS_LIMIT,
    });

    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: asAddress(senderAddress),
          to: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
          data,
          gas: numberToHex(DEFAULT_WRITE_GAS_LIMIT),
        },
      ],
    })) as Hash;

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
  devLog("contract:joinGame:start", {
    gameId,
    senderAddress,
    contract: BATTLESHIP_CONTRACT_ADDRESS,
  });

  try {
    const provider = getEthereumProvider();
    const data = encodeFunctionData({
      abi: BATTLESHIP_ABI,
      functionName: "joinGame",
      args: [gameId],
    });

    devLog("contract:joinGame:sendTransaction:request", {
      gameId,
      senderAddress,
      contract: BATTLESHIP_CONTRACT_ADDRESS,
      functionName: "joinGame",
      gas: DEFAULT_WRITE_GAS_LIMIT,
    });

    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: asAddress(senderAddress),
          to: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
          data,
          gas: numberToHex(DEFAULT_WRITE_GAS_LIMIT),
        },
      ],
    })) as Hash;

    devLog("contract:joinGame:txSent", { gameId, senderAddress, hash });
    return hash;
  } catch (error) {
    devLog("contract:joinGame:error", { gameId, senderAddress, error });
    throw error;
  }
}

export function readCreatedGameIdFromReceipt(
  receipt: TransactionReceipt
): bigint | null {
  devLog("contract:createGame:decodeReceipt:start", {
    txHash: receipt.transactionHash,
    logs: receipt.logs.length,
  });

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== BATTLESHIP_CONTRACT_ADDRESS.toLowerCase()) {
      continue;
    }

    try {
      const event = decodeEventLog({
        abi: BATTLESHIP_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (event.eventName !== "GameCreated") continue;

      const args = event.args as unknown as Record<string, unknown>;
      const gameId = args.gameId;

      if (typeof gameId !== "bigint") {
        throw new Error("GameCreated event did not include a bigint gameId.");
      }

      devLog("contract:createGame:decodeReceipt:success", {
        txHash: receipt.transactionHash,
        gameId,
      });
      return gameId;
    } catch (error) {
      devLog("contract:createGame:decodeReceipt:skipLog", {
        txHash: receipt.transactionHash,
        error,
      });
    }
  }

  devLog("contract:createGame:decodeReceipt:notFound", {
    txHash: receipt.transactionHash,
  });
  return null;
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
