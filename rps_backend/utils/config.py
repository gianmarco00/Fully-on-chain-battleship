from pathlib import Path

# blockchain_game/
PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Main project folders
CONTRACTS_DIR = PROJECT_ROOT / "contracts"
BUILD_DIR = PROJECT_ROOT / "build"
ENV_PATH = PROJECT_ROOT / ".env"

# Backend folders
RPS_BACKEND_DIR = PROJECT_ROOT / "rps_backend"
LOCAL_SECRETS_DIR = RPS_BACKEND_DIR / "local_secrets"

# UZHETH PoS chain configuration
NODE_URL = "http://127.0.0.1:8549"
EXPECTED_CHAIN_ID = 70207

# Future deployed contract artifact names
RPS_CONTRACT_NAME = "RPSGame"
RPS_ABI_PATH = BUILD_DIR / f"{RPS_CONTRACT_NAME}.abi.json"
RPS_ADDRESS_PATH = BUILD_DIR / f"{RPS_CONTRACT_NAME}.address.txt"

# Default gas values. 
DEFAULT_GAS_LIMIT = 250_000
DEPLOY_GAS_LIMIT = 2_500_000

# Fee settings
PRIORITY_FEE_GWEI = 1