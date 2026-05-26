import json
from pathlib import Path
from typing import Any

from solcx import compile_standard, install_solc
from web3 import Web3

from rps_backend.utils.config import BUILD_DIR, CONTRACTS_DIR

SOLC_VERSION = "0.8.20"


def artifact_paths(contract_name: str) -> dict[str, Path]:
    """
    Return the standard artifact paths for a deployed/compiled contract.
    """
    return {
        "abi": BUILD_DIR / f"{contract_name}.abi.json",
        "bytecode": BUILD_DIR / f"{contract_name}.bytecode.txt",
        "address": BUILD_DIR / f"{contract_name}.address.txt",
    }


def compile_contract(contract_file: str, contract_name: str) -> tuple[list[dict[str, Any]], str]:
    """
    Compile a Solidity contract from contracts/<contract_file>.

    Returns:
        abi, bytecode
    """
    contract_path = CONTRACTS_DIR / contract_file

    if not contract_path.exists():
        raise FileNotFoundError(f"Contract file not found: {contract_path}")

    install_solc(SOLC_VERSION)

    source_code = contract_path.read_text()

    compiled = compile_standard(
        {
            "language": "Solidity",
            "sources": {
                contract_file: {
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

    contract_interface = compiled["contracts"][contract_file][contract_name]
    abi = contract_interface["abi"]
    bytecode = contract_interface["evm"]["bytecode"]["object"]

    if not bytecode:
        raise RuntimeError(f"No bytecode produced for {contract_name}")

    return abi, bytecode


def save_artifacts(
    *,
    contract_name: str,
    abi: list[dict[str, Any]],
    bytecode: str,
    address: str | None = None,
) -> None:
    """
    Save ABI, bytecode, and optionally deployed address to build/.
    """
    BUILD_DIR.mkdir(exist_ok=True)

    paths = artifact_paths(contract_name)
    paths["abi"].write_text(json.dumps(abi, indent=2))
    paths["bytecode"].write_text(bytecode)

    if address is not None:
        paths["address"].write_text(Web3.to_checksum_address(address))


def load_abi(contract_name: str) -> list[dict[str, Any]]:
    """
    Load contract ABI from build/.
    """
    path = artifact_paths(contract_name)["abi"]

    if not path.exists():
        raise FileNotFoundError(f"ABI not found: {path}")

    return json.loads(path.read_text())


def load_address(contract_name: str) -> str:
    """
    Load deployed contract address from build/.
    """
    path = artifact_paths(contract_name)["address"]

    if not path.exists():
        raise FileNotFoundError(f"Contract address not found: {path}")

    return Web3.to_checksum_address(path.read_text().strip())


def load_contract(w3: Web3, contract_name: str):
    """
    Load a deployed contract using build/<contract>.abi.json and
    build/<contract>.address.txt.
    """
    abi = load_abi(contract_name)
    address = load_address(contract_name)
    return w3.eth.contract(address=address, abi=abi)