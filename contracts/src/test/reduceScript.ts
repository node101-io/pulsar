import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Poseidon,
  fetchAccount,
  Lightnet,
  UInt64,
} from 'o1js';
import {
  MultisigVerifierProgram,
  SettlementProof,
} from '../SettlementProof.js';
import {
  AGGREGATE_THRESHOLD,
  ENDPOINTS,
  VALIDATOR_NUMBER,
} from '../utils/constants.js';
import { SettlementContract } from '../SettlementContract.js';
import { devnetTestAccounts, validatorSet, testAccounts } from './mock.js';
import { TestUtils } from '../utils/testUtils.js';
import { ValidateReduceProgram } from '../ValidateReduce.js';
import { List } from '../types/common.js';
import { ActionStackProgram } from '../ActionStack.js';
import { MapFromArray, PrepareBatch } from '../utils/reduceWitness.js';
import { analyzeMethods, enableLogs, log } from '../utils/loggers.js';

const testEnvironment = process.env.TEST_ENV ?? 'local';
const localTest = testEnvironment === 'local';
const randomKeys = process.env.RANDOM_KEYS === '1';
let fee = localTest ? 0 : 1e9;
const proofsEnabled = process.env.PROOFS_ENABLED === '1';
let MINA_NODE_ENDPOINT: string;
let MINA_ARCHIVE_ENDPOINT: string;
let MINA_EXPLORER: string;
let testAccountIndex = 10;

if (testEnvironment === 'devnet') {
  MINA_NODE_ENDPOINT = ENDPOINTS.NODE.devnet;
  MINA_ARCHIVE_ENDPOINT = ENDPOINTS.ARCHIVE.devnet;
  MINA_EXPLORER = ENDPOINTS.EXPLORER.devnet;
} else {
  MINA_NODE_ENDPOINT = ENDPOINTS.NODE.lightnet;
  MINA_ARCHIVE_ENDPOINT = ENDPOINTS.ARCHIVE.lightnet;
  MINA_EXPLORER = ENDPOINTS.EXPLORER.lightnet;
}

//keys
let feePayerKey: PrivateKey;
let usersKeys: PrivateKey[] = [];

//public keys
// let feePayerAccount: PublicKey;
let usersAccounts: PublicKey[] = [];

//validator variables
let merkleList: List;
let activeSet: Array<[PrivateKey, PublicKey]> = [];

// proofs
let settlementProof: SettlementProof;

// action stack
let actionStack: Array<Field> = [];

// ZkApp
let zkappAddress: PublicKey;
let zkappPrivateKey: PrivateKey;
let zkapp: SettlementContract;

// Local Mina blockchain
let Local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>;

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
  // feePayerAccount = feePayerKey.toPublicKey();

  for (let i = 0; i < 5; i++) {
    let { key } = Local.testAccounts[i + 1];

    if (!randomKeys) {
      await sendMina(key, testAccounts[testAccountIndex][1], UInt64.from(1e11));

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
  // feePayerAccount = devnetTestAccounts[0][1];

  for (let i = 1; i < 5; i++) {
    let [key] = devnetTestAccounts[i];

    if (!randomKeys) {
      await sendMina(key, testAccounts[testAccountIndex][1], UInt64.from(1e11));

      key = testAccounts[testAccountIndex][0];
      testAccountIndex++;
    }

    usersKeys.push(key);
    usersAccounts.push(key.toPublicKey());
  }
} else {
  const Network = Mina.Network({
    mina: MINA_NODE_ENDPOINT,
    archive: MINA_ARCHIVE_ENDPOINT,
    lightnetAccountManager: 'http://127.0.0.1:8181',
  });

  Mina.setActiveInstance(Network);
  feePayerKey = (await Lightnet.acquireKeyPair()).privateKey;
  // feePayerAccount = feePayerKey.toPublicKey();

  for (let i = 0; i < 5; i++) {
    let { privateKey: key } = await Lightnet.acquireKeyPair();

    if (!randomKeys) {
      await sendMina(key, testAccounts[testAccountIndex][1], UInt64.from(1e11));

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

const validateReduceAnalyze = await ValidateReduceProgram.analyzeMethods();
analyzeMethods(validateReduceAnalyze);

const actionStackAnalyze = await ActionStackProgram.analyzeMethods();
analyzeMethods(actionStackAnalyze);

const multisigVerifierAnalyze = await MultisigVerifierProgram.analyzeMethods();
analyzeMethods(multisigVerifierAnalyze);

const settlementContractAnalyze = await SettlementContract.analyzeMethods();
analyzeMethods(settlementContractAnalyze);

await MultisigVerifierProgram.compile({
  proofsEnabled,
});
log('MultisigVerifierProgram compiled');

await ValidateReduceProgram.compile({
  proofsEnabled,
});
log('ValidateReduceProgram compiled');

await ActionStackProgram.compile({
  proofsEnabled,
});
log('ActionStackProgram compiled');

if (proofsEnabled) {
  await SettlementContract.compile();
  log('SettlementContract compiled');
}

async function sendMina(
  senderKey: PrivateKey,
  receiverKey: PublicKey,
  amount: UInt64
) {
  const tx = await Mina.transaction(
    { sender: senderKey.toPublicKey(), fee },
    async () => {
      const senderAccount = AccountUpdate.createSigned(senderKey.toPublicKey());
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
          'Transaction was rejected: ' + JSON.stringify(status.errors, null, 2)
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
    [zkapp.address, deployerAccount]
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

async function reduce(senderKey: PrivateKey) {
  let map = MapFromArray(actionStack);

  const { batch, useActionStack, actionStackProof, publicInput, mask } =
    await PrepareBatch(map, zkapp);

  const { validateReduceProof } = await TestUtils.MockReducerVerifierProof(
    publicInput,
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

await prepareNewContract();
log('ZkApp deployed and initialized:', zkappAddress.toBase58());

settlementProof = await TestUtils.GenerateTestSettlementProof(
  activeSet,
  0,
  AGGREGATE_THRESHOLD
);
await settle(feePayerKey, settlementProof);
await reduce(feePayerKey);
