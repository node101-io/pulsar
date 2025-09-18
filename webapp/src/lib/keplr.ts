"use client";

import type { Asset, AssetList, Chain } from "@chain-registry/types";
import { consumerAssetList, consumerChain } from "./constants";

type KeplrCurrency = {
  coinDenom: string;
  coinMinimalDenom: string;
  coinDecimals: number;
  coinGeckoId?: string;
};

type KeplrChainConfig = {
  chainId: string;
  chainName: string;
  rpc: string;
  rest: string;
  bip44: { coinType: number };
  coinType: number;
  bech32Config: Required<Chain>["bech32Config"];
  currencies: KeplrCurrency[];
  feeCurrencies: (KeplrCurrency & {
    gasPriceStep?: { low: number; average: number; high: number };
  })[];
  gasPriceStep?: { low: number; average: number; high: number };
  stakeCurrency: KeplrCurrency;
  features?: string[];
};

function pickDisplayDecimals(asset: Asset): number {
  const displayDenom = asset.display;
  const unit = asset.denomUnits.find((u) => u.denom === displayDenom);
  return unit?.exponent ?? 6;
}

export function buildKeplrChainConfigFromRegistry(
  chain: Chain,
  assetList: AssetList
): KeplrChainConfig {
  const rpc = chain.apis?.rpc?.[0]?.address;
  const rest = chain.apis?.rest?.[0]?.address;
  if (!rpc || !rest) {
    throw new Error("RPC/REST endpoints are missing for the chain");
  }

  if (!chain.chainId) {
    throw new Error("chainId is missing for the chain");
  }

  const primaryAsset = assetList.assets[0];
  if (!primaryAsset) {
    throw new Error("No assets defined for the chain");
  }

  const coinDecimals = pickDisplayDecimals(primaryAsset);

  const currency: KeplrCurrency = {
    coinDenom: primaryAsset.symbol ?? primaryAsset.display ?? primaryAsset.base,
    coinMinimalDenom: primaryAsset.base,
    coinDecimals,
  };

  const gasPriceAvg = chain.fees?.feeTokens?.[0]?.fixedMinGasPrice ?? 0.025;
  const gasPriceStep = {
    low: Math.max(0.01, gasPriceAvg * 0.6),
    average: gasPriceAvg,
    high: Math.max(gasPriceAvg, gasPriceAvg * 1.4),
  };

  const cfg: KeplrChainConfig = {
    chainId: chain.chainId,
    chainName: chain.prettyName ?? chain.chainName ?? chain.chainId,
    rpc,
    rest,
    bip44: { coinType: chain.slip44 ?? 118 },
    coinType: chain.slip44 ?? 118,
    bech32Config: chain.bech32Config!,
    currencies: [currency],
    feeCurrencies: [{ ...currency, gasPriceStep }],
    gasPriceStep,
    stakeCurrency: currency,
    features: [],
  };

  return cfg;
}

export async function suggestPulsarToKeplr(): Promise<void> {
  if (typeof window === "undefined")
    throw new Error("Not in a browser context");
  // @ts-ignore - Keplr injects itself on window
  const keplr = window.keplr as any | undefined;
  if (!keplr) throw new Error("Keplr extension not detected");

  const cfg = buildKeplrChainConfigFromRegistry(
    consumerChain,
    consumerAssetList
  );
  await keplr.experimentalSuggestChain(cfg);
  await keplr.enable(cfg.chainId);
}
