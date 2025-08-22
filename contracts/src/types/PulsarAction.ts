import { Bool, Field, Poseidon, Provable, PublicKey, Struct } from 'o1js';
import { BATCH_SIZE } from '../utils/constants.js';

export { PulsarAction, Batch };

[
  '1',
  '0',
  '0',
  '0',
  '0',
  '1599161376933717509482429054827422356400816166140895701993041518123932732815',
  '6310558633462665370159457076080992493592463962672742685757201873330974620505',
  '6310558633462665370159457076080992493592463962672742685757201873330974620505',
  '0',
  '32',
  '22007313283418838888498787034324580777946548475718234604119834451319224566874',
];

class PulsarAction extends Struct({
  type: Field, // deposit (1), or withdrawal (2)
  account: PublicKey, // only defined for types of deposit and withdrawal
  amount: Field, //only defined for types of deposit and withdrawal
  initialState: Field, // only defined for types of settlement
  newState: Field, // only defined for types of settlement
  initialMerkleListRoot: Field, // only defined for types of settlement
  newMerkleListRoot: Field, // only defined for types of settlement,
  initialBlockHeight: Field, // only defined for types of settlement
  newBlockHeight: Field, // only defined for types of settlement
  rewardListUpdateHash: Field, // only defined for types of settlement and withdrawal
}) {
  static deposit(account: PublicKey, amount: Field) {
    return new this({
      type: Field(1),
      account,
      amount,
      initialState: Field(0),
      newState: Field(0),
      initialMerkleListRoot: Field(0),
      newMerkleListRoot: Field(0),
      initialBlockHeight: Field(0),
      newBlockHeight: Field(0),
      rewardListUpdateHash: Field(0),
    });
  }

  static withdrawal(account: PublicKey, amount: Field) {
    return new this({
      type: Field(2),
      account,
      amount,
      initialState: Field(0),
      newState: Field(0),
      initialMerkleListRoot: Field(0),
      newMerkleListRoot: Field(0),
      initialBlockHeight: Field(0),
      newBlockHeight: Field(0),
      rewardListUpdateHash: Field(0),
    });
  }

  static isDummy(action: PulsarAction): Bool {
    return action.type.equals(Field(0));
  }

  static isDeposit(action: PulsarAction): Bool {
    return action.type.equals(Field(1));
  }

  static isWithdrawal(action: PulsarAction): Bool {
    return action.type.equals(Field(2));
  }

  unconstrainedHash() {
    if (PulsarAction.isDeposit(this).toBoolean()) {
      return Poseidon.hash([
        this.type,
        ...this.account.toFields(),
        this.amount,
      ]);
    } else if (PulsarAction.isWithdrawal(this).toBoolean()) {
      return Poseidon.hash([
        this.type,
        ...this.account.toFields(),
        this.amount,
      ]);
    } else {
      return Field(0);
    }
  }

  static fromRawAction(rawAction: string[]) {
    const [
      type,
      x,
      isOdd,
      amount,
      initialState,
      newState,
      initialMerkleListRoot,
      newMerkleListRoot,
      initialBlockHeight,
      newBlockHeight,
      rewardListUpdateHash,
    ] = rawAction.map(Field);

    return new PulsarAction({
      type,
      account: PublicKey.fromValue({ x, isOdd: Bool.fromFields([isOdd]) }),
      amount,
      initialState,
      newState,
      initialMerkleListRoot,
      newMerkleListRoot,
      initialBlockHeight,
      newBlockHeight,
      rewardListUpdateHash,
    });
  }
  toJSON() {
    return {
      type: this.type.toString(),
      account: this.account.toBase58(),
      amount: this.amount.toString(),
      initialState: this.initialState.toString(),
      newState: this.newState.toString(),
      initialMerkleListRoot: this.initialMerkleListRoot.toString(),
      newMerkleListRoot: this.newMerkleListRoot.toString(),
      initialBlockHeight: this.initialBlockHeight.toString(),
      newBlockHeight: this.newBlockHeight.toString(),
      rewardListUpdateHash: this.rewardListUpdateHash.toString(),
    };
  }
}

class Batch extends Struct({
  actions: Provable.Array(PulsarAction, BATCH_SIZE),
}) {
  static empty() {
    return new this({ actions: Array(BATCH_SIZE).fill(PulsarAction.empty()) });
  }

  static fromArray(actions: PulsarAction[]) {
    if (actions.length > BATCH_SIZE) {
      throw new Error(`Batch can only contain up to ${BATCH_SIZE} actions`);
    }

    const paddedActions = actions.concat(
      Array(BATCH_SIZE - actions.length).fill(PulsarAction.empty())
    );
    return new this({ actions: paddedActions });
  }
}
