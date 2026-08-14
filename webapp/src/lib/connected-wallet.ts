// Which wallet a screen speaks for when more than one is connected.
//
// Pure so the decision table is testable without React: the hook that feeds
// it (app/components/use-connected-wallet.ts) only gathers the candidates
// from the wallet providers and delegates the choice here.

/**
 * One vocabulary for the two wallets, everywhere: the chain modules say
 * "cosmos", but every user-facing surface of this app says Pulsar, and a
 * type that speaks both forces a translation at each boundary it crosses.
 */
export type WalletKind = 'mina' | 'pulsar';

export type ConnectedWallet = { type: WalletKind; address: string };

/**
 * `preferred` is the wallet whose view the user navigated in from, and it
 * wins while that wallet is connected. A stale preference — its wallet has
 * since disconnected — falls back to whatever is, rather than stranding the
 * screen on a wallet that cannot act. With no preference (the header has no
 * view context), Mina wins ties, matching the connect list's ordering.
 */
export function resolveConnectedWallet(
  mina: ConnectedWallet | null,
  pulsar: ConnectedWallet | null,
  preferred?: WalletKind | null,
): ConnectedWallet | null {
  if (preferred === 'mina' && mina) return mina;
  if (preferred === 'pulsar' && pulsar) return pulsar;
  return mina ?? pulsar;
}
