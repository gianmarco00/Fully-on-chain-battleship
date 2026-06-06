import { useEffect, useState } from "react";

import artworkImage from "../Images/Artwork.png";
import lighthouseImage from "../Images/Lighthouse.png";
import readStateIcon from "../Images/Read state.svg";
import walletBlueIcon from "../Images/Wallet blue.svg";
import walletWhiteIcon from "../Images/Wallet white.svg";
import { GameWindow } from "./components/GameWindow";
import { LobbyActions } from "./components/LobbyActions";
import { isCorrectChain } from "./config/chain";
import { assertCorrectChain, readNextGameId } from "./utils/contract";
import { devLog } from "./utils/devLog";
import { openGameWindow } from "./utils/gameWindow";
import {
  connectWallet,
  getCurrentAccounts,
  getCurrentChainId,
  hasMetaMask,
  shortenAddress,
} from "./utils/wallet";

import "./styles.css";

function MainApp() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const walletAvailable = hasMetaMask();
  const connected = Boolean(address);
  const correctChain = isCorrectChain(chainId);

  async function refreshWalletState() {
    devLog("app:refreshWalletState:start");
    const accounts = await getCurrentAccounts();
    const currentChainId = await getCurrentChainId();

    setAddress(accounts[0] ?? null);
    setChainId(currentChainId);
    devLog("app:refreshWalletState:success", {
      address: accounts[0] ?? null,
      chainId: currentChainId,
    });
  }

  async function handleConnect() {
    devLog("app:connectWallet:click");

    try {
      setMessage("");

      const connection = await connectWallet();

      setAddress(connection.address);
      setChainId(connection.chainId);
      devLog("app:connectWallet:success", connection);
    } catch (error) {
      devLog("app:connectWallet:error", { error });
      setMessage(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  }

  async function handleReadContract() {
    devLog("app:readContract:click");

    try {
      setMessage("");

      await assertCorrectChain();

      const gameId = await readNextGameId();

      devLog("app:readContract:success", { gameId });
    } catch (error) {
      devLog("app:readContract:error", { error });
      setMessage(error instanceof Error ? error.message : "Contract read failed.");
    }
  }

  function handleGameUpdated(gameId: bigint) {
    devLog("app:gameUpdated", { gameId });
    openGameWindow(gameId, address ?? undefined);

    handleReadContract().catch(() => {
      // The transaction succeeded; keep the action status even if refresh fails.
    });
  }

  useEffect(() => {
    const bootstrapId = window.setTimeout(() => {
      refreshWalletState().catch(() => {
        // First load may have no connected account yet.
      });
    }, 0);

    function handleAccountsChanged(...args: unknown[]) {
      const accountList = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      setAddress(accountList[0] ?? null);
    }

    function handleChainChanged(...args: unknown[]) {
      setChainId(String(args[0] ?? ""));
    }

    window.ethereum?.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum?.on?.("chainChanged", handleChainChanged);

    return () => {
      window.clearTimeout(bootstrapId);
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  return (
    <main className="page lobby-page">
      <section className="card lobby-card">
        <div className="lobby-shell">
          <header className="lobby-hero">
            <div>
              <p className="eyebrow">Fully on-chain Battleship</p>
              <h1>Battleship Lobby</h1>

              <p className="description">
                Connect MetaMask on UZHETH PoS to enter the Battleship lobby.
              </p>
            </div>

            <img
              src={artworkImage}
              alt=""
              className="lobby-hero-artwork"
              aria-hidden="true"
              draggable={false}
            />
          </header>

          <div className="lobby-wallet-panel">
            <img
              src={walletBlueIcon}
              alt=""
              className="lobby-image-icon lobby-wallet-image-icon"
              aria-hidden="true"
              draggable={false}
            />
            <span className="lobby-wallet-label">Wallet</span>
            <strong>{connected ? shortenAddress(address!) : "Not connected"}</strong>
          </div>

          <div className="lobby-top-actions">
            <button
              className="lobby-button lobby-primary-button"
              onClick={handleConnect}
              disabled={!walletAvailable}
            >
              <img
                src={walletWhiteIcon}
                alt=""
                className="lobby-image-icon lobby-button-icon"
                aria-hidden="true"
                draggable={false}
              />
              {connected ? "Reconnect Wallet" : "Connect MetaMask"}
            </button>

            <button
              className="lobby-button lobby-primary-button"
              onClick={handleReadContract}
              disabled={!connected || !correctChain}
            >
              <img
                src={readStateIcon}
                alt=""
                className="lobby-image-icon lobby-button-icon lobby-primary-image-icon"
                aria-hidden="true"
                draggable={false}
              />
              Read Lobby State
            </button>
          </div>

          {!walletAvailable && (
            <div className="warning">
              MetaMask was not detected. Open this page in a browser with MetaMask
              installed.
            </div>
          )}

          {connected && correctChain && (
            <div className="success lobby-success">
              <span className="lobby-status-icon lobby-status-icon-success" aria-hidden="true" />
              Wallet connected and network is correct.
            </div>
          )}

          {connected && !correctChain && (
            <div className="warning">Wallet connected, but the network is not correct.</div>
          )}

          {message && <div className="warning">{message}</div>}

          <LobbyActions
            connected={connected}
            correctChain={correctChain}
            address={address}
            onGameUpdated={handleGameUpdated}
          />

          <section className="lobby-info-band" aria-label="On-chain assurance">
            <img
              src={lighthouseImage}
              alt=""
              className="lobby-lighthouse"
              aria-hidden="true"
              draggable={false}
            />

            <div>
              <h2>Secure. Transparent. On-chain.</h2>
              <p>All game state and actions are stored on-chain.</p>
              <p>No servers. No centralized control.</p>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function App() {
  const params = new URLSearchParams(window.location.search);
  const isGameWindow = params.get("mode") === "game";
  const gameWindowId = params.get("gameId");
  const playerAddress = params.get("player");

  if (isGameWindow && gameWindowId && /^\d+$/.test(gameWindowId)) {
    return (
      <GameWindow gameId={BigInt(gameWindowId)} playerAddress={playerAddress} />
    );
  }

  return <MainApp />;
}

export default App;
