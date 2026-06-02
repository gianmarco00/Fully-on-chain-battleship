import { devLog } from "./devLog";

export function openGameWindow(gameId: bigint, playerAddress?: string): void {
  const params = new URLSearchParams({
    mode: "game",
    gameId: gameId.toString(),
  });

  if (playerAddress) {
    params.set("player", playerAddress);
  }

  const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  const playerKey = playerAddress ? playerAddress.slice(2, 10) : "viewer";
  const windowName = `battleship-game-${gameId.toString()}-${playerKey}`;

  devLog("gameWindow:open", { gameId, playerAddress, url, windowName });

  window.open(url, windowName, "popup,width=640,height=620");
}
