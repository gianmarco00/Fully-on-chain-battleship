import { useState } from "react";

import joinGameIcon from "../../Images/Join game.svg";
import readStateIcon from "../../Images/Read state.svg";
import timonImage from "../../Images/Timon.png";
import { GameStatePanel } from "./GameStatePanel";
import {
  assertCorrectChain,
  createGame,
  joinGame,
  readCreatedGameIdFromReceipt,
  readGame,
  readNextGameId,
  waitForTransaction,
} from "../utils/contract";
import { devLog } from "../utils/devLog";
import { loadGameState } from "../utils/gameState";
import type { BattleshipGameState } from "../utils/gameState";

type LobbyActionsProps = {
  connected: boolean;
  correctChain: boolean;
  address: string | null;
  onGameUpdated: (gameId: bigint) => void;
};

type StatusType = "idle" | "info" | "success" | "error";

function parseGameId(input: string): bigint {
  const trimmed = input.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Game ID must be a non-negative integer.");
  }

  return BigInt(trimmed);
}

function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

export function LobbyActions({
  connected,
  correctChain,
  address,
  onGameUpdated,
}: LobbyActionsProps) {
  const [joinGameIdInput, setJoinGameIdInput] = useState("");
  const [loadingAction, setLoadingAction] = useState<
    "create" | "join" | "read" | null
  >(null);
  const [statusType, setStatusType] = useState<StatusType>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [gameState, setGameState] = useState<BattleshipGameState | null>(null);

  const actionsReady = connected && correctChain;

  async function handleCreateGame() {
    devLog("lobby:createGame:click", { actionsReady, address });

    if (!address) {
      setStatusType("error");
      setStatusMessage("Connect MetaMask before creating a game.");
      devLog("lobby:createGame:blocked", { reason: "missing wallet" });
      return;
    }

    let walletPromptTimers: number[] = [];
    let receiptTimer: number | null = null;

    try {
      setLoadingAction("create");
      setStatusType("info");
      setStatusMessage("Preparing create-game transaction...");

      await assertCorrectChain();

      setStatusMessage("Opening MetaMask transaction request...");
      devLog("lobby:createGame:walletPrompt:requesting", {
        address,
      });

      walletPromptTimers = [
        window.setTimeout(() => {
          devLog("lobby:createGame:walletPrompt:stillWaiting", {
            seconds: 5,
            address,
            hint: "If no popup is visible, check whether MetaMask is locked or opened behind the browser.",
          });
        }, 5_000),
        window.setTimeout(() => {
          devLog("lobby:createGame:walletPrompt:stillWaiting", {
            seconds: 15,
            address,
            hint: "The app is still waiting for eth_sendTransaction to return a tx hash.",
          });
        }, 15_000),
      ];

      const hash = await createGame(address);
      for (const timer of walletPromptTimers) window.clearTimeout(timer);
      walletPromptTimers = [];

      setStatusType("info");
      setStatusMessage("Create transaction sent. Waiting for confirmation...");
      devLog("lobby:createGame:txSent", { hash, address });

      receiptTimer = window.setTimeout(() => {
        devLog("lobby:createGame:receipt:stillWaiting", {
          seconds: 15,
          hash,
        });
      }, 15_000);

      const receipt = await waitForTransaction(hash);
      if (receiptTimer !== null) {
        window.clearTimeout(receiptTimer);
        receiptTimer = null;
      }

      const gameIdFromReceipt = readCreatedGameIdFromReceipt(receipt);
      const gameIdAfter = await readNextGameId();
      const createdGameId = gameIdFromReceipt ?? gameIdAfter - 1n;

      devLog("lobby:createGame:confirmed", {
        hash,
        gameIdFromReceipt,
        gameIdAfter,
        createdGameId,
      });

      setStatusType("success");
      setStatusMessage("Game created successfully.");
      onGameUpdated(createdGameId);
    } catch (error) {
      devLog("lobby:createGame:error", { error });
      setStatusType("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to create game."
      );
    } finally {
      for (const timer of walletPromptTimers) window.clearTimeout(timer);
      if (receiptTimer !== null) window.clearTimeout(receiptTimer);
      setLoadingAction(null);
    }
  }

  async function handleJoinGame() {
    devLog("lobby:joinGame:click", { actionsReady, address, joinGameIdInput });

    if (!address) {
      setStatusType("error");
      setStatusMessage("Connect MetaMask before joining a game.");
      devLog("lobby:joinGame:blocked", { reason: "missing wallet" });
      return;
    }

    let walletPromptTimers: number[] = [];
    let receiptTimer: number | null = null;

    try {
      setLoadingAction("join");
      setStatusType("info");
      setStatusMessage("Checking game before joining...");

      await assertCorrectChain();

      const gameId = parseGameId(joinGameIdInput);
      devLog("lobby:joinGame:parsedGameId", { gameId });

      const game = await readGame(gameId);
      const player1 = String(game[0]).toLowerCase();
      const player2 = String(game[1]).toLowerCase();
      const phase = Number(game[3]);
      const sender = address.toLowerCase();

      devLog("lobby:joinGame:precheck", {
        gameId,
        player1,
        player2,
        phase,
        sender,
      });

      if (sender === player1) {
        throw new Error(
          "This wallet created the game and cannot join it as player2. Switch MetaMask account."
        );
      }

      if (!isZeroAddress(player2)) {
        throw new Error("This game already has player2 and cannot be joined.");
      }

      if (phase !== 0) {
        throw new Error("This game is not in WaitingForPlayer phase anymore.");
      }

      setStatusMessage("Opening MetaMask join request...");
      devLog("lobby:joinGame:walletPrompt:requesting", {
        address,
        gameId,
      });

      walletPromptTimers = [
        window.setTimeout(() => {
          devLog("lobby:joinGame:walletPrompt:stillWaiting", {
            seconds: 5,
            address,
            gameId,
            hint: "If no popup is visible, check whether MetaMask is locked or opened behind the browser.",
          });
        }, 5_000),
        window.setTimeout(() => {
          devLog("lobby:joinGame:walletPrompt:stillWaiting", {
            seconds: 15,
            address,
            gameId,
            hint: "The app is still waiting for eth_sendTransaction to return a tx hash.",
          });
        }, 15_000),
      ];

      const hash = await joinGame(gameId, address);
      for (const timer of walletPromptTimers) window.clearTimeout(timer);
      walletPromptTimers = [];

      setStatusType("info");
      setStatusMessage("Join transaction sent. Waiting for confirmation...");
      devLog("lobby:joinGame:txSent", { gameId, hash, address });

      receiptTimer = window.setTimeout(() => {
        devLog("lobby:joinGame:receipt:stillWaiting", {
          seconds: 15,
          gameId,
          hash,
        });
      }, 15_000);

      await waitForTransaction(hash);
      if (receiptTimer !== null) {
        window.clearTimeout(receiptTimer);
        receiptTimer = null;
      }

      devLog("lobby:joinGame:confirmed", { gameId, hash });
      setStatusType("success");
      setStatusMessage(`Joined game ${gameId} successfully.`);
      onGameUpdated(gameId);
    } catch (error) {
      setStatusType("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to join game."
      );
      devLog("lobby:joinGame:error", { error });
    } finally {
      for (const timer of walletPromptTimers) window.clearTimeout(timer);
      if (receiptTimer !== null) window.clearTimeout(receiptTimer);
      setLoadingAction(null);
    }
  }

  async function handleReadGameState() {
    devLog("lobby:readGameState:click", { actionsReady, joinGameIdInput });

    if (!actionsReady) {
      setStatusType("error");
      setStatusMessage("Connect MetaMask on UZHETH PoS before reading a game.");
      return;
    }

    try {
      setLoadingAction("read");
      setStatusType("info");
      setStatusMessage("Reading game state...");

      await assertCorrectChain();

      const gameId = parseGameId(joinGameIdInput);
      const loadedGameState = await loadGameState(gameId);

      setGameState(loadedGameState);
      setStatusType("success");
      setStatusMessage(`Loaded game ${gameId}.`);
      devLog("lobby:readGameState:success", {
        gameId,
        phase: loadedGameState.phaseName,
        player1: loadedGameState.player1,
        player2: loadedGameState.player2,
      });
    } catch (error) {
      setGameState(null);
      setStatusType("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to read game state."
      );
      devLog("lobby:readGameState:error", { error });
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <section className="lobby-panel-card">
      <div className="lobby-panel-heading">
        <img
          src={timonImage}
          alt=""
          className="lobby-panel-heading-icon"
          aria-hidden="true"
          draggable={false}
        />
        <h2>Lobby</h2>
      </div>

      <div className="lobby-action-columns">
        <div className="lobby-action-column">
          <h3>Create a new game</h3>
          <i aria-hidden="true" />
          <p>You will be assigned a new game ID that another player can join.</p>

          <button
            className="lobby-button lobby-primary-button lobby-create-button"
            onClick={handleCreateGame}
            disabled={!actionsReady || loadingAction !== null}
          >
            <span className="lobby-ui-icon lobby-icon-plus" aria-hidden="true" />
            {loadingAction === "create" ? "Creating..." : "Create Game"}
          </button>
        </div>

        <div className="lobby-action-column lobby-join-column">
          <h3>Join an existing game</h3>
          <i aria-hidden="true" />
          <p>Enter a game ID to join an open game and challenge another player.</p>

          <input
            className="lobby-game-input"
            type="text"
            value={joinGameIdInput}
            onChange={(event) => setJoinGameIdInput(event.target.value)}
            placeholder="Enter Game ID"
          />

          <div className="lobby-join-buttons">
            <button
              className="lobby-button lobby-primary-button"
              onClick={handleJoinGame}
              disabled={!actionsReady || loadingAction !== null}
            >
              <img
                src={joinGameIcon}
                alt=""
                className="lobby-image-icon lobby-button-icon"
                aria-hidden="true"
                draggable={false}
              />
              {loadingAction === "join" ? "Joining..." : "Join Game"}
            </button>
            <button
              className="lobby-button lobby-secondary-button"
              onClick={handleReadGameState}
              disabled={!actionsReady || loadingAction !== null}
            >
              <img
                src={readStateIcon}
                alt=""
                className="lobby-image-icon lobby-button-icon"
                aria-hidden="true"
                draggable={false}
              />
              {loadingAction === "read" ? "Reading..." : "Read State"}
            </button>
          </div>
        </div>
      </div>

      {!connected && (
        <div className="warning">Connect MetaMask before using lobby actions.</div>
      )}

      {connected && !correctChain && (
        <div className="warning">Switch to UZHETH PoS before using lobby actions.</div>
      )}

      {statusMessage && (
        <div className={statusType === "success" ? "success" : "warning"}>
          {statusMessage}
        </div>
      )}

      <GameStatePanel gameState={gameState} />
    </section>
  );
}
