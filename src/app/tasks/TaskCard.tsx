import Link from 'next/link'
import { TaskRow } from '@/lib/tasks/getTasksForCurrentUser'
import EditTaskButton from './edit-task-button'
import { endTaskRecurrence, updateTaskStatus } from './actions'
import { TaskCompleteButton } from './task-complete-button'
import { RepeatTaskBadge } from './repeat-task-badge'
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
  const endTaskRecurrenceAction = endTaskRecurrence.bind(null, task.id)
  const clientName = resolveClientName(
    task.client,
    task.company_name ?? 'Bez klienta'
  )

  const { isToday, isOverdue } = getDueDateState(task.due_date, task.status)

  const cardClassName =
    'min-w-0 overflow-hidden rounded-2xl border border-zinc-200/90 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(248,250,253,0.94)_45%,rgba(241,245,250,0.9)_100%)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.97),inset_0_-1px_0_rgba(255,255,255,0.64),inset_18px_18px_36px_rgba(59,130,246,0.05),inset_-18px_-18px_36px_rgba(255,255,255,0.58),0_12px_24px_rgba(15,23,42,0.1)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.99),inset_0_-1px_0_rgba(255,255,255,0.68),inset_20px_20px_40px_rgba(59,130,246,0.07),inset_-20px_-20px_40px_rgba(255,255,255,0.62),0_14px_28px_rgba(15,23,42,0.14)]'

  const dueBadgeClassName = [
    'inline-flex min-w-0 shrink items-center rounded-full px-2 py-1 text-[10px] font-medium sm:px-2.5 sm:text-xs',
    isOverdue
      ? 'border border-[#e69ab2]/85 bg-[linear-gradient(155deg,#d65b82_0%,#c8426c_55%,#b4335d_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(190,24,93,0.24)]'
      : isToday
        ? 'border border-[#f3c58a]/85 bg-[linear-gradient(155deg,#f2a344_0%,#e68a20_55%,#cd7212_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(180,83,9,0.24)]'
        : 'border border-[#9ebfdb]/85 bg-[linear-gradient(155deg,#6ea4cf_0%,#4f8fbe_55%,#3a79a8_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(42,95,136,0.22)]',
  ].join(' ')

  const actionButtonClassName =
    'inline-flex h-9 items-center justify-center rounded-xl px-3 text-xs font-medium transition duration-200 ease-out'

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
            >
              <span className="truncate">{getStatusLabel(task.status)}</span>
            </span>
            {isOverdue ? (
              <span className="inline-flex min-w-0 max-w-[76px] shrink items-center rounded-full border border-[#e69ab2]/85 bg-[linear-gradient(155deg,#d65b82_0%,#c8426c_55%,#b4335d_100%)] px-2 py-1 text-[10px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(190,24,93,0.24)] sm:max-w-none sm:px-2.5 sm:text-xs">
                <span className="truncate">Po termínu</span>
              </span>
            ) : null}
            {isToday ? (
              <span className="inline-flex min-w-0 shrink items-center rounded-full border border-[#f3c58a]/85 bg-[linear-gradient(155deg,#f2a344_0%,#e68a20_55%,#cd7212_100%)] px-2 py-1 text-[10px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(180,83,9,0.24)] sm:px-2.5 sm:text-xs">
                <span className="truncate">Dnes</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-auto flex min-w-0 flex-wrap items-end justify-between gap-2 pt-1">
          <RepeatTaskBadge repeatInterval={task.repeat_interval} />

          <div className="ml-auto flex min-w-0 flex-wrap justify-end gap-2">
            <EditTaskButton
              task={{
                id: task.id,
                title: task.title,
                note: task.note,
                due_date: task.due_date,
                status: task.status,
                priority: task.priority,
                repeat_interval: task.repeat_interval,
                assigned_to: task.assigned_to,
                client_id: task.client_id,
                client_contact_id: task.client_contact_id,
                company_name: task.company_name,
                contact_person: task.contact_person,
              }}
              users={users}
              clients={clients}
              contacts={contacts}
              className={`${actionButtonClassName} shrink-0 border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]`}
              label="UPRAVIT"
            />

            <Link
              href={`/tasks/${task.id}`}
              className={`${actionButtonClassName} shrink-0 border border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] hover:-translate-y-[1px] hover:bg-zinc-800`}
            >
              DETAIL
            </Link>

            {task.status !== 'done' ? (
              <>
                {task.repeat_interval ? (
                  <form action={endTaskRecurrenceAction} className="shrink-0">
                    <button
                      type="submit"
                      className={`${actionButtonClassName} border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]`}
                    >
                      UKONČIT OPAKOVÁNÍ
                    </button>
                  </form>
                ) : null}

                <form action={markTaskDoneAction} className="shrink-0">
                  <TaskCompleteButton
                    className={`${actionButtonClassName} border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(16,185,129,0.22)] hover:-translate-y-[1px]`}
                  />
                </form>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
