import Link from 'next/link'
import { getTasksForCurrentUser, TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import { createClient } from '@/lib/supabase/server'
import { getAssignableUsers } from '@/lib/users/getAssignableUsers'
import NewTaskButton from './new-task-button'
import TaskSection from './TaskSection'

type TasksPageProps = {
  searchParams?: Promise<{
    search?: string
    view?: string
    range?: string
  }>
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

type TaskView = 'all' | 'active' | 'resolved'
type TaskRange = 'all' | 'today' | 'this_week' | 'next_week'

function StatCard({
  label,
  value,
  variant = 'neutral',
}: {
  label: string
  value: number
  variant?: 'primary' | 'dark' | 'success' | 'neutral'
}) {
  const className =
    variant === 'primary'
      ? 'border-[#2980B9] bg-[#2980B9] text-white'
      : variant === 'dark'
        ? 'border-zinc-800 bg-zinc-800 text-white'
        : variant === 'success'
          ? 'border-transparent bg-emerald-600 text-white'
          : 'border-zinc-200 bg-white text-zinc-950'

  const labelClassName =
    variant === 'neutral' ? 'text-zinc-950' : 'text-white'

  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${className}`}>
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

function getTabHref({
  search,
  view,
  range,
}: {
  search: string
  view: TaskView
  range: TaskRange
}) {
  const params = new URLSearchParams()

  if (search) {
    params.set('search', search)
  }

  if (view !== 'all') {
    params.set('view', view)
  }

  if (range !== 'all') {
    params.set('range', range)
  }

  const query = params.toString()
  return query ? `/tasks?${query}` : '/tasks'
}

function isTaskRange(value: string | undefined): value is TaskRange {
  return (
    value === 'all' ||
    value === 'today' ||
    value === 'this_week' ||
    value === 'next_week'
  )
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

function getRangeLabel(range: TaskRange) {
  switch (range) {
    case 'today':
      return 'Dnes'
    case 'this_week':
      return 'Tento týden'
    case 'next_week':
      return 'Příští týden'
    default:
      return 'Bez termínového filtru'
  }
}

function getPriorityRank(priority: string | null | undefined) {
  switch (priority) {
    case 'high':
      return 0
    case 'medium':
      return 1
    case 'low':
      return 2
    default:
      return 3
  }
}

function getDueDateRank(dueDate: string | null | undefined) {
  return dueDate || '9999-12-31'
}

function sortActiveTasks(tasks: TaskRow[]) {
  return [...tasks].sort((a, b) => {
    const priorityDifference = getPriorityRank(a.priority) - getPriorityRank(b.priority)

    if (priorityDifference !== 0) {
      return priorityDifference
    }

    const dueDateDifference = getDueDateRank(a.due_date).localeCompare(getDueDateRank(b.due_date))

    if (dueDateDifference !== 0) {
      return dueDateDifference
    }

    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })
}

function splitTasks(tasks: TaskRow[]) {
  return {
    active: sortActiveTasks(tasks.filter((task) => task.status !== 'done')),
    resolved: tasks.filter((task) => task.status === 'done'),
  }
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').toLocaleLowerCase('cs-CZ')
}

function resolvePersonName(
  person: { name: string | null } | { name: string | null }[] | null
) {
  if (!person) return ''
  if (Array.isArray(person)) return person[0]?.name ?? ''
  return person.name ?? ''
}

function resolveClientName(
  client:
    | {
        id: string
        name: string | null
      }
    | {
        id: string
        name: string | null
      }[]
    | null
) {
  if (!client) return ''
  if (Array.isArray(client)) return client[0]?.name ?? ''
  return client.name ?? ''
}

function filterTasks(tasks: TaskRow[], search: string) {
  const query = normalizeText(search).trim()
  if (!query) return tasks

  return tasks.filter((task) => {
    const haystack = [
      task.title,
      task.note,
      task.company_name,
      task.contact_person,
      resolveClientName(task.client),
      resolvePersonName(task.creator),
      resolvePersonName(task.assignee),
    ]
      .map((value) => normalizeText(value))
      .join(' ')

    return haystack.includes(query)
  })
}

function filterTasksByRange(tasks: TaskRow[], range: TaskRange) {
  if (range === 'all') return tasks

  const todayRange = getTodayRange()
  const thisWeekRange = getWeekRange(0)
  const nextWeekRange = getWeekRange(1)

  const selectedRange =
    range === 'today'
      ? todayRange
      : range === 'this_week'
        ? thisWeekRange
        : nextWeekRange

  return tasks.filter((task) => {
    if (!task.due_date) return false

    return (
      task.due_date >= selectedRange.from &&
      task.due_date <= selectedRange.to
    )
  })
}

function getProfileId(profile: { id?: string | null } | null | undefined) {
  return profile?.id ?? null
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const search = resolvedSearchParams?.search?.trim() ?? ''

  const rawView = resolvedSearchParams?.view
  const view: TaskView =
    rawView === 'active' || rawView === 'resolved' ? rawView : 'all'
  const range: TaskRange = isTaskRange(resolvedSearchParams?.range)
    ? resolvedSearchParams?.range
    : 'all'

  const supabase = await createClient()
  const users = await getAssignableUsers()

  const [clientsResponse, contactsResponse] = await Promise.all([
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, is_primary')
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

  const { profile, assignedToMe, createdByMe, allTasks } =
    await getTasksForCurrentUser()

  const isAdmin = profile.role === 'admin'
  const profileId = getProfileId(profile)

  const filteredAssignedToMe = filterTasksByRange(
    filterTasks(assignedToMe, search),
    range
  )
  const filteredCreatedByMe = filterTasksByRange(
    filterTasks(createdByMe, search),
    range
  )
  const filteredAllTasks = filterTasksByRange(
    filterTasks(allTasks, search),
    range
  )

  const createdForOthers = profileId
    ? filteredCreatedByMe.filter((task) => task.assigned_to !== profileId)
    : filteredCreatedByMe

  const assigned = splitTasks(filteredAssignedToMe)
  const delegated = splitTasks(createdForOthers)
  const adminAll = splitTasks(filteredAllTasks)

  const visibleAssignedActive = view === 'resolved' ? [] : assigned.active
  const visibleDelegatedActive = view === 'resolved' ? [] : delegated.active
  const visibleAssignedResolved = view === 'active' ? [] : assigned.resolved
  const visibleDelegatedResolved = view === 'active' ? [] : delegated.resolved
  const visibleAdminActive = view === 'resolved' ? [] : adminAll.active
  const visibleAdminResolved = view === 'active' ? [] : adminAll.resolved

  const totalVisibleCount =
    visibleAssignedActive.length +
    visibleDelegatedActive.length +
    visibleAssignedResolved.length +
    visibleDelegatedResolved.length

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Moje úkoly
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form
                action="/tasks"
                method="get"
                className="flex w-full gap-3 sm:w-auto"
              >
                <input
                  id="task-search"
                  name="search"
                  defaultValue={search}
                  placeholder="Název úkolu, klient, osoba, poznámka..."
                  className="w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200 sm:w-56 lg:w-72"
                />

                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="range" value={range} />

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

              <NewTaskButton users={users} clients={clientOptions} contacts={contactOptions} />
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-zinc-200 bg-white shadow-sm">
          <div className="p-4 md:p-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Zobrazení
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <FilterTab
                  href={getTabHref({ search, view: 'all', range })}
                  label="Vše"
                  active={view === 'all'}
                />
                <FilterTab
                  href={getTabHref({ search, view: 'active', range })}
                  label="Aktivní"
                  active={view === 'active'}
                />
                <FilterTab
                  href={getTabHref({ search, view: 'resolved', range })}
                  label="Vyřešené"
                  active={view === 'resolved'}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <InfoChip
                  label={
                    view === 'all'
                      ? 'Pohled: Vše'
                      : view === 'active'
                        ? 'Pohled: Aktivní'
                        : 'Pohled: Vyřešené'
                  }
                />
                {search ? <InfoChip label={`Hledání: ${search}`} /> : null}
                {range !== 'all' ? (
                  <InfoChip label={`Termín: ${getRangeLabel(range)}`} />
                ) : null}
                {isAdmin ? <InfoChip label="Admin" /> : null}
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <StatCard
                  label="Aktivní mně"
                  value={visibleAssignedActive.length}
                  variant="primary"
                />
                <StatCard
                  label="Aktivní ostatním"
                  value={visibleDelegatedActive.length}
                  variant="dark"
                />
                <StatCard
                  label="Vyřešené celkem"
                  value={
                    visibleAssignedResolved.length + visibleDelegatedResolved.length
                  }
                  variant="success"
                />
                <StatCard label="Úkolů celkem" value={totalVisibleCount} />
              </div>
            </div>
          </div>

            <div className="mt-4 grid grid-cols-4 gap-1.5 border-t border-zinc-100 pt-4 sm:flex sm:flex-nowrap sm:items-center sm:justify-end sm:gap-2">
              <Link
                href={getTabHref({ search, view, range: 'today' })}
                className={`inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl px-2 text-[11px] font-medium text-white transition sm:h-9 sm:px-4 sm:text-sm ${
                  range === 'today'
                    ? 'bg-[#236f9f] shadow-sm'
                    : 'bg-[#2980B9] hover:bg-[#236f9f]'
                }`}
              >
                DNES
              </Link>

              <Link
                href={getTabHref({ search, view, range: 'this_week' })}
                className={`inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl px-2 text-[11px] font-medium text-white transition sm:h-9 sm:px-4 sm:text-sm ${
                  range === 'this_week'
                    ? 'bg-[#236f9f] shadow-sm'
                    : 'bg-[#2980B9] hover:bg-[#236f9f]'
                }`}
              >
                TENTO TÝDEN
              </Link>

              <Link
                href={getTabHref({ search, view, range: 'next_week' })}
                className={`inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl px-2 text-[11px] font-medium text-white transition sm:h-9 sm:px-4 sm:text-sm ${
                  range === 'next_week'
                    ? 'bg-[#236f9f] shadow-sm'
                    : 'bg-[#2980B9] hover:bg-[#236f9f]'
                }`}
              >
                PŘÍŠTÍ TÝDEN
              </Link>

              <Link
                href={getTabHref({ search, view, range: 'all' })}
                className="inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-2 text-[11px] font-medium uppercase text-gray-700 transition hover:bg-gray-50 sm:h-9 sm:px-4 sm:text-sm"
              >
                RESET
              </Link>
            </div>
          </div>
        </section>

        {view !== 'resolved' ? (
          <section className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-4">
              <TaskSection
                title="Úkoly přidělené mně"
                tasks={visibleAssignedActive}
                users={users}
                clients={clientOptions}
                contacts={contactOptions}
                countVariant="primary"
                initialVisibleCount={5}
              />
            </div>

            <div className="space-y-4">
              <TaskSection
                title="Úkoly, které jsem zadal ostatním"
                tasks={visibleDelegatedActive}
                users={users}
                clients={clientOptions}
                contacts={contactOptions}
                countVariant="dark"
                initialVisibleCount={5}
              />
            </div>
          </section>
        ) : null}

        {view !== 'active' ? (
          <section className="space-y-4">
            <div className="px-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Archiv
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950">
                Vyřešené úkoly
              </h2>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <TaskSection
                title="Vyřešené přidělené mně"
                tasks={visibleAssignedResolved}
                users={users}
                clients={clientOptions}
                contacts={contactOptions}
                muted
                countVariant="success"
                initialVisibleCount={5}
              />

              <TaskSection
                title="Vyřešené zadané ostatním"
                tasks={visibleDelegatedResolved}
                users={users}
                clients={clientOptions}
                contacts={contactOptions}
                muted
                countVariant="success"
                initialVisibleCount={5}
              />
            </div>
          </section>
        ) : null}

        {isAdmin ? (
          <section className="space-y-4">
            <div className="px-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Administrace
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950">
                Přehled všech úkolů
              </h2>
              <p className="mt-2 text-sm text-zinc-500">
                Rozšířený administrátorský pohled na celý systém.
              </p>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {view !== 'resolved' ? (
                <TaskSection
                  title="Všechny aktivní úkoly"
                  tasks={visibleAdminActive}
                  users={users}
                  clients={clientOptions}
                  contacts={contactOptions}
                  countVariant="dark"
                  initialVisibleCount={5}
                />
              ) : null}

              {view !== 'active' ? (
                <TaskSection
                  title="Všechny vyřešené úkoly"
                  tasks={visibleAdminResolved}
                  users={users}
                  clients={clientOptions}
                  contacts={contactOptions}
                  muted
                  countVariant="success"
                  initialVisibleCount={5}
                />
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
