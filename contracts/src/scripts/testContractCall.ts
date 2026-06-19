import { Mina, PrivateKey, PublicKey, UInt64, fetchAccount, Cache, Field } from 'o1js';
import { SettlementContract } from '../SettlementContract.js';
import { MultisigVerifierProgram } from '../SettlementProof.js';
import { ValidateReduceProgram } from '../ValidateReduce.js';
import { ActionStackProgram, ActionStackProof } from '../ActionStack.js';
import { PulsarAuth } from '../types/PulsarAction.js';

declare const process: { argv: string[]; exit: (code: number) => void };

const MESA_URL = 'https://plain-1-graphql.mesa-mut.minaprotocol.com/graphql';
const MESA_ARCHIVE_URL = 'https://archive-node-api.mesa-mut.minaprotocol.com/';
const FEE = 1e8;

async function main() {
  const [deployerKeyArg, contractAddressArg] = process.argv.slice(2);

  if (!deployerKeyArg || !contractAddressArg) {
    throw new Error(
      'Usage: node build/src/scripts/testContractCall.js <DEPLOYER_PRIVATE_KEY> <CONTRACT_ADDRESS>'
    );
  }

  const deployerKey = PrivateKey.fromBase58(deployerKeyArg);
  const deployer = deployerKey.toPublicKey();
  const contractAddress = PublicKey.fromBase58(contractAddressArg);

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

  console.log('\ncompiling (o1js mesa)...');
  await MultisigVerifierProgram.compile(cacheOpts);
  console.log('  MultisigVerifierProgram ✓');
  await ValidateReduceProgram.compile(cacheOpts);
  console.log('  ValidateReduceProgram ✓');
  await ActionStackProgram.compile(cacheOpts);
  console.log('  ActionStackProgram ✓');
  const { verificationKey } = await SettlementContract.compile(cacheOpts);
  console.log('  SettlementContract ✓');
  console.log('  local VK hash :', verificationKey.hash.toString());

  const contract = new SettlementContract(contractAddress);
  const account = await fetchAccount({ publicKey: contractAddress });
  const onchainVkHash = account.account?.zkapp?.verificationKey?.hash;
  console.log('  on-chain VK hash:', onchainVkHash?.toString() ?? '(none)');

  if (onchainVkHash?.toString() === verificationKey.hash.toString()) {
    console.log('\n✓ VK match — calling deposit() should SUCCEED');
  } else {
    console.log(
      '\n⚠ VK mismatch — calling deposit() will FAIL (expected pre-update)'
    );
  }

  console.log('\nAttempting deposit(2 MINA, PulsarAuth.empty())...');
  try {
    const dummyProof = await ActionStackProof.dummy(Field(0), Field(0), 0);
    const tx = await Mina.transaction(
      { sender: deployer, fee: FEE },
      async () => {
        await contract.deposit(UInt64.from(2e9), PulsarAuth.empty(), dummyProof);
      }
    );
    await tx.prove();
    console.log('  proof generated locally ✓');

    const pending = await tx.sign([deployerKey]).send();
    console.log('\n  tx hash:', pending.hash);
    console.log('  waiting for inclusion...');
    const result = await pending.safeWait();
    console.log('  status:', result.status);
    console.log('\n=== SUCCESS — deposit accepted by network ===');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('\n=== EXPECTED FAILURE ===');
    console.log('error:', msg.slice(0, 400));
    console.log('\nThis is normal BEFORE updateVerificationKey is run.');
    console.log('Run updateVerificationKey.js first, then retry.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
