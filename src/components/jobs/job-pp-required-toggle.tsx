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
        className={`password-page__toggle relative inline-flex h-8 w-[76px] items-center rounded-full border p-[2px] disabled:cursor-not-allowed disabled:opacity-60 ${
          value
            ? 'border-[#5f9dca] bg-[#4f92cb]'
            : 'border-zinc-300 bg-zinc-200'
        }`}
        aria-label={value ? 'PP vyžadován' : 'PP není vyžadován'}
      >
        <span
          className={`pointer-events-none absolute top-1/2 inline-flex h-6 w-6 -translate-y-1/2 rounded-full bg-white transition-[left] duration-150 ${
            value ? 'left-[48px]' : 'left-[2px]'
          }`}
        />

        <span className="pointer-events-none flex w-full items-center justify-between px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-white">
          <span className={`whitespace-nowrap transition-opacity duration-150 ${value ? 'opacity-100' : 'opacity-0'}`}>
            PP ON
          </span>
          <span className={`whitespace-nowrap -translate-x-2 transition-opacity duration-150 ${value ? 'opacity-0' : 'opacity-100'}`}>
            PP OFF
          </span>
        </span>
      </button>
    </div>
  )
}
