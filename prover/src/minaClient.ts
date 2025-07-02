import { EventEmitter } from "events";
import { Field, PublicKey } from "o1js";
import { fetchActions, fetchBlockHeight } from "pulsar-contracts";

const POLL_INTERVAL_MS = 5000;

/**
 * Support this situations later:
 * - Custom RPC endpoint or local node
 * - Slice actions by optimum size
 * - Add recovery when a block skipped
 * - Handle errors gracefully
 */
export class MinaClient extends EventEmitter {
    watchedAddress: PublicKey;
    fromActionState: Field;
    network: "devnet" | "mainnet";
    pollInterval: number;
    lastSeenBlockHeight: number;
    running: boolean;
    timer?: NodeJS.Timeout;

    constructor({ watchedAddress, fromActionState, network, pollInterval = POLL_INTERVAL_MS }) {
        super();
        this.watchedAddress = watchedAddress;
        this.fromActionState = fromActionState;
        this.network = network;
        this.pollInterval = pollInterval;
        this.lastSeenBlockHeight = 0;
        this.running = false;
    }

    async start() {
        if (this.running) return;
        this.running = true;
        this.lastSeenBlockHeight = await fetchBlockHeight(this.network);

        this.emit("start", this.lastSeenBlockHeight);

        this.timer = setInterval(async () => {
            try {
                const currentBlockHeight = await fetchBlockHeight(this.network);

                if (currentBlockHeight > this.lastSeenBlockHeight) {
                    this.emit("block", currentBlockHeight);
                    const actions = await fetchActions(this.watchedAddress, this.fromActionState);
                    this.emit("actions", { blockHeight: currentBlockHeight, actions });
                    this.lastSeenBlockHeight = currentBlockHeight;
                }
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
