"use client"

import { cn } from "@/lib/utils"
import { useState } from "react"
import Image from "next/image"

export default function Transactions() {
  const [activeTransactionType, setActiveTransactionType] = useState<'bridge' | 'pulsar'>('pulsar')

  return (
    <main className="bg-[#CBDBDB] rounded-tl-4xl px-8 py-12 flex-1 flex flex-col justify-center">
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

        {/* Search removed while lists are disabled */}

        {/* Bridge filter removed while lists are disabled */}

        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="flex flex-col w-full h-72 max-h-72 overflow-y-scroll scrollbar scrollbar-thumb-[#66A55A] scrollbar-track-text scrollbar-thumb-border scrollbar-thumb-rounded-full scrollbar-track-rounded-full scrollbar-w-2 scrollbar-hover:scrollbar-thumb-[#58824f]">
            {activeTransactionType === 'bridge' ? (
              <div className="my-auto flex flex-col items-center justify-center h-full">
                <p className="text-2xl text-background mb-4 font-medium font-family-darker-grotesque leading-none">Coming soon</p>
                <Image src="/no-transaction.svg" alt="Coming soon" width={48} height={48} />
              </div>
            ) : (
              <div className="my-auto flex items-center justify-center h-full">
                <p className="text-base text-[#585858] whitespace-pre">View all Pulsar transactions </p>
                <a
                  href="https://explorer.pulsarchain.xyz/pulsar"
                  target="_blank"
                  className="inline-block border-black rounded-full text-background underline text-base hover:-translate-y-px transition-all duration-300"
                >
                  here
                </a>
                .
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}