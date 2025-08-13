import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"
import { LegalNotice } from "./legal-notice"
import { ExtensionItem } from "./extension-item"
import { ProgressBar } from "./progress-bar"
import { CosmosWallet, WalletState } from "@interchain-kit/core"
import { consumerChain } from "@/lib/constants"
import { base64ToBytes, packMinaSignature, minaPublicKeyToHex } from "@/lib/crypto"
import { createKeyStoreTx } from "@/lib/tx"
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import { BroadcastMode } from "@interchain-kit/core/types"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import Image from "next/image"
import { useKeyStore } from "@/lib/hooks"

export const ConnectView = () => {
  const { isWalletInstalled: isMinaWalletInstalled, isConnecting: minaConnecting, connectWallet: connectMina, signMessage: minaSignMessage, account: minaAccount, isConnected: isMinaConnected } = useMinaWallet();
  const { status: pulsarStatus, connect: connectPulsar, getSigningClient, wallet: pulsarWallet, address } = usePulsarWallet();
  const [onboardDialog, setOnboardDialog] = useState<'done' | ''>('');
  const { data: keyStore } = useKeyStore(address);
  const queryClient = useQueryClient();

  const isPulsarConnecting = pulsarStatus === WalletState.Connecting;
  const isPulsarWalletInstalled = pulsarStatus !== WalletState.NotExist;
  const isPulsarConnected = pulsarStatus === WalletState.Connected && address;

  useEffect(() => {
    if (isMinaConnected && isPulsarConnected && !keyStore)
      setOnboardDialog('done');
  }, [keyStore, isMinaConnected, isPulsarConnected]);

  const handleCreateKeyStore = async () => {
    try {
      if (!isMinaConnected || !minaAccount) throw new Error('Connect Auro');

      const wallet = pulsarWallet.getWalletOfType(CosmosWallet);

      if (!wallet) throw new Error('Cosmos wallet not available');

      const signingClient = await getSigningClient();
      const account = await wallet.getAccount(consumerChain.chainId!);

      if (!signingClient.client) throw new Error('Keplr not ready');

      const cosmosPublicKeyHex = Buffer.from(account.pubkey).toString('hex');

      const minaSigned = await minaSignMessage({ message: cosmosPublicKeyHex });
      const minaPublicKeyHex = await minaPublicKeyToHex(minaSigned.publicKey);
      const minaSignature = packMinaSignature(minaSigned.signature.field, minaSigned.signature.scalar);

      const { signature } = await wallet.signArbitrary(consumerChain.chainId!, account.address, minaPublicKeyHex);

      const accountNumber = await signingClient.client.getAccountNumber(account.address);
      const sequence = await signingClient.client.getSequence(account.address);
      const signDoc = createKeyStoreTx({
        sequence,
        pubkeyBytes: account.pubkey,
        accountNumber,
        fromAddress: account.address,
        cosmosPublicKeyHex,
        minaPublicKey: minaPublicKeyHex,
        cosmosSignature: new Uint8Array(Buffer.from(signature, 'base64')),
        minaSignature,
      });

      const signedTx = await wallet.signDirect(consumerChain.chainId!, account.address, signDoc);

      const protobufTx = TxRaw.encode({
        bodyBytes: signedTx.signed.bodyBytes,
        authInfoBytes: signedTx.signed.authInfoBytes,
        signatures: [new Uint8Array(Buffer.from(signedTx.signature.signature, 'base64'))],
      }).finish();

      const txResponse = await wallet.sendTx(consumerChain.chainId!, protobufTx, BroadcastMode.Sync);
      console.log('tx hash', Buffer.from(txResponse).toString('hex').toUpperCase());

      queryClient.invalidateQueries({ queryKey: ["keyStore"] });
      toast.success('Register completed!');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create KeyStore');
    } finally {
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

      <div className="space-y-3 mb-6 mb-auto">
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

      {!keyStore && <ProgressBar />}

      <LegalNotice />

      <AnimatePresence>
        {onboardDialog === 'done' && !keyStore && (
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
              <h3 className="text-xl font-semibold text-background">Welcome to Pulsar!</h3>

              <button
                onClick={() => {
                  handleCreateKeyStore();
                }}
                className="w-full bg-[#CBDBDB] hover:bg-[#fff4cd] disabled:bg-gray-300 disabled:text-gray-500 text-background font-normal font-family-recady pt-4 pb-2.5 px-6 rounded-[20px] transition-colors border border-background"
              >
                Dive in
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};