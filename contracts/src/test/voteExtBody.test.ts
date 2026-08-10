import { readFileSync } from 'fs';
import { join } from 'path';
import { Field, PublicKey, Signature } from 'o1js';
import { VoteExtBody } from '../types/voteExtBody';

type Vector = {
  description: string;
  wire: {
    nextValidatorSetHashBase64: string;
    appHashBase64: string;
    currentBlockHeight: string;
    actionsReducedRootBase64: string;
  };
  fields: {
    nextValidatorSetHash: string;
    stateRootHi: string;
    stateRootLo: string;
    currentBlockHeight: string;
    actionsReducedRoot: string;
  };
  msgHash: string;
  signature: { r: string; s: string };
  publicKeyBase58: string;
};

// jest runs from the contracts package root, like seed.ts reads deploy-result.json
const fixture: { vectors: Vector[] } = JSON.parse(
  readFileSync(
    join(process.cwd(), 'src/test/fixtures/voteExtBody.vectors.json'),
    'utf-8'
  )
);

function bodyFromFields(vector: Vector): VoteExtBody {
  return new VoteExtBody({
    nextValidatorSetHash: Field(vector.fields.nextValidatorSetHash),
    stateRootHi: Field(vector.fields.stateRootHi),
    stateRootLo: Field(vector.fields.stateRootLo),
    currentBlockHeight: Field(vector.fields.currentBlockHeight),
    actionsReducedRoot: Field(vector.fields.actionsReducedRoot),
  });
}

function bodyFromWire(vector: Vector): VoteExtBody {
  return VoteExtBody.fromWire({
    nextValidatorSetHash: Uint8Array.from(
      Buffer.from(vector.wire.nextValidatorSetHashBase64, 'base64')
    ),
    currentStateRoot: Uint8Array.from(
      Buffer.from(vector.wire.appHashBase64, 'base64')
    ),
    currentBlockHeight: BigInt(vector.wire.currentBlockHeight),
    actionsReducedRoot: Uint8Array.from(
      Buffer.from(vector.wire.actionsReducedRootBase64, 'base64')
    ),
  });
}

describe('VoteExtBody chain convention', () => {
  describe('hash() against chain-generated vectors', () => {
    fixture.vectors.forEach((vector, i) => {
      it(`reproduces msgHash of vector ${i} (${vector.description})`, () => {
        expect(bodyFromFields(vector).hash().toString()).toBe(vector.msgHash);
      });
    });
  });

  describe('fromWire against the raw wire bytes', () => {
    fixture.vectors.forEach((vector, i) => {
      it(`reproduces the field decomposition of vector ${i}`, () => {
        const body = bodyFromWire(vector);
        expect(body.nextValidatorSetHash.toString()).toBe(
          vector.fields.nextValidatorSetHash
        );
        expect(body.stateRootHi.toString()).toBe(vector.fields.stateRootHi);
        expect(body.stateRootLo.toString()).toBe(vector.fields.stateRootLo);
        expect(body.currentBlockHeight.toString()).toBe(
          vector.fields.currentBlockHeight
        );
        expect(body.actionsReducedRoot.toString()).toBe(
          vector.fields.actionsReducedRoot
        );
        expect(body.hash().toString()).toBe(vector.msgHash);
      });
    });
  });

  // The decisive test: the signatures were produced by the chain's real
  // signing entry point (abci.SecondaryKey.SignVoteExtBody), so acceptance
  // here proves o1js Signature.verify consumes the chain's vote-extension
  // signatures over body.hash() unchanged.
  describe('o1js Signature.verify accepts real chain signatures', () => {
    fixture.vectors.forEach((vector, i) => {
      it(`verifies the chain signature of vector ${i} over body.hash()`, () => {
        const signature = Signature.fromValue({
          r: BigInt(vector.signature.r),
          s: BigInt(vector.signature.s),
        });
        const publicKey = PublicKey.fromBase58(vector.publicKeyBase58);
        const body = bodyFromWire(vector);

        expect(signature.verify(publicKey, [body.hash()]).toBoolean()).toBe(
          true
        );
      });
    });

    it('rejects the signature over a tampered body', () => {
      const vector = fixture.vectors[0];
      const signature = Signature.fromValue({
        r: BigInt(vector.signature.r),
        s: BigInt(vector.signature.s),
      });
      const publicKey = PublicKey.fromBase58(vector.publicKeyBase58);
      const body = bodyFromWire(vector);
      const tampered = new VoteExtBody({
        ...body,
        currentBlockHeight: body.currentBlockHeight.add(1),
      });

      expect(signature.verify(publicKey, [tampered.hash()]).toBoolean()).toBe(
        false
      );
    });
  });

  describe('fromWire input validation mirrors signing.go', () => {
    const wire = (vector: Vector) => ({
      nextValidatorSetHash: Uint8Array.from(
        Buffer.from(vector.wire.nextValidatorSetHashBase64, 'base64')
      ),
      currentStateRoot: Uint8Array.from(
        Buffer.from(vector.wire.appHashBase64, 'base64')
      ),
      currentBlockHeight: BigInt(vector.wire.currentBlockHeight),
      actionsReducedRoot: Uint8Array.from(
        Buffer.from(vector.wire.actionsReducedRootBase64, 'base64')
      ),
    });

    it('rejects an app hash that is not 32 bytes', () => {
      const malformed = wire(fixture.vectors[0]);
      malformed.currentStateRoot = malformed.currentStateRoot.slice(0, 31);
      expect(() => VoteExtBody.fromWire(malformed)).toThrow('32 bytes');
    });

    it('rejects a negative block height', () => {
      const malformed = wire(fixture.vectors[0]);
      malformed.currentBlockHeight = -1n;
      expect(() => VoteExtBody.fromWire(malformed)).toThrow('int64');
    });

    it('rejects non-canonical root bytes (>= p), like field.FromBytes', () => {
      const malformed = wire(fixture.vectors[0]);
      malformed.actionsReducedRoot = new Uint8Array(32).fill(0xff);
      expect(() => VoteExtBody.fromWire(malformed)).toThrow('field modulus');
    });
  });
});
