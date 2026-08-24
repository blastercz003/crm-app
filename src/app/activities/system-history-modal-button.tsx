'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileText,
  ListTodo,
  LoaderCircle,
  MessageSquareText,
  X,
} from 'lucide-react'
import { ModalHeading } from '@/components/ui/modal-heading'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import type { ActivityListItem } from '@/lib/activities/types'
import { getSystemHistoryAction } from './system-history-actions'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Neznámý čas'
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)
}

function presentation(item: ActivityListItem) {
  if (item.activity_type === 'offer_comment_added') {
    return { label: 'Komentář', icon: MessageSquareText, tone: 'amber' }
  }
  if (item.activity_type.startsWith('offer_')) {
    return { label: 'Nabídka', icon: FileText, tone: 'emerald' }
  }
  if (item.activity_type.startsWith('task_')) {
    return { label: 'Úkol', icon: ListTodo, tone: 'sky' }
  }
  if (item.activity_type.startsWith('meeting_')) {
    return { label: 'Schůzka', icon: CalendarDays, tone: 'violet' }
  }
  return { label: 'Systém', icon: ClipboardList, tone: 'slate' }
}

function SystemHistoryModal({
  items,
  total,
  loading,
  error,
  userName,
  onClose,
}: {
  items: ActivityListItem[]
  total: number
  loading: boolean
  error: string | null
  userName: string
  onClose: () => void
}) {
  useBodyScrollLock(true)

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="activities-system-modal fixed inset-0 z-[135] overflow-y-auto bg-zinc-950/42 p-3 backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-history-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="flex min-h-full items-center justify-center py-3 sm:py-5">
        <section className="activities-system-modal__shell flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-200/85 bg-[linear-gradient(168deg,rgba(255,255,255,0.98)_0%,rgba(249,250,251,0.96)_48%,rgba(244,244,245,0.94)_100%)] shadow-[0_34px_88px_rgba(24,24,27,0.38)]">
          <header className="activities-system-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200/75 px-5 py-4 sm:px-6">
            <div>
              <ModalHeading id="system-history-title" section="AUTOMATICKÉ ZÁZNAMY" title="Poslední události" />
              <p className="mt-1.5 text-xs text-zinc-500">{userName} · {total} záznamů</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Zavřít" className="activities-system-modal__close inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/90 text-zinc-600 transition hover:-translate-y-px"><X aria-hidden size={18} /></button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {error ? <div role="alert" className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            <div className="space-y-2">
              {items.map((item) => {
                const itemPresentation = presentation(item)
                const Icon = itemPresentation.icon
                const content = (
                  <>
                    <span className="activities-system-modal__icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border" data-tone={itemPresentation.tone}><Icon aria-hidden size={15} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <strong className="min-w-0 truncate text-[13px] font-semibold text-zinc-900">{item.title}</strong>
                        <span className="shrink-0 rounded-full border border-zinc-200 bg-white/70 px-2 py-0.5 text-[9px] font-semibold uppercase text-zinc-500">{itemPresentation.label}</span>
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-zinc-500">{item.user_name ? `${item.user_name} · ` : ''}{item.client_name ?? 'Bez klienta'} · {formatDateTime(item.occurred_at)}</span>
                    </span>
                    {item.source_path ? <ChevronRight aria-hidden size={16} className="shrink-0 text-zinc-400" /> : null}
                  </>
                )
                const className = 'activities-system-modal__row flex min-h-[58px] items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/68 px-3 py-2.5 transition hover:-translate-y-px'
                return item.source_path
                  ? <Link key={item.id} href={item.source_path} onClick={onClose} className={className}>{content}</Link>
                  : <div key={item.id} className={className}>{content}</div>
              })}
            </div>
            {loading ? <div className="flex items-center justify-center gap-2 py-7 text-sm text-zinc-500"><LoaderCircle aria-hidden size={17} className="animate-spin" /> Načítám historii…</div> : null}
            {!loading && items.length === 0 ? <p className="py-12 text-center text-sm text-zinc-500">Zatím nebyla zaznamenána žádná událost.</p> : null}
          </div>

          <footer className="activities-system-modal__footer flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200/75 px-5 py-3 text-[11px] text-zinc-500 sm:px-6">
            <span>Zobrazeno {items.length} z {total}</span>
            <button type="button" onClick={onClose} className="activities-system-modal__close-button inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-600">ZAVŘÍT</button>
          </footer>
        </section>
      </div>
    </div>
  )
}

export function SystemHistoryModalButton({
  initialItems,
  total,
  userId,
  userName,
}: {
  initialItems: ActivityListItem[]
  total: number
  userId: string
  userName: string
}) {
  const [mounted] = useState(() => typeof window !== 'undefined')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(initialItems)
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function openHistory() {
    setOpen(true)
    setError(null)
    if (loadedUserId === userId) return

    setItems(initialItems)
    startTransition(async () => {
      const response = await getSystemHistoryAction({ userId, limit: 100 })
      if (!response.success) {
        setError(response.error ?? 'Poslední události se nepodařilo načíst.')
        return
      }
      setItems(response.items)
      setLoadedUserId(userId)
    })
  }

  return (
    <>
      <button type="button" onClick={openHistory} className="activities-workspace__small-action inline-flex h-8 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition duration-200 hover:-translate-y-px hover:text-[var(--text-primary)]">Vše</button>
      {mounted && open ? createPortal(
        <SystemHistoryModal items={items} total={total} loading={pending} error={error} userName={userName} onClose={() => setOpen(false)} />,
        document.body,
      ) : null}
    </>
  )
}
