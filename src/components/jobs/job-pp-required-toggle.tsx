'use client'

type JobPpRequiredToggleProps = {
  value: boolean
  onChange: (nextValue: boolean) => void
  disabled?: boolean
  compact?: boolean
  className?: string
  thumbClassName?: string
  thumbCheckedClassName?: string
  thumbUncheckedClassName?: string
  onLabel?: string
  offLabel?: string
}

type JobFormToggleCardProps = {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  name?: string
  value?: string
  tone?: 'primary' | 'danger' | 'standby'
  disabled?: boolean
}

export function JobFormToggleCard({
  label,
  checked,
  onChange,
  name,
  value = '1',
  tone = 'primary',
  disabled = false,
}: JobFormToggleCardProps) {
  const activeCardClass =
    tone === 'danger'
      ? "border-[#ef9a9f] bg-[#fff1f2] text-[#a9232d] shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_7px_16px_rgba(180,35,45,0.1)] [html[data-theme='dark']_&]:border-[rgba(248,113,113,0.3)] [html[data-theme='dark']_&]:bg-[rgba(127,29,29,0.2)] [html[data-theme='dark']_&]:text-[#fca5a5] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_7px_16px_rgba(0,0,0,0.22)]"
      : tone === 'standby'
        ? "border-[#b9a6e8] bg-[#f3effc] text-[#6546a5] shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_7px_16px_rgba(101,70,165,0.11)] [html[data-theme='dark']_&]:border-[rgba(167,139,250,0.34)] [html[data-theme='dark']_&]:bg-[rgba(109,40,217,0.2)] [html[data-theme='dark']_&]:text-[#d8c7ff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_7px_16px_rgba(0,0,0,0.22)]"
        : "border-[#7eb1d6] bg-[#e7f2fa] text-[#236f9f] shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_7px_16px_rgba(35,111,159,0.1)] [html[data-theme='dark']_&]:border-[rgba(84,170,232,0.34)] [html[data-theme='dark']_&]:bg-[rgba(30,91,138,0.25)] [html[data-theme='dark']_&]:text-[#b8def8] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_7px_16px_rgba(0,0,0,0.22)]"
  const activeTrackClass =
    tone === 'danger'
      ? 'border-[#dc6e76] bg-[#c8444d] [html[data-theme="dark"]_&]:border-[#d7666e] [html[data-theme="dark"]_&]:bg-[#9f3039]'
      : tone === 'standby'
        ? 'border-[#8f77d0] bg-[#7656bd] [html[data-theme="dark"]_&]:border-[#9b87df] [html[data-theme="dark"]_&]:bg-[#6441a5]'
      : 'border-[#5f9dca] bg-[#4f92cb] [html[data-theme="dark"]_&]:border-[#4b91c6] [html[data-theme="dark"]_&]:bg-[#2f75a9]'

  return (
    <label
      className={`jobs-page__job-form-toggle-card group flex min-h-12 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.07em] transition duration-200 focus-within:ring-2 focus-within:ring-[#4f92cb]/30 sm:min-h-[70px] sm:flex-col sm:justify-center sm:gap-2 sm:px-2 sm:text-center sm:text-[9px] ${
        checked
          ? activeCardClass
          : "border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(247,249,252,0.9)_100%)] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] hover:border-[#abc4d8] [html[data-theme='dark']_&]:border-[rgba(71,85,105,0.72)] [html[data-theme='dark']_&]:bg-[linear-gradient(160deg,rgba(15,23,42,0.98)_0%,rgba(10,16,28,0.96)_100%)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_18px_rgba(2,6,23,0.16)] [html[data-theme='dark']_&]:hover:border-slate-500"
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />

      <span className="min-w-0 whitespace-nowrap leading-none">{label}</span>

      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-[66px] shrink-0 items-center rounded-full border p-[2px] transition-colors duration-200 ${
          checked
            ? activeTrackClass
            : "border-slate-300 bg-slate-200 [html[data-theme='dark']_&]:border-slate-600 [html[data-theme='dark']_&]:bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-1/2 h-[22px] w-[22px] -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.22)] transition-[left] duration-200 ${
            checked ? 'left-[41px]' : 'left-[2px]'
          }`}
        />
        <span className="flex w-full items-center justify-between px-[7px] text-[8px] font-bold tracking-[0.04em] text-white">
          <span className={checked ? 'opacity-100' : 'opacity-0'}>ON</span>
          <span className={checked ? 'opacity-0' : 'opacity-100'}>OFF</span>
        </span>
      </span>
    </label>
  )
}

export function JobPpRequiredToggle({
  value,
  onChange,
  disabled = false,
  compact = false,
  className,
  thumbClassName,
  thumbCheckedClassName,
  thumbUncheckedClassName,
  onLabel = 'PP ON',
  offLabel = 'PP OFF',
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
        } ${className ?? ''}`}
        aria-label={value ? 'PP vyžadován' : 'PP není vyžadován'}
      >
        <span
          className={`pointer-events-none absolute top-1/2 inline-flex h-6 w-6 -translate-y-1/2 rounded-full bg-white transition-[left] duration-150 ${
            value
              ? (thumbCheckedClassName ?? 'left-[48px]')
              : (thumbUncheckedClassName ?? 'left-[2px]')
          } ${thumbClassName ?? ''}`}
        />

        <span className="pointer-events-none flex w-full items-center justify-between px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-white">
          <span className={`whitespace-nowrap transition-opacity duration-150 ${value ? 'opacity-100' : 'opacity-0'}`}>
            {onLabel}
          </span>
          <span className={`whitespace-nowrap -translate-x-2 transition-opacity duration-150 ${value ? 'opacity-0' : 'opacity-100'}`}>
            {offLabel}
          </span>
        </span>
      </button>
    </div>
  )
}
