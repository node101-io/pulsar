export interface ProviderError extends Error {
  message: string;
  code: number;
  data?: unknown;
}

export interface SignedData {
  publicKey: string;
  data: string;
  signature: {
    field: string;
    scalar: string;
  };
}

export interface ChainInfoArgs {
  networkID: string;
}

export interface SignMessageArgs {
  message: string;
}

export interface AddChainArgs {
  url: string;
  name: string;
}

export interface SendPaymentArgs {
  readonly to: string;
  readonly amount: number;
  readonly fee?: number;
  readonly memo?: string;
}

export interface SendTransactionResult {
  hash: string;
}

export interface MinaProvider {
  requestAccounts(): Promise<string[] | ProviderError>;
  getAccounts(): Promise<string[]>;
  requestNetwork(): Promise<ChainInfoArgs | ProviderError>;
  switchChain(args: ChainInfoArgs): Promise<ChainInfoArgs | ProviderError>;
  addChain(args: AddChainArgs): Promise<ChainInfoArgs | ProviderError>;
  signMessage(args: SignMessageArgs): Promise<SignedData | ProviderError>;
  sendPayment(args: SendPaymentArgs): Promise<SendTransactionResult | ProviderError>;
  on(event: "accountsChanged", callback: (accounts: string[]) => void): void;
  on(event: "chainChanged", callback: (chainInfo: ChainInfoArgs) => void): void;
}

declare global {
  interface Window {
    mina?: MinaProvider;
  }
}

export {};