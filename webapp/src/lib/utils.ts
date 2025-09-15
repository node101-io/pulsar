import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { consumerChain } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const fetchPminaBalance = async (account: string): Promise<number> => {
  const balance = await fetch(`http://5.9.42.22:1317/cosmos/bank/v1beta1/balances/${account}`);
  const json = await balance.json() as { balances: { denom: string, amount: string }[] };
  return Number(json.balances.find(item => item.denom === 'stake')?.amount ?? 0);
};

export const formatTimeLeft = (ms: number): string => {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}

export const waitForTxCommit = async (txHashHex: string): Promise<any> => {
  const timeoutMs = 90_000;
  const pollIntervalMs = 1_500;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${consumerChain.apis?.rpc?.[0]?.address}/tx?hash=0x${txHashHex}`);
      if (res.ok) {
        const json: any = await res.json();
        const result = json?.result;
        if (result && result.height && Number(result.height) > 0) {
          const code = result?.tx_result?.code;
          if (typeof code === 'number' && code > 0) {
            const rawLog = result?.tx_result?.log || result?.tx_result?.info || 'Transaction failed';
            throw new Error(rawLog, { cause: 31 });
          }
          return result;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.cause === 31)
        throw new Error(error.message);

      // ignore and keep polling
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error('Transaction not confirmed in time');
};
