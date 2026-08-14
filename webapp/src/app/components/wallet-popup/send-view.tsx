import Image from "next/image"
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useKeyStore, useMinaPrice } from "@/lib/hooks";
import { toast } from "react-hot-toast";
import { useMinaWallet } from "@/app/_providers/mina-wallet";
import { usePulsarWallet } from "@/app/_providers/pulsar-wallet";
import { usePminaBalance, } from "@/lib/hooks"
import { useConnectedWallet } from "@/app/components/use-connected-wallet";
import { SEND_TOKEN_FEE, createSendTokenTx } from "@/lib/tx";
import { broadcastTx, fetchAccountAuth, waitForTxCommit } from "@/lib/utils";
import { signatureFromBase58 } from "@/lib/crypto";
import { DECIMALS, formatAmount, parseAmount, toDisplayNumber } from "@/lib/amount";
import { usePendingWithdrawalsFrom } from "@/lib/pending-transfers";
import { resolveMinaAddress } from "@/lib/registry";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { makeSignBytes } from "@cosmjs/proto-signing";
import { txSigningChallenge } from "pulsar-chain-client/messages";
import { getPulsarSigner } from "@/lib/keplr";
import type { WalletKind } from "@/lib/connected-wallet";

interface SavedAddress {
  name: string;
  address: string;
  id: string;
}

export const SendView = ({ setCurrentView, preferredWallet }: {
  setCurrentView: (view: 'main' | 'send') => void
  /** The wallet whose view the user pressed Send in; it decides the signer. */
  preferredWallet?: WalletKind | null
}) => {
  const [sendAmount, setSendAmount] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressName, setAddressName] = useState<string>('');
  const [showSaveDialog, setShowSaveDialog] = useState<boolean>(false);

  const { account: minaAccount, signFields: minaSignFields } = useMinaWallet();
  const { address: pulsarAddress } = usePulsarWallet();
  const connectedWallet = useConnectedWallet(preferredWallet);
  const { data: keyStore } = useKeyStore(minaAccount);

  const { data: priceData } = useMinaPrice();

  // The account this send spends from. The Keplr view speaks for the connected
  // Keplr account itself. The Mina view spends from the account its key is
  // REGISTERED to — the only account a Mina signature can move funds from —
  // which is not necessarily the connected Keplr account (see useKeyStore).
  const registeredPulsarAddress = keyStore?.keyStore?.pulsarAddress ?? null;
  const sendFromAddress =
    connectedWallet?.type === 'mina' ? registeredPulsarAddress : pulsarAddress;

  const { data: pminaBalance } = usePminaBalance(sendFromAddress, {
    enabled: !!sendFromAddress,
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

  const balance = pminaBalance ?? 0n;
  const amountBase = parseAmount(sendAmount);

  // pMINA a pending withdrawal will burn from this account when the chain
  // scans it, hours from now. The chain does not reserve it — nothing stops a
  // send from spending it — but a send that does voids the withdrawal and
  // forfeits its 1 MINA down payment on Mina. So this UI reserves it: the
  // offered maximum excludes it, and the insufficient-balance check charges
  // it. The user can still see the full balance; they just cannot walk into
  // the forfeit unwarned.
  const pendingWithdrawals = usePendingWithdrawalsFrom(sendFromAddress);
  const reserved = pendingWithdrawals.reduce((sum, w) => sum + w.amount, 0n);

  const spendable = balance > reserved ? balance - reserved : 0n;
  // The fee comes out of this same balance, so the whole balance is never
  // sendable. Rendered at full precision because it is parsed back, not read.
  const maxSendable = spendable > SEND_TOKEN_FEE ? spendable - SEND_TOKEN_FEE : 0n;

  const handleMaxClick = () => {
    setSendAmount(formatAmount(maxSendable, DECIMALS));
  };

  const calculateUsdValue = () => {
    if (priceData && amountBase > 0n) {
      return (toDisplayNumber(amountBase) * priceData.price).toFixed(2);
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

  /**
   * One send, two authorizations, one sign doc. Keplr signs the doc's bytes
   * with secp256k1 and broadcasts through the extension. Auro cannot sign
   * bytes — it signs the field element txSigningChallenge derives from them —
   * so that tx carries the Mina auth extension option to route the chain's
   * verification, and broadcasts over REST because Auro has no Cosmos
   * broadcast API.
   */
  const handleSend = async () => {
    if (!connectedWallet) return;

    if (amountBase <= 0n)
      return toast.error('Please enter a valid amount', { id: 'invalid-amount' });

    if (!recipientAddress || recipientAddress.trim() === '')
      return toast.error('Please enter a recipient address', { id: 'invalid-recipient' });

    try {
      // A Mina address is a valid recipient only through the registry:
      // the chain's MsgSend takes bech32 alone and rewrites nothing,
      // so the resolution happens here or not at all. Refusing an
      // unregistered key is what keeps this safe — its derived
      // address exists but nobody holds its Cosmos key, so pMINA sent
      // there would be stranded forever.
      let toAddress = recipientAddress.trim();
      if (toAddress.startsWith('B62')) {
        toast.loading('Resolving Mina address…', { id: 'signing-transaction' });
        let resolved;
        try {
          resolved = await resolveMinaAddress(toAddress);
        } catch {
          toast.dismiss('signing-transaction');
          return toast.error('That is not a valid Mina address', { id: 'invalid-recipient' });
        }
        if (!resolved) {
          toast.dismiss('signing-transaction');
          return toast.error(
            'This Mina address is not registered with Pulsar, so it cannot receive pMINA',
            { id: 'invalid-recipient' },
          );
        }
        toAddress = resolved.pulsarAddress;
      } else if (!toAddress.startsWith('pulsar1')) {
        return toast.error(
          'Recipient must be a pulsar1… or B62… address',
          { id: 'invalid-recipient' },
        );
      }

      // Against the fee-adjusted, reservation-adjusted maximum, not
      // the raw balance: the ante handler rejects a fee the sender
      // cannot cover, and spending what a pending withdrawal needs
      // forfeits its down payment. Name whichever is the actual cause.
      if (amountBase > maxSendable) {
        toast.dismiss('signing-transaction');
        return toast.error(
          reserved > 0n && amountBase <= balance
            ? `${formatAmount(reserved)} pMINA is reserved for a pending withdrawal — sending it would void the withdrawal and forfeit its 1 MINA deposit`
            : `Insufficient balance — ${formatAmount(SEND_TOKEN_FEE, DECIMALS)} pMINA is needed for the fee`,
          { id: 'insufficient-balance' },
        );
      }

      if (connectedWallet.type === 'pulsar') {
        const signer = getPulsarSigner();

        if (!signer)
          return toast.error('Keplr extension not detected', { id: 'no-wallet' });

        toast.loading('Please sign the transaction in your wallet...', { id: 'signing-transaction' });

        const account = await signer.getAccount();

        let accountNumber: bigint;
        let sequence: number;
        try {
          ({ accountNumber, sequence } = await fetchAccountAuth(account.address));
        } catch (error) {
          toast.dismiss('signing-transaction');
          return toast.error(
            error instanceof Error ? error.message : 'Could not read your Pulsar account',
            { id: 'no-account' },
          );
        }

        const signDoc = createSendTokenTx({
          sequence,
          pubkeyBytes: account.pubkey,
          accountNumber,
          // The extension's answer, not the store's: the signature only
          // authorizes a send FROM the account that makes it.
          fromAddress: account.address,
          toAddress,
          amount: amountBase.toString(),
        });

        const signedTx = await signer.signDirect(account.address, signDoc);

        const protobufTx = TxRaw.encode({
          bodyBytes: signedTx.signed.bodyBytes,
          authInfoBytes: signedTx.signed.authInfoBytes,
          signatures: [new Uint8Array(Buffer.from(signedTx.signature.signature, 'base64'))],
        }).finish();

        const txResponse = await signer.sendTx(protobufTx);
        console.log('tx hash', Buffer.from(txResponse).toString('hex').toUpperCase());
      } else {
        // A Mina signature can only move funds of the account its key is
        // registered to; without a registration there is nothing to spend.
        if (!keyStore?.keyStore || !registeredPulsarAddress) {
          toast.dismiss('signing-transaction');
          return toast.error(
            'This Auro account is not registered with Pulsar yet — complete registration before sending.',
            { id: 'not-registered' },
          );
        }

        const pubkeyBytes = Uint8Array.from(
          Buffer.from(keyStore.keyStore.cosmosPublicKey, 'base64'),
        );

        let accountNumber: bigint;
        let sequence: number;
        try {
          ({ accountNumber, sequence } = await fetchAccountAuth(registeredPulsarAddress));
        } catch (error) {
          toast.dismiss('signing-transaction');
          return toast.error(
            error instanceof Error ? error.message : 'Could not read your Pulsar account',
            { id: 'no-account' },
          );
        }

        const signDoc = createSendTokenTx({
          sequence,
          pubkeyBytes,
          accountNumber,
          fromAddress: registeredPulsarAddress,
          toAddress,
          amount: amountBase.toString(),
          minaAuthenticated: true,
        });

        // The challenge is derived from the doc's exact encoded bytes — the
        // same bytes the chain re-derives it from at verification.
        const challenge = await txSigningChallenge(makeSignBytes(signDoc));

        toast.loading('Please sign the transaction in Auro...', { id: 'signing-transaction' });
        const signed = await minaSignFields({ message: [challenge.toString()] });

        // Auro signs with whatever account is selected at the moment of the
        // prompt. If that drifted from the connected one, the signature is
        // from a key the sender's account is not registered to, and the
        // chain would reject it as a bad signature.
        if (signed.publicKey !== minaAccount)
          throw new Error('Auro signed with a different account than the connected one. Reconnect and try again.');

        const protobufTx = TxRaw.encode({
          bodyBytes: signDoc.bodyBytes,
          authInfoBytes: signDoc.authInfoBytes,
          signatures: [signatureFromBase58(signed.signature)],
        }).finish();

        toast.loading('Broadcasting transaction...', { id: 'signing-transaction' });
        const txHashHex = await broadcastTx(protobufTx);
        console.log('tx hash', txHashHex);
        // A sync broadcast only proves CheckTx passed. The Keplr path leaves
        // delivery to the extension's own UI; this path has none, so wait
        // for the commit before reporting success.
        await waitForTxCommit(txHashHex);
      }

      toast.dismiss('signing-transaction');
      toast.success('Transaction successful', { id: 'transaction-success' });

      setSendAmount('');
      setRecipientAddress('');
      setCurrentView('main');
    } catch (error) {
      toast.dismiss('signing-transaction');
      toast.error(error instanceof Error ? error.message : 'Failed to process transaction', { id: 'transaction-failed' });
      console.error('Transaction failed:', error);
    }
  };

  return (
    <>
      <button
        type="button"
        className="text-ink m-1 flex w-fit cursor-pointer items-center gap-2.5"
        onClick={handleBackToMain}
      >
        <Image src="/back-arrow.svg" alt="" width={8} height={14} />
        <h3 className="text-[15px] leading-none font-medium">Send pMINA</h3>
      </button>

      <div className="bg-surface border-line flex items-center gap-3 rounded-md border p-4">
        <Image
          src="/pulsar-token-logo.svg"
          alt=""
          width={36}
          height={36}
          className="border-line size-9 rounded-full border"
        />
        <span className="text-ink text-[15px] leading-none font-medium">pMINA</span>
      </div>

      <div className="bg-surface border-line flex flex-col gap-2 rounded-md border px-4 pt-4 pb-3">
        <input
          type="number"
          value={sendAmount}
          onChange={(e) => setSendAmount(e.target.value)}
          min={0}
          max={formatAmount(maxSendable, DECIMALS)}
          step="0.001"
          placeholder="0.000"
          aria-label="Amount to send"
          className="text-ink placeholder:text-ink-subtle w-full bg-transparent text-[34px] leading-none font-[550] tracking-[-0.02em] tabular-nums focus:outline-none"
        />
        <div className="flex items-center gap-2 text-[13px] leading-none">
          <span className="text-ink-subtle mr-auto tabular-nums">
            ~${calculateUsdValue()}
          </span>
          <span
            className="text-ink-subtle tabular-nums"
            title={
              reserved > 0n
                ? `${formatAmount(reserved)} pMINA is reserved for a pending withdrawal until it settles`
                : undefined
            }
          >
            Balance: {formatAmount(balance)}
            {reserved > 0n && (
              <span className="text-ink-muted"> ({formatAmount(reserved)} reserved)</span>
            )}
          </span>
          <button
            onClick={handleMaxClick}
            className="text-accent-deep hover:text-accent-strong cursor-pointer font-medium transition-colors"
          >
            MAX
          </button>
        </div>
      </div>

      <div className="bg-surface border-line flex flex-col gap-2 rounded-md border p-4">
        <label
          htmlFor="recipient-address"
          className="text-ink-subtle text-xs leading-none tracking-[0.08em] uppercase"
        >
          Recipient Address
        </label>
        <div className="flex items-center gap-2">
          <input
            id="recipient-address"
            type="text"
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            placeholder="B62q... or pulsar..."
            className="text-ink placeholder:text-ink-subtle w-full bg-transparent text-[13px] leading-none focus:outline-none"
          />
          <button
            type="button"
            aria-label="Save this address"
            className="brand-squircle border-line hover:border-ink text-ink flex size-5 shrink-0 cursor-pointer items-center justify-center border text-sm leading-none transition-colors"
            onClick={handleSaveAddressClick}
          >
            +
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showSaveDialog && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="bg-ink/20 absolute inset-0 z-5 rounded-lg"
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
                className="bg-surface border-line absolute right-0 bottom-0 left-0 z-10 flex flex-col gap-3 rounded-t-lg border-t p-5 shadow-[0_-8px_30px_rgb(2_1_6/8%)]"
              >
                <h3 className="text-ink text-[15px] leading-none font-medium">Give it an alias</h3>

                <div className="bg-canvas border-line flex items-center gap-3 rounded-md border p-3">
                  <Image
                    src="/pulsar-token-logo.svg"
                    alt=""
                    width={32}
                    height={32}
                    className="border-line size-8 shrink-0 rounded-full border"
                  />
                  <input
                    type="text"
                    value={addressName}
                    onChange={(e) => {
                      if (e.target.value.length <= 20) {
                        setAddressName(e.target.value);
                      }
                    }}
                    placeholder="Please enter alias here"
                    className="text-ink placeholder:text-ink-subtle flex-1 bg-transparent text-sm leading-none font-medium focus:outline-none"
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
                  <span className="text-ink-subtle text-xs leading-none tabular-nums">{addressName.length}/20</span>
                </div>

                <button
                  onClick={saveAddress}
                  disabled={!addressName.trim()}
                  className="brand-button w-full"
                >
                  Confirm
                </button>
              </motion.div>
          </>
        )}
      </AnimatePresence>

      <button
        onClick={handleSend}
        disabled={!connectedWallet}
        className="brand-button shrink-0"
      >
        Send {connectedWallet?.type === 'mina' ? 'with Auro Wallet' : connectedWallet?.type === 'pulsar' ? 'with Keplr Wallet' : ''}
      </button>

      {savedAddresses.length > 0 && (
        <div className="mt-3 flex min-h-0 flex-col gap-1.5">
          <h2 className="text-ink-subtle px-1 text-xs leading-none tracking-[0.08em] uppercase">
            Saved addresses
          </h2>
          <div className="hide-scrollbar flex w-full flex-col overflow-y-auto">
            {savedAddresses.map((savedAddress) => (
              <div
                key={savedAddress.id}
                className="group hover:bg-surface flex w-full cursor-pointer items-center gap-2.5 rounded-md p-2 transition-colors duration-200"
                onClick={() => {
                  setRecipientAddress(savedAddress.address);
                }}
              >
                <Image
                  src="/pulsar-token-logo.svg"
                  alt=""
                  width={28}
                  height={28}
                  className="border-line size-7 shrink-0 rounded-full border"
                />
                <div className="mr-auto flex flex-col gap-1 leading-none">
                  <p className="text-ink text-[13px] font-medium">{savedAddress.name}</p>
                  <p className="text-ink-subtle text-xs tabular-nums">{savedAddress.address.slice(0, 6)}...{savedAddress.address.slice(-6)}</p>
                </div>
                <Image
                  src="/trash-icon.svg"
                  alt="Delete"
                  width={14}
                  height={14}
                  className="shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
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
