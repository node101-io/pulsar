import Image from "next/image"

export const ExtensionItem = ({ icon, iconComponent, title, subtitle, onClick, disabled, isLoading }: {
  icon?: string
  iconComponent?: React.ReactNode
  title: string
  subtitle?: string
  onClick: () => void
  disabled?: boolean
  isLoading?: boolean
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`w-full p-5.5 ${disabled || isLoading
          ? 'bg-gray-100 cursor-not-allowed'
          : 'bg-[#CBDBDB] cursor-pointer'
        } rounded-3xl transition-colors flex items-center gap-3 border-1 border-background border-solid`}
    >
      <Image src={icon || ''} alt={title} width={38} height={38} className="border-1 border-background border-solid rounded-full size-9.5" />
      <div className="text-left flex-1">
        <div className="text-black font-semibold text-xl leading-none pb-1">
          {isLoading ? 'Connecting...' : title}
        </div>
        {subtitle && (
          <div className="text-gray-600 text-base leading-none mt-1">
            {subtitle}
          </div>
        )}
      </div>
    </button>
  )
}