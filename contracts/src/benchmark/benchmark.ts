import {
  Field,
  Mina,
  PrivateKey,
  AccountUpdate,
  PublicKey,
  fetchAccount,
  Poseidon,
  UInt64,
  Lightnet,
  Bool,
} from 'o1js';
import {
  analyzeMethods,
  enableLogs,
  log,
  logParams,
} from '../utils/loggers.js';
import {
  ACTION_QUEUE_SIZE,
  ActionStackProgram,
  Batch,
  BATCH_SIZE,
  CalculateMax,
  ENDPOINTS,
  fetchActions,
  GenerateActionStackProof,
  GenerateSettlementPublicInput,
  GenerateValidateReduceProof,
  List,
  MapFromArray,
  ReduceMask,
  SettlementContract,
  SettlementPublicInputs,
  ValidateReduceProgram,
  ValidateReducePublicInput,
  VALIDATOR_NUMBER,
} from '../index.js';
import {
  devnetTestAccounts,
  testAccounts,
  validatorSet,
} from '../test/mock.js';
import { TestUtils } from '../utils/testUtils.js';
import { performance } from 'node:perf_hooks';
import why from 'why-is-node-running';
import {
  Block,
  BlockList,
  MultisigVerifierProgram,
  SettlementProof,
} from '../SettlementProof.js';
import { GeneratePulsarBlock } from '../utils/generateFunctions.js';
import {
  AGGREGATE_THRESHOLD,
  SETTLEMENT_MATRIX_SIZE,
} from '../utils/constants.js';
import { CosmosSignature, PulsarAuth } from '../types/PulsarAction.js';
import { DeployScripts } from '../scripts/deploy.js';

const { sendMina } = DeployScripts;

interface Sample {
  label: string;
  group: string;
  values: number[];
  get runs(): number;
  get mean(): number;
  get std(): number;
}

const buckets = new Map<string, Sample>();

function getBucket(label: string, group: string): Sample {
  const key = `${group}\u241F${label}`;
  let sample = buckets.get(key);
  if (!sample) {
    sample = {
      label,
      group,
      values: [],
      get runs() {
        return this.values.length;
      },
      get mean() {
        return this.values.reduce((s, x) => s + x, 0) / this.runs;
      },
      get std() {
        const m = this.mean;
        return Math.sqrt(
          this.values.reduce((s, x) => s + (x - m) ** 2, 0) /
            (this.runs - 1 || 1)
        );
      },
    };
    buckets.set(key, sample);
  }
  return sample;
}

async function bench<T>(
  label: string,
  fn: () => Promise<T> | T,
  opts: { group?: string } = {}
): Promise<T> {
  const group = opts.group ?? label.split(' ')[0];
  const bucket = getBucket(label, group);
  // logMem(`Memo: ${label}`);
  log('benching: ', label);

  let whyTimer: NodeJS.Timeout | undefined = undefined;

  whyTimer = setTimeout(() => {
    why();
  }, 300_000);

  const t0 = performance.now();
  let out;
  try {
    out = await fn();
  } finally {
    if (whyTimer) clearTimeout(whyTimer);
  }
  bucket.values.push(performance.now() - t0);

  log(
    `bench: ${label} took ${bucket.values[bucket.values.length - 1].toFixed(
      2
    )} ms`
  );

  return out;
}

function printTable() {
  console.table(
    Array.from(buckets.values()).map((b) => ({
      label: b.label,
      runs: b.runs,
      mean_ms: b.mean.toFixed(2),
      std_ms: b.std.toFixed(2),
    }))
  );
}

async function exportJSON(path = 'logs/bench.json') {
  const fs = await import('node:fs/promises');
  await fs.writeFile(
    path,
    JSON.stringify(
      Array.from(buckets.values()).map((b) => ({
        label: b.label,
        group: b.group,
        runs: b.runs,
        mean: b.mean,
        std: b.std,
        values: b.values,
      })),
      null,
      2
    )
  );
}

const logsEnabled = process.env.LOGS_ENABLED === '1';
const testEnvironment = process.env.TEST_ENV ?? 'local';
const localTest = testEnvironment === 'local';
const proofsEnabled = process.env.PROOFS_ENABLED === '1';
let fee = localTest ? 0 : 1e9;
let merkleList: List;
let activeSet: Array<[PrivateKey, PublicKey]> = [];
let zkappAddress: PublicKey;
let zkappPrivateKey: PrivateKey;
let zkapp: SettlementContract;
let Local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>;
let feePayerKey: PrivateKey;
let usersKeys: PrivateKey[] = [];
let testAccountIndex = 10;
let usersAccounts: PublicKey[] = [];
let MINA_NODE_ENDPOINT: string;
let MINA_ARCHIVE_ENDPOINT: string;
let actionStack: Array<Field> = [];

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
      log('Hash: ', pendingTransaction.hash);
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

async function deployAndInitializeContract() {
  zkappPrivateKey = PrivateKey.random();
  zkappAddress = zkappPrivateKey.toPublicKey();
  zkapp = new SettlementContract(zkappAddress);

  const deployerAccount = feePayerKey.toPublicKey();

  const tx = await bench('Deploy and initialize contract', () =>
    Mina.transaction({ sender: deployerAccount, fee }, async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await zkapp.deploy();
      await zkapp.initialize(merkleList.hash);
    })
  );

  await waitTransactionAndFetchAccount(
    tx,
    [feePayerKey, zkappPrivateKey],
    [zkapp.address, deployerAccount]
  );
}

async function main() {
  if (logsEnabled) {
    enableLogs();
  }

  merkleList = List.empty();
  activeSet = validatorSet.slice(0, VALIDATOR_NUMBER);

  for (let i = 0; i < VALIDATOR_NUMBER; i++) {
    const [, publicKey] = activeSet[i % 60];
    merkleList.push(Poseidon.hash(publicKey.toFields()));
  }

  logParams();

  const validateReduceAnalyze = await ValidateReduceProgram.analyzeMethods();
  analyzeMethods(validateReduceAnalyze);

  const actionStackAnalyze = await ActionStackProgram.analyzeMethods();
  analyzeMethods(actionStackAnalyze);

  const multisigVerifierAnalyze =
    await MultisigVerifierProgram.analyzeMethods();
  analyzeMethods(multisigVerifierAnalyze);

  const settlementContractAnalyze = await SettlementContract.analyzeMethods();
  analyzeMethods(settlementContractAnalyze);

  await bench('ValidateReduce compile', () =>
    ValidateReduceProgram.compile({
      forceRecompile: proofsEnabled && true,
      proofsEnabled,
    })
  );
  await bench('ActionStack compile', () =>
    ActionStackProgram.compile({
      forceRecompile: proofsEnabled && true,
      proofsEnabled,
    })
  );

  await bench('MultisigVerifier compile', () =>
    MultisigVerifierProgram.compile({
      forceRecompile: proofsEnabled && true,
      proofsEnabled,
    })
  );
  if (proofsEnabled) {
    await bench('SettlementContract compile', () =>
      SettlementContract.compile({ forceRecompile: proofsEnabled && true })
    );
  }

  if (testEnvironment === 'devnet') {
    MINA_NODE_ENDPOINT = ENDPOINTS.NODE.devnet;
    MINA_ARCHIVE_ENDPOINT = ENDPOINTS.ARCHIVE.devnet;
  } else if (testEnvironment === 'lightnet') {
    MINA_NODE_ENDPOINT = ENDPOINTS.NODE.lightnet;
    MINA_ARCHIVE_ENDPOINT = ENDPOINTS.ARCHIVE.lightnet;
  } else {
    MINA_NODE_ENDPOINT = ENDPOINTS.NODE.mainnet;
    MINA_ARCHIVE_ENDPOINT = ENDPOINTS.ARCHIVE.mainnet;
  }

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

    for (let i = 0; i < 5; i++) {
      let { key } = Local.testAccounts[i + 1];

      await sendMina(key, testAccounts[testAccountIndex][1], UInt64.from(1e11));

      key = testAccounts[testAccountIndex][0];
      testAccountIndex++;

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

    for (let i = 1; i < 5; i++) {
      let [key] = devnetTestAccounts[i];

      await sendMina(key, testAccounts[testAccountIndex][1], UInt64.from(1e11));

      key = testAccounts[testAccountIndex][0];
      testAccountIndex++;

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

    for (let i = 0; i < 5; i++) {
      let { privateKey: key } = await Lightnet.acquireKeyPair();

      await sendMina(key, testAccounts[testAccountIndex][1], UInt64.from(1e11));

      key = testAccounts[testAccountIndex][0];
      testAccountIndex++;

      usersKeys.push(key);
      usersAccounts.push(key.toPublicKey());
    }
  }

  await bench('Deploy and initialize contract', () =>
    deployAndInitializeContract()
  );

  await settleDepositWithdraw(1, 1, 1);
  await settleDepositWithdraw(1, 5, 5);
  await settleDepositWithdraw(1, BATCH_SIZE, BATCH_SIZE);
  await settleDepositWithdraw(1, BATCH_SIZE * 2, BATCH_SIZE * 2);

  await BenchActionStackProgram(ACTION_QUEUE_SIZE);
  await BenchActionStackProgram(ACTION_QUEUE_SIZE * 2);
  await BenchActionStackProgram(ACTION_QUEUE_SIZE * 4);
}

async function settlementProofBenchmark(
  initialBlockHeight: number,
  newBlockHeight: number,
  initialStateRoot: number = initialBlockHeight,
  newStateRoot: number = newBlockHeight
) {
  let proofs: SettlementProof[] = [];

  let blocks: Block[] = [];
  let index = 1;
  for (let i = initialBlockHeight; i < newBlockHeight; i++, index++) {
    const block = GeneratePulsarBlock(
      merkleList.hash,
      Field.from(
        i == initialBlockHeight
          ? initialStateRoot
          : blocks[i - initialBlockHeight - 1].NewStateRoot
      ),
      Field.from(i),
      merkleList.hash,
      Field.from(i == newBlockHeight - 1 ? newStateRoot : Field.random()),
      Field.from(i + 1)
    );
    blocks.push(block);

    if (index % SETTLEMENT_MATRIX_SIZE === 0) {
      const publicInput = GenerateSettlementPublicInput(
        merkleList.hash,
        blocks[blocks.length - SETTLEMENT_MATRIX_SIZE].InitialStateRoot,
        blocks[blocks.length - SETTLEMENT_MATRIX_SIZE].InitialBlockHeight,
        blocks[blocks.length - 1].NewMerkleListRoot,
        blocks[blocks.length - 1].NewStateRoot,
        blocks[blocks.length - 1].NewBlockHeight
      );

      const signatureMatrix = TestUtils.GenerateSignaturePubKeyMatrix(
        blocks.slice(-SETTLEMENT_MATRIX_SIZE),
        Array.from({ length: SETTLEMENT_MATRIX_SIZE }, () => validatorSet)
      );

      const proof = (
        await MultisigVerifierProgram.verifySignatures(
          publicInput,
          signatureMatrix,
          BlockList.fromArray(blocks.slice(-SETTLEMENT_MATRIX_SIZE))
        )
      ).proof;

      proofs.push(proof);
    }
  }

  proofs.sort((a, b) =>
    Number(
      a.publicInput.NewBlockHeight.toBigInt() -
        b.publicInput.NewBlockHeight.toBigInt()
    )
  );
  let mergedProof = proofs[0];
  for (let i = 1; i < proofs.length; i++) {
    const proof = proofs[i];
    const publicInput = new SettlementPublicInputs({
      InitialMerkleListRoot: mergedProof.publicInput.InitialMerkleListRoot,
      InitialStateRoot: mergedProof.publicInput.InitialStateRoot,
      InitialBlockHeight: mergedProof.publicInput.InitialBlockHeight,
      NewBlockHeight: proof.publicInput.NewBlockHeight,
      NewMerkleListRoot: proof.publicInput.NewMerkleListRoot,
      NewStateRoot: proof.publicInput.NewStateRoot,
    });

    mergedProof = (
      await bench('Merge proofs', () =>
        MultisigVerifierProgram.mergeProofs(publicInput, mergedProof, proof)
      )
    ).proof;
  }

  return mergedProof;
}

async function settle(
  senderKey: PrivateKey,
  settlementProof: SettlementProof,
  pushToStack: boolean = true
) {
  await fetchAccounts([zkappAddress]);
  const tx = await bench('Settle transaction', () =>
    Mina.transaction({ sender: senderKey.toPublicKey(), fee }, async () => {
      await zkapp.settle(settlementProof);
    })
  );

  if (pushToStack) {
    actionStack.push(settlementProof.publicInput.actionHash());
  }

  await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
}

async function deposit(
  senderKey: PrivateKey,
  amount: UInt64,
  pushToStack: boolean = true
) {
  await fetchAccounts([senderKey.toPublicKey()]);
  const tx = await bench('Deposit transaction', () =>
    Mina.transaction({ sender: senderKey.toPublicKey(), fee }, async () => {
      await zkapp.deposit(
        amount,
        PulsarAuth.from(Field(0), CosmosSignature.empty())
      );
    })
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

async function withdraw(
  senderKey: PrivateKey,
  amount: UInt64,
  pushToStack: boolean = true
) {
  await fetchAccounts([senderKey.toPublicKey()]);

  const tx = await bench('Withdraw transaction', () =>
    Mina.transaction({ sender: senderKey.toPublicKey(), fee }, async () => {
      await zkapp.withdraw(amount);
    })
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

async function MockReducerVerifierProof(
  publicInput: ValidateReducePublicInput,
  validatorSet: Array<[PrivateKey, PublicKey]>
) {
  const signatureList = TestUtils.GenerateReducerSignatureList(
    publicInput,
    validatorSet
  );

  const proof = await bench('Generate ValidateReduce proof', () =>
    GenerateValidateReduceProof(publicInput, signatureList)
  );

  return {
    validateReduceProof: proof,
  };
}

async function PrepareBatch(
  includedActions: Map<string, number>,
  contractInstance: SettlementContract
) {
  const packedActions = await fetchActions(
    contractInstance.address,
    contractInstance.actionState.get()
  );

  if (packedActions.length === 0) {
    return {
      endActionState: 0n,
      batchActions: [],
      batch: Batch.empty(),
      useActionStack: Bool(false),
      actionStackProof: undefined,
      publicInput: ValidateReducePublicInput.default,
      mask: ReduceMask.empty(),
    };
  }

  const { endActionState, batchActions, publicInput, mask } = CalculateMax(
    includedActions,
    contractInstance,
    packedActions
  );

  let actionStack = packedActions
    .slice(batchActions.length)
    .map((pack) => pack.action);

  const batch = Batch.fromArray(batchActions);

  const { useActionStack, actionStackProof } = await bench(
    'Generate Action Stack Proof',
    () => GenerateActionStackProof(Field.from(endActionState), actionStack)
  );

  return {
    batchActions,
    batch,
    useActionStack,
    actionStackProof,
    publicInput,
    mask,
  };
}

async function reduce(senderKey: PrivateKey) {
  let map = MapFromArray(actionStack);

  const { batch, useActionStack, actionStackProof, publicInput, mask } =
    await bench('Prepare batch and action stack proof', () =>
      PrepareBatch(map, zkapp)
    );

  const { validateReduceProof } = await MockReducerVerifierProof(
    publicInput,
    activeSet
  );

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

async function settleDepositWithdraw(
  settlementRound: number,
  depositRound: number,
  withdrawRound: number
) {
  for (let i = 0; i < settlementRound; i++) {
    const settlementProof = await bench(
      'Generate and merge AGGREGATE_THRESHOLD Settlement Proofs',
      () =>
        settlementProofBenchmark(
          Number(zkapp.blockHeight.get().toString()),
          Number(zkapp.blockHeight.get().toString()) + AGGREGATE_THRESHOLD,
          Number(zkapp.stateRoot.get().toString()),
          Number(zkapp.stateRoot.get().toString()) + AGGREGATE_THRESHOLD
        )
    );
    await settle(feePayerKey, settlementProof);
  }
  for (let i = 0; i < depositRound; i++) {
    await deposit(usersKeys[i % 5], UInt64.from(1e9 + i));
  }
  for (let i = 0; i < withdrawRound; i++) {
    await withdraw(usersKeys[i % 5], UInt64.from(1e9 - i));
  }
  await reduce(feePayerKey);
}

async function BenchActionStackProgram(numActions: number) {
  const actions = TestUtils.GenerateTestActions(numActions);
  await bench('Generate Action Stack Proof', () =>
    GenerateActionStackProof(Field.from(0), actions)
  );
}

const watchdog = setTimeout(() => {
  why();

  setTimeout(() => process.exit(1), 5000);
}, 1200000);

await main();
clearTimeout(watchdog);

printTable();
await exportJSON();

process.exit(0);
