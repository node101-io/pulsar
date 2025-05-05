/* eslint-disable no-unused-vars */
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Poseidon,
  UInt64,
  fetchAccount,
  Lightnet,
  VerificationKey,
  Signature,
} from 'o1js';
import {
  List,
  MultisigVerifierProgram,
  SettlementPublicInputs,
  SettlementProof,
  SignaturePublicKeyList,
} from '../SettlementProof';
import { VALIDATOR_NUMBER } from '../utils/constants';
import { ProofGenerators } from '../utils/proofGenerators';
import {
  BatchReducerInstance,
  SettlementContract,
} from '../SettlementContract';
import { devnetTestAccounts } from './mock';

describe('SettlementProof tests', () => {
  const testEnvironment = process.env.TEST_ENV ?? 'local';
  const logsEnabled = process.env.LOGS_ENABLED === '1';
  const localTest = testEnvironment === 'local';
  let fee = localTest ? 0 : 1e9;
  let proofsEnabled = true;
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
  let validators: Array<[PrivateKey, PublicKey]>;
  let merkleList: List;
  let signatures: Array<Signature>;

  // Public inputs & outputs
  let previousSettlementPublicInputs: SettlementPublicInputs;
  let mergePublicInputs: SettlementPublicInputs;
  let afterPublicInputs: SettlementPublicInputs;

  //proofs
  let previousSettlementProof: SettlementProof;
  let afterSettlementProof: SettlementProof;
  let mergeSettlementProof: SettlementProof;

  // artifacts
  let MultisigVerifierProgramVK: VerificationKey;

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

  beforeAll(async () => {
    zkappPrivateKey = PrivateKey.random();
    zkappAddress = zkappPrivateKey.toPublicKey();
    zkapp = new SettlementContract(zkappAddress);

    BatchReducerInstance.setContractInstance(zkapp);

    log(await MultisigVerifierProgram.analyzeMethods());
    log(await SettlementContract.analyzeMethods());

    MultisigVerifierProgramVK = (
      await MultisigVerifierProgram.compile({
        proofsEnabled,
      })
    ).verificationKey;

    await BatchReducerInstance.compile();

    if (proofsEnabled) {
      await SettlementContract.compile();
    }

    validators = [];
    signatures = [];
    merkleList = List.empty();

    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      const privateKey = PrivateKey.random();
      const publicKey = privateKey.toPublicKey();
      validators.push([privateKey, publicKey]);
    }

    validators.sort((a, b) => {
      const aHash = Poseidon.hash(a[1].toFields());
      const bHash = Poseidon.hash(b[1].toFields());
      return aHash.toBigInt() < bHash.toBigInt() ? -1 : 1;
    });

    for (let i = 0; i < VALIDATOR_NUMBER; i++) {
      const [, publicKey] = validators[i];
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
});
