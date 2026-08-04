import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Single boot-time gate for every environment variable the bridge reads:
// missing or malformed configuration fails HERE, at import — before Mongo
// connects or a multi-minute compile starts — instead of minutes later at
// first use. Modules read `env`, never process.env.

// Exported for direct schema tests: the env module itself is mocked wherever
// consumers need per-test values.
export const validatorSetOverrideSchema = z
    .string()
    .transform((raw, ctx) => {
        try {
            return JSON.parse(raw);
        } catch {
            ctx.addIssue({ code: "custom", message: "not valid JSON" });
            return z.NEVER;
        }
    })
    .pipe(
        z.array(
            z.object({
                minaPublicKey: z.string().min(1),
                power: z.string().min(1),
            }),
        ),
    );

export const env = createEnv({
    server: {
        MONGO_URI: z.string().min(1),
        MONGO_DB: z.string().min(1).default("pulsar-bridge"),

        REDIS_HOST: z.string().min(1).default("redis"),
        REDIS_PORT: z.coerce.number().int().positive().default(6379),
        REDIS_PASSWORD: z.string().optional(),

        MINA_NETWORK: z
            .enum(["lightnet", "devnet", "mainnet"])
            .default("lightnet"),
        CONTRACT_ADDRESS: z.string().min(1),
        MINA_PRIVATE_KEY: z.string().min(1),
        MINA_FEE: z.coerce.number().positive().default(1e8),

        // Comma-separated on the wire, a non-empty array everywhere in code.
        PULSAR_VALIDATOR_ENDPOINTS: z
            .string()
            .transform((s) =>
                s
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
            )
            .pipe(z.array(z.string()).min(1)),
        PULSAR_GRPC_ENDPOINT: z.string().optional(),
        // Ordered validator set for environments without a Pulsar chain
        // (lightnet). Shape is enforced here; resolveValidatorSetForRoot
        // still hash-gates it against the on-chain merkleListRoot.
        VALIDATOR_SET_OVERRIDE: validatorSetOverrideSchema.optional(),

        MAX_RETRY: z.coerce.number().int().positive().default(3),

        NODE_ENV: z.string().min(1).default("development"),
        LOG_LEVEL: z.string().optional(),
        DOCKER_CONTAINER: z.string().optional(),
        HOSTNAME: z.string().optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
});
