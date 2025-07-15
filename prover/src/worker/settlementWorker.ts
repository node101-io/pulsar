import {
    AGGREGATE_THRESHOLD,
    Block,
    GeneratePulsarBlock,
    GenerateSettlementProof,
    List,
    SETTLEMENT_MATRIX_SIZE,
    SignaturePublicKeyList,
} from "pulsar-contracts";
import { mergeQ, SettlementJob } from "../workerConnection.js";
import { createWorker } from "./worker.js";
import { fetchBlockRange, initMongo, storeBlock, storeProof } from "../db.js";
import logger from "../logger.js";
import dotenv from "dotenv";
import { Field, Poseidon, PrivateKey, PublicKey, Signature } from "o1js";
dotenv.config();

await initMongo();

/**
 * Handle:
 * Invalid signatures
 * No vote extensions for some validators
 */
createWorker<SettlementJob, void>({
    queueName: "settlement",
    maxJobsPerWorker: 1000,
    jobHandler: async ({ data, id }) => {
        try {
            const { blockHeight, voteExts } = data;

            if (!voteExts || voteExts.length === 0) {
                logger.warn(`[Job ${id}] No vote extensions found for block height ${blockHeight}`);
                return;
            }

            const validators = voteExts.map((voteExt) => voteExt.validatorAddr);
            const validatorsList = List.empty();
            // Todo unsorted
            for (const validator of validators) {
                validatorsList.push(Poseidon.hash(PublicKey.fromBase58(validator).toFields()));
            }
            await storeBlock(
                blockHeight,
                blockHeight.toString(),
                voteExts.map((voteExt) => voteExt.validatorAddr),
                validatorsList.hash.toString(),
                voteExts
            );

            if (blockHeight % SETTLEMENT_MATRIX_SIZE == 0) {
                const blockDocs = await fetchBlockRange(
                    blockHeight - SETTLEMENT_MATRIX_SIZE,
                    blockHeight
                );

                if (blockDocs.length != SETTLEMENT_MATRIX_SIZE + 1) {
                    logger.warn(
                        `[Job ${id}] Not enough blocks to process settlement for height ${blockHeight}. Expected ${
                            SETTLEMENT_MATRIX_SIZE + 1
                        }, got ${blockDocs.length}`
                    );
                    return;
                }

                let blocks: Block[] = [];
                let signaturePubKeyLists: SignaturePublicKeyList[] = [];
                for (let i = 1; i < blockDocs.length; i++) {
                    const block = GeneratePulsarBlock(
                        Field.from(blockDocs[i - 1].validatorListHash),
                        Field.from(blockDocs[i - 1].stateRoot),
                        Field.from(blockDocs[i - 1].height),
                        Field.from(blockDocs[i].validatorListHash),
                        Field.from(blockDocs[i].stateRoot),
                        Field.from(blockDocs[i].height)
                    );
                    // console.log(JSON.stringify(block.toJSON()));
                    blocks.push(block);

                    const signaturePubKeyList = SignaturePublicKeyList.fromArray(
                        blockDocs[i].voteExts.map((voteExt) => [
                            Signature.fromJSON(JSON.parse(voteExt.signature)),
                            PublicKey.fromBase58(voteExt.validatorAddr),
                        ])
                    );
                    signaturePubKeyLists.push(signaturePubKeyList);

                    const message = block.hash().toFields();
                    signaturePubKeyList.list.forEach((item) => {
                        if (!item.signature.verify(item.publicKey, message).toBoolean()) {
                            logger.warn(
                                `[Job ${id}] Invalid signature from validator ${item.publicKey.toBase58()} in block ${block.NewBlockHeight.toBigInt()}`
                            );
                        }
                    });
                }

                logger.info(
                    `[Job ${id}] Generating settlement proof for blocks ${blocks[0].NewBlockHeight.toBigInt()} to ${blocks[
                        blocks.length - 1
                    ].NewBlockHeight.toBigInt()}`
                );

                const settlementProof = await GenerateSettlementProof(
                    blocks,
                    signaturePubKeyLists,
                    PrivateKey.fromBase58(process.env.MINA_PRIVATE_KEY || "").toPublicKey()
                );

                const rangeLow = Number(settlementProof.publicInput.InitialBlockHeight.toBigInt());
                const rangeHigh = Number(settlementProof.publicInput.NewBlockHeight.toBigInt());

                await storeProof(rangeLow, rangeHigh, "settlement", settlementProof);

                logger.info(
                    `[Job ${id}] Stored settlement proof for blocks ${blocks[0].NewBlockHeight.toBigInt()} to ${blocks[
                        blocks.length - 1
                    ].NewBlockHeight.toBigInt()}`
                );

                if (blockHeight % AGGREGATE_THRESHOLD !== SETTLEMENT_MATRIX_SIZE) {
                    const lowerBlock = {
                        rangeLow:
                            Math.floor((blockHeight - 1) / AGGREGATE_THRESHOLD) *
                            AGGREGATE_THRESHOLD,
                        rangeHigh: blockHeight - SETTLEMENT_MATRIX_SIZE,
                    };
                    const upperBlock = {
                        rangeLow: blockHeight - SETTLEMENT_MATRIX_SIZE,
                        rangeHigh: blockHeight,
                    };
                    logger.info(
                        `[Job ${id}] Adding merge job for blocks ${lowerBlock.rangeLow}-${lowerBlock.rangeHigh} and ${upperBlock.rangeLow}-${upperBlock.rangeHigh}`
                    );
                    await mergeQ.add(
                        "merge-" + blockHeight,
                        {
                            lowerBlock,
                            upperBlock,
                        },
                        {
                            attempts: 50,
                            backoff: {
                                type: "exponential",
                                delay: 5_000,
                            },
                            removeOnComplete: true,
                        }
                    );
                }
            }
        } catch (err: any) {
            logger.error(
                `[Job ${id}] Error in settlement worker: ${err?.message || err} \n${
                    err?.stack || ""
                }`
            );
            throw err;
        }
    },
});
