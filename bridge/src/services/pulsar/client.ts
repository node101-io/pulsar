import { Signature, PublicKey } from "../../../../contracts/build/src/utils/o1jsExports.js";
import logger from "../../common/logger.js";

export interface ValidatorSignature {
    validatorPublicKey: PublicKey;
    signature: Signature;
}

// PULSAR_VALIDATOR_ENDPOINTS=http://v1:6000,http://v2:6000,...
function getValidatorEndpoints(): string[] {
    const raw = process.env.PULSAR_VALIDATOR_ENDPOINTS ?? "";
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

export async function requestSignatures(
    initialActionState: string,
    finalActionState: string,
): Promise<ValidatorSignature[]> {
    const endpoints = getValidatorEndpoints();
    if (endpoints.length === 0)
        throw new Error("PULSAR_VALIDATOR_ENDPOINTS is not set");

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
