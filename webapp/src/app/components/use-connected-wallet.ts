"use client"

import { useMemo } from "react"

import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"
import { resolveConnectedWallet, type WalletKind } from "@/lib/connected-wallet"

/**
 * Which wallet the header and the wallet popup are currently speaking for.
 *
 * This hook only gathers the candidates from the wallet providers; the
 * choice between them — preference, staleness, tie-breaking — lives in
 * lib/connected-wallet.ts, where it is a pure, tested decision table.
 *
 * Lives here rather than in lib/hooks because it reads the Pulsar wallet
 * context, whose provider wraps the header alone. Pages import lib/hooks;
 * if this lived there, every page would need the provider above it.
 */
export function useConnectedWallet(preferred?: WalletKind | null) {
  const { isConnected: isMinaConnected, account: minaAccount } = useMinaWallet();
  const { status: keplrStatus, address: keplrAddress, username: keplrUsername } = usePulsarWallet();

  return useMemo(() => {
    const mina = isMinaConnected && minaAccount
      ? { type: 'mina' as const, address: minaAccount }
      : null;

    const pulsarAddress = keplrAddress || keplrUsername;
    const pulsar = keplrStatus === 'Connected' && pulsarAddress
      ? { type: 'pulsar' as const, address: pulsarAddress }
      : null;

    return resolveConnectedWallet(mina, pulsar, preferred);
  }, [preferred, isMinaConnected, minaAccount, keplrStatus, keplrAddress, keplrUsername]);
}
