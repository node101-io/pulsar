import type { Chain, AssetList } from "@chain-registry/types";

// Mina devnet, read through Minascan. The SettlementContract lives here and
// every deposit is a transaction against it.
export const MINA_NETWORK = "devnet";
export const MINA_RPC_URL = "https://api.minascan.io/node/devnet/v1/graphql";

// Auro reports the connected network as "mina:<name>". A deposit built for
// this contract and sent from another network fails in a way that reads like
// a wallet bug, so the UI checks before it builds anything.
export const EXPECTED_MINA_NETWORK_IDS = ["mina:devnet", "mina:testnet"];

// SettlementContract on Mina devnet, deployed 2026-08-14 against the
// re-genesis'd Pulsar chain. The chain adjudicates exactly this address
// (x/bridge params.contract_address) — they are one deployment, not two
// settings. A chain re-genesis ALWAYS forces a new address here: deploy
// seals the account (verification key immutable, state proof-only), so the
// old contract can never be re-anchored to a new chain.
export const BRIDGE_ADDRESS =
  "B62qje6kuVppRQNfL3ot7cF1o4tLK5w2Tg3rRBFHe8RmY9YUJrPkFKW";

// Deposits below this are rejected by the contract (MINIMUM_DEPOSIT_AMOUNT).
//
// Nanomina, like every amount in this app — see lib/amount.ts, which owns the
// conversion to and from what a user types. Deliberately bigint: a number here
// invites the float arithmetic that module exists to keep out.
export const MINIMUM_DEPOSIT_NANOMINA = 1_000_000_000n;

// Transaction fee for the deposit. 0.1 MINA is the going rate on devnet; the
// old 1 MINA meant a user needed 2 MINA to make the 1 MINA minimum deposit.
export const MINA_TX_FEE_NANOMINA = 100_000_000n;

// What a withdrawal locks up on Mina until it settles (WITHDRAW_DOWN_PAYMENT,
// mirrored the way MINIMUM_DEPOSIT_NANOMINA mirrors its contract constant —
// importing pulsar-contracts here would pull o1js into every page bundle).
//
// The contract returns it WITH the payout when the chain judges the
// withdrawal valid, and keeps it when it does not — an unregistered sender or
// a pMINA balance that no longer covers the amount at scan time forfeits it.
// Everything the UI blocks or warns about around withdrawals exists to keep a
// user from ever paying this.
export const WITHDRAW_DOWN_PAYMENT_NANOMINA = 1_000_000_000n;

export const PULSAR_RPC_URL = "https://rpc.pulsarchain.xyz";
export const PULSAR_REST_URL = "https://rest.pulsarchain.xyz";

export const PULSAR_EXPLORER_URL = "https://explorer.pulsarchain.xyz/pulsar";

// Where a deposit can be checked while Pulsar has not credited it yet. Until
// then the Mina transaction is the only public evidence it happened at all.
export const MINA_EXPLORER_TX_URL = `https://minascan.io/${MINA_NETWORK}/tx`;

// The x/bridge module account.
//
// This is what makes bridge history readable at all. x/bridge emits no events
// of its own, and MsgPushNewActions carries only a Mina height — the actions
// themselves never reach the transaction body. What does survive is the bank
// module's own bookkeeping: a deposit is MintCoins + SendCoinsFromModuleToAccount
// FROM this address, a withdrawal is SendCoinsFromAccountToModule TO it. So the
// pair (this address, user address) on a single `transfer` event identifies a
// bridge movement and its direction. See fetchBridgeTransfers.
//
// NOT a deployment value: a module account address is a pure function of the
// module name and the bech32 prefix, so it survives re-genesis, redeploys and
// restarts unchanged. It is authtypes.NewModuleAddress("bridge"), i.e.
//
//     bech32("pulsar", sha256("bridge")[:20])
//
// which is verifiable in one line and was checked against the live chain's
// /cosmos/auth/v1beta1/module_accounts. Exactly two upstream edits can move it,
// and both are chain-forking changes that would break far more than this:
//   - pulsar-chain/x/bridge/types/keys.go  -> ModuleName = "bridge"
//   - pulsar-chain/app/config.go           -> AccountAddressPrefix
//
// Deriving it here instead was considered and rejected: it needs a sha256, and
// the only ready source (@cosmjs/crypto) would pull @noble/curves, @noble/ciphers
// and a hash-wasm blob into every page bundle to hash six bytes.
export const BRIDGE_MODULE_ADDRESS =
  "pulsar1zlefkpe3g0vvm9a4h0jf9000lmqutlh96h0437";

// The chain's one and only denomination — verified against bank/supply, which
// lists `pmina` alone. NOT "upmina": there is no micro unit here, pmina IS the
// base unit (see PMINA_EXPONENT).
export const PMINA_DENOM = "pmina";

// Keyed by chainName everywhere: the wallet provider, its endpoint overrides
// and the registry entry must agree or the chain store lookup fails at render.
export const PULSAR_CHAIN_NAME = "pulsar";

// pmina is the chain's base denomination AND its smallest unit: a deposit
// mints 1:1 with the action's nanomina amount, so 1 MINA == 1e9 pmina. The
// display exponent is 9 for that reason — 6 would show balances 1000x wrong.
export const PMINA_EXPONENT = 9;

// The name of the unit balances are SHOWN in, as distinct from the one the
// chain counts in. No such denomination exists on chain, and that is the
// convention: a display unit is a rendering of the base denom, the way ATOM
// renders uatom. It needs a name of its own only because this chain's base
// denom is already called pmina, so the two cannot share the string.
//
// Not cosmetic. A wallet reads the exponent attached to the DISPLAY denom, so
// while the asset list named the base as its own display unit, every wallet
// took the exponent beside it — 0 — and rendered balances in raw base units,
// a billion times what this app showed for the same account.
export const PMINA_DISPLAY_DENOM = "PMINA";

export const consumerChain: Chain = {
  chainType: "cosmos",
  chainName: PULSAR_CHAIN_NAME,
  prettyName: "Pulsar",
  chainId: "mytestnet",
  bech32Prefix: "pulsar",
  bech32Config: {
    bech32PrefixAccAddr: "pulsar",
    bech32PrefixAccPub: "pulsarpub",
    bech32PrefixValAddr: "pulsarvaloper",
    bech32PrefixValPub: "pulsarvaloperpub",
    bech32PrefixConsAddr: "pulsarvalcons",
    bech32PrefixConsPub: "pulsarvalconspub",
  },
  slip44: 118,
  apis: {
    rpc: [{ address: PULSAR_RPC_URL }],
    rest: [{ address: PULSAR_REST_URL }],
  },
  staking: {
    stakingTokens: [{ denom: "pmina" }],
  },
  fees: {
    feeTokens: [
      {
        denom: "pmina",
        // The chain's minimum-gas-prices; the wallet multiplies by gas.
        fixedMinGasPrice: 0.0001,
      },
    ],
  },
};

export const consumerAssetList: AssetList = {
  chainName: PULSAR_CHAIN_NAME,
  assets: [
    {
      base: PMINA_DENOM,
      name: "Pulsar MINA",
      display: PMINA_DISPLAY_DENOM,
      symbol: "pMINA",
      typeAsset: "sdk.coin",
      // Both ends of the scale, which is what a wallet needs to convert between
      // them: the denom the chain counts in at exponent 0, and the one balances
      // are shown in at PMINA_EXPONENT. Listing only the base leaves a reader
      // no exponent to find and nothing to say it is missing.
      denomUnits: [
        { denom: PMINA_DENOM, exponent: 0 },
        { denom: PMINA_DISPLAY_DENOM, exponent: PMINA_EXPONENT },
      ],
    },
  ],
};
