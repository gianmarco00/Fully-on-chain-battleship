import argparse
import time

from web3.exceptions import ContractLogicError

from rps_backend.utils.chain import connect_web3, send_contract_tx
from rps_backend.utils.commit import (
    delete_reveal_secret,
    generate_salt,
    load_reveal_secret,
    make_commitment,
    move_name,
    normalize_move,
    save_reveal_secret,
)
from rps_backend.utils.config import DEFAULT_GAS_LIMIT, RPS_CONTRACT_NAME
from rps_backend.utils.contract import load_contract
from rps_backend.utils.game_state import (
    PHASE_COMMIT,
    PHASE_REVEAL,
    fetch_game_state,
)
from rps_backend.utils.wallets import load_wallet


POLL_SECONDS = 3


def commit_if_needed(contract, w3, wallet, game_id: int, move_int: int) -> None:
    state = fetch_game_state(contract, game_id)

    if state.has_committed(wallet.address):
        print("Already committed. Skipping commit step.")
        return

    if state.phase != PHASE_COMMIT:
        raise RuntimeError(f"Cannot commit. Game phase is {state.phase_name}.")

    salt = generate_salt()
    commitment = make_commitment(
        contract_address=contract.address,
        move=move_int,
        salt=salt,
        player_address=wallet.address,
        game_id=game_id,
    )

    function_call = contract.functions.commitMove(game_id, commitment)

    print("\nSimulating commitMove...")
    try:
        function_call.call({"from": wallet.address})
    except ContractLogicError as exc:
        raise RuntimeError(f"commitMove would revert: {exc}") from exc

    secret_path = save_reveal_secret(
        game_id=game_id,
        player_address=wallet.address,
        move=move_int,
        salt=salt,
        commitment=commitment.hex(),
    )

    print("Saved reveal secret:", secret_path)

    send_contract_tx(
        w3=w3,
        function_call=function_call,
        sender_address=wallet.address,
        private_key=wallet.private_key,
        gas=DEFAULT_GAS_LIMIT,
        label="commitMove",
    )

    print("Commit sent. Move remains hidden.")


def reveal_if_safe(contract, w3, wallet, game_id: int) -> bool:
    state = fetch_game_state(contract, game_id)

    if state.phase != PHASE_REVEAL:
        return False

    if state.has_revealed(wallet.address):
        print("Already revealed.")
        return True

    if not state.both_committed:
        return False

    secret = load_reveal_secret(game_id=game_id, player_address=wallet.address)

    move_int = int(secret["move"])
    salt = secret["salt"]

    function_call = contract.functions.revealMove(game_id, move_int, salt)

    print("\nBoth commitments found. Revealing automatically...")
    print("Move:", move_int, f"({move_name(move_int)})")

    try:
        function_call.call({"from": wallet.address})
    except ContractLogicError as exc:
        raise RuntimeError(f"revealMove would revert: {exc}") from exc

    send_contract_tx(
        w3=w3,
        function_call=function_call,
        sender_address=wallet.address,
        private_key=wallet.private_key,
        gas=DEFAULT_GAS_LIMIT,
        label="revealMove",
    )

    print("Reveal sent.")
    return True

def claim_timeout_if_possible(contract, w3, wallet, game_id: int) -> bool:
    state = fetch_game_state(contract, game_id)

    if state.phase not in {PHASE_COMMIT, PHASE_REVEAL}:
        return False

    deadline = state.commit_deadline if state.phase == PHASE_COMMIT else state.reveal_deadline

    if deadline == 0:
        return False

    latest_timestamp = w3.eth.get_block("latest")["timestamp"]

    if latest_timestamp <= deadline:
        return False

    function_call = contract.functions.claimTimeout(game_id)

    print("\nDeadline passed. Trying to claim timeout...")

    try:
        function_call.call({"from": wallet.address})
    except ContractLogicError as exc:
        print("Timeout claim not available:", exc)
        return False

    send_contract_tx(
        w3=w3,
        function_call=function_call,
        sender_address=wallet.address,
        private_key=wallet.private_key,
        gas=DEFAULT_GAS_LIMIT,
        label="claimTimeout",
    )

    print("Timeout claim sent.")
    return True

def watch_until_done(contract, w3, wallet, game_id: int) -> None:
    print("\nWatching game state. Press Ctrl-C to stop.")

    while True:
        state = fetch_game_state(contract, game_id)

        print(
            f"phase={state.phase_name} "
            f"committed={state.has_committed(wallet.address)} "
            f"revealed={state.has_revealed(wallet.address)}"
        )

        if state.is_finished:
            delete_reveal_secret(
                game_id=game_id,
                player_address=wallet.address,
            )

            print("\nGame ended.")
            print("Winner:", state.winner)
            print("Local reveal secret cleaned up.")
            return

        reveal_if_safe(contract, w3, wallet, game_id)
        claim_timeout_if_possible(contract, w3, wallet, game_id)

        time.sleep(POLL_SECONDS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_id", type=int, help="Game ID")
    parser.add_argument("move", help="rock, paper, or scissors")
    parser.add_argument(
        "--wallet",
        choices=["player1", "player2"],
        required=True,
        help="Local wallet role making the move",
    )
    args = parser.parse_args()

    move_int = normalize_move(args.move)

    print("=== RPS one-button move ===")
    print("Move:", move_int, f"({move_name(move_int)})")

    w3 = connect_web3()
    wallet = load_wallet(args.wallet)
    contract = load_contract(w3, RPS_CONTRACT_NAME)

    print("Contract:", contract.address)
    print("Game ID:", args.game_id)
    print("Wallet:", args.wallet)
    print("Player:", wallet.address)

    commit_if_needed(contract, w3, wallet, args.game_id, move_int)
    watch_until_done(contract, w3, wallet, args.game_id)


if __name__ == "__main__":
    main()