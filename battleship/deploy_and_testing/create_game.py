from battleship.deploy_and_testing.utils.contract import (
    load_battleship_contract,
    send_estimated_tx,
)
from rps_backend.utils.chain import connect_web3
from rps_backend.utils.wallets import load_wallet


def main() -> None:
    print("=== Create Battleship game ===")

    w3 = connect_web3()
    wallet = load_wallet("player1")
    contract = load_battleship_contract(w3)

    next_game_id = contract.functions.nextGameId().call()

    print("Contract:", contract.address)
    print("Creator:", wallet.address)
    print("Next game ID:", next_game_id)

    receipt = send_estimated_tx(
        w3=w3,
        function_call=contract.functions.createGame(),
        wallet=wallet,
        label="createGame",
    )

    events = contract.events.GameCreated().process_receipt(receipt)

    if not events:
        raise RuntimeError("GameCreated event not found in receipt.")

    event = events[0]["args"]

    print("\nGame created.")
    print("  gameId:", event["gameId"])
    print("  player1:", event["player1"])


if __name__ == "__main__":
    main()
