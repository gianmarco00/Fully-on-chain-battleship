from rps_backend.utils.config import DEFAULT_GAS_LIMIT


BATTLESHIP_CONTRACT_NAME = "BattleshipGame"
BATTLESHIP_CONTRACT_FILE = "BattleshipGame.sol"

# revealCell and revealFinalBoard do Merkle work, so keep a larger test ceiling.
BATTLESHIP_GAS_LIMIT = max(DEFAULT_GAS_LIMIT, 700_000)

# Local PoS chains can occasionally roll back a just-mined block if the node or
# consensus process is stopped immediately. Wait a little before saving artifacts.
DEPLOY_CONFIRMATION_BLOCKS = 2
