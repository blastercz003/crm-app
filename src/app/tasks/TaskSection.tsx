import { TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import TaskCard from './TaskCard'

type TaskSectionProps = {
  title: string
  description?: string
  tasks: TaskRow[]
}

export default function TaskSection({
  title,
  description,
  tasks,
}: TaskSectionProps) {
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
          {title}
        </h2>

        {description ? (
          <p className="mt-2 text-sm text-zinc-500">{description}</p>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
          V této sekci zatím nejsou žádné úkoly.
        </div>
      ) : (
        <div className="grid gap-4">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </section>
  )
}