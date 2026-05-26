import { UZHETH_CHAIN_ID_HEX, UZHETH_NETWORK } from "../config/chain";

export type WalletConnection = {
  address: string;
  chainId: string;
};

export function hasMetaMask(): boolean {
  return Boolean(window.ethereum?.isMetaMask);
}

export async function getCurrentChainId(): Promise<string | null> {
  if (!window.ethereum) return null;

  const chainId = await window.ethereum.request({
    method: "eth_chainId",
  });

  return String(chainId);
}

export async function getCurrentAccounts(): Promise<string[]> {
  if (!window.ethereum) return [];

  const accounts = await window.ethereum.request({
    method: "eth_accounts",
  });

  return accounts as string[];
}

export async function connectWallet(): Promise<WalletConnection> {
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

  return {
    address: accountList[0],
    chainId,
  };
}

export async function switchToUzhethNetwork(): Promise<void> {
  if (!window.ethereum) {
    throw new Error("MetaMask is not available in this browser.");
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: UZHETH_CHAIN_ID_HEX }],
    });
  } catch (error) {
    const switchError = error as { code?: number };

    // 4902 means MetaMask does not know this network yet.
    if (switchError.code !== 4902) {
      throw error;
    }

    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [UZHETH_NETWORK],
    });
  }
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}