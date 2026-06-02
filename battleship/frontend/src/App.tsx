import { useEffect, useState } from "react";

import { LobbyActions } from "./components/LobbyActions";
import { UZHETH_CHAIN_ID_DECIMAL, isCorrectChain } from "./config/chain";
import { BATTLESHIP_CONTRACT_ADDRESS } from "./config/contract";
import {
  assertCorrectChain,
  readContractCodeBytes,
  readNextGameId,
} from "./utils/contract";
import { devLog } from "./utils/devLog";
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
  const [message, setMessage] = useState("");
  const [nextGameId, setNextGameId] = useState<string | null>(null);
  const [contractCodeBytes, setContractCodeBytes] = useState<number | null>(null);

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

  async function handleSwitchNetwork() {
    devLog("app:switchNetwork:click");

    try {
      setMessage("");

      await switchToUzhethNetwork();
      await refreshWalletState();
      devLog("app:switchNetwork:success");
    } catch (error) {
      devLog("app:switchNetwork:error", { error });
      setMessage(error instanceof Error ? error.message : "Network switch failed.");
    }
  }

  async function handleReadContract() {
    devLog("app:readContract:click");

    try {
      setMessage("");

      await assertCorrectChain();

      const [gameId, codeBytes] = await Promise.all([
        readNextGameId(),
        readContractCodeBytes(),
      ]);

      setNextGameId(gameId.toString());
      setContractCodeBytes(codeBytes);
      devLog("app:readContract:success", { gameId, codeBytes });
    } catch (error) {
      devLog("app:readContract:error", { error });
      setMessage(error instanceof Error ? error.message : "Contract read failed.");
    }
  }

  function handleGameCreated(gameId: bigint) {
    devLog("app:gameCreated", { gameId });
    setNextGameId((gameId + 1n).toString());

    handleReadContract().catch(() => {
      // The transaction succeeded; keep the create status even if refresh fails.
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
      setNextGameId(null);
      setContractCodeBytes(null);
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
        <p className="eyebrow">Fully on-chain Battleship</p>
        <h1>Battleship Lobby</h1>

        <p className="description">
          Connect MetaMask on UZHETH PoS to enter the Battleship lobby.
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
            Read Lobby State
          </button>
        </div>

        {connected && correctChain && (
          <div className="success">
            Wallet connected and network is correct.
          </div>
        )}

        <div className="contract-box">
          <span className="label">BattleshipGame contract</span>
          <strong>{BATTLESHIP_CONTRACT_ADDRESS}</strong>
        </div>

        {nextGameId !== null && (
          <div className="state-grid compact-state-grid">
            <div>
              <span className="label">Next game ID</span>
              <strong>{nextGameId}</strong>
            </div>

            <div>
              <span className="label">Contract code</span>
              <strong>
                {contractCodeBytes === null ? "Not read" : `${contractCodeBytes} bytes`}
              </strong>
            </div>
          </div>
        )}

        <LobbyActions
          connected={connected}
          correctChain={correctChain}
          address={address}
          onGameCreated={handleGameCreated}
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
