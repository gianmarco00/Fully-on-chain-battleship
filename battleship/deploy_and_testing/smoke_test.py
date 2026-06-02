from web3.logs import DISCARD

from battleship.deploy_and_testing.utils.board import (
    build_test_board,
    cell_label,
    has_ship,
    merkle_proof,
    short_hex,
)
from battleship.deploy_and_testing.utils.config import BATTLESHIP_GAS_LIMIT
from battleship.deploy_and_testing.utils.contract import (
    load_battleship_contract,
    require_contract_code,
    send_estimated_tx,
)
from rps_backend.utils.chain import connect_web3
from rps_backend.utils.wallets import load_wallet


PLAYER1_SHIPS = (0, 6, 12)
PLAYER2_SHIPS = (1, 7, 13)


def send(w3, contract, wallet, function_call, label: str):
    receipt = send_estimated_tx(
        w3=w3,
        function_call=function_call,
        wallet=wallet,
        label=label,
        minimum_gas=BATTLESHIP_GAS_LIMIT,
    )

    for event_type in (
        contract.events.GameCreated(),
        contract.events.GameJoined(),
        contract.events.BoardCommitted(),
        contract.events.CellAttacked(),
        contract.events.CellRevealed(),
        contract.events.AuditStarted(),
        contract.events.BoardAudited(),
        contract.events.GameFinished(),
    ):
        for event in event_type.process_receipt(receipt, errors=DISCARD):
            print("  event:", event["event"], dict(event["args"]))

    return receipt


def attack_and_reveal(
    *,
    w3,
    contract,
    attacker_wallet,
    defender_wallet,
    defender_board,
    game_id: int,
    cell: int,
) -> None:
    hit = has_ship(defender_board.ship_mask, cell)

    print(
        f"\n{attacker_wallet.role} attacks {cell_label(cell)} "
        f"on {defender_wallet.role}'s board ({'hit' if hit else 'miss'})"
    )

    send(
        w3,
        contract,
        attacker_wallet,
        contract.functions.attackCell(game_id, cell),
        "attackCell",
    )

    proof = merkle_proof(defender_board.leaves, cell)

    send(
        w3,
        contract,
        defender_wallet,
        contract.functions.revealCell(
            game_id,
            cell,
            hit,
            defender_board.salts[cell],
            proof,
        ),
        "revealCell",
    )


def main() -> None:
    print("=== Battleship smoke test ===")

    w3 = connect_web3()
    player1 = load_wallet("player1")
    player2 = load_wallet("player2")
    contract = load_battleship_contract(w3)

    print("Contract:", contract.address)
    print("Player 1:", player1.address)
    print("Player 2:", player2.address)
    print("Latest block:", w3.eth.block_number)

    code = require_contract_code(w3, contract.address)
    print("Contract code bytes:", len(code))

    game_id = contract.functions.nextGameId().call()
    print("Game ID:", game_id)

    board1 = build_test_board(
        game_id=game_id,
        player_address=player1.address,
        contract_address=contract.address,
        ship_cells=PLAYER1_SHIPS,
        namespace="player1",
    )
    board2 = build_test_board(
        game_id=game_id,
        player_address=player2.address,
        contract_address=contract.address,
        ship_cells=PLAYER2_SHIPS,
        namespace="player2",
    )

    print("\nTest boards:")
    print("  player1 ships:", ", ".join(cell_label(cell) for cell in board1.ship_cells))
    print("  player1 root:", short_hex(board1.root))
    print("  player2 ships:", ", ".join(cell_label(cell) for cell in board2.ship_cells))
    print("  player2 root:", short_hex(board2.root))

    send(w3, contract, player1, contract.functions.createGame(), "createGame")
    send(w3, contract, player2, contract.functions.joinGame(game_id), "joinGame")
    send(
        w3,
        contract,
        player1,
        contract.functions.commitBoard(game_id, board1.root),
        "commitBoard player1",
    )
    send(
        w3,
        contract,
        player2,
        contract.functions.commitBoard(game_id, board2.root),
        "commitBoard player2",
    )

    attack_and_reveal(
        w3=w3,
        contract=contract,
        attacker_wallet=player1,
        defender_wallet=player2,
        defender_board=board2,
        game_id=game_id,
        cell=1,
    )
    attack_and_reveal(
        w3=w3,
        contract=contract,
        attacker_wallet=player2,
        defender_wallet=player1,
        defender_board=board1,
        game_id=game_id,
        cell=4,
    )
    attack_and_reveal(
        w3=w3,
        contract=contract,
        attacker_wallet=player1,
        defender_wallet=player2,
        defender_board=board2,
        game_id=game_id,
        cell=0,
    )
    attack_and_reveal(
        w3=w3,
        contract=contract,
        attacker_wallet=player2,
        defender_wallet=player1,
        defender_board=board1,
        game_id=game_id,
        cell=0,
    )
    attack_and_reveal(
        w3=w3,
        contract=contract,
        attacker_wallet=player1,
        defender_wallet=player2,
        defender_board=board2,
        game_id=game_id,
        cell=7,
    )
    attack_and_reveal(
        w3=w3,
        contract=contract,
        attacker_wallet=player2,
        defender_wallet=player1,
        defender_board=board1,
        game_id=game_id,
        cell=6,
    )
    attack_and_reveal(
        w3=w3,
        contract=contract,
        attacker_wallet=player1,
        defender_wallet=player2,
        defender_board=board2,
        game_id=game_id,
        cell=13,
    )

    print("\nPlayer 1 audits their own board to confirm the win.")
    send(
        w3,
        contract,
        player1,
        contract.functions.revealFinalBoard(game_id, board1.ship_mask, board1.salts),
        "revealFinalBoard",
    )

    game = contract.functions.getGame(game_id).call()
    hit_masks = contract.functions.getHitMasks(game_id).call()

    print("\nFinal state:")
    print("  phase:", game[3])
    print("  winner:", game[2])
    print("  player1 hits received:", hit_masks[2])
    print("  player2 hits received:", hit_masks[3])

    if game[2].lower() != player1.address.lower():
        raise RuntimeError("Smoke test expected player1 to win.")

    if int(hit_masks[2]) != 2 or int(hit_masks[3]) != 3:
        raise RuntimeError("Smoke test hit counts are not the expected 2 / 3.")

    print("\nSmoke test passed.")


if __name__ == "__main__":
    main()
