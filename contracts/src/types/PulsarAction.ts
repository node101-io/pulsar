import { Bool, Field, Poseidon, PublicKey, Struct } from 'o1js';
import { ProofGenerators } from './proofGenerators';

export class PulsarAction extends Struct({
  type: Field, // settlement (1), deposit (2), or withdrawal (3)
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
  static settlement(
    initialState: Field,
    newState: Field,
    initialMerkleListRoot: Field,
    newMerkleListRoot: Field,
    initialBlockHeight: Field,
    newBlockHeight: Field,
    rewardListUpdate: ProofGenerators
  ) {
    return new this({
      type: Field(1),
      account: PublicKey.empty(),
      amount: Field(0),
      initialState,
      newState,
      initialMerkleListRoot,
      newMerkleListRoot,
      initialBlockHeight,
      newBlockHeight,
      rewardListUpdateHash: Poseidon.hash(rewardListUpdate.toFields()),
    });
  }

  static deposit(account: PublicKey, amount: Field) {
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

  static withdrawal(account: PublicKey, amount: Field) {
    return new this({
      type: Field(3),
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

  static isSettlement(action: PulsarAction): Bool {
    return action.type.equals(Field(1));
  }

  static isDeposit(action: PulsarAction): Bool {
    return action.type.equals(Field(2));
  }

  static isWithdrawal(action: PulsarAction): Bool {
    return action.type.equals(Field(3));
  }

  unconstrainedHash() {
    if (PulsarAction.isSettlement(this).toBoolean()) {
      return Poseidon.hash([
        this.type,
        this.initialState,
        this.newState,
        this.initialMerkleListRoot,
        this.newMerkleListRoot,
        this.initialBlockHeight,
        this.newBlockHeight,
        this.rewardListUpdateHash,
      ]);
    } else if (PulsarAction.isDeposit(this).toBoolean()) {
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
