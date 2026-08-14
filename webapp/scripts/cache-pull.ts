// Fetches the prebuilt o1js compile cache into public/cache.
//
// The CI build's first step (`pnpm run build:ci`): Cloudflare's GitHub
// integration clones fresh, public/cache is gitignored, and generating it in
// CI would put six circuit compiles inside every deploy. So the cache is
// built once wherever `cache:push` last ran, and fetched here from R2's
// public bucket URL — public on purpose: the site serves these exact bytes
// to every visitor anyway.
//
// A failed fetch fails the build. Silently proceeding would ship the exact
// bug this pipeline exists to prevent: a site where every visitor compiles
// for four minutes and the only symptom is a console warning.

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_URL =
  "https://pub-9fa353d739b6495abe37e4ee9e0a0ae0.r2.dev/cache.tar.gz";

const webappDir = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(webappDir, "public");
const cacheDir = join(publicDir, "cache");

// Local runs may hold a newer cache straight out of cache:build — replacing
// it with the published one would silently test different bytes than the
// ones just generated.
if (existsSync(join(cacheDir, "manifest.json"))) {
  console.log("public/cache already present — keeping it (cache:build output wins locally)");
  process.exit(0);
}

rmSync(cacheDir, { recursive: true, force: true });
execFileSync("bash", ["-c", `curl -fsSL '${CACHE_URL}' | tar -xz -C '${publicDir}'`], {
  stdio: "inherit",
});

if (!existsSync(join(cacheDir, "manifest.json"))) {
  console.error("cache tarball unpacked but manifest.json is missing — re-run cache:push");
  process.exit(1);
}
console.log("compile cache pulled from R2");
