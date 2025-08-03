import Image from "next/image"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"
import toast from "react-hot-toast"
import { useMinaPrice, usePminaBalance } from "@/lib/hooks"
import { useQueryClient } from "@tanstack/react-query"

export const MainView = ({ setCurrentView, setPopupWalletType }: {
  setCurrentView: (view: 'main' | 'send') => void
  setPopupWalletType: (isOpen: boolean) => void
}) => {
  const { disconnectWallet: disconnectMina, account: minaAccount, isConnected: isMinaConnected } = useMinaWallet();
  const { disconnect: disconnectKeplr, address: keplrAddress, status: keplrStatus } = usePulsarWallet();
  const queryClient = useQueryClient();

  const isKeplrConnected = keplrStatus === 'Connected' && keplrAddress;
  const currentWallet = isMinaConnected && minaAccount ? 'mina' : isKeplrConnected ? 'cosmos' : null;
  const currentAddress = currentWallet === 'mina' ? minaAccount : keplrAddress;

  const {
    data: pminaBalance,
    isLoading: isLoadingBalance,
    isFetching: isFetchingBalance,
    error: balanceError,
    refetch: refetchBalance
  } = usePminaBalance(minaAccount, {
    enabled: !!minaAccount && isMinaConnected && currentWallet === 'mina',
  });

  const {
    data: priceData,
    isLoading: isLoadingPrice,
    isFetching: isFetchingPrice,
    error: priceError,
  } = useMinaPrice({
    enabled: !!minaAccount && isMinaConnected && !isLoadingBalance && !isFetchingBalance && pminaBalance !== undefined && currentWallet === 'mina',
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
    } else if (currentWallet === 'cosmos') {
      disconnectKeplr();
      toast.success('Cosmos Wallet disconnected', { id: 'wallet-disconnected' });
    }
    setPopupWalletType(false);
  };

  const getBalance = () => {
    if (currentWallet === 'mina') {
      return pminaBalance ? `${pminaBalance.toFixed(3)} pMINA` : '0.000 pMINA';
    } else if (currentWallet === 'cosmos') {
      return '0.000 ATOM';
    }
    return '0.000';
  };

  const getBalanceUSD = () => {
    if (currentWallet === 'mina' && priceData?.data && pminaBalance) {
      return (
        <h3 className={`text-base transition-all duration-300 ${isLoadingPrice || isFetchingPrice || isFetchingBalance ? 'opacity-30' : ''}`}>
          <span className="text-black font-medium">
            ${(pminaBalance * priceData.data.price).toFixed(2)}
          </span>
          <span className={`ml-2 ${priceData.data.change24h >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ({priceData.data.change24h >= 0 ? '+' : ''}{priceData.data.change24h.toFixed(2)}%)
          </span>
        </h3>
      );
    }
    return <h3 className="text-base text-gray-400">$0.00 (0.00%)</h3>;
  };

  if (!currentWallet) {
    return (
      <div className="text-center text-gray-500">
        No wallet connected
      </div>
    );
  }

  return (
    <>
      <div className="flex w-full justify-between">
        {currentWallet === 'mina' ? (
          <Image src="/mina-token-logo.png" alt="Mina Logo" width={36} height={36} />
        ) : (
          <Image src="/pulsar-token-logo.png" alt="Pulsar Logo" width={36} height={36} />
        )}
        <div className="flex gap-2">
          <button className="flex items-center justify-center size-6 bg-neutral-300 hover:bg-neutral-400 rounded-[10px]">
            <Image src="/settings.svg" alt="Settings" width={14} height={14} />
          </button>
          <button
            className="flex items-center justify-center size-6 bg-neutral-300 hover:bg-neutral-400 rounded-[10px]"
            onClick={handleDisconnect}
          >
            <Image src="/disconnect.svg" alt="Disconnect" width={14} height={14} />
          </button>
        </div>
      </div>

      <button className="flex items-center gap-2 text-black font-medium text-base leading-none cursor-pointer mt-2" onClick={handleCopyAddress} title={currentAddress || ''}>
        {currentAddress?.slice(0, 6)}...{currentAddress?.slice(-6)}
        <Image src="/copy.svg" alt="Copy" width={10} height={10} className="mt-1" />
      </button>

      <div className="mt-4">
        {balanceError && currentWallet === 'mina' ? (
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
          <h1 className={`text-black font-bold text-4xl leading-none transition-all duration-300 ${currentWallet === 'mina' && isFetchingBalance ? 'opacity-30' : ''}`}>
            {getBalance()}
          </h1>
        )}
        <div className="flex items-center justify-between mt-1">
          {priceError && currentWallet === 'mina' ? (
            <h3 className="text-base text-red-500">Price unavailable</h3>
          ) : (
            getBalanceUSD()
          )}

          {!balanceError && currentWallet === 'mina' && (
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