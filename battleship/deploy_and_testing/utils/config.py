from rps_backend.utils.config import DEFAULT_GAS_LIMIT


BATTLESHIP_CONTRACT_NAME = "BattleshipGame"
BATTLESHIP_CONTRACT_FILE = "BattleshipGame.sol"

# revealFinalBoard now recomputes a 100-cell Merkle tree, so keep a larger
# test ceiling while still estimating each transaction first.
BATTLESHIP_GAS_LIMIT = max(DEFAULT_GAS_LIMIT, 1_500_000)

# Local PoS chains can occasionally roll back a just-mined block if the node or
# consensus process is stopped immediately. Wait a little before saving artifacts.
DEPLOY_CONFIRMATION_BLOCKS = 2
