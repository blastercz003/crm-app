'use client'

type JobPpRequiredToggleProps = {
  value: boolean
  onChange: (nextValue: boolean) => void
  disabled?: boolean
  compact?: boolean
}

export function JobPpRequiredToggle({
  value,
  onChange,
  disabled = false,
  compact = false,
}: JobPpRequiredToggleProps) {
  return (
    <div
      className={`flex items-center justify-end gap-3 ${
        compact ? 'flex-wrap' : 'flex-col items-end sm:flex-row sm:items-center'
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`password-page__toggle relative inline-flex h-8 w-[92px] items-center rounded-full border p-[2px] transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
          value
            ? 'border-[#5f9dca] bg-[linear-gradient(160deg,#5fa4d3_0%,#3f84bb_100%)]'
            : 'border-zinc-300 bg-zinc-200/90'
        }`}
        aria-label={value ? 'PP vyžadován' : 'PP není vyžadován'}
      >
        <span
          className={`pointer-events-none absolute inset-y-[2px] inline-flex w-[44px] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition duration-200 ${
            value ? 'translate-x-[42px]' : 'translate-x-0'
          }`}
        />

        <span className="flex w-full items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/90">
          <span className={`${value ? 'opacity-45' : 'opacity-100'} transition duration-200`}>
            PP ON
          </span>
          <span className={`${value ? 'opacity-100' : 'opacity-45'} transition duration-200`}>
            PP OFF
          </span>
        </span>
      </button>
    </div>
  )
}
