"use client";

import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import Image from "next/image";
import { useMinaWallet } from "@/app/_providers/mina-wallet";
import {
  EXPECTED_MINA_NETWORK_IDS,
  MINA_RPC_URL,
  MINA_TX_FEE_NANOMINA,
  MINIMUM_DEPOSIT_NANOMINA,
  WITHDRAW_DOWN_PAYMENT_NANOMINA,
} from "@/lib/constants";
import { toast } from "react-hot-toast";
import {
  useMinaPrice,
  useMinaBalance,
  useKeyStore,
  usePendingBridgeTransfers,
  usePminaBalance,
  usePulsarAddress,
} from "@/lib/hooks";
import { useWorker, useWorkerInit } from "@/app/_providers/worker";
import { DECIMALS, formatAmount, parseAmount, toDisplayNumber } from "@/lib/amount";
import { recordPendingTransfer } from "@/lib/pending-transfers";
import { fetchMinaHeight, fetchPulsarHeight } from "@/lib/utils";
import Link from "next/link";

type Direction = "deposit" | "withdraw";

function truncateAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

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
  const [direction, setDirection] = useState<Direction>("deposit");
  const [amount, setAmount] = useState<string>("");
  const [isTransacting, setIsTransacting] = useState(false);

  const { data: priceData } = useMinaPrice();
  const { data: keyStore } = useKeyStore(account);
  const { data: connectedPulsarAddress } = usePulsarAddress();
  const pendingTransfers = usePendingBridgeTransfers(account);

  const { data: minaBalanceData, isError: minaUnreachable } = useMinaBalance(
    account,
    { enabled: !!account && isConnected },
  );

  // The registered Pulsar account: where a deposit is credited, where a
  // withdrawal burns from. The registry decides this, not the connected
  // wallet — a Mina key can never be re-pointed at another account.
  const pulsarAccount = keyStore?.keyStore?.pulsarAddress;
  const isRegistered = !!pulsarAccount;

  // The withdrawable balance is the REGISTERED account's, which is why this is
  // keyed by the registry's answer and not by whatever Keplr has selected —
  // and why withdrawing needs no Cosmos wallet at all.
  const { data: pminaBalanceData } = usePminaBalance(pulsarAccount, {
    enabled: !!pulsarAccount,
  });

  const isDeposit = direction === "deposit";
  const minaBalance = minaBalanceData ?? 0n;
  const pminaBalance = pminaBalanceData ?? 0n;
  const amountNano = parseAmount(amount);

  // Everything a withdrawal costs on the Mina side. The down payment rides in
  // the same transaction and comes back with the payout when the chain judges
  // the withdrawal valid; the fee does not.
  const withdrawMinaCost = WITHDRAW_DOWN_PAYMENT_NANOMINA + MINA_TX_FEE_NANOMINA;

  // The fee leaves the same account as a deposit, so this — not the balance —
  // is the most that can be deposited. A withdrawal's maximum is the full
  // pMINA balance: its Mina-side costs are separate, and the balance-race
  // warning below owns the risk of cutting it that close.
  const maxSendable = isDeposit
    ? minaBalance > MINA_TX_FEE_NANOMINA
      ? minaBalance - MINA_TX_FEE_NANOMINA
      : 0n
    : pminaBalance;

  const isWrongDestination =
    isDeposit &&
    !!pulsarAccount &&
    !!connectedPulsarAddress &&
    pulsarAccount !== connectedPulsarAddress;

  const onExpectedNetwork =
    !network || EXPECTED_MINA_NETWORK_IDS.includes(network.networkID);
  // No verdict against an unreadable balance: comparing to the 0n default
  // mid-outage would flag every amount as over-balance.
  const isOverBalance =
    amountNano > 0n &&
    (isDeposit
      ? !minaUnreachable && amountNano + MINA_TX_FEE_NANOMINA > minaBalance
      : amountNano > pminaBalance);
  const isBelowMinimum =
    isDeposit && amountNano > 0n && amountNano < MINIMUM_DEPOSIT_NANOMINA;
  // Without this much MINA the withdrawal transaction itself cannot be built,
  // down payment included.
  const cannotAffordWithdraw = !isDeposit && minaBalance < withdrawMinaCost;

  // Compiling takes minutes, so start as soon as a wallet is connected rather
  // than when the user clicks — otherwise the button appears to hang before
  // the wallet ever opens.
  useEffect(() => {
    if (isConnected && workerReady && !isInitialized && !isInitializing) {
      initializeWorker().catch((error) => console.error(error));
    }
  }, [isConnected, workerReady, isInitialized, isInitializing, initializeWorker]);

  const switchDirection = () => {
    setDirection(isDeposit ? "withdraw" : "deposit");
    // The number means a different token in the other direction; keeping it
    // would invite signing it unread.
    setAmount("");
  };

  const blockedReason = !isConnected
    ? "Connect your Mina wallet"
    : !onExpectedNetwork
      ? `Auro is on ${network?.networkID} — switch to Devnet`
      : minaUnreachable
        // Mina's problem, and said so: a balance shown as 0.000 with a live
        // deposit button reads as Pulsar having lost the funds. Everything
        // downstream needs the same node anyway — the transaction could not
        // be built either.
        ? "Mina devnet is unavailable right now — not a Pulsar issue. Your balance is unaffected; try again later."
        : !isRegistered
        ? `Register your keys before ${isDeposit ? "depositing" : "withdrawing"}`
        : isWrongDestination
          ? `This Mina account is registered to ${truncateAddress(pulsarAccount!)}, not the connected ${truncateAddress(connectedPulsarAddress!)} — the deposit would land there. Switch Keplr to that account.`
          : cannotAffordWithdraw
            ? `Withdrawing needs ${formatAmount(withdrawMinaCost)} MINA on Mina — a ${formatAmount(WITHDRAW_DOWN_PAYMENT_NANOMINA)} MINA deposit returned when it settles, plus the ${formatAmount(MINA_TX_FEE_NANOMINA)} MINA fee`
            : isBelowMinimum
              ? `Minimum deposit is ${formatAmount(MINIMUM_DEPOSIT_NANOMINA)} MINA`
              : isOverBalance
                ? isDeposit
                  ? `Insufficient MINA — ${formatAmount(MINA_TX_FEE_NANOMINA)} MINA is needed for the fee on top of the deposit`
                  : `Insufficient pMINA — your registered account holds ${formatAmount(pminaBalance)}`
                : null;

  const handleSubmit = async () => {
    if (blockedReason || !account || !worker) return;

    setIsTransacting(true);
    try {
      if (!window.mina?.sendTransaction) {
        throw new Error("Auro Wallet not found. Please install Auro Wallet.");
      }

      await initializeWorker();

      const args = {
        sender: account,
        amount: amountNano.toString(),
        fee: MINA_TX_FEE_NANOMINA.toString(),
      };
      const json = isDeposit
        ? await worker.deposit(args)
        : await worker.withdraw(args);

      const result = await window.mina.sendTransaction({ transaction: json });
      if (!("hash" in result)) {
        const code = (result as { code?: number }).code;
        throw new Error(
          code === 1002
            ? "Transaction rejected in the wallet."
            : `Transaction failed: ${(result as { message?: string }).message ?? "unknown error"}`,
        );
      }

      toast.success(
        `${isDeposit ? "Deposit" : "Withdrawal"} submitted: ${result.hash.slice(0, 10)}…`,
      );

      // Recorded the moment the wallet accepts it, before waiting on anything:
      // this is the only trace the transfer leaves until Pulsar scans it, and
      // a user who closes the tab during the wait would otherwise lose it. The
      // two heights are the watermarks that later tell this transfer apart
      // from an older one — see reconcilePendingTransfers. They are read
      // together and may fail independently, which the record allows for.
      const [pulsarHeight, minaHeight] = await Promise.allSettled([
        fetchPulsarHeight(),
        fetchMinaHeight(),
      ]);
      recordPendingTransfer({
        minaTxHash: result.hash,
        minaSender: account,
        pulsarAccount: pulsarAccount!,
        amount: amountNano,
        direction,
        pulsarHeightAtSend:
          pulsarHeight.status === "fulfilled" ? pulsarHeight.value : null,
        minaHeightAtSend:
          minaHeight.status === "fulfilled" ? minaHeight.value : null,
        sentAt: Date.now(),
      });

      const pending = toast.loading("Waiting for confirmation on Mina…");
      const status = await worker.waitForTransaction({
        hash: result.hash,
        rpcUrl: MINA_RPC_URL,
      });
      toast.dismiss(pending);

      if (!status.success) {
        throw new Error(
          status.failureReason ||
            `${isDeposit ? "Deposit" : "Withdrawal"} failed on-chain`,
        );
      }

      // The chain reads Mina at its confirmation depth, so the answer lands
      // long after the transaction does. Saying so here, and pointing at the
      // page that tracks it, prevents a support ticket for every transfer.
      toast.success(
        isDeposit
          ? "Deposit confirmed on Mina. Pulsar credits it once the chain scans this block — follow it under Transactions."
          : "Withdrawal confirmed on Mina. Pulsar burns the pMINA once it scans this block, and the MINA — deposit included — pays out with the settlement that follows. Follow it under Transactions.",
        { duration: 8000 },
      );
      setAmount("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `${isDeposit ? "Deposit" : "Withdrawal"} failed`,
      );
    } finally {
      setIsTransacting(false);
    }
  };

  const disabled = !!blockedReason || !amount || isTransacting || !workerReady;

  const minaSide = (
    <div className="flex flex-col items-end gap-1.5">
      <span className="text-ink-muted text-[13px] leading-none">Mina Protocol</span>
      {!isDeposit && account && (
        <span className="text-ink-subtle text-[13px] leading-none tabular-nums" title={account}>
          {truncateAddress(account)}
        </span>
      )}
    </div>
  );

  const pulsarSide = (
    <div className="flex flex-col items-end gap-1.5">
      <span className="text-ink-muted text-[13px] leading-none">Pulsar Network</span>
      {/* The registry picks this account, not the connected wallet. Showing it
          is the only way a user can tell the two apart before signing. */}
      {pulsarAccount && (
        <span
          className={cn(
            "text-[13px] leading-none tabular-nums",
            isWrongDestination ? "text-negative" : "text-ink-subtle",
          )}
          title={pulsarAccount}
        >
          {truncateAddress(pulsarAccount)}
        </span>
      )}
    </div>
  );

  return (
    <main className="bg-canvas flex flex-1 flex-col justify-center overflow-y-auto px-6 py-12">
      <div className="mb-12 text-center">
        <h1 className="brand-title text-ink text-[clamp(32px,4vw,56px)] leading-[0.95] font-[750] tracking-[-0.035em]">
          {isDeposit ? "Jump To Pulsar" : "Back To Mina"}
        </h1>
        <p className="text-ink-muted mx-auto mt-4 max-w-105 text-[17px] leading-[1.35]">
          {isDeposit
            ? "Bridge your MINA funds to Pulsar for a seamless DeFi experience"
            : "Bridge your pMINA back to the Mina account it is registered to"}
        </p>
      </div>

      <div className="bg-surface border-line mx-auto flex w-full max-w-105 flex-col gap-2 rounded-lg border p-2">
        <div className="bg-canvas border-line flex flex-col rounded-md border p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-ink-subtle text-xs leading-none tracking-[0.08em] uppercase">
              From
            </span>
            {isDeposit ? (
              <span className="text-ink-muted text-[13px] leading-none">Mina Protocol</span>
            ) : (
              pulsarSide
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <input
              min="0"
              step="1.000"
              placeholder="0.000"
              aria-label={`Amount to ${direction}`}
              className="text-ink placeholder:text-ink-subtle w-full text-3xl leading-none font-[550] tracking-[-0.02em] tabular-nums focus:outline-none"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="border-line flex shrink-0 items-center gap-2 rounded-md border px-3 py-2">
              <Image
                src={isDeposit ? "/mina-token-logo.png" : "/pulsar-token-logo.svg"}
                alt=""
                width={18}
                height={18}
                className="size-4.5 rounded-full"
              />
              <span className="text-ink text-[13px] leading-none font-medium">
                {isDeposit ? "MINA" : "pMINA"}
              </span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[13px] leading-none">
            {(isOverBalance || isBelowMinimum) && amount !== "" && (
              <span className="text-negative">
                {isBelowMinimum
                  ? `Minimum ${formatAmount(MINIMUM_DEPOSIT_NANOMINA)} MINA`
                  : `Insufficient ${isDeposit ? "MINA" : "pMINA"} balance`}
              </span>
            )}
            {/* An unreadable balance is not a zero balance: "Max: 0.000"
                during a Mina outage tells a funded user their MINA is gone. */}
            {isDeposit && minaUnreachable ? (
              <span
                className="text-ink-subtle ml-auto"
                title="Mina devnet is unavailable — your balance cannot be read right now"
              >
                Max: <span className="tabular-nums">—</span> MINA
              </span>
            ) : (
              <button
                type="button"
                className="text-ink-subtle hover:text-ink ml-auto cursor-pointer transition-colors"
                title={
                  isDeposit
                    ? `Balance minus the ${formatAmount(MINA_TX_FEE_NANOMINA)} MINA fee`
                    : "Your registered account's full pMINA balance"
                }
                onClick={() => setAmount(formatAmount(maxSendable, DECIMALS))}
              >
                Max: <span className="tabular-nums">{formatAmount(maxSendable)}</span>{" "}
                {isDeposit ? "MINA" : "pMINA"}
              </button>
            )}
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            aria-label={isDeposit ? "Switch to withdraw" : "Switch to deposit"}
            onClick={switchDirection}
            className="border-line bg-surface hover:border-ink absolute -top-4.25 left-1/2 z-1 flex size-8 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border transition-colors"
          >
            <Image src="/opposite-arrows.svg" alt="" width={12} height={12} />
          </button>
          <div className="bg-canvas border-line flex items-start justify-between gap-2 rounded-md border p-5">
            <span className="text-ink-subtle text-xs leading-none tracking-[0.08em] uppercase">
              To
            </span>
            {isDeposit ? pulsarSide : minaSide}
          </div>
        </div>

        <div
          className={cn(
            "grid transition-all duration-300 ease-in-out",
            amount ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden">
            <div className="bg-canvas border-line flex flex-col gap-4 rounded-md border p-5">
              <div className="flex w-full items-start justify-between gap-2">
                <span className="text-ink-subtle max-w-22.5 text-xs leading-[1.3] tracking-[0.08em] uppercase">
                  You will receive
                </span>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-ink text-[15px] leading-none font-medium tabular-nums">
                    {formatAmount(amountNano)} {isDeposit ? "pMINA" : "MINA"}
                  </span>
                  <span className="text-ink-subtle text-[13px] leading-none tabular-nums">
                    ~${(toDisplayNumber(amountNano) * (priceData?.price ?? 0)).toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="bg-line h-px w-full" />
              <div className="flex w-full items-center gap-2">
                <Image src="/clock.svg" alt="" width={14} height={14} className="opacity-60" />
                <span className="text-ink-subtle mr-auto text-[13px] leading-none">~2 hours</span>
                <span className="text-ink-subtle text-[13px] leading-none tabular-nums">
                  Fee {formatAmount(MINA_TX_FEE_NANOMINA)} MINA
                  {!isDeposit &&
                    ` + ${formatAmount(WITHDRAW_DOWN_PAYMENT_NANOMINA, 0)} MINA refundable deposit`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* The one risk the UI cannot gate away: the chain checks the pMINA
            balance when it SCANS the withdrawal, hours from now. Spending in
            between voids the withdrawal and the contract keeps the down
            payment. Said every time, because the cost of forgetting is real
            money and the check is hours away from the signature. */}
        {!isDeposit && amountNano > 0n && !blockedReason && (
          <p className="border-accent-strong text-ink-muted mx-3 my-1 border-l-2 py-0.5 pl-4 text-[13px] leading-[1.4]">
            Keep at least {formatAmount(amountNano)} pMINA in your account until
            this settles (~2 hours). If the balance dips below it, the
            withdrawal is voided and the {formatAmount(WITHDRAW_DOWN_PAYMENT_NANOMINA, 0)}{" "}
            MINA deposit is forfeited.
          </p>
        )}

        {blockedReason && isConnected && (
          <p className="border-accent-strong text-ink-muted mx-3 my-1 border-l-2 py-0.5 pl-4 text-[13px] leading-[1.4]">
            {blockedReason}
          </p>
        )}

        {/* The minutes after a transfer are when a user is most likely to
            think the money vanished. This is the one place they are still
            looking. */}
        {pendingTransfers.length > 0 && (
          <Link
            href="/transactions"
            className="text-ink-muted hover:text-ink mx-3 my-1 flex items-center gap-2 text-[13px] leading-[1.4] transition-colors"
          >
            <Image src="/clock.svg" alt="" width={13} height={13} className="opacity-60" />
            {pendingTransfers.length === 1
              ? `${formatAmount(pendingTransfers[0].amount)} ${pendingTransfers[0].direction === "deposit" ? "MINA" : "pMINA"} in flight`
              : `${pendingTransfers.length} transfers in flight`}
            <span className="text-ink-subtle ml-auto">Track →</span>
          </Link>
        )}

        <button
          disabled={disabled}
          className="brand-button mt-1 w-full"
          onClick={handleSubmit}
        >
          {!workerReady
            ? "Loading…"
            : isInitializing
              ? `Preparing proofs…${totalPrograms ? ` ${compiledCount}/${totalPrograms}` : ""}`
              : isTransacting
                ? "Processing…"
                : isDeposit
                  ? "Deposit"
                  : "Withdraw"}
        </button>
      </div>
    </main>
  );
}
