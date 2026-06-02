from dataclasses import dataclass
from typing import Iterable

from web3 import Web3


BOARD_WIDTH = 5
BOARD_HEIGHT = 5
CELL_COUNT = BOARD_WIDTH * BOARD_HEIGHT
SHIP_COUNT = 3


@dataclass(frozen=True)
class TestBoard:
    ship_cells: tuple[int, ...]
    ship_mask: int
    salts: tuple[bytes, ...]
    leaves: tuple[bytes, ...]
    root: bytes


def normalize_cell(cell: str | int) -> int:
    if isinstance(cell, int):
        cell_index = cell
    else:
        value = cell.strip().upper()

        if value.isdecimal():
            cell_index = int(value)
        else:
            if len(value) < 2:
                raise ValueError("Cell must be an index like 7 or a label like C2.")

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


def parse_ship_cells(raw: str) -> tuple[int, ...]:
    cells = tuple(normalize_cell(part) for part in raw.split(",") if part.strip())
    validate_ship_cells(cells)
    return cells


def validate_ship_cells(ship_cells: Iterable[int]) -> tuple[int, ...]:
    cells = tuple(normalize_cell(cell) for cell in ship_cells)

    if len(cells) != SHIP_COUNT:
        raise ValueError(f"Test board must contain exactly {SHIP_COUNT} ships.")

    if len(set(cells)) != len(cells):
        raise ValueError("Ship cells must be unique.")

    return cells


def ship_mask_from_cells(ship_cells: Iterable[int]) -> int:
    mask = 0

    for cell in validate_ship_cells(ship_cells):
        mask |= 1 << cell

    return mask


def has_ship(ship_mask: int, cell: int) -> bool:
    cell_index = normalize_cell(cell)
    return (ship_mask & (1 << cell_index)) != 0


def deterministic_salt(namespace: str, game_id: int, player_address: str, cell: int) -> bytes:
    return Web3.keccak(
        text=(
            "battleship-test:"
            f"{namespace}:"
            f"{game_id}:"
            f"{Web3.to_checksum_address(player_address)}:"
            f"{normalize_cell(cell)}"
        )
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
    ship_cells: Iterable[int],
    namespace: str,
) -> TestBoard:
    ships = validate_ship_cells(ship_cells)
    ship_mask = ship_mask_from_cells(ships)
    salts = tuple(
        deterministic_salt(namespace, game_id, player_address, cell)
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
        ship_cells=ships,
        ship_mask=ship_mask,
        salts=salts,
        leaves=leaves,
        root=root,
    )


def short_hex(value: bytes | str) -> str:
    text = value.hex() if isinstance(value, bytes) else value

    if not text.startswith("0x"):
        text = "0x" + text

    return f"{text[:10]}...{text[-8:]}"
