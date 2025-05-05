import { Bool, Field, PublicKey, Struct } from 'o1js';
import { ProofGenerators } from './proofGenerators';

export class ActionType extends Struct({
  type: Field, // settlement (1), deposit (2), or withdrawal (3)
  account: PublicKey, // only defined for types of deposit and withdrawal
  amount: Field, //only defined for types of deposit and withdrawal
  initialState: Field, // only defined for types of settlement
  newState: Field, // only defined for types of settlement
  initialMerkleListRoot: Field, // only defined for types of settlement
  newMerkleListRoot: Field, // only defined for types of settlement,
  initialBlockHeight: Field, // only defined for types of settlement
  newBlockHeight: Field, // only defined for types of settlement
  rewardListUpdate: ProofGenerators, // only defined for types of settlement and withdrawal
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
      rewardListUpdate,
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
      rewardListUpdate: ProofGenerators.empty(),
    });
  }

  static withdrawal(
    account: PublicKey,
    amount: Field,
    rewardListUpdate: ProofGenerators
  ) {
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
      rewardListUpdate,
    });
  }

  static isSettlement(action: ActionType): Bool {
    return action.type.equals(Field(1));
  }

  static isDeposit(action: ActionType): Bool {
    return action.type.equals(Field(2));
  }

  static isWithdrawal(action: ActionType): Bool {
    return action.type.equals(Field(3));
  }
}
