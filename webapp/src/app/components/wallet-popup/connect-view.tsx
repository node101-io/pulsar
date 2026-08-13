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
import { fetchAccountAuth, requestFeeGrant, waitForTxCommit } from "@/lib/utils"
import { formatMinaPublicKey, signatureFromBase58 } from "@/lib/crypto"
import { createRegisterKeysTx } from "@/lib/tx"
import { ActorType, KeySigningOperation, keySigningChallenge } from "pulsar-chain-client/messages"
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import { BroadcastMode } from "@interchain-kit/core/types"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { suggestPulsarToKeplr } from "@/lib/keplr"

export const ConnectView = ({ keyStore: keyStoreData }: {
  keyStore: { keyStore?: { cosmosPublicKey: string } } | undefined;
}) => {
  const { isWalletInstalled: isMinaWalletInstalled, isConnecting: minaConnecting, connectWallet: connectMina, signFields: minaSignFields, account: minaAccount, isConnected: isMinaConnected } = useMinaWallet();
  const { status: pulsarStatus, connect: connectPulsar, wallet: pulsarWallet, address: pulsarAddress } = usePulsarWallet();
  const [onboardDialog, setOnboardDialog] = useState<'done' | ''>('');
  const queryClient = useQueryClient();
  const [signStep, setSignStep] = useState<'auro' | 'keplr' | 'broadcast' | 'done'>('auro');
  const [isBusy, setIsBusy] = useState(false);
  const minaPublicKeyRef = useRef<Uint8Array | null>(null);
  const minaSignatureRef = useRef<Uint8Array | null>(null);
  // The Cosmos key the Auro proof was bound to, so a wallet switch between the
  // two signatures is caught here instead of on chain.
  const cosmosPublicKeyRef = useRef<Uint8Array | null>(null);

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
      minaPublicKeyRef.current = null;
      minaSignatureRef.current = null;
      cosmosPublicKeyRef.current = null;
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
      const account = await wallet.getAccount(consumerChain.chainId!);

      if (signStep === 'auro') {
        setIsBusy(true);

        // The challenge binds the Mina key being registered, so it has to be
        // known before the signature is asked for — it can no longer be read
        // back off the wallet's answer. The connected account IS that key.
        const minaPublicKey = await formatMinaPublicKey(minaAccount);
        const challenge = await keySigningChallenge({
          chainId: consumerChain.chainId!,
          operation: KeySigningOperation.KEY_SIGNING_OPERATION_REGISTER,
          actorType: ActorType.ACTOR_TYPE_USER,
          cosmosPublicKey: account.pubkey,
          newMinaPublicKey: minaPublicKey,
        });
        const signed = await minaSignFields({ message: [challenge.toString()] });

        // Auro can sign with whatever account is selected at the moment of the
        // prompt. If that drifted, the proof is for a key we are not
        // registering, and the chain would reject it as a bad signature.
        if (signed.publicKey !== minaAccount)
          throw new Error('Auro signed with a different account than the connected one. Reconnect and try again.');

        minaPublicKeyRef.current = minaPublicKey;
        minaSignatureRef.current = signatureFromBase58(signed.signature);
        cosmosPublicKeyRef.current = account.pubkey;

        setSignStep('keplr');
        setIsBusy(false);
        return;
      }

      if (signStep === 'keplr') {
        setIsBusy(true);
        if (!minaPublicKeyRef.current || !minaSignatureRef.current || !cosmosPublicKeyRef.current) {
          setIsBusy(false);
          throw new Error('Missing Auro signature. Please sign with Auro first.');
        }
        // The challenge Auro signed names this Cosmos key. Registering under
        // another one would only fail on chain, as a bad signature.
        if (!Buffer.from(cosmosPublicKeyRef.current).equals(Buffer.from(account.pubkey))) {
          setIsBusy(false);
          throw new Error('The Pulsar account changed after signing with Auro. Please start over.');
        }

        // The grant comes first and does double duty: x/feegrant creates the
        // account, which is what makes it addressable at all, and it covers
        // this one transaction. Without it a first-time user cannot sign.
        const { granter } = await requestFeeGrant(account.address);

        const { accountNumber, sequence } = await fetchAccountAuth(account.address);
        const signDoc = createRegisterKeysTx({
          sequence,
          accountNumber,
          pubkeyBytes: account.pubkey,
          creator: account.address,
          minaPublicKey: minaPublicKeyRef.current,
          minaSignature: minaSignatureRef.current,
          feeGranter: granter,
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
        const txHashHex = Buffer.from(txResponse).toString('hex').toUpperCase();
        console.log('tx hash', txHashHex);

        await waitForTxCommit(txHashHex);

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

      try {
        await suggestPulsarToKeplr();
      } catch (e) {
        console.warn('Keplr suggest chain failed or not needed:', e);
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
      <h3 className="text-ink mb-2 px-1 text-[15px] leading-none font-medium">
        Connect Wallet
      </h3>

      <div className="mb-auto space-y-2">
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
              className="bg-ink/20 absolute inset-0 z-5 rounded-[8px]"
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
              className="bg-surface border-line absolute right-0 bottom-0 left-0 z-10 flex flex-col items-center gap-3 rounded-t-[8px] border-t p-6 shadow-[0_-8px_30px_rgb(2_1_6/8%)]"
            >
              <Image src="/welcome.svg" alt="" width={32} height={32} />
              <div className="flex flex-col items-center gap-1.5 text-center">
                <h3 className="text-ink text-[16px] leading-none font-medium">{getOverlayTitle()}</h3>
                <p className="text-ink-muted text-[13px] leading-[1.4]">{getOverlaySubtitle()}</p>
              </div>

              <button
                onClick={handlePrimaryAction}
                disabled={isBusy || signStep === 'broadcast' || signStep === 'done'}
                className="brand-button w-full gap-2"
                aria-busy={isBusy}
              >
                {isBusy || signStep === 'broadcast' ? (
                  <svg
                    className="h-4 w-4 animate-spin"
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