import { useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import {
  fetchAllBridgeTransfers,
  fetchBridgeConfirmationDepth,
  fetchBridgeTransfers,
  fetchMinaHeight,
  fetchMinaPrice,
  fetchMinaScanCursor,
  fetchPminaBalance,
} from "./utils"
import type { BridgeScanProgress } from "./bridge-progress"
import { getPulsarAddress } from "./keplr"
import { MINA_RPC_URL } from "./constants"
import { resolveMinaAddress } from "./registry"
import {
  forgetPendingTransfer,
  reconcilePendingTransfers,
  usePendingTransfers,
} from "./pending-transfers"

export function useMinaPrice(options?: {
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['minaPrice'],
    queryFn: fetchMinaPrice,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    retryDelay: 1000,
    ...options,
  });
}

export function usePminaBalance(account: string | null | undefined, options?: {
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['pminaBalance', account],
    queryFn: () => fetchPminaBalance(account!),
    enabled: !!account && (options?.enabled ?? true),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    ...options,
  });
}

/** A Mina account's balance in nanomina. Zero when the account does not exist. */
export function useMinaBalance(account: string | null | undefined, options?: {
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['minaBalance', account],
    queryFn: async (): Promise<bigint> => {
      if (!account) throw new Error('No account connected');

      const { fetchAccount } = await import('o1js');
      const accountInfo = await fetchAccount({ publicKey: account }, MINA_RPC_URL);

       if (accountInfo.error || !accountInfo.account)
         return 0n;

       return accountInfo.account.balance.toBigInt();
    },
    enabled: !!account && (options?.enabled ?? true),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    ...options,
  });
}


/**
 * The connected Pulsar address, for pages that cannot hold the interchain-kit
 * provider — see getPulsarAddress. Refetches when the user switches accounts
 * in the extension, which fires keplr_keystorechange.
 */
export function usePulsarAddress() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["pulsarAddress"] });
    };
    window.addEventListener("keplr_keystorechange", invalidate);
    return () => window.removeEventListener("keplr_keystorechange", invalidate);
  }, [queryClient]);

  return useQuery({
    queryKey: ["pulsarAddress"],
    queryFn: getPulsarAddress,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Settled bridge movements for a Pulsar account. Nothing appears here while a
 * deposit is in flight — see fetchBridgeTransfers for why.
 */
export function useBridgeTransactions(address?: string | null) {
  return useQuery({
    queryKey: ["bridgeTransactions", address],
    queryFn: () => fetchBridgeTransfers(address!),
    enabled: Boolean(address),
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: 1000,
  });
}

/**
 * Everyone's settled bridge movements — the public feed. Needs no wallet:
 * the registry and the bank events are public data, and the transactions
 * page shows them to anyone, highlighting the viewer's own rows when a
 * wallet says which those are.
 */
export function useAllBridgeTransactions() {
  return useQuery({
    queryKey: ["bridgeTransactions", "all"],
    queryFn: fetchAllBridgeTransfers,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    retryDelay: 1000,
  });
}

/**
 * Bridge transfers this Mina account has signed that the chain has not
 * answered yet — deposits waiting on their credit, withdrawals on their burn.
 *
 * The one place pending records are compared against settled history, so that
 * every page agrees on what is still in flight. Reconciling in each consumer
 * instead let a page the user had not opened keep showing a transfer the
 * chain had already answered.
 *
 * History is read for the REGISTERED Pulsar account, not the connected
 * wallet: that is the account deposits credit and withdrawals burn from, so
 * it is the only place the answers can appear — and it keeps this working
 * with no Cosmos wallet connected at all, which a withdrawal never needs.
 */
export function usePendingBridgeTransfers(minaAccount?: string | null) {
  const recorded = usePendingTransfers(minaAccount);
  const { data: keyStore } = useKeyStore(minaAccount);
  const { data: transfers } = useBridgeTransactions(
    keyStore?.keyStore?.pulsarAddress,
  );

  const { settledHashes, stillPending } = reconcilePendingTransfers(
    recorded,
    transfers ?? [],
  );

  // Dropping a record is a write, so it cannot happen during render. Repeating
  // it is harmless — forgetting an absent hash is a no-op — which is what makes
  // it safe to run for every settlement the reconcile reports.
  const settledKey = settledHashes.join(",");
  useEffect(() => {
    if (!settledKey) return;
    for (const hash of settledKey.split(",")) forgetPendingTransfer(hash);
  }, [settledKey]);

  return stillPending;
}

/**
 * How far into Mina the chain has scanned, and where Mina's tip is.
 *
 * Polled while a deposit is in flight, because it is the only signal that
 * separates "the bridge is working through a backlog" from "the bridge has
 * stopped". Both reads are independent; a failure of either leaves the other
 * usable, so the query resolves partials rather than rejecting.
 */
export function useBridgeScanProgress(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["bridgeScanProgress"],
    queryFn: async (): Promise<BridgeScanProgress> => {
      const [cursor, minaTip, confirmationDepth] = await Promise.allSettled([
        fetchMinaScanCursor(),
        fetchMinaHeight(),
        fetchBridgeConfirmationDepth(),
      ]);
      return {
        cursor: cursor.status === "fulfilled" ? cursor.value : null,
        minaTip: minaTip.status === "fulfilled" ? minaTip.value : null,
        confirmationDepth:
          confirmationDepth.status === "fulfilled" ? confirmationDepth.value : null,
      };
    },
    // The cursor only moves when the bridge pushes a batch, which is minutes
    // apart. Polling harder would just add load for the same answer.
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Whether this Mina key is registered on Pulsar, and to which Cosmos key.
 * A deposit from an unregistered key still reaches the chain but is judged
 * invalid, so the UI gates on this rather than letting funds strand.
 *
 * `pulsarAddress` is the deposit's destination, and it is NOT necessarily the
 * connected Keplr account: the registry decides, and its mina -> cosmos entry
 * can never be re-pointed (RegisterUserKeys rejects a known Mina key,
 * UpdateUserKeys only rotates the Mina side). Callers must show it, and gate
 * on it when it disagrees with the account the user is watching.
 */
export function useKeyStore(minaAddress?: string | null) {
  return useQuery({
    queryKey: ["keyStore", minaAddress],
    queryFn: async () => {
      const resolved = await resolveMinaAddress(minaAddress!);
      return resolved
        ? {
            keyStore: {
              cosmosPublicKey: Buffer.from(resolved.cosmosPublicKey).toString("base64"),
              pulsarAddress: resolved.pulsarAddress,
            },
          }
        : { keyStore: undefined };
    },
    staleTime: 15_000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    enabled: Boolean(minaAddress),
  });
}
