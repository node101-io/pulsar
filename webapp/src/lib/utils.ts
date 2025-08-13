import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { StargateClient } from "@cosmjs/stargate";
import { consumerChain } from "./constants";

export const stargateClient = await StargateClient.connect(consumerChain.apis?.rpc?.[0]?.address!);

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const fetchPminaBalance = async (account: string): Promise<number> => {
  const balance = await stargateClient.getBalance(account, "stake");
  return Number(balance.amount);
};

export const formatTimeLeft = (ms: number): string => {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}
