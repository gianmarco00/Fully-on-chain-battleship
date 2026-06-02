export type EthereumProvider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;

  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    callback: (...args: unknown[]) => void
  ) => void;

  isMetaMask?: boolean;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}
