import { useWallet } from "@/app/_providers/wallet"
import { LegalNotice } from "./legal-notice"
import { ExtensionItem } from "./extension-item"
import { toast } from "react-hot-toast"

export const ConnectView = () => {
  const { error, isWalletInstalled, isConnecting, connectWallet } = useWallet();

  const handleAuroExtensionClick = async () => {
    if (!isWalletInstalled) {
      toast.error('Auro Wallet not found. Please install the extension first.', {
        id: 'wallet-not-found'
      });
      window.open('https://chrome.google.com/webstore/detail/auro-wallet/cnmamaachppnkjgnildpdmkaakejnhae', '_blank');
      return;
    }

    try {
      await connectWallet();
      toast.success('Wallet connected successfully!', {
        id: 'wallet-connected'
      });
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      toast.error('Failed to connect wallet. Please try again.', {
        id: 'wallet-connection-failed'
      });
    }
  };

  return (
    <>
      <h3 className="text-xl font-semibold text-black mb-6">
        Connect Mina Wallet
      </h3>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3 mb-6">
        <ExtensionItem
          icon="/mina-token-logo.png"
          title={!isWalletInstalled ? 'Install Auro Wallet Extension' : 'Auro Wallet Extension'}
          onClick={handleAuroExtensionClick}
          disabled={isConnecting}
          isLoading={isConnecting}
        />
      </div>

      <LegalNotice />
    </>
)
}