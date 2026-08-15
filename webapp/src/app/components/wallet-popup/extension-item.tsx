import Image from "next/image"
import { cn } from "@/lib/utils"

export const ExtensionItem = ({ icon, title, subtitle, onClick, disabled, isLoading, connected }: {
  icon?: string
  title: string
  subtitle?: string
  onClick: () => void
  disabled?: boolean
  isLoading?: boolean
  /** Already connected: the click opens this wallet instead of connecting it. */
  connected?: boolean
}) => {
  const isInactive = disabled || isLoading

  return (
    <button
      onClick={onClick}
      disabled={isInactive}
      className={cn(
        "brand-squircle border-line flex w-full items-center gap-3 border p-4 text-left transition-colors",
        isInactive
          ? "cursor-not-allowed opacity-40"
          : "bg-surface hover:border-ink cursor-pointer",
      )}
    >
      <div className="relative shrink-0">
        <Image
          src={icon || ''}
          alt=""
          width={38}
          height={38}
          className="border-line size-9 rounded-full border"
        />
        {connected && (
          <span className="border-surface absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 bg-emerald-500" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-ink text-sm leading-tight font-medium">
          {isLoading ? 'Connecting…' : title}
        </div>
        {subtitle && (
          <div className="text-ink-subtle mt-1 truncate text-[13px] leading-none">
            {subtitle}
          </div>
        )}
      </div>
      {connected && !isInactive && (
        <span className="text-ink-subtle flex shrink-0 items-center gap-1 text-[13px] leading-none">
          Connected
          <svg
            className="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </span>
      )}
    </button>
  )
}
