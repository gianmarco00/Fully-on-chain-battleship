import { devLog } from "./devLog";

function gameWindowFeatures(): string {
  const screenLeft = window.screenLeft ?? window.screenX ?? 0;
  const screenTop = window.screenTop ?? window.screenY ?? 0;
  const availableWidth = window.screen.availWidth || window.screen.width || 960;
  const availableHeight = window.screen.availHeight || window.screen.height || 1080;
  const width = Math.min(850, availableWidth);
  const height = Math.max(620, availableHeight);

  return [
    "popup",
    `width=${width}`,
    `height=${height}`,
    `left=${screenLeft}`,
    `top=${screenTop}`,
  ].join(",");
}

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

  const features = gameWindowFeatures();

  devLog("gameWindow:open", { gameId, playerAddress, url, windowName, features });

  window.open(url, windowName, features);
}
