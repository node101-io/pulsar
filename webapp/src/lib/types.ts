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

// Field elements are passed as decimal strings, and the signature comes back
// base58-encoded — unlike signMessage, which returns {field, scalar}.
export interface SignFieldsArgs {
  message: string[];
}

export interface SignedFieldsData {
  data: string[];
  publicKey: string;
  signature: string;
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
  signFields(args: SignFieldsArgs): Promise<SignedFieldsData | ProviderError>;
  sendPayment(args: SendPaymentArgs): Promise<SendTransactionResult | ProviderError>;
  sendTransaction?(args: { transaction: string } | { transaction: any }): Promise<SendTransactionResult | ProviderError>;
  on(event: "accountsChanged", callback: (accounts: string[]) => void): void;
  on(event: "chainChanged", callback: (chainInfo: ChainInfoArgs) => void): void;
}


declare global {
  interface Window {
    mina?: MinaProvider;
  }
}

export {};