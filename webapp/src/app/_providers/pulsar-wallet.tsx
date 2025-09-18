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
            rpc: ["https://rpc.pulsarchain.xyz/"],
            rest: ["https://rest.pulsarchain.xyz/"],
          },
        },
      }}
    >
      {children}
    </ChainProvider>
  );
}
