import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  numberToHex,
} from "viem";
import type { Address, Hash, Hex, TransactionReceipt } from "viem";

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
import { devLog, devTrace } from "./devLog";

const DEFAULT_WRITE_GAS_LIMIT = 250_000n;
const FINAL_BOARD_AUDIT_GAS_LIMIT = 1_500_000n;
const FAST_POLLING_INTERVAL_MS = 500;

export type BattleshipGameEventName =
  | "GameJoined"
  | "BoardCommitted"
  | "CellAttacked"
  | "CellRevealed"
  | "AuditStarted"
  | "BoardAudited"
  | "GameFinished"
  | "TimeoutClaimed"
  | "GameCancelled";

type GameEvent = {
  eventName: BattleshipGameEventName;
  transactionHash: Hash | null;
  cellRevealed: CellRevealedLog | null;
};

export type CellRevealedLog = {
  gameId: bigint;
  defender: Address;
  cell: number;
  hit: boolean;
  defenderHitMask: string;
  transactionHash: Hash | null;
};

const GAME_EVENTS_TO_WATCH: readonly BattleshipGameEventName[] = [
  "GameJoined",
  "BoardCommitted",
  "CellAttacked",
  "CellRevealed",
  "AuditStarted",
  "BoardAudited",
  "GameFinished",
  "TimeoutClaimed",
  "GameCancelled",
];

function decodeCellRevealedEventLog(log: {
  data: Hex;
  topics: readonly Hex[];
  transactionHash?: Hash | null;
}): CellRevealedLog | null {
  if (log.topics.length === 0) return null;

  const event = decodeEventLog({
    abi: BATTLESHIP_ABI,
    data: log.data,
    topics: [...log.topics] as [signature: Hex, ...args: Hex[]],
  });

  if (event.eventName !== "CellRevealed") return null;

  const args = event.args as unknown as Record<string, unknown>;

  return {
    gameId: args.gameId as bigint,
    defender: asAddress(String(args.defender)),
    cell: Number(args.cell),
    hit: Boolean(args.hit),
    defenderHitMask: `0x${BigInt(String(args.defenderHitMask)).toString(16)}`,
    transactionHash: log.transactionHash ?? null,
  };
}

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
  devTrace("contract:nextGameId:start", {
    contract: BATTLESHIP_CONTRACT_ADDRESS,
  });

  const client = createBattleshipPublicClient();

  try {
    const value = (await client.readContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      functionName: "nextGameId",
    })) as bigint;

    devTrace("contract:nextGameId:success", { value });
    return value;
  } catch (error) {
    devLog("contract:nextGameId:error", { error });
    throw error;
  }
}

export async function readContractCodeBytes(): Promise<number> {
  devTrace("contract:code:start", { contract: BATTLESHIP_CONTRACT_ADDRESS });

  const client = createBattleshipPublicClient();

  try {
    const bytecode = await client.getBytecode({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
    });
    const byteCount = bytecode ? (bytecode.length - 2) / 2 : 0;

    devTrace("contract:code:success", { byteCount });
    return byteCount;
  } catch (error) {
    devLog("contract:code:error", { error });
    throw error;
  }
}

export async function readGame(gameId: bigint): Promise<readonly unknown[]> {
  devTrace("contract:getGame:start", { gameId });
  const client = createBattleshipPublicClient();

  try {
    const game = (await client.readContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
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

export async function readBoardRoots(
  gameId: bigint
): Promise<readonly unknown[]> {
  devTrace("contract:getBoardRoots:start", { gameId });
  const client = createBattleshipPublicClient();

  try {
    const boardRoots = (await client.readContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      functionName: "getBoardRoots",
      args: [gameId],
    })) as readonly unknown[];

    devTrace("contract:getBoardRoots:success", { gameId, boardRoots });
    return boardRoots;
  } catch (error) {
    devLog("contract:getBoardRoots:error", { gameId, error });
    throw error;
  }
}

export async function readHitMasks(gameId: bigint): Promise<readonly unknown[]> {
  devTrace("contract:getHitMasks:start", { gameId });
  const client = createBattleshipPublicClient();

  try {
    const hitMasks = (await client.readContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      functionName: "getHitMasks",
      args: [gameId],
    })) as readonly unknown[];

    devTrace("contract:getHitMasks:success", { gameId, hitMasks });
    return hitMasks;
  } catch (error) {
    devLog("contract:getHitMasks:error", { gameId, error });
    throw error;
  }
}

export async function computeBoardRoot(
  gameId: bigint,
  playerAddress: string,
  masterSalt: Hex,
  shipStartCells: readonly number[],
  shipHorizontal: readonly boolean[]
): Promise<Hex> {
  if (shipStartCells.length !== 5 || shipHorizontal.length !== 5) {
    throw new Error("Board root computation requires exactly five ship placements.");
  }

  devLog("contract:computeBoardRoot:start", {
    gameId,
    playerAddress,
    shipStartCells,
    shipHorizontal,
  });

  const client = createBattleshipPublicClient();

  try {
    const boardRoot = (await client.readContract({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      functionName: "computeBoardRoot",
      args: [
        gameId,
        asAddress(playerAddress),
        masterSalt,
        shipStartCells,
        shipHorizontal,
      ],
    })) as Hex;

    devLog("contract:computeBoardRoot:success", {
      gameId,
      playerAddress,
      shipStartCells,
      shipHorizontal,
      boardRoot,
    });
    return boardRoot;
  } catch (error) {
    devLog("contract:computeBoardRoot:error", {
      gameId,
      playerAddress,
      shipStartCells,
      shipHorizontal,
      error,
    });
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

export async function commitBoard(
  gameId: bigint,
  boardRoot: Hash,
  senderAddress: string
): Promise<Hash> {
  devLog("contract:commitBoard:start", {
    gameId,
    boardRoot,
    senderAddress,
    contract: BATTLESHIP_CONTRACT_ADDRESS,
  });

  try {
    const provider = getEthereumProvider();
    const data = encodeFunctionData({
      abi: BATTLESHIP_ABI,
      functionName: "commitBoard",
      args: [gameId, boardRoot],
    });

    devLog("contract:commitBoard:sendTransaction:request", {
      gameId,
      boardRoot,
      senderAddress,
      contract: BATTLESHIP_CONTRACT_ADDRESS,
      functionName: "commitBoard",
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

    devLog("contract:commitBoard:txSent", {
      gameId,
      boardRoot,
      senderAddress,
      hash,
    });
    return hash;
  } catch (error) {
    devLog("contract:commitBoard:error", {
      gameId,
      boardRoot,
      senderAddress,
      error,
    });
    throw error;
  }
}

export async function attackCell(
  gameId: bigint,
  cell: number,
  senderAddress: string
): Promise<Hash> {
  devLog("contract:attackCell:start", {
    gameId,
    cell,
    senderAddress,
    contract: BATTLESHIP_CONTRACT_ADDRESS,
  });

  try {
    const provider = getEthereumProvider();
    const data = encodeFunctionData({
      abi: BATTLESHIP_ABI,
      functionName: "attackCell",
      args: [gameId, cell],
    });

    devLog("contract:attackCell:sendTransaction:request", {
      gameId,
      cell,
      senderAddress,
      contract: BATTLESHIP_CONTRACT_ADDRESS,
      functionName: "attackCell",
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

    devLog("contract:attackCell:txSent", {
      gameId,
      cell,
      senderAddress,
      hash,
    });
    return hash;
  } catch (error) {
    devLog("contract:attackCell:error", {
      gameId,
      cell,
      senderAddress,
      error,
    });
    throw error;
  }
}

export async function revealCell(
  gameId: bigint,
  cell: number,
  hit: boolean,
  salt: Hex,
  proof: readonly Hex[],
  senderAddress: string
): Promise<Hash> {
  devLog("contract:revealCell:start", {
    gameId,
    cell,
    hit,
    senderAddress,
    proofLength: proof.length,
    contract: BATTLESHIP_CONTRACT_ADDRESS,
  });

  try {
    const provider = getEthereumProvider();
    const data = encodeFunctionData({
      abi: BATTLESHIP_ABI,
      functionName: "revealCell",
      args: [gameId, cell, hit, salt, proof],
    });

    devLog("contract:revealCell:sendTransaction:request", {
      gameId,
      cell,
      hit,
      senderAddress,
      proofLength: proof.length,
      contract: BATTLESHIP_CONTRACT_ADDRESS,
      functionName: "revealCell",
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

    devLog("contract:revealCell:txSent", {
      gameId,
      cell,
      hit,
      senderAddress,
      hash,
    });
    return hash;
  } catch (error) {
    devLog("contract:revealCell:error", {
      gameId,
      cell,
      hit,
      senderAddress,
      proofLength: proof.length,
      error,
    });
    throw error;
  }
}

export async function revealFinalBoard(
  gameId: bigint,
  masterSalt: Hex,
  shipStartCells: readonly number[],
  shipHorizontal: readonly boolean[],
  senderAddress: string
): Promise<Hash> {
  if (shipStartCells.length !== 5 || shipHorizontal.length !== 5) {
    throw new Error("Final board audit requires exactly five ship placements.");
  }

  devLog("contract:revealFinalBoard:start", {
    gameId,
    shipStartCells,
    shipHorizontal,
    senderAddress,
    contract: BATTLESHIP_CONTRACT_ADDRESS,
  });

  try {
    const provider = getEthereumProvider();
    const data = encodeFunctionData({
      abi: BATTLESHIP_ABI,
      functionName: "revealFinalBoard",
      args: [gameId, masterSalt, shipStartCells, shipHorizontal],
    });

    devLog("contract:revealFinalBoard:sendTransaction:request", {
      gameId,
      shipStartCells,
      shipHorizontal,
      senderAddress,
      contract: BATTLESHIP_CONTRACT_ADDRESS,
      functionName: "revealFinalBoard",
      gas: FINAL_BOARD_AUDIT_GAS_LIMIT,
    });

    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: asAddress(senderAddress),
          to: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
          data,
          gas: numberToHex(FINAL_BOARD_AUDIT_GAS_LIMIT),
        },
      ],
    })) as Hash;

    devLog("contract:revealFinalBoard:txSent", {
      gameId,
      shipStartCells,
      shipHorizontal,
      senderAddress,
      hash,
    });
    return hash;
  } catch (error) {
    devLog("contract:revealFinalBoard:error", {
      gameId,
      shipStartCells,
      shipHorizontal,
      senderAddress,
      error,
    });
    throw error;
  }
}

export async function claimTimeout(
  gameId: bigint,
  senderAddress: string
): Promise<Hash> {
  devLog("contract:claimTimeout:start", {
    gameId,
    senderAddress,
    contract: BATTLESHIP_CONTRACT_ADDRESS,
  });

  try {
    const provider = getEthereumProvider();
    const data = encodeFunctionData({
      abi: BATTLESHIP_ABI,
      functionName: "claimTimeout",
      args: [gameId],
    });

    devLog("contract:claimTimeout:sendTransaction:request", {
      gameId,
      senderAddress,
      contract: BATTLESHIP_CONTRACT_ADDRESS,
      functionName: "claimTimeout",
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

    devLog("contract:claimTimeout:txSent", {
      gameId,
      senderAddress,
      hash,
    });
    return hash;
  } catch (error) {
    devLog("contract:claimTimeout:error", {
      gameId,
      senderAddress,
      error,
    });
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

export function readCellRevealedLogsFromReceipt(
  receipt: TransactionReceipt
): CellRevealedLog[] {
  devLog("contract:revealCell:decodeReceipt:start", {
    txHash: receipt.transactionHash,
    logs: receipt.logs.length,
  });

  const revealedLogs: CellRevealedLog[] = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== BATTLESHIP_CONTRACT_ADDRESS.toLowerCase()) {
      continue;
    }

    try {
      const revealedLog = decodeCellRevealedEventLog({
        data: log.data,
        topics: log.topics,
        transactionHash: receipt.transactionHash,
      });

      if (revealedLog) revealedLogs.push(revealedLog);
    } catch (error) {
      devLog("contract:revealCell:decodeReceipt:skipLog", {
        txHash: receipt.transactionHash,
        error,
      });
    }
  }

  devLog("contract:revealCell:decodeReceipt:success", {
    txHash: receipt.transactionHash,
    revealedCount: revealedLogs.length,
    revealedLogs,
  });
  return revealedLogs;
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

export function watchGameEvents(
  gameId: bigint,
  onEvent: (event: GameEvent) => void
): () => void {
  const client = createBattleshipPublicClient();

  devLog("contract:watchGameEvents:start", {
    gameId,
    events: GAME_EVENTS_TO_WATCH,
    pollingIntervalMs: FAST_POLLING_INTERVAL_MS,
  });

  const unwatchers = GAME_EVENTS_TO_WATCH.map((eventName) =>
    client.watchContractEvent({
      address: asAddress(BATTLESHIP_CONTRACT_ADDRESS),
      abi: BATTLESHIP_ABI,
      eventName,
      args: { gameId },
      onLogs(logs) {
        for (const log of logs) {
          let cellRevealed: CellRevealedLog | null = null;

          if (eventName === "CellRevealed") {
            try {
              cellRevealed = decodeCellRevealedEventLog({
                data: log.data,
                topics: log.topics,
                transactionHash: log.transactionHash ?? null,
              });
            } catch (error) {
              devLog("contract:watchGameEvents:decodeCellRevealed:error", {
                gameId,
                eventName,
                error,
              });
            }
          }

          onEvent({
            eventName,
            transactionHash: log.transactionHash ?? null,
            cellRevealed,
          });
        }
      },
      onError(error) {
        devLog("contract:watchGameEvents:error", {
          gameId,
          eventName,
          error,
        });
      },
    })
  );

  return () => {
    for (const unwatch of unwatchers) {
      unwatch();
    }

    devLog("contract:watchGameEvents:stop", { gameId });
  };
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
