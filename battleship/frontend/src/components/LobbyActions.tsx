import { useState } from "react";

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
  const [loadingAction, setLoadingAction] = useState<"create" | "join" | null>(
    null
  );
  const [statusType, setStatusType] = useState<StatusType>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);

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
      setTxHash(null);

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

      setTxHash(hash);
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
      setStatusMessage(`Game created successfully. gameId = ${createdGameId}`);
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
      setTxHash(null);

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

      setTxHash(hash);
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

  return (
    <section className="panel-block">
      <h2>Lobby</h2>

      <div className="actions">
        <button
          onClick={handleCreateGame}
          disabled={!actionsReady || loadingAction !== null}
        >
          {loadingAction === "create" ? "Creating..." : "Create Game"}
        </button>
      </div>

      <div className="inline-input spaced-top">
        <input
          type="text"
          value={joinGameIdInput}
          onChange={(event) => setJoinGameIdInput(event.target.value)}
          placeholder="Game ID to join"
        />
        <button
          onClick={handleJoinGame}
          disabled={!actionsReady || loadingAction !== null}
        >
          {loadingAction === "join" ? "Joining..." : "Join Game"}
        </button>
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

      {txHash && (
        <div className="contract-box">
          <span className="label">Latest tx hash</span>
          <strong>{txHash}</strong>
        </div>
      )}
    </section>
  );
}
