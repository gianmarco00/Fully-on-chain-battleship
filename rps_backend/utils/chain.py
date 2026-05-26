from decimal import Decimal
from typing import Any

from web3 import Web3

from rps_backend.utils.config import (
    EXPECTED_CHAIN_ID,
    NODE_URL,
    PRIORITY_FEE_GWEI,
)


def connect_web3() -> Web3:
    """
    Connect to the local UZHETH PoS execution node and verify the chain ID.
    """
    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))

    if not w3.is_connected():
        raise ConnectionError(
            f"Could not connect to node at {NODE_URL}. "
            "Check that the geth/reth tmux session is running."
        )

    chain_id = w3.eth.chain_id
    if chain_id != EXPECTED_CHAIN_ID:
        raise RuntimeError(
            f"Connected to wrong chain. Expected {EXPECTED_CHAIN_ID}, got {chain_id}."
        )

    return w3


def get_fee_params(w3: Web3) -> dict[str, int | str]:
    """
    Build EIP-1559 fee parameters for a transaction.
    """
    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", w3.to_wei(1, "gwei"))

    priority_fee = w3.to_wei(PRIORITY_FEE_GWEI, "gwei")
    max_fee = base_fee * 2 + priority_fee

    return {
        "type": 2,
        "maxFeePerGas": max_fee,
        "maxPriorityFeePerGas": priority_fee,
    }


def send_contract_tx(
    *,
    w3: Web3,
    function_call: Any,
    sender_address: str,
    private_key: str,
    gas: int,
    label: str,
):
    """
    Build, sign, send, and wait for a contract transaction.

    This is the main helper that prevents us from repeating transaction
    boilerplate in every action script.
    """
    sender_address = Web3.to_checksum_address(sender_address)

    tx = function_call.build_transaction(
        {
            "chainId": w3.eth.chain_id,
            "from": sender_address,
            "nonce": w3.eth.get_transaction_count(sender_address),
            "gas": gas,
            **get_fee_params(w3),
        }
    )

    print(f"\nSending transaction: {label}")
    print("  from:", sender_address)
    print("  gas limit:", gas)

    signed_tx = w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)

    print("  tx hash:", tx_hash.hex())
    print("  waiting for receipt...")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)

    print("  status:", receipt["status"])
    print("  block:", receipt["blockNumber"])
    print("  gas used:", receipt["gasUsed"])

    if receipt["status"] != 1:
        raise RuntimeError(f"Transaction failed: {label} ({tx_hash.hex()})")

    return receipt


def get_balance_eth(w3: Web3, address: str) -> Decimal:
    """
    Return account balance in human-readable UZHETHs.
    """
    address = Web3.to_checksum_address(address)
    return w3.from_wei(w3.eth.get_balance(address), "ether")