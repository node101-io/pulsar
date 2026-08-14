import { useState, useEffect, useRef, RefObject } from "react"
import { motion, AnimatePresence } from "motion/react"
import { SendView } from "./send-view"
import { ConnectView } from "./connect-view"
import { MainView } from "./main-view"
import { ReceiveView } from "./receive-view"
import { useCosmosKeyStore, useKeyStore } from "@/lib/hooks"
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
  // Which wallet the main view speaks for when both are connected — the one
  // the user last chose on the connect screen. Falls back to whatever is
  // connected when the choice is stale.
  const [preferredWallet, setPreferredWallet] = useState<'mina' | 'pulsar' | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const { account: minaAccount } = useMinaWallet();
  const { address: pulsarAddress } = usePulsarWallet();
  const connectedWallet = useConnectedWallet();
  const queryClient = useQueryClient();
  const { data: keyStore, isLoading: isKeyStoreLoading } = useKeyStore(minaAccount);

  // Registration read from the Keplr side, for sessions with no Auro to ask
  // through. Either direction proves the same on-chain fact.
  const { data: cosmosKeyStore, isLoading: isCosmosKeyStoreLoading } =
    useCosmosKeyStore(pulsarAddress);

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["keyStore"] });
    queryClient.invalidateQueries({ queryKey: ["cosmosKeyStore"] });
  }, [connectedWallet?.type, connectedWallet?.address, queryClient]);

  // Registered through EITHER wallet's lens is registered. The Auro-side
  // answer requires Auro connected; the Keplr-side answer covers the rest —
  // without it, a registered Keplr-only session was marched back through an
  // onboarding it had already finished.
  const isRegistered = Boolean(keyStore?.keyStore || cosmosKeyStore?.keyStore);
  // While either lookup is still in flight, hold the current view instead of
  // flashing the connect screen at a user who will turn out to be registered.
  const isResolving =
    (minaAccount && isKeyStoreLoading) ||
    (pulsarAddress && !minaAccount && isCosmosKeyStoreLoading);

  // The landing view is decided once per open. Deciding continuously used to
  // work only because nothing could navigate to the connect screen on
  // purpose; now that the main view can, a background query refetch must not
  // yank the user back out of it mid-errand.
  const hasDecidedLandingView = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      hasDecidedLandingView.current = false;
      return;
    }
    if (hasDecidedLandingView.current) return;

    if (!connectedWallet) {
      setCurrentView('connect');
      hasDecidedLandingView.current = true;
      return;
    }
    if (isResolving) return;
    setCurrentView(isRegistered ? 'main' : 'connect');
    hasDecidedLandingView.current = true;
  }, [isOpen, connectedWallet, isRegistered, isResolving]);

  // What ends a visit to the connect screen: finishing a registration, or a
  // registered user attaching the wallet they came for. Keyed to those
  // transitions — not to the query objects, whose identity changes on every
  // refetch.
  const walletsKey = `${minaAccount ?? ''}|${pulsarAddress ?? ''}`;
  const prevRegistered = useRef(isRegistered);
  const prevWalletsKey = useRef(walletsKey);
  useEffect(() => {
    const becameRegistered = isRegistered && !prevRegistered.current;
    const walletAttached = isRegistered && walletsKey !== prevWalletsKey.current;
    prevRegistered.current = isRegistered;
    prevWalletsKey.current = walletsKey;

    if (isOpen && (becameRegistered || walletAttached)) setCurrentView('main');
  }, [isOpen, isRegistered, walletsKey]);

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
          {currentView === 'connect' && (
            <ConnectView
              keyStore={keyStore}
              onOpenWallet={(wallet) => {
                setPreferredWallet(wallet);
                setCurrentView('main');
              }}
              onWalletConnected={setPreferredWallet}
            />
          )}
          {currentView === 'main' && (
            <MainView
              setCurrentView={setCurrentView}
              setPopupWalletType={setIsWalletPopupOpen}
              preferredWallet={preferredWallet}
            />
          )}
          {currentView === 'send' && <SendView setCurrentView={setCurrentView} />}
          {currentView === 'receive' && <ReceiveView setCurrentView={setCurrentView} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}