import { Bool, Field, PublicKey } from 'o1js';
import { CosmosSignature } from '../types/PulsarAction.js';

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

  static bigintToHex(value: bigint): string {
    return '0x' + value.toString(16);
  }

  static stringToHex(str: string): string {
    return '0x' + Buffer.from(str, 'utf8').toString('hex');
  }

  static hexToBytes(hex: string): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (cleanHex.length % 2 !== 0) {
      throw new Error('Invalid hex string length');
    }

    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
    }
    return bytes;
  }

  static parseCosmosSignature(cosmosSignature: string): CosmosSignature {
    const cosmosSignatureBytes = PulsarEncoder.hexToBytes(cosmosSignature);

    if (cosmosSignatureBytes.length !== 64) {
      throw new Error(
        `Invalid cosmos signature length: expected 64 bytes, got ${cosmosSignatureBytes.length}`
      );
    }

    const sigR = PulsarEncoder.bytesToBigint(cosmosSignatureBytes.slice(0, 32));
    const sigS = PulsarEncoder.bytesToBigint(cosmosSignatureBytes.slice(32));

    return new CosmosSignature({ r: Field(sigR), s: Field(sigS) });
  }

  static encodeSignature(signature: CosmosSignature): string {
    const rBytes = PulsarEncoder.bigintToBytes(signature.r.toBigInt());
    const sBytes = PulsarEncoder.bigintToBytes(signature.s.toBigInt());

    const paddedR = new Uint8Array(32);
    const paddedS = new Uint8Array(32);

    paddedR.set(rBytes, 32 - rBytes.length);
    paddedS.set(sBytes, 32 - sBytes.length);

    const combined = new Uint8Array(64);
    combined.set(paddedR, 0);
    combined.set(paddedS, 32);

    return Array.from(combined)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  static hexToBigint(hex: string): bigint {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (cleanHex.length === 0) {
      return 0n;
    }
    return BigInt('0x' + cleanHex);
  }
}
