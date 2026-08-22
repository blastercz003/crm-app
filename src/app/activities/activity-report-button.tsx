'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3, Download, RefreshCcw, X } from 'lucide-react'
import { getActivityReportAction } from './actions'
import { ModalHeading } from '@/components/ui/modal-heading'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import type { ActivityAdminReport, ActivityUserOption } from '@/lib/activities/types'

function toDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function defaultPeriod() {
  const dateTo = new Date()
  const dateFrom = new Date()
  dateFrom.setDate(dateFrom.getDate() - 29)
  return { dateFrom: toDateKey(dateFrom), dateTo: toDateKey(dateTo) }
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function reportPdfHref(userId: string, dateFrom: string, dateTo: string) {
  const query = new URLSearchParams({ from: dateFrom, to: dateTo })
  if (userId) query.set('user', userId)
  return `/activities/report/pdf?${query.toString()}`
}

function ActivityReportModal({ users, onClose }: {
  users: ActivityUserOption[]
  onClose: () => void
}) {
  const initialPeriod = useState(defaultPeriod)[0]
  const [userId, setUserId] = useState('')
  const [dateFrom, setDateFrom] = useState(initialPeriod.dateFrom)
  const [dateTo, setDateTo] = useState(initialPeriod.dateTo)
  const [report, setReport] = useState<ActivityAdminReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useBodyScrollLock(true)

  function loadReport(nextUserId = userId, nextFrom = dateFrom, nextTo = dateTo) {
    setError(null)
    startTransition(async () => {
      const result = await getActivityReportAction({
        userId: nextUserId || null,
        dateFrom: nextFrom,
        dateTo: nextTo,
      })
      if (!result.success || !result.report) {
        setError(result.error ?? 'Report aktivit se nepodařilo načíst.')
        return
      }
      setReport(result.report)
    })
  }

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => loadReport('', initialPeriod.dateFrom, initialPeriod.dateTo))
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('keydown', closeOnEscape)
    }
    // Initial report is intentionally loaded once when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  const metricCards = report ? [
    ['Celkem', report.total, 'evidovaných událostí'],
    ['Ručně', report.manualCount, 'vlastních zápisů'],
    ['Automaticky', report.automaticCount, 'událostí ze sekcí'],
    ['Aktivní dny', report.activeDays, `průměr ${report.averagePerActiveDay} / den`],
  ] : []

  return (
    <div className="activities-report-modal fixed inset-0 z-[130] overflow-y-auto bg-zinc-950/42 p-3 backdrop-blur-[5px] sm:p-4" role="dialog" aria-modal="true" aria-labelledby="activities-report-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex min-h-full items-start justify-center py-3 sm:py-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <section className="activities-report-modal__shell relative w-full max-w-6xl overflow-hidden rounded-3xl border border-zinc-200/85 bg-[linear-gradient(168deg,rgba(255,255,255,0.98)_0%,rgba(249,250,251,0.96)_48%,rgba(244,244,245,0.94)_100%)] shadow-[0_34px_88px_rgba(24,24,27,0.38)]">
          <header className="activities-report-modal__header flex items-start justify-between gap-4 border-b border-zinc-200/75 px-5 py-4 sm:px-6">
            <ModalHeading id="activities-report-title" section="AKTIVITY" title="Přehled práce a export" />
            <button type="button" onClick={onClose} aria-label="Zavřít" className="activities-report-modal__close inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/90 text-zinc-600"><X aria-hidden size={18} /></button>
          </header>

          <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-5 py-5 sm:px-6">
            <form onSubmit={(event) => { event.preventDefault(); loadReport() }} className="activities-report-modal__filters grid gap-3 rounded-2xl border border-zinc-200/80 bg-white/65 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_160px_160px_auto]">
              <label className="activities-modal__label">Uživatel<select value={userId} onChange={(event) => setUserId(event.target.value)} className="activities-modal__input mt-2"><option value="">Celý tým</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
              <label className="activities-modal__label">Od<input type="date" required value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="activities-modal__input mt-2" /></label>
              <label className="activities-modal__label">Do<input type="date" required value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="activities-modal__input mt-2" /></label>
              <div className="flex items-end"><button type="submit" disabled={pending} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2980B9] px-4 text-sm font-semibold text-white disabled:opacity-60"><RefreshCcw aria-hidden size={15} className={pending ? 'animate-spin' : ''} /> {pending ? 'NAČÍTÁM…' : 'AKTUALIZOVAT'}</button></div>
            </form>

            {error ? <div role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}

            {report ? (
              <div className="mt-5 space-y-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {metricCards.map(([label, value, note]) => <article key={String(label)} className="activities-report-modal__card rounded-2xl border border-zinc-200/80 bg-white/72 p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{label}</p><p className="mt-2 text-3xl font-semibold text-zinc-900">{value}</p><p className="mt-1 text-xs text-zinc-500">{note}</p></article>)}
                </div>

                <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
                  <section className="activities-report-modal__card rounded-2xl border border-zinc-200/80 bg-white/72 p-4">
                    <h3 className="text-sm font-semibold text-zinc-900">Rozložení aktivit</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      {[['Schůzky', report.meetingCount], ['Úkoly', report.taskCount], ['Nabídky', report.offerCount], ['Ruční bez zdroje', report.withoutSourceCount]].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between border-b border-zinc-100 pb-2"><span className="text-zinc-600">{label}</span><strong className="text-zinc-900">{value}</strong></div>)}
                    </div>
                  </section>

                  <section className="activities-report-modal__card rounded-2xl border border-zinc-200/80 bg-white/72 p-4">
                    <h3 className="text-sm font-semibold text-zinc-900">Výkon uživatelů</h3>
                    {report.userSummaries.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><thead className="text-zinc-500"><tr><th className="pb-2 font-semibold">Uživatel</th><th className="pb-2 text-right font-semibold">Celkem</th><th className="pb-2 text-right font-semibold">Ručně</th><th className="pb-2 text-right font-semibold">Auto</th><th className="pb-2 text-right font-semibold">Aktivní dny</th><th className="pb-2 text-right font-semibold">Poslední aktivita</th></tr></thead><tbody>{report.userSummaries.map((user) => <tr key={user.userId} className="border-t border-zinc-100"><td className="py-2.5 font-semibold text-zinc-900">{user.userName}</td><td className="py-2.5 text-right">{user.total}</td><td className="py-2.5 text-right">{user.manual}</td><td className="py-2.5 text-right">{user.automatic}</td><td className="py-2.5 text-right">{user.activeDays}</td><td className="py-2.5 text-right text-zinc-500">{formatDateTime(user.lastActivityAt)}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-zinc-500">Ve zvoleném období nejsou žádné aktivity.</p>}
                  </section>
                </div>

                <section className="activities-report-modal__card rounded-2xl border border-zinc-200/80 bg-white/72 p-4">
                  <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-zinc-900">Poslední záznamy ve výběru</h3><span className="text-xs text-zinc-500">{report.selectedUserName ?? 'Celý tým'} · {report.dateFrom} až {report.dateTo}</span></div>
                  <div className="mt-3 divide-y divide-zinc-100">{report.items.slice(0, 12).map((item) => <div key={item.id} className="grid gap-1 py-2.5 text-xs sm:grid-cols-[140px_100px_minmax(0,1fr)]"><span className="text-zinc-500">{formatDateTime(item.occurred_at)}</span><span className="font-semibold text-zinc-700">{item.user_name ?? '—'}</span><span className="min-w-0 truncate text-zinc-900">{item.title}</span></div>)}{report.items.length === 0 ? <p className="py-5 text-center text-sm text-zinc-500">Bez záznamů.</p> : null}</div>
                </section>

                <footer className="flex flex-col-reverse gap-3 border-t border-zinc-200/75 pt-5 sm:flex-row sm:justify-end">
                  <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-600">ZAVŘÍT</button>
                  <a href={reportPdfHref(userId, dateFrom, dateTo)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2980B9] px-5 text-sm font-semibold text-white"><Download aria-hidden size={16} /> EXPORTOVAT PDF</a>
                </footer>
              </div>
            ) : pending ? <div className="py-16 text-center text-sm text-zinc-500">Načítám report aktivit…</div> : null}
          </div>
        </section>
      </div>
    </div>
  )
}

export function ActivityReportButton({ users }: { users: ActivityUserOption[] }) {
  const [open, setOpen] = useState(false)
  const [mounted] = useState(() => typeof window !== 'undefined')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 text-sm font-semibold text-[var(--text-primary)] shadow-[0_8px_18px_var(--shadow-soft)] transition hover:-translate-y-px"><BarChart3 aria-hidden size={17} /> PŘEHLED / EXPORT</button>
      {mounted && open ? createPortal(<ActivityReportModal users={users} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  )
}
