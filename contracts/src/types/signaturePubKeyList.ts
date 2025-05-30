import { Provable, PublicKey, Signature, Struct } from 'o1js';
import { VALIDATOR_NUMBER } from '../utils/constants';

export { SignaturePublicKey, SignaturePublicKeyList };

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
