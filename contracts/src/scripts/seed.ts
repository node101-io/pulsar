/**
 * Zaten deploy edilmiş bir SettlementContract'a seed atar (deposit + withdraw).
 * Deploy'u TEKRAR çalıştırmaz — mevcut kontrata action dispatch eder.
 *
 * kullanım:
 *   node build/src/scripts/seed.js \
 *     <DEPLOYER_PRIVATE_KEY_BASE58> \
 *     [--network devnet|mainnet] \
 *     [--contract <B62...>] \
 *     [--deposits N] [--withdrawals M]
 *
 * DEPLOYER_PRIVATE_KEY_BASE58: ilgili ağda bakiyesi olan hesabın private key'i (EK...)
 * --network   : hedef ağ (varsayılan "devnet")
 * --contract  : kontrat adresi. Verilmezse deploy-result.json'daki contractAddress kullanılır.
 * --deposits  : deposit sayısı (varsayılan 3)
 * --withdrawals: withdraw sayısı (varsayılan 2)
 *
 * NOT: mainnet'te her deposit/withdraw GERÇEK MINA harcar.
 */

import { Mina, PrivateKey, PublicKey, UInt64, AccountUpdate, fetchAccount } from 'o1js';
import { readFileSync } from 'fs';
import { SettlementContract } from '../SettlementContract.js';
import { MultisigVerifierProgram } from '../SettlementProof.js';
import { ValidateReduceProgram } from '../ValidateReduce.js';
import { ActionStackProgram } from '../ActionStack.js';
import { PulsarAuth } from '../types/PulsarAction.js';
import { ENDPOINTS } from '../utils/constants.js';

declare const process: { argv: string[]; exit: (code: number) => void };

const FEE = 1e8;

type SeedNetwork = 'devnet' | 'mainnet';

function parseCliArgs(args: string[]) {
  const positionalArgs = args.filter((a) => !a.startsWith('--'));
  const deployerKeyArg = positionalArgs[0];

  const flagValue = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const networkArg = flagValue('--network') ?? 'devnet';
  if (networkArg !== 'devnet' && networkArg !== 'mainnet') {
    throw new Error(
      `Invalid --network "${networkArg}". Expected "devnet" or "mainnet".`
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
  const deployerKey = parseDeployerPrivateKey(deployerKeyArg);
  const deployer = deployerKey.toPublicKey();
  const contractAddress = resolveContractAddress(contractArg);

  const nodeUrl = ENDPOINTS.NODE[network];
  const archiveUrl = ENDPOINTS.ARCHIVE[network];
  const Network = Mina.Network({
    networkId: network === 'mainnet' ? 'mainnet' : 'testnet',
    mina: nodeUrl,
    archive: archiveUrl,
  });
  Mina.setActiveInstance(Network);

  console.log(`network : ${network}`);
  console.log(`  node    : ${nodeUrl}`);
  console.log(`  archive : ${archiveUrl}`);
  console.log(`deployer: ${deployer.toBase58()}`);
  console.log(`contract: ${contractAddress.toBase58()}`);
  console.log(`plan    : ${deposits} deposit + ${withdrawals} withdraw`);

  await fetchAccount({ publicKey: deployer });
  await fetchAccount({ publicKey: contractAddress });

  console.log('\ncompiling...');
  await MultisigVerifierProgram.compile();
  console.log('  MultisigVerifierProgram ✓');
  await ValidateReduceProgram.compile();
  console.log('  ValidateReduceProgram ✓');
  await ActionStackProgram.compile();
  console.log('  ActionStackProgram ✓');
  await SettlementContract.compile();
  console.log('  SettlementContract ✓');

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
    await depositTx.prove();
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
    await withdrawTx.prove();
    const pending = await withdrawTx.sign([deployerKey]).send();
    console.log(`withdraw #${i + 1}:`, pending.hash);
    await pending.safeWait();
  }

  console.log('\n=== SEED DONE ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
