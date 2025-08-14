"use client"

import { cn } from "@/lib/utils"
import Image from "next/image"
import { useConnectedWallet, useFaucetDrip } from "@/lib/hooks"
import { toast } from "react-hot-toast"
import { useState, useEffect, useRef } from "react"

export default function Faucet() {
  const connectedWallet = useConnectedWallet();
  const dripMutation = useFaucetDrip();
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleDrip = () => {
    if (!connectedWallet)
      return toast.error('Please connect your wallet first');

    dripMutation.mutate({ walletAddress: inputRef.current?.value || '' }, {
      onSuccess: (data) => {
        if (!data.success) {
          if (data.error === "Rate limit exceeded" && 'details' in data)
            return toast.error(`Rate limit exceeded: ${data.details.message}`);

          return toast.error(data.error || 'Failed to send tokens');
        }

        toast.success(`Successfully sent ${data.data.amount} ${data.data.token}!`);
      },
      onError: (error) => {
        console.error('Faucet error:', error);
        toast.error('Network error. Please try again.');
      }
    });
  }

  return (
    <main className="bg-[#CBDBDB] rounded-tl-4xl px-8 py-12 flex-1 flex flex-col justify-center">
      <div className="text-center mb-12">
        <h1 className="text-5xl text-background mb-4 tracking-wide uppercase">
          Drip Tokens
        </h1>
        <p className="text-2xl font-medium text-background font-family-darker-grotesque">
          Get your pMINA tokens via the Pulsar Faucet, easily.
        </p>
      </div>

      <div className="w-144 mx-auto bg-text rounded-[30px] p-6 border-1 border-black flex flex-col space-y-5 overflow-hidden">
        <h2 className="text-xl text-background text-center font-medium mb-2">Pulsar Testnet</h2>

        <input
          type="text"
          // value={mounted ? (connectedWallet?.address || '') : ''}
          // readOnly
          ref={inputRef}
          placeholder="Connect wallet to see address"
          className="w-full text-center text-lg text-background focus:outline-none leading-none bg-[#BFBFBF] rounded-2xl p-4 font-family-darker-grotesque placeholder:text-[#666]"
        />

        <div className="text-center text-sm text-background font-family-darker-grotesque">
          Faucet Amount: 10 pMINA per request (24h cooldown)
        </div>

        <button
          disabled={!mounted || !connectedWallet || dripMutation.isPending}
          className={cn(
            "mx-auto px-10 pt-2.5 pb-1.5 flex items-center justify-center gap-3 rounded-full transition-all leading-none text-background text-lg font-medium border-1 border-black",
            !mounted || !connectedWallet || dripMutation.isPending
              ? "opacity-50 cursor-not-allowed bg-gray-200"
              : "hover:bg-background hover:text-text cursor-pointer bg-text"
          )}
          onClick={handleDrip}
        >
          {dripMutation.isPending ? 'Sending...' : 'Drip'}
          <div className="bg-background rounded-full p-2">
            <Image src="/arrow.svg" alt="arrow" width={12} height={12} className="rotate-90" />
          </div>
        </button>
      </div>
    </main>
  );
}