import * as grpc from "@grpc/grpc-js";
import { GrpcReflection } from "grpc-js-reflection-client";

async function createClient(serviceName, rpcAddress, credentials) {
    const reflectionClient = new GrpcReflection(rpcAddress, credentials);
    const sd = await reflectionClient.getDescriptorBySymbol(serviceName);
    const pkg = sd.getPackageObject({ keepCase: true, enums: String, longs: String });
    let cls = pkg;
    const parts = serviceName.split(".");
    const last = parts.pop();
    for (const p of parts) cls = cls[p];
    return new (cls[last])(rpcAddress, credentials);
}

function protoBytes(v) {
    if (!v) return Buffer.alloc(0);
    if (Buffer.isBuffer(v)) return Buffer.from(v);
    return Buffer.from(v, "base64");
}

const rpcAddress = "65.108.68.236:9090";
const creds = grpc.credentials.createInsecure();

const abciClient = await createClient("pulsarchain.abci.Query", rpcAddress, creds);
const tmClient = await createClient("cosmos.base.tendermint.v1beta1.Service", rpcAddress, creds);

const latestRes = await new Promise((r, e) => tmClient.GetLatestBlock({}, (err, res) => err ? e(err) : r(res)));
const latestH = Number(latestRes.block.header.height);
console.log("Latest height:", latestH);

// processUpTo = latestH - 3, target block = processUpTo (safe)
const targetH = latestH - 3;
const queryH = targetH + 2;
console.log("Testing targetH:", targetH, "VoteExtBodyByHeight(", queryH, ")");

const res = await new Promise((r, e) =>
    abciClient.VoteExtBodyByHeight({ vote_extension_height: queryH }, (err, body) => err ? e(err) : r(body)));

const body = res?.vote_ext_body ?? res?.voteExtBody ?? res;
const currentBlockHeight = Number(body?.current_block_height ?? body?.currentBlockHeight ?? 0);
const nextValSetHashBuf = protoBytes(body?.next_validator_set_hash ?? body?.nextValidatorSetHash);
const stateRootBuf = protoBytes(body?.current_state_root ?? body?.currentStateRoot);

const validatorListHash = nextValSetHashBuf.length > 0
    ? BigInt("0x" + nextValSetHashBuf.toString("hex")).toString()
    : "0";
const stateRoot = BigInt("0x" + stateRootBuf.toString("hex")).toString();

console.log("currentBlockHeight:", currentBlockHeight, "(expected:", targetH, ") match:", currentBlockHeight === targetH);
console.log("stateRoot:", stateRoot.slice(0, 30) + "...");
console.log("validatorListHash:", validatorListHash);
console.log("actionsReducedRoot:", body?.actions_reduced_root ?? body?.actionsReducedRoot);
