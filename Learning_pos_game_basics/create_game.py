import json
import os
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3

PROJECT_ROOT = Path(__file__).resolve().parents[1]

NODE_URL = "http://127.0.0.1:8549"
EXPECTED_CHAIN_ID = 70207

ABI_PATH = PROJECT_ROOT / "build" / "GameLobby.abi.json"
ADDRESS_PATH = PROJECT_ROOT / "build" / "GameLobby.address.txt"
ENV_PATH = PROJECT_ROOT / ".env"


def main():
    load_dotenv(ENV_PATH)

    private_key = os.getenv("PRIVATE_KEY")
    funding_address = os.getenv("FUNDING_ADDRESS")

    if not private_key or not funding_address:
        raise RuntimeError("Missing PRIVATE_KEY or FUNDING_ADDRESS in .env")

    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))

    print("=== Create a game ===")
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

    before_next_id = lobby.functions.nextGameId().call()

    print("GameLobby address:", contract_address)
    print("Creator:", funding_address)
    print("nextGameId before:", before_next_id)

    nonce = w3.eth.get_transaction_count(funding_address)
    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", w3.to_wei(1, "gwei"))

    priority_fee = w3.to_wei(1, "gwei")
    max_fee = base_fee * 2 + priority_fee

    tx = lobby.functions.createGame().build_transaction(
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

    confirm = input("\nSend createGame() transaction? Type YES to continue: ")
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
        raise RuntimeError("createGame() failed.")

    after_next_id = lobby.functions.nextGameId().call()
    created_game_id = before_next_id

    game = lobby.functions.getGame(created_game_id).call()

    print("\nGame created:")
    print("  gameId:", created_game_id)
    print("  player1:", game[0])
    print("  player2:", game[1])
    print("  phase:", game[2], "(0 = WaitingForPlayer, 1 = Ready)")
    print("  nextGameId after:", after_next_id)

    events = lobby.events.GameCreated().process_receipt(receipt)

    print("\nEvents emitted:")
    for event in events:
        print("  Event:", event["event"])
        print("  gameId:", event["args"]["gameId"])
        print("  player1:", event["args"]["player1"])

    print("\nSUCCESS: You created your first on-chain game lobby.")


if __name__ == "__main__":
    main()