from dataclasses import dataclass

from web3 import Web3


PHASE_WAITING = 0
PHASE_COMMIT = 1
PHASE_REVEAL = 2
PHASE_FINISHED = 3
PHASE_CANCELLED = 4


PHASE_NAMES = {
    PHASE_WAITING: "WaitingForPlayer",
    PHASE_COMMIT: "Commit",
    PHASE_REVEAL: "Reveal",
    PHASE_FINISHED: "Finished",
    PHASE_CANCELLED: "Cancelled",
}


@dataclass(frozen=True)
class GameState:
    game_id: int
    player1: str
    player2: str
    winner: str
    phase: int
    commit_deadline: int
    reveal_deadline: int
    commitment1: bytes
    commitment2: bytes
    revealed1: bool
    revealed2: bool
    move1: int
    move2: int

    @property
    def phase_name(self) -> str:
        return PHASE_NAMES.get(self.phase, "Unknown")

    @property
    def both_committed(self) -> bool:
        return self.commitment1 != b"\x00" * 32 and self.commitment2 != b"\x00" * 32

    @property
    def is_finished(self) -> bool:
        return self.phase in {PHASE_FINISHED, PHASE_CANCELLED}

    def is_player1(self, address: str) -> bool:
        return self.player1.lower() == Web3.to_checksum_address(address).lower()

    def is_player2(self, address: str) -> bool:
        return self.player2.lower() == Web3.to_checksum_address(address).lower()

    def has_committed(self, address: str) -> bool:
        if self.is_player1(address):
            return self.commitment1 != b"\x00" * 32
        if self.is_player2(address):
            return self.commitment2 != b"\x00" * 32
        return False

    def has_revealed(self, address: str) -> bool:
        if self.is_player1(address):
            return self.revealed1
        if self.is_player2(address):
            return self.revealed2
        return False


def fetch_game_state(contract, game_id: int) -> GameState:
    player1, player2, winner, phase, commit_deadline, reveal_deadline = (
        contract.functions.getGame(game_id).call()
    )
    commitment1, commitment2 = contract.functions.getCommitments(game_id).call()
    revealed1, revealed2, move1, move2 = contract.functions.getReveals(game_id).call()

    return GameState(
        game_id=game_id,
        player1=player1,
        player2=player2,
        winner=winner,
        phase=phase,
        commit_deadline=commit_deadline,
        reveal_deadline=reveal_deadline,
        commitment1=commitment1,
        commitment2=commitment2,
        revealed1=revealed1,
        revealed2=revealed2,
        move1=move1,
        move2=move2,
    )