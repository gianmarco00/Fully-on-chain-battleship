import { readCommitments, readGame, readReveals } from "./contract";
import { devLog, devTrace } from "./devLog";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_COMMITMENT = `0x${"00".repeat(32)}`;

export const PHASE_NAMES: Record<number, string> = {
  0: "WaitingForPlayer",
  1: "Commit",
  2: "Reveal",
  3: "Finished",
  4: "Cancelled",
};

export const MOVE_NAMES: Record<number, string> = {
  0: "Rock",
  1: "Paper",
  2: "Scissors",
};

export type GameStateView = {
  gameId: bigint;
  player1: string;
  player2: string;
  winner: string;
  phase: number;
  phaseName: string;
  commitDeadline: bigint;
  revealDeadline: bigint;
  player1Committed: boolean;
  player2Committed: boolean;
  player1Revealed: boolean;
  player2Revealed: boolean;
  player1MoveName: string;
  player2MoveName: string;
};

export type GameStateSummary = {
  gameId: string;
  phase: string;
  player1: string;
  player2: string;
  player1Committed: boolean;
  player2Committed: boolean;
  player1Revealed: boolean;
  player2Revealed: boolean;
  commitDeadline: string;
  revealDeadline: string;
};

type ParsedGame = {
  player1: string;
  player2: string;
  winner: string;
  phase: number;
  commitDeadline: bigint;
  revealDeadline: bigint;
};

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);

  throw new Error("Contract returned an unexpected numeric value.");
}

export function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS;
}

function isZeroCommitment(commitment: string): boolean {
  return commitment.toLowerCase() === ZERO_COMMITMENT;
}

function moveName(move: number): string {
  return MOVE_NAMES[move] ?? "Unknown";
}

function parseGame(game: readonly unknown[]): ParsedGame {
  if (game.length !== 6) {
    throw new Error("Unexpected getGame() response format.");
  }

  const [player1, player2, winner, phaseRaw, commitDeadlineRaw, revealDeadlineRaw] =
    game;

  return {
    player1: String(player1),
    player2: String(player2),
    winner: String(winner),
    phase: Number(asBigInt(phaseRaw)),
    commitDeadline: asBigInt(commitDeadlineRaw),
    revealDeadline: asBigInt(revealDeadlineRaw),
  };
}

function buildGameStateView(
  gameId: bigint,
  game: ParsedGame,
  details: {
    player1Committed: boolean;
    player2Committed: boolean;
    player1Revealed: boolean;
    player2Revealed: boolean;
    player1MoveName: string;
    player2MoveName: string;
  }
): GameStateView {
  return {
    gameId,
    player1: game.player1,
    player2: game.player2,
    winner: game.winner,
    phase: game.phase,
    phaseName: PHASE_NAMES[game.phase] ?? "Unknown",
    commitDeadline: game.commitDeadline,
    revealDeadline: game.revealDeadline,
    ...details,
  };
}

export function formatDeadline(timestamp: bigint): string {
  if (timestamp === 0n) return "not set";

  const date = new Date(Number(timestamp) * 1000);
  return `${date.toLocaleString()} (${timestamp.toString()})`;
}

export function formatWinner(winner: string): string {
  return isZeroAddress(winner) ? "Draw / none" : winner;
}

export function formatPlayer(address: string): string {
  return isZeroAddress(address) ? "Not set yet" : address;
}

export function summarizeGameState(state: GameStateView): GameStateSummary {
  return {
    gameId: state.gameId.toString(),
    phase: state.phaseName,
    player1: state.player1,
    player2: state.player2,
    player1Committed: state.player1Committed,
    player2Committed: state.player2Committed,
    player1Revealed: state.player1Revealed,
    player2Revealed: state.player2Revealed,
    commitDeadline: state.commitDeadline.toString(),
    revealDeadline: state.revealDeadline.toString(),
  };
}

export function gameStateKey(state: GameStateView): string {
  const summary = summarizeGameState(state);

  return [
    summary.phase,
    summary.player1,
    summary.player2,
    summary.player1Committed,
    summary.player2Committed,
    summary.player1Revealed,
    summary.player2Revealed,
    summary.commitDeadline,
    summary.revealDeadline,
  ].join("|");
}

export function secondsUntil(timestamp: bigint): number | null {
  if (timestamp === 0n) return null;

  return Number(timestamp) - Math.floor(Date.now() / 1000);
}

export function logGameStateSnapshot(
  tag: string,
  state: GameStateView,
  extra: Record<string, unknown> = {}
): void {
  devLog(tag, {
    ...extra,
    ...summarizeGameState(state),
    secondsUntilCommitDeadline: secondsUntil(state.commitDeadline),
    secondsUntilRevealDeadline: secondsUntil(state.revealDeadline),
  });
}

export async function loadGameHeader(gameId: bigint): Promise<GameStateView> {
  devTrace("gameState:loadHeader:start", { gameId });

  const game = parseGame(await readGame(gameId));
  const state = buildGameStateView(gameId, game, {
    player1Committed: false,
    player2Committed: false,
    player1Revealed: false,
    player2Revealed: false,
    player1MoveName: "Hidden",
    player2MoveName: "Hidden",
  });

  devTrace("gameState:loadHeader:success", summarizeGameState(state));

  return state;
}

export async function loadGameState(gameId: bigint): Promise<GameStateView> {
  devTrace("gameState:load:start", { gameId });

  const [game, commitments, reveals] = await Promise.all([
    readGame(gameId),
    readCommitments(gameId),
    readReveals(gameId),
  ]);

  if (commitments.length !== 2) {
    throw new Error("Unexpected getCommitments() response format.");
  }

  if (reveals.length !== 4) {
    throw new Error("Unexpected getReveals() response format.");
  }

  const [commitment1Raw, commitment2Raw] = commitments;
  const [revealed1Raw, revealed2Raw, move1Raw, move2Raw] = reveals;

  const parsedGame = parseGame(game);
  const commitment1 = String(commitment1Raw);
  const commitment2 = String(commitment2Raw);

  const player1Revealed = Boolean(revealed1Raw);
  const player2Revealed = Boolean(revealed2Raw);

  const move1 = Number(asBigInt(move1Raw));
  const move2 = Number(asBigInt(move2Raw));

  const state = buildGameStateView(gameId, parsedGame, {
    player1Committed: !isZeroCommitment(commitment1),
    player2Committed: !isZeroCommitment(commitment2),
    player1Revealed,
    player2Revealed,
    player1MoveName: player1Revealed ? moveName(move1) : "Hidden",
    player2MoveName: player2Revealed ? moveName(move2) : "Hidden",
  });

  devTrace("gameState:load:success", summarizeGameState(state));

  return state;
}
