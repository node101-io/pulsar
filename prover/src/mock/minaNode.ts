import express from "express";
import { Signature } from "o1js";
import { PulsarAction, TestUtils, ValidateReducePublicInput, validatorSet } from "pulsar-contracts";

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
        console.error("Error signing:", error);
        res.status(500).json({ error: "Failed to sign the request" });
    }
});

app.listen(port, () => console.log(`Validator ${index} up on http://localhost:${port}/sign`));
