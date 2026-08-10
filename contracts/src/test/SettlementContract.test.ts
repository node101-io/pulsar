/* eslint-disable no-unused-vars */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  Bool,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  fetchAccount,
  Lightnet,
  Reducer,
  UInt64,
} from 'o1js';
import { MultisigVerifierProgram, SettlementProof } from '../SettlementProof';
import {
  AGGREGATE_THRESHOLD,
  BATCH_SIZE,
  ENDPOINTS,
  MINIMUM_DEPOSIT_AMOUNT,
  VALIDATOR_NUMBER,
  WITHDRAW_DOWN_PAYMENT,
} from '../utils/constants';
import { SettlementContract } from '../SettlementContract';
import { devnetTestAccounts, validatorSet, testAccounts } from './mock';
import { TestUtils } from '../utils/testUtils';
import { List } from '../types/common';
import { ActionStackProgram } from '../ActionStack';
import { ApprovalTailProgram } from '../ApprovalTail';
import { ApprovalQuorumProgram } from '../ApprovalQuorum';
import { GenerateActionStackProof } from '../utils/generateFunctions';
import { fetchActions } from '../utils/fetch';
import {
  foldApprovalCursor,
  hashPulsarActionLeafV2,
} from '../utils/pulsarActionLeaf';
import { enableLogs, log, logZkappState } from '../utils/loggers';
import {
  Batch,
  CosmosSignature,
  PulsarAction,
  PulsarAuth,
} from '../types/PulsarAction';
import { DeployScripts } from '../utils/deployHelpers.js';

const { sendMina } = DeployScripts;

describe('SettlementContract tests', () => {
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
  } else if (testEnvironment === 'lightnet') {
    MINA_NODE_ENDPOINT = ENDPOINTS.NODE.lightnet;
    MINA_ARCHIVE_ENDPOINT = ENDPOINTS.ARCHIVE.lightnet;
    MINA_EXPLORER = ENDPOINTS.EXPLORER.lightnet;
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

  // ZkApp
  let zkappAddress: PublicKey;
  let zkappPrivateKey: PrivateKey;
  let zkapp: SettlementContract;

  // Row counts of the redesign circuits, collected in beforeAll and reported
  // by the 'Circuit rows' test — the benchmark record for this tranche.
  let rows: {
    tailBase: number;
    tailRecursive: number;
    quorum: number;
    reduce: number;
  };

  // Local Mina blockchain
  let Local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>;

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
    zkappPrivateKey: PrivateKey,
    merkleListRoot: Field,
    stateRoot: Field = Field(0),
    blockHeight: Field = Field(0)
  ) {
    const deployerAccount = deployerKey.toPublicKey();
    const tx = await Mina.transaction(
      { sender: deployerAccount, fee },
      async () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        // anchors live in deploy(); the permissionless initialize is gone
        await zkapp.deploy({ merkleListRoot, stateRoot, blockHeight });
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

    await deployZkApp(zkapp, feePayerKey, zkappPrivateKey, merkleList.hash);
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

    log('settle tx', JSON.parse(tx.toJSON()));

    await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
  }

  async function expectSettleToFail(
    senderKey: PrivateKey,
    settlementProof: SettlementProof,
    expectedMsg: string = 'Transaction failed'
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
    await fetchAccounts([senderKey.toPublicKey()]);
    const balanceBefore = Mina.getBalance(senderKey.toPublicKey());
    log(
      `Balance before deposit: ${balanceBefore.toBigInt() / BigInt(1e9)} MINA`
    );
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.deposit(
          amount,
          PulsarAuth.from(Field(0), CosmosSignature.empty()),
        );
      }
    );

    await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);

    const balanceAfter = Mina.getBalance(senderKey.toPublicKey());
    log(`Balance after deposit: ${balanceAfter.toBigInt() / BigInt(1e9)} MINA`);
  }

  async function expectDepositToFail(
    senderKey: PrivateKey,
    amount: UInt64,
    expectedMsg: string = 'Transaction failed'
  ) {
    try {
      const tx = await Mina.transaction(
        { sender: senderKey.toPublicKey(), fee },
        async () => {
          await zkapp.deposit(
            amount,
            PulsarAuth.from(Field(0), CosmosSignature.empty()),
          );
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

  async function withdraw(senderKey: PrivateKey, amount: UInt64) {
    await fetchAccounts([senderKey.toPublicKey()]);
    const balanceBefore = Mina.getBalance(senderKey.toPublicKey());
    log(
      `Balance before withdraw: ${balanceBefore.toBigInt() / BigInt(1e9)} MINA`
    );
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.withdraw(amount);
      }
    );

    await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
    const balanceAfter = Mina.getBalance(senderKey.toPublicKey());
    log(
      `Balance after withdraw: ${balanceAfter.toBigInt() / BigInt(1e9)} MINA`
    );
  }

  async function expectWithdrawToFail(
    senderKey: PrivateKey,
    amount: UInt64,
    expectedMsg: string = 'Transaction failed'
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

  /**
   * Knobs to make the mock chain's signed truth diverge from what the
   * contract folds — each knob exists for one mandatory rejection case of
   * the redesign.
   */
  type ReduceOverrides = {
    /** consume only the first N pending actions (rest go to the action stack) */
    batchCount?: number;
    /** what the CONTRACT folds, per batch slot (default: approve all) */
    verdicts?: boolean[];
    /** what the CHAIN signed (default: same as verdicts) */
    signedVerdicts?: boolean[];
    /** the chain scanned only this many of the batch's actions */
    scannedCount?: number;
  };

  async function buildReduce(overrides: ReduceOverrides = {}) {
    await fetchAccounts([zkappAddress]);
    const cursorBefore = zkapp.approvalCursor.get();
    const packed = await fetchActions(zkapp.address, zkapp.actionState.get());

    const batchCount = Math.min(
      overrides.batchCount ?? packed.length,
      BATCH_SIZE
    );
    const batchActions = packed
      .slice(0, batchCount)
      .map((pack) => pack.action);
    const stackActions = packed.slice(batchCount).map((pack) => pack.action);
    const endActionState =
      batchCount === 0
        ? zkapp.actionState.get()
        : Field(packed[batchCount - 1].hash);

    const { useActionStack, actionStackProof } = await GenerateActionStackProof(
      endActionState,
      stackActions
    );

    const verdicts = overrides.verdicts ?? batchActions.map(() => true);
    // Unless a scan limit is being simulated, the mock chain has scanned the
    // whole queue: unconsumed actions feed the tail as approve-all leaves —
    // exactly the "batch shorter than the signed prefix" geometry.
    const tailLeaves =
      overrides.scannedCount !== undefined
        ? []
        : stackActions.map((action) =>
            hashPulsarActionLeafV2(action, Bool(true))
          );

    const { verdicts: verdictsStruct, approvalProof } =
      await TestUtils.MockApprovalQuorumProof({
        validatorSet: activeSet,
        cursorBefore,
        batchActions,
        verdicts,
        signedVerdicts: overrides.signedVerdicts,
        scannedCount: overrides.scannedCount,
        tailLeaves,
      });

    return {
      cursorBefore,
      batchActions,
      verdicts,
      batch: Batch.fromArray(batchActions),
      useActionStack,
      actionStackProof,
      verdictsStruct,
      approvalProof,
    };
  }

  async function reduce(senderKey: PrivateKey, overrides: ReduceOverrides = {}) {
    const witness = await buildReduce(overrides);
    const tx = await Mina.transaction(
      { sender: senderKey.toPublicKey(), fee },
      async () => {
        await zkapp.reduce(
          witness.batch,
          witness.useActionStack,
          witness.actionStackProof,
          witness.verdictsStruct,
          witness.approvalProof
        );
      }
    );

    await waitTransactionAndFetchAccount(tx, [senderKey], [zkappAddress]);
    return witness;
  }

  async function expectReduceToFail(
    senderKey: PrivateKey,
    overrides: ReduceOverrides = {},
    expectedMsg: string = 'Batch verdict fold must reach the quorum-bound approval cursor'
  ) {
    try {
      await reduce(senderKey, overrides);
    } catch (error: any) {
      log(error);
      expect(error.message).toContain(expectedMsg);
      return;
    }
    throw new Error('Reduce should have failed');
  }

  beforeAll(async () => {
    activeSet = validatorSet.slice(0, VALIDATOR_NUMBER);
    merkleList = TestUtils.CreateValidatorMerkleList(activeSet);

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

    const tailAnalyze = await ApprovalTailProgram.analyzeMethods();
    const quorumAnalyze = await ApprovalQuorumProgram.analyzeMethods();
    const contractAnalyze = await SettlementContract.analyzeMethods();
    rows = {
      tailBase: tailAnalyze.proveBase.rows,
      tailRecursive: tailAnalyze.proveRecursive.rows,
      quorum: quorumAnalyze.verifySignatures.rows,
      reduce: contractAnalyze.reduce.rows,
    };

    await MultisigVerifierProgram.compile({
      proofsEnabled,
    });
    log('MultisigVerifierProgram compiled');

    // ApprovalQuorumProgram verifies ApprovalTailProofs — tail compiles first
    await ApprovalTailProgram.compile({
      proofsEnabled,
    });
    log('ApprovalTailProgram compiled');

    await ApprovalQuorumProgram.compile({
      proofsEnabled,
    });
    log('ApprovalQuorumProgram compiled');

    await ActionStackProgram.compile({
      proofsEnabled,
    });
    log('ActionStackProgram compiled');

    if (proofsEnabled) {
      await SettlementContract.compile();
      log('SettlementContract compiled');
    }
  });

  describe('Circuit rows', () => {
    // The benchmark record for the redesign: its
    // in-circuit cost argument ("designed to be neutral") is measured, not
    // assumed. 65,536 is the per-method row limit.
    it('logs row counts for the redesign circuits and stays within the limit', () => {
      console.log(
        `[rows] ApprovalTailProgram.proveBase=${rows.tailBase} ` +
          `proveRecursive=${rows.tailRecursive}`
      );
      console.log(
        `[rows] ApprovalQuorumProgram.verifySignatures=${rows.quorum}`
      );
      console.log(
        `[rows] SettlementContract.reduce=${rows.reduce} (limit 65536)`
      );

      expect(rows.tailBase).toBeLessThan(65536);
      expect(rows.tailRecursive).toBeLessThan(65536);
      expect(rows.quorum).toBeLessThan(65536);
      expect(rows.reduce).toBeLessThan(65536);
    });

    // benchmark.md is what a retune decision reads (e.g. APPROVAL_TAIL_CHUNK
    // headroom against the 65,536 limit) — a stale record there is worse than
    // none, so the recorded numbers must equal the measured ones.
    it('matches the rows recorded in benchmark.md', () => {
      // jest runs from the contracts package root, like seed.ts reads
      // deploy-result.json
      const benchmark = readFileSync(
        join(process.cwd(), 'src/benchmark/benchmark.md'),
        'utf-8'
      );

      // method names repeat across circuits (proveBase, verifySignatures),
      // so resolve them inside their '### <circuit> ...' section
      const recordedRows = (circuit: string, method: string): number => {
        const section = benchmark
          .split(/^### /m)
          .find((block) => block.startsWith(circuit));
        const match = section?.match(
          new RegExp(`\\|\\s*${method}\\s*\\|\\s*(\\d+)\\s*\\|`)
        );
        if (!match) {
          throw new Error(`benchmark.md records no rows for ${circuit}.${method}`);
        }
        return Number(match[1]);
      };

      expect(recordedRows('ApprovalTailProgram', 'proveBase')).toBe(
        rows.tailBase
      );
      expect(recordedRows('ApprovalTailProgram', 'proveRecursive')).toBe(
        rows.tailRecursive
      );
      expect(recordedRows('ApprovalQuorumProgram', 'verifySignatures')).toBe(
        rows.quorum
      );
      expect(recordedRows('SettlementContract', 'reduce')).toBe(rows.reduce);
    });
  });

  describe('Deploy flow', () => {
    beforeEach(() => {
      log(expect.getState().currentTestName);
    });

    it('Deploys with all five anchors set in deploy()', async () => {
      await deployZkApp(zkapp, feePayerKey, zkappPrivateKey, merkleList.hash);

      expect(zkapp.merkleListRoot.get()).toEqual(merkleList.hash);
      expect(zkapp.stateRoot.get()).toEqual(Field(0));
      expect(zkapp.blockHeight.get()).toEqual(Field.from(0));
      expect(zkapp.actionState.get()).toEqual(Reducer.initialActionState);
      // m = 0 of the cursor invariant: Field(0) is the chain's empty root
      expect(zkapp.approvalCursor.get()).toEqual(Field(0));
    });

    // `settle` requires blockHeight and stateRoot to equal the first proof's
    // Initial* values, so a contract tracking a live chain is deployed from a
    // real anchor block rather than zero. A deploy that silently dropped
    // blockHeight would deploy fine and reject every settlement forever.
    it('Deploy persists a non-zero anchor', async () => {
      const anchorKey = PrivateKey.random();
      const anchorApp = new SettlementContract(anchorKey.toPublicKey());
      const anchorStateRoot = Field(7);
      const anchorBlockHeight = Field(11);

      await deployZkApp(
        anchorApp,
        feePayerKey,
        anchorKey,
        merkleList.hash,
        anchorStateRoot,
        anchorBlockHeight
      );

      expect(anchorApp.merkleListRoot.get()).toEqual(merkleList.hash);
      expect(anchorApp.stateRoot.get()).toEqual(anchorStateRoot);
      expect(anchorApp.blockHeight.get()).toEqual(anchorBlockHeight);
      expect(anchorApp.approvalCursor.get()).toEqual(Field(0));
    });
  });

  describe('Settlement flow', () => {
    beforeEach(() => {
      log(expect.getState().currentTestName);
    });

    it('Invalid merkle list settlement proof & reject settle', async () => {
      const invalidSettlementProof =
        await TestUtils.GenerateTestSettlementProof(
          testAccounts.slice(0, VALIDATOR_NUMBER),
          0,
          AGGREGATE_THRESHOLD
        );
      // settle guards its inputs with requireEquals preconditions, so the
      // rejection surfaces as the raw precondition on state slot 1
      // (merkleListRoot), not a custom message
      await expectSettleToFail(
        feePayerKey,
        invalidSettlementProof,
        '"Account_app_state_precondition_unsatisfied",1'
      );
    });

    it('Invalid block height settlement proof & reject settle', async () => {
      const invalidSettlementProof =
        await TestUtils.GenerateTestSettlementProof(activeSet, 1, 17);
      // initial height matches the anchor, so this fails on the in-circuit
      // NewBlockHeight == InitialBlockHeight + AGGREGATE_THRESHOLD assertion
      await expectSettleToFail(
        feePayerKey,
        invalidSettlementProof,
        'New block height must be equal to initial block height + AGGREGATE_THRESHOLD'
      );
    });

    it('Generate a valid settlement proof & Settle method', async () => {
      settlementProof = await TestUtils.GenerateTestSettlementProof(
        activeSet,
        0,
        AGGREGATE_THRESHOLD
      );
      await settle(feePayerKey, settlementProof);
    });

    it('Reject settlement with invalid proof: wrong state root', async () => {
      const invalidSettlementProof =
        await TestUtils.GenerateTestSettlementProof(
          activeSet,
          AGGREGATE_THRESHOLD,
          AGGREGATE_THRESHOLD * 2,
          40,
          50
        );
      // raw precondition on state slot 2 (stateRoot)
      await expectSettleToFail(
        feePayerKey,
        invalidSettlementProof,
        '"Account_app_state_precondition_unsatisfied",2'
      );
    });

    it('Reject settlement with invalid proof: previous block height', async () => {
      const invalidSettlementProof =
        await TestUtils.GenerateTestSettlementProof(
          activeSet,
          2,
          2 + AGGREGATE_THRESHOLD
        );

      // raw precondition on state slot 3 (blockHeight)
      await expectSettleToFail(
        feePayerKey,
        invalidSettlementProof,
        '"Account_app_state_precondition_unsatisfied",3'
      );
    });
  });

  describe('Dispatch bounds', () => {
    beforeEach(() => {
      log(expect.getState().currentTestName);
    });

    it('Reject deposit with less than minimum amount', async () => {
      await expectDepositToFail(
        feePayerKey,
        UInt64.from(MINIMUM_DEPOSIT_AMOUNT - 123),
        `At least ${Number(MINIMUM_DEPOSIT_AMOUNT / 1e9)} MINA is required`
      );
    });

    // A withdraw(0) reaching the chain scanner is the archive-wrapper stall
    // class the redesign closes — the L1 bound is defence in depth.
    it('Reject withdraw of zero', async () => {
      await expectWithdrawToFail(
        feePayerKey,
        UInt64.zero,
        'Withdrawal amount must be positive'
      );
    });

    // The reduce circuit range-checks amount + WITHDRAW_DOWN_PAYMENT as a
    // UInt64, so an amount near 2^64 would make the queue head unprovable —
    // 2^63 also keeps the amount inside the chain's int64 domain.
    it('Reject withdraw at the 2^63 int64 boundary', async () => {
      await expectWithdrawToFail(
        feePayerKey,
        UInt64.from(2n ** 63n),
        'Withdrawal amount must fit int64'
      );
    });
  });

  describe('Reduce flow', () => {
    beforeEach(() => {
      log(expect.getState().currentTestName);
    });

    it('Deploys a fresh contract for the reduce flow', async () => {
      // self-contained so `-t "Reduce flow"` (the PROOFS_ENABLED=1 target)
      // runs without the other describes
      await prepareNewContract();
      expect(zkapp.approvalCursor.get()).toEqual(Field(0));
    });

    it('Reduces a deposit, advancing both cursors in lockstep', async () => {
      await deposit(feePayerKey, UInt64.from(1e10));

      const witness = await reduce(feePayerKey);
      logZkappState('after deposit reduce', zkapp);

      const expectedAction = PulsarAction.deposit(
        feePayerAccount,
        UInt64.from(1e10).value,
        PulsarAuth.from(Field(0), CosmosSignature.empty())
      );
      expect(zkapp.approvalCursor.get()).toEqual(
        foldApprovalCursor(
          witness.cursorBefore,
          hashPulsarActionLeafV2(expectedAction, Bool(true))
        )
      );
      // both cursors moved by exactly one action: the ALIGNMENT invariant
      expect(zkapp.actionState.get()).toEqual(
        TestUtils.CalculateActionRoot(Reducer.initialActionState, [
          expectedAction,
        ])
      );
    });

    it('Pays an approved withdrawal with its down payment', async () => {
      await withdraw(feePayerKey, UInt64.from(1e9));

      const balanceBefore = Mina.getBalance(feePayerAccount);
      const witness = await reduce(feePayerKey);
      const balanceAfter = Mina.getBalance(feePayerAccount);

      expect(balanceAfter.toBigInt() - balanceBefore.toBigInt()).toBe(
        BigInt(1e9) + BigInt(WITHDRAW_DOWN_PAYMENT)
      );
      expect(zkapp.approvalCursor.get()).toEqual(
        TestUtils.FoldVerdictLeaves(
          witness.cursorBefore,
          witness.batchActions,
          witness.verdicts
        )
      );
    });

    // Mandatory case: an approved action
    // folded as unapproved must fail — the flipped bit changes the leaf and
    // every later fold, so no quorum-signed root is reachable.
    it('Rejects an approved action folded as unapproved', async () => {
      await withdraw(feePayerKey, UInt64.from(1e9));

      await expectReduceToFail(feePayerKey, {
        verdicts: [false],
        signedVerdicts: [true],
      });
    });

    // Mandatory case: the symmetric flip. Folding a chain-rejected action as
    // approved would PAY it — same cursor divergence blocks it.
    it('Rejects an unapproved action folded as approved', async () => {
      // the withdrawal from the previous test is still pending
      await expectReduceToFail(feePayerKey, {
        verdicts: [true],
        signedVerdicts: [false],
      });
    });

    it('Folds the chain-rejected withdrawal unpaid, consuming the action', async () => {
      // still the same pending withdrawal: now BOTH sides agree on verdict 0
      const balanceBefore = Mina.getBalance(feePayerAccount);
      const witness = await reduce(feePayerKey, { verdicts: [false] });
      const balanceAfter = Mina.getBalance(feePayerAccount);

      // unpaid: the WITHDRAW_DOWN_PAYMENT stays with the contract
      expect(balanceAfter.toBigInt()).toBe(balanceBefore.toBigInt());
      expect(zkapp.approvalCursor.get()).toEqual(
        TestUtils.FoldVerdictLeaves(
          witness.cursorBefore,
          witness.batchActions,
          [false]
        )
      );
      // consumed: nothing left pending
      expect(
        await fetchActions(zkapp.address, zkapp.actionState.get())
      ).toHaveLength(0);
    });

    // Mandatory case: a batch shorter than the signed prefix passes — the
    // tail proof absorbs the scanned-but-unconsumed suffix, and the next
    // reduce picks the remainder up. No batch/snapshot alignment required.
    it('Accepts a batch shorter than the signed prefix (tail absorbs)', async () => {
      await deposit(usersKeys[0], UInt64.from(2e9));
      await deposit(usersKeys[1], UInt64.from(3e9));
      await deposit(usersKeys[2], UInt64.from(4e9));

      const witness = await reduce(feePayerKey, { batchCount: 2 });
      expect(witness.batchActions).toHaveLength(2);
      expect(zkapp.approvalCursor.get()).toEqual(
        TestUtils.FoldVerdictLeaves(
          witness.cursorBefore,
          witness.batchActions,
          witness.verdicts
        )
      );

      // the third action stayed queued with its leaf unconsumed
      const witness2 = await reduce(feePayerKey);
      expect(witness2.batchActions).toHaveLength(1);
      expect(
        await fetchActions(zkapp.address, zkapp.actionState.get())
      ).toHaveLength(0);
    });

    // Mandatory case: a batch beyond the chain's scan must fail — the cursor
    // can only advance to a prefix of a signed root, so an unscanned action
    // has no leaf any tail could reach ("no premature consumption").
    it('Rejects a batch beyond the chain scan', async () => {
      await deposit(usersKeys[0], UInt64.from(2e9));
      await deposit(usersKeys[1], UInt64.from(2e9));

      await expectReduceToFail(feePayerKey, { scannedCount: 1 });

      // cleanup: the chain catches up and the same batch reduces fine
      await reduce(feePayerKey);
    });

    // Mandatory case: a duplicate action pair with different verdicts pays
    // exactly one — the two leaves differ only in the approved bit, and the
    // fold pins which position was paid.
    it('Pays exactly one of a duplicate pair with different verdicts', async () => {
      await deposit(usersKeys[3], UInt64.from(5e9));
      await reduce(feePayerKey);

      await withdraw(usersKeys[3], UInt64.from(1e9));
      await withdraw(usersKeys[3], UInt64.from(1e9));

      const balanceBefore = Mina.getBalance(usersAccounts[3]);
      const witness = await reduce(feePayerKey, { verdicts: [true, false] });
      const balanceAfter = Mina.getBalance(usersAccounts[3]);

      expect(witness.batchActions).toHaveLength(2);
      expect(balanceAfter.toBigInt() - balanceBefore.toBigInt()).toBe(
        BigInt(1e9) + BigInt(WITHDRAW_DOWN_PAYMENT)
      );
      expect(zkapp.approvalCursor.get()).toEqual(
        TestUtils.FoldVerdictLeaves(
          witness.cursorBefore,
          witness.batchActions,
          [true, false]
        )
      );
    });

    // Mandatory case: an all-dummy batch is a no-op — dummy slots contribute
    // to neither cursor, and the quorum proof binds the unchanged cursor to
    // the chain's current signed root via the empty-tail identity.
    it('Accepts an all-dummy batch as a no-op', async () => {
      const actionStateBefore = zkapp.actionState.get();
      const cursorBefore = zkapp.approvalCursor.get();

      const witness = await reduce(feePayerKey);
      expect(witness.batchActions).toHaveLength(0);

      expect(zkapp.actionState.get()).toEqual(actionStateBefore);
      expect(zkapp.approvalCursor.get()).toEqual(cursorBefore);
    });
  });
});
