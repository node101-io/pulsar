import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import toast from "react-hot-toast"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"
import { LegalNotice } from "./legal-notice"
import { ExtensionItem } from "./extension-item"
import { ProgressBar } from "./progress-bar"
import { CosmosWallet, WalletState } from "@interchain-kit/core"
import { consumerChain } from "@/lib/constants"
import { formatMinaPublicKey, packMinaSignature, hashMessageForSigning } from "@/lib/crypto"
import { createKeyStoreTx } from "@/lib/tx"
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import { BroadcastMode } from "@interchain-kit/core/types"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { KeyStore } from "@/generated/cosmos/minakeys/key_store"

export const ConnectView = ({ keyStore: keyStoreData }: {
  keyStore: {
    keyStore: KeyStore | undefined;
    error: undefined;
  } | {
    keyStore: undefined;
    error: Error;
  } | undefined;
}) => {
  const { isWalletInstalled: isMinaWalletInstalled, isConnecting: minaConnecting, connectWallet: connectMina, signMessage: minaSignMessage, account: minaAccount, isConnected: isMinaConnected } = useMinaWallet();
  const { status: pulsarStatus, connect: connectPulsar, getSigningClient, wallet: pulsarWallet, address: pulsarAddress } = usePulsarWallet();
  const [onboardDialog, setOnboardDialog] = useState<'done' | ''>('');
  const queryClient = useQueryClient();
  const [signStep, setSignStep] = useState<'auro' | 'keplr' | 'broadcast' | 'done'>('auro');
  const [isBusy, setIsBusy] = useState(false);
  const cosmosPublicKeyHexRef = useRef<string | null>(null);
  const minaPublicKeyRef = useRef<string | null>(null);
  const minaSignatureRef = useRef<Uint8Array | null>(null);

  const isPulsarConnecting = pulsarStatus === WalletState.Connecting;
  const isPulsarWalletInstalled = pulsarStatus !== WalletState.NotExist;
  const isPulsarConnected = pulsarStatus === WalletState.Connected && pulsarAddress;

  useEffect(() => {
    if (isMinaConnected && isPulsarConnected && !keyStoreData?.keyStore)
      setOnboardDialog('done');
  }, [keyStoreData?.keyStore, isMinaConnected, isPulsarConnected]);

  useEffect(() => {
    if (onboardDialog === 'done' && !keyStoreData?.keyStore) {
      setSignStep('auro');
      setIsBusy(false);
      cosmosPublicKeyHexRef.current = null;
      minaPublicKeyRef.current = null;
      minaSignatureRef.current = null;

    }
  }, [onboardDialog, keyStoreData?.keyStore]);

  const getOverlayTitle = () => {
    if (signStep === 'done') return 'Welcome to Pulsar!';
    if (signStep === 'broadcast') return 'Registering your wallet';
    return 'Welcome to Pulsar!';
  };

  const getOverlaySubtitle = () => {
    if (signStep === 'auro') return 'Please sign with Auro to register your wallet.';
    if (signStep === 'keplr') return 'Please sign with Keplr to continue.';
    if (signStep === 'broadcast') return 'Sending transaction...';
    if (signStep === 'done') return 'Registration completed! You can now use Pulsar.';
    return 'Please register your wallet to use Pulsar.';
  };

  const getCtaText = () => {
    if (signStep === 'done') return 'Welcome to Pulsar';
    if (signStep === 'broadcast') return 'Sending transaction...';
    if (signStep === 'keplr') return isBusy ? 'Signing with Keplr...' : 'Sign with Keplr';
    return isBusy ? 'Signing with Auro...' : 'Sign with Auro';
  };

  const handlePrimaryAction = async () => {
    if (isBusy || signStep === 'done') return;
    try {
      if (!isMinaConnected || !minaAccount) throw new Error('Connect Auro');
      const wallet = pulsarWallet.getWalletOfType(CosmosWallet);
      if (!wallet) throw new Error('Cosmos wallet not available');
      const signingClient = await getSigningClient();
      const account = await wallet.getAccount(consumerChain.chainId!);
      if (!signingClient.client) throw new Error('Keplr not ready');

      if (signStep === 'auro') {
        setIsBusy(true);
        const localCosmosPubKeyHex = Buffer.from(account.pubkey).toString('hex');
        cosmosPublicKeyHexRef.current = localCosmosPubKeyHex;

        // const minaSigned = await minaSignMessage({ message: localCosmosPubKeyHex });
        const minaSigned = await minaSignMessage({ message: "node101" });

        console.log("minaSignature", minaSigned.signature);
        console.log("minaSignature", {
          r: minaSigned.signature.field,
          s: minaSigned.signature.scalar,
        });

        minaPublicKeyRef.current = await formatMinaPublicKey(minaSigned.publicKey);
        minaSignatureRef.current = packMinaSignature(minaSigned.signature.field, minaSigned.signature.scalar);

        setSignStep('keplr');
        setIsBusy(false);
        return;
      }

      if (signStep === 'keplr') {
        setIsBusy(true);
        if (!minaPublicKeyRef.current || !minaSignatureRef.current || !cosmosPublicKeyHexRef.current) {
          setIsBusy(false);
          throw new Error('Missing Auro signature. Please sign with Auro first.');
        }
        const { signature } = await wallet.signArbitrary(consumerChain.chainId!, account.address, minaPublicKeyRef.current);

        const accountNumber = await signingClient.client.getAccountNumber(account.address);
        const sequence = await signingClient.client.getSequence(account.address);
        const signDoc = createKeyStoreTx({
          sequence,
          pubkeyBytes: account.pubkey,
          accountNumber,
          fromAddress: account.address,
          cosmosPublicKeyHex: cosmosPublicKeyHexRef.current!,
          minaPublicKey: minaPublicKeyRef.current!,
          cosmosSignature: new Uint8Array(Buffer.from(signature, 'base64')),
          minaSignature: minaSignatureRef.current!,
        });

        const signedTx = await wallet.signDirect(consumerChain.chainId!, account.address, signDoc);
        setSignStep('broadcast');
        await new Promise((r) => setTimeout(r, 0));

        const protobufTx = TxRaw.encode({
          bodyBytes: signedTx.signed.bodyBytes,
          authInfoBytes: signedTx.signed.authInfoBytes,
          signatures: [new Uint8Array(Buffer.from(signedTx.signature.signature, 'base64'))],
        }).finish();

        const txResponse = await wallet.sendTx(consumerChain.chainId!, protobufTx, BroadcastMode.Sync);
        console.log('tx hash', Buffer.from(txResponse).toString('hex').toUpperCase());

        await queryClient.invalidateQueries({ queryKey: ["keyStore"] });
        toast.success('Register completed!');
        setIsBusy(false);
        setSignStep('done');
        return;
      }

      if (signStep === 'broadcast') return;
    } catch (e: any) {
      console.error(e);
      setIsBusy(false);
      toast.error(e?.message || 'Failed to create KeyStore');
    }
  };

  const handleAuroClick = async () => {
    if (!isMinaWalletInstalled) {
      toast.error('Auro Wallet not found. Please install the extension first.', {
        id: 'wallet-not-found'
      });
      window.open('https://chrome.google.com/webstore/detail/auro-wallet/cnmamaachppnkjgnildpdmkaakejnhae', '_blank');
      return;
    }

    try {
      await connectMina();
      toast.success('Auro Wallet connected successfully!', {
        id: 'wallet-connected'
      });
    } catch (error) {
      console.error('Failed to connect Auro Wallet:', error);
      toast.error('Failed to connect Auro Wallet. Please try again.', {
        id: 'wallet-connection-failed'
      });
    }
  };

  const handleKeplrClick = async () => {
    try {
      if (!isPulsarWalletInstalled) {
        toast.error('Pulsar Wallet not found. Please install the extension first.', {
          id: 'wallet-not-found'
        });
        window.open('https://chrome.google.com/webstore/detail/keplr/dmkamcknogkgcdfhhbddcghachkejeap', '_blank');
        return;
      }

      await connectPulsar();

      toast.success('Keplr Wallet connected successfully!', {
        id: 'keplr-connected'
      });
    } catch (error) {
      console.error('Failed to connect Keplr wallet:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast.error(`Failed to connect Keplr wallet: ${errorMessage}`, {
        id: 'keplr-connection-failed'
      });
    }
  };

  return (
    <>
      <h3 className="text-xl font-semibold text-black mb-2">
        Connect Wallet
      </h3>

      <div className="space-y-3 mb-auto">
        <ExtensionItem
          icon="/auro-wallet-logo.png"
          title={!isMinaWalletInstalled ? 'Install Auro Wallet Extension' : 'Auro Wallet Extension'}
          onClick={handleAuroClick}
          disabled={minaConnecting}
          isLoading={minaConnecting}
        />
        <ExtensionItem
          icon="/keplr-wallet-logo.png"
          title={!isPulsarWalletInstalled ? 'Install Keplr Wallet Extension' : 'Keplr Wallet Extension'}
          onClick={handleKeplrClick}
          disabled={isPulsarConnecting}
          isLoading={isPulsarConnecting}
        />
      </div>

      {!keyStoreData?.keyStore && <ProgressBar />}

      <LegalNotice />

      <AnimatePresence>
        {onboardDialog === 'done' && !keyStoreData?.keyStore && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-5 bg-black/20 rounded-4xl rounded-tr-none"
            />
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 300,
                duration: 0.3
              }}
              className="bg-[#FFE68C] rounded-t-[26px] p-6 flex flex-col gap-2 border border-background absolute bottom-0 left-0 right-0 z-10 shadow-lg items-center"
            >
              <Image src="/welcome.svg" alt="welcome" width={34} height={34} />
              <div className="flex flex-col items-center">
                <h3 className="text-xl font-semibold text-background">{getOverlayTitle()}</h3>
                <p className="text-base text-background font-medium">{getOverlaySubtitle()}</p>
              </div>

              <button
                onClick={handlePrimaryAction}
                disabled={isBusy || signStep === 'broadcast' || signStep === 'done'}
                className="w-full bg-[#CBDBDB] hover:bg-[#fff4cd] disabled:bg-gray-300 disabled:text-gray-500 text-background font-normal font-family-recady pt-4 pb-2.5 px-6 rounded-[20px] transition-colors border border-background flex items-center justify-center gap-2"
                aria-busy={isBusy}
              >
                {isBusy || signStep === 'broadcast' ? (
                  <svg
                    className="animate-spin h-4 w-4 text-background"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                ) : null}
                {getCtaText()}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};