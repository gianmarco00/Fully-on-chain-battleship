from web3 import Web3

NODE_URL = "http://127.0.0.1:8549"
EXPECTED_CHAIN_ID = 70207


def main():
    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))

    print("=== UZHETH PoS connection check ===")
    print(f"RPC endpoint: {NODE_URL}")
    print(f"Connected: {w3.is_connected()}")

    if not w3.is_connected():
        print("\nERROR: Could not connect to the local execution node.")
        print("Check that your geth/reth tmux session is running.")
        return

    chain_id = w3.eth.chain_id
    block_number = w3.eth.block_number
    latest_block = w3.eth.get_block("latest")

    print(f"Chain ID: {chain_id}")
    print(f"Expected Chain ID: {EXPECTED_CHAIN_ID}")
    print(f"Latest block number: {block_number}")
    print(f"Latest block hash: {latest_block['hash'].hex()}")
    print(f"Transactions in latest block: {len(latest_block['transactions'])}")

    if chain_id == EXPECTED_CHAIN_ID:
        print("\nSUCCESS: You are connected to UZHETH PoS.")
    else:
        print("\nWARNING: Connected, but this is not the expected UZHETH PoS chain.")


if __name__ == "__main__":
    main()