import argparse

from battleship.deploy_and_testing.utils.contract import (
    load_battleship_contract,
    send_estimated_tx,
)
from rps_backend.utils.chain import connect_web3
from rps_backend.utils.wallets import load_wallet


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_id", type=int, help="Game ID to join")
    parser.add_argument(
        "--wallet",
        choices=["player1", "player2"],
        default="player2",
        help="Local wallet role used to join the game",
    )
    args = parser.parse_args()

    print("=== Join Battleship game ===")

    w3 = connect_web3()
    wallet = load_wallet(args.wallet)
    contract = load_battleship_contract(w3)

    print("Contract:", contract.address)
    print("Game ID:", args.game_id)
    print("Joining as:", args.wallet)
    print("Joiner address:", wallet.address)

    receipt = send_estimated_tx(
        w3=w3,
        function_call=contract.functions.joinGame(args.game_id),
        wallet=wallet,
        label="joinGame",
    )

    events = contract.events.GameJoined().process_receipt(receipt)

    if not events:
        raise RuntimeError("GameJoined event not found in receipt.")

    event = events[0]["args"]

    print("\nGame joined.")
    print("  gameId:", event["gameId"])
    print("  player2:", event["player2"])


if __name__ == "__main__":
    main()
