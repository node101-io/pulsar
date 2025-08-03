import Image from "next/image"
import { useState } from "react";
import { useMinaPrice } from "@/lib/hooks";
import { toast } from "react-hot-toast";
import { useMinaWallet } from "@/app/_providers/mina-wallet";
import { usePminaBalance } from "@/lib/hooks";

export const SendView = ({ setCurrentView }: {
  setCurrentView: (view: 'main' | 'send') => void
}) => {
  const [sendAmount, setSendAmount] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const { isConnected, signMessage, account } = useMinaWallet();
  const { data: priceData } = useMinaPrice();
  const { data: pminaBalance } = usePminaBalance(account, {
    enabled: !!account && isConnected,
  });

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

  return (
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
  )
}