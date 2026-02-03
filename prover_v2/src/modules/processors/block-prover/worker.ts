import { ObjectId, WithId } from "mongodb";
import { BlockDoc, ProofEpochDoc } from "../../db/interfaces";
import { ProofStatus } from "../../db/types";
import { DB } from "../../db";
import { TIMEOUT_TIME_MS } from "../../utils/constants";
import logger from "../../../logger";

export async function worker(task: WithId<BlockDoc>) {
    const db = new DB();
    await db.initMongo();

    const height = task.height;

    const session = db.client.startSession();
    try {
        await session.withTransaction(async () => {
            // change proof epoch's specific proof slot to processing (preventing concurrency issues)
            await registerProofEpoch(height);

            const proofId = await createProof(db, task);

            if (height % 16 == 0) {
                await createProofEpoch(height, proofId);
            } else {
                const epoch = await setProofOnEpoch(db, height, proofId);
                if (epoch) {
                    await setBlockStatusDone(db, height);
                    logger.info(
                        `Set proof ${proofId.toHexString()} for block height ${height} in proof epoch ${epoch.height}.`,
                    );
                } else {
                    await db.proofsCol.findOneAndDelete({ _id: proofId });
                    logger.warn(
                        `Proof epoch slot was not in 'processing' status for block height ${height}. Deleted proof ${proofId.toHexString()}.`,
                    );
                }
            }
        });
    } finally {
        await session.endSession();
    }
}

async function createProof(db: DB, block: BlockDoc) {
    // TODO: create proof logic here

    const proof = await db.storeProof("test-proof-data");

    logger.info(
        `Created proof ${proof.toHexString()} for block ${block.height}`,
    );

    return proof; // return proof id
}

async function createProofEpoch(height: number, proofId: ObjectId) {
    const db = new DB();
    await db.initMongo();

    const epochHeight = height - (height % 16);

    await db.proofEpochsCol.findOneAndUpdate(
        { height: epochHeight },
        {
            $setOnInsert: {
                height: epochHeight,
                proofs: Array(31).fill(null),
                status: Array(16).fill("waiting" as ProofStatus),
                failCount: 0,
                timeoutAt: new Date(Date.now() + TIMEOUT_TIME_MS),
            },
            $set: {
                [`proofs.${height % 16}`]: proofId,
            },
        },
        { upsert: true },
    );

    logger.info(
        `Created proof epoch for height ${epochHeight} with proof for block ${height}`,
    );
}

/**
 * Change proof epoch's specific proof slot to 'processing' (preventing concurrency issues)
 **/
async function registerProofEpoch(height: number) {
    const db = new DB();
    await db.initMongo();

    await db.proofEpochsCol.updateOne(
        {
            height: height - (height % 16),
            [`status.${height % 16}`]: "waiting",
        },
        {
            $set: {
                [`status.${height % 16}`]: "processing",
            },
        },
    );
}

/**
 * Set proof ID on epoch for specific height
 * @param db Database instance
 * @param height Block height
 * @param proofId Proof ObjectId
 * @return Updated ProofEpochDoc or null if not found
 */
async function setProofOnEpoch(
    db: DB,
    height: number,
    proofId: ObjectId,
): Promise<WithId<ProofEpochDoc> | null> {
    return db.proofEpochsCol.findOneAndUpdate(
        {
            height: height - (height % 16),
            [`status.${height % 16}`]: "processing",
        },
        {
            $set: {
                [`proofs.${height % 16}`]: proofId,
                [`status.${height % 16}`]: "done" as ProofStatus,
            },
        },
    );
}

async function setBlockStatusDone(db: DB, height: number) {
    await db.blocksCol.findOneAndUpdate(
        {
            height: height,
            status: { $ne: "done" },
        },
        {
            $set: {
                status: "done",
            },
        },
    );
}
