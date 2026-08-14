import { describe, expect, it } from "vitest";

import { DECIMALS, formatAmount, parseAmount, toDisplayNumber } from "./amount";

describe("parseAmount", () => {
  it("reads whole and fractional tokens exactly", () => {
    expect(parseAmount("1")).toBe(1_000_000_000n);
    expect(parseAmount("1.5")).toBe(1_500_000_000n);
    expect(parseAmount(".5")).toBe(500_000_000n);
    expect(parseAmount("1.")).toBe(1_000_000_000n);
    expect(parseAmount("0.000000001")).toBe(1n);
  });

  it("does not lose a base unit to float error", () => {
    // 0.29 * 1e9 is 289999999.99999994 in float, so the old flooring parse
    // deposited one nanomina less than the user typed.
    expect(parseAmount("0.29")).toBe(290_000_000n);
    expect(parseAmount("0.07")).toBe(70_000_000n);
    expect(parseAmount("8.29")).toBe(8_290_000_000n);
  });

  it("truncates precision finer than a base unit, never rounds up", () => {
    expect(parseAmount("1.9999999999")).toBe(1_999_999_999n);
    expect(parseAmount("0.0000000009")).toBe(0n);
  });

  it("handles the exponent notation a number input can produce", () => {
    expect(parseAmount("1e3")).toBe(1_000_000_000_000n);
    expect(parseAmount("1.5e2")).toBe(150_000_000_000n);
    expect(parseAmount("1e-3")).toBe(1_000_000n);
  });

  it("reads anything unusable as zero rather than guessing", () => {
    for (const value of ["", "   ", "abc", "-5", "1.2.3", "0x10", "Infinity", "NaN"]) {
      expect(parseAmount(value)).toBe(0n);
    }
  });

  it("rejects an exponent no real amount could carry", () => {
    // Not merely wrong: 10n ** 1e9 would hang the tab computing it.
    expect(parseAmount("1e1000000000")).toBe(0n);
    expect(parseAmount("1e31")).toBe(0n);
  });

  it("keeps large amounts exact where a float would not", () => {
    // Above 2^53 base units, so Number would have rounded this.
    expect(parseAmount("90071992.547409911")).toBe(90_071_992_547_409_911n);
  });
});

describe("formatAmount", () => {
  it("truncates rather than rounding up", () => {
    // toFixed(3) renders this as 5.001, which is more than the account holds.
    expect(formatAmount(5_000_900_000n)).toBe("5.000");
    expect(formatAmount(999_999_999n)).toBe("0.999");
  });

  it("pads the fraction to the requested width", () => {
    expect(formatAmount(0n)).toBe("0.000");
    expect(formatAmount(1_000_000_000n)).toBe("1.000");
    expect(formatAmount(1_020_000_000n)).toBe("1.020");
  });

  it("renders whole tokens when asked for no decimals", () => {
    expect(formatAmount(1_500_000_000n, 0)).toBe("1");
  });

  it("keeps the sign outside the digits", () => {
    expect(formatAmount(-4_900_000_000n)).toBe("-4.900");
  });

  it("round-trips through parseAmount at full precision", () => {
    for (const value of [0n, 1n, 999_999_999n, 5_000_900_001n, 10n ** 18n]) {
      expect(parseAmount(formatAmount(value, DECIMALS))).toBe(value);
    }
  });

  it("never renders a Max button above the balance it came from", () => {
    const fee = 100_000_000n;
    for (const balance of [1n, 100_000_001n, 5_000_900_000n, 123_456_789_012n]) {
      const max = balance > fee ? balance - fee : 0n;
      expect(parseAmount(formatAmount(max, DECIMALS)) + fee).toBeLessThanOrEqual(
        balance > fee ? balance : balance + fee,
      );
    }
  });
});

describe("toDisplayNumber", () => {
  it("converts for price math", () => {
    expect(toDisplayNumber(1_500_000_000n)).toBe(1.5);
    expect(toDisplayNumber(0n)).toBe(0);
  });
});
