import argparse
from datetime import datetime

from battleship.deploy_and_testing.utils.board import cell_label
from battleship.deploy_and_testing.utils.contract import load_battleship_contract
from rps_backend.utils.chain import connect_web3


PHASE_NAMES = {
    0: "WaitingForPlayer",
    1: "BoardSetup",
    2: "Attack",
    3: "CellReveal",
    4: "Audit",
    5: "Finished",
    6: "Cancelled",
}


def format_deadline(timestamp: int) -> str:
    if timestamp == 0:
        return "not set"

    return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")


def format_address(address: str) -> str:
    if address.lower() == "0x0000000000000000000000000000000000000000":
        return "not set"

    return address


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_id", type=int, help="Game ID to inspect")
    args = parser.parse_args()

    w3 = connect_web3()
    contract = load_battleship_contract(w3)

    game = contract.functions.getGame(args.game_id).call()
    roots = contract.functions.getBoardRoots(args.game_id).call()
    hit_masks = contract.functions.getHitMasks(args.game_id).call()

    (
        player1,
        player2,
        winner,
        phase,
        current_attacker,
        pending_target,
        provisional_winner,
        action_deadline,
    ) = game
    board_root1, board_root2 = roots
    hit_mask1, hit_mask2, hit_count1, hit_count2 = hit_masks

    print(f"=== Battleship game {args.game_id} ===")
    print("Contract:", contract.address)
    print("Phase:", phase, f"({PHASE_NAMES.get(phase, 'Unknown')})")

    print("\nPlayers:")
    print("  player1:", player1)
    print("  player2:", player2)

    print("\nTurn:")
    print("  current attacker:", format_address(current_attacker))
    print("  pending target:", pending_target, f"({cell_label(pending_target)})")
    print("  action deadline:", action_deadline, f"({format_deadline(action_deadline)})")

    print("\nBoard roots:")
    print("  player1:", board_root1.hex())
    print("  player2:", board_root2.hex())

    print("\nHits:")
    print("  player1 hit mask:", hit_mask1, "hit count:", hit_count1)
    print("  player2 hit mask:", hit_mask2, "hit count:", hit_count2)

    print("\nResult:")
    print("  provisional winner:", format_address(provisional_winner))
    print("  winner:", format_address(winner))


if __name__ == "__main__":
    main()
