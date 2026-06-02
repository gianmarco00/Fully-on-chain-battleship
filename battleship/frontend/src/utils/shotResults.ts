import type { Address, Hash } from "viem";

import { asAddress } from "./contract";
import { devLog, devTrace } from "./devLog";

const SHOT_RESULTS_KEY_PREFIX = "battleship:shot-results";

export type ShotResult = {
  defender: Address;
  cell: number;
  hit: boolean;
  transactionHash: Hash | null;
};

function shotResultsKey(gameId: bigint | string): string {
  return `${SHOT_RESULTS_KEY_PREFIX}:${gameId.toString()}`;
}

function resultKey(result: Pick<ShotResult, "defender" | "cell">): string {
  return `${result.defender.toLowerCase()}:${result.cell}`;
}

export function loadShotResults(gameId: bigint | string): ShotResult[] {
  devTrace("shotResults:load", { gameId });
  const raw = localStorage.getItem(shotResultsKey(gameId));

  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as ShotResult[];
    return parsed.map((result) => ({
      defender: asAddress(result.defender),
      cell: Number(result.cell),
      hit: Boolean(result.hit),
      transactionHash: result.transactionHash,
    }));
  } catch (error) {
    devLog("shotResults:load:error", { gameId, error });
    return [];
  }
}

export function saveShotResult(
  gameId: bigint | string,
  result: ShotResult
): ShotResult[] {
  const existingResults = loadShotResults(gameId);
  const nextResultsByKey = new Map<string, ShotResult>();

  for (const existingResult of existingResults) {
    nextResultsByKey.set(resultKey(existingResult), existingResult);
  }

  nextResultsByKey.set(resultKey(result), result);

  const nextResults = Array.from(nextResultsByKey.values());
  localStorage.setItem(shotResultsKey(gameId), JSON.stringify(nextResults));

  devLog("shotResults:save", {
    gameId,
    defender: result.defender,
    cell: result.cell,
    hit: result.hit,
    transactionHash: result.transactionHash,
  });

  return nextResults;
}

export function shotResultForBoard(
  results: readonly ShotResult[],
  boardOwner: string | null,
  cell: number
): ShotResult | null {
  if (!boardOwner) return null;

  return (
    results.find(
      (result) =>
        result.cell === cell &&
        result.defender.toLowerCase() === boardOwner.toLowerCase()
    ) ?? null
  );
}
