import { defineConfig } from "vitest/config";

// Same role as in vitest.config.ts: satisfy the boot-time env gate; the
// integration tests exercise real proofs, not real chain endpoints.
const envGateDummies = {
    MONGO_URI: "mongodb://127.0.0.1:27017",
    CONTRACT_ADDRESS: "B62qTestContractAddress",
    MINA_PRIVATE_KEY: "EKETestPrivateKey",
    PULSAR_VALIDATOR_ENDPOINTS: "http://localhost:7100",
    NODE_ENV: "test",
};

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.integration.test.ts"],
        testTimeout: 60_000,
        hookTimeout: 300_000,
        pool: "forks",
        env: envGateDummies,
    },
});
