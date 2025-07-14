import express from "express";
import { PrivateKey, Signature } from "o1js";
import { TestUtils, ValidateReducePublicInput } from "pulsar-contracts";
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

const minaPrivateKey = process.env.MINA_PRIVATE_KEY;
if (!minaPrivateKey) {
    throw new Error("Mina private key is not specified in environment variables");
}
const privateKey = PrivateKey.fromBase58(minaPrivateKey);
const publicKey = privateKey.toPublicKey();

const port = Number(process.env.PORT ?? 6000);

const app = express();
app.use(express.json());

app.post("/sign", signActionQueueLimiter, async (req, res) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    if (await isIpBlocked(ip)) {
        res.status(429).json({ error: "Too many invalid actions from your IP. Try again later." });
    }

    const { blockHeight, actions } = req.body;
    if (!blockHeight || !actions)
        res.status(400).json({ error: "body must contain { blockHeight, actions }" });

    try {
        const finalActionState = "IMPLEMENTATION_SPECIFIC_FINAL_STATE";
        const { actions: typedActions, isValid } = validateActionQueue(actions, finalActionState);

        if (!isValid) {
            await registerInvalidAttempt(ip);
            logger.warn(`Invalid action from IP ${ip}`);
            res.status(400).json({ error: "Invalid action(s) sent." });
        }

        await resetInvalidAttempts(ip);

        const cachedSignature = await getSignature(blockHeight, finalActionState);

        if (cachedSignature) {
            logger.info(
                `Returning cached signature for block ${blockHeight}, state ${finalActionState}`
            );
            res.json({
                blockHeight,
                validatorPubKey: publicKey.toBase58(),
                signature: cachedSignature,
            });
        } else {
            const { publicInput } = TestUtils.CalculateFromMockActions(
                ValidateReducePublicInput.default, // Todo: use correct public input
                typedActions
            );
            const signature = Signature.create(privateKey, publicInput.hash().toFields());

            await saveSignature(blockHeight, finalActionState, signature.toBase58());

            res.json({
                blockHeight,
                validatorPubKey: publicKey.toBase58(),
                signature: JSON.stringify(signature.toJSON()),
            });
        }
    } catch (error) {
        console.error("Error signing:", error);
        res.status(500).json({ error: "Failed to sign the request" });
    }
});

app.listen(port, () => console.log(`Signer up on http://localhost:${port}/sign`));
