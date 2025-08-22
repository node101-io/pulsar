import express from "express";
import { Signature } from "o1js";
import { PulsarAction, TestUtils, ValidateReducePublicInput, validatorSet } from "pulsar-contracts";
import logger from "../logger.js";

const index = Number(process.env.VALIDATOR_INDEX ?? 0);
const [priv, pub] = validatorSet[index];
const port = Number(process.env.PORT ?? 6000 + index);

const app = express();
app.use(express.json());

app.post("/sign", (req, res) => {
    const { blockHeight, actions } = req.body;
    if (!blockHeight || !actions)
        return res.status(400).json({ error: "body must contain { blockHeight, actions }" });

    try {
        const typedActions = actions.map((action: { actions: string[][]; hash: string }) => {
            return {
                action: PulsarAction.fromRawAction(action.actions[0]),
                hash: BigInt(action.hash),
            };
        });
        const { publicInput } = TestUtils.CalculateFromMockActions(
            ValidateReducePublicInput.default, // Todo: use correct public input
            typedActions
        );
        const signature = Signature.create(priv, publicInput.hash().toFields());

        res.json({
            blockHeight,
            validatorPubKey: pub.toBase58(),
            signature: JSON.stringify(signature.toJSON()),
        });
    } catch (error) {
        logger.error("Error signing request", error, {
            blockHeight,
            validatorIndex: index,
            event: "mock_signing_error"
        });
        res.status(500).json({ error: "Failed to sign the request" });
    }
});

app.listen(port, () => logger.info(`Mock validator ${index} up on http://localhost:${port}/sign`, {
    validatorIndex: index,
    port,
    publicKey: pub.toBase58(),
    event: "mock_validator_started"
}));
