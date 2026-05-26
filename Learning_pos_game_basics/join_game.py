import json
import os
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3

NODE_URL = "http://127.0.0.1:8549"
EXPECTED_CHAIN_ID = 70207

GAME_ID = 1

PROJECT_ROOT = Path(__file__).resolve().parents[1]

ABI_PATH = PROJECT_ROOT / "build" / "GameLobby.abi.json"
ADDRESS_PATH = PROJECT_ROOT / "build" / "GameLobby.address.txt"
ENV_PATH = PROJECT_ROOT / ".env"


def main():
    load_dotenv(ENV_PATH)

    player2_private_key = os.getenv("PLAYER2_PRIVATE_KEY")
    player2_address = os.getenv("PLAYER2_ADDRESS")

    if not player2_private_key or not player2_address:
        raise RuntimeError("Missing PLAYER2_PRIVATE_KEY or PLAYER2_ADDRESS in .env")

    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))

    print("=== Join game as Player 2 ===")
    print("Connected:", w3.is_connected())

    if not w3.is_connected():
        raise RuntimeError("Could not connect to local node.")

    chain_id = w3.eth.chain_id
    print("Chain ID:", chain_id)

    if chain_id != EXPECTED_CHAIN_ID:
        raise RuntimeError(f"Wrong chain ID: expected {EXPECTED_CHAIN_ID}, got {chain_id}")

    player2_address = Web3.to_checksum_address(player2_address)
    account = w3.eth.account.from_key(player2_private_key)

    if account.address.lower() != player2_address.lower():
        raise RuntimeError(
            "PLAYER2_PRIVATE_KEY does not match PLAYER2_ADDRESS. "
            f"Private key address: {account.address}, PLAYER2_ADDRESS: {player2_address}"
        )

    balance = w3.eth.get_balance(player2_address)
    print("Player 2 address:", player2_address)
    print("Player 2 balance:", w3.from_wei(balance, "ether"), "UZHETHs")

    abi = json.loads(ABI_PATH.read_text())
    contract_address = Web3.to_checksum_address(ADDRESS_PATH.read_text().strip())
    lobby = w3.eth.contract(address=contract_address, abi=abi)

    game_before = lobby.functions.getGame(GAME_ID).call()

    print("\nGame before:")
    print("  gameId:", GAME_ID)
    print("  player1:", game_before[0])
    print("  player2:", game_before[1])
    print("  phase:", game_before[2], "(0 = WaitingForPlayer, 1 = Ready)")

    print("\nSimulating joinGame()...")
    lobby.functions.joinGame(GAME_ID).call({"from": player2_address})
    print("Simulation succeeded.")

    nonce = w3.eth.get_transaction_count(player2_address)
    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", w3.to_wei(1, "gwei"))

    priority_fee = w3.to_wei(1, "gwei")
    max_fee = base_fee * 2 + priority_fee

    tx = lobby.functions.joinGame(GAME_ID).build_transaction(
        {
            "chainId": chain_id,
            "from": player2_address,
            "nonce": nonce,
            "gas": 200_000,
            "maxFeePerGas": max_fee,
            "maxPriorityFeePerGas": priority_fee,
            "type": 2,
        }
    )

    confirm = input("\nSend joinGame() transaction as Player 2? Type YES to continue: ")
    if confirm != "YES":
        print("Cancelled.")
        return

    signed_tx = w3.eth.account.sign_transaction(tx, player2_private_key)
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
        raise RuntimeError("joinGame() failed.")

    game_after = lobby.functions.getGame(GAME_ID).call()

    print("\nGame after:")
    print("  gameId:", GAME_ID)
    print("  player1:", game_after[0])
    print("  player2:", game_after[1])
    print("  phase:", game_after[2], "(0 = WaitingForPlayer, 1 = Ready)")

    events = lobby.events.GameJoined().process_receipt(receipt)

    print("\nEvents emitted:")
    for event in events:
        print("  Event:", event["event"])
        print("  gameId:", event["args"]["gameId"])
        print("  player2:", event["args"]["player2"])

    if game_after[1].lower() == player2_address.lower() and game_after[2] == 1:
        print("\nSUCCESS: Player 2 joined the game. The game is now Ready.")
    else:
        print("\nWARNING: Unexpected final game state.")


if __name__ == "__main__":
    main()