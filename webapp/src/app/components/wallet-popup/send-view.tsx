import Image from "next/image"
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useKeyStore, useMinaPrice } from "@/lib/hooks";
import { toast } from "react-hot-toast";
import { useMinaWallet } from "@/app/_providers/mina-wallet";
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet";
import { usePminaBalance, useConnectedWallet } from "@/lib/hooks";
import { createKeyStoreTx, createSendTokenTx } from "@/lib/tx";
import { TxRaw, SignDoc } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { DeliverTxResponse } from "@interchainjs/types/rpc";
import { BroadcastMode, CosmosWallet } from "@interchain-kit/core";
import { consumerChain } from "@/lib/constants";
import { fromBase64, toBase64 } from "@cosmjs/encoding";
import { packMinaSignature } from "@/lib/crypto";

interface SavedAddress {
  name: string;
  address: string;
  id: string;
}

export const SendView = ({ setCurrentView }: {
  setCurrentView: (view: 'main' | 'send') => void
}) => {
  const [sendAmount, setSendAmount] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressName, setAddressName] = useState<string>('');
  const [showSaveDialog, setShowSaveDialog] = useState<boolean>(false);

  const { isConnected: isMinaConnected, signMessage: minaSignMessage, account: minaAccount } = useMinaWallet();
  const { getSigningClient, isSigningClientLoading, wallet: pulsarWallet, address: pulsarAddress } = usePulsarWallet();
  const connectedWallet = useConnectedWallet();
  const { data: keyStore } = useKeyStore(pulsarAddress, minaAccount);

  const { data: priceData } = useMinaPrice();
  const { data: pminaBalance } = usePminaBalance(keyStore?.keyStore?.creator || keyStore?.keyStore?.minaPublicKey, {
    enabled: !!keyStore?.keyStore?.creator || !!keyStore?.keyStore?.minaPublicKey,
  });

  const getSavedAddresses = (): SavedAddress[] => {
    try {
      const stored = localStorage.getItem('pulsar-saved-addresses');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error loading saved addresses:', error);
      return [];
    }
  };

  const saveSavedAddresses = (addresses: SavedAddress[]) => {
    try {
      localStorage.setItem('pulsar-saved-addresses', JSON.stringify(addresses));
      setSavedAddresses(addresses);
    } catch (error) {
      console.error('Error saving addresses:', error);
      toast.error('Failed to save address');
    }
  };

  useEffect(() => {
    const addresses = getSavedAddresses();
    setSavedAddresses(addresses);
  }, []);

  const handleBackToMain = () => {
    setCurrentView('main');
    setSendAmount('');
    setRecipientAddress('');
    setShowSaveDialog(false);
    setAddressName('');
  };

  const handleMaxClick = () => {
    if (pminaBalance) {
      setSendAmount(pminaBalance.toString());
    }
  };

  const calculateUsdValue = () => {
    const amount = parseFloat(sendAmount) || 0;
    if (priceData?.data && amount > 0) {
      return (amount * priceData.data.price).toFixed(2);
    }
    return '0.00';
  };

  const handleSaveAddressClick = () => {
    if (!recipientAddress.trim()) {
      toast.error('Please enter an address first');
      return;
    }

    const exists = savedAddresses.some(addr => addr.address === recipientAddress.trim());
    if (exists) {
      toast.error('Address already saved');
      return;
    }

    setShowSaveDialog(true);
  };

  const saveAddress = () => {
    if (!addressName.trim()) {
      toast.error('Please enter a name for the address');
      return;
    }

    const aliasExists = savedAddresses.some(addr => addr.name.toLowerCase() === addressName.trim().toLowerCase());
    if (aliasExists) {
      toast.error('This alias already exists');
      return;
    }

    const newAddress: SavedAddress = {
      id: Date.now().toString(),
      name: addressName.trim(),
      address: recipientAddress.trim(),
    };

    const updatedAddresses = [...savedAddresses, newAddress];
    saveSavedAddresses(updatedAddresses);

    setShowSaveDialog(false);
    setAddressName('');
    toast.success('Address saved successfully!');
  };

  const deleteAddress = (id: string) => {
    const updatedAddresses = savedAddresses.filter(addr => addr.id !== id);
    saveSavedAddresses(updatedAddresses);
    toast.success('Address deleted successfully!');
  };

  return (
    <>
      <div className="flex items-center gap-3 m-3 cursor-pointer w-fit" onClick={handleBackToMain}>
        <Image src="/back-arrow.svg" alt="Back" width={8} height={14} className="" />
        <h3 className="text-xl font-semibold text-background leading-none mb-1">Send pMINA</h3>
      </div>

      <div className="bg-[#CBDBDB] rounded-[26px] p-5.5 flex gap-3 border border-background items-center">
        <div className="flex items-center justify-center size-9.5 bg-text border border-background rounded-full">
          <Image src="/logo-dark.svg" alt="" width={32} height={32} className="" />
        </div>
        <label className="block text-xl font-semibold text-700 mb-1 leading-none">
          pMINA
        </label>
      </div>

      <div className="bg-[#CBDBDB] rounded-[26px] px-5.5 pb-4 pt-3 flex flex-col gap-1 border border-background">
        <input
          type="number"
          value={sendAmount}
          onChange={(e) => setSendAmount(e.target.value)}
          min={0}
          max={pminaBalance || 0}
          step="0.001"
          placeholder="0.000"
          className="w-full focus:outline-none text-5xl font-semibold placeholder:font-medium bg-transparent leading-[1.1]"
        />
        <div className="flex justify-between items-center">
          <span className="text-base text-gray-600 mr-auto">
            ~${calculateUsdValue()}
          </span>
          <span className="text-base text-gray-600 mr-2">
            Balance: {pminaBalance?.toFixed(3) || '0.000'}
          </span>
          <button
            onClick={handleMaxClick}
            className="text-base text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
          >
            MAX
          </button>
        </div>
      </div>

      <div className="bg-[#CBDBDB] rounded-[26px] p-5.5 flex flex-col gap-1 relative border border-background">
        <label className="blockleading-none font-family-recady text-base">
          Recipient Address
        </label>
        <input
          type="text"
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value)}
          placeholder="B62q... or pulsar..."
          className="w-full focus:outline-none text-base placeholder:text-base pr-5 relative"
        />
        <div className="size-4 border border-background rounded-sm bg-text absolute right-4 bottom-6 cursor-pointer hover:scale-110 transition-transform duration-200
            active:scale-104
            after:w-2
            after:h-px
            before:h-2
            before:w-px
            after:bg-background
            before:bg-background
            after:absolute
            after:left-1/2
            after:-translate-x-1/2
            after:top-1/2
            after:-translate-y-1/2
            before:absolute
            before:left-1/2
            before:-translate-x-1/2
            before:top-1/2
            before:-translate-y-1/2
            after:rounded-full
          "
          onClick={handleSaveAddressClick}
        >
        </div>
      </div>

      <AnimatePresence>
        {showSaveDialog && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-5 bg-black/20 rounded-4xl rounded-tr-none"
              onClick={() => {
                setShowSaveDialog(false);
                setAddressName('');
              }}
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
                className="bg-[#CBDBDB] rounded-t-[26px] p-6 flex flex-col gap-2 border border-background absolute bottom-0 left-0 right-0 z-10 shadow-lg"
              >
                <h3 className="text-xl font-semibold text-background">Give it an alias</h3>

                <div className="bg-text rounded-2xl p-4 border border-background flex items-center gap-3">
                  <div className="size-8 rounded-full flex items-center justify-center border border-background">
                    <Image src="/pulsar-token-logo.png" alt="Profile" width={32} height={32} className="rounded-full" />
                  </div>
                  <input
                    type="text"
                    value={addressName}
                    onChange={(e) => {
                      if (e.target.value.length <= 20) {
                        setAddressName(e.target.value);
                      }
                    }}
                    placeholder="Please enter alias here"
                    className="flex-1 placeholder:font-medium focus:outline-none text-lg bg-transparent font-semibold text-background placeholder-gray-500 mb-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        saveAddress();
                      }
                      if (e.key === 'Escape') {
                        setShowSaveDialog(false);
                        setAddressName('');
                      }
                    }}
                    autoFocus
                  />
                  <span className="text-sm font-medium text-[#585858] mb-1">{addressName.length}/20</span>
                </div>

                <button
                  onClick={saveAddress}
                  disabled={!addressName.trim()}
                  className="w-full bg-[#FFE68C] hover:bg-[#fff4cd] disabled:bg-gray-300 disabled:text-gray-500 text-background font-normal font-family-recady pt-4 pb-2.5 px-6 rounded-[20px] transition-colors border border-background"
                >
                  Confirm
                </button>
              </motion.div>
          </>
        )}
      </AnimatePresence>

      <button
        onClick={async () => {
          if (connectedWallet?.type === 'cosmos') {
            try {
              const wallet = pulsarWallet.getWalletOfType(CosmosWallet);
  
              if (!wallet)
                return toast.error('Please connect a wallet first', { id: 'no-wallet' });
  
              const amount = parseFloat(sendAmount);
              if (!sendAmount || amount <= 0)
                return toast.error('Please enter a valid amount', { id: 'invalid-amount' });
  
              if (!recipientAddress || recipientAddress.trim() === '')
                return toast.error('Please enter a recipient address', { id: 'invalid-recipient' });
  
              if (pminaBalance && amount > pminaBalance)
                return toast.error('Insufficient balance', { id: 'insufficient-balance' });
  
              if (!connectedWallet)
                return toast.error('Please connect a wallet first', { id: 'no-wallet' });
  
              toast.loading('Please sign the transaction in your wallet...', { id: 'signing-transaction' });
  
              const signingClient = await getSigningClient();
  
              if (!signingClient.client)
                return toast.error('Please connect a wallet first', { id: 'no-wallet' });
  
              const account = await wallet.getAccount(consumerChain.chainId!);
  
              const accountNumber = await signingClient.client.getAccountNumber(account.address).catch(err => {
                if(/key not found/.test(err.message)) {
                  toast.error('Please get tokens from faucet first', { id: 'no-account' });
                  return;
                }
                return;
              });
              const sequence = await signingClient.client.getSequence(account.address).catch(err => {
                if(/key not found/.test(err.message)) {
                  toast.error('Please get tokens from faucet first', { id: 'no-account' });
                  return;
                }
                return;
              });
  
              if (accountNumber == undefined || sequence == undefined) return;
  
              const upminaAmount = Math.floor(amount * 1e9).toString();
  
              const signDoc = createSendTokenTx({
                sequence,
                pubkeyBytes: account.pubkey,
                accountNumber,
                fromAddress: connectedWallet.address,
                toAddress: recipientAddress.trim(),
                amount: upminaAmount,
                walletType: connectedWallet.type
              });
  
              const signedTx = await wallet.signDirect(consumerChain.chainId!, account.address, signDoc);
  
              const protobufTx = TxRaw.encode({
                bodyBytes: signedTx.signed.bodyBytes,
                authInfoBytes: signedTx.signed.authInfoBytes,
                signatures: [new Uint8Array(Buffer.from(signedTx.signature.signature, 'base64'))],
              }).finish();
  
              const txResponse = await wallet.sendTx(consumerChain.chainId!, protobufTx, BroadcastMode.Sync);
              console.log('tx hash', Buffer.from(txResponse).toString('hex').toUpperCase());
  
              toast.success('Transaction successful', { id: 'transaction-success' });
  
              setSendAmount('');
              setRecipientAddress('');
              setCurrentView('main');
            } catch (error) {
              toast.dismiss('signing-transaction');
              toast.error(error instanceof Error ? error.message : 'Failed to process transaction', { id: 'transaction-failed' });
              console.error('Transaction failed:', error);
            }  
          } else if (connectedWallet?.type === 'mina') {
            try {
              if (!sendAmount || parseFloat(sendAmount) <= 0)
                return toast.error('Please enter a valid amount', { id: 'invalid-amount' });

              if (!recipientAddress || recipientAddress.trim() === '')
                return toast.error('Please enter a recipient address', { id: 'invalid-recipient' });

              const amount = parseFloat(sendAmount);
              if (pminaBalance && amount > pminaBalance)
                return toast.error('Insufficient balance', { id: 'insufficient-balance' });

              if (!keyStore?.keyStore?.creator)
                return toast.error('Please register your keystore first', { id: 'no-keystore' });

              toast.loading('Please sign the transaction in your wallet...', { id: 'signing-transaction' });

              const upminaAmount = Math.floor(amount * 1e9).toString();

              const account = await fetch(`https://rest.pulsarchain.xyz/cosmos/auth/v1beta1/accounts/${keyStore.keyStore.creator}`);
              const accountData = await account.json() as {
                account: {
                  "@type": string,
                  address: string,
                  pub_key: {
                    "@type": string,
                    key: string
                  },
                  account_number: string,
                  sequence: string
                }
              };

              const signDoc = createSendTokenTx({
                sequence: Number(accountData.account.sequence),
                pubkeyBytes: fromBase64(accountData.account.pub_key.key),
                accountNumber: BigInt(accountData.account.account_number),
                fromAddress: accountData.account.address,
                toAddress: recipientAddress.trim(),
                amount: upminaAmount,
                walletType: connectedWallet.type
              });

              const signBytes = SignDoc.encode(signDoc).finish();
              let message = '';
              for (let i = 0; i < signBytes.length; i++) {
                message += String.fromCharCode(signBytes[i]!);
              }

              const minaSigned = await minaSignMessage({ message });

              const minaSigBytes = packMinaSignature(minaSigned.signature.field, minaSigned.signature.scalar);

              const protobufTx = TxRaw.encode({
                bodyBytes: signDoc.bodyBytes,
                authInfoBytes: signDoc.authInfoBytes,
                signatures: [minaSigBytes],
              }).finish();

              const result = await fetch(`https://rest.pulsarchain.xyz/cosmos/tx/v1beta1/txs`, {
                method: 'POST',
                body: JSON.stringify({
                  tx_bytes: toBase64(protobufTx),
                  mode: 'BROADCAST_MODE_SYNC'
                })
              });

              const { tx_response } = await result.json() as { tx_response: { 
                txhash: string,
                code: number,
                raw_log: string
              }};
        
              console.log("result", tx_response);

              if (tx_response.code === 0) {
                console.log('tx hash', tx_response.txhash);
                toast.success('Transaction successful', { id: 'transaction-success' });
                setSendAmount('');
                setRecipientAddress('');
                setCurrentView('main');
              } else {
                toast.error(`Broadcast failed${tx_response.code ? ` (code ${tx_response.code})` : ''}`, { id: 'transaction-failed' });
              }
            } catch (error) {
              toast.dismiss('signing-transaction');
              toast.error(error instanceof Error ? error.message : 'Failed to process transaction', { id: 'transaction-failed' });
              console.error('Transaction failed:', error);
            }
          }
        }}
        disabled={!connectedWallet || (connectedWallet.type === 'cosmos' && isSigningClientLoading)}
        className="flex cursor-pointer items-center justify-center gap-3 p-4 text-base text-background font-semibold rounded-full transition-colors bg-[#FFE68C] hover:bg-[#fff4cd] border border-background disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <p className="font-family-recady text-base font-normal mt-1 leading-none">
          Send {connectedWallet?.type === 'mina' ? 'with Auro Wallet' : connectedWallet?.type === 'cosmos' ? 'with Keplr Wallet' : ''}
        </p>
      </button>

      {savedAddresses.length > 0 && (
        <div className="flex flex-col justify-between mt-2 gap-2">
          <div className="flex justify-between text-base font-medium text-[#585858]">
            <h2 className="">Saved addresses</h2>
          </div>
          <div className="flex flex-col items-center w-full cursor-pointer">
            {savedAddresses.map((savedAddress) => (
              <div
                key={savedAddress.id}
                className="flex items-center gap-2 w-full group hover:bg-neutral-300 rounded-xl p-2 transition-colors duration-200"
                onClick={() => {
                  setRecipientAddress(savedAddress.address);
                }}
              >
                <Image src="/pulsar-token-logo.png" alt="Mina Logo" width={32} height={32} className="rounded-full border border-background" />
                <div className="flex flex-col mr-auto text-base justify-between leading-none font-medium">
                  <p className="text-background">{savedAddress.name}</p>
                  <p className="text-[#585858]">{savedAddress.address.slice(0, 6)}...{savedAddress.address.slice(-6)}</p>
                </div>
                <Image
                  src="/trash-icon.svg"
                  alt="Delete"
                  width={14}
                  height={14}
                  className="group-hover:opacity-100 opacity-0 transition-opacity duration-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteAddress(savedAddress.id);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}