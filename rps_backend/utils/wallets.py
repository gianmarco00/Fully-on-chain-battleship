import os
from dataclasses import dataclass

from dotenv import load_dotenv
from web3 import Web3

from rps_backend.utils.config import ENV_PATH


@dataclass(frozen=True)
class Wallet:
    role: str
    address: str
    private_key: str


def _load_env() -> None:
    if not ENV_PATH.exists():
        raise FileNotFoundError(f"Missing .env file at {ENV_PATH}")

    load_dotenv(ENV_PATH)


def _build_wallet(*, role: str, address_var: str, key_var: str) -> Wallet:
    _load_env()

    address = os.getenv(address_var)
    private_key = os.getenv(key_var)

    if not address or not private_key:
        raise RuntimeError(
            f"Missing {address_var} or {key_var} in .env for wallet role '{role}'."
        )

    checksum_address = Web3.to_checksum_address(address)
    derived_address = Web3().eth.account.from_key(private_key).address

    if derived_address.lower() != checksum_address.lower():
        raise RuntimeError(
            f"Private key does not match address for wallet role '{role}'.\n"
            f"Expected: {checksum_address}\n"
            f"Key gives: {derived_address}"
        )

    return Wallet(
        role=role,
        address=checksum_address,
        private_key=private_key,
    )


def load_wallet(role: str) -> Wallet:
    """
    Load a local development wallet.

    Supported roles:
    - player1: PRIVATE_KEY + FUNDING_ADDRESS
    - player2: PLAYER2_PRIVATE_KEY + PLAYER2_ADDRESS

    This is for local Python development only.
    The future frontend should use MetaMask instead of asking for private keys.
    """
    normalized_role = role.strip().lower()

    if normalized_role == "player1":
        return _build_wallet(
            role="player1",
            address_var="FUNDING_ADDRESS",
            key_var="PRIVATE_KEY",
        )

    if normalized_role == "player2":
        return _build_wallet(
            role="player2",
            address_var="PLAYER2_ADDRESS",
            key_var="PLAYER2_PRIVATE_KEY",
        )

    raise ValueError("Unknown wallet role. Use 'player1' or 'player2'.")