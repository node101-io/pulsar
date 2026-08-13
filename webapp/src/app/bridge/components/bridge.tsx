"use client";

import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import Image from "next/image";
import { useMinaWallet } from "@/app/_providers/mina-wallet";
import {
  BRIDGE_ADDRESS,
  EXPECTED_MINA_NETWORK_IDS,
  MINA_RPC_URL,
  MINA_TX_FEE_NANOMINA,
  MINIMUM_DEPOSIT_NANOMINA,
} from "@/lib/constants";
import { toast } from "react-hot-toast";
import { useMinaPrice, useMinaBalance, useKeyStore } from "@/lib/hooks";
import { useWorker, useWorkerInit } from "@/app/_providers/worker";

const NANO = 1_000_000_000;

export default function Bridge() {
  const { account, isConnected, network } = useMinaWallet();
  const worker = useWorker();
  const {
    isInitialized,
    isInitializing,
    workerReady,
    initializeWorker,
    compiledCount,
    totalPrograms,
  } = useWorkerInit();
  const [amount, setAmount] = useState<string>("");
  const [isTransacting, setIsTransacting] = useState(false);

  const { data: priceData } = useMinaPrice();
  const { data: keyStore } = useKeyStore(account);

  const { data: balanceData } = useMinaBalance(account, {
    enabled: !!account && isConnected,
  });

  const balance = balanceData ? Number(balanceData) / NANO : 0;
  const amountNano = amount ? BigInt(Math.floor(Number(amount) * NANO)) : 0n;

  const isRegistered = !!keyStore?.keyStore;
  const onExpectedNetwork =
    !network || EXPECTED_MINA_NETWORK_IDS.includes(network.networkID);
  const isOverBalance = Number(amount) > balance;
  const isBelowMinimum = amountNano > 0n && amountNano < MINIMUM_DEPOSIT_NANOMINA;

  // Compiling takes minutes, so start as soon as a wallet is connected rather
  // than when the user clicks — otherwise Deposit appears to hang before the
  // wallet ever opens.
  useEffect(() => {
    if (isConnected && workerReady && !isInitialized && !isInitializing) {
      initializeWorker().catch((error) => console.error(error));
    }
  }, [isConnected, workerReady, isInitialized, isInitializing, initializeWorker]);

  const blockedReason = !isConnected
    ? "Connect your Mina wallet"
    : !onExpectedNetwork
      ? `Auro is on ${network?.networkID} — switch to Devnet`
      : !isRegistered
        ? "Register your keys before depositing"
        : isBelowMinimum
          ? `Minimum deposit is ${Number(MINIMUM_DEPOSIT_NANOMINA) / NANO} MINA`
          : isOverBalance
            ? "Insufficient MINA balance"
            : null;

  const handleDeposit = async () => {
    if (blockedReason || !account || !worker) return;

    setIsTransacting(true);
    try {
      if (!window.mina?.sendTransaction) {
        throw new Error("Auro Wallet not found. Please install Auro Wallet.");
      }

      await initializeWorker();

      const json = await worker.deposit({
        sender: account,
        amount: amountNano.toString(),
        fee: MINA_TX_FEE_NANOMINA,
      });

      const result = await window.mina.sendTransaction({ transaction: json });
      if (!("hash" in result)) {
        const code = (result as { code?: number }).code;
        throw new Error(
          code === 1002
            ? "Transaction rejected in the wallet."
            : `Transaction failed: ${(result as { message?: string }).message ?? "unknown error"}`,
        );
      }

      toast.success(`Deposit submitted: ${result.hash.slice(0, 10)}…`);

      const pending = toast.loading("Waiting for confirmation on Mina…");
      const status = await worker.waitForTransaction({
        hash: result.hash,
        rpcUrl: MINA_RPC_URL,
      });
      toast.dismiss(pending);

      if (!status.success) {
        throw new Error(status.failureReason || "Deposit failed on-chain");
      }

      // The chain reads Mina at its confirmation depth, so the credit lands
      // long after the transaction does. Saying so here prevents a support
      // ticket for every deposit.
      toast.success(
        "Deposit confirmed on Mina. Pulsar credits it once the chain scans this block — allow about two hours.",
        { duration: 8000 },
      );
      setAmount("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deposit failed");
    } finally {
      setIsTransacting(false);
    }
  };

  const disabled = !!blockedReason || !amount || isTransacting || !workerReady;

  return (
    <main className="bg-canvas flex flex-1 flex-col justify-center overflow-y-auto px-6 py-12">
      <div className="mb-12 text-center">
        <h1 className="brand-title text-ink text-[clamp(32px,4vw,56px)] leading-[0.95] font-[750] tracking-[-0.035em]">
          Jump To Pulsar
        </h1>
        <p className="text-ink-muted mx-auto mt-4 max-w-[420px] text-[17px] leading-[1.35]">
          Bridge your MINA funds to Pulsar for a seamless DeFi experience
        </p>
      </div>

      <div className="bg-surface border-line mx-auto flex w-full max-w-[420px] flex-col gap-2 rounded-[8px] border p-2">
        <div className="bg-canvas border-line flex flex-col rounded-[6px] border p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-ink-subtle text-[12px] leading-none tracking-[0.08em] uppercase">
              From
            </span>
            <span className="text-ink-muted text-[13px] leading-none">Mina Protocol</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <input
              min="0"
              step="1.000"
              placeholder="0.000"
              aria-label="Amount to deposit"
              className="text-ink placeholder:text-ink-subtle w-full text-[30px] leading-none font-[550] tracking-[-0.02em] tabular-nums focus:outline-none"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="border-line flex shrink-0 items-center gap-2 rounded-[6px] border px-3 py-2">
              <Image src="/mina-token-logo.png" alt="" width={18} height={18} className="size-[18px] rounded-full" />
              <span className="text-ink text-[13px] leading-none font-medium">MINA</span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[13px] leading-none">
            {(isOverBalance || isBelowMinimum) && amount !== "" && (
              <span className="text-negative">
                {isBelowMinimum
                  ? `Minimum ${Number(MINIMUM_DEPOSIT_NANOMINA) / NANO} MINA`
                  : "Insufficient MINA balance"}
              </span>
            )}
            <button
              type="button"
              className="text-ink-subtle hover:text-ink ml-auto cursor-pointer transition-colors"
              onClick={() => setAmount(balance.toFixed(3))}
            >
              Max: <span className="tabular-nums">{balance.toFixed(3)}</span> MINA
            </button>
          </div>
        </div>

        <div className="bg-canvas border-line flex items-center justify-between rounded-[6px] border p-5">
          <span className="text-ink-subtle text-[12px] leading-none tracking-[0.08em] uppercase">
            To
          </span>
          <span className="text-ink-muted text-[13px] leading-none">Pulsar Network</span>
        </div>

        <div
          className={cn(
            "grid transition-all duration-300 ease-in-out",
            amount ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="bg-canvas border-line flex flex-col gap-4 rounded-[6px] border p-5">
              <div className="flex w-full items-start justify-between gap-2">
                <span className="text-ink-subtle max-w-[90px] text-[12px] leading-[1.3] tracking-[0.08em] uppercase">
                  You will receive
                </span>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-ink text-[15px] leading-none font-medium tabular-nums">
                    {Number(amount || 0).toFixed(3)} pMINA
                  </span>
                  <span className="text-ink-subtle text-[13px] leading-none tabular-nums">
                    ~${(Number(amount || 0) * (priceData?.price || 0)).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="bg-line h-px w-full" />
              <div className="flex w-full items-center gap-2">
                <Image src="/clock.svg" alt="" width={14} height={14} className="opacity-60" />
                <span className="text-ink-subtle mr-auto text-[13px] leading-none">~2 hours</span>
                <span className="text-ink-subtle text-[13px] leading-none tabular-nums">
                  Fee {MINA_TX_FEE_NANOMINA / NANO} MINA
                </span>
              </div>
            </div>
          </div>
        </div>

        {blockedReason && isConnected && (
          <p className="border-accent-strong text-ink-muted mx-3 my-1 border-l-2 py-0.5 pl-4 text-[13px] leading-[1.4]">
            {blockedReason}
          </p>
        )}

        <button
          disabled={disabled}
          className="brand-button mt-1 w-full"
          onClick={handleDeposit}
        >
          {!workerReady
            ? "Loading…"
            : isInitializing
              ? `Preparing proofs…${totalPrograms ? ` ${compiledCount}/${totalPrograms}` : ""}`
              : isTransacting
                ? "Processing…"
                : "Deposit"}
        </button>
      </div>
    </main>
  );
}
