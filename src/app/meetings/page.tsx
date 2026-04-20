import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { EditMeetingButton } from './edit-meeting-button'
import { NewMeetingButton } from './new-meeting-button'

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
  assigned_user_name: string | null
}

type ProfileRow = {
  id: string
  name: string | null
  role: string | null
}

type ClientOption = {
  id: string
  name: string
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

function formatDateTime(value: string | null) {
  return formatInPrague(
    value,
    {
      dateStyle: 'medium',
      timeStyle: 'short',
    },
    'Bez termínu'
  )
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

function truncateMeetingCompanyLabel(value: string, maxLength = 23) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength)}...`
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
  variant = 'neutral',
}: {
  label: string
  value: number
  variant?: 'neutral' | 'primary' | 'dark' | 'success'
}) {
  const cardClassName =
    variant === 'primary'
      ? 'border-transparent bg-[#2980B9] text-white'
      : variant === 'dark'
        ? 'border-transparent bg-zinc-800 text-white'
        : variant === 'success'
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-zinc-200 bg-white text-zinc-950'

  const labelClassName =
    variant === 'primary' || variant === 'dark'
      ? 'text-white'
      : variant === 'neutral'
        ? 'text-zinc-950'
        : 'text-current/80'

  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${cardClassName}`}>
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
    <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
      {label}
    </div>
  )
}

function MeetingListItem({
  meeting,
  isAdminView,
  clients,
}: {
  meeting: MeetingRow
  isAdminView: boolean
  clients: ClientOption[]
}) {
  const companyLabel =
    meeting.client?.[0]?.name ?? meeting.company_name ?? 'Bez firmy'
  const previewCompanyLabel = truncateMeetingCompanyLabel(companyLabel)

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 transition hover:border-zinc-300 hover:bg-zinc-50">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-sm">
          <div className="shrink-0 whitespace-nowrap rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
            {formatCompactDateTime(meeting.meeting_datetime)}
          </div>

          <div
            className="min-w-0 flex-1 break-words font-medium text-zinc-900"
            title={companyLabel}
          >
            {previewCompanyLabel}
          </div>

          {isAdminView && meeting.assigned_user_name ? (
            <div className="max-w-full break-words rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600">
              {meeting.assigned_user_name}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/meetings/${meeting.id}`}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
          >
            DETAIL
          </Link>

          <EditMeetingButton clients={clients} meeting={meeting} />
        </div>
      </div>
    </div>
  )
}

function MeetingSection({
  eyebrow,
  title,
  count,
  meetings,
  emptyText,
  isAdminView,
  clients,
  scrollClassName,
}: {
  eyebrow: string
  title: string
  count: number
  meetings: MeetingRow[]
  emptyText: string
  isAdminView: boolean
  clients: ClientOption[]
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
                clients={clients}
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

  const { data: allProfiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, role')
    .order('name', { ascending: true })

  if (profilesError) {
    throw new Error(
      `Nepodařilo se načíst seznam uživatelů: ${profilesError.message}`
    )
  }

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name')
    .order('name', { ascending: true })

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  const clientOptions = (clients ?? []) as ClientOption[]

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

  const totalCount =
    visiblePlannedMeetings.length +
    visibleOverdueMeetings.length +
    visibleCompletedMeetings.length

  const taskCount =
    visiblePlannedMeetings.filter((m) => m.follow_up_task?.trim()).length +
    visibleOverdueMeetings.filter((m) => m.follow_up_task?.trim()).length +
    visibleCompletedMeetings.filter((m) => m.follow_up_task?.trim()).length

  const ownerOptions = profileRows.filter(
    (item) => item.role !== 'admin' || item.id === user.id
  )

  const ownerLabel =
    rawOwner && profileNameById.get(rawOwner)
      ? profileNameById.get(rawOwner)
      : 'Všichni'

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
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

              <NewMeetingButton clients={clientOptions} />
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

              <div className="mt-3 flex flex-wrap gap-2">
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

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <StatCard label="Celkem" value={totalCount} variant="neutral" />
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
                <StatCard label="S úkolem" value={taskCount} variant="neutral" />
              </div>

              {isAdminTeamView ? (
                <form method="get" className="space-y-2.5">
                  <input type="hidden" name="view" value={view} />
                  <input type="hidden" name="scope" value={scope} />
                  <input type="hidden" name="search" value={rawSearch} />

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

                  <button
                    type="submit"
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium uppercase tracking-[0.08em] text-zinc-900 transition hover:bg-zinc-50"
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
              meetings={visiblePlannedMeetings}
              emptyText="Pro zadaný filtr tu není žádná plánovaná schůzka."
              isAdminView={isAdminTeamView}
              clients={clientOptions}
              scrollClassName="xl:max-h-[960px] xl:overflow-y-auto xl:pr-1"
            />

            <MeetingSection
              eyebrow="Potřebuje řešení"
              title="Po termínu"
              count={visibleOverdueMeetings.length}
              meetings={visibleOverdueMeetings}
              emptyText="Pro zadaný filtr tu není žádná schůzka po termínu."
              isAdminView={isAdminTeamView}
              clients={clientOptions}
              scrollClassName="xl:max-h-[960px] xl:overflow-y-auto xl:pr-1"
            />

            <MeetingSection
              eyebrow="Historie"
              title="Proběhlé"
              count={visibleCompletedMeetings.length}
              meetings={visibleCompletedMeetings}
              emptyText="Pro zadaný filtr tu není žádná proběhlá schůzka."
              isAdminView={isAdminTeamView}
              clients={clientOptions}
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
            clients={clientOptions}
          />
        ) : null}

        {view === 'overdue' ? (
          <MeetingSection
            eyebrow="Potřebuje řešení"
            title="Po termínu"
            count={visibleOverdueMeetings.length}
            meetings={visibleOverdueMeetings}
            emptyText="Pro zadaný filtr tu není žádná schůzka po termínu."
            isAdminView={isAdminTeamView}
            clients={clientOptions}
          />
        ) : null}

        {view === 'completed' ? (
          <MeetingSection
            eyebrow="Historie"
            title="Proběhlé"
            count={visibleCompletedMeetings.length}
            meetings={visibleCompletedMeetings}
            emptyText="Pro zadaný filtr tu není žádná proběhlá schůzka."
            isAdminView={isAdminTeamView}
            clients={clientOptions}
          />
        ) : null}
      </div>
    </main>
  )
}
