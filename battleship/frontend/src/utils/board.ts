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
import { devLog, devTrace } from "./devLog";

export const BOARD_SIZE = 10;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
export const SHIP_COUNT = 5;
export const FLEET_CELL_COUNT = 17;
export const SHIP_DEFINITIONS = [
  { id: "aircraftCarrier", name: "Aircraft Carrier", length: 5 },
  { id: "battleship", name: "Battleship", length: 4 },
  { id: "destroyer", name: "Destroyer", length: 3 },
  { id: "submarine", name: "Submarine", length: 3 },
  { id: "patrolBoat", name: "Patrol Boat", length: 2 },
] as const;

const BOARD_SECRET_KEY_PREFIX = "battleship:board-secret";

export type ShipDefinition = (typeof SHIP_DEFINITIONS)[number];

export type ShipPlacement = {
  shipId: ShipDefinition["id"];
  startCell: number;
  horizontal: boolean;
};

export type BoardSecret = {
  gameId: string;
  playerAddress: Address;
  shipCells: number[];
  shipMask: string;
  masterSalt?: Hex;
  firstMoveSecret?: Hex;
  firstMoveCommit?: Hex;
  shipStartCells?: number[];
  shipHorizontal?: boolean[];
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

export function shipMaskFromCells(shipCells: readonly number[]): string {
  if (shipCells.length !== FLEET_CELL_COUNT) {
    throw new Error(`Board must contain exactly ${FLEET_CELL_COUNT} ship cells.`);
  }

  const uniqueCells = new Set(shipCells.map(validateCell));

  if (uniqueCells.size !== shipCells.length) {
    throw new Error("Ship cells must be unique.");
  }

  let mask = 0n;

  for (const cell of uniqueCells) {
    mask |= 1n << BigInt(cell);
  }

  return `0x${mask.toString(16)}`;
}

export function hasShip(shipMask: string, cell: number): boolean {
  return (BigInt(shipMask) & (1n << BigInt(validateCell(cell)))) !== 0n;
}

export function shipDefinitionById(shipId: string): ShipDefinition {
  const ship = SHIP_DEFINITIONS.find((definition) => definition.id === shipId);

  if (!ship) {
    throw new Error("Unknown ship.");
  }

  return ship;
}

export function cellsForShipPlacement(
  startCell: number,
  length: number,
  horizontal = true
): number[] {
  const start = validateCell(startCell);
  const cells: number[] = [];

  for (let offset = 0; offset < length; offset += 1) {
    const cell = start + offset * (horizontal ? 1 : BOARD_SIZE);
    validateCell(cell);

    if (horizontal && Math.floor(cell / BOARD_SIZE) !== Math.floor(start / BOARD_SIZE)) {
      throw new Error("Ship would cross the board edge.");
    }

    cells.push(cell);
  }

  return cells;
}

export function shipCellsFromPlacements(
  placements: readonly ShipPlacement[]
): number[] {
  if (placements.length !== SHIP_COUNT) {
    throw new Error(`Board must contain exactly ${SHIP_COUNT} ships.`);
  }

  const orderedPlacements = orderedShipPlacements(placements);
  const occupiedCells: number[] = [];
  const seenCells = new Set<number>();

  for (const placement of orderedPlacements) {
    const ship = shipDefinitionById(placement.shipId);
    const cells = cellsForShipPlacement(
      placement.startCell,
      ship.length,
      placement.horizontal
    );

    for (const cell of cells) {
      if (seenCells.has(cell)) {
        throw new Error("Ships cannot overlap.");
      }

      seenCells.add(cell);
      occupiedCells.push(cell);
    }
  }

  if (occupiedCells.length !== FLEET_CELL_COUNT) {
    throw new Error(`Board must occupy exactly ${FLEET_CELL_COUNT} ship cells.`);
  }

  return occupiedCells;
}

export function orderedShipPlacements(
  placements: readonly ShipPlacement[]
): ShipPlacement[] {
  return SHIP_DEFINITIONS.map((ship) => {
    const placement = placements.find((candidate) => candidate.shipId === ship.id);

    if (!placement) {
      throw new Error(`Missing ${ship.name}.`);
    }

    return {
      shipId: ship.id,
      startCell: validateCell(placement.startCell),
      horizontal: Boolean(placement.horizontal),
    };
  });
}

export function generateSalt(): Hex {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Browser crypto is not available.");
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const salt = bytesToHex(bytes);

    if (BigInt(salt) !== 0n) {
      return salt;
    }
  }

  throw new Error("Browser crypto produced an empty secret.");
}

export function deriveCellSalt({
  gameId,
  playerAddress,
  cell,
  masterSalt,
  contractAddress = BATTLESHIP_CONTRACT_ADDRESS,
}: {
  gameId: bigint;
  playerAddress: string;
  cell: number;
  masterSalt: Hex;
  contractAddress?: string;
}): Hex {
  return keccak256(
    encodePacked(
      ["uint256", "address", "uint8", "bytes32", "address"],
      [
        gameId,
        asAddress(playerAddress),
        validateCell(cell),
        masterSalt,
        asAddress(contractAddress),
      ]
    )
  );
}

export function makeFirstMoveCommit({
  gameId,
  playerAddress,
  firstMoveSecret,
  contractAddress = BATTLESHIP_CONTRACT_ADDRESS,
}: {
  gameId: bigint;
  playerAddress: string;
  firstMoveSecret: Hex;
  contractAddress?: string;
}): Hex {
  return keccak256(
    encodePacked(
      ["uint256", "address", "bytes32", "address"],
      [
        gameId,
        asAddress(playerAddress),
        firstMoveSecret,
        asAddress(contractAddress),
      ]
    )
  );
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

export function buildMerkleProof(leaves: readonly Hex[], cell: number): Hex[] {
  let index = validateCell(cell);

  if (leaves.length !== CELL_COUNT) {
    throw new Error(`Merkle tree needs exactly ${CELL_COUNT} leaves.`);
  }

  let layer = [...leaves];
  const proof: Hex[] = [];

  while (layer.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push(layer[siblingIndex] ?? layer[index]);

    const nextLayer: Hex[] = [];

    for (let layerIndex = 0; layerIndex < layer.length; layerIndex += 2) {
      const left = layer[layerIndex];
      const right = layer[layerIndex + 1] ?? left;
      nextLayer.push(hashPair(left, right));
    }

    layer = nextLayer;
    index = Math.floor(index / 2);
  }

  return proof;
}

export function buildBoardSecret({
  gameId,
  playerAddress,
  placements,
}: {
  gameId: bigint;
  playerAddress: string;
  placements: readonly ShipPlacement[];
}): BoardSecret {
  const orderedPlacements = orderedShipPlacements(placements);
  const shipCells = shipCellsFromPlacements(orderedPlacements);
  const shipMask = shipMaskFromCells(shipCells);
  const masterSalt = generateSalt();
  const firstMoveSecret = generateSalt();
  const firstMoveCommit = makeFirstMoveCommit({
    gameId,
    playerAddress,
    firstMoveSecret,
  });
  const salts = Array.from({ length: CELL_COUNT }, (_, cell) =>
    deriveCellSalt({
      gameId,
      playerAddress,
      cell,
      masterSalt,
    })
  );
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
    masterSalt,
    firstMoveSecret,
    firstMoveCommit,
    shipStartCells: orderedPlacements.map((placement) => placement.startCell),
    shipHorizontal: orderedPlacements.map((placement) => placement.horizontal),
    salts,
    leaves,
    root,
  };
}

export function saveBoardSecret(secret: BoardSecret): void {
  devLog("board:secret:save", {
    gameId: secret.gameId,
    playerAddress: secret.playerAddress,
    shipCount: secret.shipStartCells?.length ?? 0,
    shipCellCount: secret.shipCells.length,
    firstMoveCommit: secret.firstMoveCommit,
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
  devTrace("board:secret:load", { gameId, playerAddress });
  const raw = localStorage.getItem(boardSecretKey(gameId, playerAddress));

  if (!raw) return null;

  return JSON.parse(raw) as BoardSecret;
}
