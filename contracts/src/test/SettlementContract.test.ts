/* eslint-disable no-unused-vars */
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Poseidon,
  fetchAccount,
  Lightnet,
  VerificationKey,
  UInt64,
} from 'o1js';
import { MultisigVerifierProgram, SettlementProof } from '../SettlementProof';
import { VALIDATOR_NUMBER } from '../utils/constants';
import { SettlementContract } from '../SettlementContract';
import { devnetTestAccounts, validatorSet, testAccounts } from './mock';
import {
  GenerateTestSettlementProof,
  MockReducerVerifierProof,
} from '../utils/testUtils';
import { ValidateReduceProgram } from '../ValidateReduce';
import { List } from '../types/common';
import { ActionStackProgram } from '../ActionStack';
import { PrepareBatch } from '../utils/reduceWitness';
import {
  analyzeMethods,
  enableLogs,
  log,
  logZkappState,
} from '../utils/loggers';

describe('SettlementProof tests', () => {
  const testEnvironment = process.env.TEST_ENV ?? 'local';
  const localTest = testEnvironment === 'local';
  const randomKeys = process.env.RANDOM_KEYS === '1';
  let fee = localTest ? 0 : 1e9;
  let proofsEnabled = false;
  let MINA_NODE_ENDPOINT: string;
  let MINA_ARCHIVE_ENDPOINT: string;
  let MINA_EXPLORER: string;
  let testAccountIndex = 10;

  if (testEnvironment === 'devnet') {
    MINA_NODE_ENDPOINT = 'https://api.minascan.io/node/devnet/v1/graphql';
    MINA_ARCHIVE_ENDPOINT = 'https://api.minascan.io/archive/devnet/v1/graphql';
    MINA_EXPLORER = 'https://minascan.io/devnet/tx/';
  } else if (testEnvironment === 'lightnet') {
    MINA_NODE_ENDPOINT = 'http://127.0.0.1:8080/graphql';
    MINA_ARCHIVE_ENDPOINT = 'http://127.0.0.1:8282';
    MINA_EXPLORER =
      'file:///Users/kadircan/.cache/zkapp-cli/lightnet/explorer/v0.2.2/index.html?target=block&numberOrHash=';
  }

  //keys
  let feePayerKey: PrivateKey;
  let usersKeys: PrivateKey[] = [];

  //public keys
  let feePayerAccount: PublicKey;
  let usersAccounts: PublicKey[] = [];

  //validator variables
  let merkleList: List;
  let activeSet: Array<[PrivateKey, PublicKey]> = [];

  // proofs
  let settlementProof: SettlementProof;

  // action stack
  let actionStack: Array<Field> = [];

  // artifacts
  let MultisigVerifierProgramVK: VerificationKey;
  let ReducerVerifierProgramVK: VerificationKey;

  // ZkApp
  let zkappAddress: PublicKey;
  let zkappPrivateKey: PrivateKey;
  let zkapp: SettlementContract;

  // Local Mina blockchain
  let Local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>;

  async function sendMina(
    senderKey: PrivateKey,
    receiverKey: PublicKey,
    amount: UInt64
  ) {
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        const senderAccount = AccountUpdate.createSigned(
          senderKey.toPublicKey()
        );
        AccountUpdate.fundNewAccount(senderKey.toPublicKey());
        senderAccount.send({ to: receiverKey, amount });
      }
    );

    await waitTransactionAndFetchAccount(tx, [senderKey], [receiverKey]);
  }

  async function waitTransactionAndFetchAccount(
    tx: Awaited<ReturnType<typeof Mina.transaction>>,
    keys: PrivateKey[],
    accountsToFetch?: PublicKey[]
  ) {
    try {
      // log('proving and sending transaction');
      await tx.prove();
      const pendingTransaction = await tx.sign(keys).send();

      // log('waiting for transaction to be included in a block');
      if (!localTest) {
        log(`${MINA_EXPLORER}${pendingTransaction.hash}`);
        const status = await pendingTransaction.safeWait();
        if (status.status === 'rejected') {
          throw new Error(
            'Transaction was rejected: ' +
              JSON.stringify(status.errors, null, 2)
          );
        }

        if (accountsToFetch) {
          await fetchAccounts(accountsToFetch);
        }
      }
    } catch (error) {
      log('error', error);
      throw error;
    }
  }

  async function fetchAccounts(accounts: PublicKey[]) {
    if (localTest) return;
    for (let account of accounts) {
      await fetchAccount({ publicKey: account });
    }
  }

  async function deployZkApp(
    zkapp: SettlementContract,
    deployerKey: PrivateKey,
    zkappPrivateKey: PrivateKey
  ) {
    const deployerAccount = deployerKey.toPublicKey();
    const tx = await Mina.transaction(
      { sender: deployerAccount, fee },
      async () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        await zkapp.deploy();
      }
    );

    await waitTransactionAndFetchAccount(
      tx,
      [deployerKey, zkappPrivateKey],
      [zkappAddress]
    );
  }

  async function initializeContract(
    zkapp: SettlementContract,
    deployerKey: PrivateKey,
    merkleListRoot: Field
  ) {
    const deployerAccount = deployerKey.toPublicKey();

    const initTx = await Mina.transaction(
      { sender: deployerAccount, fee },
      async () => {
        await zkapp.initialize(merkleListRoot);
      }
    );

    await waitTransactionAndFetchAccount(initTx, [deployerKey], [zkappAddress]);
  }

  async function expectInitializeContractToFail(
    zkapp: SettlementContract,
    deployerKey: PrivateKey,
    merkleListRoot: Field,
    expectedMsg?: string
  ) {
    const deployerAccount = deployerKey.toPublicKey();

    try {
      const tx = await Mina.transaction(
        { sender: deployerAccount, fee },
        async () => {
          await zkapp.initialize(merkleListRoot);
        }
      );
      await waitTransactionAndFetchAccount(tx, [deployerKey]);
    } catch (error: any) {
      log(error);
      expect(error.message).toContain(expectedMsg);
      return;
    }
    throw new Error('Contract initialization should have failed');
  }

  async function deployAndInitializeContract(
    zkapp: SettlementContract,
    deployerKey: PrivateKey,
    zkappPrivateKey: PrivateKey,
    merkleListRoot: Field
  ) {
    const deployerAccount = deployerKey.toPublicKey();

    const tx = await Mina.transaction(
      { sender: deployerAccount, fee },
      async () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        await zkapp.deploy();
        await zkapp.initialize(merkleListRoot);
      }
    );

    await waitTransactionAndFetchAccount(
      tx,
      [deployerKey, zkappPrivateKey],
      [zkappAddress, deployerAccount]
    );
  }

  async function prepareNewContract() {
    zkappPrivateKey = randomKeys
      ? PrivateKey.random()
      : testAccounts[testAccountIndex][0];
    testAccountIndex++;
    zkappAddress = zkappPrivateKey.toPublicKey();
    zkapp = new SettlementContract(zkappAddress);

    await deployAndInitializeContract(
      zkapp,
      feePayerKey,
      zkappPrivateKey,
      merkleList.hash
    );
    actionStack = [];
  }

  async function settle(
    senderKey: PrivateKey,
    settlementProof: SettlementProof,
    pushToStack: boolean = true
  ) {
    console.log('senderKey', senderKey.toPublicKey().toBase58());
    await fetchAccounts([zkappAddress]);
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.settle(settlementProof);
      }
    );

    if (pushToStack) {
      actionStack.push(settlementProof.publicInput.actionHash());
    }

    log('settle tx', JSON.parse(tx.toJSON()));

    await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
  }

  async function expectSettleToFail(
    senderKey: PrivateKey,
    settlementProof: SettlementProof,
    expectedMsg?: string
  ) {
    try {
      const tx = await Mina.transaction(
        { sender: senderKey.toPublicKey(), fee },
        async () => {
          await zkapp.settle(settlementProof);
        }
      );
      await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
    } catch (error: any) {
      log(error);
      expect(error.message).toContain(expectedMsg);
      return;
    }
    throw new Error('Settle should have failed');
  }

  async function deposit(
    senderKey: PrivateKey,
    amount: UInt64,
    pushToStack: boolean = true
  ) {
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.deposit(amount);
      }
    );

    if (pushToStack) {
      actionStack.push(
        Poseidon.hash([
          Field(2),
          ...senderKey.toPublicKey().toFields(),
          amount.value,
        ])
      );
    }

    await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
  }

  async function expectDepositToFail(
    senderKey: PrivateKey,
    amount: UInt64,
    expectedMsg?: string
  ) {
    try {
      const tx = await Mina.transaction(
        { sender: senderKey.toPublicKey(), fee },
        async () => {
          await zkapp.deposit(amount);
        }
      );
      await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
    } catch (error: any) {
      log(error);
      expect(error.message).toContain(expectedMsg);
      return;
    }
    throw new Error('Deposit should have failed');
  }

  async function withdraw(
    senderKey: PrivateKey,
    amount: UInt64,
    pushToStack: boolean = true
  ) {
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.withdraw(amount);
      }
    );

    if (pushToStack) {
      actionStack.push(
        Poseidon.hash([
          Field(3),
          ...senderKey.toPublicKey().toFields(),
          amount.value,
        ])
      );
    }

    await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
  }

  async function expectWithdrawToFail(
    senderKey: PrivateKey,
    amount: UInt64,
    expectedMsg?: string
  ) {
    try {
      const tx = await Mina.transaction(
        { sender: senderKey.toPublicKey(), fee },
        async () => {
          await zkapp.withdraw(amount);
        }
      );
      await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
    } catch (error: any) {
      log(error);
      expect(error.message).toContain(expectedMsg);
      return;
    }
    throw new Error('Withdraw should have failed');
  }

  async function reduce(senderKey: PrivateKey) {
    const { batchActions, batch, useActionStack, actionStackProof } =
      await PrepareBatch(zkapp);

    const { validateReduceProof, mask } = await MockReducerVerifierProof(
      zkapp,
      batchActions,
      actionStack,
      activeSet
    );
    log('mask', mask.toJSON());
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.reduce(
          batch!,
          useActionStack!,
          actionStackProof!,
          mask,
          validateReduceProof
        );
      }
    );

    await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
  }

  async function expectReduceToFail(
    senderKey: PrivateKey,
    expectedMsg?: string
  ) {
    try {
      const { batchActions, batch, useActionStack, actionStackProof } =
        await PrepareBatch(zkapp);

      const { validateReduceProof, mask } = await MockReducerVerifierProof(
        zkapp,
        batchActions,
        actionStack,
        activeSet
      );
      log('mask', mask.toJSON());
      const tx = await Mina.transaction(
        { sender: senderKey.toPublicKey(), fee },
        async () => {
          await zkapp.reduce(
            batch!,
            useActionStack!,
            actionStackProof!,
            mask,
            validateReduceProof
          );
        }
      );

      await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
    } catch (error: any) {
      log(error);
      expect(error.message).toContain(expectedMsg);
      return;
    }
    throw new Error('Reduce should have failed');
  }

  async function settleDepositWithdraw(
    settlement: boolean,
    depositRound: number,
    withdrawRound: number
  ) {
    if (settlement) {
      settlementProof = await GenerateTestSettlementProof(activeSet, 0, 16);
      await settle(feePayerKey, settlementProof);
    }
    for (let i = 0; i < depositRound; i++) {
      await deposit(usersKeys[i % 5], UInt64.from((i + 1) * 1e10));
    }
    for (let i = 0; i < withdrawRound; i++) {
      await withdraw(usersKeys[i % 5], UInt64.from((i + 1) * 1e9));
    }
    logZkappState('before', zkapp);
    await reduce(feePayerKey);
    logZkappState('after', zkapp);
  }

  beforeAll(async () => {
    merkleList = List.empty();
    activeSet = validatorSet.slice(0, VALIDATOR_NUMBER);

    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      const [, publicKey] = activeSet[i];
      merkleList.push(Poseidon.hash(publicKey.toFields()));
    }

    if (testEnvironment === 'local') {
      Local = await Mina.LocalBlockchain({ proofsEnabled });
      Mina.setActiveInstance(Local);

      feePayerKey = Local.testAccounts[0].key;
      feePayerAccount = feePayerKey.toPublicKey();

      for (let i = 0; i < 5; i++) {
        let { key } = Local.testAccounts[i + 1];

        if (!randomKeys) {
          await sendMina(
            key,
            testAccounts[testAccountIndex][1],
            UInt64.from(1e11)
          );

          key = testAccounts[testAccountIndex][0];
          testAccountIndex++;
        }

        usersKeys.push(key);
        usersAccounts.push(key.toPublicKey());
      }
    } else if (testEnvironment === 'devnet') {
      // Set up the Mina devnet
      const Network = Mina.Network({
        mina: MINA_NODE_ENDPOINT,
        archive: MINA_ARCHIVE_ENDPOINT,
      });

      Mina.setActiveInstance(Network);

      feePayerKey = devnetTestAccounts[0][0];
      feePayerAccount = devnetTestAccounts[0][1];

      for (let i = 1; i < 5; i++) {
        let [key] = devnetTestAccounts[i];

        if (!randomKeys) {
          await sendMina(
            key,
            testAccounts[testAccountIndex][1],
            UInt64.from(1e11)
          );

          key = testAccounts[testAccountIndex][0];
          testAccountIndex++;
        }

        usersKeys.push(key);
        usersAccounts.push(key.toPublicKey());
      }
    } else if (testEnvironment === 'lightnet') {
      const Network = Mina.Network({
        mina: MINA_NODE_ENDPOINT,
        archive: MINA_ARCHIVE_ENDPOINT,
        lightnetAccountManager: 'http://127.0.0.1:8181',
      });

      Mina.setActiveInstance(Network);
      feePayerKey = (await Lightnet.acquireKeyPair()).privateKey;
      feePayerAccount = feePayerKey.toPublicKey();

      for (let i = 0; i < 5; i++) {
        let { privateKey: key } = await Lightnet.acquireKeyPair();

        if (!randomKeys) {
          await sendMina(
            key,
            testAccounts[testAccountIndex][1],
            UInt64.from(1e11)
          );

          key = testAccounts[testAccountIndex][0];
          testAccountIndex++;
        }

        usersKeys.push(key);
        usersAccounts.push(key.toPublicKey());
      }
    }

    zkappPrivateKey = randomKeys
      ? PrivateKey.random()
      : testAccounts[testAccountIndex][0];
    testAccountIndex++;
    zkappAddress = zkappPrivateKey.toPublicKey();
    zkapp = new SettlementContract(zkappAddress);

    if (process.env.LOGS_ENABLED === '1') {
      enableLogs();
    }

    await analyzeMethods(ValidateReduceProgram.analyzeMethods());
    await analyzeMethods(ActionStackProgram.analyzeMethods());
    await analyzeMethods(MultisigVerifierProgram.analyzeMethods());
    await analyzeMethods(SettlementContract.analyzeMethods());

    MultisigVerifierProgramVK = (
      await MultisigVerifierProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;

    ReducerVerifierProgramVK = (
      await ValidateReduceProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;

    await ActionStackProgram.compile({
      proofsEnabled,
    });

    if (proofsEnabled) {
      await SettlementContract.compile();
    }
  });

  describe.skip('Deploy & Initialize Flow', () => {
    beforeEach(() => {
      log(expect.getState().currentTestName);
    });

    it('Deploy a SettlementContract', async () => {
      await deployZkApp(zkapp, feePayerKey, zkappPrivateKey);
    });

    it('Initialize the contract with a valid MerkleListRoot', async () => {
      await initializeContract(zkapp, feePayerKey, merkleList.hash);

      expect(zkapp.merkleListRoot.get()).toEqual(merkleList.hash);
      expect(zkapp.stateRoot.get()).toEqual(Field(0));
      expect(zkapp.blockHeight.get()).toEqual(Field.from(0));
      expect(zkapp.depositListHash.get()).toEqual(Field(0));
      expect(zkapp.withdrawalListHash.get()).toEqual(Field(0));
      expect(zkapp.rewardListHash.get()).toEqual(Field(0));
    });
  });

  describe.skip('Settlement flow', () => {
    it('Generate a settlement proof', async () => {
      settlementProof = await GenerateTestSettlementProof(activeSet, 0, 16);
    });

    it('Settle method', async () => {
      await settle(feePayerKey, settlementProof);
    });

    it('Reduce actions', async () => {
      await reduce(feePayerKey);
      actionStack = [];
      expect(zkapp.stateRoot.get()).toEqual(
        settlementProof.publicInput.NewStateRoot
      );
      expect(zkapp.blockHeight.get()).toEqual(
        settlementProof.publicInput.NewBlockHeight
      );
      expect(zkapp.merkleListRoot.get()).toEqual(
        settlementProof.publicInput.NewMerkleListRoot
      );
    });
  });

  describe.skip('Deposit flow', () => {
    it('Deposit method', async () => {
      await deposit(feePayerKey, UInt64.from(1e10));
    });
    it('Reduce actions', async () => {
      const depositListHash = zkapp.depositListHash.get();
      await reduce(feePayerKey);

      expect(zkapp.depositListHash.get()).toEqual(
        Poseidon.hash([
          depositListHash,
          ...feePayerAccount.toFields(),
          Field(1e10),
        ])
      );
    });
  });

  describe.skip('Withdraw flow', () => {
    it('Withdraw method', async () => {
      await withdraw(feePayerKey, UInt64.from(1e9));
    });
    it('Reduce actions', async () => {
      const withdrawalListHash = zkapp.withdrawalListHash.get();
      await reduce(feePayerKey);

      expect(zkapp.withdrawalListHash.get()).toEqual(
        Poseidon.hash([
          withdrawalListHash,
          ...feePayerAccount.toFields(),
          Field(1e9),
        ])
      );
    });
  });

  describe.skip('Combined flow', () => {
    it('Generate a settlement proof', async () => {
      settlementProof = await GenerateTestSettlementProof(activeSet, 16, 32);
    });
    it('Settle method', async () => {
      await settle(feePayerKey, settlementProof);
    });
    it('Deposit method', async () => {
      await deposit(feePayerKey, UInt64.from(1e10 + 123));
    });
    it('Withdraw method', async () => {
      await withdraw(feePayerKey, UInt64.from(1e9 + 123));
    });
    it('Reduce actions', async () => {
      const depositListHash = zkapp.depositListHash.get();
      const withdrawalListHash = zkapp.withdrawalListHash.get();
      await reduce(feePayerKey);
      expect(zkapp.stateRoot.get()).toEqual(
        settlementProof.publicInput.NewStateRoot
      );
      expect(zkapp.blockHeight.get()).toEqual(
        settlementProof.publicInput.NewBlockHeight
      );
      expect(zkapp.merkleListRoot.get()).toEqual(
        settlementProof.publicInput.NewMerkleListRoot
      );

      expect(zkapp.depositListHash.get()).toEqual(
        Poseidon.hash([
          depositListHash,
          ...feePayerAccount.toFields(),
          Field(1e10 + 123),
        ])
      );

      expect(zkapp.withdrawalListHash.get()).toEqual(
        Poseidon.hash([
          withdrawalListHash,
          ...feePayerAccount.toFields(),
          Field(1e9 + 123),
        ])
      );
    });
  });

  describe('More transactions to reduce', () => {
    beforeEach(async () => {
      await prepareNewContract();
    });
    it.skip('1 settlement', async () => {
      await settleDepositWithdraw(true, 0, 0);
    });

    it.skip('1 settlement + 1 deposit', async () => {
      await settleDepositWithdraw(true, 1, 0);
    });

    it.skip('1 settlement + 2 deposits', async () => {
      await settleDepositWithdraw(true, 2, 0);
    });

    it.skip('1 settlement + 3 deposits', async () => {
      await settleDepositWithdraw(true, 3, 0);
    });

    it.skip('1 settlement + 1 withdraw', async () => {
      await settleDepositWithdraw(true, 0, 1);
    });

    it.skip('1 settlement + 2 withdraws', async () => {
      await settleDepositWithdraw(true, 0, 2);
    });

    it.skip('1 settlement + 3 withdraws', async () => {
      await settleDepositWithdraw(true, 0, 3);
    });

    it.skip('1 deposit + 1 withdraw', async () => {
      await settleDepositWithdraw(false, 1, 1);
    });

    it.skip('1 deposit + 2 withdraws', async () => {
      await settleDepositWithdraw(false, 1, 2);
    });

    it.skip('2 deposits + 1 withdraw', async () => {
      await settleDepositWithdraw(false, 2, 1);
    });
    it.skip('2 deposits + 2 withdraws', async () => {
      await settleDepositWithdraw(false, 2, 2);
    });

    it.skip('1 settlement + 1 deposit + 1 withdraw', async () => {
      await settleDepositWithdraw(true, 1, 1);
    });
    it.skip('1 settlement + 1 deposit + 2 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 2);
    });
    it.skip('1 settlement + 1 deposit + 3 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 3);
    });

    it.skip('1 settlement + 1 deposit + 4 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 4);
    });

    it.skip('1 settlement + 1 deposit + 5 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 5);
    });

    it.skip('1 settlement + 1 deposit + 6 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 6);
    });

    it.skip('1 settlement + 1 deposit + 7 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 7);
    });

    it.skip('1 settlement + 1 deposit + 8 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 8);
    });

    it('1 settlement + 1 deposit + 9 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 9);
    });

    it.skip('1 settlement + 1 deposit + 10 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 10);
    });

    it.skip('1 settlement + 1 deposit + 11 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 11);
    });

    it.skip('1 settlement + 1 deposit + 12 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 12);
    });
    it.skip('1 settlement + 1 deposit + 13 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 13);
    });

    it.skip('1 settlement + 1 deposit + 14 withdraws', async () => {
      await settleDepositWithdraw(true, 1, 14);
    });
  });
});
