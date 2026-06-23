/**
 * deploy + (opsiyonel) birkaç deposit/withdraw action dispatch eder, devnet için
 *
 * kullanım:
 *   node build/src/scripts/deployAndSeed.js \
 *     <DEPLOYER_PRIVATE_KEY_BASE58> \
 *     [INITIAL_STATE_ROOT] \
 *     [--no-seed]
 *
 * DEPLOYER_PRIVATE_KEY_BASE58: devnet'te bakiyesi olan hesabın private key'i
 * INITIAL_STATE_ROOT          : Pulsar genesis state root (decimal string, varsayılan "0")
 * --no-seed                   : deposit/withdraw işlemlerini atla
 *
 * Çıktı: deploy-result.json  ← contract address + private key burada saklanır
 */

import {
  Mina,
  PrivateKey,
  UInt64,
  AccountUpdate,
  fetchAccount,
  Field,
} from 'o1js';
import { writeFileSync } from 'fs';
import { SettlementContract } from '../SettlementContract.js';
import { MultisigVerifierProgram } from '../SettlementProof.js';
import { ValidateReduceProgram } from '../ValidateReduce.js';
import { ActionStackProgram } from '../ActionStack.js';
import { PulsarAuth } from '../types/PulsarAction.js';
import { List } from '../types/common.js';

declare const process: { argv: string[]; exit: (code: number) => void };

const DEVNET_URL = 'https://plain-1-graphql.mesa-mut.minaprotocol.com/graphql';
const DEVNET_ARCHIVE_URL = 'https://archive-node-api.mesa-mut.minaprotocol.com/';
const FEE = 1e8;
function parseCliArgs(args: string[]) {
  const positionalArgs = args.filter((a) => !a.startsWith('--'));
  const deployerKeyArg = positionalArgs[0];
  const initialStateRootStr = positionalArgs[1] ?? '0';
  const noSeed = args.includes('--no-seed');

  return { deployerKeyArg, initialStateRootStr, noSeed };
}

function parseDeployerPrivateKey(input?: string): PrivateKey {
  if (!input) {
    throw new Error(
      'Missing deployer private key. Usage: node build/src/scripts/deployAndSeed.js <DEPLOYER_PRIVATE_KEY_BASE58> [INITIAL_STATE_ROOT] [--no-seed]'
    );
  }

  const normalizedInput = input.trim().replace(/^['"]|['"]$/g, '');

  try {
    return PrivateKey.fromBase58(normalizedInput);
  } catch {
    const looksLikeBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(normalizedInput);
    if (looksLikeBase64) {
      throw new Error(
        'Invalid deployer private key format: input looks like base64, but this script expects Mina Base58 private key (usually starts with EK...).'
      );
    }

    throw new Error(
      'Invalid deployer private key: expected Mina Base58 private key (usually starts with EK...).'
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const { deployerKeyArg, initialStateRootStr, noSeed } = parseCliArgs(args);
  const deployerKey = parseDeployerPrivateKey(deployerKeyArg);
  const deployer = deployerKey.toPublicKey();

  const initialStateRoot = Field(BigInt(initialStateRootStr));

  const Network = Mina.Network({
    mina: DEVNET_URL,
    archive: DEVNET_ARCHIVE_URL,
  });
  Mina.setActiveInstance(Network);

  await fetchAccount({ publicKey: deployer });
  console.log('deployer:', deployer.toBase58());

  console.log('\ncompiling...');
  await MultisigVerifierProgram.compile();
  console.log('  MultisigVerifierProgram ✓');
  await ValidateReduceProgram.compile();
  console.log('  ValidateReduceProgram ✓');
  await ActionStackProgram.compile();
  console.log('  ActionStackProgram ✓');
  await SettlementContract.compile();
  console.log('  SettlementContract ✓');

  // Key'i hemen kaydet — tx başlamadan önce, kaybolmasın
  const contractKey = PrivateKey.random();
  const contract = new SettlementContract(contractKey.toPublicKey());
  const deployResult = {
    contractAddress: contractKey.toPublicKey().toBase58(),
    contractPrivateKey: contractKey.toBase58(),
    deployedAt: new Date().toISOString(),
    network: 'mesa',
    initialStateRoot: initialStateRootStr,
  };
  writeFileSync('deploy-result.json', JSON.stringify(deployResult, null, 2));
  console.log('\ncontract address:', deployResult.contractAddress);
  console.log('(key saved to deploy-result.json)');

  // 1 — deploy
  console.log('\n[1/2] deploying...');
  const deployTx = await Mina.transaction(
    { sender: deployer, fee: FEE },
    async () => {
      AccountUpdate.fundNewAccount(deployer);
      await contract.deploy();
    }
  );
  await deployTx.prove();
  const deployPending = await deployTx.sign([deployerKey, contractKey]).send();
  console.log('deploy tx:', deployPending.hash);
  await deployPending.safeWait();
  await fetchAccount({ publicKey: contract.address });

  // 2 — initialize (verification key önce on-chain'e yazılmalı, ayrı TX)
  console.log('\n[2/2] initializing...');
  const initTx = await Mina.transaction(
    { sender: deployer, fee: FEE },
    async () => {
      await contract.initialize(List.empty().hash, initialStateRoot);
    }
  );
  await initTx.prove();
  const initPending = await initTx.sign([deployerKey]).send();
  console.log('init tx:', initPending.hash);
  await initPending.safeWait();
  await fetchAccount({ publicKey: contract.address });

  if (noSeed) {
    console.log('\n--no-seed: seeding atlandı.');
  } else {
    console.log('\n[seeding] 3 deposit + 2 withdrawal...');

    for (let i = 0; i < 3; i++) {
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

    for (let i = 0; i < 2; i++) {
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
  }

  // deploy-result.json'a tx hash'lerini ekle
  const finalResult = {
    ...deployResult,
    deployTxHash: deployPending.hash,
    initTxHash: initPending.hash,
  };
  writeFileSync('deploy-result.json', JSON.stringify(finalResult, null, 2));

  console.log('\n=== DONE ===');
  console.log('contract address  :', deployResult.contractAddress);
  console.log('contract priv key :', deployResult.contractPrivateKey);
  console.log('deploy-result.json dosyasını sakla!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
