from dataclasses import dataclass
from typing import Iterable

from web3 import Web3


BOARD_WIDTH = 10
BOARD_HEIGHT = 10
CELL_COUNT = BOARD_WIDTH * BOARD_HEIGHT
SHIP_LENGTHS = (5, 4, 3, 3, 2)
SHIP_COUNT = len(SHIP_LENGTHS)
FLEET_CELL_COUNT = sum(SHIP_LENGTHS)


@dataclass(frozen=True)
class ShipPlacement:
    start_cell: int
    horizontal: bool


@dataclass(frozen=True)
class TestBoard:
    placements: tuple[ShipPlacement, ...]
    ship_cells: tuple[int, ...]
    ship_mask: int
    master_salt: bytes
    salts: tuple[bytes, ...]
    leaves: tuple[bytes, ...]
    root: bytes

    @property
    def ship_start_cells(self) -> tuple[int, ...]:
        return tuple(placement.start_cell for placement in self.placements)

    @property
    def ship_horizontal(self) -> tuple[bool, ...]:
        return tuple(placement.horizontal for placement in self.placements)


def normalize_cell(cell: str | int) -> int:
    if isinstance(cell, int):
        cell_index = cell
    else:
        value = cell.strip().upper()

        if value.isdecimal():
            cell_index = int(value)
        else:
            if len(value) < 2:
                raise ValueError("Cell must be an index like 17 or a label like C2.")

            column = ord(value[0]) - ord("A")
            row_text = value[1:]

            if not row_text.isdecimal():
                raise ValueError("Cell row must be a number.")

            row = int(row_text) - 1
            cell_index = row * BOARD_WIDTH + column

    if cell_index < 0 or cell_index >= CELL_COUNT:
        raise ValueError(f"Cell must be between 0 and {CELL_COUNT - 1}.")

    return cell_index


def cell_label(cell: int) -> str:
    cell_index = normalize_cell(cell)
    column = chr(ord("A") + (cell_index % BOARD_WIDTH))
    row = cell_index // BOARD_WIDTH + 1
    return f"{column}{row}"


def parse_ship_placements(raw: str) -> tuple[ShipPlacement, ...]:
    placements: list[ShipPlacement] = []

    for part in raw.split(","):
        value = part.strip()

        if not value:
            continue

        pieces = value.split(":")

        if len(pieces) != 2:
            raise ValueError("Placement must look like A1:H or C3:V.")

        orientation = pieces[1].strip().upper()

        if orientation not in {"H", "V"}:
            raise ValueError("Orientation must be H or V.")

        placements.append(
            ShipPlacement(
                start_cell=normalize_cell(pieces[0]),
                horizontal=orientation == "H",
            )
        )

    return validate_ship_placements(placements)


def validate_ship_placements(
    placements: Iterable[ShipPlacement],
) -> tuple[ShipPlacement, ...]:
    normalized = tuple(
        ShipPlacement(
            start_cell=normalize_cell(placement.start_cell),
            horizontal=bool(placement.horizontal),
        )
        for placement in placements
    )

    if len(normalized) != SHIP_COUNT:
        raise ValueError(f"Board must contain exactly {SHIP_COUNT} ships.")

    ship_cells_from_placements(normalized)
    return normalized


def ship_cells_from_placements(
    placements: Iterable[ShipPlacement],
) -> tuple[int, ...]:
    normalized = tuple(placements)

    if len(normalized) != SHIP_COUNT:
        raise ValueError(f"Board must contain exactly {SHIP_COUNT} ships.")

    occupied: list[int] = []
    seen: set[int] = set()

    for placement, length in zip(normalized, SHIP_LENGTHS, strict=True):
        start = normalize_cell(placement.start_cell)
        start_column = start % BOARD_WIDTH
        start_row = start // BOARD_WIDTH

        if placement.horizontal:
            if start_column + length > BOARD_WIDTH:
                raise ValueError(f"Ship at {cell_label(start)} does not fit.")

            step = 1
        else:
            if start_row + length > BOARD_HEIGHT:
                raise ValueError(f"Ship at {cell_label(start)} does not fit.")

            step = BOARD_WIDTH

        for offset in range(length):
            cell = start + offset * step

            if cell in seen:
                raise ValueError(f"Ships overlap at {cell_label(cell)}.")

            seen.add(cell)
            occupied.append(cell)

    if len(occupied) != FLEET_CELL_COUNT:
        raise ValueError(f"Fleet must occupy exactly {FLEET_CELL_COUNT} cells.")

    return tuple(occupied)


def ship_mask_from_placements(placements: Iterable[ShipPlacement]) -> int:
    mask = 0

    for cell in ship_cells_from_placements(placements):
        mask |= 1 << cell

    return mask


def has_ship(ship_mask: int, cell: int) -> bool:
    cell_index = normalize_cell(cell)
    return (ship_mask & (1 << cell_index)) != 0


def deterministic_master_salt(
    namespace: str,
    game_id: int,
    player_address: str,
) -> bytes:
    return Web3.keccak(
        text=(
            "battleship-test-master:"
            f"{namespace}:"
            f"{game_id}:"
            f"{Web3.to_checksum_address(player_address)}"
        )
    )


def deterministic_first_move_secret(
    namespace: str,
    game_id: int,
    player_address: str,
) -> bytes:
    return Web3.keccak(
        text=(
            "battleship-test-first-move:"
            f"{namespace}:"
            f"{game_id}:"
            f"{Web3.to_checksum_address(player_address)}"
        )
    )


def make_first_move_commit(
    *,
    game_id: int,
    player_address: str,
    random_secret: bytes,
    contract_address: str,
) -> bytes:
    if int.from_bytes(random_secret, "big") == 0:
        raise ValueError("Random secret cannot be zero.")

    return Web3.solidity_keccak(
        ["uint256", "address", "bytes32", "address"],
        [
            game_id,
            Web3.to_checksum_address(player_address),
            random_secret,
            Web3.to_checksum_address(contract_address),
        ],
    )


def derive_cell_salt(
    *,
    game_id: int,
    player_address: str,
    cell: int,
    master_salt: bytes,
    contract_address: str,
) -> bytes:
    return Web3.solidity_keccak(
        ["uint256", "address", "uint8", "bytes32", "address"],
        [
            game_id,
            Web3.to_checksum_address(player_address),
            normalize_cell(cell),
            master_salt,
            Web3.to_checksum_address(contract_address),
        ],
    )


def make_leaf(
    *,
    game_id: int,
    player_address: str,
    cell: int,
    has_ship_value: bool,
    salt: bytes,
    contract_address: str,
) -> bytes:
    return Web3.solidity_keccak(
        ["uint256", "address", "uint8", "uint8", "bytes32", "address"],
        [
            game_id,
            Web3.to_checksum_address(player_address),
            normalize_cell(cell),
            1 if has_ship_value else 0,
            salt,
            Web3.to_checksum_address(contract_address),
        ],
    )


def hash_pair(left: bytes, right: bytes) -> bytes:
    first, second = (left, right) if left < right else (right, left)
    return Web3.keccak(first + second)


def build_tree(leaves: Iterable[bytes]) -> list[list[bytes]]:
    tree = [list(leaves)]

    if len(tree[0]) != CELL_COUNT:
        raise ValueError(f"Merkle tree needs exactly {CELL_COUNT} leaves.")

    while len(tree[-1]) > 1:
        layer = tree[-1]
        next_layer: list[bytes] = []

        for index in range(0, len(layer), 2):
            left = layer[index]
            right = layer[index + 1] if index + 1 < len(layer) else left
            next_layer.append(hash_pair(left, right))

        tree.append(next_layer)

    return tree


def merkle_proof(leaves: Iterable[bytes], cell: int) -> list[bytes]:
    index = normalize_cell(cell)
    tree = build_tree(leaves)
    proof: list[bytes] = []

    for layer in tree[:-1]:
        sibling_index = index + 1 if index % 2 == 0 else index - 1
        sibling = layer[sibling_index] if sibling_index < len(layer) else layer[index]
        proof.append(sibling)
        index //= 2

    return proof


def build_test_board(
    *,
    game_id: int,
    player_address: str,
    contract_address: str,
    placements: Iterable[ShipPlacement],
    namespace: str,
) -> TestBoard:
    ships = validate_ship_placements(placements)
    ship_cells = ship_cells_from_placements(ships)
    ship_mask = ship_mask_from_placements(ships)
    master_salt = deterministic_master_salt(namespace, game_id, player_address)
    salts = tuple(
        derive_cell_salt(
            game_id=game_id,
            player_address=player_address,
            cell=cell,
            master_salt=master_salt,
            contract_address=contract_address,
        )
        for cell in range(CELL_COUNT)
    )
    leaves = tuple(
        make_leaf(
            game_id=game_id,
            player_address=player_address,
            cell=cell,
            has_ship_value=has_ship(ship_mask, cell),
            salt=salts[cell],
            contract_address=contract_address,
        )
        for cell in range(CELL_COUNT)
    )
    root = build_tree(leaves)[-1][0]

    return TestBoard(
        placements=ships,
        ship_cells=ship_cells,
        ship_mask=ship_mask,
        master_salt=master_salt,
        salts=salts,
        leaves=leaves,
        root=root,
    )


def first_miss_cells(board: TestBoard, count: int) -> tuple[int, ...]:
    misses = [cell for cell in range(CELL_COUNT) if not has_ship(board.ship_mask, cell)]

    if len(misses) < count:
        raise ValueError("Not enough miss cells available.")

    return tuple(misses[:count])


def short_hex(value: bytes | str) -> str:
    text = value.hex() if isinstance(value, bytes) else value

    if not text.startswith("0x"):
        text = "0x" + text

    return f"{text[:10]}...{text[-8:]}"
