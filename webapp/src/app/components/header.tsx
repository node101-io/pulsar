"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useWallet } from "@/lib/wallet-context"
import WalletPopup from "./wallet-popup"

type Tab = 'home' | 'bridge' | 'transactions' | 'faucet'

interface HeaderProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
}

export default function Header({ activeTab, onTabChange }: HeaderProps) {
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const { isConnected, account, disconnectWallet } = useWallet()

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  return (
    <header className="w-full bg-white px-12 py-4 flex items-center justify-between h-22">
      <button
        onClick={() => onTabChange('home')}
        className="text-xl font-bold text-black hover:text-gray-700 transition-colors"
      >
        PULSAR
      </button>

      <nav className="flex items-center gap-8 text-xl text-black">
        <button
          onClick={() => onTabChange('bridge')}
          className={cn(
            "hover:text-gray-700 font-medium cursor-pointer w-25 transition-all duration-100",
            activeTab === 'bridge' && "font-bold"
          )}
        >
          Bridge
        </button>
        <button
          onClick={() => onTabChange('transactions')}
          className={cn(
            "hover:text-gray-700 font-medium cursor-pointer w-25 transition-all duration-100",
            activeTab === 'transactions' && "font-bold"
          )}
        >
          Transactions
        </button>
        <button
          onClick={() => onTabChange('faucet')}
          className={cn(
            "hover:text-gray-700 font-medium cursor-pointer w-25 transition-all duration-100",
            activeTab === 'faucet' && "font-bold"
          )}
        >
          Faucet
        </button>
      </nav>

      <div className="relative">
        <button
          onClick={() => setIsPopupOpen(!isPopupOpen)}
          className="bg-neutral-300 hover:bg-neutral-400 text-black px-4 pt-2 pb-[11px] rounded-lg font-bold leading-none transition-all duration-100"
        >
          {isConnected && account ? formatAddress(account) : 'Connect'}
        </button>

        <WalletPopup
          isOpen={isPopupOpen}
          onClose={() => setIsPopupOpen(false)}
        />
      </div>
    </header>
  )
}
