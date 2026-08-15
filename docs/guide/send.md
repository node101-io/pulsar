# Send pMINA

pMINA moves like any Cosmos asset, but on Pulsar you can also send it with
your **Mina wallet**. The wallet popup's Send view supports both.

## With Auro (no Keplr needed)

Auro signs a challenge derived from the exact transaction bytes, and the
chain accepts that Mina signature in place of a Cosmos one. The transaction
spends from your **registered** Pulsar account.

## With Keplr

A standard Cosmos send from the connected Keplr account.

## Recipients

- A `pulsar1…` address is used as-is.
- A `B62…` Mina address also works. The app resolves it through the key
  registry and sends to its registered Pulsar account. If that Mina address
  is not registered, the send is refused, because the funds would otherwise
  be unreachable.

Sending to a Mina address only works inside this app; other Pulsar wallets
don't do the registry resolution.

## Fees and reserves

- The send fee is negligible: 100 pmina base units, or 0.0000001 pMINA.
- While a withdrawal of yours is pending, the app **reserves** that amount
  and excludes it from Max. Spending it would void the withdrawal and forfeit
  its 1 MINA down payment, as described in
  [Withdraw](/guide/withdraw#the-down-payment).
