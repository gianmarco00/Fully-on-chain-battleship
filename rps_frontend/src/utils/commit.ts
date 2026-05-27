import { encodePacked, keccak256 } from "viem";
import type { Address, Hash } from "viem";

import { RPS_CONTRACT_ADDRESS } from "../config/contract";
import { asAddress } from "./contract";
import { devLog } from "./devLog";

const SECRET_KEY_PREFIX = "rps:reveal-secret";

const MOVE_TO_INT = {
  rock: 0,
  paper: 1,
  scissors: 2,
} as const;

const INT_TO_MOVE = {
  0: "rock",
  1: "paper",
  2: "scissors",
} as const;

export type MoveValue = 0 | 1 | 2;
export type MoveInput = MoveValue | string;

export type RevealSecret = {
  gameId: string;
  playerAddress: Address;
  move: MoveValue;
  moveName: string;
  salt: Hash;
  commitment: Hash;
};

type MakeCommitmentParams = {
  move: MoveInput;
  salt: Hash;
  playerAddress: string;
  gameId: bigint;
  contractAddress?: string;
};

function isMoveValue(move: number): move is MoveValue {
  return move === 0 || move === 1 || move === 2;
}

function secretKey(gameId: bigint | string, playerAddress: string): string {
  return `${SECRET_KEY_PREFIX}:${gameId.toString()}:${playerAddress.toLowerCase()}`;
}

export function normalizeMove(move: MoveInput): MoveValue {
  if (typeof move === "number") {
    if (isMoveValue(move)) return move;
    throw new Error("Move must be 0, 1, or 2.");
  }

  const key = move.trim().toLowerCase();

  if (key === "0" || key === "1" || key === "2") {
    return Number(key) as MoveValue;
  }

  if (key in MOVE_TO_INT) {
    return MOVE_TO_INT[key as keyof typeof MOVE_TO_INT];
  }

  throw new Error("Move must be rock, paper, or scissors.");
}

export function moveName(move: MoveInput): string {
  return INT_TO_MOVE[normalizeMove(move)];
}

export function generateSalt(): Hash {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Browser crypto is not available.");
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `0x${hex}` as Hash;
}

export function makeCommitment({
  contractAddress = RPS_CONTRACT_ADDRESS,
  move,
  salt,
  playerAddress,
  gameId,
}: MakeCommitmentParams): Hash {
  return keccak256(
    encodePacked(
      ["uint8", "bytes32", "address", "uint256", "address"],
      [
        normalizeMove(move),
        salt,
        asAddress(playerAddress),
        gameId,
        asAddress(contractAddress),
      ]
    )
  );
}

export function saveRevealSecret(secret: RevealSecret): void {
  devLog("commit:secret:save", {
    gameId: secret.gameId,
    playerAddress: secret.playerAddress,
    commitment: secret.commitment,
  });

  localStorage.setItem(
    secretKey(secret.gameId, secret.playerAddress),
    JSON.stringify(secret)
  );
}

export function loadRevealSecret(
  gameId: bigint,
  playerAddress: string
): RevealSecret | null {
  devLog("commit:secret:load", { gameId, playerAddress });
  const raw = localStorage.getItem(secretKey(gameId, playerAddress));

  if (!raw) return null;

  return JSON.parse(raw) as RevealSecret;
}

export function deleteRevealSecret(
  gameId: bigint,
  playerAddress: string
): void {
  devLog("commit:secret:delete", { gameId, playerAddress });
  localStorage.removeItem(secretKey(gameId, playerAddress));
}
