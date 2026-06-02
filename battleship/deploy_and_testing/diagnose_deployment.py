import argparse

from web3 import Web3
from web3.exceptions import BadFunctionCallOutput

from battleship.deploy_and_testing.utils.config import BATTLESHIP_CONTRACT_NAME
from battleship.deploy_and_testing.utils.contract import load_battleship_contract
from rps_backend.utils.chain import connect_web3
from rps_backend.utils.contract import load_address


def print_code_status(w3: Web3, label: str, address: str) -> None:
    checksum_address = Web3.to_checksum_address(address)
    code = w3.eth.get_code(checksum_address)

    print(f"\n{label}:")
    print("  address:", checksum_address)
    print("  code bytes:", len(code))
    print("  code prefix:", code.hex()[:80] if code else "0x")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--tx",
        help="Optional deployment transaction hash to inspect.",
    )
    args = parser.parse_args()

    print("=== Diagnose Battleship deployment ===")

    w3 = connect_web3()
    contract = load_battleship_contract(w3)
    artifact_address = load_address(BATTLESHIP_CONTRACT_NAME)
    latest_block = w3.eth.get_block("latest")

    print("Chain ID:", w3.eth.chain_id)
    print("Latest block:", latest_block["number"])
    print("Latest block hash:", latest_block["hash"].hex())
    print("Artifact address:", artifact_address)
    print("Loaded contract address:", contract.address)

    print_code_status(w3, "Artifact address code", artifact_address)

    try:
        next_game_id = contract.functions.nextGameId().call()
        print("\nnextGameId call: OK")
        print("  nextGameId:", next_game_id)
    except BadFunctionCallOutput as exc:
        print("\nnextGameId call: FAILED")
        print("  reason:", exc)

    if args.tx:
        tx_hash = args.tx if args.tx.startswith("0x") else f"0x{args.tx}"

        print("\nDeployment transaction:")
        print("  tx hash:", tx_hash)

        try:
            tx = w3.eth.get_transaction(tx_hash)
            print("  from:", tx["from"])
            print("  to:", tx["to"])
            print("  nonce:", tx["nonce"])
            print("  block number:", tx["blockNumber"])
        except Exception as exc:
            print("  get_transaction failed:", type(exc).__name__, exc)

        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash)
            receipt_address = receipt["contractAddress"]

            print("  status:", receipt["status"])
            print("  receipt block:", receipt["blockNumber"])
            print("  gas used:", receipt["gasUsed"])
            print("  contractAddress:", receipt_address)

            if receipt_address:
                print_code_status(w3, "Receipt contractAddress code", receipt_address)

                if Web3.to_checksum_address(receipt_address) != artifact_address:
                    print("\nWARNING: receipt contractAddress does not match artifact address.")
        except Exception as exc:
            print("  get_transaction_receipt failed:", type(exc).__name__, exc)


if __name__ == "__main__":
    main()
