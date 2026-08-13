import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Cross-origin isolation. o1js proves with a shared WebAssembly.Memory, which
// is a SharedArrayBuffer, which the browser only hands to an isolated page —
// without these the deposit flow cannot compile a circuit.
//
// In production these are served by Cloudflare from public/_headers, because
// output: "export" drops headers() entirely. KEEP THE TWO IN SYNC: if this
// list changes, change public/_headers with it.
const ISOLATION_HEADERS = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

/** @type {(phase: string) => import('next').NextConfig} */
export default function config(phase) {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    // Dev and the production export cannot share a build directory: the export
    // writes prerendered pages that the dev server then tries to serve, and it
    // crashes reading them. Separate directories mean `pnpm dev` and
    // `pnpm preview` can be run in any order without a manual clean.
    distDir: isDev ? ".next-dev" : ".next",

    // Deployed to Cloudflare Workers as static assets — no Next server at
    // runtime. The dev server is a real server, so it can do the redirect and
    // the headers itself; the export cannot, and defers both to Cloudflare.
    ...(isDev
      ? {
          async redirects() {
            return [{ source: "/", destination: "/bridge", permanent: false }];
          },
          async headers() {
            return [{ source: "/:path*", headers: ISOLATION_HEADERS }];
          },
        }
      : { output: "export" }),

    images: {
      unoptimized: true,
    },
    // o1js only ever runs in the browser (proving needs SharedArrayBuffer) but
    // its dynamic imports still put dist/node in the server graph, where the
    // wasm bindings' computed require() is unanalysable. Externalising it
    // keeps it out; nothing evaluates it during prerender.
    serverExternalPackages: ["o1js"],
    webpack: (config, { webpack }) => {
      // libsodium-sumo uses top-level await. Without this webpack decides the
      // target cannot run async functions, emits the async-module startup
      // runtime anyway, and the mismatch throws "Cannot read properties of
      // undefined (reading 'length')" while the page module is still
      // evaluating. Every browser that can run o1js (SharedArrayBuffer, wasm)
      // has had async functions for years, and the server is Node.
      config.output.environment = {
        ...config.output.environment,
        asyncFunction: true,
      };

      // Allow imports that end with .js to resolve to .ts/.tsx during build
      config.resolve.extensionAlias = {
        ...(config.resolve.extensionAlias || {}),
        ".js": [".ts", ".tsx", ".js"],
        ".mjs": [".mts", ".mjs"],
        ".cjs": [".cts", ".cjs"],
      };

      // libsodium-wrappers-sumo's ESM build imports "./libsodium-sumo.mjs" as a
      // sibling, but that file ships in the separate libsodium-sumo package — a
      // dependency it does declare, so only the relative path is wrong. Rewrite
      // it to the bare specifier and webpack resolves it from the wrapper's own
      // node_modules; no direct dependency here, nothing pinned to a path.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^\.\/libsodium-sumo\.mjs$/,
          (resource) => {
            resource.request = "libsodium-sumo";
          },
        ),
      );

      return config;
    },
  };
}
