import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

import { MOCK_GRPC_PORT } from "./constants.js";
import { getBlocks, getLatestHeight } from "./blockProducer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROTO_PATH = join(__dirname, "proto", "voteexthandler.proto");

function loadProto() {
    const packageDef = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    });
    return grpc.loadPackageDefinition(packageDef) as any;
}

function handleGetLatestHeight(
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
) {
    callback(null, { height: getLatestHeight().toString() });
}

function handleGetAllVoteExtsByHeight(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
) {
    const height = Number(call.request.height);
    const block = getBlocks().get(height);

    if (!block) {
        callback({
            code: grpc.status.NOT_FOUND,
            message: `Block at height ${height} not yet produced`,
        });
        return;
    }

    const vote_exts = block.voteExts.map((ve) => ({
        index: ve.index,
        height: ve.height.toString(),
        validator_addr: ve.validatorAddr,
        signature: ve.signature,
        body: {
            initial_validator_set_root: ve.body.initialValidatorSetRoot,
            initial_state_root: ve.body.initialStateRoot,
            initial_block_height: ve.body.initialBlockHeight.toString(),
            new_validator_set_root: ve.body.newValidatorSetRoot,
            new_state_root: ve.body.newStateRoot,
            new_block_height: ve.body.newBlockHeight.toString(),
        },
    }));

    callback(null, {
        vote_exts,
        validator_set_root: block.validatorSetRoot,
    });
}

function handleGetStateAtHeight(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>,
) {
    const height = Number(call.request.height);
    const block = getBlocks().get(height);

    if (!block) {
        callback({
            code: grpc.status.NOT_FOUND,
            message: `Block at height ${height} not yet produced`,
        });
        return;
    }

    callback(null, {
        height: block.height.toString(),
        state_root: block.stateRoot,
        validator_set_root: block.validatorSetRoot,
        validators: block.validators.map((v) => v.address),
    });
}

export function startGrpcServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        const proto = loadProto();
        const server = new grpc.Server();

        server.addService(
            proto.pulsarchain.voteexthandler.v1.Query.service,
            {
                GetLatestHeight: handleGetLatestHeight,
                GetAllVoteExtsByHeight: handleGetAllVoteExtsByHeight,
                GetStateAtHeight: handleGetStateAtHeight,
            },
        );

        server.bindAsync(
            `0.0.0.0:${MOCK_GRPC_PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => {
                if (err) return reject(err);
                resolve();
            },
        );
    });
}
