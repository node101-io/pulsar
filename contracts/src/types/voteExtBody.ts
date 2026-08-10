import { Field, Poseidon, Struct } from 'o1js';

export { VoteExtBody, VoteExtBodyWire, hashVoteExtMessage };

/**
 * THE signed formula, factored out so the two circuits that verify chain
 * signatures — MultisigVerifierProgram over Block (settle) and
 * ApprovalQuorumProgram over VoteExtBody (reduce) — run one implementation
 * and cannot drift. `stateRoot` is the
 * JOINED app-hash commitment: settle's Block carries it pre-joined, while
 * VoteExtBody carries the two 16-byte halves (so a wire body round-trips)
 * and joins them in hash().
 */
function hashVoteExtMessage(
  nextValidatorSetHash: Field,
  stateRoot: Field,
  currentBlockHeight: Field,
  actionsReducedRoot: Field
): Field {
  const inner = Poseidon.hash([
    nextValidatorSetHash,
    stateRoot,
    currentBlockHeight,
  ]);
  return Poseidon.hash([inner, actionsReducedRoot]);
}

/**
 * Raw VoteExtBody protobuf values as the chain serves them
 * (pulsarchain.votepersistence.v1.VoteExtBody): three byte blobs and an
 * int64 height. `currentStateRoot` is the 32-byte CometBFT app hash.
 */
interface VoteExtBodyWire {
  nextValidatorSetHash: Uint8Array;
  currentStateRoot: Uint8Array;
  currentBlockHeight: bigint;
  actionsReducedRoot: Uint8Array;
}

/**
 * SINGLE SOURCE OF TRUTH for the vote-extension body hash — the one field
 * element every Pulsar validator signs each block.
 *
 * Mirrors hashVoteExtBody in pulsar-chain/abci/signing.go:87-161. The chain
 * signs plain Kimchi Poseidon (zero IV, rate 2, no domain prefix), so
 * hash() here is bit-identical to the value passed to SignFieldElement at
 * signing.go:52 and `Signature.verify(pk, [body.hash()])` accepts the
 * chain's signatures unchanged. Pinned digit-for-digit by chain-generated
 * vectors in src/test/fixtures/voteExtBody.vectors.json (signed via the
 * real abci.SecondaryKey.SignVoteExtBody entry point) — never inline the
 * formula.
 *
 * The 32-byte app hash does not fit one field element, so the chain splits
 * it into two big-endian halves (signing.go:145-155); the struct carries
 * the halves, not the joined stateRoot, so a wire body round-trips.
 */
class VoteExtBody extends Struct({
  nextValidatorSetHash: Field,
  stateRootHi: Field,
  stateRootLo: Field,
  currentBlockHeight: Field,
  actionsReducedRoot: Field,
}) {
  /**
   * signing.go:87-133:
   *   stateRoot = Poseidon([stateRootHi, stateRootLo])          // :155
   *   inner     = Poseidon([vsRoot, stateRoot, height])         // :113-117
   *   msgHash   = Poseidon([inner, actionsReducedRoot])         // :127
   */
  hash(): Field {
    return hashVoteExtMessage(
      this.nextValidatorSetHash,
      Poseidon.hash([this.stateRootHi, this.stateRootLo]),
      this.currentBlockHeight,
      this.actionsReducedRoot
    );
  }

  /**
   * Non-provable: decodes the wire body with the chain's exact byte->field
   * conventions.
   *
   * - nextValidatorSetHash / actionsReducedRoot: strict big-endian field
   *   bytes (signing.go:98,:108 -> field.FromBytes, big-endian, errors on
   *   values >= p) — a non-canonical root is a malformed body, so throw
   *   like the chain does rather than silently reduce.
   * - currentStateRoot: exactly 32 bytes, split 16/16; each half is a
   *   big-endian integer reduced mod p (signing.go:139-153 ->
   *   FromBytesBEReduce). A 128-bit value never reaches p, so the
   *   reduction cannot wrap — kept only to mirror the chain's semantics.
   * - currentBlockHeight: non-negative int64 cast to a field
   *   (signing.go:92-94,:116).
   */
  static fromWire(wire: VoteExtBodyWire): VoteExtBody {
    if (wire.currentStateRoot.length !== 32) {
      throw new Error(
        `currentStateRoot must be 32 bytes, got ${wire.currentStateRoot.length}`
      );
    }
    if (wire.currentBlockHeight < 0n || wire.currentBlockHeight >= 1n << 63n) {
      throw new Error(
        `currentBlockHeight must fit a non-negative int64, got ${wire.currentBlockHeight}`
      );
    }

    return new VoteExtBody({
      nextValidatorSetHash: fieldFromBytesBE(wire.nextValidatorSetHash),
      stateRootHi: fieldFromBytesBEReduce(wire.currentStateRoot.slice(0, 16)),
      stateRootLo: fieldFromBytesBEReduce(wire.currentStateRoot.slice(16, 32)),
      currentBlockHeight: Field(wire.currentBlockHeight),
      actionsReducedRoot: fieldFromBytesBE(wire.actionsReducedRoot),
    });
  }
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/** Strict big-endian decode: mirrors field.FromBytes, rejects values >= p. */
function fieldFromBytesBE(bytes: Uint8Array): Field {
  const value = bytesToBigIntBE(bytes);
  if (value >= Field.ORDER) {
    throw new Error('big-endian bytes exceed the field modulus');
  }
  return Field(value);
}

/** Reducing big-endian decode: mirrors field.FromBytesBEReduce. */
function fieldFromBytesBEReduce(bytes: Uint8Array): Field {
  return Field(bytesToBigIntBE(bytes) % Field.ORDER);
}
