"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { usePathname } from "next/navigation"
import WalletPopup from "./wallet-popup/index"
import Image from "next/image"
import Link from "next/link"
import { useConnectedWallet } from "@/app/components/use-connected-wallet"

const formatAddress = (address: string) => {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/**
 * The brand's nav link: the label rolls up on hover and its copy rolls in
 * behind it. Two stacked spans inside a 1em mask, moved as one.
 */
const NavLink = ({ href, label, isActive }: {
  href: string
  label: string
  isActive: boolean
}) => (
  <Link
    href={href}
    aria-current={isActive ? "page" : undefined}
    className={cn(
      "group inline-block text-[13px] font-[450] whitespace-nowrap transition-colors",
      isActive ? "text-accent-strong" : "text-ink",
    )}
  >
    {/*
      The mask, the label and its copy all share one height. It has to clear the
      descenders — at 1em the "g" in Bridge is sliced off and the copy's
      ascenders show through from below — and the copy sits exactly one mask
      height down (top-full), so travelling its own height (-translate-y-full)
      lands it precisely where the label was. Change the three together.
    */}
    <span className="relative block h-[1.45em] overflow-hidden motion-reduce:overflow-visible">
      <span className="block h-[1.45em] leading-[1.45em] transition-transform duration-200 ease-in-out group-hover:-translate-y-full motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        {label}
      </span>
      <span
        aria-hidden="true"
        className="absolute top-full left-0 block h-[1.45em] leading-[1.45em] transition-transform duration-200 ease-in-out group-hover:-translate-y-full motion-reduce:hidden"
      >
        {label}
      </span>
    </span>
  </Link>
)

export default function Header() {
  const [isWalletPopupOpen, setIsWalletPopupOpen] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const walletButtonRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()
  const connectedWallet = useConnectedWallet()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const isActive = (path: string) => pathname.startsWith(path)

  const handleWalletButtonClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsWalletPopupOpen(!isWalletPopupOpen);
  };

  const showConnectedWallet = isMounted && connectedWallet

  return (
    <header className="bg-canvas border-line flex h-[var(--header-height)] w-full shrink-0 items-center justify-between border-b px-8 md:px-[30px]">
      <div className="flex items-center gap-2.5">
        <Link href="/bridge" aria-label="Pulsar home" className="flex items-center">
          <Image src="/logo.svg" alt="Pulsar" width={80} height={23} className="h-[23px] w-auto" priority />
        </Link>
        <span className="bg-surface text-accent-deep rounded-[2px] px-[5px] py-[3px] text-[8px] leading-none font-medium tracking-[0.08em] uppercase">
          Devnet
        </span>
      </div>

      <nav aria-label="Primary navigation" className="flex items-center gap-10">
        <NavLink href="/bridge" label="Bridge" isActive={isActive("/bridge")} />
        <NavLink href="/transactions" label="Transactions" isActive={isActive("/transactions")} />
      </nav>

      <div className="relative flex items-center">
        <button
          ref={walletButtonRef}
          onClick={handleWalletButtonClick}
          aria-expanded={isWalletPopupOpen}
          aria-haspopup="dialog"
          className={cn(
            "brand-squircle flex cursor-pointer items-center gap-2 text-[13px] leading-none font-medium transition-colors",
            showConnectedWallet
              ? cn(
                  "border py-1 pr-3.5 pl-1",
                  isWalletPopupOpen
                    ? "border-ink bg-surface text-ink"
                    : "border-line text-ink hover:border-ink",
                )
              : cn(
                  "h-[34px] px-4",
                  isWalletPopupOpen ? "bg-ink-muted text-ink-inverse" : "bg-ink text-ink-inverse",
                ),
          )}
        >
          {!showConnectedWallet ? (
            <span>Connect Wallet</span>
          ) : (
            <>
              <Image
                src={connectedWallet.type === "mina" ? "/mina-token-logo.png" : "/pulsar-token-logo.svg"}
                alt=""
                width={24}
                height={24}
                className="border-line size-6 rounded-full border"
              />
              <span className="tabular-nums">{formatAddress(connectedWallet.address)}</span>
            </>
          )}
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
