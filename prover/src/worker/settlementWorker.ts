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
import { Field, Poseidon, PublicKey, Signature } from "o1js";
dotenv.config();

await initMongo();

/**
 * Invalid signatures
 * No vote extensions for some validators
 */
createWorker<SettlementJob, void>({
    queueName: "settlement",
    maxJobsPerWorker: 160,
    jobHandler: async ({ data, id }) => {
        try {
            const { blockData } = data;

            const { height, stateRoot, validators, voteExt } = blockData;

            logger.jobStarted(id, "settlement", {
                blockHeight: height,
                validatorsCount: validators.length,
                voteExtCount: voteExt?.length || 0,
                workerId: "settlementWorker",
            });

            if (height === 1) {
                logger.info("Skipping genesis block processing", {
                    jobId: id,
                    blockHeight: height,
                    event: "genesis_block_skipped",
                });
                return;
            }

            if (!voteExt || voteExt.length === 0) {
                logger.warn("No vote extensions found for block height", {
                    jobId: id,
                    blockHeight: height,
                    validatorsCount: validators.length,
                    event: "no_vote_extensions",
                });
                return;
            }

            const validatorsList = List.empty();
            // Todo unsorted
            for (const validator of validators) {
                validatorsList.push(Poseidon.hash(PublicKey.fromBase58(validator).toFields()));
            }
            await storeBlock(
                height,
                stateRoot,
                validators,
                validatorsList.hash.toString(),
                voteExt
            );

            logger.dbOperation("store_block", "blocks", undefined, {
                jobId: id,
                blockHeight: height,
                validatorsCount: validators.length,
                voteExtCount: voteExt.length,
                event: "block_stored",
            });

            if (height % SETTLEMENT_MATRIX_SIZE == 0) {
                logger.debug("Settlement matrix size reached, processing settlement", {
                    jobId: id,
                    blockHeight: height,
                    settlementMatrixSize: SETTLEMENT_MATRIX_SIZE,
                    event: "settlement_processing_start",
                });

                const blockDocs = await fetchBlockRange(height - SETTLEMENT_MATRIX_SIZE, height);

                logger.debug("Fetched blocks for settlement processing", {
                    jobId: id,
                    fetchedBlocks: blockDocs.map((doc) => doc.height),
                    blockCount: blockDocs.length,
                    expectedCount: SETTLEMENT_MATRIX_SIZE + 1,
                    event: "blocks_fetched",
                });

                if (blockDocs.length != SETTLEMENT_MATRIX_SIZE + 1) {
                    logger.warn("Insufficient blocks for settlement processing", {
                        jobId: id,
                        blockHeight: height,
                        fetchedCount: blockDocs.length,
                        expectedCount: SETTLEMENT_MATRIX_SIZE + 1,
                        fetchedBlocks: blockDocs.map((doc) => doc.height),
                        event: "insufficient_blocks",
                    });
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
                    blocks.push(block);

                    const signaturePubKeyList = SignaturePublicKeyList.fromArray(
                        blockDocs[i].voteExt.map((ext) => [
                            Signature.fromBase58(ext.signature),
                            PublicKey.fromBase58(ext.validatorAddr),
                        ])
                    );
                    signaturePubKeyLists.push(signaturePubKeyList);

                    const message = block.hash().toFields();
                    signaturePubKeyList.list.forEach((item) => {
                        if (!item.signature.verify(item.publicKey, message).toBoolean()) {
                            logger.warn("Invalid signature from validator", {
                                jobId: id,
                                validatorPublicKey: item.publicKey.toBase58(),
                                blockHeight: Number(block.NewBlockHeight.toBigInt().toString()),
                                signature: item.signature.toBase58(),
                                messageHash: block.hash().toString(),
                                event: "invalid_signature",
                            });
                        }
                    });
                }

                logger.info("Generating settlement proof", {
                    jobId: id,
                    initialBlockHeight: blocks[0].InitialBlockHeight.toBigInt().toString(),
                    finalBlockHeight:
                        blocks[blocks.length - 1].NewBlockHeight.toBigInt().toString(),
                    blocksCount: blocks.length,
                    event: "generating_settlement_proof",
                });

                const settlementProof = await GenerateSettlementProof(blocks, signaturePubKeyLists);

                const rangeLow = Number(settlementProof.publicInput.InitialBlockHeight.toBigInt());
                const rangeHigh = Number(settlementProof.publicInput.NewBlockHeight.toBigInt());

                await storeProof(rangeLow, rangeHigh, "settlement", settlementProof);

                logger.proofGenerated("settlement", 0, {
                    jobId: id,
                    rangeLow,
                    rangeHigh,
                    initialBlockHeight: blocks[0].NewBlockHeight.toBigInt().toString(),
                    finalBlockHeight:
                        blocks[blocks.length - 1].NewBlockHeight.toBigInt().toString(),
                    event: "settlement_proof_stored",
                });

                if (height % AGGREGATE_THRESHOLD !== SETTLEMENT_MATRIX_SIZE) {
                    const lowerBlock = {
                        rangeLow:
                            Math.floor((height - 1) / AGGREGATE_THRESHOLD) * AGGREGATE_THRESHOLD,
                        rangeHigh: height - SETTLEMENT_MATRIX_SIZE,
                    };
                    const upperBlock = {
                        rangeLow: height - SETTLEMENT_MATRIX_SIZE,
                        rangeHigh: height,
                    };
                    logger.info("Adding merge job for settlement proofs", {
                        jobId: id,
                        height,
                        lowerBlockRange: `${lowerBlock.rangeLow}-${lowerBlock.rangeHigh}`,
                        upperBlockRange: `${upperBlock.rangeLow}-${upperBlock.rangeHigh}`,
                        mergeJobId: "merge-" + height,
                        event: "merge_job_queued",
                    });
                    await mergeQ.add(
                        "merge-" + height,
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
            logger.jobFailed(id, "settlement", err, {
                blockHeight: data.blockData.height,
                workerId: "settlementWorker",
            });
            throw err;
        }
    },
});
