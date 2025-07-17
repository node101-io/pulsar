import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { PrivateKey, PublicKey, Field } from "o1js";
import path from "path";
import { GeneratePulsarBlock, TestUtils, VALIDATOR_NUMBER, validatorSet } from "pulsar-contracts";
import { fileURLToPath } from "url";
import { VoteExt } from "../pulsarClient";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_PATH = path.join(__dirname, "../../../src/vote_ext.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});

const protoDescriptor: any = grpc.loadPackageDefinition(packageDefinition);
const blockService = protoDescriptor.voteext.BlockService;

let currentHeight = 0;
let activeSet: Array<[PrivateKey, PublicKey]> = validatorSet.slice(0, VALIDATOR_NUMBER);
const merkleList = TestUtils.CreateValidatorMerkleList(activeSet);

const blockHistory: Record<number, { height: number; voteExts: VoteExt[] }> = {};

function createVoteExts(height: number): VoteExt[] {
    const block = GeneratePulsarBlock(
        merkleList.hash,
        Field(height - 1),
        Field(height - 1),
        merkleList.hash,
        Field(height),
        Field(height)
    );
    // console.log(JSON.stringify(block.toJSON()));

    const signaturePubKeyList = TestUtils.GenerateSignaturePubKeyList(
        block.hash().toFields(),
        activeSet
    );

    return signaturePubKeyList.list.map((item, index) => {
        return {
            index: index.toString(),
            height: height,
            validatorAddr: item.publicKey.toBase58(),
            signature: JSON.stringify(item.signature.toJSON()),
        };
    });
}

blockHistory[currentHeight] = {
    height: currentHeight,
    voteExts: createVoteExts(currentHeight),
};

const serviceImpl = {
    GetLatestBlock: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
        const block = blockHistory[currentHeight] || {
            height: currentHeight,
            voteExts: createVoteExts(currentHeight),
        };
        callback(null, block);
    },
    GetBlock: (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
        const { height } = call.request;
        const block = blockHistory[height];
        if (block) {
            callback(null, block);
        } else {
            callback({
                code: grpc.status.NOT_FOUND,
                message: `Block at height ${height} not found`,
            });
        }
    },
};

setInterval(() => {
    currentHeight++;
    const block = {
        height: currentHeight,
        voteExts: createVoteExts(currentHeight),
    };
    blockHistory[currentHeight] = block;
    console.log(`Block produced: ${currentHeight}`);
}, 10_000);

function main() {
    const server = new grpc.Server();
    server.addService(blockService.service, serviceImpl);

    const bindAddr = "0.0.0.0:50051";
    server.bindAsync(bindAddr, grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err) throw err;
        console.log(`Mock VoteExt gRPC server running at ${bindAddr}`);
    });
}

main();
