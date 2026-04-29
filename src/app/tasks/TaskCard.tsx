import Link from 'next/link'
import { TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import EditTaskButton from './edit-task-button'
import { updateTaskStatus } from './actions'
import { TaskCompleteButton } from './task-complete-button'
import {
  getPriorityBadgeClass,
  getPriorityLabel,
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

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

type TaskCardProps = {
  task: TaskRow
  users: UserOption[]
  clients: ClientOption[]
  contacts: ClientContactOption[]
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

function truncatePreviewText(value: string | null, maxLength = 72) {
  const text = value?.trim() ?? ''

  if (!text) return ''
  if (text.length <= maxLength) return text

  return `${text.slice(0, maxLength).trimEnd()}...`
}

export default function TaskCard({
  task,
  users,
  clients,
  contacts,
}: TaskCardProps) {
  const markTaskDoneAction = updateTaskStatus.bind(null, task.id, 'done')
  const clientName = resolveClientName(
    task.client,
    task.company_name ?? 'Bez klienta'
  )

  const { isToday, isOverdue } = getDueDateState(task.due_date, task.status)

  const cardClassName = [
    'min-w-0 overflow-hidden rounded-2xl border px-4 py-4 shadow-sm transition',
    isOverdue
      ? 'border-red-300 bg-white hover:border-red-400'
      : isToday
        ? 'border-orange-300 bg-white hover:border-orange-400'
        : 'border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50',
  ].join(' ')

  const dueBadgeClassName = [
    'inline-flex min-w-0 shrink items-center rounded-full px-2 py-1 text-[10px] font-medium sm:px-2.5 sm:text-xs',
    isOverdue
      ? 'bg-red-100 text-red-700'
      : isToday
        ? 'bg-orange-100 text-orange-700'
        : 'bg-zinc-100 text-zinc-700',
  ].join(' ')

  const actionButtonClassName =
    'inline-flex h-9 items-center justify-center rounded-xl px-3 text-xs font-medium transition'

  return (
    <div className={`${cardClassName} min-h-[178px]`}>
      <div className="flex h-full flex-col gap-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="order-2 min-w-0 flex-1 sm:order-1">
            <h3
              className="line-clamp-2 min-h-[2.4rem] break-words text-sm font-semibold leading-5 text-zinc-900 md:text-base"
              title={task.title}
            >
              {task.title}
            </h3>

            <div
              className="mt-0.5 min-h-[1.125rem] truncate text-sm leading-5 text-zinc-600"
              title={clientName}
            >
              {clientName}
            </div>

            <div
              className={`mt-0.5 min-h-[1rem] text-xs leading-4 text-zinc-500 ${task.note ? 'line-clamp-1' : 'invisible'}`}
              title={task.note ?? undefined}
            >
              {task.note ? truncatePreviewText(task.note) : '—'}
            </div>
          </div>

          <div className="order-1 flex w-full min-w-0 flex-nowrap justify-end gap-1.5 overflow-hidden text-sm sm:order-2 sm:w-auto sm:shrink-0 sm:flex-wrap sm:gap-2 sm:overflow-visible">
            <div className={`${dueBadgeClassName} max-w-[92px] sm:max-w-none`}>
              <span className="truncate">{formatDueDate(task.due_date)}</span>
            </div>
            {task.priority ? (
              <span
                className={`inline-flex min-w-0 max-w-[72px] shrink items-center rounded-full px-2 py-1 text-[10px] font-medium sm:max-w-none sm:px-2.5 sm:text-xs ${getPriorityBadgeClass(task.priority)}`}
              >
                <span className="truncate">
                  <span className="hidden sm:inline">Priorita: </span>
                  {getPriorityLabel(task.priority)}
                </span>
              </span>
            ) : null}
            <span
              className={`inline-flex min-w-0 max-w-[82px] shrink items-center rounded-full px-2 py-1 text-[10px] font-medium sm:max-w-none sm:px-2.5 sm:text-xs ${getStatusBadgeClass(task.status)}`}
              style={task.status === 'todo' ? { backgroundColor: '#2980B9' } : undefined}
            >
              <span className="truncate">{getStatusLabel(task.status)}</span>
            </span>
            {isOverdue ? (
              <span className="inline-flex min-w-0 max-w-[76px] shrink items-center rounded-full bg-red-100 px-2 py-1 text-[10px] font-medium text-red-700 sm:max-w-none sm:px-2.5 sm:text-xs">
                <span className="truncate">Po termínu</span>
              </span>
            ) : null}
            {isToday ? (
              <span className="inline-flex min-w-0 shrink items-center rounded-full bg-orange-100 px-2 py-1 text-[10px] font-medium text-orange-700 sm:px-2.5 sm:text-xs">
                <span className="truncate">Dnes</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-auto min-w-0 flex flex-wrap justify-end gap-2 pt-1">
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
              client_contact_id: task.client_contact_id,
              company_name: task.company_name,
              contact_person: task.contact_person,
            }}
            users={users}
            clients={clients}
            contacts={contacts}
            className={`${actionButtonClassName} shrink-0 border border-gray-200 bg-white text-gray-700 hover:bg-gray-100`}
            label="UPRAVIT"
          />

          <Link
            href={`/tasks/${task.id}`}
            className={`${actionButtonClassName} shrink-0 bg-zinc-900 text-white hover:bg-zinc-800`}
          >
            DETAIL
          </Link>

          {task.status !== 'done' ? (
            <form action={markTaskDoneAction} className="shrink-0">
              <TaskCompleteButton
                className={`${actionButtonClassName} border border-emerald-600 bg-emerald-600 text-white hover:border-emerald-700 hover:bg-emerald-700 [animation:task-complete-glow_2.2s_ease-in-out_infinite]`}
              />
            </form>
          ) : null}
        </div>
      </div>
    </div>
  )
}
