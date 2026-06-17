import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { canViewTechJobsSection } from '@/lib/auth/access'
import { JobCalendarButton } from '../jobs/job-calendar-button'
import { JobsInteractiveTable } from '../jobs/jobs-interactive-table'
import { JobFilterResetLink } from '../jobs/job-filter-reset-link'
import { JobFilterSubmitButton } from '../jobs/job-filter-submit-button'
import { PrintJobsButton } from '../jobs/print-jobs-button'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { hasJobInfoContent } from '../jobs/info-note-shared'

export const metadata: Metadata = {
  title: 'Moje zakázky',
}

type SearchParams = {
  q?: string | string[]
  status?: string | string[]
  view?: string | string[]
  sort?: string | string[]
  date_from?: string | string[]
  date_to?: string | string[]
}

type ProfileRow = {
  role: string | null
  can_view_tech_jobs: boolean | null
}

type JobCalendarFeedRow = {
  user_id: string
  token: string
  enabled: boolean
  disabled_at: string | null
}

type JobGoogleCalendarIntegrationRow = {
  user_id: string
  calendar_id: string | null
  enabled: boolean
  disabled_at: string | null
}

type JobRow = {
  id: string
  job_number: string
  client_id?: string | null
  client_contact_id?: string | null
  company_name: string
  contact_person: string | null
  sales_owner: 'JIŘÍ' | 'MICHAL' | 'LÍDA'
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  info_alert_enabled?: boolean | null
  has_info_attachments?: boolean
  has_info_content?: boolean
  handover_protocol_is_sent?: boolean | null
  job_status: 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
  invoice_status: 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'
  evidence_status: 'nove' | 'zapsano'
  created_at: string
  updated_at: string
}

type AssignedJobRow = {
  job_id: string
}

type JobFinanceVisibilityRow = {
  job_id: string
  invoice_number: string | null
}

type HandoverProtocolStateRow = {
  job_id: string
  is_sent: boolean | null
}

type JobStatus = 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
type ViewMode = 'all' | 'active'
type SortMode = 'job_number_desc' | 'start_nearest'

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

function getSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }
  return value ?? ''
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

function getTomorrowRange() {
  const today = getPragueTodayParts()
  const pragueDateAsUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0)
  )
  const tomorrow = addDaysUtc(pragueDateAsUtc, 1)
  const date = toDateOnly(tomorrow)

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

  return search ? `/zakazky-techniku?${search}` : '/zakazky-techniku'
}

function getSortLabel(sort: SortMode) {
  return sort === 'start_nearest' ? 'Dle začátku' : 'Dle čísla zakázky'
}

function getViewLabel(view: ViewMode) {
  return view === 'active' ? 'Pouze aktivní' : 'Všechny'
}

export default async function ZakazkyTechnikuPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const query = getSingleParam(params?.q).trim()
  const statusParam = getSingleParam(params?.status)
  const viewParam = getSingleParam(params?.view)
  const sortParam = getSingleParam(params?.sort)
  const dateFromParam = getSingleParam(params?.date_from)
  const dateToParam = getSingleParam(params?.date_to)

  const jobStatus = isJobStatus(statusParam) ? statusParam : ''
  const view = isViewMode(viewParam) ? viewParam : 'all'
  const sort = isSortMode(sortParam) ? sortParam : 'job_number_desc'
  const dateFrom = dateFromParam.trim()
  const dateTo = dateToParam.trim()

  const todayRange = getTodayRange()
  const tomorrowRange = getTomorrowRange()
  const thisWeekRange = getWeekRange(0)
  const nextWeekRange = getWeekRange(1)

  const isTodayActive =
    dateFrom === todayRange.from && dateTo === todayRange.to
  const isTomorrowActive =
    dateFrom === tomorrowRange.from && dateTo === tomorrowRange.to
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

  const tomorrowHref = buildWeekFilterHref({
    query,
    jobStatus,
    view,
    dateFrom: tomorrowRange.from,
    dateTo: tomorrowRange.to,
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
    .select('role, can_view_tech_jobs')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfileRow | null
  const role = typedProfile?.role ?? null

  if (!canViewTechJobsSection(role, typedProfile)) {
    redirect('/dashboard')
  }

  const isAdmin = role === 'admin'

  const { data: jobCalendarFeed, error: jobCalendarFeedError } = await supabase
    .from('job_calendar_feeds')
    .select('user_id, token, enabled, disabled_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (jobCalendarFeedError) {
    throw new Error(
      `Nepodařilo se načíst stav kalendáře zakázek: ${jobCalendarFeedError.message}`
    )
  }

  const typedJobCalendarFeed = jobCalendarFeed as JobCalendarFeedRow | null
  const isJobCalendarActivated = Boolean(
    typedJobCalendarFeed &&
      typedJobCalendarFeed.enabled &&
      !typedJobCalendarFeed.disabled_at
  )
  const initialJobCalendarFeedPath = typedJobCalendarFeed?.token
    ? `/api/job-calendars/${typedJobCalendarFeed.token}`
    : null

  let allowedJobIds: string[] = []

  if (!isAdmin) {
    const { data: assignedJobs, error: assignedJobsError } = await supabase
      .from('job_technicians')
      .select('job_id')
      .eq('technician_id', user.id)

    if (assignedJobsError) {
      throw new Error('Nepodařilo se načíst přiřazené zakázky.')
    }

    allowedJobIds = Array.from(
      new Set(
        ((assignedJobs ?? []) as AssignedJobRow[])
          .map((row) => String(row.job_id ?? '').trim())
          .filter((jobId) => Boolean(jobId))
      )
    )
  }

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

  if (dateFrom && dateTo) {
    request = request
      .lte('start_at', `${dateTo}T23:59:59`)
      .gte('end_at', `${dateFrom}T00:00:00`)
  } else {
    if (dateFrom) {
      request = request.gte('start_at', `${dateFrom}T00:00:00`)
    }

    if (dateTo) {
      request = request.lte('start_at', `${dateTo}T23:59:59`)
    }
  }

  if (!isAdmin) {
    if (allowedJobIds.length === 0) {
      request = request.in('id', ['00000000-0000-0000-0000-000000000000'])
    } else {
      request = request.in('id', allowedJobIds)
    }
  }

  if (sort === 'start_nearest') {
    request = request.order('start_at', { ascending: true })
  } else {
    request = request.order('job_number', { ascending: false })
  }

  const { data: jobs, error } = await request

  if (error) {
    throw new Error('Nepodařilo se načíst zakázky technika.')
  }

  const typedJobs = (jobs ?? []) as JobRow[]
  const jobIds = typedJobs.map((job) => job.id)
  const serviceSupabase = getServiceRoleClient()

  if (!serviceSupabase) {
    throw new Error(
      'Chybí SUPABASE_SERVICE_ROLE_KEY nebo NEXT_PUBLIC_SUPABASE_URL pro načtení viditelnosti zakázek technika.'
    )
  }

  const { data: financeRows, error: financeRowsError } =
    jobIds.length > 0
      ? await serviceSupabase
          .from('job_finances')
          .select('job_id, invoice_number')
          .in('job_id', jobIds)
      : { data: [], error: null }

  if (financeRowsError) {
    throw new Error('Nepodařilo se načíst faktury zakázek technika.')
  }

  const hiddenJobIds = new Set(
    ((financeRows ?? []) as JobFinanceVisibilityRow[])
      .filter((row) => Boolean(row.invoice_number?.trim()))
      .map((row) => String(row.job_id))
  )

  const { data: jobGoogleCalendarIntegration, error: jobGoogleCalendarIntegrationError } =
    await serviceSupabase
      .from('job_google_calendar_integrations')
      .select('user_id, calendar_id, enabled, disabled_at')
      .eq('user_id', user.id)
      .maybeSingle()

  if (jobGoogleCalendarIntegrationError) {
    throw new Error(
      `Nepodařilo se načíst stav Google kalendáře zakázek: ${jobGoogleCalendarIntegrationError.message}`
    )
  }

  const typedJobGoogleCalendarIntegration =
    jobGoogleCalendarIntegration as JobGoogleCalendarIntegrationRow | null
  const isJobGoogleCalendarConnected = Boolean(
    typedJobGoogleCalendarIntegration &&
      typedJobGoogleCalendarIntegration.enabled &&
      !typedJobGoogleCalendarIntegration.disabled_at &&
      typedJobGoogleCalendarIntegration.calendar_id
  )

  const visibleJobs = isAdmin
    ? typedJobs
    : typedJobs.filter((job) => !hiddenJobIds.has(job.id))

  const visibleJobIds = visibleJobs.map((job) => job.id)
  const { data: infoAttachmentRows, error: infoAttachmentsError } =
    visibleJobIds.length > 0
      ? await supabase
          .from('job_info_attachments')
          .select('job_id')
          .in('job_id', visibleJobIds)
      : { data: [], error: null }

  if (infoAttachmentsError) {
    throw new Error('Nepodařilo se načíst fotky k info zakázek.')
  }

  const { data: protocolRows, error: protocolError } =
    visibleJobIds.length > 0
      ? await supabase
          .from('handover_protocols')
          .select('job_id, is_sent')
          .in('job_id', visibleJobIds)
      : { data: [], error: null }

  if (protocolError) {
    throw new Error('Nepodařilo se načíst stav předávacích protokolů.')
  }

  const protocolStateByJobId = new Map(
    ((protocolRows ?? []) as HandoverProtocolStateRow[]).map((row) => [
      String(row.job_id),
      Boolean(row.is_sent),
    ])
  )

  const jobsWithInfoState = visibleJobs.map((job) => {
    const hasAttachments = (infoAttachmentRows ?? []).some(
      (row) => String((row as { job_id?: string | null }).job_id ?? '') === job.id
    )

    return {
      ...job,
      has_info_attachments: hasAttachments,
      has_info_content: hasJobInfoContent({
        infoNote: job.info_note,
        hasAttachments,
      }),
      handover_protocol_is_sent: protocolStateByJobId.get(job.id) ?? false,
      info_alert_enabled: Boolean(job.info_alert_enabled),
    }
  })

  const hasActiveFilters = Boolean(
    query || jobStatus || view !== 'all' || dateFrom || dateTo
  )

  return (
    <main className="jobs-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <PresenceSectionTracker section="Moje zakázky" route="/zakazky-techniku" />
      <div
        aria-hidden
        className="jobs-page__glow jobs-page__glow--right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="jobs-page__glow jobs-page__glow--left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />

      <div className="print-shell relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="jobs-page__hero print-header rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
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
              <form action="/zakazky-techniku" method="get" className="flex w-full gap-3 sm:w-auto">
                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Hledat zakázku, město, firmu"
                  className="jobs-page__search-input w-full min-w-0 rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:w-56 lg:w-72"
                />

                <button
                  type="submit"
                  className="clients-page__search-button rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="clients-page__back-button inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                ZPĚT NA DASHBOARD
              </Link>
            </div>
          </div>
        </section>

        <section className="jobs-page__filters-shell print-header rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-4">
          <div className="space-y-3">
            <form action="/zakazky-techniku" method="get" className="print-hidden lg:hidden">
              <input type="hidden" name="q" value={query} />
              <details className="group w-full">
                <summary className="jobs-page__filters-summary flex cursor-pointer list-none items-center justify-between gap-2.5 rounded-xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(242,247,252,0.88)_100%)] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
                  <span className="inline-flex items-center gap-2">
                    FILTRY
                    {hasActiveFilters ? (
                      <span className="inline-flex items-center rounded-full border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.07em] text-[#236f9f]">
                        FILTR AKTIVNÍ
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-zinc-500 transition group-open:rotate-180">⌄</span>
                </summary>

                <div className="jobs-page__filters-panel mt-2 space-y-3 rounded-2xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="status-mobile"
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                      >
                        Stav zakázky
                      </label>
                      <select
                        id="status-mobile"
                        name="status"
                        defaultValue={jobStatus}
                        className="h-9 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
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
                        htmlFor="view-mobile"
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                      >
                        Zobrazení
                      </label>
                      <select
                        id="view-mobile"
                        name="view"
                        defaultValue={view}
                        className="h-9 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      >
                        <option value="all">Vše</option>
                        <option value="active">Aktivní</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="sort-mobile"
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                      >
                        Řazení
                      </label>
                      <select
                        id="sort-mobile"
                        name="sort"
                        defaultValue={sort}
                        className="h-9 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      >
                        <option value="job_number_desc">Dle čísla zakázky</option>
                        <option value="start_nearest">Dle data od (nejbližší)</option>
                      </select>
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="date_from-mobile"
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                      >
                        Od dne
                      </label>
                      <div className="jobs-page__filters-date-shell min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef]">
                        <input
                          id="date_from-mobile"
                          name="date_from"
                          type="date"
                          defaultValue={dateFrom}
                          className="block h-9 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm filter-date-input text-gray-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor="date_to-mobile"
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                      >
                        Do dne
                      </label>
                      <div className="jobs-page__filters-date-shell min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef]">
                        <input
                          id="date_to-mobile"
                          name="date_to"
                          type="date"
                          defaultValue={dateTo}
                          className="block h-9 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm filter-date-input text-gray-900 outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="jobs-page__filter-divider flex items-center gap-2 border-t border-gray-100 pt-3">
                    <JobFilterSubmitButton className="jobs-page__filter-submit inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800">
                      POUŽÍT FILTRY
                    </JobFilterSubmitButton>

                    <JobFilterResetLink
                      href="/zakazky-techniku"
                      className="jobs-page__filter-reset inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
                    >
                      RESET
                    </JobFilterResetLink>

                    <PrintJobsButton className="jobs-page__print-button" />
                  </div>

                  <div className="mt-2 flex">
                    <JobCalendarButton
                      initiallyActivated={isJobCalendarActivated}
                      initialFeedPath={initialJobCalendarFeedPath}
                      initialGoogleConnected={isJobGoogleCalendarConnected}
                    />
                  </div>
                </div>
              </details>
            </form>

            <div className="print-hidden mt-2 grid grid-cols-4 gap-2 lg:hidden">
              <Link
                href={todayHref}
                data-active={isTodayActive}
                className={`jobs-page__range-link inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-xl border px-0.5 text-[10px] font-medium uppercase tracking-[0.01em] transition duration-200 hover:-translate-y-[1px] ${
                  isTodayActive
                    ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
                    : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]'
                }`}
              >
                DNES
              </Link>

              <Link
                href={tomorrowHref}
                data-active={isTomorrowActive}
                className={`jobs-page__range-link inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-xl border px-0.5 text-[10px] font-medium uppercase tracking-[0.01em] transition duration-200 hover:-translate-y-[1px] ${
                  isTomorrowActive
                    ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
                    : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]'
                }`}
              >
                ZÍTRA
              </Link>

              <Link
                href={thisWeekHref}
                data-active={isThisWeekActive}
                className={`jobs-page__range-link inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-xl border px-0.5 text-[10px] font-medium uppercase tracking-[0.01em] transition duration-200 hover:-translate-y-[1px] ${
                  isThisWeekActive
                    ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
                    : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]'
                }`}
              >
                TENTO T.
              </Link>

              <Link
                href={nextWeekHref}
                data-active={isNextWeekActive}
                className={`jobs-page__range-link inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-xl border px-0.5 text-[10px] font-medium uppercase tracking-[0.01em] transition duration-200 hover:-translate-y-[1px] ${
                  isNextWeekActive
                    ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
                    : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]'
                }`}
              >
                PŘÍŠTÍ T.
              </Link>
            </div>

            <form action="/zakazky-techniku" method="get" className="print-hidden hidden lg:block">
              <input type="hidden" name="q" value={query} />
              <div className="grid w-full gap-2 lg:grid-cols-5">
                <div>
                  <label
                    htmlFor="status"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Stav zakázky
                  </label>
                  <div className="relative min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <select
                      id="status"
                      name="status"
                      defaultValue={jobStatus}
                      className="block h-9 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-3 pr-8 text-sm text-gray-900 outline-none sm:rounded-xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                    >
                      <option value="">Všechny</option>
                      <option value="nova">Nová</option>
                      <option value="k_reseni">V řešení</option>
                      <option value="realizace">Realizace</option>
                      <option value="ukoncena">Ukončená</option>
                      <option value="storno">Storno</option>
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">⌄</span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="view"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Zobrazení
                  </label>
                  <div className="relative min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <select
                      id="view"
                      name="view"
                      defaultValue={view}
                      className="block h-9 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-3 pr-8 text-sm text-gray-900 outline-none sm:rounded-xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                    >
                      <option value="all">Vše</option>
                      <option value="active">Aktivní</option>
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">⌄</span>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="sort"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Řazení
                  </label>
                  <div className="relative min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <select
                      id="sort"
                      name="sort"
                      defaultValue={sort}
                      className="block h-9 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-3 pr-8 text-sm text-gray-900 outline-none sm:rounded-xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                    >
                      <option value="job_number_desc">Dle čísla zakázky</option>
                      <option value="start_nearest">Dle data od (nejbližší)</option>
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">⌄</span>
                  </div>
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="date_from"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Od dne
                  </label>
                  <div className="min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <input
                      id="date_from"
                      name="date_from"
                      type="date"
                      defaultValue={dateFrom}
                      className="block h-9 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm filter-date-input text-gray-900 outline-none sm:rounded-xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
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
                  <div className="min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                    <input
                      id="date_to"
                      name="date_to"
                      type="date"
                      defaultValue={dateTo}
                      className="block h-9 min-w-0 w-full max-w-full border-0 bg-transparent px-3 text-sm filter-date-input text-gray-900 outline-none sm:rounded-xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                    />
                  </div>
                </div>
              </div>

              <div className="jobs-page__filter-divider mt-3 flex w-full flex-col gap-2 border-t border-gray-100 pt-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="print-filters-summary flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span className="meetings-page__info-chip inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                    Řazení:{' '}
                    <span className="ml-1 font-medium">
                      {getSortLabel(sort)}
                    </span>
                  </span>

                  <span className="meetings-page__info-chip inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                    Zobrazení:{' '}
                    <span className="ml-1 font-medium">
                      {getViewLabel(view)}
                    </span>
                  </span>

                  {query ? (
                    <span className="meetings-page__info-chip inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      Hledání:{' '}
                      <span className="ml-1 font-medium">
                        {query}
                      </span>
                    </span>
                  ) : null}

                  {dateFrom ? (
                    <span className="meetings-page__info-chip inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      Od:{' '}
                      <span className="ml-1 font-medium">{dateFrom}</span>
                    </span>
                  ) : null}

                  {dateTo ? (
                    <span className="meetings-page__info-chip inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      Do:{' '}
                      <span className="ml-1 font-medium">{dateTo}</span>
                    </span>
                  ) : null}
                </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <JobFilterSubmitButton className="jobs-page__filter-submit inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800">
                      POUŽÍT FILTRY
                    </JobFilterSubmitButton>

                  <JobFilterResetLink
                    href="/zakazky-techniku"
                    className="jobs-page__filter-reset inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
                  >
                    RESET
                  </JobFilterResetLink>

                    <PrintJobsButton className="jobs-page__print-button" />
                    <div className="ml-auto flex min-w-0 justify-end">
                      <JobCalendarButton
                        initiallyActivated={isJobCalendarActivated}
                        initialFeedPath={initialJobCalendarFeedPath}
                        initialGoogleConnected={isJobGoogleCalendarConnected}
                      />
                    </div>
                  <Link
                    href={todayHref}
                    data-active={isTodayActive}
                    className={`inline-flex h-9 items-center justify-center rounded-xl border px-4 text-sm font-medium uppercase transition duration-200 hover:-translate-y-[1px] ${
                      isTodayActive
                        ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
                        : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]'
                    }`}
                  >
                    DNES
                  </Link>

                  <Link
                    href={tomorrowHref}
                    data-active={isTomorrowActive}
                    className={`inline-flex h-9 items-center justify-center rounded-xl border px-4 text-sm font-medium uppercase transition duration-200 hover:-translate-y-[1px] ${
                      isTomorrowActive
                        ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
                        : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]'
                    }`}
                  >
                    ZÍTRA
                  </Link>

                  <Link
                    href={thisWeekHref}
                    data-active={isThisWeekActive}
                    className={`inline-flex h-9 items-center justify-center rounded-xl border px-4 text-sm font-medium uppercase transition duration-200 hover:-translate-y-[1px] ${
                      isThisWeekActive
                        ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
                        : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]'
                    }`}
                  >
                    TENTO TÝDEN
                  </Link>

                  <Link
                    href={nextWeekHref}
                    data-active={isNextWeekActive}
                    className={`inline-flex h-9 items-center justify-center rounded-xl border px-4 text-sm font-medium uppercase transition duration-200 hover:-translate-y-[1px] ${
                      isNextWeekActive
                        ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
                        : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)]'
                    }`}
                    >
                      PŘÍŠTÍ TÝDEN
                  </Link>
                </div>
              </div>
            </form>

          </div>
        </section>

        {typedJobs.length === 0 ? (
          <section className="jobs-page__empty-state rounded-[26px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <div className="mx-auto max-w-xl space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">
                {query
                  ? 'Žádná zakázka neodpovídá hledání.'
                  : 'Zatím tu nejsou žádné zakázky.'}
              </h2>

              <p className="text-sm leading-6 text-gray-500">
                {query
                  ? 'Zkus upravit hledání a zkus to znovu.'
                  : 'Jakmile budeš mít přiřazenou první zakázku, zobrazí se zde přehled.'}
              </p>
            </div>
          </section>
        ) : (
          <div className="jobs-page__table-shell print-table-section">
            <JobsInteractiveTable
              jobs={jobsWithInfoState}
              clientSuggestions={[]}
              clientContacts={[]}
              offerSuggestions={[]}
              jobOfferSuggestions={[]}
              technicianSuggestions={[]}
              isAdmin={false}
              allowEditing={false}
              showReadOnlyInfo
              showEvidenceColumn={false}
              showHandoverProtocolPdfColumn
              collapseReadOnlyMobileActions
            />
          </div>
        )}
      </div>
    </main>
  )
}
