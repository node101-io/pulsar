import { EventEmitter } from "events";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";

const POLL_INTERVAL_MS = 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.join(__dirname, "../../src/mock/vote_ext.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const protoDescriptor: any = grpc.loadPackageDefinition(packageDefinition);
const BlockService = protoDescriptor.voteext.BlockService;

export interface VoteExt {
    index: string;
    height: number;
    validatorAddr: string;
    signature: string;
}

export class PulsarClient extends EventEmitter {
    rpcAddress: string;
    pollInterval: number;
    running: boolean;
    timer?: NodeJS.Timeout;
    lastSeenBlockHeight: number;
    client: any;

    constructor(rpcAddress = "localhost:50051", pollInterval = POLL_INTERVAL_MS) {
        super();
        this.rpcAddress = rpcAddress;
        this.pollInterval = pollInterval;
        this.running = false;
        this.lastSeenBlockHeight = 0;
        this.client = new BlockService(this.rpcAddress, grpc.credentials.createInsecure());
    }

    async start() {
        if (this.running) return;
        this.running = true;
        this.emit("start");
        this.timer = setInterval(async () => {
            try {
                this.client.GetLatestBlock({}, (err: any, res: any) => {
                    if (err) {
                        this.emit("error", err);
                        return;
                    }
                    const blockHeight: number =
                        typeof res.height === "string" ? parseInt(res.height, 10) : res.height;
                    const voteExts: VoteExt[] = res.voteExts || [];

                    if (blockHeight > this.lastSeenBlockHeight) {
                        this.emit("newPulsarBlock", { blockHeight, voteExts });
                        this.lastSeenBlockHeight = blockHeight;
                    }
                });
            } catch (err) {
                this.emit("error", err);
            }
        }, this.pollInterval);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.running = false;
        this.emit("stop");
    }
}
