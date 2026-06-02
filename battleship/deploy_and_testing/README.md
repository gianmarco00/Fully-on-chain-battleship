# Battleship Python Helpers

Small deployment and contract-test scripts for `BattleshipGame`.

These scripts are for local development only. The real game frontend should use
MetaMask, not Python private keys.

Run commands from the repository root with `python -m`:

```bash
./.venv/bin/python -m battleship.deploy_and_testing.deploy
./.venv/bin/python -m battleship.deploy_and_testing.create_game
./.venv/bin/python -m battleship.deploy_and_testing.join_game 0 --wallet player2
./.venv/bin/python -m battleship.deploy_and_testing.get_game 0
./.venv/bin/python -m battleship.deploy_and_testing.smoke_test
./.venv/bin/python -m battleship.deploy_and_testing.diagnose_deployment --tx <deploy_tx_hash>
```

`smoke_test` uses deterministic test boards:

- player1 ships: A1, B2, C3
- player2 ships: B1, C2, D3

It creates a game, joins with player2, commits both board roots, plays enough
turns for player1 to hit all three player2 ships, and audits player1's board to
confirm the win.
