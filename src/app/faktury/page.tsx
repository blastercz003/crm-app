import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FakturyInteractiveTable } from './faktury-interactive-table'

export type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA' | 'NONAME'
export type SortMode = 'start_nearest' | 'job_number_desc' | 'sale_desc'

export type FakturaRow = {
  id: string
  job_id: string
  job_number: string
  company_name: string
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  info_note: string | null
  invoice_number: string | null
  sale_amount: number | null
  cost_amount: number | null
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
        job_number: string
        company_name: string
        contact_person: string | null
        sales_owner: SalesOwner
        start_at: string
        end_at: string
        site_address: string | null
        store_number: string | null
      }
    | {
        id: string
        job_number: string
        company_name: string
        contact_person: string | null
        sales_owner: SalesOwner
        start_at: string
        end_at: string
        site_address: string | null
        store_number: string | null
      }[]
    | null
}

type JobIdRow = {
  id: string
}

const SALES_OWNER_OPTIONS: SalesOwner[] = ['JIŘÍ', 'MICHAL', 'LÍDA', 'NONAME']

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
    `job_number.ilike.%${escaped}%`,
    `company_name.ilike.%${escaped}%`,
    `contact_person.ilike.%${escaped}%`,
    `site_address.ilike.%${escaped}%`,
    `store_number.ilike.%${escaped}%`,
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

function getCurrentMonthValue() {
  const today = getPragueTodayParts()
  return `${today.year}-${String(today.month).padStart(2, '0')}`
}

function getProfit(saleAmount: number | null, costAmount: number | null) {
  const sale = typeof saleAmount === 'number' ? saleAmount : 0
  const cost = typeof costAmount === 'number' ? costAmount : 0
  return sale - cost
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)
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

  const currentMonth = getCurrentMonthValue()

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
        job_number,
        company_name,
        contact_person,
        sales_owner,
        start_at,
        end_at,
        site_address,
        store_number
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

  const { data, error } = await request

  if (error) {
    throw new Error('Nepodařilo se načíst fakturaci.')
  }

  let rows: FakturaRow[] = ((data ?? []) as JobFinanceJoinRow[])
    .map((item) => {
      const job = Array.isArray(item.job) ? item.job[0] : item.job

      if (!job) return null

      return {
        id: item.id,
        job_id: item.job_id,
        job_number: job.job_number,
        company_name: job.company_name,
        contact_person: job.contact_person,
        sales_owner: job.sales_owner,
        start_at: job.start_at,
        end_at: job.end_at,
        site_address: job.site_address,
        store_number: job.store_number,
        info_note: item.info_note,
        invoice_number: item.invoice_number,
        sale_amount:
          typeof item.sale_amount === 'number' ? item.sale_amount : null,
        cost_amount:
          typeof item.cost_amount === 'number' ? item.cost_amount : null,
      }
    })
    .filter((item): item is FakturaRow => Boolean(item))

  if (sort === 'start_nearest') {
    rows = [...rows].sort((a, b) => {
      const dateDiff =
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime()

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

  const currentMonthRows = rows.filter(
    (row) => row.start_at.slice(0, 7) === currentMonth
  )

  const totalSale = rows.reduce(
    (sum, row) =>
      sum + (typeof row.sale_amount === 'number' ? row.sale_amount : 0),
    0
  )

  const currentMonthSale = currentMonthRows.reduce(
    (sum, row) =>
      sum + (typeof row.sale_amount === 'number' ? row.sale_amount : 0),
    0
  )

  const totalProfit = rows.reduce(
    (sum, row) => sum + getProfit(row.sale_amount, row.cost_amount),
    0
  )

  const currentMonthProfit = currentMonthRows.reduce(
    (sum, row) => sum + getProfit(row.sale_amount, row.cost_amount),
    0
  )

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

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center">
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
                  className="w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200 sm:w-56 lg:w-72"
                />

                <button
                  type="submit"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium uppercase text-gray-700 transition hover:bg-gray-50"
                >
                  HLEDAT
                </button>
              </form>

              <Link
  href="/dashboard"
  className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
>
  ZPĚT NA DASHBOARD
</Link>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <form action="/faktury" method="get" className="space-y-4">
              <input type="hidden" name="q" value={query} />

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label
                    htmlFor="sales"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Obchodník
                  </label>
                  <select
                    id="sales"
                    name="sales"
                    defaultValue={salesOwner}
                    className="h-10 w-full rounded-2xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
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
                    htmlFor="sort"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Řazení
                  </label>
                  <select
                    id="sort"
                    name="sort"
                    defaultValue={sort}
                    className="h-10 w-full rounded-2xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                  >
                    <option value="job_number_desc">Dle čísla zakázky</option>
                    <option value="start_nearest">Dle data od (nejbližší)</option>
                    <option value="sale_desc">Dle prodeje</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="invoiced"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Faktura
                  </label>
                  <select
                    id="invoiced"
                    name="invoiced"
                    defaultValue={invoiced}
                    className="h-10 w-full rounded-2xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                  >
                    <option value="">Všechny</option>
                    <option value="yes">Jen s číslem faktury</option>
                    <option value="no">Jen bez čísla faktury</option>
                  </select>
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="date_from"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Od dne
                  </label>
                  <input
                    id="date_from"
                    name="date_from"
                    type="date"
                    defaultValue={dateFrom}
                    className="block h-10 min-w-0 w-full max-w-full rounded-2xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="date_to"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Do dne
                  </label>
                  <input
                    id="date_to"
                    name="date_to"
                    type="date"
                    defaultValue={dateTo}
                    className="block h-10 min-w-0 w-full max-w-full rounded-2xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center rounded-2xl bg-gray-900 px-4 text-sm font-medium uppercase text-white transition hover:bg-gray-800"
                >
                  POUŽÍT FILTRY
                </button>

                <Link
                  href="/faktury"
                  className="inline-flex h-10 items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 text-sm font-medium uppercase text-gray-700 transition hover:bg-gray-50"
                >
                  UPDATE
                </Link>

                <Link
                  href={exportHref}
                  className="inline-flex h-10 items-center justify-center rounded-2xl border border-[#2980B9] bg-[#2980B9] px-4 text-sm font-medium uppercase text-white transition hover:bg-[#236f9f] hover:border-[#236f9f]"
                >
                  EXPORT
                </Link>
              </div>

              <div className="border-t border-gray-100 pt-3">
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
          </section>

          <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              Přehled
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Vyfakturováno celkem"
                value={formatCurrency(totalSale)}
                accent="blue"
              />
              <StatCard
                label="Vyfakturováno tento měsíc"
                value={formatCurrency(currentMonthSale)}
                accent="blueSoft"
              />
              <StatCard
                label="Zisk celkem"
                value={formatCurrency(totalProfit)}
                valueClassName={totalProfit < 0 ? 'text-red-600' : 'text-black'}
              />
              <StatCard
                label="Zisk tento měsíc"
                value={formatCurrency(currentMonthProfit)}
                valueClassName={
                  currentMonthProfit < 0 ? 'text-red-600' : 'text-black'
                }
              />
            </div>
          </section>
        </section>

        {rows.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm">
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
          <FakturyInteractiveTable rows={rows} />
        )}
      </div>
    </main>
  )
}

function StatCard({
  label,
  value,
  valueClassName = 'text-black',
  accent = 'default',
}: {
  label: string
  value: string
  valueClassName?: string
  accent?: 'default' | 'blue' | 'blueSoft'
}) {
  const accentClass =
    accent === 'blue'
      ? 'border-[#2980B9]/20 bg-white'
      : accent === 'blueSoft'
        ? 'border-[#2980B9]/20 bg-[#2980B9]/[0.05]'
        : 'border-gray-200 bg-gray-50'

  const topBarClass =
    accent === 'blue' || accent === 'blueSoft'
      ? 'bg-[#2980B9]'
      : 'bg-gray-200'

  return (
    <div className={`overflow-hidden rounded-2xl border ${accentClass}`}>
      <div className={`h-[2px] w-full ${topBarClass}`} />
      <div className="p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
          {label}
        </div>
        <div
          className={`mt-2 text-lg font-semibold tracking-tight ${valueClassName}`}
        >
          <span className={valueClassName}>{value}</span>
        </div>
      </div>
    </div>
  )
}
