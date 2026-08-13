import { useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import {
  AbciQueryError,
  SDK_ERR_KEY_NOT_FOUND,
  abciQuery,
  fetchBridgeTransfers,
  fetchMinaPrice,
  fetchPminaBalance,
} from "./utils"
import { getPulsarAddress } from "./keplr"
import {
  KEYREGISTRY_QUERY_USER_COSMOS_KEY,
  QueryGetUserCosmosPublicKeyRequest,
  QueryGetUserCosmosPublicKeyResponse,
} from "pulsar-chain-client/messages"
import { MINA_RPC_URL } from "./constants"
import { formatMinaPublicKey } from "./crypto"

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

export function useMinaBalance(account: string | null | undefined, options?: {
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['minaBalance', account],
    queryFn: async () => {
      if (!account) throw new Error('No account connected');

      const { fetchAccount } = await import('o1js');
      const accountInfo = await fetchAccount({ publicKey: account }, MINA_RPC_URL);

       if (accountInfo.error || !accountInfo.account)
         return '';

       return accountInfo.account.balance.toString();
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
 * Whether this Mina key is registered on Pulsar, and to which Cosmos key.
 * A deposit from an unregistered key still reaches the chain but is judged
 * invalid, so the UI gates on this rather than letting funds strand.
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
