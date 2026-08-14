import { useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import {
  AbciQueryError,
  SDK_ERR_KEY_NOT_FOUND,
  abciQuery,
  fetchBridgeTransfers,
  fetchMinaHeight,
  fetchMinaPrice,
  fetchMinaScanCursor,
  fetchPminaBalance,
} from "./utils"
import { getPulsarAddress } from "./keplr"
import {
  KEYREGISTRY_QUERY_USER_COSMOS_KEY,
  QueryGetUserCosmosPublicKeyRequest,
  QueryGetUserCosmosPublicKeyResponse,
} from "pulsar-chain-client/messages"
import { rawSecp256k1PubkeyToRawAddress } from "@cosmjs/amino"
import { toBech32 } from "@cosmjs/encoding"
import { MINA_RPC_URL, consumerChain } from "./constants"
import { formatMinaPublicKey } from "./crypto"
import {
  forgetPendingDeposit,
  reconcilePendingDeposits,
  usePendingDeposits,
} from "./pending-deposits"

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
 * Deposits this Mina account has sent that the chain has not credited yet.
 *
 * The one place a pending deposit is compared against settled history, so that
 * every page agrees on what is still in flight. Reconciling in each consumer
 * instead let a page the user had not opened keep showing a deposit the chain
 * had already paid out.
 */
export function usePendingBridgeDeposits(minaAccount?: string | null) {
  const recorded = usePendingDeposits(minaAccount);
  const { data: pulsarAddress } = usePulsarAddress();
  const { data: transfers } = useBridgeTransactions(pulsarAddress);

  const { settledHashes, stillPending } = reconcilePendingDeposits(
    recorded,
    transfers ?? [],
  );

  // Dropping a record is a write, so it cannot happen during render. Repeating
  // it is harmless — forgetting an absent hash is a no-op — which is what makes
  // it safe to run for every settlement the reconcile reports.
  const settledKey = settledHashes.join(",");
  useEffect(() => {
    if (!settledKey) return;
    for (const hash of settledKey.split(",")) forgetPendingDeposit(hash);
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
    queryFn: async (): Promise<{ cursor: number | null; minaTip: number | null }> => {
      const [cursor, minaTip] = await Promise.allSettled([
        fetchMinaScanCursor(),
        fetchMinaHeight(),
      ]);
      return {
        cursor: cursor.status === "fulfilled" ? cursor.value : null,
        minaTip: minaTip.status === "fulfilled" ? minaTip.value : null,
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
 * Where a deposit from this Mina key lands, derived exactly the way the chain
 * derives it: ripemd160(sha256(compressed secp256k1 key)) in bech32. See
 * x/bridge applyDeposit -> userAddressFromCosmosPubKey.
 */
function pulsarAddressFromCosmosPubkey(cosmosPublicKey: Uint8Array): string {
  return toBech32(
    consumerChain.bech32Prefix!,
    rawSecp256k1PubkeyToRawAddress(cosmosPublicKey),
  );
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
      const packed = await formatMinaPublicKey(minaAddress!);
      const request = QueryGetUserCosmosPublicKeyRequest.encode(
        QueryGetUserCosmosPublicKeyRequest.fromPartial({
          user_mina_public_key: Buffer.from(packed),
        }),
      ).finish();

      let value: Uint8Array;
      try {
        value = await abciQuery(KEYREGISTRY_QUERY_USER_COSMOS_KEY, request);
      } catch (error) {
        // The keeper reports a miss as an error; for us "not registered" is an
        // answer. Every other code is a real failure and stays one.
        if (
          error instanceof AbciQueryError &&
          error.code === SDK_ERR_KEY_NOT_FOUND
        ) {
          return { keyStore: undefined };
        }
        throw error;
      }

      const { user_cosmos_public_key: cosmosKey } =
        QueryGetUserCosmosPublicKeyResponse.decode(value);
      return cosmosKey?.length
        ? {
            keyStore: {
              cosmosPublicKey: Buffer.from(cosmosKey).toString("base64"),
              pulsarAddress: pulsarAddressFromCosmosPubkey(cosmosKey),
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
