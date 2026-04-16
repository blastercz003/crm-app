import Link from 'next/link'
import { TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import { deleteTask, updateTaskStatus } from './actions'
import {
  getPriorityBadgeClass,
  getPriorityLabel,
  getStatusBadgeClass,
  getStatusLabel,
} from './taskUi'

type TaskCardProps = {
  task: TaskRow
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
    | null,
  fallback: string
) {
  if (!client) return fallback
  if (Array.isArray(client)) return client[0]?.name ?? fallback
  return client.name ?? fallback
}

function parseDueDate(value: string | null) {
  if (!value) return null

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const [, year, month, day] = match
  return new Date(Number(year), Number(month) - 1, Number(day))
}

function getDueDateState(dueDate: string | null, status: string | null) {
  if (!dueDate || status === 'done') {
    return {
      isToday: false,
      isOverdue: false,
    }
  }

  const parsed = parseDueDate(dueDate)
  if (!parsed) {
    return {
      isToday: false,
      isOverdue: false,
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const compareDate = new Date(parsed)
  compareDate.setHours(0, 0, 0, 0)

  const isToday = compareDate.getTime() === today.getTime()
  const isOverdue = compareDate.getTime() < today.getTime()

  return {
    isToday,
    isOverdue,
  }
}

function formatDueDate(value: string | null) {
  if (!value) return 'Bez termínu'

  const parsed = parseDueDate(value)
  if (!parsed) return value

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
  }).format(parsed)
}

export default function TaskCard({ task }: TaskCardProps) {
  const clientName = resolveClientName(
    task.client,
    task.company_name ?? 'Bez klienta'
  )

  const { isToday, isOverdue } = getDueDateState(task.due_date, task.status)

  const cardClassName = [
    'rounded-2xl border bg-white px-4 py-4 shadow-sm transition',
    isOverdue
      ? 'border-red-300 bg-red-50/40'
      : isToday
        ? 'border-orange-300 bg-orange-50/40'
        : 'border-zinc-200',
  ].join(' ')

  const dueBadgeClassName = [
    'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
    isOverdue
      ? 'bg-red-100 text-red-700'
      : isToday
        ? 'bg-orange-100 text-orange-700'
        : 'bg-zinc-100 text-zinc-700',
  ].join(' ')

  const completeTaskAction = updateTaskStatus.bind(null, task.id, 'done')
  const deleteTaskAction = deleteTask.bind(null, task.id)

  return (
    <div className={cardClassName}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold leading-tight text-zinc-950 md:text-lg">
                {task.title}
              </h3>

              <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
                💬 {task.comment_count}
              </span>
            </div>

            <div className="mt-2 text-sm text-zinc-500">
              <span className="text-zinc-400">Klient:</span> {clientName}
            </div>

            {task.note ? (
              <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2.5">
                <p className="whitespace-pre-wrap text-sm leading-5 text-zinc-700">
                  {task.note}
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col gap-2 md:w-[190px]">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Stav vyřízení
              </div>
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(task.status)}`}
              >
                {getStatusLabel(task.status)}
              </span>
            </div>

            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Priorita
              </div>
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getPriorityBadgeClass(task.priority)}`}
              >
                {getPriorityLabel(task.priority)}
              </span>
            </div>

            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                Termín
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={dueBadgeClassName}>
                  {formatDueDate(task.due_date)}
                </span>

                {isOverdue ? (
                  <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                    Po termínu
                  </span>
                ) : null}

                {isToday ? (
                  <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700">
                    Dnes
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-zinc-200/80 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/tasks/${task.id}`}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
            >
              Detail
            </Link>

            <Link
              href={`/tasks/${task.id}/edit`}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
            >
              Upravit
            </Link>

            {task.status !== 'done' ? (
              <form action={completeTaskAction}>
                <button className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800">
                  Dokončit
                </button>
              </form>
            ) : (
              <span className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
                Vyřešeno
              </span>
            )}
          </div>

          <form action={deleteTaskAction}>
            <button className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50">
              Smazat
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}