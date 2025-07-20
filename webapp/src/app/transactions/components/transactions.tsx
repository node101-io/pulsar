"use client"

import { cn } from "@/lib/utils"
import { useState } from "react"
import Image from "next/image"
import { useWallet } from "@/app/_providers/wallet"
import { useMinaPrice } from "@/lib/hooks"

export default function Transactions() {
  const { account, isConnected } = useWallet()
  const [activeTransactionType, setActiveTransactionType] = useState<'bridge' | 'pulsar'>('bridge')
  const [activeStatusFilter, setActiveStatusFilter] = useState<'pending' | 'settled'>('pending')
  const [searchAddress, setSearchAddress] = useState<string>('')

  const { data: priceData } = useMinaPrice();

  const price = priceData?.data?.price || 0;

  const mockTransactions = {
    bridge: [
      {
        hash: '0xa7b9d5e2f3c8410296fe',
        status: 'pending',
        amount: 150.5,
        date: new Date('2024-01-15'),
        type: 'incoming'
      },
      {
        hash: '0x3f2a8c7d1e9b5048362c',
        status: 'pending',
        amount: 75.25,
        date: new Date('2024-01-14'),
        type: 'outgoing'
      },
      {
        hash: '0x8e4b6a1c9f3d2587041b',
        status: 'settled',
        amount: 200.0,
        date: new Date('2024-01-13'),
        type: 'outgoing'
      },
      {
        hash: '0x5c9f2d7a4e8b1396054f',
        status: 'pending',
        amount: 42.75,
        date: new Date('2024-01-12'),
        type: 'incoming'
      },
      {
        hash: '0x2d8a5f3c6e1b9074285a',
        status: 'settled',
        amount: 89.3,
        date: new Date('2024-01-11'),
        type: 'outgoing'
      },
      {
        hash: '0x7f4a2c8e5b9d1036247e',
        status: 'pending',
        amount: 125.8,
        date: new Date('2024-01-10'),
        type: 'incoming'
      },
      {
        hash: '0x1b6d9e3a7f4c2058391c',
        status: 'settled',
        amount: 67.45,
        date: new Date('2024-01-09'),
        type: 'outgoing'
      },
      {
        hash: '0x9a3f5c8b2e7d1047582f',
        status: 'pending',
        amount: 300.0,
        date: new Date('2024-01-08'),
        type: 'incoming'
      },
      {
        hash: '0x4e7b1d8a3f5c9026174b',
        status: 'settled',
        amount: 55.9,
        date: new Date('2024-01-07'),
        type: 'outgoing'
      },
      {
        hash: '0x8c2f6a9e1d4b7035268d',
        status: 'pending',
        amount: 180.25,
        date: new Date('2024-01-06'),
        type: 'incoming'
      },
      {
        hash: '0x3a8d5f2c9e7b1046359e',
        status: 'settled',
        amount: 95.75,
        date: new Date('2024-01-05'),
        type: 'outgoing'
      },
      {
        hash: '0x6f1c4a8e2d9b5037481a',
        status: 'pending',
        amount: 220.5,
        date: new Date('2024-01-04'),
        type: 'incoming'
      },
      {
        hash: '0x2e9b5d1a7f4c8026593c',
        status: 'settled',
        amount: 73.2,
        date: new Date('2024-01-03'),
        type: 'outgoing'
      },
      {
        hash: '0x7d4f8a3c6e2b9015274f',
        status: 'pending',
        amount: 165.8,
        date: new Date('2024-01-02'),
        type: 'incoming'
      },
      {
        hash: '0x5b8e2a9f1d6c4037582b',
        status: 'settled',
        amount: 112.45,
        date: new Date('2024-01-01'),
        type: 'outgoing'
      }
    ],
    pulsar: []
  }

  return (
    <main className="bg-[#CBDBDB] rounded-4xl rounded-b-none px-8 py-12 flex-1 flex flex-col justify-center">
      <div className="w-144 mx-auto bg-text rounded-[30px] p-3 pb-0 border-1 border-black flex flex-col space-y-5 overflow-hidden">
        {/* Transaction Type Tabs */}
        <div className="mb-5">
          <div className="flex border-1 gap-2 border-black bg-text rounded-full p-1.5">
            <button
              onClick={() => setActiveTransactionType('bridge')}
              className={cn(
                "flex-1 pt-2.5 pb-1.5 justify-center items-center rounded-full transition-all leading-none border-1 border-black uppercase cursor-pointer",
                activeTransactionType === 'bridge'
                  ? "bg-[#FFE68C]"
                  : "bg-text hover:bg-[#fff8de]"
              )}
            >
              BRIDGE TRANSACTIONS
            </button>
            <button
              onClick={() => setActiveTransactionType('pulsar')}
              className={cn(
                "flex-1 pt-2.5 pb-1.5 justify-center items-center rounded-full transition-all leading-none border-1 border-black uppercase cursor-pointer",
                activeTransactionType === 'pulsar'
                ? "bg-[#FFE68C]"
                : "bg-text hover:bg-[#fff8de]"
            )}
            >
              PULSAR TRANSACTIONS
            </button>
          </div>
        </div>

        <div className="mb-5">
          <div className="relative max-w-4xl mx-auto">
            <Image src="/search.svg" alt="Search" width={14} height={15} className="absolute left-6 top-1/2 transform -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search any transaction hash"
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
              className="w-full pl-14 pr-4 pb-2.5 pt-1.5 text-xl font-medium font-family-darker-grotesque leading-none text-[#666] bg-text border-1 border-black rounded-full focus:outline-none placeholder:text-[#999]"
            />
          </div>
        </div>

        {activeTransactionType === 'bridge' && (
          <div className="flex gap-3 bg-text w-full font-semibold text-base font-family-darker-grotesque">
            <button
              onClick={() => setActiveStatusFilter('pending')}
              className={cn(
                "flex-1 pt-3 pb-3.5 justify-center items-center rounded-full transition-all leading-none border-1 border-black uppercase",
                activeStatusFilter === 'pending'
                  ? "bg-[#D5EBEB]"
                  : "bg-text hover:bg-[#e4eded]"
              )}
            >
              PENDING TRANSACTIONS
            </button>
            <button
              onClick={() => setActiveStatusFilter('settled')}
              className={cn(
                "flex-1 pt-3 pb-3.5 justify-center items-center rounded-full transition-all leading-none border-1 border-black uppercase",
                activeStatusFilter === 'settled'
                  ? "bg-[#D5EBEB]"
                  : "bg-text hover:bg-[#e4eded]"
              )}
            >
              SETTLED TRANSACTIONS
            </button>
          </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-center text-center">
          {!isConnected ? (
            <div className="my-24 flex flex-col items-center justify-center">
              <p className="text-2xl text-background mb-4 font-medium font-family-darker-grotesque leading-none">
                Connect wallet to display<br />your transactions.
              </p>
              <Image src="/no-transaction.svg" alt="No transactions" width={48} height={48} />
            </div>
          ) : (
            <div className="flex flex-col w-full h-72 max-h-72 overflow-y-scroll scrollbar scrollbar-thumb-[#66A55A] scrollbar-track-text scrollbar-thumb-border scrollbar-thumb-rounded-full scrollbar-track-rounded-full scrollbar-w-2 scrollbar-hover:scrollbar-thumb-[#58824f]">
              {activeTransactionType === 'bridge' ? (
                <>
                  {(() => {
                    const filteredTransactions = mockTransactions.bridge
                      .filter(transaction =>
                        transaction.status === activeStatusFilter &&
                        transaction.hash.toLowerCase().includes(searchAddress.toLowerCase())
                      );

                    return filteredTransactions.length > 0 ? (
                      <div className="gap-4 flex flex-col pr-6 pb-4">
                        {filteredTransactions.map((transaction) => (
                        <a
                          key={transaction.hash}
                          className="flex gap-3 items-center justify-between"
                          href={`https://minascan.io/mainnet/tx/${transaction.hash}/txInfo`}
                          target="_blank"
                        >
                          <div className={cn(
                            "flex items-center justify-center size-8 border-1 border-black rounded-full",
                            transaction.type === "outgoing" ? "bg-[#FFAB90]" : "bg-[#CBDCDB]"
                          )}>
                            <Image src='/arrow-dark.svg' width={14} height={14} alt="Arrow" className={cn(transaction.type === "outgoing" ? "-rotate-45" : "rotate-135")} />
                          </div>
                          <div className="flex flex-col items-start mr-auto pb-1">
                            <h3 className="text-xl text-background font-medium font-family-darker-grotesque leading-none">{transaction.type === "outgoing" ? "Bridging to Mina" : "Bridging to Pulsar"}</h3>
                            <p className="text-base text-[#585858] font-medium font-family-darker-grotesque leading-none">{transaction.date.toLocaleDateString()}</p>
                          </div>
                          <div className="flex flex-col items-end">
                            <div className="flex items-center gap-1">
                              <p className="text-base text-[#585858] font-medium font-family-darker-grotesque leading-none">{transaction.amount} MINA</p>
                              <Image src='/mina-token-logo.png' width={16} height={16} alt="Mina" className="border-1 border-black rounded-full mt-1" />
                            </div>
                            <p className="text-base text-[#585858] font-medium font-family-darker-grotesque leading-none">~${(transaction.amount * price).toFixed(2)}</p>
                          </div>
                        </a>
                        ))}
                      </div>
                    ) : (
                      <div className="my-auto flex flex-col items-center justify-center">
                        {searchAddress ? (
                          <div className="text-2xl text-background mb-4 font-medium font-family-darker-grotesque leading-none text-center">
                            <p>No transactions found</p>
                            <p>matching your search.</p>
                          </div>
                        ) : (
                          <p className="text-2xl text-background mb-4 font-medium font-family-darker-grotesque leading-none">
                            No transactions found.
                          </p>
                        )}
                        <Image src="/no-transaction.svg" alt="No transactions" width={48} height={48} />
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div className="my-auto flex flex-col items-center justify-center">
                  {searchAddress ? (
                    <div className="text-2xl text-background mb-4 font-medium font-family-darker-grotesque leading-none text-center">
                      <p>No pulsar transactions found</p>
                      <p>matching your search.</p>
                    </div>
                  ) : (
                    <div className="text-2xl text-background mb-4 font-medium font-family-darker-grotesque leading-none text-center">
                      <p>No pulsar transactions</p>
                      <p>available yet.</p>
                    </div>
                  )}
                  <Image src="/no-transaction.svg" alt="No transactions" width={48} height={48} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}