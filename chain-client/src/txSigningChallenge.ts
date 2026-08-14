// The field element a Mina wallet signs to authorize a whole Pulsar
// transaction. This is the client half of the chain's buildTxSigningChallenge
// (pulsar-chain, app/ante/tx_signing_challenge.go) and MUST stay
// byte-identical to it — the only symptom of drift is a rejected transaction
// with an opaque "signature verification failed", so txSigningChallenge.test.ts
// pins this to the chain's own vectors, including one signed by a real Auro
// wallet.
//
// The input is the canonical SIGN_MODE_DIRECT sign bytes, so the challenge
// binds everything they bind: chain id, account number, sequence, fee and all
// messages. Replay protection is unchanged from a Cosmos-signed tx.
//
// o1js is imported lazily on purpose: this module is reachable from the
// browser entry (src/messages.ts), and a static import would drag the whole
// prover runtime into a bundle that only wanted to build a transaction.

export { txSigningChallenge };

// Domain separation from key registration and every other wallet-signing
// context (the pulsar-kr-* prefixes). Changing the prefix, version, or framing
// is a chain protocol change; it lands here only together with new vectors.
const TX_SIGNING_CHALLENGE_PREFIX = "pulsar-tx-auth-v1";

const TX_SIGNING_CHALLENGE_VERSION = 1;

/**
 * The challenge for one transaction, as a decimal field element.
 *
 * Pass it to a wallet's `signFields` and place the returned signature in
 * `TxRaw.signatures` — the chain verifies a Schnorr field signature over
 * exactly this element instead of a secp256k1 signature over the bytes.
 */
async function txSigningChallenge(signBytes: Uint8Array): Promise<bigint> {
    // The chain refuses empty sign bytes for the same reason: they cannot
    // come out of a real transaction, so hashing them would mint a
    // well-formed challenge that authorizes nothing.
    if (signBytes.length === 0) {
        throw new Error("empty sign bytes");
    }

    const { Encoding, Poseidon } = await import("o1js");

    // A version byte, the 4-byte big-endian length, then the sign bytes —
    // matching binary.BigEndian framing on the Go side.
    const payload = new Uint8Array(5 + signBytes.length);
    payload[0] = TX_SIGNING_CHALLENGE_VERSION;
    new DataView(payload.buffer).setUint32(1, signBytes.length, false);
    payload.set(signBytes, 5);

    return Poseidon.hashWithPrefix(
        TX_SIGNING_CHALLENGE_PREFIX,
        Encoding.bytesToFields(payload),
    ).toBigInt();
}
