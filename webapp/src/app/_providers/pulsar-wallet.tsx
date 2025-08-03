"use client";

import React, { ReactNode } from 'react';
import { ChainProvider, useChainWallet } from "@interchain-kit/react";
import { keplrWallet } from "@interchain-kit/keplr-extension";
import { leapWallet } from "@interchain-kit/leap-extension";
import { chains, assetLists } from "chain-registry";

const chainNames = ["cosmoshub"];
const filteredChains = chains.filter(c => chainNames.includes(c.chainName));
const filteredAssetLists = assetLists.filter(a => chainNames.includes(a.chainName));

interface PulsarWalletProviderProps {
  children: ReactNode;
}

export function usePulsarWallet() {
  return useChainWallet("cosmoshub", "keplr-extension");
}

export function PulsarWalletProvider({ children }: PulsarWalletProviderProps) {
  return (
    <ChainProvider
      chains={filteredChains}
      wallets={[keplrWallet, leapWallet]}
      assetLists={filteredAssetLists}
      signerOptions={{
        signing: (chainName) => {
          if (chainName === "cosmoshub") {
            return {
              gasPrice: "0.025uatom",
              broadcast: {
                checkTx: true,
                deliverTx: true,
                timeoutMs: 60000,
              },
            };
          }
          return undefined;
        },
        preferredSignType: () => "direct",
      }}
      endpointOptions={{
        endpoints: {
          'cosmoshub': {
            rpc: ['https://rpc.cosmos.network'],
            rest: ['https://rest.cosmos.network']
          }
        },
      }}
    >
      {children}
    </ChainProvider>
  );
}
