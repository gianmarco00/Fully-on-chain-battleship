import {
  formatDeadline,
  formatPlayer,
  formatWinner,
} from "../utils/gameState";
import type { GameStateView } from "../utils/gameState";

type GameStatePanelProps = {
  connected: boolean;
  correctChain: boolean;
  gameIdInput: string;
  onGameIdInputChange: (value: string) => void;
  onLoadGame: () => void;
  loading: boolean;
  message: string;
  gameState: GameStateView | null;
};

export function GameStatePanel({
  connected,
  correctChain,
  gameIdInput,
  onGameIdInputChange,
  onLoadGame,
  loading,
  message,
  gameState,
}: GameStatePanelProps) {

  return (
    <section className="panel-block">
      <h2>Game State</h2>

      <div className="inline-input">
        <input
          type="text"
          value={gameIdInput}
          onChange={(event) => onGameIdInputChange(event.target.value)}
          placeholder="Enter game ID"
        />
        <button
          onClick={onLoadGame}
          disabled={!connected || !correctChain || loading}
        >
          {loading ? "Loading..." : "Load Game"}
        </button>
      </div>

      {!connected && (
        <div className="warning">Connect MetaMask before loading a game.</div>
      )}

      {connected && !correctChain && (
        <div className="warning">Switch to UZHETH PoS before loading a game.</div>
      )}

      {message && <div className="warning">{message}</div>}

      {gameState && (
        <div className="state-grid">
          <div>
            <span className="label">Game ID</span>
            <strong>{gameState.gameId.toString()}</strong>
          </div>

          <div>
            <span className="label">Phase</span>
            <strong>
              {gameState.phase} ({gameState.phaseName})
            </strong>
          </div>

          <div>
            <span className="label">Player 1</span>
            <strong>{formatPlayer(gameState.player1)}</strong>
          </div>

          <div>
            <span className="label">Player 2</span>
            <strong>{formatPlayer(gameState.player2)}</strong>
          </div>

          <div>
            <span className="label">Winner</span>
            <strong>{formatWinner(gameState.winner)}</strong>
          </div>

          <div>
            <span className="label">P1 committed</span>
            <strong>{gameState.player1Committed ? "Yes" : "No"}</strong>
          </div>

          <div>
            <span className="label">P2 committed</span>
            <strong>{gameState.player2Committed ? "Yes" : "No"}</strong>
          </div>

          <div>
            <span className="label">P1 revealed</span>
            <strong>{gameState.player1Revealed ? "Yes" : "No"}</strong>
          </div>

          <div>
            <span className="label">P2 revealed</span>
            <strong>{gameState.player2Revealed ? "Yes" : "No"}</strong>
          </div>

          <div>
            <span className="label">P1 move</span>
            <strong>{gameState.player1MoveName}</strong>
          </div>

          <div>
            <span className="label">P2 move</span>
            <strong>{gameState.player2MoveName}</strong>
          </div>

          <div>
            <span className="label">Commit deadline</span>
            <strong>{formatDeadline(gameState.commitDeadline)}</strong>
          </div>

          <div>
            <span className="label">Reveal deadline</span>
            <strong>{formatDeadline(gameState.revealDeadline)}</strong>
          </div>
        </div>
      )}
    </section>
  );
}
