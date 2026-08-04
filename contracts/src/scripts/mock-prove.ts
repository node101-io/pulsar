/**
 * Fill INSTANT dummy proofs into a transaction instead of running the real
 * Pickles SNARK (30-60 min per tx without a compile cache). Only valid on
 * networks that never verify proof content (lightnet PROOF_LEVEL=none).
 *
 * This reaches into o1js internals because the public API cannot do it yet:
 * `Mina.transaction` on a Network hardcodes proofsEnabled=true when building
 * the transaction (mina.js Network.transaction → createTransaction without
 * the flag), so `tx.prove()` always runs the real prover; the instance's
 * `proofsEnabled` flag is only honored by `Transaction.fromJSON`, whose JSON
 * roundtrip does not carry the lazy-proof builder state. If o1js ever wires
 * `Network.proofsEnabled` through, replace every mockProve() call with
 * `network.proofsEnabled = false` + plain `tx.prove()` and delete this file.
 */

import { Mina } from 'o1js';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';

type BuiltTransaction = Awaited<ReturnType<typeof Mina.transaction>>;

export async function mockProve(tx: BuiltTransaction): Promise<void> {
  // Resolve the internal module RELATIVE TO the o1js main entry, so the one
  // deep path here survives package-store layouts (pnpm) — and dynamic
  // file-URL import sidesteps the package "exports" restriction.
  const require = createRequire(import.meta.url);
  const o1jsEntry = require.resolve('o1js');
  const accountUpdatePath = resolve(
    dirname(o1jsEntry),
    'lib/mina/v1/account-update.js'
  );
  const { addMissingProofs } = (await import(
    pathToFileURL(accountUpdatePath).href
  )) as {
    addMissingProofs: (
      command: unknown,
      options: { proofsEnabled: boolean }
    ) => Promise<{ zkappCommand: unknown }>;
  };

  const internal = tx as unknown as { transaction: unknown };
  const { zkappCommand } = await addMissingProofs(internal.transaction, {
    proofsEnabled: false,
  });
  internal.transaction = zkappCommand;
}
