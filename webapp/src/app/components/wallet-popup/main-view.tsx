import Image from "next/image"
import { useWallet } from "@/app/_providers/wallet"
import toast from "react-hot-toast"
import { useMinaPrice, usePminaBalance } from "@/lib/hooks"
import { useQueryClient } from "@tanstack/react-query"
import { WalletType } from "@/lib/types"

export const MainView = ({ setCurrentView, setPopupWalletType }: {
  setCurrentView: (view: 'main' | 'send') => void
  setPopupWalletType: (walletType: WalletType) => void
}) => {
  const { disconnectWallet, account, isConnected } = useWallet();

  const queryClient = useQueryClient();

  const {
    data: pminaBalance,
    isLoading: isLoadingBalance,
    isFetching: isFetchingBalance,
    error: balanceError,
    refetch: refetchBalance
  } = usePminaBalance(account, {
    enabled: !!account && isConnected,
  });

  const {
    data: priceData,
    isLoading: isLoadingPrice,
    isFetching: isFetchingPrice,
    error: priceError,
  } = useMinaPrice({
    enabled: !!account && isConnected && !isLoadingBalance && !isFetchingBalance && pminaBalance !== undefined,
  });

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(account || '')
      .then(() => toast.success('Address copied to clipboard!'))
      .catch(() => toast.error('Failed to copy address. Please try again.'));
  };

  return (
    <>
      <div className="flex w-full justify-between">
        <Image src="/mina-token-logo.png" alt="Mina Logo" width={36} height={36} />
        <div className="flex gap-2">
          <button className="flex items-center justify-center size-6 bg-neutral-300 hover:bg-neutral-400 rounded-[10px]">
            <Image src="/settings.svg" alt="Settings" width={14} height={14} />
          </button>
          <button
            className="flex items-center justify-center size-6 bg-neutral-300 hover:bg-neutral-400 rounded-[10px]"
            onClick={() => {
              disconnectWallet();
              toast.success('Wallet disconnected', {
                id: 'wallet-disconnected'
              });
              setPopupWalletType(null);
            }}
          >
            <Image src="/disconnect.svg" alt="Disconnect" width={14} height={14} />
          </button>
        </div>
      </div>

      <button className="flex items-center gap-2 text-black font-medium text-base leading-none cursor-pointer mt-2" onClick={handleCopyAddress} title={account || ''}>
        {account?.slice(0, 6)}...{account?.slice(-6)}
        <Image src="/copy.svg" alt="Copy" width={10} height={10} className="mt-1" />
      </button>

      <div className="mt-4">
        {balanceError ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-red-600 font-bold text-2xl leading-none">Error loading balance</h1>
            <button
              onClick={() => refetchBalance()}
              className="self-start px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <h1 className={`text-black font-bold text-4xl leading-none transition-all duration-300 ${isFetchingBalance ? 'opacity-30' : ''}`}>
            {pminaBalance ? pminaBalance.toFixed(3) : '0.000'} pMINA
          </h1>
        )}
        <div className="flex items-center justify-between mt-1">
          {priceError ? (
            <h3 className="text-base text-red-500">Price unavailable</h3>
          ) : priceData?.data && pminaBalance ? (
            <h3 className={`text-base transition-all duration-300 ${isLoadingPrice || isFetchingPrice || isFetchingBalance ? 'opacity-30' : ''}`}>
              <span className="text-black font-medium">
                ${(pminaBalance * priceData.data.price).toFixed(2)}
              </span>
              <span className={`ml-2 ${priceData.data.change24h >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ({priceData.data.change24h >= 0 ? '+' : ''}{priceData.data.change24h.toFixed(2)}%)
              </span>
            </h3>
          ) : (
            <h3 className={`text-base text-gray-400 transition-all duration-300 ${isLoadingPrice || isFetchingPrice || isFetchingBalance ? 'opacity-30' : ''}`}>$0.00 (0.00%)</h3>
          )}

          {!balanceError && (
            <button
              onClick={() => {
                refetchBalance();
                queryClient.invalidateQueries({ queryKey: ['minaPrice'] });
              }}
              disabled={isFetchingBalance || isFetchingPrice}
              className={`text-xs font-medium transition-all duration-200 flex items-center gap-1 ${isFetchingBalance || isFetchingPrice
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-400 hover:text-gray-600 cursor-pointer'
                }`}
              title={(isFetchingBalance || isFetchingPrice) ? "Refreshing..." : "Refresh balance & price"}
            >
              <span className={`${(isFetchingBalance || isFetchingPrice) ? 'animate-spin origin-[50%_60%]' : ''}`}>↻</span>
              Refresh
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={() => setCurrentView("send")}
          className="flex-1 flex flex-col gap-1 items-center py-2 bg-neutral-300 hover:bg-neutral-400 rounded-xl transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-center size-9 bg-[#2C202A] rounded-full">
            <Image src="/arrow.svg" alt="Send" width={12} height={12} className="-rotate-45" />
          </div>
          <span className="text-black font-semibold text-base">Send</span>
        </button>
        <button className="flex-1 flex flex-col gap-1 items-center py-2 bg-neutral-300 hover:bg-neutral-400 rounded-xl transition-colors cursor-pointer">
          <div className="flex items-center justify-center size-9 bg-[#2C202A] rounded-full">
            <Image src="/arrow.svg" alt="Receive" width={12} height={12} className="rotate-135" />
          </div>
          <span className="text-black font-semibold text-base">Receive</span>
        </button>
      </div>
    </>
  )
}