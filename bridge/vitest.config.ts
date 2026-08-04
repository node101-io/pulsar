import { defineConfig } from "vitest/config";

// Dummies exist only to satisfy the boot-time env gate (src/config/env.ts)
// when modules import it transitively; tests that CARE about an env value
// mock the env module with per-test values instead.
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
        include: ["src/**/*.test.ts"],
        exclude: ["src/**/*.integration.test.ts"],
        env: envGateDummies,
    },
});
