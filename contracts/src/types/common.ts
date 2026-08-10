import { Bool, Field, MerkleList, Poseidon, Provable, Struct } from 'o1js';
import { BATCH_SIZE } from '../utils/constants.js';

export { List, emptyHash, ApprovalVerdicts, PulsarActionData };

const emptyHash = Poseidon.hash([Field(0)]);
const nextHash = (hash: Field, value: Field) => Poseidon.hash([hash, value]);
class List extends MerkleList.create(Field, nextHash, emptyHash) {}

/**
 * Per-slot chain verdicts for a reduce batch — the approved bit of each v2
 * verdict leaf, in batch order. Renamed from ReduceMask: the mask was the bridge's opinion of what to pay; the verdict is
 * the chain's adjudication, and reduce can only fold the one vector whose
 * leaf chain reaches a quorum-signed actions_reduced_root.
 */
class ApprovalVerdicts extends Struct({
  list: Provable.Array(Bool, BATCH_SIZE),
}) {
  static empty(): ApprovalVerdicts {
    return new ApprovalVerdicts({
      list: new Array(BATCH_SIZE).fill(Bool(false)),
    });
  }

  static fromArray(arr: Array<boolean>): ApprovalVerdicts {
    return new ApprovalVerdicts({
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
