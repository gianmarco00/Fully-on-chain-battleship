import { defineChain } from "viem";

export const UZHETH_CHAIN_ID_DECIMAL = 70207;
export const UZHETH_CHAIN_ID_HEX = "0x1123f";
export const UZHETH_RPC_URL =
  import.meta.env.VITE_UZHETH_RPC_URL ?? "http://130.60.144.77:8554/";

export const UZHETH_NETWORK = {
  chainId: UZHETH_CHAIN_ID_HEX,
  chainName: "UZHETH PoS",
  nativeCurrency: {
    name: "UZHETHs",
    symbol: "UZHETHs",
    decimals: 18,
  },
  rpcUrls: [UZHETH_RPC_URL],
  blockExplorerUrls: [],
};

export const UZHETH_CHAIN = defineChain({
  id: UZHETH_CHAIN_ID_DECIMAL,
  name: "UZHETH PoS",
  nativeCurrency: {
    name: "UZHETHs",
    symbol: "UZHETHs",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [UZHETH_RPC_URL],
    },
  },
});

export function isCorrectChain(chainIdHex: string | null): boolean {
  return chainIdHex?.toLowerCase() === UZHETH_CHAIN_ID_HEX.toLowerCase();
}
