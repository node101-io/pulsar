import { EventEmitter } from "events";
import * as grpc from "@grpc/grpc-js";
import { BlockParserResult, VoteExt } from "./interfaces.js";
import { GrpcReflection } from "grpc-js-reflection-client";
import { PublicKey, Signature } from "o1js";

const POLL_INTERVAL_MS = 5_000;

const TENDERMINT_SERVICE_NAME = "cosmos.base.tendermint.v1beta1.Service";
const MINA_KEYS_SERVICE_NAME = "cosmos.minakeys.Query";

export class PulsarClient extends EventEmitter {
    rpcAddress: string;
    pollInterval: number;
    running: boolean;
    timer?: NodeJS.Timeout;
    lastSeenBlockHeight: number;
    tmClient: any;
    mkClient: any;

    constructor(
        rpcAddress = "localhost:50051",
        initialHeight = 0,
        pollInterval = POLL_INTERVAL_MS
    ) {
        super();
        this.rpcAddress = rpcAddress;
        this.pollInterval = pollInterval;
        this.running = false;
        this.lastSeenBlockHeight = initialHeight;
        console.log(`Pulsar client initialized with RPC address: ${this.rpcAddress}`);
    }

    private async createClient(_serviceName: string, rpcAddress: string) {
        const credentials = grpc.credentials.createInsecure();

        const reflectionClient = new GrpcReflection(rpcAddress, credentials);

        const serviceDescriptor = await reflectionClient.getDescriptorBySymbol(_serviceName);

        const packageObject = serviceDescriptor.getPackageObject({
            keepCase: true,
            enums: String,
            longs: String,
        });
        let serviceClass: any = packageObject;

        const servicePath = _serviceName.split(".");
        const serviceName = servicePath.pop();

        for (const part of servicePath) serviceClass = serviceClass[part];

        serviceClass = serviceClass[serviceName!];

        return new serviceClass(rpcAddress, credentials);
    }

    async start() {
        if (this.running) return;

        try {
            this.tmClient = await this.createClient(TENDERMINT_SERVICE_NAME, this.rpcAddress);
            this.mkClient = await this.createClient(MINA_KEYS_SERVICE_NAME, this.rpcAddress);

            this.running = true;
            this.emit("start");

            await this.syncMissedBlocks();

            this.timer = setInterval(() => this.pollLatestBlock(), this.pollInterval);
        } catch (error) {
            this.emit("Error on start retrying....", error);
            setTimeout(() => this.start(), 5000);
        }
    }

    pollLatestBlock() {
        this.tmClient.GetLatestBlock({}, (err: any, res: any) => {
            if (err) return this.emit("error", err as Error);

            const { height: blockHeight } = parseTendermintBlockResponse(res);
            const voteExt: VoteExt[] = res.voteExt || [];

            if (blockHeight > this.lastSeenBlockHeight) {
                if (blockHeight === this.lastSeenBlockHeight + 1) {
                    this.emit("newPulsarBlock", { blockHeight, voteExt });
                    this.lastSeenBlockHeight = blockHeight;
                } else {
                    console.warn(
                        `Missed blocks detected: last seen ${this.lastSeenBlockHeight}, current ${blockHeight}, syncing...`
                    );
                    this.syncMissedBlocks()
                        .then(() => {
                            this.emit("newPulsarBlock", { blockHeight, voteExt });
                            this.lastSeenBlockHeight = blockHeight;
                        })
                        .catch((err) => {
                            this.emit("error", err);
                        });
                }
            }
        });
    }

    async syncMissedBlocks() {
        return new Promise<void>((resolve, reject) => {
            this.tmClient.GetLatestBlock({}, async (err: any, res: any) => {
                if (err) return reject(err as Error);

                const { height } = parseTendermintBlockResponse(res);
                console.log(
                    `Syncing missed blocks from ${this.lastSeenBlockHeight + 1} to ${height}`
                );

                for (let h = this.lastSeenBlockHeight + 1; h <= height; ++h) {
                    await this.getBlockAndEmit(h);
                }
                resolve();
            });
        });
    }

    async getBlockAndEmit(height: number): Promise<void> {
        let voteExt: VoteExt[] = [];

        let pageReq: any = { block_height: height.toString(), pagination: { limit: 200 } };

        for (;;) {
            const page = await new Promise<any>((resolve, reject) => {
                this.mkClient.VoteExtByHeight(pageReq, (err: unknown, res: any) => {
                    if (err) return reject(err);
                    resolve(res);
                });
            });

            voteExt = await this.parseVoteExtResponse(page);

            const nextKey = page.pagination?.next_key;
            if (!nextKey || nextKey.length === 0) break;

            pageReq.pagination.key = nextKey;
        }

        console.log(`Emitting new block: ${height} with ${voteExt.length} vote extensions`);

        this.emit("newPulsarBlock", { blockHeight: height, voteExt });
        this.lastSeenBlockHeight = height;
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.running = false;
        this.emit("stop");
    }

    async parseVoteExtResponse(res: any): Promise<VoteExt[]> {
        let voteExt: VoteExt[] = [];
        if (!res || !Array.isArray(res.voteExt)) return voteExt;

        try {
            for (const v of res.voteExt) {
                const recoveredPubkey = await this.recoverPubkeyFromEncoded(v.validatorAddr);

                const parsedVoteExt: VoteExt = {
                    index: v.index,
                    height: Number(v.height),
                    validatorAddr: recoveredPubkey,
                    signature: decodeMinaSignature(v.signature),
                };

                voteExt.push(parsedVoteExt);
            }
        } catch (error) {
            console.error("Error parsing vote extension response:", error);
            throw error;
        }

        return voteExt;
    }

    async recoverPubkeyFromEncoded(encoded: string): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                this.mkClient.GetMinaPubkey({ validatorAddr: encoded }, (err: any, res: any) => {
                    if (err) {
                        console.error("Error retrieving Mina public key:", err);
                        reject(err);
                        return;
                    }

                    try {
                        const publicKey = PublicKey.from({
                            x: res.x,
                            isOdd: res.is_odd === "true" ? true : false,
                        }).toBase58();
                        resolve(publicKey);
                    } catch (parseError) {
                        console.error("Error parsing public key:", parseError);
                        console.log("Response data:", res);
                        reject(parseError);
                    }
                });
            } catch (error) {
                console.error("Error recovering public key:", error);
                reject(error);
            }
        });
    }
}

export function parseTendermintBlockResponse(res: any): BlockParserResult {
    const header = res?.block?.header;
    const blockId = res?.block_id?.hash || null;
    const blockHash = header?.app_hash || null;
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
