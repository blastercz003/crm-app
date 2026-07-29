'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import {
  buildNordFjellaReportData,
  validateNordFjellaReportRange,
  type NordFjellaFinanceDateBasis,
  type NordFjellaReportData,
  type NordFjellaReportType,
} from '@/lib/nord-fjella/reports'
import type {
  NordFjellaPaymentRow,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaStayGuestRow,
} from '@/lib/nord-fjella/types'

const REPORT_TYPES: Array<{ value: NordFjellaReportType; label: string }> = [
  { value: 'overview', label: 'Souhrn' },
  { value: 'finance', label: 'Finance' },
  { value: 'guests', label: 'Historie hostů' },
  { value: 'owner_stays', label: 'Vlastní pobyty' },
  { value: 'guest_book', label: 'Evidenční kniha' },
]

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}.${month}.${year}` : value
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))
}

function getDefaultFromDate() {
  return `${new Date().getFullYear()}-01-01`
}

function getDefaultToDate() {
  return `${new Date().getFullYear()}-12-31`
}

function getCurrentPeriodRange(period: 'month' | 'quarter' | 'year') {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstMonth = period === 'quarter' ? Math.floor(month / 3) * 3 : period === 'year' ? 0 : month
  const lastMonth = period === 'quarter' ? firstMonth + 2 : period === 'year' ? 11 : month
  const format = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`
  return {
    from: format(new Date(year, firstMonth, 1)),
    to: format(new Date(year, lastMonth + 1, 0)),
  }
}

export function ReportsButton({
  reservations,
  reservationItems,
  stayGuests,
  payments,
}: {
  reservations: NordFjellaReservationRow[]
  reservationItems: NordFjellaReservationItemRow[]
  stayGuests: NordFjellaStayGuestRow[]
  payments: NordFjellaPaymentRow[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function closeReports() {
    setIsOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className="nord-fjella-chip inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-xs font-medium uppercase tracking-[0.05em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-200"
      >
        Reporty
      </button>
      {isOpen ? (
        <ReportsModal
          reservations={reservations}
          reservationItems={reservationItems}
          stayGuests={stayGuests}
          payments={payments}
          onClose={closeReports}
        />
      ) : null}
    </>
  )
}

function ReportsModal({
  reservations,
  reservationItems,
  stayGuests,
  payments,
  onClose,
}: {
  reservations: NordFjellaReservationRow[]
  reservationItems: NordFjellaReservationItemRow[]
  stayGuests: NordFjellaStayGuestRow[]
  payments: NordFjellaPaymentRow[]
  onClose: () => void
}) {
  const [reportType, setReportType] = useState<NordFjellaReportType>('overview')
  const [financeDateBasis, setFinanceDateBasis] =
    useState<NordFjellaFinanceDateBasis>('supply')
  const [fromDate, setFromDate] = useState(getDefaultFromDate)
  const [toDate, setToDate] = useState(getDefaultToDate)
  const [guestSearch, setGuestSearch] = useState('')
  const [cityTaxFilter, setCityTaxFilter] = useState<
    'all' | 'liable' | 'exempt' | 'not_applicable'
  >('all')
  const shellRef = useRef<HTMLDivElement>(null)

  useBodyScrollLock(true)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !shellRef.current) return
      const focusable = Array.from(
        shellRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href]:not([aria-disabled="true"]), input:not([disabled]), select:not([disabled])'
        )
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const rangeError = validateNordFjellaReportRange(fromDate, toDate)
  const effectiveRange = useMemo(
    () =>
      rangeError
        ? { from: getDefaultFromDate(), to: getDefaultToDate() }
        : { from: fromDate, to: toDate },
    [fromDate, rangeError, toDate]
  )
  const reportData = useMemo(
    () =>
      buildNordFjellaReportData({
        type: reportType,
        basis: financeDateBasis,
        range: effectiveRange,
        reservations,
        reservationItems,
        stayGuests,
        payments,
        guestSearch: reportType === 'guests' || reportType === 'guest_book' ? guestSearch : '',
        cityTaxFilter:
          reportType === 'guests' || reportType === 'guest_book' ? cityTaxFilter : 'all',
      }),
    [
      cityTaxFilter,
      financeDateBasis,
      effectiveRange,
      guestSearch,
      payments,
      reportType,
      reservationItems,
      reservations,
      stayGuests,
    ]
  )

  const query = new URLSearchParams({
    type: reportType,
    from: fromDate,
    to: toDate,
    basis: financeDateBasis,
    q: guestSearch,
    tax: cityTaxFilter,
  }).toString()

  const content = (
    <div
      className="fixed inset-0 z-[120] overflow-y-auto overscroll-contain bg-zinc-950/42 p-2 backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nord-fjella-reports-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          ref={shellRef}
          className="clients-modal__shell flex h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(247,249,251,0.92)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.3)] sm:h-auto sm:max-h-[calc(100dvh-2rem)]"
        >
          <div className="clients-modal__header flex shrink-0 items-center justify-between gap-4 border-b border-gray-100/90 px-4 py-3 sm:px-5">
            <h2
              id="nord-fjella-reports-title"
              className="clients-modal__title text-lg font-semibold tracking-tight text-gray-900"
            >
              Reporty
            </h2>
            <button
              type="button"
              onClick={onClose}
              autoFocus
              className="clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-700"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="nord-fjella-modal-body min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
            <div
              className="nord-fjella-modal-card overflow-x-auto rounded-2xl border border-white/80 bg-white/72 p-1"
              role="tablist"
              aria-label="Typ reportu"
            >
              <div className="flex min-w-max gap-1">
                {REPORT_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    role="tab"
                    aria-selected={reportType === type.value}
                    onClick={() => setReportType(type.value)}
                    className={`min-w-[118px] rounded-xl px-3 py-2.5 text-[11px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5f9fca] sm:min-w-0 sm:flex-1 ${
                      reportType === type.value
                        ? 'bg-[#e9f3fa] text-[#236f9f] shadow-sm [html[data-theme=\'dark\']_&]:bg-slate-700/80 [html[data-theme=\'dark\']_&]:text-sky-200'
                        : 'text-zinc-600 hover:bg-white/60 [html[data-theme=\'dark\']_&]:text-slate-400 [html[data-theme=\'dark\']_&]:hover:bg-white/[0.04]'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="nord-fjella-modal-card mt-3 grid gap-3 rounded-2xl border border-white/80 bg-white/72 p-3 lg:grid-cols-[auto_150px_150px_auto] lg:items-end">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                  Období
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {[
                    ['Měsíc', 'month'],
                    ['Čtvrtletí', 'quarter'],
                    ['Rok', 'year'],
                  ].map(([label, period]) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => {
                        const next = getCurrentPeriodRange(
                          period as 'month' | 'quarter' | 'year'
                        )
                        setFromDate(next.from)
                        setToDate(next.to)
                      }}
                      className="rounded-lg border border-zinc-200 bg-white/75 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-zinc-500 [html[data-theme='dark']_&]:border-slate-400/15 [html[data-theme='dark']_&]:bg-slate-800/55 [html[data-theme='dark']_&]:text-slate-300"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="clients-modal__label text-xs text-zinc-500">
                Od
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="clients-modal__input mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
                />
              </label>
              <label className="clients-modal__label text-xs text-zinc-500">
                Do
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="clients-modal__input mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
                />
              </label>
              <div className="flex gap-2">
                <a
                  href={rangeError ? undefined : `/nord-fjella/reports/pdf?${query}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={Boolean(rangeError)}
                  className={`inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#2b679a_100%)] px-4 text-xs font-medium uppercase text-white ${
                    rangeError ? 'pointer-events-none opacity-45' : ''
                  }`}
                >
                  PDF
                </a>
                <a
                  href={rangeError ? undefined : `/nord-fjella/reports/csv?${query}`}
                  aria-disabled={Boolean(rangeError)}
                  className={`inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-medium uppercase text-zinc-700 [html[data-theme='dark']_&]:border-slate-400/15 [html[data-theme='dark']_&]:bg-slate-800/80 [html[data-theme='dark']_&]:text-slate-200 ${
                    rangeError ? 'pointer-events-none opacity-45' : ''
                  }`}
                >
                  CSV
                </a>
              </div>
            </div>

            {rangeError ? (
              <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 [html[data-theme='dark']_&]:border-red-400/20 [html[data-theme='dark']_&]:bg-red-950/35 [html[data-theme='dark']_&]:text-red-200">
                {rangeError}
              </div>
            ) : null}

            {reportType === 'finance' ? (
              <FinanceBasis
                value={financeDateBasis}
                onChange={setFinanceDateBasis}
              />
            ) : null}

            {reportType === 'guests' || reportType === 'guest_book' ? (
              <GuestFilters
                search={guestSearch}
                onSearch={setGuestSearch}
                taxFilter={cityTaxFilter}
                onTaxFilter={setCityTaxFilter}
              />
            ) : null}

            <MetricStrip type={reportType} basis={financeDateBasis} data={reportData} />

            <div className="mt-3">
              {reportType === 'overview' ? (
                <OverviewReport data={reportData} />
              ) : reportType === 'finance' ? (
                <FinanceReport data={reportData} basis={financeDateBasis} />
              ) : reportType === 'owner_stays' ? (
                <OwnerStaysReport data={reportData} />
              ) : (
                <GuestsReport data={reportData} legalBook={reportType === 'guest_book'} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(content, document.body)
}

function FinanceBasis({
  value,
  onChange,
}: {
  value: NordFjellaFinanceDateBasis
  onChange: (value: NordFjellaFinanceDateBasis) => void
}) {
  return (
    <div className="nord-fjella-modal-card mt-3 flex flex-col gap-2 rounded-2xl border border-white/80 bg-white/72 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
          Pohled na finance
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          Plnění = DPH a tržby, Platby = cash-flow, Pobyt = provozní pohled.
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-zinc-100/80 p-1 [html[data-theme='dark']_&]:border-slate-400/15 [html[data-theme='dark']_&]:bg-slate-950/35">
        {[
          ['Plnění', 'supply'],
          ['Platby', 'payment'],
          ['Pobyt', 'stay'],
        ].map(([label, itemValue]) => (
          <button
            key={itemValue}
            type="button"
            aria-pressed={value === itemValue}
            onClick={() => onChange(itemValue as NordFjellaFinanceDateBasis)}
            className={`rounded-lg px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] ${
              value === itemValue
                ? 'bg-white text-[#236f9f] shadow-sm [html[data-theme=\'dark\']_&]:bg-slate-700/80 [html[data-theme=\'dark\']_&]:text-sky-200'
                : 'text-zinc-500 [html[data-theme=\'dark\']_&]:text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function GuestFilters({
  search,
  onSearch,
  taxFilter,
  onTaxFilter,
}: {
  search: string
  onSearch: (value: string) => void
  taxFilter: 'all' | 'liable' | 'exempt' | 'not_applicable'
  onTaxFilter: (value: 'all' | 'liable' | 'exempt' | 'not_applicable') => void
}) {
  return (
    <div className="nord-fjella-modal-card mt-3 grid gap-2 rounded-2xl border border-white/80 bg-white/72 p-3 sm:grid-cols-[minmax(0,1fr)_220px]">
      <label className="text-xs text-zinc-500">
        Hledat hosta nebo rezervaci
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Jméno nebo číslo rezervace"
          className="clients-modal__input mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
        />
      </label>
      <label className="text-xs text-zinc-500">
        Stav poplatku
        <select
          value={taxFilter}
          onChange={(event) =>
            onTaxFilter(
              event.target.value as 'all' | 'liable' | 'exempt' | 'not_applicable'
            )
          }
          className="clients-modal__select mt-1 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
        >
          <option value="all">Všechny</option>
          <option value="liable">Podléhá poplatku</option>
          <option value="exempt">Osvobozen</option>
          <option value="not_applicable">Nepodléhá</option>
        </select>
      </label>
    </div>
  )
}

function MetricStrip({
  type,
  basis,
  data,
}: {
  type: NordFjellaReportType
  basis: NordFjellaFinanceDateBasis
  data: NordFjellaReportData
}) {
  const metrics = data.metrics
  const values: Array<[string, string | number]> =
    type === 'finance'
      ? basis === 'payment'
        ? [
            ['Přijaté platby', formatCurrency(metrics.paymentIncome)],
            ['Vratky', formatCurrency(metrics.paymentRefunds)],
            ['Čisté cash-flow', formatCurrency(metrics.netCashflow)],
            ['DPH z plateb', formatCurrency(metrics.advanceVat12Amount + metrics.advanceVat21Amount)],
          ]
        : [
            ['Služby bez DPH', formatCurrency(metrics.servicesNet)],
            ['DPH celkem', formatCurrency(metrics.servicesVat)],
            ['Služby s DPH', formatCurrency(metrics.servicesGross)],
            ['K inkasu', formatCurrency(metrics.receivable)],
          ]
      : type === 'guests'
        ? [
            ['Unikátní hosté', metrics.uniqueGuests],
            ['Pobyty hostů', metrics.guestStays],
            ['Osobonoci', metrics.guestNights],
            ['Vracející se', metrics.returningGuests],
          ]
        : type === 'owner_stays'
          ? [
              ['Vlastní pobyty', data.ownerStays.length],
              ['Noci', metrics.ownerNights],
              [
                'Průměrná délka',
                data.ownerStays.length
                  ? `${(metrics.ownerNights / data.ownerStays.length).toLocaleString('cs-CZ', {
                      maximumFractionDigits: 1,
                    })} noci`
                  : '0 nocí',
              ],
              ['Technické blokace', data.technicalBlocks.length],
            ]
          : type === 'guest_book'
            ? [
                ['Evidované osoby', data.guests.length],
                ['Zpoplatněné osobonoci', metrics.taxableGuestNights],
                ['Osvobozené osoby', metrics.exemptGuests],
                ['Skutečně vybráno', formatCurrency(metrics.cityTaxCollected)],
              ]
            : [
                ['Aktivní a dokončené', metrics.reservedRentals + metrics.completedRentals],
                ['Obsazené noci', metrics.occupiedNights],
                ['Ubytované osoby', data.guests.length],
                ['Vybraný poplatek', formatCurrency(metrics.cityTaxCollected)],
              ]

  return (
    <div className="nord-fjella-modal-card mt-3 grid grid-cols-2 overflow-hidden rounded-2xl border border-white/80 bg-white/72 lg:grid-cols-4">
      {values.map(([label, value], index) => (
        <div
          key={label}
          className={`min-w-0 px-3 py-3 ${
            index % 2 ? 'border-l border-zinc-200/70 [html[data-theme=\'dark\']_&]:border-slate-400/10' : ''
          } ${index >= 2 ? 'border-t border-zinc-200/70 lg:border-t-0 [html[data-theme=\'dark\']_&]:border-slate-400/10' : ''} ${
            index > 0 ? 'lg:border-l lg:border-zinc-200/70 [html[data-theme=\'dark\']_&]:lg:border-slate-400/10' : ''
          }`}
        >
          <div className="truncate text-[9px] font-semibold uppercase tracking-[0.09em] text-zinc-400">
            {label}
          </div>
          <div className="mt-1 truncate text-lg font-semibold text-zinc-900" title={String(value)}>
            {value}
          </div>
        </div>
      ))}
    </div>
  )
}

function OverviewReport({ data }: { data: NordFjellaReportData }) {
  const { metrics } = data
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <ReportPanel title="Provoz">
        <ReportRow label="Potvrzené a rozpracované" value={metrics.reservedRentals} />
        <ReportRow label="Dokončené pronájmy" value={metrics.completedRentals} />
        <ReportRow label="Storna" value={metrics.cancelledRentals} />
        <ReportRow label="Vlastní pobyty / noci" value={`${data.ownerStays.length} / ${metrics.ownerNights}`} />
        <ReportRow label="Technické blokace / noci" value={`${data.technicalBlocks.length} / ${metrics.technicalNights}`} />
      </ReportPanel>
      <ReportPanel title="Hosté a místní poplatek">
        <ReportRow label="Unikátní hosté" value={metrics.uniqueGuests} />
        <ReportRow label="Všechny osobonoci" value={metrics.guestNights} />
        <ReportRow label="Zpoplatněné osobonoci" value={metrics.taxableGuestNights} />
        <ReportRow label="Předepsaný poplatek" value={formatCurrency(metrics.cityTaxAssessed)} />
        <ReportRow label="Skutečně vybráno" value={formatCurrency(metrics.cityTaxCollected)} strong />
      </ReportPanel>
    </div>
  )
}

function FinanceReport({
  data,
  basis,
}: {
  data: NordFjellaReportData
  basis: NordFjellaFinanceDateBasis
}) {
  const { metrics } = data
  const completeness =
    data.rentals.length > 0
      ? Math.round(
          ((data.rentals.length - metrics.financialIncompleteCount) / data.rentals.length) *
            100
        )
      : null

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <ReportPanel title={basis === 'payment' ? 'DPH z přijatých plateb' : 'Tržby a DPH'}>
          {basis === 'payment' ? (
            <>
              <ReportRow label="Základ 12 %" value={formatCurrency(metrics.advanceVat12Base)} />
              <ReportRow label="DPH 12 %" value={formatCurrency(metrics.advanceVat12Amount)} strong />
              <ReportRow label="Základ 21 %" value={formatCurrency(metrics.advanceVat21Base)} />
              <ReportRow label="DPH 21 %" value={formatCurrency(metrics.advanceVat21Amount)} strong />
            </>
          ) : (
            <>
              <ReportRow label="Základ 12 %" value={formatCurrency(metrics.vat12Base)} />
              <ReportRow label="DPH 12 %" value={formatCurrency(metrics.vat12Amount)} />
              <ReportRow label="Základ 21 %" value={formatCurrency(metrics.vat21Base)} />
              <ReportRow label="DPH 21 %" value={formatCurrency(metrics.vat21Amount)} />
              <ReportRow label="Celkem s DPH" value={formatCurrency(metrics.servicesGross)} strong />
            </>
          )}
        </ReportPanel>
        <ReportPanel title="Platby">
          <ReportRow label="Přijaté zálohy a doplatky" value={formatCurrency(metrics.paymentIncome)} />
          <ReportRow label="Vratky" value={formatCurrency(metrics.paymentRefunds)} />
          <ReportRow label="Čistě přijato" value={formatCurrency(metrics.netCashflow)} strong />
          <ReportRow label="Aktuálně k inkasu" value={formatCurrency(metrics.receivable)} />
        </ReportPanel>
        <ReportPanel title="Mimo tržby">
          <ReportRow label="Místní poplatek předepsán" value={formatCurrency(metrics.cityTaxAssessed)} />
          <ReportRow label="Místní poplatek vybrán" value={formatCurrency(metrics.cityTaxCollected)} />
          <ReportRow label="Kauce aktuálně drženo" value={formatCurrency(metrics.heldDeposits)} />
          <ReportRow label="Kauce vráceno / zadrženo" value={`${formatCurrency(metrics.refundedDeposits)} / ${formatCurrency(metrics.withheldDeposits)}`} />
        </ReportPanel>
      </div>

      <div className="nord-fjella-modal-card flex flex-col gap-2 rounded-2xl border border-white/80 bg-white/72 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-zinc-600">
          Úplnost finanční evidence:{' '}
          <strong className="text-zinc-900">
            {completeness === null ? '—' : `${completeness} %`}
          </strong>
          <span className="ml-2 text-zinc-400">
            ({data.rentals.length - metrics.financialIncompleteCount} z {data.rentals.length})
          </span>
        </div>
        {data.rentals.length === 0 ? (
          <span className="text-xs font-medium text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
            Bez finančních záznamů
          </span>
        ) : metrics.financialIncompleteCount > 0 ? (
          <span role="status" className="text-xs font-medium text-amber-700 [html[data-theme='dark']_&]:text-amber-200">
            {metrics.financialIncompleteCount} záznamů vyžaduje doplnění
          </span>
        ) : (
          <span className="text-xs font-medium text-emerald-700 [html[data-theme='dark']_&]:text-emerald-300">
            Evidence je kompletní
          </span>
        )}
      </div>

      {basis === 'payment' ? (
        <PaymentsTable data={data} />
      ) : (
        <FinanceReservationsTable data={data} />
      )}
    </div>
  )
}

function FinanceReservationsTable({ data }: { data: NordFjellaReportData }) {
  return (
    <TableShell scrollHint="Tabulku lze posouvat vodorovně.">
      <table className="w-full min-w-[1020px] text-left text-xs">
        <thead className="bg-zinc-100/75 text-[9px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:bg-slate-950/35">
          <tr>
            {['Rezervace', 'Zákazník', 'DUZP', 'Bez DPH', 'DPH', 'S DPH', 'Poplatek vybrán / předpis', 'Přijato', 'K inkasu', 'Stav'].map((label) => (
              <th key={label} className={`px-3 py-3 ${['Bez DPH', 'DPH', 'S DPH', 'Poplatek vybrán / předpis', 'Přijato', 'K inkasu'].includes(label) ? 'text-right' : ''}`}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.financeRows.map((row) => (
            <tr key={row.reservation.id} className="border-t border-zinc-200/65 [html[data-theme='dark']_&]:border-slate-400/10">
              <td className="sticky left-0 whitespace-nowrap bg-white/95 px-3 py-3 font-semibold [html[data-theme='dark']_&]:bg-slate-900/95">
                {row.reservation.reservation_number}
                {row.reservation.external_document_number ? <div className="text-[9px] font-normal text-zinc-500">{row.reservation.external_document_number}</div> : null}
              </td>
              <td className="max-w-[170px] truncate px-3 py-3">{row.reservation.guest_company_name || row.reservation.guest_full_name || row.reservation.guest_contact_name || '—'}</td>
              <td className="whitespace-nowrap px-3 py-3">{formatDate(row.reservation.taxable_supply_date || row.reservation.stay_end_date)}</td>
              {[row.servicesNet, row.servicesVat, row.servicesGross].map((value, index) => (
                <td key={index} className="whitespace-nowrap px-3 py-3 text-right">{formatCurrency(value)}</td>
              ))}
              <td className="whitespace-nowrap px-3 py-3 text-right">
                {formatCurrency(row.cityTaxCollected)} / {formatCurrency(row.cityTaxAssessed)}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-right">{formatCurrency(row.paid)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">
                {formatCurrency(Math.max(row.remaining, 0))}
              </td>
              <td className="whitespace-nowrap px-3 py-3">{row.reservation.settlement_status === 'closed' ? 'Uzavřeno' : row.reservation.settlement_status === 'in_progress' ? 'Rozpracováno' : 'Nepřipraveno'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.financeRows.length === 0 ? <EmptyState text="V období nejsou finanční záznamy." /> : null}
    </TableShell>
  )
}

function PaymentsTable({ data }: { data: NordFjellaReportData }) {
  const reservationMap = new Map(data.reservations.map((row) => [row.id, row]))
  return (
    <TableShell scrollHint="Platební knihu lze posouvat vodorovně.">
      <table className="w-full min-w-[900px] text-left text-xs">
        <thead className="bg-zinc-100/75 text-[9px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:bg-slate-950/35">
          <tr>
            {['Datum', 'Rezervace', 'Doklad', 'Pohyb', 'Způsob', 'Částka', 'Základ DPH', 'DPH'].map((label) => (
              <th key={label} className={`px-3 py-3 ${['Částka', 'Základ DPH', 'DPH'].includes(label) ? 'text-right' : ''}`}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.payments.map((payment) => (
            <tr key={payment.id} className="border-t border-zinc-200/65 [html[data-theme='dark']_&]:border-slate-400/10">
              <td className="whitespace-nowrap px-3 py-3">{formatDate(payment.transaction_date)}</td>
              <td className="px-3 py-3 font-semibold">{reservationMap.get(payment.reservation_id)?.reservation_number ?? '—'}</td>
              <td className="px-3 py-3">{payment.tax_document_number || '—'}</td>
              <td className="px-3 py-3">{paymentTypeLabel(payment.transaction_type)}</td>
              <td className="px-3 py-3">{payment.payment_method === 'cash' ? 'Hotově' : payment.payment_method === 'bank_transfer' ? 'Převod' : '—'}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">{formatCurrency(payment.direction === 'out' ? -Number(payment.amount) : Number(payment.amount))}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right">{formatCurrency(Number(payment.vat_12_base ?? 0) + Number(payment.vat_21_base ?? 0))}</td>
              <td className="whitespace-nowrap px-3 py-3 text-right">{formatCurrency(Number(payment.vat_12_amount ?? 0) + Number(payment.vat_21_amount ?? 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.payments.length === 0 ? <EmptyState text="V období nejsou žádné platební pohyby." /> : null}
    </TableShell>
  )
}

function OwnerStaysReport({ data }: { data: NordFjellaReportData }) {
  return (
    <TableShell>
      <div className="grid gap-2 p-3 md:hidden">
        {data.ownerStays.map((row) => (
          <article key={row.id} className="rounded-xl border border-zinc-200/75 bg-white/65 p-3 [html[data-theme='dark']_&]:border-slate-400/10 [html[data-theme='dark']_&]:bg-slate-950/25">
            <div className="flex items-center justify-between gap-3">
              <strong>{row.reservation_number}</strong>
              <span className="text-xs text-zinc-500">{formatDate(row.stay_start_date)}–{formatDate(row.stay_end_date)}</span>
            </div>
            <div className="mt-2 text-xs text-zinc-600">{row.internal_note || 'Bez poznámky'}</div>
          </article>
        ))}
      </div>
      <table className="hidden w-full text-left text-xs md:table">
        <thead className="bg-zinc-100/75 text-[9px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:bg-slate-950/35">
          <tr><th className="px-4 py-3">Číslo</th><th className="px-4 py-3">Od</th><th className="px-4 py-3">Do</th><th className="px-4 py-3">Poznámka</th></tr>
        </thead>
        <tbody>
          {data.ownerStays.map((row) => (
            <tr key={row.id} className="border-t border-zinc-200/65 [html[data-theme='dark']_&]:border-slate-400/10">
              <td className="px-4 py-3 font-semibold">{row.reservation_number}</td>
              <td className="px-4 py-3">{formatDate(row.stay_start_date)}</td>
              <td className="px-4 py-3">{formatDate(row.stay_end_date)}</td>
              <td className="max-w-[360px] truncate px-4 py-3">{row.internal_note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.ownerStays.length === 0 ? <EmptyState text="V období nejsou vlastní pobyty." /> : null}
    </TableShell>
  )
}

function GuestsReport({
  data,
  legalBook,
}: {
  data: NordFjellaReportData
  legalBook: boolean
}) {
  const reservationMap = new Map(data.reservations.map((row) => [row.id, row]))
  return (
    <TableShell scrollHint="Na mobilu jsou údaje uspořádané do karet.">
      <div className="grid gap-2 p-3 md:hidden">
        {data.guests.map((guest) => (
          <article key={guest.id} className="rounded-xl border border-zinc-200/75 bg-white/65 p-3 [html[data-theme='dark']_&]:border-slate-400/10 [html[data-theme='dark']_&]:bg-slate-950/25">
            <div className="flex items-start justify-between gap-3">
              <div>
                <strong>{guest.first_name} {guest.last_name}</strong>
                <div className="mt-0.5 text-[10px] text-zinc-500">{formatDate(guest.birth_date)} · ČR</div>
              </div>
              <span className="text-[10px] font-semibold text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">
                {reservationMap.get(guest.reservation_id)?.reservation_number ?? '—'}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-[90px_1fr] gap-x-2 gap-y-1.5 text-xs">
              <dt className="text-zinc-500">Pobyt</dt><dd>{formatDate(guest.stay_start_date)}–{formatDate(guest.stay_end_date)}</dd>
              <dt className="text-zinc-500">Bydliště</dt><dd>{guest.street}, {guest.postal_code} {guest.city}</dd>
              {legalBook ? <><dt className="text-zinc-500">Doklad</dt><dd>{documentTypeLabel(guest.identity_document_type)} · {guest.identity_document_number}</dd></> : null}
              <dt className="text-zinc-500">Poplatek</dt><dd>{taxLabel(guest)}</dd>
            </dl>
          </article>
        ))}
      </div>
      <table className="hidden w-full min-w-[820px] text-left text-xs md:table">
        <thead className="bg-zinc-100/75 text-[9px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:bg-slate-950/35">
          <tr>
            <th className="px-4 py-3">Host</th><th className="px-4 py-3">Pobyt</th><th className="px-4 py-3">Bydliště</th>
            {legalBook ? <th className="px-4 py-3">Doklad</th> : null}
            <th className="px-4 py-3">Poplatek</th>
          </tr>
        </thead>
        <tbody>
          {data.guests.map((guest) => (
            <tr key={guest.id} className="border-t border-zinc-200/65 [html[data-theme='dark']_&]:border-slate-400/10">
              <td className="whitespace-nowrap px-4 py-3"><strong>{guest.first_name} {guest.last_name}</strong><div className="text-[10px] text-zinc-500">{formatDate(guest.birth_date)} · ČR</div></td>
              <td className="whitespace-nowrap px-4 py-3">{formatDate(guest.stay_start_date)}–{formatDate(guest.stay_end_date)}<div className="text-[10px] text-zinc-500">{reservationMap.get(guest.reservation_id)?.reservation_number ?? '—'}</div></td>
              <td className="min-w-[190px] px-4 py-3">{guest.street}, {guest.postal_code} {guest.city}</td>
              {legalBook ? <td className="whitespace-nowrap px-4 py-3">{documentTypeLabel(guest.identity_document_type)} · {guest.identity_document_number}</td> : null}
              <td className="whitespace-nowrap px-4 py-3">{taxLabel(guest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.guests.length === 0 ? <EmptyState text="V období nejsou evidováni žádní hosté." /> : null}
    </TableShell>
  )
}

function ReportPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-white/72 p-4">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{title}</h3>
      <dl className="mt-3 space-y-2">{children}</dl>
    </section>
  )
}

function ReportRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string | number
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-zinc-200/55 pt-2 first:border-t-0 first:pt-0 [html[data-theme='dark']_&]:border-slate-400/10">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`text-right text-xs ${strong ? 'font-semibold text-[#236f9f] [html[data-theme=\'dark\']_&]:text-sky-200' : 'font-medium text-zinc-900'}`}>{value}</dd>
    </div>
  )
}

function TableShell({
  children,
  scrollHint,
}: {
  children: ReactNode
  scrollHint?: string
}) {
  return (
    <section className="nord-fjella-modal-card overflow-hidden rounded-2xl border border-white/80 bg-white/72">
      {scrollHint ? <div className="border-b border-zinc-200/60 px-3 py-2 text-[10px] text-zinc-400 md:hidden [html[data-theme='dark']_&]:border-slate-400/10">{scrollHint}</div> : null}
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="border-t border-zinc-200/60 px-4 py-8 text-center text-sm text-zinc-500 [html[data-theme='dark']_&]:border-slate-400/10">{text}</div>
}

function paymentTypeLabel(type: NordFjellaPaymentRow['transaction_type']) {
  if (type === 'deposit') return 'Záloha'
  if (type === 'balance') return 'Doplatek'
  if (type === 'refund') return 'Vratka'
  if (type === 'security_deposit_received') return 'Přijetí kauce'
  if (type === 'security_deposit_refund') return 'Vrácení kauce'
  return 'Zadržení kauce'
}

function documentTypeLabel(type: NordFjellaStayGuestRow['identity_document_type']) {
  if (type === 'id_card') return 'OP'
  if (type === 'passport') return 'Pas'
  return 'Jiný'
}

function taxLabel(guest: NordFjellaStayGuestRow) {
  if (guest.city_tax_status === 'liable') {
    return `${formatCurrency(guest.city_tax_collected_amount)} vybráno z ${formatCurrency(guest.city_tax_amount)}`
  }
  if (guest.city_tax_status === 'exempt') return `Osvobozen · ${guest.city_tax_exemption_reason || 'bez důvodu'}`
  return 'Nepodléhá'
}
