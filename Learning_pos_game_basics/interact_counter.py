import json
import os
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3

NODE_URL = "http://127.0.0.1:8549"
EXPECTED_CHAIN_ID = 70207

PROJECT_ROOT = Path(__file__).resolve().parents[1]

ABI_PATH = PROJECT_ROOT / "build" / "Counter.abi.json"
ADDRESS_PATH = PROJECT_ROOT / "build" / "Counter.address.txt"
ENV_PATH = PROJECT_ROOT / ".env"


def main():
    load_dotenv(ENV_PATH)

    private_key = os.getenv("PRIVATE_KEY")
    funding_address = os.getenv("FUNDING_ADDRESS")

    if not private_key or not funding_address:
        raise RuntimeError("Missing PRIVATE_KEY or FUNDING_ADDRESS in .env")

    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))

    print("=== Interact with deployed Counter ===")
    print("Connected:", w3.is_connected())

    if not w3.is_connected():
        raise RuntimeError("Could not connect to local UZHETH PoS node.")

    chain_id = w3.eth.chain_id
    print("Chain ID:", chain_id)

    if chain_id != EXPECTED_CHAIN_ID:
        raise RuntimeError(f"Wrong chain ID: expected {EXPECTED_CHAIN_ID}, got {chain_id}")

    funding_address = Web3.to_checksum_address(funding_address)
    account = w3.eth.account.from_key(private_key)

    if account.address.lower() != funding_address.lower():
        raise RuntimeError(
            "PRIVATE_KEY does not match FUNDING_ADDRESS. "
            f"Private key address: {account.address}, funding address: {funding_address}"
        )

    abi = json.loads(ABI_PATH.read_text())
    contract_address = Web3.to_checksum_address(ADDRESS_PATH.read_text().strip())

    counter = w3.eth.contract(address=contract_address, abi=abi)

    print("Contract address:", contract_address)
    print("Caller address:", funding_address)

    # 1. Read-only call. No gas, no transaction.
    current_value = counter.functions.get().call()
    print("\nCurrent counter value:", current_value)

    # 2. Build a transaction to call count().
    nonce = w3.eth.get_transaction_count(funding_address)
    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", w3.to_wei(1, "gwei"))

    priority_fee = w3.to_wei(1, "gwei")
    max_fee = base_fee * 2 + priority_fee

    tx = counter.functions.count().build_transaction(
        {
            "chainId": chain_id,
            "from": funding_address,
            "nonce": nonce,
            "gas": 100_000,
            "maxFeePerGas": max_fee,
            "maxPriorityFeePerGas": priority_fee,
            "type": 2,
        }
    )

    print("\nPrepared transaction:")
    print("  function: count()")
    print("  nonce:", nonce)
    print("  gas limit:", tx["gas"])

    confirm = input("\nSend count() transaction? Type YES to continue: ")
    if confirm != "YES":
        print("Cancelled.")
        return

    signed_tx = w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)

    print("\nTransaction sent.")
    print("Tx hash:", tx_hash.hex())
    print("Waiting for receipt...")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)

    print("\nReceipt:")
    print("  status:", receipt["status"])
    print("  blockNumber:", receipt["blockNumber"])
    print("  gasUsed:", receipt["gasUsed"])

    if receipt["status"] != 1:
        raise RuntimeError("count() transaction failed.")

    # 3. Read again after the transaction.
    new_value = counter.functions.get().call()
    print("\nNew counter value:", new_value)

    if new_value == current_value + 1:
        print("\nSUCCESS: count() changed contract storage on-chain.")
    else:
        print("\nWARNING: Counter did not increase as expected.")

    # 4. Decode emitted events from the transaction receipt.
    events = counter.events.Counted().process_receipt(receipt)

    print("\nEvents emitted:")
    for event in events:
        print("  Event:", event["event"])
        print("  newValue:", event["args"]["newValue"])
        print("  caller:", event["args"]["caller"])


if __name__ == "__main__":
    main()