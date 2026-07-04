import { Bool, Field, PublicKey, Signature } from "o1js";

function leBytesToBigint(bytes: Uint8Array): bigint {
    let value = 0n;
    for (let i = bytes.length - 1; i >= 0; i -= 1) {
        value = (value << 8n) | BigInt(bytes[i]);
    }
    return value;
}

export function decodeMinaSignature(sig: Buffer | Uint8Array): string {
    const bytes = Buffer.isBuffer(sig) ? sig : Buffer.from(sig);
    if (bytes.length !== 64) {
        throw new Error(`Mina signature must be 64 bytes, got ${bytes.length}`);
    }

    // mina-signer-go wire format: (R.x || s), each 32-byte half little-endian.
    return Signature.fromValue({
        r: leBytesToBigint(bytes.subarray(0, 32)),
        s: leBytesToBigint(bytes.subarray(32, 64)),
    }).toBase58();
}

export function parseMinaPubkeyFromBytes(data: Buffer | Uint8Array): string {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (bytes.length === 33) {
        // Legacy 33-byte format: 32 bytes big-endian x + 1 byte isOdd
        const x = BigInt("0x" + bytes.subarray(0, 32).toString("hex"));
        const isOdd = bytes[32] === 1;
        return PublicKey.from({ x: Field(x), isOdd: Bool(isOdd) }).toBase58();
    }
    // 32-byte little-endian compressed format: buf[31] MSB = isOdd, remaining = x
    const isOdd = (bytes[31] & 0x80) !== 0;
    const xBuf = Buffer.from(bytes); // copy before clearing the parity bit
    xBuf[31] &= 0x7f;
    return PublicKey.from({
        x: Field(leBytesToBigint(xBuf)),
        isOdd: Bool(isOdd),
    }).toBase58();
}
