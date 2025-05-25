# Pulsar

Pulsar is a application layer on top of Mina Protocol using Cosmos SDK, designed and built by the node101 team. It is currently under exploration and PoC level, and we hope to release it under public testnet in a couple of months time. Some important points are:

1. It is designed as a restake chain (probably on top of ATOM, not finalized yet).
2. It performs periodic proving of all consensus related activity through o1js proofs.
3. It settles on Mina to keep the chain history succinct.
4. It is backed by the consumer chain's economical security for any on chain activity.
5. It is backed by Mina's economical security for historical availability and succinctness of the chain.

In short, it is designed as a side-chain for Mina for fast throughput zkApps.

For more information, you can reach out from [hello@node101.io](mailto:hello@node101.io) or write from Telegram (@ygurlek).
