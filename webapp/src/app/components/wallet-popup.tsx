import Image from "next/image"
import toast from "react-hot-toast"
import { useWallet } from "@/lib/wallet-context"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { client } from "@/lib/client"
import { useState } from "react"

interface WalletPopupProps {
  isOpen: boolean
  onClose: () => void
}

const fetchPminaBalance = async (account: string): Promise<number> => {
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

  if (Math.random() < 0.05)
    throw new Error('Failed to fetch balance from Osmosis RPC');

  const mockBalance = 125.674 + (Math.random() - 0.5) * 10;
  return Number(mockBalance.toFixed(3));
};

export default function WalletPopup({ isOpen, onClose }: WalletPopupProps) {
  const { connectWallet, isConnected, account, isConnecting, error, isWalletInstalled, disconnectWallet, signMessage } = useWallet();
  const queryClient = useQueryClient();
  const [currentView, setCurrentView] = useState<'main' | 'send'>('main');
  const [sendAmount, setSendAmount] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');

  const {
    data: pminaBalance,
    isLoading: isLoadingBalance,
    isFetching: isFetchingBalance,
    error: balanceError,
    refetch: refetchBalance
  } = useQuery({
    queryKey: ['pminaBalance', account],
    queryFn: () => fetchPminaBalance(account!),
    enabled: !!account && isConnected,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  const {
    data: priceData,
    isLoading: isLoadingPrice,
    isFetching: isFetchingPrice,
    error: priceError,
    refetch: refetchPrice
  } = useQuery({
    queryKey: ['minaPrice'],
    queryFn: async () => {
      const res = await client.price.mina.$get();
      return await res.json();
    },
    enabled: !!account && isConnected && !isLoadingBalance && !isFetchingBalance && pminaBalance !== undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    retryDelay: 1000,
  });

  if (balanceError)
    toast.error('Failed to load balance from Osmosis RPC', { id: 'balance-error' });

  if (!isOpen) return null

  const handleAuroExtensionClick = async () => {
    if (!isWalletInstalled) {
      toast.error('Auro Wallet not found. Please install the extension first.', {
        id: 'wallet-not-found'
      });
      window.open('https://chrome.google.com/webstore/detail/auro-wallet/cnmamaachppnkjgnildpdmkaakejnhae', '_blank');
      return;
    }

    try {
      await connectWallet();
      toast.success('Wallet connected successfully!', {
        id: 'wallet-connected'
      });
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      toast.error('Failed to connect wallet. Please try again.', {
        id: 'wallet-connection-failed'
      });
    }
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(account || '');
      toast.success('Address copied to clipboard!', {
        id: 'address-copied'
      });
    } catch (error) {
      toast.error('Failed to copy address. Please try again.', {
        id: 'copy-failed'
      });
    }
  };

  const handleClose = () => {
    setCurrentView('main');
    setSendAmount('');
    setRecipientAddress('');
    onClose();
  };

  const handleSendClick = () => {
    setCurrentView('send');
  };

  const handleBackToMain = () => {
    setCurrentView('main');
    setSendAmount('');
    setRecipientAddress('');
  };

  const handleMaxClick = () => {
    if (pminaBalance) {
      setSendAmount(pminaBalance.toString());
    }
  };

  const calculateUsdValue = () => {
    const amount = parseFloat(sendAmount) || 0;
    if (priceData?.data && amount > 0) {
      return (amount * priceData.data.price).toFixed(2);
    }
    return '0.00';
  };

  const renderSendView = () => (
    <>
      <div className="flex items-center gap-3 mb-3 justify-between">
        <h3 className="text-xl font-semibold text-black">Send pMINA</h3>
        <Image src="/back-arrow.svg" alt="Back" width={14} height={14} onClick={handleBackToMain} className="cursor-pointer" />
      </div>

      <div className="bg-neutral-300 rounded-xl px-4 py-3 flex flex-col gap-1 mb-6">
        <label className="block text-xl font-medium text-700 mb-2 leading-none">
          Amount
        </label>
        <input
          type="number"
          value={sendAmount}
          onChange={(e) => setSendAmount(e.target.value)}
          min={0}
          max={pminaBalance || 0}
          step="0.001"
          placeholder="0.000"
          className="w-full focus:outline-none text-5xl font-semibold placeholder:font-medium bg-transparent"
        />
        <div className="flex justify-between items-center">
          <span className="text-base text-gray-600 mr-auto">
            ~${calculateUsdValue()}
          </span>
          <span className="text-base text-gray-600 mr-2">
            Balance: {pminaBalance?.toFixed(3) || '0.000'}
          </span>
          <button
            onClick={handleMaxClick}
            className="text-base text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
          >
            MAX
          </button>
        </div>
      </div>

      <div className="bg-neutral-300 rounded-xl px-4 py-3 flex flex-col gap-1 relative mb-3">
        <label className="block text-xl font-medium text-700 mb-2 leading-none">
          Recipient Address
        </label>
        <input
          type="text"
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value)}
          placeholder="B62q..."
          className="w-full focus:outline-none text-base placeholder:text-base pr-6"
        />
        <Image src="/notebook.svg" alt="Save address" width={14} height={14} className="absolute right-4 bottom-4" />
      </div>

      <button
        onClick={async () => {
          try {
            const amount = parseFloat(sendAmount);
            if (!sendAmount || amount <= 0) {
              toast.error('Please enter a valid amount', { id: 'invalid-amount' });
              return;
            }

            if (!recipientAddress || recipientAddress.trim() === '') {
              toast.error('Please enter a recipient address', { id: 'invalid-recipient' });
              return;
            }

            if (pminaBalance && amount > pminaBalance) {
              toast.error('Insufficient balance', { id: 'insufficient-balance' });
              return;
            }

            const transactionMessage = JSON.stringify({
              type: 'send',
              from: account,
              to: recipientAddress.trim(),
              amount: amount.toString(),
              currency: 'pMINA',
              timestamp: new Date().toISOString()
            });

            toast.loading('Please sign the transaction in your wallet...', { id: 'signing-transaction' });

            const signedData = await signMessage({ message: transactionMessage });

            toast.dismiss('signing-transaction');
            toast.success('Transaction signed successfully!', { id: 'transaction-signed' });

            console.log('Signed transaction:', {
              message: transactionMessage,
              signature: signedData
            });

            setSendAmount('');
            setRecipientAddress('');
            setCurrentView('main');

          } catch (error) {
            toast.dismiss('signing-transaction');
            toast.error(error instanceof Error ? error.message : 'Failed to sign transaction', {
              id: 'signing-failed'
            });
            console.error('Transaction signing failed:', error);
          }
        }}
        className="flex cursor-pointer items-center justify-center gap-3 p-1.5 text-base text-black font-semibold rounded-xl transition-colors bg-neutral-300 hover:bg-neutral-400"
      >
        <p className="mb-1">Send</p>
        <div className="flex items-center justify-center size-8 bg-[#2C202A] rounded-full">
          <Image src="/arrow.svg" alt="Send" width={14} height={14} className="-rotate-45" />
        </div>
      </button>

      <div className="flex flex-col justify-between mt-6 gap-2">
        <h2 className="text-base font-light text-black">Saved addresses</h2>
        <div className="flex flex-col items-center w-full cursor-pointer">
          {[
            {
              name: 'Yunus',
              address: 'B62qneWKP5bz1pJmwBXH13paefN9R59BtYoUszC9vbQEZdV6jqpuGFK',
            },
            {
              name: 'Mete',
              address: 'B62qpeiVLCfkwetYqDazs9Bz88Ykfw5ZqjqdrvZHrjfpRvTzvboJ1Sp',
            },
            {
              name: 'Aleyna',
              address: 'B62qpeiVLZqjqdrvZHrjfpRvTzvboJ1SpCfkwetYqDazs9Bz88Ykf25',
            },
          ].map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-2 w-full group hover:bg-neutral-300 rounded-xl p-2 transition-colors"
              onClick={() => {
                setRecipientAddress(_.address);
              }}
            >
              <Image src="/mina-token-logo.png" alt="Mina Logo" width={32} height={32} />
              <div className="flex flex-col mr-auto text-base justify-between text-black leading-none">
                <p className="font-medium">{_.name}</p>
                <p className="font-light">{_.address.slice(0, 6)}...{_.address.slice(-6)}</p>
              </div>
              <Image src="/trash-icon.svg" alt="Delete" width={12} height={12} />
            </div>
          ))}
        </div>
      </div>
    </>
  );

  return (
    <div className="absolute flex flex-col top-full right-0 mt-2 w-88 min-h-120 bg-white border border-gray-200 rounded-2xl shadow-lg z-50 py-6 px-4">
      {isConnected && account ? (
        currentView === 'send' ? renderSendView() : (
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
                  handleClose();
                }}
              >
                <Image src="/disconnect.svg" alt="Disconnect" width={14} height={14} />
              </button>
            </div>
          </div>

          <button className="flex items-center gap-2 text-black font-medium text-base leading-none cursor-pointer mt-2" onClick={handleCopyAddress} title={account}>
            {account.slice(0, 6)}...{account.slice(-6)}
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
              onClick={handleSendClick}
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
      ) : (
        <>
          <h3 className="text-xl font-semibold text-black mb-6">Connect a wallet</h3>

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-3 mb-6">
            <button
              onClick={handleAuroExtensionClick}
              disabled={isConnecting}
              className={`w-full px-5 py-7 ${isConnecting
                  ? 'bg-gray-100 cursor-not-allowed'
                  : 'bg-gray-200 hover:bg-gray-300'
                } rounded-xl transition-colors flex items-center gap-5`}
            >
              <Image src="/mina-token-logo.png" alt="Mina Logo" width={36} height={36} />
              <span className="text-black font-semibold text-xl leading-none">
                {isConnecting ? 'Connecting...' :
                  !isWalletInstalled ? 'Install Auro Wallet Extension' : 'Auro Wallet Extension'}
              </span>
            </button>

            <button
              onClick={() => {
                toast('QR code feature coming soon!', {
                  icon: '📱',
                  id: 'qr-coming-soon'
                });
                handleClose();
              }}
              className="w-full px-5 py-7 bg-gray-200 hover:bg-gray-300 rounded-xl transition-colors flex items-center gap-5"
            >
              <div className="relative">
                <Image src="/mina-token-logo.png" alt="Mina Logo" width={36} height={36} />
                <Image src="/qr-code.png" alt="QR Code" width={24} height={24} className="absolute top-1/1 left-1/1 -translate-x-3/4 -translate-y-3/4" />
              </div>
              <div className="text-left">
                <div className="text-black font-semibold text-xl leading-none">Auro Mobile</div>
                <div className="text-gray-600 text-base leading-none">Scan QR code to connect</div>
              </div>
            </button>
          </div>

          <p className="text-gray-600 text-base text-center font-light leading-none mt-auto">
            By connecting a wallet, you agree to Pulsar's <a href="/terms-of-service" className="font-regular text-black">Terms of Service</a> and consent to its <a href="/privacy-policy" className="font-regular text-black">Privacy Policies</a>.
          </p>
        </>
      )}
    </div>
  )
}