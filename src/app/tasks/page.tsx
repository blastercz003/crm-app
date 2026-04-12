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

function FilterPill({
  label,
  active = false,
}: {
  label: string
  active?: boolean
}) {
  return (
    <div
      className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? 'bg-zinc-900 text-white shadow-sm'
          : 'border border-zinc-200 bg-white text-zinc-600'
      }`}
    >
      {label}
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

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const search = resolvedSearchParams?.search?.trim() ?? ''

  const { profile, assignedToMe, createdByMe, allTasks } =
    await getTasksForCurrentUser()

  const isAdmin = profile.role === 'admin'

  const filteredAssignedToMe = filterTasks(assignedToMe, search)
  const filteredCreatedByMe = filterTasks(createdByMe, search)
  const filteredAllTasks = filterTasks(allTasks, search)

  const assigned = splitTasks(filteredAssignedToMe)
  const created = splitTasks(filteredCreatedByMe)
  const adminAll = splitTasks(filteredAllTasks)

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-4 text-zinc-900 md:px-6 md:py-6 xl:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-[26px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 p-5 md:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Agenda
              </div>

              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 md:text-3xl">
                Moje úkoly
              </h1>

              <p className="mt-2 max-w-2xl text-sm text-zinc-500">
                Přehled úkolů, které máš splnit, i těch, které jsi zadal dál.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium uppercase tracking-[0.08em] text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
              >
                ZPĚT NA DASHBOARD
              </Link>

              <Link
                href="/tasks/new"
                className="inline-flex items-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800"
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
                Zobrazení
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <FilterPill label="Vše" active />
                <FilterPill label="Přidělené mně" />
                <FilterPill label="Zadané mnou" />
                <FilterPill label="Aktivní" active />
                <FilterPill label="Vyřešené" />
                {isAdmin ? <FilterPill label="Administrace" /> : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <InfoChip label="Pohled: Vše" />
                <InfoChip label={search ? `Hledání: ${search}` : 'Hledání: Bez filtru'} />
                <InfoChip label={isAdmin ? 'Role: Admin' : 'Role: Uživatel'} />
              </div>
            </div>

            <div className="space-y-3">
              <div
                className={`grid gap-2 ${
                  isAdmin ? 'grid-cols-2 xl:grid-cols-3' : 'grid-cols-2'
                }`}
              >
                <StatCard
                  label="Aktivní mně"
                  value={assigned.active.length}
                />
                <StatCard
                  label="Vyřešené mně"
                  value={assigned.resolved.length}
                />
                <StatCard
                  label="Aktivní mnou"
                  value={created.active.length}
                />
                <StatCard
                  label="Vyřešené mnou"
                  value={created.resolved.length}
                />

                {isAdmin ? (
                  <>
                    <StatCard
                      label="Všechny aktivní"
                      value={adminAll.active.length}
                    />
                    <StatCard
                      label="Všechny hotové"
                      value={adminAll.resolved.length}
                    />
                  </>
                ) : null}
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
                      Filtrovat
                    </button>

                    <Link
                      href="/tasks"
                      className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950"
                    >
                      Reset
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
              description="Aktuálně otevřené úkoly."
              tasks={assigned.active}
            />

            <TaskSection
              title="Vyřešené přidělené mně"
              description="Dokončené položky."
              tasks={assigned.resolved}
              muted
            />
          </div>

          <div className="space-y-4">
            <TaskSection
              title="Úkoly, které jsem zadal"
              description="Aktivní delegované úkoly."
              tasks={created.active}
            />

            <TaskSection
              title="Vyřešené zadané mnou"
              description="Dokončené delegované úkoly."
              tasks={created.resolved}
              muted
            />
          </div>
        </section>

        {isAdmin ? (
          <section className="space-y-4">
            <div className="px-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Administrace
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950">
                Přehled všech úkolů
              </h2>
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