import json
import secrets
from pathlib import Path

from web3 import Web3

from rps_backend.utils.config import LOCAL_SECRETS_DIR

MOVE_TO_INT = {
    "rock": 0,
    "paper": 1,
    "scissors": 2,
}

INT_TO_MOVE = {
    0: "rock",
    1: "paper",
    2: "scissors",
}


def normalize_move(move: str | int) -> int:
    """
    Convert a user move into its contract integer representation.

    rock     -> 0
    paper    -> 1
    scissors -> 2
    """
    if isinstance(move, int):
        if move not in INT_TO_MOVE:
            raise ValueError("Move must be 0, 1, or 2.")
        return move

    move_key = move.strip().lower()

    if move_key not in MOVE_TO_INT:
        raise ValueError("Move must be one of: rock, paper, scissors.")

    return MOVE_TO_INT[move_key]


def move_name(move: int) -> str:
    """
    Convert a contract move integer into a readable name.
    """
    if move not in INT_TO_MOVE:
        raise ValueError(f"Unknown move value: {move}")

    return INT_TO_MOVE[move]


def generate_salt() -> str:
    """
    Generate a random 32-byte salt as a 0x-prefixed hex string.
    """
    return "0x" + secrets.token_hex(32)


def make_commitment(
    *,
    contract_address: str,
    move: str | int,
    salt: str,
    player_address: str,
    game_id: int,
) -> bytes:
    """
    Compute the same commitment that Solidity computes:

    keccak256(abi.encodePacked(
        uint8 move,
        bytes32 salt,
        address player,
        uint256 gameId,
        address contract
    ))
    """
    move_int = normalize_move(move)

    return Web3.solidity_keccak(
        ["uint8", "bytes32", "address", "uint256", "address"],
        [
            move_int,
            salt,
            Web3.to_checksum_address(player_address),
            game_id,
            Web3.to_checksum_address(contract_address),
        ],
    )


def _secret_path(game_id: int, player_address: str) -> Path:
    safe_address = Web3.to_checksum_address(player_address)
    return LOCAL_SECRETS_DIR / f"game_{game_id}_{safe_address}.json"


def save_reveal_secret(
    *,
    game_id: int,
    player_address: str,
    move: str | int,
    salt: str,
    commitment: str,
) -> Path:
    """
    Save the local secret needed for reveal.

    This file must never be committed to Git.
    """
    LOCAL_SECRETS_DIR.mkdir(parents=True, exist_ok=True)

    move_int = normalize_move(move)
    path = _secret_path(game_id, player_address)

    data = {
        "game_id": game_id,
        "player_address": Web3.to_checksum_address(player_address),
        "move": move_int,
        "move_name": move_name(move_int),
        "salt": salt,
        "commitment": commitment,
    }

    path.write_text(json.dumps(data, indent=2))
    return path


def load_reveal_secret(*, game_id: int, player_address: str) -> dict:
    """
    Load the local move + salt needed for reveal.
    """
    path = _secret_path(game_id, player_address)

    if not path.exists():
        raise FileNotFoundError(
            f"No local reveal secret found for game {game_id} and player {player_address}.\n"
            "Without the original salt, this player cannot reveal their committed move."
        )

    return json.loads(path.read_text())


def delete_reveal_secret(*, game_id: int, player_address: str) -> None:
    """
    Delete local reveal secret after the game is finished.
    """
    path = _secret_path(game_id, player_address)

    if path.exists():
        path.unlink()