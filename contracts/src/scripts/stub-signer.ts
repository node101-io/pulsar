/**
 * Lightnet stub signer — stands in for a Pulsar validator's /getSignature.
 *
 * The circuit verifies signatures over ValidateReducePublicInput.hash()
 * (merkleListRoot + batch-folded actionListHash), but the request payload only
 * carries (initialActionState, finalActionState) — so the signer must derive
 * the message itself, exactly like a real validator would: read the contract
 * state, refold the pending queue with the same approve-all map the bridge
 * worker uses, and sign the resulting public input hash.
 *
 * Usage:
 *   CONTRACT_ADDRESS=B62... VALIDATOR_PRIVATE_KEY=EKE... \
 *     node build/src/scripts/stub-signer.js [port]
 */

import http from 'http';
import { Field, PrivateKey, PublicKey, Signature, fetchAccount } from 'o1js';
import { SettlementContract } from '../SettlementContract.js';
import { setMinaNetwork, fetchActions } from '../utils/fetch.js';
import { CalculateMax } from '../utils/reduceWitness.js';
import { CalculateFinalActionState } from '../utils/actionQueueUtils.js';

const PORT = Number(process.argv[2] ?? process.env.STUB_SIGNER_PORT ?? 6000);

const contractAddressStr = process.env.CONTRACT_ADDRESS;
const validatorKeyStr = process.env.VALIDATOR_PRIVATE_KEY;
if (!contractAddressStr || !validatorKeyStr) {
  console.error('CONTRACT_ADDRESS and VALIDATOR_PRIVATE_KEY must be set');
  process.exit(1);
}

const network = process.env.MINA_NETWORK ?? 'lightnet';
if (network !== 'devnet' && network !== 'mainnet' && network !== 'lightnet') {
  console.error(`Invalid MINA_NETWORK "${network}"`);
  process.exit(1);
}
setMinaNetwork(network);
const contractAddress = PublicKey.fromBase58(contractAddressStr);
const validatorKey = PrivateKey.fromBase58(validatorKeyStr);
const contract = new SettlementContract(contractAddress);

async function handleGetSignature(body: {
  initialActionState: string;
  finalActionState: string;
}) {
  await fetchAccount({ publicKey: contractAddress });

  const packed = await fetchActions(
    contractAddress,
    Field(body.initialActionState)
  );
  if (packed.length === 0) {
    throw new Error(
      `no pending actions from ${body.initialActionState} — nothing to sign`
    );
  }

  // Integrity check a real validator would also run: the requested range must
  // refold to the claimed final state, otherwise we are signing over a
  // different queue than the requester saw.
  const computedTip = CalculateFinalActionState(
    Field(body.initialActionState),
    packed.map((pack) => pack.action)
  ).toString();
  if (computedTip !== body.finalActionState) {
    throw new Error(
      `refolded tip ${computedTip} != requested finalActionState ${body.finalActionState}`
    );
  }

  // Approve-all map — mirrors the bridge worker's placeholder policy so both
  // sides fold the identical batch (and therefore the identical publicInput).
  const includedActions = new Map<string, number>();
  for (const pack of packed) {
    const hash = pack.action.unconstrainedHash().toString();
    includedActions.set(hash, (includedActions.get(hash) ?? 0) + 1);
  }

  const { publicInput } = CalculateMax(includedActions, contract, packed);

  const signature = Signature.create(
    validatorKey,
    publicInput.hash().toFields()
  );

  console.log(
    `signed reduce: from=${body.initialActionState.slice(0, 12)}… ` +
      `actions=${packed.length} actionListHash=${publicInput.actionListHash.toString().slice(0, 12)}…`
  );

  return {
    validatorPublicKey: validatorKey.toPublicKey().toBase58(),
    signature: signature.toBase58(),
  };
}

http
  .createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/getSignature') {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const result = await handleGetSignature(
          JSON.parse(Buffer.concat(chunks).toString())
        );
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('getSignature failed:', message);
        res
          .writeHead(500, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: message }));
      }
    });
  })
  // Loopback only: this process holds a validator private key and signs
  // anything that refolds — it must never be reachable from the network.
  .listen(PORT, '127.0.0.1', () => {
    console.log(
      `stub signer on 127.0.0.1:${PORT} — validator ${validatorKey.toPublicKey().toBase58()}`
    );
  });
