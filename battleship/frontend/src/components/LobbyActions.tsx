import { useState } from "react";

import {
  assertCorrectChain,
  createGame,
  readNextGameId,
  waitForTransaction,
} from "../utils/contract";
import { devLog } from "../utils/devLog";

type LobbyActionsProps = {
  connected: boolean;
  correctChain: boolean;
  address: string | null;
  onGameCreated: (gameId: bigint) => void;
};

type StatusType = "idle" | "info" | "success" | "error";

function parseGameId(input: string): bigint {
  const trimmed = input.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Game ID must be a non-negative integer.");
  }

  return BigInt(trimmed);
}

export function LobbyActions({
  connected,
  correctChain,
  address,
  onGameCreated,
}: LobbyActionsProps) {
  const [joinGameIdInput, setJoinGameIdInput] = useState("");
  const [loadingAction, setLoadingAction] = useState<"create" | null>(null);
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

      const gameIdBefore = await readNextGameId();
      devLog("lobby:createGame:nextGameIdBefore", { gameIdBefore });

      setStatusMessage("Waiting for MetaMask transaction prompt...");
      devLog("lobby:createGame:walletPrompt:requesting", {
        address,
        gameIdBefore,
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
            hint: "The app is still waiting for walletClient.writeContract to return a tx hash.",
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

      await waitForTransaction(hash);
      if (receiptTimer !== null) {
        window.clearTimeout(receiptTimer);
        receiptTimer = null;
      }

      const gameIdAfter = await readNextGameId();
      const createdGameId =
        gameIdAfter > gameIdBefore ? gameIdAfter - 1n : gameIdBefore;

      devLog("lobby:createGame:confirmed", {
        hash,
        gameIdBefore,
        gameIdAfter,
        createdGameId,
      });

      setStatusType("success");
      setStatusMessage(`Game created successfully. gameId = ${createdGameId}`);
      onGameCreated(createdGameId);
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

  function handleJoinGame() {
    devLog("lobby:joinGame:click", { actionsReady, joinGameIdInput });

    if (!actionsReady) {
      setStatusType("error");
      setStatusMessage("Connect MetaMask on UZHETH PoS before joining a game.");
      return;
    }

    try {
      const gameId = parseGameId(joinGameIdInput);

      setStatusType("info");
      setStatusMessage(
        `Join transaction flow for game ${gameId.toString()} is staged for the next milestone.`
      );
    } catch (error) {
      setStatusType("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Invalid game ID."
      );
      devLog("lobby:joinGame:error", { error });
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
          Join Game
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
