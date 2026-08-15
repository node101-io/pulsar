# Withdraw (Pulsar → Mina)

A withdrawal burns pMINA on Pulsar and releases the same amount of MINA from
the settlement contract to your Mina account. It is a **Mina transaction
signed in Auro**, so no Cosmos wallet is involved at any point.

## The numbers

- **Maximum:** your full pMINA balance
- **Mina fee:** 0.1 MINA
- **Down payment:** 1 MINA, **refunded** with a valid withdrawal
- **Mina balance needed:** 1.1 MINA (down payment plus fee)
- **Time to pay out:** about two hours to burn, then the next settlement

## The down payment

Every withdrawal locks a 1 MINA down payment in the contract alongside the
request. When Pulsar judges the withdrawal valid, the payout returns it, so
you receive **amount + 1 MINA**. When it judges the withdrawal invalid,
because the sender is unregistered or the pMINA balance no longer covers the
amount when the chain scans it, the down payment is **forfeited** and nothing
is burned.

::: warning Keep your balance until it settles
The chain checks your pMINA balance when it *scans* the withdrawal, not when
you sign it. If you spend the balance in the meantime and it dips below the
withdrawn amount, the withdrawal is voided and the 1 MINA down payment is
lost. The app reserves the amount in its Send view for exactly this reason,
so don't work around it from another wallet.
:::

## Steps

1. Open the bridge, switch direction to **Pulsar → Mina**, and connect Auro.
2. Enter the amount, up to your full balance.
3. Sign in Auro. The transaction carries the down payment, which you will see
   as part of the same transaction.

## What happens next

1. The withdrawal action reaches the settlement contract on Mina.
2. After Mina finality, about two hours, Pulsar validators verify your
   registered account holds enough pMINA and burn it.
3. The next settlement proof pays out **amount + 1 MINA down payment** to
   your Mina address.

Track it under **Transactions**: pending until the burn, then settled. The
MINA payout follows with the settlement that consumes the action.
