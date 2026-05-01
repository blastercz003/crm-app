import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NewJobButton } from './new-job-button'
import { JobsInteractiveTable } from './jobs-interactive-table'
import { PrintJobsButton } from './print-jobs-button'

export const metadata: Metadata = {
  title: 'Zakázky',
}

export type JobStatus =
  | 'nova'
  | 'k_reseni'
  | 'realizace'
  | 'ukoncena'
  | 'storno'

export type InvoiceStatus =
  | 'bez_faktury'
  | 'k_fakturaci'
  | 'vyfakturovano'

export type EvidenceStatus = 'nove' | 'zapsano'

export type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA' | 'NONAME'
export type ViewMode = 'all' | 'active'
export type SortMode = 'job_number_desc' | 'start_nearest'

export type JobRow = {
  id: string
  job_number: string
  client_id?: string | null
  client_contact_id?: string | null
  company_name: string
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  job_status: JobStatus
  invoice_status: InvoiceStatus
  evidence_status: EvidenceStatus
  created_at: string
  updated_at: string
}

type ClientSuggestionRow = {
  id: string
  name: string | null
}

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

type ProfilePermissionRow = {
  can_view_jobs: boolean | null
  role: string | null
}

type JobsSearchParams = {
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

  return search ? `/jobs?${search}` : '/jobs'
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Promise<JobsSearchParams>
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
    .select('can_view_jobs, role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfilePermissionRow | null
  const isAdmin = typedProfile?.role === 'admin'

  if (!isAdmin && !typedProfile?.can_view_jobs) {
    redirect('/dashboard')
  }

  let clientsRequest = supabase
    .from('clients')
    .select('id, name')
    .order('name', { ascending: true })

  if (!isAdmin) {
    clientsRequest = clientsRequest.eq('created_by', user.id)
  }

  const { data: clientSuggestionsData, error: clientsError } =
    await clientsRequest

  if (clientsError) {
    throw new Error('Nepodařilo se načíst firmy pro našeptávání.')
  }

  const clientOptions = Array.from(
    new Map(
      ((clientSuggestionsData ?? []) as ClientSuggestionRow[])
        .map((item) => ({
          id: String(item.id ?? '').trim(),
          name: item.name?.trim() ?? '',
        }))
        .filter(
          (item): item is ClientOption =>
            Boolean(item.id) && Boolean(item.name)
        )
        .map((item) => [item.id, item])
    ).values()
  )

  let request = supabase.from('jobs').select('*')

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

  let contactsRequest = supabase
    .from('client_contacts')
    .select('id, client_id, name, is_primary')
    .order('is_primary', { ascending: false })
    .order('name', { ascending: true })

  if (!isAdmin) {
    const visibleClientIds = clientOptions.map((client) => client.id)

    if (visibleClientIds.length > 0) {
      contactsRequest = contactsRequest.in('client_id', visibleClientIds)
    } else {
      contactsRequest = contactsRequest.eq(
        'client_id',
        '00000000-0000-0000-0000-000000000000'
      )
    }
  }

  const [
    { data: jobs, error },
    { data: clientContactsData, error: contactsError },
  ] = await Promise.all([request, contactsRequest])

  if (error) {
    throw new Error('Nepodařilo se načíst zakázky.')
  }

  if (contactsError) {
    throw new Error('Nepodařilo se načíst kontaktní osoby klientů.')
  }

  const typedJobs = (jobs ?? []) as JobRow[]

  const clientContacts = ((clientContactsData ?? []) as ClientContactOption[])
    .map((item) => ({
      id: String(item.id ?? '').trim(),
      client_id: String(item.client_id ?? '').trim(),
      name: item.name?.trim() ?? '',
      is_primary: Boolean(item.is_primary),
    }))
    .filter((item) => Boolean(item.id) && Boolean(item.client_id) && Boolean(item.name))

  const hasActiveFilters = Boolean(
    query || jobStatus || view !== 'all' || dateFrom || dateTo
  )

  return (
    <>
      <style>
        {`
          @media print {
            @page {
              size: A4 landscape;
              margin: 10mm;
            }

            html,
            body {
              background: #ffffff !important;
            }

            .print-hidden {
              display: none !important;
            }

            .print-shell {
              max-width: 100% !important;
              padding: 0 !important;
              margin: 0 !important;
              gap: 10px !important;
            }

            .print-header {
              border: 1px solid #d1d5db !important;
              box-shadow: none !important;
              padding: 12px !important;
              border-radius: 14px !important;
            }

            .print-filters-summary {
              display: flex !important;
              flex-wrap: wrap !important;
              gap: 6px !important;
            }

            .print-table-section {
              display: block !important;
              border: 1px solid #d1d5db !important;
              box-shadow: none !important;
              border-radius: 14px !important;
              padding: 6px !important;
              overflow: visible !important;
            }
          }
        `}
      </style>

      <main className="min-h-screen bg-gray-50">
        <div className="print-shell mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <section className="print-header rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
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

              <div className="print-hidden flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <form
                  action="/jobs"
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
  className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
>
  ZPĚT NA DASHBOARD
</Link>

                <NewJobButton
                  clientSuggestions={clientOptions}
                  clientContacts={clientContacts}
                  isAdmin={isAdmin}
                  className="inline-flex items-center justify-center rounded-2xl bg-[#2980B9] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#236f9f]"
                />
              </div>
            </div>
          </section>

          <section className="print-header rounded-3xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
            <form action="/jobs" method="get" className="space-y-3">
              <input type="hidden" name="q" value={query} />

              <div className="print-hidden grid gap-2 xl:grid-cols-5">
                <div>
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

                <div className="min-w-0">
                  <label
                    htmlFor="date_from"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Od dne
                  </label>
                  <div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 transition focus-within:border-gray-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-gray-200 sm:overflow-visible sm:border-0 sm:bg-transparent sm:focus-within:border-0 sm:focus-within:bg-transparent sm:focus-within:ring-0">
                    <input
                      id="date_from"
                      name="date_from"
                      type="date"
                      defaultValue={dateFrom}
                      className="block h-9 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm text-gray-900 outline-none sm:rounded-xl sm:border sm:border-gray-200 sm:bg-gray-50 sm:transition sm:focus:border-gray-300 sm:focus:bg-white sm:focus:ring-2 sm:focus:ring-gray-200"
                    />
                  </div>
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="date_to"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Do dne
                  </label>
                  <div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 transition focus-within:border-gray-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-gray-200 sm:overflow-visible sm:border-0 sm:bg-transparent sm:focus-within:border-0 sm:focus-within:bg-transparent sm:focus-within:ring-0">
                    <input
                      id="date_to"
                      name="date_to"
                      type="date"
                      defaultValue={dateTo}
                      className="block h-9 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm text-gray-900 outline-none sm:rounded-xl sm:border sm:border-gray-200 sm:bg-gray-50 sm:transition sm:focus:border-gray-300 sm:focus:bg-white sm:focus:ring-2 sm:focus:ring-gray-200"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="print-filters-summary flex flex-wrap items-center gap-2 text-xs text-gray-600">
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

                <div className="print-hidden flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="h-px bg-gray-100 sm:hidden" />

                  <div className="flex flex-wrap items-center gap-2 sm:contents">
                    <PrintJobsButton />

                    <button
                      type="submit"
                      className="inline-flex h-9 items-center justify-center rounded-xl bg-black px-4 text-sm font-medium uppercase text-white transition hover:bg-gray-800 sm:order-4"
                    >
                      POUŽÍT FILTRY
                    </button>

                    <Link
                      href="/jobs"
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
                    : 'Zatím tu nejsou žádné zakázky.'}
                </h2>

                <p className="text-sm leading-6 text-gray-500">
                  {hasActiveFilters
                    ? 'Zkus upravit hledání nebo změnit aktivní filtry a řazení.'
                    : 'Jakmile přidáš první zakázku, zobrazí se zde přehled všech realizací.'}
                </p>
              </div>
            </section>
          ) : (
            <div className="print-table-section">
              <JobsInteractiveTable
                jobs={typedJobs}
                clientSuggestions={clientOptions}
                clientContacts={clientContacts}
                isAdmin={isAdmin}
              />
            </div>
          )}
        </div>
      </main>
    </>
  )
}
