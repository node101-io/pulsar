import * as Comlink from "comlink";
import {
  SettlementContract,
  PulsarAuth,
  CosmosSignature,
  MultisigVerifierProgram,
  SettleAttestProgram,
  ApprovalTailProgram,
  ApprovalQuorumProgram,
  ActionStackProgram,
  waitForTransaction,
} from "pulsar-contracts";
import { fetchAccount, Field, Mina, PublicKey, UInt64 } from "o1js";

import { loadO1jsCache } from "./o1js-cache";

const state = {
  status: "idle" as "idle" | "compiling" | "ready",
  contract: null as SettlementContract | null,
  compiledCount: 0,
  totalPrograms: 0,
};

export type State = typeof state;

// A zkApp method call needs a proof, so the browser must compile the contract
// — and compiling it means compiling every program whose proofs its methods
// verify, since their verification keys are baked in at compile time. That is
// the whole list below, several minutes cold. Deposits cannot avoid it.
const PROGRAMS = [
  ["MultisigVerifierProgram", MultisigVerifierProgram],
  ["SettleAttestProgram", SettleAttestProgram],
  ["ApprovalTailProgram", ApprovalTailProgram],
  ["ApprovalQuorumProgram", ApprovalQuorumProgram],
  ["ActionStackProgram", ActionStackProgram],
] as const;

class ZkappWorker {
  async setActiveInstance({ url }: { url: string }) {
    Mina.setActiveInstance(Mina.Network({ mina: url }));
  }

  async compile({ contractAddress }: { contractAddress: string }) {
    if (state.status !== "idle") return;
    state.status = "compiling";
    state.compiledCount = 0;
    state.totalPrograms = PROGRAMS.length + 1;

    // Prebuilt cache, fetched once: without it these six compiles take about
    // four minutes, with it about sixteen seconds.
    const cache = await loadO1jsCache();
    if (!cache) {
      console.warn("o1js cache unavailable — compiling from scratch");
    }

    for (const [name, program] of PROGRAMS) {
      console.time(`compile ${name}`);
      await program.compile({ cache });
      console.timeEnd(`compile ${name}`);
      state.compiledCount++;
    }

    console.time("compile SettlementContract");
    await SettlementContract.compile({ cache });
    console.timeEnd("compile SettlementContract");
    state.compiledCount++;

    state.contract = new SettlementContract(
      PublicKey.fromBase58(contractAddress),
    );
    state.status = "ready";
  }

  async fetchAccount(args: { publicKey: string }) {
    return await fetchAccount({ publicKey: PublicKey.fromBase58(args.publicKey) });
  }

  async getMinaBalance({ userAddress }: { userAddress: string }) {
    try {
      const publicKey = PublicKey.fromBase58(userAddress);
      await fetchAccount({ publicKey });
      return Mina.getBalance(publicKey).toString();
    } catch {
      return "0";
    }
  }

  // Both amounts cross as decimal strings of nanomina: bigint is what the app
  // counts in (see lib/amount.ts), and a number here would be one more place
  // an amount could pick up float error on its way to a signature.
  async deposit({
    sender,
    amount,
    fee,
  }: {
    sender: string;
    amount: string;
    fee: string;
  }) {
    const senderPubKey = PublicKey.fromBase58(sender);

    // pulsarAuth carries a Cosmos address and signature that the chain does
    // NOT read today: the archive wrapper decodes only [type, x, isOdd,
    // amount], and the keeper resolves the destination through keyregistry
    // instead. Passing empty keeps the action shape valid without implying a
    // binding that is not enforced — the registration IS the binding.
    const tx = await Mina.transaction({ sender: senderPubKey, fee }, async () => {
      await state.contract!.deposit(
        UInt64.from(amount),
        PulsarAuth.from(Field(0), CosmosSignature.empty()),
      );
    });

    await tx.prove();
    return tx.toJSON();
  }

  async withdraw({
    sender,
    amount,
    fee,
  }: {
    sender: string;
    amount: string;
    fee: string;
  }) {
    const senderPubKey = PublicKey.fromBase58(sender);

    // The method takes only the amount: the payout target is the sender
    // itself, fixed by the action, and the 1 MINA down payment is moved by an
    // AccountUpdate the method adds — Auro shows it as part of this
    // transaction. amount is pmina to burn on Pulsar, expressed in the same
    // base units, and comes back as MINA (plus the down payment) when the
    // chain's verdict settles.
    const tx = await Mina.transaction({ sender: senderPubKey, fee }, async () => {
      await state.contract!.withdraw(UInt64.from(amount));
    });

    await tx.prove();
    return tx.toJSON();
  }

  async waitForTransaction({ hash, rpcUrl }: { hash: string; rpcUrl: string }) {
    return await waitForTransaction(hash, rpcUrl);
  }

  getState() {
    return { ...state };
  }
}

Comlink.expose(new ZkappWorker());
