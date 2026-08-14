// Builds the o1js compilation cache the browser downloads instead of deriving.
//
// Cold compilation is ~4 minutes; with this cache it is ~16 seconds. Only the
// entries o1js marks `dataType: "string"` are kept — the prover keys are
// binary, and a browser cache cannot return them (see src/lib/o1js-cache.ts).
// Dropping them costs nothing measurable: they are cheap to derive, unlike the
// SRS and Lagrange bases, which are what the four minutes actually go on.
//
// Run from webapp/: pnpm run cache:build

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Cache, type CacheHeader } from "o1js";
import {
  ActionStackProgram,
  ApprovalQuorumProgram,
  ApprovalTailProgram,
  MultisigVerifierProgram,
  SettleAttestProgram,
  SettlementContract,
} from "pulsar-contracts";

const webappDir = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(webappDir, "public", "cache");
const MANIFEST = join(OUT_DIR, "manifest.json");

type Compilable = { compile(options: { cache: Cache }): Promise<unknown> };

// Same order and set as src/lib/worker.ts. A circuit missing here compiles
// from scratch in the browser.
const CIRCUITS: [string, Compilable][] = [
  ["MultisigVerifierProgram", MultisigVerifierProgram],
  ["SettleAttestProgram", SettleAttestProgram],
  ["ApprovalTailProgram", ApprovalTailProgram],
  ["ApprovalQuorumProgram", ApprovalQuorumProgram],
  ["ActionStackProgram", ActionStackProgram],
  ["SettlementContract", SettlementContract],
];

// Wrapped instead of top-level await: without `"type": "module"` in
// package.json, tsx lowers .ts files to CJS, where top-level await cannot
// exist.
async function main() {
  const scratch = mkdtempSync(join(tmpdir(), "pulsar-o1js-cache-"));

  try {
    const fsCache = Cache.FileSystem(scratch);

    // o1js hands the header to write(), which is the only place the data type is
    // stated. Recording it here beats guessing from file names.
    const dataTypes = new Map<string, CacheHeader["dataType"]>();
    const recording: Cache = {
      read: (header) => fsCache.read(header),
      write(header, data) {
        dataTypes.set(header.persistentId, header.dataType);
        fsCache.write(header, data);
      },
      canWrite: true,
    };

    for (const [name, circuit] of CIRCUITS) {
      const started = Date.now();
      await circuit.compile({ cache: recording });
      console.log(`compiled ${name} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }

    rmSync(OUT_DIR, { recursive: true, force: true });
    mkdirSync(OUT_DIR, { recursive: true });

    const kept: string[] = [];
    let bytes = 0;
    for (const [persistentId, dataType] of dataTypes) {
      if (dataType !== "string") continue;

      const data = join(scratch, persistentId);
      const header = `${data}.header`;
      if (!existsSync(data) || !existsSync(header)) continue;

      copyFileSync(data, join(OUT_DIR, persistentId));
      copyFileSync(header, join(OUT_DIR, `${persistentId}.header`));
      kept.push(persistentId);
      bytes += statSync(data).size + statSync(header).size;
    }

    kept.sort();
    writeFileSync(MANIFEST, `${JSON.stringify({ files: kept }, null, 2)}\n`);

    const skipped = dataTypes.size - kept.length;
    console.log(
      `\nwrote ${kept.length} entries (${(bytes / 1024 / 1024).toFixed(1)} MB) to public/cache, skipped ${skipped} binary`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
