from battleship.deploy_and_testing.utils.config import (
    BATTLESHIP_CONTRACT_FILE,
    BATTLESHIP_CONTRACT_NAME,
    DEPLOY_CONFIRMATION_BLOCKS,
)
from battleship.deploy_and_testing.utils.contract import (
    block_safe_gas_limit,
    compile_optimized_contract,
    require_contract_code,
    send_fee_bumped_tx,
    save_optimized_artifacts,
    wait_for_confirmations,
)
from rps_backend.utils.chain import connect_web3
from rps_backend.utils.wallets import load_wallet


def main() -> None:
    print("=== Deploy BattleshipGame ===")

    w3 = connect_web3()
    deployer = load_wallet("player1")

    abi, bytecode = compile_optimized_contract(
        contract_file=BATTLESHIP_CONTRACT_FILE,
        contract_name=BATTLESHIP_CONTRACT_NAME,
    )

    print("Compiled with Solidity optimizer enabled.")
    print("Deployment bytecode bytes:", len(bytecode) // 2)

    contract_factory = w3.eth.contract(abi=abi, bytecode=bytecode)
    constructor_call = contract_factory.constructor()

    estimated_gas = constructor_call.estimate_gas({"from": deployer.address})
    latest_block = w3.eth.get_block("latest")
    block_gas_limit = latest_block["gasLimit"]
    gas_limit = block_safe_gas_limit(
        estimated_gas=estimated_gas,
        block_gas_limit=block_gas_limit,
    )

    print("\nEstimated deployment gas:", estimated_gas)
    print("Latest block gas limit:", block_gas_limit)
    print("Using deployment gas limit:", gas_limit)

    receipt = send_fee_bumped_tx(
        w3=w3,
        function_call=constructor_call,
        wallet=deployer,
        gas=gas_limit,
        label="deploy BattleshipGame",
    )

    contract_address = receipt["contractAddress"]

    if not contract_address:
        raise RuntimeError("Deployment receipt did not contain a contract address.")

    deployed_code = require_contract_code(w3, contract_address)
    wait_for_confirmations(
        w3=w3,
        mined_block=receipt["blockNumber"],
        confirmation_blocks=DEPLOY_CONFIRMATION_BLOCKS,
    )
    deployed_code = require_contract_code(w3, contract_address)

    save_optimized_artifacts(
        contract_name=BATTLESHIP_CONTRACT_NAME,
        abi=abi,
        bytecode=bytecode,
        address=contract_address,
    )

    deployed = w3.eth.contract(address=contract_address, abi=abi)

    print("\nDeployment complete.")
    print("  contract:", contract_address)
    print("  deployed code bytes:", len(deployed_code))
    print("  nextGameId:", deployed.functions.nextGameId().call())
    print("\nSaved artifacts:")
    print(f"  build/{BATTLESHIP_CONTRACT_NAME}.abi.json")
    print(f"  build/{BATTLESHIP_CONTRACT_NAME}.bytecode.txt")
    print(f"  build/{BATTLESHIP_CONTRACT_NAME}.address.txt")


if __name__ == "__main__":
    main()
