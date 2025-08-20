import { EventEmitter } from "events";
import { fetchAccount, Field, PublicKey, Reducer } from "o1js";
import {
    fetchBlockHeight,
    fetchRawActions,
    setMinaNetwork,
    SettlementContract,
} from "pulsar-contracts";

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
    settlementContract: SettlementContract;
    fromActionState: Field;
    network: "devnet" | "mainnet" | "lightnet";
    pollInterval: number;
    lastSeenBlockHeight: number;
    running: boolean;
    timer?: NodeJS.Timeout;

    constructor(
        watchedAddress: PublicKey,
        network: "devnet" | "mainnet" | "lightnet" = (process.env.MINA_NETWORK as
            | "devnet"
            | "mainnet"
            | "lightnet") || "lightnet",
        lastSeenBlockHeight: number = 0,
        pollInterval = POLL_INTERVAL_MS
    ) {
        super();
        this.watchedAddress = watchedAddress;
        this.settlementContract = new SettlementContract(watchedAddress);
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
            await fetchAccount({
                publicKey: this.watchedAddress,
            });

            this.fromActionState = this.settlementContract.actionState.get();

            this.emit("start", this.lastSeenBlockHeight);

            this.timer = setInterval(async () => {
                const currentBlockHeight = await fetchBlockHeight(this.network);

                if (currentBlockHeight > this.lastSeenBlockHeight) {
                    this.emit("block", currentBlockHeight);
                    let actions = await fetchRawActions(this.watchedAddress, this.fromActionState);
                    console.table({
                        actionState: this.settlementContract.actionState.get().toString(),
                        merkleListRoot: this.settlementContract.merkleListRoot.get().toString(),
                        stateRoot: this.settlementContract.stateRoot.get().toString(),
                        blockHeight: this.settlementContract.blockHeight.get().toString(),
                        depositListHash: this.settlementContract.depositListHash.get().toString(),
                        withdrawalListHash: this.settlementContract.withdrawalListHash
                            .get()
                            .toString(),
                        rewardListHash: this.settlementContract.rewardListHash.get().toString(),
                        accountActionState: this.settlementContract.account.actionState
                            .get()
                            .toString(),
                    });
                    console.log(this.lastSeenBlockHeight, this.fromActionState.toString(), actions);
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
