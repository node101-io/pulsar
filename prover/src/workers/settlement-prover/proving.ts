import { Types } from "mongoose";
import { Cache, PublicKey } from "o1js";
import {
    SettlementProof,
    MultisigVerifierProgram,
    SettleAttestProgram,
    ApprovalTailProgram,
    ApprovalQuorumProgram,
    ActionStackProgram,
    SettlementContract,
} from "pulsar-contracts";

import logger from "../../common/logger.js";
import { ProofEpochModel } from "../../db/models/ProofEpoch.js";
import { getProof } from "../../db/models/Proof.js";
import { ProofKind } from "../../common/types.js";
import {
    type MinaClientContext,
    type MinaNetwork,
    initMinaClientContext,
} from "../../services/mina/client.js";
import { proveSettlementTx } from "../../services/mina/settlement.js";
import { epochLastPulsarBlock } from "../../common/epoch.js";
import { CACHE_DIR } from "../../config/constants.js";

// Child-process side. See workers/childProver.ts.

let compiled = false;
export async function ensureCompiled() {
    if (compiled) return;
    logger.info("Compiling ZK programs for settlement-prover…", {
        event: "settlement_prover_compile_start",
    });
    await MultisigVerifierProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    await SettleAttestProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    // reduce verifies ApprovalQuorumProof, which verifies ApprovalTailProof —
    // both VKs must exist before SettlementContract.compile.
    await ApprovalTailProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    await ApprovalQuorumProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    await ActionStackProgram.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    await SettlementContract.compile({ cache: Cache.FileSystem(CACHE_DIR) });
    compiled = true;
    logger.info("ZK programs compiled for settlement-prover.", {
        event: "settlement_prover_compile_done",
    });
}

async function getMinaContext(): Promise<MinaClientContext> {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
        throw new Error("CONTRACT_ADDRESS is not set");
    }
    const network: MinaNetwork =
        (process.env.MINA_NETWORK as MinaNetwork) || "lightnet";
    return initMinaClientContext(
        PublicKey.fromBase58(contractAddress),
        network,
    );
}

/**
 * Prove the settle transaction for one proof epoch and move it to
 * 'settlement' — the whole unit of work, so the parent only has to read an
 * exit code.
 */
export async function proveSettlement(
    height: number,
    settlementProofId: Types.ObjectId,
): Promise<void> {
    const settlementProofJson = await getProof(settlementProofId);
    if (!settlementProofJson) {
        throw new Error("Settlement proof is missing.");
    }

    const settlementProof = await SettlementProof.fromJSON(settlementProofJson);
    const lastPulsarBlock = epochLastPulsarBlock(height);

    const ctx = await getMinaContext();
    const provedTxJson = await proveSettlementTx(
        ctx,
        settlementProof,
        lastPulsarBlock,
    );

    await setProofEpochSettlement(height, provedTxJson);
}

async function setProofEpochSettlement(
    height: number,
    provedTxJson: string | null,
): Promise<void> {
    const result = await ProofEpochModel.findOneAndUpdate(
        {
            height,
            kind: "txProving" as ProofKind,
        },
        {
            $set: {
                kind: "settlement" as ProofKind,
                provedTxJson,
            },
        },
    );

    if (!result) {
        throw new Error(
            `Proof epoch at height ${height} not found or not in txProving state.`,
        );
    }

    logger.info("Proof epoch marked as settlement-ready after tx proving", {
        epochHeight: height,
        alreadySettled: provedTxJson === null,
        event: "settlement_prover_epoch_ready",
    });
}
