import express from "express";
import { fetchAccount, Field, PrivateKey, PublicKey, Signature } from "o1js";
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

const minaPrivateKey = process.env.MINA_PRIVATE_KEY;
if (!minaPrivateKey) {
    throw new Error("Mina private key is not specified in environment variables");
}
const privateKey = PrivateKey.fromBigInt(BigInt("0x" + minaPrivateKey));
const publicKey = privateKey.toPublicKey();

const contractInstance = new SettlementContract(
    PublicKey.fromBase58(process.env.CONTRACT_ADDRESS || "")
);

const port = Number(process.env.PORT ?? 6000);

setMinaNetwork("lightnet");

const app = express();
app.use(express.json());

app.post("/sign", signActionQueueLimiter, async (req, res) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    // if (await isIpBlocked(ip)) {
    //     res.status(429).json({ error: "Too many invalid actions from your IP. Try again later." });
    // }

    const { blockHeight, actions } = req.body;
    if (!blockHeight || !actions)
        res.status(400).json({ error: "body must contain { blockHeight, actions }" });

    try {
        const finalActionState = calculateFinalState(actions);
        const { actions: typedActions, isValid } = validateActionQueue(actions, finalActionState);

        // if (!isValid) {
        //     await registerInvalidAttempt(ip);
        //     logger.warn(`Invalid action from IP ${ip}`);
        //     res.status(400).json({ error: "Invalid action(s) sent." });
        // }

        // await resetInvalidAttempts(ip);

        // const cachedSignature = await getSignature(blockHeight, finalActionState);

        // if (cachedSignature) {
        //     logger.info(
        //         `Returning cached signature for block ${blockHeight}, state ${finalActionState}`
        //     );
        //     res.json({
        //         blockHeight,
        //         validatorPubKey: publicKey.toBase58(),
        //         signature: cachedSignature,
        //     });
        // } else {
        const actionHashMap: Map<string, number> = new Map();
        for (const action of typedActions) {
            const key = action.action.unconstrainedHash().toString();
            actionHashMap.set(key, (actionHashMap.get(key) ?? 0) + 1);
        }
        await fetchAccount({ publicKey: contractInstance.address });
        const { publicInput } = CalculateMax(actionHashMap, contractInstance, typedActions);
        const signature = Signature.create(privateKey, publicInput.hash().toFields());

        // await saveSignature(blockHeight, finalActionState, signature.toBase58());

        res.json({
            blockHeight,
            validatorPubKey: publicKey.toBase58(),
            signature: JSON.stringify(signature.toJSON()),
        });
        // }
    } catch (error) {
        console.error("Error signing:", error);
        res.status(500).json({ error: "Failed to sign the request" });
    }
});

app.listen(port, () => console.log(`Signer up on http://localhost:${port}/sign`));

function calculateFinalState(
    rawActions: {
        actions: string[][];
        hash: string;
    }[]
): string {
    if (rawActions.length === 0) {
        return emptyActionListHash.toString();
    }

    const actions = rawActions.map((action) => {
        return {
            action: PulsarAction.fromRawAction(action.actions[0]),
            hash: BigInt(action.hash),
        };
    });

    actions.forEach((action, index) => {
        if (action.action.unconstrainedHash().toBigInt() !== action.hash) {
            logger.error(
                `Action hash mismatch at index ${index}: expected ${
                    action.hash
                }, got ${action.action.unconstrainedHash().toBigInt()}`
            );
            return emptyActionListHash.toString();
        }
    });

    let actionListHash = emptyActionListHash;
    for (const action of actions) {
        actionListHash = merkleActionsAdd(actionListHash, Field(action.hash));
    }

    return actionListHash.toString();
}
