import type { Hash } from "viem";

import {
  assertCorrectChain,
  readCommitments,
  revealMove as sendRevealMove,
  simulateRevealMove,
  waitForTransaction,
} from "./contract";
import {
  deleteRevealSecret,
  loadRevealSecret,
  makeCommitment,
} from "./commit";
import type { RevealSecret } from "./commit";
import { devLog } from "./devLog";
import { loadGameState, logGameStateSnapshot } from "./gameState";
import type { GameStateView } from "./gameState";
import { getCurrentAccounts } from "./wallet";

const PHASE_REVEAL = 2;
const PHASE_FINISHED = 3;
const PHASE_CANCELLED = 4;

export type PlayerRole = "player1" | "player2";

export type RevealMoveResult = {
  role: PlayerRole;
  txHash: Hash;
  revealed: boolean;
  gameEnded: boolean;
};

type RevealMoveParams = {
  gameId: bigint;
  playerAddress: string;
};

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function findPlayerRole(
  state: GameStateView,
  playerAddress: string
): PlayerRole | null {
  if (sameAddress(playerAddress, state.player1)) return "player1";
  if (sameAddress(playerAddress, state.player2)) return "player2";
  return null;
}

function hasRevealed(state: GameStateView, role: PlayerRole): boolean {
  return role === "player1" ? state.player1Revealed : state.player2Revealed;
}

function bothCommitted(state: GameStateView): boolean {
  return state.player1Committed && state.player2Committed;
}

function gameEnded(state: GameStateView): boolean {
  return state.phase === PHASE_FINISHED || state.phase === PHASE_CANCELLED;
}

async function readPlayerCommitment(
  gameId: bigint,
  role: PlayerRole
): Promise<string> {
  const commitments = await readCommitments(gameId);

  if (commitments.length !== 2) {
    throw new Error("Unexpected getCommitments() response format.");
  }

  return String(role === "player1" ? commitments[0] : commitments[1]);
}

function validateSecret(
  secret: RevealSecret,
  gameId: bigint,
  playerAddress: string
): void {
  if (secret.gameId !== gameId.toString()) {
    throw new Error("Saved reveal secret belongs to a different game.");
  }

  if (!sameAddress(secret.playerAddress, playerAddress)) {
    throw new Error("Saved reveal secret belongs to a different wallet.");
  }

  const expectedCommitment = makeCommitment({
    move: secret.move,
    salt: secret.salt,
    playerAddress,
    gameId,
  });

  if (expectedCommitment.toLowerCase() !== secret.commitment.toLowerCase()) {
    throw new Error("Saved reveal secret does not match its commitment.");
  }
}

export async function revealMoveForGame({
  gameId,
  playerAddress,
}: RevealMoveParams): Promise<RevealMoveResult> {
  devLog("revealMove:flow:start", { gameId, playerAddress });

  let role: PlayerRole | null = null;
  let txHash: Hash | null = null;

  try {
    const accounts = await getCurrentAccounts();
    const activeAccount = accounts[0] ?? null;

    await assertCorrectChain();

    const state = await loadGameState(gameId);
    role = findPlayerRole(state, playerAddress);

    logGameStateSnapshot("revealMove:preflight", state, {
      playerAddress,
      activeAccount,
      activeAccountMatchesPlayer: activeAccount
        ? sameAddress(activeAccount, playerAddress)
        : false,
      role,
    });

    if (!role) {
      throw new Error("This wallet is not a player in this game.");
    }

    if (state.phase !== PHASE_REVEAL) {
      throw new Error(`Cannot reveal. Game phase is ${state.phaseName}.`);
    }

    if (!bothCommitted(state)) {
      throw new Error("Cannot reveal before both players have committed.");
    }

    if (hasRevealed(state, role)) {
      throw new Error("This player has already revealed.");
    }

    const secret = loadRevealSecret(gameId, playerAddress);

    if (!secret) {
      throw new Error("No saved reveal secret found for this game and wallet.");
    }

    validateSecret(secret, gameId, playerAddress);

    const onChainCommitment = await readPlayerCommitment(gameId, role);

    if (onChainCommitment.toLowerCase() !== secret.commitment.toLowerCase()) {
      throw new Error("Saved reveal secret does not match the on-chain commitment.");
    }

    devLog("revealMove:flow:prepared", {
      gameId,
      playerAddress,
      role,
      commitment: secret.commitment,
    });

    await simulateRevealMove(gameId, secret.move, secret.salt, playerAddress);

    txHash = await sendRevealMove(gameId, secret.move, secret.salt, playerAddress);
    devLog("revealMove:flow:txSent", { gameId, playerAddress, txHash });

    await waitForTransaction(txHash);

    const stateAfter = await loadGameState(gameId);
    const revealed = hasRevealed(stateAfter, role);
    const ended = gameEnded(stateAfter);

    logGameStateSnapshot("revealMove:stateAfterReceipt", stateAfter, {
      playerAddress,
      role,
      txHash,
      revealed,
      gameEnded: ended,
    });

    if (!revealed) {
      throw new Error(
        "Reveal transaction confirmed, but game state does not show this reveal yet."
      );
    }

    if (ended) {
      deleteRevealSecret(gameId, playerAddress);
    }

    devLog("revealMove:flow:confirmed", {
      gameId,
      playerAddress,
      txHash,
      gameEnded: ended,
    });

    return {
      role,
      txHash,
      revealed,
      gameEnded: ended,
    };
  } catch (error) {
    if (txHash) {
      try {
        const failureState = await loadGameState(gameId);

        logGameStateSnapshot("revealMove:failureState", failureState, {
          playerAddress,
          role,
          txHash,
        });
      } catch (stateError) {
        devLog("revealMove:failureState:error", {
          gameId,
          playerAddress,
          txHash,
          error: stateError,
        });
      }
    }

    devLog("revealMove:flow:error", { gameId, playerAddress, txHash, error });
    throw error;
  }
}
