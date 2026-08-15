# Network Reference

Current **testnet** deployment. A chain re-genesis changes the contract
address and can change parameters, so this page is the single place to
update.

::: info Last updated
2026-08-15, for the contract deployed 2026-08-14.
:::

## Pulsar chain

| Setting | Value |
| --- | --- |
| Chain ID | `mytestnet` |
| Base denom | `pmina` (the base unit; there is no "upmina") |
| Display | 1 pMINA = 10⁹ pmina (9 decimals, matches nanomina 1:1) |
| Address prefix | `pulsar` |
| Min gas price | `0.0001 pmina` |
| RPC | `https://rpc.pulsarchain.xyz` |
| REST | `https://rest.pulsarchain.xyz` |
| gRPC | `grpc.pulsarchain.xyz:443` |
| Explorer | `https://explorer.pulsarchain.xyz/pulsar` |

## Mina side

| Setting | Value |
| --- | --- |
| Network | Mina **Devnet** |
| Settlement contract | `B62qje6kuVppRQNfL3ot7cF1o4tLK5w2Tg3rRBFHe8RmY9YUJrPkFKW` |
| Bridge module account (Pulsar) | `pulsar1zlefkpe3g0vvm9a4h0jf9000lmqutlh96h0437` |
| Explorer | `https://minascan.io/devnet` |

The contract address is also readable on-chain from the `x/bridge` module's
`contract_address` parameter, and the chain adjudicates exactly that
contract. The module account is derived from the module name and survives
re-genesis.

## Bridge parameters

| Parameter | Value |
| --- | --- |
| Minimum deposit | 1 MINA |
| Mina transaction fee (app default) | 0.1 MINA |
| Withdrawal down payment | 1 MINA, refunded with a valid withdrawal |
| Mina finality depth | 40 blocks (~2 hours), read live from chain params |
| Settlement stride | 32 Pulsar blocks per `settle()` |

## Apps

| App | URL |
| --- | --- |
| Bridge webapp | `https://app.pulsarchain.xyz` |
| Docs | `https://docs.pulsarchain.xyz` |
