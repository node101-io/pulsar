import { Bool, Field, Poseidon, Provable, PublicKey, Struct } from 'o1js';
import { BATCH_SIZE } from '../utils/constants.js';

export { PulsarAction, Batch, PulsarActionBase, PulsarAuth, CosmosSignature };

class CosmosSignature extends Struct({
  r: Field,
  s: Field,
}) {
  static empty() {
    return new this({ r: Field(0), s: Field(0) });
  }

  static from(r: Field, s: Field) {
    return new this({ r, s });
  }

  toFields() {
    return [this.r, this.s];
  }

  toJSON() {
    return {
      r: this.r.toString(),
      s: this.s.toString(),
    };
  }
}

class PulsarAuth extends Struct({
  cosmosAddress: Field,
  cosmosSignature: CosmosSignature,
}) {
  static empty() {
    return new this({
      cosmosAddress: Field(0),
      cosmosSignature: CosmosSignature.empty(),
    });
  }

  static from(cosmosAddress: Field, cosmosSignature: CosmosSignature) {
    return new this({ cosmosAddress, cosmosSignature });
  }

  toFields() {
    return [this.cosmosAddress, ...this.cosmosSignature.toFields()];
  }

  toJSON() {
    return {
      cosmosAddress: this.cosmosAddress.toString(),
      cosmosSignature: this.cosmosSignature.toJSON(),
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
  static deposit(account: PublicKey, amount: Field, pulsarAuth: PulsarAuth) {
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
    const [type, x, isOdd, amount, cosmosAddress, r, s] = rawAction.map(Field);

    return new PulsarAction({
      type,
      account: PublicKey.fromValue({ x, isOdd: Bool.fromFields([isOdd]) }),
      amount,
      pulsarAuth: new PulsarAuth({
        cosmosAddress,
        cosmosSignature: new CosmosSignature({ r, s }),
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
