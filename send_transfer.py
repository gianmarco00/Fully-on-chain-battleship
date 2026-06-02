import os
from decimal import Decimal

from dotenv import load_dotenv
from web3 import Web3

NODE_URL = "http://127.0.0.1:8549"
EXPECTED_CHAIN_ID = 70207

# Tiny test transfer. If recipient is yourself, only gas is really spent.
AMOUNT_UZHETHS = Decimal("2")


def main():
    load_dotenv()

    private_key = os.getenv("PRIVATE_KEY")
    funding_address = os.getenv("FUNDING_ADDRESS")
    recipient_address = os.getenv("RECIPIENT_ADDRESS")

    if not private_key or not funding_address or not recipient_address:
        raise RuntimeError(
            "Missing PRIVATE_KEY, FUNDING_ADDRESS, or RECIPIENT_ADDRESS in .env"
        )

    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))

    print("=== UZHETH PoS simple transfer ===")
    print("Connected:", w3.is_connected())

    if not w3.is_connected():
        raise RuntimeError("Could not connect to local node.")

    chain_id = w3.eth.chain_id
    print("Chain ID:", chain_id)

    if chain_id != EXPECTED_CHAIN_ID:
        raise RuntimeError(f"Wrong chain ID: expected {EXPECTED_CHAIN_ID}, got {chain_id}")

    funding_address = Web3.to_checksum_address(funding_address)
    recipient_address = Web3.to_checksum_address(recipient_address)

    account = w3.eth.account.from_key(private_key)

    if account.address.lower() != funding_address.lower():
        raise RuntimeError(
            "The PRIVATE_KEY does not match FUNDING_ADDRESS. "
            f"Private key address: {account.address}, funding address: {funding_address}"
        )

    balance_before = w3.eth.get_balance(funding_address)
    print("Sender:", funding_address)
    print("Recipient:", recipient_address)
    print("Balance before:", w3.from_wei(balance_before, "ether"), "UZHETHs")

    value_wei = w3.to_wei(AMOUNT_UZHETHS, "ether")
    nonce = w3.eth.get_transaction_count(funding_address)

    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", w3.to_wei(1, "gwei"))

    priority_fee = w3.to_wei(1, "gwei")
    max_fee = base_fee * 2 + priority_fee

    transaction = {
        "chainId": chain_id,
        "type": 2,
        "nonce": nonce,
        "to": recipient_address,
        "value": value_wei,
        "gas": 21000,
        "maxFeePerGas": max_fee,
        "maxPriorityFeePerGas": priority_fee,
    }

    print("\nPrepared transaction:")
    print("  nonce:", nonce)
    print("  value:", AMOUNT_UZHETHS, "UZHETHs")
    print("  gas:", transaction["gas"])
    print("  maxFeePerGas:", max_fee)
    print("  maxPriorityFeePerGas:", priority_fee)

    confirm = input("\nSend this transaction? Type YES to continue: ")
    if confirm != "YES":
        print("Cancelled.")
        return

    signed_tx = w3.eth.account.sign_transaction(transaction, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)

    print("\nTransaction sent.")
    print("Tx hash:", tx_hash.hex())
    print("Waiting for receipt...")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

    print("\nReceipt:")
    print("  status:", receipt["status"])
    print("  blockNumber:", receipt["blockNumber"])
    print("  gasUsed:", receipt["gasUsed"])

    balance_after = w3.eth.get_balance(funding_address)
    print("\nBalance after:", w3.from_wei(balance_after, "ether"), "UZHETHs")

    if receipt["status"] == 1:
        print("\nSUCCESS: Transaction was included successfully.")
    else:
        print("\nWARNING: Transaction was included but failed.")


if __name__ == "__main__":
    main()