import express, { Request, Response } from "express";
import { fetchAccount, Field, Poseidon, PrivateKey, PublicKey, Signature } from "o1js";
import {
    actionListAdd,
    CalculateMaxWithBalances,
    emptyActionListHash,
    merkleActionsAdd,
    PulsarAction,
    PulsarAuth,
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
import { getSignatureLimiter } from "./rateLimit.js";

dotenv.config();

interface PulsarActionData {
    public_key: string;
    amount: string;
    action_type: string;
    block_height: number;
}

interface VerifyActionListRequest {
    actions: PulsarActionData[];
    balances: { [key: string]: string };
    witness: string;
    settled_height: number;
    next_height: number;
}

interface ProcessedAction {
    action: PulsarAction;
    hash: bigint;
}

interface VerifyActionListResponse {
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
    validatorPublicKey?: string;
    signature?: string;
    publicInput?: string;
    mask?: boolean[];
    isValid?: boolean;
    cached: boolean;
}

interface CachedSignature {
    initialActionState: string;
    finalActionState: string;
    signature: string;
    publicInput: string;
    mask: boolean[];
    timestamp: Date;
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

function isValidVerifyActionListRequest(body: unknown): body is VerifyActionListRequest {
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

        const actionData = action as Record<string, unknown>;
        if (
            typeof actionData.public_key !== "string" ||
            typeof actionData.amount !== "string" ||
            typeof actionData.action_type !== "string" ||
            typeof actionData.block_height !== "number"
        ) {
            return false;
        }
    }

    return (
        req.balances != null &&
        typeof req.balances === "object" &&
        !Array.isArray(req.balances) &&
        typeof req.witness === "string" &&
        typeof req.settled_height === "number" &&
        typeof req.next_height === "number"
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
const publicKey: PublicKey = privateKey.toPublicKey();

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
    async (
        req: Request<{}, VerifyActionListResponse, unknown>,
        res: Response<VerifyActionListResponse>
    ) => {
        try {
            if (!isValidVerifyActionListRequest(req.body)) {
                throw new ValidationError(
                    "Invalid request format",
                    "Request must include 'actions' array, 'balances' object, 'witness' string, 'settled_height' number, and 'next_height' number"
                );
            }

            const { actions, balances } = req.body;
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
                    const response: VerifyActionListResponse = {
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

            const withdrawMapping: Map<string, number> = new Map();
            for (const [key, value] of Object.entries(balances)) {
                withdrawMapping.set(key, Number(value));
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

            const response: VerifyActionListResponse = {
                mask: mask.toJSON(),
            };

            res.json(response);
        } catch (error) {
            logger.error("Error signing:", error);
            const response: VerifyActionListResponse = {
                mask: [],
            };
            res.status(400).json(response);
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
                        validatorPublicKey: publicKey.toBase58(),
                        signature: cachedSignature.signature,
                        publicInput: cachedSignature.publicInput,
                        mask: cachedSignature.mask,
                        isValid: cachedSignature.isValid,
                        cached: true,
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

function validateActionList(rawActions: PulsarActionData[]): {
    actions: ProcessedAction[];
    finalActionState: string;
} {
    if (rawActions.length === 0) {
        return { actions: [], finalActionState: emptyActionListHash.toString() };
    }

    const actions: ProcessedAction[] = rawActions.map((action: PulsarActionData, index: number) => {
        let actionType: number;
        if (action.action_type === "deposit") {
            actionType = 1;
        } else {
            actionType = 2;
        }

        const pulsarAction = new PulsarAction({
            type: Field(actionType),
            account: PublicKey.fromBase58(action.public_key),
            amount: Field(action.amount),
            pulsarAuth: PulsarAuth.empty(),
        });

        return {
            action: pulsarAction,
            hash: Poseidon.hash(pulsarAction.toFields()).toBigInt(),
        };
    });

    let actionState = contractInstance.actionState.get();
    for (let index = 0; index < actions.length; index++) {
        const action = actions[index];
        actionState = merkleActionsAdd(
            actionState,
            actionListAdd(emptyActionListHash, action.action)
        );
    }

    return { actions, finalActionState: actionState.toString() };
}
