import { Bool, Field, Poseidon, Provable, PublicKey, Struct } from 'o1js';
import { VALIDATOR_NUMBER } from './constants';

export { PublicKeyList };

class PublicKeyList extends Struct({
  list: Provable.Array(Field, VALIDATOR_NUMBER),
}) {
  static empty() {
    const list = Array<Field>(VALIDATOR_NUMBER).fill(Field.from(0));
    return new PublicKeyList({ list });
  }

  isEmpty() {
    let empty = Bool(true);
    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      empty = empty.and(this.list[i].equals(Field(0)));
    }
    return empty;
  }

  static fromPubkeyArray(arr: Array<PublicKey>) {
    if (arr.length !== VALIDATOR_NUMBER) {
      throw new Error(
        `Array length must be ${VALIDATOR_NUMBER}, but got ${arr.length}`
      );
    }
    const list = arr.map((pubKey) => {
      return Poseidon.hash(pubKey.toFields());
    });
    return new PublicKeyList({ list });
  }

  static fromFieldArray(arr: Array<Field>) {
    if (arr.length !== VALIDATOR_NUMBER) {
      throw new Error(
        `Array length must be ${VALIDATOR_NUMBER}, but got ${arr.length}`
      );
    }
    return new PublicKeyList({ list: arr });
  }

  insertAt(index: Field, value: Field) {
    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      this.list[i] = Provable.if(index.equals(Field(i)), value, this.list[i]);
    }
    return this;
  }

  getAt(index: Field) {
    let value = Field(0);
    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      value = Provable.if(index.equals(Field(i)), this.list[i], value);
    }
    return value;
  }

  assertEquals(other: PublicKeyList) {
    let equal = Bool(true);
    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      equal = equal.and(this.list[i].equals(other.list[i]));
    }
    equal.assertTrue('Proof generators list mismatch');
  }

  toFields() {
    return this.list.map((field) => field.toFields()).flat();
  }

  hash() {
    return Poseidon.hash(this.toFields());
  }

  appendList(length: Field, other: PublicKeyList) {
    let newList = PublicKeyList.empty();
    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      newList.list[i] = Provable.if(
        Field(i).lessThan(length),
        this.list[i],
        Provable.if(
          Field(i).greaterThanOrEqual(length),
          other.getAt(Field(i).sub(length)),
          Field(0)
        )
      );
    }
    return newList;
  }
}
