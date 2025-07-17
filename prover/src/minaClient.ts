import { EventEmitter } from "events";
import { fetchAccount, Field, PublicKey, Reducer } from "o1js";
import { fetchActions, fetchBlockHeight, fetchRawActions, setMinaNetwork } from "pulsar-contracts";

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
    network: "devnet" | "mainnet" | "lightnet";
    pollInterval: number;
    lastSeenBlockHeight: number;
    running: boolean;
    timer?: NodeJS.Timeout;

    constructor(
        watchedAddress: PublicKey,
        network: "devnet" | "mainnet" | "lightnet" = "devnet",
        lastSeenBlockHeight: number = 0,
        pollInterval = POLL_INTERVAL_MS
    ) {
        super();
        this.watchedAddress = watchedAddress;
        this.fromActionState = Reducer.initialActionState;
        this.network = network;
        this.pollInterval = pollInterval;
        this.lastSeenBlockHeight = lastSeenBlockHeight;
        this.running = false;
    }

    async start() {
        if (this.running) return;
        try {
            this.running = true;
            setMinaNetwork(this.network);
            this.lastSeenBlockHeight = await fetchBlockHeight(this.network);
            this.fromActionState = await fetchAccount({
                publicKey: this.watchedAddress,
            }).then((account) => {
                if (account) {
                    return account.account?.zkapp?.appState[0] || Reducer.initialActionState;
                }
                return Reducer.initialActionState;
            });

            this.emit("start", this.lastSeenBlockHeight);

            this.timer = setInterval(async () => {
                const currentBlockHeight = await fetchBlockHeight(this.network);

                if (currentBlockHeight > this.lastSeenBlockHeight) {
                    this.emit("block", currentBlockHeight);
                    let actions = await fetchRawActions(this.watchedAddress, this.fromActionState);
                    if (!actions || actions.length === 0) {
                        actions = [];
                    }
                    this.emit("actions", { blockHeight: currentBlockHeight, actions });
                    this.lastSeenBlockHeight = currentBlockHeight;
                }
            }, this.pollInterval);
        } catch (err) {
            this.emit("error", err);
        }
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.running = false;
        this.emit("stop");
    }
}
