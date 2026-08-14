import { describe, expect, it } from "vitest";

import { buildKeplrChainConfigFromRegistry } from "./keplr";
import {
  PMINA_DENOM,
  PMINA_EXPONENT,
  consumerAssetList,
  consumerChain,
} from "./constants";

describe("buildKeplrChainConfigFromRegistry", () => {
  it("gives the wallet the same scale this app renders in", () => {
    // The regression this exists for: while the asset list named its base denom
    // as its own display unit, this resolved to 0 and every wallet showed
    // balances a billion times too large.
    const config = buildKeplrChainConfigFromRegistry(consumerChain, consumerAssetList);

    expect(config.currencies[0].coinDecimals).toBe(PMINA_EXPONENT);
    expect(config.feeCurrencies[0].coinDecimals).toBe(PMINA_EXPONENT);
    expect(config.stakeCurrency.coinDecimals).toBe(PMINA_EXPONENT);
  });

  it("keeps the on-chain denom as the minimal one, and the symbol user-facing", () => {
    const config = buildKeplrChainConfigFromRegistry(consumerChain, consumerAssetList);

    expect(config.currencies[0].coinMinimalDenom).toBe(PMINA_DENOM);
    expect(config.currencies[0].coinDenom).toBe("pMINA");
  });

  it("passes the chain's minimum gas price through in base units", () => {
    // Keplr reads gasPriceStep in the minimal denom, so it must not be rescaled
    // by the decimals above — the chain's minimum-gas-prices is 0.0001pmina.
    const config = buildKeplrChainConfigFromRegistry(consumerChain, consumerAssetList);

    expect(config.gasPriceStep?.average).toBe(
      consumerChain.fees!.feeTokens[0]!.fixedMinGasPrice,
    );
  });

  it("refuses an asset whose display denom has no unit", () => {
    // Silently guessing here is what let the wrong scale reach a wallet before.
    expect(() =>
      buildKeplrChainConfigFromRegistry(consumerChain, {
        chainName: "pulsar",
        assets: [
          {
            base: "pmina",
            name: "Pulsar MINA",
            display: "PMINA",
            symbol: "pMINA",
            typeAsset: "sdk.coin",
            denomUnits: [{ denom: "pmina", exponent: 0 }],
          },
        ],
      }),
    ).toThrow(/no matching denom unit/);
  });
});
