import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const fetchPminaBalance = async (account: string): Promise<number> => {
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

  if (Math.random() < 0.05)
    throw new Error('Failed to fetch balance from Osmosis RPC');

  const mockBalance = 125.674 + (Math.random() - 0.5) * 10;
  return Number(mockBalance.toFixed(3));
};

export const formatTimeLeft = (ms: number): string => {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  return `${hours}h ${minutes}m`
}
