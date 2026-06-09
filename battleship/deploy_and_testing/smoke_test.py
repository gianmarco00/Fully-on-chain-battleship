import os

from web3 import Web3
from web3.logs import DISCARD

from battleship.deploy_and_testing.utils.board import (
    FLEET_CELL_COUNT,
    ShipPlacement,
    build_test_board,
    cell_label,
    deterministic_first_move_secret,
    first_miss_cells,
    has_ship,
    make_first_move_commit,
    merkle_proof,
    short_hex,
)
from battleship.deploy_and_testing.utils.config import BATTLESHIP_GAS_LIMIT
from battleship.deploy_and_testing.utils.contract import (
    load_battleship_contract,
    require_contract_code,
    send_estimated_tx,
)
from rps_backend.utils.config import EXPECTED_CHAIN_ID, NODE_URL
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

PHASE_ATTACK = 3
PHASE_AUDIT = 5

DEFAULT_SMOKE_RPC_URL = "http://130.60.144.77:8554/"

GAS_REPORT_ACTIONS = (
    "createGame",
    "joinGame",
    "commitBoard",
    "revealRandomness",
    "attackCell",
    "revealCell miss",
    "revealCell hit",
    "revealFinalBoard",
)


def connect_smoke_web3() -> Web3:
    configured_rpc_url = os.getenv("BATTLESHIP_RPC_URL") or os.getenv("UZHETH_RPC_URL")
    rpc_urls = [configured_rpc_url] if configured_rpc_url else [
        DEFAULT_SMOKE_RPC_URL,
        NODE_URL,
    ]
    last_error: Exception | None = None

    for rpc_url in rpc_urls:
        if not rpc_url:
            continue

        w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 20}))

        if not w3.is_connected():
            last_error = ConnectionError(f"Could not connect to UZHETH RPC at {rpc_url}.")
            continue

        chain_id = w3.eth.chain_id
        if chain_id != EXPECTED_CHAIN_ID:
            raise RuntimeError(
                f"Connected to wrong chain. Expected {EXPECTED_CHAIN_ID}, got {chain_id}."
            )

        print("RPC URL:", rpc_url)
        return w3

    if last_error:
        raise last_error

    raise ConnectionError("No UZHETH RPC URL configured.")


def placement_text(placements: tuple[ShipPlacement, ...]) -> str:
    return ", ".join(
        f"{cell_label(placement.start_cell)}:{'H' if placement.horizontal else 'V'}"
        for placement in placements
    )


def record_gas(
    gas_samples: dict[str, list[int]],
    action: str | None,
    receipt,
) -> None:
    if action is None:
        return

    gas_samples.setdefault(action, []).append(int(receipt["gasUsed"]))


def print_gas_report(gas_samples: dict[str, list[int]]) -> None:
    print("\nGas usage summary for report:")
    print(f"{'Action':<22} {'Gas used':>10}  Notes")
    print("-" * 58)

    for action in GAS_REPORT_ACTIONS:
        samples = gas_samples.get(action, [])

        if not samples:
            print(f"{action:<22} {'missing':>10}")
            continue

        chosen_gas = max(samples)

        if len(samples) == 1:
            note = "single transaction"
        else:
            note = (
                f"max of {len(samples)} transactions "
                f"(samples: {', '.join(str(sample) for sample in samples)})"
            )

        print(f"{action:<22} {chosen_gas:>10}  {note}")


def send(
    w3,
    contract,
    wallet,
    function_call,
    label: str,
    gas_samples: dict[str, list[int]],
    report_action: str | None = None,
):
    receipt = send_estimated_tx(
        w3=w3,
        function_call=function_call,
        wallet=wallet,
        label=label,
        minimum_gas=BATTLESHIP_GAS_LIMIT,
    )
    record_gas(gas_samples, report_action, receipt)

    for event_type in (
        contract.events.GameCreated(),
        contract.events.GameJoined(),
        contract.events.BoardCommitted(),
        contract.events.RandomnessRevealed(),
        contract.events.FirstAttackerChosen(),
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
    gas_samples: dict[str, list[int]],
) -> None:
    hit = has_ship(defender_board.ship_mask, cell)
    reveal_action = "revealCell hit" if hit else "revealCell miss"

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
        gas_samples,
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
        reveal_action,
        gas_samples,
        reveal_action,
    )


def main() -> None:
    print("=== Battleship smoke test ===")

    w3 = connect_smoke_web3()
    player1 = load_wallet("player1")
    player2 = load_wallet("player2")
    contract = load_battleship_contract(w3)
    gas_samples: dict[str, list[int]] = {}

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
    player1_random_secret = deterministic_first_move_secret(
        "player1",
        game_id,
        player1.address,
    )
    player2_random_secret = deterministic_first_move_secret(
        "player2",
        game_id,
        player2.address,
    )
    player1_random_commit = make_first_move_commit(
        game_id=game_id,
        player_address=player1.address,
        random_secret=player1_random_secret,
        contract_address=contract.address,
    )
    player2_random_commit = make_first_move_commit(
        game_id=game_id,
        player_address=player2.address,
        random_secret=player2_random_secret,
        contract_address=contract.address,
    )

    player2_miss_cells = first_miss_cells(board1, FLEET_CELL_COUNT)

    print("\nTest boards:")
    print("  player1 placements:", placement_text(board1.placements))
    print("  player1 ships:", ", ".join(cell_label(cell) for cell in board1.ship_cells))
    print("  player1 master salt:", short_hex(board1.master_salt))
    print("  player1 root:", short_hex(board1.root))
    print("  player1 first move secret:", short_hex(player1_random_secret))
    print("  player1 first move commit:", short_hex(player1_random_commit))
    print("  player2 placements:", placement_text(board2.placements))
    print("  player2 ships:", ", ".join(cell_label(cell) for cell in board2.ship_cells))
    print("  player2 master salt:", short_hex(board2.master_salt))
    print("  player2 root:", short_hex(board2.root))
    print("  player2 first move secret:", short_hex(player2_random_secret))
    print("  player2 first move commit:", short_hex(player2_random_commit))

    send(
        w3,
        contract,
        player1,
        contract.functions.createGame(),
        "createGame",
        gas_samples,
        "createGame",
    )
    send(
        w3,
        contract,
        player2,
        contract.functions.joinGame(game_id),
        "joinGame",
        gas_samples,
        "joinGame",
    )
    send(
        w3,
        contract,
        player1,
        contract.functions.commitBoard(game_id, board1.root, player1_random_commit),
        "commitBoard player1",
        gas_samples,
        "commitBoard",
    )
    send(
        w3,
        contract,
        player2,
        contract.functions.commitBoard(game_id, board2.root, player2_random_commit),
        "commitBoard player2",
        gas_samples,
        "commitBoard",
    )

    print("\nPlayers reveal first-move randomness.")
    send(
        w3,
        contract,
        player1,
        contract.functions.revealRandomness(game_id, player1_random_secret),
        "revealRandomness player1",
        gas_samples,
        "revealRandomness",
    )
    send(
        w3,
        contract,
        player2,
        contract.functions.revealRandomness(game_id, player2_random_secret),
        "revealRandomness player2",
        gas_samples,
        "revealRandomness",
    )

    game = contract.functions.getGame(game_id).call()
    print("  first attacker:", game[4])

    player1_hit_index = 0
    player2_miss_index = 0

    while True:
        game = contract.functions.getGame(game_id).call()
        phase = int(game[3])

        if phase == PHASE_AUDIT:
            break

        if phase != PHASE_ATTACK:
            raise RuntimeError(f"Expected attack phase, got phase {phase}.")

        current_attacker = str(game[4]).lower()

        if current_attacker == player1.address.lower():
            if player1_hit_index >= len(board2.ship_cells):
                raise RuntimeError("Player 1 ran out of ship cells to attack.")

            target_cell = board2.ship_cells[player1_hit_index]
            player1_hit_index += 1

            attack_and_reveal(
                w3=w3,
                contract=contract,
                attacker_wallet=player1,
                defender_wallet=player2,
                defender_board=board2,
                game_id=game_id,
                cell=target_cell,
                gas_samples=gas_samples,
            )
        elif current_attacker == player2.address.lower():
            if player2_miss_index >= len(player2_miss_cells):
                raise RuntimeError("Player 2 ran out of miss cells to attack.")

            target_cell = player2_miss_cells[player2_miss_index]
            player2_miss_index += 1

            attack_and_reveal(
                w3=w3,
                contract=contract,
                attacker_wallet=player2,
                defender_wallet=player1,
                defender_board=board1,
                game_id=game_id,
                cell=target_cell,
                gas_samples=gas_samples,
            )
        else:
            raise RuntimeError(f"Unexpected current attacker: {game[4]}")

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
        gas_samples,
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

    print_gas_report(gas_samples)

    print("\nSmoke test passed.")


if __name__ == "__main__":
    main()
