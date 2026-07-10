import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

import type { GrpcCallback, ProtoBytes } from "./grpcTypes.js";

// gRPC service names, resolved from the vendored .proto tree (see ../proto and
// `pnpm run proto:vendor`). No server-side reflection is required.
export const TENDERMINT_SERVICE_NAME = "cosmos.base.tendermint.v1beta1.Service";
export const VOTE_PERSISTENCE_SERVICE_NAME =
    "pulsarchain.votepersistence.v1.Query";
export const MINA_KEYS_SERVICE_NAME = "pulsarchain.keyregistry.v1.Query";
export const ABCI_SERVICE_NAME = "pulsarchain.abci.Query";

// build/src/transport.js → package root → proto/
const PROTO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../proto");

// Entry points that define the four services we consume; proto-loader pulls
// their transitive imports from PROTO_ROOT.
const SERVICE_PROTOS = [
    "cosmos/base/tendermint/v1beta1/query.proto",
    "pulsarchain/abci/query.proto",
    "pulsarchain/keyregistry/v1/query.proto",
    "pulsarchain/votepersistence/v1/query.proto",
];

// Match the wire shape the generated types assume (grpcTypes.ts): snake_case
// field names, string-encoded 64-bit ints, string enums.
const LOAD_OPTIONS: protoLoader.Options = {
    keepCase: true,
    longs: String,
    enums: String,
    includeDirs: [PROTO_ROOT],
};

let cachedRoot: grpc.GrpcObject | null = null;

// Parse the vendored protos once (synchronous, local — no network) and reuse
// the package tree across every createClient call.
function loadPackageRoot(): grpc.GrpcObject {
    if (cachedRoot) return cachedRoot;
    const packageDefinition = protoLoader.loadSync(SERVICE_PROTOS, LOAD_OPTIONS);
    cachedRoot = grpc.loadPackageDefinition(packageDefinition);
    return cachedRoot;
}

export function createClient<T>(
    serviceName: string,
    rpcAddress: string,
    credentials: grpc.ChannelCredentials,
): T {
    const root = loadPackageRoot();

    // Walk the dotted service name (e.g. "pulsarchain.abci.Query") down to the
    // service constructor in the loaded package tree.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = root;
    for (const part of serviceName.split(".")) {
        node = node?.[part];
        if (node == null) {
            throw new Error(
                `service "${serviceName}" not found in vendored protos (missing at "${part}")`,
            );
        }
    }

    const ServiceClient = node as grpc.ServiceClientConstructor;
    return new ServiceClient(rpcAddress, credentials) as T;
}

// Promisify a single callback-style gRPC call:
//   const res = await grpcUnary((cb) => client.Method(req, cb));
export function grpcUnary<TRes>(
    call: (cb: GrpcCallback<TRes>) => void,
): Promise<TRes> {
    return new Promise<TRes>((resolve, reject) => {
        call((err, res) => (err ? reject(err) : resolve(res)));
    });
}

export function isServiceError(err: unknown): err is grpc.ServiceError {
    return err instanceof Error && "code" in err;
}

// Normalize a proto `bytes` field: gRPC delivers Buffers, JSON-transcoded
// responses deliver base64 strings.
export function protoBytesToBuffer(val: ProtoBytes | null | undefined): Buffer {
    if (val == null) return Buffer.alloc(0);
    if (Buffer.isBuffer(val)) return val;
    if (typeof val === "string") return Buffer.from(val, "base64");
    return Buffer.from(val);
}

export function protoBufferToDecStr(
    val: ProtoBytes | null | undefined,
): string {
    const buf = protoBytesToBuffer(val);
    if (buf.length === 0) return "0";
    return BigInt("0x" + buf.toString("hex")).toString();
}
