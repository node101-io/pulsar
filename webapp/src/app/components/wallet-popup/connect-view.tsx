import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet"
import { LegalNotice } from "./legal-notice"
import { ExtensionItem } from "./extension-item"
import toast from "react-hot-toast"

export const ConnectView = () => {
  const { isWalletInstalled, isConnecting: minaConnecting, connectWallet: connectMina } = useMinaWallet();
  const { connect: connectKeplr, status: keplrStatus } = usePulsarWallet();

  const isKeplrConnecting = keplrStatus === 'Connecting';

  const handleAuroClick = async () => {
    if (!isWalletInstalled) {
      toast.error('Auro Wallet not found. Please install the extension first.', {
        id: 'wallet-not-found'
      });
      window.open('https://chrome.google.com/webstore/detail/auro-wallet/cnmamaachppnkjgnildpdmkaakejnhae', '_blank');
      return;
    }

    try {
      await connectMina();
      toast.success('Mina Wallet connected successfully!', {
        id: 'wallet-connected'
      });
    } catch (error) {
      console.error('Failed to connect Mina wallet:', error);
      toast.error('Failed to connect Mina wallet. Please try again.', {
        id: 'wallet-connection-failed'
      });
    }
  };

  const handleKeplrClick = async () => {
    try {
      await connectKeplr();
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
      <h3 className="text-xl font-semibold text-black mb-6">
        Connect Wallet
      </h3>

      <div className="space-y-3 mb-6">
        <ExtensionItem
          icon="/auro-wallet-logo.png"
          title={!isWalletInstalled ? 'Install Auro Wallet Extension' : 'Auro Wallet Extension'}
          onClick={handleAuroClick}
          disabled={minaConnecting}
          isLoading={minaConnecting}
        />

        <ExtensionItem
          icon="/keplr-wallet-logo.png"
          title="Keplr Wallet Extension"
          onClick={handleKeplrClick}
          disabled={isKeplrConnecting}
          isLoading={isKeplrConnecting}
        />
      </div>

      <LegalNotice />
    </>
  );
};