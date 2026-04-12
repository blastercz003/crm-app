import { TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import TaskCard from './TaskCard'

type TaskSectionProps = {
  title: string
  description?: string
  tasks: TaskRow[]
  muted?: boolean
}

export default function TaskSection({
  title,
  description,
  tasks,
  muted = false,
}: TaskSectionProps) {
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
              <p className="mt-1 text-sm text-zinc-500">{description}</p>
            ) : null}
          </div>

          <span className="inline-flex shrink-0 items-center rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200">
            {tasks.length}
          </span>
        </div>
      </div>

      <div className="p-4 md:p-5">
        {tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/80 px-4 py-5 text-sm text-zinc-500">
            V této sekci zatím nejsou žádné úkoly.
          </div>
        ) : (
          <div className="grid gap-3">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}