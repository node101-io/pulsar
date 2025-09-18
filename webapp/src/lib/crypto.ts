import bs58 from 'bs58';
// import 'mina-signer';

function bytesToBase58(bytes: Uint8Array): string {
  return bs58.encode(bytes);
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

function bigintToBytesBE(input: bigint, length: number): Uint8Array {
  let value = input;
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(value & BigInt(0xff));
    value = value >> BigInt(8);
  }
  return bytes;
}

async function hexToFields(hex: string) {
  const { Field } = await import('o1js');
  // 31 byte = 62 hex karakter
  const chunkSize = 62;
  let fields = [];
  for (let i = 0; i < hex.length; i += chunkSize) {
    const chunk = hex.slice(i, i + chunkSize);
    fields.push(Field(BigInt("0x" + chunk)));
  }
  return fields;
}

async function stringToFields(msg: string) {
  const { Field } = await import('o1js');

  const chunkSize = Field.sizeInBytes;

  const msgBytes = new TextEncoder().encode(msg);

  const fields: any[] = [];

  if (msgBytes.length === 0)
    return fields;

  for (let i = 0; i < msgBytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, msgBytes.length);
    const chunk = msgBytes.slice(i, end);

    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const bigIntValue = BigInt('0x' + hex);

    fields.push(Field(bigIntValue));
  }

  return fields;
}

export async function formatMinaPublicKey(base58: string): Promise<string> {
  const { PublicKey } = await import('o1js');
  const pubkey = PublicKey.fromBase58(base58);

  const out = new Uint8Array(33);
  out.set(bigintToBytesBE(pubkey.x.toBigInt(), 32), 0);
  out[32] = pubkey.isOdd.toBoolean() ? 0x01 : 0x00;

  return bytesToBase58(out);
}

export function packMinaSignature(field: string, scalar: string): Uint8Array {
  const fieldSizeBytes = 32; // kimchi Fp byte length

  const fieldBigInt = BigInt(field);
  const scalarBigInt = BigInt(scalar);

  const fieldBytes = bigintToBytesBE(fieldBigInt, fieldSizeBytes);
  const scalarBytes = bigintToBytesBE(scalarBigInt, fieldSizeBytes);

  if (fieldBytes.length > fieldSizeBytes) {
    throw new Error(`Signature field is too large: got ${fieldBytes.length} bytes, max ${fieldSizeBytes} bytes`);
  }
  if (scalarBytes.length > fieldSizeBytes) {
    throw new Error(`Signature scalar is too large: got ${scalarBytes.length} bytes, max ${fieldSizeBytes} bytes`);
  }

  const packed = new Uint8Array(fieldSizeBytes * 2);

  packed.set(fieldBytes, fieldSizeBytes - fieldBytes.length);
  packed.set(scalarBytes, fieldSizeBytes + (fieldSizeBytes - scalarBytes.length));
  return packed;
}

export async function hashMessageForSigning(message: string): Promise<string> {
  const { Poseidon } = await import('o1js');

  const fields = await stringToFields(message);
  const hash = Poseidon.hash(fields);

  return hash.toString();
}

// // SignMessage generates a Schnorr signature for an arbitrary string message.
// // The message is split into field elements of size equal to the underlying field byte size.
// // Each chunk is converted to a big.Int, collected into a poseidonbigint.HashInput and
// // then the existing Sign method is invoked.
// func (sk PrivateKey) SignMessage(msg string, networkId string) (*signature.Signature, error) {
// 	// Determine the chunk size (in bytes) for each field element.
// 	// This corresponds to the size, in bytes, of elements in the base field Fp.
// 	chunkSize := field.Fp.SizeInBytes()

// 	// Convert the incoming string message to a byte slice.
// 	msgBytes := []byte(msg)

// 	// Convert the message into field elements for Poseidon hash.
// 	var fields []*big.Int

// 	if len(msgBytes) == 0 {
// 		// Empty message results in an empty slice of field elements.
// 		fields = []*big.Int{}
// 	} else {
// 		for i := 0; i < len(msgBytes); i += chunkSize {
// 			end := i + chunkSize
// 			if end > len(msgBytes) {
// 				end = len(msgBytes)
// 			}
// 			chunk := msgBytes[i:end]

// 			fieldElement := new(big.Int)
// 			fieldElement.SetBytes(chunk)
// 			fields = append(fields, fieldElement)
// 		}
// 	}

// 	hashInput := poseidonbigint.HashInput{
// 		Fields: fields,
// 	}

// 	// Delegate to the existing Sign implementation.
// 	return sk.Sign(hashInput, networkId)
// }
