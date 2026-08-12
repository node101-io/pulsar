import { Metadata } from "@grpc/grpc-js";

import {
    type BridgeQueryClient,
    type QueryActionsReducedRootResponse,
    type QueryBridgeParamsResponse,
    type QueryLatestActionHashesResponse,
    grpcUnary,
} from "./transport.js";

export { HISTORICAL_HEIGHT_HEADER, historicalHeightMetadata };
export { fetchLatestActionHashes, fetchActionsReducedRoot, fetchBridgeParams };

// Standard Cosmos historical state query: the request runs against the state
// version committed at that height. Height 0 means LATEST, not genesis — so
// an unpinned read simply sends no metadata instead of pinning 0.
const HISTORICAL_HEIGHT_HEADER = "x-cosmos-block-height";

function historicalHeightMetadata(atCosmosHeight?: number): Metadata {
    const metadata = new Metadata();
    if (atCosmosHeight !== undefined)
        metadata.add(HISTORICAL_HEIGHT_HEADER, String(atCosmosHeight));
    return metadata;
}

/**
 * The chain's latest action batch (x/bridge Query/LatestActionHashes) as
 * served — decimal-string field elements and quoted int64s straight off the
 * generated codec. Validation (digits, field range, canonicalisation) is the
 * consumer's job: the bridge owns the error taxonomy those checks feed.
 */
async function fetchLatestActionHashes(
    client: Pick<BridgeQueryClient, "latestActionHashes">,
    atCosmosHeight?: number,
): Promise<QueryLatestActionHashesResponse> {
    return grpcUnary<QueryLatestActionHashesResponse>((cb) =>
        client.latestActionHashes(
            {},
            historicalHeightMetadata(atCosmosHeight),
            cb,
        ),
    );
}

/**
 * The x/bridge module params (Query/Params), as served — start_block_height
 * and max_block_range bound what a MsgPushNewActions may ask for, so the
 * pusher reads them from the chain instead of duplicating the constants.
 */
async function fetchBridgeParams(
    client: Pick<BridgeQueryClient, "params">,
): Promise<QueryBridgeParamsResponse> {
    return grpcUnary<QueryBridgeParamsResponse>((cb) => client.params({}, cb));
}

/** The cumulative approval root (x/bridge Query/ActionsReducedRoot), as served. */
async function fetchActionsReducedRoot(
    client: Pick<BridgeQueryClient, "actionsReducedRoot">,
    atCosmosHeight?: number,
): Promise<QueryActionsReducedRootResponse> {
    return grpcUnary<QueryActionsReducedRootResponse>((cb) =>
        client.actionsReducedRoot(
            {},
            historicalHeightMetadata(atCosmosHeight),
            cb,
        ),
    );
}
