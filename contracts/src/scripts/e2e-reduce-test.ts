/**
 * End-to-end reduce test — runs outside vitest to avoid dual-Wasm OOM.
 *
 * Reads bridge/.env for config, deploys nothing, just:
 *   1. Compiles all ZkPrograms (with selective cache)
 *   2. Fetches first action block from lightnet archive
 *   3. Generates dummy proofs (LocalBlockchain proofsEnabled=false)
 *   4. Sends reduce tx to lightnet
 *   5. Verifies on-chain actionState advanced
 *
 * Usage:
 *   node build/src/scripts/e2e-reduce-test.js
 */

import {
  Mina,
  PrivateKey,
  PublicKey,
  Field,
  Signature,
  Cache,
  fetchAccount,
} from 'o1js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SettlementContract } from '../SettlementContract.js';
import { MultisigVerifierProgram } from '../SettlementProof.js';
import { ValidateReduceProgram, ValidateReducePublicInput } from '../ValidateReduce.js';
import { ActionStackProgram } from '../ActionStack.js';
import { PulsarAction, PulsarAuth } from '../types/PulsarAction.js';
import { Batch } from '../types/PulsarAction.js';
import { ReduceMask } from '../types/common.js';
import { SignaturePublicKey, SignaturePublicKeyList } from '../types/signaturePubKeyList.js';
import { CalculateFinalActionState } from '../utils/actionQueueUtils.js';
import { GenerateValidateReduceProof, GenerateActionStackProof } from '../utils/generateFunctions.js';
import { BATCH_SIZE, VALIDATOR_NUMBER } from '../utils/constants.js';
import { Poseidon } from 'o1js';
import { waitForTransaction } from '../utils/fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load bridge/.env
const envPath = resolve(__dirname, '../../../../bridge/.env');
const env: Record<string, string> = {};
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const NODE_URL = env.LIGHTNET_NODE_URL ?? 'http://127.0.0.1:8080/graphql';
const ARCHIVE_URL = env.LIGHTNET_ARCHIVE_URL ?? 'http://127.0.0.1:8282';
const CONTRACT_ADDRESS = env.CONTRACT_ADDRESS;
const MINA_PRIVATE_KEY = env.MINA_PRIVATE_KEY;
const VALIDATOR_PRIVATE_KEY = env.VALIDATOR_PRIVATE_KEY;
const FEE = Number(env.MINA_FEE ?? 1e8);

if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS not set in bridge/.env');
if (!MINA_PRIVATE_KEY) throw new Error('MINA_PRIVATE_KEY not set in bridge/.env');
if (!VALIDATOR_PRIVATE_KEY) throw new Error('VALIDATOR_PRIVATE_KEY not set in bridge/.env');

function log(msg: string) { console.log(`[E2E] ${msg}`); }

// Selective cache: reads SRS/lagrange from disk, skips stale circuit keys
const cache: Cache = {
  read(header) {
    const id: string = (header as any).persistentId ?? '';
    if (id.startsWith('step-') || id.startsWith('wrap-')) return undefined;
    return Cache.FileSystemDefault.read(header);
  },
  write(_header, _data) { /* no-op — avoid Wasm OOM */ },
  canWrite: false,
};

function buildBatchAndMask(pulsarActions: PulsarAction[]): { batch: Batch; mask: ReduceMask } {
  if (pulsarActions.length > BATCH_SIZE) throw new Error(`Too many actions: ${pulsarActions.length} > ${BATCH_SIZE}`);
  const batch = Batch.fromArray(pulsarActions);
  const maskBools = [
    ...Array(pulsarActions.length).fill(true),
    ...Array(BATCH_SIZE - pulsarActions.length).fill(false),
  ];
  return { batch, mask: ReduceMask.fromArray(maskBools) };
}

function computeActionListHash(startHash: Field, batch: Batch, mask: ReduceMask): Field {
  let hash = startHash;
  for (let i = 0; i < BATCH_SIZE; i++) {
    const action = batch.actions[i];
    if (PulsarAction.isDummy(action).toBoolean()) continue;
    if (!mask.list[i].toBoolean()) continue;
    hash = Poseidon.hash([hash, action.type, ...action.account.toFields(), action.amount, ...action.pulsarAuth.toFields()]);
  }
  return hash;
}

function buildSignatureList(
  validatorPublicKey: PublicKey,
  signature: Signature,
): SignaturePublicKeyList {
  const padded: { validatorPublicKey: PublicKey | null; signature: Signature | null }[] = [{ validatorPublicKey, signature }];
  while (padded.length < VALIDATOR_NUMBER) {
    padded.push({ validatorPublicKey: null as any, signature: null as any });
  }
  return new SignaturePublicKeyList({
    list: padded.map((s) => new SignaturePublicKey({ publicKey: s.validatorPublicKey as PublicKey, signature: s.signature as Signature })),
  });
}

async function fetchActionsFromArchive(contractAddr: string): Promise<{ blockHeight: number; actions: string[][] }[]> {
  const query = `{ actions(input: { address: "${contractAddr}" }) { blockInfo { height } actionData { data } } }`;
  const res = await fetch(ARCHIVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const { data, errors } = (await res.json()) as any;
  if (errors?.length) throw new Error(`Archive error: ${errors[0].message}`);

  const byHeight = new Map<number, string[][]>();
  for (const entry of data?.actions ?? []) {
    const height: number = entry.blockInfo.height;
    for (const actionData of entry.actionData ?? []) {
      const fields: string[] = actionData.data ?? [];
      if (fields.length === 0) continue;
      const existing = byHeight.get(height) ?? [];
      byHeight.set(height, [...existing, fields]);
    }
  }
  return Array.from(byHeight.entries())
    .sort(([a], [b]) => a - b)
    .map(([blockHeight, actions]) => ({ blockHeight, actions }));
}

async function main() {
  log(`Contract: ${CONTRACT_ADDRESS}`);
  log(`Node:     ${NODE_URL}`);
  log(`Archive:  ${ARCHIVE_URL}`);

  // 1. Connect to lightnet
  const Network = Mina.Network({ mina: NODE_URL, archive: ARCHIVE_URL });
  Mina.setActiveInstance(Network);

  // 2. Compile programs
  log('Compiling ZkPrograms (selective cache)...');
  const t0 = Date.now();
  await MultisigVerifierProgram.compile({ cache });
  log(`  MultisigVerifierProgram ✓ (${Date.now() - t0}ms)`);
  await ValidateReduceProgram.compile({ cache });
  log(`  ValidateReduceProgram ✓ (${Date.now() - t0}ms)`);
  await ActionStackProgram.compile({ cache });
  log(`  ActionStackProgram ✓ (${Date.now() - t0}ms)`);
  await SettlementContract.compile({ cache });
  log(`  SettlementContract ✓ (${Date.now() - t0}ms)`);

  // 3. Fetch on-chain state
  const contractAddress = PublicKey.fromBase58(CONTRACT_ADDRESS!);
  const fetchResult = await fetchAccount({ publicKey: contractAddress });
  if (fetchResult.error) throw new Error(`fetchAccount failed: ${fetchResult.error.statusText}`);
  const zkappState = (fetchResult.account?.zkapp?.appState ?? []).map((f: any) => f.toString());
  log(`On-chain state:`);
  log(`  actionState:     ${zkappState[0]}`);
  log(`  merkleListRoot:  ${zkappState[1]}`);
  log(`  actionListHash:  ${zkappState[4]}`);

  // 4. Fetch actions from archive
  const entries = await fetchActionsFromArchive(CONTRACT_ADDRESS!);
  if (entries.length === 0) throw new Error('No actions found in archive');
  const firstEntry = entries[0];
  log(`Processing block ${firstEntry.blockHeight} — ${firstEntry.actions.length} action(s)`);
  const pulsarActions = firstEntry.actions.map((raw) => PulsarAction.fromRawAction(raw));

  // 5. Build batch & compute hashes off-circuit
  const merkleListRoot = Field(zkappState[1]);
  const initialActionState = Field(zkappState[0]);
  const initialActionListHash = Field(zkappState[4]);

  const { batch, mask } = buildBatchAndMask(pulsarActions);
  const actionListHash = computeActionListHash(initialActionListHash, batch, mask);
  const finalActionState = CalculateFinalActionState(initialActionState, pulsarActions);
  log(`  actionListHash:   ${actionListHash.toString()}`);
  log(`  finalActionState: ${finalActionState.toString()}`);

  // 6. Sign with validator key
  const validatorKey = PrivateKey.fromBase58(VALIDATOR_PRIVATE_KEY!);
  const validatorPubKey = validatorKey.toPublicKey();
  const publicInput = new ValidateReducePublicInput({ merkleListRoot, actionListHash });
  const signature = Signature.create(validatorKey, publicInput.hash().toFields());
  const sigList = buildSignatureList(validatorPubKey, signature);
  log(`Validator: ${validatorPubKey.toBase58()}`);

  // 7. Generate DUMMY proofs (LocalBlockchain proofsEnabled=false)
  // ActionStackProgram.proveBase with ACTION_QUEUE_SIZE=3000 takes hours with real proofs.
  // PROOF_LEVEL=none on lightnet accepts any proof, so dummy proofs work fine.
  log('Switching to LocalBlockchain(proofsEnabled=false) for instant dummy proofs...');
  const localNet = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(localNet);

  const t1 = Date.now();
  log('Generating ValidateReduceProof (dummy)...');
  const validateReduceProof = await GenerateValidateReduceProof(publicInput, sigList);
  log(`  ValidateReduceProof ✓ (${Date.now() - t1}ms)`);

  const t2 = Date.now();
  log('Generating ActionStackProof (dummy)...');
  const { useActionStack, actionStackProof } = await GenerateActionStackProof(finalActionState, pulsarActions);
  log(`  ActionStackProof ✓  useActionStack: ${useActionStack.toBoolean()}  (${Date.now() - t2}ms)`);

  // 8. Restore lightnet Network for tx
  log('Restoring lightnet Network for tx...');
  Mina.setActiveInstance(Network);

  // 9. Send reduce tx
  const senderKey = PrivateKey.fromBase58(MINA_PRIVATE_KEY!);
  const sender = senderKey.toPublicKey();
  const contract = new SettlementContract(contractAddress);

  await fetchAccount({ publicKey: sender });
  await fetchAccount({ publicKey: contractAddress });

  log('Building reduce tx...');
  const tx = await Mina.transaction({ sender, fee: FEE }, async () => {
    await contract.reduce(batch, useActionStack, actionStackProof, mask, validateReduceProof);
  });

  log('Proving tx (dummy, PROOF_LEVEL=none)...');
  await tx.prove();

  log('Signing & sending...');
  const pending = await tx.sign([senderKey]).send();
  if (pending.status === 'rejected') {
    throw new Error(`Reduce tx rejected: ${JSON.stringify(pending.errors)}`);
  }
  log(`  tx hash: ${pending.hash}`);

  const result = await pending.safeWait();
  if (result.status === 'rejected') {
    throw new Error(`Reduce tx included but rejected: ${JSON.stringify((result as any).errors ?? [])}`);
  }
  log(`  Reduce tx ✓`);

  // 10. Verify on-chain state advanced
  const afterResult = await fetchAccount({ publicKey: contractAddress });
  const newState = (afterResult.account?.zkapp?.appState ?? []).map((f: any) => f.toString());
  const newActionState = newState[0];
  log(`New on-chain actionState: ${newActionState}`);

  if (newActionState === initialActionState.toString()) {
    throw new Error('FAIL: actionState did not change after reduce tx');
  }

  log('=== E2E PASSED ===');
}

main().catch((e) => {
  console.error('[E2E] FAILED:', e);
  process.exit(1);
});
