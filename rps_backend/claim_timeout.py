import argparse

from web3.exceptions import ContractLogicError
from web3.logs import DISCARD

from rps_backend.utils.chain import connect_web3, send_contract_tx
from rps_backend.utils.config import DEFAULT_GAS_LIMIT, RPS_CONTRACT_NAME
from rps_backend.utils.contract import load_contract
from rps_backend.utils.wallets import load_wallet


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_id", type=int, help="Game ID")
    parser.add_argument(
        "--wallet",
        choices=["player1", "player2"],
        required=True,
        help="Local wallet role claiming timeout",
    )
    args = parser.parse_args()

    print("=== Claim RPS timeout ===")

    w3 = connect_web3()
    wallet = load_wallet(args.wallet)
    contract = load_contract(w3, RPS_CONTRACT_NAME)

    print("Contract:", contract.address)
    print("Game ID:", args.game_id)
    print("Wallet:", args.wallet)
    print("Claimer:", wallet.address)

    function_call = contract.functions.claimTimeout(args.game_id)

    print("\nSimulating claimTimeout before sending transaction...")

    try:
        function_call.call({"from": wallet.address})
    except ContractLogicError as exc:
        raise RuntimeError(f"claimTimeout would revert: {exc}") from exc

    print("Simulation succeeded.")

    receipt = send_contract_tx(
        w3=w3,
        function_call=function_call,
        sender_address=wallet.address,
        private_key=wallet.private_key,
        gas=DEFAULT_GAS_LIMIT,
        label="claimTimeout",
    )

    timeout_events = contract.events.TimeoutClaimed().process_receipt(
        receipt,
        errors=DISCARD,
    )

    finish_events = contract.events.GameFinished().process_receipt(
        receipt,
        errors=DISCARD,
    )

    cancel_events = contract.events.GameCancelled().process_receipt(
        receipt,
        errors=DISCARD,
    )

    if timeout_events:
        event = timeout_events[0]["args"]
        print("\nTimeout claimed.")
        print("  gameId:", event["gameId"])
        print("  claimant:", event["claimant"])

    if finish_events:
        event = finish_events[0]["args"]
        print("\nGame finished by timeout.")
        print("  gameId:", event["gameId"])
        print("  winner:", event["winner"])
        print("  draw:", event["draw"])

    if cancel_events:
        event = cancel_events[0]["args"]
        print("\nGame cancelled by timeout.")
        print("  gameId:", event["gameId"])


if __name__ == "__main__":
    main()