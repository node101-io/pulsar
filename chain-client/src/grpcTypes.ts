import type * as grpc from "@grpc/grpc-js";
import type {
    QueryVoteExtBodyByHeightRequest,
    QueryVoteExtBodyByHeightResponse,
} from "./generated/pulsarchain/abci/query.js";
import type {
    QueryVoteExtensionsRequest,
    QueryVoteExtensionsResponse,
} from "./generated/pulsarchain/votepersistence/v1/query.js";
import type {
    QueryGetValidatorMinaPubKeyRequest,
    QueryGetValidatorMinaPubKeyResponse,
} from "./generated/pulsarchain/keyregistry/v1/query.js";

// Service surfaces for the pulsar-chain RPCs. Message types are generated
// from the chain's protos (see buf.gen.yaml; regenerate with
// `pnpm run proto:gen`). The proto-loader-built clients (createClient<T>) are
// dynamically typed, so these interfaces pin their shapes at the call site.

export type {
    QueryVoteExtBodyByHeightResponse,
    QueryVoteExtensionsResponse,
    QueryGetValidatorMinaPubKeyResponse,
};

// Raw value of a proto `bytes` field. gRPC delivers Buffers (a Uint8Array
// subclass), but JSON-transcoded responses may carry base64 strings; normalize
// with protoBytesToBuffer.
export type ProtoBytes = Buffer | Uint8Array | string;

export type GrpcCallback<TRes> = (
    err: grpc.ServiceError | null,
    res: TRes,
) => void;

// --- cosmos.base.tendermint.v1beta1.Service ---
// Hand-written minimal surface: the upstream Cosmos SDK query service. Its
// .proto is vendored for the runtime transport (../proto), but buf.gen.yaml
// only generates pulsarchain types, so these interfaces stay hand-written.

export interface GetLatestBlockResponse {
    block?: { header?: { height?: string } };
}

export interface GetBlockByHeightResponse {
    block?: { header?: { app_hash?: ProtoBytes } };
}

export interface ValidatorSetMember {
    address?: string;
    pub_key?: { value?: ProtoBytes };
    voting_power?: string;
}

export interface GetValidatorSetByHeightResponse {
    validators?: ValidatorSetMember[];
}

export interface TendermintService {
    GetLatestBlock(
        req: Record<string, never>,
        cb: GrpcCallback<GetLatestBlockResponse>,
    ): void;
    GetBlockByHeight(
        req: { height: string },
        cb: GrpcCallback<GetBlockByHeightResponse>,
    ): void;
    GetValidatorSetByHeight(
        req: { height: string },
        cb: GrpcCallback<GetValidatorSetByHeightResponse>,
    ): void;
    GetLatestValidatorSet(
        req: Record<string, never>,
        cb: GrpcCallback<GetValidatorSetByHeightResponse>,
    ): void;
}

// --- pulsarchain.votepersistence.v1.Query ---

export interface VotePersistenceService {
    VoteExtensions(
        req: QueryVoteExtensionsRequest,
        metadata: grpc.Metadata,
        cb: GrpcCallback<QueryVoteExtensionsResponse>,
    ): void;
}

// --- pulsarchain.keyregistry.v1.Query ---

export interface KeyregistryService {
    GetValidatorMinaPubKey(
        req: QueryGetValidatorMinaPubKeyRequest,
        cb: GrpcCallback<QueryGetValidatorMinaPubKeyResponse>,
    ): void;
}

// --- pulsarchain.abci.Query ---

export interface AbciQueryService {
    VoteExtBodyByHeight(
        req: QueryVoteExtBodyByHeightRequest,
        cb: GrpcCallback<QueryVoteExtBodyByHeightResponse>,
    ): void;
}
