import type { ReactNode } from 'react'

type CompletePanelStatusBadgeProps = {
  label: string
  badgeClassName: string
  dotClassName?: string
  icon?: ReactNode
  attention?: boolean
  title?: string
  ariaLabel?: string
  onClick?: () => void
}

export function CompletePanelStatusBadge({
  label,
  badgeClassName,
  dotClassName,
  icon,
  attention = false,
  title,
  ariaLabel,
  onClick,
}: CompletePanelStatusBadgeProps) {
  const className = `relative inline-flex h-8 w-[104px] shrink-0 items-center justify-center rounded-xl border px-2 text-center text-[8px] font-bold uppercase leading-none tracking-[0.065em] ${onClick ? 'transition hover:-translate-y-px' : ''} ${badgeClassName}`
  const content = <>
    <span className="inline-flex items-center justify-center gap-1.5 leading-none">
      {icon ?? <i aria-hidden className={`block h-1.5 w-1.5 shrink-0 rounded-full ${dotClassName ?? ''}`} />}
      <span className="relative top-[0.5px] leading-none lg:top-px">{label}</span>
    </span>
    {attention ? <span aria-hidden className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black leading-none text-amber-950 shadow-sm">!</span> : null}
  </>

  if (onClick) {
    return <button type="button" onClick={onClick} title={title} aria-label={ariaLabel} className={className}>{content}</button>
  }
  return <span title={title} aria-label={ariaLabel} className={className}>{content}</span>
}
