# Troubleshooting

## My deposit hasn't arrived

Two hours is normal. The transactions page shows exactly where it is:

1. **"Confirming on Mina"**, with a block counter: Pulsar only trusts a Mina
   block at finality depth, currently 40 blocks at roughly 3 minutes each.
   This phase is most of the wait.
2. **"Pulsar's scan is N blocks away"**: confirmed on Mina, and the chain's
   scanner is catching up to your block.
3. **Settled**: the pending row flips to a regular one and your pMINA balance
   updates.

If the scan cursor is not advancing for a long time across all transfers, the
bridge relayer is behind. That is an operator matter rather than something in
your control, and the transfer is not lost.

## The deposit button is blocked

The app names the reason under the button. The common ones:

- **Wrong network.** Auro must be on Mina Devnet.
- **Not registered.** Complete [registration](/#register-your-keys) first.
- **Keplr on a different account.** Deposits land on the *registered*
  account. Switch Keplr to it, or disconnect Keplr. The block exists so funds
  don't land somewhere you weren't looking at.
- **Balance too low.** You need the amount plus the 0.1 MINA fee, and a
  withdrawal needs 1.1 MINA on the Mina side.

## My withdrawal was voided

The chain checks your pMINA balance at scan time. If the balance dipped below
the withdrawn amount before the chain scanned it, the withdrawal burns
nothing and the 1 MINA down payment is forfeited. The pMINA is still yours;
the down payment is not recoverable. Keep the amount untouched until the
withdrawal settles, about two hours.

## A pending row never settles

Pending records deliberately never expire, because a transfer that never
settles is the one you most need to keep seeing. **Dismiss** removes the row
from your browser only; it does not affect the transfer itself. Before
dismissing, check the Mina transaction link on the row: if the Mina
transaction failed, nothing ever reached the bridge.

## I registered but the app says I'm not registered

Registration is visible from either wallet, but it can take a moment after
the transaction commits. If it persists, check that Auro is connected with
the same Mina account you registered, since the registry maps that exact key.

## I sent a deposit without registering

The deposit is judged invalid: no pMINA is minted, and the MINA stays locked
in the contract. There is currently no self-service refund path, so contact
the team.
