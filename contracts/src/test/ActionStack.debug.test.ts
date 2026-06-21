/**
 * ActionStack Debug & Performance Test Suite
 *
 * PURPOSE:
 *   ACTION_QUEUE_SIZE = 3000 creates an enormous ZkProgram circuit.
 *   In o1js, for-loops inside ZkProgram methods are UNROLLED at compile time —
 *   each iteration becomes permanent constraint rows in the circuit.
 *
 *   Cost estimate:
 *     merkleActionsAdd  = Poseidon.hashWithPrefix  → ~250–300 constraints
 *     Provable.if       → ~50 constraints
 *     per iteration     → ~300–350 constraints
 *     3000 iterations   → ~900,000–1,050,000 constraints per method
 *     Two methods       → ~1.8–2.1M total constraints
 *
 *   This is why bridge-node "hangs": compile() must synthesize the full
 *   circuit before it can prove anything. It is NOT an infinite loop —
 *   just a very long (potentially 5–30 min) synthesis step.
 *
 * WHAT THESE TESTS COVER:
 *   1. Logic correctness  — fast, no ZkProgram overhead
 *   2. Constraint count   — analyzeMethods() reports rows without full compile
 *   3. Compile timing     — measures how long compile() actually takes
 *   4. Prove timing       — measures a single proof (proofsEnabled = false → mock)
 *   5. Scaling check      — demonstrates the constraint growth rate
 */

import { Bool, Field, Provable } from 'o1js';
import {
  ActionStackProgram,
  ActionStackQueue,
} from '../ActionStack.js';
import {
  actionListAdd,
  emptyActionListHash,
  merkleActionsAdd,
} from '../types/actionHelpers.js';
import { ACTION_QUEUE_SIZE } from '../utils/constants.js';
import { TestUtils } from '../utils/testUtils.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function ms(start: number) {
  return `${(performance.now() - start).toFixed(0)} ms`;
}

function computeExpectedRoot(
  initialState: Field,
  actions: ReturnType<typeof TestUtils.GenerateTestActions>
): Field {
  let state = initialState;
  for (const action of actions) {
    state = merkleActionsAdd(state, actionListAdd(emptyActionListHash, action));
  }
  return state;
}

// ─── 1. Logic correctness (no ZkProgram, runs in milliseconds) ───────────────

describe('ActionStack — logic correctness (no circuit)', () => {
  it('ActionStackQueue.fromArray hashes each slot correctly', () => {
    const actions = TestUtils.GenerateTestActions(10);
    const queue = ActionStackQueue.fromArray(actions);

    for (let i = 0; i < actions.length; i++) {
      const expected = actionListAdd(emptyActionListHash, actions[i]);
      expect(queue.stack[i].actionListHash.equals(expected).toBoolean()).toBe(
        true
      );
      expect(queue.stack[i].isDummy.toBoolean()).toBe(false);
    }

    // Remaining slots must be dummy
    for (let i = actions.length; i < ACTION_QUEUE_SIZE; i++) {
      expect(queue.stack[i].isDummy.toBoolean()).toBe(true);
    }
  });

  it('merkleActionsAdd accumulates correctly outside a circuit', () => {
    const actions = TestUtils.GenerateTestActions(50);
    const initial = Field(42);
    const expected = computeExpectedRoot(initial, actions);

    // Manually simulate the proveBase loop (native JS, not in-circuit)
    let state = initial;
    const queue = ActionStackQueue.fromArray(actions);
    for (let i = 0; i < ACTION_QUEUE_SIZE; i++) {
      const slot = queue.stack[i];
      if (!slot.isDummy.toBoolean()) {
        state = merkleActionsAdd(state, slot.actionListHash);
      }
    }

    expect(state.equals(expected).toBoolean()).toBe(true);
  });

  it('ActionStackQueue.empty() fills all slots as dummy', () => {
    const q = ActionStackQueue.empty();
    for (const slot of q.stack) {
      expect(slot.isDummy.toBoolean()).toBe(true);
      expect(slot.actionListHash.equals(Field(0)).toBoolean()).toBe(true);
    }
  });

  it('fromArray rejects oversized input', () => {
    const tooMany = TestUtils.GenerateTestActions(ACTION_QUEUE_SIZE + 1);
    expect(() => ActionStackQueue.fromArray(tooMany)).toThrow(
      `Too many actions, max is ${ACTION_QUEUE_SIZE}`
    );
  });

  it('fromArray with zero actions produces an all-dummy queue', () => {
    const q = ActionStackQueue.fromArray([]);
    expect(q.stack.every((s) => s.isDummy.toBoolean())).toBe(true);
  });

  it('Provable.if skips dummy slots (native simulation)', () => {
    // Simulate proveBase logic natively to confirm dummy-skip behaviour
    const actions = TestUtils.GenerateTestActions(5);
    const queue = ActionStackQueue.fromArray(actions);
    const initial = Field(0);

    let inCircuitState = initial;
    for (let i = 0; i < ACTION_QUEUE_SIZE; i++) {
      const slot = queue.stack[i];
      // Mirror: Provable.if(slot.isDummy, state, merkleActionsAdd(state, hash))
      const updated = merkleActionsAdd(inCircuitState, slot.actionListHash);
      inCircuitState = slot.isDummy.toBoolean() ? inCircuitState : updated;
    }

    const expected = computeExpectedRoot(initial, actions);
    expect(inCircuitState.equals(expected).toBoolean()).toBe(true);
  });
});

// ─── 2. Constraint analysis (slow — synthesises the circuit) ─────────────────

describe('ActionStack — constraint analysis', () => {
  /**
   * analyzeMethods() synthesises the arithmetic circuit and reports row counts.
   * It does NOT generate a proving key; it is faster than compile() but still
   * requires full circuit unrolling (expect 30 s – 5 min for 3 000 iterations).
   *
   * Run with: ANALYZE=1 npx jest ActionStack.debug
   */
  it(
    'reports constraint rows per method',
    async () => {
      if (process.env.ANALYZE !== '1') {
        console.log(
          '[SKIPPED] Set ANALYZE=1 to run constraint analysis (slow).'
        );
        console.log(
          `  Estimated constraints for ACTION_QUEUE_SIZE=${ACTION_QUEUE_SIZE}:`,
          `~${(ACTION_QUEUE_SIZE * 350).toLocaleString()} rows/method`
        );
        return;
      }

      console.log(
        `\nAnalysing ActionStackProgram with ACTION_QUEUE_SIZE=${ACTION_QUEUE_SIZE}…`
      );
      const t = performance.now();
      const analysis = await ActionStackProgram.analyzeMethods();
      console.log(`analyzeMethods() finished in ${ms(t)}`);
      console.log('  proveBase     rows:', analysis.proveBase.rows.toLocaleString());
      console.log('  proveRecursive rows:', analysis.proveRecursive.rows.toLocaleString());
      console.log(
        '  Total rows:',
        (analysis.proveBase.rows + analysis.proveRecursive.rows).toLocaleString()
      );

      // Sanity: constraint count must be > 0
      expect(analysis.proveBase.rows).toBeGreaterThan(0);
      expect(analysis.proveRecursive.rows).toBeGreaterThan(0);
    },
    30 * 60 * 1000 // 30 min timeout — synthesis is slow at queue size 3000
  );
});

// ─── 3. Compile & prove timing (proofsEnabled = false → mock proofs) ─────────

describe('ActionStack — compile & prove timing (mock proofs)', () => {
  /**
   * With proofsEnabled=false the prover is mocked; the circuit is still
   * synthesised during compile(). This is the cheapest "real" path.
   *
   * At ACTION_QUEUE_SIZE=3000 compile() can take many minutes.
   * Set COMPILE=1 to opt in.
   */

  let compiled = false;

  beforeAll(async () => {
    if (process.env.COMPILE !== '1') return;
    console.log(
      `\nCompiling ActionStackProgram (ACTION_QUEUE_SIZE=${ACTION_QUEUE_SIZE})…`
    );
    const t = performance.now();
    await ActionStackProgram.compile({ proofsEnabled: false });
    compiled = true;
    console.log(`compile() finished in ${ms(t)}`);
  }, 60 * 60 * 1000);

  it(
    'proveBase — timing with mock proof',
    async () => {
      if (process.env.COMPILE !== '1') {
        console.log('[SKIPPED] Set COMPILE=1 to run compile + prove timing.');
        return;
      }
      expect(compiled).toBe(true);

      const actions = TestUtils.GenerateTestActions(ACTION_QUEUE_SIZE / 2);
      const queue = ActionStackQueue.fromArray(actions);
      const initial = Field(0);

      const t = performance.now();
      const result = await ActionStackProgram.proveBase(initial, queue);
      console.log(`\nproveBase() with ${actions.length} actions: ${ms(t)}`);

      const expected = computeExpectedRoot(initial, actions);
      expect(result.proof.publicOutput.equals(expected).toBoolean()).toBe(true);
    },
    30 * 60 * 1000
  );

  it(
    'proveRecursive — timing with mock proof',
    async () => {
      if (process.env.COMPILE !== '1') {
        console.log('[SKIPPED] Set COMPILE=1 to run proveRecursive timing.');
        return;
      }
      expect(compiled).toBe(true);

      // Build a base proof first
      const firstActions = TestUtils.GenerateTestActions(ACTION_QUEUE_SIZE);
      const firstQueue = ActionStackQueue.fromArray(firstActions);
      const initial = Field(0);
      const baseResult = await ActionStackProgram.proveBase(initial, firstQueue);

      const secondActions = TestUtils.GenerateTestActions(ACTION_QUEUE_SIZE / 2);
      const secondQueue = ActionStackQueue.fromArray(secondActions);

      // initialActionState for recursive must equal base proof's publicOutput
      const nextInitial = baseResult.proof.publicOutput;

      const t = performance.now();
      const result = await ActionStackProgram.proveRecursive(
        nextInitial,
        baseResult.proof,
        secondQueue
      );
      console.log(`\nproveRecursive() with ${secondActions.length} actions: ${ms(t)}`);

      // publicInput of recursive proof must equal base proof's publicOutput
      result.proof.publicInput.assertEquals(baseResult.proof.publicOutput);
    },
    60 * 60 * 1000
  );
});

// ─── 4. Scaling analysis (demonstrates the constraint growth problem) ─────────

describe('ActionStack — scaling analysis (no circuit)', () => {
  /**
   * This test does NOT invoke the ZkProgram at all.
   * It documents the constraint explosion mathematically so the numbers are
   * visible without needing to wait for synthesis.
   */

  it('reports theoretical constraint cost at current queue size', () => {
    // Each iteration:
    //   Provable.if          → ~50 constraints
    //   merkleActionsAdd (Poseidon.hashWithPrefix) → ~250 constraints
    const CONSTRAINTS_PER_ITER = 300;
    const estimate = ACTION_QUEUE_SIZE * CONSTRAINTS_PER_ITER;

    console.log('\n=== ActionStack scaling analysis ===');
    console.log(`ACTION_QUEUE_SIZE       : ${ACTION_QUEUE_SIZE.toLocaleString()}`);
    console.log(`Estimated constraints/method: ~${estimate.toLocaleString()}`);
    console.log(`Two methods (base+recursive): ~${(2 * estimate).toLocaleString()}`);
    console.log('');
    console.log('Comparison:');
    [60, 100, 250, 500, 1000, 3000].forEach((n) => {
      const c = n * CONSTRAINTS_PER_ITER;
      console.log(`  QUEUE_SIZE=${n.toString().padStart(4)}: ~${c.toLocaleString().padStart(10)} constraints/method`);
    });
    console.log('');
    console.log('Rule of thumb: ~100–300K constraints compile in <30 s.');
    console.log('               ~1M+ constraints can take 5–30 minutes.');
    console.log('               3000 × 300 = 900K — borderline, but risky on');
    console.log('               constrained hardware (bridge node).');

    // This "test" always passes — it is purely informational.
    expect(ACTION_QUEUE_SIZE).toBeGreaterThan(0);
  });

  it('demonstrates chunk-based alternative avoids the large-circuit problem', () => {
    /**
     * Instead of one ZkProgram with 3000 iterations, use recursive proofs
     * where each call processes CHUNK_SIZE actions (e.g. 60–250).
     * The circuit size stays small; recursion handles arbitrary totals.
     *
     * This is exactly what proveRecursive is designed for — but the current
     * ACTION_QUEUE_SIZE of 3000 makes even a single proveBase call too heavy.
     *
     * RECOMMENDATION: Reduce ACTION_QUEUE_SIZE to 60–250 and call
     * proveRecursive multiple times for larger batches.
     */
    const SAFE_CHUNK_SIZE = 60; // matches BATCH_SIZE constant
    const TOTAL_ACTIONS = 3000;
    const CHUNKS_NEEDED = Math.ceil(TOTAL_ACTIONS / SAFE_CHUNK_SIZE);
    const CONSTRAINTS_SAFE = SAFE_CHUNK_SIZE * 300;

    console.log('\n=== Chunk-based alternative ===');
    console.log(`Safe chunk size     : ${SAFE_CHUNK_SIZE} actions`);
    console.log(`Constraints/method  : ~${CONSTRAINTS_SAFE.toLocaleString()} (fast to compile)`);
    console.log(`Total actions       : ${TOTAL_ACTIONS}`);
    console.log(`Recursive calls     : ${CHUNKS_NEEDED}`);
    console.log(`Each call proves    : ${SAFE_CHUNK_SIZE} actions`);

    expect(CHUNKS_NEEDED).toBe(50); // 3000 / 60 = 50 recursive proofs
    expect(CONSTRAINTS_SAFE).toBeLessThan(30_000);
  });
});
