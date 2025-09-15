import type { Chain, AssetList } from "@chain-registry/types";

export const MINA_RPC_URL = "http://65.108.68.236:8080/graphql";
//  || "https://api.minascan.io/node/mainnet/v1/graphql"
export const BRIDGE_ADDRESS = "B62qoaJYLUD66gzvSnjwsHJP2JHc4mPvsSKhgHUUL4M64uW8Yamj1RD";

export const consumerChain: Chain = {
  chainType: "cosmos",
  chainName: "consumer",
  prettyName: "Pulsar",
  chainId: "ccv-1",
  bech32Prefix: "consumer",
  bech32Config: {
    bech32PrefixAccAddr: "consumer",
    bech32PrefixAccPub: "consumerpub",
    bech32PrefixValAddr: "consumervaloper",
    bech32PrefixValPub: "consumervaloperpub",
    bech32PrefixConsAddr: "consumervalcons",
    bech32PrefixConsPub: "consumervalconspub",
  },
  slip44: 118,
  apis: {
    rpc: [
      {
        address: "http://5.9.42.22:26657",
      },
    ],
    rest: [
      {
        address: "http://5.9.42.22:1317",
      },
    ],
  },
  staking: {
    stakingTokens: [
      {
        denom: "stake",
      },
    ],
  },
  fees: {
    feeTokens: [
      {
        denom: "stake",
        fixedMinGasPrice: 0.025,
      },
    ],
  },
};

export const consumerAssetList: AssetList = {
  chainName: "consumer",
  assets: [
    {
      base: "stake",
      name: "stake",
      display: "stake",
      symbol: "STAKE",
      typeAsset: "sdk.coin",
      denomUnits: [
        { denom: "stake", exponent: 0 },
        { denom: "stake", exponent: 6 },
      ],
    },
    {
      base: "token",
      name: "token",
      display: "token",
      symbol: "TOKEN",
      typeAsset: "sdk.coin",
      denomUnits: [
        { denom: "token", exponent: 0 },
        { denom: "token", exponent: 6 },
      ],
    },
  ],
};
