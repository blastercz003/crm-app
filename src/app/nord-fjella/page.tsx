import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { canViewNordFjellaSection } from '@/lib/nord-fjella/access'
import {
  buildNordFjellaSettlementSummary,
  getNordFjellaNightCount,
} from '@/lib/nord-fjella/settlement'
import type {
  NordFjellaGuestRow,
  NordFjellaPaymentStatus,
  NordFjellaPaymentRow,
  NordFjellaReservationFileRow,
  NordFjellaRecordType,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaReservationStatus,
  NordFjellaSettingsRow,
  NordFjellaStayGuestRow,
  NordFjellaSettlementStatus,
} from '@/lib/nord-fjella/types'
import { NewReservationButton } from './new-reservation-button'
import NordFjellaCalendarClient, {
  type NordFjellaCalendarEvent,
} from './calendar-client'
import { ReservationDetailButton } from './reservation-detail-button'
import { SettingsButton } from './settings-button'
import { SettlementPreviewButton } from './settlement-preview-button'
import { ReportsButton } from './reports-button'

export const metadata: Metadata = {
  title: 'Nord Fjella',
}

type NordFjellaPageProps = {
  searchParams?: Promise<{
    q?: string
    status?: string
    type?: string
    payment?: string
    settlement?: string
    sort?: string
  }>
}

type ProfilePermissionRow = {
  role: string | null
  can_view_nord_fjella: boolean | null
}

type SortOption = 'start_desc' | 'start_asc' | 'created_desc' | 'updated_desc'

const STATUS_OPTIONS: Array<{
  value: NordFjellaReservationStatus
  label: string
}> = [
  { value: 'reserved', label: 'Rezervace' },
  { value: 'completed', label: 'Proběhlo' },
  { value: 'cancelled', label: 'Storno' },
]

const RECORD_TYPE_OPTIONS: Array<{
  value: NordFjellaRecordType
  label: string
}> = [
  { value: 'reservation', label: 'Pronájem' },
  { value: 'owner_block', label: 'Vlastní pobyt' },
  { value: 'technical_block', label: 'Technická blokace' },
]

const PAYMENT_STATUS_OPTIONS: Array<{
  value: NordFjellaPaymentStatus
  label: string
}> = [
  { value: 'unpaid', label: 'Nezaplaceno' },
  { value: 'deposit_paid', label: 'Záloha uhrazena' },
  { value: 'partially_paid', label: 'Částečně zaplaceno' },
  { value: 'paid', label: 'Zaplaceno' },
  { value: 'refund_or_overpayment', label: 'Vratka / přeplatek' },
]

const SETTLEMENT_STATUS_OPTIONS: Array<{
  value: NordFjellaSettlementStatus
  label: string
}> = [
  { value: 'draft', label: 'Nepřipraveno' },
  { value: 'in_progress', label: 'Rozpracováno' },
  { value: 'closed', label: 'Uzavřeno' },
]

const SORT_OPTIONS: Array<{
  value: SortOption
  label: string
}> = [
  { value: 'start_desc', label: 'Příjezd od nejnovějšího' },
  { value: 'start_asc', label: 'Příjezd od nejbližšího' },
  { value: 'created_desc', label: 'Vytvořeno od nejnovějšího' },
  { value: 'updated_desc', label: 'Upraveno od nejnovějšího' },
]

const NORD_FJELLA_LIGHT_THEME_LOGO = '/nord-fjella-logo-light.png'
const NORD_FJELLA_DARK_THEME_LOGO = '/nord-fjella-logo-dark.png'

function isReservationStatus(value: string | undefined): value is NordFjellaReservationStatus {
  return STATUS_OPTIONS.some((option) => option.value === value)
}

function isRecordType(value: string | undefined): value is NordFjellaRecordType {
  return RECORD_TYPE_OPTIONS.some((option) => option.value === value)
}

function isPaymentStatus(value: string | undefined): value is NordFjellaPaymentStatus {
  return PAYMENT_STATUS_OPTIONS.some((option) => option.value === value)
}

function isSettlementStatus(value: string | undefined): value is NordFjellaSettlementStatus {
  return SETTLEMENT_STATUS_OPTIONS.some((option) => option.value === value)
}

function isSortOption(value: string | undefined): value is SortOption {
  return SORT_OPTIONS.some((option) => option.value === value)
}

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function buildSearchText(row: NordFjellaReservationRow) {
  return normalizeSearchValue(
    [
      row.reservation_number,
      row.variable_symbol,
      row.guest_full_name,
      row.guest_company_name,
      row.guest_contact_name,
      row.guest_email,
      row.guest_phone,
      row.guest_city,
      row.internal_note,
      row.public_note,
    ]
      .filter(Boolean)
      .join(' ')
  )
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)

  if (!year || !month || !day) {
    return value
  }

  return `${day}.${month}.${year}`
}

function formatCurrency(value: number | null | undefined) {
  const parsed = Number(value ?? 0)

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(parsed)
}

function formatCompactCurrency(value: number | null | undefined) {
  const parsed = Number(value ?? 0)
  const absoluteValue = Math.abs(parsed)

  if (absoluteValue >= 1_000_000) {
    return `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(parsed / 1_000_000)} mil. Kč`
  }

  if (absoluteValue >= 1_000) {
    return `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(parsed / 1_000)} tis. Kč`
  }

  return formatCurrency(parsed)
}

function getPragueDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

function addDaysToDateString(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function getCoveredNights(
  rows: NordFjellaReservationRow[],
  rangeStart: string,
  rangeEnd: string
) {
  const nights = new Set<string>()

  for (const row of rows) {
    let cursor = row.stay_start_date > rangeStart ? row.stay_start_date : rangeStart
    const end = row.stay_end_date < rangeEnd ? row.stay_end_date : rangeEnd

    while (cursor < end) {
      nights.add(cursor)
      cursor = addDaysToDateString(cursor, 1)
    }
  }

  return nights
}

type FilterOption = {
  value: string
  label: string
}

function FilterSelect({
  label,
  name,
  defaultValue,
  options,
  className = '',
}: {
  label: string
  name: string
  defaultValue: string
  options: FilterOption[]
  className?: string
}) {
  return (
    <label className={`min-w-0 ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
        {label}
      </span>
      <span className="nord-fjella-input-shell relative block min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
        <select
          name={name}
          defaultValue={defaultValue}
          className="block h-9 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-3 pr-8 text-[13px] text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400"
        >
          ⌄
        </span>
      </span>
    </label>
  )
}

function getGuestLabel(row: NordFjellaReservationRow) {
  if (row.record_type === 'owner_block') return 'Vlastní pobyt'
  if (row.record_type === 'technical_block') return 'Technická blokace'
  if (row.guest_company_name?.trim()) return row.guest_company_name
  if (row.guest_full_name?.trim()) return row.guest_full_name
  return 'Bez hosta'
}

function getStatusLabel(status: NordFjellaReservationStatus | null) {
  switch (status) {
    case 'inquiry':
      return 'POPTÁVKA'
    case 'reserved':
      return 'REZERVACE'
    case 'completed':
      return 'PROBĚHLO'
    case 'cancelled':
      return 'STORNO'
    default:
      return '—'
  }
}

function getPaymentStatusLabel(status: NordFjellaPaymentStatus | null) {
  switch (status) {
    case 'unpaid':
      return 'Nezaplaceno'
    case 'deposit_paid':
      return 'Záloha uhrazena'
    case 'partially_paid':
      return 'Částečně zaplaceno'
    case 'paid':
      return 'Zaplaceno'
    case 'refund_or_overpayment':
      return 'Vratka / přeplatek'
    default:
      return '—'
  }
}

function getSettlementStatusLabel(status: NordFjellaSettlementStatus) {
  switch (status) {
    case 'draft':
      return 'Nepřipraveno'
    case 'in_progress':
      return 'Rozpracováno'
    case 'closed':
      return 'Uzavřeno'
    default:
      return status
  }
}

function getRecordTypeLabel(type: NordFjellaRecordType) {
  switch (type) {
    case 'reservation':
      return 'Pronájem'
    case 'owner_block':
      return 'Vlastní pobyt'
    case 'technical_block':
      return 'Technická blokace'
    default:
      return type
  }
}

function getStatusBadgeClass(row: NordFjellaReservationRow) {
  if (row.record_type === 'owner_block') {
    return 'nord-fjella-badge nord-fjella-badge--owner-block'
  }

  if (row.record_type === 'technical_block') {
    return 'nord-fjella-badge nord-fjella-badge--technical-block'
  }

  switch (row.reservation_status) {
    case 'inquiry':
      return 'nord-fjella-badge nord-fjella-badge--inquiry'
    case 'reserved':
      return 'nord-fjella-badge nord-fjella-badge--reserved'
    case 'completed':
      return 'nord-fjella-badge nord-fjella-badge--completed'
    case 'cancelled':
      return 'nord-fjella-badge nord-fjella-badge--cancelled'
    default:
      return 'nord-fjella-badge nord-fjella-badge--neutral'
  }
}

function getPaymentBadgeClass(status: NordFjellaPaymentStatus | null) {
  switch (status) {
    case 'unpaid':
      return 'nord-fjella-badge nord-fjella-badge--unpaid'
    case 'deposit_paid':
      return 'nord-fjella-badge nord-fjella-badge--deposit-paid'
    case 'partially_paid':
      return 'nord-fjella-badge nord-fjella-badge--partially-paid'
    case 'paid':
      return 'nord-fjella-badge nord-fjella-badge--paid'
    case 'refund_or_overpayment':
      return 'nord-fjella-badge nord-fjella-badge--refund'
    default:
      return 'nord-fjella-badge nord-fjella-badge--neutral'
  }
}

function getReservationTotal(
  row: NordFjellaReservationRow,
  extraItems: NordFjellaReservationItemRow[] = []
) {
  return buildNordFjellaSettlementSummary(row, extraItems).subtotalExcludingDeposit
}

function toCalendarEvent(
  row: NordFjellaReservationRow,
  extraItems: NordFjellaReservationItemRow[] = []
): NordFjellaCalendarEvent {
  const statusLabel =
    row.record_type === 'reservation'
      ? getStatusLabel(row.reservation_status)
      : getRecordTypeLabel(row.record_type)

  let backgroundColor = '#3b82f6'
  let borderColor = '#2563eb'
  let textColor = '#ffffff'

  if (row.record_type === 'owner_block') {
    backgroundColor = '#7c3aed'
    borderColor = '#6d28d9'
  } else if (row.record_type === 'technical_block') {
    backgroundColor = '#f59e0b'
    borderColor = '#d97706'
    textColor = '#111827'
  } else if (row.reservation_status === 'reserved') {
    backgroundColor = '#16a34a'
    borderColor = '#15803d'
  } else if (row.reservation_status === 'completed') {
    backgroundColor = '#71717a'
    borderColor = '#52525b'
  } else if (row.reservation_status === 'cancelled') {
    backgroundColor = '#e11d48'
    borderColor = '#be123c'
  }

  const guestLabel = getGuestLabel(row)
  const total = row.record_type === 'reservation' ? getReservationTotal(row, extraItems) : null

  return {
    id: row.id,
    title: guestLabel,
    start: row.stay_start_date,
    end: row.stay_end_date,
    allDay: true,
    display: 'block',
    backgroundColor,
    borderColor,
    textColor,
    classNames: ['nord-fjella-calendar-event'],
    extendedProps: {
      reservationNumber: row.reservation_number,
      recordTypeLabel: getRecordTypeLabel(row.record_type),
      statusLabel,
      paymentLabel: row.record_type === 'reservation' ? getPaymentStatusLabel(row.payment_status) : null,
      settlementLabel: getSettlementStatusLabel(row.settlement_status),
      guestLabel,
      amountLabel: total !== null ? formatCurrency(total) : null,
    },
  }
}

function getPaidAmount(row: NordFjellaReservationRow) {
  return (
    Number(row.deposit_paid_amount ?? 0) +
    Number(row.balance_paid_amount ?? 0) -
    Number(row.payment_refund_amount ?? 0)
  )
}

export default async function NordFjellaPage({ searchParams }: NordFjellaPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const query = resolvedSearchParams?.q?.trim() ?? ''
  const statusFilter = isReservationStatus(resolvedSearchParams?.status)
    ? resolvedSearchParams?.status
    : 'all'
  const typeFilter = isRecordType(resolvedSearchParams?.type)
    ? resolvedSearchParams?.type
    : 'all'
  const paymentFilter = isPaymentStatus(resolvedSearchParams?.payment)
    ? resolvedSearchParams?.payment
    : 'all'
  const settlementFilter = isSettlementStatus(resolvedSearchParams?.settlement)
    ? resolvedSearchParams?.settlement
    : 'all'
  const sortFilter = isSortOption(resolvedSearchParams?.sort)
    ? resolvedSearchParams?.sort
    : 'start_desc'
  const currentParams = new URLSearchParams()

  if (query) currentParams.set('q', query)
  if (statusFilter !== 'all') currentParams.set('status', statusFilter)
  if (typeFilter !== 'all') currentParams.set('type', typeFilter)
  if (paymentFilter !== 'all') currentParams.set('payment', paymentFilter)
  if (settlementFilter !== 'all') currentParams.set('settlement', settlementFilter)
  if (sortFilter !== 'start_desc') currentParams.set('sort', sortFilter)

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_nord_fjella')
    .eq('id', user.id)
    .single<ProfilePermissionRow>()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  if (!canViewNordFjellaSection(profile?.role ?? null, profile)) {
    redirect('/dashboard')
  }

  const [settingsResult, reservationsResult, guestsResult, reservationItemsResult, reservationFilesResult, stayGuestsResult, paymentsResult] = await Promise.all([
    supabase
      .from('nord_fjella_settings')
      .select('*')
      .eq('singleton_key', 'primary')
      .maybeSingle<NordFjellaSettingsRow>(),
    supabase
      .from('nord_fjella_reservations')
      .select('*')
      .order('stay_start_date', { ascending: false }),
    supabase
      .from('nord_fjella_guests')
      .select('*')
      .order('updated_at', { ascending: false }),
    supabase
      .from('nord_fjella_reservation_items')
      .select('*')
      .order('reservation_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('nord_fjella_reservation_files')
      .select('*')
      .order('reservation_id', { ascending: true })
      .order('created_at', { ascending: false }),
    supabase
      .from('nord_fjella_stay_guests')
      .select('*')
      .order('reservation_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('nord_fjella_payments')
      .select('*')
      .order('transaction_date', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (settingsResult.error) {
    throw new Error('Nepodařilo se načíst nastavení Nord Fjella.')
  }

  if (reservationsResult.error) {
    throw new Error('Nepodařilo se načíst rezervace Nord Fjella.')
  }

  if (guestsResult.error) {
    throw new Error('Nepodařilo se načíst hosty Nord Fjella.')
  }

  if (reservationItemsResult.error) {
    throw new Error('Nepodařilo se načíst doplňkové položky Nord Fjella.')
  }

  if (reservationFilesResult.error) {
    throw new Error('Nepodařilo se načíst soubory rezervací Nord Fjella.')
  }

  const stayGuestsTableMissing =
    stayGuestsResult.error?.code === '42P01' || stayGuestsResult.error?.code === 'PGRST205'

  if (stayGuestsResult.error && !stayGuestsTableMissing) {
    throw new Error('Nepodařilo se načíst evidenci ubytovaných osob.')
  }

  const paymentsTableMissing =
    paymentsResult.error?.code === '42P01' || paymentsResult.error?.code === 'PGRST205'

  if (paymentsResult.error && !paymentsTableMissing) {
    throw new Error('Nepodařilo se načíst platební knihu.')
  }

  const settings = settingsResult.data
  const rows = (reservationsResult.data ?? []) as NordFjellaReservationRow[]
  const guests = (guestsResult.data ?? []) as NordFjellaGuestRow[]
  const reservationItems = (reservationItemsResult.data ?? []) as NordFjellaReservationItemRow[]
  const reservationFiles = (reservationFilesResult.data ?? []) as NordFjellaReservationFileRow[]
  const stayGuests = (stayGuestsTableMissing ? [] : (stayGuestsResult.data ?? [])) as NordFjellaStayGuestRow[]
  const payments = (paymentsTableMissing ? [] : (paymentsResult.data ?? [])) as NordFjellaPaymentRow[]
  const reservationItemsByReservationId = new Map<string, NordFjellaReservationItemRow[]>()
  const reservationFilesByReservationId = new Map<string, NordFjellaReservationFileRow[]>()
  const stayGuestsByReservationId = new Map<string, NordFjellaStayGuestRow[]>()

  for (const item of reservationItems) {
    const currentItems = reservationItemsByReservationId.get(item.reservation_id) ?? []
    currentItems.push(item)
    reservationItemsByReservationId.set(item.reservation_id, currentItems)
  }

  for (const file of reservationFiles) {
    const currentFiles = reservationFilesByReservationId.get(file.reservation_id) ?? []
    currentFiles.push(file)
    reservationFilesByReservationId.set(file.reservation_id, currentFiles)
  }

  for (const stayGuest of stayGuests) {
    const currentGuests = stayGuestsByReservationId.get(stayGuest.reservation_id) ?? []
    currentGuests.push(stayGuest)
    stayGuestsByReservationId.set(stayGuest.reservation_id, currentGuests)
  }

  const filteredRows = rows
    .filter((row) => {
      if (query && !buildSearchText(row).includes(normalizeSearchValue(query))) {
        return false
      }

      if (statusFilter !== 'all' && row.reservation_status !== statusFilter) {
        return false
      }

      if (typeFilter !== 'all' && row.record_type !== typeFilter) {
        return false
      }

      if (paymentFilter !== 'all' && row.payment_status !== paymentFilter) {
        return false
      }

      if (settlementFilter !== 'all' && row.settlement_status !== settlementFilter) {
        return false
      }

      return true
    })
    .sort((left, right) => {
      if (sortFilter === 'start_asc') {
        return left.stay_start_date.localeCompare(right.stay_start_date)
      }

      if (sortFilter === 'created_desc') {
        return right.created_at.localeCompare(left.created_at)
      }

      if (sortFilter === 'updated_desc') {
        return right.updated_at.localeCompare(left.updated_at)
      }

      return right.stay_start_date.localeCompare(left.stay_start_date)
    })

  const calendarEvents = filteredRows.map((row) =>
    toCalendarEvent(row, reservationItemsByReservationId.get(row.id) ?? [])
  )
  const today = getPragueDateString()
  const sevenDayEnd = addDaysToDateString(today, 7)
  const thirtyDayEnd = addDaysToDateString(today, 30)
  const activeReservations = rows.filter(
    (row) =>
      row.record_type === 'reservation' &&
      row.reservation_status === 'reserved' &&
      row.stay_end_date > today
  )
  const activeBlocks = rows.filter(
    (row) =>
      row.record_type !== 'reservation' &&
      row.stay_end_date > today &&
      row.stay_start_date < thirtyDayEnd
  )
  const reservationNights = getCoveredNights(activeReservations, today, thirtyDayEnd)
  const blockNights = getCoveredNights(activeBlocks, today, thirtyDayEnd)
  const unavailableNights = new Set([...reservationNights, ...blockNights])
  const occupancyPercent = Math.min(100, Math.round((unavailableNights.size / 30) * 100))
  const todayReservation = activeReservations.find(
    (row) => row.stay_start_date <= today && row.stay_end_date > today
  )
  const todayBlock = activeBlocks.find(
    (row) => row.stay_start_date <= today && row.stay_end_date > today
  )
  const nextArrival = activeReservations
    .filter((row) => row.stay_start_date >= today)
    .sort((left, right) => left.stay_start_date.localeCompare(right.stay_start_date))[0]
  const arrivalsNextSevenDays = activeReservations.filter(
    (row) => row.stay_start_date >= today && row.stay_start_date < sevenDayEnd
  ).length
  const departuresNextSevenDays = activeReservations.filter(
    (row) => row.stay_end_date >= today && row.stay_end_date < sevenDayEnd
  ).length
  const activeFinancialSummary = activeReservations.reduce(
    (summary, row) => {
      const settlement = buildNordFjellaSettlementSummary(
        row,
        reservationItemsByReservationId.get(row.id) ?? []
      )
      const remaining = Math.max(settlement.remainingToPay, 0)
      const requestedDeposit = Number(row.requested_deposit_amount ?? 0)
      const paidDeposit = Number(row.deposit_paid_amount ?? 0)
      const overdueAmount =
        row.balance_due_date && row.balance_due_date < today && remaining > 0
          ? remaining
          : row.deposit_due_date &&
              row.deposit_due_date < today &&
              requestedDeposit > paidDeposit
            ? requestedDeposit - paidDeposit
            : 0

      return {
        contracted: summary.contracted + settlement.servicesGrossTotal,
        received: summary.received + Math.max(settlement.paidTotal, 0),
        remaining: summary.remaining + remaining,
        overdueAmount: summary.overdueAmount + overdueAmount,
        overdueCount: summary.overdueCount + (overdueAmount > 0 ? 1 : 0),
      }
    },
    { contracted: 0, received: 0, remaining: 0, overdueAmount: 0, overdueCount: 0 }
  )
  const pendingSettlementCount = rows.filter(
    (row) =>
      row.record_type === 'reservation' &&
      row.reservation_status === 'completed' &&
      row.settlement_status !== 'closed'
  ).length
  const pendingDepositRows = rows.filter((row) => {
    if (row.record_type !== 'reservation' || !row.security_deposit_received) return false

    const pendingAmount =
      Number(row.security_deposit_amount ?? 0) -
      Number(row.security_deposit_refund_amount ?? 0) -
      Number(row.security_deposit_withheld_amount ?? 0)

    return pendingAmount > 0
  })
  const pendingDepositAmount = pendingDepositRows.reduce(
    (sum, row) =>
      sum +
      Math.max(
        Number(row.security_deposit_amount ?? 0) -
          Number(row.security_deposit_refund_amount ?? 0) -
          Number(row.security_deposit_withheld_amount ?? 0),
        0
      ),
    0
  )
  const activeReservedCount = activeReservations.length
  const hasActiveFilters =
    Boolean(query) ||
    statusFilter !== 'all' ||
    typeFilter !== 'all' ||
    paymentFilter !== 'all' ||
    settlementFilter !== 'all' ||
    sortFilter !== 'start_desc'

  const objectName = settings?.object_name?.trim() || 'Nord Fjella'
  const isAdmin = profile?.role === 'admin'

  return (
    <main className="nord-fjella-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] [html[data-theme='dark']_&]:bg-[linear-gradient(160deg,#0b1220_0%,#111b2e_50%,#09111f_100%)]">
      <PresenceSectionTracker section="Nord Fjella" route="/nord-fjella" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 [html[data-theme='dark']_&]:bg-[linear-gradient(160deg,#0b1220_0%,#111b2e_50%,#09111f_100%)] [html[data-theme='dark']_&]:opacity-100"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl [html[data-theme='dark']_&]:bg-[rgba(78,160,220,0.12)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl [html[data-theme='dark']_&]:bg-[rgba(12,87,140,0.10)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="nord-fjella-panel rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="-ml-1 flex items-end gap-2">
              <div className="inline-flex h-10 items-end justify-center">
                <div className="relative h-10 w-[112px] overflow-visible">
                  <Image
                    src={NORD_FJELLA_LIGHT_THEME_LOGO}
                    alt={objectName}
                    fill
                    sizes="112px"
                    className="translate-x-[25px] scale-[1.58] object-contain object-left-bottom [html[data-theme='dark']_&]:hidden"
                    priority
                  />
                  <Image
                    src={NORD_FJELLA_DARK_THEME_LOGO}
                    alt={objectName}
                    fill
                    sizes="112px"
                    className="hidden translate-x-[25px] scale-[1.58] object-contain object-left-bottom [html[data-theme='dark']_&]:block"
                    priority
                  />
                </div>
              </div>

              <h1 className="-ml-[55px] text-3xl font-semibold leading-none tracking-tight text-gray-900 [html[data-theme='dark']_&]:text-white">
                NORD FJELLA
              </h1>
            </div>

            <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:w-auto">
              <form action="/nord-fjella" method="get" className="w-full sm:w-auto">
                <input type="hidden" name="status" value={statusFilter === 'all' ? '' : statusFilter} />
                <input type="hidden" name="type" value={typeFilter === 'all' ? '' : typeFilter} />
                <input type="hidden" name="payment" value={paymentFilter === 'all' ? '' : paymentFilter} />
                <input type="hidden" name="settlement" value={settlementFilter === 'all' ? '' : settlementFilter} />
                <input type="hidden" name="sort" value={sortFilter === 'start_desc' ? '' : sortFilter} />
                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Hledat číslo, hosta, firmu nebo kontakt"
                  className="nord-fjella-input h-11 w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-zinc-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] transition placeholder:text-zinc-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:w-[320px]"
                />
              </form>

              <Link
                href="/dashboard"
                className="offers-page__back-button clients-page__back-button nord-fjella-back-button inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                ZPĚT NA DASHBOARD
              </Link>

              {isAdmin ? <SettingsButton settings={settings} /> : null}
              {isAdmin ? <NewReservationButton guests={guests} settings={settings} /> : null}
            </div>
          </div>
        </section>

        <section className="nord-fjella-panel relative z-30 overflow-visible rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[0_20px_44px_rgba(2,8,23,0.32)]">
          <div>
            <form action="/nord-fjella" method="get" className="lg:hidden">
              <input type="hidden" name="q" value={query} />
              <details className="group w-full">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2.5 rounded-xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(242,247,252,0.88)_100%)] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-white [html[data-theme='dark']_&]:shadow-[0_8px_16px_rgba(2,8,23,0.22)]">
                  <span className="inline-flex items-center gap-2">
                    Filtry
                    {hasActiveFilters ? (
                      <span className="inline-flex items-center rounded-full border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.07em] text-[#236f9f] [html[data-theme='dark']_&]:border-[rgba(96,165,250,0.22)] [html[data-theme='dark']_&]:bg-[rgba(30,64,175,0.24)] [html[data-theme='dark']_&]:text-sky-200">
                        Filtr aktivní
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-zinc-500 transition group-open:rotate-180 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                </summary>

                <div className="mt-2 space-y-3 rounded-2xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[0_8px_18px_rgba(2,8,23,0.24)]">
                  <div className="rounded-xl border border-[#8dbfe0]/50 bg-[linear-gradient(155deg,rgba(229,244,252,0.62)_0%,rgba(204,231,247,0.42)_100%)] p-3 [html[data-theme='dark']_&]:border-[rgba(96,165,250,0.2)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(24,45,72,0.9)_0%,rgba(15,31,52,0.86)_100%)]">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                        Dnes {todayReservation ? 'obsazeno' : todayBlock ? 'blokováno' : 'volno'}
                      </span>
                      <span className="text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Obsazenost 30 dní <strong className="text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">{occupancyPercent} %</strong>
                      </span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/75 [html[data-theme='dark']_&]:bg-slate-700/80">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#4f92cb_0%,#2b679a_100%)]"
                        style={{ width: `${occupancyPercent}%` }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                      <span>{rows.length} záznamů celkem · {activeReservedCount} aktivních · {arrivalsNextSevenDays} příjezdů</span>
                      <span className="font-semibold text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">
                        K úhradě {formatCompactCurrency(activeFinancialSummary.remaining)}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Stav záznamu
                      </div>
                      <div className="nord-fjella-input-shell relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                        <select
                          name="status"
                          defaultValue={statusFilter}
                          className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                        >
                          <option value="all">Všechny</option>
                          {STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Typ záznamu
                      </div>
                      <div className="nord-fjella-input-shell relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                        <select
                          name="type"
                          defaultValue={typeFilter}
                          className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                        >
                          <option value="all">Všechny</option>
                          {RECORD_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Platební stav
                      </div>
                      <div className="nord-fjella-input-shell relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                        <select
                          name="payment"
                          defaultValue={paymentFilter}
                          className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                        >
                          <option value="all">Všechny</option>
                          {PAYMENT_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Vyúčtování
                      </div>
                      <div className="nord-fjella-input-shell relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                        <select
                          name="settlement"
                          defaultValue={settlementFilter}
                          className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                        >
                          <option value="all">Všechny</option>
                          {SETTLEMENT_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Řazení
                      </div>
                      <div className="nord-fjella-input-shell relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                        <select
                          name="sort"
                          defaultValue={sortFilter}
                          className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                        >
                          {SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-t border-gray-100 pt-3 [html[data-theme='dark']_&]:border-white/10">
                    <button
                      type="submit"
                      className="offers-page__filter-submit inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
                    >
                      Použít filtry
                    </button>
                    <Link
                      href="/nord-fjella"
                      className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:shadow-[0_8px_18px_rgba(2,8,23,0.22)]"
                    >
                      Reset
                    </Link>
                  </div>
                </div>
              </details>
            </form>

            <div className="hidden min-w-0 gap-5 lg:grid lg:grid-cols-[minmax(0,1.45fr)_minmax(380px,0.85fr)]">
              <form action="/nord-fjella" method="get" className="min-w-0">
                <input type="hidden" name="q" value={query} />

                <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
                  <FilterSelect
                    label="Stav záznamu"
                    name="status"
                    defaultValue={statusFilter}
                    options={[{ value: 'all', label: 'Všechny' }, ...STATUS_OPTIONS]}
                  />
                  <FilterSelect
                    label="Typ záznamu"
                    name="type"
                    defaultValue={typeFilter}
                    options={[{ value: 'all', label: 'Všechny' }, ...RECORD_TYPE_OPTIONS]}
                  />
                  <FilterSelect
                    label="Platební stav"
                    name="payment"
                    defaultValue={paymentFilter}
                    options={[{ value: 'all', label: 'Všechny' }, ...PAYMENT_STATUS_OPTIONS]}
                  />
                  <FilterSelect
                    label="Vyúčtování"
                    name="settlement"
                    defaultValue={settlementFilter}
                    options={[{ value: 'all', label: 'Všechny' }, ...SETTLEMENT_STATUS_OPTIONS]}
                  />
                </div>

                <div className="mt-3 flex min-w-0 flex-wrap items-end gap-2">
                  <FilterSelect
                    label="Řazení"
                    name="sort"
                    defaultValue={sortFilter}
                    options={SORT_OPTIONS}
                    className="w-full min-w-[210px] flex-1 xl:max-w-[270px]"
                  />
                  <button
                    type="submit"
                    className="offers-page__filter-submit inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-xs font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_18px_rgba(24,24,27,0.22)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
                  >
                    Použít
                  </button>
                  <Link
                    href="/nord-fjella"
                    className="nord-fjella-chip inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-xs font-medium uppercase tracking-[0.04em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300"
                  >
                    Reset
                  </Link>
                  <span className="ml-auto inline-flex h-9 items-center whitespace-nowrap text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    Zobrazeno&nbsp;
                    <strong className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                      {filteredRows.length}
                    </strong>
                    &nbsp;z&nbsp;{rows.length}
                  </span>
                </div>
              </form>

              <aside className="min-w-0 border-l border-zinc-200/75 pl-5 [html[data-theme='dark']_&]:border-slate-400/12">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    Provozní souhrn
                  </div>
                  <div className="flex min-w-0 items-center gap-2 text-xs">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        todayReservation
                          ? 'bg-[#16a34a]'
                          : todayBlock
                            ? 'bg-[#f59e0b]'
                            : 'bg-[#2980b9]'
                      }`}
                    />
                    <span className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                      Dnes {todayReservation ? 'obsazeno' : todayBlock ? 'blokováno' : 'volno'}
                    </span>
                    <span className="truncate text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                      · další příjezd {nextArrival ? formatDate(nextArrival.stay_start_date) : '—'}
                    </span>
                  </div>
                </div>

                <div className="mt-2">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[11px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Obsazenost následujících 30 dní
                      </div>
                      <div className="mt-0.5 text-xl font-semibold tracking-tight text-zinc-900 [html[data-theme='dark']_&]:text-white">
                        {occupancyPercent} %
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                      {reservationNights.size} nocí rezervace · {blockNights.size} nocí blokace
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200/80 [html[data-theme='dark']_&]:bg-slate-700/80">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#4f92cb_0%,#2b679a_100%)]"
                      style={{ width: `${occupancyPercent}%` }}
                    />
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-3 border-y border-zinc-200/70 py-1.5 [html[data-theme='dark']_&]:border-slate-400/10">
                  <div>
                    <div className="truncate text-[10px] uppercase tracking-[0.1em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
                      Nasmlouváno
                    </div>
                    <div className="mt-0.5 truncate text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                      {formatCompactCurrency(activeFinancialSummary.contracted)}
                    </div>
                  </div>
                  <div>
                    <div className="truncate text-[10px] uppercase tracking-[0.1em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
                      Přijato
                    </div>
                    <div className="mt-0.5 truncate text-sm font-semibold text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">
                      {formatCompactCurrency(activeFinancialSummary.received)}
                    </div>
                  </div>
                  <div>
                    <div className="truncate text-[10px] uppercase tracking-[0.1em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
                      K inkasu
                    </div>
                    <div
                      className={`mt-0.5 truncate text-sm font-semibold ${
                        activeFinancialSummary.remaining > 0
                          ? 'text-[#236f9f] [html[data-theme=\'dark\']_&]:text-sky-200'
                          : 'text-zinc-900 [html[data-theme=\'dark\']_&]:text-white'
                      }`}
                    >
                      {formatCompactCurrency(activeFinancialSummary.remaining)}
                    </div>
                  </div>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                  <span><strong className="text-zinc-900 [html[data-theme='dark']_&]:text-white">{rows.length}</strong> záznamů celkem</span>
                  <span><strong className="text-zinc-900 [html[data-theme='dark']_&]:text-white">{activeReservedCount}</strong> aktivních</span>
                  <span><strong className="text-zinc-900 [html[data-theme='dark']_&]:text-white">{arrivalsNextSevenDays}</strong> příjezdů / 7 dní</span>
                  <span><strong className="text-zinc-900 [html[data-theme='dark']_&]:text-white">{departuresNextSevenDays}</strong> odjezdů</span>
                  <span><strong className="text-zinc-900 [html[data-theme='dark']_&]:text-white">{pendingSettlementCount}</strong> vyúčtování</span>
                  <span className={activeFinancialSummary.overdueCount > 0 ? 'text-amber-700 [html[data-theme=\'dark\']_&]:text-amber-200' : undefined}>
                    <strong>{activeFinancialSummary.overdueCount}</strong> po splatnosti · {formatCompactCurrency(activeFinancialSummary.overdueAmount)}
                  </span>
                  <span title={formatCurrency(pendingDepositAmount)}>
                    <strong className="text-zinc-900 [html[data-theme='dark']_&]:text-white">{pendingDepositRows.length}</strong> kaucí · {formatCompactCurrency(pendingDepositAmount)}
                  </span>
                </div>

              </aside>
            </div>

            <form action="/nord-fjella" method="get" className="hidden">
              <div className="grid gap-4 lg:grid-cols-[220px_220px_240px_220px_auto] lg:items-end">
                <div>
                  <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    Stav záznamu
                  </div>
                  <div className="nord-fjella-input-shell relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                    <select
                      name="status"
                      defaultValue={statusFilter}
                      className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                    >
                      <option value="all">Všechny</option>
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                  </div>
                </div>

                <div>
                  <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    Typ záznamu
                  </div>
                  <div className="nord-fjella-input-shell relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                    <select
                      name="type"
                      defaultValue={typeFilter}
                      className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                    >
                      <option value="all">Všechny</option>
                      {RECORD_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                  </div>
                </div>

                <div>
                  <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    Platební stav
                  </div>
                  <div className="nord-fjella-input-shell relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                    <select
                      name="payment"
                      defaultValue={paymentFilter}
                      className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                    >
                      <option value="all">Všechny</option>
                      {PAYMENT_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                  </div>
                </div>

                <div>
                  <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    Vyúčtování
                  </div>
                  <div className="nord-fjella-input-shell relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                    <select
                      name="settlement"
                      defaultValue={settlementFilter}
                      className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                    >
                      <option value="all">Všechny</option>
                      {SETTLEMENT_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                  </div>
                </div>

                <div className="flex gap-2 lg:justify-end">
                  <input type="hidden" name="q" value={query} />
                  <div className="nord-fjella-input-shell relative min-w-[220px] overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                    <select
                      name="sort"
                      defaultValue={sortFilter}
                      className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-slate-200"
                    >
                      {SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                  </div>
                  <button
                    type="submit"
                    className="offers-page__filter-submit inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
                  >
                    Použít
                  </button>
                  <Link
                    href="/nord-fjella"
                    className="nord-fjella-chip inline-flex h-10 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:shadow-[0_8px_18px_rgba(2,8,23,0.22)]"
                  >
                    Reset
                  </Link>
                </div>
              </div>
            </form>

            <div className="hidden">
              {query ? (
                <span className="nord-fjella-chip inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                  Hledání: <span className="ml-1 font-medium">{query}</span>
                </span>
              ) : null}
              {hasActiveFilters ? (
                <span className="nord-fjella-chip inline-flex items-center rounded-full border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] px-2.5 py-1 font-semibold text-[#236f9f] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(96,165,250,0.22)] [html[data-theme='dark']_&]:bg-[rgba(30,64,175,0.24)] [html[data-theme='dark']_&]:text-sky-200">
                  Filtr aktivní
                </span>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <section className="nord-fjella-panel flex min-w-0 flex-col overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
            <div className="flex min-h-[81px] items-center justify-between gap-3 border-b border-zinc-100/90 px-4 py-4 sm:px-5 [html[data-theme='dark']_&]:border-slate-400/10">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 sm:text-xl [html[data-theme='dark']_&]:text-white">
                  Rezervace
                </h2>
                <p className="mt-1 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  Přehled pronájmů a blokací termínu
                </p>
              </div>
              <ReportsButton
                reservations={rows}
                reservationItems={reservationItems}
                stayGuests={stayGuests}
                payments={payments}
              />
            </div>

            {rows.length === 0 ? (
              <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center px-6 py-10 text-center xl:min-h-[560px]">
                <h3 className="text-xl font-semibold text-gray-900 [html[data-theme='dark']_&]:text-white">
                  Zatím tu nejsou žádné záznamy
                </h3>
                <p className="mt-2 max-w-md text-sm text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                  Jakmile založíš první pronájem nebo blokaci termínu, zobrazí se tady přehled.
                </p>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center px-6 py-10 text-center xl:min-h-[560px]">
                <h3 className="text-xl font-semibold text-gray-900 [html[data-theme='dark']_&]:text-white">
                  Žádný záznam neodpovídá filtrům
                </h3>
                <p className="mt-2 max-w-md text-sm text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                  Zkus upravit hledání nebo změnit vybrané stavy.
                </p>
              </div>
            ) : (
              <div className="grid min-w-0 max-h-[760px] gap-2 overflow-y-auto p-4 sm:p-5 xl:max-h-[680px]">
                {filteredRows.map((row) => {
                  const rowItems = reservationItemsByReservationId.get(row.id) ?? []
                  const rowStayGuests = stayGuestsByReservationId.get(row.id) ?? []
                  const total = getReservationTotal(row, rowItems)
                  const paid = getPaidAmount(row)
                  const remaining = Math.max(total - paid, 0)
                  const nights = getNordFjellaNightCount(row)

                  return (
                    <article
                      key={row.id}
                      id={`reservation-${row.id}`}
                      className="nord-fjella-card min-w-0 w-full rounded-[20px] border border-white/78 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.90)_52%,rgba(242,247,252,0.86)_100%)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_20px_rgba(15,23,42,0.08)] backdrop-blur-[12px] transition duration-200 ease-out hover:-translate-y-[1px] sm:px-4 sm:py-3 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap">
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-400">
                            {row.reservation_number}
                          </span>
                          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                            {getGuestLabel(row)}
                          </h3>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <SettlementPreviewButton
                            reservation={row}
                            reservationItems={rowItems}
                            settings={settings}
                            compact
                          />
                          {isAdmin ? (
                            <ReservationDetailButton
                              guests={guests}
                              reservation={row}
                              reservationItems={rowItems}
                              reservationFiles={reservationFilesByReservationId.get(row.id) ?? []}
                              stayGuests={stayGuestsByReservationId.get(row.id) ?? []}
                              compact
                            />
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-zinc-200/70 pt-2 text-[11px] text-zinc-600 [html[data-theme='dark']_&]:border-slate-400/10 [html[data-theme='dark']_&]:text-slate-300">
                        <div className="min-w-0 flex-1 truncate whitespace-nowrap">
                          <span>{formatDate(row.stay_start_date)} – {formatDate(row.stay_end_date)}</span>
                          <span className="mx-1.5 text-zinc-300 [html[data-theme='dark']_&]:text-slate-600">•</span>
                          <span>{nights} nocí</span>
                          {row.record_type === 'reservation' ? (
                            <>
                              <span className="mx-1.5 text-zinc-300 [html[data-theme='dark']_&]:text-slate-600">•</span>
                              <span>{row.adult_count} dosp. / {row.child_count} dětí</span>
                              <span className="mx-1.5 text-zinc-300 [html[data-theme='dark']_&]:text-slate-600">•</span>
                              <span
                                className={
                                  rowStayGuests.length === row.adult_count + row.child_count
                                    ? 'text-emerald-700 [html[data-theme=\'dark\']_&]:text-emerald-300'
                                    : 'font-medium text-amber-700 [html[data-theme=\'dark\']_&]:text-amber-300'
                                }
                              >
                                evidence {rowStayGuests.length}/{row.adult_count + row.child_count}
                              </span>
                              <span className="mx-1.5 text-zinc-300 [html[data-theme='dark']_&]:text-slate-600">•</span>
                              <span className="font-medium text-zinc-900 [html[data-theme='dark']_&]:text-white">
                                {formatCurrency(total)}
                              </span>
                              <span className="mx-1.5 text-zinc-300 [html[data-theme='dark']_&]:text-slate-600">•</span>
                              <span className="font-semibold text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">
                                zbývá {formatCurrency(remaining)}
                              </span>
                            </>
                          ) : null}
                        </div>

                        <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.05em] ${getStatusBadgeClass(row)}`}>
                          {row.record_type === 'reservation'
                            ? getStatusLabel(row.reservation_status)
                            : getRecordTypeLabel(row.record_type)}
                        </span>
                        {row.record_type === 'reservation' ? (
                          <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[10px] font-medium ${getPaymentBadgeClass(row.payment_status)}`}>
                            {getPaymentStatusLabel(row.payment_status)}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <NordFjellaCalendarClient events={calendarEvents} />
        </div>
      </div>
    </main>
  )
}
