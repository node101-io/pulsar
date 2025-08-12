function bigintToBytesBE(input: bigint, length: number): Uint8Array {
  let value = input;
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(value & BigInt(0xff));
    value = value >> BigInt(8);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const padded = clean.length % 2 === 1 ? `0${clean}` : clean;
  const arr = new Uint8Array(padded.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(padded.substr(i * 2, 2), 16);
  }
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  // Node fallback
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

export function ensureLength(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length === length) return bytes;
  if (bytes.length > length) return bytes.slice(bytes.length - length);
  const out = new Uint8Array(length);
  out.set(bytes, length - bytes.length);
  return out;
}

// Convert Mina base58 public key to hex encoding expected by backend (kryptology MarshalBinary format):
// 32-byte big-endian X coordinate with the MSB indicating oddness of Y.
export async function minaPublicKeyToHex(base58: string): Promise<string> {
  const { PublicKey } = await import('o1js');
  const pk = PublicKey.fromBase58(base58);
  // PublicKey JSON is { x: string (decimal), isOdd: boolean }
  if (!pk.x) throw new Error('Failed to derive Mina public key X coordinate');
  const x = BigInt(pk.x.toBigInt());
  const xBytes = bigintToBytesBE(x, 32);
  const isOdd = !!pk.isOdd;
  const first = xBytes[0] ?? 0;
  xBytes[0] = isOdd ? (first | 0x80) : (first & 0x7f);
  return bytesToHex(xBytes);
}

// Pack Auro signature (field, scalar) into 64-byte binary (32 + 32) expected by backend.
export function packMinaSignature(fieldHex: string, scalarHex: string): Uint8Array {
  const f = ensureLength(hexToBytes(fieldHex), 32);
  const s = ensureLength(hexToBytes(scalarHex), 32);
  const out = new Uint8Array(64);
  out.set(f, 0);
  out.set(s, 32);
  return out;
}
