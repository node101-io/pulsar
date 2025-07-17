import { EventEmitter } from "events";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";

const POLL_INTERVAL_MS = 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.join(__dirname, "../../src/vote_ext.proto");
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
        console.log(`Pulsar client initialized with RPC address: ${this.rpcAddress}`);
    }

    async start() {
        if (this.running) return;
        this.running = true;
        this.emit("start");

        await this.syncMissedBlocks();

        this.timer = setInterval(() => this.pollLatestBlock(), this.pollInterval);
    }

    pollLatestBlock() {
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
    }

    async syncMissedBlocks() {
        return new Promise<void>((resolve, reject) => {
            this.client.GetLatestBlock({}, async (err: any, res: any) => {
                if (err) {
                    this.emit("error", err);
                    return reject(err);
                }
                const latestHeight: number =
                    typeof res.height === "string" ? parseInt(res.height, 10) : res.height;
                if (this.lastSeenBlockHeight < latestHeight) {
                    for (let h = this.lastSeenBlockHeight + 1; h <= latestHeight; ++h) {
                        try {
                            await this.getBlockAndEmit(h);
                        } catch (err) {
                            this.emit("error", err);
                        }
                    }
                }
                resolve();
            });
        });
    }

    getBlockAndEmit(height: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.GetBlock({ height }, (err: any, res: any) => {
                if (err) return reject(err);
                const voteExts: VoteExt[] = res.voteExts || [];
                this.emit("newPulsarBlock", { blockHeight: height, voteExts });
                this.lastSeenBlockHeight = height;
                resolve();
            });
        });
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.running = false;
        this.emit("stop");
    }
}
