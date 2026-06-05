import { getRepeatIntervalShortLabel } from './taskUi'

export function RepeatTaskBadge({
  repeatInterval,
  className = '',
}: {
  repeatInterval: string | null | undefined
  className?: string
}) {
  const label = getRepeatIntervalShortLabel(repeatInterval)

  if (!label) {
    return null
  }

  return (
    <span
      className={[
        'task-repeat-badge inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-[#9f8ce6]/85 bg-[linear-gradient(155deg,#7b5fd0_0%,#6648c2_55%,#5739b2_100%)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(91,51,191,0.24)] sm:text-xs',
        className,
      ].join(' ')}
      title={`Opakování: ${label}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-3.5 w-3.5 shrink-0"
        fill="none"
      >
        <path
          d="M5.25 6.25h6.9c1.52 0 2.75 1.23 2.75 2.75 0 .61-.2 1.18-.54 1.64"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="M7.1 4.35 5.2 6.25 7.1 8.15"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="M14.75 13.75h-6.9A2.75 2.75 0 0 1 5.1 11c0-.61.2-1.18.54-1.64"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="m12.9 15.65 1.9-1.9-1.9-1.9"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
      <span className="truncate">{label}</span>
    </span>
  )
}
