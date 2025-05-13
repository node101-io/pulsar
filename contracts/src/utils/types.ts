import {
  Field,
  MerkleList,
  Poseidon,
  Provable,
  PublicKey,
  Signature,
  Struct,
} from 'o1js';
import { VALIDATOR_NUMBER } from './constants';

export { SignaturePublicKey, SignaturePublicKeyList, List, emptyHash };

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
}

const emptyHash = Poseidon.hash([Field(0)]);
const nextHash = (hash: Field, value: Field) => Poseidon.hash([hash, value]);
class List extends MerkleList.create(Field, nextHash, emptyHash) {}
