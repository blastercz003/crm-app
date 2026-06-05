'use client'

type ChangesButtonProps = {
  count: number
  className?: string
  onClick?: () => void
}

export function ChangesButton({
  count,
  className = '',
  onClick,
}: ChangesButtonProps) {
  const hasBadge = count > 0
  const badgeLabel = count > 99 ? '99+' : String(count)

  return (
    <button
      type="button"
      onClick={onClick}
      title="Změny"
      aria-label="Změny"
      className={[
        'relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-orange-400/85 bg-[linear-gradient(155deg,#ff8b2b_0%,#ff6a00_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(249,115,22,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_14px_28px_rgba(249,115,22,0.3)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 7h7M4 12h12M4 17h9"
        />
        <circle cx="18" cy="7" r="1.75" fill="currentColor" />
      </svg>

      {hasBadge ? (
        <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full border border-red-600 bg-red-600 px-1 text-[10px] font-semibold leading-none text-white shadow-[0_6px_14px_rgba(220,38,38,0.38)]">
          {badgeLabel}
        </span>
      ) : null}
    </button>
  )
}
