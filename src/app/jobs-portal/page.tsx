import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { JobsPortalTable } from './jobs-portal-table'

type JobStatus =
  | 'nova'
  | 'k_reseni'
  | 'realizace'
  | 'ukoncena'
  | 'storno'

type SalesOwner = 'MICHAL' | 'LÍDA'
type ViewMode = 'all' | 'active'
type SortMode = 'job_number_desc' | 'start_nearest'

type PortalJobRow = {
  id: string
  job_number: string
  company_name: string
  contact_person: string | null
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  sales_owner: SalesOwner
}

type ProfilePermissionRow = {
  can_view_jobs_portal: boolean | null
  jobs_sales_scope: SalesOwner | null
  role: string | null
}

type JobsPortalSearchParams = {
  q?: string
  status?: string
  view?: string
  sort?: string
  date_from?: string
  date_to?: string
}

const JOB_STATUS_OPTIONS: JobStatus[] = [
  'nova',
  'k_reseni',
  'realizace',
  'ukoncena',
  'storno',
]

function buildSearchFilter(search: string) {
  const escaped = search.replaceAll(',', ' ').trim()

  return [
    `company_name.ilike.%${escaped}%`,
    `technician_name.ilike.%${escaped}%`,
    `site_address.ilike.%${escaped}%`,
    `generator_name.ilike.%${escaped}%`,
    `contact_person.ilike.%${escaped}%`,
    `job_number.ilike.%${escaped}%`,
    `store_number.ilike.%${escaped}%`,
  ].join(',')
}

function isJobStatus(value: string | undefined): value is JobStatus {
  return JOB_STATUS_OPTIONS.includes(value as JobStatus)
}

function isViewMode(value: string | undefined): value is ViewMode {
  return value === 'all' || value === 'active'
}

function isSortMode(value: string | undefined): value is SortMode {
  return value === 'job_number_desc' || value === 'start_nearest'
}

function getSortLabel(sort: SortMode) {
  return sort === 'start_nearest' ? 'Dle začátku' : 'Dle čísla zakázky'
}

function getViewLabel(view: ViewMode) {
  return view === 'active' ? 'Pouze aktivní' : 'Všechny'
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

function toDateOnly(value: Date) {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function addDaysUtc(value: Date, days: number) {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function getTodayRange() {
  const today = getPragueTodayParts()
  const pragueDateAsUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0)
  )

  const date = toDateOnly(pragueDateAsUtc)

  return {
    from: date,
    to: date,
  }
}

function getWeekRange(offsetWeeks = 0) {
  const today = getPragueTodayParts()
  const pragueDateAsUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0)
  )

  const day = pragueDateAsUtc.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = addDaysUtc(pragueDateAsUtc, mondayOffset + offsetWeeks * 7)
  const sunday = addDaysUtc(monday, 6)

  return {
    from: toDateOnly(monday),
    to: toDateOnly(sunday),
  }
}

function buildWeekFilterHref({
  query,
  jobStatus,
  view,
  dateFrom,
  dateTo,
}: {
  query: string
  jobStatus: string
  view: ViewMode
  dateFrom: string
  dateTo: string
}) {
  const params = new URLSearchParams()

  if (query) params.set('q', query)
  if (jobStatus) params.set('status', jobStatus)
  if (view) params.set('view', view)
  params.set('sort', 'start_nearest')
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo) params.set('date_to', dateTo)

  const search = params.toString()

  return search ? `/jobs-portal?${search}` : '/jobs-portal'
}

export default async function JobsPortalPage({
  searchParams,
}: {
  searchParams?: Promise<JobsPortalSearchParams>
}) {
  const params = searchParams ? await searchParams : undefined

  const query = params?.q?.trim() ?? ''
  const jobStatus = isJobStatus(params?.status) ? params?.status : ''
  const view = isViewMode(params?.view) ? params?.view : 'all'
  const sort = isSortMode(params?.sort) ? params?.sort : 'job_number_desc'
  const dateFrom = params?.date_from?.trim() ?? ''
  const dateTo = params?.date_to?.trim() ?? ''

  const todayRange = getTodayRange()
  const thisWeekRange = getWeekRange(0)
  const nextWeekRange = getWeekRange(1)

  const isTodayActive =
    dateFrom === todayRange.from && dateTo === todayRange.to
  const isThisWeekActive =
    dateFrom === thisWeekRange.from && dateTo === thisWeekRange.to
  const isNextWeekActive =
    dateFrom === nextWeekRange.from && dateTo === nextWeekRange.to

  const todayHref = buildWeekFilterHref({
    query,
    jobStatus,
    view,
    dateFrom: todayRange.from,
    dateTo: todayRange.to,
  })

  const thisWeekHref = buildWeekFilterHref({
    query,
    jobStatus,
    view,
    dateFrom: thisWeekRange.from,
    dateTo: thisWeekRange.to,
  })

  const nextWeekHref = buildWeekFilterHref({
    query,
    jobStatus,
    view,
    dateFrom: nextWeekRange.from,
    dateTo: nextWeekRange.to,
  })

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('can_view_jobs_portal, jobs_sales_scope, role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfilePermissionRow | null

  if (!typedProfile?.can_view_jobs_portal) {
    redirect('/dashboard')
  }

  const allowedSalesOwners: SalesOwner[] =
    typedProfile.role === 'admin'
      ? ['MICHAL', 'LÍDA']
      : typedProfile.jobs_sales_scope
        ? [typedProfile.jobs_sales_scope]
        : []

  if (allowedSalesOwners.length === 0) {
    throw new Error('Uživatel nemá nastavený rozsah zakázek pro portál.')
  }

  let request = supabase
    .from('jobs')
    .select(`
      id,
      job_number,
      company_name,
      contact_person,
      start_at,
      end_at,
      site_address,
      store_number,
      technician_name,
      generator_name,
      info_note,
      sales_owner,
      job_status
    `)
    .in('sales_owner', allowedSalesOwners)

  if (query) {
    request = request.or(buildSearchFilter(query))
  }

  if (jobStatus) {
    request = request.eq('job_status', jobStatus)
  }

  if (view === 'active') {
    request = request.in('job_status', ['nova', 'k_reseni', 'realizace'])
  }

  if (dateFrom) {
    request = request.gte('start_at', `${dateFrom}T00:00:00`)
  }

  if (dateTo) {
    request = request.lte('start_at', `${dateTo}T23:59:59`)
  }

  if (sort === 'start_nearest') {
    request = request.order('start_at', { ascending: true })
  } else {
    request = request.order('job_number', { ascending: false })
  }

  const { data: jobs, error: jobsError } = await request

  if (jobsError) {
    throw new Error('Nepodařilo se načíst zakázky pro portál.')
  }

  const typedJobs = (jobs ?? []) as PortalJobRow[]
  const hasActiveFilters = Boolean(
    query || jobStatus || view !== 'all' || dateFrom || dateTo
  )

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
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

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
              <form
                action="/jobs-portal"
                method="get"
                className="flex w-full gap-3 sm:w-auto"
              >
                <input type="hidden" name="status" value={jobStatus} />
                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="sort" value={sort} />
                <input type="hidden" name="date_from" value={dateFrom} />
                <input type="hidden" name="date_to" value={dateTo} />

                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Hledat adresu, technika, firmu"
                  className="w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200 sm:w-56 lg:w-72"
                />

                <button
                  type="submit"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="inline-flex w-full items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 sm:w-auto"
              >
                ZPĚT NA DASHBOARD
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
          <form action="/jobs-portal" method="get" className="space-y-3">
            <input type="hidden" name="q" value={query} />

            <div className="grid gap-2 xl:grid-cols-5">
              <div className="min-w-0">
                <label
                  htmlFor="status"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                >
                  Stav zakázky
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={jobStatus}
                  className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                >
                  <option value="">Všechny</option>
                  <option value="nova">Nová</option>
                  <option value="k_reseni">V řešení</option>
                  <option value="realizace">Realizace</option>
                  <option value="ukoncena">Ukončená</option>
                  <option value="storno">Storno</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="view"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                >
                  Zobrazení
                </label>
                <select
                  id="view"
                  name="view"
                  defaultValue={view}
                  className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                >
                  <option value="all">Vše</option>
                  <option value="active">Aktivní</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="sort"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                >
                  Řazení
                </label>
                <select
                  id="sort"
                  name="sort"
                  defaultValue={sort}
                  className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                >
                  <option value="job_number_desc">Dle čísla zakázky</option>
                  <option value="start_nearest">Dle data od (nejbližší)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="date_from"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                >
                  Od dne
                </label>
                <input
                  id="date_from"
                  name="date_from"
                  type="date"
                  defaultValue={dateFrom}
                  className="h-9 w-full max-w-full min-w-0 appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                />
              </div>

              <div className="min-w-0">
                <label
                  htmlFor="date_to"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                >
                  Do dne
                </label>
                <input
                  id="date_to"
                  name="date_to"
                  type="date"
                  defaultValue={dateTo}
                  className="h-9 w-full max-w-full min-w-0 appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                  Řazení:{' '}
                  <span className="ml-1 font-medium text-gray-900">
                    {getSortLabel(sort)}
                  </span>
                </span>

                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                  Zobrazení:{' '}
                  <span className="ml-1 font-medium text-gray-900">
                    {getViewLabel(view)}
                  </span>
                </span>

                {query ? (
                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                    Hledání:{' '}
                    <span className="ml-1 font-medium text-gray-900">
                      {query}
                    </span>
                  </span>
                ) : null}

                {dateFrom ? (
                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                    Od:{' '}
                    <span className="ml-1 font-medium text-gray-900">
                      {dateFrom}
                    </span>
                  </span>
                ) : null}

                {dateTo ? (
                  <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                    Do:{' '}
                    <span className="ml-1 font-medium text-gray-900">
                      {dateTo}
                    </span>
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:border-t-0 sm:pt-0">
                <div className="flex flex-wrap items-center gap-2 sm:contents">
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center justify-center rounded-xl bg-black px-4 text-sm font-medium uppercase text-white transition hover:bg-gray-800 sm:order-4"
                  >
                    POUŽÍT FILTRY
                  </button>

                  <Link
                    href="/jobs-portal"
                    className="inline-flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium uppercase text-gray-700 transition hover:bg-gray-50 sm:order-5"
                  >
                    RESET
                  </Link>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:contents">
                  <Link
                    href={todayHref}
                    className={`inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-medium text-white transition sm:order-1 ${
                      isTodayActive
                        ? 'bg-[#236f9f] shadow-sm'
                        : 'bg-[#2980B9] hover:bg-[#236f9f]'
                    }`}
                  >
                    DNES
                  </Link>

                  <Link
                    href={thisWeekHref}
                    className={`inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-medium text-white transition sm:order-2 ${
                      isThisWeekActive
                        ? 'bg-[#236f9f] shadow-sm'
                        : 'bg-[#2980B9] hover:bg-[#236f9f]'
                    }`}
                  >
                    TENTO TÝDEN
                  </Link>

                  <Link
                    href={nextWeekHref}
                    className={`inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-medium text-white transition sm:order-3 ${
                      isNextWeekActive
                        ? 'bg-[#236f9f] shadow-sm'
                        : 'bg-[#2980B9] hover:bg-[#236f9f]'
                    }`}
                  >
                    PŘÍŠTÍ TÝDEN
                  </Link>
                </div>
              </div>
            </div>
          </form>
        </section>

        {typedJobs.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto max-w-xl space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">
                {hasActiveFilters
                  ? 'Žádná zakázka neodpovídá aktuálním filtrům.'
                  : 'Pro tohoto uživatele teď nejsou k dispozici žádné zakázky.'}
              </h2>

              <p className="text-sm leading-6 text-gray-500">
                {hasActiveFilters
                  ? 'Zkus upravit hledání nebo změnit aktivní filtry a řazení.'
                  : 'Jakmile budou existovat zakázky přiřazené k odpovídajícímu obchodníkovi, zobrazí se zde.'}
              </p>
            </div>
          </section>
        ) : (
          <div>
            <JobsPortalTable jobs={typedJobs} />
          </div>
        )}
      </div>
    </main>
  )
}
