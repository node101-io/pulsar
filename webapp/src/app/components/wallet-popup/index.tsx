import { useState, useEffect, useRef, RefObject } from "react"
import { motion, AnimatePresence } from "motion/react"
import { SendView } from "./send-view"
import { ConnectView } from "./connect-view"
import { MainView } from "./main-view"
import { ReceiveView } from "./receive-view"
import { useKeyStore } from "@/lib/hooks"
import { useConnectedWallet } from "@/app/components/use-connected-wallet"
import { useQueryClient } from "@tanstack/react-query"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"

export default function WalletPopup({
  isOpen,
  setIsWalletPopupOpen,
  walletButtonRef
}: {
  isOpen: boolean
  setIsWalletPopupOpen: (isOpen: boolean) => void
  walletButtonRef: RefObject<HTMLButtonElement | null>
}) {
  const [currentView, setCurrentView] = useState<'connect' | 'main' | 'send' | 'receive'>('connect');
  const popupRef = useRef<HTMLDivElement>(null);
  const { account: minaAccount } = useMinaWallet();
  const { address: pulsarAddress } = usePulsarWallet();
  const connectedWallet = useConnectedWallet();
  const queryClient = useQueryClient();
  const { data: keyStore } = useKeyStore(minaAccount);

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["keyStore"] });
  }, [connectedWallet?.type, connectedWallet?.address, queryClient]);

  useEffect(() => {
    if (!isOpen) return;

    if (!connectedWallet) {
      setCurrentView('connect');
      return;
    }

    console.log("keyStore", keyStore);
    if (!keyStore?.keyStore) {
      setCurrentView('connect');
      return;
    }

    setCurrentView('main');
  }, [isOpen, connectedWallet, keyStore]);

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
          role="dialog"
          aria-label="Wallet"
          className="bg-canvas border-line fixed top-[calc(var(--header-height)+var(--spacing)*3)] right-8 z-50 flex h-[calc(100dvh-var(--header-height)-var(--spacing)*6)] w-88 flex-col gap-2 overflow-hidden rounded-[8px] border p-3 shadow-[0_8px_30px_rgb(2_1_6/8%)] md:right-[30px]"
        >
          {currentView === 'connect' && <ConnectView keyStore={keyStore} />}
          {currentView === 'main' && <MainView setCurrentView={setCurrentView} setPopupWalletType={setIsWalletPopupOpen} />}
          {currentView === 'send' && <SendView setCurrentView={setCurrentView} />}
          {currentView === 'receive' && <ReceiveView setCurrentView={setCurrentView} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}