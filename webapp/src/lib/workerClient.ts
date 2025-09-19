import * as Comlink from "comlink";
import type { State } from "./worker";

export type ZkappWorkerType = {
  setActiveInstance({ url }: { url: string }): Promise<void>;
  compile({ contractAddress }: { contractAddress: string }): Promise<void>;
  fetchAccount(args: { publicKey: string }): Promise<any>;
  getMinaBalance(args: { userAddress: string }): Promise<string>;
  deposit(args: { sender: string; amount: number }): Promise<string>;
  withdraw(args: { sender: string; amount: number }): Promise<string>;
  waitForTransaction(args: { hash: string; rpcUrl: string }): Promise<any>;
  getState(): Promise<State>;
};

export default class WorkerClient {
  private worker: Worker;
  private api: Comlink.Remote<ZkappWorkerType>;

  constructor() {
    if (typeof window === "undefined") {
      throw new Error("WorkerClient can only be used in the browser");
    }

    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.api = Comlink.wrap<ZkappWorkerType>(this.worker);
  }

  async setActiveInstance({ url }: { url: string }) {
    return this.api.setActiveInstance({ url });
  }

  async compile({ contractAddress }: { contractAddress: string }) {
    return this.api.compile({ contractAddress });
  }

  async fetchAccount(args: { publicKey: string }) {
    return this.api.fetchAccount(args);
  }

  async getMinaBalance(args: { userAddress: string }) {
    return this.api.getMinaBalance(args);
  }

  async deposit(args: { sender: string; amount: number }) {
    return this.api.deposit(args);
  }

  async withdraw(args: { sender: string; amount: number }) {
    return this.api.withdraw(args);
  }

  async waitForTransaction(args: { hash: string; rpcUrl: string }) {
    return this.api.waitForTransaction(args);
  }

  async getState() {
    return this.api.getState();
  }

  terminate() {
    this.worker.terminate();
  }
}
