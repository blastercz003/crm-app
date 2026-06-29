import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FakturyInteractiveTable } from './faktury-interactive-table'
import { FakturyFilterSubmitButton } from './faktury-filter-submit-button'
import { FakturyFilterResetLink } from './faktury-filter-reset-link'
import { getJobPpNotRequiredSet } from '@/lib/jobs/pp-requirements'

export const metadata: Metadata = {
  title: 'Faktury',
}

export type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA'
export type SortMode = 'start_nearest' | 'job_number_desc' | 'sale_desc'

export type FakturaRow = {
  id: string
  job_id: string
  client_id: string | null
  offer_id: string | null
  client_contact_id: string | null
  job_number: string
  company_name: string
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  marny_vyjezd: boolean | null
  pp_required?: boolean
  job_status: 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
  invoice_status: 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'
  info_note: string | null
  invoice_number: string | null
  sale_amount: number | null
  cost_amount: number | null
  has_attachments: boolean
}

type ProfileRoleRow = {
  role: string | null
}

type FakturySearchParams = {
  q?: string
  sales?: string
  sort?: string
  date_from?: string
  date_to?: string
  invoiced?: string
  overview_year?: string
}

type JobFinanceJoinRow = {
  id: string
  job_id: string
  info_note: string | null
  invoice_number: string | null
  sale_amount: number | null
  cost_amount: number | null
  job:
      | {
          id: string
          client_id: string | null
          offer_id: string | null
          client_contact_id: string | null
          job_number: string
          company_name: string
          contact_person: string | null
          sales_owner: SalesOwner
          start_at: string
        end_at: string
          site_address: string | null
          store_number: string | null
          technician_name: string | null
          generator_name: string | null
          marny_vyjezd: boolean | null
          job_status: 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
          invoice_status: 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'
        }
    | {
        id: string
        client_id: string | null
        offer_id: string | null
        client_contact_id: string | null
        job_number: string
        company_name: string
        contact_person: string | null
        sales_owner: SalesOwner
        start_at: string
        end_at: string
        site_address: string | null
        store_number: string | null
        technician_name: string | null
        generator_name: string | null
        marny_vyjezd: boolean | null
        job_status: 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
        invoice_status: 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'
      }[]
    | null
}

type JobIdRow = {
  id: string
}

type ClientSuggestionRow = {
  id: string
  name: string | null
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

type JobOfferOption = {
  id: string
  client_id: string
  offer_number: string
  title: string
}

type FinanceStatsJoinRow = {
  sale_amount: number | null
  cost_amount: number | null
  job:
    | {
        start_at: string
        end_at: string
      }
    | {
        start_at: string
        end_at: string
      }[]
    | null
}

type JobAttachmentJobIdRow = {
  job_id: string
}

const SALES_OWNER_OPTIONS: SalesOwner[] = ['JIŘÍ', 'MICHAL', 'LÍDA']

function isSalesOwner(value: string | undefined): value is SalesOwner {
  return SALES_OWNER_OPTIONS.includes(value as SalesOwner)
}

function isSortMode(value: string | undefined): value is SortMode {
  return (
    value === 'start_nearest' ||
    value === 'job_number_desc' ||
    value === 'sale_desc'
  )
}

function isInvoicedFilter(value: string | undefined) {
  return value === 'yes' || value === 'no' ? value : ''
}

function sanitizeSearchTerm(search: string) {
  return search.replaceAll(',', ' ').trim()
}

function buildFinanceSearchFilter(search: string) {
  const escaped = sanitizeSearchTerm(search)

  return [
    `invoice_number.ilike.%${escaped}%`,
    `info_note.ilike.%${escaped}%`,
  ].join(',')
}

function buildJobSearchFilter(search: string) {
  const escaped = sanitizeSearchTerm(search)

  return [
    `job_number_search.ilike.%${escaped}%`,
    `company_name_search.ilike.%${escaped}%`,
    `contact_person_search.ilike.%${escaped}%`,
    `site_address_search.ilike.%${escaped}%`,
    `store_number_search.ilike.%${escaped}%`,
  ].join(',')
}

function getPragueTodayParts() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(new Date())

  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '')
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '')
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '')

  return { year, month, day }
}

function getCurrentMonthRange() {
  const today = getPragueTodayParts()
  const month = String(today.month).padStart(2, '0')
  const lastDay = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate()

  return {
    from: `${today.year}-${month}-01`,
    to: `${today.year}-${month}-${String(lastDay).padStart(2, '0')}`,
  }
}

function getPreviousMonthRange() {
  const today = getPragueTodayParts()
  const previousMonthDate = new Date(Date.UTC(today.year, today.month - 2, 1))
  const year = previousMonthDate.getUTCFullYear()
  const monthNumber = previousMonthDate.getUTCMonth() + 1
  const month = String(monthNumber).padStart(2, '0')
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  }
}

function getProfit(saleAmount: number | null, costAmount: number | null) {
  const sale = typeof saleAmount === 'number' ? saleAmount : 0
  const cost = typeof costAmount === 'number' ? costAmount : 0
  return sale - cost
}

function hasCompleteFinanceValues(
  row: Pick<FakturaRow, 'sale_amount' | 'cost_amount'>
): row is { sale_amount: number; cost_amount: number } {
  return Number.isFinite(row.sale_amount) && Number.isFinite(row.cost_amount)
}

const MONTH_LABELS_CS = [
  'Leden',
  'Únor',
  'Březen',
  'Duben',
  'Květen',
  'Červen',
  'Červenec',
  'Srpen',
  'Září',
  'Říjen',
  'Listopad',
  'Prosinec',
]

function parseOverviewYear(value: string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) return null
  return parsed
}

function resolveFinanceStatDate(startAt: string, endAt: string) {
  const endDate = new Date(endAt)
  if (!Number.isNaN(endDate.getTime())) return endDate
  return new Date(startAt)
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)
}

function formatChartMoneyTick(value: number) {
  if (Math.abs(value) >= 1_000_000) {
    const millions = value / 1_000_000
    return `${new Intl.NumberFormat('cs-CZ', {
      minimumFractionDigits: millions < 10 ? 1 : 0,
      maximumFractionDigits: 1,
    }).format(millions)} mil. Kč`
  }

  return formatCurrency(value)
}

function getJobNumberSortValue(jobNumber: string) {
  const digits = String(jobNumber ?? '').match(/\d+/g)?.join('') ?? ''
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : -1
}

function compareByJobNumberDesc(a: FakturaRow, b: FakturaRow) {
  const aValue = getJobNumberSortValue(a.job_number)
  const bValue = getJobNumberSortValue(b.job_number)

  if (bValue !== aValue) {
    return bValue - aValue
  }

  return String(b.job_number).localeCompare(String(a.job_number), 'cs')
}

function buildExportHref({
  query,
  salesOwner,
  sort,
  dateFrom,
  dateTo,
  invoiced,
}: {
  query: string
  salesOwner: string
  sort: SortMode
  dateFrom: string
  dateTo: string
  invoiced: string
}) {
  const params = new URLSearchParams()

  if (query) {
    params.set('q', query)
  }

  if (salesOwner) {
    params.set('sales', salesOwner)
  }

  if (sort) {
    params.set('sort', sort)
  }

  if (dateFrom) {
    params.set('date_from', dateFrom)
  }

  if (dateTo) {
    params.set('date_to', dateTo)
  }

  if (invoiced) {
    params.set('invoiced', invoiced)
  }

  const search = params.toString()
  return search ? `/faktury/export?${search}` : '/faktury/export'
}

function buildCurrentMonthHref({
  query,
  salesOwner,
  sort,
  invoiced,
}: {
  query: string
  salesOwner: string
  sort: SortMode
  invoiced: string
}) {
  const currentMonthRange = getCurrentMonthRange()
  const params = new URLSearchParams()

  if (query) {
    params.set('q', query)
  }

  if (salesOwner) {
    params.set('sales', salesOwner)
  }

  if (sort) {
    params.set('sort', sort)
  }

  params.set('date_from', currentMonthRange.from)
  params.set('date_to', currentMonthRange.to)

  if (invoiced) {
    params.set('invoiced', invoiced)
  }

  return `/faktury?${params.toString()}`
}

function buildPreviousMonthHref({
  query,
  salesOwner,
  sort,
  invoiced,
}: {
  query: string
  salesOwner: string
  sort: SortMode
  invoiced: string
}) {
  const previousMonthRange = getPreviousMonthRange()
  const params = new URLSearchParams()

  if (query) {
    params.set('q', query)
  }

  if (salesOwner) {
    params.set('sales', salesOwner)
  }

  if (sort) {
    params.set('sort', sort)
  }

  params.set('date_from', previousMonthRange.from)
  params.set('date_to', previousMonthRange.to)

  if (invoiced) {
    params.set('invoiced', invoiced)
  }

  return `/faktury?${params.toString()}`
}

function buildOverviewYearHref({
  year,
  query,
  salesOwner,
  sort,
  dateFrom,
  dateTo,
  invoiced,
}: {
  year: number
  query: string
  salesOwner: string
  sort: SortMode
  dateFrom: string
  dateTo: string
  invoiced: string
}) {
  const params = new URLSearchParams()

  if (query) params.set('q', query)
  if (salesOwner) params.set('sales', salesOwner)
  if (sort) params.set('sort', sort)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)
  if (invoiced) params.set('invoiced', invoiced)
  params.set('overview_year', String(year))

  return `/faktury?${params.toString()}`
}

export default async function FakturyPage({
  searchParams,
}: {
  searchParams?: Promise<FakturySearchParams>
}) {
  const params = searchParams ? await searchParams : undefined

  const query = params?.q?.trim() ?? ''
  const salesOwner = isSalesOwner(params?.sales) ? params?.sales : ''
  const sort = isSortMode(params?.sort) ? params?.sort : 'job_number_desc'
  const dateFrom = params?.date_from?.trim() ?? ''
  const dateTo = params?.date_to?.trim() ?? ''
  const invoiced = isInvoicedFilter(params?.invoiced)
  const overviewYearParam = parseOverviewYear(params?.overview_year)

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfileRoleRow | null

  if (typedProfile?.role !== 'admin') {
    redirect('/dashboard')
  }

  let matchingJobIds: string[] = []

  if (query) {
    let jobsSearchRequest = supabase.from('jobs').select('id')

    if (salesOwner) {
      jobsSearchRequest = jobsSearchRequest.eq('sales_owner', salesOwner)
    }

    if (dateFrom) {
      jobsSearchRequest = jobsSearchRequest.gte('start_at', `${dateFrom}T00:00:00`)
    }

    if (dateTo) {
      jobsSearchRequest = jobsSearchRequest.lte('start_at', `${dateTo}T23:59:59`)
    }

    const { data: matchingJobs, error: matchingJobsError } =
      await jobsSearchRequest.or(buildJobSearchFilter(query))

    if (matchingJobsError) {
      throw new Error('Nepodařilo se načíst fakturaci.')
    }

    matchingJobIds = ((matchingJobs ?? []) as JobIdRow[]).map((job) => job.id)
  }

  let request = supabase.from('job_finances').select(`
      id,
      job_id,
      info_note,
      invoice_number,
      sale_amount,
      cost_amount,
      job:jobs!inner (
        id,
        client_id,
        offer_id,
        client_contact_id,
        job_number,
        company_name,
        contact_person,
        sales_owner,
        start_at,
        end_at,
        site_address,
        store_number,
        technician_name,
        generator_name,
        marny_vyjezd,
        job_status,
        invoice_status
      )
    `)

  if (salesOwner) {
    request = request.eq('job.sales_owner', salesOwner)
  }

  if (dateFrom) {
    request = request.gte('job.start_at', `${dateFrom}T00:00:00`)
  }

  if (dateTo) {
    request = request.lte('job.start_at', `${dateTo}T23:59:59`)
  }

  if (invoiced === 'yes') {
    request = request.not('invoice_number', 'is', null)
  }

  if (invoiced === 'no') {
    request = request.is('invoice_number', null)
  }

  if (query) {
    const financeSearchFilter = buildFinanceSearchFilter(query)

    if (matchingJobIds.length > 0) {
      request = request.or(
        `${financeSearchFilter},job_id.in.(${matchingJobIds.join(',')})`
      )
    } else {
      request = request.or(financeSearchFilter)
    }
  }

  const [
    financeResponse,
    clientSuggestionsResponse,
    clientContactsResponse,
    offerSuggestionsResponse,
    technicianProfilesResponse,
    statsResponse,
  ] = await Promise.all([
    request,
    supabase
      .from('clients')
      .select('id, name')
      .order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('offers')
      .select('id, client_id, offer_number, title, offer_type, status')
      .eq('offer_type', 'classic')
      .neq('status', 'realizace')
      .order('offer_number', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, name, can_be_assigned_as_technician')
      .eq('can_be_assigned_as_technician', true)
      .order('name', { ascending: true }),
    supabase.from('job_finances').select(`
      sale_amount,
      cost_amount,
      job:jobs!inner (
        id,
        client_id,
        offer_id,
        client_contact_id,
        job_number,
        company_name,
        contact_person,
        sales_owner,
        start_at,
        end_at,
        site_address,
        store_number,
        technician_name,
        generator_name,
        marny_vyjezd,
        job_status,
        invoice_status
      )
    `),
  ])

  const { data, error } = financeResponse

  if (error) {
    throw new Error('Nepodařilo se načíst fakturaci.')
  }

  if (clientSuggestionsResponse.error) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  if (clientContactsResponse.error) {
    throw new Error('Nepodařilo se načíst kontaktní osoby klientů.')
  }

  if (offerSuggestionsResponse.error) {
    throw new Error('Nepodařilo se načíst nabídky pro zakázky.')
  }

  if (technicianProfilesResponse.error) {
    throw new Error('Nepodařilo se načíst techniky pro našeptávání.')
  }

  if (statsResponse.error) {
    throw new Error('Nepodařilo se načíst přehled fakturace.')
  }

  const clientSuggestions = ((clientSuggestionsResponse.data ?? []) as ClientSuggestionRow[])
    .map((client) => ({
      id: String(client.id ?? '').trim(),
      name: String(client.name ?? '').trim(),
    }))
    .filter((client) => client.id && client.name)

  const clientContacts = ((clientContactsResponse.data ?? []) as ClientContactOption[])
    .map((item) => ({
      id: String(item.id ?? '').trim(),
      client_id: String(item.client_id ?? '').trim(),
      name: String(item.name ?? '').trim(),
      is_primary: Boolean(item.is_primary),
    }))
    .filter((item) => item.id && item.client_id && item.name)

  const offerSuggestions = ((offerSuggestionsResponse.data ?? []) as JobOfferOption[])
    .map((item) => ({
      id: String(item.id ?? '').trim(),
      client_id: String(item.client_id ?? '').trim(),
      offer_number: String(item.offer_number ?? '').trim(),
      title: String(item.title ?? '').trim(),
    }))
    .filter((item) => item.id && item.client_id && item.offer_number && item.title)

  const technicianSuggestions = ((technicianProfilesResponse.data ?? []) as {
    id: string
    name: string | null
    can_be_assigned_as_technician: boolean | null
  }[])
    .map((item) => String(item.name ?? '').trim())
    .filter((name): name is string => Boolean(name))

  let rows: FakturaRow[] = ((data ?? []) as JobFinanceJoinRow[])
    .map((item) => {
      const job = Array.isArray(item.job) ? item.job[0] : item.job

      if (!job) return null

      return {
        id: item.id,
        job_id: item.job_id,
        client_id: job.client_id,
        offer_id: job.offer_id,
        client_contact_id: job.client_contact_id,
        job_number: job.job_number,
        company_name: job.company_name,
        contact_person: job.contact_person,
        sales_owner: job.sales_owner,
        start_at: job.start_at,
        end_at: job.end_at,
        site_address: job.site_address,
        store_number: job.store_number,
        technician_name: job.technician_name,
        generator_name: job.generator_name,
        marny_vyjezd: job.marny_vyjezd,
        job_status: job.job_status,
        invoice_status: job.invoice_status,
        info_note: item.info_note,
        invoice_number: item.invoice_number,
        sale_amount:
          typeof item.sale_amount === 'number' ? item.sale_amount : null,
        cost_amount:
          typeof item.cost_amount === 'number' ? item.cost_amount : null,
        has_attachments: false,
      }
    })
    .filter((item): item is FakturaRow => Boolean(item))

  const linkedOfferIds = Array.from(
    new Set(
      rows
        .map((row) => String(row.offer_id ?? '').trim())
        .filter((offerId) => Boolean(offerId))
    )
  )

  const { data: linkedOfferRows, error: linkedOfferError } =
    linkedOfferIds.length > 0
      ? await supabase
          .from('offers')
          .select('id, client_id, offer_number, title')
          .in('id', linkedOfferIds)
      : { data: [], error: null }

  if (linkedOfferError) {
    throw new Error('Nepodařilo se načíst navázané nabídky k zakázkám.')
  }

  const uniqueJobIds = Array.from(new Set(rows.map((row) => row.job_id)))
  const jobPpNotRequiredIds = await getJobPpNotRequiredSet(supabase, uniqueJobIds)

  if (uniqueJobIds.length > 0) {
    const { data: attachmentRows, error: attachmentsError } = await supabase
      .from('job_attachments')
      .select('job_id')
      .in('job_id', uniqueJobIds)

    if (attachmentsError) {
      throw new Error('Nepodařilo se načíst stav příloh.')
    }

    const jobIdsWithAttachments = new Set(
      ((attachmentRows ?? []) as JobAttachmentJobIdRow[]).map((row) =>
        String(row.job_id)
      )
    )

    rows = rows.map((row) => ({
      ...row,
      pp_required: !jobPpNotRequiredIds.has(row.job_id),
      has_attachments: jobIdsWithAttachments.has(row.job_id),
    }))
  } else {
    rows = rows.map((row) => ({
      ...row,
      pp_required: !jobPpNotRequiredIds.has(row.job_id),
    }))
  }

  if (sort === 'start_nearest') {
    rows = [...rows].sort((a, b) => {
      const dateDiff =
        new Date(b.start_at).getTime() - new Date(a.start_at).getTime()

      if (dateDiff !== 0) {
        return dateDiff
      }

      return compareByJobNumberDesc(a, b)
    })
  } else if (sort === 'sale_desc') {
    rows = [...rows].sort((a, b) => {
      const aSale = typeof a.sale_amount === 'number' ? a.sale_amount : -1
      const bSale = typeof b.sale_amount === 'number' ? b.sale_amount : -1

      if (bSale !== aSale) {
        return bSale - aSale
      }

      return compareByJobNumberDesc(a, b)
    })
  } else {
    rows = [...rows].sort(compareByJobNumberDesc)
  }

  const statRows = ((statsResponse.data ?? []) as FinanceStatsJoinRow[])
    .map((item) => {
      const job = Array.isArray(item.job) ? item.job[0] : item.job

      if (!job) return null

      return {
        sale_amount: typeof item.sale_amount === 'number' ? item.sale_amount : null,
        cost_amount: typeof item.cost_amount === 'number' ? item.cost_amount : null,
        start_at: job.start_at,
        end_at: job.end_at,
      }
    })
    .filter((item): item is { sale_amount: number | null; cost_amount: number | null; start_at: string; end_at: string } =>
      Boolean(item)
    )
  const overviewYearOptions = Array.from(
    new Set(
      statRows
        .map((row) => resolveFinanceStatDate(row.start_at, row.end_at))
        .filter((date) => !Number.isNaN(date.getTime()))
        .map((date) => date.getUTCFullYear())
    )
  ).sort((a, b) => b - a)

  const currentYear = getPragueTodayParts().year
  const selectedOverviewYear =
    overviewYearParam &&
    (overviewYearOptions.includes(overviewYearParam) ||
      overviewYearParam === currentYear)
      ? overviewYearParam
      : overviewYearOptions[0] ?? currentYear

  const monthlySaleByYear = Array.from({ length: 12 }, () => 0)
  const monthlyProfitByYear = Array.from({ length: 12 }, () => 0)

  for (const row of statRows) {
    const rowDate = resolveFinanceStatDate(row.start_at, row.end_at)
    if (Number.isNaN(rowDate.getTime())) continue
    if (rowDate.getUTCFullYear() !== selectedOverviewYear) continue
    if (!hasCompleteFinanceValues(row)) continue

    const monthIndex = rowDate.getUTCMonth()
    monthlySaleByYear[monthIndex] += row.sale_amount
    monthlyProfitByYear[monthIndex] += getProfit(row.sale_amount, row.cost_amount)
  }

  const activeFilterSummary = [
    salesOwner || null,
    invoiced === 'yes'
      ? 's fakturou'
      : invoiced === 'no'
        ? 'bez faktury'
        : null,
    dateFrom ? `od ${dateFrom}` : null,
    dateTo ? `do ${dateTo}` : null,
    query || null,
  ]
    .filter(Boolean)
    .join(' · ')

  const hasActiveFilters = Boolean(
    query || salesOwner || dateFrom || dateTo || invoiced
  )

  const exportHref = buildExportHref({
    query,
    salesOwner,
    sort,
    dateFrom,
    dateTo,
    invoiced,
  })
  const currentMonthHref = buildCurrentMonthHref({
    query,
    salesOwner,
    sort,
    invoiced,
  })
  const previousMonthHref = buildPreviousMonthHref({
    query,
    salesOwner,
    sort,
    invoiced,
  })

  return (
    <main className="jobs-page faktury-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
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
            <div className="flex items-center justify-center lg:justify-start">
              <Image
                src="/logo2.png"
                alt="B-ENERGY"
                width={150}
                height={42}
                className="h-6 w-auto"
                priority
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form
                action="/faktury"
                method="get"
                className="flex w-full gap-3 sm:w-auto"
              >
                <input type="hidden" name="sales" value={salesOwner} />
                <input type="hidden" name="sort" value={sort} />
                <input type="hidden" name="date_from" value={dateFrom} />
                <input type="hidden" name="date_to" value={dateTo} />
                <input type="hidden" name="invoiced" value={invoiced} />

                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Hledat firmu, osobu, fakturu, info, adresu"
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
          <section className="jobs-page__filters-shell rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <details id="faktury-mobile-filters" className="group mb-2 lg:hidden">
              <summary className="jobs-page__filters-summary flex h-10 cursor-pointer list-none items-center justify-between gap-2.5 rounded-xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(242,247,252,0.88)_100%)] px-3 text-[12px] font-semibold uppercase tracking-[0.07em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
                <span className="inline-flex items-center gap-2">
                  FILTRY
                  {hasActiveFilters ? (
                    <span className="jobs-page__filters-summary-badge inline-flex items-center rounded-full border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.07em] text-[#236f9f]">
                      FILTR AKTIVNÍ
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-zinc-500 transition group-open:rotate-180">⌄</span>
              </summary>

              <form
                action="/faktury"
                method="get"
                className="jobs-page__filters-panel mt-2 space-y-3 rounded-2xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"
              >
                <input type="hidden" name="q" value={query} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="sales-mobile"
                      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      Obchodník
                    </label>
                    <select
                      id="sales-mobile"
                      name="sales"
                      defaultValue={salesOwner}
                      className="h-10 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                    >
                      <option value="">Všichni</option>
                      {SALES_OWNER_OPTIONS.map((owner) => (
                        <option key={owner} value={owner}>
                          {owner}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="sort-mobile"
                      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      Řazení
                    </label>
                    <select
                      id="sort-mobile"
                      name="sort"
                      defaultValue={sort}
                      className="h-10 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                    >
                      <option value="job_number_desc">Dle čísla zakázky</option>
                      <option value="start_nearest">Dle data od (nejstarší)</option>
                      <option value="sale_desc">Dle prodeje</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="invoiced-mobile"
                      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      Faktura
                    </label>
                    <select
                      id="invoiced-mobile"
                      name="invoiced"
                      defaultValue={invoiced}
                      className="h-10 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                    >
                      <option value="">Všechny</option>
                      <option value="yes">Jen s číslem faktury</option>
                      <option value="no">Jen bez čísla faktury</option>
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label
                      htmlFor="date_from-mobile"
                      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      Od dne
                    </label>
                    <div className="jobs-page__filters-date-shell min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef]">
                      <input
                        id="date_from-mobile"
                        name="date_from"
                        type="date"
                        defaultValue={dateFrom}
                        className="block h-10 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm filter-date-input text-gray-900 outline-none"
                      />
                    </div>
                  </div>

                  <div className="min-w-0">
                    <label
                      htmlFor="date_to-mobile"
                      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      Do dne
                    </label>
                    <div className="jobs-page__filters-date-shell min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef]">
                      <input
                        id="date_to-mobile"
                        name="date_to"
                        type="date"
                        defaultValue={dateTo}
                        className="block h-10 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm filter-date-input text-gray-900 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="faktury-page__filter-actions-divider flex items-center gap-2 border-t border-gray-100 pt-3">
                  <FakturyFilterSubmitButton className="jobs-page__filter-reset inline-flex h-10 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800">
                    POUŽÍT FILTRY
                  </FakturyFilterSubmitButton>

                  <FakturyFilterResetLink
                    href="/faktury"
                    detailsId="faktury-mobile-filters"
                    className="jobs-page__filter-reset inline-flex h-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
                  >
                    RESET
                  </FakturyFilterResetLink>
                </div>

                <div className="jobs-page__filter-divider faktury-page__filter-divider border-t border-gray-100 pt-3">
                  <div className="text-[11px] text-gray-500">
                    {activeFilterSummary ? (
                      <>
                        Aktivní:{' '}
                        <span className="font-medium text-gray-700">
                          {activeFilterSummary}
                        </span>
                      </>
                    ) : (
                      'Aktivní: bez omezení'
                    )}
                  </div>
                </div>
              </form>
            </details>

            <form action="/faktury" method="get" className="space-y-4">
              <input type="hidden" name="q" value={query} />

              <div className="hidden gap-3 sm:grid-cols-2 xl:grid-cols-3 lg:grid">
                <div>
                  <label
                    htmlFor="sales"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Obchodník
                  </label>
                  <div className="jobs-page__filters-panel relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <select
                      id="sales"
                      name="sales"
                      defaultValue={salesOwner}
                      className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-3 pr-8 text-sm text-gray-900 outline-none sm:rounded-2xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                    >
                      <option value="">Všichni</option>
                      {SALES_OWNER_OPTIONS.map((owner) => (
                        <option key={owner} value={owner}>
                          {owner}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">⌄</span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="sort"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Řazení
                  </label>
                  <div className="jobs-page__filters-panel relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <select
                      id="sort"
                      name="sort"
                      defaultValue={sort}
                      className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-3 pr-8 text-sm text-gray-900 outline-none sm:rounded-2xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                    >
                      <option value="job_number_desc">Dle čísla zakázky</option>
                      <option value="start_nearest">Dle data od (nejstarší)</option>
                      <option value="sale_desc">Dle prodeje</option>
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">⌄</span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="invoiced"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Faktura
                  </label>
                  <div className="jobs-page__filters-panel relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <select
                      id="invoiced"
                      name="invoiced"
                      defaultValue={invoiced}
                      className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-3 pr-8 text-sm text-gray-900 outline-none sm:rounded-2xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                    >
                      <option value="">Všechny</option>
                      <option value="yes">Jen s číslem faktury</option>
                      <option value="no">Jen bez čísla faktury</option>
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">⌄</span>
                  </div>
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="date_from"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Od dne
                  </label>
                  <div className="jobs-page__filters-panel min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <input
                      id="date_from"
                      name="date_from"
                      type="date"
                      defaultValue={dateFrom}
                      className="block h-10 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm filter-date-input text-gray-900 outline-none sm:rounded-2xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                    />
                  </div>
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="date_to"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Do dne
                  </label>
                  <div className="jobs-page__filters-panel min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <input
                      id="date_to"
                      name="date_to"
                      type="date"
                      defaultValue={dateTo}
                      className="block h-10 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm filter-date-input text-gray-900 outline-none sm:rounded-2xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                    />
                  </div>
                </div>
              </div>

                <div className="jobs-page__filter-divider faktury-page__filter-divider hidden flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center lg:flex">
                <div className="flex flex-wrap items-center gap-2 sm:contents">
                  <button
                    type="submit"
                    className="jobs-page__filter-reset inline-flex h-10 w-[calc((100%-1rem)/3)] min-w-0 items-center justify-center whitespace-nowrap rounded-2xl border border-zinc-900 bg-zinc-900 px-2 text-[11px] font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 sm:order-1 sm:w-auto sm:px-4 sm:text-sm"
                  >
                    POUŽÍT FILTRY
                  </button>

                  <Link
                    href="/faktury"
                    className="jobs-page__filter-reset inline-flex h-10 w-[calc((100%-1rem)/3)] min-w-0 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)] sm:order-2 sm:w-auto"
                  >
                    RESET
                  </Link>
                </div>

                <div className="grid w-full grid-cols-3 items-center gap-2 sm:contents">
                  <Link
                    href={previousMonthHref}
                    className="jobs-page__range-link inline-flex h-10 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[11px] font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)] sm:order-3 sm:w-auto sm:px-4 sm:text-sm"
                  >
                    MINULÝ MĚSÍC
                  </Link>

                  <Link
                    href={currentMonthHref}
                    className="jobs-page__range-link inline-flex h-10 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[11px] font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)] sm:order-4 sm:w-auto sm:px-4 sm:text-sm"
                  >
                    TENTO MĚSÍC
                  </Link>

                  <Link
                    href={exportHref}
                    className="jobs-page__range-link inline-flex h-10 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[11px] font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)] sm:order-5 sm:w-auto sm:px-4 sm:text-sm"
                  >
                    EXPORT
                  </Link>
                </div>
              </div>

                <div className="jobs-page__filter-divider faktury-page__filter-divider hidden border-t border-gray-100 pt-3 lg:block">
                <div className="text-[11px] text-gray-500">
                  {activeFilterSummary ? (
                    <>
                      Aktivní:{' '}
                      <span className="font-medium text-gray-700">
                        {activeFilterSummary}
                      </span>
                    </>
                  ) : (
                    'Aktivní: bez omezení'
                  )}
                </div>
              </div>
            </form>
            <div className="grid w-full grid-cols-3 items-center gap-2 lg:hidden">
              <Link
                href={previousMonthHref}
                className="inline-flex h-10 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[11px] font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]"
              >
                MINULÝ MĚSÍC
              </Link>

              <Link
                href={currentMonthHref}
                className="inline-flex h-10 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[11px] font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]"
              >
                TENTO MĚSÍC
              </Link>

              <Link
                href={exportHref}
                className="inline-flex h-10 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[11px] font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]"
              >
                EXPORT
              </Link>
            </div>
          </section>

          <section className="jobs-page__filters-shell rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                Přehled
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1">
                {(overviewYearOptions.length > 0
                  ? overviewYearOptions
                  : [selectedOverviewYear]
                ).map((yearOption) => (
                  <Link
                    key={yearOption}
                    href={buildOverviewYearHref({
                      year: yearOption,
                      query,
                      salesOwner,
                      sort,
                      dateFrom,
                      dateTo,
                      invoiced,
                    })}
                    data-active={yearOption === selectedOverviewYear}
                    className={`jobs-page__range-link inline-flex h-8 items-center justify-center rounded-xl border px-3 text-xs font-medium transition ${
                      yearOption === selectedOverviewYear
                        ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.3)]'
                        : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]'
                    }`}
                  >
                    {yearOption}
                  </Link>
                ))}
              </div>
            </div>

            <div className="mt-2">
              <FinanceCombinedChart
                months={MONTH_LABELS_CS}
                saleValues={monthlySaleByYear}
                profitValues={monthlyProfitByYear}
              />
            </div>
            <div className="mt-[5px] pt-3">
              <div className="text-[11px] text-gray-500">
                Prodej:{' '}
                <span className="font-medium text-gray-700">
                  {formatCurrency(
                    monthlySaleByYear.reduce((sum, value) => sum + value, 0)
                  )}
                </span>{' '}
                · Zisk:{' '}
                <span className="font-medium text-gray-700">
                  {formatCurrency(
                    monthlyProfitByYear.reduce((sum, value) => sum + value, 0)
                  )}
                </span>
              </div>
            </div>
          </section>
        </section>

        {rows.length === 0 ? (
          <section className="jobs-page__empty-state rounded-[26px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <div className="mx-auto max-w-xl space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">
                {hasActiveFilters
                  ? 'Žádná realizace neodpovídá aktuálním filtrům.'
                  : 'Zatím tu nejsou žádné záznamy pro fakturaci.'}
              </h2>

              <p className="text-sm leading-6 text-gray-500">
                {hasActiveFilters
                  ? 'Zkus upravit hledání nebo změnit aktivní filtry.'
                  : 'Jakmile vytvoříš první zakázku, automaticky se zde objeví i její řádek pro fakturaci.'}
              </p>
            </div>
          </section>
        ) : (
          <FakturyInteractiveTable
            rows={rows}
            clientSuggestions={clientSuggestions}
            clientContacts={clientContacts}
            offerSuggestions={offerSuggestions}
            jobOfferSuggestions={((linkedOfferRows ?? []) as JobOfferOption[]).map(
              (item) => ({
                id: String(item.id ?? '').trim(),
                client_id: String(item.client_id ?? '').trim(),
                offer_number: String(item.offer_number ?? '').trim(),
                title: String(item.title ?? '').trim(),
              })
            )}
            technicianSuggestions={technicianSuggestions}
          />
        )}
      </div>
    </main>
  )
}

function FinanceCombinedChart({
  months,
  saleValues,
  profitValues,
}: {
  months: string[]
  saleValues: number[]
  profitValues: number[]
}) {
  const width = 900
  const height = 208
  const paddingTop = 14
  const paddingRight = 14
  const paddingBottom = 30
  const paddingLeft = 64
  const innerWidth = width - paddingLeft - paddingRight
  const innerHeight = height - paddingTop - paddingBottom
  const maxValueRaw = Math.max(...saleValues, ...profitValues, 0)
  const maxValue = maxValueRaw > 0 ? maxValueRaw * 1.1 : 1
  const tickCount = 2

  const salePoints = saleValues.map((value, index) => {
    const x = paddingLeft + (index / (saleValues.length - 1)) * innerWidth
    const y = paddingTop + innerHeight - (value / maxValue) * innerHeight
    return { x, y }
  })

  const profitPoints = profitValues.map((value, index) => {
    const x = paddingLeft + (index / (profitValues.length - 1)) * innerWidth
    const y = paddingTop + innerHeight - (value / maxValue) * innerHeight
    return { x, y }
  })

  const saleLinePath = salePoints
    .map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )
    .join(' ')

  const profitLinePath = profitPoints
    .map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )
    .join(' ')

  const saleAreaPath = `${saleLinePath} L ${(
    paddingLeft + innerWidth
  ).toFixed(2)} ${(paddingTop + innerHeight).toFixed(2)} L ${paddingLeft.toFixed(
    2
  )} ${(paddingTop + innerHeight).toFixed(2)} Z`

  return (
    <div className="faktury-page__overview-chart rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_12px_24px_rgba(15,23,42,0.1)]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[170px] w-full"
        role="img"
        aria-label="Přehled fakturováno a zisk"
      >
        {Array.from({ length: tickCount + 1 }).map((_, index) => {
          const ratio = index / tickCount
          const tickValue = maxValue * (1 - ratio)
          const y = paddingTop + ratio * innerHeight

          return (
            <g key={index}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={paddingLeft + innerWidth}
                y2={y}
                stroke="#E5E7EB"
                strokeWidth="1"
              />
              <text
                x={paddingLeft - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#6B7280"
              >
                {formatChartMoneyTick(Math.max(0, tickValue))}
              </text>
            </g>
          )
        })}

        <path d={saleAreaPath} fill="rgba(41, 128, 185, 0.10)" />
        <path
          d={saleLinePath}
          fill="none"
          stroke="#2980B9"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={profitLinePath}
          fill="none"
          stroke="#1F3A5F"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={saleLinePath}
          fill="none"
          stroke="#7FD3FF"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="finance-chart-energy finance-chart-energy--sale hidden lg:block"
        />
        <path
          d={profitLinePath}
          fill="none"
          stroke="#9BC7FF"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="finance-chart-energy finance-chart-energy--profit hidden lg:block"
        />

        {salePoints.map((point, index) => {
          const saleValue = saleValues[index] ?? 0
          const profitValue = profitValues[index] ?? 0
          const month = months[index] ?? ''
          const xStart =
            index === 0
              ? paddingLeft
              : paddingLeft + ((index - 0.5) / (months.length - 1)) * innerWidth
          const xEnd =
            index === months.length - 1
              ? paddingLeft + innerWidth
              : paddingLeft + ((index + 0.5) / (months.length - 1)) * innerWidth
          const zoneWidth = Math.max(1, xEnd - xStart)

          return (
            <g key={`${month}-${index}`}>
              <rect
                x={xStart}
                y={paddingTop}
                width={zoneWidth}
                height={innerHeight}
                fill="transparent"
              >
                <title>{`${month} · PRODEJ: ${formatCurrency(
                  saleValue
                )} · ZISK: ${formatCurrency(profitValue)}`}</title>
              </rect>
              <circle
                cx={point.x}
                cy={point.y}
                r="1.8"
                fill="#2980B9"
                fillOpacity="0.9"
              >
                <title>{`PRODEJ: ${formatCurrency(saleValue)}`}</title>
              </circle>
              <circle
                cx={profitPoints[index]?.x ?? point.x}
                cy={profitPoints[index]?.y ?? point.y}
                r="1.8"
                fill="#1F3A5F"
                fillOpacity="0.9"
              >
                <title>{`ZISK: ${formatCurrency(profitValue)}`}</title>
              </circle>
            </g>
          )
        })}

        {months.map((month, index) => {
          const x = paddingLeft + (index / (months.length - 1)) * innerWidth
          const textAnchor =
            index === 0 ? 'start' : index === months.length - 1 ? 'end' : 'middle'
          return (
            <text
              key={month}
              x={x}
              y={height - 5}
              textAnchor={textAnchor}
              fontSize="10.5"
              fill="#6B7280"
            >
              {month}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
