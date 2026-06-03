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

`smoke_test` uses deterministic 10x10 classic Battleship boards:

- player1 placements: A1:H, A3:H, A5:H, E5:H, A7:H
- player2 placements: A2:H, A4:H, A6:H, E6:H, A8:H

It creates a game, joins with player2, commits both board roots, plays enough
turns for player1 to hit all 17 player2 ship cells, and audits player1's board
with `masterSalt + ship placements` to confirm the win.
