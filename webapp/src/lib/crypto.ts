// Encoding boundary between the browser (o1js / Auro) and the Pulsar chain
// (mina-signer-go). Every conversion here was measured against the chain's
// own verification code, not inferred from the shapes — the two sides
// disagree about endianness in ways that fail silently or produce
// plausible-looking wrong keys.

// The field a Mina key signs to prove it belongs with a Cosmos key is NOT
// here: it is derived by pulsar-chain-client's keySigningChallenge, which is
// pinned to the chain's own cross-language test vectors. A second copy of that
// derivation is exactly how a registration starts failing with an opaque
// "invalid signature".
export {
  formatMinaPublicKey,
  signatureFromBase58,
};

function toLittleEndian(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let rest = value;
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

/**
 * A Mina public key as the chain stores and parses it: the affine x
 * coordinate in 32 LITTLE-endian bytes, with the odd-y flag in the top bit of
 * the most significant byte.
 *
 * Not 33 big-endian bytes — that shape parses as a different point or fails
 * outright, and the failure surfaces as "invalid public key length" much
 * later, inside the registration handler.
 */
async function formatMinaPublicKey(base58: string): Promise<Uint8Array> {
  const { PublicKey } = await import("o1js");
  const publicKey = PublicKey.fromBase58(base58);

  const packed = toLittleEndian(publicKey.x.toBigInt(), 32);
  if (publicKey.isOdd.toBoolean()) packed[31] |= 0x80;

  return packed;
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Auro returns `signFields` signatures base58-encoded (base58check: version
 * and type bytes, the 64-byte payload, then a 4-byte checksum). Only the
 * payload crosses to the chain.
 *
 * That payload is field then scalar, each 32 LITTLE-endian bytes — the shape
 * the chain's deserialiser accepts. Big-endian is not merely a different
 * reading, it is rejected outright ("R.x is not canonical"), which reads as a
 * malformed signature rather than a mis-encoded one.
 */
function signatureFromBase58(encoded: string): Uint8Array {
  let value = 0n;
  for (const char of encoded) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`invalid base58 character: ${char}`);
    value = value * 58n + BigInt(index);
  }

  const digits: number[] = [];
  while (value > 0n) {
    digits.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  let leadingZeros = 0;
  for (const char of encoded) {
    if (char === "1") leadingZeros++;
    else break;
  }
  const raw = new Uint8Array([...new Array(leadingZeros).fill(0), ...digits]);

  if (raw.length < 68) throw new Error("base58 signature is too short");
  return raw.slice(raw.length - 68, raw.length - 4);
}
