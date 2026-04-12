import Link from 'next/link'
import { getTasksForCurrentUser, TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import TaskSection from './TaskSection'

function StatCard({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-900">{value}</div>
    </div>
  )
}

function splitTasks(tasks: TaskRow[]) {
  return {
    active: tasks.filter((task) => task.status !== 'done'),
    resolved: tasks.filter((task) => task.status === 'done'),
  }
}

export default async function TasksPage() {
  const { profile, assignedToMe, createdByMe, allTasks } =
    await getTasksForCurrentUser()

  const isAdmin = profile.role === 'admin'

  const assigned = splitTasks(assignedToMe)
  const created = splitTasks(createdByMe)
  const adminAll = splitTasks(allTasks)

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-6 text-zinc-900 md:px-10 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between lg:p-10">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Agenda
              </div>

              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
                Moje úkoly
              </h1>

              <p className="mt-2 max-w-xl text-sm text-zinc-500">
                Správa týmových úkolů. Vidíš úkoly, které máš splnit, i úkoly,
                které jsi zadal.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-wide text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
              >
                ZPĚT NA DASHBOARD
              </Link>

              <Link
                href="/tasks/new"
                className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-zinc-800"
              >
                NOVÝ ÚKOL
              </Link>
            </div>
          </div>
        </section>

        <section className="flex flex-wrap gap-3">
          <StatCard label="Aktivní přidělené mně" value={assigned.active.length} />
          <StatCard label="Vyřešené přidělené mně" value={assigned.resolved.length} />
          <StatCard label="Aktivní zadané mnou" value={created.active.length} />
          <StatCard label="Vyřešené zadané mnou" value={created.resolved.length} />
          {isAdmin ? (
            <>
              <StatCard label="Všechny aktivní úkoly" value={adminAll.active.length} />
              <StatCard label="Všechny vyřešené úkoly" value={adminAll.resolved.length} />
            </>
          ) : null}
        </section>

        <TaskSection
          title="Úkoly přidělené mně"
          description="Aktivní úkoly, které jsou aktuálně přiřazené tobě."
          tasks={assigned.active}
        />

        <TaskSection
          title="Vyřešené úkoly přidělené mně"
          description="Dokončené úkoly, které zůstávají v evidenci."
          tasks={assigned.resolved}
        />

        <TaskSection
          title="Úkoly, které jsem zadal"
          description="Aktivní úkoly, které jsi vytvořil a delegoval dál nebo sobě."
          tasks={created.active}
        />

        <TaskSection
          title="Vyřešené úkoly, které jsem zadal"
          description="Dokončené úkoly, které jsi zadal dál nebo sobě."
          tasks={created.resolved}
        />

        {isAdmin ? (
          <>
            <TaskSection
              title="Všechny aktivní úkoly"
              description="Administrátorský přehled všech aktivních úkolů v systému."
              tasks={adminAll.active}
            />

            <TaskSection
              title="Všechny vyřešené úkoly"
              description="Administrátorský přehled všech dokončených úkolů v systému."
              tasks={adminAll.resolved}
            />
          </>
        ) : null}
      </div>
    </main>
  )
}