import { ObjectId, WithId } from "mongodb";
import { BlockDoc, ProofEpochDoc } from "../../db/interfaces";
import { ProofKind, ProofStatus } from "../../db/types";
import { DB } from "../../db";
import { TIMEOUT_TIME_MS, PROOF_EPOCH_SIZE } from "../../utils/constants";
import logger from "../../../logger";

export async function worker(task: WithId<BlockDoc>) {
    const db = new DB();
    await db.initMongo();

    const proofEpochHeight =
        Math.floor(task.height / PROOF_EPOCH_SIZE) * PROOF_EPOCH_SIZE;

    const session = db.client.startSession();
    try {
        await session.withTransaction(async () => {
            await registerBlock(task.height);

            const proofId = await createProof(db, task);

            if (task.height % PROOF_EPOCH_SIZE == 0) {
                await createProofEpoch(proofEpochHeight, task.height, proofId);
            } else {
                const epoch = await setProofOnEpoch(
                    db,
                    proofEpochHeight,
                    task.height,
                    proofId,
                );
                if (epoch) {
                    await setBlockStatusDone(db, task.height);
                    logger.info(
                        `Set proof ${proofId.toHexString()} for block height ${task.height} in proof epoch ${epoch.height}.`,
                    );
                } else {
                    await db.proofsCol.findOneAndDelete({ _id: proofId });
                    logger.warn(
                        `Block was not in 'processing' status for height ${task.height}. Deleted proof ${proofId.toHexString()}.`,
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

/**
 * Creates a new proof epoch document if it does not exist and sets the proof for the given height
 * @param proofEpochHeight Proof epoch height
 * @param height Block height
 * @param proofId Proof ObjectId
 */
async function createProofEpoch(
    proofEpochHeight: number,
    height: number,
    proofId: ObjectId,
) {
    const db = new DB();
    await db.initMongo();

    await db.proofEpochsCol.findOneAndUpdate(
        { height: proofEpochHeight },
        {
            $setOnInsert: {
                height: proofEpochHeight,
                kind: "blockProof" as ProofKind,
                proofs: Array(31).fill(null),
                status: Array(15).fill("waiting" as ProofStatus),
                failCount: 0,
                timeoutAt: new Date(Date.now() + TIMEOUT_TIME_MS),
            },
            $set: {
                [`proofs.${height % PROOF_EPOCH_SIZE}`]: proofId,
            },
        },
        { upsert: true },
    );

    logger.info(
        `Created proof epoch for first height ${height} with proof for block ${height}`,
    );
}

/**
 * Change block status from 'waiting' to 'processing'
 * @param height Block height
 **/
async function registerBlock(height: number) {
    const db = new DB();
    await db.initMongo();

    await db.blocksCol
        .updateOne(
            {
                height: height,
                status: "waiting" as ProofStatus,
            },
            {
                $set: {
                    status: "processing" as ProofStatus,
                },
            },
        )
        .then((result) => {
            if (!result) {
                throw new Error(
                    `Block at height ${height} is not in 'waiting' status.`,
                );
            }

            logger.info(
                `Registered block at height ${height} as 'processing'.`,
            );
        });
}

/**
 * Set proof ID on epoch for specific height
 * @param db Database instance
 * @param height Block height
 * @param proofEpochHeight Proof epoch height
 * @param proofId Proof ObjectId
 * @return Updated ProofEpochDoc or null if not found
 */
async function setProofOnEpoch(
    db: DB,
    proofEpochHeight: number,
    height: number,
    proofId: ObjectId,
): Promise<WithId<ProofEpochDoc> | null> {
    return db.proofEpochsCol.findOneAndUpdate(
        {
            height: proofEpochHeight,
        },
        {
            $set: {
                [`proofs.${height % PROOF_EPOCH_SIZE}`]: proofId,
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
