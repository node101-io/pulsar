"use client"

import { useState, useRef } from "react"
import { cn } from "@/lib/utils"
import { usePathname } from "next/navigation"
import WalletPopup from "./wallet-popup/index"
import Image from "next/image"
import Link from "next/link"
import { useConnectedWallet } from "@/lib/hooks"

const formatAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export default function Header() {
  const [isWalletPopupOpen, setIsWalletPopupOpen] = useState(false)
  const walletButtonRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()
  const connectedWallet = useConnectedWallet()

  const isActive = (path: string) => {
    if (path === '/') {
      return pathname === '/'
    }
    return pathname.startsWith(path)
  }

  const handleWalletButtonClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsWalletPopupOpen(!isWalletPopupOpen);
  };

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
          href="/"
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
        <button
          ref={walletButtonRef}
          onClick={handleWalletButtonClick}
          className={cn(
            "flex cursor-pointer items-center gap-2 border-1 border-text text-base border-solid px-4 rounded-full transition-all duration-100 pb-1 pt-2 leading-none text-text pr-1",
          )}
        >
          {!connectedWallet ? 'Connect Wallet' : (<>
            <Image src={connectedWallet.type === 'mina' ? "/mina-token-logo.png" : "/pulsar-token-logo.png"} alt="Pulsar Token" width={24} height={24} className="border-1 border-text rounded-full" />
            {formatAddress(connectedWallet.address)}
          </>)}
        </button>

        <WalletPopup
          isOpen={isWalletPopupOpen}
          setIsWalletPopupOpen={setIsWalletPopupOpen}
          walletButtonRef={walletButtonRef}
        />
      </div>
    </header>
  )
}
