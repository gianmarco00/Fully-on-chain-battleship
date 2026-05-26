from web3 import Web3

NODE_URL = "http://127.0.0.1:8549"

# Replace this with your public MetaMask funding wallet address.
# This is safe to put here because it is public.
WALLET_ADDRESS = "0x87420B230f5695619d166a8ee55b9a9EdC063898"


def main():
    w3 = Web3(Web3.HTTPProvider(NODE_URL, request_kwargs={"timeout": 20}))

    print("=== UZHETH PoS balance check ===")
    print(f"Connected: {w3.is_connected()}")

    if not w3.is_connected():
        print("ERROR: Could not connect to local node.")
        return

    # Web3.py expects checksum addresses.
    address = Web3.to_checksum_address(WALLET_ADDRESS)

    balance_wei = w3.eth.get_balance(address)
    balance_eth = w3.from_wei(balance_wei, "ether")

    print(f"Chain ID: {w3.eth.chain_id}")
    print(f"Wallet address: {address}")
    print(f"Balance in wei: {balance_wei}")
    print(f"Balance in UZHETHs: {balance_eth}")


if __name__ == "__main__":
    main()