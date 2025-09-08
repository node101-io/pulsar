import {
    ActionStackProgram,
    MultisigVerifierProgram,
    SettlementContract,
    ValidateReduceProgram,
} from "pulsar-contracts";
import logger from "./logger.js";
import { QueueName } from "./workerConnection.js";
import { BlockParserResult } from "./interfaces.js";
import { Signature } from "o1js";

export {
    compileContracts,
    prettierAddress,
    parseTendermintBlockResponse,
    decodeMinaSignature,
    parseValidatorSetResponse,
};

async function compileContracts(mode: QueueName) {
    try {
        if (mode === "collect-signature") {
            return;
        }
        logger.info("Compiling contracts...");
        let time = performance.now();
        await MultisigVerifierProgram.compile();
        logger.performance("MultisigVerifierProgram compilation", performance.now() - time, {
            mode,
            event: "contract_compilation",
        });
        if (mode === "reduce") {
            time = performance.now();
            await ValidateReduceProgram.compile();
            logger.performance("ValidateReduceProgram compilation", performance.now() - time, {
                mode,
                event: "contract_compilation",
            });

            time = performance.now();
            await ActionStackProgram.compile();
            logger.performance("ActionStackProgram compilation", performance.now() - time, {
                mode,
                event: "contract_compilation",
            });

            time = performance.now();
            await SettlementContract.compile();
            logger.performance("SettlementContract compilation", performance.now() - time, {
                mode,
                event: "contract_compilation",
            });
        }
    } catch (err) {
        throw new Error(`Failed to compile contracts: ${err}`);
    }
}

function prettierAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-6)}`;
}

function parseTendermintBlockResponse(res: any): BlockParserResult {
    const header = res?.block?.header;
    const blockId = res?.block_id?.hash || null;
    const blockHash = BigInt(
        "0x" + Buffer.from(header.app_hash, "base64").toString("hex")
    ).toString();
    const height = header?.height ? Number(header.height) : NaN;
    const chainId = header?.chain_id || "";
    const proposerAddress = header?.proposer_address || "";
    const timeSec = Number(header?.time?.seconds || 0);
    const timeNanos = Number(header?.time?.nanos || 0);
    const time = new Date(timeSec * 1e3 + timeNanos / 1e6);

    const txs: string[] = res?.block?.data?.txs ?? [];
    const txsDecoded: string[] = txs.map((t: string) => {
        try {
            const decoded = Buffer.from(t, "base64").toString("utf-8");
            return decoded;
        } catch {
            return "";
        }
    });

    const signatures = res?.block?.last_commit?.signatures ?? [];
    const lastCommitSignatures = signatures.map((sig: any) => ({
        validator_address: sig?.validator_address ?? "",
        signature: sig?.signature ?? "",
        block_id_flag: sig?.block_id_flag ?? "",
        timestamp: sig?.timestamp
            ? new Date(
                  Number(sig.timestamp.seconds || 0) * 1e3 + Number(sig.timestamp.nanos || 0) / 1e6
              )
            : null,
    }));

    return {
        blockId,
        blockHash,
        height,
        chainId,
        proposerAddress,
        time,
        txs,
        txsDecoded,
        lastCommitSignatures,
        hashes: {
            appHash: header?.app_hash || "",
            dataHash: header?.data_hash || "",
            validatorsHash: header?.validators_hash || "",
            consensusHash: header?.consensus_hash || "",
            evidenceHash: header?.evidence_hash || "",
            lastCommitHash: header?.last_commit_hash || "",
            lastResultsHash: header?.last_results_hash || "",
            nextValidatorsHash: header?.next_validators_hash || "",
        },
    };
}

function decodeMinaSignature(signatureHex: string): string {
    const sigBuffer = Buffer.from(signatureHex, "hex");
    const rHex = sigBuffer.slice(0, 32).toString("hex");
    const sHex = sigBuffer.slice(32, 64).toString("hex");

    return Signature.fromValue({ r: BigInt("0x" + rHex), s: BigInt("0x" + sHex) }).toBase58();
}

function parseValidatorSetResponse(res: any): string[] {
    return res?.validators.map((v: any) => v.address);
}
