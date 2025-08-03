"use client"

import { cn } from "@/lib/utils"
import { useState, useEffect } from "react"
import Image from "next/image"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { BRIDGE_ADDRESS } from "@/lib/constants"
import { toast } from "react-hot-toast"
import { useMinaPrice, usePminaBalance, useMinaBalance } from "@/lib/hooks"

export default function Bridge() {
  const { account, isConnected } = useMinaWallet()
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [amount, setAmount] = useState<string>('')
  const [gasFee, setGasFee] = useState<number>(0)
  const [isTransacting, setIsTransacting] = useState(false)

  const { data: priceData } = useMinaPrice();

  const {
    data: balanceData,
    isLoading: isLoadingBalance,
    error: balanceError,
  } = useMinaBalance(account, {
    enabled: !!account && isConnected && activeTab === 'deposit',
  });

  const {
    data: pminaBalanceData,
    isLoading: isLoadingPminaBalance,
    error: pminaBalanceError,
  } = usePminaBalance(account, {
    enabled: !!account && isConnected && activeTab === 'withdraw',
  });

  const balance = activeTab === 'deposit'
    ? (balanceData ? Number(balanceData) / 1e9 : 0)
    : (pminaBalanceData || 0);
  const isOverBalance = Number(amount) > balance;
  const hasError = isOverBalance && amount !== '';
  const currentBalanceError = activeTab === 'deposit' ? balanceError : pminaBalanceError;
  const isLoadingCurrentBalance = activeTab === 'deposit' ? isLoadingBalance : isLoadingPminaBalance;

  useEffect(() => {
    setAmount('');
    setGasFee(0);
  }, [activeTab]);

  const handleBridge = async () => {
    if (!account || !isConnected) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!amount || Number(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (hasError) {
      toast.error(`Insufficient ${activeTab === 'deposit' ? 'MINA' : 'pMINA'} balance`);
      return;
    }

    setIsTransacting(true);

    if (activeTab === 'deposit') {
      if (!window.mina?.sendPayment) {
        toast.error('Auro Wallet not found. Please install Auro Wallet.');
        return;
      }

      const result = await window.mina.sendPayment({
        to: BRIDGE_ADDRESS,
        amount: Number(amount),
        fee: gasFee,
        memo: `Pulsar Bridge Deposit: ${amount} MINA`,
      });

      if (!('hash' in result)) {
        switch (result.code) {
          case 1001:
            toast.error('Please connect your Auro Wallet first.');
            break;
          case 1002:
            toast.error('Transaction was rejected by user.');
            break;
          case 20003:
            toast.error('Invalid parameters. Please check address, amount, and fee.');
            break;
          case 23001:
            toast.error('Origin mismatch. Please check if the site is safe.');
            break;
          default:
            toast.error(`Transaction failed: ${result.message || 'Unknown error'}`);
        }
        return;
      }

      toast.success(`Deposit transaction submitted! Hash: ${result.hash.slice(0, 10)}...`);
      setAmount('');
      setGasFee(0);
    } else if (activeTab === 'withdraw') {
      toast.success('Withdraw functionality coming soon!');
    } else {
      toast.error('Invalid tab');
    }

    setIsTransacting(false);
  };

  return (
    <main className="bg-[#CBDBDB] rounded-4xl rounded-b-none px-8 py-12 flex-1 flex flex-col justify-center">
      <div className="text-center mb-12">
        <h1 className="text-5xl text-background mb-4 tracking-wide uppercase">
          Jump To Pulsar
        </h1>
        <p className="text-2xl font-medium text-background font-family-darker-grotesque">
          Bridge your MINA funds to Pulsar for a seamless DeFi experience
        </p>
      </div>

      <div className="w-100 mx-auto bg-text rounded-[30px] p-3 border-1 border-black flex flex-col space-y-5">
        <div className="flex border-1 gap-6 border-black bg-text rounded-full p-1.5">
          <button
            onClick={() => setActiveTab('deposit')}
            className={cn(
              "flex-1 pt-2.5 pb-1.5 justify-center items-center rounded-full transition-all leading-none border-1 border-black",
              activeTab === 'deposit'
                ? "bg-[#66A55A]"
                : "bg-text hover:bg-[#BFF0B5]"
            )}
          >
            DEPOSIT
          </button>
          <button
            onClick={() => setActiveTab('withdraw')}
            className={cn(
              "flex-1 pt-2.5 pb-1.5 justify-center items-center rounded-full transition-all leading-none border-1 border-black",
              activeTab === 'withdraw'
                ? "bg-[#FFAB90]"
                : "bg-text hover:bg-[#FED7C8]"
            )}
          >
            WITHDRAW
          </button>
        </div>

        <div className="rounded-2xl border-1 border-black bg-text p-5 relative flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <span className="text-2xl text-background leading-none">From</span>
            <span className="text-background leading-none">
              {activeTab === 'deposit' ? 'Mina Protocol' : 'Pulsar Network'}
            </span>
          </div>
          <div className="flex items-center justify-between mb-1.5">
            <input min="0" step="1.000" placeholder="0.000" className="w-full pr-5 text-2xl text-background focus:outline-none leading-none" type="number" value={amount} onChange={(e) => {
              setAmount(e.target.value)
              setGasFee(Number(e.target.value) * 0.01)
            }} />
            <button className="bg-text rounded-full p-2.5 pb-1.5 border border-black flex items-center gap-2.5 leading-none transition-colors">
              <span className="text-background">
                {activeTab === 'deposit' ? 'MINA' : 'pMINA'}
              </span>
              {/* <Image src="/dropdown.svg" alt="dropdown" width={14} height={10} /> */}
            </button>
          </div>
          <div className="flex gap-2 font-family-darker-grotesque font-medium">
            {hasError && (
              <div className="leading-none text-[#B40000]">
                Insufficient {activeTab === 'deposit' ? 'MINA' : 'pMINA'} balance
              </div>
            )}
            <div className="leading-none ml-auto text-background cursor-pointer" onClick={() => setAmount(balance.toFixed(3))}>
              Max: {balance.toFixed(3)} {activeTab === 'deposit' ? 'MINA' : 'pMINA'}
            </div>
          </div>
          <div
            className="flex justify-center rounded-full size-12 bg-background absolute -bottom-8.5 left-1/2 -translate-x-1/2 cursor-pointer hover:scale-105 transition-transform"
            onClick={() => setActiveTab(activeTab === 'deposit' ? 'withdraw' : 'deposit')}
          >
            <Image src="/opposite-arrows.svg" alt="opposite-arrows" width={25} height={25} />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border-1 border-black bg-text p-5 pb-4">
          <span className="text-2xl text-background leading-none">To</span>
          <span className="text-background leading-none">
            {activeTab === 'deposit' ? 'Pulsar Network' : 'Mina Protocol'}
          </span>
        </div>

        <div className={cn(
          "grid transition-all duration-300 ease-in-out",
          amount ? "grid-rows-[1fr]" : "grid-rows-[0fr] mb-0 opacity-0"
        )}>
          <div className="overflow-hidden">
            <div className="flex flex-col gap-5 items-center justify-between rounded-2xl border-1 border-black bg-text p-5 pb-4">
              <div className="flex gap-2 w-full items-center justify-between">
                <span className="text-2xl text-background leading-none">You Will<br/>Receive</span>
                <div className="flex flex-col items-end">
                  <span className="text-background leading-none">
                    {(Number(amount) - gasFee).toFixed(3)} {activeTab === 'deposit' ? 'pMINA' : 'MINA'}
                  </span>
                  <span className="text-background leading-none font-family-darker-grotesque">~${((Number(amount) - gasFee) * (priceData?.data?.price || 0)).toFixed(2)}</span>
                </div>
              </div>
              <div className="w-full h-px bg-black"></div>
              <div className="flex gap-2 items-center w-full">
                <Image src="/clock.svg" alt="clock" width={14} height={14} />
                <span className="text-sm text-background leading-none mr-auto mt-1">~2.5 Hours</span>
                <label htmlFor="gas-fee" className="flex items-center gap-0 cursor-pointer">
                  <input type="checkbox" className="hidden peer/gas-fee" id="gas-fee" defaultChecked={true} />
                  <Image src="/gas.svg" alt="gas" width={15} height={15} className="mr-2" />
                  <Image src="/arrow-dark.svg" alt="arrow-right" width={11} height={11} className="peer-checked/gas-fee:rotate-90 transition-all duration-300 mr-2 peer-checked/gas-fee:mr-0" />
                  <div className={cn(
                    "grid transition-all duration-300 ease-in-out peer-checked/gas-fee:grid-cols-[0fr] peer-checked/gas-fee:opacity-0",
                    "grid-cols-[1fr]"
                  )}>
                    <div className="overflow-hidden">
                      <span className="text-nowrap text-base font-medium text-background leading-none font-family-darker-grotesque mb-1">{gasFee.toFixed(3)} pMINA</span>
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>

        <button
          disabled={hasError || !amount || isTransacting || !isConnected}
          className={cn(
            "mx-auto px-10 pt-2.5 pb-1.5 justify-center items-center rounded-full transition-all leading-none border-1 border-black uppercase w-fit",
            hasError || !amount || isTransacting || !isConnected
              ? "opacity-50 cursor-not-allowed bg-gray-200"
              : "hover:bg-background hover:text-text cursor-pointer"
          )}
          onClick={handleBridge}
        >
          {isTransacting ? 'Processing...' : 'Bridge'}
        </button>
      </div>
    </main>
  )
}