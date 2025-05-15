import { Bool, Field, Poseidon, Provable, PublicKey, Struct } from 'o1js';
import { LIST_LENGTH, TOTAL_GENERATORS } from '../utils/constants';

export { ProofGenerators };

class ProofGenerators extends Struct({
  list: Provable.Array(Field, LIST_LENGTH),
}) {
  static empty() {
    const list = Array<Field>(LIST_LENGTH).fill(Field.from(0));
    return new ProofGenerators({ list });
  }

  isEmpty() {
    let empty = Bool(true);
    for (let i = 0; i < LIST_LENGTH; i++) {
      empty = empty.and(this.list[i].equals(Field(0)));
    }
    return empty;
  }

  /**
   * Creates a ProofGenerators instance from an array of PublicKey. This method meant to be used outside of the provable code.
   * @param arr - An array of PublicKeys. The length of the array must be equal to TOTAL_GENERATORS.
   * @returns A ProofGenerators instance.
   */
  static fromPubkeyArray(arr: Array<PublicKey>) {
    if (arr.length !== TOTAL_GENERATORS) {
      throw new Error(
        `Array length must be ${TOTAL_GENERATORS}, but got ${arr.length}`
      );
    }
    const list = this.empty().list;
    for (let i = 0; i < TOTAL_GENERATORS; i++) {
      list[i] = arr[i].x;
      list[TOTAL_GENERATORS] = list[TOTAL_GENERATORS].add(
        Number(arr[i].isOdd.toField().toBigInt()) * 2 ** i
      );
    }
    return new ProofGenerators({ list });
  }

  insertAt(index: Field, publicKey: PublicKey) {
    let power = Field(1);
    let previousValue = this.list[0];
    for (let i = 0; i < TOTAL_GENERATORS; i++) {
      previousValue = Provable.if(
        index.equals(Field(i)),
        this.list[i],
        previousValue
      );

      this.list[i] = Provable.if(
        index.equals(Field(i)),
        publicKey.x,
        this.list[i]
      );
      power = Provable.if(Field(i).lessThan(index), power.add(power), power);
    }

    previousValue.assertEquals(
      Field(0),
      `ProofGenerators: index already occupied`
    );

    this.list[TOTAL_GENERATORS] = this.list[TOTAL_GENERATORS].add(
      power.mul(publicKey.isOdd.toField())
    );
    return this;
  }

  getXAt(index: Field) {
    let x = Field(0);
    for (let i = 0; i < TOTAL_GENERATORS; i++) {
      x = Provable.if(index.equals(Field(i)), this.list[i], x);
    }
    return x;
  }

  getIsOddAt(index: Field) {
    let isOdd = Bool(false);
    let isOddFields = this.list[TOTAL_GENERATORS].toBits(TOTAL_GENERATORS);
    for (let i = 0; i < TOTAL_GENERATORS; i++) {
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
    for (let i = 0; i < LIST_LENGTH; i++) {
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
    for (let i = 0; i < TOTAL_GENERATORS; i++) {
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

    newList.list[TOTAL_GENERATORS] = this.list[TOTAL_GENERATORS].add(
      power.mul(other.list[TOTAL_GENERATORS])
    );
    return newList;
  }

  toJSON() {
    return {
      list: this.list.map((field) => field.toString()),
    };
  }
}
