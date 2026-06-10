/**
 * MESA upgrade sonrası SettlementContract'ın verification key'ini günceller.
 *
 * Kullanım:
 *   node build/src/scripts/updateVerificationKey.js \
 *     <DEPLOYER_PRIVATE_KEY_BASE58> \
 *     <CONTRACT_PRIVATE_KEY_BASE58>
 *
 * Ön koşul:
 *   - MESA hardfork GERÇEKLEŞTİKTEN SONRA çalıştır.
 *   - deploy-result.json'daki contractPrivateKey'i kullan.
 */

import {
  Mina,
  PrivateKey,
  AccountUpdate,
  Permissions,
  fetchAccount,
  Cache,
} from 'o1js';
import { SettlementContract } from '../SettlementContract.js';
import { MultisigVerifierProgram } from '../SettlementProof.js';
import { ValidateReduceProgram } from '../ValidateReduce.js';
import { ActionStackProgram } from '../ActionStack.js';

declare const process: { argv: string[]; exit: (code: number) => void };

const MESA_URL = 'https://plain-1-graphql.mesa-mut.minaprotocol.com/graphql';
const MESA_ARCHIVE_URL = 'https://archive-node-api.mesa-mut.minaprotocol.com/';
const FEE = 1e8;

async function main() {
  const [deployerKeyArg, contractKeyArg] = process.argv.slice(2);

  if (!deployerKeyArg || !contractKeyArg) {
    throw new Error(
      'Usage: node build/src/scripts/updateVerificationKey.js <DEPLOYER_PRIVATE_KEY> <CONTRACT_PRIVATE_KEY>'
    );
  }

  const deployerKey = PrivateKey.fromBase58(deployerKeyArg);
  const contractKey = PrivateKey.fromBase58(contractKeyArg);
  const deployer = deployerKey.toPublicKey();
  const contractAddress = contractKey.toPublicKey();

  const Network = Mina.Network({ mina: MESA_URL, archive: MESA_ARCHIVE_URL });
  Mina.setActiveInstance(Network);

  await fetchAccount({ publicKey: deployer });
  await fetchAccount({ publicKey: contractAddress });

  console.log('deployer :', deployer.toBase58());
  console.log('contract :', contractAddress.toBase58());

  const srsReadCache = {
    read: Cache.FileSystemDefault.read.bind(Cache.FileSystemDefault),
    write(_header: unknown, _data: unknown) {},
    canWrite: false,
  } as ReturnType<typeof Cache.FileSystem>;

  const cacheOpts = { cache: srsReadCache };

  console.log('\ncompiling (MESA-compatible VK)...');
  await MultisigVerifierProgram.compile(cacheOpts);
  console.log('  MultisigVerifierProgram ✓');
  await ValidateReduceProgram.compile(cacheOpts);
  console.log('  ValidateReduceProgram ✓');
  await ActionStackProgram.compile(cacheOpts);
  console.log('  ActionStackProgram ✓');
  const { verificationKey } = await SettlementContract.compile(cacheOpts);
  console.log('  SettlementContract ✓');
  console.log('new VK hash:', verificationKey.hash.toString());

  // MESA sonrası permission "signature" fallback'e geçer — proof üretmeye gerek yok.
  const updateTx = await Mina.transaction(
    { sender: deployer, fee: FEE },
    async () => {
      const contractUpdate = AccountUpdate.createSigned(contractAddress);
      contractUpdate.account.verificationKey.set(verificationKey);
      contractUpdate.account.permissions.set({
        ...Permissions.default(),
        send: Permissions.proof(),
        setVerificationKey:
          Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      });
    }
  );

  const pending = await updateTx.sign([deployerKey, contractKey]).send();
  console.log('\nupdate VK tx:', pending.hash);
  await pending.safeWait();

  console.log('\n=== DONE ===');
  console.log('VK güncellendi, yeni MESA VK ile kilitlendi.');
  console.log('contract :', contractAddress.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
