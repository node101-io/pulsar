import Image from "next/image"
import { cn } from "@/lib/utils"

export const ExtensionItem = ({ icon, title, subtitle, onClick, disabled, isLoading }: {
  icon?: string
  title: string
  subtitle?: string
  onClick: () => void
  disabled?: boolean
  isLoading?: boolean
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
      <Image
        src={icon || ''}
        alt=""
        width={38}
        height={38}
        className="border-line size-9 shrink-0 rounded-full border"
      />
      <div className="flex-1">
        <div className="text-ink text-[14px] leading-[1.25] font-medium">
          {isLoading ? 'Connecting…' : title}
        </div>
        {subtitle && (
          <div className="text-ink-subtle mt-1 text-[13px] leading-none">
            {subtitle}
          </div>
        )}
      </div>
    </button>
  )
}
