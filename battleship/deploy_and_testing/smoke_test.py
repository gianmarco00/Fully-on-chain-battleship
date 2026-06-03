from web3.logs import DISCARD

from battleship.deploy_and_testing.utils.board import (
    FLEET_CELL_COUNT,
    ShipPlacement,
    build_test_board,
    cell_label,
    first_miss_cells,
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


# Ship order must match the contract: length 5, length 4, length 3, length 3, length 2.
PLAYER1_PLACEMENTS = (
    ShipPlacement(start_cell=0, horizontal=True),   # A1-E1
    ShipPlacement(start_cell=20, horizontal=True),  # A3-D3
    ShipPlacement(start_cell=40, horizontal=True),  # A5-C5
    ShipPlacement(start_cell=44, horizontal=True),  # E5-G5
    ShipPlacement(start_cell=60, horizontal=True),  # A7-B7
)
PLAYER2_PLACEMENTS = (
    ShipPlacement(start_cell=10, horizontal=True),  # A2-E2
    ShipPlacement(start_cell=30, horizontal=True),  # A4-D4
    ShipPlacement(start_cell=50, horizontal=True),  # A6-C6
    ShipPlacement(start_cell=54, horizontal=True),  # E6-G6
    ShipPlacement(start_cell=70, horizontal=True),  # A8-B8
)


def placement_text(placements: tuple[ShipPlacement, ...]) -> str:
    return ", ".join(
        f"{cell_label(placement.start_cell)}:{'H' if placement.horizontal else 'V'}"
        for placement in placements
    )


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
        placements=PLAYER1_PLACEMENTS,
        namespace="player1",
    )
    board2 = build_test_board(
        game_id=game_id,
        player_address=player2.address,
        contract_address=contract.address,
        placements=PLAYER2_PLACEMENTS,
        namespace="player2",
    )

    player2_miss_cells = first_miss_cells(board1, FLEET_CELL_COUNT - 1)

    print("\nTest boards:")
    print("  player1 placements:", placement_text(board1.placements))
    print("  player1 ships:", ", ".join(cell_label(cell) for cell in board1.ship_cells))
    print("  player1 master salt:", short_hex(board1.master_salt))
    print("  player1 root:", short_hex(board1.root))
    print("  player2 placements:", placement_text(board2.placements))
    print("  player2 ships:", ", ".join(cell_label(cell) for cell in board2.ship_cells))
    print("  player2 master salt:", short_hex(board2.master_salt))
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

    for attack_index, player1_target in enumerate(board2.ship_cells):
        attack_and_reveal(
            w3=w3,
            contract=contract,
            attacker_wallet=player1,
            defender_wallet=player2,
            defender_board=board2,
            game_id=game_id,
            cell=player1_target,
        )

        if attack_index == len(board2.ship_cells) - 1:
            break

        attack_and_reveal(
            w3=w3,
            contract=contract,
            attacker_wallet=player2,
            defender_wallet=player1,
            defender_board=board1,
            game_id=game_id,
            cell=player2_miss_cells[attack_index],
        )

    print("\nPlayer 1 audits their own board to confirm the win.")
    send(
        w3,
        contract,
        player1,
        contract.functions.revealFinalBoard(
            game_id,
            board1.master_salt,
            board1.ship_start_cells,
            board1.ship_horizontal,
        ),
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

    if int(hit_masks[2]) != 0 or int(hit_masks[3]) != FLEET_CELL_COUNT:
        raise RuntimeError(
            f"Smoke test hit counts are not the expected 0 / {FLEET_CELL_COUNT}."
        )

    print("\nSmoke test passed.")


if __name__ == "__main__":
    main()
