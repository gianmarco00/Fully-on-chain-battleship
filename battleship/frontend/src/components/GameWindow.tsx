import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import aircraftCarrierImage from "../../Images/Aircraft carrier.png";
import anchorImage from "../../Images/Anchor.png";
import artworkImage from "../../Images/Artwork.png";
import battleshipImage from "../../Images/Battleship.png";
import cannonImage from "../../Images/Cannon.png";
import destroyerImage from "../../Images/Destroyer.png";
import patrolBoatImage from "../../Images/Patrol boat.png";
import sankShipImage from "../../Images/Sank ship.png";
import submarineImage from "../../Images/Submarine.png";
import timonImage from "../../Images/Timon.png";
import {
  attackCell,
  claimTimeout,
  commitBoard,
  computeBoardRoot,
  readBoardRoots,
  readCellRevealedLogsFromReceipt,
  revealCell,
  revealFinalBoard,
  revealRandomness,
  waitForTransaction,
  watchGameEvents,
} from "../utils/contract";
import {
  SHIP_DEFINITIONS,
  buildBoardSecret,
  buildMerkleProof,
  cellLabel,
  cellsForShipPlacement,
  hasShip,
  loadBoardSecret,
  saveBoardSecret,
} from "../utils/board";
import type { ShipDefinition, ShipPlacement } from "../utils/board";
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

type PlacedShip = ShipPlacement & {
  name: ShipDefinition["name"];
  length: ShipDefinition["length"];
  cells: number[];
};

type CandidatePlacement = {
  cells: number[];
  blockedReason: string | null;
};

type ShipCellSegment = {
  horizontal: boolean;
  position: "start" | "middle" | "end";
};

const POLL_MS = 1000;
const LOBBY_POLL_MS = 300;
const PHASE_WAITING = 0;
const PHASE_BOARD_SETUP = 1;
const PHASE_RANDOM_REVEAL = 2;
const PHASE_ATTACK = 3;
const PHASE_CELL_REVEAL = 4;
const PHASE_AUDIT = 5;
const PHASE_FINISHED = 6;
const GAME_STARTING_DELAY_MS = 2000;
const FIRST_ATTACK_ANNOUNCEMENT_MS = 2000;
const BOARD_COLUMNS = Array.from({ length: 10 }, (_, index) =>
  String.fromCharCode("A".charCodeAt(0) + index)
);
const BOARD_ROWS = Array.from({ length: 10 }, (_, index) => index + 1);
const SETUP_GRID_ITEMS = Array.from({ length: 121 }, (_, index) => index);
const TIMER_TICK_MS = 1000;
const SHIP_IMAGES = {
  aircraftCarrier: aircraftCarrierImage,
  battleship: battleshipImage,
  destroyer: destroyerImage,
  submarine: submarineImage,
  patrolBoat: patrolBoatImage,
} satisfies Record<ShipDefinition["id"], string>;

function boardCornerClass(rowIndex: number, columnIndex: number): string {
  if (rowIndex === 0 && columnIndex === 1) return "board-cell-corner-top-left";
  if (rowIndex === 0 && columnIndex === BOARD_COLUMNS.length) {
    return "board-cell-corner-top-right";
  }
  if (rowIndex === BOARD_ROWS.length - 1 && columnIndex === 1) {
    return "board-cell-corner-bottom-left";
  }
  if (rowIndex === BOARD_ROWS.length - 1 && columnIndex === BOARD_COLUMNS.length) {
    return "board-cell-corner-bottom-right";
  }

  return "";
}

function renderLabeledBoardGrid(
  renderCell: (cell: number, cornerClass: string) => ReactNode
): ReactNode[] {
  return SETUP_GRID_ITEMS.map((gridIndex) => {
    if (gridIndex === 0) {
      return (
        <span
          key="board-grid-corner"
          className="setup-board-corner"
          aria-hidden="true"
        />
      );
    }

    if (gridIndex <= BOARD_COLUMNS.length) {
      const column = BOARD_COLUMNS[gridIndex - 1];

      return (
        <span
          key={`board-grid-column-${column}`}
          className="setup-board-column"
          aria-hidden="true"
        >
          {column}
        </span>
      );
    }

    const bodyIndex = gridIndex - (BOARD_COLUMNS.length + 1);
    const rowIndex = Math.floor(bodyIndex / (BOARD_COLUMNS.length + 1));
    const columnIndex = bodyIndex % (BOARD_COLUMNS.length + 1);

    if (columnIndex === 0) {
      const row = BOARD_ROWS[rowIndex];

      return (
        <span
          key={`board-grid-row-${row}`}
          className="setup-board-row"
          aria-hidden="true"
        >
          {row}
        </span>
      );
    }

    const cell = rowIndex * BOARD_COLUMNS.length + columnIndex - 1;

    return renderCell(cell, boardCornerClass(rowIndex, columnIndex));
  });
}

function savedShipPlacementsFor(
  gameId: bigint,
  playerAddress: string | null
): PlacedShip[] {
  if (!playerAddress) return [];

  const boardSecret = loadBoardSecret(gameId, playerAddress);

  if (!boardSecret?.shipStartCells || !boardSecret.shipHorizontal) return [];

  try {
    return SHIP_DEFINITIONS.map((ship, index) => {
      const startCell = boardSecret.shipStartCells?.[index];
      const horizontal = Boolean(boardSecret.shipHorizontal?.[index]);

      if (startCell === undefined) {
        throw new Error("Missing ship placement.");
      }

      return {
        shipId: ship.id,
        name: ship.name,
        length: ship.length,
        startCell,
        horizontal,
        cells: cellsForShipPlacement(startCell, ship.length, horizontal),
      };
    });
  } catch {
    return [];
  }
}

function shipCellSegmentForCell(
  ships: readonly Pick<PlacedShip, "cells" | "horizontal">[],
  cell: number
): ShipCellSegment | null {
  for (const ship of ships) {
    const index = ship.cells.indexOf(cell);

    if (index === -1) continue;

    return {
      horizontal: ship.horizontal,
      position:
        index === 0 ? "start" : index === ship.cells.length - 1 ? "end" : "middle",
    };
  }

  return null;
}

function renderShipCellPiece(segment: ShipCellSegment): ReactNode {
  return (
    <span
      className={[
        "ship-cell-piece",
        segment.horizontal ? "ship-cell-piece-horizontal" : "ship-cell-piece-vertical",
        `ship-cell-piece-${segment.position}`,
      ].join(" ")}
      aria-hidden="true"
    />
  );
}

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

function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(seconds, 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function DeadlineTimer({
  gameState,
  iconSrc,
  nowMs,
}: {
  gameState: BattleshipGameState | null;
  iconSrc?: string;
  nowMs: number;
}) {
  if (!gameState || gameState.actionDeadline === 0n) return null;

  const secondsLeft = Number(gameState.actionDeadline) - Math.floor(nowMs / 1000);
  const expired = secondsLeft <= 0;

  return (
    <div className={expired ? "deadline-timer deadline-timer-expired" : "deadline-timer"}>
      {iconSrc && (
        <img
          src={iconSrc}
          alt=""
          className="deadline-timer-icon"
          aria-hidden="true"
          draggable={false}
        />
      )}
      <span>{gameState.phaseName}</span>
      <strong>{expired ? "Deadline passed" : formatCountdown(secondsLeft)}</strong>
    </div>
  );
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
  const [placedShips, setPlacedShips] = useState<PlacedShip[]>([]);
  const [selectedShipId, setSelectedShipId] = useState<ShipDefinition["id"]>(
    SHIP_DEFINITIONS[0].id
  );
  const [shipHorizontal, setShipHorizontal] = useState(false);
  const [hoveredBoardCell, setHoveredBoardCell] = useState<number | null>(null);
  const [committingBoard, setCommittingBoard] = useState(false);
  const [boardCommitMessage, setBoardCommitMessage] = useState("");
  const [boardCommitError, setBoardCommitError] = useState("");
  const [setupTimeoutMessage, setSetupTimeoutMessage] = useState("");
  const [setupTimeoutError, setSetupTimeoutError] = useState("");
  const [savedShipCells, setSavedShipCells] = useState<number[]>(() =>
    playerAddress ? (loadBoardSecret(gameId, playerAddress)?.shipCells ?? []) : []
  );
  const [savedShipPlacements, setSavedShipPlacements] = useState<PlacedShip[]>(() =>
    savedShipPlacementsFor(gameId, playerAddress)
  );
  const [randomRevealMessage, setRandomRevealMessage] = useState("");
  const [randomRevealError, setRandomRevealError] = useState("");
  const [firstAttackAnnouncementKey, setFirstAttackAnnouncementKey] = useState<
    string | null
  >(null);
  const [selectedAttackCell, setSelectedAttackCell] = useState<number | null>(null);
  const [attackingCell, setAttackingCell] = useState<number | null>(null);
  const [attackMessage, setAttackMessage] = useState("");
  const [attackError, setAttackError] = useState("");
  const [phaseTimeoutMessage, setPhaseTimeoutMessage] = useState("");
  const [phaseTimeoutError, setPhaseTimeoutError] = useState("");
  const [auditMessage, setAuditMessage] = useState("");
  const [auditError, setAuditError] = useState("");
  const [shotResults, setShotResults] = useState<ShotResult[]>(() =>
    loadShotResults(gameId)
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastStateKey = useRef<string | null>(null);
  const latestPhase = useRef<number | null>(null);
  const autoSetupTimeoutClaimKeys = useRef<Set<string>>(new Set());
  const autoPhaseTimeoutClaimKeys = useRef<Set<string>>(new Set());
  const autoRandomRevealKeys = useRef<Set<string>>(new Set());
  const firstAttackAnnouncementSeenKeys = useRef<Set<string>>(new Set());
  const firstAttackAnnouncementTimeoutId = useRef<number | null>(null);
  const autoRevealKeys = useRef<Set<string>>(new Set());
  const autoAuditKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, TIMER_TICK_MS);

    return () => window.clearInterval(intervalId);
  }, []);

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
  const randomRevealPhaseVisible = gameState?.phase === PHASE_RANDOM_REVEAL;
  const attackPhaseVisible = gameState?.phase === PHASE_ATTACK;
  const cellRevealPhaseVisible = gameState?.phase === PHASE_CELL_REVEAL;
  const auditPhaseVisible = gameState?.phase === PHASE_AUDIT;
  const finishedPhaseVisible = gameState?.phase === PHASE_FINISHED;
  const activePhase = gameState?.phase ?? null;
  const activePhaseName = gameState?.phaseName ?? "";
  const activeActionDeadline = gameState?.actionDeadline ?? 0n;
  const activeCurrentAttacker = gameState?.currentAttacker ?? "";
  const combatPhaseVisible = attackPhaseVisible || cellRevealPhaseVisible;
  const currentPlayerIsAttacker = Boolean(
    gameState && sameAddress(playerAddress, gameState.currentAttacker)
  );
  const currentPlayerCanClaimTurnTimeout =
    (attackPhaseVisible && !currentPlayerIsAttacker) ||
    (cellRevealPhaseVisible && currentPlayerIsAttacker);
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
  const firstAttackAnnouncementAttacker = gameState?.currentAttacker ?? "";
  const firstAttackAnnouncementNoShots = Boolean(
    gameState &&
      gameState.hitCount1 === 0 &&
      gameState.hitCount2 === 0 &&
      shotResults.length === 0
  );
  const firstAttackAnnouncementCurrentKey =
    attackPhaseVisible && !isZeroAddress(firstAttackAnnouncementAttacker)
      ? `${gameId.toString()}:${firstAttackAnnouncementAttacker.toLowerCase()}`
      : null;
  const firstAttackAnnouncementVisible =
    firstAttackAnnouncementKey !== null &&
    firstAttackAnnouncementKey === firstAttackAnnouncementCurrentKey;
  const placedShipCells = placedShips.flatMap((ship) => ship.cells);
  const placedShipCellSet = new Set(placedShipCells);
  const placedShipIds = new Set(placedShips.map((ship) => ship.shipId));
  const selectedShip = SHIP_DEFINITIONS.find(
    (ship) => ship.id === selectedShipId && !placedShipIds.has(ship.id)
  );
  const nextUnplacedShip =
    selectedShip ?? SHIP_DEFINITIONS.find((ship) => !placedShipIds.has(ship.id));
  const candidatePlacementForCell = (cell: number): CandidatePlacement => {
    if (!nextUnplacedShip) {
      return { cells: [], blockedReason: "all ships placed" };
    }

    try {
      const cells = cellsForShipPlacement(
        cell,
        nextUnplacedShip.length,
        shipHorizontal
      );
      const overlappingCell = cells.find((shipCell) =>
        placedShipCellSet.has(shipCell)
      );

      if (overlappingCell !== undefined) {
        return {
          cells: [],
          blockedReason: `overlaps ${cellLabel(overlappingCell)}`,
        };
      }

      return { cells, blockedReason: null };
    } catch {
      return { cells: [], blockedReason: "outside board" };
    }
  };
  const previewCells =
    hoveredBoardCell !== null
      ? candidatePlacementForCell(hoveredBoardCell).cells
      : [];
  const ownShipCells = savedShipCells.length > 0 ? savedShipCells : placedShipCells;
  const ownShipPlacements =
    savedShipPlacements.length > 0 ? savedShipPlacements : placedShips;

  useEffect(() => {
    if (!boardSetupVisible || committingBoard || currentPlayerBoardCommitted) {
      return;
    }

    function handleOrientationKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "q" || isTextEntryTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setShipHorizontal((current) => {
        const next = !current;

        devLog("gameWindow:boardSetup:orientationToggled", {
          gameId,
          windowPlayerAddress: playerAddress,
          shipHorizontal: next,
        });

        return next;
      });
    }

    window.addEventListener("keydown", handleOrientationKeyDown);

    return () => window.removeEventListener("keydown", handleOrientationKeyDown);
  }, [
    boardSetupVisible,
    committingBoard,
    currentPlayerBoardCommitted,
    gameId,
    playerAddress,
  ]);

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
      !playerAddress ||
      !currentRole ||
      activePhase !== PHASE_BOARD_SETUP ||
      !currentPlayerBoardCommitted ||
      opponentBoardCommitted ||
      activeActionDeadline === 0n
    ) {
      return;
    }

    const claimantAddress = playerAddress;
    const actionDeadline = activeActionDeadline;
    const claimKey = [
      gameId.toString(),
      claimantAddress.toLowerCase(),
      currentRole,
      actionDeadline.toString(),
    ].join(":");

    if (autoSetupTimeoutClaimKeys.current.has(claimKey)) return;

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
    activeActionDeadline,
    activePhase,
    currentPlayerBoardCommitted,
    currentRole,
    gameId,
    opponentBoardCommitted,
    playerAddress,
  ]);

  useEffect(() => {
    if (
      !playerAddress ||
      !currentRole ||
      !currentPlayerCanClaimTurnTimeout ||
      activeActionDeadline === 0n
    ) {
      return;
    }

    const claimantAddress = playerAddress;
    const actionDeadline = activeActionDeadline;
    const phase = activePhase;
    const phaseName = activePhaseName;
    const currentAttacker = activeCurrentAttacker;
    const claimKey = [
      gameId.toString(),
      claimantAddress.toLowerCase(),
      phase,
      currentAttacker.toLowerCase(),
      actionDeadline.toString(),
    ].join(":");

    if (autoPhaseTimeoutClaimKeys.current.has(claimKey)) return;

    const delayMs = Math.max(Number(actionDeadline) * 1000 - Date.now() + 1000, 0);

    devLog("gameWindow:phaseTimeout:scheduled", {
      gameId,
      windowPlayerAddress: claimantAddress,
      phase: phaseName,
      currentAttacker,
      actionDeadline,
      delayMs,
    });

    const timeoutId = window.setTimeout(() => {
      if (autoPhaseTimeoutClaimKeys.current.has(claimKey)) return;
      autoPhaseTimeoutClaimKeys.current.add(claimKey);

      async function claimTurnTimeout() {
        devLog("gameWindow:phaseTimeout:start", {
          gameId,
          windowPlayerAddress: claimantAddress,
          phase: phaseName,
          currentAttacker,
        });

        try {
          const accounts = await getCurrentAccounts();
          const activeAccount = accounts[0] ?? null;

          if (!sameAddress(activeAccount, claimantAddress)) {
            throw new Error("Switch MetaMask to this player to claim timeout.");
          }

          setPhaseTimeoutMessage("Claiming turn timeout...");
          setPhaseTimeoutError("");

          const txHash = await claimTimeout(gameId, claimantAddress);

          setPhaseTimeoutMessage(
            "Timeout claim transaction sent. Waiting for confirmation..."
          );
          devLog("gameWindow:phaseTimeout:txSent", {
            gameId,
            windowPlayerAddress: claimantAddress,
            phase: phaseName,
            txHash,
          });

          await waitForTransaction(txHash);
          const refreshedState = await loadGameState(gameId);
          setGameState(refreshedState);

          const claimedWin =
            refreshedState.phase === PHASE_FINISHED &&
            sameAddress(claimantAddress, refreshedState.winner);

          devLog("gameWindow:phaseTimeout:registered", {
            gameId,
            windowPlayerAddress: claimantAddress,
            phase: phaseName,
            txHash,
            claimedWin,
            finalPhase: refreshedState.phaseName,
            winner: refreshedState.winner,
          });

          if (!claimedWin) {
            throw new Error("Timeout claim confirmed, but winner did not match.");
          }

          setPhaseTimeoutMessage("");
        } catch (error) {
          setPhaseTimeoutMessage("");
          setPhaseTimeoutError(
            error instanceof Error ? error.message : "Timeout claim failed."
          );
          devLog("gameWindow:phaseTimeout:error", {
            gameId,
            windowPlayerAddress: claimantAddress,
            phase: phaseName,
            error,
          });
        }
      }

      claimTurnTimeout();
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeActionDeadline,
    activeCurrentAttacker,
    activePhase,
    activePhaseName,
    currentPlayerCanClaimTurnTimeout,
    currentRole,
    gameId,
    playerAddress,
  ]);

  useEffect(() => {
    if (!gameState || !playerAddress || !currentRole || !randomRevealPhaseVisible) {
      return;
    }

    const revealerAddress = playerAddress;
    const actionDeadline = gameState.actionDeadline;

    if (actionDeadline !== 0n && Number(actionDeadline) * 1000 <= Date.now()) {
      devLog("gameWindow:autoRandomReveal:skipped", {
        gameId,
        windowPlayerAddress: revealerAddress,
        reason: "random reveal deadline already passed",
        actionDeadline,
      });
      return;
    }

    const revealKey = [
      gameId.toString(),
      revealerAddress.toLowerCase(),
      actionDeadline.toString(),
    ].join(":");

    if (autoRandomRevealKeys.current.has(revealKey)) return;
    autoRandomRevealKeys.current.add(revealKey);

    let cancelled = false;

    async function autoRevealRandomness() {
      devLog("gameWindow:autoRandomReveal:start", {
        gameId,
        windowPlayerAddress: revealerAddress,
        role: currentRole,
      });

      try {
        const boardSecret = loadBoardSecret(gameId, revealerAddress);

        if (!boardSecret?.firstMoveSecret) {
          throw new Error("No local first-move secret found for randomness reveal.");
        }

        const accounts = await getCurrentAccounts();
        const activeAccount = accounts[0] ?? null;

        if (!sameAddress(activeAccount, revealerAddress)) {
          throw new Error("Switch MetaMask to this player to reveal randomness.");
        }

        setRandomRevealMessage("Revealing first-move randomness...");
        setRandomRevealError("");

        const txHash = await revealRandomness(
          gameId,
          boardSecret.firstMoveSecret,
          revealerAddress
        );

        setRandomRevealMessage(
          "Randomness reveal transaction sent. Waiting for confirmation..."
        );
        devLog("gameWindow:autoRandomReveal:txSent", {
          gameId,
          windowPlayerAddress: revealerAddress,
          role: currentRole,
          txHash,
          firstMoveCommit: boardSecret.firstMoveCommit,
        });

        await waitForTransaction(txHash);
        const refreshedState = await loadGameState(gameId);

        if (cancelled) return;

        setGameState(refreshedState);
        setRandomRevealMessage("");
        setRandomRevealError("");

        devLog("gameWindow:autoRandomReveal:registered", {
          gameId,
          windowPlayerAddress: revealerAddress,
          role: currentRole,
          txHash,
          nextPhase: refreshedState.phaseName,
          firstAttacker: refreshedState.currentAttacker,
        });
      } catch (error) {
        if (!cancelled) {
          setRandomRevealMessage("");
          setRandomRevealError(
            error instanceof Error ? error.message : "Randomness reveal failed."
          );
        }

        devLog("gameWindow:autoRandomReveal:error", {
          gameId,
          windowPlayerAddress: revealerAddress,
          role: currentRole,
          error,
        });
      }
    }

    autoRevealRandomness();

    return () => {
      cancelled = true;
    };
  }, [
    currentRole,
    gameId,
    gameState,
    playerAddress,
    randomRevealPhaseVisible,
  ]);

  useEffect(() => {
    if (
      !attackPhaseVisible ||
      !firstAttackAnnouncementCurrentKey ||
      firstAttackAnnouncementSeenKeys.current.has(firstAttackAnnouncementCurrentKey) ||
      !firstAttackAnnouncementNoShots
    ) {
      return;
    }

    firstAttackAnnouncementSeenKeys.current.add(firstAttackAnnouncementCurrentKey);
    setFirstAttackAnnouncementKey(firstAttackAnnouncementCurrentKey);

    if (firstAttackAnnouncementTimeoutId.current !== null) {
      window.clearTimeout(firstAttackAnnouncementTimeoutId.current);
      firstAttackAnnouncementTimeoutId.current = null;
    }

    devLog("gameWindow:firstAttackAnnouncement:visible", {
      gameId,
      windowPlayerAddress: playerAddress,
      firstAttacker: firstAttackAnnouncementAttacker,
      key: firstAttackAnnouncementCurrentKey,
    });

    firstAttackAnnouncementTimeoutId.current = window.setTimeout(() => {
      setFirstAttackAnnouncementKey((currentKey) =>
        currentKey === firstAttackAnnouncementCurrentKey ? null : currentKey
      );
      firstAttackAnnouncementTimeoutId.current = null;

      devLog("gameWindow:firstAttackAnnouncement:hidden", {
        gameId,
        windowPlayerAddress: playerAddress,
        firstAttacker: firstAttackAnnouncementAttacker,
        key: firstAttackAnnouncementCurrentKey,
      });
    }, FIRST_ATTACK_ANNOUNCEMENT_MS);
  }, [
    attackPhaseVisible,
    firstAttackAnnouncementAttacker,
    firstAttackAnnouncementCurrentKey,
    firstAttackAnnouncementNoShots,
    gameId,
    playerAddress,
  ]);

  useEffect(() => {
    return () => {
      if (firstAttackAnnouncementTimeoutId.current !== null) {
        window.clearTimeout(firstAttackAnnouncementTimeoutId.current);
      }
    };
  }, []);

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
    const actionDeadline = gameState.actionDeadline;

    if (actionDeadline !== 0n && Number(actionDeadline) * 1000 <= Date.now()) {
      devLog("gameWindow:autoReveal:skipped", {
        gameId,
        windowPlayerAddress: defenderAddress,
        reason: "reveal deadline already passed",
        actionDeadline,
      });
      return;
    }

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

        if (
          !boardSecret.masterSalt ||
          !boardSecret.shipStartCells ||
          !boardSecret.shipHorizontal
        ) {
          throw new Error("Classic ship placement audit is not ready yet.");
        }

        const boardRoots = await readBoardRoots(gameId);
        const committedRoot = String(
          currentRole === "player1" ? boardRoots[0] : boardRoots[1]
        );
        const computedRoot = await computeBoardRoot(
          gameId,
          auditorAddress,
          boardSecret.masterSalt,
          boardSecret.shipStartCells,
          boardSecret.shipHorizontal
        );
        const matchesCommittedRoot =
          computedRoot.toLowerCase() === committedRoot.toLowerCase();
        const matchesLocalRoot =
          computedRoot.toLowerCase() === boardSecret.root.toLowerCase();

        devLog("gameWindow:autoAudit:prepared", {
          gameId,
          windowPlayerAddress: auditorAddress,
          shipStartCells: boardSecret.shipStartCells,
          shipHorizontal: boardSecret.shipHorizontal,
          localRoot: boardSecret.root,
          committedRoot,
          computedRoot,
          matchesCommittedRoot,
          matchesLocalRoot,
        });

        if (!matchesCommittedRoot || !matchesLocalRoot) {
          throw new Error(
            "Local board secret does not match the committed audit root."
          );
        }

        const txHash = await revealFinalBoard(
          gameId,
          boardSecret.masterSalt,
          boardSecret.shipStartCells,
          boardSecret.shipHorizontal,
          auditorAddress
        );

        setAuditMessage("Audit transaction sent. Waiting for confirmation...");
        devLog("gameWindow:autoAudit:txSent", {
          gameId,
          windowPlayerAddress: auditorAddress,
          txHash,
          shipStartCells: boardSecret.shipStartCells,
          shipHorizontal: boardSecret.shipHorizontal,
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

  async function commitSelectedBoard(nextPlacedShips: readonly PlacedShip[]) {
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

    const placements = nextPlacedShips.map((ship) => ({
      shipId: ship.shipId,
      startCell: ship.startCell,
      horizontal: ship.horizontal,
    }));
    let boardRoot: string | null = null;

    try {
      setCommittingBoard(true);
      setBoardCommitError("");
      setBoardCommitMessage("Committing board root...");

      const boardSecret = buildBoardSecret({
        gameId,
        playerAddress,
        placements,
      });
      boardRoot = boardSecret.root;

      if (!boardSecret.firstMoveCommit) {
        throw new Error("First-move randomness commitment was not created.");
      }

      saveBoardSecret(boardSecret);
      setSavedShipCells(boardSecret.shipCells);
      setSavedShipPlacements([...nextPlacedShips]);
      devLog("gameWindow:boardCommit:prepared", {
        gameId,
        windowPlayerAddress: playerAddress,
        role,
        shipCount: placements.length,
        shipCellCount: boardSecret.shipCells.length,
        firstMoveCommit: boardSecret.firstMoveCommit,
        boardRoot: boardSecret.root,
      });

      const txHash = await commitBoard(
        gameId,
        boardSecret.root,
        boardSecret.firstMoveCommit,
        playerAddress
      );
      setBoardCommitMessage("Board transaction sent. Waiting for confirmation...");
      devLog("gameWindow:boardCommit:txSent", {
        gameId,
        windowPlayerAddress: playerAddress,
        role,
        txHash,
        firstMoveCommit: boardSecret.firstMoveCommit,
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
        boardRoot,
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
      selectedShipId,
    });

    const shipToPlace =
      SHIP_DEFINITIONS.find(
        (ship) => ship.id === selectedShipId && !placedShipIds.has(ship.id)
      ) ?? SHIP_DEFINITIONS.find((ship) => !placedShipIds.has(ship.id));

    if (!shipToPlace) {
      setBoardCommitMessage("");
      setBoardCommitError("All ships have already been placed.");
      return;
    }

    try {
      const candidatePlacement = candidatePlacementForCell(cell);

      if (candidatePlacement.blockedReason) {
        devLog("gameWindow:boardSetup:shipPlace:blocked", {
          gameId,
          windowPlayerAddress: playerAddress,
          shipId: shipToPlace.id,
          cell,
          label: cellLabel(cell),
          shipHorizontal,
          reason: candidatePlacement.blockedReason,
        });
        return;
      }

      const nextPlacedShips: PlacedShip[] = [
        ...placedShips,
        {
          shipId: shipToPlace.id,
          name: shipToPlace.name,
          length: shipToPlace.length,
          startCell: cell,
          horizontal: shipHorizontal,
          cells: candidatePlacement.cells,
        },
      ];
      const nextShip = SHIP_DEFINITIONS.find(
        (ship) => !nextPlacedShips.some((placedShip) => placedShip.shipId === ship.id)
      );

      setPlacedShips(nextPlacedShips);
      setHoveredBoardCell(null);
      setSelectedShipId(nextShip?.id ?? shipToPlace.id);
      setBoardCommitMessage("");
      setBoardCommitError("");

      devLog("gameWindow:boardSetup:shipPlaced", {
        gameId,
        windowPlayerAddress: playerAddress,
        shipId: shipToPlace.id,
        shipName: shipToPlace.name,
        length: shipToPlace.length,
        startCell: cell,
        label: cellLabel(cell),
        shipHorizontal,
        shipsPlaced: nextPlacedShips.length,
      });

      if (nextPlacedShips.length === SHIP_DEFINITIONS.length) {
        commitSelectedBoard(nextPlacedShips).catch((error) => {
          devLog("gameWindow:boardCommit:unhandledError", {
            gameId,
            windowPlayerAddress: playerAddress,
            error,
          });
        });
      }
    } catch (error) {
      setBoardCommitMessage("");
      setBoardCommitError(
        error instanceof Error ? error.message : "Could not place ship."
      );
      devLog("gameWindow:boardSetup:shipPlace:error", {
        gameId,
        windowPlayerAddress: playerAddress,
        shipId: shipToPlace.id,
        cell,
        error,
      });
    }
  }

  function handleAttackCellClick(cell: number) {
    if (attackingCell !== null || cellRevealPhaseVisible) return;

    const existingResult = shotResultForBoard(shotResults, opponentAddress, cell);

    if (existingResult) return;

    setSelectedAttackCell(cell);
    setAttackMessage("");
    setAttackError("");
    devLog("gameWindow:attack:cellSelect", {
      gameId,
      windowPlayerAddress: playerAddress,
      cell,
      label: cellLabel(cell),
    });
  }

  async function handleConfirmAttackClick() {
    if (attackingCell !== null) return;

    if (selectedAttackCell === null) {
      setAttackMessage("");
      setAttackError("Select a cell before confirming your shot.");
      return;
    }

    const cell = selectedAttackCell;
    const existingResult = shotResultForBoard(shotResults, opponentAddress, cell);

    if (existingResult) {
      setAttackMessage("");
      setAttackError(`${cellLabel(cell)} has already been attacked.`);
      return;
    }

    setAttackMessage("");
    setAttackError("");
    devLog("gameWindow:attack:confirmClick", {
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
          <DeadlineTimer gameState={gameState} nowMs={nowMs} />
          <h1>Game Starting...</h1>
        </section>
      </main>
    );
  }

  if (finishedPhaseVisible) {
    return (
      <main className="page game-window-page">
        <section className="card game-window-card game-result-card">
          <DeadlineTimer gameState={gameState} nowMs={nowMs} />
          <h1>{currentPlayerWon ? "You win" : "You loose"}</h1>
        </section>
      </main>
    );
  }

  if (auditPhaseVisible) {
    return (
      <main className="page game-window-page">
        <section className="card game-window-card combat-window-card">
          <DeadlineTimer gameState={gameState} nowMs={nowMs} />
          <h1>
            {currentPlayerIsProvisionalWinner ? "Auditing board" : "Waiting for audit"}
          </h1>
          {auditMessage && <div className="success">{auditMessage}</div>}
          {auditError && <div className="warning">{auditError}</div>}
        </section>
      </main>
    );
  }

  if (randomRevealPhaseVisible) {
    return (
      <main className="page game-window-page">
        <section className="card game-window-card game-starting-card">
          <DeadlineTimer gameState={gameState} nowMs={nowMs} />
          <h1>Choosing first player...</h1>
          {randomRevealMessage && <div className="success">{randomRevealMessage}</div>}
          {randomRevealError && <div className="warning">{randomRevealError}</div>}
        </section>
      </main>
    );
  }

  if (firstAttackAnnouncementVisible) {
    return (
      <main className="page game-window-page">
        <section className="card game-window-card game-starting-card">
          <h1>
            {currentPlayerIsAttacker ? "You move first" : "Prepare to be attacked"}
          </h1>
        </section>
      </main>
    );
  }

  function boardCellClass({
    baseClass,
    cornerClass,
    result,
    targeted,
  }: {
    baseClass: string;
    cornerClass?: string;
    result: ShotResult | null;
    targeted: boolean;
  }): string {
    return [
      "board-cell",
      cornerClass ?? "",
      baseClass,
      targeted ? "board-cell-targeted" : "",
      result?.hit ? "board-cell-hit" : "",
      result && !result.hit ? "board-cell-miss" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function boardCellAriaLabel(prefix: string, cell: number, result: ShotResult | null) {
    const outcome = result ? ` ${result.hit ? "hit" : "miss"}` : "";

    return `${prefix} ${cellLabel(cell)}${outcome}`;
  }

  if (combatPhaseVisible) {
    if (currentPlayerIsAttacker) {
      const selectedAttackResult =
        selectedAttackCell !== null
          ? shotResultForBoard(shotResults, opponentAddress, selectedAttackCell)
          : null;
      const confirmShotDisabled =
        !attackPhaseVisible ||
        attackingCell !== null ||
        selectedAttackCell === null ||
        selectedAttackResult !== null;

      return (
        <main className="page game-window-page board-setup-page combat-page">
          <section className="card game-window-card board-setup-card combat-window-card">
            <div className="board-setup-shell combat-shell">
              <div className="board-setup-topbar">
                <div className="board-setup-titlemark combat-titlemark">
                  <img
                    src={cannonImage}
                    alt=""
                    className="cannon-mark"
                    aria-hidden="true"
                    draggable={false}
                  />
                  <span>Your Turn</span>
                </div>
                <DeadlineTimer
                  gameState={gameState}
                  iconSrc={timonImage}
                  nowMs={nowMs}
                />
              </div>

              <div className="board-setup-hero combat-hero">
                <div>
                  <p className="eyebrow">Attack Phase</p>
                  <h1>Choose your target</h1>
                  <p className="combat-copy">
                    Select a cell to fire at your opponent&apos;s fleet.
                  </p>
                </div>
                <div className="combat-artwork combat-artwork-attack" aria-hidden="true">
                  <img src={artworkImage} alt="" draggable={false} />
                </div>
              </div>

              <div
                className="setup-board-frame combat-board-frame"
                aria-label="Enemy board"
              >
                <div className="setup-board-grid combat-board-grid">
                  {renderLabeledBoardGrid((cell, cornerClass) => {
                    const result = shotResultForBoard(
                      shotResults,
                      opponentAddress,
                      cell
                    );
                    const targeted =
                      selectedAttackCell === cell ||
                      (cellRevealPhaseVisible && gameState?.pendingTarget === cell);

                    return (
                      <button
                        key={`attack-cell-${cell}`}
                        type="button"
                        className={boardCellClass({
                          baseClass: "board-cell-attackable",
                          cornerClass,
                          result,
                          targeted: targeted && !result,
                        })}
                        onClick={() => handleAttackCellClick(cell)}
                        disabled={attackingCell !== null || cellRevealPhaseVisible}
                        aria-label={boardCellAriaLabel("Attack", cell, result)}
                      >
                        {result?.hit ? (
                          <img
                            src={sankShipImage}
                            alt=""
                            className="hit-cell-fire"
                            aria-hidden="true"
                            draggable={false}
                          />
                        ) : (
                          <span className="board-cell-dot" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="combat-actions combat-actions-attack">
                <div className="shots-remaining">
                  <span className="shot-mark" aria-hidden="true" />
                  <span>1 of 1 shots remaining</span>
                </div>
                <button
                  type="button"
                  className="confirm-shot-button"
                  onClick={() => {
                    handleConfirmAttackClick().catch((error) => {
                      setAttackError(
                        error instanceof Error ? error.message : "Attack failed."
                      );
                    });
                  }}
                  disabled={confirmShotDisabled}
                >
                  {attackingCell !== null ? "Confirming..." : "Confirm Shot"}
                </button>
              </div>

              <div className="board-setup-footer combat-footer">
                <div className="combat-footer-status">
                  <img
                    src={cannonImage}
                    alt=""
                    className="cannon-mark cannon-mark-small"
                    aria-hidden="true"
                    draggable={false}
                  />
                  <span className="label">Your Turn</span>
                  <span className="combat-footer-copy">Fire at a cell to attack</span>
                </div>
                <span className="target-mark" aria-hidden="true" />
              </div>

              {attackMessage && <div className="success">{attackMessage}</div>}
              {attackError && <div className="warning">{attackError}</div>}
              {phaseTimeoutMessage && (
                <div className="success">{phaseTimeoutMessage}</div>
              )}
              {phaseTimeoutError && (
                <div className="warning">{phaseTimeoutError}</div>
              )}
            </div>
          </section>
        </main>
      );
    }

    return (
      <main className="page game-window-page board-setup-page combat-page">
        <section className="card game-window-card board-setup-card combat-window-card">
          <div className="board-setup-shell combat-shell">
            <div className="board-setup-topbar">
              <div className="board-setup-titlemark combat-titlemark">
                <img
                  src={anchorImage}
                  alt=""
                  className="anchor-mark"
                  aria-hidden="true"
                  draggable={false}
                />
                <span>Opponent&apos;s Turn</span>
              </div>
              <DeadlineTimer
                gameState={gameState}
                iconSrc={timonImage}
                nowMs={nowMs}
              />
            </div>

            <div className="board-setup-hero combat-hero">
              <div>
                <p className="eyebrow">Enemy Attack</p>
                <h1>Enemy is firing</h1>
                <p className="combat-copy">Defend your fleet. Their shot is incoming.</p>
              </div>
              <div className="combat-artwork" aria-hidden="true">
                <img src={artworkImage} alt="" draggable={false} />
              </div>
            </div>

            <div
              className="setup-board-frame combat-board-frame"
              aria-label="Your board"
            >
              <div className="setup-board-grid combat-board-grid">
                {renderLabeledBoardGrid((cell, cornerClass) => {
                  const result = shotResultForBoard(shotResults, playerAddress, cell);
                  const ownShipSegment = shipCellSegmentForCell(
                    ownShipPlacements,
                    cell
                  );
                  const targeted =
                    cellRevealPhaseVisible && gameState?.pendingTarget === cell;

                  return (
                    <div
                      key={`defense-cell-${cell}`}
                      className={boardCellClass({
                        baseClass: [
                          "board-cell-readonly",
                          ownShipCells.includes(cell) ? "board-cell-selected" : "",
                          ownShipSegment ? "board-cell-ship-piece-cell" : "",
                        ]
                          .filter(Boolean)
                          .join(" "),
                        cornerClass,
                        result,
                        targeted: targeted && !result,
                      })}
                      aria-label={boardCellAriaLabel("Cell", cell, result)}
                    >
                      {result?.hit ? (
                        <>
                          {ownShipSegment && renderShipCellPiece(ownShipSegment)}
                          <img
                            src={sankShipImage}
                            alt=""
                            className="hit-cell-fire"
                            aria-hidden="true"
                            draggable={false}
                          />
                        </>
                      ) : ownShipSegment ? (
                        renderShipCellPiece(ownShipSegment)
                      ) : (
                        <span className="board-cell-dot" aria-hidden="true" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="setup-board-legend combat-legend" aria-hidden="true">
              <span>
                <i className="legend-swatch legend-swatch-placed" />
                Your ships
              </span>
              <span>
                <img
                  src={sankShipImage}
                  alt=""
                  className="legend-swatch legend-swatch-hit-icon"
                  draggable={false}
                />
                Hit
              </span>
              <span>
                <i className="legend-swatch legend-swatch-miss" />
                Miss
              </span>
            </div>

            <div className="board-setup-footer combat-footer">
              <div className="combat-footer-status">
                <img
                  src={anchorImage}
                  alt=""
                  className="anchor-mark anchor-mark-small"
                  aria-hidden="true"
                  draggable={false}
                />
                <span className="label">Waiting for opponent</span>
                <span className="combat-footer-copy">Defend your fleet</span>
              </div>
              <span className="shield-mark" aria-hidden="true" />
            </div>

            {phaseTimeoutMessage && (
              <div className="success">{phaseTimeoutMessage}</div>
            )}
            {phaseTimeoutError && <div className="warning">{phaseTimeoutError}</div>}
          </div>
        </section>
      </main>
    );
  }

  if (gameStarting && boardSetupVisible) {
    return (
      <main className="page game-window-page board-setup-page">
        <section className="card game-window-card board-setup-card">
          <div className="board-setup-shell">
            <div className="board-setup-topbar">
              <div className="board-setup-titlemark">
                <img
                  src={anchorImage}
                  alt=""
                  className="anchor-mark"
                  aria-hidden="true"
                  draggable={false}
                />
                <span>Board Setup</span>
              </div>
              <DeadlineTimer
                gameState={gameState}
                iconSrc={timonImage}
                nowMs={nowMs}
              />
            </div>

            <div className="board-setup-hero">
              <div>
                <p className="eyebrow">Game {gameId.toString()}</p>
                <h1>Position your fleet</h1>
              </div>
              <img
                src={artworkImage}
                alt=""
                className="setup-ship-artwork"
                aria-hidden="true"
                draggable={false}
              />
            </div>

            <div className="ship-selector" aria-label="Ships">
              {SHIP_DEFINITIONS.map((ship) => {
                const placed = placedShipIds.has(ship.id);
                const active = nextUnplacedShip?.id === ship.id && !placed;

                return (
                  <button
                    key={ship.id}
                    type="button"
                    className={[
                      "ship-button",
                      active ? "ship-button-active" : "",
                      placed ? "ship-button-placed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      setSelectedShipId(ship.id);
                      setBoardCommitMessage("");
                      setBoardCommitError("");
                    }}
                    disabled={committingBoard || currentPlayerBoardCommitted || placed}
                  >
                    <img
                      src={SHIP_IMAGES[ship.id]}
                      alt=""
                      className={`ship-image ship-image-${ship.id}`}
                      aria-hidden="true"
                      draggable={false}
                    />
                    <span>{ship.name}</span>
                    <strong>{ship.length} holes</strong>
                  </button>
                );
              })}
            </div>

            <div
              className="setup-board-frame"
              aria-label="Battleship board"
              onMouseLeave={() => setHoveredBoardCell(null)}
            >
              <div className="setup-board-grid">
                {SETUP_GRID_ITEMS.map((gridIndex) => {
                  if (gridIndex === 0) {
                    return (
                      <span
                        key="setup-grid-corner"
                        className="setup-board-corner"
                        aria-hidden="true"
                      />
                    );
                  }

                  if (gridIndex <= BOARD_COLUMNS.length) {
                    const column = BOARD_COLUMNS[gridIndex - 1];

                    return (
                      <span
                        key={`setup-grid-column-${column}`}
                        className="setup-board-column"
                        aria-hidden="true"
                      >
                        {column}
                      </span>
                    );
                  }

                  const bodyIndex = gridIndex - (BOARD_COLUMNS.length + 1);
                  const rowIndex = Math.floor(bodyIndex / (BOARD_COLUMNS.length + 1));
                  const columnIndex = bodyIndex % (BOARD_COLUMNS.length + 1);

                  if (columnIndex === 0) {
                    const row = BOARD_ROWS[rowIndex];

                    return (
                      <span
                        key={`setup-grid-row-${row}`}
                        className="setup-board-row"
                        aria-hidden="true"
                      >
                        {row}
                      </span>
                    );
                  }

                  const cell = rowIndex * BOARD_COLUMNS.length + columnIndex - 1;
                  const placed = placedShipCells.includes(cell);
                  const placedSegment = shipCellSegmentForCell(placedShips, cell);
                  const candidatePlacement = candidatePlacementForCell(cell);
                  const preview =
                    !placed &&
                    !committingBoard &&
                    !currentPlayerBoardCommitted &&
                    previewCells.includes(cell);
                  const previewOrigin = preview && hoveredBoardCell === cell;
                  const placementBlocked =
                    !committingBoard &&
                    !currentPlayerBoardCommitted &&
                    Boolean(candidatePlacement.blockedReason);
                  const blocked = !placed && !preview && placementBlocked;
                  const cornerClass =
                    rowIndex === 0 && columnIndex === 1
                      ? "board-cell-corner-top-left"
                      : rowIndex === 0 && columnIndex === BOARD_COLUMNS.length
                        ? "board-cell-corner-top-right"
                        : rowIndex === BOARD_ROWS.length - 1 && columnIndex === 1
                          ? "board-cell-corner-bottom-left"
                          : rowIndex === BOARD_ROWS.length - 1 &&
                              columnIndex === BOARD_COLUMNS.length
                            ? "board-cell-corner-bottom-right"
                            : "";

                  return (
                    <button
                      key={`setup-grid-cell-${cell}`}
                      type="button"
                      className={[
                        "board-cell",
                        cornerClass,
                        placed ? "board-cell-selected" : "",
                        placedSegment ? "board-cell-ship-piece-cell" : "",
                        preview ? "board-cell-preview" : "",
                        previewOrigin ? "board-cell-preview-origin" : "",
                        blocked ? "board-cell-blocked" : "",
                        hoveredBoardCell === cell ? "board-cell-hovered" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onMouseEnter={() => setHoveredBoardCell(cell)}
                      onClick={() => handleBoardCellClick(cell)}
                      disabled={committingBoard || currentPlayerBoardCommitted}
                      aria-disabled={placementBlocked}
                      aria-label={`Cell ${cellLabel(cell)}`}
                    >
                      {placedSegment ? (
                        renderShipCellPiece(placedSegment)
                      ) : (
                        <span className="board-cell-dot" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="setup-board-legend" aria-hidden="true">
                <span>
                  <i className="legend-swatch legend-swatch-placed" />
                  Placed
                </span>
                <span>
                  <i className="legend-swatch legend-swatch-selected" />
                  Selected
                </span>
              </div>
            </div>

            <div className="board-setup-footer">
              <div className="board-setup-progress">
                <img
                  src={anchorImage}
                  alt=""
                  className="anchor-mark anchor-mark-small"
                  aria-hidden="true"
                  draggable={false}
                />
                <span className="label">Ships placed</span>
                <strong>
                  {placedShips.length}/{SHIP_DEFINITIONS.length}
                </strong>
              </div>

              <button
                type="button"
                className="clear-board-button"
                onClick={() => {
                  setPlacedShips([]);
                  setHoveredBoardCell(null);
                  setSelectedShipId(SHIP_DEFINITIONS[0].id);
                  setBoardCommitMessage("");
                  setBoardCommitError("");
                }}
                disabled={
                  committingBoard ||
                  currentPlayerBoardCommitted ||
                  placedShips.length === 0
                }
              >
                <span aria-hidden="true">↻</span>
                Clear Board
              </button>
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
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page game-window-page">
      <section className="card game-window-card">
        <DeadlineTimer gameState={gameState} nowMs={nowMs} />
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
