from rps_backend.utils.chain import connect_web3, get_balance_eth
from rps_backend.utils.wallets import load_wallet

from rps_backend.utils.chain import connect_web3
from rps_backend.utils.commit import (
    generate_salt,
    make_commitment,
    move_name,
    normalize_move,
    save_reveal_secret,
    load_reveal_secret,
    delete_reveal_secret,
)
from rps_backend.utils.wallets import load_wallet


def main() -> None:
    print("=== RPS backend setup check ===")

    w3 = connect_web3()
    print("Connected: True")
    print("Chain ID:", w3.eth.chain_id)
    print("Latest block:", w3.eth.block_number)

    for role in ("player1", "player2"):
        wallet = load_wallet(role)
        balance = get_balance_eth(w3, wallet.address)

        print(f"\n{role}:")
        print("  address:", wallet.address)
        print("  balance:", balance, "UZHETHs")

    print("\nSUCCESS: backend utilities can connect to chain and load wallets.")

    print("=== RPS utility check ===")

    w3 = connect_web3()
    player1 = load_wallet("player1")

    dummy_contract_address = player1.address
    dummy_game_id = 123
    move = "rock"

    salt = generate_salt()
    commitment = make_commitment(
        contract_address=dummy_contract_address,
        move=move,
        salt=salt,
        player_address=player1.address,
        game_id=dummy_game_id,
    )

    print("Connected chain:", w3.eth.chain_id)
    print("Player:", player1.address)
    print("Move:", move, "->", normalize_move(move), "->", move_name(normalize_move(move)))
    print("Salt:", salt)
    print("Commitment:", commitment.hex())

    path = save_reveal_secret(
        game_id=dummy_game_id,
        player_address=player1.address,
        move=move,
        salt=salt,
        commitment=commitment.hex(),
    )

    loaded = load_reveal_secret(
        game_id=dummy_game_id,
        player_address=player1.address,
    )

    print("\nSaved local secret:", path)
    print("Loaded move:", loaded["move_name"])
    print("Loaded salt matches:", loaded["salt"] == salt)
    print("Loaded commitment matches:", loaded["commitment"] == commitment.hex())

    delete_reveal_secret(
        game_id=dummy_game_id,
        player_address=player1.address,
    )

    print("\nSUCCESS: contract and commit utilities are ready.")


if __name__ == "__main__":
    main()