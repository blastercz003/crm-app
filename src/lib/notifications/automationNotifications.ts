import { createNotification } from '@/lib/notifications/createNotification'
import { getServiceRoleClient } from '@/lib/supabase/service'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const SEND_WINDOW_START_HOUR = 8
const SEND_WINDOW_END_HOUR = 20

function getPragueDateParts(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(now)

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value ?? '0'),
    month: Number(parts.find((part) => part.type === 'month')?.value ?? '0'),
    day: Number(parts.find((part) => part.type === 'day')?.value ?? '0'),
    hour: Number(parts.find((part) => part.type === 'hour')?.value ?? '0'),
  }
}

function getPragueDateKey(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(now)
}

function getPragueOffsetMinutes(dateUtc: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PRAGUE_TIME_ZONE,
    timeZoneName: 'shortOffset',
  })

  const parts = formatter.formatToParts(dateUtc)
  const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value

  if (!timeZoneName || timeZoneName === 'GMT' || timeZoneName === 'UTC') {
    return 0
  }

  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)

  if (!match) {
    return 0
  }

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '0')

  return sign * (hours * 60 + minutes)
}

function convertPragueLocalPartsToUtcIsoString(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  const offsetMinutes = getPragueOffsetMinutes(utcGuess)

  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000
  ).toISOString()
}

function getPragueDayStartIso(now: Date) {
  const parts = getPragueDateParts(now)
  return convertPragueLocalPartsToUtcIsoString(parts.year, parts.month, parts.day, 0, 0, 0)
}

function getIsoHoursAgo(hours: number, now: Date) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()
}

function isWithinSendWindow(now: Date) {
  const { hour } = getPragueDateParts(now)
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR
}

type AutomationRunResult = {
  sent: number
  skippedOutsideWindow: boolean
  details: {
    meetingsOverdue24h: number
    tasksOverdue: number
    jobsMissingPp: number
    unreadOlderThan6h: number
  }
}

type MeetingRow = {
  id: string
  company_name: string | null
  title: string | null
  meeting_datetime: string | null
  created_by: string | null
}

type TaskRow = {
  id: string
  title: string
  status: string | null
  due_date: string | null
  created_by: string | null
  assigned_to: string | null
}

type JobRow = {
  id: string
  job_number: string
  end_at: string
}

type JobAttachmentRow = {
  job_id: string
}

type RecipientRow = {
  recipient_user_id: string
}

type AdminRow = {
  id: string
}

async function sendMeetingOverdue24hNotifications(
  supabase: ServiceClient,
  now: Date
) {
  const cutoffIso = getIsoHoursAgo(24, now)

  const { data, error } = await supabase
    .from('meetings')
    .select('id, company_name, title, meeting_datetime, created_by')
    .eq('status', 'planned')
    .lt('meeting_datetime', cutoffIso)
    .is('result_note', null)
    .not('created_by', 'is', null)

  if (error) {
    throw new Error(`Automatické notifikace (schůzky) selhaly: ${error.message}`)
  }

  const meetings = (data ?? []) as MeetingRow[]

  await Promise.all(
    meetings.map((meeting) =>
      createNotification({
        supabase,
        recipientUserId: meeting.created_by,
        actorUserId: null,
        category: 'meetings',
        type: 'meeting_overdue_24h',
        title: 'SCHŮZKA PO TERMÍNU',
        message: `Schůzka „${meeting.company_name ?? meeting.title ?? 'bez názvu'}“ je po termínu déle než 24 hodin a je stále plánovaná.`,
        entityType: 'meeting',
        entityId: meeting.id,
        href: `/meetings/${meeting.id}`,
        priority: 'high',
        dedupeKey: `meeting_overdue_24h:${meeting.id}`,
        skipSelfNotification: false,
      })
    )
  )

  return meetings.length
}

async function sendTaskOverdueNotifications(supabase: ServiceClient, now: Date) {
  const pragueDateKey = getPragueDateKey(now)

  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, due_date, created_by, assigned_to')
    .neq('status', 'done')
    .lt('due_date', pragueDateKey)

  if (error) {
    throw new Error(`Automatické notifikace (úkoly) selhaly: ${error.message}`)
  }

  const tasks = (data ?? []) as TaskRow[]

  let sent = 0

  for (const task of tasks) {
    const recipients = Array.from(
      new Set([task.created_by, task.assigned_to].filter(Boolean) as string[])
    )

    for (const recipientUserId of recipients) {
      await createNotification({
        supabase,
        recipientUserId,
        actorUserId: null,
        category: 'tasks',
        type: 'task_overdue_daily',
        title: 'ÚKOL PO TERMÍNU!',
        message: `Úkol „${task.title}“ je po termínu a není splněný.`,
        entityType: 'task',
        entityId: task.id,
        href: `/tasks/${task.id}`,
        priority: 'high',
        dedupeKey: `task_overdue_daily:${task.id}:${recipientUserId}:${pragueDateKey}`,
        skipSelfNotification: false,
      })

      sent += 1
    }
  }

  return sent
}

async function sendJobMissingPpNotifications(supabase: ServiceClient, now: Date) {
  const cutoffIso = getIsoHoursAgo(24, now)

  const [{ data: jobs, error: jobsError }, { data: attachments, error: attachmentsError }, { data: admins, error: adminsError }] =
    await Promise.all([
      supabase
        .from('jobs')
        .select('id, job_number, end_at')
        .lt('end_at', cutoffIso),
      supabase
        .from('job_attachments')
        .select('job_id'),
      supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .limit(1),
    ])

  if (jobsError) {
    throw new Error(`Automatické notifikace (zakázky) selhaly: ${jobsError.message}`)
  }

  if (attachmentsError) {
    throw new Error(`Automatické notifikace (přílohy zakázek) selhaly: ${attachmentsError.message}`)
  }

  if (adminsError) {
    throw new Error(`Automatické notifikace (admin) selhaly: ${adminsError.message}`)
  }

  const adminId = (admins?.[0] as AdminRow | undefined)?.id

  if (!adminId) {
    return 0
  }

  const attachmentJobIds = new Set(
    ((attachments ?? []) as JobAttachmentRow[]).map((row) => row.job_id)
  )

  const jobsWithoutAnyAttachment = ((jobs ?? []) as JobRow[]).filter(
    (job) => !attachmentJobIds.has(job.id)
  )

  await Promise.all(
    jobsWithoutAnyAttachment.map((job) =>
      createNotification({
        supabase,
        recipientUserId: adminId,
        actorUserId: null,
        category: 'jobs',
        type: 'job_missing_pp',
        title: 'ZAKÁZKA BEZ PP',
        message: `Zakázka ${job.job_number} je po termínu a nemá nahraný PP.`,
        entityType: 'job',
        entityId: job.id,
        href: '/faktury',
        priority: 'high',
        dedupeKey: `job_missing_pp:${job.id}`,
        skipSelfNotification: false,
      })
    )
  )

  return jobsWithoutAnyAttachment.length
}

async function sendUnreadNotificationReminder(supabase: ServiceClient, now: Date) {
  const cutoffIso = getIsoHoursAgo(6, now)
  const pragueDateKey = getPragueDateKey(now)

  const { data, error } = await supabase
    .from('notifications')
    .select('recipient_user_id')
    .is('read_at', null)
    .is('archived_at', null)
    .lt('created_at', cutoffIso)

  if (error) {
    throw new Error(`Automatické notifikace (připomínka notifikací) selhaly: ${error.message}`)
  }

  const recipientIds = Array.from(
    new Set(((data ?? []) as RecipientRow[]).map((row) => row.recipient_user_id))
  )

  await Promise.all(
    recipientIds.map((recipientUserId) =>
      createNotification({
        supabase,
        recipientUserId,
        actorUserId: null,
        category: 'system',
        type: 'unread_notification_6h',
        title: 'NEVYŘÍZENÁ NOTIFIKACE',
        message: 'Jedna nebo více notifikací čeká na otevření déle než 6 hodin.',
        entityType: 'notification',
        entityId: null,
        href: '/notifications?status=unread',
        priority: 'normal',
        dedupeKey: `unread_notification_6h:${recipientUserId}:${pragueDateKey}`,
        skipSelfNotification: false,
      })
    )
  )

  return recipientIds.length
}

export async function runNotificationAutomations(now = new Date()): Promise<AutomationRunResult> {
  if (!isWithinSendWindow(now)) {
    return {
      sent: 0,
      skippedOutsideWindow: true,
      details: {
        meetingsOverdue24h: 0,
        tasksOverdue: 0,
        jobsMissingPp: 0,
        unreadOlderThan6h: 0,
      },
    }
  }

  const supabase = getServiceRoleClient()

  if (!supabase) {
    throw new Error('Chybí SUPABASE_SERVICE_ROLE_KEY nebo NEXT_PUBLIC_SUPABASE_URL pro automatické notifikace.')
  }

  const [meetingsOverdue24h, tasksOverdue, jobsMissingPp, unreadOlderThan6h] =
    await Promise.all([
      sendMeetingOverdue24hNotifications(supabase, now),
      sendTaskOverdueNotifications(supabase, now),
      sendJobMissingPpNotifications(supabase, now),
      sendUnreadNotificationReminder(supabase, now),
    ])

  return {
    sent: meetingsOverdue24h + tasksOverdue + jobsMissingPp + unreadOlderThan6h,
    skippedOutsideWindow: false,
    details: {
      meetingsOverdue24h,
      tasksOverdue,
      jobsMissingPp,
      unreadOlderThan6h,
    },
  }
}

export function getNotificationAutomationMetadata(now = new Date()) {
  return {
    sendWindow: `${SEND_WINDOW_START_HOUR}:00-${SEND_WINDOW_END_HOUR}:00 (${PRAGUE_TIME_ZONE})`,
    inWindowNow: isWithinSendWindow(now),
    pragueDayStartIso: getPragueDayStartIso(now),
  }
}
