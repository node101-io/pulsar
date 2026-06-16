import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.integration.test.ts"],
        testTimeout: 60_000, // archive/node calls can be slow
        hookTimeout: 300_000, // ZkProgram Wasm init on first import can take minutes
    },
});
