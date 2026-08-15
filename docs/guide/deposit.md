# Deposit (Mina → Pulsar)

A deposit locks MINA in the settlement contract on Mina and credits the same
amount as pMINA to your **registered** Pulsar account.

## The numbers

- **Minimum:** 1 MINA
- **Maximum:** your Mina balance minus the fee
- **Mina fee:** 0.1 MINA
- **Time to credit:** about two hours

## Before you start

::: danger
Make sure your Mina key is [registered](/#register-your-keys). A deposit from
an unregistered key is judged invalid: no pMINA is minted, and the MINA stays
locked in the contract.
:::

Keplr is **not** needed to deposit. If Keplr happens to be connected to a
different account than your registered one, the app blocks the deposit and
tells you to switch. Deposits always land on the registered account, and the
block prevents a surprise.

## Steps

1. Open the bridge and connect Auro, on Mina **Devnet**.
2. Enter the amount. The app builds and proves the transaction in your
   browser. The first proof after opening the app takes a few minutes cold
   and seconds afterwards; preparation starts as soon as your wallet
   connects.
3. Sign in Auro.

## What happens next

The deposit appears under **Transactions** as *pending* immediately. That
record lives in your browser, because nothing on either chain shows the
deposit until Pulsar scans it.

Behind the scenes:

1. Your transaction dispatches a deposit action on the settlement contract.
2. Pulsar waits for the Mina block to reach finality depth, then validators
   read the action and judge it.
3. A valid deposit mints pMINA to your registered account, and the pending
   row flips to a settled one.

The transactions page shows live progress: confirming on Mina, with a block
countdown, then waiting for Pulsar's scan. End to end is **about two
hours**, nearly all of it Mina finality.
