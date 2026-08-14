// Publishes public/cache to R2, where CI builds fetch it from.
//
// Deploys run on Cloudflare's GitHub integration, which clones fresh —
// and public/cache is gitignored (40 MB of generated artifacts), so nothing
// a clone contains can provide it. This script is the hand-off: run
// `pnpm run cache:build && pnpm run cache:push` after anything that changes
// the circuits (contracts code, o1js version), and every CI build afterwards
// pulls the result via `pnpm run cache:pull`.
//
// One key, overwritten in place: the browser validates every entry against
// the live circuit's uniqueId (src/lib/o1js-cache.ts), so an outdated tarball
// degrades to a slow compile, never to wrong keys. Versioned keys would add
// bookkeeping to protect against a failure mode that cannot happen.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webappDir = fileURLToPath(new URL("..", import.meta.url));
const cacheDir = join(webappDir, "public", "cache");

if (!existsSync(join(cacheDir, "manifest.json"))) {
  console.error("public/cache/manifest.json is missing — run `pnpm run cache:build` first.");
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "pulsar-cache-push-"));
const tarball = join(scratch, "cache.tar.gz");

try {
  execFileSync("tar", ["-czf", tarball, "-C", join(webappDir, "public"), "cache"], {
    stdio: "inherit",
  });
  execFileSync(
    "npx",
    [
      "wrangler",
      "r2",
      "object",
      "put",
      "pulsar-webapp-cache/cache.tar.gz",
      "--file",
      tarball,
      "--remote",
    ],
    { stdio: "inherit", cwd: webappDir },
  );
  console.log("cache pushed — CI builds will pick it up via cache:pull");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
