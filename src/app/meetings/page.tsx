import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { ensureMeetingResultNotifications } from '@/lib/notifications/meetingNotifications'
import { EditMeetingButton } from './edit-meeting-button'
import { MeetingCalendarButton } from './meeting-calendar-button'
import { NewMeetingButton } from './new-meeting-button'
import { MeetingFilterSubmitButton } from './meeting-filter-submit-button'
import { MeetingFilterResetLink } from './meeting-filter-reset-link'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'

export const metadata: Metadata = {
  title: 'Schůzky',
}

type SearchParams = {
  view?: string
  scope?: string
  owner?: string
  search?: string
}

type MeetingRowBase = {
  id: string
  client_id: string | null
  client_contact_id: string | null
  company_name: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  title: string | null
  meeting_datetime: string | null
  pre_meeting_note: string | null
  result_note: string | null
  follow_up_task: string | null
  follow_up_task_note: string | null
  follow_up_task_priority: string | null
  follow_up_task_due_date: string | null
  status: 'planned' | 'completed'
  assigned_user_id: string | null
  client:
    | {
        id: string
        name: string
      }[]
    | null
}

type MeetingRow = MeetingRowBase & {
  assigned_user_name: string | null
}

type ProfileRow = {
  id: string
  name: string | null
  role: string | null
}

type MeetingGoogleCalendarIntegrationRow = {
  user_id: string
  calendar_id: string | null
  enabled: boolean
  disabled_at: string | null
}

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  phone: string | null
  email: string | null
  is_primary: boolean
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'

function parseMeetingDate(value: string | null) {
  if (!value) return null

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date
}

function formatInPrague(
  value: string | null,
  options: Intl.DateTimeFormatOptions,
  fallback = 'Bez termínu'
) {
  const date = parseMeetingDate(value)

  if (!date) return fallback

  return new Intl.DateTimeFormat('cs-CZ', {
    ...options,
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)
}

function formatCompactDateTime(value: string | null) {
  return formatInPrague(
    value,
    {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
    'Bez termínu'
  )
}

function isMeetingOverdue(meeting: MeetingRow) {
  if (meeting.status !== 'planned') return false

  const date = parseMeetingDate(meeting.meeting_datetime)

  if (!date) return false

  return date.getTime() < Date.now()
}

function compareMeetingDateAsc(a: MeetingRow, b: MeetingRow) {
  const aDate = parseMeetingDate(a.meeting_datetime)
  const bDate = parseMeetingDate(b.meeting_datetime)

  if (!aDate && !bDate) return 0
  if (!aDate) return 1
  if (!bDate) return -1

  return aDate.getTime() - bDate.getTime()
}

function compareMeetingDateDesc(a: MeetingRow, b: MeetingRow) {
  return compareMeetingDateAsc(b, a)
}

function attachAssignedUserNames(
  meetings: MeetingRowBase[],
  profileNameById: Map<string, string>
): MeetingRow[] {
  return meetings.map((meeting) => ({
    ...meeting,
    assigned_user_name: meeting.assigned_user_id
      ? (profileNameById.get(meeting.assigned_user_id) ?? null)
      : null,
  }))
}

function getTabHref(
  currentParams: SearchParams,
  updates: Partial<SearchParams>
) {
  const params = new URLSearchParams()

  const next: SearchParams = {
    view: currentParams.view,
    scope: currentParams.scope,
    owner: currentParams.owner,
    search: currentParams.search,
    ...updates,
  }

  if (next.view && next.view !== 'all') {
    params.set('view', next.view)
  }

  if (next.scope && next.scope !== 'mine') {
    params.set('scope', next.scope)
  }

  if (next.owner) {
    params.set('owner', next.owner)
  }

  if (next.search?.trim()) {
    params.set('search', next.search.trim())
  }

  const query = params.toString()
  return query ? `/meetings?${query}` : '/meetings'
}

function isTabActive(
  currentValue: string | undefined,
  expectedValue: string,
  defaultValue: string
) {
  return (currentValue ?? defaultValue) === expectedValue
}

function FilterTab({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      data-active={active}
      className={[
        'meetings-page__filter-tab',
        'inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition duration-200 ease-out sm:px-4 sm:py-2 sm:text-sm',
        active
          ? 'border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
          : 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] hover:-translate-y-[1px] hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]',
      ].join(' ')}
    >
      {label}
    </Link>
  )
}

function StatCard({
  label,
  value,
  variant = 'neutral',
  className = '',
}: {
  label: string
  value: number
  variant?: 'neutral' | 'primary' | 'dark' | 'success'
  className?: string
}) {
  const cardClassName =
    variant === 'primary'
      ? 'border-transparent bg-[#2980B9] text-white'
      : variant === 'dark'
        ? 'border-transparent bg-zinc-800 text-white'
        : variant === 'success'
          ? 'border-transparent bg-emerald-600 text-white'
          : 'border-zinc-200 bg-white text-zinc-950'

  const variantClassName =
    variant === 'primary'
      ? 'meetings-page__stat-card--primary'
      : variant === 'dark'
        ? 'meetings-page__stat-card--dark'
        : variant === 'success'
          ? 'meetings-page__stat-card--success'
          : 'meetings-page__stat-card--neutral'

  const labelClassName =
    variant === 'primary' || variant === 'dark' || variant === 'success'
      ? 'text-white'
      : variant === 'neutral'
        ? 'text-zinc-950'
        : 'text-current/80'

  return (
    <div
      className={`meetings-page__stat-card ${variantClassName} rounded-2xl border px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.12)] ${cardClassName} ${className}`}
    >
      <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${labelClassName}`}>
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold leading-none tracking-tight text-current">
        {value}
      </div>
    </div>
  )
}

function InfoChip({ label }: { label: string }) {
  return (
    <div className="meetings-page__info-chip inline-flex items-center whitespace-nowrap rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-1 text-[11px] text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] sm:py-1.5 sm:text-xs">
      {label}
    </div>
  )
}

function MeetingListItem({
  meeting,
  isAdminView,
  clients,
  contacts,
}: {
  meeting: MeetingRow
  isAdminView: boolean
  clients: ClientOption[]
  contacts: ClientContactOption[]
}) {
  const companyLabel =
    meeting.client?.[0]?.name ?? meeting.company_name ?? 'Bez firmy'

  return (
    <div className="meetings-page__meeting-item min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          <div
            className="meetings-page__meeting-company min-w-0 flex-1 truncate font-medium text-zinc-900"
            title={companyLabel}
          >
            {companyLabel}
          </div>

          {isAdminView && meeting.assigned_user_name ? (
            <div
              className="meetings-page__meeting-user max-w-[120px] shrink-0 truncate rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-2.5 py-1 text-xs font-medium text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]"
              title={meeting.assigned_user_name}
            >
              {meeting.assigned_user_name}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="meetings-page__meeting-date shrink-0 whitespace-nowrap rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2.5 py-1 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(24,78,129,0.24)]">
            {formatCompactDateTime(meeting.meeting_datetime)}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <EditMeetingButton
              clients={clients}
              contacts={contacts}
              meeting={meeting}
              className="meetings-page__meeting-edit inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-2 text-xs font-medium text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
            />

            <Link
              href={`/meetings/${meeting.id}`}
              className="meetings-page__meeting-detail inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:bg-gray-800"
            >
              DETAIL
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function MeetingSection({
  eyebrow,
  title,
  count,
  countVariant = 'neutral',
  meetings,
  emptyText,
  isAdminView,
  clients,
  contacts,
  initialVisibleCount,
}: {
  eyebrow: string
  title: string
  count: number
  countVariant?: 'neutral' | 'primary' | 'dark' | 'success'
  meetings: MeetingRow[]
  emptyText: string
  isAdminView: boolean
  clients: ClientOption[]
  contacts: ClientContactOption[]
  initialVisibleCount?: number
}) {
  const countClassName =
    countVariant === 'primary'
      ? 'border-transparent bg-[#2980B9] text-white'
      : countVariant === 'dark'
        ? 'border-transparent bg-zinc-800 text-white'
        : countVariant === 'success'
          ? 'border-transparent bg-emerald-600 text-white'
          : 'border-zinc-200 bg-zinc-50 text-zinc-600'

  const countVariantClassName =
    countVariant === 'primary'
      ? 'meetings-page__count--primary'
      : countVariant === 'dark'
        ? 'meetings-page__count--dark'
        : countVariant === 'success'
          ? 'meetings-page__count--success'
          : 'meetings-page__count--neutral'

  const shouldLimitMeetings =
    typeof initialVisibleCount === 'number' && meetings.length > initialVisibleCount
  const visibleMeetings = shouldLimitMeetings ? meetings.slice(0, initialVisibleCount) : meetings
  const hiddenMeetings = shouldLimitMeetings ? meetings.slice(initialVisibleCount) : []

  return (
    <section className="meetings-page__section min-w-0 rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_32px_rgba(15,23,42,0.1)]">
      <div className="meetings-page__section-header mb-0 flex items-center justify-between gap-4 border-b border-zinc-200/80 px-4 py-4 md:px-5">
        <div>
          <div className="meetings-page__section-eyebrow text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            {eyebrow}
          </div>
          <h2 className="meetings-page__section-title mt-1.5 text-xl font-semibold tracking-tight text-zinc-950 md:text-2xl">
            {title}
          </h2>
        </div>

        <span
          className={`meetings-page__count ${countVariantClassName} inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-3 text-sm font-semibold ${countClassName}`}
        >
          {count}
        </span>
      </div>

      <div className="p-4 md:p-5">
      {meetings.length === 0 ? (
        <div className="meetings-page__empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-8 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.08)]">
          {emptyText}
        </div>
      ) : (
        <div className="grid min-w-0 gap-3">
          {visibleMeetings.map((meeting) => (
            <MeetingListItem
              key={meeting.id}
              meeting={meeting}
              isAdminView={isAdminView}
              clients={clients}
              contacts={contacts}
            />
          ))}

          {hiddenMeetings.length > 0 ? (
            <details className="group grid gap-3">
              <summary className="meetings-page__show-all inline-flex min-h-10 cursor-pointer list-none items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800 [&::-webkit-details-marker]:hidden">
                ZOBRAZIT VŠE
              </summary>

              <div className="grid gap-3">
                {hiddenMeetings.map((meeting) => (
                  <MeetingListItem
                    key={meeting.id}
                    meeting={meeting}
                    isAdminView={isAdminView}
                    clients={clients}
                    contacts={contacts}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
      </div>
    </section>
  )
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = (await searchParams) ?? {}

  const rawView = params.view
  const rawScope = params.scope
  const rawOwner = params.owner
  const rawSearch = params.search?.trim() ?? ''

  const view: 'all' | 'planned' | 'overdue' | 'completed' =
    rawView === 'planned' || rawView === 'overdue' || rawView === 'completed'
      ? rawView
      : 'all'

  const requestedScope: 'mine' | 'team' = rawScope === 'team' ? rawScope : 'mine'

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Uživatel není přihlášen.')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, role')
    .eq('id', user.id)
    .single<ProfileRow>()

  if (profileError) {
    throw new Error(
      `Nepodařilo se načíst profil uživatele: ${profileError.message}`
    )
  }

  const isAdmin = profile?.role === 'admin'
  const scope: 'mine' | 'team' = isAdmin ? requestedScope : 'mine'
  const isAdminTeamView = isAdmin && scope === 'team'

  const { data: meetingCalendarFeed, error: meetingCalendarFeedError } =
    await supabase
      .from('meeting_calendar_feeds')
      .select('user_id, token, enabled, disabled_at')
      .eq('user_id', user.id)
      .maybeSingle<{
        user_id: string
        token: string
        enabled: boolean
        disabled_at: string | null
      }>()

  if (meetingCalendarFeedError) {
    throw new Error(
      `Nepodařilo se načíst stav kalendáře schůzek: ${meetingCalendarFeedError.message}`
    )
  }

  const isMeetingCalendarActivated = Boolean(
    meetingCalendarFeed && meetingCalendarFeed.enabled && !meetingCalendarFeed.disabled_at
  )
  const initialMeetingCalendarFeedPath = meetingCalendarFeed?.token
    ? `/api/calendars/${meetingCalendarFeed.token}`
    : null

  let isMeetingGoogleCalendarConnected = false

  try {
    const { data: meetingGoogleCalendarIntegration, error: meetingGoogleCalendarIntegrationError } =
      await supabase
        .from('meeting_google_calendar_integrations')
        .select('user_id, calendar_id, enabled, disabled_at')
        .eq('user_id', user.id)
        .maybeSingle()

    if (meetingGoogleCalendarIntegrationError) {
      console.warn(
        'Nepodařilo se načíst stav Google kalendáře schůzek:',
        meetingGoogleCalendarIntegrationError.message
      )
    } else {
      const typedMeetingGoogleCalendarIntegration =
        meetingGoogleCalendarIntegration as MeetingGoogleCalendarIntegrationRow | null
      isMeetingGoogleCalendarConnected = Boolean(
        typedMeetingGoogleCalendarIntegration &&
          typedMeetingGoogleCalendarIntegration.enabled &&
          !typedMeetingGoogleCalendarIntegration.disabled_at &&
          typedMeetingGoogleCalendarIntegration.calendar_id
      )
    }
  } catch (error) {
    console.warn('Nepodařilo se načíst stav Google kalendáře schůzek:', error)
  }

  await ensureMeetingResultNotifications({ supabase, userId: user.id })

  const { data: allProfiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, role')
    .order('name', { ascending: true })

  if (profilesError) {
    throw new Error(
      `Nepodařilo se načíst seznam uživatelů: ${profilesError.message}`
    )
  }

  const [clientsResponse, contactsResponse] = await Promise.all([
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, phone, email, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
  ])

  const { data: clients, error: clientsError } = clientsResponse
  const { data: contacts, error: contactsError } = contactsResponse

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  if (contactsError) {
    throw new Error('Nepodařilo se načíst kontaktní osoby klientů.')
  }

  const clientOptions = (clients ?? []) as ClientOption[]
  const contactOptions = (contacts ?? []) as ClientContactOption[]

  const profileRows = (allProfiles ?? []) as ProfileRow[]
  const profileNameById = new Map(
    profileRows.map((item) => [item.id, item.name ?? 'Bez jména'])
  )

  const meetingSelect = `
    id,
    client_id,
    client_contact_id,
    company_name,
    contact_person,
    contact_phone,
    contact_email,
    address,
    title,
    meeting_datetime,
    pre_meeting_note,
    result_note,
    follow_up_task,
    follow_up_task_note,
    follow_up_task_priority,
    follow_up_task_due_date,
    status,
    assigned_user_id,
    client:clients (
      id,
      name
    )
  `

  let plannedQuery = supabase
    .from('meetings')
    .select(meetingSelect)
    .eq('status', 'planned')
    .order('meeting_datetime', { ascending: true })

  let completedQuery = supabase
    .from('meetings')
    .select(meetingSelect)
    .eq('status', 'completed')
    .order('meeting_datetime', { ascending: false })

  if (scope === 'mine') {
    plannedQuery = plannedQuery.eq('assigned_user_id', user.id)
    completedQuery = completedQuery.eq('assigned_user_id', user.id)
  }

  if (isAdminTeamView && rawOwner) {
    plannedQuery = plannedQuery.eq('assigned_user_id', rawOwner)
    completedQuery = completedQuery.eq('assigned_user_id', rawOwner)
  }

  if (rawSearch) {
    const escaped = rawSearch.replaceAll(',', ' ').trim()
    const searchFilter = [
      `company_name.ilike.%${escaped}%`,
      `contact_person.ilike.%${escaped}%`,
      `contact_phone.ilike.%${escaped}%`,
      `contact_email.ilike.%${escaped}%`,
      `title.ilike.%${escaped}%`,
      `address.ilike.%${escaped}%`,
      `pre_meeting_note.ilike.%${escaped}%`,
      `result_note.ilike.%${escaped}%`,
      `follow_up_task.ilike.%${escaped}%`,
    ].join(',')

    plannedQuery = plannedQuery.or(searchFilter)
    completedQuery = completedQuery.or(searchFilter)
  }

  const [plannedResponse, completedResponse] = await Promise.all([
    plannedQuery,
    completedQuery,
  ])

  if (plannedResponse.error) {
    throw new Error(
      `Nepodařilo se načíst plánované schůzky: ${plannedResponse.error.message}`
    )
  }

  if (completedResponse.error) {
    throw new Error(
      `Nepodařilo se načíst proběhlé schůzky: ${completedResponse.error.message}`
    )
  }

  const plannedMeetingsBase = (plannedResponse.data ?? []) as MeetingRowBase[]
  const completedMeetingsBase = (completedResponse.data ?? []) as MeetingRowBase[]

  const plannedMeetingPool = attachAssignedUserNames(
    plannedMeetingsBase,
    profileNameById
  )
  const completedMeetings = attachAssignedUserNames(
    completedMeetingsBase,
    profileNameById
  )

  const overdueMeetings = plannedMeetingPool
    .filter((meeting) => isMeetingOverdue(meeting))
    .sort(compareMeetingDateDesc)

  const plannedMeetings = plannedMeetingPool
    .filter((meeting) => !isMeetingOverdue(meeting))
    .sort(compareMeetingDateAsc)

  const visiblePlannedMeetings =
    view === 'all' || view === 'planned' ? plannedMeetings : []

  const visibleOverdueMeetings =
    view === 'all' || view === 'overdue' ? overdueMeetings : []

  const visibleCompletedMeetings =
    view === 'all' || view === 'completed' ? completedMeetings : []

  const ownerOptions = profileRows.filter(
    (item) => item.role !== 'admin' || item.id === user.id
  )

  const ownerLabel =
    rawOwner && profileNameById.get(rawOwner)
      ? profileNameById.get(rawOwner)
      : 'Všichni'
  const hasActiveMobileFilters =
    view !== 'all' || scope !== 'mine' || Boolean(rawOwner)
  const mobileResetHref = getTabHref(params, {
    view: 'all',
    scope: 'mine',
    owner: '',
  })

  return (
    <main className="meetings-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <PresenceSectionTracker section="Schůzky" route="/meetings" />
      <div
        aria-hidden
        className="meetings-page__glow--primary pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="meetings-page__glow--secondary pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="meetings-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="meetings-page__title text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Moje schůzky
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form
                action="/meetings"
                method="get"
                className="flex w-full gap-3 sm:w-auto"
              >
                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="scope" value={scope} />
                {isAdminTeamView ? (
                  <input type="hidden" name="owner" value={rawOwner ?? ''} />
                ) : null}

                <input
                  id="meeting-search"
                  type="text"
                  name="search"
                  defaultValue={rawSearch}
                  placeholder="Firma, osoba, telefon, e-mail..."
                  className="meetings-page__search-input w-full min-w-0 rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:w-56 lg:w-72"
                />

                <button
                  type="submit"
                  className="meetings-page__search-button rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="clients-page__back-button meetings-page__back-button inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                ZPĚT NA DASHBOARD
              </Link>

              <NewMeetingButton clients={clientOptions} contacts={contactOptions} />
            </div>
          </div>
        </section>

        <section className="meetings-page__filters-panel rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="grid gap-5 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
            <div className="min-w-0 hidden lg:block">
              <div className="meetings-page__filter-eyebrow text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Zobrazení
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2.5 sm:gap-y-2">
                <FilterTab
                  href={getTabHref(params, { view: 'all' })}
                  label="Vše"
                  active={isTabActive(params.view, 'all', 'all')}
                />
                <FilterTab
                  href={getTabHref(params, { view: 'planned' })}
                  label="Plánované"
                  active={isTabActive(params.view, 'planned', 'all')}
                />
                <FilterTab
                  href={getTabHref(params, { view: 'overdue' })}
                  label="Po termínu"
                  active={isTabActive(params.view, 'overdue', 'all')}
                />
                <FilterTab
                  href={getTabHref(params, { view: 'completed' })}
                  label="Proběhlé"
                  active={isTabActive(params.view, 'completed', 'all')}
                />

                {isAdmin ? (
                  <>
                    <FilterTab
                      href={getTabHref(params, {
                        scope: 'mine',
                        owner: '',
                      })}
                      label="Moje schůzky"
                      active={isTabActive(params.scope, 'mine', 'mine')}
                    />
                    <FilterTab
                      href={getTabHref(params, { scope: 'team' })}
                      label="Všechny schůzky"
                      active={isTabActive(params.scope, 'team', 'mine')}
                    />
                  </>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-y-1.5">
                <InfoChip
                  label={
                    view === 'all'
                      ? 'Pohled: Vše'
                      : view === 'planned'
                        ? 'Pohled: Plánované'
                        : view === 'overdue'
                          ? 'Pohled: Po termínu'
                        : 'Pohled: Proběhlé'
                  }
                />
                <InfoChip
                  label={
                    scope === 'team'
                      ? 'Rozsah: Všechny schůzky'
                      : 'Rozsah: Moje schůzky'
                  }
                />
                {isAdminTeamView ? (
                  <InfoChip label={`Uživatel: ${ownerLabel}`} />
                ) : null}
                <InfoChip
                  label={rawSearch ? `Hledání: ${rawSearch}` : 'Hledání: Bez filtru'}
                />
              </div>
            </div>
            <details
              id="meetings-mobile-filters"
              className="group print-hidden w-full lg:hidden"
            >
              <summary className="meetings-page__mobile-summary flex h-10 cursor-pointer list-none items-center justify-between gap-2.5 rounded-xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(242,247,252,0.88)_100%)] px-3 text-[12px] font-semibold uppercase tracking-[0.07em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
                <span className="inline-flex items-center gap-2">
                  FILTRY
                  {hasActiveMobileFilters ? (
                    <span className="inline-flex items-center rounded-full border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.07em] text-[#236f9f]">
                      FILTR AKTIVNÍ
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-zinc-500 transition group-open:rotate-180">⌄</span>
              </summary>

              <form
                action="/meetings"
                method="get"
                className="meetings-page__mobile-panel mt-2 space-y-3 rounded-2xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"
              >
                <input type="hidden" name="search" value={rawSearch} />

                <div>
                  <label
                    htmlFor="view-mobile"
                    className="meetings-page__mobile-label mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Zobrazení
                  </label>
                  <select
                    id="view-mobile"
                    name="view"
                    defaultValue={view}
                    className="meetings-page__mobile-select h-9 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                  >
                    <option value="all">Vše</option>
                    <option value="planned">Plánované</option>
                    <option value="overdue">Po termínu</option>
                    <option value="completed">Proběhlé</option>
                  </select>
                </div>

                {isAdmin ? (
                  <div>
                    <label
                      htmlFor="scope-mobile"
                      className="meetings-page__mobile-label mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      Rozsah
                    </label>
                    <select
                      id="scope-mobile"
                      name="scope"
                      defaultValue={scope}
                      className="meetings-page__mobile-select h-9 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                    >
                      <option value="mine">Moje schůzky</option>
                      <option value="team">Všechny schůzky</option>
                    </select>
                  </div>
                ) : (
                  <input type="hidden" name="scope" value="mine" />
                )}

                {isAdmin ? (
                  <div>
                    <label
                      htmlFor="owner-mobile"
                      className="meetings-page__mobile-label mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      Uživatel
                    </label>
                    <select
                      id="owner-mobile"
                      name="owner"
                      defaultValue={rawOwner ?? ''}
                      className="meetings-page__mobile-select h-9 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                    >
                      <option value="">Všichni</option>
                      {ownerOptions.map((profileItem) => (
                        <option key={profileItem.id} value={profileItem.id}>
                          {profileItem.name ?? 'Bez jména'}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

              <div className="meetings-page__filter-actions-divider flex items-center gap-2 border-t pt-3">
                  <MeetingFilterSubmitButton className="meetings-page__mobile-submit inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800">
                    POUŽÍT FILTRY
                  </MeetingFilterSubmitButton>

                  <MeetingFilterResetLink
                    href={mobileResetHref}
                    detailsId="meetings-mobile-filters"
                    className="meetings-page__mobile-reset inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
                    >
                      RESET
                    </MeetingFilterResetLink>
                  </div>

                  <div className="pt-3">
                    <MeetingCalendarButton
                      className="meetings-page__calendar-button inline-flex h-10 w-full items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 text-sm font-medium uppercase tracking-[0.05em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                      initiallyActivated={isMeetingCalendarActivated}
                      initialFeedPath={initialMeetingCalendarFeedPath}
                      initialGoogleConnected={isMeetingGoogleCalendarConnected}
                      initialGoogleConfigured={Boolean(
                        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
                      )}
                    />
                  </div>
                </form>
              </details>

            <div className="hidden space-y-3 md:block">
              <div className="hidden grid-cols-3 gap-2 md:grid">
                <StatCard
                  label="Plánované"
                  value={visiblePlannedMeetings.length}
                  variant="primary"
                />
                <StatCard
                  label="Po termínu"
                  value={visibleOverdueMeetings.length}
                  variant="dark"
                />
                <StatCard
                  label="Proběhlé"
                  value={visibleCompletedMeetings.length}
                  variant="success"
                />
              </div>

              <div className="flex justify-end">
                <MeetingCalendarButton
                  className="meetings-page__calendar-button inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 text-sm font-medium uppercase tracking-[0.05em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                  initiallyActivated={isMeetingCalendarActivated}
                  initialFeedPath={initialMeetingCalendarFeedPath}
                  initialGoogleConnected={isMeetingGoogleCalendarConnected}
                  initialGoogleConfigured={Boolean(
                    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
                  )}
                />
              </div>

              {isAdminTeamView ? (
                <form method="get" className="meetings-page__owner-form space-y-2.5">
                  <input type="hidden" name="view" value={view} />
                  <input type="hidden" name="scope" value={scope} />
                  <input type="hidden" name="search" value={rawSearch} />

                  <div>
                    <label
                      htmlFor="meeting-owner"
                      className="meetings-page__owner-label mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400"
                    >
                      Obchodník
                    </label>
                    <select
                      id="meeting-owner"
                      name="owner"
                      defaultValue={rawOwner ?? ''}
                      className="meetings-page__owner-select h-11 w-full rounded-2xl border border-zinc-200 bg-white/96 px-4 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out focus:border-zinc-400"
                    >
                      <option value="">Všichni</option>
                      {ownerOptions.map((profileItem) => (
                        <option key={profileItem.id} value={profileItem.id}>
                          {profileItem.name ?? 'Bez jména'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    className="meetings-page__owner-button meetings-page__owner-submit inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 text-sm font-medium uppercase tracking-[0.08em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                  >
                    POUŽÍT FILTR
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </section>

        {view === 'all' ? (
          <div className="grid gap-4 xl:grid-cols-3">
            <MeetingSection
              eyebrow="Aktuální agenda"
              title="Plánované"
              count={visiblePlannedMeetings.length}
              countVariant="primary"
              meetings={visiblePlannedMeetings}
              emptyText="Pro zadaný filtr tu není žádná plánovaná schůzka."
              isAdminView={isAdminTeamView}
              clients={clientOptions}
              contacts={contactOptions}
              initialVisibleCount={5}
            />

            <MeetingSection
              eyebrow="Potřebuje řešení"
              title="Po termínu"
              count={visibleOverdueMeetings.length}
              countVariant="dark"
              meetings={visibleOverdueMeetings}
              emptyText="Pro zadaný filtr tu není žádná schůzka po termínu."
              isAdminView={isAdminTeamView}
              clients={clientOptions}
              contacts={contactOptions}
              initialVisibleCount={5}
            />

            <MeetingSection
              eyebrow="Historie"
              title="Proběhlé"
              count={visibleCompletedMeetings.length}
              countVariant="success"
              meetings={visibleCompletedMeetings}
              emptyText="Pro zadaný filtr tu není žádná proběhlá schůzka."
              isAdminView={isAdminTeamView}
              clients={clientOptions}
              contacts={contactOptions}
              initialVisibleCount={5}
            />
          </div>
        ) : null}

        {view === 'planned' ? (
          <MeetingSection
            eyebrow="Aktuální agenda"
            title="Plánované"
            count={visiblePlannedMeetings.length}
            countVariant="primary"
            meetings={visiblePlannedMeetings}
            emptyText="Pro zadaný filtr tu není žádná plánovaná schůzka."
            isAdminView={isAdminTeamView}
            clients={clientOptions}
            contacts={contactOptions}
          />
        ) : null}

        {view === 'overdue' ? (
          <MeetingSection
            eyebrow="Potřebuje řešení"
            title="Po termínu"
            count={visibleOverdueMeetings.length}
            countVariant="dark"
            meetings={visibleOverdueMeetings}
            emptyText="Pro zadaný filtr tu není žádná schůzka po termínu."
            isAdminView={isAdminTeamView}
            clients={clientOptions}
            contacts={contactOptions}
          />
        ) : null}

        {view === 'completed' ? (
          <MeetingSection
            eyebrow="Historie"
            title="Proběhlé"
            count={visibleCompletedMeetings.length}
            countVariant="success"
            meetings={visibleCompletedMeetings}
            emptyText="Pro zadaný filtr tu není žádná proběhlá schůzka."
            isAdminView={isAdminTeamView}
            clients={clientOptions}
            contacts={contactOptions}
          />
        ) : null}
      </div>
    </main>
  )
}
