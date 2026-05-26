import { defineChain } from "viem";

export const UZHETH_CHAIN_ID_DECIMAL = 70207;
export const UZHETH_CHAIN_ID_HEX = "0x1123f"; // 70207 in hexadecimal

export const UZHETH_NETWORK = {
  chainId: UZHETH_CHAIN_ID_HEX,
  chainName: "UZHETH PoS",
  nativeCurrency: {
    name: "UZHETHs",
    symbol: "UZHETHs",
    decimals: 18,
  },
  rpcUrls: ["http://127.0.0.1:8549"],
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
      http: ["http://127.0.0.1:8549"],
    },
  },
});

export function isCorrectChain(chainIdHex: string | null): boolean {
  return chainIdHex?.toLowerCase() === UZHETH_CHAIN_ID_HEX.toLowerCase();
}
