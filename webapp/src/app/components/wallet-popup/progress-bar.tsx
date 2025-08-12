import Image from "next/image";
import { cn } from "@/lib/utils";
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet";
import { useMinaWallet } from "@/app/_providers/mina-wallet";
import { WalletState } from "@interchain-kit/core";

export const ProgressBar = () => {
  const { status: pulsarStatus } = usePulsarWallet();
  const { isConnected: isMinaConnected } = useMinaWallet();

  const isPulsarConnected = pulsarStatus === WalletState.Connected;

  const showMinaFirst = isMinaConnected && !isPulsarConnected;

  const firstWallet = showMinaFirst ? { name: "Mina", connected: isMinaConnected, icon: "/1.svg", width: 9, height: 9 } : { name: "Pulsar", connected: isPulsarConnected, icon: "/1.svg", width: 7, height: 9 };
  const secondWallet = showMinaFirst ? { name: "Pulsar", connected: isPulsarConnected, icon: "/2.svg", width: 7, height: 9 } : { name: "Mina", connected: isMinaConnected, icon: "/2.svg", width: 9, height: 9 };

  return (
    <>
      <div className="flex justify-between leading-none font-family-darker-grotesque p-3">
        <h3 className="text-base font-medium text-background flex items-center gap-2">
          <div className={cn("border border-background rounded-full size-4.5 flex items-center justify-center mt-1 bg-[#F5F5F5]", firstWallet.connected && "bg-[#D5EBEB]")}>
            <Image src={firstWallet.icon} alt="1" width={firstWallet.width} height={firstWallet.height} />
          </div>
          {firstWallet.name}
        </h3>
        <div className="border-b border-background w-full h-px mb-2.5 mt-auto mx-3" />
        <h3 className="text-base font-medium text-background flex items-center gap-2">
          <div className={cn("border border-background rounded-full size-4.5 flex items-center justify-center mt-1 bg-[#F5F5F5]", secondWallet.connected && "bg-[#D5EBEB]")}>
            <Image src={secondWallet.icon} alt="2" width={secondWallet.width} height={secondWallet.height} />
          </div>
          {secondWallet.name}
        </h3>
      </div>
      <div className="border border-background rounded-3xl p-4 flex items-center gap-2 bg-[#F5F5F5]">
        <img src="/warning.svg" alt="warning" />
        <p className="leading-4">
          <span className="font-semibold">Attention!</span> To dive into Pulsar, you should connect both your <span className="font-semibold">Mina</span> and <span className="font-semibold">Pulsar</span> wallets. Don't worry this is just for the first time.
        </p>
      </div>

    </>
  )
}
