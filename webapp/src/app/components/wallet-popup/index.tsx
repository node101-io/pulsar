import { useState, useEffect, useRef, RefObject } from "react"
import { motion, AnimatePresence } from "motion/react"
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

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={popupRef}
          initial={{ 
            opacity: 0, 
            scale: 0.95,
            x: '100%',
            y: 0
          }}
          animate={{ 
            opacity: 1, 
            scale: 1,
            x: 0,
            y: 0
          }}
          exit={{ 
            opacity: 0, 
            scale: 0.95,
            x: '100%',
            y: 0
          }}
          transition={{ 
            duration: 0.2,
            ease: "easeInOut"
          }}
          className="fixed flex flex-col top-[calc(var(--header-height)+var(--spacing)*5)] right-5 h-[calc(100vh-var(--header-height)-var(--spacing)*10)] w-88 bg-white rounded-4xl shadow-lg z-50 p-3.5 font-family-darker-grotesque border-1 border-background border-solid rounded-tr-none gap-2"
        >
          {currentView === 'connect' && <ConnectView />}
          {currentView === 'main' && <MainView setCurrentView={setCurrentView} setPopupWalletType={setIsWalletPopupOpen} />}
          {currentView === 'send' && <SendView setCurrentView={setCurrentView} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}