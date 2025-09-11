import { Bool, Field, MerkleList, Poseidon, Provable, Struct } from 'o1js';
import { BATCH_SIZE } from '../utils/constants.js';

export { List, emptyHash, ReduceMask, PulsarActionData };

const emptyHash = Poseidon.hash([Field(0)]);
const nextHash = (hash: Field, value: Field) => Poseidon.hash([hash, value]);
class List extends MerkleList.create(Field, nextHash, emptyHash) {}

class ReduceMask extends Struct({
  list: Provable.Array(Bool, BATCH_SIZE),
}) {
  static empty(): ReduceMask {
    return new ReduceMask({
      list: new Array(BATCH_SIZE).fill(Bool(false)),
    });
  }

  static fromArray(arr: Array<boolean>): ReduceMask {
    return new ReduceMask({
      list: arr.map((item) => Bool(item)),
    });
  }

  toJSON() {
    return this.list.map((item) => item.toBoolean());
  }

  toField(): Field {
    return Field.fromBits(this.list);
  }
}

interface PulsarActionData {
  public_key: string;
  amount: string;
  action_type: string;
  cosmos_address: string;
  cosmos_signature: string;
}
