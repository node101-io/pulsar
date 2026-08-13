"use client";

import {
  PULSAR_CHAIN_NAME,
  PULSAR_REST_URL,
  PULSAR_RPC_URL,
  consumerAssetList,
  consumerChain,
} from "@/lib/constants";
import { keplrWallet } from "@interchain-kit/keplr-extension";
import { ChainProvider, useChainWallet } from "@interchain-kit/react";
import React, { ReactNode } from "react";

export function usePulsarWallet() {
  return useChainWallet(PULSAR_CHAIN_NAME, "keplr-extension");
}

export function PulsarWalletProvider({ children }: { children: ReactNode }) {
  return (
    <ChainProvider
      chains={[consumerChain]}
      wallets={[keplrWallet]}
      assetLists={[consumerAssetList]}
      signerOptions={{
        preferredSignType: () => "direct",
      }}
      endpointOptions={{
        endpoints: {
          [PULSAR_CHAIN_NAME]: {
            rpc: [PULSAR_RPC_URL],
            rest: [PULSAR_REST_URL],
          },
        },
      }}
    >
      {children}
    </ChainProvider>
  );
}
