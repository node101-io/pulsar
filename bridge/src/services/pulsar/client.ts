import { PublicKey, Signature } from "o1js";
import logger from "../../common/logger.js";
import { env } from "../../config/env.js";

export interface ValidatorSignature {
    validatorPublicKey: PublicKey;
    signature: Signature;
}

export async function requestSignatures(
    initialActionState: string,
    finalActionState: string,
): Promise<ValidatorSignature[]> {
    // Parsed and non-empty by the boot-time env gate.
    const endpoints = env.PULSAR_VALIDATOR_ENDPOINTS;

    const results = await Promise.allSettled(
        endpoints.map((url) =>
            fetchSignatureFromValidator(url, initialActionState, finalActionState),
        ),
    );

    const signatures: ValidatorSignature[] = [];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") {
            signatures.push(r.value);
        } else {
            logger.warn("Validator signature request failed", {
                endpoint: endpoints[i],
                error: r.reason,
                event: "validator_sig_failed",
            });
        }
    }

    if (signatures.length === 0)
        throw new Error("No validator signatures received");

    return signatures;
}

async function fetchSignatureFromValidator(
    baseUrl: string,
    initialActionState: string,
    finalActionState: string,
): Promise<ValidatorSignature> {
    const res = await fetch(`${baseUrl}/getSignature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initialActionState, finalActionState }),
    });

    if (!res.ok)
        throw new Error(`HTTP ${res.status} from ${baseUrl}`);

    const data = (await res.json()) as {
        validatorPublicKey: string;
        signature: string;
    };

    return {
        validatorPublicKey: PublicKey.fromBase58(data.validatorPublicKey),
        signature: Signature.fromBase58(data.signature),
    };
}
