# Fully On-Chain Battleship

A playable Web3 Battleship game where the full game logic runs on-chain.

Players create and join games through MetaMask, commit hidden boards with Merkle roots, attack cells through blockchain transactions, automatically reveal attacked cells with Merkle proofs, and finish the game through an on-chain audit that validates the winner's board.

The project was built for the UZH Blockchain Programming Seminar 2025.

## What This Project Shows

Most Web3 games keep game logic on a centralized server and only store assets on-chain. This project takes the opposite approach.

The smart contract handles:

- game creation and joining
- board commitment
- verifiable random first attacker selection
- turn order
- attack and reveal phases
- hit tracking
- timeouts
- final board audit
- winner assignment

The frontend improves usability, but it is not trusted for correctness. Critical rules are enforced by the Solidity contract.

## Core Ideas

### Hidden Boards

Each player places a classic Battleship fleet on a 10x10 board.

The frontend converts the board into 100 Merkle leaves and commits only the Merkle root on-chain. The full board remains hidden during gameplay.

When a cell is attacked, the defender reveals only that cell with:

- cell index
- hit or miss value
- cell salt
- Merkle proof

The contract verifies that the revealed cell matches the original committed board.

### Verifiable Randomness

Player 1 does not always move first.

Both players commit to a private random secret, then reveal it after both boards are committed. The contract combines both secrets and chooses the first attacker from the resulting random seed.

### Final Audit

When a player reaches 17 hits, they become the provisional winner.

The provisional winner must reveal their master salt and ship placements. The contract reconstructs the board, checks that the fleet is valid, recomputes the Merkle root, and compares it to the original commitment.

If the audit succeeds, the provisional winner wins. If it fails, the opponent wins.

## Repository Structure

```text
contracts/
  BattleshipGame.sol
    Core Solidity smart contract.

battleship/frontend/
  React + Vite + TypeScript frontend.
  Uses MetaMask and viem to interact with the deployed contract.

battleship/deploy_and_testing/
  Python scripts for deployment, diagnostics, smoke testing, and gas reporting.

rps_frontend/
rps_backend/
  Earlier Rock Paper Scissors prototype used as a learning step before Battleship.
```

## Deployed Contract

Latest deployed Battleship contract:

```text
0xE83Fb5FE5d2E3dBa06187d8eECa7580A4b4b2E3c
```

Network:

```text
UZHETH PoS
Chain ID: 70207
RPC: http://130.60.144.77:8554/
Currency: UZHETHs
```

## Running the Frontend

Clone the repository:

```bash
git clone https://gitlab.uzh.ch/gianmarco.albano/blockchain_game
cd blockchain_game/battleship/frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL printed by Vite, for example:

```text
http://127.0.0.1:5173/
```

Use two browser windows or profiles with two different MetaMask accounts to play a full game.

## How to Play

1. Connect MetaMask.
2. Player 1 creates a game.
3. Player 2 joins using the game ID.
4. Both players place their ships.
5. Both players commit their board roots and randomness commitments.
6. The contract chooses the first attacker.
7. Players attack cells in turns.
8. The defender automatically reveals the attacked cell.
9. Hits and misses are displayed in both windows.
10. When all 17 ship cells of one player are hit, the audit phase starts.
11. The contract validates the provisional winner's board.
12. The winner and loser screens are shown.

## Running the Smoke Test

The smoke test executes a full game directly against the deployed contract.

From the repository root:

```bash
python -m battleship.deploy_and_testing.smoke_test
```

The smoke test checks:

- game creation
- joining
- board commitment
- randomness reveal
- random first attacker selection
- attack and reveal turns
- Merkle proof verification
- hit tracking
- final audit
- winner assignment

It also prints a gas usage summary for the main contract actions.

## Deployment

To deploy the contract:

```bash
python -m battleship.deploy_and_testing.deploy
```

The deployment script compiles the contract, deploys it to the configured UZHETH PoS RPC, and saves the ABI, bytecode, and deployed address in the `build/` folder.

## Security Model

The frontend is not trusted.

A modified frontend cannot legally change the game result because the contract validates:

- player roles
- phase transitions
- board commitments
- Merkle proofs
- randomness commitments
- hit tracking
- ship placement rules
- audit results
- timeout claims

Known limitation: players must keep their local board secret. If a player loses their local secret, they cannot correctly reveal cells or pass the final audit.

## Main Technologies

- Solidity
- React
- Vite
- TypeScript
- viem
- MetaMask
- Python
- Web3.py

## Authors

Valeria Cerciello  
Gianmarco Albano
