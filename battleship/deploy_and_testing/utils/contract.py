import json
import time
from typing import Any

from solcx import compile_standard, install_solc
from web3 import Web3

from battleship.deploy_and_testing.utils.config import BATTLESHIP_CONTRACT_NAME
from rps_backend.utils.chain import send_contract_tx
from rps_backend.utils.config import BUILD_DIR, CONTRACTS_DIR
from rps_backend.utils.contract import SOLC_VERSION, load_contract
from rps_backend.utils.wallets import Wallet


def load_battleship_contract(w3: Web3):
    return load_contract(w3, BATTLESHIP_CONTRACT_NAME)


def require_contract_code(w3: Web3, address: str) -> bytes:
    checksum_address = Web3.to_checksum_address(address)
    code = w3.eth.get_code(checksum_address)

    if len(code) == 0:
        raise RuntimeError(
            "No contract code found at the configured BattleshipGame address.\n"
            f"Address: {checksum_address}\n"
            f"Latest block: {w3.eth.block_number}\n"
            "This usually means the saved build/BattleshipGame.address.txt points "
            "to an address that was not deployed on the chain this RPC is reading."
        )

    return code


def wait_for_confirmations(
    *,
    w3: Web3,
    mined_block: int,
    confirmation_blocks: int,
    poll_seconds: float = 1.0,
) -> None:
    if confirmation_blocks <= 0:
        return

    target_block = mined_block + confirmation_blocks

    print(f"\nWaiting for {confirmation_blocks} confirmation block(s)...")
    print("  mined block:", mined_block)
    print("  target block:", target_block)

    while w3.eth.block_number < target_block:
        print("  latest block:", w3.eth.block_number)
        time.sleep(poll_seconds)

    print("  latest block:", w3.eth.block_number)


def compile_optimized_contract(
    *,
    contract_file: str,
    contract_name: str,
) -> tuple[list[dict[str, Any]], str]:
    contract_path = CONTRACTS_DIR / contract_file

    if not contract_path.exists():
        raise FileNotFoundError(f"Contract file not found: {contract_path}")

    install_solc(SOLC_VERSION)

    compiled = compile_standard(
        {
            "language": "Solidity",
            "sources": {
                contract_file: {
                    "content": contract_path.read_text(),
                }
            },
            "settings": {
                "optimizer": {
                    "enabled": True,
                    "runs": 200,
                },
                "outputSelection": {
                    "*": {
                        "*": ["abi", "evm.bytecode"],
                    }
                },
            },
        },
        solc_version=SOLC_VERSION,
    )

    contract_interface = compiled["contracts"][contract_file][contract_name]
    abi = contract_interface["abi"]
    bytecode = contract_interface["evm"]["bytecode"]["object"]

    if not bytecode:
        raise RuntimeError(f"No bytecode produced for {contract_name}")

    return abi, bytecode


def save_optimized_artifacts(
    *,
    contract_name: str,
    abi: list[dict[str, Any]],
    bytecode: str,
    address: str | None = None,
) -> None:
    BUILD_DIR.mkdir(exist_ok=True)

    (BUILD_DIR / f"{contract_name}.abi.json").write_text(json.dumps(abi, indent=2))
    (BUILD_DIR / f"{contract_name}.bytecode.txt").write_text(bytecode)

    if address is not None:
        (BUILD_DIR / f"{contract_name}.address.txt").write_text(
            Web3.to_checksum_address(address)
        )


def block_safe_gas_limit(
    *,
    estimated_gas: int,
    block_gas_limit: int,
    multiplier: float = 1.10,
    block_margin: int = 10_000,
) -> int:
    if estimated_gas + block_margin >= block_gas_limit:
        raise RuntimeError(
            "Deployment estimate is too close to or above the latest block gas limit.\n"
            f"Estimated gas: {estimated_gas}\n"
            f"Block gas limit: {block_gas_limit}\n"
            "The contract must be reduced further or the chain block gas limit increased."
        )

    buffered = int(estimated_gas * multiplier)
    max_allowed = block_gas_limit - block_margin

    return min(buffered, max_allowed)


def send_fee_bumped_tx(
    *,
    w3: Web3,
    function_call: Any,
    wallet: Wallet,
    gas: int,
    label: str,
    priority_fee_gwei: int = 2,
):
    sender_address = Web3.to_checksum_address(wallet.address)
    latest_nonce = w3.eth.get_transaction_count(sender_address, "latest")
    pending_nonce = w3.eth.get_transaction_count(sender_address, "pending")

    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", w3.to_wei(1, "gwei"))
    priority_fee = w3.to_wei(priority_fee_gwei, "gwei")
    max_fee = base_fee * 3 + priority_fee

    if pending_nonce > latest_nonce:
        print("\nPending transaction detected for this sender.")
        print("Replacing nonce:", latest_nonce)
        print("Pending nonce:", pending_nonce)

    tx = function_call.build_transaction(
        {
            "chainId": w3.eth.chain_id,
            "from": sender_address,
            "nonce": latest_nonce,
            "gas": gas,
            "type": 2,
            "maxFeePerGas": max_fee,
            "maxPriorityFeePerGas": priority_fee,
        }
    )

    print(f"\nSending transaction: {label}")
    print("  from:", sender_address)
    print("  nonce:", latest_nonce)
    print("  gas limit:", gas)
    print("  max fee per gas:", max_fee)
    print("  max priority fee per gas:", priority_fee)

    signed_tx = w3.eth.account.sign_transaction(tx, wallet.private_key)
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


def send_estimated_tx(
    *,
    w3: Web3,
    function_call: Any,
    wallet: Wallet,
    label: str,
    minimum_gas: int = 0,
):
    estimated_gas = function_call.estimate_gas({"from": wallet.address})
    gas_limit = max(minimum_gas, int(estimated_gas * 1.25))

    print(f"\nEstimated gas for {label}: {estimated_gas}")
    print(f"Using gas limit for {label}: {gas_limit}")

    return send_contract_tx(
        w3=w3,
        function_call=function_call,
        sender_address=wallet.address,
        private_key=wallet.private_key,
        gas=gas_limit,
        label=label,
    )
