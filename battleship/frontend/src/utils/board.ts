import {
  bytesToHex,
  concatHex,
  encodePacked,
  hexToBytes,
  keccak256,
} from "viem";
import type { Address, Hex } from "viem";

import { BATTLESHIP_CONTRACT_ADDRESS } from "../config/contract";
import { asAddress } from "./contract";
import { devLog } from "./devLog";

export const BOARD_SIZE = 5;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
export const SHIP_COUNT = 3;

const BOARD_SECRET_KEY_PREFIX = "battleship:board-secret";

export type BoardSecret = {
  gameId: string;
  playerAddress: Address;
  shipCells: number[];
  shipMask: number;
  salts: Hex[];
  leaves: Hex[];
  root: Hex;
};

function boardSecretKey(gameId: bigint | string, playerAddress: string): string {
  return `${BOARD_SECRET_KEY_PREFIX}:${gameId.toString()}:${playerAddress.toLowerCase()}`;
}

export function cellLabel(cell: number): string {
  const column = String.fromCharCode("A".charCodeAt(0) + (cell % BOARD_SIZE));
  const row = Math.floor(cell / BOARD_SIZE) + 1;

  return `${column}${row}`;
}

export function validateCell(cell: number): number {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) {
    throw new Error(`Cell must be between 0 and ${CELL_COUNT - 1}.`);
  }

  return cell;
}

export function shipMaskFromCells(shipCells: readonly number[]): number {
  if (shipCells.length !== SHIP_COUNT) {
    throw new Error(`Board must contain exactly ${SHIP_COUNT} ships.`);
  }

  const uniqueCells = new Set(shipCells.map(validateCell));

  if (uniqueCells.size !== shipCells.length) {
    throw new Error("Ship cells must be unique.");
  }

  let mask = 0;

  for (const cell of uniqueCells) {
    mask |= 1 << cell;
  }

  return mask;
}

export function hasShip(shipMask: number, cell: number): boolean {
  return (shipMask & (1 << validateCell(cell))) !== 0;
}

export function generateSalt(): Hex {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Browser crypto is not available.");
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(bytes);
}

export function makeBoardLeaf({
  gameId,
  playerAddress,
  cell,
  hasShipValue,
  salt,
  contractAddress = BATTLESHIP_CONTRACT_ADDRESS,
}: {
  gameId: bigint;
  playerAddress: string;
  cell: number;
  hasShipValue: boolean;
  salt: Hex;
  contractAddress?: string;
}): Hex {
  return keccak256(
    encodePacked(
      ["uint256", "address", "uint8", "uint8", "bytes32", "address"],
      [
        gameId,
        asAddress(playerAddress),
        validateCell(cell),
        hasShipValue ? 1 : 0,
        salt,
        asAddress(contractAddress),
      ]
    )
  );
}

function isLexicographicallyLess(left: Uint8Array, right: Uint8Array): boolean {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;

    return left[index] < right[index];
  }

  return false;
}

export function hashPair(left: Hex, right: Hex): Hex {
  const leftBytes = hexToBytes(left);
  const rightBytes = hexToBytes(right);
  const [first, second] = isLexicographicallyLess(leftBytes, rightBytes)
    ? [left, right]
    : [right, left];

  return keccak256(concatHex([first, second]));
}

export function buildMerkleRoot(leaves: readonly Hex[]): Hex {
  if (leaves.length !== CELL_COUNT) {
    throw new Error(`Merkle tree needs exactly ${CELL_COUNT} leaves.`);
  }

  let layer = [...leaves];

  while (layer.length > 1) {
    const nextLayer: Hex[] = [];

    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right = layer[index + 1] ?? left;
      nextLayer.push(hashPair(left, right));
    }

    layer = nextLayer;
  }

  return layer[0];
}

export function buildBoardSecret({
  gameId,
  playerAddress,
  shipCells,
}: {
  gameId: bigint;
  playerAddress: string;
  shipCells: readonly number[];
}): BoardSecret {
  const shipMask = shipMaskFromCells(shipCells);
  const salts = Array.from({ length: CELL_COUNT }, generateSalt);
  const leaves = salts.map((salt, cell) =>
    makeBoardLeaf({
      gameId,
      playerAddress,
      cell,
      hasShipValue: hasShip(shipMask, cell),
      salt,
    })
  );
  const root = buildMerkleRoot(leaves);

  return {
    gameId: gameId.toString(),
    playerAddress: asAddress(playerAddress),
    shipCells: [...shipCells],
    shipMask,
    salts,
    leaves,
    root,
  };
}

export function saveBoardSecret(secret: BoardSecret): void {
  devLog("board:secret:save", {
    gameId: secret.gameId,
    playerAddress: secret.playerAddress,
    shipCells: secret.shipCells,
    shipMask: secret.shipMask,
    root: secret.root,
  });

  localStorage.setItem(
    boardSecretKey(secret.gameId, secret.playerAddress),
    JSON.stringify(secret)
  );
}

export function loadBoardSecret(
  gameId: bigint,
  playerAddress: string
): BoardSecret | null {
  devLog("board:secret:load", { gameId, playerAddress });
  const raw = localStorage.getItem(boardSecretKey(gameId, playerAddress));

  if (!raw) return null;

  return JSON.parse(raw) as BoardSecret;
}
