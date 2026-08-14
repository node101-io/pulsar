// Refuses to deploy a build with no compile cache in it.
//
// public/cache is gitignored (40 MB of generated artifacts) and produced only
// by `pnpm run cache:build` — nothing in the build pipeline creates it. So a
// deploy from a fresh clone, or after a cleanup, ships a site where every
// visitor compiles the circuits from scratch: about four minutes instead of
// sixteen seconds, and the only symptom is a console warning nobody reads.
// That happened; this check is why it does not happen again.
//
// Staleness is deliberately NOT checked here. Each cache entry's header is the
// circuit's own uniqueId, and the browser cache misses on mismatch (see
// src/lib/o1js-cache.ts) — a stale cache degrades to a slow compile, never to
// wrong keys. Absence is the only failure mode that needs a gate.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const manifest = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "out",
  "cache",
  "manifest.json",
);

if (!existsSync(manifest)) {
  console.error(
    "\nout/cache/manifest.json is missing — this build would ship without the " +
      "o1js compile cache, and every visitor would compile for ~4 minutes." +
      "\nRun `pnpm run cache:build` (writes public/cache), then rebuild.\n",
  );
  process.exit(1);
}

const { files } = JSON.parse(readFileSync(manifest, "utf8")) as { files?: unknown };
if (!Array.isArray(files) || files.length === 0) {
  console.error("out/cache/manifest.json lists no files — regenerate with `pnpm run cache:build`.");
  process.exit(1);
}

console.log(`compile cache present: ${files.length} entries`);
