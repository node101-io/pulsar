import {
    AbciQueryClient,
    TendermintClient,
    VotePersistenceClient,
    VOTE_EXT_PERSISTENCE_LAG,
    fetchSignedVoteExtension,
    getLatestHeight,
    grpcCredentials,
    type SignedVoteExtRecord,
} from "pulsar-chain-client";

import logger from "../../common/logger.js";
import { env } from "../../config/env.js";

// On-demand signed-root reads: the chain's LIVE vote store is overwritten every block, but
// votepersistence is ordinary chain state, so every past block's signature
// set stays readable through the standard historical state query for as long
// as the node retains that version (~300k blocks by default). Correctness
// never needs more than the LATEST signed root — every block re-signs the
// cumulative actions root — so an archive of our own would only ever shorten
// approval tails, and a pinned read at the covering height shortens them just
// as well. Hence: no poller, no Mongo collection, two reads per reduce at
// most.

let _clients: {
    tm: TendermintClient;
    abci: AbciQueryClient;
    vp: VotePersistenceClient;
} | null = null;

function getClients() {
    if (_clients) return _clients;

    // Non-empty by the boot-time env gate.
    const endpoint = env.PULSAR_GRPC_ENDPOINT;
    const creds = grpcCredentials(endpoint);
    _clients = {
        tm: new TendermintClient(endpoint, creds),
        abci: new AbciQueryClient(endpoint, creds),
        vp: new VotePersistenceClient(endpoint, creds),
    };
    return _clients;
}

function usable(
    record: SignedVoteExtRecord | null,
    nextValidatorSetHash: string,
): record is SignedVoteExtRecord {
    // A signatureless record is a missed one-block persistence window; a
    // record signed under another validator-set root can never satisfy the
    // quorum circuit, which pins body.nextValidatorSetHash to the contract's
    // merkleListRoot.
    return (
        record !== null &&
        record.signatures.length > 0 &&
        record.body.nextValidatorSetHash === nextValidatorSetHash
    );
}

async function tryFetch(
    abci: AbciQueryClient,
    vp: VotePersistenceClient,
    signedHeight: number,
): Promise<SignedVoteExtRecord | null> {
    try {
        return await fetchSignedVoteExtension(abci, vp, signedHeight);
    } catch (error) {
        // Early chain, pruned version, missed window: each only costs tail
        // length (the latest root still proves), never correctness.
        logger.debug("Signed root not readable at height", {
            cosmosHeight: signedHeight,
            error: error instanceof Error ? error.message : String(error),
            event: "signed_root_read_miss",
        });
        return null;
    }
}

/**
 * The oldest READABLE signed root at or beyond `coveringHeight` whose body
 * carries the given validator-set root — the reduce worker's proof target.
 * Older means a shorter approval tail between the batch end and the signed
 * actions root, so the covering height itself is tried first (a pinned
 * historical read); the latest signed root is the fallback that always
 * exists while the chain is alive. Returns null when neither read yields a
 * usable record — the caller waits: the next block re-signs everything.
 */
export async function findSignedRootAtOrBeyond(
    coveringHeight: number,
    nextValidatorSetHash: string,
): Promise<SignedVoteExtRecord | null> {
    const { tm, abci, vp } = getClients();

    const pinned = await tryFetch(abci, vp, coveringHeight);
    if (usable(pinned, nextValidatorSetHash)) return pinned;

    const tip = await getLatestHeight(tm);
    if (!Number.isFinite(tip)) {
        throw new Error("GetLatestBlock returned no usable height");
    }
    // The persisted signatures for signed height H live in state H + LAG, so
    // the newest fully readable signed root trails the tip by LAG.
    const newestSigned = tip - VOTE_EXT_PERSISTENCE_LAG;
    if (newestSigned <= coveringHeight) return null;

    const latest = await tryFetch(abci, vp, newestSigned);
    if (usable(latest, nextValidatorSetHash)) return latest;
    return null;
}
