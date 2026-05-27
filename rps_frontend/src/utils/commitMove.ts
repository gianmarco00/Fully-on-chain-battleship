import type { Hash } from "viem";

import {
  assertCorrectChain,
  asAddress,
  commitMove as sendCommitMove,
  simulateCommitMove,
  waitForTransaction,
} from "./contract";
import {
  deleteRevealSecret,
  generateSalt,
  makeCommitment,
  moveName,
  normalizeMove,
  saveRevealSecret,
} from "./commit";
import type { MoveInput, RevealSecret } from "./commit";
import { devLog } from "./devLog";
import { loadGameState, logGameStateSnapshot } from "./gameState";
import type { GameStateView } from "./gameState";
import { getCurrentAccounts } from "./wallet";

const PHASE_COMMIT = 1;

export type PlayerRole = "player1" | "player2";

export type CommitMoveResult = RevealSecret & {
  role: PlayerRole;
  txHash: Hash;
  registered: boolean;
};

type CommitMoveParams = {
  gameId: bigint;
  move: MoveInput;
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

function alreadyCommitted(state: GameStateView, role: PlayerRole): boolean {
  return role === "player1" ? state.player1Committed : state.player2Committed;
}

export async function commitMoveForGame({
  gameId,
  move,
  playerAddress,
}: CommitMoveParams): Promise<CommitMoveResult> {
  devLog("commitMove:flow:start", { gameId, playerAddress });

  let secret: RevealSecret | null = null;
  let txHash: Hash | null = null;
  let role: PlayerRole | null = null;

  try {
    const moveInt = normalizeMove(move);
    const readableMove = moveName(moveInt);
    const accounts = await getCurrentAccounts();
    const activeAccount = accounts[0] ?? null;

    await assertCorrectChain();

    const state = await loadGameState(gameId);
    role = findPlayerRole(state, playerAddress);

    logGameStateSnapshot("commitMove:preflight", state, {
      playerAddress,
      activeAccount,
      activeAccountMatchesPlayer: activeAccount
        ? sameAddress(activeAccount, playerAddress)
        : false,
      role,
    });

    if (!role) {
      devLog("commitMove:flow:blocked", {
        gameId,
        playerAddress,
        reason: "wallet is not a player",
      });
      throw new Error("This wallet is not a player in this game.");
    }

    if (state.phase !== PHASE_COMMIT) {
      devLog("commitMove:flow:blocked", {
        gameId,
        playerAddress,
        role,
        phase: state.phaseName,
        reason: "wrong phase",
      });
      throw new Error(`Cannot commit. Game phase is ${state.phaseName}.`);
    }

    if (alreadyCommitted(state, role)) {
      devLog("commitMove:flow:blocked", {
        gameId,
        playerAddress,
        role,
        reason: "already committed",
      });
      throw new Error("This player has already committed a move.");
    }

    const salt = generateSalt();
    const commitment = makeCommitment({
      move: moveInt,
      salt,
      playerAddress,
      gameId,
    });

    devLog("commitMove:flow:prepared", {
      gameId,
      playerAddress,
      role,
      commitment,
    });

    await simulateCommitMove(gameId, commitment, playerAddress);

    secret = {
      gameId: gameId.toString(),
      playerAddress: asAddress(playerAddress),
      move: moveInt,
      moveName: readableMove,
      salt,
      commitment,
    };

    // Save before sending. If the tx reaches chain, this salt is needed to reveal.
    saveRevealSecret(secret);

    txHash = await sendCommitMove(gameId, commitment, playerAddress);
    devLog("commitMove:flow:txSent", { gameId, playerAddress, txHash });

    await waitForTransaction(txHash);

    const stateAfter = await loadGameState(gameId);
    const registered = alreadyCommitted(stateAfter, role);

    logGameStateSnapshot("commitMove:stateAfterReceipt", stateAfter, {
      playerAddress,
      role,
      txHash,
      registered,
    });

    if (!registered) {
      throw new Error(
        "Commit transaction confirmed, but the refreshed game state does not show this commitment yet."
      );
    }

    devLog("commitMove:flow:confirmed", { gameId, playerAddress, txHash });

    return {
      ...secret,
      role,
      txHash,
      registered,
    };
  } catch (error) {
    if (secret && !txHash) {
      deleteRevealSecret(gameId, playerAddress);
    }

    if (secret && txHash) {
      try {
        const stateAfterFailure = await loadGameState(gameId);

        logGameStateSnapshot("commitMove:failureState", stateAfterFailure, {
          playerAddress,
          role,
          txHash,
        });
      } catch (stateError) {
        devLog("commitMove:failureState:error", {
          gameId,
          playerAddress,
          txHash,
          error: stateError,
        });
      }
    }

    devLog("commitMove:flow:error", { gameId, playerAddress, txHash, error });
    throw error;
  }
}
