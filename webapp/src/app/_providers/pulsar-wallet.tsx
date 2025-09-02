"use client";

import { consumerAssetList, consumerChain } from '@/lib/constants';
import { keplrWallet } from "@interchain-kit/keplr-extension";
import { ChainProvider, useChainWallet } from "@interchain-kit/react";
import React, { ReactNode } from 'react';

export function usePulsarWallet() {
  return useChainWallet("consumer", "keplr-extension");
}

export function PulsarWalletProvider({ children }: {
  children: ReactNode;
}) {
  return (
    <ChainProvider
      chains={[consumerChain]}
      wallets={[keplrWallet]}
      assetLists={[consumerAssetList]}
      signerOptions={{
        signing: (chainName) => {
          return {
            broadcast: {
              checkTx: true,
              deliverTx: true,
              timeoutMs: 60000
            },
          };
        },
        preferredSignType: () => "direct",
      }}
      endpointOptions={{
        endpoints: {
          consumer: {
            rpc: ["http://5.9.42.22:26657/"],
            rest: ["http://5.9.42.22:1317"],
          },
        },
      }}
    >
      {children}
    </ChainProvider>
  );
}
