import Link from 'next/link'
import { getTasksForCurrentUser, TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import TaskSection from './TaskSection'

type TasksPageProps = {
  searchParams?: Promise<{
    search?: string
  }>
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

  const hasResolvedAssigned = assigned.resolved.length > 0
  const hasResolvedDelegated = delegated.resolved.length > 0
  const hasAnyResolved = hasResolvedAssigned || hasResolvedDelegated

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-4 text-zinc-900 md:px-6 md:py-6 xl:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-5 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Agenda
              </div>

              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
                Moje úkoly
              </h1>

              <p className="mt-2 text-sm text-zinc-500">
                Přehled úkolů, které máš splnit, i těch, které jsi zadal dál.
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
                href="/tasks/new"
                className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800"
              >
                NOVÝ ÚKOL
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-zinc-200 bg-white shadow-sm">
          <div className="grid gap-5 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Přehled
              </div>

              <h2 className="mt-2 text-lg font-semibold tracking-tight text-zinc-950">
                Hlavní pracovní agenda
              </h2>

              <p className="mt-2 text-sm text-zinc-500">
                Nahoře vidíš své aktivní úkoly a zvlášť úkoly delegované ostatním.
                
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <InfoChip label="MOJE ÚKOLY" />
                <InfoChip label="BEZ DUPLICIT" />
                {search ? <InfoChip label={`HLEDÁNÍ: ${search}`} /> : null}
                {isAdmin ? <InfoChip label="ADMIN" /> : null}
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Aktivní mně" value={assigned.active.length} />
                <StatCard label="Vyřešené mně" value={assigned.resolved.length} />
                <StatCard
                  label="Aktivní ostatním"
                  value={delegated.active.length}
                />
                <StatCard
                  label="Vyřešené ostatním"
                  value={delegated.resolved.length}
                />
              </div>

              <form action="/tasks" className="space-y-2.5">
                <label
                  htmlFor="task-search"
                  className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400"
                >
                  Hledat
                </label>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="task-search"
                    name="search"
                    defaultValue={search}
                    placeholder="Název úkolu, klient, osoba, poznámka..."
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400"
                  />

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="inline-flex h-11 items-center justify-center rounded-2xl bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800"
                    >
                      FILTROVAT
                    </button>

                    <Link
                      href="/tasks"
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium uppercase tracking-[0.08em] text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950"
                    >
                      RESET
                    </Link>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            <TaskSection
              title="Úkoly přidělené mně"
              description="Aktuálně otevřené úkoly, které mám splnit."
              tasks={assigned.active}
            />
          </div>

          <div className="space-y-4">
            <TaskSection
              title="Úkoly, které jsem zadal ostatním"
              description="Aktivní delegované úkoly."
              tasks={delegated.active}
            />
          </div>
        </section>

        {hasAnyResolved ? (
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
              {hasResolvedAssigned ? (
                <TaskSection
                  title="Vyřešené přidělené mně"
                  description="Dokončené položky, které jsem měl splnit."
                  tasks={assigned.resolved}
                  muted
                />
              ) : (
                <div className="rounded-[26px] border border-zinc-200 bg-white p-6 shadow-sm">
                  <div className="text-sm font-medium text-zinc-950">
                    Vyřešené přidělené mně
                  </div>
                  <p className="mt-2 text-sm text-zinc-500">
                    Zatím tu nejsou žádné dokončené položky.
                  </p>
                </div>
              )}

              {hasResolvedDelegated ? (
                <TaskSection
                  title="Vyřešené zadané ostatním"
                  description="Dokončené delegované úkoly bez vlastních duplicit."
                  tasks={delegated.resolved}
                  muted
                />
              ) : (
                <div className="rounded-[26px] border border-zinc-200 bg-white p-6 shadow-sm">
                  <div className="text-sm font-medium text-zinc-950">
                    Vyřešené zadané ostatním
                  </div>
                  <p className="mt-2 text-sm text-zinc-500">
                    Zatím tu nejsou žádné dokončené delegované úkoly.
                  </p>
                </div>
              )}
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
              <TaskSection
                title="Všechny aktivní úkoly"
                description="Všechny otevřené úkoly v systému."
                tasks={adminAll.active}
              />

              <TaskSection
                title="Všechny vyřešené úkoly"
                description="Všechny dokončené úkoly v systému."
                tasks={adminAll.resolved}
                muted
              />
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}