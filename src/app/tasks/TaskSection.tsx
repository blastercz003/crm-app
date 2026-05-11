import { TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import TaskCard from './TaskCard'

type UserOption = {
  id: string
  name: string | null
  role: string | null
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

type TaskSectionProps = {
  title: string
  description?: string
  tasks: TaskRow[]
  users: UserOption[]
  clients: ClientOption[]
  contacts: ClientContactOption[]
  muted?: boolean
  countVariant?: 'primary' | 'dark' | 'success' | 'neutral'
  initialVisibleCount?: number
}

export default function TaskSection({
  title,
  description,
  tasks,
  users,
  clients,
  contacts,
  muted = false,
  countVariant = 'neutral',
  initialVisibleCount,
}: TaskSectionProps) {
  const shouldLimitTasks =
    typeof initialVisibleCount === 'number' && tasks.length > initialVisibleCount
  const visibleTasks = shouldLimitTasks ? tasks.slice(0, initialVisibleCount) : tasks
  const hiddenTasks = shouldLimitTasks ? tasks.slice(initialVisibleCount) : []

  const countClassName =
    countVariant === 'primary'
      ? 'border-transparent bg-[#2980B9] text-white'
      : countVariant === 'dark'
        ? 'border-transparent bg-zinc-800 text-white'
        : countVariant === 'success'
          ? 'border-transparent bg-emerald-600 text-white'
          : muted
            ? 'bg-white text-zinc-500 ring-1 ring-zinc-200'
            : 'bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200'

  return (
    <section
      className={`rounded-[24px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_32px_rgba(15,23,42,0.1)] ${
        muted
          ? 'border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(246,248,251,0.88)_100%)]'
          : 'border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)]'
      }`}
    >
      <div className="border-b border-zinc-200/80 px-4 py-4 md:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              className={`text-lg font-semibold tracking-tight md:text-xl ${
                muted ? 'text-zinc-800' : 'text-zinc-950'
              }`}
            >
              {title}
            </h2>

            {description ? (
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                {description}
              </p>
            ) : null}
          </div>

          <span
            className={`inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-2.5 text-xs font-semibold ${countClassName}`}
          >
            {tasks.length}
          </span>
        </div>
      </div>

      <div className="p-4 md:p-5">
        {tasks.length === 0 ? (
          <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-5 text-sm leading-6 text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.08)]">
            V této sekci zatím nejsou žádné úkoly.
          </div>
        ) : (
          <div className="grid gap-3">
            {visibleTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                users={users}
                clients={clients}
                contacts={contacts}
              />
            ))}

            {hiddenTasks.length > 0 ? (
              <details className="group grid gap-3">
                <summary className="inline-flex min-h-10 cursor-pointer list-none items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800 [&::-webkit-details-marker]:hidden">
                  ZOBRAZIT VŠE
                </summary>

                <div className="grid gap-3">
                  {hiddenTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      users={users}
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
