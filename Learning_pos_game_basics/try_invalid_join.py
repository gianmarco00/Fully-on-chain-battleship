import json
import os
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3
from web3.exceptions import ContractLogicError

NODE_URL = "http://127.0.0.1:8549"
EXPECTED_CHAIN_ID = 70207

GAME_ID = 0

ABI_PATH = Path("build/GameLobby.abi.json")
ADDRESS_PATH = Path("build/GameLobby.address.txt")


def main():
    load_dotenv()

    private_key = os.getenv("PRIVATE_KEY")
    funding_address = os.getenv("FUNDING_ADDRESS")

    if not private_key or not funding_address:
        raise RuntimeError("Missing PRIVATE_KEY or FUNDING_ADDRESS in .env")

    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))

    print("=== Invalid join test ===")
    print("Connected:", w3.is_connected())

    if not w3.is_connected():
        raise RuntimeError("Could not connect to local node.")

    chain_id = w3.eth.chain_id
    print("Chain ID:", chain_id)

    if chain_id != EXPECTED_CHAIN_ID:
        raise RuntimeError(f"Wrong chain ID: expected {EXPECTED_CHAIN_ID}, got {chain_id}")

    funding_address = Web3.to_checksum_address(funding_address)
    account = w3.eth.account.from_key(private_key)

    if account.address.lower() != funding_address.lower():
        raise RuntimeError("PRIVATE_KEY does not match FUNDING_ADDRESS")

    abi = json.loads(ABI_PATH.read_text())
    contract_address = Web3.to_checksum_address(ADDRESS_PATH.read_text().strip())
    lobby = w3.eth.contract(address=contract_address, abi=abi)

    game_before = lobby.functions.getGame(GAME_ID).call()

    print("\nGame before:")
    print("  gameId:", GAME_ID)
    print("  player1:", game_before[0])
    print("  player2:", game_before[1])
    print("  phase:", game_before[2], "(0 = WaitingForPlayer, 1 = Ready)")

    print("\nCaller trying to join:", funding_address)
    print("This should fail, because player1 cannot join their own game.")

    # First try a read-only simulation using .call().
    # This does not send a transaction. It asks: would this transaction succeed?
    try:
        lobby.functions.joinGame(GAME_ID).call({"from": funding_address})
        print("\nWARNING: Simulation unexpectedly succeeded.")
    except ContractLogicError as exc:
        print("\nGood: simulation reverted as expected.")
        print("Reason:", exc)

    confirm = input("\nSend the real invalid transaction anyway? Type YES to continue: ")
    if confirm != "YES":
        print("Cancelled before sending real invalid transaction.")
        return

    nonce = w3.eth.get_transaction_count(funding_address)
    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", w3.to_wei(1, "gwei"))

    priority_fee = w3.to_wei(1, "gwei")
    max_fee = base_fee * 2 + priority_fee

    tx = lobby.functions.joinGame(GAME_ID).build_transaction(
        {
            "chainId": chain_id,
            "from": funding_address,
            "nonce": nonce,
            "gas": 200_000,
            "maxFeePerGas": max_fee,
            "maxPriorityFeePerGas": priority_fee,
            "type": 2,
        }
    )

    signed_tx = w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)

    print("\nInvalid transaction sent.")
    print("Tx hash:", tx_hash.hex())
    print("Waiting for receipt...")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)

    print("\nReceipt:")
    print("  status:", receipt["status"])
    print("  blockNumber:", receipt["blockNumber"])
    print("  gasUsed:", receipt["gasUsed"])

    game_after = lobby.functions.getGame(GAME_ID).call()

    print("\nGame after:")
    print("  player1:", game_after[0])
    print("  player2:", game_after[1])
    print("  phase:", game_after[2], "(0 = WaitingForPlayer, 1 = Ready)")

    if receipt["status"] == 0 and game_after == game_before:
        print("\nSUCCESS: The contract rejected the invalid move and state did not change.")
    else:
        print("\nWARNING: Unexpected result. Check the contract state carefully.")


if __name__ == "__main__":
    main()