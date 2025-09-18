import { useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { client } from "./client"
import { fetchPminaBalance } from "./utils"
import { MINA_RPC_URL } from "./constants"
import { FaucetResponse } from "./types"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"
import { formatMinaPublicKey } from "./crypto"

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
  pulsarWalletAddress?: string | null,
  minaWalletAddress?: string | null,
) {
  return useQuery<{
    keyStore: {
      cosmosPublicKey: string,
      minaPublicKey: string,
      creator: string
    } | undefined,
    error: undefined
  } | {
    keyStore: undefined,
    error: Error
  }, Error>({
    queryKey: ["keyStore", pulsarWalletAddress, minaWalletAddress],
    queryFn: async () => {
      const [responseForPulsar, responseForMina] = await Promise.all([
        pulsarWalletAddress ? fetch(`https://rest.pulsarchain.xyz/interchain_security/minakeys/key_store/${pulsarWalletAddress}`) : null,
        minaWalletAddress ? fetch(`https://rest.pulsarchain.xyz/interchain_security/minakeys/key_store/${await formatMinaPublicKey(minaWalletAddress)}`) : null,
      ]);

      const dataForPulsar = responseForPulsar && responseForPulsar.ok
        ? await responseForPulsar.json() as { keyStore: { cosmosPublicKey: string, minaPublicKey: string, creator: string } }
        : undefined;

      const dataForMina = responseForMina && responseForMina.ok
        ? await responseForMina.json() as { keyStore: { cosmosPublicKey: string, minaPublicKey: string, creator: string } }
        : undefined;

      console.log("dataForPulsar", dataForPulsar);
      console.log("dataForMina", dataForMina);

      if (!dataForPulsar && !dataForMina)
        return { error: new Error('No key store found') };

      if (dataForPulsar && dataForMina) {
        if (
          dataForPulsar.keyStore.creator !== dataForMina.keyStore.creator ||
          dataForPulsar.keyStore.cosmosPublicKey !== dataForMina.keyStore.cosmosPublicKey ||
          dataForPulsar.keyStore.minaPublicKey !== dataForMina.keyStore.minaPublicKey
        ) {
          return { error: new Error('Mismatch key store') };
        }

        return { keyStore: dataForPulsar.keyStore };
      }

      return { keyStore: dataForPulsar?.keyStore ?? dataForMina?.keyStore };
    },
    staleTime: 15_000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    enabled: Boolean(pulsarWalletAddress) || Boolean(minaWalletAddress),
  });
}

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
