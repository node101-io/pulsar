import Image from "next/image"
import { cn } from "@/lib/utils"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"
import toast from "react-hot-toast"
import { useKeyStore, useMinaPrice, usePminaBalance } from "@/lib/hooks"
import { useQueryClient } from "@tanstack/react-query"
import { WalletState } from "@interchain-kit/core"

export const MainView = ({ setCurrentView, setPopupWalletType }: {
  setCurrentView: (view: 'main' | 'send') => void
  setPopupWalletType: (isOpen: boolean) => void
}) => {
  const { disconnectWallet: disconnectMina, account: minaAccount, isConnected: isMinaConnected } = useMinaWallet();
  const { disconnect: disconnectPulsar, address: pulsarAddress, status: pulsarStatus } = usePulsarWallet();
  const queryClient = useQueryClient();
  const { data: keyStore } = useKeyStore(minaAccount);

  const isPulsarConnected = pulsarStatus === WalletState.Connected;
  const currentWallet = isMinaConnected && minaAccount ? 'mina' : isPulsarConnected ? 'pulsar' : null;
  const currentAddress = currentWallet === 'mina' ? minaAccount : pulsarAddress;

  const {
    data: pminaBalance,
    isLoading: isLoadingBalance,
    isFetching: isFetchingBalance,
    error: balanceError,
    refetch: refetchBalance
  } = usePminaBalance(pulsarAddress, {
    enabled: !!pulsarAddress,
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

  const getBalance = () => {
    return pminaBalance ? `${pminaBalance.toFixed(2)} pMINA` : '0.000 pMINA';
  };

  const getBalanceUSD = () => {
    if (currentWallet === 'mina' && priceData && pminaBalance) {
      return (
        <h3 className={cn(
          "text-[13px] leading-none tabular-nums transition-opacity duration-300",
          (isLoadingPrice || isFetchingPrice || isFetchingBalance) && "opacity-30",
        )}>
          <span className="text-ink font-medium">
            ${(pminaBalance * priceData.price).toFixed(2)}
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
      <div className="text-ink-subtle text-center text-[14px]">
        No wallet connected
      </div>
    );
  }

  const isRefreshing = isFetchingBalance || isFetchingPrice;

  return (
    <>
      <div className="bg-surface border-line flex w-full items-center gap-2 rounded-[6px] border p-4">
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

      <div className="bg-surface border-line mt-2 rounded-[6px] border p-4">
        <h1 className="text-ink text-[26px] leading-none font-[550] tracking-[-0.02em] tabular-nums">
          {getBalance()}
        </h1>
        <div className="mt-2.5 flex items-center justify-between">
          {priceError ? (
            <h3 className="text-negative text-[13px] leading-none">Price unavailable</h3>
          ) : (
            getBalanceUSD()
          )}

          {!balanceError && (
            <button
              onClick={() => {
                refetchBalance();
                queryClient.invalidateQueries({ queryKey: ['minaPrice'] });
              }}
              disabled={isRefreshing}
              className={cn(
                "flex items-center gap-1 text-[12px] leading-none transition-colors",
                isRefreshing
                  ? "text-ink-subtle cursor-not-allowed"
                  : "text-ink-subtle hover:text-ink cursor-pointer",
              )}
              title={isRefreshing ? "Refreshing…" : "Refresh balance & price"}
            >
              <span className={cn(isRefreshing && "animate-spin origin-[50%_60%]")}>↻</span>
              Refresh
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setCurrentView("send")}
            className="brand-squircle bg-canvas border-line hover:border-ink flex flex-1 cursor-pointer flex-col items-center gap-1.5 border py-3 transition-colors"
          >
            <Image src="/arrow-dark.svg" alt="" width={14} height={14} className="-rotate-45" />
            <span className="text-ink text-[13px] leading-none font-medium">Send</span>
          </button>
          <button className="brand-squircle bg-canvas border-line hover:border-ink flex flex-1 cursor-pointer flex-col items-center gap-1.5 border py-3 transition-colors">
            <Image src="/arrow-dark.svg" alt="" width={14} height={14} className="rotate-135" />
            <span className="text-ink text-[13px] leading-none font-medium">Receive</span>
          </button>
        </div>
      </div>
    </>
  )
}
