import type { BattleshipGameState } from "../utils/gameState";

type GameStatePanelProps = {
  gameState: BattleshipGameState | null;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function formatAddress(address: string): string {
  if (address.toLowerCase() === ZERO_ADDRESS) return "None";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatRoot(root: string, committed: boolean): string {
  if (!committed) return "Not committed";
  return `${root.slice(0, 10)}...${root.slice(-8)}`;
}

function formatDeadline(deadline: bigint): string {
  if (deadline === 0n) return "Not set";

  const milliseconds = Number(deadline) * 1000;
  return new Date(milliseconds).toLocaleString();
}

function formatMask(mask: number): string {
  return `0x${mask.toString(16)}`;
}

export function GameStatePanel({ gameState }: GameStatePanelProps) {
  if (!gameState) return null;

  return (
    <div className="game-state-panel">
      <h3>Game {gameState.gameId.toString()}</h3>

      <div className="state-grid">
        <div>
          <span className="label">Phase</span>
          <strong>
            {gameState.phase} ({gameState.phaseName})
          </strong>
        </div>

        <div>
          <span className="label">Player 1</span>
          <strong>{formatAddress(gameState.player1)}</strong>
        </div>

        <div>
          <span className="label">Player 2</span>
          <strong>{formatAddress(gameState.player2)}</strong>
        </div>

        <div>
          <span className="label">Winner</span>
          <strong>{formatAddress(gameState.winner)}</strong>
        </div>

        <div>
          <span className="label">Current attacker</span>
          <strong>{formatAddress(gameState.currentAttacker)}</strong>
        </div>

        <div>
          <span className="label">Pending target</span>
          <strong>{gameState.pendingTarget}</strong>
        </div>

        <div>
          <span className="label">Provisional winner</span>
          <strong>{formatAddress(gameState.provisionalWinner)}</strong>
        </div>

        <div>
          <span className="label">Action deadline</span>
          <strong>{formatDeadline(gameState.actionDeadline)}</strong>
        </div>

        <div>
          <span className="label">Player 1 board</span>
          <strong>
            {formatRoot(gameState.boardRoot1, gameState.player1BoardCommitted)}
          </strong>
        </div>

        <div>
          <span className="label">Player 2 board</span>
          <strong>
            {formatRoot(gameState.boardRoot2, gameState.player2BoardCommitted)}
          </strong>
        </div>

        <div>
          <span className="label">Player 1 hits received</span>
          <strong>
            {gameState.hitCount1} ({formatMask(gameState.hitMask1)})
          </strong>
        </div>

        <div>
          <span className="label">Player 2 hits received</span>
          <strong>
            {gameState.hitCount2} ({formatMask(gameState.hitMask2)})
          </strong>
        </div>
      </div>
    </div>
  );
}
