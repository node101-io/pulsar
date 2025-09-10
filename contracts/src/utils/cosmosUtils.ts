import { Bool, Field, PublicKey } from 'o1js';

export { PulsarEncoder };

class PulsarEncoder {
  private static readonly alphabet =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  static marshalBytes(pubKey: PublicKey): Uint8Array {
    const out = new Uint8Array(33);
    const xBytes = PulsarEncoder.bigintToBytes(pubKey.x.toBigInt());

    if (xBytes.length > 32) {
      throw new Error(
        `PublicKey.X is too large: got ${xBytes.length} bytes, max ${32} bytes`
      );
    }

    const offset = 32 - xBytes.length;
    out.set(xBytes, offset);

    out[32] = pubKey.isOdd.toBoolean() ? 0x01 : 0x00;

    return out;
  }

  static toAddress(pubKey: PublicKey): string {
    const pubKeyBytes = PulsarEncoder.marshalBytes(pubKey);

    return PulsarEncoder.base58Encode(pubKeyBytes);
  }

  static bigintToBytes(value: bigint): Uint8Array {
    if (value === 0n) {
      return new Uint8Array([0]);
    }

    const bytes: number[] = [];
    let temp = value;

    while (temp > 0n) {
      bytes.unshift(Number(temp & 0xffn));
      temp = temp >> 8n;
    }

    return new Uint8Array(bytes);
  }

  static base58Encode(bytes: Uint8Array): string {
    let num = 0n;
    for (let i = 0; i < bytes.length; i++) {
      num = num * 256n + BigInt(bytes[i]);
    }

    if (num === 0n) {
      return this.alphabet[0];
    }

    let result = '';
    while (num > 0n) {
      const remainder = num % 58n;
      num = num / 58n;
      result = this.alphabet[Number(remainder)] + result;
    }

    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
      result = this.alphabet[0] + result;
    }

    return result;
  }

  static base58Decode(encoded: string): Uint8Array {
    let num = 0n;
    for (let i = 0; i < encoded.length; i++) {
      const char = encoded[i];
      const index = this.alphabet.indexOf(char);
      if (index === -1) {
        throw new Error(`Invalid base58 character: ${char}`);
      }
      num = num * 58n + BigInt(index);
    }

    const bytes: number[] = [];
    while (num > 0n) {
      bytes.unshift(Number(num & 0xffn));
      num = num >> 8n;
    }

    for (
      let i = 0;
      i < encoded.length && encoded[i] === this.alphabet[0];
      i++
    ) {
      bytes.unshift(0);
    }

    return new Uint8Array(bytes);
  }

  static unmarshalBytes(bytes: Uint8Array): { x: bigint; isOdd: boolean } {
    if (bytes.length !== 33) {
      throw new Error(
        `Invalid byte length: got ${bytes.length}, expected ${33}`
      );
    }

    const xBytes = bytes.slice(0, 32);
    const x = PulsarEncoder.bytesToBigint(xBytes);

    const isOdd = bytes[32] === 0x01;

    return { x, isOdd };
  }

  static fromAddress(address: string): PublicKey {
    const bytes = PulsarEncoder.base58Decode(address);
    const { x, isOdd } = PulsarEncoder.unmarshalBytes(bytes);
    return PublicKey.from({
      x: Field(x),
      isOdd: Bool(isOdd),
    });
  }

  static bytesToBigint(bytes: Uint8Array): bigint {
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
      result = result * 256n + BigInt(bytes[i]);
    }
    return result;
  }
}
