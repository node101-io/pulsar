import Image from "next/image"
import { toast } from "react-hot-toast"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"
import { useKeyStore } from "@/lib/hooks"

/**
 * The addresses this user can be paid at, and what each one receives.
 *
 * Two addresses because there are two ways money arrives:
 *   - The Pulsar address takes pMINA directly (any Cosmos wallet can pay it).
 *   - The Mina address works twice over — it takes MINA on Mina like any L1
 *     address, and this app's own send flow also accepts it for pMINA,
 *     resolving it through the registry (see send-view). Other Pulsar wallets
 *     cannot do that resolution, which is why the note under it says "in this
 *     app".
 *
 * The Pulsar address shown is the REGISTERED one when Auro is connected — the
 * registry's answer, where bridge credits actually land — with the connected
 * Keplr account only as a fallback when there is no Auro to derive from.
 */
export const ReceiveView = ({ setCurrentView }: {
  setCurrentView: (view: 'main' | 'send' | 'receive') => void
}) => {
  const { account: minaAccount, isConnected: isMinaConnected } = useMinaWallet();
  const { address: connectedPulsarAddress } = usePulsarWallet();
  const { data: keyStore } = useKeyStore(minaAccount);

  const pulsarAddress =
    keyStore?.keyStore?.pulsarAddress ?? connectedPulsarAddress ?? null;
  const minaAddress = isMinaConnected ? minaAccount : null;

  const copy = (label: string, address: string) => {
    navigator.clipboard.writeText(address)
      .then(() => toast.success(`${label} address copied!`))
      .catch(() => toast.error('Failed to copy address. Please try again.'));
  };

  const entries = [
    pulsarAddress && {
      label: "Pulsar",
      symbol: "pMINA",
      address: pulsarAddress,
      icon: "/pulsar-token-logo.svg",
      note: "Receives pMINA on Pulsar",
    },
    minaAddress && {
      label: "Mina",
      symbol: "MINA",
      address: minaAddress,
      icon: "/mina-token-logo.png",
      note: "Receives MINA on Mina — and pMINA when pasted into Send in this app",
    },
  ].filter(Boolean) as {
    label: string; symbol: string; address: string; icon: string; note: string;
  }[];

  return (
    <>
      <button
        type="button"
        className="text-ink m-1 flex w-fit cursor-pointer items-center gap-2.5"
        onClick={() => setCurrentView('main')}
      >
        <Image src="/back-arrow.svg" alt="" width={8} height={14} />
        <h3 className="text-[15px] leading-none font-medium">Receive</h3>
      </button>

      {entries.length === 0 && (
        <p className="text-ink-subtle my-auto text-center text-sm">
          Connect a wallet to see your addresses.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {entries.map(({ label, symbol, address, icon, note }) => (
          <div key={label} className="bg-surface border-line flex flex-col gap-3 rounded-md border p-4">
            <div className="flex items-center gap-2.5">
              <Image
                src={icon}
                alt=""
                width={28}
                height={28}
                className="border-line size-7 shrink-0 rounded-full border"
              />
              <div className="mr-auto flex flex-col gap-1 leading-none">
                <span className="text-ink text-[13px] font-medium">{label}</span>
                <span className="text-ink-subtle text-xs">{symbol}</span>
              </div>
              <button
                type="button"
                onClick={() => copy(label, address)}
                className="brand-squircle border-line hover:border-ink flex size-7 cursor-pointer items-center justify-center border transition-colors"
                aria-label={`Copy ${label} address`}
              >
                <Image src="/copy.svg" alt="" width={12} height={12} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => copy(label, address)}
              className="text-ink cursor-pointer text-left font-mono text-xs leading-normal break-all"
              title="Copy"
            >
              {address}
            </button>
            <p className="text-ink-subtle text-xs leading-[1.4]">{note}</p>
          </div>
        ))}
      </div>
    </>
  )
}
