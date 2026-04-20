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
  }>
}

type ClientOption = {
  id: string
  name: string
}

type TaskView = 'all' | 'active' | 'resolved'

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
          ? 'border-green-100 bg-green-100 text-green-800'
          : 'border-zinc-200 bg-white text-zinc-950'

  const labelClassName =
    variant === 'neutral'
      ? 'text-zinc-950'
      : variant === 'success'
        ? 'text-current/80'
        : 'text-white'

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
}: {
  search: string
  view: TaskView
}) {
  const params = new URLSearchParams()

  if (search) {
    params.set('search', search)
  }

  if (view !== 'all') {
    params.set('view', view)
  }

  const query = params.toString()
  return query ? `/tasks?${query}` : '/tasks'
}

function splitTasks(tasks: TaskRow[]) {
  return {
    active: tasks.filter((task) => task.status !== 'done'),
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

function getProfileId(profile: { id?: string | null } | null | undefined) {
  return profile?.id ?? null
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const search = resolvedSearchParams?.search?.trim() ?? ''

  const rawView = resolvedSearchParams?.view
  const view: TaskView =
    rawView === 'active' || rawView === 'resolved' ? rawView : 'all'

  const supabase = await createClient()
  const users = await getAssignableUsers()

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name')
    .order('name', { ascending: true })

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  const clientOptions = (clients ?? []) as ClientOption[]

  const { profile, assignedToMe, createdByMe, allTasks } =
    await getTasksForCurrentUser()

  const isAdmin = profile.role === 'admin'
  const profileId = getProfileId(profile)

  const filteredAssignedToMe = filterTasks(assignedToMe, search)
  const filteredCreatedByMe = filterTasks(createdByMe, search)
  const filteredAllTasks = filterTasks(allTasks, search)

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

              <NewTaskButton users={users} clients={clientOptions} />
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
                  href={getTabHref({ search, view: 'all' })}
                  label="Vše"
                  active={view === 'all'}
                />
                <FilterTab
                  href={getTabHref({ search, view: 'active' })}
                  label="Aktivní"
                  active={view === 'active'}
                />
                <FilterTab
                  href={getTabHref({ search, view: 'resolved' })}
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
        </section>

        {view !== 'resolved' ? (
          <section className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-4">
              <TaskSection
                title="Úkoly přidělené mně"
                tasks={visibleAssignedActive}
                users={users}
                clients={clientOptions}
                countVariant="primary"
              />
            </div>

            <div className="space-y-4">
              <TaskSection
                title="Úkoly, které jsem zadal ostatním"
                tasks={visibleDelegatedActive}
                users={users}
                clients={clientOptions}
                countVariant="dark"
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
                muted
                countVariant="success"
              />

              <TaskSection
                title="Vyřešené zadané ostatním"
                tasks={visibleDelegatedResolved}
                users={users}
                clients={clientOptions}
                muted
                countVariant="success"
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
                  countVariant="dark"
                />
              ) : null}

              {view !== 'active' ? (
                <TaskSection
                  title="Všechny vyřešené úkoly"
                  tasks={visibleAdminResolved}
                  users={users}
                  clients={clientOptions}
                  muted
                  countVariant="success"
                />
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
