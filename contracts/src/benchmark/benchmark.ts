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
} from 'o1js';
import { analyzeMethods, enableLogs, log } from '../utils/loggers.js';
import {
  ActionStackProgram,
  ENDPOINTS,
  GenerateSettlementPublicInput,
  GenerateValidateReduceProof,
  List,
  MapFromArray,
  MultisigVerifierProgram,
  PrepareBatch,
  SettlementContract,
  SettlementProof,
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
import {
  GenerateReducerSignatureList,
  GenerateSignaturePubKeyList,
} from '../utils/testUtils.js';
import { performance } from 'node:perf_hooks';

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
  log('benching: ', label);
  const t0 = performance.now();
  const out = await fn();
  bucket.values.push(performance.now() - t0);
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
let MINA_EXPLORER: string;
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
    const [, publicKey] = activeSet[i];
    merkleList.push(Poseidon.hash(publicKey.toFields()));
  }

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
    MINA_EXPLORER = ENDPOINTS.EXPLORER.devnet;
  } else if (testEnvironment === 'lightnet') {
    MINA_NODE_ENDPOINT = ENDPOINTS.NODE.lightnet;
    MINA_ARCHIVE_ENDPOINT = ENDPOINTS.ARCHIVE.lightnet;
    MINA_EXPLORER = ENDPOINTS.EXPLORER.lightnet;
  } else {
    MINA_NODE_ENDPOINT = ENDPOINTS.NODE.mainnet;
    MINA_ARCHIVE_ENDPOINT = ENDPOINTS.ARCHIVE.mainnet;
    MINA_EXPLORER = ENDPOINTS.EXPLORER.mainnet;
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

async function settlementProofBenchmark(
  initialBlockHeight: number,
  newBlockHeight: number,
  initialStateRoot: number = initialBlockHeight,
  newStateRoot: number = newBlockHeight
) {
  const settlementPublicInputs: SettlementPublicInputs[] = [];
  let proofs: SettlementProof[] = [];

  log(activeSet[0][1].toBase58());
  for (let i = initialBlockHeight; i < newBlockHeight; i++) {
    const publicInput = GenerateSettlementPublicInput(
      merkleList.hash,
      Field.from(
        i == initialBlockHeight
          ? initialStateRoot
          : settlementPublicInputs[i - initialBlockHeight - 1].NewStateRoot
      ),
      Field.from(i),
      merkleList.hash,
      Field.from(i == newBlockHeight - 1 ? newStateRoot : Field.random()),
      Field.from(i + 1),
      [validatorSet[0][1]]
    );
    settlementPublicInputs.push(publicInput);

    const privateInput = GenerateSignaturePubKeyList(
      publicInput.hash().toFields(),
      validatorSet
    );

    const proof = (
      await bench('MultisigVerifier verifySignatures', () =>
        MultisigVerifierProgram.verifySignatures(
          publicInput,
          privateInput,
          validatorSet[0][1]
        )
      )
    ).proof;

    proofs.push(proof);
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
      ProofGeneratorsList:
        mergedProof.publicInput.ProofGeneratorsList.appendList(
          Field(i),
          proof.publicInput.ProofGeneratorsList
        ),
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
      await zkapp.deposit(amount);
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
  const signatureList = GenerateReducerSignatureList(publicInput, validatorSet);

  const proof = await bench('Generate ValidateReduce proof', () =>
    GenerateValidateReduceProof(publicInput, signatureList)
  );

  return {
    validateReduceProof: proof,
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

async function settleDepositWithdraw(
  settlementRound: number,
  depositRound: number,
  withdrawRound: number
) {
  for (let i = 0; i < settlementRound; i++) {
    const settlementProof = await bench(
      'Generate and merge 16 Settlement Proofs',
      () =>
        settlementProofBenchmark(
          Number(zkapp.blockHeight.get().toString()),
          Number(zkapp.blockHeight.get().toString()) + 16,
          Number(zkapp.stateRoot.get().toString()),
          Number(zkapp.stateRoot.get().toString()) + 16
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

await main();
printTable();
await exportJSON();
process.exit(0);
