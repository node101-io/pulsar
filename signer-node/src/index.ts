import express from "express";
import { PrivateKey, Signature } from "o1js";
import { TestUtils, ValidateReducePublicInput } from "pulsar-contracts";
import { validateActionQueue } from "pulsar-contracts/build/src/utils/reduceWitness";
import { signActionQueueLimiter } from "./rateLimit";

const minaPrivateKey = process.env.MINA_PRIVATE_KEY;
if (!minaPrivateKey) {
    throw new Error("Mina private key is not specified in environment variables");
}
const privateKey = PrivateKey.fromBase58(minaPrivateKey);
const publicKey = privateKey.toPublicKey();

const port = Number(process.env.PORT ?? 6000);

const app = express();
app.use(express.json());

app.post("/sign", signActionQueueLimiter, (req, res) => {
    const { blockHeight, actions } = req.body;
    if (!blockHeight || !actions)
        return res.status(400).json({ error: "body must contain { blockHeight, actions }" });

    try {
        const finalActionState = "IMPLEMENTATION_SPECIFIC_FINAL_STATE";
        const { actions: typedActions, isValid } = validateActionQueue(actions, finalActionState);
        const { publicInput } = TestUtils.CalculateFromMockActions(
            ValidateReducePublicInput.default, // Todo: use correct public input
            typedActions
        );
        const signature = Signature.create(privateKey, publicInput.hash().toFields());

        res.json({
            blockHeight,
            validatorPubKey: publicKey.toBase58(),
            signature: JSON.stringify(signature.toJSON()),
        });
    } catch (error) {
        console.error("Error signing:", error);
        res.status(500).json({ error: "Failed to sign the request" });
    }
});

app.listen(port, () => console.log(`Signer up on http://localhost:${port}/sign`));
