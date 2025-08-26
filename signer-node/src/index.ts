import express, { raw, Request, Response } from "express";
import { fetchAccount, Field, Poseidon, PrivateKey, PublicKey, Signature } from "o1js";
import {
    CalculateMax,
    emptyActionListHash,
    merkleActionsAdd,
    PulsarAction,
    setMinaNetwork,
    SettlementContract,
    TestUtils,
    ValidateReducePublicInput,
} from "pulsar-contracts";
import { validateActionQueue } from "pulsar-contracts";
import { signActionQueueLimiter } from "./rateLimit.js";
import {
    getSignature,
    isIpBlocked,
    registerInvalidAttempt,
    resetInvalidAttempts,
    saveSignature,
} from "./db.js";
import logger from "./logger.js";
import dotenv from "dotenv";
dotenv.config();

interface RawAction {
    actions: string[][];
    hash: string;
}

interface ProcessedAction {
    action: PulsarAction;
    hash: bigint;
}

interface SignRequest {
    actions: RawAction[];
    withdrawMapping: Record<string, unknown>;
}

interface SignResponse {
    isValid: boolean;
    mask: unknown;
}

interface ErrorResponse {
    error: string;
    details?: string;
}

function isValidSignRequest(body: unknown): body is SignRequest {
    if (!body || typeof body !== "object") {
        return false;
    }

    const req = body as Record<string, unknown>;

    if (!Array.isArray(req.actions)) {
        return false;
    }

    for (const action of req.actions) {
        if (!action || typeof action !== "object") {
            return false;
        }

        const rawAction = action as Record<string, unknown>;

        if (!Array.isArray(rawAction.actions) || typeof rawAction.hash !== "string") {
            return false;
        }

        for (const actionArray of rawAction.actions) {
            if (
                !Array.isArray(actionArray) ||
                !actionArray.every((item) => typeof item === "string")
            ) {
                return false;
            }
        }
    }

    if (!req.withdrawMapping || typeof req.withdrawMapping !== "object") {
        return false;
    }

    return true;
}

class ValidationError extends Error {
    constructor(message: string, public details?: string) {
        super(message);
        this.name = "ValidationError";
    }
}

class ProcessingError extends Error {
    constructor(message: string, public details?: string) {
        super(message);
        this.name = "ProcessingError";
    }
}

const minaPrivateKey: string | undefined = process.env.MINA_PRIVATE_KEY;
if (!minaPrivateKey) {
    throw new Error("Mina private key is not specified in environment variables");
}
const privateKey: PrivateKey = PrivateKey.fromBigInt(BigInt("0x" + minaPrivateKey));

const contractAddress: string = process.env.CONTRACT_ADDRESS || "";
if (!contractAddress) {
    throw new Error("Contract address is not specified in environment variables");
}
const contractInstance: SettlementContract = new SettlementContract(
    PublicKey.fromBase58(contractAddress)
);

const port: number = Number(process.env.PORT ?? 6000);

setMinaNetwork(process.env.MINA_NETWORK as "devnet" | "mainnet" | "lightnet");

const app = express();
app.use(express.json());

app.post(
    "/sign",
    async (
        req: Request<{}, SignResponse | ErrorResponse, unknown>,
        res: Response<SignResponse | ErrorResponse>
    ) => {
        try {
            if (!isValidSignRequest(req.body)) {
                throw new ValidationError(
                    "Invalid request format",
                    "Request must include 'actions' array and 'withdrawMapping' object"
                );
            }

            const { actions, withdrawMapping } = req.body;

            console.info(`Processing sign request with ${actions.length} actions`);

            const finalActionState: string = calculateFinalState(actions);
            console.info(`Calculated final action state: ${finalActionState}`);
            const { actions: typedActions, isValid } = validateActionQueue(
                actions,
                finalActionState
            );

            console.info(`Action queue validation result: isValid=${isValid}`);

            if (!typedActions || !Array.isArray(typedActions)) {
                throw new ProcessingError(
                    "Failed to validate action queue",
                    "Typed actions array is invalid"
                );
            }

            const actionHashMap: Map<string, number> = new Map();
            for (const action of typedActions) {
                const key: string = action.action.unconstrainedHash().toString();
                actionHashMap.set(key, (actionHashMap.get(key) ?? 0) + 1);
            }

            await fetchAccount({ publicKey: contractInstance.address });
            const { publicInput, mask } = CalculateMax(
                actionHashMap,
                contractInstance,
                typedActions
            );
            const signature: Signature = Signature.create(
                privateKey,
                publicInput.hash().toFields()
            );

            console.info(`Sign request completed successfully, isValid: ${isValid}`);

            const response: SignResponse = {
                isValid,
                mask,
            };

            res.json(response);
        } catch (error) {
            console.error("Error signing:", error);

            let errorResponse: ErrorResponse;

            if (error instanceof ValidationError) {
                errorResponse = {
                    error: "Validation failed",
                    details: error.details || error.message,
                };
                res.status(400).json(errorResponse);
            } else if (error instanceof ProcessingError) {
                errorResponse = {
                    error: "Processing failed",
                    details: error.details || error.message,
                };
                res.status(422).json(errorResponse);
            } else {
                errorResponse = {
                    error: "Internal server error",
                    details: error instanceof Error ? error.message : "Unknown error occurred",
                };
                res.status(500).json(errorResponse);
            }
        }
    }
);

app.listen(port, () => console.log(`Signer up on http://localhost:${port}/sign`));

function calculateFinalState(rawActions: RawAction[]): string {
    console.log(rawActions);
    if (rawActions.length === 0) {
        return emptyActionListHash.toString();
    }

    const actions: ProcessedAction[] = rawActions.map((action: RawAction, index: number) => {
        try {
            if (!action.actions[0] || !Array.isArray(action.actions[0])) {
                throw new ValidationError(
                    `Invalid action format at index ${index}`,
                    "Action must contain at least one action array"
                );
            }

            return {
                action: PulsarAction.fromRawAction(action.actions[0]),
                hash: BigInt(action.hash),
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            throw new ProcessingError(`Failed to process action at index ${index}`, errorMsg);
        }
    });

    // console.log("validating", actions);
    // for (let index = 0; index < actions.length; index++) {
    //     const action = actions[index];
    //     const computedHash: bigint = Poseidon.hash(action.action.toFields()).toBigInt();

    //     if (computedHash !== action.hash) {
    //         console.error(
    //             `Action hash mismatch at index ${index}: expected ${action.hash}, got ${computedHash}`
    //         );
    //         throw new ValidationError(
    //             `Hash mismatch at action index ${index}`,
    //             `Expected: ${action.hash}, Computed: ${computedHash}`
    //         );
    //     }
    // }

    let actionListHash = emptyActionListHash;
    for (const action of actions) {
        actionListHash = merkleActionsAdd(actionListHash, Field(action.hash));
    }

    return actionListHash.toString();
}
