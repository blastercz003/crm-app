import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  MeetingStatusBadge,
  MeetingTaskBadge,
} from '@/components/meetings/meeting-status-badge'

type SearchParams = {
  view?: string
  scope?: string
  owner?: string
  search?: string
}

type MeetingRowBase = {
  id: string
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
  comment_count: number
  assigned_user_name: string | null
}

type ProfileRow = {
  id: string
  name: string | null
  role: string | null
}

function formatDateTime(value: string | null) {
  if (!value) return 'Bez termínu'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatCompactDateTime(value: string | null) {
  if (!value) return 'Bez termínu'

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getPreviewText(meeting: MeetingRow) {
  if (meeting.status === 'completed' && meeting.result_note) {
    return meeting.result_note
  }

  if (meeting.pre_meeting_note) {
    return meeting.pre_meeting_note
  }

  if (meeting.contact_email) {
    return meeting.contact_email
  }

  if (meeting.address) {
    return meeting.address
  }

  return 'Bez doplňujících poznámek'
}

function trimText(text: string, max = 95) {
  if (text.length <= max) return text
  return `${text.slice(0, max).trim()}…`
}

function attachCommentCounts(
  meetings: MeetingRowBase[],
  commentEntityIds: string[],
  profileNameById: Map<string, string>
): MeetingRow[] {
  const commentCountByMeetingId = new Map<string, number>()

  for (const entityId of commentEntityIds) {
    commentCountByMeetingId.set(
      entityId,
      (commentCountByMeetingId.get(entityId) ?? 0) + 1
    )
  }

  return meetings.map((meeting) => ({
    ...meeting,
    comment_count: commentCountByMeetingId.get(meeting.id) ?? 0,
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
      className={[
        'inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition',
        active
          ? 'bg-zinc-900 text-white shadow-sm'
          : 'border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900',
      ].join(' ')}
    >
      {label}
    </Link>
  )
}

function StatCard({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold leading-none tracking-tight text-zinc-950">
        {value}
      </div>
    </div>
  )
}

function InfoChip({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
      {label}
    </div>
  )
}

function MeetingListItem({
  meeting,
  isAdminView,
}: {
  meeting: MeetingRow
  isAdminView: boolean
}) {
  const preview = trimText(getPreviewText(meeting))
  const hasTask = Boolean(meeting.follow_up_task?.trim())

  const meetingDate = meeting.meeting_datetime
    ? new Date(meeting.meeting_datetime)
    : null

  const day = meetingDate
    ? new Intl.DateTimeFormat('cs-CZ', { day: '2-digit' }).format(meetingDate)
    : '--'

  const month = meetingDate
    ? new Intl.DateTimeFormat('cs-CZ', { month: 'short' }).format(meetingDate)
    : 'bez data'

  const time = meetingDate
    ? new Intl.DateTimeFormat('cs-CZ', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(meetingDate)
    : 'Bez času'

  const companyLabel =
    meeting.client?.[0]?.name ?? meeting.company_name ?? 'Bez firmy'

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="block rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 shadow-sm transition hover:border-zinc-300 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="flex w-[72px] shrink-0 flex-col items-center rounded-2xl border border-zinc-200 bg-zinc-50 px-2.5 py-2.5 text-center">
          <div className="text-xl font-semibold leading-none text-zinc-950">
            {day}
          </div>

          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            {month}
          </div>

          <div className="mt-2.5 w-full rounded-xl border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700">
            {time}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate text-sm font-semibold text-zinc-900">
                  {companyLabel}
                </div>

                <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
                  💬 {meeting.comment_count}
                </span>

                {isAdminView && meeting.assigned_user_name ? (
                  <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600">
                    👤 {meeting.assigned_user_name}
                  </span>
                ) : null}
              </div>

              <div className="mt-1 text-sm text-zinc-600">
                {meeting.contact_person ?? meeting.title ?? 'Bez kontaktní osoby'}
              </div>

              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                {meeting.contact_phone ? <span>{meeting.contact_phone}</span> : null}
                {meeting.contact_email ? <span>{meeting.contact_email}</span> : null}
              </div>

              <div className="mt-2 text-xs leading-5 text-zinc-500">{preview}</div>

              <div className="mt-2 text-[11px] text-zinc-400">
                {meeting.status === 'planned'
                  ? 'Nadcházející schůzka'
                  : 'Uzavřená schůzka'}{' '}
                · {formatDateTime(meeting.meeting_datetime)}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <MeetingStatusBadge status={meeting.status} />
              {hasTask ? <MeetingTaskBadge /> : null}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function CompactCompletedMeetingListItem({
  meeting,
  isAdminView,
}: {
  meeting: MeetingRow
  isAdminView: boolean
}) {
  const companyLabel =
    meeting.client?.[0]?.name ?? meeting.company_name ?? 'Bez firmy'

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="block rounded-2xl border border-zinc-200 bg-white px-4 py-3 transition hover:border-zinc-300 hover:bg-zinc-50"
    >
      <div className="flex items-center gap-3 text-sm">
        <div className="shrink-0 whitespace-nowrap rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
          {formatCompactDateTime(meeting.meeting_datetime)}
        </div>

        <div className="min-w-0 flex-1 truncate font-medium text-zinc-900">
          {companyLabel}
        </div>

        <div className="min-w-0 flex-1 truncate text-zinc-600">
          {meeting.contact_person ?? meeting.title ?? 'Bez kontaktní osoby'}
        </div>

        {isAdminView && meeting.assigned_user_name ? (
          <div className="hidden max-w-[140px] truncate rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600 xl:block">
            {meeting.assigned_user_name}
          </div>
        ) : null}
      </div>
    </Link>
  )
}

function MeetingSection({
  eyebrow,
  title,
  count,
  meetings,
  emptyText,
  isAdminView,
  scrollClassName,
}: {
  eyebrow: string
  title: string
  count: number
  meetings: MeetingRow[]
  emptyText: string
  isAdminView: boolean
  scrollClassName?: string
}) {
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            {eyebrow}
          </div>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-950 md:text-2xl">
            {title}
          </h2>
        </div>

        <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-600">
          {count}
        </span>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
          {emptyText}
        </div>
      ) : (
        <div className={scrollClassName ?? 'grid gap-3'}>
          <div className="grid gap-3">
            {meetings.map((meeting) => (
              <MeetingListItem
                key={meeting.id}
                meeting={meeting}
                isAdminView={isAdminView}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function CompactCompletedSection({
  eyebrow,
  title,
  count,
  meetings,
  emptyText,
  isAdminView,
  scrollClassName,
}: {
  eyebrow: string
  title: string
  count: number
  meetings: MeetingRow[]
  emptyText: string
  isAdminView: boolean
  scrollClassName?: string
}) {
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            {eyebrow}
          </div>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-950 md:text-2xl">
            {title}
          </h2>
        </div>

        <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-600">
          {count}
        </span>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
          {emptyText}
        </div>
      ) : (
        <div className={scrollClassName ?? 'grid gap-2'}>
          <div className="grid gap-2">
            {meetings.map((meeting) => (
              <CompactCompletedMeetingListItem
                key={meeting.id}
                meeting={meeting}
                isAdminView={isAdminView}
              />
            ))}
          </div>
        </div>
      )}
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

  const view: 'all' | 'planned' | 'completed' =
    rawView === 'planned' || rawView === 'completed' ? rawView : 'all'

  const requestedScope: 'mine' | 'team' = rawScope === 'team' ? 'team' : 'mine'

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
    throw new Error(`Nepodařilo se načíst profil uživatele: ${profileError.message}`)
  }

  const isAdmin = profile?.role === 'admin'
  const scope: 'mine' | 'team' = isAdmin ? requestedScope : 'mine'
  const isAdminTeamView = isAdmin && scope === 'team'

  const { data: allProfiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, role')
    .order('name', { ascending: true })

  if (profilesError) {
    throw new Error(`Nepodařilo se načíst seznam uživatelů: ${profilesError.message}`)
  }

  const profileRows = (allProfiles ?? []) as ProfileRow[]
  const profileNameById = new Map(
    profileRows.map((item) => [item.id, item.name ?? 'Bez jména'])
  )

  const meetingSelect = `
    id,
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

  const allMeetingIds = [
    ...plannedMeetingsBase.map((meeting) => meeting.id),
    ...completedMeetingsBase.map((meeting) => meeting.id),
  ]

  const uniqueMeetingIds = Array.from(new Set(allMeetingIds))

  const { data: comments, error: commentsError } = uniqueMeetingIds.length
    ? await supabase
        .from('comments')
        .select('entity_id')
        .eq('entity_type', 'meeting')
        .in('entity_id', uniqueMeetingIds)
    : { data: [], error: null }

  if (commentsError) {
    throw new Error('Nepodařilo se načíst počty komentářů ke schůzkám.')
  }

  const commentEntityIds = (comments ?? []).map((row) => row.entity_id as string)

  const plannedMeetings = attachCommentCounts(
    plannedMeetingsBase,
    commentEntityIds,
    profileNameById
  )

  const completedMeetings = attachCommentCounts(
    completedMeetingsBase,
    commentEntityIds,
    profileNameById
  )

  const visiblePlannedMeetings =
    view === 'all' || view === 'planned' ? plannedMeetings : []

  const visibleCompletedMeetings =
    view === 'all' || view === 'completed' ? completedMeetings : []

  const totalCount = visiblePlannedMeetings.length + visibleCompletedMeetings.length

  const taskCount =
    visiblePlannedMeetings.filter((m) => m.follow_up_task?.trim()).length +
    visibleCompletedMeetings.filter((m) => m.follow_up_task?.trim()).length

  const ownerOptions = profileRows.filter(
    (item) => item.role !== 'admin' || item.id === user.id
  )

  const ownerLabel =
    rawOwner && profileNameById.get(rawOwner)
      ? profileNameById.get(rawOwner)
      : 'Všichni'

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-6 text-zinc-900 md:px-10 md:py-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-5 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Agenda
              </div>

              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
                Moje schůzky
              </h1>

              <p className="mt-2 text-sm text-zinc-500">
                {isAdminTeamView
                  ? 'Přehled plánovaných i proběhlých schůzek celého týmu.'
                  : 'Přehled plánovaných i proběhlých schůzek.'}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium uppercase tracking-[0.08em] text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
              >
                ZPĚT NA DASHBOARD
              </Link>

              <Link
                href="/meetings/new"
                className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800"
              >
                NOVÁ SCHŮZKA
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-zinc-200 bg-white shadow-sm">
          <div className="grid gap-5 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Zobrazení
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
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

              <div className="mt-3 flex flex-wrap gap-2">
                <InfoChip
                  label={
                    view === 'all'
                      ? 'Pohled: Vše'
                      : view === 'planned'
                        ? 'Pohled: Plánované'
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

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Celkem" value={totalCount} />
                <StatCard label="Plánované" value={visiblePlannedMeetings.length} />
                <StatCard label="Proběhlé" value={visibleCompletedMeetings.length} />
                <StatCard label="S úkolem" value={taskCount} />
              </div>

              <form method="get" className="space-y-2.5">
                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="scope" value={scope} />

                <label
                  htmlFor="meeting-search"
                  className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400"
                >
                  Hledat
                </label>

                <input
                  id="meeting-search"
                  type="text"
                  name="search"
                  defaultValue={rawSearch}
                  placeholder="Firma, osoba, telefon, e-mail, poznámka..."
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400"
                />

                {isAdminTeamView ? (
                  <div>
                    <label
                      htmlFor="meeting-owner"
                      className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400"
                    >
                      Obchodník
                    </label>
                    <select
                      id="meeting-owner"
                      name="owner"
                      defaultValue={rawOwner ?? ''}
                      className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none transition focus:border-zinc-400"
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

                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800"
                  >
                    Filtrovat
                  </button>

                  <Link
                    href={
                      isAdminTeamView
                        ? getTabHref(
                            { view, scope: 'team' },
                            { search: '', owner: '' }
                          )
                        : getTabHref({ view, scope }, { search: '' })
                    }
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950"
                  >
                    Reset
                  </Link>
                </div>
              </form>
            </div>
          </div>
        </section>

        {view === 'all' ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
            <MeetingSection
              eyebrow="Aktuální agenda"
              title="Plánované"
              count={visiblePlannedMeetings.length}
              meetings={visiblePlannedMeetings}
              emptyText="Pro zadaný filtr tu není žádná plánovaná schůzka."
              isAdminView={isAdminTeamView}
              scrollClassName="xl:max-h-[960px] xl:overflow-y-auto xl:pr-1"
            />

            <CompactCompletedSection
              eyebrow="Historie"
              title="Proběhlé"
              count={visibleCompletedMeetings.length}
              meetings={visibleCompletedMeetings}
              emptyText="Pro zadaný filtr tu není žádná proběhlá schůzka."
              isAdminView={isAdminTeamView}
              scrollClassName="xl:max-h-[960px] xl:overflow-y-auto xl:pr-1"
            />
          </div>
        ) : null}

        {view === 'planned' ? (
          <MeetingSection
            eyebrow="Aktuální agenda"
            title="Plánované"
            count={visiblePlannedMeetings.length}
            meetings={visiblePlannedMeetings}
            emptyText="Pro zadaný filtr tu není žádná plánovaná schůzka."
            isAdminView={isAdminTeamView}
          />
        ) : null}

        {view === 'completed' ? (
          <CompactCompletedSection
            eyebrow="Historie"
            title="Proběhlé"
            count={visibleCompletedMeetings.length}
            meetings={visibleCompletedMeetings}
            emptyText="Pro zadaný filtr tu není žádná proběhlá schůzka."
            isAdminView={isAdminTeamView}
          />
        ) : null}
      </div>
    </main>
  )
}