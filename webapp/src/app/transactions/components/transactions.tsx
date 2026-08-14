"use client"

import { cn, type BridgeTransfer } from "@/lib/utils"
import { formatAmount } from "@/lib/amount"
import {
  useAllBridgeTransactions,
  useBridgeScanProgress,
  useKeyStore,
  usePendingBridgeTransfers,
  usePulsarAddress,
} from "@/lib/hooks"
import {
  forgetPendingTransfer,
  type PendingTransfer,
} from "@/lib/pending-transfers"
import { useMinaWallet } from "@/app/_providers/mina-wallet"
import { MINA_EXPLORER_TX_URL, PULSAR_EXPLORER_URL } from "@/lib/constants"
import { useState } from "react"
import Image from "next/image"

const TABS = [
  { id: "bridge", label: "Bridge" },
  { id: "pulsar", label: "Pulsar" },
] as const

const formatWhen = (timestamp: string) => {
  const then = new Date(timestamp).getTime()
  if (Number.isNaN(then)) return ""

  const minutes = Math.round((Date.now() - then) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / (60 * 24))}d ago`
}

/**
 * What the chain can honestly say about a transfer it has not answered yet.
 *
 * The transfer's own Mina block is unknowable from here — it is consumed by
 * the keeper and never published — so the height recorded when it was sent
 * stands in as a lower bound. That is enough to say whether the scan has even
 * reached the neighbourhood, and never enough to claim it is done. A missing
 * reading says so rather than inventing an estimate.
 */
const describeProgress = (
  transfer: PendingTransfer,
  cursor: number | null | undefined,
): string => {
  if (cursor == null || transfer.minaHeightAtSend == null)
    return "Waiting for Pulsar to scan it"

  const remaining = transfer.minaHeightAtSend - cursor
  if (remaining > 0)
    return `Pulsar has ${remaining.toLocaleString()} Mina block${remaining === 1 ? "" : "s"} to scan before reaching it`

  return "Pulsar is scanning the blocks that carry it"
}

const PendingRow = ({
  transfer,
  cursor,
}: {
  transfer: PendingTransfer
  cursor: number | null | undefined
}) => {
  const isDeposit = transfer.direction === "deposit"

  return (
    <div className="border-line flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
      <span className="border-line flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed">
        <Image src="/clock.svg" alt="" width={12} height={12} className="opacity-60" />
      </span>

      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-ink text-[13px] leading-none font-medium">
          {isDeposit ? "Deposit" : "Withdraw"} ·{" "}
          <span className="text-ink-subtle font-normal">
            {formatWhen(new Date(transfer.sentAt).toISOString())}
          </span>
        </span>
        <span className="text-ink-subtle truncate text-[12px] leading-none">
          {describeProgress(transfer, cursor)}
        </span>
      </span>

      <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
        <span className="text-ink-muted text-[13px] leading-none font-medium tabular-nums">
          {isDeposit ? "+" : "−"}{formatAmount(transfer.amount)} pMINA
        </span>
        <span className="flex items-center gap-2 text-[12px] leading-none">
          <a
            href={`${MINA_EXPLORER_TX_URL}/${transfer.minaTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-subtle hover:text-ink transition-colors"
          >
            Mina tx
          </a>
          {/* Never expires on its own: a transfer that never settles is the one
              a user most needs to keep seeing — an unanswered withdrawal means
              its down payment was forfeited. Only they can retire it. */}
          <button
            type="button"
            onClick={() => forgetPendingTransfer(transfer.minaTxHash)}
            className="text-ink-subtle hover:text-negative cursor-pointer transition-colors"
            title={`Remove this from the list. It does not affect the ${isDeposit ? "deposit" : "withdrawal"}.`}
          >
            Dismiss
          </button>
        </span>
      </span>
    </div>
  )
}

const truncateAddress = (address: string) =>
  `${address.slice(0, 10)}…${address.slice(-6)}`

const Row = ({ transfer, isMine }: { transfer: BridgeTransfer; isMine: boolean }) => {
  const isDeposit = transfer.direction === "deposit"

  return (
    <a
      href={`${PULSAR_EXPLORER_URL}/tx/${transfer.txHash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "hover:bg-surface border-line flex items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0",
        // The viewer's own movements, marked rather than filtered: the feed is
        // everyone's, and "which of these are mine" is the one question a
        // wallet can answer that the chain data alone cannot.
        isMine && "border-accent-strong bg-surface border-l-2",
      )}
    >
      <span className="border-line flex size-8 shrink-0 items-center justify-center rounded-full border">
        <Image
          src="/arrow-dark.svg"
          alt=""
          width={12}
          height={12}
          className={isDeposit ? "rotate-135" : "-rotate-45"}
        />
      </span>

      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-ink flex items-center gap-1.5 text-[13px] leading-none font-medium">
          {isDeposit ? "Deposit" : "Withdraw"}
          {isMine && (
            <span className="text-accent-deep text-[11px] leading-none font-medium">
              You
            </span>
          )}
        </span>
        <span className="text-ink-subtle truncate text-[12px] leading-none tabular-nums">
          {isMine ? formatWhen(transfer.timestamp) : (
            <>
              {truncateAddress(transfer.account)} · {formatWhen(transfer.timestamp)}
            </>
          )}
        </span>
      </span>

      <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
        <span className="text-ink text-[13px] leading-none font-medium tabular-nums">
          {isDeposit ? "+" : "−"}{formatAmount(transfer.amount)} pMINA
        </span>
        <span className="text-ink-subtle text-[12px] leading-none tabular-nums">
          #{transfer.height}
        </span>
      </span>
    </a>
  )
}

const Centered = ({ children }: { children: React.ReactNode }) => (
  <p className="text-ink-subtle my-auto px-8 text-center text-[14px] leading-[1.5]">
    {children}
  </p>
)

const BridgePanel = () => {
  // The feed is public data and renders for anyone. Wallets only sharpen it:
  // Auro names the registered account (where this user's movements actually
  // happen — Keplr is not needed for that, or for anything after
  // registration), a connected Keplr adds its own address to the highlight
  // set for good measure.
  const { data: transfers, isPending, isError, error } = useAllBridgeTransactions()
  const { account: minaAccount } = useMinaWallet()
  const { data: keyStore } = useKeyStore(minaAccount)
  const { data: connectedPulsarAddress } = usePulsarAddress()
  const stillPending = usePendingBridgeTransfers(minaAccount)

  const myAddresses = new Set(
    [keyStore?.keyStore?.pulsarAddress, connectedPulsarAddress].filter(Boolean),
  )

  // Only worth asking the chain where its scan is while something is waiting on
  // the answer.
  const { data: progress } = useBridgeScanProgress({ enabled: stillPending.length > 0 })

  if (isPending) return <Centered>Loading bridge transactions…</Centered>

  if (isError)
    return (
      <Centered>
        {error instanceof Error ? error.message : "Could not read bridge history."}
      </Centered>
    )

  if (!transfers.length && !stillPending.length)
    return (
      <Centered>
        No settled bridge transactions yet.
        <br />
        <span className="text-[13px]">
          A deposit appears here once Pulsar scans the Mina block that carried it —
          allow about two hours.
        </span>
      </Centered>
    )

  return (
    <div className="flex flex-col">
      {/* The viewer's in-flight transfers first: they are the only thing on
          this page nobody else can see — the chain has not witnessed them yet,
          only this browser has. */}
      {stillPending.map((transfer) => (
        <PendingRow
          key={transfer.minaTxHash}
          transfer={transfer}
          cursor={progress?.cursor}
        />
      ))}
      {transfers.map((transfer) => (
        <Row
          key={transfer.id}
          transfer={transfer}
          isMine={myAddresses.has(transfer.account)}
        />
      ))}
    </div>
  )
}

export default function Transactions() {
  const [activeTransactionType, setActiveTransactionType] = useState<'bridge' | 'pulsar'>('bridge')

  return (
    <main className="bg-canvas flex flex-1 flex-col justify-center overflow-y-auto px-6 py-12">
      <div className="mb-10 text-center">
        <h1 className="brand-title text-ink text-[clamp(28px,3vw,40px)] leading-none font-[750] tracking-[-0.03em]">
          Transactions
        </h1>
      </div>

      <div className="bg-surface border-line mx-auto flex w-full max-w-[560px] flex-col rounded-[8px] border p-2">
        <div role="tablist" aria-label="Transaction type" className="flex gap-1">
          {TABS.map(({ id, label }) => {
            const isActive = activeTransactionType === id
            return (
              <button
                key={id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTransactionType(id)}
                className={cn(
                  "brand-squircle flex-1 cursor-pointer py-2.5 text-[13px] leading-none font-medium transition-colors",
                  isActive
                    ? "bg-ink text-ink-inverse"
                    : "text-ink-subtle hover:text-ink",
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div
          role="tabpanel"
          className="bg-canvas border-line hide-scrollbar mt-2 flex h-72 flex-col overflow-y-auto rounded-[6px] border"
        >
          {activeTransactionType === 'bridge' ? (
            <BridgePanel />
          ) : (
            <Centered>
              View all Pulsar transactions{" "}
              <a
                href={PULSAR_EXPLORER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink decoration-accent-strong underline decoration-1 underline-offset-4 transition-colors hover:text-accent-deep"
              >
                on the explorer
              </a>
              .
            </Centered>
          )}
        </div>
      </div>
    </main>
  )
}
