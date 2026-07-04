/**
 * Standalone ActionStack proof generation debug script.
 *
 * Compiles ActionStackProgram only (no SettlementContract, no ValidateReduce),
 * then runs multiple scenarios to stress-test proof generation and verify
 * that publicOutput matches CalculateFinalActionState.
 *
 * Usage:
 *   node build/src/scripts/actionstack-debug.js [--proofs] [--cache]
 *
 *   --proofs   Enable real Pickles SNARKs (default: mock mode — witness-only)
 *   --cache    Load step-/wrap- keys from disk (default: skip to force recompile)
 */

import { Field, Cache, PrivateKey, UInt64, verify } from 'o1js';
import { ActionStackProgram, ActionStackQueue } from '../ActionStack.js';
import { CosmosSignature, PulsarAction, PulsarAuth } from '../types/PulsarAction.js';
import { CalculateFinalActionState } from '../utils/actionQueueUtils.js';
import { ACTION_QUEUE_SIZE } from '../utils/constants.js';

const args = process.argv.slice(2);
const PROOFS_ENABLED = args.includes('--proofs');
const USE_CACHE = args.includes('--cache');

function log(msg: string) {
  console.log(`[ActionStack] ${msg}`);
}

function makeActions(count: number): PulsarAction[] {
  const actions: PulsarAction[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 2 === 0) {
      actions.push(
        PulsarAction.deposit(
          PrivateKey.random().toPublicKey(),
          UInt64.from(BigInt(i + 1) * 1_000_000_000n).value,
          PulsarAuth.from(Field(i), CosmosSignature.empty())
        )
      );
    } else {
      actions.push(
        PulsarAction.withdrawal(
          PrivateKey.random().toPublicKey(),
          UInt64.from(BigInt(i + 1) * 500_000_000n).value
        )
      );
    }
  }
  return actions;
}

async function runScenario(label: string, actionCount: number, initialActionState: Field, vk: any) {
  log(`--- ${label} (${actionCount} actions, ACTION_QUEUE_SIZE=${ACTION_QUEUE_SIZE}) ---`);

  const actions = makeActions(actionCount);
  const expectedOutput = CalculateFinalActionState(initialActionState, actions);
  log(`Expected publicOutput: ${expectedOutput.toString().slice(0, 20)}...`);

  const chunks = Math.ceil(actions.length / ACTION_QUEUE_SIZE);
  log(`Chunks needed: ${chunks}`);

  let proof: any;
  const totalStart = Date.now();

  // proveBase — first chunk
  const baseStart = Date.now();
  const baseQueue = ActionStackQueue.fromArray(actions.slice(0, ACTION_QUEUE_SIZE));
  log(`proveBase → chunk 0 (${Math.min(ACTION_QUEUE_SIZE, actions.length)} actions)...`);
  proof = (
    await ActionStackProgram.proveBase(initialActionState, baseQueue)
  ).proof;
  const initialProofPublicInput: Field = proof.publicInput;
  log(`  publicInput:  ${proof.publicInput.toString().slice(0, 20)}...`);
  log(`  publicOutput: ${proof.publicOutput.toString().slice(0, 20)}...`);
  log(`  proveBase done in ${Date.now() - baseStart}ms`);

  // proveRecursive — subsequent chunks
  for (let i = 1; i < chunks; i++) {
    const chunkStart = Date.now();
    const slice = actions.slice(i * ACTION_QUEUE_SIZE, (i + 1) * ACTION_QUEUE_SIZE);
    log(`proveRecursive → chunk ${i} (${slice.length} actions)...`);
    const recQueue = ActionStackQueue.fromArray(slice);
    proof = (
      await ActionStackProgram.proveRecursive(proof.publicOutput, proof, recQueue)
    ).proof;
    log(`  publicInput:  ${proof.publicInput.toString().slice(0, 20)}...`);
    log(`  publicOutput: ${proof.publicOutput.toString().slice(0, 20)}...`);
    log(`  proveRecursive chunk ${i} done in ${Date.now() - chunkStart}ms`);
  }

  const totalMs = Date.now() - totalStart;

  // Verify output matches expected
  const outputMatch = proof.publicOutput.equals(expectedOutput).toBoolean();
  log(`publicOutput matches CalculateFinalActionState: ${outputMatch ? 'YES ✓' : 'NO ✗'}`);

  if (!outputMatch) {
    log(`  got:      ${proof.publicOutput.toString()}`);
    log(`  expected: ${expectedOutput.toString()}`);
    throw new Error(`${label}: publicOutput mismatch!`);
  }

  // Verify first proof's publicInput == initialActionState
  // (after proveRecursive, proof.publicInput is the previous chunk's output, not initialActionState)
  const inputMatch = initialProofPublicInput.equals(initialActionState).toBoolean();
  log(`first proof publicInput == initialActionState: ${inputMatch ? 'YES ✓' : 'NO ✗'}`);

  if (!inputMatch) {
    throw new Error(`${label}: publicInput mismatch!`);
  }

  const proofJson = JSON.stringify(proof.toJSON()).slice(0, 300);
  log(`proof object (truncated): ${proofJson}...`);

  if (PROOFS_ENABLED) {
    log('Verifying proof cryptographically...');
    const ok = await verify(proof, vk);
    log(`verify(): ${ok ? 'VALID ✓' : 'INVALID ✗'}`);
    if (!ok) throw new Error(`${label}: proof verification failed!`);
  }

  log(`${label} PASSED in ${totalMs}ms\n`);
}

async function main() {
  log(`PROOFS_ENABLED=${PROOFS_ENABLED}  USE_CACHE=${USE_CACHE}`);
  log(`ACTION_QUEUE_SIZE=${ACTION_QUEUE_SIZE}`);

  const cache: Cache = USE_CACHE
    ? Cache.FileSystemDefault
    : {
        read(header: any) {
          const id: string = header.persistentId ?? '';
          if (id.startsWith('step-') || id.startsWith('wrap-')) return undefined;
          return Cache.FileSystemDefault.read(header);
        },
        write() { /* no-op */ },
        canWrite: false,
      };

  log('Compiling ActionStackProgram...');
  const compileStart = Date.now();
  const { verificationKey: vk } = await ActionStackProgram.compile({
    proofsEnabled: PROOFS_ENABLED,
    cache,
  });
  log(`Compiled in ${Date.now() - compileStart}ms\n`);

  const initialActionState = Field(0);

  const half = Math.max(1, Math.floor(ACTION_QUEUE_SIZE / 2));
  const double = ACTION_QUEUE_SIZE * 2;
  const triple = ACTION_QUEUE_SIZE * 2 + Math.floor(ACTION_QUEUE_SIZE / 3);

  await runScenario(`half-queue (${half} actions)`, half, initialActionState, vk);
  await runScenario(`full-queue (${ACTION_QUEUE_SIZE} actions)`, ACTION_QUEUE_SIZE, initialActionState, vk);
  await runScenario(`double-queue (${double} actions)`, double, initialActionState, vk);
  await runScenario(`triple-partial (${triple} actions)`, triple, initialActionState, vk);

  log('=== ALL SCENARIOS PASSED ===');
}

main().catch((e) => {
  console.error('[ActionStack] FAILED:', e);
  process.exit(1);
});
