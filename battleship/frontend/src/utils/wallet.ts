import { UZHETH_CHAIN_ID_HEX, UZHETH_NETWORK } from "../config/chain";
import { devLog, devTrace } from "./devLog";

export type WalletConnection = {
  address: string;
  chainId: string;
};

export function hasMetaMask(): boolean {
  return Boolean(window.ethereum?.isMetaMask);
}

export async function getCurrentChainId(): Promise<string | null> {
  devTrace("wallet:getCurrentChainId:start");

  if (!window.ethereum) return null;

  const chainId = await window.ethereum.request({
    method: "eth_chainId",
  });

  devTrace("wallet:getCurrentChainId:success", { chainId });
  return String(chainId);
}

export async function getCurrentAccounts(): Promise<string[]> {
  devTrace("wallet:getCurrentAccounts:start");

  if (!window.ethereum) return [];

  const accounts = await window.ethereum.request({
    method: "eth_accounts",
  });

  devTrace("wallet:getCurrentAccounts:success", { accounts });
  return accounts as string[];
}

export async function connectWallet(): Promise<WalletConnection> {
  devLog("wallet:connect:start");

  if (!window.ethereum) {
    throw new Error("MetaMask is not available in this browser.");
  }

  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  const accountList = accounts as string[];

  if (accountList.length === 0) {
    throw new Error("No wallet account was selected.");
  }

  const chainId = await getCurrentChainId();

  if (!chainId) {
    throw new Error("Could not read current chain ID.");
  }

  devLog("wallet:connect:success", {
    address: accountList[0],
    chainId,
  });

  return {
    address: accountList[0],
    chainId,
  };
}

export async function switchToUzhethNetwork(): Promise<void> {
  devLog("wallet:switchNetwork:start", { chainId: UZHETH_CHAIN_ID_HEX });

  if (!window.ethereum) {
    throw new Error("MetaMask is not available in this browser.");
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: UZHETH_CHAIN_ID_HEX }],
    });
    devLog("wallet:switchNetwork:success", { chainId: UZHETH_CHAIN_ID_HEX });
  } catch (error) {
    const switchError = error as { code?: number };

    if (switchError.code !== 4902) {
      devLog("wallet:switchNetwork:error", { error });
      throw error;
    }

    devLog("wallet:addNetwork:start", { chainId: UZHETH_CHAIN_ID_HEX });
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [UZHETH_NETWORK],
    });
    devLog("wallet:addNetwork:success", { chainId: UZHETH_CHAIN_ID_HEX });
  }
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
