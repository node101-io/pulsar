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

        // REQUIRED: the single chain dependency. Everything the bridge asks
        // the Pulsar chain — validator set, vote-extension bodies and
        // signatures, adjudicated verdict leaves, the cumulative approval
        // root — travels over this one gRPC endpoint, and the chain's
        // verdicts are the only source of the reduce approval data
        // (the redesign deleted the approve-all escape hatch — a
        // local verdict cannot produce a signed root), so a bridge without
        // it cannot reduce at all.
        PULSAR_GRPC_ENDPOINT: z.string().min(1),
        // Ordered validator set for environments without a Pulsar chain
        // (lightnet). Shape is enforced here; resolveValidatorSetForRoot
        // still hash-gates it against the on-chain merkleListRoot.
        VALIDATOR_SET_OVERRIDE: validatorSetOverrideSchema.optional(),

        MAX_RETRY: z.coerce.number().int().positive().default(3),

        // Action pusher: the bridge process owns sending the periodic
        // MsgPushNewActions tx (decided with the chain team — no external
        // cron). Enabled only when BOTH the Tendermint RPC endpoint and the
        // signing key are set; a half-configuration is a boot error, checked
        // in startPusher, so a typo cannot silently disable adjudication.
        PULSAR_RPC_ENDPOINT: z.string().min(1).optional(),
        PULSAR_PRIVATE_KEY_HEX: z
            .string()
            .regex(/^[0-9a-fA-F]{64}$/, "64 hex chars (secp256k1 key)")
            .optional(),
        PULSAR_FEE_AMOUNT: z.coerce.number().int().positive().default(5000),
        PULSAR_FEE_DENOM: z.string().min(1).default("pmina"),
        PULSAR_GAS_LIMIT: z.coerce.number().int().positive().default(300000),
        PUSH_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

        NODE_ENV: z.string().min(1).default("development"),
        LOG_LEVEL: z.string().optional(),
        DOCKER_CONTAINER: z.string().optional(),
        HOSTNAME: z.string().optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
});
