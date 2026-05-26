from rps_backend.utils.chain import connect_web3, send_contract_tx
from rps_backend.utils.config import DEFAULT_GAS_LIMIT, RPS_CONTRACT_NAME
from rps_backend.utils.contract import load_contract
from rps_backend.utils.wallets import load_wallet


def main() -> None:
    print("=== Create RPS game ===")

    w3 = connect_web3()
    wallet = load_wallet("player1")
    contract = load_contract(w3, RPS_CONTRACT_NAME)

    next_game_id = contract.functions.nextGameId().call()

    print("Contract:", contract.address)
    print("Creator:", wallet.address)
    print("Next game ID:", next_game_id)

    receipt = send_contract_tx(
        w3=w3,
        function_call=contract.functions.createGame(),
        sender_address=wallet.address,
        private_key=wallet.private_key,
        gas=DEFAULT_GAS_LIMIT,
        label="createGame",
    )

    events = contract.events.GameCreated().process_receipt(receipt)

    if not events:
        raise RuntimeError("GameCreated event not found in receipt.")

    game_id = events[0]["args"]["gameId"]
    player1 = events[0]["args"]["player1"]

    print("\nGame created.")
    print("  gameId:", game_id)
    print("  player1:", player1)


if __name__ == "__main__":
    main()