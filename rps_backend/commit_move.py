import argparse

from rps_backend.utils.chain import connect_web3, send_contract_tx
from rps_backend.utils.commit import (
    generate_salt,
    make_commitment,
    move_name,
    normalize_move,
    save_reveal_secret,
)
from rps_backend.utils.config import DEFAULT_GAS_LIMIT, RPS_CONTRACT_NAME
from rps_backend.utils.contract import load_contract
from rps_backend.utils.wallets import load_wallet

from web3.exceptions import ContractLogicError


PHASE_COMMIT = 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_id", type=int, help="Game ID")
    parser.add_argument("move", help="rock, paper, or scissors")
    parser.add_argument(
        "--wallet",
        choices=["player1", "player2"],
        required=True,
        help="Local wallet role committing the move",
    )
    args = parser.parse_args()

    print("=== Commit RPS move ===")

    w3 = connect_web3()
    wallet = load_wallet(args.wallet)
    contract = load_contract(w3, RPS_CONTRACT_NAME)

    move_int = normalize_move(args.move)
    salt = generate_salt()

    game = contract.functions.getGame(args.game_id).call()
    player1, player2, _winner, phase, _commit_deadline, _reveal_deadline = game

    if phase != PHASE_COMMIT:
        raise RuntimeError(f"Game is not in Commit phase. Current phase: {phase}")

    if wallet.address.lower() not in {player1.lower(), player2.lower()}:
        raise RuntimeError("Selected wallet is not a player in this game.")

    commitment = make_commitment(
        contract_address=contract.address,
        move=move_int,
        salt=salt,
        player_address=wallet.address,
        game_id=args.game_id,
    )

    solidity_commitment = contract.functions.makeCommitment(
        move_int,
        salt,
        wallet.address,
        args.game_id,
    ).call()

    if commitment != solidity_commitment:
        raise RuntimeError("Python commitment does not match Solidity commitment.")

    print("Contract:", contract.address)
    print("Game ID:", args.game_id)
    print("Wallet:", args.wallet)
    print("Player:", wallet.address)
    print("Move:", move_int, f"({move_name(move_int)})")
    print("Commitment:", commitment.hex())

    function_call = contract.functions.commitMove(args.game_id, commitment)

    print("\nSimulating commitMove before sending transaction...")

    try:
        function_call.call({"from": wallet.address})
    except ContractLogicError as exc:
        raise RuntimeError(f"commitMove would revert: {exc}") from exc

    print("Simulation succeeded.")

    secret_path = save_reveal_secret(
        game_id=args.game_id,
        player_address=wallet.address,
        move=move_int,
        salt=salt,
        commitment=commitment.hex(),
    )

    print("\nSaved local reveal secret:")
    print(" ", secret_path)

    try:
        receipt = send_contract_tx(
            w3=w3,
            function_call=function_call,
            sender_address=wallet.address,
            private_key=wallet.private_key,
            gas=DEFAULT_GAS_LIMIT,
            label="commitMove",
        )
    except Exception:
        from rps_backend.utils.commit import delete_reveal_secret

        delete_reveal_secret(
            game_id=args.game_id,
            player_address=wallet.address,
        )
        raise

    events = contract.events.MoveCommitted().process_receipt(receipt)

    if not events:
        raise RuntimeError("MoveCommitted event not found in receipt.")

    event = events[0]["args"]

    print("\nMove committed.")
    print("  gameId:", event["gameId"])
    print("  player:", event["player"])
    print("\nThe move itself is still hidden on-chain.")


if __name__ == "__main__":
    main()