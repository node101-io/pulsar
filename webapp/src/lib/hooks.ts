import { useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { client } from "./client"
import { fetchPminaBalance } from "./utils"
import { MINA_RPC_URL } from "./constants"
import { FaucetResponse } from "./types"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"

export function useMinaPrice(options?: {
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['minaPrice'],
    queryFn: async () => {
      const res = await client.price.mina.$get();
      return await res.json();
    },
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

export function useFaucetDrip() {
  const queryClient = useQueryClient();

  return useMutation<FaucetResponse, Error, { walletAddress: string }>({
    mutationFn: async (data: { walletAddress: string }) => {
      const res = await client.faucet.drip.$post(data);
      return await res.json() as FaucetResponse;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['pminaBalance', variables.walletAddress]
      });
    },
  });
};

export function useKeyStore(
  address: string | null | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: ["keyStore", address],
    queryFn: async () => {
      const response = await fetch(`http://5.9.42.22:1317/pulsar/cosmos/minakeys/key_store/${address}`);

      if (!response.ok)
        throw new Error(`Failed to fetch key store for address: ${address || ""}`);

      return await response.json();
    },
    enabled: !!address && (options?.enabled ?? true),
    staleTime: 15_000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useBroadcastTx() {
  return useMutation<{ success: boolean, data: { hash: string, code?: number } }, Error, { tx: string }>({
    mutationFn: async ({ tx }) => {
      const res = await client.grpc.call.$post({
        protoFile: "tx_service.proto",
        pkg: "cosmos.tx.v1beta1",
        service: "Service",
        method: "BroadcastTx",
        request: {
          txBytes: tx,
          mode: 'BROADCAST_MODE_SYNC'
        }
      });

      const json = await res.json() as any;
      const hash = json?.data?.txResponse?.txhash || json?.data?.txResponse?.txHash || json?.data?.txhash;

      return { success: !!json?.success, data: { hash, code: json?.data?.txResponse?.code } };
    },
  });
};

export function useConnectedWallet() {
  const { isConnected: isMinaConnected, account: minaAccount } = useMinaWallet();
  const { status: keplrStatus, address: keplrAddress, username: keplrUsername } = usePulsarWallet();

  const connectedWallet = useMemo(() => {
    if (isMinaConnected && minaAccount)
      return {
        type: 'mina' as const,
        address: minaAccount,
      }

    const cosmosAddress = keplrAddress || keplrUsername;

    if (keplrStatus === 'Connected' && cosmosAddress)
      return {
        type: 'cosmos' as const,
        address: cosmosAddress,
      }

    return null;
  }, [isMinaConnected, minaAccount, keplrStatus, keplrAddress, keplrUsername]);

  return connectedWallet;
}
