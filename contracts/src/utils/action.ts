import { Bool, Field, PublicKey, Struct } from 'o1js';
import { ProofGenerators } from './proofGenerators';

export class ActionType extends Struct({
  type: Field, // settlement (0), deposit (1), or withdrawal (2)
  account: PublicKey, // only defined for types of deposit and withdrawal
  amount: Field, //only defined for types of deposit and withdrawal
  initialState: Field, // only defined for types of settlement
  newState: Field, // only defined for types of settlement
  initialMerkleListRoot: Field, // only defined for types of settlement
  newMerkleListRoot: Field, // only defined for types of settlement,
  rewardListUpdate: ProofGenerators, // only defined for types of settlement and withdrawal
}) {
  static settlement(
    initialState: Field,
    newState: Field,
    initialMerkleListRoot: Field,
    newMerkleListRoot: Field,
    rewardListUpdate: ProofGenerators
  ) {
    return new this({
      type: Field(0),
      account: PublicKey.empty(),
      amount: Field(0),
      initialState,
      newState,
      initialMerkleListRoot,
      newMerkleListRoot,
      rewardListUpdate,
    });
  }

  static deposit(account: PublicKey, amount: Field) {
    return new this({
      type: Field(1),
      account,
      amount,
      initialState: Field(0),
      newState: Field(0),
      initialMerkleListRoot: Field(0),
      newMerkleListRoot: Field(0),
      rewardListUpdate: ProofGenerators.empty(),
    });
  }

  static withdrawal(
    account: PublicKey,
    amount: Field,
    rewardListUpdate: ProofGenerators
  ) {
    return new this({
      type: Field(2),
      account,
      amount,
      initialState: Field(0),
      newState: Field(0),
      initialMerkleListRoot: Field(0),
      newMerkleListRoot: Field(0),
      rewardListUpdate,
    });
  }

  static isSettlement(action: ActionType): Bool {
    return action.type.equals(Field(0));
  }

  static isDeposit(action: ActionType): Bool {
    return action.type.equals(Field(1));
  }

  static isWithdrawal(action: ActionType): Bool {
    return action.type.equals(Field(2));
  }
}
