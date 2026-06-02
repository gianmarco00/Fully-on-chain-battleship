import { useEffect, useRef, useState } from "react";

import { watchGameEvents } from "../utils/contract";
import { devLog } from "../utils/devLog";
import {
  formatPlayer,
  gameStateKey,
  isZeroAddress,
  loadGameHeader,
  loadGameState,
  logGameStateSnapshot,
} from "../utils/gameState";
import type { BattleshipGameState } from "../utils/gameState";

type GameWindowProps = {
  gameId: bigint;
  playerAddress: string | null;
};

type LobbyView = {
  title: string;
  messages: string[];
  role: string;
};

type RefreshReason = "initial" | "poll" | "lobby-poll" | "focus" | "event";

const POLL_MS = 1000;
const LOBBY_POLL_MS = 300;
const PHASE_WAITING = 0;
const BOARD_SIZE = 5;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const GAME_STARTING_DELAY_MS = 2000;
const BOARD_CELLS = Array.from({ length: CELL_COUNT }, (_, cell) => cell);

function sameAddress(left: string | null, right: string): boolean {
  return Boolean(left && left.toLowerCase() === right.toLowerCase());
}

function cellLabel(cell: number): string {
  const column = String.fromCharCode("A".charCodeAt(0) + (cell % BOARD_SIZE));
  const row = Math.floor(cell / BOARD_SIZE) + 1;

  return `${column}${row}`;
}

function buildLobbyView(
  state: BattleshipGameState,
  playerAddress: string | null
): LobbyView {
  const player2Joined = !isZeroAddress(state.player2);

  if (sameAddress(playerAddress, state.player1)) {
    return {
      title: player2Joined ? "Player 2 joined" : "Waiting for player 2",
      messages: player2Joined
        ? ["You are player 1", "Player 2 joined"]
        : ["You are player 1", "Waiting for player 2"],
      role: "Player 1",
    };
  }

  if (player2Joined && sameAddress(playerAddress, state.player2)) {
    return {
      title: "Player 2 joined",
      messages: ["You are player 2", "Player 2 joined"],
      role: "Player 2",
    };
  }

  return {
    title: player2Joined ? "Player 2 joined" : "Waiting for player 2",
    messages: player2Joined
      ? ["Player 1 is ready", "Player 2 joined"]
      : ["Player 1 is ready", "Waiting for player 2"],
    role: "Viewer",
  };
}

export function GameWindow({ gameId, playerAddress }: GameWindowProps) {
  const [gameState, setGameState] = useState<BattleshipGameState | null>(null);
  const [lobbyView, setLobbyView] = useState<LobbyView>({
    title: "Loading game...",
    messages: [],
    role: "Viewer",
  });
  const [boardSetupReadyGameId, setBoardSetupReadyGameId] = useState<string | null>(
    null
  );
  const lastStateKey = useRef<string | null>(null);
  const latestPhase = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    let requestInFlight = false;
    let queuedRefreshReason: Exclude<RefreshReason, "initial"> | null = null;

    async function loadWindowState(reason: RefreshReason) {
      if (requestInFlight) {
        queuedRefreshReason = reason === "initial" ? "poll" : reason;
        return;
      }

      requestInFlight = true;

      try {
        const state =
          reason === "lobby-poll" && latestPhase.current === PHASE_WAITING
            ? await loadGameHeader(gameId)
            : await loadGameState(gameId);
        const nextLobbyView = buildLobbyView(state, playerAddress);

        if (!alive) return;

        latestPhase.current = state.phase;
        setGameState(state);
        setLobbyView(nextLobbyView);

        const nextStateKey = gameStateKey(state);

        if (lastStateKey.current !== nextStateKey) {
          lastStateKey.current = nextStateKey;
          logGameStateSnapshot("gameWindow:stateChanged", state, {
            reason,
            windowPlayerAddress: playerAddress,
            windowRole: nextLobbyView.role,
          });
        }

        if (reason === "initial") {
          devLog("gameWindow:ready", {
            gameId,
            windowPlayerAddress: playerAddress,
            role: nextLobbyView.role,
          });
        }
      } catch (error) {
        if (!alive) return;

        setLobbyView({
          title: error instanceof Error ? error.message : "Failed to load game.",
          messages: [],
          role: "Viewer",
        });
        devLog("gameWindow:load:error", { gameId, playerAddress, reason, error });
      } finally {
        requestInFlight = false;

        if (alive && queuedRefreshReason) {
          const nextReason = queuedRefreshReason;
          queuedRefreshReason = null;
          loadWindowState(nextReason);
        }
      }
    }

    loadWindowState("initial");

    const intervalId = window.setInterval(() => {
      if (latestPhase.current !== PHASE_WAITING) {
        loadWindowState("poll");
      }
    }, POLL_MS);

    const lobbyIntervalId = window.setInterval(() => {
      if (latestPhase.current === PHASE_WAITING) {
        loadWindowState("lobby-poll");
      }
    }, LOBBY_POLL_MS);

    function refreshOnFocus() {
      loadWindowState("focus");
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        loadWindowState("focus");
      }
    }

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    const stopWatchingEvents = watchGameEvents(
      gameId,
      ({ eventName, transactionHash }) => {
        devLog("gameWindow:event:received", {
          gameId,
          windowPlayerAddress: playerAddress,
          eventName,
          transactionHash,
        });
        loadWindowState("event");
      }
    );

    return () => {
      alive = false;
      window.clearInterval(intervalId);
      window.clearInterval(lobbyIntervalId);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      stopWatchingEvents();
    };
  }, [gameId, playerAddress]);

  const gameStarting = gameState ? !isZeroAddress(gameState.player2) : false;
  const boardSetupVisible =
    gameStarting && boardSetupReadyGameId === gameId.toString();

  useEffect(() => {
    if (!gameStarting) {
      return;
    }

    const gameIdText = gameId.toString();

    devLog("gameWindow:boardSetup:scheduled", {
      gameId,
      windowPlayerAddress: playerAddress,
      delayMs: GAME_STARTING_DELAY_MS,
    });

    const timeoutId = window.setTimeout(() => {
      setBoardSetupReadyGameId(gameIdText);
      devLog("gameWindow:boardSetup:visible", {
        gameId,
        windowPlayerAddress: playerAddress,
      });
    }, GAME_STARTING_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [gameId, gameStarting, playerAddress]);

  function handleBoardCellClick(cell: number) {
    devLog("gameWindow:boardSetup:cellClick", {
      gameId,
      windowPlayerAddress: playerAddress,
      cell,
      label: cellLabel(cell),
    });
  }

  if (gameStarting && !boardSetupVisible) {
    return (
      <main className="page game-window-page">
        <section className="card game-window-card game-starting-card">
          <h1>Game Starting...</h1>
        </section>
      </main>
    );
  }

  if (gameStarting && boardSetupVisible) {
    return (
      <main className="page game-window-page">
        <section className="card game-window-card">
          <p className="eyebrow">Game {gameId.toString()}</p>
          <h1>Position your fleet</h1>

          <div className="fleet-board" aria-label="Battleship board">
            {BOARD_CELLS.map((cell) => (
              <button
                key={cell}
                type="button"
                className="board-cell"
                onClick={() => handleBoardCellClick(cell)}
                aria-label={`Cell ${cellLabel(cell)}`}
              >
                {cellLabel(cell)}
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page game-window-page">
      <section className="card game-window-card">
        <p className="eyebrow">Game {gameId.toString()}</p>
        <h1>{lobbyView.title}</h1>

        {lobbyView.messages.length > 0 && (
          <div className="lobby-messages">
            {lobbyView.messages.map((message, index) => (
              <div key={`${message}-${index}`}>{message}</div>
            ))}
          </div>
        )}

        {gameState && (
          <div className="panel">
            <div>
              <span className="label">Your role</span>
              <strong>{lobbyView.role}</strong>
            </div>
            <div>
              <span className="label">Phase</span>
              <strong>{gameState.phaseName}</strong>
            </div>
            <div>
              <span className="label">Player 1</span>
              <strong>{formatPlayer(gameState.player1)}</strong>
            </div>
            <div>
              <span className="label">Player 2</span>
              <strong>{formatPlayer(gameState.player2)}</strong>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
