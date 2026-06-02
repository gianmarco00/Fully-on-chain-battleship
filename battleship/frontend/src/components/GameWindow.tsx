import { useEffect, useRef, useState } from "react";

import {
  attackCell,
  claimTimeout,
  commitBoard,
  readBoardRoots,
  readCellRevealedLogsFromReceipt,
  revealCell,
  revealFinalBoard,
  waitForTransaction,
  watchGameEvents,
} from "../utils/contract";
import {
  CELL_COUNT,
  SHIP_COUNT,
  buildBoardSecret,
  buildMerkleProof,
  cellLabel,
  hasShip,
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
import {
  loadShotResults,
  saveShotResult,
  shotResultForBoard,
} from "../utils/shotResults";
import type { ShotResult } from "../utils/shotResults";

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
const PHASE_CELL_REVEAL = 3;
const PHASE_AUDIT = 4;
const PHASE_FINISHED = 5;
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
  const [setupTimeoutMessage, setSetupTimeoutMessage] = useState("");
  const [setupTimeoutError, setSetupTimeoutError] = useState("");
  const [savedShipCells, setSavedShipCells] = useState<number[]>(() =>
    playerAddress ? (loadBoardSecret(gameId, playerAddress)?.shipCells ?? []) : []
  );
  const [selectedAttackCell, setSelectedAttackCell] = useState<number | null>(null);
  const [attackingCell, setAttackingCell] = useState<number | null>(null);
  const [attackMessage, setAttackMessage] = useState("");
  const [attackError, setAttackError] = useState("");
  const [auditMessage, setAuditMessage] = useState("");
  const [auditError, setAuditError] = useState("");
  const [shotResults, setShotResults] = useState<ShotResult[]>(() =>
    loadShotResults(gameId)
  );
  const lastStateKey = useRef<string | null>(null);
  const latestPhase = useRef<number | null>(null);
  const autoSetupTimeoutClaimKeys = useRef<Set<string>>(new Set());
  const autoRevealKeys = useRef<Set<string>>(new Set());
  const autoAuditKeys = useRef<Set<string>>(new Set());

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
      ({ eventName, transactionHash, cellRevealed }) => {
        devLog("gameWindow:event:received", {
          gameId,
          windowPlayerAddress: playerAddress,
          eventName,
          transactionHash,
          cellRevealed,
        });

        if (cellRevealed) {
          setShotResults(
            saveShotResult(gameId, {
              defender: cellRevealed.defender,
              cell: cellRevealed.cell,
              hit: cellRevealed.hit,
              transactionHash: cellRevealed.transactionHash,
            })
          );
        }

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
  const opponentBoardCommitted =
    currentRole === "player1"
      ? Boolean(gameState?.player2BoardCommitted)
      : currentRole === "player2"
        ? Boolean(gameState?.player1BoardCommitted)
        : false;
  const attackPhaseVisible = gameState?.phase === PHASE_ATTACK;
  const cellRevealPhaseVisible = gameState?.phase === PHASE_CELL_REVEAL;
  const auditPhaseVisible = gameState?.phase === PHASE_AUDIT;
  const finishedPhaseVisible = gameState?.phase === PHASE_FINISHED;
  const combatPhaseVisible = attackPhaseVisible || cellRevealPhaseVisible;
  const currentPlayerIsAttacker = Boolean(
    gameState && sameAddress(playerAddress, gameState.currentAttacker)
  );
  const currentPlayerIsProvisionalWinner = Boolean(
    gameState && sameAddress(playerAddress, gameState.provisionalWinner)
  );
  const currentPlayerWon = Boolean(
    gameState && sameAddress(playerAddress, gameState.winner)
  );
  const opponentAddress =
    gameState && currentRole === "player1"
      ? gameState.player2
      : gameState && currentRole === "player2"
        ? gameState.player1
        : null;
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

  useEffect(() => {
    if (
      !gameState ||
      !playerAddress ||
      !currentRole ||
      gameState.phase !== PHASE_BOARD_SETUP ||
      !currentPlayerBoardCommitted ||
      opponentBoardCommitted ||
      gameState.actionDeadline === 0n
    ) {
      return;
    }

    const claimantAddress = playerAddress;
    const actionDeadline = gameState.actionDeadline;
    const claimKey = [
      gameId.toString(),
      claimantAddress.toLowerCase(),
      currentRole,
      actionDeadline.toString(),
    ].join(":");
    const delayMs = Math.max(Number(actionDeadline) * 1000 - Date.now() + 1000, 0);

    devLog("gameWindow:setupTimeout:scheduled", {
      gameId,
      windowPlayerAddress: claimantAddress,
      actionDeadline,
      delayMs,
    });

    const timeoutId = window.setTimeout(() => {
      if (autoSetupTimeoutClaimKeys.current.has(claimKey)) return;
      autoSetupTimeoutClaimKeys.current.add(claimKey);

      async function claimBoardSetupTimeout() {
        devLog("gameWindow:setupTimeout:start", {
          gameId,
          windowPlayerAddress: claimantAddress,
          role: currentRole,
        });

        try {
          const accounts = await getCurrentAccounts();
          const activeAccount = accounts[0] ?? null;

          if (!sameAddress(activeAccount, claimantAddress)) {
            throw new Error("Switch MetaMask to this player to claim timeout.");
          }

          setSetupTimeoutMessage("Claiming board setup timeout...");
          setSetupTimeoutError("");

          const txHash = await claimTimeout(gameId, claimantAddress);

          setSetupTimeoutMessage(
            "Timeout claim transaction sent. Waiting for confirmation..."
          );
          devLog("gameWindow:setupTimeout:txSent", {
            gameId,
            windowPlayerAddress: claimantAddress,
            txHash,
          });

          await waitForTransaction(txHash);
          const refreshedState = await loadGameState(gameId);
          setGameState(refreshedState);

          const claimedWin =
            refreshedState.phase === PHASE_FINISHED &&
            sameAddress(claimantAddress, refreshedState.winner);

          devLog("gameWindow:setupTimeout:registered", {
            gameId,
            windowPlayerAddress: claimantAddress,
            txHash,
            claimedWin,
            phase: refreshedState.phaseName,
            winner: refreshedState.winner,
          });

          if (!claimedWin) {
            throw new Error("Timeout claim confirmed, but winner did not match.");
          }

          setSetupTimeoutMessage("");
        } catch (error) {
          setSetupTimeoutMessage("");
          setSetupTimeoutError(
            error instanceof Error ? error.message : "Timeout claim failed."
          );
          devLog("gameWindow:setupTimeout:error", {
            gameId,
            windowPlayerAddress: claimantAddress,
            role: currentRole,
            error,
          });
        }
      }

      claimBoardSetupTimeout();
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    currentPlayerBoardCommitted,
    currentRole,
    gameId,
    gameState,
    opponentBoardCommitted,
    playerAddress,
  ]);

  useEffect(() => {
    if (
      !gameState ||
      !playerAddress ||
      !currentRole ||
      !cellRevealPhaseVisible ||
      currentPlayerIsAttacker
    ) {
      return;
    }

    const defenderAddress = playerAddress;
    const cell = gameState.pendingTarget;
    const revealKey = [
      gameId.toString(),
      defenderAddress.toLowerCase(),
      gameState.currentAttacker.toLowerCase(),
      cell,
    ].join(":");

    if (autoRevealKeys.current.has(revealKey)) return;
    autoRevealKeys.current.add(revealKey);

    let cancelled = false;

    async function autoRevealCell() {
      devLog("gameWindow:autoReveal:start", {
        gameId,
        windowPlayerAddress: defenderAddress,
        cell,
        label: cellLabel(cell),
      });

      try {
        const boardSecret = loadBoardSecret(gameId, defenderAddress);

        if (!boardSecret) {
          throw new Error("No local board secret found for automatic reveal.");
        }

        const accounts = await getCurrentAccounts();
        const activeAccount = accounts[0] ?? null;

        if (!sameAddress(activeAccount, defenderAddress)) {
          throw new Error("Switch MetaMask to the defender account to auto-reveal.");
        }

        const hit = hasShip(boardSecret.shipMask, cell);
        const salt = boardSecret.salts[cell];
        const proof = buildMerkleProof(boardSecret.leaves, cell);

        devLog("gameWindow:autoReveal:prepared", {
          gameId,
          windowPlayerAddress: defenderAddress,
          cell,
          label: cellLabel(cell),
          hit,
          proofLength: proof.length,
          boardRoot: boardSecret.root,
        });

        const txHash = await revealCell(
          gameId,
          cell,
          hit,
          salt,
          proof,
          defenderAddress
        );

        devLog("gameWindow:autoReveal:txSent", {
          gameId,
          windowPlayerAddress: defenderAddress,
          cell,
          label: cellLabel(cell),
          hit,
          txHash,
        });

        const receipt = await waitForTransaction(txHash);
        const revealedLogs = readCellRevealedLogsFromReceipt(receipt);
        const revealedLog = revealedLogs.find(
          (log) =>
            log.cell === cell && sameAddress(defenderAddress, log.defender)
        );

        if (!revealedLog) {
          throw new Error("Reveal confirmed, but CellRevealed event was not found.");
        }

        const nextShotResults = saveShotResult(gameId, {
          defender: revealedLog.defender,
          cell: revealedLog.cell,
          hit: revealedLog.hit,
          transactionHash: revealedLog.transactionHash,
        });
        const refreshedState = await loadGameState(gameId);

        if (cancelled) return;

        setShotResults(nextShotResults);
        setGameState(refreshedState);
        setAttackMessage("");
        setAttackError("");

        devLog("gameWindow:autoReveal:registered", {
          gameId,
          windowPlayerAddress: defenderAddress,
          cell,
          label: cellLabel(cell),
          hit: revealedLog.hit,
          txHash,
          nextPhase: refreshedState.phaseName,
          currentAttacker: refreshedState.currentAttacker,
        });
      } catch (error) {
        devLog("gameWindow:autoReveal:error", {
          gameId,
          windowPlayerAddress: defenderAddress,
          cell,
          label: cellLabel(cell),
          error,
        });
      }
    }

    autoRevealCell();

    return () => {
      cancelled = true;
    };
  }, [
    cellRevealPhaseVisible,
    currentPlayerIsAttacker,
    currentRole,
    gameId,
    gameState,
    playerAddress,
  ]);

  useEffect(() => {
    if (
      !gameState ||
      !playerAddress ||
      !currentRole ||
      !auditPhaseVisible ||
      !currentPlayerIsProvisionalWinner
    ) {
      return;
    }

    const auditorAddress = playerAddress;
    const provisionalWinner = gameState.provisionalWinner;
    const actionDeadline = gameState.actionDeadline;
    const auditKey = [
      gameId.toString(),
      auditorAddress.toLowerCase(),
      provisionalWinner.toLowerCase(),
      actionDeadline.toString(),
    ].join(":");

    if (autoAuditKeys.current.has(auditKey)) return;
    autoAuditKeys.current.add(auditKey);

    let cancelled = false;

    async function autoAuditFinalBoard() {
      devLog("gameWindow:autoAudit:start", {
        gameId,
        windowPlayerAddress: auditorAddress,
        provisionalWinner,
      });

      try {
        const boardSecret = loadBoardSecret(gameId, auditorAddress);

        if (!boardSecret) {
          throw new Error("No local board secret found for audit.");
        }

        const accounts = await getCurrentAccounts();
        const activeAccount = accounts[0] ?? null;

        if (!sameAddress(activeAccount, auditorAddress)) {
          throw new Error("Switch MetaMask to the provisional winner to audit.");
        }

        setAuditMessage("Auditing final board...");
        setAuditError("");

        devLog("gameWindow:autoAudit:prepared", {
          gameId,
          windowPlayerAddress: auditorAddress,
          shipMask: boardSecret.shipMask,
          saltCount: boardSecret.salts.length,
          boardRoot: boardSecret.root,
        });

        const txHash = await revealFinalBoard(
          gameId,
          boardSecret.shipMask,
          boardSecret.salts,
          auditorAddress
        );

        setAuditMessage("Audit transaction sent. Waiting for confirmation...");
        devLog("gameWindow:autoAudit:txSent", {
          gameId,
          windowPlayerAddress: auditorAddress,
          txHash,
          shipMask: boardSecret.shipMask,
        });

        await waitForTransaction(txHash);
        const refreshedState = await loadGameState(gameId);

        if (cancelled) return;

        setGameState(refreshedState);
        setAuditMessage("");

        const finished = refreshedState.phase === PHASE_FINISHED;

        devLog("gameWindow:autoAudit:registered", {
          gameId,
          windowPlayerAddress: auditorAddress,
          txHash,
          finished,
          winner: refreshedState.winner,
          phase: refreshedState.phaseName,
        });

        if (!finished) {
          throw new Error("Audit confirmed, but game did not finish.");
        }
      } catch (error) {
        if (!cancelled) {
          setAuditMessage("");
          setAuditError(error instanceof Error ? error.message : "Audit failed.");
        }

        devLog("gameWindow:autoAudit:error", {
          gameId,
          windowPlayerAddress: auditorAddress,
          error,
        });
      }
    }

    autoAuditFinalBoard();

    return () => {
      cancelled = true;
    };
  }, [
    auditPhaseVisible,
    currentPlayerIsProvisionalWinner,
    currentRole,
    gameId,
    gameState,
    playerAddress,
  ]);

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

  async function handleAttackCellClick(cell: number) {
    if (attackingCell !== null) return;

    setSelectedAttackCell(cell);
    setAttackMessage("");
    setAttackError("");
    devLog("gameWindow:attack:cellClick", {
      gameId,
      windowPlayerAddress: playerAddress,
      cell,
      label: cellLabel(cell),
    });

    if (!gameState || !playerAddress) {
      setAttackError("Game or player is not ready yet.");
      devLog("gameWindow:attack:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        cell,
        reason: "missing game state or player address",
      });
      return;
    }

    if (!attackPhaseVisible) {
      setAttackError("This game is not in the attack phase.");
      devLog("gameWindow:attack:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        cell,
        phase: gameState.phaseName,
        reason: "not attack phase",
      });
      return;
    }

    if (!currentPlayerIsAttacker) {
      setAttackError("It is not your turn to attack.");
      devLog("gameWindow:attack:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        cell,
        currentAttacker: gameState.currentAttacker,
        reason: "not current attacker",
      });
      return;
    }

    const accounts = await getCurrentAccounts();
    const activeAccount = accounts[0] ?? null;

    if (!sameAddress(activeAccount, playerAddress)) {
      setAttackError("Switch MetaMask to this player before attacking.");
      devLog("gameWindow:attack:blocked", {
        gameId,
        windowPlayerAddress: playerAddress,
        activeAccount,
        cell,
        reason: "active account does not match window player",
      });
      return;
    }

    try {
      setAttackingCell(cell);
      setAttackMessage(`Attacking ${cellLabel(cell)}...`);

      const txHash = await attackCell(gameId, cell, playerAddress);
      setAttackMessage("Attack transaction sent. Waiting for confirmation...");
      devLog("gameWindow:attack:txSent", {
        gameId,
        windowPlayerAddress: playerAddress,
        cell,
        label: cellLabel(cell),
        txHash,
      });

      await waitForTransaction(txHash);

      const refreshedState = await loadGameState(gameId);
      setGameState(refreshedState);

      const registered =
        refreshedState.phase === PHASE_CELL_REVEAL &&
        refreshedState.pendingTarget === cell &&
        sameAddress(playerAddress, refreshedState.currentAttacker);

      devLog("gameWindow:attack:registered", {
        gameId,
        windowPlayerAddress: playerAddress,
        cell,
        label: cellLabel(cell),
        txHash,
        registered,
        phase: refreshedState.phaseName,
        pendingTarget: refreshedState.pendingTarget,
        currentAttacker: refreshedState.currentAttacker,
      });

      if (!registered) {
        throw new Error("Attack transaction confirmed, but state did not match.");
      }

      setAttackMessage("");
    } catch (error) {
      setAttackMessage("");
      setAttackError(error instanceof Error ? error.message : "Attack failed.");
      devLog("gameWindow:attack:error", {
        gameId,
        windowPlayerAddress: playerAddress,
        cell,
        label: cellLabel(cell),
        error,
      });
    } finally {
      setAttackingCell(null);
    }
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

  if (finishedPhaseVisible) {
    return (
      <main className="page game-window-page">
        <section className="card game-window-card game-result-card">
          <h1>{currentPlayerWon ? "You win" : "You loose"}</h1>
        </section>
      </main>
    );
  }

  if (auditPhaseVisible) {
    return (
      <main className="page game-window-page">
        <section className="card game-window-card combat-window-card">
          <h1>
            {currentPlayerIsProvisionalWinner ? "Auditing board" : "Waiting for audit"}
          </h1>
          {auditMessage && <div className="success">{auditMessage}</div>}
          {auditError && <div className="warning">{auditError}</div>}
        </section>
      </main>
    );
  }

  function boardCellClass({
    baseClass,
    result,
    targeted,
  }: {
    baseClass: string;
    result: ShotResult | null;
    targeted: boolean;
  }): string {
    return [
      "board-cell",
      baseClass,
      targeted ? "board-cell-targeted" : "",
      result?.hit ? "board-cell-hit" : "",
      result && !result.hit ? "board-cell-miss" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function boardCellText(result: ShotResult | null, cell: number): string {
    if (!result) return cellLabel(cell);

    return result.hit ? "HIT" : "MISS";
  }

  if (combatPhaseVisible) {
    if (currentPlayerIsAttacker) {
      return (
        <main className="page game-window-page">
          <section className="card game-window-card combat-window-card">
            <h1>Attack</h1>

            <div className="fleet-board attack-board" aria-label="Enemy board">
              {BOARD_CELLS.map((cell) => {
                const result = shotResultForBoard(shotResults, opponentAddress, cell);
                const targeted =
                  selectedAttackCell === cell ||
                  (cellRevealPhaseVisible && gameState?.pendingTarget === cell);

                return (
                  <button
                    key={cell}
                    type="button"
                    className={boardCellClass({
                      baseClass: "board-cell-attackable",
                      result,
                      targeted: targeted && !result,
                    })}
                    onClick={() => handleAttackCellClick(cell)}
                    disabled={attackingCell !== null || cellRevealPhaseVisible}
                    aria-label={`Attack ${cellLabel(cell)}`}
                  >
                    {boardCellText(result, cell)}
                  </button>
                );
              })}
            </div>

            {attackMessage && <div className="success">{attackMessage}</div>}
            {attackError && <div className="warning">{attackError}</div>}
          </section>
        </main>
      );
    }

    return (
      <main className="page game-window-page">
        <section className="card game-window-card combat-window-card">
          <h1>Waiting to be attacked</h1>

          <div className="fleet-board own-board" aria-label="Your board">
            {BOARD_CELLS.map((cell) => {
              const result = shotResultForBoard(shotResults, playerAddress, cell);
              const targeted =
                cellRevealPhaseVisible && gameState?.pendingTarget === cell;

              return (
                <div
                  key={cell}
                  className={boardCellClass({
                    baseClass: [
                      "board-cell-readonly",
                      ownShipCells.includes(cell) ? "board-cell-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" "),
                    result,
                    targeted: targeted && !result,
                  })}
                  aria-label={`Cell ${cellLabel(cell)}`}
                >
                  {boardCellText(result, cell)}
                </div>
              );
            })}
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
          {setupTimeoutMessage && (
            <div className="success">{setupTimeoutMessage}</div>
          )}
          {setupTimeoutError && <div className="warning">{setupTimeoutError}</div>}
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
