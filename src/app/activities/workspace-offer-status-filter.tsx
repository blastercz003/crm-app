'use client'

import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Check, LoaderCircle } from 'lucide-react'
import type { ActivityWorkspaceOfferStatusOption } from '@/lib/activities/workspace-types'

const TONE_CLASS: Record<ActivityWorkspaceOfferStatusOption['tone'], string> = {
  blue: 'bg-sky-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  red: 'bg-rose-500',
}

export function WorkspaceOfferStatusFilter({
  options,
  selectedStatus,
}: {
  options: ActivityWorkspaceOfferStatusOption[]
  selectedStatus: string | null
}) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const [isPending, startTransition] = useTransition()

  const syncMenuPosition = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect()
    if (!trigger) return

    const mobile = window.innerWidth < 640
    const width = mobile ? Math.min(320, window.innerWidth - 24) : 230
    const estimatedHeight = Math.min(16 + options.length * 44, window.innerHeight - 24)
    const belowTop = trigger.bottom + 8
    const top = belowTop + estimatedHeight <= window.innerHeight - 12
      ? belowTop
      : Math.max(12, trigger.top - estimatedHeight - 8)
    const left = mobile
      ? Math.max(12, (window.innerWidth - width) / 2)
      : Math.min(Math.max(12, trigger.right - width), window.innerWidth - width - 12)

    setMenuStyle({
      top,
      left,
      width,
      maxHeight: Math.max(120, window.innerHeight - top - 12),
    })
  }, [options.length])

  useEffect(() => {
    function close(event: PointerEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', syncMenuPosition)
    window.addEventListener('scroll', syncMenuPosition, true)
    return () => {
      window.removeEventListener('resize', syncMenuPosition)
      window.removeEventListener('scroll', syncMenuPosition, true)
    }
  }, [open, syncMenuPosition])

  function selectStatus(value: string) {
    setOpen(false)
    const query = new URLSearchParams(window.location.search)
    query.set('offerStatus', value)
    startTransition(() => router.replace(`/activities?${query.toString()}`, { scroll: false }))
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          syncMenuPosition()
          setOpen(true)
        }}
        disabled={isPending || options.length === 0}
        aria-expanded={open}
        aria-haspopup="menu"
        className="activities-workspace__small-action inline-flex h-8 min-w-[46px] items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition duration-200 hover:-translate-y-px hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
      >
        {isPending ? <LoaderCircle aria-hidden size={12} className="animate-spin" /> : 'STAV'}
      </button>

      {open ? createPortal(
        <div ref={menuRef} role="menu" aria-label="Zvolit stav nabídek" className="activities-page__panel fixed z-[180] overflow-y-auto overscroll-contain rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(247,250,252,0.97)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_20px_44px_rgba(15,23,42,0.2)] backdrop-blur-[16px]" style={menuStyle}>
          {options.map((option) => {
            const selected = option.value === selectedStatus
            return (
              <button key={option.value} type="button" role="menuitemradio" aria-checked={selected} onClick={() => selectStatus(option.value)} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition hover:bg-[var(--surface-muted)] ${selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE_CLASS[option.tone]}`} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--accent)]">{option.count}</span>
                {selected ? <Check aria-hidden size={13} className="shrink-0 text-[var(--accent)]" /> : <span className="w-[13px]" />}
              </button>
            )
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
