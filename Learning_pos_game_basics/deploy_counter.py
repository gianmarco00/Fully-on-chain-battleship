import json
import os
from pathlib import Path

from dotenv import load_dotenv
from solcx import compile_standard, install_solc
from web3 import Web3

NODE_URL = "http://127.0.0.1:8549"
EXPECTED_CHAIN_ID = 70207
SOLC_VERSION = "0.8.20"

PROJECT_ROOT = Path(__file__).resolve().parents[1]

CONTRACT_PATH = PROJECT_ROOT / "contracts" / CONTRACT_FILE
BUILD_DIR = PROJECT_ROOT / "build"
ENV_PATH = PROJECT_ROOT / ".env"


def compile_contract():
    print("Installing / selecting Solidity compiler:", SOLC_VERSION)
    install_solc(SOLC_VERSION)

    source_code = CONTRACT_PATH.read_text()

    compiled = compile_standard(
        {
            "language": "Solidity",
            "sources": {
                "Counter.sol": {
                    "content": source_code,
                }
            },
            "settings": {
                "outputSelection": {
                    "*": {
                        "*": ["abi", "evm.bytecode"]
                    }
                }
            },
        },
        solc_version=SOLC_VERSION,
    )

    contract_interface = compiled["contracts"]["Counter.sol"]["Counter"]
    abi = contract_interface["abi"]
    bytecode = contract_interface["evm"]["bytecode"]["object"]

    BUILD_DIR.mkdir(exist_ok=True)

    (BUILD_DIR / "Counter.abi.json").write_text(json.dumps(abi, indent=2))
    (BUILD_DIR / "Counter.bytecode.txt").write_text(bytecode)

    return abi, bytecode


def main():
    load_dotenv()

    private_key = os.getenv("PRIVATE_KEY")
    funding_address = os.getenv("FUNDING_ADDRESS")

    if not private_key or not funding_address:
        raise RuntimeError("Missing PRIVATE_KEY or FUNDING_ADDRESS in .env")

    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))

    print("=== Deploy Counter contract ===")
    print("Connected:", w3.is_connected())

    if not w3.is_connected():
        raise RuntimeError("Could not connect to local UZHETH PoS node.")

    chain_id = w3.eth.chain_id
    print("Chain ID:", chain_id)

    if chain_id != EXPECTED_CHAIN_ID:
        raise RuntimeError(f"Wrong chain ID: expected {EXPECTED_CHAIN_ID}, got {chain_id}")

    funding_address = Web3.to_checksum_address(funding_address)
    account = w3.eth.account.from_key(private_key)

    if account.address.lower() != funding_address.lower():
        raise RuntimeError(
            "PRIVATE_KEY does not match FUNDING_ADDRESS. "
            f"Private key address: {account.address}, funding address: {funding_address}"
        )

    abi, bytecode = compile_contract()

    Counter = w3.eth.contract(abi=abi, bytecode=bytecode)

    nonce = w3.eth.get_transaction_count(funding_address)
    latest_block = w3.eth.get_block("latest")
    base_fee = latest_block.get("baseFeePerGas", w3.to_wei(1, "gwei"))

    priority_fee = w3.to_wei(1, "gwei")
    max_fee = base_fee * 2 + priority_fee

    deploy_tx = Counter.constructor().build_transaction(
        {
            "chainId": chain_id,
            "from": funding_address,
            "nonce": nonce,
            "gas": 1_000_000,
            "maxFeePerGas": max_fee,
            "maxPriorityFeePerGas": priority_fee,
            "type": 2,
        }
    )

    print("\nPrepared deployment transaction:")
    print("  from:", funding_address)
    print("  nonce:", nonce)
    print("  gas limit:", deploy_tx["gas"])

    confirm = input("\nDeploy Counter contract? Type YES to continue: ")
    if confirm != "YES":
        print("Cancelled.")
        return

    signed_tx = w3.eth.account.sign_transaction(deploy_tx, private_key)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)

    print("\nDeployment transaction sent.")
    print("Tx hash:", tx_hash.hex())
    print("Waiting for receipt...")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)

    print("\nReceipt:")
    print("  status:", receipt["status"])
    print("  blockNumber:", receipt["blockNumber"])
    print("  gasUsed:", receipt["gasUsed"])
    print("  contractAddress:", receipt["contractAddress"])

    if receipt["status"] != 1:
        raise RuntimeError("Deployment transaction failed.")

    deployed_address = receipt["contractAddress"]

    (BUILD_DIR / "Counter.address.txt").write_text(deployed_address)

    counter = w3.eth.contract(address=deployed_address, abi=abi)
    initial_value = counter.functions.get().call()

    print("\nRead from deployed contract:")
    print("  counter.get():", initial_value)

    print("\nSUCCESS: Counter contract deployed and readable.")
    print("Saved files:")
    print("  build/Counter.abi.json")
    print("  build/Counter.bytecode.txt")
    print("  build/Counter.address.txt")


if __name__ == "__main__":
    main()