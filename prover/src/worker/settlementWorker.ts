import {
    Block,
    GenerateSettlementProof,
    SETTLEMENT_MATRIX_SIZE,
    SignaturePublicKeyList,
} from "pulsar-contracts";
import { SettlementJob } from "../workerConnection.js";
import { createWorker } from "./worker.js";
import { fetchBlockRange, storeBlock, storeProof } from "../db.js";
import logger from "../logger.js";
import dotenv from "dotenv";
import { Field, PrivateKey, PublicKey, Signature } from "o1js";
dotenv.config();

createWorker<SettlementJob, void>({
    queueName: "settlement",
    maxJobsPerWorker: 5,
    jobHandler: async ({ data }) => {
        logger.info(`Processing settlement job: ${JSON.stringify(data)}`);
        const { blockHeight, voteExts } = data;

        if (!voteExts || voteExts.length === 0) {
            logger.warn(`No vote extensions found for block height ${blockHeight}`);
            return;
        }

        await storeBlock(
            blockHeight,
            "StateRootPlaceholder",
            ["ValidatorPlaceholder"],
            "ValidatorListHash",
            voteExts
        );
        logger.info(`Stored block for height ${blockHeight}`);

        if (blockHeight % SETTLEMENT_MATRIX_SIZE) {
            const blockDocs = await fetchBlockRange(
                blockHeight - (SETTLEMENT_MATRIX_SIZE + 1),
                blockHeight
            );

            if (blockDocs.length < SETTLEMENT_MATRIX_SIZE + 1) {
                logger.warn(
                    `Not enough blocks to process settlement for height ${blockHeight}. Expected ${
                        SETTLEMENT_MATRIX_SIZE + 1
                    }, got ${blockDocs.length}`
                );
                return;
            }
            let blocks: Block[] = [];
            let signaturePubKeyLists: SignaturePublicKeyList[] = [];
            for (let i = 1; i < blockDocs.length; i++) {
                blocks.push(
                    new Block({
                        InitialMerkleListRoot: Field.from(blockDocs[i - 1].validatorListHash),
                        InitialStateRoot: Field.from(blockDocs[i - 1].stateRoot),
                        InitialBlockHeight: Field.from(blockDocs[i - 1].height),
                        NewMerkleListRoot: Field.from(blockDocs[i].validatorListHash),
                        NewStateRoot: Field.from(blockDocs[i].stateRoot),
                        NewBlockHeight: Field.from(blockDocs[i].height),
                    })
                );

                signaturePubKeyLists.push(
                    SignaturePublicKeyList.fromArray(
                        blockDocs[i].voteExts.map((voteExt) => [
                            Signature.fromJSON(JSON.parse(voteExt.signature)),
                            PublicKey.fromBase58(voteExt.validatorAddr),
                        ])
                    )
                );
            }

            logger.info(
                `Generating settlement proof for blocks ${blocks[0].NewBlockHeight.toBigInt()} to ${blocks[
                    blocks.length - 1
                ].NewBlockHeight.toBigInt()}`
            );

            const settlementProof = await GenerateSettlementProof(
                blocks,
                signaturePubKeyLists,
                PrivateKey.fromBase58(process.env.MINA_PRIVATE_KEY || "").toPublicKey()
            );

            await storeProof(
                blocks[0].NewBlockHeight.toBigInt(),
                blocks[blocks.length - 1].NewBlockHeight.toBigInt(),
                "settlement",
                settlementProof
            );

            logger.info(
                `Stored settlement proof for blocks ${blocks[0].NewBlockHeight.toBigInt()} to ${blocks[
                    blocks.length - 1
                ].NewBlockHeight.toBigInt()}`
            );
        }
    },
});
