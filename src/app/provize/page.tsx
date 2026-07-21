import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SafeRealtimeRefresh } from '@/components/realtime/safe-realtime-refresh'
import {
  canViewProvizeSection,
  resolveProvizeSalesOwnerName,
  type ProvizeSalesOwner,
} from '@/lib/provize/access'
import {
  getCommissionRateForSalesOwner,
  getEffectiveProfitAmount,
  roundCommissionAmount,
  syncProvizeRecordsFromJobFinances,
  type ProvizeRecordRow,
} from '@/lib/provize/service'
import { ProvizeHistoryModalLauncher } from './provize-history-modal'
import { ProvizePayoutModalLauncher } from './provize-payout-modal'
import { ProvizeInteractiveTable } from './provize-interactive-table'

export const metadata: Metadata = {
  title: 'Provize',
}

type ProvizeProfileRow = {
  role: string | null
  name: string | null
  can_view_provize: boolean | null
}

type PaidBatchItemStatsRow = {
  sales_owner: ProvizeSalesOwner
  commission_amount: number
  batch:
    | {
        confirmed_at: string | null
      }
    | {
        confirmed_at: string | null
      }[]
    | null
}

type ProvizeSearchParams = {
  q?: string
  sales?: string
  payout?: string
  approval?: string
  year_scope?: string
  sort?: string
  date_from?: string
  date_to?: string
}

export type ProvizeRow = {
  id: string
  jobNumber: string
  salesOwner: ProvizeSalesOwner
  companyName: string
  startAt: string
  endAt: string
  startLabel: string
  endLabel: string
  siteAddress: string | null
  storeNumber: string | null
  invoiceNumber: string
  saleAmount: number
  saleAmountLabel: string
  profitAmount: number
  profitAmountLabel: string
  commissionAmount: number
  commissionAmountLabel: string
  approvedForPayout: boolean
  isPaid: boolean
}

const SALES_OWNER_OPTIONS: ProvizeSalesOwner[] = ['MICHAL', 'LÍDA']

type SortMode = 'job_number_desc' | 'start_nearest' | 'profit_desc' | 'commission_desc'
type PayoutFilter = 'unpaid' | 'paid' | 'all'
type ApprovalFilter = 'approved' | 'not_approved' | 'all'
type YearScope = 'year' | 'all'

function isSortMode(value: string | undefined): value is SortMode {
  return (
    value === 'job_number_desc' ||
    value === 'start_nearest' ||
    value === 'profit_desc' ||
    value === 'commission_desc'
  )
}

function isPayoutFilter(value: string | undefined): value is PayoutFilter {
  return value === 'unpaid' || value === 'paid' || value === 'all'
}

function isApprovalFilter(value: string | undefined): value is ApprovalFilter {
  return value === 'approved' || value === 'not_approved' || value === 'all'
}

function isYearScope(value: string | undefined): value is YearScope {
  return value === 'year' || value === 'all'
}

function isSalesOwner(value: string | undefined): value is ProvizeSalesOwner {
  return SALES_OWNER_OPTIONS.includes(value as ProvizeSalesOwner)
}

function sanitizeSearchTerm(search: string) {
  return search.replaceAll(',', ' ').trim()
}

function buildProvizeSearchFilter(search: string) {
  const escaped = sanitizeSearchTerm(search)

  return [
    `job_number.ilike.%${escaped}%`,
    `company_name.ilike.%${escaped}%`,
    `invoice_number.ilike.%${escaped}%`,
    `site_address.ilike.%${escaped}%`,
    `store_number.ilike.%${escaped}%`,
  ].join(',')
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)
}

function buildProvizeHref(params: {
  query: string
  salesOwner: string
  payoutFilter: PayoutFilter
  approvalFilter: ApprovalFilter
  yearScope: YearScope
  sort: SortMode
  dateFrom: string
  dateTo: string
}) {
  const searchParams = new URLSearchParams()

  if (params.query) {
    searchParams.set('q', params.query)
  }

  if (params.salesOwner) {
    searchParams.set('sales', params.salesOwner)
  }

  if (params.payoutFilter !== 'unpaid') {
    searchParams.set('payout', params.payoutFilter)
  }

  if (params.approvalFilter !== 'all') {
    searchParams.set('approval', params.approvalFilter)
  }

  if (params.yearScope !== 'year') {
    searchParams.set('year_scope', params.yearScope)
  }

  if (params.sort !== 'job_number_desc') {
    searchParams.set('sort', params.sort)
  }

  if (params.dateFrom) {
    searchParams.set('date_from', params.dateFrom)
  }

  if (params.dateTo) {
    searchParams.set('date_to', params.dateTo)
  }

  const search = searchParams.toString()
  return search ? `/provize?${search}` : '/provize'
}

function getSearchSummary({
  salesOwner,
  payoutFilter,
  approvalFilter,
  yearScope,
  sort,
  dateFrom,
  dateTo,
  query,
}: {
  salesOwner: string
  payoutFilter: PayoutFilter
  approvalFilter: ApprovalFilter
  yearScope: YearScope
  sort: SortMode
  dateFrom: string
  dateTo: string
  query: string
}) {
  return [
    salesOwner || null,
    payoutFilter === 'unpaid'
      ? 'nevyplacené'
      : payoutFilter === 'paid'
        ? 'vyplacené'
        : null,
    approvalFilter === 'approved'
      ? 'k vyplacení ano'
      : approvalFilter === 'not_approved'
        ? 'k vyplacení ne'
        : null,
    yearScope === 'year' ? 'aktuální rok' : 'celá historie',
    sort === 'job_number_desc'
      ? 'řazení: číslo zakázky'
      : sort === 'start_nearest'
        ? 'řazení: datum'
        : sort === 'profit_desc'
          ? 'řazení: zisk'
          : 'řazení: provize',
    dateFrom ? `od ${dateFrom}` : null,
    dateTo ? `do ${dateTo}` : null,
    query || null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function getJobNumberSortValue(jobNumber: string) {
  const digits = String(jobNumber ?? '').match(/\d+/g)?.join('') ?? ''
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : -1
}

function compareByJobNumberDesc(a: ProvizeRow, b: ProvizeRow) {
  const aValue = getJobNumberSortValue(a.jobNumber)
  const bValue = getJobNumberSortValue(b.jobNumber)

  if (bValue !== aValue) {
    return bValue - aValue
  }

  return String(b.jobNumber).localeCompare(String(a.jobNumber), 'cs')
}

function mapProvizeRecordToRow(record: ProvizeRecordRow): ProvizeRow {
  const profitAmount = getEffectiveProfitAmount(record)
  const commissionRate = getCommissionRateForSalesOwner(record.sales_owner)

  return {
    id: record.id,
    jobNumber: record.job_number,
    salesOwner: record.sales_owner,
    companyName: record.company_name,
    startAt: record.start_at,
    endAt: record.end_at,
    startLabel: formatDateTime(record.start_at),
    endLabel: formatDateTime(record.end_at),
    siteAddress: record.site_address,
    storeNumber: record.store_number,
    invoiceNumber: record.invoice_number,
    saleAmount: record.sale_amount,
    saleAmountLabel: formatCurrency(record.sale_amount),
    profitAmount,
    profitAmountLabel: formatCurrency(profitAmount),
    commissionAmount: roundCommissionAmount(profitAmount * commissionRate),
    commissionAmountLabel: formatCurrency(
      roundCommissionAmount(profitAmount * commissionRate)
    ),
    approvedForPayout: record.approved_for_payout,
    isPaid: Boolean(record.confirmed_batch_id),
  }
}

function getPragueCurrentYear() {
  return Number(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
    }).format(new Date())
  )
}

export default async function ProvizePage({
  searchParams,
}: {
  searchParams?: Promise<ProvizeSearchParams>
}) {
  const supabase = await createClient()
  const params = searchParams ? await searchParams : undefined

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, name, can_view_provize')
    .eq('id', user.id)
    .single<ProvizeProfileRow>()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění pro sekci Provize.')
  }

  if (!canViewProvizeSection(profile?.role ?? null, profile)) {
    redirect('/dashboard')
  }

  const isAdmin = profile?.role === 'admin'
  const currentSalesOwner = resolveProvizeSalesOwnerName(profile?.name ?? null)

  if (isAdmin) {
    try {
      await syncProvizeRecordsFromJobFinances()
    } catch (error) {
      console.error('Provize sync failed:', error)
    }
  }

  const query = params?.q?.trim() ?? ''
  const sort = isSortMode(params?.sort) ? params?.sort : 'job_number_desc'
  const payoutFilter = isPayoutFilter(params?.payout) ? params?.payout : 'unpaid'
  const requestedApprovalFilter = isApprovalFilter(params?.approval)
    ? params?.approval
    : 'all'
  const yearScope = isYearScope(params?.year_scope) ? params?.year_scope : 'year'
  const dateFrom = params?.date_from?.trim() ?? ''
  const dateTo = params?.date_to?.trim() ?? ''
  const requestedSalesOwner = isSalesOwner(params?.sales) ? params?.sales : ''
  const salesOwner = isAdmin ? requestedSalesOwner : currentSalesOwner ?? ''
  const approvalFilter = isAdmin ? requestedApprovalFilter : 'approved'

  let recordsRequest = supabase
    .from('provize_records')
    .select(
      'id, job_finance_id, job_id, sales_owner, job_number, company_name, start_at, end_at, site_address, store_number, invoice_number, sale_amount, cost_amount, base_profit_amount, manual_profit_amount, approved_for_payout, approved_for_payout_at, current_draft_batch_id, confirmed_batch_id, created_at, updated_at'
    )

  if (salesOwner) {
    recordsRequest = recordsRequest.eq('sales_owner', salesOwner)
  }

  if (payoutFilter === 'unpaid') {
    recordsRequest = recordsRequest.is('confirmed_batch_id', null)
  } else if (payoutFilter === 'paid') {
    recordsRequest = recordsRequest.not('confirmed_batch_id', 'is', null)
  }

  if (approvalFilter === 'approved') {
    recordsRequest = recordsRequest.eq('approved_for_payout', true)
  } else if (approvalFilter === 'not_approved') {
    recordsRequest = recordsRequest.eq('approved_for_payout', false)
  }

  if (dateFrom) {
    recordsRequest = recordsRequest.gte('start_at', `${dateFrom}T00:00:00`)
  }

  if (dateTo) {
    recordsRequest = recordsRequest.lte('start_at', `${dateTo}T23:59:59`)
  }

  if (query) {
    recordsRequest = recordsRequest.or(buildProvizeSearchFilter(query))
  }

  const { data: recordsData, error: recordsError } = await recordsRequest

  if (recordsError) {
    throw new Error('Nepodařilo se načíst provizní záznamy.')
  }

  let rows = ((recordsData ?? []) as ProvizeRecordRow[]).map(mapProvizeRecordToRow)

  if (sort === 'start_nearest') {
    rows = [...rows].sort((a, b) => {
      const dateDiff = new Date(b.startAt).getTime() - new Date(a.startAt).getTime()

      if (dateDiff !== 0) {
        return dateDiff
      }

      return compareByJobNumberDesc(a, b)
    })
  } else if (sort === 'profit_desc') {
    rows = [...rows].sort((a, b) => {
      if (b.profitAmount !== a.profitAmount) {
        return b.profitAmount - a.profitAmount
      }

      return compareByJobNumberDesc(a, b)
    })
  } else if (sort === 'commission_desc') {
    rows = [...rows].sort((a, b) => {
      if (b.commissionAmount !== a.commissionAmount) {
        return b.commissionAmount - a.commissionAmount
      }

      return compareByJobNumberDesc(a, b)
    })
  } else {
    rows = [...rows].sort(compareByJobNumberDesc)
  }

  let unpaidStatsRequest = supabase
    .from('provize_records')
    .select(
      'sales_owner, base_profit_amount, manual_profit_amount, confirmed_batch_id, approved_for_payout'
    )
    .is('confirmed_batch_id', null)

  if (!isAdmin && currentSalesOwner) {
    unpaidStatsRequest = unpaidStatsRequest
      .eq('sales_owner', currentSalesOwner)
      .eq('approved_for_payout', true)
  }

  const { data: unpaidStatsData, error: unpaidStatsError } =
    await unpaidStatsRequest

  if (unpaidStatsError) {
    throw new Error('Nepodařilo se načíst souhrn nevyplacených provizí.')
  }

  let paidStatsRequest = supabase
    .from('provize_payout_batch_items')
    .select(
      `
        sales_owner,
        commission_amount,
        batch:provize_payout_batches!inner (
          confirmed_at
        )
      `
    )

  if (!isAdmin && currentSalesOwner) {
    paidStatsRequest = paidStatsRequest.eq('sales_owner', currentSalesOwner)
  }

  const { data: paidStatsData, error: paidStatsError } = await paidStatsRequest

  if (paidStatsError) {
    throw new Error('Nepodařilo se načíst souhrn vyplacených provizí.')
  }

  const currentYear = getPragueCurrentYear()
  const unpaidCommissionByOwner = new Map<ProvizeSalesOwner, number>(
    SALES_OWNER_OPTIONS.map((owner) => [owner, 0])
  )

  for (const item of (unpaidStatsData ?? []) as Array<
    Pick<
      ProvizeRecordRow,
      | 'sales_owner'
      | 'base_profit_amount'
      | 'manual_profit_amount'
      | 'confirmed_batch_id'
      | 'approved_for_payout'
    >
  >) {
    const profitAmount = getEffectiveProfitAmount(item)
    const commissionRate = getCommissionRateForSalesOwner(item.sales_owner)
    unpaidCommissionByOwner.set(
      item.sales_owner,
      (unpaidCommissionByOwner.get(item.sales_owner) ?? 0) +
        roundCommissionAmount(profitAmount * commissionRate)
    )
  }

  const paidCommissionByOwner = new Map<ProvizeSalesOwner, number>(
    SALES_OWNER_OPTIONS.map((owner) => [owner, 0])
  )

  for (const item of (paidStatsData ?? []) as PaidBatchItemStatsRow[]) {
    const batch = Array.isArray(item.batch) ? item.batch[0] : item.batch

    if (!batch?.confirmed_at) continue

    const confirmedYear = new Date(batch.confirmed_at).getFullYear()

    if (yearScope === 'year' && confirmedYear !== currentYear) {
      continue
    }

    paidCommissionByOwner.set(
      item.sales_owner,
      (paidCommissionByOwner.get(item.sales_owner) ?? 0) +
        item.commission_amount
    )
  }

  const activeFilterSummary = getSearchSummary({
    salesOwner,
    payoutFilter,
    approvalFilter,
    yearScope,
    sort,
    dateFrom,
    dateTo,
    query,
  })
  const canShowHistoryButton = isAdmin || Boolean(currentSalesOwner)
  const hasActiveFilters = Boolean(
    query ||
      salesOwner ||
      payoutFilter !== 'unpaid' ||
      approvalFilter !== 'all' ||
      yearScope !== 'year' ||
      dateFrom ||
      dateTo ||
      sort !== 'job_number_desc'
  )
  const yearHref = buildProvizeHref({
    query,
    salesOwner,
    payoutFilter,
    approvalFilter,
    yearScope: 'year',
    sort,
    dateFrom,
    dateTo,
  })
  const allTimeHref = buildProvizeHref({
    query,
    salesOwner,
    payoutFilter,
    approvalFilter,
    yearScope: 'all',
    sort,
    dateFrom,
    dateTo,
  })

  return (
    <main className="jobs-page provize-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <SafeRealtimeRefresh scopes={['finances', 'jobs', 'provize']} />
      <div
        aria-hidden
        className="jobs-page__glow--right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="jobs-page__glow--left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="jobs-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Provize
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form
                action="/provize"
                method="get"
                className="flex w-full gap-3 sm:w-auto"
              >
                {isAdmin ? <input type="hidden" name="sales" value={salesOwner} /> : null}
                <input type="hidden" name="sort" value={sort} />
                <input type="hidden" name="payout" value={payoutFilter} />
                <input type="hidden" name="approval" value={approvalFilter} />
                <input type="hidden" name="year_scope" value={yearScope} />
                <input type="hidden" name="date_from" value={dateFrom} />
                <input type="hidden" name="date_to" value={dateTo} />

                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Hledat zakázku, firmu, fakturu, adresu, prodejnu"
                  className="jobs-page__search-input w-full min-w-0 rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:w-56 lg:w-72"
                />

                <button
                  type="submit"
                  className="clients-page__search-button jobs-page__search-button rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="jobs-page__back-button inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                ZPĚT NA DASHBOARD
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <section className="jobs-page__filters-shell provize-page__filter-shell rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.02),0_20px_44px_rgba(0,0,0,0.24)]">
            <details id="provize-mobile-filters" className="group mb-2 lg:hidden">
              <summary className="jobs-page__filters-summary flex h-10 cursor-pointer list-none items-center justify-between gap-2.5 rounded-xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(242,247,252,0.88)_100%)] px-3 text-[12px] font-semibold uppercase tracking-[0.07em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
                <span className="inline-flex items-center gap-2">
                  FILTRY
                  {hasActiveFilters ? (
                    <span className="inline-flex items-center rounded-full border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.07em] text-[#236f9f]">
                      AKTIVNÍ
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-zinc-500 transition group-open:rotate-180">⌄</span>
              </summary>

              <form
                action="/provize"
                method="get"
                className="mt-2 space-y-3 rounded-2xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]"
              >
                <input type="hidden" name="q" value={query} />

                <div className="grid gap-3 sm:grid-cols-2">
                  {isAdmin ? (
                    <FilterSelect
                      id="sales-mobile"
                      name="sales"
                      label="Obchodník"
                      defaultValue={salesOwner}
                      options={[
                        { value: '', label: 'Všichni' },
                        ...SALES_OWNER_OPTIONS.map((owner) => ({ value: owner, label: owner })),
                      ]}
                    />
                  ) : null}

                  <FilterSelect
                    id="payout-mobile"
                    name="payout"
                    label="Vyplaceno"
                    defaultValue={payoutFilter}
                    options={[
                      { value: 'unpaid', label: 'Nevyplacené' },
                      { value: 'paid', label: 'Vyplacené' },
                      { value: 'all', label: 'Vše' },
                    ]}
                  />

                  {isAdmin ? (
                    <FilterSelect
                      id="approval-mobile"
                      name="approval"
                      label="K vyplacení"
                      defaultValue={approvalFilter}
                      options={[
                        { value: 'all', label: 'Vše' },
                        { value: 'approved', label: 'Ano' },
                        { value: 'not_approved', label: 'Ne' },
                      ]}
                    />
                  ) : null}

                  <FilterSelect
                    id="sort-mobile"
                    name="sort"
                    label="Řazení"
                    defaultValue={sort}
                    options={[
                      { value: 'job_number_desc', label: 'Dle čísla zakázky' },
                      { value: 'start_nearest', label: 'Dle data realizace' },
                      { value: 'profit_desc', label: 'Dle zisku' },
                      { value: 'commission_desc', label: 'Dle provize' },
                    ]}
                  />

                  <FilterSelect
                    id="year-scope-mobile"
                    name="year_scope"
                    label="Období statistik"
                    defaultValue={yearScope}
                    options={[
                      { value: 'year', label: 'Aktuální rok' },
                      { value: 'all', label: 'Celkem' },
                    ]}
                  />

                </div>

                <div className="provize-page__filter-divider flex items-center gap-2 border-t border-gray-100 pt-3 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
                  <button
                    type="submit"
                    className="jobs-page__filter-submit inline-flex h-10 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
                  >
                    POUŽÍT FILTRY
                  </button>

                  <Link
                    href="/provize"
                    className="jobs-page__filter-reset inline-flex h-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                  >
                    RESET
                  </Link>
                </div>

                <div className="provize-page__filter-divider border-t border-gray-100 pt-3 text-[11px] text-gray-500 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:text-slate-400">
                  Aktivní:{' '}
                  <span className="font-medium text-gray-700 [html[data-theme='dark']_&]:text-slate-300">
                    {activeFilterSummary || 'bez omezení'}
                  </span>
                </div>
              </form>
            </details>

            <form action="/provize" method="get" className="space-y-4">
              <input type="hidden" name="q" value={query} />

              <div className="hidden gap-3 sm:grid-cols-2 xl:grid-cols-3 lg:grid">
                {isAdmin ? (
                  <DesktopFilterSelect
                    id="sales"
                    name="sales"
                    label="Obchodník"
                    defaultValue={salesOwner}
                    options={[
                      { value: '', label: 'Všichni' },
                      ...SALES_OWNER_OPTIONS.map((owner) => ({ value: owner, label: owner })),
                    ]}
                  />
                ) : null}

                <DesktopFilterSelect
                  id="payout"
                  name="payout"
                  label="Vyplaceno"
                  defaultValue={payoutFilter}
                  options={[
                    { value: 'unpaid', label: 'Nevyplacené' },
                    { value: 'paid', label: 'Vyplacené' },
                    { value: 'all', label: 'Vše' },
                  ]}
                />

                {isAdmin ? (
                  <DesktopFilterSelect
                    id="approval"
                    name="approval"
                    label="K vyplacení"
                    defaultValue={approvalFilter}
                    options={[
                      { value: 'all', label: 'Vše' },
                      { value: 'approved', label: 'Ano' },
                      { value: 'not_approved', label: 'Ne' },
                    ]}
                  />
                ) : null}

                <DesktopFilterSelect
                  id="sort"
                  name="sort"
                  label="Řazení"
                  defaultValue={sort}
                  options={[
                    { value: 'job_number_desc', label: 'Dle čísla zakázky' },
                    { value: 'start_nearest', label: 'Dle data realizace' },
                    { value: 'profit_desc', label: 'Dle zisku' },
                    { value: 'commission_desc', label: 'Dle provize' },
                  ]}
                />

                <DesktopFilterSelect
                  id="year_scope"
                  name="year_scope"
                  label="Období statistik"
                  defaultValue={yearScope}
                  options={[
                    { value: 'year', label: 'Aktuální rok' },
                    { value: 'all', label: 'Celkem' },
                  ]}
                />
              </div>

              <div className="provize-page__filter-divider hidden flex-col gap-2 border-t border-gray-100 pt-4 lg:flex [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    className="jobs-page__filter-submit inline-flex h-10 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
                  >
                    POUŽÍT FILTRY
                  </button>

                  <Link
                    href="/provize"
                    className="jobs-page__filter-reset inline-flex h-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                  >
                    RESET
                  </Link>

                  {isAdmin ? (
                    <ProvizePayoutModalLauncher
                      owners={SALES_OWNER_OPTIONS}
                      buttonClassName="provize-page__payout-button inline-flex h-10 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(78,160,220,0.3)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(56,125,177,0.94)_0%,rgba(38,97,141,0.92)_52%,rgba(27,73,111,0.94)_100%)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_24px_rgba(11,33,56,0.34)] [html[data-theme='dark']_&:hover]:border-[rgba(96,165,250,0.38)] [html[data-theme='dark']_&:hover]:bg-[linear-gradient(155deg,rgba(67,142,195,0.96)_0%,rgba(45,111,160,0.94)_52%,rgba(32,82,124,0.96)_100%)]"
                    />
                  ) : null}

                  {canShowHistoryButton ? (
                    <ProvizeHistoryModalLauncher
                      isAdmin={isAdmin}
                      currentSalesOwner={currentSalesOwner}
                      owners={SALES_OWNER_OPTIONS}
                      buttonClassName="provize-page__history-button inline-flex h-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(84,170,232,0.42)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(40,92,144,0.92)_0%,rgba(28,70,114,0.94)_52%,rgba(20,51,87,0.96)_100%)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_28px_rgba(13,39,66,0.34)] [html[data-theme='dark']_&:hover]:border-[rgba(125,211,252,0.52)] [html[data-theme='dark']_&:hover]:bg-[linear-gradient(155deg,rgba(54,112,170,0.96)_0%,rgba(36,84,131,0.96)_52%,rgba(25,60,99,0.98)_100%)] [html[data-theme='dark']_&:hover]:text-[#f8fbff]"
                    />
                  ) : null}
                </div>
              </div>

              <div className="provize-page__filter-divider hidden border-t border-gray-100 pt-3 text-[11px] text-gray-500 lg:block [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
                Aktivní:{' '}
                <span className="font-medium text-gray-700">
                  {activeFilterSummary || 'bez omezení'}
                </span>
              </div>
            </form>

            <div className="grid w-full grid-cols-2 gap-2 lg:hidden">
              {isAdmin ? (
                <ProvizePayoutModalLauncher
                  owners={SALES_OWNER_OPTIONS}
                  buttonClassName="provize-page__payout-button inline-flex h-10 w-full items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[11px] font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 [html[data-theme='dark']_&]:border-[rgba(78,160,220,0.3)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(56,125,177,0.94)_0%,rgba(38,97,141,0.92)_52%,rgba(27,73,111,0.94)_100%)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_24px_rgba(11,33,56,0.34)]"
                />
              ) : null}

              {canShowHistoryButton ? (
                <ProvizeHistoryModalLauncher
                  isAdmin={isAdmin}
                  currentSalesOwner={currentSalesOwner}
                  owners={SALES_OWNER_OPTIONS}
                  buttonClassName="provize-page__history-button inline-flex h-10 w-full items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2 text-[11px] font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 [html[data-theme='dark']_&]:border-[rgba(84,170,232,0.42)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(40,92,144,0.92)_0%,rgba(28,70,114,0.94)_52%,rgba(20,51,87,0.96)_100%)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_28px_rgba(13,39,66,0.34)]"
                />
              ) : null}
            </div>
          </section>

          <section
            className={`jobs-page__filters-shell rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] ${
              isAdmin ? 'xl:self-start' : 'flex h-full flex-col'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Přehled provizí
                </div>
              </div>

              <div className="inline-flex rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(84,170,232,0.26)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(24,45,78,0.94)_0%,rgba(18,36,66,0.92)_52%,rgba(14,28,53,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_12px_24px_rgba(8,20,37,0.32)]">
                <Link
                  href={yearHref}
                  className={`inline-flex h-8 items-center justify-center rounded-xl px-3 text-xs font-medium ${
                    yearScope === 'year'
                      ? 'bg-zinc-900 text-white shadow-[0_8px_16px_rgba(24,24,27,0.18)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.92)] [html[data-theme=\'dark\']_&]:text-[#f8fbff] [html[data-theme=\'dark\']_&]:shadow-[0_8px_16px_rgba(0,0,0,0.28)]'
                      : 'text-gray-600 transition hover:bg-white/80 [html[data-theme=\'dark\']_&]:text-slate-300 [html[data-theme=\'dark\']_&]:hover:bg-white/10 [html[data-theme=\'dark\']_&]:hover:text-[#f8fbff]'
                  }`}
                  aria-current={yearScope === 'year' ? 'page' : undefined}
                >
                  ROK
                </Link>
                <Link
                  href={allTimeHref}
                  className={`inline-flex h-8 items-center justify-center rounded-xl px-3 text-xs font-medium ${
                    yearScope === 'all'
                      ? 'bg-zinc-900 text-white shadow-[0_8px_16px_rgba(24,24,27,0.18)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.92)] [html[data-theme=\'dark\']_&]:text-[#f8fbff] [html[data-theme=\'dark\']_&]:shadow-[0_8px_16px_rgba(0,0,0,0.28)]'
                      : 'text-gray-600 transition hover:bg-white/80 [html[data-theme=\'dark\']_&]:text-slate-300 [html[data-theme=\'dark\']_&]:hover:bg-white/10 [html[data-theme=\'dark\']_&]:hover:text-[#f8fbff]'
                  }`}
                  aria-current={yearScope === 'all' ? 'page' : undefined}
                >
                  CELKEM
                </Link>
              </div>
            </div>

            <div className={`mt-3 grid gap-2.5 ${isAdmin ? '' : 'flex-1'}`}>
              {isAdmin ? (
                <>
                  <StatsCard
                    label="MICHAL"
                    unpaidValue={formatCurrency(
                      unpaidCommissionByOwner.get('MICHAL') ?? 0
                    )}
                    paidValue={formatCurrency(
                      paidCommissionByOwner.get('MICHAL') ?? 0
                    )}
                  />
                  <StatsCard
                    label="LÍDA"
                    unpaidValue={formatCurrency(
                      unpaidCommissionByOwner.get('LÍDA') ?? 0
                    )}
                    paidValue={formatCurrency(
                      paidCommissionByOwner.get('LÍDA') ?? 0
                    )}
                  />
                </>
              ) : (
                <StatsCard
                  className="h-full"
                  label={currentSalesOwner ?? 'Moje provize'}
                  unpaidValue={formatCurrency(
                    currentSalesOwner
                      ? (unpaidCommissionByOwner.get(currentSalesOwner) ?? 0)
                      : 0
                  )}
                  paidValue={formatCurrency(
                    currentSalesOwner
                      ? (paidCommissionByOwner.get(currentSalesOwner) ?? 0)
                      : 0
                  )}
                />
              )}
            </div>
          </section>
        </section>

        {rows.length === 0 ? (
          <>
            <section className="jobs-page__table-shell provize-page__table-shell hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.02),0_20px_44px_rgba(0,0,0,0.24)] lg:block">
              <div className="border-b border-white/70 px-5 py-4 [html[data-theme='dark']_&]:border-b-transparent">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Přehled zakázek pro provize
                </div>
              </div>

              <div className="max-h-[58vh] overflow-auto">
                <table className="jobs-page__table w-full min-w-[1320px] table-fixed border-separate border-spacing-y-0">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col className="w-[108px]" />
                    <col />
                    <col className="w-[130px]" />
                    <col className="w-[130px]" />
                    <col className="w-[180px]" />
                    <col className="w-[88px]" />
                    <col className="w-[132px]" />
                    <col className="w-[132px]" />
                    <col className="w-[132px]" />
                    <col className="w-[132px]" />
                    <col className="w-[132px]" />
                    <col className="w-[120px]" />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(249,250,251,0.96)_100%)] shadow-[0_1px_0_0_#e5e7eb] backdrop-blur [html[data-theme='dark']_&]:shadow-none">
                    <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      <th className="px-2 py-3 text-left">Zakázka</th>
                      <th className="px-2 py-3 text-left">Obchodník</th>
                      <th className="px-2 py-3 text-left">Firma</th>
                      <th className="px-2 py-3 text-left">Začátek</th>
                      <th className="px-2 py-3 text-left">Konec</th>
                      <th className="px-2 py-3 text-left">Adresa</th>
                      <th className="px-2 py-3 text-center">Prodejna</th>
                      <th className="px-2 py-3 text-center">Faktura</th>
                      <th className="px-2 py-3 text-center">Prodej</th>
                      <th className="px-2 py-3 text-center">Zisk</th>
                      <th className="px-2 py-3 text-center">Provize</th>
                      <th className="px-2 py-3 text-center">K vyplacení</th>
                      <th className="px-2 py-3 text-center">Vyplaceno</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={13} className="px-5 py-16">
                        <div className="mx-auto max-w-2xl text-center">
                          <h2 className="text-lg font-semibold text-gray-900">
                            {hasActiveFilters
                              ? 'Žádné provizní záznamy neodpovídají aktuálním filtrům.'
                              : 'Zatím tu nejsou žádné provizní záznamy.'}
                          </h2>
                          <p className="mt-3 text-sm leading-6 text-gray-500">
                            {hasActiveFilters
                              ? 'Zkus upravit vyhledávání nebo změnit aktivní filtry.'
                              : 'Jakmile budou ve Fakturách splněné podmínky pro přenos, objeví se tu automaticky nové zakázky pro výpočet provizí.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-3 lg:hidden">
              <MobileEmptyCard
                title={
                  hasActiveFilters
                    ? 'Filtry nevrátily žádné záznamy'
                    : 'Zatím tu nejsou žádné provizní záznamy'
                }
                description={
                  hasActiveFilters
                    ? 'Zkus upravit vyhledávání nebo některý z filtrů.'
                    : 'Mobilní karty jsou připravené. Jakmile budou ve Fakturách splněné podmínky, zobrazí se tu jednotlivé zakázky i jejich stavy.'
                }
              />
            </section>
          </>
        ) : (
          <>
            <ProvizeInteractiveTable rows={rows} isAdmin={isAdmin} />
          </>
        )}
      </div>
    </main>
  )
}

function FilterSelect({
  id,
  name,
  label,
  defaultValue,
  options,
}: {
  id: string
  name: string
  label: string
  defaultValue: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400"
      >
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        className="h-10 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(15,23,42,0.96)_0%,rgba(12,20,34,0.92)_100%)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_18px_rgba(0,0,0,0.18)] [html[data-theme='dark']_&]:focus:border-[rgba(84,170,232,0.34)] [html[data-theme='dark']_&]:focus:ring-[rgba(84,170,232,0.22)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function DesktopFilterSelect({
  id,
  name,
  label,
  defaultValue,
  options,
}: {
  id: string
  name: string
  label: string
  defaultValue: string
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
      >
        {label}
      </label>
      <div className="jobs-page__filters-panel relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
        <select
          id={id}
          name={name}
          defaultValue={defaultValue}
          className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-3 pr-8 text-sm text-gray-900 outline-none sm:rounded-2xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
          ⌄
        </span>
      </div>
    </div>
  )
}

function StatsCard({
  className,
  label,
  unpaidValue,
  paidValue,
}: {
  className?: string
  label: string
  unpaidValue: string
  paidValue: string
}) {
  return (
    <article
      className={`rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_20px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(84,170,232,0.22)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(24,45,78,0.56)_0%,rgba(18,36,66,0.48)_52%,rgba(14,28,53,0.52)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_14px_28px_rgba(8,20,37,0.24)] ${
        className ?? ''
      }`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-300">
        {label}
      </div>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
            Nevyplacené
          </div>
          <div className="mt-0.5 text-lg font-semibold text-gray-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
            {unpaidValue}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
            Vyplacené
          </div>
          <div className="mt-0.5 text-lg font-semibold text-gray-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
            {paidValue}
          </div>
        </div>
      </div>
    </article>
  )
}

function MobileEmptyCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <article className="rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-gray-500">{description}</p>
      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex items-center justify-between rounded-2xl border border-white/75 bg-white/70 px-3 py-2">
          <dt className="text-gray-500">Vyplaceno</dt>
          <dd className="font-medium text-red-600">Ne</dd>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-white/75 bg-white/70 px-3 py-2">
          <dt className="text-gray-500">K vyplacení</dt>
          <dd className="font-medium text-gray-700">V přípravě</dd>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-white/75 bg-white/70 px-3 py-2">
          <dt className="text-gray-500">Zisk</dt>
          <dd className="font-medium text-gray-900">{formatDateTime(null)}</dd>
        </div>
      </dl>
    </article>
  )
}
