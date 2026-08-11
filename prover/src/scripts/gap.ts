/**
 * Logs the settlement gap: the Pulsar chain tip vs the blockHeight the
 * SettlementContract has settled on Mina. The gap is the number of Pulsar
 * blocks the prover still has to prove+settle — steady means keeping pace,
 * growing means falling behind (see PROOF_EPOCH_LEAF_COUNT for the lever).
 *
 * One-shot by default. `--watch [seconds]` re-measures forever (default 60).
 *
 * Required env vars:
 *   CONTRACT_ADDRESS     - deployed SettlementContract address
 *   MINA_NETWORK         - "devnet" | "mainnet" | "lightnet"
 *   PULSAR_GRPC_ENDPOINT - gRPC endpoint of the Pulsar node
 */
import "dotenv/config";
import { PublicKey } from "o1js";
import {
    getLatestHeight,
    grpcCredentials,
    TendermintClient,
} from "pulsar-chain-client";

import {
    type MinaClientContext,
    type MinaNetwork,
    initMinaClientContext,
    getContractBlockHeight,
} from "../services/mina/client.js";
import { PROOF_EPOCH_SIZE } from "../config/constants.js";
import { sleep } from "../common/sleep.js";
import logger from "../common/logger.js";

async function measure(ctx: MinaClientContext, tmClient: TendermintClient) {
    const [chainTip, contractHeight] = await Promise.all([
        getLatestHeight(tmClient),
        getContractBlockHeight(ctx),
    ]);

    const gapBlocks = chainTip - contractHeight;

    logger.info(
        `Settlement gap: chain tip ${chainTip}, contract ${contractHeight}, behind by ${gapBlocks} blocks (${(gapBlocks / PROOF_EPOCH_SIZE).toFixed(1)} epochs)`,
        {
            chainTip,
            contractHeight,
            gapBlocks,
            gapEpochs: Number((gapBlocks / PROOF_EPOCH_SIZE).toFixed(1)),
            event: "settlement_gap",
        },
    );
}

async function main() {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) throw new Error("CONTRACT_ADDRESS is not set");

    const network: MinaNetwork =
        (process.env.MINA_NETWORK as MinaNetwork) || "lightnet";

    const grpcEndpoint = process.env.PULSAR_GRPC_ENDPOINT || "localhost:9090";
    const tmClient = new TendermintClient(
        grpcEndpoint,
        grpcCredentials(grpcEndpoint),
    );

    const ctx = await initMinaClientContext(
        PublicKey.fromBase58(contractAddress),
        network,
    );

    const watchIndex = process.argv.indexOf("--watch");
    if (watchIndex === -1) {
        await measure(ctx, tmClient);
        process.exit(0);
    }

    const intervalSeconds = Number(process.argv[watchIndex + 1]) || 60;
    while (true) {
        try {
            await measure(ctx, tmClient);
        } catch (error) {
            logger.error("Gap measurement failed", {
                message: error instanceof Error ? error.message : String(error),
                event: "settlement_gap_error",
            });
        }
        await sleep(intervalSeconds * 1000);
    }
}

main().catch((error) => {
    logger.error("Gap script failed", {
        message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
