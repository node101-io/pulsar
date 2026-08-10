/**
 * Zaten deploy edilmiş bir SettlementContract'a seed atar (deposit + withdraw).
 * Deploy'u TEKRAR çalıştırmaz — mevcut kontrata action dispatch eder.
 *
 * kullanım:
 *   node build/src/scripts/seed.js \
 *     [DEPLOYER_PRIVATE_KEY_BASE58] \
 *     [--network devnet|mainnet|lightnet] \
 *     [--contract <B62...>] \
 *     [--deposits N] [--withdrawals M]
 *
 * DEPLOYER_PRIVATE_KEY_BASE58: ilgili ağda bakiyesi olan hesabın private key'i
 * (EK...). lightnet'te verilmezse account manager'dan taze hesap alınır —
 * bridge'in gönderici hesabıyla nonce çakışmaması için tercih edilen yol.
 * --network   : hedef ağ (varsayılan "devnet"). lightnet'te compile atlanır,
 *               proof'lar mock'lanır (PROOF_LEVEL=none zaten doğrulamıyor).
 * --contract  : kontrat adresi. Verilmezse deploy-result.json'daki contractAddress kullanılır.
 * --deposits  : deposit sayısı (varsayılan 3)
 * --withdrawals: withdraw sayısı (varsayılan 2)
 *
 * NOT: mainnet'te her deposit/withdraw GERÇEK MINA harcar.
 */

import {
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  AccountUpdate,
  fetchAccount,
  Lightnet,
} from 'o1js';
import { readFileSync } from 'fs';
import { mockProve } from './mock-prove.js';
import { SettlementContract } from '../SettlementContract.js';
import { MultisigVerifierProgram } from '../SettlementProof.js';
import { ApprovalTailProgram } from '../ApprovalTail.js';
import { ApprovalQuorumProgram } from '../ApprovalQuorum.js';
import { ActionStackProgram } from '../ActionStack.js';
import { PulsarAuth } from '../types/PulsarAction.js';
import { ENDPOINTS } from '../utils/constants.js';

declare const process: { argv: string[]; exit: (code: number) => void };

const FEE = 1e8;
const LIGHTNET_ACCOUNT_MANAGER_URL = 'http://127.0.0.1:8181';

type SeedNetwork = 'devnet' | 'mainnet' | 'lightnet';

function parseCliArgs(args: string[]) {
  // Every flag consumes the next arg as its value — flag values must not be
  // mistaken for positionals.
  const positionalArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      i++;
      continue;
    }
    positionalArgs.push(args[i]);
  }
  const deployerKeyArg = positionalArgs[0];

  const flagValue = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const networkArg = flagValue('--network') ?? 'devnet';
  if (
    networkArg !== 'devnet' &&
    networkArg !== 'mainnet' &&
    networkArg !== 'lightnet'
  ) {
    throw new Error(
      `Invalid --network "${networkArg}". Expected "devnet", "mainnet" or "lightnet".`
    );
  }

  const contractArg = flagValue('--contract');
  const deposits = Number(flagValue('--deposits') ?? '3');
  const withdrawals = Number(flagValue('--withdrawals') ?? '2');

  return {
    deployerKeyArg,
    network: networkArg as SeedNetwork,
    contractArg,
    deposits,
    withdrawals,
  };
}

function parseDeployerPrivateKey(input?: string): PrivateKey {
  if (!input) {
    throw new Error(
      'Missing deployer private key. Usage: node build/src/scripts/seed.js <DEPLOYER_PRIVATE_KEY_BASE58> [--network ...] [--contract ...]'
    );
  }
  const normalized = input.trim().replace(/^['"]|['"]$/g, '');
  try {
    return PrivateKey.fromBase58(normalized);
  } catch {
    throw new Error(
      'Invalid deployer private key: expected Mina Base58 private key (usually starts with EK...).'
    );
  }
}

function resolveContractAddress(contractArg?: string): PublicKey {
  if (contractArg) {
    return PublicKey.fromBase58(contractArg.trim());
  }
  try {
    const raw = readFileSync('deploy-result.json', 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.contractAddress) {
      throw new Error('deploy-result.json has no contractAddress');
    }
    return PublicKey.fromBase58(parsed.contractAddress);
  } catch (e) {
    throw new Error(
      `Kontrat adresi bulunamadı. --contract <B62...> ver ya da deploy-result.json bulunsun. (${(e as Error).message})`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const { deployerKeyArg, network, contractArg, deposits, withdrawals } =
    parseCliArgs(args);
  const contractAddress = resolveContractAddress(contractArg);

  const nodeUrl = ENDPOINTS.NODE[network];
  const archiveUrl = ENDPOINTS.ARCHIVE[network];
  const Network = Mina.Network({
    networkId: network === 'mainnet' ? 'mainnet' : 'testnet',
    mina: nodeUrl,
    archive: archiveUrl,
    ...(network === 'lightnet'
      ? { lightnetAccountManager: LIGHTNET_ACCOUNT_MANAGER_URL }
      : {}),
  });
  Mina.setActiveInstance(Network);

  // Lightnet runs PROOF_LEVEL=none — dummy proofs suffice and take
  // milliseconds instead of 30-60 min per tx (see mock-prove.ts).
  const prove = (tx: Awaited<ReturnType<typeof Mina.transaction>>) =>
    network === 'lightnet' ? mockProve(tx) : tx.prove().then(() => {});

  const acquiredFromPool = network === 'lightnet' && !deployerKeyArg;
  const deployerKey = acquiredFromPool
    ? (await Lightnet.acquireKeyPair()).privateKey
    : parseDeployerPrivateKey(deployerKeyArg);
  const deployer = deployerKey.toPublicKey();

  console.log(`network : ${network}`);
  console.log(`  node    : ${nodeUrl}`);
  console.log(`  archive : ${archiveUrl}`);
  console.log(`deployer: ${deployer.toBase58()}`);
  console.log(`contract: ${contractAddress.toBase58()}`);
  console.log(`plan    : ${deposits} deposit + ${withdrawals} withdraw`);

  await fetchAccount({ publicKey: deployer });
  await fetchAccount({ publicKey: contractAddress });

  if (network !== 'lightnet') {
    console.log('\ncompiling...');
    await MultisigVerifierProgram.compile();
    console.log('  MultisigVerifierProgram ✓');
    // ApprovalQuorumProgram verifies ApprovalTailProofs — tail first
    await ApprovalTailProgram.compile();
    console.log('  ApprovalTailProgram ✓');
    await ApprovalQuorumProgram.compile();
    console.log('  ApprovalQuorumProgram ✓');
    await ActionStackProgram.compile();
    console.log('  ActionStackProgram ✓');
    await SettlementContract.compile();
    console.log('  SettlementContract ✓');
  } else {
    console.log('\nlightnet: compile atlandı (mock proof)');
  }

  const contract = new SettlementContract(contractAddress);

  console.log('\n[seeding] deposits...');
  for (let i = 0; i < deposits; i++) {
    const amount = UInt64.from(2e9);
    const depositTx = await Mina.transaction(
      { sender: deployer, fee: FEE },
      async () => {
        AccountUpdate.fundNewAccount(deployer, 0);
        await contract.deposit(amount, PulsarAuth.empty());
      }
    );
    await prove(depositTx);
    const pending = await depositTx.sign([deployerKey]).send();
    console.log(`deposit #${i + 1}:`, pending.hash);
    await pending.safeWait();
  }

  console.log('\n[seeding] withdrawals...');
  for (let i = 0; i < withdrawals; i++) {
    const amount = UInt64.from(1e9);
    const withdrawTx = await Mina.transaction(
      { sender: deployer, fee: FEE },
      async () => {
        await contract.withdraw(amount);
      }
    );
    await prove(withdrawTx);
    const pending = await withdrawTx.sign([deployerKey]).send();
    console.log(`withdraw #${i + 1}:`, pending.hash);
    await pending.safeWait();
  }

  console.log('\n=== SEED DONE ===');

  if (acquiredFromPool) {
    await Lightnet.releaseKeyPair({ publicKey: deployer.toBase58() });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
