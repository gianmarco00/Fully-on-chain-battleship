import { readBoardRoots, readGame, readHitMasks } from "./contract";
import { devLog } from "./devLog";

export const PHASE_NAMES: Record<number, string> = {
  0: "WaitingForPlayer",
  1: "BoardSetup",
  2: "Attack",
  3: "CellReveal",
  4: "Audit",
  5: "Finished",
  6: "Cancelled",
};

const EMPTY_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export type BattleshipGameState = {
  gameId: bigint;
  player1: string;
  player2: string;
  winner: string;
  phase: number;
  phaseName: string;
  currentAttacker: string;
  pendingTarget: number;
  provisionalWinner: string;
  actionDeadline: bigint;
  boardRoot1: string;
  boardRoot2: string;
  player1BoardCommitted: boolean;
  player2BoardCommitted: boolean;
  hitMask1: number;
  hitMask2: number;
  hitCount1: number;
  hitCount2: number;
};

function asString(value: unknown): string {
  return String(value);
}

function asNumber(value: unknown): number {
  return Number(value);
}

function asBigInt(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(String(value));
}

function parseGameState(
  gameId: bigint,
  game: readonly unknown[],
  boardRoots: readonly unknown[],
  hitMasks: readonly unknown[]
): BattleshipGameState {
  const phase = asNumber(game[3]);
  const boardRoot1 = asString(boardRoots[0]);
  const boardRoot2 = asString(boardRoots[1]);

  return {
    gameId,
    player1: asString(game[0]),
    player2: asString(game[1]),
    winner: asString(game[2]),
    phase,
    phaseName: PHASE_NAMES[phase] ?? "Unknown",
    currentAttacker: asString(game[4]),
    pendingTarget: asNumber(game[5]),
    provisionalWinner: asString(game[6]),
    actionDeadline: asBigInt(game[7]),
    boardRoot1,
    boardRoot2,
    player1BoardCommitted: boardRoot1.toLowerCase() !== EMPTY_BYTES32,
    player2BoardCommitted: boardRoot2.toLowerCase() !== EMPTY_BYTES32,
    hitMask1: asNumber(hitMasks[0]),
    hitMask2: asNumber(hitMasks[1]),
    hitCount1: asNumber(hitMasks[2]),
    hitCount2: asNumber(hitMasks[3]),
  };
}

export function summarizeGameState(state: BattleshipGameState) {
  return {
    gameId: state.gameId,
    phase: state.phaseName,
    player1: state.player1,
    player2: state.player2,
    player1BoardCommitted: state.player1BoardCommitted,
    player2BoardCommitted: state.player2BoardCommitted,
    hitCount1: state.hitCount1,
    hitCount2: state.hitCount2,
    winner: state.winner,
  };
}

export async function loadGameState(
  gameId: bigint
): Promise<BattleshipGameState> {
  devLog("gameState:load:start", { gameId });

  try {
    const [game, boardRoots, hitMasks] = await Promise.all([
      readGame(gameId),
      readBoardRoots(gameId),
      readHitMasks(gameId),
    ]);
    const state = parseGameState(gameId, game, boardRoots, hitMasks);

    devLog("gameState:load:success", summarizeGameState(state));
    return state;
  } catch (error) {
    devLog("gameState:load:error", { gameId, error });
    throw error;
  }
}
