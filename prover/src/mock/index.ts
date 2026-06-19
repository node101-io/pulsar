import "dotenv/config";

import {
    MOCK_GRPC_PORT,
    MOCK_BLOCK_PRODUCE_INTERVAL_MS,
    MOCK_ACTIVE_VALIDATOR_COUNT,
    MOCK_VALIDATOR_POOL_SIZE,
    MOCK_VALIDATORS_CHANGE_PER_BLOCK,
} from "./constants.js";
import { initBlockProducer, startBlockProduction } from "./blockProducer.js";
import { startGrpcServer } from "./grpcServer.js";
import { MockBlock } from "./types.js";

function onBlock(block: MockBlock) {
    console.log(
        `[mock] Block #${block.height} produced | validators: ${block.validators.length} | vote_exts: ${block.voteExts.length}`,
    );
}

async function main() {
    console.log("[mock] Initializing validator pool...");
    await initBlockProducer();

    console.log(
        `[mock] Validator pool: ${MOCK_VALIDATOR_POOL_SIZE} total, ${MOCK_ACTIVE_VALIDATOR_COUNT} active, ${MOCK_VALIDATORS_CHANGE_PER_BLOCK} rotating per block`,
    );

    console.log("[mock] Starting gRPC server...");
    await startGrpcServer();
    console.log(`[mock] gRPC server listening on port ${MOCK_GRPC_PORT}`);

    console.log(
        `[mock] Starting block production every ${MOCK_BLOCK_PRODUCE_INTERVAL_MS}ms`,
    );
    startBlockProduction(onBlock);
}

main().catch((err) => {
    console.error("[mock] Fatal error:", err);
    process.exit(1);
});
