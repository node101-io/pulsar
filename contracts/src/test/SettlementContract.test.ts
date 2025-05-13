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
import {
  MultisigVerifierProgram,
  SettlementPublicInputs,
  SettlementProof,
} from '../SettlementProof';
import { VALIDATOR_NUMBER } from '../utils/constants';
import {
  BatchReducerInstance,
  SettlementContract,
} from '../SettlementContract';
import { devnetTestAccounts, validatorSet } from './mock';
import {
  GenerateTestSettlementProof,
  MimicReduce,
  MockReducerVerifierProof,
} from '../utils/testUtils';
import {
  ReducePublicInputs,
  ReduceVerifierProgram,
} from '../ReducerVerifierProof';
import { GenerateReducerVerifierProof } from '../utils/generateFunctions';
import { ProofGenerators } from '../utils/proofGenerators';
import { List } from '../utils/types';
import { WithdrawProgram } from '../Withdraw';

describe('SettlementProof tests', () => {
  const testEnvironment = process.env.TEST_ENV ?? 'local';
  const logsEnabled = process.env.LOGS_ENABLED === '1';
  const localTest = testEnvironment === 'local';
  let fee = localTest ? 0 : 1e9;
  let proofsEnabled = false;
  let MINA_NODE_ENDPOINT: string;
  let MINA_ARCHIVE_ENDPOINT: string;
  let MINA_EXPLORER: string;

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

  //public keys
  let feePayerAccount: PublicKey;

  //validator variables
  let merkleList: List;
  let activeSet: Array<[PrivateKey, PublicKey]> = [];

  // proofs
  let settlementProof: SettlementProof;

  // action stacks
  let settlementActionStack: Array<SettlementPublicInputs> = [];
  let depositActionStack: Array<[PublicKey, UInt64]> = [];
  let withdrawActionStack: Array<[PublicKey, UInt64, ProofGenerators]> = [];

  // artifacts
  let WithdrawProgramVK: VerificationKey;
  let MultisigVerifierProgramVK: VerificationKey;
  let ReducerVerifierProgramVK: VerificationKey;

  // ZkApp
  let zkappAddress: PublicKey;
  let zkappPrivateKey: PrivateKey;
  let zkapp: SettlementContract;

  // Local Mina blockchain
  let Local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>;

  // Helper functions
  function log(...args: any[]) {
    if (logsEnabled) {
      console.log(...args);
    }
  }

  function analyzeMethods(data: any) {
    const tableData = Object.entries(data).map(([methodName, details]) => ({
      method: methodName,
      rows: (details as any).rows,
    }));
    console.table(tableData);
  }

  async function waitTransactionAndFetchAccount(
    tx: Awaited<ReturnType<typeof Mina.transaction>>,
    keys: PrivateKey[],
    accountsToFetch?: PublicKey[]
  ) {
    try {
      log('proving and sending transaction');
      await tx.prove();
      const pendingTransaction = await tx.sign(keys).send();

      log('waiting for transaction to be included in a block');
      if (!localTest) {
        log(`${MINA_EXPLORER}${pendingTransaction.hash}`);
        const status = await pendingTransaction.safeWait();
        if (status.status === 'rejected') {
          log('Transaction rejected', JSON.stringify(status.errors));
          throw new Error(
            'Transaction was rejected: ' + JSON.stringify(status.errors)
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
    throw new Error('Game initialization should have failed');
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

  async function settle(
    senderKey: PrivateKey,
    settlementProof: SettlementProof
  ) {
    await fetchAccounts([zkappAddress]);
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.settle(settlementProof);
      }
    );

    console.log('settle tx', JSON.parse(tx.toJSON()));

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

  async function deposit(senderKey: PrivateKey, amount: UInt64) {
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.deposit(amount);
      }
    );

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

  async function reduce(senderKey: PrivateKey) {
    const batch = await BatchReducerInstance.prepareBatches();

    const reduceResult = await MimicReduce(zkapp);
    const reduceProof = await MockReducerVerifierProof(reduceResult, activeSet);
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.reduce(batch[0].batch, batch[0].proof, reduceProof);
      }
    );

    await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
  }

  // async function expectReduceToFail(
  //   senderKey: PrivateKey,
  //   expectedMsg?: string
  // ) {
  //   try {
  //     const batch = await BatchReducerInstance.prepareBatches();

  //     const tx = await Mina.transaction(
  //       { sender: senderKey.toPublicKey(), fee },
  //       async () => {
  //         await zkapp.reduce(batch[0].batch, batch[0].proof);
  //       }
  //     );
  //     await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
  //   } catch (error: any) {
  //     log(error);
  //     expect(error.message).toContain(expectedMsg);
  //     return;
  //   }
  //   throw new Error('Reduce should have failed');
  // }

  beforeAll(async () => {
    zkappPrivateKey = PrivateKey.random();
    zkappAddress = zkappPrivateKey.toPublicKey();
    zkapp = new SettlementContract(zkappAddress);

    BatchReducerInstance.setContractInstance(zkapp);

    analyzeMethods(await WithdrawProgram.analyzeMethods());
    analyzeMethods(await ReduceVerifierProgram.analyzeMethods());
    analyzeMethods(await MultisigVerifierProgram.analyzeMethods());
    analyzeMethods(await SettlementContract.analyzeMethods());

    WithdrawProgramVK = (
      await WithdrawProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;

    MultisigVerifierProgramVK = (
      await MultisigVerifierProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;

    ReducerVerifierProgramVK = (
      await ReduceVerifierProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;

    await BatchReducerInstance.compile();

    if (proofsEnabled) {
      await SettlementContract.compile();
    }

    merkleList = List.empty();
    activeSet = validatorSet.slice(0, VALIDATOR_NUMBER);

    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      const [, publicKey] = activeSet[i];
      merkleList.push(Poseidon.hash(publicKey.toFields()));
    }

    if (testEnvironment === 'local') {
      // Set up the Mina local blockchain
      Local = await Mina.LocalBlockchain({ proofsEnabled });
      Mina.setActiveInstance(Local);

      feePayerKey = Local.testAccounts[0].key;
      feePayerAccount = feePayerKey.toPublicKey();
    } else if (testEnvironment === 'devnet') {
      // Set up the Mina devnet
      const Network = Mina.Network({
        mina: MINA_NODE_ENDPOINT,
        archive: MINA_ARCHIVE_ENDPOINT,
      });

      Mina.setActiveInstance(Network);

      feePayerKey = devnetTestAccounts[0][0];
      feePayerAccount = devnetTestAccounts[0][1];
    } else if (testEnvironment === 'lightnet') {
      // Set up the Mina lightnet
      const Network = Mina.Network({
        mina: MINA_NODE_ENDPOINT,
        archive: MINA_ARCHIVE_ENDPOINT,
        lightnetAccountManager: 'http://127.0.0.1:8181',
      });

      Mina.setActiveInstance(Network);
      feePayerKey = (await Lightnet.acquireKeyPair()).privateKey;
      feePayerAccount = feePayerKey.toPublicKey();
    }
  });

  describe('Deploy & Initialize Flow', () => {
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

  describe('Settlement flow', () => {
    it('Generate a settlement proof', async () => {
      settlementProof = await GenerateTestSettlementProof(activeSet, 0, 16);
      settlementActionStack.push(settlementProof.publicInput);
    });

    it('Settle method', async () => {
      await settle(feePayerKey, settlementProof);
    });

    it('Reduce actions', async () => {
      settlementActionStack = [];
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
    });
  });

  describe('Deposit flow', () => {
    it('Deposit method', async () => {
      await deposit(feePayerKey, UInt64.from(1e10));
    });
    it('Reduce actions', async () => {
      const depositListHash = zkapp.depositListHash.get();
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
          Field(1e10),
        ])
      );
    });
  });

  describe('Withdraw flow', () => {
    it('Withdraw method', async () => {});
    it('Reduce actions', async () => {});
  });

  describe('Combined flow', () => {
    it('Generate a settlement proof', async () => {
      settlementProof = await GenerateTestSettlementProof(activeSet, 16, 32);
      settlementActionStack.push(settlementProof.publicInput);
    });
    it('Settle method', async () => {
      await settle(feePayerKey, settlementProof);
    });
    it('Deposit method', async () => {
      await deposit(feePayerKey, UInt64.from(1e10 + 123));
    });
    it('Withdraw method', async () => {});
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
    });
  });
});
