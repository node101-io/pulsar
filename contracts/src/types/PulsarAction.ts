import { Bool, Field, Poseidon, Provable, PublicKey, Struct } from 'o1js';
import { BATCH_SIZE } from '../utils/constants.js';

export { PulsarAction, Batch, PulsarActionBase, PulsarAuth };

class PulsarAuth extends Struct({
  cosmosAddress: Field,
  cosmosSignature: Provable.Array(Field, 2),
}) {
  static empty() {
    return new this({
      cosmosAddress: Field(0),
      cosmosSignature: [Field(0), Field(0)],
    });
  }

  static from(cosmosAddress: Field, cosmosSignature: Field[]) {
    if (cosmosSignature.length !== 2) {
      throw new Error('Cosmos signature must be an array of 2 Fields');
    }
    return new this({ cosmosAddress, cosmosSignature });
  }

  toFields() {
    return [this.cosmosAddress, ...this.cosmosSignature];
  }

  toJSON() {
    return {
      cosmosAddress: this.cosmosAddress.toString(),
      cosmosSignature: this.cosmosSignature.map((f) => f.toString()),
    };
  }
}

type PulsarActionBase = {
  type: Field; // deposit (1), or withdrawal (2)
  account: PublicKey;
  amount: Field;
  pulsarAuth: PulsarAuth;
};

class PulsarAction extends Struct({
  type: Field,
  account: PublicKey,
  amount: Field,
  pulsarAuth: PulsarAuth,
}) {
  static deposit(
    account: PublicKey,
    amount: Field,
    blockHeight: Field,
    pulsarAuth: PulsarAuth
  ) {
    return new this({
      type: Field(1),
      account,
      amount,
      pulsarAuth,
    });
  }

  static withdrawal(account: PublicKey, amount: Field) {
    return new this({
      type: Field(2),
      account,
      amount,
      pulsarAuth: PulsarAuth.empty(),
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
        ...this.pulsarAuth.toFields(),
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
    const [type, x, isOdd, amount, cosmosAddress, sig1, sig2] =
      rawAction.map(Field);

    return new PulsarAction({
      type,
      account: PublicKey.fromValue({ x, isOdd: Bool.fromFields([isOdd]) }),
      amount,
      pulsarAuth: new PulsarAuth({
        cosmosAddress,
        cosmosSignature: [sig1, sig2],
      }),
    });
  }

  toFields() {
    return [
      this.type,
      ...this.account.toFields(),
      this.amount,
      ...this.pulsarAuth.toFields(),
    ];
  }

  toJSON() {
    return {
      type: this.type.toString(),
      account: this.account.toBase58(),
      amount: this.amount.toString(),
      pulsarAuth: this.pulsarAuth.toJSON(),
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
