# Getting Started

Pulsar is an appchain anchored to [Mina](https://minaprotocol.com). MINA
locked in a zkApp contract on Mina becomes **pMINA** on Pulsar, one for one;
burning pMINA releases the MINA back. Everything the bridge does is
adjudicated by Pulsar's validators and proven back to the Mina contract, as
described in [How It Works](/how-it-works).

::: danger Register before your first deposit
The bridge credits pMINA to the Pulsar account registered against your Mina
key. A deposit from an unregistered key is judged invalid: no pMINA is
minted, and the MINA stays locked in the contract.
:::

## What you need

- **[Auro Wallet](https://www.aurowallet.com/)** with a Mina account funded
  on **Mina devnet**. This is required for everything: registration,
  deposits, withdrawals, and even sending pMINA.
- **[Keplr](https://www.keplr.app/)**, needed **once**, for registration.
  After that, every flow works with Auro alone.

There is no faucet in the app, so fund your devnet Mina account first. A
deposit needs at least 1.1 MINA (the 1 MINA minimum plus the 0.1 MINA fee),
and a withdrawal needs 1.1 MINA (refundable down payment plus fee).

## Connect both wallets

Open [app.pulsarchain.xyz](https://app.pulsarchain.xyz) and connect Auro and
Keplr. The app suggests the Pulsar chain to Keplr automatically. When both
are connected and your keys are not yet registered, onboarding opens on its
own.

## Register your keys

Registration links your Mina key to your Pulsar account in the chain's key
registry, with two signatures:

1. **Auro** signs a challenge binding your Mina key to your Pulsar key.
2. **Keplr** signs the registration transaction that submits it.

You do not need pMINA to register. The app requests a fee grant for your new
Pulsar account, and the grant pays the registration fee.

Two rules to know:

- The mapping is **one-time**. A Mina key registers once, and a Pulsar
  account can never be re-pointed to a different one, so deposits will always
  credit the Pulsar account you register now.
- After registration, Keplr is optional. The app recognizes your registered
  account from either wallet.

## Make your first transfer

| | Deposit | Withdrawal |
| --- | --- | --- |
| Signed with | Auro | Auro |
| Minimum | 1 MINA | none (up to your full balance) |
| Mina cost | 0.1 MINA fee | 0.1 MINA fee plus 1 MINA refundable down payment |
| Time | ~2 hours to credit | ~2 hours to burn, then the next settlement pays out |

Both directions are Mina transactions, and both take about two hours, nearly
all of it Mina finality before Pulsar will scan the block. Track them under
**Transactions** in the app.

Next: [Deposit](/guide/deposit) · [Withdraw](/guide/withdraw) ·
[Send pMINA](/guide/send) · [Troubleshooting](/guide/troubleshooting)
