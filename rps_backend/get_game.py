import argparse
from datetime import datetime

from rps_backend.utils.chain import connect_web3
from rps_backend.utils.config import RPS_CONTRACT_NAME
from rps_backend.utils.contract import load_contract


PHASE_NAMES = {
    0: "WaitingForPlayer",
    1: "Commit",
    2: "Reveal",
    3: "Finished",
    4: "Cancelled",
}

MOVE_NAMES = {
    0: "Rock",
    1: "Paper",
    2: "Scissors",
}


def format_deadline(timestamp: int) -> str:
    if timestamp == 0:
        return "not set"

    return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("game_id", type=int, help="Game ID to inspect")
    args = parser.parse_args()

    w3 = connect_web3()
    contract = load_contract(w3, RPS_CONTRACT_NAME)

    game = contract.functions.getGame(args.game_id).call()
    commitments = contract.functions.getCommitments(args.game_id).call()
    reveals = contract.functions.getReveals(args.game_id).call()

    player1, player2, winner, phase, commit_deadline, reveal_deadline = game
    commitment1, commitment2 = commitments
    revealed1, revealed2, move1, move2 = reveals

    print(f"=== RPS game {args.game_id} ===")
    print("Contract:", contract.address)
    print("Phase:", phase, f"({PHASE_NAMES.get(phase, 'Unknown')})")

    print("\nPlayers:")
    print("  player1:", player1)
    print("  player2:", player2)

    print("\nCommitments:")
    print("  player1:", commitment1.hex())
    print("  player2:", commitment2.hex())

    print("\nReveals:")
    print("  player1 revealed:", revealed1)
    print("  player2 revealed:", revealed2)

    if revealed1:
        print("  player1 move:", move1, f"({MOVE_NAMES.get(move1, 'Unknown')})")
    else:
        print("  player1 move: hidden")

    if revealed2:
        print("  player2 move:", move2, f"({MOVE_NAMES.get(move2, 'Unknown')})")
    else:
        print("  player2 move: hidden")

    print("\nDeadlines:")
    print("  commit deadline:", commit_deadline, f"({format_deadline(commit_deadline)})")
    print("  reveal deadline:", reveal_deadline, f"({format_deadline(reveal_deadline)})")

    print("\nResult:")
    print("  winner:", winner)


if __name__ == "__main__":
    main()