import { Bool, Field, Poseidon, Provable, PublicKey, Struct } from 'o1js';
import { AGGREGATE_THRESHOLD } from './constants';

export { ProofGenerators };

class ProofGenerators extends Struct({
  list: Provable.Array(Field, AGGREGATE_THRESHOLD),
}) {
  static empty() {
    const list = Array<Field>(AGGREGATE_THRESHOLD).fill(Field.from(0));
    return new ProofGenerators({ list });
  }

  isEmpty() {
    let empty = Bool(true);
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
      empty = empty.and(this.list[i].equals(Field(0)));
    }
    return empty;
  }

  static fromPubkeyArray(arr: Array<PublicKey>) {
    if (arr.length !== AGGREGATE_THRESHOLD) {
      throw new Error(
        `Array length must be ${AGGREGATE_THRESHOLD}, but got ${arr.length}`
      );
    }
    const list = arr.map((pubKey) => {
      return Poseidon.hash(pubKey.toFields());
    });
    return new ProofGenerators({ list });
  }

  static fromFieldArray(arr: Array<Field>) {
    if (arr.length !== AGGREGATE_THRESHOLD) {
      throw new Error(
        `Array length must be ${AGGREGATE_THRESHOLD}, but got ${arr.length}`
      );
    }
    return new ProofGenerators({ list: arr });
  }

  insertAt(index: Field, value: Field) {
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
      this.list[i] = Provable.if(index.equals(Field(i)), value, this.list[i]);
    }
    return this;
  }

  getAt(index: Field) {
    let value = Field(0);
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
      value = Provable.if(index.equals(Field(i)), this.list[i], value);
    }
    return value;
  }

  assertEquals(other: ProofGenerators) {
    let equal = Bool(true);
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
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

  appendList(length: Field, other: ProofGenerators) {
    let newList = ProofGenerators.empty();
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
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
