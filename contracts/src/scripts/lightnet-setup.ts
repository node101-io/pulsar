/**
 * Lightnet deploy + seed script.
 *
 * - Connects to local lightnet (127.0.0.1:8080 / 8282)
 * - Acquires funded accounts from the lightnet Account Manager
 * - Generates a test validator key and computes the correct merkleListRoot
 * - Compiles and deploys SettlementContract with that merkleListRoot
 * - Dispatches several deposit and withdrawal actions so the archive has data
 * - Writes results to ../../bridge/.env.lightnet (includes VALIDATOR_PRIVATE_KEY)
 *
 * Usage:
 *   node build/src/scripts/lightnet-setup.js [--no-seed]
 */

import {
  Mina,
  PrivateKey,
  UInt64,
  fetchAccount,
  Cache,
  Field,
  Poseidon,
  Lightnet,
  AccountUpdate,
} from 'o1js';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SettlementContract } from '../SettlementContract.js';
import { MultisigVerifierProgram } from '../SettlementProof.js';
import { ValidateReduceProgram } from '../ValidateReduce.js';
import { ActionStackProgram, ActionStackProof, ActionStackQueue } from '../ActionStack.js';
import { PulsarAuth } from '../types/PulsarAction.js';
import { List } from '../types/common.js';
import { VALIDATOR_NUMBER } from '../utils/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const NODE_URL = 'http://127.0.0.1:8080/graphql';
const ARCHIVE_URL = 'http://127.0.0.1:8282';
const ACCOUNT_MANAGER_URL = 'http://127.0.0.1:8181';
const FEE = 1e8;

const noSeed = process.argv.includes('--no-seed');

async function waitForTx(
  tx: Awaited<ReturnType<typeof Mina.transaction>>,
  signingKeys: PrivateKey[],
  label: string,
  skipProve = false,
): Promise<void> {
  if (!skipProve) await tx.prove();
  const pending = await tx.sign(signingKeys).send();
  if (pending.status === 'rejected') {
    throw new Error(`${label}: transaction rejected — ${JSON.stringify(pending.errors)}`);
  }
  console.log(`  ${label} tx: ${pending.hash}`);
  const result = await pending.safeWait();
  if (result.status === 'rejected') {
    throw new Error(`${label}: included but rejected — ${JSON.stringify((result as any).errors ?? [])}`);
  }
  console.log(`  ${label} ✓ (block ${(result as any).blockHeight ?? '?'})`);
}

/** Compute the merkleListRoot by pushing the validator key VALIDATOR_NUMBER times.
 *  ValidateReduceProgram iterates over all VALIDATOR_NUMBER slots, so the root
 *  must reflect the full list — even when there is only one real validator. */
function computeMerkleListRoot(validatorPublicKey: PrivateKey['toPublicKey'] extends () => infer R ? R : never): Field {
  const list = List.empty();
  for (let i = 0; i < VALIDATOR_NUMBER; i++) {
    list.push(Poseidon.hash(validatorPublicKey.toFields()));
  }
  return list.hash;
}

async function main() {
  const Network = Mina.Network({
    mina: NODE_URL,
    archive: ARCHIVE_URL,
    lightnetAccountManager: ACCOUNT_MANAGER_URL,
  });
  Mina.setActiveInstance(Network);

  // Acquire two funded accounts: deployer and depositor
  console.log('Acquiring funded accounts from lightnet...');
  const deployerKeyPair = await Lightnet.acquireKeyPair();
  const depositorKeyPair = await Lightnet.acquireKeyPair();
  const deployerKey = deployerKeyPair.privateKey;
  const depositorKey = depositorKeyPair.privateKey;
  const deployer = deployerKey.toPublicKey();
  const depositor = depositorKey.toPublicKey();

  console.log('  deployer:', deployer.toBase58());
  console.log('  depositor:', depositor.toBase58());

  await fetchAccount({ publicKey: deployer });
  await fetchAccount({ publicKey: depositor });

  // Generate a test validator key and compute merkleListRoot
  const validatorKey = PrivateKey.random();
  const validatorPubKey = validatorKey.toPublicKey();
  const merkleListRoot = computeMerkleListRoot(validatorPubKey);
  console.log('\nValidator public key:', validatorPubKey.toBase58());
  console.log('merkleListRoot:', merkleListRoot.toString());

  // Selective cache: reads SRS/lagrange basis from disk (expensive to recompute),
  // but ignores circuit-specific keys (step-pk/wrap-pk) which may be stale,
  // and skips writing to avoid Wasm OOM during large prover key serialization.
  const cache: Cache = {
    read(header) {
      const id: string = (header as any).persistentId ?? '';
      if (id.startsWith('step-') || id.startsWith('wrap-')) return undefined;
      return Cache.FileSystemDefault.read(header);
    },
    write(_header, _data) { /* no-op */ },
    canWrite: false,
  };

  console.log('\nCompiling programs (using cache)...');
  await MultisigVerifierProgram.compile({ cache });
  console.log('  MultisigVerifierProgram ✓');
  await ValidateReduceProgram.compile({ cache });
  console.log('  ValidateReduceProgram ✓');
  await ActionStackProgram.compile({ cache });
  console.log('  ActionStackProgram ✓');
  // Lightnet runs with PROOF_LEVEL=none — proof content is never verified on-chain.
  // Use Proof.dummy() for the _dummy parameter in deposit/withdraw (verifyIf(Bool(false))).
  // maxProofsVerified=1 because proveRecursive verifies a SelfProof.
  // domainLog2=16 because 45K constraints → 2^16=65536 is the smallest fitting power of 2.
  const dummyActionProof = await ActionStackProof.dummy(Field(0), Field(0), 1, 16);
  console.log('  dummy ActionStackProof ✓');
  const { verificationKey } = await SettlementContract.compile({ cache });
  console.log('  SettlementContract ✓  VK:', verificationKey.hash.toString());

  // Generate contract key and save IMMEDIATELY before any tx
  const contractKey = PrivateKey.random();
  const contractAddress = contractKey.toPublicKey();
  const contract = new SettlementContract(contractAddress);

  console.log('\nDeploying SettlementContract...');
  console.log('  contract address:', contractAddress.toBase58());

  const deployTx = await Mina.transaction({ sender: deployer, fee: FEE }, async () => {
    AccountUpdate.fundNewAccount(deployer);
    await contract.deploy();
    await contract.initialize(merkleListRoot);
  });
  await waitForTx(deployTx, [deployerKey, contractKey], 'deploy+initialize');

  await fetchAccount({ publicKey: contractAddress });
  console.log('  Contract deployed and initialized ✓');

  if (!noSeed) {
    console.log('\nDispatching deposit actions...');
    for (let i = 1; i <= 5; i++) {
      await fetchAccount({ publicKey: depositor });
      await fetchAccount({ publicKey: contractAddress });
      const amount = UInt64.from(BigInt(i) * BigInt(2e9)); // 2, 4, 6, 8, 10 MINA
      const depositTx = await Mina.transaction({ sender: depositor, fee: FEE }, async () => {
        await contract.deposit(amount, PulsarAuth.empty(), dummyActionProof);
      });
      await waitForTx(depositTx, [depositorKey], `deposit ${i * 2} MINA`);
    }

    console.log('\nDispatching withdrawal actions...');
    for (let i = 1; i <= 2; i++) {
      await fetchAccount({ publicKey: depositor });
      await fetchAccount({ publicKey: contractAddress });
      const amount = UInt64.from(BigInt(i) * BigInt(1e9)); // 1, 2 MINA
      const withdrawTx = await Mina.transaction({ sender: depositor, fee: FEE }, async () => {
        await contract.withdraw(amount, dummyActionProof);
      });
      await waitForTx(withdrawTx, [depositorKey], `withdraw ${i} MINA`);
    }
  }

  // Write bridge/.env.lightnet
  const envPath = resolve(__dirname, '../../../../bridge/.env.lightnet');
  const envContent = [
    `MINA_NETWORK=lightnet`,
    `CONTRACT_ADDRESS=${contractAddress.toBase58()}`,
    `MINA_PRIVATE_KEY=${deployerKey.toBase58()}`,
    `MINA_FEE=${FEE}`,
    `LIGHTNET_NODE_URL=${NODE_URL}`,
    `LIGHTNET_ARCHIVE_URL=${ARCHIVE_URL}`,
    `VALIDATOR_PRIVATE_KEY=${validatorKey.toBase58()}`,
    '',
  ].join('\n');

  writeFileSync(envPath, envContent);
  console.log(`\nWrote ${envPath}`);

  // Also write deploy-result.json in contracts/
  const resultPath = resolve(__dirname, '../../../deploy-result.json');
  const result = {
    contractAddress: contractAddress.toBase58(),
    contractPrivateKey: contractKey.toBase58(),
    deployerAddress: deployer.toBase58(),
    validatorPublicKey: validatorPubKey.toBase58(),
    merkleListRoot: merkleListRoot.toString(),
    deployedAt: new Date().toISOString(),
    network: 'lightnet',
    nodeUrl: NODE_URL,
    archiveUrl: ARCHIVE_URL,
    verificationKeyHash: verificationKey.hash.toString(),
  };
  writeFileSync(resultPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ${resultPath}`);

  console.log('\n=== DONE ===');
  console.log(`Contract address: ${contractAddress.toBase58()}`);
  console.log(`Validator key written to .env.lightnet`);

  // Release accounts back to the pool
  await Lightnet.releaseKeyPair({ publicKey: depositor.toBase58() });
  await Lightnet.releaseKeyPair({ publicKey: deployer.toBase58() });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
