'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { ModalHeading } from '@/components/ui/modal-heading'
import { SlidingFourTabSwitch } from '@/components/ui/sliding-two-tab-switch'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import {
  getFinanceStatisticsAction,
  type FinanceStatisticsPayload,
  type FinanceStatisticsView,
} from './statistics-actions'
import { StatisticsMap } from './statistics-map'

type FakturyStatisticsModalLauncherProps = {
  className: string
}

type StatisticsSection = 'summary' | 'people' | 'customers' | 'technology'
type SummaryTrendMetric = 'jobs' | 'sale' | 'profit'
type CustomerRankingMetric = 'jobs' | 'sale' | 'profit'
type TechnologyRankingMetric = 'jobs' | 'sale' | 'profit'

const VIEW_OPTIONS: Array<{ value: FinanceStatisticsView; label: string }> = [
  { value: 'week', label: 'TÝDEN' },
  { value: 'month', label: 'MĚSÍC' },
  { value: 'year', label: 'ROK' },
]

const SECTION_OPTIONS = [
  { value: 'summary', label: 'SOUHRN' },
  { value: 'people', label: 'LIDÉ' },
  { value: 'customers', label: 'ZÁKAZNÍCI' },
  { value: 'technology', label: 'TECHNIKA' },
] as const satisfies readonly [
  { value: StatisticsSection; label: string },
  { value: StatisticsSection; label: string },
  { value: StatisticsSection; label: string },
  { value: StatisticsSection; label: string },
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

function formatCompactMoney(value: number) {
  return `${new Intl.NumberFormat('cs-CZ', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)} Kč`
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
      <div className="mx-auto flex h-full w-full min-w-0 max-w-[1180px] items-center justify-center">
        <div className="faktury-statistics-modal flex max-h-[calc(100vh-1.5rem)] w-full min-w-0 flex-col overflow-hidden rounded-[30px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(244,248,252,0.96)_100%)] shadow-[0_36px_84px_rgba(24,24,27,0.28)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(12,20,34,0.99)_0%,rgba(8,15,27,0.99)_100%)] [html[data-theme='dark']_&]:shadow-[0_36px_84px_rgba(0,0,0,0.48)]">
          <header className="flex items-start justify-between gap-4 border-b border-zinc-200/75 px-4 py-4 sm:px-6 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
            <ModalHeading
              section="FAKTURY"
              title="Výkony zakázek a techniků"
              id="faktury-statistics-title"
            />

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition hover:text-zinc-900 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.92)] [html[data-theme='dark']_&]:text-slate-400 [html[data-theme='dark']_&]:shadow-[0_8px_18px_rgba(0,0,0,0.22)] [html[data-theme='dark']_&:hover]:text-white"
              aria-label="Zavřít statistiku"
            >
              ×
            </button>
          </header>

          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
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

            <SlidingFourTabSwitch
              value={section}
              options={SECTION_OPTIONS}
              onValueChange={setSection}
              ariaLabel="Část statistiky"
              className="mt-3 rounded-[20px] border border-zinc-200/80 bg-zinc-100/75 p-1 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.68)]"
            />

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
                className={`min-w-0 transition-opacity ${isPending ? 'opacity-55' : 'opacity-100'}`}
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
  const [trendMetric, setTrendMetric] = useState<SummaryTrendMetric>('jobs')
  const wastedTripRate =
    payload.summary.jobCount > 0
      ? (payload.summary.wastedTripCount / payload.summary.jobCount) * 100
      : 0
  const standbyRate =
    payload.summary.jobCount > 0
      ? (payload.summary.standbyCount / payload.summary.jobCount) * 100
      : 0
  const financeCompleteness =
    payload.summary.jobCount > 0
      ? (payload.summary.completeFinanceJobCount / payload.summary.jobCount) * 100
      : 0
  const profitMargin =
    payload.summary.sale !== 0
      ? (payload.summary.profit / payload.summary.sale) * 100
      : 0
  const averageSale = payload.summary.financialJobCount
    ? payload.summary.sale / payload.summary.financialJobCount
    : 0
  const averageProfit = payload.summary.financialJobCount
    ? payload.summary.profit / payload.summary.financialJobCount
    : 0
  const missingFinanceJobCount = Math.max(
    payload.summary.jobCount - payload.summary.completeFinanceJobCount,
    0
  )
  const activeTechnicians = payload.technicians.filter(
    (technician) => technician.jobCount > 0
  )
  const technicianJobAssignments = activeTechnicians.reduce(
    (sum, technician) => sum + technician.jobCount,
    0
  )
  const averageJobsPerTechnician = activeTechnicians.length
    ? technicianJobAssignments / activeTechnicians.length
    : 0

  return (
    <div className="mt-4 grid min-w-0 gap-3">
      <section className="grid min-w-0 gap-3 lg:grid-cols-3">
        <SummaryPanel title="Zakázky">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                Počet zakázek
              </div>
              <div className="mt-1 text-[30px] font-semibold leading-none text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                {formatMetric(payload.summary.jobCount)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <PercentageRing
                value={wastedTripRate}
                label="marných"
                tone="danger"
              />
              <PercentageRing
                value={standbyRate}
                label="pohotovostí"
                tone="standby"
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SummaryMiniMetric
              label="Marné výjezdy"
              value={formatMetric(payload.summary.wastedTripCount)}
              tone="danger"
            />
            <SummaryMiniMetric
              label="Pohotovosti"
              value={formatMetric(payload.summary.standbyCount)}
              tone="standby"
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <SummaryMiniMetric
              label="Kompletní finance"
              value={formatMetric(payload.summary.completeFinanceJobCount)}
            />
            <SummaryMiniMetric
              label="Chybějící finance"
              value={formatMetric(missingFinanceJobCount)}
            />
          </div>
        </SummaryPanel>

        <SummaryPanel title="Výkon">
          <div className="grid grid-cols-2 gap-2">
            <SummaryPrimaryMetric
              label="Ujeté kilometry"
              value={`${formatMetric(payload.summary.kilometers)} km`}
            />
            <SummaryPrimaryMetric
              label="Odpracované hodiny"
              value={`${formatMetric(payload.summary.hours)} h`}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 divide-x divide-zinc-200/75 rounded-2xl border border-zinc-200/75 bg-white/55 px-3 py-2.5 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.11)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.11)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.34)]">
            <CompactValue
              label="Průměr km / zakázku"
              value={`${formatMetric(payload.summary.averageKilometersPerJob)} km`}
            />
            <div className="pl-3">
              <CompactValue
                label="Průměr hodin / zakázku"
                value={`${formatMetric(payload.summary.averageHoursPerJob)} h`}
              />
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <SummaryMiniMetric
              label="Aktivní technici"
              value={formatMetric(activeTechnicians.length)}
            />
            <SummaryMiniMetric
              label="Ø zakázek na technika"
              value={formatMetric(averageJobsPerTechnician)}
            />
          </div>
        </SummaryPanel>

        <SummaryPanel title="Finance">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                Celkový zisk
              </div>
              <div
                className={`mt-1 truncate text-[26px] font-semibold leading-none ${
                  payload.summary.profit < 0
                    ? 'text-rose-600 [html[data-theme=\'dark\']_&]:text-rose-300'
                    : 'text-[#2877aa] [html[data-theme=\'dark\']_&]:text-[#67b8ed]'
                }`}
                title={formatMoney(payload.summary.profit)}
              >
                {formatMoney(payload.summary.profit)}
              </div>
            </div>
            <div className="rounded-xl border border-[#9bc5e1]/70 bg-[#e8f3fa] px-2.5 py-1.5 text-right [html[data-theme='dark']_&]:border-[rgba(82,166,224,0.25)] [html[data-theme='dark']_&]:bg-[rgba(32,85,126,0.28)]">
              <div className="text-[8px] font-semibold uppercase tracking-[0.08em] text-[#417fa8] [html[data-theme='dark']_&]:text-[#8fc9ed]">
                Marže
              </div>
              <div className="text-sm font-semibold text-[#2877aa] [html[data-theme='dark']_&]:text-[#67b8ed]">
                {formatMetric(profitMargin)} %
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SummaryMiniMetric
              label="Celkový prodej"
              value={formatMoney(payload.summary.sale)}
            />
            <SummaryMiniMetric
              label="Celkové náklady"
              value={formatMoney(payload.summary.cost)}
            />
          </div>
          <FinanceComposition
            sale={payload.summary.sale}
            cost={payload.summary.cost}
            profit={payload.summary.profit}
          />
          <div className="mt-2 grid grid-cols-2 divide-x divide-zinc-200/75 px-1 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.11)]">
            <CompactValue label="Průměrný prodej" value={formatMoney(averageSale)} />
            <div className="pl-3">
              <CompactValue
                label="Průměrný zisk"
                value={formatMoney(averageProfit)}
                accent
              />
            </div>
          </div>
          <ProgressLine
            value={financeCompleteness}
            label={`Finance: ${payload.summary.completeFinanceJobCount} z ${payload.summary.jobCount} zakázek`}
          />
        </SummaryPanel>
      </section>

      <StatisticsMap
        key={`${payload.view}:${payload.period.from}:${payload.period.to}`}
        jobs={payload.mapJobs}
      />

      <SummaryTrendChart
        payload={payload}
        metric={trendMetric}
        onMetricChange={setTrendMetric}
      />
    </div>
  )
}

function SummaryPanel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <article className="min-w-0 rounded-[24px] border border-white/80 bg-white/72 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
      <h3 className="px-1 pb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
        {title}
      </h3>
      {children}
    </article>
  )
}

function SummaryPrimaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/80 bg-white/75 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_20px_rgba(15,23,42,0.05)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.11)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.42)] [html[data-theme='dark']_&]:shadow-none">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100" title={value}>
        {value}
      </div>
    </div>
  )
}

function SummaryMiniMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'danger' | 'standby'
}) {
  const boxToneClass =
    tone === 'danger'
      ? "border-[#ef9a9f] bg-[#fff1f2] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_5px_12px_rgba(169,35,45,0.08)] [html[data-theme='dark']_&]:border-[rgba(248,113,113,0.3)] [html[data-theme='dark']_&]:bg-[rgba(127,29,29,0.2)] [html[data-theme='dark']_&]:shadow-[0_5px_12px_rgba(0,0,0,0.18)]"
      : tone === 'standby'
        ? "border-[#b9a6e8] bg-[#f3effc] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_5px_12px_rgba(101,70,165,0.08)] [html[data-theme='dark']_&]:border-[rgba(167,139,250,0.34)] [html[data-theme='dark']_&]:bg-[rgba(109,40,217,0.2)] [html[data-theme='dark']_&]:shadow-[0_5px_12px_rgba(0,0,0,0.18)]"
        : "border-zinc-200/75 bg-slate-50/75 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.11)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.4)]"
  const textToneClass =
    tone === 'danger'
      ? "text-[#a9232d] [html[data-theme='dark']_&]:text-[#fca5a5]"
      : tone === 'standby'
        ? "text-[#6546a5] [html[data-theme='dark']_&]:text-[#d8c7ff]"
        : "text-zinc-900 [html[data-theme='dark']_&]:text-slate-100"

  return (
    <div className={`min-w-0 rounded-2xl border px-3 py-2.5 ${boxToneClass}`}>
      <div className={`text-[9px] font-semibold uppercase tracking-[0.08em] ${textToneClass}`}>
        {label}
      </div>
      <div
        className={`mt-1 truncate text-base font-semibold ${textToneClass}`}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function PercentageRing({
  value,
  label,
  tone = 'primary',
}: {
  value: number
  label: string
  tone?: 'primary' | 'danger' | 'standby'
}) {
  const safeValue = Math.min(Math.max(value, 0), 100)

  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg className="-rotate-90" viewBox="0 0 42 42" aria-hidden="true">
        <circle
          cx="21"
          cy="21"
          r="16"
          fill="none"
          strokeWidth="4"
          className={
            tone === 'danger'
              ? "stroke-[#fde1e3] [html[data-theme='dark']_&]:stroke-[rgba(127,29,29,0.38)]"
              : tone === 'standby'
                ? "stroke-[#ebe5fa] [html[data-theme='dark']_&]:stroke-[rgba(109,40,217,0.3)]"
                : "stroke-zinc-200/80 [html[data-theme='dark']_&]:stroke-slate-700/70"
          }
        />
        <circle
          cx="21"
          cy="21"
          r="16"
          fill="none"
          strokeWidth="4"
          pathLength="100"
          strokeDasharray={`${safeValue} ${100 - safeValue}`}
          strokeLinecap="round"
          className={
            tone === 'danger'
              ? "stroke-[#ef9a9f] [html[data-theme='dark']_&]:stroke-[#fca5a5]"
              : tone === 'standby'
                ? "stroke-[#b9a6e8] [html[data-theme='dark']_&]:stroke-[#d8c7ff]"
                : 'stroke-[#2980B9] [html[data-theme=\'dark\']_&]:stroke-[#67b8ed]'
          }
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`text-sm font-semibold ${
            tone === 'danger'
              ? "text-[#a9232d] [html[data-theme='dark']_&]:text-[#fca5a5]"
              : tone === 'standby'
                ? "text-[#6546a5] [html[data-theme='dark']_&]:text-[#d8c7ff]"
                : "text-zinc-900 [html[data-theme='dark']_&]:text-slate-100"
          }`}
        >
          {formatMetric(value)} %
        </span>
        <span
          className={`text-[8px] uppercase tracking-[0.05em] ${
            tone === 'danger'
              ? "text-[#a9232d] [html[data-theme='dark']_&]:text-[#fca5a5]"
              : tone === 'standby'
                ? "text-[#6546a5] [html[data-theme='dark']_&]:text-[#d8c7ff]"
                : "text-zinc-500 [html[data-theme='dark']_&]:text-slate-500"
          }`}
        >
          {label}
        </span>
      </div>
    </div>
  )
}

function FinanceComposition({
  sale,
  cost,
  profit,
}: {
  sale: number
  cost: number
  profit: number
}) {
  const hasPositiveComposition = sale > 0 && cost >= 0 && profit >= 0
  const costShare = hasPositiveComposition
    ? Math.min(Math.max((cost / sale) * 100, 0), 100)
    : 0
  const profitShare = hasPositiveComposition ? Math.max(100 - costShare, 0) : 0

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between text-[8px] font-semibold uppercase tracking-[0.07em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
        <span>Poměr nákladů a zisku</span>
        {!hasPositiveComposition && profit < 0 ? (
          <span className="text-rose-600 [html[data-theme='dark']_&]:text-rose-300">
            Náklady převyšují prodej
          </span>
        ) : null}
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-200/80 [html[data-theme='dark']_&]:bg-slate-700/70">
        {hasPositiveComposition ? (
          <>
            <span
              className="h-full bg-slate-400/80 [html[data-theme='dark']_&]:bg-slate-500"
              style={{ width: `${costShare}%` }}
              title={`Náklady ${formatMetric(costShare)} %`}
            />
            <span
              className="h-full bg-[#2980B9] [html[data-theme='dark']_&]:bg-[#67b8ed]"
              style={{ width: `${profitShare}%` }}
              title={`Zisk ${formatMetric(profitShare)} %`}
            />
          </>
        ) : profit < 0 ? (
          <span className="h-full w-full bg-rose-400 [html[data-theme='dark']_&]:bg-rose-400" />
        ) : null}
      </div>
    </div>
  )
}

function ProgressLine({ value, label }: { value: number; label: string }) {
  const safeValue = Math.min(Math.max(value, 0), 100)

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[9px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
        <span>{label}</span>
        <span className="font-semibold">{formatMetric(value)} %</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200/80 [html[data-theme='dark']_&]:bg-slate-700/70">
        <div
          className="h-full rounded-full bg-[#2980B9] [html[data-theme='dark']_&]:bg-[#67b8ed]"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  )
}

function SummaryTrendChart({
  payload,
  metric,
  onMetricChange,
}: {
  payload: FinanceStatisticsPayload
  metric: SummaryTrendMetric
  onMetricChange: (metric: SummaryTrendMetric) => void
}) {
  const options: Array<{ value: SummaryTrendMetric; label: string }> = [
    { value: 'jobs', label: 'ZAKÁZKY' },
    { value: 'sale', label: 'PRODEJ' },
    { value: 'profit', label: 'ZISK' },
  ]
  const values = payload.trend.map((point) =>
    metric === 'jobs'
      ? point.jobCount
      : metric === 'sale'
        ? point.sale
        : point.profit
  )
  const total = values.reduce((sum, value) => sum + value, 0)

  return (
    <section className="min-w-0 rounded-[24px] border border-white/80 bg-white/72 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
            Vývoj v období
          </h3>
          <div className="mt-1 text-lg font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
            {metric === 'jobs' ? formatMetric(total) : formatMoney(total)}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-zinc-200/80 bg-zinc-100/75 p-1 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.68)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onMetricChange(option.value)}
              aria-pressed={metric === option.value}
              className={`faktury-statistics-section-tab h-8 rounded-xl px-3 text-[9px] font-semibold tracking-[0.07em] transition ${
                metric === option.value
                  ? 'faktury-statistics-section-tab--active bg-white text-[#2877aa] shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900 [html[data-theme=\'dark\']_&]:text-slate-500 [html[data-theme=\'dark\']_&:hover]:text-slate-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <TrendChart
        points={payload.trend}
        values={values}
        metric={metric}
      />
    </section>
  )
}

function TrendChart({
  points,
  values,
  metric,
}: {
  points: FinanceStatisticsPayload['trend']
  values: number[]
  metric: SummaryTrendMetric
}) {
  const width = 720
  const height = 190
  const left = 22
  const right = 18
  const top = 16
  const bottom = 34
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const minimum = Math.min(0, ...values)
  const maximum = Math.max(0, ...values)
  const range = maximum - minimum || 1
  const y = (value: number) => top + ((maximum - value) / range) * plotHeight
  const zeroY = y(0)
  const step = plotWidth / Math.max(points.length, 1)
  const coordinates = values.map((value, index) => ({
    x: left + step * index + step / 2,
    y: y(value),
    value,
  }))
  const linePoints = coordinates.map((point) => `${point.x},${point.y}`).join(' ')
  const areaPath = coordinates.length
    ? `M ${coordinates[0].x} ${zeroY} L ${coordinates
        .map((point) => `${point.x} ${point.y}`)
        .join(' L ')} L ${coordinates[coordinates.length - 1].x} ${zeroY} Z`
    : ''

  return (
    <div className="mt-3 w-full min-w-0 max-w-full overflow-x-auto rounded-2xl border border-zinc-200/70 bg-slate-50/55 px-2 py-2 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.11)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.34)]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full min-w-[560px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500"
        role="img"
        aria-label={`Vývoj: ${metric === 'jobs' ? 'zakázky' : metric === 'sale' ? 'prodej' : 'zisk'}`}
      >
        <defs>
          <linearGradient id={`statistics-trend-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2980B9" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#2980B9" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((position) => {
          const lineY = top + plotHeight * position

          return (
            <line
              key={position}
              x1={left}
              x2={width - right}
              y1={lineY}
              y2={lineY}
              className="stroke-zinc-200/80 [html[data-theme='dark']_&]:stroke-slate-700/55"
              strokeWidth="1"
            />
          )
        })}
        {minimum < 0 ? (
          <line
            x1={left}
            x2={width - right}
            y1={zeroY}
            y2={zeroY}
            className="stroke-zinc-400 [html[data-theme='dark']_&]:stroke-slate-500"
            strokeWidth="1"
          />
        ) : null}
        {metric === 'jobs'
          ? coordinates.map((point, index) => {
              const barWidth = Math.min(step * 0.5, 34)
              const barY = Math.min(point.y, zeroY)
              const barHeight = Math.max(Math.abs(zeroY - point.y), point.value ? 2 : 0)

              return (
                <rect
                  key={points[index].key}
                  x={point.x - barWidth / 2}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  rx="6"
                  className="fill-[#2980B9] [html[data-theme='dark']_&]:fill-[#67b8ed]"
                >
                  <title>{`${points[index].label}: ${formatMetric(point.value)}`}</title>
                </rect>
              )
            })
          : (
              <>
                <path
                  d={areaPath}
                  fill={`url(#statistics-trend-${metric})`}
                />
                <polyline
                  points={linePoints}
                  fill="none"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="stroke-[#2980B9] [html[data-theme='dark']_&]:stroke-[#67b8ed]"
                />
                {coordinates.map((point, index) => (
                  <circle
                    key={points[index].key}
                    cx={point.x}
                    cy={point.y}
                    r="4"
                    className="fill-white stroke-[#2980B9] [html[data-theme='dark']_&]:fill-[#0d1727] [html[data-theme='dark']_&]:stroke-[#67b8ed]"
                    strokeWidth="2"
                  >
                    <title>{`${points[index].label}: ${formatMoney(point.value)}`}</title>
                  </circle>
                ))}
              </>
            )}
        {points.map((point, index) => (
          <text
            key={point.key}
            x={left + step * index + step / 2}
            y={height - 12}
            textAnchor="middle"
            fill="currentColor"
            className="text-[9px] font-semibold"
          >
            {point.label}
          </text>
        ))}
      </svg>
    </div>
  )
}

function PeopleSection({ payload }: { payload: FinanceStatisticsPayload }) {
  return (
    <div className="mt-4 grid gap-4">
      <section>
        <div className="grid gap-2 md:grid-cols-3">
          {payload.salesOwners.map((owner) => (
            <SalesOwnerCard
              key={owner.name}
              owner={owner}
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

function SalesOwnerCard({
  owner,
}: {
  owner: FinanceStatisticsPayload['salesOwners'][number]
}) {
  const metrics = [
    { label: 'Prodej', value: formatMoney(owner.sale) },
    { label: 'Náklady', value: formatMoney(owner.cost) },
    { label: 'Zisk', value: formatMoney(owner.profit), accent: true },
  ]

  return (
    <article className="rounded-[22px] border border-white/80 bg-white/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_24px_rgba(15,23,42,0.07)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.86)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_26px_rgba(0,0,0,0.2)]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
          {owner.name}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold leading-none text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
            {formatMetric(owner.jobCount)}
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
            zakázek
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="min-w-0 rounded-xl border border-zinc-200/75 bg-slate-50/75 px-2 py-2 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.11)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.44)]"
          >
            <div className="text-[8px] font-semibold uppercase tracking-[0.07em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
              {metric.label}
            </div>
            <div
              className={`mt-1 truncate text-[11px] font-semibold ${
                metric.accent
                  ? 'text-[#2877aa] [html[data-theme=\'dark\']_&]:text-[#67b8ed]'
                  : 'text-zinc-800 [html[data-theme=\'dark\']_&]:text-slate-200'
              }`}
              title={metric.value}
            >
              {metric.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 divide-x divide-zinc-200/75 rounded-xl border border-zinc-200/75 bg-white/55 px-2 py-2 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.11)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.11)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.5)]">
        <CompactValue
          label="Průměrný zisk"
          value={formatMoney(owner.averageProfitPerJob)}
          accent
        />
        <div className="pl-2">
          <CompactValue
            label="Marže"
            value={`${formatMetric(owner.profitMargin)} %`}
            accent
          />
        </div>
      </div>

      <div className="mt-2 text-[9px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
        Finance vyplněny u {owner.financialJobCount} z {owner.jobCount} zakázek
      </div>
    </article>
  )
}

function CustomersSection({ payload }: { payload: FinanceStatisticsPayload }) {
  const [rankingMetric, setRankingMetric] =
    useState<CustomerRankingMetric>('jobs')
  const repeatCustomerRate = payload.customerSummary.customerCount
    ? (payload.customerSummary.repeatCustomerCount /
        payload.customerSummary.customerCount) *
      100
    : 0
  const rankingOptions: Array<{
    value: CustomerRankingMetric
    label: string
  }> = [
    { value: 'jobs', label: 'ZAKÁZKY' },
    { value: 'sale', label: 'PRODEJ' },
    { value: 'profit', label: 'ZISK' },
  ]
  const rankedCustomers = [...payload.customers]
    .sort((a, b) => {
      const difference =
        rankingMetric === 'jobs'
          ? b.jobCount - a.jobCount
          : rankingMetric === 'sale'
            ? b.sale - a.sale
            : b.profit - a.profit

      return difference || a.name.localeCompare(b.name, 'cs')
    })
    .slice(0, 10)
  const jobsChartItems = buildCustomerDonutItems(
    payload.customers,
    (customer) => customer.jobCount
  )
  const saleChartItems = buildCustomerDonutItems(
    payload.customers,
    (customer) => customer.sale
  )

  return (
    <div className="mt-4 grid min-w-0 gap-3">
      {payload.customers.length === 0 ? (
        <section className="overflow-hidden rounded-[24px] border border-white/80 bg-white/72 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)]">
          <EmptyState>V tomto období nejsou žádné zakázky.</EmptyState>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <CustomerKpiCard
              label="Počet zákazníků"
              value={formatMetric(payload.customerSummary.customerCount)}
            />
            <CustomerKpiCard
              label="Opakovaní zákazníci"
              value={formatMetric(payload.customerSummary.repeatCustomerCount)}
              detail={`${formatMetric(repeatCustomerRate)} %`}
            />
            <CustomerKpiCard
              label="Zakázek / zákazníka"
              value={formatMetric(payload.customerSummary.averageJobsPerCustomer)}
            />
            <CustomerKpiCard
              label="Prodej / zákazníka"
              value={formatMoney(payload.customerSummary.averageSalePerCustomer)}
            />
            <CustomerKpiCard
              label="Zisk / zákazníka"
              value={formatMoney(payload.customerSummary.averageProfitPerCustomer)}
              detail={`TOP 3: ${formatMetric(payload.customerSummary.topThreeSaleShare)} % prodeje`}
              accent
              className="col-span-2 lg:col-span-1"
            />
          </section>

          <section className="grid min-w-0 gap-3 lg:grid-cols-2">
            <CustomerDonutCard
              title="Zakázky podle zákazníka"
              items={jobsChartItems}
              centerValue={formatMetric(payload.summary.jobCount)}
              centerLabel="zakázek"
              valueFormatter={formatMetric}
            />
            <CustomerDonutCard
              title="Prodej podle zákazníka"
              items={saleChartItems}
              centerValue={formatCompactMoney(payload.summary.sale)}
              centerLabel="celkem"
              valueFormatter={formatMoney}
            />
          </section>

          <CustomerRanking
            customers={rankedCustomers}
            totalCustomerCount={payload.customerSummary.customerCount}
            rankingMetric={rankingMetric}
            rankingOptions={rankingOptions}
            onMetricChange={setRankingMetric}
          />
        </>
      )}
    </div>
  )
}

const CUSTOMER_CHART_COLORS = [
  '#2980B9',
  '#4D9ED0',
  '#70B3D9',
  '#91C6E2',
  '#AFD7E9',
  '#CCDDE7',
]

type CustomerDonutItem = {
  label: string
  value: number
}

function buildCustomerDonutItems(
  customers: FinanceStatisticsPayload['customers'],
  getValue: (customer: FinanceStatisticsPayload['customers'][number]) => number
) {
  const ranked = customers
    .map((customer) => ({
      label: customer.name,
      value: Math.max(getValue(customer), 0),
    }))
    .filter((customer) => customer.value > 0)
    .sort((a, b) => b.value - a.value)
  const topCustomers = ranked.slice(0, 5)
  const otherValue = ranked
    .slice(5)
    .reduce((sum, customer) => sum + customer.value, 0)

  return otherValue > 0
    ? [...topCustomers, { label: 'Ostatní', value: otherValue }]
    : topCustomers
}

function CustomerKpiCard({
  label,
  value,
  detail,
  accent = false,
  className = '',
}: {
  label: string
  value: string
  detail?: string
  accent?: boolean
  className?: string
}) {
  return (
    <article className={`min-w-0 rounded-[20px] border border-white/80 bg-white/72 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_24px_rgba(15,23,42,0.07)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.86)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_26px_rgba(0,0,0,0.2)] ${className}`}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.09em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-lg font-semibold ${
          accent
            ? 'text-[#2877aa] [html[data-theme=\'dark\']_&]:text-[#67b8ed]'
            : 'text-zinc-900 [html[data-theme=\'dark\']_&]:text-slate-100'
        }`}
        title={value}
      >
        {value}
      </div>
      {detail ? (
        <div
          className="mt-1 truncate text-[9px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500"
          title={detail}
        >
          {detail}
        </div>
      ) : null}
    </article>
  )
}

function CustomerDonutCard({
  title,
  items,
  centerValue,
  centerLabel,
  valueFormatter,
}: {
  title: string
  items: CustomerDonutItem[]
  centerValue: string
  centerLabel: string
  valueFormatter: (value: number) => string
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const percentages = items.map((item) =>
    total > 0 ? (item.value / total) * 100 : 0
  )
  const segments = items.map((item, index) => ({
    ...item,
    percentage: percentages[index],
    offset: -percentages
      .slice(0, index)
      .reduce((sum, percentage) => sum + percentage, 0),
  }))

  return (
    <article className="min-w-0 rounded-[24px] border border-white/80 bg-white/72 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
      <h3 className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
        {title}
      </h3>
      <div className="mt-3 grid items-center gap-4 sm:grid-cols-[170px_minmax(0,1fr)]">
        <div className="relative mx-auto h-[164px] w-[164px]">
          <svg viewBox="0 0 42 42" className="-rotate-90" aria-hidden="true">
            <circle
              cx="21"
              cy="21"
              r="15.5"
              fill="none"
              strokeWidth="6"
              className="stroke-zinc-200/75 [html[data-theme='dark']_&]:stroke-slate-700/65"
            />
            {segments.map((item, index) => (
              <circle
                key={item.label}
                cx="21"
                cy="21"
                r="15.5"
                fill="none"
                strokeWidth="6"
                pathLength="100"
                stroke={CUSTOMER_CHART_COLORS[index]}
                strokeDasharray={`${item.percentage} ${100 - item.percentage}`}
                strokeDashoffset={item.offset}
              >
                <title>{`${item.label}: ${valueFormatter(item.value)} (${formatMetric(item.percentage)} %)`}</title>
              </circle>
            ))}
          </svg>
          <div className="absolute inset-[30px] flex flex-col items-center justify-center rounded-full bg-white/72 text-center [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.94)]">
            <div
              className="max-w-[96px] truncate text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100"
              title={centerValue}
            >
              {centerValue}
            </div>
            <div className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
              {centerLabel}
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-2">
          {items.map((item, index) => {
            const percentage = total > 0 ? (item.value / total) * 100 : 0

            return (
              <div
                key={item.label}
                className="grid min-w-0 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-[10px]"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CUSTOMER_CHART_COLORS[index] }}
                  aria-hidden="true"
                />
                <span
                  className="truncate text-zinc-700 [html[data-theme='dark']_&]:text-slate-300"
                  title={item.label}
                >
                  {item.label}
                </span>
                <span className="whitespace-nowrap font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                  {formatMetric(percentage)} %
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </article>
  )
}

function CustomerRanking({
  customers,
  totalCustomerCount,
  rankingMetric,
  rankingOptions,
  onMetricChange,
}: {
  customers: FinanceStatisticsPayload['customers']
  totalCustomerCount: number
  rankingMetric: CustomerRankingMetric
  rankingOptions: Array<{ value: CustomerRankingMetric; label: string }>
  onMetricChange: (metric: CustomerRankingMetric) => void
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[24px] border border-white/80 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeading
          title="Top 10 zákazníků"
          meta={`${totalCustomerCount} celkem`}
        />
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-zinc-200/80 bg-zinc-100/75 p-1 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.68)]">
          {rankingOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onMetricChange(option.value)}
              aria-pressed={rankingMetric === option.value}
              className={`faktury-statistics-section-tab h-8 rounded-xl px-3 text-[9px] font-semibold tracking-[0.07em] transition ${
                rankingMetric === option.value
                  ? 'faktury-statistics-section-tab--active bg-white text-[#2877aa] shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900 [html[data-theme=\'dark\']_&]:text-slate-500 [html[data-theme=\'dark\']_&:hover]:text-slate-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden border-y border-zinc-200/70 px-4 py-2 text-[8px] font-semibold uppercase tracking-[0.09em] text-zinc-500 md:grid md:grid-cols-[28px_minmax(150px,1fr)_58px_112px_112px_112px_64px_112px] md:gap-2 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.12)] [html[data-theme='dark']_&]:text-slate-500">
        <span>#</span>
        <span>Zákazník</span>
        <span className="text-right">Zakázky</span>
        <span className="text-right">Prodej</span>
        <span className="text-right">Náklady</span>
        <span className="text-right">Zisk</span>
        <span className="text-right">Marže</span>
        <span className="text-right">Prům. zisk</span>
      </div>
      <div className="divide-y divide-zinc-200/70 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.12)]">
        {customers.map((customer, index) => (
          <div key={customer.name}>
            <div className="hidden items-center px-4 py-3 text-[11px] md:grid md:grid-cols-[28px_minmax(150px,1fr)_58px_112px_112px_112px_64px_112px] md:gap-2">
              <span className="text-zinc-400">{index + 1}</span>
              <span className="truncate font-medium text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                {customer.name}
              </span>
              <span className="text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                {customer.jobCount}
              </span>
              <span className="whitespace-nowrap text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                {formatMoney(customer.sale)}
              </span>
              <span className="whitespace-nowrap text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                {formatMoney(customer.cost)}
              </span>
              <span className={`whitespace-nowrap text-right font-semibold ${getProfitTone(customer.profit)}`}>
                {formatMoney(customer.profit)}
              </span>
              <span className={`whitespace-nowrap text-right font-semibold ${getProfitTone(customer.profitMargin)}`}>
                {formatMetric(customer.profitMargin)} %
              </span>
              <span className={`whitespace-nowrap text-right font-semibold ${getProfitTone(customer.averageProfitPerJob)}`}>
                {formatMoney(customer.averageProfitPerJob)}
              </span>
            </div>

            <div className="px-4 py-3 md:hidden">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-xs text-zinc-400">{index + 1}</span>
                <span className="truncate text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                  {customer.name}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-3 text-xs">
                <CompactValue
                  label="Zakázky"
                  value={formatMetric(customer.jobCount)}
                />
                <CompactValue
                  label="Prodej"
                  value={formatMoney(customer.sale)}
                />
                <CompactValue
                  label="Náklady"
                  value={formatMoney(customer.cost)}
                />
                <CustomerCompactValue
                  label="Zisk"
                  value={formatMoney(customer.profit)}
                  toneValue={customer.profit}
                />
                <CustomerCompactValue
                  label="Marže"
                  value={`${formatMetric(customer.profitMargin)} %`}
                  toneValue={customer.profitMargin}
                />
                <CustomerCompactValue
                  label="Prům. zisk"
                  value={formatMoney(customer.averageProfitPerJob)}
                  toneValue={customer.averageProfitPerJob}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function getProfitTone(value: number) {
  return value < 0
    ? 'text-rose-600 [html[data-theme=\'dark\']_&]:text-rose-300'
    : 'text-[#2877aa] [html[data-theme=\'dark\']_&]:text-[#67b8ed]'
}

function CustomerCompactValue({
  label,
  value,
  toneValue,
}: {
  label: string
  value: string
  toneValue: number
}) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate font-semibold ${getProfitTone(toneValue)}`}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function TechnologySection({ payload }: { payload: FinanceStatisticsPayload }) {
  const [rankingMetric, setRankingMetric] =
    useState<TechnologyRankingMetric>('jobs')
  const rankingOptions: Array<{
    value: TechnologyRankingMetric
    label: string
  }> = [
    { value: 'jobs', label: 'ZAKÁZKY' },
    { value: 'sale', label: 'PRODEJ' },
    { value: 'profit', label: 'ZISK' },
  ]
  const rankedGenerators = [...payload.generators]
    .sort((a, b) => {
      const difference =
        rankingMetric === 'jobs'
          ? b.jobCount - a.jobCount
          : rankingMetric === 'sale'
            ? b.sale - a.sale
            : b.profit - a.profit

      return difference || a.name.localeCompare(b.name, 'cs')
    })
    .slice(0, 10)
  const assignmentItems: CustomerDonutItem[] = [
    {
      label: 'S přiřazeným DA',
      value: payload.generatorSummary.assignedJobCount,
    },
    {
      label: 'Bez přiřazeného DA',
      value: payload.generatorSummary.unassignedJobCount,
    },
  ].filter((item) => item.value > 0)
  const usageItems = buildGeneratorDonutItems(payload.generators)

  return (
    <div className="mt-4 grid min-w-0 gap-3">
      {payload.summary.jobCount === 0 ? (
        <section className="overflow-hidden rounded-[24px] border border-white/80 bg-white/72 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)]">
          <EmptyState>V tomto období nejsou žádné zakázky.</EmptyState>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <CustomerKpiCard
              label="Použitá zařízení"
              value={formatMetric(payload.generatorSummary.generatorCount)}
            />
            <CustomerKpiCard
              label="Zakázky s DA"
              value={formatMetric(payload.generatorSummary.assignedJobCount)}
              detail={`${formatMetric(payload.generatorSummary.assignmentRate)} % všech zakázek`}
            />
            <CustomerKpiCard
              label="Zakázky bez DA"
              value={formatMetric(payload.generatorSummary.unassignedJobCount)}
            />
            <CustomerKpiCard
              label="Zakázek / zařízení"
              value={formatMetric(
                payload.generatorSummary.averageJobsPerGenerator
              )}
            />
            <CustomerKpiCard
              label="Podíl TOP 3"
              value={`${formatMetric(payload.generatorSummary.topThreeUsageShare)} %`}
              detail="z použití všech DA"
              accent
              className="col-span-2 lg:col-span-1"
            />
          </section>

          <section className="grid min-w-0 gap-3 lg:grid-cols-2">
            <CustomerDonutCard
              title="Pokrytí zakázek technikou"
              items={assignmentItems}
              centerValue={`${formatMetric(payload.generatorSummary.assignmentRate)} %`}
              centerLabel="s DA"
              valueFormatter={formatMetric}
            />
            <CustomerDonutCard
              title="Rozložení využití DA"
              items={usageItems}
              centerValue={formatMetric(
                payload.generatorSummary.assignedJobCount
              )}
              centerLabel="použití"
              valueFormatter={formatMetric}
            />
          </section>

          {payload.generators.length === 0 ? (
            <section className="overflow-hidden rounded-[24px] border border-white/80 bg-white/72 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)]">
              <EmptyState>
                V tomto období nejsou k zakázkám přiřazené žádné DA.
              </EmptyState>
            </section>
          ) : (
            <TechnologyRanking
              generators={rankedGenerators}
              totalGeneratorCount={payload.generatorSummary.generatorCount}
              assignedJobCount={payload.generatorSummary.assignedJobCount}
              rankingMetric={rankingMetric}
              rankingOptions={rankingOptions}
              onMetricChange={setRankingMetric}
            />
          )}
        </>
      )}
    </div>
  )
}

function buildGeneratorDonutItems(
  generators: FinanceStatisticsPayload['generators']
) {
  const ranked = generators
    .map((generator) => ({
      label: generator.name,
      value: generator.jobCount,
    }))
    .filter((generator) => generator.value > 0)
    .sort((a, b) => b.value - a.value)
  const topGenerators = ranked.slice(0, 5)
  const otherValue = ranked
    .slice(5)
    .reduce((sum, generator) => sum + generator.value, 0)

  return otherValue > 0
    ? [...topGenerators, { label: 'Ostatní', value: otherValue }]
    : topGenerators
}

function TechnologyRanking({
  generators,
  totalGeneratorCount,
  assignedJobCount,
  rankingMetric,
  rankingOptions,
  onMetricChange,
}: {
  generators: FinanceStatisticsPayload['generators']
  totalGeneratorCount: number
  assignedJobCount: number
  rankingMetric: TechnologyRankingMetric
  rankingOptions: Array<{ value: TechnologyRankingMetric; label: string }>
  onMetricChange: (metric: TechnologyRankingMetric) => void
}) {
  const maximumJobCount = Math.max(
    ...generators.map((generator) => generator.jobCount),
    1
  )

  return (
    <section className="min-w-0 overflow-hidden rounded-[24px] border border-white/80 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeading
          title="Využití DA / agregátů"
          meta={`${totalGeneratorCount} zařízení`}
        />
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-zinc-200/80 bg-zinc-100/75 p-1 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.68)]">
          {rankingOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onMetricChange(option.value)}
              aria-pressed={rankingMetric === option.value}
              className={`faktury-statistics-section-tab h-8 rounded-xl px-3 text-[9px] font-semibold tracking-[0.07em] transition ${
                rankingMetric === option.value
                  ? 'faktury-statistics-section-tab--active bg-white text-[#2877aa] shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900 [html[data-theme=\'dark\']_&]:text-slate-500 [html[data-theme=\'dark\']_&:hover]:text-slate-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden border-y border-zinc-200/70 px-4 py-2 text-[8px] font-semibold uppercase tracking-[0.09em] text-zinc-500 md:grid md:grid-cols-[28px_minmax(150px,1fr)_58px_64px_102px_102px_102px_62px_102px] md:gap-2 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.12)] [html[data-theme='dark']_&]:text-slate-500">
        <span>#</span>
        <span>DA / agregát</span>
        <span className="text-right">Zakázky</span>
        <span className="text-right">Podíl</span>
        <span className="text-right">Prodej</span>
        <span className="text-right">Náklady</span>
        <span className="text-right">Zisk</span>
        <span className="text-right">Marže</span>
        <span className="text-right">Prům. zisk</span>
      </div>

      <div className="divide-y divide-zinc-200/70 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.12)]">
        {generators.map((generator, index) => {
          const usageShare =
            assignedJobCount > 0
              ? (generator.jobCount / assignedJobCount) * 100
              : 0

          return (
            <div key={generator.name}>
              <div className="hidden items-center px-4 py-3 text-[11px] md:grid md:grid-cols-[28px_minmax(150px,1fr)_58px_64px_102px_102px_102px_62px_102px] md:gap-2">
                <span className="text-zinc-400">{index + 1}</span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                    {generator.name}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-200/80 [html[data-theme='dark']_&]:bg-slate-700/65">
                    <div
                      className="h-full rounded-full bg-[#4D9ED0] [html[data-theme='dark']_&]:bg-[#67b8ed]"
                      style={{
                        width: `${(generator.jobCount / maximumJobCount) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                  {generator.jobCount}
                </span>
                <span className="text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                  {formatMetric(usageShare)} %
                </span>
                <span className="whitespace-nowrap text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                  {formatMoney(generator.sale)}
                </span>
                <span className="whitespace-nowrap text-right text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                  {formatMoney(generator.cost)}
                </span>
                <span className={`whitespace-nowrap text-right font-semibold ${getProfitTone(generator.profit)}`}>
                  {formatMoney(generator.profit)}
                </span>
                <span className={`whitespace-nowrap text-right font-semibold ${getProfitTone(generator.profitMargin)}`}>
                  {formatMetric(generator.profitMargin)} %
                </span>
                <span className={`whitespace-nowrap text-right font-semibold ${getProfitTone(generator.averageProfitPerJob)}`}>
                  {formatMoney(generator.averageProfitPerJob)}
                </span>
              </div>

              <div className="px-4 py-3 md:hidden">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xs text-zinc-400">{index + 1}</span>
                  <span className="truncate text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                    {generator.name}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-200/80 [html[data-theme='dark']_&]:bg-slate-700/65">
                  <div
                    className="h-full rounded-full bg-[#4D9ED0] [html[data-theme='dark']_&]:bg-[#67b8ed]"
                    style={{
                      width: `${(generator.jobCount / maximumJobCount) * 100}%`,
                    }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-3 text-xs">
                  <CompactValue
                    label="Zakázky"
                    value={formatMetric(generator.jobCount)}
                  />
                  <CompactValue
                    label="Podíl"
                    value={`${formatMetric(usageShare)} %`}
                  />
                  <CompactValue
                    label="Prodej"
                    value={formatMoney(generator.sale)}
                  />
                  <CompactValue
                    label="Náklady"
                    value={formatMoney(generator.cost)}
                  />
                  <CustomerCompactValue
                    label="Zisk"
                    value={formatMoney(generator.profit)}
                    toneValue={generator.profit}
                  />
                  <CustomerCompactValue
                    label="Marže"
                    value={`${formatMetric(generator.profitMargin)} %`}
                    toneValue={generator.profitMargin}
                  />
                </div>
              </div>
            </div>
          )
        })}
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

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap text-right">
      <span className="sr-only">{label}: </span>
      <span className="text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">{value}</span>
    </span>
  )
}
