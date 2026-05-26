import { readCommitments, readGame, readReveals } from "./contract";

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

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);

  throw new Error("Contract returned an unexpected numeric value.");
}

function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS;
}

function isZeroCommitment(commitment: string): boolean {
  return commitment.toLowerCase() === ZERO_COMMITMENT;
}

function moveName(move: number): string {
  return MOVE_NAMES[move] ?? "Unknown";
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

export async function loadGameState(gameId: bigint): Promise<GameStateView> {
  const [game, commitments, reveals] = await Promise.all([
    readGame(gameId),
    readCommitments(gameId),
    readReveals(gameId),
  ]);

  if (game.length !== 6) {
    throw new Error("Unexpected getGame() response format.");
  }

  if (commitments.length !== 2) {
    throw new Error("Unexpected getCommitments() response format.");
  }

  if (reveals.length !== 4) {
    throw new Error("Unexpected getReveals() response format.");
  }

  const [player1, player2, winner, phaseRaw, commitDeadlineRaw, revealDeadlineRaw] =
    game;
  const [commitment1Raw, commitment2Raw] = commitments;
  const [revealed1Raw, revealed2Raw, move1Raw, move2Raw] = reveals;

  const phase = Number(asBigInt(phaseRaw));
  const commitDeadline = asBigInt(commitDeadlineRaw);
  const revealDeadline = asBigInt(revealDeadlineRaw);

  const commitment1 = String(commitment1Raw);
  const commitment2 = String(commitment2Raw);

  const player1Revealed = Boolean(revealed1Raw);
  const player2Revealed = Boolean(revealed2Raw);

  const move1 = Number(asBigInt(move1Raw));
  const move2 = Number(asBigInt(move2Raw));

  return {
    gameId,
    player1: String(player1),
    player2: String(player2),
    winner: String(winner),
    phase,
    phaseName: PHASE_NAMES[phase] ?? "Unknown",
    commitDeadline,
    revealDeadline,
    player1Committed: !isZeroCommitment(commitment1),
    player2Committed: !isZeroCommitment(commitment2),
    player1Revealed,
    player2Revealed,
    player1MoveName: player1Revealed ? moveName(move1) : "Hidden",
    player2MoveName: player2Revealed ? moveName(move2) : "Hidden",
  };
}
