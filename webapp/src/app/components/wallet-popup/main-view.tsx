import Image from "next/image"
import { cn } from "@/lib/utils"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"
import { useConnectedWallet } from "@/app/components/use-connected-wallet"
import { Spinner } from "@/app/components/spinner"
import type { WalletKind } from "@/lib/connected-wallet"
import toast from "react-hot-toast"
import { useKeyStore, useMinaPrice, usePminaBalance } from "@/lib/hooks"
import { formatAmount, toDisplayNumber } from "@/lib/amount"
import { useQueryClient } from "@tanstack/react-query"

export const MainView = ({ setCurrentView, setPopupWalletType, preferredWallet }: {
  setCurrentView: (view: 'connect' | 'main' | 'send' | 'receive') => void
  setPopupWalletType: (isOpen: boolean) => void
  /** The wallet the user chose on the connect screen; honored while connected. */
  preferredWallet?: WalletKind | null
}) => {
  const { disconnectWallet: disconnectMina, account: minaAccount, isConnected: isMinaConnected } = useMinaWallet();
  const { disconnect: disconnectPulsar, address: pulsarAddress } = usePulsarWallet();
  const queryClient = useQueryClient();
  const { data: keyStore } = useKeyStore(minaAccount);

  const currentWallet = useConnectedWallet(preferredWallet)?.type ?? null;
  const currentAddress = currentWallet === 'mina' ? minaAccount : pulsarAddress;

  // Where this view's pMINA actually lives. Bridge credits land at the
  // REGISTERED account — the registry's answer for the Mina key, which is not
  // necessarily the connected Keplr account (see useKeyStore) — so the Mina
  // view reads that, falling back to the connected account only when there is
  // no registration to ask. The Pulsar view reads the connected account
  // itself: that is the wallet it speaks for.
  const registeredPulsarAddress = keyStore?.keyStore?.pulsarAddress ?? null;
  const balanceAddress =
    currentWallet === 'mina'
      ? registeredPulsarAddress ?? pulsarAddress
      : pulsarAddress;

  // Both wallets connected, but Keplr is not on the account this Mina key is
  // registered to. Everything the bridge does keys on the registered account,
  // so the user must know — and the app cannot switch Keplr accounts for
  // them, so the notice below tells them to.
  const isMismatched =
    !!registeredPulsarAddress && !!pulsarAddress && registeredPulsarAddress !== pulsarAddress;

  const {
    data: pminaBalance,
    isLoading: isLoadingBalance,
    isFetching: isFetchingBalance,
    error: balanceError,
    refetch: refetchBalance
  } = usePminaBalance(balanceAddress, {
    enabled: !!balanceAddress,
  });

  const {
    data: priceData,
    isLoading: isLoadingPrice,
    isFetching: isFetchingPrice,
    error: priceError,
  } = useMinaPrice({
    enabled: !!minaAccount && isMinaConnected && !isLoadingBalance && !isFetchingBalance && pminaBalance !== undefined,
  });

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(currentAddress || '')
      .then(() => toast.success('Address copied to clipboard!'))
      .catch(() => toast.error('Failed to copy address. Please try again.'));
  };

  const handleCopyRegisteredAddress = () => {
    navigator.clipboard.writeText(registeredPulsarAddress || '')
      .then(() => toast.success('Registered address copied — find it in Keplr'))
      .catch(() => toast.error('Failed to copy address. Please try again.'));
  };

  const handleDisconnect = () => {
    if (currentWallet === 'mina') {
      disconnectMina();
      toast.success('Mina Wallet disconnected', { id: 'wallet-disconnected' });
    } else if (currentWallet === 'pulsar') {
      disconnectPulsar();
      toast.success('Pulsar Wallet disconnected', { id: 'wallet-disconnected' });
    }
    setPopupWalletType(false);
  };

  // An unread balance is not a zero balance — same rule as the bridge form.
  // A read still in flight spins; one that failed shows the dash, because a
  // spinner there would promise an answer that is not coming.
  const getBalance = () => {
    if (isLoadingBalance) return <Spinner className="size-5" />;
    if (balanceError)
      return (
        <span title="Your pMINA balance can't be read right now — the balance itself is unaffected">
          <span className="tabular-nums">—</span> pMINA
        </span>
      );
    return `${formatAmount(pminaBalance ?? 0n)} pMINA`;
  };

  const getBalanceUSD = () => {
    // No USD verdict on a balance that has not arrived — "$0.00" under the
    // dash above restates the zero-lie in dollars. The empty line keeps the
    // slot so the Refresh button does not jump.
    if (isLoadingBalance || balanceError) {
      return <h3 className="text-[13px] leading-none">&nbsp;</h3>;
    }
    if (currentWallet === 'mina' && priceData && pminaBalance) {
      return (
        <h3 className={cn(
          "text-[13px] leading-none tabular-nums transition-opacity duration-300",
          (isLoadingPrice || isFetchingPrice || isFetchingBalance) && "opacity-30",
        )}>
          <span className="text-ink font-medium">
            ${(toDisplayNumber(pminaBalance) * priceData.price).toFixed(2)}
          </span>
          <span className={cn("ml-2", priceData.change24h >= 0 ? "text-positive" : "text-negative")}>
            ({priceData.change24h >= 0 ? '+' : ''}{priceData.change24h.toFixed(2)}%)
          </span>
        </h3>
      );
    }
    return <h3 className="text-ink-subtle text-[13px] leading-none tabular-nums">$0.00 (0.00%)</h3>;
  };

  if (!currentWallet) {
    return (
      <div className="text-ink-subtle text-center text-sm">
        No wallet connected
      </div>
    );
  }

  const isRefreshing = isFetchingBalance || isFetchingPrice;

  return (
    <>
      <button
        className="text-ink m-1 flex w-fit cursor-pointer items-center gap-2.5"
        onClick={() => setCurrentView('connect')}
      >
        <Image src="/back-arrow.svg" alt="" width={8} height={14} />
        <h3 className="text-[15px] leading-none font-medium">Wallet</h3>
      </button>

      <div className="bg-surface border-line flex w-full items-center gap-2 rounded-md border p-4">
        <Image
          src={currentWallet === 'mina' ? "/mina-token-logo.png" : "/pulsar-token-logo.svg"}
          alt=""
          width={32}
          height={32}
          className="border-line size-8 shrink-0 rounded-full border"
        />
        <button
          className="text-ink mr-auto flex cursor-pointer items-center gap-2 text-[13px] leading-none font-medium tabular-nums"
          onClick={handleCopyAddress}
          title={currentAddress || ''}
        >
          {currentAddress?.slice(0, 6)}...{currentAddress?.slice(-6)}
          <Image src="/copy.svg" alt="Copy address" width={10} height={10} className="opacity-60" />
        </button>
        <div className="flex gap-1.5">
          <button
            hidden
            aria-label="Settings"
            className="brand-squircle border-line hover:border-ink flex size-7 cursor-pointer items-center justify-center border transition-colors"
          >
            <Image src="/settings.svg" alt="" width={12} height={12} />
          </button>
          <button
            aria-label="Disconnect wallet"
            className="brand-squircle border-line hover:border-negative flex size-7 cursor-pointer items-center justify-center border transition-colors"
            onClick={handleDisconnect}
          >
            <Image src="/disconnect.svg" alt="" width={11} height={11} />
          </button>
        </div>
      </div>

      {isMismatched && (
        <div className="border-negative/40 bg-surface mt-2 rounded-md border px-3.5 py-3 text-xs leading-[1.6]">
          <span className="text-negative font-medium">Keplr is on a different account. </span>
          <span className="text-ink">
            This Mina wallet is registered to{' '}
            <button
              type="button"
              onClick={handleCopyRegisteredAddress}
              title={`${registeredPulsarAddress} — click to copy`}
              className="cursor-pointer font-medium tabular-nums underline decoration-dotted underline-offset-2"
            >
              {registeredPulsarAddress!.slice(0, 6)}...{registeredPulsarAddress!.slice(-6)}
            </button>
            {' '}— bridge deposits land there, not on the connected{' '}
            <span className="tabular-nums">{pulsarAddress!.slice(0, 6)}...{pulsarAddress!.slice(-6)}</span>.
            Switch to that account in the Keplr extension to line them up.
          </span>
        </div>
      )}

      <div className="bg-surface border-line mt-2 rounded-md border p-4">
        <h1 className="text-ink text-[26px] leading-none font-[550] tracking-[-0.02em] tabular-nums">
          {getBalance()}
        </h1>
        <div className="mt-2.5 flex items-center justify-between">
          {priceError ? (
            <h3 className="text-negative text-[13px] leading-none">Price unavailable</h3>
          ) : (
            getBalanceUSD()
          )}

          {/* Shown on error too — a failed read is when retrying matters most. */}
          <button
            onClick={() => {
              refetchBalance();
              queryClient.invalidateQueries({ queryKey: ['minaPrice'] });
            }}
            disabled={isRefreshing}
            className={cn(
              "flex items-center gap-1 text-xs leading-none transition-colors",
              isRefreshing
                ? "text-ink-subtle cursor-not-allowed"
                : "text-ink-subtle hover:text-ink cursor-pointer",
            )}
            title={isRefreshing ? "Refreshing…" : "Refresh balance & price"}
          >
            <span className={cn(isRefreshing && "animate-spin origin-[50%_60%]")}>↻</span>
            Refresh
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setCurrentView("send")}
            className="brand-squircle bg-canvas border-line hover:border-ink flex flex-1 cursor-pointer flex-col items-center gap-1.5 border py-3 transition-colors"
          >
            <Image src="/arrow-dark.svg" alt="" width={14} height={14} className="w-auto -rotate-45" />
            <span className="text-ink text-[13px] leading-none font-medium">Send</span>
          </button>
          <button
            onClick={() => setCurrentView("receive")}
            className="brand-squircle bg-canvas border-line hover:border-ink flex flex-1 cursor-pointer flex-col items-center gap-1.5 border py-3 transition-colors"
          >
            <Image src="/arrow-dark.svg" alt="" width={14} height={14} className="w-auto rotate-135" />
            <span className="text-ink text-[13px] leading-none font-medium">Receive</span>
          </button>
        </div>
      </div>
    </>
  )
}
