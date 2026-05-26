import { useState } from "react";

import {
  assertCorrectChain,
  createGame,
  joinGame,
  readGame,
  readNextGameId,
  waitForTransaction,
} from "../utils/contract";

type GameControlsProps = {
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

export function GameControls({
  connected,
  correctChain,
  address,
  onGameUpdated,
}: GameControlsProps) {
  const [joinGameIdInput, setJoinGameIdInput] = useState("");
  const [loadingAction, setLoadingAction] = useState<"create" | "join" | null>(
    null
  );
  const [statusType, setStatusType] = useState<StatusType>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);

  async function handleCreateGame() {
    if (!address) {
      setStatusType("error");
      setStatusMessage("Connect MetaMask before creating a game.");
      return;
    }

    try {
      setLoadingAction("create");
      setStatusType("idle");
      setStatusMessage("");
      setTxHash(null);

      await assertCorrectChain();

      // Read before + after to recover the created game ID in a simple way.
      const gameIdBefore = await readNextGameId();

      const hash = await createGame(address);
      setTxHash(hash);
      setStatusType("info");
      setStatusMessage("Create transaction sent. Waiting for confirmation...");

      await waitForTransaction(hash);

      const gameIdAfter = await readNextGameId();
      const createdGameId =
        gameIdAfter > gameIdBefore ? gameIdAfter - 1n : gameIdBefore;

      setStatusType("success");
      setStatusMessage(`Game created successfully. gameId = ${createdGameId}`);
      onGameUpdated(createdGameId);
    } catch (error) {
      setStatusType("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to create game."
      );
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleJoinGame() {
    if (!address) {
      setStatusType("error");
      setStatusMessage("Connect MetaMask before joining a game.");
      return;
    }

    try {
      setLoadingAction("join");
      setStatusType("idle");
      setStatusMessage("");
      setTxHash(null);

      await assertCorrectChain();

      const gameId = parseGameId(joinGameIdInput);

      // Pre-check game constraints so users get readable errors before signing.
      const game = await readGame(gameId);
      const player1 = String(game[0]).toLowerCase();
      const player2 = String(game[1]).toLowerCase();
      const phase = Number(game[3]);
      const sender = address.toLowerCase();

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

      const hash = await joinGame(gameId, address);

      setTxHash(hash);
      setStatusType("info");
      setStatusMessage("Join transaction sent. Waiting for confirmation...");

      await waitForTransaction(hash);

      setStatusType("success");
      setStatusMessage(`Joined game ${gameId} successfully.`);
      onGameUpdated(gameId);
    } catch (error) {
      setStatusType("error");
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to join game."
      );
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <section className="panel-block">
      <h2>Create / Join</h2>

      <div className="actions">
        <button
          onClick={handleCreateGame}
          disabled={!connected || !correctChain || loadingAction !== null}
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
          disabled={!connected || !correctChain || loadingAction !== null}
        >
          {loadingAction === "join" ? "Joining..." : "Join Game"}
        </button>
      </div>

      {!connected && (
        <div className="warning">Connect MetaMask before using game actions.</div>
      )}

      {connected && !correctChain && (
        <div className="warning">Switch to UZHETH PoS before using game actions.</div>
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
