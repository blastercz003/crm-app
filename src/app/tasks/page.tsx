import Link from 'next/link'
import type { Metadata } from 'next'
import { getTasksForCurrentUser, TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import { createClient } from '@/lib/supabase/server'
import { getAssignableUsers } from '@/lib/users/getAssignableUsers'
import NewTaskButton from './new-task-button'
import TaskSection from './TaskSection'
import { TaskFilterSubmitButton } from './task-filter-submit-button'
import { TaskFilterResetLink } from './task-filter-reset-link'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'

export const metadata: Metadata = {
  title: 'Úkoly',
}

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
      ? 'border-transparent bg-[#2980B9] text-white'
      : variant === 'dark'
        ? 'border-transparent bg-zinc-800 text-white'
        : variant === 'success'
          ? 'border-transparent bg-emerald-600 text-white'
          : 'border-zinc-200 bg-white text-zinc-950'

  const labelClassName =
    variant === 'neutral' ? 'text-zinc-950' : 'text-white'

  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.12)] ${className}`}>
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
    <div className="inline-flex items-center whitespace-nowrap rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-1 text-[11px] text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] sm:py-1.5 sm:text-xs">
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
        'inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition duration-200 ease-out sm:px-4 sm:py-2 sm:text-sm',
        active
          ? 'border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
          : 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]',
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

  const hasActiveMobileFilters = view !== 'all'

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <PresenceSectionTracker section="Úkoly" route="/tasks" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
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
                  className="w-full min-w-0 rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:w-56 lg:w-72"
                />

                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="range" value={range} />

                <button
                  type="submit"
                  className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                ZPĚT NA DASHBOARD
              </Link>

              <NewTaskButton users={users} clients={clientOptions} contacts={contactOptions} />
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="p-4 md:p-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
            <div className="min-w-0 hidden lg:block">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Zobrazení
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2.5 sm:gap-y-2">
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

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-y-1.5">
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
            <details
              id="tasks-mobile-filters"
              className="group print-hidden w-full lg:hidden"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2.5 rounded-xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(242,247,252,0.88)_100%)] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
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
                action="/tasks"
                method="get"
                className="mt-2 space-y-3 rounded-2xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"
              >
                <input type="hidden" name="search" value={search} />
                <input type="hidden" name="range" value={range} />

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
                    <option value="resolved">Vyřešené</option>
                  </select>
                </div>

                <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
                  <TaskFilterSubmitButton className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800">
                    POUŽÍT FILTRY
                  </TaskFilterSubmitButton>
                </div>
              </form>
            </details>

            <div className="space-y-3">
              <div className="hidden grid-cols-4 gap-2 md:grid">
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

            <div className="mt-0 grid grid-cols-4 gap-1.5 lg:hidden">
              <Link
                href={getTabHref({ search, view, range: 'today' })}
                className={`inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl border border-[#76a9d3]/85 px-2 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] sm:h-9 sm:px-4 sm:text-sm ${
                  range === 'today'
                    ? 'bg-[linear-gradient(155deg,#3f86be_0%,#2f74ab_55%,#245f91_100%)]'
                    : 'bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)]'
                }`}
              >
                DNES
              </Link>

              <Link
                href={getTabHref({ search, view, range: 'this_week' })}
                className={`inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl border border-[#76a9d3]/85 px-2 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] sm:h-9 sm:px-4 sm:text-sm ${
                  range === 'this_week'
                    ? 'bg-[linear-gradient(155deg,#3f86be_0%,#2f74ab_55%,#245f91_100%)]'
                    : 'bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)]'
                }`}
              >
                TENTO TÝDEN
              </Link>

              <Link
                href={getTabHref({ search, view, range: 'next_week' })}
                className={`inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl border border-[#76a9d3]/85 px-2 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] sm:h-9 sm:px-4 sm:text-sm ${
                  range === 'next_week'
                    ? 'bg-[linear-gradient(155deg,#3f86be_0%,#2f74ab_55%,#245f91_100%)]'
                    : 'bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)]'
                }`}
              >
                PŘÍŠTÍ TÝDEN
              </Link>

              <TaskFilterResetLink
                href="/tasks"
                detailsId="tasks-mobile-filters"
                className="inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-2 text-[11px] font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_16px_rgba(15,23,42,0.09)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900 sm:h-9 sm:px-4 sm:text-sm"
              >
                RESET
              </TaskFilterResetLink>
            </div>
            <div className="mt-4 hidden flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 lg:flex">
              <Link
                href={getTabHref({ search, view, range: 'today' })}
                className={`inline-flex min-w-0 h-9 items-center justify-center whitespace-nowrap rounded-xl border border-[#76a9d3]/85 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] ${
                  range === 'today'
                    ? 'bg-[linear-gradient(155deg,#3f86be_0%,#2f74ab_55%,#245f91_100%)]'
                    : 'bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)]'
                }`}
              >
                DNES
              </Link>

              <Link
                href={getTabHref({ search, view, range: 'this_week' })}
                className={`inline-flex min-w-0 h-9 items-center justify-center whitespace-nowrap rounded-xl border border-[#76a9d3]/85 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] ${
                  range === 'this_week'
                    ? 'bg-[linear-gradient(155deg,#3f86be_0%,#2f74ab_55%,#245f91_100%)]'
                    : 'bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)]'
                }`}
              >
                TENTO TÝDEN
              </Link>

              <Link
                href={getTabHref({ search, view, range: 'next_week' })}
                className={`inline-flex min-w-0 h-9 items-center justify-center whitespace-nowrap rounded-xl border border-[#76a9d3]/85 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] ${
                  range === 'next_week'
                    ? 'bg-[linear-gradient(155deg,#3f86be_0%,#2f74ab_55%,#245f91_100%)]'
                    : 'bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)]'
                }`}
              >
                PŘÍŠTÍ TÝDEN
              </Link>

              <Link
                href="/tasks"
                className="inline-flex min-w-0 h-9 items-center justify-center whitespace-nowrap rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_16px_rgba(15,23,42,0.09)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900"
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
