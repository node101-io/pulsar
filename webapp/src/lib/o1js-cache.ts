import type { Cache } from "o1js";

// o1js's Cache interface is synchronous, and there is no way to await inside
// read(). So the files are fetched up front into a Map and served from there.
// Only `string` entries exist to serve: prover keys are binary, and the
// generator drops them (scripts/generate-cache.mjs explains why that is free).

type CacheEntry = { header: string; data: string };

const CACHE_PATH = "/cache";

/**
 * Loads the prebuilt compilation cache. Returns undefined when it is not
 * deployed, in which case the caller should compile without one — slow, but
 * a missing cache should never be the difference between working and not.
 */
export async function loadO1jsCache(): Promise<Cache | undefined> {
  let names: string[];
  try {
    const res = await fetch(`${CACHE_PATH}/manifest.json`);
    if (!res.ok) return undefined;
    ({ files: names } = (await res.json()) as { files: string[] });
  } catch {
    return undefined;
  }

  const entries = new Map<string, CacheEntry>();
  await Promise.all(
    names.map(async (name) => {
      const [header, data] = await Promise.all([
        fetch(`${CACHE_PATH}/${name}.header`).then((res) => res.text()),
        fetch(`${CACHE_PATH}/${name}`).then((res) => res.text()),
      ]);
      entries.set(name, { header, data });
    }),
  );

  return {
    read({ persistentId, uniqueId, dataType }) {
      const entry = entries.get(persistentId);
      // uniqueId changes when the circuit does; a stale file must miss rather
      // than feed o1js the wrong keys.
      if (!entry || entry.header !== uniqueId) return undefined;
      if (dataType !== "string") return undefined;

      return new TextEncoder().encode(entry.data);
    },
    write() {},
    canWrite: false,
  };
}
