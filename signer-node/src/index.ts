import express, { Request, Response } from "express";
import { fetchAccount, PrivateKey, PublicKey, Signature } from "o1js";
import {
    actionListAdd,
    CalculateMaxWithBalances,
    emptyActionListHash,
    merkleActionsAdd,
    PulsarAction,
    setMinaNetwork,
    SettlementContract,
} from "pulsar-contracts";
import {
    getSignature,
    initMongo,
    isIpBlocked,
    registerInvalidAttempt,
    resetInvalidAttempts,
    saveSignature,
} from "./db.js";
import logger from "./logger.js";
import dotenv from "dotenv";
import { getSignatureLimiter, localhostOnly } from "./rateLimit.js";

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
    withdrawMapping: Map<string, number>;
}

interface SignResponse {
    isValid: boolean;
    mask: boolean[];
}

interface ErrorResponse {
    error: string;
    details?: string;
}

interface GetSignatureRequest {
    initialActionState: string;
    finalActionState: string;
}

interface GetSignatureResponse {
    signature?: string;
    publicInput?: string;
    mask?: boolean[];
    isValid?: boolean;
    cached: boolean;
    timestamp?: string;
}

interface CachedSignature {
    initialActionState: string;
    finalActionState: string;
    signature: string;
    publicInput: string;
    mask: boolean[];
    timestamp: Date;
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

function isValidGetSignatureRequest(body: unknown): body is GetSignatureRequest {
    if (!body || typeof body !== "object") {
        return false;
    }

    const req = body as Record<string, unknown>;
    return (
        typeof req.initialActionState === "string" &&
        req.initialActionState.length > 0 &&
        typeof req.finalActionState === "string" &&
        req.finalActionState.length > 0
    );
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

initMongo().catch((error) => {
    logger.error("Failed to initialize MongoDB:", error);
    process.exit(1);
});

app.post(
    "/sign",
    localhostOnly,
    async (req: Request<{}, SignResponse, unknown>, res: Response<SignResponse>) => {
        try {
            if (!isValidSignRequest(req.body)) {
                throw new ValidationError(
                    "Invalid request format",
                    "Request must include 'actions' array and 'withdrawMapping' object"
                );
            }

            const { actions, withdrawMapping } = req.body;
            await fetchAccount({ publicKey: contractInstance.address });
            const initialActionState = contractInstance.actionState.get().toString();

            logger.info(`Processing sign request with ${actions.length} actions`);
            logger.info(`Initial action state: ${initialActionState}`);

            const { finalActionState, actions: typedActions } = validateActionList(actions);
            logger.info(`Calculated final action state: ${finalActionState}`);

            try {
                const cachedSignature = await getSignature(initialActionState, finalActionState);
                if (cachedSignature) {
                    logger.info("Returning cached signature");
                    const response: SignResponse = {
                        isValid: true,
                        mask: cachedSignature.mask,
                    };
                    return res.json(response);
                }
            } catch (cacheError) {
                logger.warn("Cache lookup failed, proceeding with calculation:", cacheError);
            }

            if (!typedActions || !Array.isArray(typedActions)) {
                throw new ProcessingError(
                    "Failed to validate action queue",
                    "Typed actions array is invalid"
                );
            }

            await fetchAccount({ publicKey: contractInstance.address });
            const { publicInput, mask } = CalculateMaxWithBalances(
                withdrawMapping,
                contractInstance,
                typedActions
            );
            const signature: Signature = Signature.create(
                privateKey,
                publicInput.hash().toFields()
            );

            try {
                const initialActionState = contractInstance.actionState.get().toString();
                const cacheData: CachedSignature = {
                    initialActionState,
                    finalActionState,
                    signature: signature.toBase58(),
                    publicInput: JSON.stringify(publicInput.toJSON()),
                    mask: mask.toJSON(),
                    timestamp: new Date(),
                };
                await saveSignature(initialActionState, finalActionState, cacheData);
                logger.info("Signature cached successfully");
            } catch (saveError) {
                logger.error("Failed to cache signature:", saveError);
            }

            const response: SignResponse = {
                isValid: true,
                mask: mask.toJSON(),
            };

            res.json(response);
        } catch (error) {
            logger.error("Error signing:", error);
            const response: SignResponse = {
                isValid: false,
                mask: [],
            };
            res.status(400).json(response);

            // let errorResponse: ErrorResponse;

            // if (error instanceof ValidationError) {
            //     errorResponse = {
            //         error: "Validation failed",
            //         details: error.details || error.message,
            //     };
            //     res.status(400).json(errorResponse);
            // } else if (error instanceof ProcessingError) {
            //     errorResponse = {
            //         error: "Processing failed",
            //         details: error.details || error.message,
            //     };
            //     res.status(422).json(errorResponse);
            // } else {
            //     errorResponse = {
            //         error: "Internal server error",
            //         details: error instanceof Error ? error.message : "Unknown error occurred",
            //     };
            //     res.status(500).json(errorResponse);
            // }
        }
    }
);

app.post(
    "/getSignature",
    getSignatureLimiter,
    async (
        req: Request<{}, GetSignatureResponse | ErrorResponse, unknown>,
        res: Response<GetSignatureResponse | ErrorResponse>
    ) => {
        try {
            if (!isValidGetSignatureRequest(req.body)) {
                throw new ValidationError(
                    "Invalid request format",
                    "Request must include 'initialActionState' and 'finalActionState' strings"
                );
            }

            const { initialActionState, finalActionState } = req.body;
            logger.info(
                `Looking up cached signature for states: ${initialActionState} -> ${finalActionState}`
            );

            const clientIp = req.ip || req.socket.remoteAddress || "unknown";
            if (await isIpBlocked(clientIp)) {
                logger.warn(`Blocked request from IP: ${clientIp}`);
                const errorResponse: ErrorResponse = {
                    error: "Access denied",
                    details: "Too many invalid attempts. Please try again later.",
                };
                return res.status(429).json(errorResponse);
            }

            try {
                const cachedSignature = await getSignature(initialActionState, finalActionState);

                if (cachedSignature) {
                    logger.info("Found cached signature");
                    const response: GetSignatureResponse = {
                        signature: cachedSignature.signature,
                        publicInput: cachedSignature.publicInput,
                        mask: cachedSignature.mask,
                        isValid: cachedSignature.isValid,
                        cached: true,
                        timestamp: cachedSignature.timestamp.toISOString(),
                    };

                    await resetInvalidAttempts(clientIp);
                    return res.json(response);
                }

                logger.info("No cached signature found");
                const response: GetSignatureResponse = {
                    cached: false,
                };
                return res.json(response);
            } catch (dbError) {
                logger.error("Database error:", dbError);
                await registerInvalidAttempt(clientIp);
                throw new ProcessingError("Failed to lookup signature", "Database error occurred");
            }
        } catch (error) {
            logger.error("Error in getSignature:", error);

            let errorResponse: ErrorResponse;
            const clientIp = req.ip || req.socket.remoteAddress || "unknown";

            if (error instanceof ValidationError) {
                await registerInvalidAttempt(clientIp);
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

app.listen(port, () => console.log(`Signer up on http://localhost:${port}`));

function validateActionList(rawActions: RawAction[]): {
    actions: ProcessedAction[];
    finalActionState: string;
} {
    if (rawActions.length === 0) {
        return { actions: [], finalActionState: emptyActionListHash.toString() };
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

    let actionState = contractInstance.actionState.get();
    for (let index = 0; index < actions.length; index++) {
        const action = actions[index];
        actionState = merkleActionsAdd(
            actionState,
            actionListAdd(emptyActionListHash, action.action)
        );

        if (actionState.toBigInt() !== action.hash) {
            console.error(
                `Action hash mismatch at index ${index}: expected ${
                    action.hash
                }, got ${actionState.toBigInt()}`
            );
            throw new ValidationError(
                `Hash mismatch at action index ${index}`,
                `Expected: ${action.hash}, Computed: ${actionState.toBigInt()}`
            );
        }
    }

    return { actions, finalActionState: actionState.toString() };
}
