import { useEffect, useState } from "react";

import { assertCorrectChain, readNextGameId } from "./utils/contract";
import { GameControls } from "./components/GameControls";
import { GameStatePanel } from "./components/GameStatePanel";
import { loadGameState } from "./utils/gameState";
import type { GameStateView } from "./utils/gameState";

import { UZHETH_CHAIN_ID_DECIMAL, isCorrectChain } from "./config/chain";
import {
  connectWallet,
  getCurrentAccounts,
  getCurrentChainId,
  hasMetaMask,
  shortenAddress,
  switchToUzhethNetwork,
} from "./utils/wallet";

import "./styles.css";

function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  const [nextGameId, setNextGameId] = useState<string | null>(null);
  const [gameIdInput, setGameIdInput] = useState("");
  const [gameState, setGameState] = useState<GameStateView | null>(null);
  const [gameStateLoading, setGameStateLoading] = useState(false);
  const [gameStateMessage, setGameStateMessage] = useState("");

  const walletAvailable = hasMetaMask();
  const connected = Boolean(address);
  const correctChain = isCorrectChain(chainId);

  async function refreshWalletState() {
    const accounts = await getCurrentAccounts();
    const currentChainId = await getCurrentChainId();

    setAddress(accounts[0] ?? null);
    setChainId(currentChainId);
  }

  async function handleReadContract() {
    try {
      setMessage("");
  
      await assertCorrectChain();
  
      const value = await readNextGameId();
      setNextGameId(value.toString());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Contract read failed.");
    }
  }

  async function handleConnect() {
    try {
      setMessage("");

      const connection = await connectWallet();

      setAddress(connection.address);
      setChainId(connection.chainId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  }

  async function handleSwitchNetwork() {
    try {
      setMessage("");

      await switchToUzhethNetwork();
      await refreshWalletState();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Network switch failed.");
    }
  }

  function parseGameId(input: string): bigint {
    const trimmed = input.trim();

    if (!/^\d+$/.test(trimmed)) {
      throw new Error("Game ID must be a non-negative integer.");
    }

    return BigInt(trimmed);
  }

  async function loadGameByInput(input: string) {
    try {
      setGameStateMessage("");
      setGameStateLoading(true);

      const gameId = parseGameId(input);
      await assertCorrectChain();

      const loadedState = await loadGameState(gameId);
      setGameState(loadedState);
    } catch (error) {
      setGameState(null);
      setGameStateMessage(
        error instanceof Error ? error.message : "Failed to load game."
      );
    } finally {
      setGameStateLoading(false);
    }
  }

  async function handleLoadGame() {
    await loadGameByInput(gameIdInput);
  }

  function handleGameUpdated(gameId: bigint) {
    const gameIdText = gameId.toString();
    setGameIdInput(gameIdText);

    loadGameByInput(gameIdText).catch(() => {
      // Errors are already handled in loadGameByInput.
    });

    handleReadContract().catch(() => {
      // If nextGameId refresh fails, we keep the successful tx status from controls.
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
    <main className="page">
      <section className="card">
        <p className="eyebrow">Fully on-chain RPS</p>
        <h1>Rock–Paper–Scissors</h1>

        <p className="description">
          Connect MetaMask to start interacting with the UZHETH PoS version of
          the game. This step includes wallet/network checks and basic contract
          reads for game state inspection.
        </p>

        {!walletAvailable && (
          <div className="warning">
            MetaMask was not detected. Open this page in a browser with MetaMask
            installed.
          </div>
        )}

        <div className="panel">
          <div>
            <span className="label">Wallet</span>
            <strong>{connected ? shortenAddress(address!) : "Not connected"}</strong>
          </div>

          <div>
            <span className="label">Chain</span>
            <strong>{chainId ?? "Unknown"}</strong>
          </div>

          <div>
            <span className="label">Expected chain</span>
            <strong>{UZHETH_CHAIN_ID_DECIMAL}</strong>
          </div>
        </div>

        <div className="actions">
          <button onClick={handleConnect} disabled={!walletAvailable}>
            {connected ? "Reconnect Wallet" : "Connect MetaMask"}
          </button>

          <button onClick={handleSwitchNetwork} disabled={!walletAvailable || correctChain}>
            Switch to UZHETH PoS
          </button>

          <button onClick={handleReadContract} disabled={!connected || !correctChain}>
            Read nextGameId
          </button>
        </div>

        {connected && correctChain && (
          <div className="success">
            Wallet connected and network is correct. You can now read the RPSGame contract.
          </div>
        )}

        {nextGameId !== null && (
          <div className="contract-box">
            <span className="label">RPSGame nextGameId</span>
            <strong>{nextGameId}</strong>
          </div>
        )}

        <GameControls
          connected={connected}
          correctChain={correctChain}
          address={address}
          onGameUpdated={handleGameUpdated}
        />

        <GameStatePanel
          connected={connected}
          correctChain={correctChain}
          gameIdInput={gameIdInput}
          onGameIdInputChange={setGameIdInput}
          onLoadGame={handleLoadGame}
          loading={gameStateLoading}
          message={gameStateMessage}
          gameState={gameState}
        />

        {connected && !correctChain && (
          <div className="warning">
            Wallet connected, but MetaMask is not on UZHETH PoS.
          </div>
        )}

        {message && <div className="warning">{message}</div>}
      </section>
    </main>
  );
}

export default App;
