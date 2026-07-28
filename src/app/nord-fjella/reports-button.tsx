'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import {
  buildNordFjellaSettlementSummary,
  getNordFjellaNightCount,
} from '@/lib/nord-fjella/settlement'
import type {
  NordFjellaPaymentRow,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaStayGuestRow,
} from '@/lib/nord-fjella/types'

type ReportType = 'overview' | 'finance' | 'guests' | 'owner_stays' | 'guest_book'
type FinanceDateBasis = 'supply' | 'payment' | 'stay'

const REPORT_TYPES: Array<{ value: ReportType; label: string }> = [
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

function getDateNightCount(from: string, to: string) {
  const start = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000))
}

function getTaxStatusLabel(status: NordFjellaStayGuestRow['city_tax_status']) {
  if (status === 'liable') return 'Poplatek'
  if (status === 'exempt') return 'Osvobozen'
  return 'Bez poplatku'
}

function getDefaultFromDate() {
  const now = new Date()
  return `${now.getFullYear()}-01-01`
}

function getDefaultToDate() {
  const now = new Date()
  return `${now.getFullYear()}-12-31`
}

function getCurrentPeriodRange(period: 'month' | 'quarter' | 'year') {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstMonth = period === 'quarter' ? Math.floor(month / 3) * 3 : period === 'year' ? 0 : month
  const lastMonth = period === 'quarter' ? firstMonth + 2 : period === 'year' ? 11 : month
  const from = new Date(year, firstMonth, 1)
  const to = new Date(year, lastMonth + 1, 0)
  const format = (date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return { from: format(from), to: format(to) }
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

  return (
    <>
      <button
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
          onClose={() => setIsOpen(false)}
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
  const [reportType, setReportType] = useState<ReportType>('overview')
  const [financeDateBasis, setFinanceDateBasis] = useState<FinanceDateBasis>('supply')
  const [fromDate, setFromDate] = useState(getDefaultFromDate)
  const [toDate, setToDate] = useState(getDefaultToDate)

  useBodyScrollLock(true)

  const paymentsInRange = useMemo(
    () =>
      payments.filter(
        (payment) =>
          payment.transaction_date >= fromDate && payment.transaction_date <= toDate
      ),
    [fromDate, payments, toDate]
  )
  const paymentReservationIds = useMemo(
    () => new Set(paymentsInRange.map((payment) => payment.reservation_id)),
    [paymentsInRange]
  )
  const filteredReservations = useMemo(() => {
    if (reportType === 'finance' && financeDateBasis === 'payment') {
      return reservations.filter((reservation) => paymentReservationIds.has(reservation.id))
    }

    if (reportType === 'finance' && financeDateBasis === 'supply') {
      return reservations.filter((reservation) => {
        const supplyDate = reservation.taxable_supply_date || reservation.stay_end_date
        return supplyDate >= fromDate && supplyDate <= toDate
      })
    }

    return reservations.filter(
      (reservation) =>
        reservation.stay_end_date > fromDate && reservation.stay_start_date <= toDate
    )
  }, [
    financeDateBasis,
    fromDate,
    paymentReservationIds,
    reportType,
    reservations,
    toDate,
  ])
  const reservationIds = useMemo(
    () =>
      new Set(
        filteredReservations
          .filter((reservation) => reservation.record_type === 'reservation')
          .map((reservation) => reservation.id)
      ),
    [filteredReservations]
  )
  const filteredGuests = useMemo(
    () => stayGuests.filter((guest) => reservationIds.has(guest.reservation_id)),
    [reservationIds, stayGuests]
  )
  const ownerStays = filteredReservations.filter((row) => row.record_type === 'owner_block')
  const rentals = filteredReservations.filter((row) => row.record_type === 'reservation')
  const completedRentals = rentals.filter((row) => row.reservation_status === 'completed')
  const totalGuestNights = filteredGuests.reduce(
    (sum, guest) => sum + getDateNightCount(guest.stay_start_date, guest.stay_end_date),
    0
  )
  const taxableGuestNights = filteredGuests.reduce(
    (sum, guest) => sum + Math.max(Number(guest.city_tax_nights ?? 0), 0),
    0
  )
  const totalTax = filteredGuests.reduce(
    (sum, guest) => sum + Number(guest.city_tax_amount ?? 0),
    0
  )
  const incompleteReservations = rentals.filter(
    (reservation) =>
      filteredGuests.filter((guest) => guest.reservation_id === reservation.id).length !==
      reservation.adult_count + reservation.child_count
  )
  const itemsByReservationId = useMemo(() => {
    const map = new Map<string, NordFjellaReservationItemRow[]>()
    for (const item of reservationItems) {
      const rows = map.get(item.reservation_id) ?? []
      rows.push(item)
      map.set(item.reservation_id, rows)
    }
    return map
  }, [reservationItems])
  const filteredPayments =
    reportType === 'finance' && financeDateBasis === 'payment'
      ? paymentsInRange
      : payments.filter((payment) => reservationIds.has(payment.reservation_id))
  const filteredPaymentIncome = filteredPayments
    .filter(
      (payment) =>
        payment.direction === 'in' &&
        (payment.transaction_type === 'deposit' || payment.transaction_type === 'balance')
    )
    .reduce((sum, payment) => sum + Number(payment.amount), 0)
  const filteredPaymentRefunds = filteredPayments
    .filter((payment) => payment.transaction_type === 'refund')
    .reduce((sum, payment) => sum + Number(payment.amount), 0)
  const financeSummary = rentals.reduce(
    (summary, reservation) => {
      const settlement = buildNordFjellaSettlementSummary(
        reservation,
        itemsByReservationId.get(reservation.id) ?? []
      )
      return {
        net: summary.net + settlement.servicesNetTotal,
        vat: summary.vat + settlement.servicesVatTotal,
        gross: summary.gross + settlement.servicesGrossTotal,
        vat12Base: summary.vat12Base + settlement.vat12Base,
        vat12: summary.vat12 + settlement.vat12Amount,
        vat21Base: summary.vat21Base + settlement.vat21Base,
        vat21: summary.vat21 + settlement.vat21Amount,
        outsideVat: summary.outsideVat + settlement.outsideVatTotal,
        received: summary.received + settlement.paidTotal,
        receivable: summary.receivable + Math.max(settlement.remainingToPay, 0),
      }
    },
    {
      net: 0,
      vat: 0,
      gross: 0,
      vat12Base: 0,
      vat12: 0,
      vat21Base: 0,
      vat21: 0,
      outsideVat: 0,
      received: 0,
      receivable: 0,
    }
  )
  const financialIncompleteReservations = rentals.filter(
    (reservation) =>
      !reservation.taxable_supply_date ||
      (reservation.reservation_status === 'completed' &&
        reservation.settlement_status !== 'closed') ||
      (Number(reservation.deposit_paid_amount ?? 0) > 0 && !reservation.deposit_paid_at) ||
      (Number(reservation.balance_paid_amount ?? 0) > 0 && !reservation.balance_paid_at)
  )
  const reportedReceived =
    reportType === 'finance' && financeDateBasis === 'payment'
      ? filteredPaymentIncome - filteredPaymentRefunds
      : financeSummary.received

  const query = new URLSearchParams({
    type: reportType,
    from: fromDate,
    to: toDate,
    basis: financeDateBasis,
  }).toString()

  const content = (
    <div
      className="fixed inset-0 z-[120] overflow-y-auto overscroll-contain bg-zinc-950/42 p-4 backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex min-h-full items-center justify-center py-2">
        <div className="clients-modal__shell flex max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.94)_0%,rgba(249,250,251,0.86)_42%,rgba(244,244,245,0.78)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.3)]">
          <div className="clients-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 px-4 py-3 sm:px-5 sm:py-4">
            <h2 className="clients-modal__title text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
              Reporty
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-700"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="nord-fjella-modal-body min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="nord-fjella-modal-card grid gap-3 rounded-2xl border border-white/80 bg-white/68 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] lg:grid-cols-[minmax(0,1fr)_170px_170px_auto] lg:items-end">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  Typ reportu
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-zinc-100/80 p-1 sm:grid-cols-5 [html[data-theme='dark']_&]:border-slate-400/15 [html[data-theme='dark']_&]:bg-slate-950/35">
                  {REPORT_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setReportType(type.value)}
                      className={`rounded-lg px-2 py-2 text-[11px] font-medium transition ${
                        reportType === type.value
                          ? 'bg-white text-[#236f9f] shadow-sm [html[data-theme=\'dark\']_&]:bg-slate-700/80 [html[data-theme=\'dark\']_&]:text-sky-200'
                          : 'text-zinc-600 hover:text-zinc-900 [html[data-theme=\'dark\']_&]:text-slate-400 [html[data-theme=\'dark\']_&]:hover:text-white'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
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
                        const range = getCurrentPeriodRange(period as 'month' | 'quarter' | 'year')
                        setFromDate(range.from)
                        setToDate(range.to)
                      }}
                      className="rounded-lg border border-zinc-200 bg-white/70 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.06em] text-zinc-500 [html[data-theme='dark']_&]:border-slate-400/15 [html[data-theme='dark']_&]:bg-slate-800/55 [html[data-theme='dark']_&]:text-slate-400"
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
                  href={`/nord-fjella/reports/pdf?${query}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#2b679a_100%)] px-3 text-xs font-medium uppercase text-white"
                >
                  PDF
                </a>
                <a
                  href={`/nord-fjella/reports/csv?${query}`}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium uppercase text-zinc-700 [html[data-theme='dark']_&]:border-slate-400/15 [html[data-theme='dark']_&]:bg-slate-800/80 [html[data-theme='dark']_&]:text-slate-200"
                >
                  CSV
                </a>
              </div>
            </div>

            {reportType === 'finance' ? (
              <div className="nord-fjella-modal-card mt-3 flex flex-col gap-2 rounded-2xl border border-white/80 bg-white/68 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    Rozhodné datum
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    Určuje, podle kterého data se rezervace zařadí do období.
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-zinc-100/80 p-1 [html[data-theme='dark']_&]:border-slate-400/15 [html[data-theme='dark']_&]:bg-slate-950/35">
                  {[
                    ['Plnění', 'supply'],
                    ['Platby', 'payment'],
                    ['Pobyt', 'stay'],
                  ].map(([label, value]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFinanceDateBasis(value as FinanceDateBasis)}
                      className={`rounded-lg px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.06em] transition ${
                        financeDateBasis === value
                          ? 'bg-white text-[#236f9f] shadow-sm [html[data-theme=\'dark\']_&]:bg-slate-700/80 [html[data-theme=\'dark\']_&]:text-sky-200'
                          : 'text-zinc-500 [html[data-theme=\'dark\']_&]:text-slate-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {reportType === 'finance' && financialIncompleteReservations.length > 0 ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-800 [html[data-theme='dark']_&]:border-amber-400/20 [html[data-theme='dark']_&]:bg-amber-950/30 [html[data-theme='dark']_&]:text-amber-200">
                {financialIncompleteReservations.length} rezervací nemá kompletní finanční údaje nebo uzavřené vyúčtování.
              </div>
            ) : reportType !== 'finance' && incompleteReservations.length > 0 ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-800">
                {incompleteReservations.length} rezervací nemá doplněný počet ubytovaných osob. Export je označí jako neúplné.
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
              {(reportType === 'finance'
                ? [
                    ['Služby bez DPH', formatCurrency(financeSummary.net)],
                    ['DPH celkem', formatCurrency(financeSummary.vat)],
                    ['Služby s DPH', formatCurrency(financeSummary.gross)],
                    ['Přijato', formatCurrency(reportedReceived)],
                    ['K inkasu', formatCurrency(financeSummary.receivable)],
                  ]
                : [
                    ['Záznamy', filteredReservations.length],
                    ['Pronájmy', rentals.length],
                    ['Hosté', filteredGuests.length],
                    ['Osobonoci', totalGuestNights],
                    ['Místní poplatek', formatCurrency(totalTax)],
                  ]
              ).map(([label, value]) => (
                <div key={label} className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-white/70 p-3">
                  <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">{label}</div>
                  <div className="mt-1 text-lg font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">{value}</div>
                </div>
              ))}
            </div>

            <div className="nord-fjella-modal-card mt-4 overflow-hidden rounded-2xl border border-white/80 bg-white/72">
              {reportType === 'overview' ? (
                <OverviewReport
                  rentals={rentals}
                  completedRentals={completedRentals}
                  ownerStays={ownerStays}
                  guests={filteredGuests}
                />
              ) : reportType === 'finance' ? (
                <FinanceReport
                  reservations={rentals}
                  itemsByReservationId={itemsByReservationId}
                  payments={filteredPayments}
                  summary={financeSummary}
                  receivedTotal={reportedReceived}
                  cityTax={totalTax}
                  taxableGuestNights={taxableGuestNights}
                  allGuestNights={totalGuestNights}
                  incompleteCount={financialIncompleteReservations.length}
                />
              ) : reportType === 'owner_stays' ? (
                <OwnerStaysReport rows={ownerStays} />
              ) : (
                <GuestsReport
                  guests={filteredGuests}
                  reservations={filteredReservations}
                  legalBook={reportType === 'guest_book'}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(content, document.body)
}

function OverviewReport({
  rentals,
  completedRentals,
  ownerStays,
  guests,
}: {
  rentals: NordFjellaReservationRow[]
  completedRentals: NordFjellaReservationRow[]
  ownerStays: NordFjellaReservationRow[]
  guests: NordFjellaStayGuestRow[]
}) {
  const liableGuests = guests.filter((guest) => guest.city_tax_status === 'liable').length
  const exemptGuests = guests.filter((guest) => guest.city_tax_status === 'exempt').length
  const rentalNights = rentals.reduce((sum, row) => sum + getNordFjellaNightCount(row), 0)
  const ownerNights = ownerStays.reduce((sum, row) => sum + getNordFjellaNightCount(row), 0)

  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">Pobyty</h3>
        <dl className="mt-3 grid gap-2 text-sm [html[data-theme='dark']_&]:text-slate-300">
          <div className="flex justify-between"><dt>Pronájmy</dt><dd className="font-semibold">{rentals.length}</dd></div>
          <div className="flex justify-between"><dt>Dokončené pronájmy</dt><dd className="font-semibold">{completedRentals.length}</dd></div>
          <div className="flex justify-between"><dt>Noci pronájmů</dt><dd className="font-semibold">{rentalNights}</dd></div>
          <div className="flex justify-between"><dt>Vlastní pobyty</dt><dd className="font-semibold">{ownerStays.length}</dd></div>
          <div className="flex justify-between"><dt>Noci vlastních pobytů</dt><dd className="font-semibold">{ownerNights}</dd></div>
        </dl>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">Evidence hostů</h3>
        <dl className="mt-3 grid gap-2 text-sm [html[data-theme='dark']_&]:text-slate-300">
          <div className="flex justify-between"><dt>Ubytované osoby</dt><dd className="font-semibold">{guests.length}</dd></div>
          <div className="flex justify-between"><dt>Poplatku podléhá</dt><dd className="font-semibold">{liableGuests}</dd></div>
          <div className="flex justify-between"><dt>Osvobozené osoby</dt><dd className="font-semibold">{exemptGuests}</dd></div>
          <div className="flex justify-between"><dt>Občanství</dt><dd className="font-semibold">Pouze ČR</dd></div>
        </dl>
      </div>
    </div>
  )
}

type FinanceSummaryValue = {
  net: number
  vat: number
  gross: number
  vat12Base: number
  vat12: number
  vat21Base: number
  vat21: number
  outsideVat: number
  received: number
  receivable: number
}

function FinanceReport({
  reservations,
  itemsByReservationId,
  payments,
  summary,
  receivedTotal,
  cityTax,
  taxableGuestNights,
  allGuestNights,
  incompleteCount,
}: {
  reservations: NordFjellaReservationRow[]
  itemsByReservationId: Map<string, NordFjellaReservationItemRow[]>
  payments: NordFjellaPaymentRow[]
  summary: FinanceSummaryValue
  receivedTotal: number
  cityTax: number
  taxableGuestNights: number
  allGuestNights: number
  incompleteCount: number
}) {
  const paymentIncome = payments
    .filter(
      (payment) =>
        payment.direction === 'in' &&
        (payment.transaction_type === 'deposit' || payment.transaction_type === 'balance')
    )
    .reduce((sum, payment) => sum + Number(payment.amount), 0)
  const paymentRefunds = payments
    .filter((payment) => payment.transaction_type === 'refund')
    .reduce((sum, payment) => sum + Number(payment.amount), 0)
  const heldDeposits = reservations.reduce(
    (sum, reservation) =>
      sum +
      Math.max(
        Number(reservation.security_deposit_received ? reservation.security_deposit_amount : 0) -
          Number(reservation.security_deposit_refund_amount ?? 0) -
          Number(reservation.security_deposit_withheld_amount ?? 0),
        0
      ),
    0
  )
  const refundedDeposits = reservations.reduce(
    (sum, reservation) => sum + Number(reservation.security_deposit_refund_amount ?? 0),
    0
  )
  const withheldDeposits = reservations.reduce(
    (sum, reservation) => sum + Number(reservation.security_deposit_withheld_amount ?? 0),
    0
  )
  const completeness =
    reservations.length > 0
      ? Math.round(((reservations.length - incompleteCount) / reservations.length) * 100)
      : 100

  return (
    <div className="p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <FinancePanel title="Tržby">
          <FinancePrimary label="Služby bez DPH" value={formatCurrency(summary.net)} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <FinanceMini label="DPH celkem" value={formatCurrency(summary.vat)} />
            <FinanceMini label="Služby s DPH" value={formatCurrency(summary.gross)} />
          </div>
          <FinanceCompact
            label="Mimo DPH · místní poplatek"
            value={formatCurrency(summary.outsideVat)}
          />
        </FinancePanel>

        <FinancePanel title="Inkaso">
          <FinancePrimary
            label="Čistě přijato"
            value={formatCurrency(receivedTotal)}
            accent
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <FinanceMini
              label="Přijaté platby"
              value={formatCurrency(paymentIncome || receivedTotal + paymentRefunds)}
            />
            <FinanceMini label="Vratky" value={formatCurrency(paymentRefunds)} />
          </div>
          <FinanceCompact label="Zbývá uhradit" value={formatCurrency(summary.receivable)} />
        </FinancePanel>

        <FinancePanel title="DPH">
          <FinancePrimary label="Daň celkem" value={formatCurrency(summary.vat)} accent />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <FinanceMini
              label="12 % · základ / DPH"
              value={`${formatCurrency(summary.vat12Base)} / ${formatCurrency(summary.vat12)}`}
            />
            <FinanceMini
              label="21 % · základ / DPH"
              value={`${formatCurrency(summary.vat21Base)} / ${formatCurrency(summary.vat21)}`}
            />
          </div>
        </FinancePanel>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <FinancePanel title="Místní poplatek">
          <FinancePrimary label="Předepsáno" value={formatCurrency(cityTax)} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <FinanceMini label="Všechny osobonoci" value={String(allGuestNights)} />
            <FinanceMini label="Zpoplatněné osobonoci" value={String(taxableGuestNights)} />
          </div>
        </FinancePanel>
        <FinancePanel title="Kauce">
          <FinancePrimary label="Aktuálně drženo" value={formatCurrency(heldDeposits)} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <FinanceMini label="Vráceno" value={formatCurrency(refundedDeposits)} />
            <FinanceMini label="Zadrženo" value={formatCurrency(withheldDeposits)} />
          </div>
        </FinancePanel>
        <FinancePanel title="Úplnost evidence">
          <FinancePrimary label="Finančně kompletní" value={`${completeness} %`} accent />
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200/80 [html[data-theme='dark']_&]:bg-slate-700/70">
            <div
              className="h-full rounded-full bg-[#2980b9] [html[data-theme='dark']_&]:bg-sky-300"
              style={{ width: `${Math.max(0, Math.min(completeness, 100))}%` }}
            />
          </div>
          <div className="mt-3 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
            {reservations.length - incompleteCount} z {reservations.length} rezervací
          </div>
        </FinancePanel>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200/80 [html[data-theme='dark']_&]:border-slate-400/15">
        <table className="min-w-[1050px] w-full text-left text-xs">
          <thead className="bg-zinc-50 text-[10px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:bg-slate-950/35 [html[data-theme='dark']_&]:text-slate-400">
            <tr>
              <th className="px-3 py-3">Rezervace</th>
              <th className="px-3 py-3">Zákazník</th>
              <th className="px-3 py-3">DUZP</th>
              <th className="px-3 py-3 text-right">Bez DPH</th>
              <th className="px-3 py-3 text-right">DPH</th>
              <th className="px-3 py-3 text-right">S DPH</th>
              <th className="px-3 py-3 text-right">Poplatek</th>
              <th className="px-3 py-3 text-right">Přijato</th>
              <th className="px-3 py-3 text-right">K inkasu</th>
              <th className="px-3 py-3">Vyúčtování</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((reservation) => {
              const settlement = buildNordFjellaSettlementSummary(
                reservation,
                itemsByReservationId.get(reservation.id) ?? []
              )
              return (
                <tr
                  key={reservation.id}
                  className="border-t border-zinc-100 [html[data-theme='dark']_&]:border-slate-400/10 [html[data-theme='dark']_&]:text-slate-200"
                >
                  <td className="whitespace-nowrap px-3 py-3 font-semibold">
                    {reservation.reservation_number}
                    {reservation.external_document_number ? (
                      <div className="mt-0.5 text-[9px] font-normal text-zinc-500">
                        {reservation.external_document_number}
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-3">
                    {reservation.guest_company_name ||
                      reservation.guest_full_name ||
                      reservation.guest_contact_name ||
                      '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {formatDate(reservation.taxable_supply_date || reservation.stay_end_date)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">{formatCurrency(settlement.servicesNetTotal)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">{formatCurrency(settlement.servicesVatTotal)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">{formatCurrency(settlement.servicesGrossTotal)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">{formatCurrency(settlement.outsideVatTotal)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">{formatCurrency(settlement.paidTotal)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">
                    {formatCurrency(Math.max(settlement.remainingToPay, 0))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {reservation.settlement_status === 'closed'
                      ? 'Uzavřeno'
                      : reservation.settlement_status === 'in_progress'
                        ? 'Rozpracováno'
                        : 'Nepřipraveno'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {reservations.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-500">V období nejsou finanční záznamy.</div>
        ) : null}
      </div>
    </div>
  )
}

function FinancePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="nord-fjella-modal-card min-w-0 rounded-2xl border border-white/80 bg-white/70 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  )
}

function FinancePrimary({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="mt-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 truncate text-2xl font-semibold ${
          accent
            ? 'text-[#2877aa] [html[data-theme=\'dark\']_&]:text-sky-300'
            : 'text-zinc-900 [html[data-theme=\'dark\']_&]:text-white'
        }`}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function FinanceMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200/75 bg-slate-50/75 px-2.5 py-2 [html[data-theme='dark']_&]:border-slate-400/10 [html[data-theme='dark']_&]:bg-slate-950/30">
      <div className="text-[8px] font-semibold uppercase tracking-[0.07em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-slate-100" title={value}>
        {value}
      </div>
    </div>
  )
}

function FinanceCompact({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3 border-t border-zinc-200/70 pt-2 text-xs [html[data-theme='dark']_&]:border-slate-400/10">
      <span className="text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">{label}</span>
      <span className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">{value}</span>
    </div>
  )
}

function OwnerStaysReport({ rows }: { rows: NordFjellaReservationRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-zinc-50 text-[10px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:bg-slate-950/35 [html[data-theme='dark']_&]:text-slate-400">
          <tr><th className="px-4 py-3">Číslo</th><th className="px-4 py-3">Od</th><th className="px-4 py-3">Do</th><th className="px-4 py-3">Nocí</th><th className="px-4 py-3">Poznámka</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-zinc-100 [html[data-theme='dark']_&]:border-slate-400/10 [html[data-theme='dark']_&]:text-slate-200">
              <td className="px-4 py-3 font-semibold">{row.reservation_number}</td>
              <td className="px-4 py-3">{formatDate(row.stay_start_date)}</td>
              <td className="px-4 py-3">{formatDate(row.stay_end_date)}</td>
              <td className="px-4 py-3">{getNordFjellaNightCount(row)}</td>
              <td className="max-w-[280px] truncate px-4 py-3">{row.internal_note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <div className="p-6 text-center text-sm text-zinc-500">V období nejsou vlastní pobyty.</div> : null}
    </div>
  )
}

function GuestsReport({
  guests,
  reservations,
  legalBook,
}: {
  guests: NordFjellaStayGuestRow[]
  reservations: NordFjellaReservationRow[]
  legalBook: boolean
}) {
  const reservationMap = new Map(reservations.map((reservation) => [reservation.id, reservation]))

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-zinc-50 text-[10px] uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:bg-slate-950/35 [html[data-theme='dark']_&]:text-slate-400">
          <tr>
            <th className="px-4 py-3">Host</th>
            <th className="px-4 py-3">Pobyt</th>
            <th className="px-4 py-3">Bydliště</th>
            {legalBook ? <th className="px-4 py-3">Doklad</th> : null}
            <th className="px-4 py-3">Poplatek</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((guest) => {
            const reservation = reservationMap.get(guest.reservation_id)
            return (
              <tr key={guest.id} className="border-t border-zinc-100 [html[data-theme='dark']_&]:border-slate-400/10 [html[data-theme='dark']_&]:text-slate-200">
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="font-semibold">{guest.first_name} {guest.last_name}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">{formatDate(guest.birth_date)} · ČR</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div>{formatDate(guest.stay_start_date)} – {formatDate(guest.stay_end_date)}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">{reservation?.reservation_number ?? '—'}</div>
                </td>
                <td className="min-w-[190px] px-4 py-3">{guest.street}, {guest.postal_code} {guest.city}</td>
                {legalBook ? (
                  <td className="whitespace-nowrap px-4 py-3">
                    {guest.identity_document_type === 'id_card' ? 'OP' : guest.identity_document_type === 'passport' ? 'Pas' : 'Jiný'} · {guest.identity_document_number}
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="font-medium">{getTaxStatusLabel(guest.city_tax_status)}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">
                    {guest.city_tax_status === 'liable' ? formatCurrency(guest.city_tax_amount) : guest.city_tax_exemption_reason || '—'}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {guests.length === 0 ? <div className="p-6 text-center text-sm text-zinc-500">V období nejsou evidováni žádní hosté.</div> : null}
    </div>
  )
}
