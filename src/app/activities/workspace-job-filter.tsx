'use client'

import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Check, LoaderCircle } from 'lucide-react'
import type { ActivityWorkspaceJobPeriod, ActivityWorkspaceJobStatus } from '@/lib/activities/workspace-types'

const PERIODS: Array<{ value: ActivityWorkspaceJobPeriod; label: string }> = [
  { value: 'today', label: 'Dnes' },
  { value: 'this_week', label: 'Tento týden' },
  { value: 'next_week', label: 'Příští týden' },
  { value: 'next_30_days', label: 'Následujících 30 dní' },
  { value: 'all', label: 'Bez omezení' },
]

const STATUSES: Array<{ value: ActivityWorkspaceJobStatus | 'active' | 'all'; label: string; tone: string }> = [
  { value: 'all', label: 'Všechny stavy', tone: 'bg-slate-400' },
  { value: 'active', label: 'Aktivní', tone: 'bg-violet-500' },
  { value: 'nova', label: 'Nové', tone: 'bg-sky-500' },
  { value: 'k_reseni', label: 'V řešení', tone: 'bg-orange-500' },
  { value: 'realizace', label: 'Realizace', tone: 'bg-emerald-500' },
  { value: 'ukoncena', label: 'Ukončené', tone: 'bg-slate-500' },
  { value: 'storno', label: 'Storno', tone: 'bg-rose-500' },
]

export function WorkspaceJobFilter({
  selectedPeriod,
  selectedStatus,
}: {
  selectedPeriod: ActivityWorkspaceJobPeriod
  selectedStatus: ActivityWorkspaceJobStatus | 'active' | 'all'
}) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    function close(event: PointerEvent) {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    function closeOnViewportChange() {
      setOpen(false)
    }
    function closeOnBackgroundScroll(event: Event) {
      const target = event.target
      if (target instanceof Node && popupRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnBackgroundScroll, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnBackgroundScroll, true)
    }
  }, [])

  function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(250, window.innerWidth - 24)
    const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12)
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    if (spaceBelow >= 420 || spaceBelow >= spaceAbove) {
      setPosition({ top: rect.bottom + 8, left, width, maxHeight: Math.max(240, spaceBelow - 8) })
    } else {
      setPosition({ bottom: window.innerHeight - rect.top + 8, left, width, maxHeight: Math.max(240, spaceAbove - 8) })
    }
    setOpen(true)
  }

  function update(name: 'jobPeriod' | 'jobStatus', value: string) {
    const query = new URLSearchParams(window.location.search)
    query.set(name, value)
    setOpen(false)
    startTransition(() => router.replace(`/activities?${query.toString()}`, { scroll: false }))
  }

  return (
    <div ref={rootRef} className="relative">
      <button ref={buttonRef} type="button" onClick={toggle} disabled={isPending} aria-expanded={open} aria-haspopup="menu" className="activities-workspace__small-action inline-flex h-8 min-w-[46px] items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition duration-200 hover:-translate-y-px hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60">
        {isPending ? <LoaderCircle aria-hidden size={12} className="animate-spin" /> : 'FILTR'}
      </button>

      {open && position && typeof document !== 'undefined' ? createPortal(
        <div ref={popupRef} role="menu" aria-label="Filtrovat zakázky" style={position} className="activities-page__panel fixed z-[160] overflow-y-auto overscroll-contain rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(247,250,252,0.97)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_20px_44px_rgba(15,23,42,0.2)] backdrop-blur-[16px]">
          <p className="px-3 pb-1.5 pt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Období</p>
          {PERIODS.map((option) => <FilterOption key={option.value} label={option.label} selected={option.value === selectedPeriod} onClick={() => update('jobPeriod', option.value)} />)}
          <div className="my-2 border-t border-[var(--surface-border)]" />
          <p className="px-3 pb-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Stav</p>
          {STATUSES.map((option) => <FilterOption key={option.value} label={option.label} tone={option.tone} selected={option.value === selectedStatus} onClick={() => update('jobStatus', option.value)} />)}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

function FilterOption({ label, selected, tone, onClick }: { label: string; selected: boolean; tone?: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={selected} onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold transition hover:bg-[var(--surface-muted)] ${selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
      {tone ? <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} /> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? <Check aria-hidden size={13} className="shrink-0 text-[var(--accent)]" /> : <span className="w-[13px]" />}
    </button>
  )
}
