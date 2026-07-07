import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { canViewNordFjellaSection } from '@/lib/nord-fjella/access'
import {
  buildNordFjellaSettlementSummary,
} from '@/lib/nord-fjella/settlement'
import type {
  NordFjellaGuestRow,
  NordFjellaPaymentStatus,
  NordFjellaReservationFileRow,
  NordFjellaRecordType,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaReservationStatus,
  NordFjellaSettingsRow,
  NordFjellaSettlementStatus,
} from '@/lib/nord-fjella/types'
import { NewReservationButton } from './new-reservation-button'
import NordFjellaCalendarClient, {
  type NordFjellaCalendarEvent,
} from './calendar-client'
import { ReservationDetailButton } from './reservation-detail-button'
import { SettingsButton } from './settings-button'
import { SettlementPreviewButton } from './settlement-preview-button'

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
  return Number(row.deposit_paid_amount ?? 0) + Number(row.balance_paid_amount ?? 0)
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

  const [settingsResult, reservationsResult, guestsResult, reservationItemsResult, reservationFilesResult] = await Promise.all([
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

  const settings = settingsResult.data
  const rows = (reservationsResult.data ?? []) as NordFjellaReservationRow[]
  const guests = (guestsResult.data ?? []) as NordFjellaGuestRow[]
  const reservationItems = (reservationItemsResult.data ?? []) as NordFjellaReservationItemRow[]
  const reservationFiles = (reservationFilesResult.data ?? []) as NordFjellaReservationFileRow[]
  const reservationItemsByReservationId = new Map<string, NordFjellaReservationItemRow[]>()
  const reservationFilesByReservationId = new Map<string, NordFjellaReservationFileRow[]>()

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
  const blockCount = rows.filter((row) => row.record_type !== 'reservation').length
  const activeReservedCount = rows.filter((row) => row.reservation_status === 'reserved').length
  const completedStayCount = rows.filter(
    (row) => row.record_type === 'reservation' && row.reservation_status === 'completed'
  ).length
  const cancelledReservationCount = rows.filter(
    (row) => row.record_type === 'reservation' && row.reservation_status === 'cancelled'
  ).length
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

        <section className="nord-fjella-panel relative z-30 overflow-visible rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-4">
              <div className="nord-fjella-card offers-page__stats-card offers-page__stats-card--draft rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                <div className="offers-page__stats-card-label text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  Aktivní rezervace
                </div>
                <div className="offers-page__stats-card-value mt-1 text-2xl font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                  {activeReservedCount}
                </div>
              </div>
              <div className="nord-fjella-card offers-page__stats-card offers-page__stats-card--draft rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                <div className="offers-page__stats-card-label text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  Blokace termínů
                </div>
                <div className="offers-page__stats-card-value mt-1 text-2xl font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                  {blockCount}
                </div>
              </div>
              <div className="nord-fjella-card offers-page__stats-card offers-page__stats-card--draft rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
                <div className="offers-page__stats-card-label text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  Storna
                </div>
                <div className="offers-page__stats-card-value mt-1 text-2xl font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                  {cancelledReservationCount}
                </div>
              </div>
              <div className="nord-fjella-card offers-page__stats-card offers-page__stats-card--total rounded-2xl border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(35,111,159,0.12)] [html[data-theme='dark']_&]:border-[rgba(96,165,250,0.22)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(16,49,99,0.42)_0%,rgba(18,36,73,0.34)_100%)]">
                <div className="offers-page__stats-card-label text-[11px] font-semibold uppercase tracking-[0.14em] text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">
                  Proběhlé pobyty
                </div>
                <div className="offers-page__stats-card-value mt-1 text-2xl font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                  {completedStayCount}
                </div>
              </div>
            </div>

            <form action="/nord-fjella" method="get" className="space-y-4">
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
                    className="nord-fjella-chip inline-flex h-10 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300"
                  >
                    Reset
                  </Link>
                </div>
              </div>
            </form>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 [html[data-theme='dark']_&]:text-slate-400">
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

        {rows.length === 0 ? (
          <section className="nord-fjella-panel rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
            <h2 className="text-xl font-semibold text-gray-900 [html[data-theme='dark']_&]:text-white">
              Zatím tu nejsou žádné záznamy
            </h2>
            <p className="mt-2 text-sm text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
              Jakmile založíš první pronájem nebo blokaci termínu, zobrazí se tady seznam i kalendář obsazenosti.
            </p>
          </section>
        ) : filteredRows.length === 0 ? (
          <section className="nord-fjella-panel rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
            <h2 className="text-xl font-semibold text-gray-900 [html[data-theme='dark']_&]:text-white">
              Žádný záznam neodpovídá aktuálním filtrům
            </h2>
            <p className="mt-2 text-sm text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
              Zkus upravit hledání nebo změnit vybrané stavy.
            </p>
          </section>
        ) : (
          <>
            <section className="nord-fjella-panel hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="sticky top-0 z-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(245,246,248,0.92)_100%)] shadow-sm [html[data-theme='dark']_&]:bg-[linear-gradient(180deg,rgba(18,28,46,0.98)_0%,rgba(12,20,34,0.96)_100%)]">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                      <th className="px-5 py-4">Rezervace</th>
                      <th className="px-5 py-4">Typ / stav</th>
                      <th className="px-5 py-4">Host</th>
                      <th className="px-5 py-4">Termín</th>
                      <th className="px-5 py-4">Osoby</th>
                      <th className="px-5 py-4 text-right">Cena</th>
                      <th className="px-5 py-4 text-right">Uhrazeno</th>
                      <th className="px-5 py-4">Platba</th>
                      <th className="px-5 py-4">Vyúčtování</th>
                      <th className="px-5 py-4 text-right">Akce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const rowItems = reservationItemsByReservationId.get(row.id) ?? []
                      const total = getReservationTotal(row, rowItems)
                      const paid = getPaidAmount(row)

                      return (
                        <tr
                          key={row.id}
                          id={`reservation-${row.id}`}
                          className="transition duration-200 ease-out hover:bg-white/75 [html[data-theme='dark']_&]:hover:bg-white/5"
                        >
                          <td className="px-5 py-4 align-middle">
                            <div className="whitespace-nowrap text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                              {row.reservation_number}
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle">
                            <div className="flex items-center">
                              <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${getStatusBadgeClass(row)}`}>
                                {row.record_type === 'reservation'
                                  ? getStatusLabel(row.reservation_status)
                                  : getRecordTypeLabel(row.record_type)}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle">
                            <div className="max-w-[220px] truncate whitespace-nowrap text-sm font-semibold leading-none text-zinc-900 [html[data-theme='dark']_&]:text-white">
                              {getGuestLabel(row)}
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle text-sm text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                            <div className="whitespace-nowrap leading-none">{formatDate(row.stay_start_date)} - {formatDate(row.stay_end_date)}</div>
                          </td>
                          <td className="px-5 py-4 align-middle text-sm text-zinc-700 [html[data-theme='dark']_&]:text-slate-200">
                            {row.record_type === 'reservation'
                              ? <span className="whitespace-nowrap leading-none">{`${row.adult_count} dosp. / ${row.child_count} dětí`}</span>
                              : '—'}
                          </td>
                          <td className="px-5 py-4 align-middle text-right text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                            <span className="leading-none">{row.record_type === 'reservation' ? formatCurrency(total) : '—'}</span>
                          </td>
                          <td className="px-5 py-4 align-middle text-right text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                            <span className="leading-none">{row.record_type === 'reservation' ? formatCurrency(paid) : '—'}</span>
                          </td>
                          <td className="px-5 py-4 align-middle">
                            {row.record_type === 'reservation' ? (
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 leading-none text-[11px] font-medium ${getPaymentBadgeClass(row.payment_status)}`}>
                                {getPaymentStatusLabel(row.payment_status)}
                              </span>
                            ) : (
                              <span className="text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-5 py-4 align-middle">
                            <div className="flex items-center">
                              <SettlementPreviewButton
                                reservation={row}
                                reservationItems={rowItems}
                                settings={settings}
                              />
                            </div>
                          </td>
                          <td className="px-5 py-4 align-middle text-right">
                            {isAdmin ? (
                              <div className="flex justify-end">
                                <ReservationDetailButton
                                  guests={guests}
                                  reservation={row}
                                  reservationItems={rowItems}
                                  reservationFiles={reservationFilesByReservationId.get(row.id) ?? []}
                                />
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-3 lg:hidden">
              {filteredRows.map((row) => {
                const rowItems = reservationItemsByReservationId.get(row.id) ?? []
                const total = getReservationTotal(row, rowItems)
                const paid = getPaidAmount(row)

                return (
                  <article
                    key={row.id}
                    id={`reservation-${row.id}`}
                    className="nord-fjella-card rounded-[24px] border border-white/78 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.90)_52%,rgba(242,247,252,0.86)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_24px_rgba(15,23,42,0.09)] backdrop-blur-[12px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                          {row.reservation_number}
                        </div>
                      </div>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${getStatusBadgeClass(row)}`}>
                        {row.record_type === 'reservation'
                          ? getStatusLabel(row.reservation_status)
                          : getRecordTypeLabel(row.record_type)}
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-400">
                          Host / typ
                        </div>
                        <div className="mt-1 text-sm text-zinc-900 [html[data-theme='dark']_&]:text-white">
                          {getGuestLabel(row)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-400">
                          Termín
                        </div>
                        <div className="mt-1 text-sm text-zinc-900 [html[data-theme='dark']_&]:text-white">
                          {formatDate(row.stay_start_date)} - {formatDate(row.stay_end_date)}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-400">
                            Cena
                          </div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                            {row.record_type === 'reservation' ? formatCurrency(total) : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-400">
                            Uhrazeno
                          </div>
                          <div className="mt-1 text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                            {row.record_type === 'reservation' ? formatCurrency(paid) : '—'}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {row.record_type === 'reservation' ? (
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${getPaymentBadgeClass(row.payment_status)}`}>
                            {getPaymentStatusLabel(row.payment_status)}
                          </span>
                        ) : null}
                        <SettlementPreviewButton
                          reservation={row}
                          reservationItems={rowItems}
                          settings={settings}
                        />
                      </div>

                      {isAdmin ? (
                        <div className="pt-2">
                          <ReservationDetailButton
                            guests={guests}
                            reservation={row}
                            reservationItems={rowItems}
                            reservationFiles={reservationFilesByReservationId.get(row.id) ?? []}
                          />
                        </div>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </section>
          </>
        )}

        <NordFjellaCalendarClient events={calendarEvents} />
      </div>
    </main>
  )
}
