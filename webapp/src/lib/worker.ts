import "reflect-metadata";
import * as Comlink from "comlink";
import {
  SettlementContract,
  PulsarAuth,
  CosmosSignature,
  MultisigVerifierProgram,
  ActionStackProgram,
  ValidateReduceProgram,
  waitForTransaction,
} from "pulsar-contracts";
import { fetchAccount, Field, Mina, PublicKey, UInt64 } from "o1js";

const state = {
  status: "idle" as "idle" | "compiling" | "ready",
  contract: null as SettlementContract | null,
};

export type State = typeof state;

class ZkappWorker {
  async setActiveInstance({ url }: { url: string }) {
    Mina.setActiveInstance(Mina.Network({ mina: url }));
  }

  async compile({ contractAddress }: { contractAddress: string }) {
    if (state.status !== "idle") return;
    state.status = "compiling";

    console.time("compile MultisigVerifierProgram");
    await MultisigVerifierProgram.compile();
    console.timeEnd("compile MultisigVerifierProgram");

    console.time("compile ActionStackProgram");
    await ActionStackProgram.compile();
    console.timeEnd("compile ActionStackProgram");

    console.time("compile ValidateReduceProgram");
    await ValidateReduceProgram.compile();
    console.timeEnd("compile ValidateReduceProgram");

    console.time("compile SettlementContract");
    await SettlementContract.compile();
    console.timeEnd("compile SettlementContract");

    state.contract = new SettlementContract(
      PublicKey.fromBase58(contractAddress)
    );
    state.status = "ready";
  }

  async fetchAccount(args: { publicKey: string }) {
    const publicKey = PublicKey.fromBase58(args.publicKey);
    return await fetchAccount({
      publicKey,
    });
  }

  async getMinaBalance({ userAddress }: { userAddress: string }) {
    try {
      const publicKey = PublicKey.fromBase58(userAddress);
      await fetchAccount({
        publicKey,
      });
      const balance = Mina.getBalance(publicKey);
      return balance.toString();
    } catch (e) {
      return "0";
    }
  }

  async deposit({ sender, amount }: { sender: string; amount: number }) {
    try {
      const senderPubKey = PublicKey.fromBase58(sender);
      const tx = await Mina.transaction(
        { sender: senderPubKey, fee: 1e9 },
        async () => {
          await state.contract!.deposit(
            UInt64.from(amount),
            PulsarAuth.from(Field(0), CosmosSignature.empty())
          );
        }
      );

      await tx.prove();
      return tx.toJSON();
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async waitForTransaction({ hash, rpcUrl }: { hash: string; rpcUrl: string }) {
    return await waitForTransaction(hash, rpcUrl);
  }

  getState() {
    return { ...state };
  }
}

Comlink.expose(new ZkappWorker());

console.log("Comlink Web Worker Successfully Initialized.");
