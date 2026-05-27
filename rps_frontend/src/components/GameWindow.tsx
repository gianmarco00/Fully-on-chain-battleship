import { useEffect, useRef, useState } from "react";

import {
  formatPlayer,
  gameStateKey,
  isZeroAddress,
  loadGameState,
  logGameStateSnapshot,
} from "../utils/gameState";
import type { GameStateView } from "../utils/gameState";
import { commitMoveForGame } from "../utils/commitMove";
import { revealMoveForGame } from "../utils/revealMove";
import type { MoveInput } from "../utils/commit";
import { devLog } from "../utils/devLog";
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

type FinishedView = {
  title: string;
  message: string;
  result: "win" | "lose" | "draw" | "viewer";
};

const POLL_MS = 1000;
const PHASE_COMMIT = 1;
const PHASE_REVEAL = 2;
const PHASE_FINISHED = 3;
const CLOSE_AFTER_FINISH_MS = 5000;

const MOVES = [
  { label: "Rock", value: "rock" },
  { label: "Paper", value: "paper" },
  { label: "Scissors", value: "scissors" },
] as const;

function sameAddress(left: string | null, right: string): boolean {
  return Boolean(left && left.toLowerCase() === right.toLowerCase());
}

function playerRole(
  state: GameStateView,
  playerAddress: string | null
): "player1" | "player2" | null {
  if (sameAddress(playerAddress, state.player1)) return "player1";
  if (sameAddress(playerAddress, state.player2)) return "player2";
  return null;
}

function playerCommitted(
  state: GameStateView,
  role: "player1" | "player2" | null
): boolean {
  if (role === "player1") return state.player1Committed;
  if (role === "player2") return state.player2Committed;
  return false;
}

function playerRevealed(
  state: GameStateView,
  role: "player1" | "player2" | null
): boolean {
  if (role === "player1") return state.player1Revealed;
  if (role === "player2") return state.player2Revealed;
  return false;
}

function buildLobbyView(
  state: GameStateView,
  playerAddress: string | null
): LobbyView {
  const player2Joined = !isZeroAddress(state.player2);

  if (sameAddress(playerAddress, state.player1)) {
    const messages = ["You have joined the lobby"];

    if (player2Joined) {
      messages.push("Second player has joined the lobby", "Game starting");
    } else {
      messages.push("Waiting for player 2...");
    }

    return {
      title: player2Joined ? "Game starting" : "You have joined the lobby",
      messages,
      role: "Player 1",
    };
  }

  if (player2Joined && sameAddress(playerAddress, state.player2)) {
    return {
      title: "Game starting",
      messages: ["You have joined the lobby", "Game starting"],
      role: "Player 2",
    };
  }

  return {
    title: player2Joined ? "Game starting" : "Player 1 has joined the lobby",
    messages: player2Joined
      ? [
          "Player 1 has joined the lobby",
          "Player 2 has joined the lobby",
          "Game starting",
        ]
      : ["Player 1 has joined the lobby", "Waiting for player 2..."],
    role: "Viewer",
  };
}

function buildFinishedView(
  state: GameStateView,
  playerAddress: string | null
): FinishedView {
  if (isZeroAddress(state.winner)) {
    return {
      title: "Draw",
      message: "Both players revealed the same strength. Nobody wins this round.",
      result: "draw",
    };
  }

  if (sameAddress(playerAddress, state.winner)) {
    return {
      title: "You win!",
      message: "The smart contract recorded you as the winner.",
      result: "win",
    };
  }

  if (playerRole(state, playerAddress)) {
    return {
      title: "You lose.",
      message: "The other player won this round.",
      result: "lose",
    };
  }

  return {
    title: "Game finished",
    message: `Winner: ${formatPlayer(state.winner)}`,
    result: "viewer",
  };
}

export function GameWindow({ gameId, playerAddress }: GameWindowProps) {
  const [gameState, setGameState] = useState<GameStateView | null>(null);
  const [lobbyView, setLobbyView] = useState<LobbyView>({
    title: "Loading game...",
    messages: [],
    role: "Viewer",
  });
  const [commitMessage, setCommitMessage] = useState("");
  const [commitError, setCommitError] = useState("");
  const [committing, setCommitting] = useState(false);
  const [revealMessage, setRevealMessage] = useState("");
  const [revealError, setRevealError] = useState("");
  const lastStateKey = useRef<string | null>(null);
  const revealAttemptKey = useRef<string | null>(null);
  const revealInFlight = useRef(false);
  const closeAfterFinishStarted = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let requestInFlight = false;

    async function loadWindowState(reason: "initial" | "poll" | "focus") {
      if (requestInFlight) return;

      requestInFlight = true;

      try {
        const state = await loadGameState(gameId);
        const nextLobbyView = buildLobbyView(state, playerAddress);

        if (!alive) return;

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
      }
    }

    loadWindowState("initial");

    // The blockchain is the source of truth, so the popup refreshes by reading it.
    const intervalId = window.setInterval(() => {
      loadWindowState("poll");
    }, POLL_MS);

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

    return () => {
      alive = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [gameId, playerAddress]);

  async function handleCommitMove(move: MoveInput) {
    if (!playerAddress || !gameState) {
      setCommitError("Game or player is not ready yet.");
      devLog("gameWindow:commit:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        reason: "missing game state or player address",
      });
      return;
    }

    const accounts = await getCurrentAccounts();
    const activeAccount = accounts[0] ?? null;
    const role = playerRole(gameState, playerAddress);

    logGameStateSnapshot("gameWindow:commit:clicked", gameState, {
      windowPlayerAddress: playerAddress,
      activeAccount,
      activeAccountMatchesWindowPlayer: sameAddress(activeAccount, playerAddress),
      role,
    });

    if (!role) {
      setCommitError("This popup does not belong to a player in this game.");
      devLog("gameWindow:commit:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        activeAccount,
        reason: "viewer cannot commit",
      });
      return;
    }

    if (gameState.phase !== PHASE_COMMIT) {
      setCommitError(`Cannot commit while phase is ${gameState.phaseName}.`);
      devLog("gameWindow:commit:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        activeAccount,
        role,
        phase: gameState.phaseName,
        reason: "wrong phase",
      });
      return;
    }

    if (playerCommitted(gameState, role)) {
      setCommitError("This player has already committed a move.");
      devLog("gameWindow:commit:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        activeAccount,
        role,
        reason: "already committed",
      });
      return;
    }

    try {
      setCommitting(true);
      setCommitError("");
      setCommitMessage("Sending hidden move commitment...");

      const result = await commitMoveForGame({ gameId, move, playerAddress });

      const refreshedState = await loadGameState(gameId);
      const refreshedRole = playerRole(refreshedState, playerAddress);
      const registered = playerCommitted(refreshedState, refreshedRole);

      setGameState(refreshedState);
      setLobbyView(buildLobbyView(refreshedState, playerAddress));
      setCommitMessage("Move committed. Waiting for the other player...");

      logGameStateSnapshot("gameWindow:commit:stateAfter", refreshedState, {
        windowPlayerAddress: playerAddress,
        role: result.role,
        txHash: result.txHash,
        registered,
      });
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "Commit failed.");
      setCommitMessage("");
      devLog("gameWindow:commit:error", {
        gameId,
        windowPlayerAddress: playerAddress,
        error,
      });
    } finally {
      setCommitting(false);
    }
  }

  const role = gameState ? playerRole(gameState, playerAddress) : null;
  const inCommitPhase = gameState?.phase === PHASE_COMMIT;
  const inRevealPhase = gameState?.phase === PHASE_REVEAL;
  const inFinishedPhase = gameState?.phase === PHASE_FINISHED;
  const alreadyCommitted = gameState ? playerCommitted(gameState, role) : false;
  const alreadyRevealed = gameState ? playerRevealed(gameState, role) : false;
  const finishedView = gameState ? buildFinishedView(gameState, playerAddress) : null;

  useEffect(() => {
    if (!inFinishedPhase || closeAfterFinishStarted.current) return;

    closeAfterFinishStarted.current = true;
    devLog("gameWindow:finished:closeScheduled", {
      gameId,
      windowPlayerAddress: playerAddress,
      closeAfterMs: CLOSE_AFTER_FINISH_MS,
    });

    const timeoutId = window.setTimeout(() => {
      devLog("gameWindow:finished:closeNow", {
        gameId,
        windowPlayerAddress: playerAddress,
      });
      window.close();
    }, CLOSE_AFTER_FINISH_MS);

    return () => window.clearTimeout(timeoutId);
  }, [gameId, inFinishedPhase, playerAddress]);

  useEffect(() => {
    if (
      !gameState ||
      !playerAddress ||
      !role ||
      !inRevealPhase ||
      alreadyRevealed ||
      revealInFlight.current
    ) {
      return;
    }

    const revealPlayerAddress = playerAddress;
    const revealRole = role;
    const revealState = gameState;
    const attemptKey = `${gameId.toString()}:${revealPlayerAddress.toLowerCase()}`;

    if (revealAttemptKey.current === attemptKey) return;

    revealAttemptKey.current = attemptKey;

    async function revealNow() {
      devLog("gameWindow:reveal:autoStart", {
        gameId,
        windowPlayerAddress: revealPlayerAddress,
        role: revealRole,
      });
      logGameStateSnapshot("gameWindow:reveal:stateBefore", revealState, {
        windowPlayerAddress: revealPlayerAddress,
        role: revealRole,
      });

      try {
        revealInFlight.current = true;
        setRevealError("");
        setRevealMessage("Waiting for MetaMask confirmation...");

        const result = await revealMoveForGame({
          gameId,
          playerAddress: revealPlayerAddress,
        });
        const refreshedState = await loadGameState(gameId);

        if (!mounted.current) return;

        setGameState(refreshedState);
        setLobbyView(buildLobbyView(refreshedState, revealPlayerAddress));
        setRevealMessage(
          result.gameEnded
            ? "Move revealed. Game finished."
            : "Move revealed. Waiting for the other player..."
        );

        logGameStateSnapshot("gameWindow:reveal:stateAfter", refreshedState, {
          windowPlayerAddress: revealPlayerAddress,
          role: result.role,
          txHash: result.txHash,
          revealed: result.revealed,
          gameEnded: result.gameEnded,
        });
      } catch (error) {
        if (!mounted.current) return;

        setRevealMessage("");
        setRevealError(error instanceof Error ? error.message : "Reveal failed.");
        devLog("gameWindow:reveal:error", {
          gameId,
          windowPlayerAddress: revealPlayerAddress,
          role: revealRole,
          error,
        });
      } finally {
        revealInFlight.current = false;
      }
    }

    revealNow();
  }, [
    alreadyRevealed,
    gameId,
    gameState,
    inRevealPhase,
    playerAddress,
    role,
  ]);

  return (
    <main className="page game-window-page">
      <section className="card game-window-card">
        <p className="eyebrow">Game {gameId.toString()}</p>

        {inFinishedPhase && finishedView && gameState ? (
          <div className={`finish-screen finish-screen-${finishedView.result}`}>
            <h1>{finishedView.title}</h1>
            <p>{finishedView.message}</p>

            <div className="finish-details">
              <div>
                <span className="label">player1 move</span>
                <strong>{gameState.player1MoveName}</strong>
              </div>
              <div>
                <span className="label">player2 move</span>
                <strong>{gameState.player2MoveName}</strong>
              </div>
            </div>

            <div className="success">This game window will close in 5 seconds.</div>
          </div>
        ) : inRevealPhase ? (
          <>
            <h1>{alreadyRevealed ? "Move revealed" : "please reveal your move"}</h1>

            {revealMessage && <div className="success">{revealMessage}</div>}
            {revealError && <div className="warning">{revealError}</div>}
          </>
        ) : inCommitPhase ? (
          <>
            <h1>{alreadyCommitted ? "Move committed" : "Choose your move"}</h1>

            <div className="move-buttons">
              {MOVES.map((move) => (
                <button
                  key={move.value}
                  onClick={() => handleCommitMove(move.value)}
                  disabled={committing || alreadyCommitted || !role}
                >
                  {move.label}
                </button>
              ))}
            </div>

            {commitMessage && <div className="success">{commitMessage}</div>}
            {commitError && <div className="warning">{commitError}</div>}
          </>
        ) : (
          <>
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
                  <span className="label">your role</span>
                  <strong>{lobbyView.role}</strong>
                </div>
                <div>
                  <span className="label">player1</span>
                  <strong>{formatPlayer(gameState.player1)}</strong>
                </div>
                <div>
                  <span className="label">player2</span>
                  <strong>{formatPlayer(gameState.player2)}</strong>
                </div>
              </div>
            )}
          </>
        )}

        {inCommitPhase && gameState && (
          <div className="commit-status">
            <div>
              <span className="label">your role</span>
              <strong>{role ?? "Viewer"}</strong>
            </div>
            <div>
              <span className="label">on-chain status</span>
              <strong>{alreadyCommitted ? "Committed" : "Not committed"}</strong>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
