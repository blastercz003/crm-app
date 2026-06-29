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
        compact ? 'flex-wrap' : 'flex-col items-end gap-2 sm:flex-row sm:items-center'
      }`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
        {value ? 'PP vyžadován' : 'PP není vyžadován'}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`password-page__toggle relative inline-flex h-7 w-12 items-center rounded-full border transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
          value
            ? 'border-[#5f9dca] bg-[linear-gradient(160deg,#5fa4d3_0%,#3f84bb_100%)]'
            : 'border-zinc-300 bg-zinc-200/90'
        }`}
        aria-label={value ? 'PP vyžadován' : 'PP není vyžadován'}
      >
        <span
          className={`password-page__toggle-thumb inline-block h-5 w-5 transform rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition duration-200 ${
            value ? 'translate-x-[24px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </div>
  )
}
