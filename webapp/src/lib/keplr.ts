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

/**
 * How many decimals a wallet should render this asset with.
 *
 * Throws rather than defaulting when the asset list has no unit for its own
 * display denom. The default that used to sit here was 6, which is not a safe
 * guess but a specific wrong answer for this chain — it would render every
 * balance a thousandfold off — and it would do so silently, in a wallet, where
 * nothing in this codebase could catch it. A misconfigured asset list is a
 * mistake to surface at the first connect, not to paper over.
 */
function pickDisplayDecimals(asset: Asset): number {
  const unit = asset.denomUnits.find((u) => u.denom === asset.display);
  if (!unit) {
    throw new Error(
      `Asset ${asset.base} declares display denom "${asset.display}" with no matching denom unit`,
    );
  }
  return unit.exponent;
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

/**
 * The connected Pulsar account, read straight from the extension.
 *
 * Pages cannot reach usePulsarWallet: its provider wraps the header alone, and
 * deliberately — interchain-kit's graph reaches libsodium's top-level await,
 * which a prerendered page cannot carry. getKey answers without that graph.
 *
 * It throws when the chain has never been approved, which here means exactly
 * "no wallet connected", so the rejection is an answer rather than a failure.
 */
export async function getPulsarAddress(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  // @ts-ignore - Keplr injects itself on window
  const keplr = window.keplr as any | undefined;
  if (!keplr) return null;

  try {
    const key = await keplr.getKey(consumerChain.chainId);
    return (key?.bech32Address as string | undefined) ?? null;
  } catch {
    return null;
  }
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
