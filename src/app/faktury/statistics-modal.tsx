'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import {
  getFinanceStatisticsAction,
  type FinanceStatisticsPayload,
  type FinanceStatisticsView,
} from './statistics-actions'

type FakturyStatisticsModalLauncherProps = {
  className: string
}

type StatisticsSection = 'summary' | 'people' | 'customers' | 'technology'

const VIEW_OPTIONS: Array<{ value: FinanceStatisticsView; label: string }> = [
  { value: 'week', label: 'TÝDEN' },
  { value: 'month', label: 'MĚSÍC' },
  { value: 'year', label: 'ROK' },
]

const SECTION_OPTIONS: Array<{ value: StatisticsSection; label: string }> = [
  { value: 'summary', label: 'SOUHRN' },
  { value: 'people', label: 'LIDÉ' },
  { value: 'customers', label: 'ZÁKAZNÍCI' },
  { value: 'technology', label: 'TECHNIKA' },
]

function getPragueToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatPeriod(payload: FinanceStatisticsPayload) {
  const from = parseCalendarDate(payload.period.from)
  const to = parseCalendarDate(payload.period.to)

  if (payload.view === 'year') {
    return new Intl.DateTimeFormat('cs-CZ', {
      year: 'numeric',
      timeZone: 'UTC',
    }).format(from)
  }

  if (payload.view === 'month') {
    return new Intl.DateTimeFormat('cs-CZ', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(from)
  }

  const fromLabel = new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
  }).format(from)
  const toLabel = new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(to)

  return `${fromLabel} - ${toLabel}`
}

function formatJobDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function formatMetric(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value)
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 0,
  }).format(Math.round(value))} Kč`
}

export function FakturyStatisticsModalLauncher({
  className,
}: FakturyStatisticsModalLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={className}
        aria-haspopup="dialog"
      >
        STATISTIKA
      </button>

      {isOpen ? <FakturyStatisticsModal onClose={() => setIsOpen(false)} /> : null}
    </>
  )
}

function FakturyStatisticsModal({ onClose }: { onClose: () => void }) {
  const requestVersionRef = useRef(0)
  const [view, setView] = useState<FinanceStatisticsView>('month')
  const [section, setSection] = useState<StatisticsSection>('summary')
  const [anchorDate, setAnchorDate] = useState(getPragueToday)
  const [payload, setPayload] = useState<FinanceStatisticsPayload | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useBodyScrollLock(true)

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current
    const initialAnchor = getPragueToday()

    startTransition(async () => {
      const result = await getFinanceStatisticsAction('month', initialAnchor)

      if (requestVersion !== requestVersionRef.current) return

      if (!result.success) {
        setErrorMessage(result.error)
        return
      }

      setPayload(result.payload)
      setErrorMessage(null)
    })
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function loadStatistics(nextView: FinanceStatisticsView, nextAnchor: string) {
    const requestVersion = ++requestVersionRef.current

    setView(nextView)
    setAnchorDate(nextAnchor)
    setErrorMessage(null)

    startTransition(async () => {
      const result = await getFinanceStatisticsAction(nextView, nextAnchor)

      if (requestVersion !== requestVersionRef.current) return

      if (!result.success) {
        setErrorMessage(result.error)
        return
      }

      setPayload(result.payload)
    })
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[140] bg-zinc-950/42 p-3 backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="faktury-statistics-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-[1180px] items-center justify-center">
        <div className="faktury-statistics-modal flex max-h-[calc(100vh-1.5rem)] w-full flex-col overflow-hidden rounded-[30px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(244,248,252,0.96)_100%)] shadow-[0_36px_84px_rgba(24,24,27,0.28)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(12,20,34,0.99)_0%,rgba(8,15,27,0.99)_100%)] [html[data-theme='dark']_&]:shadow-[0_36px_84px_rgba(0,0,0,0.48)]">
          <header className="flex items-start justify-between gap-4 border-b border-zinc-200/75 px-4 py-4 sm:px-6 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#2877aa] [html[data-theme='dark']_&]:text-[#67b8ed]">
                Statistika fakturace
              </div>
              <h2
                id="faktury-statistics-title"
                className="mt-1 text-xl font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100"
              >
                Výkony zakázek a techniků
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition hover:text-zinc-900 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.92)] [html[data-theme='dark']_&]:text-slate-400 [html[data-theme='dark']_&]:shadow-[0_8px_18px_rgba(0,0,0,0.22)] [html[data-theme='dark']_&:hover]:text-white"
              aria-label="Zavřít statistiku"
            >
              ×
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <section className="rounded-[24px] border border-white/80 bg-white/72 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="grid grid-cols-3 rounded-2xl border border-zinc-200 bg-zinc-100/80 p-1 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.72)]">
                  {VIEW_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => loadStatistics(option.value, anchorDate)}
                      disabled={isPending && view === option.value}
                      aria-pressed={view === option.value}
                      className={`h-9 rounded-xl px-3 text-[11px] font-semibold tracking-[0.08em] transition disabled:cursor-wait ${
                        view === option.value
                          ? 'bg-[#327fb6] text-white shadow-[0_8px_18px_rgba(31,103,157,0.24)]'
                          : 'text-zinc-500 hover:text-zinc-900 [html[data-theme=\'dark\']_&]:text-slate-400 [html[data-theme=\'dark\']_&:hover]:text-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      payload && loadStatistics(view, payload.period.previousAnchor)
                    }
                    disabled={!payload || isPending}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/82 text-zinc-600 disabled:opacity-40 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.9)] [html[data-theme='dark']_&]:text-slate-300"
                    aria-label="Předchozí období"
                  >
                    ‹
                  </button>

                  <div
                    className="min-w-0 flex-1 text-center text-sm font-semibold capitalize text-zinc-900 sm:min-w-[190px] sm:flex-none [html[data-theme='dark']_&]:text-slate-100"
                    aria-live="polite"
                  >
                    {payload ? formatPeriod(payload) : 'Načítám období...'}
                  </div>

                  <button
                    type="button"
                    onClick={() => payload && loadStatistics(view, payload.period.nextAnchor)}
                    disabled={!payload || isPending}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/82 text-zinc-600 disabled:opacity-40 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.9)] [html[data-theme='dark']_&]:text-slate-300"
                    aria-label="Následující období"
                  >
                    ›
                  </button>

                  <button
                    type="button"
                    onClick={() => loadStatistics(view, getPragueToday())}
                    disabled={isPending}
                    className="inline-flex h-9 items-center justify-center rounded-xl border border-[#79afd4]/70 bg-[#e7f2fa] px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#276f9f] disabled:opacity-40 [html[data-theme='dark']_&]:border-[rgba(82,166,224,0.3)] [html[data-theme='dark']_&]:bg-[rgba(32,85,126,0.34)] [html[data-theme='dark']_&]:text-[#8fd0f5]"
                  >
                    DNES
                  </button>
                </div>
              </div>
            </section>

            <nav
              className="mt-3 grid grid-cols-2 gap-1 rounded-[20px] border border-zinc-200/80 bg-zinc-100/75 p-1 sm:grid-cols-4 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.68)]"
              aria-label="Část statistiky"
            >
              {SECTION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSection(option.value)}
                  aria-pressed={section === option.value}
                  className={`faktury-statistics-section-tab h-9 rounded-2xl px-2 text-[10px] font-semibold tracking-[0.09em] transition sm:text-[11px] ${
                    section === option.value
                      ? 'faktury-statistics-section-tab--active bg-white text-[#286f9f] shadow-[0_6px_16px_rgba(15,23,42,0.1)]'
                      : 'text-zinc-500 hover:text-zinc-900 [html[data-theme=\'dark\']_&]:text-slate-400 [html[data-theme=\'dark\']_&:hover]:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </nav>

            {errorMessage ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 [html[data-theme='dark']_&]:border-rose-400/20 [html[data-theme='dark']_&]:bg-rose-950/30 [html[data-theme='dark']_&]:text-rose-300">
                {errorMessage}
              </div>
            ) : null}

            {!payload ? (
              <div className="mt-4 rounded-[24px] border border-zinc-200/80 bg-white/65 px-5 py-16 text-center text-sm text-zinc-500 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.72)] [html[data-theme='dark']_&]:text-slate-400">
                {errorMessage ? 'Statistika není dostupná.' : 'Načítám statistiku...'}
              </div>
            ) : (
              <div
                className={`transition-opacity ${isPending ? 'opacity-55' : 'opacity-100'}`}
                aria-busy={isPending}
              >
                {section === 'summary' ? <SummarySection payload={payload} /> : null}
                {section === 'people' ? <PeopleSection payload={payload} /> : null}
                {section === 'customers' ? <CustomersSection payload={payload} /> : null}
                {section === 'technology' ? <TechnologySection payload={payload} /> : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function SummarySection({ payload }: { payload: FinanceStatisticsPayload }) {
  const groups = [
    {
      title: 'Zakázky',
      items: [
        { label: 'Počet zakázek', value: formatMetric(payload.summary.jobCount) },
        { label: 'Marné výjezdy', value: formatMetric(payload.summary.wastedTripCount) },
        { label: 'Pohotovosti', value: formatMetric(payload.summary.standbyCount) },
      ],
    },
    {
      title: 'Výkon',
      items: [
        { label: 'Ujeté kilometry', value: `${formatMetric(payload.summary.kilometers)} km` },
        { label: 'Odpracované hodiny', value: `${formatMetric(payload.summary.hours)} h` },
        { label: 'Průměr km / zakázku', value: `${formatMetric(payload.summary.averageKilometersPerJob)} km` },
        { label: 'Průměr hodin / zakázku', value: `${formatMetric(payload.summary.averageHoursPerJob)} h` },
      ],
    },
    {
      title: 'Finance',
      items: [
        { label: 'Celkový prodej', value: formatMoney(payload.summary.sale) },
        { label: 'Celkové náklady', value: formatMoney(payload.summary.cost) },
        { label: 'Celkový zisk', value: formatMoney(payload.summary.profit), accent: true },
      ],
    },
  ]

  return (
    <section className="mt-4 grid gap-3 lg:grid-cols-3">
      {groups.map((group) => (
        <div
          key={group.title}
          className="rounded-[24px] border border-white/80 bg-white/72 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]"
        >
          <div className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
            {group.title}
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {group.items.map((item) => (
              <StatisticCard
                key={item.label}
                label={item.label}
                value={item.value}
                accent={'accent' in item && item.accent}
              />
            ))}
          </div>
          {group.title === 'Finance' ? (
            <div className="px-1 pt-2 text-[10px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
              Započítáno {payload.summary.financialJobCount} z {payload.summary.jobCount} zakázek
            </div>
          ) : null}
        </div>
      ))}
    </section>
  )
}

function PeopleSection({ payload }: { payload: FinanceStatisticsPayload }) {
  return (
    <div className="mt-4 grid gap-4">
      <section>
        <SectionHeading title="Obchodníci" meta={`${payload.summary.jobCount} zakázek`} />
        <div className="mt-2 grid grid-cols-3 gap-2">
          {payload.salesOwners.map((owner) => (
            <StatisticCard
              key={owner.name}
              label={owner.name}
              value={formatMetric(owner.jobCount)}
            />
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-white/80 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)_18px] items-center gap-2 border-b border-zinc-200/70 px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-500 sm:grid-cols-[minmax(180px,1fr)_100px_130px_110px_18px] sm:gap-3 sm:text-[10px] sm:tracking-[0.12em] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.12)] [html[data-theme='dark']_&]:text-slate-400">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
            Přehled techniků
          </div>
          <div className="text-right">Zakázky</div>
          <div className="text-right">KM</div>
          <div className="text-right">Hodiny</div>
          <span aria-hidden="true" />
        </div>

        {payload.technicians.length === 0 ? (
          <EmptyState>V tomto období nejsou výkony přiřazené žádnému technikovi.</EmptyState>
        ) : (
          <div className="divide-y divide-zinc-200/70 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.12)]">
            {payload.technicians.map((technician) => (
              <details key={technician.id} className="group">
                <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_repeat(3,auto)_18px] items-center gap-2 px-4 py-3 text-xs transition hover:bg-slate-50/80 sm:grid-cols-[minmax(180px,1fr)_100px_130px_110px_18px] sm:gap-3 sm:text-sm [html[data-theme='dark']_&:hover]:bg-white/[0.025]">
                  <span className="truncate font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                    {technician.name}
                  </span>
                  <MetricCell label="Zakázky" value={formatMetric(technician.jobCount)} />
                  <MetricCell label="Kilometry" value={`${formatMetric(technician.kilometers)} km`} />
                  <MetricCell label="Hodiny" value={`${formatMetric(technician.hours)} h`} />
                  <span className="text-zinc-400 transition group-open:rotate-180">⌄</span>
                </summary>

                <div className="border-t border-zinc-200/60 bg-slate-50/70 px-3 py-3 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.1)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.42)]">
                  <div className="grid gap-2">
                    {technician.jobs.map((job) => (
                      <div
                        key={job.id}
                        className="grid grid-cols-[70px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border border-zinc-200/70 bg-white/80 px-3 py-2 text-[11px] sm:grid-cols-[82px_minmax(0,1fr)_auto_auto] sm:gap-3 sm:text-xs [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.12)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.76)]"
                      >
                        <div>
                          <div className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                            {job.jobNumber || '—'}
                          </div>
                          <div className="mt-0.5 text-[9px] text-zinc-500 sm:text-[10px] [html[data-theme='dark']_&]:text-slate-500">
                            {formatJobDate(job.startAt)}
                          </div>
                        </div>
                        <div className="truncate text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                          {job.companyName || '—'}
                        </div>
                        <div className="whitespace-nowrap text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                          {formatMetric(job.kilometers)} km
                        </div>
                        <div className="whitespace-nowrap text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                          {formatMetric(job.hours)} h
                          {job.isWastedTrip ? (
                            <span className="ml-2 hidden text-[9px] font-semibold uppercase text-rose-600 sm:inline [html[data-theme='dark']_&]:text-rose-300">
                              Marný
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function CustomersSection({ payload }: { payload: FinanceStatisticsPayload }) {
  return (
    <section className="mt-4 overflow-hidden rounded-[24px] border border-white/80 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
      <div className="px-4 py-3">
        <SectionHeading title="Top 10 zákazníků" meta="Podle počtu zakázek" />
      </div>

      {payload.customers.length === 0 ? (
        <EmptyState>V tomto období nejsou žádné zakázky.</EmptyState>
      ) : (
        <>
          <div className="hidden border-y border-zinc-200/70 px-4 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-500 md:grid md:grid-cols-[36px_minmax(0,1fr)_90px_140px_140px] md:gap-3 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.12)] [html[data-theme='dark']_&]:text-slate-500">
            <span>#</span><span>Zákazník</span><span className="text-right">Zakázky</span><span className="text-right">Prodej</span><span className="text-right">Zisk</span>
          </div>
          <div className="divide-y divide-zinc-200/70 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.12)]">
            {payload.customers.map((customer, index) => (
              <div key={customer.name}>
                <div className="hidden items-center px-4 py-3 text-sm md:grid md:grid-cols-[36px_minmax(0,1fr)_90px_140px_140px] md:gap-3">
                  <span className="text-zinc-400">{index + 1}</span>
                  <span className="truncate font-medium text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">{customer.name}</span>
                  <span className="text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">{customer.jobCount}</span>
                  <span className="text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">{formatMoney(customer.sale)}</span>
                  <span className="text-right font-semibold text-[#2877aa] [html[data-theme='dark']_&]:text-[#67b8ed]">{formatMoney(customer.profit)}</span>
                </div>
                <div className="px-4 py-3 md:hidden">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-xs text-zinc-400">{index + 1}</span>
                    <span className="truncate text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">{customer.name}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <CompactValue label="Zakázky" value={formatMetric(customer.jobCount)} />
                    <CompactValue label="Prodej" value={formatMoney(customer.sale)} />
                    <CompactValue label="Zisk" value={formatMoney(customer.profit)} accent />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function TechnologySection({ payload }: { payload: FinanceStatisticsPayload }) {
  return (
    <section className="mt-4 overflow-hidden rounded-[24px] border border-white/80 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
      <div className="px-4 py-3">
        <SectionHeading title="Využití DA / agregátů" meta={`${payload.generators.length} zařízení`} />
      </div>

      {payload.generators.length === 0 ? (
        <EmptyState>V tomto období nejsou k zakázkám přiřazené žádné DA.</EmptyState>
      ) : (
        <div className="divide-y divide-zinc-200/70 border-t border-zinc-200/70 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.12)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.12)]">
          {payload.generators.map((generator, index) => (
            <div key={generator.name} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm">
              <span className="text-zinc-400">{index + 1}</span>
              <span className="truncate font-medium text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">{generator.name}</span>
              <span className="whitespace-nowrap font-semibold text-[#2877aa] [html[data-theme='dark']_&]:text-[#67b8ed]">{generator.jobCount} zakázek</span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-zinc-200/70 px-4 py-3 text-xs text-zinc-500 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.12)] [html[data-theme='dark']_&]:text-slate-500">
        Bez přiřazeného DA: {payload.jobsWithoutGeneratorCount} zakázek
      </div>
    </section>
  )
}

function SectionHeading({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">{title}</h3>
      <span className="text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">{meta}</span>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-zinc-200/70 px-4 py-12 text-center text-sm text-zinc-500 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.12)] [html[data-theme='dark']_&]:text-slate-400">
      {children}
    </div>
  )
}

function CompactValue({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate font-semibold ${accent ? 'text-[#2877aa] [html[data-theme=\'dark\']_&]:text-[#67b8ed]' : 'text-zinc-800 [html[data-theme=\'dark\']_&]:text-slate-200'}`}>{value}</div>
    </div>
  )
}

function StatisticCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white/75 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_24px_rgba(15,23,42,0.07)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.86)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_26px_rgba(0,0,0,0.2)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold ${accent ? 'text-[#2877aa] [html[data-theme=\'dark\']_&]:text-[#67b8ed]' : 'text-zinc-900 [html[data-theme=\'dark\']_&]:text-slate-100'}`}>
        {value}
      </div>
    </div>
  )
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap text-right">
      <span className="sr-only">{label}: </span>
      <span className="text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">{value}</span>
    </span>
  )
}
