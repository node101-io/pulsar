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
  Bool,
} from 'o1js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { SettlementContract } from '../SettlementContract.js';
import { MultisigVerifierProgram } from '../SettlementProof.js';
import { ValidateReduceProgram, ValidateReducePublicInput } from '../ValidateReduce.js';
import { ActionStackProgram, ActionStackProof } from '../ActionStack.js';
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
  // Fill all VALIDATOR_NUMBER slots with the same real validator key/signature.
  // computeMerkleListRoot in lightnet-setup also pushes VALIDATOR_NUMBER copies
  // of the same key, so the MerkleList hashes will match.
  const list: Array<{ publicKey: PublicKey; signature: Signature }> = [];
  for (let i = 0; i < VALIDATOR_NUMBER; i++) {
    list.push({ publicKey: validatorPublicKey, signature });
  }
  return new SignaturePublicKeyList({
    list: list.map((s) => new SignaturePublicKey({ publicKey: s.publicKey, signature: s.signature })),
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
  // Re-compile ActionStackProgram with proofsEnabled:false so that proveBase()
  // produces instant mock proofs. SettlementContract is already compiled above,
  // so this re-compile only affects subsequent ZkProgram.prove* calls.
  // The VK is circuit-structure-derived and identical regardless of proofsEnabled.
  await ActionStackProgram.compile({ cache, proofsEnabled: false });
  log(`  ActionStackProgram (mock mode) ✓ (${Date.now() - t0}ms)`);

  // 3. Fetch on-chain state
  const contractAddress = PublicKey.fromBase58(CONTRACT_ADDRESS!);
  const fetchResult = await fetchAccount({ publicKey: contractAddress });
  if (fetchResult.error) throw new Error(`fetchAccount failed: ${fetchResult.error.statusText}`);
  const zkappState = (fetchResult.account?.zkapp?.appState ?? []).map((f: any) => f.toString());
  log(`On-chain state:`);
  log(`  actionState:     ${zkappState[0]}`);
  log(`  merkleListRoot:  ${zkappState[1]}`);
  log(`  actionListHash:  ${zkappState[4]}`);

  // 4. Fetch ALL pending actions from archive.
  // reduce() checks that our batch covers from initialActionState → account.actionState (all pending).
  // All actions dispatched since the last reduce() must be included in one batch.
  const entries = await fetchActionsFromArchive(CONTRACT_ADDRESS!);
  if (entries.length === 0) throw new Error('No actions found in archive');
  const allRawActions = entries.flatMap((e) => e.actions);
  log(`Found ${entries.length} block(s), ${allRawActions.length} total action(s) to reduce`);
  if (allRawActions.length > BATCH_SIZE) throw new Error(`Too many pending actions: ${allRawActions.length} > BATCH_SIZE(${BATCH_SIZE})`);
  const pulsarActions = allRawActions.map((raw) => PulsarAction.fromRawAction(raw));

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

  // 7. Generate ZkProgram dummy proofs via LocalBlockchain(proofsEnabled=false).
  // ValidateReduceProgram and ActionStackProgram are ZkPrograms — they don't check
  // activeInstance.proofsEnabled; they check their own compile-time flag.
  // ValidateReduceProgram was compiled with proofsEnabled:true (default), so we need
  // LocalBlockchain context to make its prove() return a mock proof.
  log('Switching to LocalBlockchain(proofsEnabled=false) for ZkProgram dummy proofs...');
  const localNet = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(localNet);

  const t1 = Date.now();
  log('Generating ValidateReduceProof (dummy)...');
  const validateReduceProof = await GenerateValidateReduceProof(publicInput, sigList);
  log(`  ValidateReduceProof ✓ (${Date.now() - t1}ms)`);

  const t2 = Date.now();
  log('Generating ActionStackProof (dummy, useActionStack=false)...');
  // useActionStack=false → reduce() uses batch-computed actionState, skips proof verify.
  // maxProofsVerified=1 (proveRecursive has SelfProof), domainLog2=16 (45K rows → 2^16).
  const useActionStack = Bool(false);
  const actionStackProof = await ActionStackProof.dummy(Field(0), Field(0), 1, 16);
  log(`  ActionStackProof dummy ✓ (${Date.now() - t2}ms)`);

  // 8. Restore lightnet for account fetch & tx submission.
  Mina.setActiveInstance(Network);

  // 9. Send reduce tx
  const senderKey = PrivateKey.fromBase58(MINA_PRIVATE_KEY!);
  const sender = senderKey.toPublicKey();
  const contract = new SettlementContract(contractAddress);

  await fetchAccount({ publicKey: sender });
  await fetchAccount({ publicKey: contractAddress });

  // ROOT CAUSE FIX:
  // Network.transaction() calls createTransaction() WITHOUT proofsEnabled, so it defaults
  // to true. Then tx.prove() → addMissingProofs(cmd, { proofsEnabled: true }) → real Pickles
  // proof → 13+ minutes. Network.proofsEnabled is NOT read by Network.transaction() at all.
  //
  // Fix: build the tx normally (Network handles fetch/nonces), then bypass tx.prove()
  // entirely by calling addMissingProofs directly from o1js internals with proofsEnabled:false.
  // This produces an instant dummyBase64Proof() — structurally a Proof authorization but
  // not a real SNARK. Lightnet PROOF_LEVEL=none never verifies proof content, so it's accepted.
  log('Building reduce tx...');
  const tx = await Mina.transaction({ sender, fee: FEE }, async () => {
    await contract.reduce(batch, useActionStack, actionStackProof, mask, validateReduceProof);
  });

  log('Applying mock proof (instant — bypasses real Pickles prover)...');
  // addMissingProofs is not exported from o1js public API, so we import via file URL.
  // The exports field in o1js/package.json restricts bare specifier subpaths, but direct
  // file:// URLs bypass that restriction in Node.js ESM.
  const accountUpdatePath = resolve(
    __dirname,
    '../../../node_modules/o1js/dist/node/lib/mina/v1/account-update.js',
  );
  const { addMissingProofs } = await import(pathToFileURL(accountUpdatePath).href) as any;
  const { zkappCommand } = await addMissingProofs((tx as any).transaction, { proofsEnabled: false });
  (tx as any).transaction = zkappCommand;
  // tx.prove() is NOT called — authorization kind is already 'Proof' (dummy base64 content)

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
