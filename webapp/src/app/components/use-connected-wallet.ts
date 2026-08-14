"use client"

import { useMemo } from "react"

import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"

/**
 * Which wallet the header and the wallet popup are currently speaking for.
 *
 * Lives here rather than in lib/hooks because it reads the Pulsar wallet
 * context, whose provider wraps the header alone. Pages import lib/hooks;
 * if this lived there, every page would need the provider above it.
 */
export function useConnectedWallet() {
  const { isConnected: isMinaConnected, account: minaAccount } = useMinaWallet();
  const { status: keplrStatus, address: keplrAddress, username: keplrUsername } = usePulsarWallet();

  return useMemo(() => {
    if (isMinaConnected && minaAccount)
      return { type: 'mina' as const, address: minaAccount };

    const cosmosAddress = keplrAddress || keplrUsername;

    if (keplrStatus === 'Connected' && cosmosAddress)
      return { type: 'cosmos' as const, address: cosmosAddress };

    return null;
  }, [isMinaConnected, minaAccount, keplrStatus, keplrAddress, keplrUsername]);
}
