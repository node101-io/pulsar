import pino from "pino";
import { env } from "../config/env.js";

const isProduction = env.NODE_ENV === "production";
const isDocker = !!env.DOCKER_CONTAINER;

// pino's err serializer natively handles what winston never did: an Error
// attached to the log metadata (message/stack are non-enumerable, so plain
// JSON serialization yields {}). The `error` key is the codebase-wide
// convention for attaching one; cause chains are unwrapped too.
const base = pino({
    level: env.LOG_LEVEL || (isProduction ? "info" : "debug"),
    base: {
        service: "pulsar-bridge",
        environment: env.NODE_ENV,
        container: env.HOSTNAME || "local",
    },
    serializers: {
        error: pino.stdSerializers.errWithCause,
    },
    transport:
        !isDocker && !isProduction ? { target: "pino-pretty" } : undefined,
});

// Call sites use the (message, meta) order; pino natively takes (meta, message).
function level(name: "info" | "warn" | "error" | "debug") {
    return (message: string, meta?: Record<string, unknown>) =>
        base[name](meta ?? {}, message);
}

export default {
    info: level("info"),
    warn: level("warn"),
    error: level("error"),
    debug: level("debug"),
};
