import json
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv
from web3 import Web3

PROJECT_ROOT = Path(__file__).resolve().parents[1]

NODE_URL = "http://127.0.0.1:8549"
EXPECTED_CHAIN_ID = 70207

ABI_PATH = PROJECT_ROOT / "build" / "CommitRevealRPS.abi.json"
ADDRESS_PATH = PROJECT_ROOT / "build" / "CommitRevealRPS.address.txt"
ENV_PATH = PROJECT_ROOT / ".env"

MOVE_NAMES = {
    0: "Rock",
    1: "Paper",
    2: "Scissors",
}

PHASE_NAMES = {
    0: "WaitingForPlayer",
    1: "Commit",
    2: "Reveal",
    3: "Finished",
}


def connect():
    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))
    if not w3.is_connected():
        raise RuntimeError("Could not connect to local node.")
    if w3.eth.chain_id != EXPECTED_CHAIN_ID:
        raise RuntimeError(f"Wrong chain ID: {w3.eth.chain_id}")
    return w3


def load_contract(w3):
    abi = json.loads(ABI_PATH.read_text())
    address = Web3.to_checksum_address(ADDRESS_PATH.read_text().strip())
    return w3.eth.contract(address=address, abi=abi)


def fee_params(w3):
    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", w3.to_wei(1, "gwei"))
    priority_fee = w3.to_wei(1, "gwei")
    max_fee = base_fee * 2 + priority_fee
    return max_fee, priority_fee


def send_tx(w3, function_call, sender_address, private_key, gas):
    sender_address = Web3.to_checksum_address(sender_address)
    nonce = w3.eth.get_transaction_count(sender_address)
    max_fee, priority_fee = fee_params(w3)

    tx = function_call.build_transaction(
        {
            "chainId": w3.eth.chain_id,
            "from": sender_address,
            "nonce": nonce,
            "gas": gas,
            "maxFeePerGas": max_fee,
            "maxPriorityFeePerGas": priority_fee,
            "type": 2,
        }
    )

    signed = w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)

    if receipt["status"] != 1:
        raise RuntimeError(f"Transaction failed: {tx_hash.hex()}")

    return tx_hash.hex(), receipt


def print_game(contract, game_id):
    player1, player2, phase, winner = contract.functions.getGame(game_id).call()
    commitment1, commitment2 = contract.functions.getCommitments(game_id).call()
    revealed1, revealed2, move1, move2 = contract.functions.getReveals(game_id).call()

    print(f"\nGame {game_id} state:")
    print("  player1:", player1)
    print("  player2:", player2)
    print("  phase:", phase, f"({PHASE_NAMES[phase]})")
    print("  commitment1:", commitment1.hex())
    print("  commitment2:", commitment2.hex())
    print("  revealed1:", revealed1)
    print("  revealed2:", revealed2)

    if revealed1:
        print("  move1:", move1, f"({MOVE_NAMES[move1]})")
    else:
        print("  move1: hidden")

    if revealed2:
        print("  move2:", move2, f"({MOVE_NAMES[move2]})")
    else:
        print("  move2: hidden")

    print("  winner:", winner)


def make_python_commitment(w3, contract_address, move, salt, player, game_id):
    return Web3.solidity_keccak(
        ["uint8", "bytes32", "address", "uint256", "address"],
        [
            move,
            salt,
            Web3.to_checksum_address(player),
            game_id,
            Web3.to_checksum_address(contract_address),
        ],
    )


def main():
    load_dotenv(ENV_PATH)

    player1_key = os.getenv("PRIVATE_KEY")
    player1_address = os.getenv("FUNDING_ADDRESS")
    player2_key = os.getenv("PLAYER2_PRIVATE_KEY")
    player2_address = os.getenv("PLAYER2_ADDRESS")

    if not player1_key or not player1_address:
        raise RuntimeError("Missing PRIVATE_KEY or FUNDING_ADDRESS in .env")
    if not player2_key or not player2_address:
        raise RuntimeError("Missing PLAYER2_PRIVATE_KEY or PLAYER2_ADDRESS in .env")

    w3 = connect()
    contract = load_contract(w3)

    player1_address = Web3.to_checksum_address(player1_address)
    player2_address = Web3.to_checksum_address(player2_address)

    if w3.eth.account.from_key(player1_key).address.lower() != player1_address.lower():
        raise RuntimeError("PRIVATE_KEY does not match FUNDING_ADDRESS")
    if w3.eth.account.from_key(player2_key).address.lower() != player2_address.lower():
        raise RuntimeError("PLAYER2_PRIVATE_KEY does not match PLAYER2_ADDRESS")

    print("=== Commit-Reveal Rock Paper Scissors Demo ===")
    print("Contract:", contract.address)
    print("Player 1:", player1_address)
    print("Player 2:", player2_address)

    print("\nMove encoding:")
    print("  0 = Rock")
    print("  1 = Paper")
    print("  2 = Scissors")

    # For this first demo, choose fixed moves so the result is predictable.
    # Player 1 = Rock, Player 2 = Paper, so Player 2 should win.
    player1_move = 0
    player2_move = 1

    # A salt is secret random data kept off-chain until reveal.
    player1_salt = "0x" + secrets.token_hex(32)
    player2_salt = "0x" + secrets.token_hex(32)

    print("\nSecret local choices:")
    print("  Player 1 move:", MOVE_NAMES[player1_move])
    print("  Player 1 salt:", player1_salt)
    print("  Player 2 move:", MOVE_NAMES[player2_move])
    print("  Player 2 salt:", player2_salt)

    confirm = input("\nRun full commit-reveal demo? Type YES to continue: ")
    if confirm != "YES":
        print("Cancelled.")
        return

    # 1. Create game.
    before_next_id = contract.functions.nextGameId().call()
    tx_hash, receipt = send_tx(
        w3,
        contract.functions.createGame(),
        player1_address,
        player1_key,
        gas=250_000,
    )
    game_id = before_next_id

    print("\n1. Game created")
    print("  gameId:", game_id)
    print("  tx:", tx_hash)
    print_game(contract, game_id)

    # 2. Join game.
    tx_hash, receipt = send_tx(
        w3,
        contract.functions.joinGame(game_id),
        player2_address,
        player2_key,
        gas=250_000,
    )

    print("\n2. Player 2 joined")
    print("  tx:", tx_hash)
    print_game(contract, game_id)

    # 3. Compute commitments off-chain.
    commitment1 = make_python_commitment(
        w3,
        contract.address,
        player1_move,
        player1_salt,
        player1_address,
        game_id,
    )
    commitment2 = make_python_commitment(
        w3,
        contract.address,
        player2_move,
        player2_salt,
        player2_address,
        game_id,
    )

    # Sanity check: compare Python hash with Solidity hash.
    solidity_commitment1 = contract.functions.makeCommitment(
        player1_move,
        player1_salt,
        player1_address,
        game_id,
    ).call()

    solidity_commitment2 = contract.functions.makeCommitment(
        player2_move,
        player2_salt,
        player2_address,
        game_id,
    ).call()

    assert commitment1 == solidity_commitment1
    assert commitment2 == solidity_commitment2

    print("\n3. Commitments computed off-chain")
    print("  Player 1 commitment:", commitment1.hex())
    print("  Player 2 commitment:", commitment2.hex())
    print("  Notice: moves and salts are not sent yet.")

    # 4. Commit moves.
    tx_hash, receipt = send_tx(
        w3,
        contract.functions.commitMove(game_id, commitment1),
        player1_address,
        player1_key,
        gas=250_000,
    )

    print("\n4a. Player 1 committed")
    print("  tx:", tx_hash)
    print_game(contract, game_id)

    tx_hash, receipt = send_tx(
        w3,
        contract.functions.commitMove(game_id, commitment2),
        player2_address,
        player2_key,
        gas=250_000,
    )

    print("\n4b. Player 2 committed")
    print("  tx:", tx_hash)
    print("  Both players committed, so the phase should now be Reveal.")
    print_game(contract, game_id)

    # 5. Reveal moves.
    tx_hash, receipt = send_tx(
        w3,
        contract.functions.revealMove(game_id, player1_move, player1_salt),
        player1_address,
        player1_key,
        gas=250_000,
    )

    print("\n5a. Player 1 revealed")
    print("  tx:", tx_hash)
    print_game(contract, game_id)

    tx_hash, receipt = send_tx(
        w3,
        contract.functions.revealMove(game_id, player2_move, player2_salt),
        player2_address,
        player2_key,
        gas=250_000,
    )

    print("\n5b. Player 2 revealed")
    print("  tx:", tx_hash)
    print("  Both players revealed, so the game should now be Finished.")
    print_game(contract, game_id)

    # 6. Read final result.
    player1, player2, phase, winner = contract.functions.getGame(game_id).call()

    print("\nFinal result:")
    if winner == "0x0000000000000000000000000000000000000000":
        print("  Draw")
    elif winner.lower() == player1_address.lower():
        print("  Winner: Player 1")
    elif winner.lower() == player2_address.lower():
        print("  Winner: Player 2")
    else:
        print("  Unexpected winner:", winner)

    print("\nSUCCESS: Full commit-reveal round completed on-chain.")


if __name__ == "__main__":
    main()