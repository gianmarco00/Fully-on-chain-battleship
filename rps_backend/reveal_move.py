import argparse

from web3.exceptions import ContractLogicError
from web3.logs import DISCARD

from rps_backend.utils.chain import connect_web3, send_contract_tx
from rps_backend.utils.commit import (
    delete_reveal_secret,
    load_reveal_secret,
    move_name,
)
from rps_backend.utils.config import DEFAULT_GAS_LIMIT, RPS_CONTRACT_NAME
from rps_backend.utils.contract import load_contract
from rps_backend.utils.wallets import load_wallet


PHASE_FINISHED = 3
PHASE_CANCELLED = 4


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_id", type=int, help="Game ID")
    parser.add_argument(
        "--wallet",
        choices=["player1", "player2"],
        required=True,
        help="Local wallet role revealing the move",
    )
    args = parser.parse_args()

    print("=== Reveal RPS move ===")

    w3 = connect_web3()
    wallet = load_wallet(args.wallet)
    contract = load_contract(w3, RPS_CONTRACT_NAME)

    secret = load_reveal_secret(
        game_id=args.game_id,
        player_address=wallet.address,
    )

    move = int(secret["move"])
    salt = secret["salt"]

    print("Contract:", contract.address)
    print("Game ID:", args.game_id)
    print("Wallet:", args.wallet)
    print("Player:", wallet.address)
    print("Revealing move:", move, f"({move_name(move)})")

    function_call = contract.functions.revealMove(args.game_id, move, salt)

    print("\nSimulating revealMove before sending transaction...")

    try:
        function_call.call({"from": wallet.address})
    except ContractLogicError as exc:
        raise RuntimeError(f"revealMove would revert: {exc}") from exc

    print("Simulation succeeded.")

    receipt = send_contract_tx(
        w3=w3,
        function_call=function_call,
        sender_address=wallet.address,
        private_key=wallet.private_key,
        gas=DEFAULT_GAS_LIMIT,
        label="revealMove",
    )

    move_events = contract.events.MoveRevealed().process_receipt(
        receipt,
        errors=DISCARD,
    )

    if not move_events:
        raise RuntimeError("MoveRevealed event not found in receipt.")

    move_event = move_events[0]["args"]

    print("\nMove revealed.")
    print("  gameId:", move_event["gameId"])
    print("  player:", move_event["player"])
    print("  move:", int(move_event["move"]), f"({move_name(int(move_event['move']))})")

    finish_events = contract.events.GameFinished().process_receipt(
        receipt,
        errors=DISCARD,
    )

    if finish_events:
        finish_event = finish_events[0]["args"]
        print("\nGameFinished event:")
        print("  gameId:", finish_event["gameId"])
        print("  winner:", finish_event["winner"])
        print("  draw:", finish_event["draw"])

    game = contract.functions.getGame(args.game_id).call()
    _player1, _player2, winner, phase, _commit_deadline, _reveal_deadline = game

    if phase in {PHASE_FINISHED, PHASE_CANCELLED}:
        delete_reveal_secret(
            game_id=args.game_id,
            player_address=wallet.address,
        )
        print("\nLocal reveal secret deleted because the game is finished/cancelled.")
    else:
        print("\nLocal reveal secret kept because the game is not finished yet.")

    if phase == PHASE_FINISHED:
        print("\nGame is finished.")
        print("  winner:", winner)


if __name__ == "__main__":
    main()