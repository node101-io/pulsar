import { useState, useEffect, useRef, RefObject } from "react"
import { SendView } from "./send-view"
import { ConnectView } from "./connect-view"
import { MainView } from "./main-view"
import { useConnectedWallet } from "@/lib/hooks"

export default function WalletPopup({
  isOpen,
  setIsWalletPopupOpen,
  walletButtonRef
}: {
  isOpen: boolean
  setIsWalletPopupOpen: (isOpen: boolean) => void
  walletButtonRef: RefObject<HTMLButtonElement | null>
}) {
  const currentWallet = useConnectedWallet();
  const [currentView, setCurrentView] = useState<'connect' | 'main' | 'send'>('connect');
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (currentWallet)
      setCurrentView('main');
    else
      setCurrentView('connect');
  }, [isOpen, currentWallet]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      if (walletButtonRef.current && walletButtonRef.current.contains(target))
        return;

      if (popupRef.current && !popupRef.current.contains(target))
        setIsWalletPopupOpen(false);
    };

    if (isOpen)
      document.addEventListener('click', handleClickOutside, true);

    return () => document.removeEventListener('click', handleClickOutside, true);
  }, [isOpen, setIsWalletPopupOpen, walletButtonRef]);

  if (!isOpen) return null;

  return (
    <div
      ref={popupRef}
      className="absolute flex flex-col top-full right-0 mt-8 w-88 min-h-160 bg-white rounded-4xl shadow-lg z-50 py-6 px-4 font-family-darker-grotesque border-1 border-background border-solid rounded-tr-none"
    >
      {currentView === 'connect' && <ConnectView />}
      {currentView === 'main' && <MainView setCurrentView={setCurrentView} setPopupWalletType={setIsWalletPopupOpen} />}
      {currentView === 'send' && <SendView setCurrentView={setCurrentView} />}
    </div>
  )
}