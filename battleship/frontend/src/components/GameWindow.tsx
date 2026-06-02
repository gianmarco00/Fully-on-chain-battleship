import { useEffect, useRef, useState } from "react";

import {
  commitBoard,
  readBoardRoots,
  waitForTransaction,
  watchGameEvents,
} from "../utils/contract";
import {
  CELL_COUNT,
  SHIP_COUNT,
  buildBoardSecret,
  cellLabel,
  loadBoardSecret,
  saveBoardSecret,
} from "../utils/board";
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
import { getCurrentAccounts } from "../utils/wallet";

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
const PHASE_BOARD_SETUP = 1;
const PHASE_ATTACK = 2;
const GAME_STARTING_DELAY_MS = 2000;
const BOARD_CELLS = Array.from({ length: CELL_COUNT }, (_, cell) => cell);

function sameAddress(left: string | null, right: string): boolean {
  return Boolean(left && left.toLowerCase() === right.toLowerCase());
}

function playerRole(
  state: BattleshipGameState,
  playerAddress: string | null
): "player1" | "player2" | null {
  if (sameAddress(playerAddress, state.player1)) return "player1";
  if (sameAddress(playerAddress, state.player2)) return "player2";
  return null;
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
  const [selectedShipCells, setSelectedShipCells] = useState<number[]>([]);
  const [committingBoard, setCommittingBoard] = useState(false);
  const [boardCommitMessage, setBoardCommitMessage] = useState("");
  const [boardCommitError, setBoardCommitError] = useState("");
  const [savedShipCells, setSavedShipCells] = useState<number[]>(() =>
    playerAddress ? (loadBoardSecret(gameId, playerAddress)?.shipCells ?? []) : []
  );
  const [selectedAttackCell, setSelectedAttackCell] = useState<number | null>(null);
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

  const gameStarting =
    gameState?.phase === PHASE_BOARD_SETUP && !isZeroAddress(gameState.player2);
  const boardSetupVisible =
    gameStarting && boardSetupReadyGameId === gameId.toString();
  const currentRole = gameState ? playerRole(gameState, playerAddress) : null;
  const currentPlayerBoardCommitted =
    currentRole === "player1"
      ? Boolean(gameState?.player1BoardCommitted)
      : currentRole === "player2"
        ? Boolean(gameState?.player2BoardCommitted)
        : false;
  const attackPhaseVisible = gameState?.phase === PHASE_ATTACK;
  const currentPlayerIsAttacker = Boolean(
    gameState && sameAddress(playerAddress, gameState.currentAttacker)
  );
  const ownShipCells = savedShipCells.length > 0 ? savedShipCells : selectedShipCells;

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

  async function commitSelectedBoard(shipCells: number[]) {
    if (!gameState || !playerAddress) {
      setBoardCommitError("Game or player is not ready yet.");
      devLog("gameWindow:boardCommit:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        reason: "missing game state or player address",
      });
      return;
    }

    const role = playerRole(gameState, playerAddress);

    if (!role) {
      setBoardCommitError("This game window does not belong to a player.");
      devLog("gameWindow:boardCommit:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        reason: "viewer cannot commit board",
      });
      return;
    }

    const alreadyCommitted =
      role === "player1"
        ? gameState.player1BoardCommitted
        : gameState.player2BoardCommitted;

    if (alreadyCommitted) {
      setBoardCommitError("This player has already committed a board.");
      devLog("gameWindow:boardCommit:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        role,
        reason: "board already committed",
      });
      return;
    }

    const accounts = await getCurrentAccounts();
    const activeAccount = accounts[0] ?? null;

    if (!sameAddress(activeAccount, playerAddress)) {
      setBoardCommitError("Switch MetaMask to this player before committing.");
      devLog("gameWindow:boardCommit:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        activeAccount,
        role,
        reason: "active account does not match window player",
      });
      return;
    }

    const boardSecret = buildBoardSecret({
      gameId,
      playerAddress,
      shipCells,
    });

    try {
      setCommittingBoard(true);
      setBoardCommitError("");
      setBoardCommitMessage("Committing board root...");

      saveBoardSecret(boardSecret);
      setSavedShipCells(boardSecret.shipCells);
      devLog("gameWindow:boardCommit:prepared", {
        gameId,
        windowPlayerAddress: playerAddress,
        role,
        shipCells,
        shipMask: boardSecret.shipMask,
        boardRoot: boardSecret.root,
      });

      const txHash = await commitBoard(gameId, boardSecret.root, playerAddress);
      setBoardCommitMessage("Board transaction sent. Waiting for confirmation...");
      devLog("gameWindow:boardCommit:txSent", {
        gameId,
        windowPlayerAddress: playerAddress,
        role,
        txHash,
        boardRoot: boardSecret.root,
      });

      await waitForTransaction(txHash);

      const boardRoots = await readBoardRoots(gameId);
      const committedRoot = String(role === "player1" ? boardRoots[0] : boardRoots[1]);
      const matches = committedRoot.toLowerCase() === boardSecret.root.toLowerCase();

      devLog("gameWindow:boardCommit:verified", {
        gameId,
        windowPlayerAddress: playerAddress,
        role,
        expectedRoot: boardSecret.root,
        committedRoot,
        matches,
      });

      if (!matches) {
        throw new Error("Committed board root did not match local board root.");
      }

      const refreshedState = await loadGameState(gameId);
      setGameState(refreshedState);
      setBoardCommitMessage("Board committed successfully.");
    } catch (error) {
      setBoardCommitMessage("");
      setBoardCommitError(
        error instanceof Error ? error.message : "Board commit failed."
      );
      devLog("gameWindow:boardCommit:error", {
        gameId,
        windowPlayerAddress: playerAddress,
        boardRoot: boardSecret.root,
        error,
      });
    } finally {
      setCommittingBoard(false);
    }
  }

  function handleBoardCellClick(cell: number) {
    if (committingBoard || currentPlayerBoardCommitted) return;

    devLog("gameWindow:boardSetup:cellClick", {
      gameId,
      windowPlayerAddress: playerAddress,
      cell,
      label: cellLabel(cell),
    });

    if (selectedShipCells.includes(cell)) {
      const nextCells = selectedShipCells.filter((shipCell) => shipCell !== cell);
      setSelectedShipCells(nextCells);
      setBoardCommitMessage("");
      setBoardCommitError("");
      return;
    }

    if (selectedShipCells.length >= SHIP_COUNT) return;

    const nextCells = [...selectedShipCells, cell];
    setSelectedShipCells(nextCells);
    setBoardCommitMessage("");
    setBoardCommitError("");

    if (nextCells.length === SHIP_COUNT) {
      commitSelectedBoard(nextCells).catch((error) => {
        devLog("gameWindow:boardCommit:unhandledError", {
          gameId,
          windowPlayerAddress: playerAddress,
          error,
        });
      });
    }
  }

  function handleAttackCellClick(cell: number) {
    if (!attackPhaseVisible || !currentPlayerIsAttacker) return;

    setSelectedAttackCell(cell);
    devLog("gameWindow:attack:cellClick", {
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

  if (attackPhaseVisible) {
    if (currentPlayerIsAttacker) {
      return (
        <main className="page game-window-page">
          <section className="card game-window-card combat-window-card">
            <h1>Attack</h1>

            <div className="fleet-board attack-board" aria-label="Enemy board">
              {BOARD_CELLS.map((cell) => (
                <button
                  key={cell}
                  type="button"
                  className={
                    selectedAttackCell === cell
                      ? "board-cell board-cell-attackable board-cell-targeted"
                      : "board-cell board-cell-attackable"
                  }
                  onClick={() => handleAttackCellClick(cell)}
                  aria-label={`Attack ${cellLabel(cell)}`}
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
        <section className="card game-window-card combat-window-card">
          <h1>Waiting to be attacked</h1>

          <div className="fleet-board own-board" aria-label="Your board">
            {BOARD_CELLS.map((cell) => (
              <div
                key={cell}
                className={
                  ownShipCells.includes(cell)
                    ? "board-cell board-cell-readonly board-cell-selected"
                    : "board-cell board-cell-readonly"
                }
                aria-label={`Cell ${cellLabel(cell)}`}
              >
                {cellLabel(cell)}
              </div>
            ))}
          </div>
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
                className={
                  selectedShipCells.includes(cell)
                    ? "board-cell board-cell-selected"
                    : "board-cell"
                }
                onClick={() => handleBoardCellClick(cell)}
                disabled={committingBoard || currentPlayerBoardCommitted}
                aria-label={`Cell ${cellLabel(cell)}`}
              >
                {cellLabel(cell)}
              </button>
            ))}
          </div>

          <div className="board-setup-status">
            <span className="label">Ships selected</span>
            <strong>
              {selectedShipCells.length} / {SHIP_COUNT}
            </strong>
          </div>

          {currentPlayerBoardCommitted && (
            <div className="success">Board already committed.</div>
          )}
          {boardCommitMessage && <div className="success">{boardCommitMessage}</div>}
          {boardCommitError && <div className="warning">{boardCommitError}</div>}
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
