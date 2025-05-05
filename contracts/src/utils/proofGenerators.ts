import { Bool, Field, Poseidon, Provable, PublicKey, Struct } from 'o1js';
import { AGGREGATE_THRESHOLD } from './constants';

export { ProofGenerators };

class ProofGenerators extends Struct({
  // AGGREGATE_THRESHOLD -> PublicKey x Field
  // 1 -> PublicKey isOdd Field concatenated
  list: Provable.Array(Field, AGGREGATE_THRESHOLD + 1),
}) {
  static empty() {
    const list = Array<Field>(AGGREGATE_THRESHOLD + 1).fill(Field.from(0));
    return new ProofGenerators({ list });
  }

  isEmpty() {
    let empty = Bool(true);
    for (let i = 0; i < AGGREGATE_THRESHOLD + 1; i++) {
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
    const list = this.empty().list;
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
      list[i] = arr[i].x;
      list[AGGREGATE_THRESHOLD] = list[AGGREGATE_THRESHOLD].add(
        Number(arr[i].isOdd.toField().toBigInt()) * 2 ** i
      );
    }
    return new ProofGenerators({ list });
  }

  insertAt(index: Field, publicKey: PublicKey) {
    let power = Field(1);
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
      this.list[i] = Provable.if(
        index.equals(Field(i)),
        publicKey.x,
        this.list[i]
      );
      power = Provable.if(Field(i).lessThan(index), power.add(power), power);
    }
    // Todo first reset
    this.list[AGGREGATE_THRESHOLD] = this.list[AGGREGATE_THRESHOLD].add(
      power.mul(publicKey.isOdd.toField())
    );
    return this;
  }

  getXAt(index: Field) {
    let x = Field(0);
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
      x = Provable.if(index.equals(Field(i)), this.list[i], x);
    }
    return x;
  }

  getIsOddAt(index: Field) {
    let isOdd = Bool(false);
    let isOddFields =
      this.list[AGGREGATE_THRESHOLD].toBits(AGGREGATE_THRESHOLD);
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
      isOdd = Provable.if(index.equals(Field(i)), isOddFields[i], isOdd);
    }
    return isOdd;
  }

  getPublicKeyAt(index: Field) {
    const x = this.getXAt(index);
    const isOdd = this.getIsOddAt(index);
    return PublicKey.fromValue({ x, isOdd });
  }

  assertEquals(other: ProofGenerators) {
    let equal = Bool(true);
    for (let i = 0; i < AGGREGATE_THRESHOLD + 1; i++) {
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
    let power = Field(1);
    for (let i = 0; i < AGGREGATE_THRESHOLD; i++) {
      newList.list[i] = Provable.if(
        Field(i).lessThan(length),
        this.list[i],
        Provable.if(
          Field(i).greaterThanOrEqual(length),
          other.getXAt(Field(i).sub(length)),
          Field(0)
        )
      );
      power = Provable.if(Field(i).lessThan(length), power.add(power), power);
    }

    newList.list[AGGREGATE_THRESHOLD] = this.list[AGGREGATE_THRESHOLD].add(
      power.mul(other.list[AGGREGATE_THRESHOLD])
    );
    return newList;
  }
}
