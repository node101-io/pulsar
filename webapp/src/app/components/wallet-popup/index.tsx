import toast from "react-hot-toast"
import { useWallet } from "@/app/_providers/wallet"

import { LegalNotice } from "./legal-notice"
import { SendView } from "./send-view"
import { ConnectView } from "./connect-view"
import { MainView } from "./main-view"
import { useState, useEffect, useRef } from "react"
import { ExtensionItem } from "./extension-item"
import { WalletType } from "@/lib/types"

export default function WalletPopup({ isOpen, walletType, setPopupWalletType }: {
  isOpen: boolean
  walletType: WalletType
  setPopupWalletType: (walletType: WalletType) => void
}) {
  const { isConnected, account } = useWallet();
  const [currentView, setCurrentView] = useState<'main' | 'send'>('main');
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node))
        setPopupWalletType(null);
    };

    if (isOpen)
      document.addEventListener('click', handleClickOutside);

    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen, setPopupWalletType]);

  if (!isOpen) return null;

  const renderCosmosWallet = () => (
    <>
      <h3 className="text-xl font-semibold text-black mb-6">
        Connect Cosmos Wallet
      </h3>

      <div className="space-y-3 mb-6">
        <ExtensionItem
          iconComponent={
            <div className="w-9 h-9 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full flex items-center justify-center">
              <span className="text-white text-lg font-bold">K</span>
            </div>
          }
          title="Keplr Wallet Extension"
          onClick={() => {
            toast('Cosmos wallet integration coming soon!', {
              icon: '🚀',
              id: 'cosmos-coming-soon'
            });
          }}
        />

        <ExtensionItem
          iconComponent={
            <div className="w-9 h-9 bg-gradient-to-r from-orange-500 to-red-500 rounded-full flex items-center justify-center">
              <span className="text-white text-lg font-bold">C</span>
            </div>
          }
          title="Cosmostation Extension"
          onClick={() => {
            toast('Cosmostation integration coming soon!', {
              icon: '🌌',
              id: 'cosmostation-coming-soon'
            });
          }}
        />
      </div>

      <LegalNotice />
    </>
  );

  const renderMinaWallet = () => (
    <>
      {!isConnected || !account ? <ConnectView /> : (
        currentView === 'main' ? <MainView setCurrentView={setCurrentView} setPopupWalletType={setPopupWalletType} /> : <SendView setCurrentView={setCurrentView} />
      )}
    </>
  );

  return (
    <div
      ref={popupRef}
      className="absolute flex flex-col top-full right-0 mt-8 w-88 min-h-160 bg-white rounded-4xl shadow-lg z-50 py-6 px-4 font-family-darker-grotesque border-1 border-background border-solid rounded-tr-none"
    >
      {walletType === 'cosmos' ? renderCosmosWallet() : renderMinaWallet()}
    </div>
  )
}