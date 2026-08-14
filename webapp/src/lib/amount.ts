// Every amount in this app, on both sides of the bridge, in one place.
//
// Both chains count in the same unit and at the same scale: 1 MINA is 1e9
// nanomina, a deposit mints 1:1, so 1 pMINA is 1e9 pmina. `pmina` IS the base
// denomination — there is no micro unit below it (see PMINA_DENOM).
//
// The rule this module exists to enforce: amounts are bigint base units
// everywhere, and become numbers only to be displayed or multiplied by a USD
// price. Every float shortcut that was here before lost money. `0.29 * 1e9` is
// 289999999.99999994, so flooring it sent a nanomina less than the user typed,
// and `balance.toFixed(3)` rounds up, so a Max button could offer more than the
// account held. Neither failure is visible in a code review of the call site,
// which is why the conversion lives here and not at each one.

import { PMINA_EXPONENT } from "./constants";

export {
  BASE_UNITS_PER_TOKEN,
  DECIMALS,
  formatAmount,
  parseAmount,
  toDisplayNumber,
};

/**
 * Decimal places a base unit resolves. `formatAmount(x, DECIMALS)` is the only
 * lossless rendering — use it wherever the string is parsed back rather than
 * read, a Max button above all.
 */
const DECIMALS = PMINA_EXPONENT;

/** Base units in one whole token. 1 MINA = 1e9 nanomina = 1e9 pmina. */
const BASE_UNITS_PER_TOKEN = 10n ** BigInt(PMINA_EXPONENT);

// An exponent past this cannot be a real amount, and 10n ** 1e9 would hang the
// tab computing a number no balance can hold. Rejecting is the safe answer.
const MAX_EXPONENT = 30;

const DECIMAL = /^(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/;

/**
 * Base units from what an amount field holds, exactly — no float ever touches
 * the digits. Anything that is not a non-negative decimal number reads as 0n:
 * a blank field, a pasted word, a negative. Callers gate on `> 0n` and on their
 * own minimum, so 0n is the one safe reading of "nothing usable here".
 *
 * More precision than a base unit can hold is TRUNCATED, never rounded up —
 * rounding up would produce an amount the account cannot cover.
 *
 * Exponent notation is handled rather than rejected: `<input type="number">`
 * reports `1e3` verbatim, so a decimal-only parser would silently read a
 * thousand tokens as zero.
 */
function parseAmount(value: string): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) return 0n;

  const [, decimal, exponent] = match;
  const power = exponent ? Number(exponent) : 0;
  if (!Number.isSafeInteger(power) || Math.abs(power) > MAX_EXPONENT) return 0n;

  const [whole, fraction = ""] = decimal.split(".");
  const digits = `${whole}${fraction}` || "0";

  // Where the decimal point ends up once the exponent is applied and the value
  // is expressed in base units. Positive means padding with zeros, negative
  // means there is more precision than a base unit can carry.
  const shift = PMINA_EXPONENT + power - fraction.length;

  return shift >= 0
    ? BigInt(digits) * 10n ** BigInt(shift)
    : BigInt(digits) / 10n ** BigInt(-shift);
}

/**
 * Base units as a token amount for display, truncated to `decimals`.
 *
 * Truncated, not rounded: this renders balances and maximums, and a printed
 * figure that is larger than the real one is a figure a user will try to spend.
 */
function formatAmount(base: bigint, decimals = 3): string {
  const negative = base < 0n;
  const magnitude = negative ? -base : base;

  const whole = magnitude / BASE_UNITS_PER_TOKEN;
  if (decimals <= 0) return `${negative ? "-" : ""}${whole}`;

  const fraction = (magnitude % BASE_UNITS_PER_TOKEN)
    .toString()
    .padStart(PMINA_EXPONENT, "0")
    .slice(0, decimals);

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Base units as a JS number, for multiplying by a USD price and nothing else.
 *
 * Lossy above 2^53 base units (about 9 million tokens) and lossy in the low
 * digits well before that. Never feed the result back into an amount — parse
 * the string instead.
 */
function toDisplayNumber(base: bigint): number {
  return Number(base) / Number(BASE_UNITS_PER_TOKEN);
}
