import { Mina, Poseidon, PrivateKey, PublicKey } from 'o1js';

export { generateKeys, generateKeysAndSort, fundKeys };

async function generateKeys(numKeys: number): Promise<{
  keys: Array<{
    privateKey: PrivateKey;
    publicKey: PublicKey;
  }>;
}> {
  const keys = [];
  for (let i = 0; i < numKeys; i++) {
    const privateKey = PrivateKey.random();
    const publicKey = privateKey.toPublicKey();
    keys.push({ privateKey, publicKey });
  }
  return { keys };
}

async function generateKeysAndSort(numKeys: number): Promise<{
  keys: Array<{
    privateKey: PrivateKey;
    publicKey: PublicKey;
  }>;
}> {
  const { keys } = await generateKeys(numKeys);
  keys.sort((a, b) => {
    const aHash = Poseidon.hash(a.publicKey.toFields());
    const bHash = Poseidon.hash(b.publicKey.toFields());
    return aHash.toBigInt() < bHash.toBigInt() ? -1 : 1;
  });
  return { keys };
}

async function fundKeys(
  keys: Array<{ privateKey: PrivateKey; publicKey: PublicKey }>,
  network: string = 'https://api.minascan.io/node/devnet/v1/graphql'
): Promise<void> {
  Promise.all(
    keys.map(async ({ publicKey }) => {
      Mina.faucet(publicKey, network)
        .then(() => {
          console.log(`Funded ${publicKey.toBase58()}`);
        })
        .catch((error) => {
          console.error(`Error funding ${publicKey.toBase58()}:`, error);
        });
    })
  );
}

async function printKeys(
  keys: Array<{ privateKey: PrivateKey; publicKey: PublicKey }>
): Promise<void> {
  for (const { privateKey, publicKey } of keys) {
    console.log(
      `[PrivateKey.fromBase58("${privateKey.toBase58()}"), PublicKey.fromBase58("${publicKey.toBase58()}")],`
    );
  }
}

async function generateValidatorKeys(numKeys: number): Promise<void> {
  const { keys } = await generateKeysAndSort(numKeys);
  await printKeys(keys);
}

await generateValidatorKeys(60);
