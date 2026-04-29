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
}: TaskSectionProps) {
  const countClassName =
    countVariant === 'primary'
      ? 'border-transparent bg-[#2980B9] text-white'
      : countVariant === 'dark'
        ? 'border-transparent bg-zinc-800 text-white'
        : countVariant === 'success'
          ? 'border-green-100 bg-green-100 text-green-800'
          : muted
            ? 'bg-white text-zinc-500 ring-1 ring-zinc-200'
            : 'bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200'

  return (
    <section
      className={`rounded-[24px] border shadow-sm ${
        muted
          ? 'border-zinc-200 bg-zinc-50/70'
          : 'border-zinc-200 bg-white'
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
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/80 px-4 py-5 text-sm leading-6 text-zinc-500">
            V této sekci zatím nejsou žádné úkoly.
          </div>
        ) : (
          <div className="grid gap-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                users={users}
                clients={clients}
                contacts={contacts}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
