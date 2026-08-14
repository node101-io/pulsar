import Image from "next/image";
import { cn } from "@/lib/utils";
import { usePulsarWallet, WalletState } from "@/app/_providers/pulsar-wallet";
import { useMinaWallet } from "@/app/_providers/mina-wallet";

const Step = ({ name, connected, icon, width, height }: {
  name: string
  connected: boolean
  icon: string
  width: number
  height: number
}) => (
  <h3 className="text-ink flex items-center gap-2 text-[13px] leading-none font-medium">
    <span
      className={cn(
        "flex size-4.5 items-center justify-center rounded-full border transition-colors",
        connected ? "border-accent bg-accent" : "border-line-strong bg-canvas",
      )}
    >
      <Image src={icon} alt="" width={width} height={height} className="w-auto" />
    </span>
    {name}
  </h3>
)

export const ProgressBar = () => {
  const { status: pulsarStatus } = usePulsarWallet();
  const { isConnected: isMinaConnected } = useMinaWallet();

  const isPulsarConnected = pulsarStatus === WalletState.Connected;

  const showMinaFirst = isMinaConnected && !isPulsarConnected;

  const firstWallet = showMinaFirst ? { name: "Mina", connected: isMinaConnected, icon: "/1.svg", width: 9, height: 9 } : { name: "Pulsar", connected: isPulsarConnected, icon: "/1.svg", width: 7, height: 9 };
  const secondWallet = showMinaFirst ? { name: "Pulsar", connected: isPulsarConnected, icon: "/2.svg", width: 7, height: 9 } : { name: "Mina", connected: isMinaConnected, icon: "/2.svg", width: 9, height: 9 };

  return (
    <>
      <div className="flex items-center justify-between px-1 py-3">
        <Step {...firstWallet} />
        <div className="bg-line mx-3 h-px w-full" />
        <Step {...secondWallet} />
      </div>

      <div className="border-accent-strong border-l-2 py-1 pl-4">
        <p className="text-ink-muted text-xs leading-normal">
          <span className="text-ink font-medium">Attention!</span> To dive into Pulsar,
          you should connect both your <span className="text-ink font-medium">Mina</span> and{" "}
          <span className="text-ink font-medium">Pulsar</span> wallets. Don&apos;t worry, this
          is just for the first time.
        </p>
      </div>
    </>
  )
}
