import Link from 'next/link'
import { TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import { deleteTask, updateTaskStatus } from './actions'
import EditTaskButton from './edit-task-button'
import {
  getStatusBadgeClass,
  getStatusLabel,
} from './taskUi'

type UserOption = {
  id: string
  name: string | null
  role: string | null
}

type ClientOption = {
  id: string
  name: string
}

type TaskCardProps = {
  task: TaskRow
  users: UserOption[]
  clients: ClientOption[]
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

export default function TaskCard({
  task,
  users,
  clients,
}: TaskCardProps) {
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
  const actionButtonClassName =
    'inline-flex h-9 items-center justify-center rounded-xl px-3 text-xs font-medium transition'

  return (
    <div className={cardClassName}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-semibold text-zinc-900 md:text-base">
              {task.title}
            </h3>

            <div className="mt-1 text-sm text-zinc-600">
              {clientName}
            </div>

            {task.note ? (
              <div className="mt-1 text-xs text-zinc-500">
                {task.note}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2 text-sm">
            <div className={dueBadgeClassName}>
              {formatDueDate(task.due_date)}
            </div>
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(task.status)}`}
              style={task.status === 'todo' ? { backgroundColor: '#2980B9' } : undefined}
            >
              {getStatusLabel(task.status)}
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

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/tasks/${task.id}`}
            className={`${actionButtonClassName} border border-gray-200 bg-white text-gray-700 hover:bg-gray-100`}
          >
            DETAIL
          </Link>

          <EditTaskButton
            task={{
              id: task.id,
              title: task.title,
              note: task.note,
              due_date: task.due_date,
              status: task.status,
              priority: task.priority,
              assigned_to: task.assigned_to,
              client_id: task.client_id,
              company_name: task.company_name,
              contact_person: task.contact_person,
            }}
            users={users}
            clients={clients}
            className={`${actionButtonClassName} bg-zinc-900 text-white hover:bg-zinc-800`}
            label="UPRAVIT"
          />

          {task.status !== 'done' ? (
            <form action={completeTaskAction}>
              <button
                className={`${actionButtonClassName} text-white hover:opacity-90`}
                style={{ backgroundColor: '#2980B9' }}
              >
                DOKONČIT
              </button>
            </form>
          ) : (
            <span className={`${actionButtonClassName} bg-emerald-50 text-emerald-700`}>
              VYŘEŠENO
            </span>
          )}

          <form action={deleteTaskAction}>
            <button className={`${actionButtonClassName} border border-red-200 bg-white text-red-600 hover:bg-red-50`}>
              SMAZAT
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
