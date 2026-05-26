from rps_backend.utils.chain import connect_web3, send_contract_tx
from rps_backend.utils.config import DEPLOY_GAS_LIMIT, RPS_CONTRACT_NAME
from rps_backend.utils.contract import compile_contract, save_artifacts
from rps_backend.utils.wallets import load_wallet


CONTRACT_FILE = "RPSGame.sol"


def main() -> None:
    print("=== Deploy RPSGame ===")

    w3 = connect_web3()
    deployer = load_wallet("player1")

    abi, bytecode = compile_contract(
        contract_file=CONTRACT_FILE,
        contract_name=RPS_CONTRACT_NAME,
    )

    contract_factory = w3.eth.contract(abi=abi, bytecode=bytecode)

    constructor_call = contract_factory.constructor()

    estimated_gas = constructor_call.estimate_gas({"from": deployer.address})
    gas_limit = int(estimated_gas * 1.25)

    print("\nEstimated deployment gas:", estimated_gas)
    print("Using deployment gas limit:", gas_limit)

    receipt = send_contract_tx(
        w3=w3,
        function_call=constructor_call,
        sender_address=deployer.address,
        private_key=deployer.private_key,
        gas=gas_limit,
        label="deploy RPSGame",
    )

    contract_address = receipt["contractAddress"]

    save_artifacts(
        contract_name=RPS_CONTRACT_NAME,
        abi=abi,
        bytecode=bytecode,
        address=contract_address,
    )

    deployed = w3.eth.contract(address=contract_address, abi=abi)

    print("\nDeployment complete.")
    print("  contract:", contract_address)
    print("  nextGameId:", deployed.functions.nextGameId().call())
    print("\nSaved artifacts:")
    print(f"  build/{RPS_CONTRACT_NAME}.abi.json")
    print(f"  build/{RPS_CONTRACT_NAME}.bytecode.txt")
    print(f"  build/{RPS_CONTRACT_NAME}.address.txt")


if __name__ == "__main__":
    main()