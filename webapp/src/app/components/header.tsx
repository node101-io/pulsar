"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { useWallet } from "@/lib/wallet-context"
import { usePathname } from "next/navigation"
import WalletPopup from "./wallet-popup"
import Image from "next/image"
import Link from "next/link"

type WalletType = 'mina' | 'cosmos' | null

export default function Header() {
  const [popupWalletType, setPopupWalletType] = useState<WalletType>(null)
  const { isConnected, account, disconnectWallet } = useWallet()
  const pathname = usePathname()

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const isActive = (path: string) => {
    if (path === '/') {
      return pathname === '/'
    }
    return pathname.startsWith(path)
  }

  return (
    <header className="w-full px-12 py-4 flex items-center justify-between h-22 bg-background">
      <Link href="/" className="relative">
        <Image
          src="/logo.svg"
          alt="Pulsar"
          width={69}
          height={22}
          className="text-text transition-colors cursor-pointer"
        />
        <span className="absolute top-0 left-0 -translate-x-1/5 -translate-y-1/2 text-background text-[6px] leading-none px-1 pt-1 pb-0.5 bg-[#FFB29A] rounded-full">TESTNET</span>
      </Link>

      <nav className="flex items-center gap-18 text-base text-text">
        <Link
          href="/bridge"
          className={cn(
            "font-medium cursor-pointer transition-color duration-300",
            isActive('/bridge') && "text-[#FB8F6D]"
          )}
        >
          Bridge
        </Link>
        <Link
          href="/transactions"
          className={cn(
            "font-medium cursor-pointer transition-color duration-300",
            isActive('/transactions') && "text-[#FB8F6D]"
          )}
        >
          Transactions
        </Link>
        <Link
          href="/faucet"
          className={cn(
            "font-medium cursor-pointer transition-color duration-300",
            isActive('/faucet') && "text-[#FB8F6D]"
          )}
        >
          Faucet
        </Link>
      </nav>

      <div className="relative flex items-center gap-3">
        {/* Mina Wallet Button */}
        <button
          onClick={() => setPopupWalletType(popupWalletType === 'mina' ? null : 'mina')}
          className={cn(
            "flex cursor-pointer items-center gap-2 border-1 border-text text-base border-solid px-2 py-1.5 rounded-full transition-all duration-100",
          )}
        >
          <Image src="/mina-token-logo.png" alt="Mina Token" width={24} height={24} className="border-1 border-text rounded-full" />
          <span className="pb-1 pt-2 leading-none text-text pr-1">{isConnected && account ? formatAddress(account) : 'MINA'}</span>
        </button>

        {/* Cosmos Wallet Button */}
        <button
          onClick={() => setPopupWalletType(popupWalletType === 'cosmos' ? null : 'cosmos')}
          className={cn(
            "flex cursor-pointer items-center gap-2 border-1 border-text text-base border-solid px-2 py-1.5 rounded-full transition-all duration-100",
          )}
        >
          <div className="w-6 h-6 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-bold">C</span>
          </div>
          <span className="pb-1 pt-2 leading-none text-text pr-1">COSMOS</span>
        </button>

        <WalletPopup
          isOpen={popupWalletType !== null}
          walletType={popupWalletType}
          onClose={() => setPopupWalletType(null)}
        />
      </div>
    </header>
  )
}
