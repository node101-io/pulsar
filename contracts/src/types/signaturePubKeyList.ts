import { Provable, PublicKey, Signature, Struct } from 'o1js';
import {
  SETTLEMENT_MATRIX_SIZE,
  VALIDATOR_NUMBER,
} from '../utils/constants.js';

export { SignaturePublicKey, SignaturePublicKeyList, SignaturePublicKeyMatrix };

class SignaturePublicKey extends Struct({
  signature: Signature,
  publicKey: PublicKey,
}) {}

class SignaturePublicKeyList extends Struct({
  list: Provable.Array(SignaturePublicKey, VALIDATOR_NUMBER),
}) {
  static fromArray(arr: Array<[Signature, PublicKey]>): SignaturePublicKeyList {
    return new SignaturePublicKeyList({
      list: arr.map(
        ([signature, publicKey]) =>
          new SignaturePublicKey({ signature, publicKey })
      ),
    });
  }

  toJSON() {
    return this.list.map((item) => ({
      signature: item.signature.toString(),
      publicKey: item.publicKey.toString(),
    }));
  }
}

class SignaturePublicKeyMatrix extends Struct({
  matrix: Provable.Array(SignaturePublicKeyList, SETTLEMENT_MATRIX_SIZE),
}) {
  static fromArray(
    arr: Array<Array<[Signature, PublicKey]>>
  ): SignaturePublicKeyMatrix {
    return new SignaturePublicKeyMatrix({
      matrix: arr.map((row) => SignaturePublicKeyList.fromArray(row)),
    });
  }

  static fromSignaturePublicKeyLists(
    lists: SignaturePublicKeyList[]
  ): SignaturePublicKeyMatrix {
    if (lists.length !== SETTLEMENT_MATRIX_SIZE) {
      throw new Error(
        `Expected ${SETTLEMENT_MATRIX_SIZE} lists, but got ${lists.length}`
      );
    }
    return new SignaturePublicKeyMatrix({
      matrix: lists,
    });
  }

  toJSON() {
    return this.matrix.map((list) => list.toJSON());
  }
}
