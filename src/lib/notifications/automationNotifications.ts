import { createNotification } from '@/lib/notifications/createNotification'
import { buildAssetDetailHref } from '@/lib/majetek/detail'
import { getServiceRoleClient } from '@/lib/supabase/service'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const SEND_WINDOW_START_HOUR = 8
const SEND_WINDOW_END_HOUR = 20
const RECEIVED_INVOICE_REMINDER_HOUR = 13
const JOB_MISSING_PP_REPEAT_INTERVAL_MS = 24 * 60 * 60 * 1000
const JOB_MISSING_PP_TECHNICIAN_REPEAT_TYPE = 'job_missing_pp_technician_repeat'
const JOB_MISSING_PP_MIN_END_AT_ISO = convertPragueLocalPartsToUtcIsoString(
  2026,
  5,
  30,
  0,
  0,
  0
)

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
    jobsMissingPpTechnicians: number
    unreadOlderThan6h: number
    receivedInvoicesDue: number
    assetInsuranceExpiring6w: number
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
  site_address: string | null
  technician_name: string | null
}

type JobAttachmentRow = {
  job_id: string
}

type NotificationHistoryRow = {
  entity_id: string | null
  recipient_user_id: string
  type: string
  created_at: string
}

type JobTechnicianAssignmentRow = {
  job_id: string
  technician_id: string
}

type TechnicianProfileRow = {
  id: string
  role: string | null
}

type RecipientRow = {
  recipient_user_id: string
}

type AdminRow = {
  id: string
}

type ReceivedInvoiceDueRow = {
  id: string
  file_name: string
  due_date: string | null
  status: 'unpaid' | 'paid'
}

type AssetInsuranceExpiryRow = {
  id: string
  asset_id: string
  end_date: string | null
  provider_name: string | null
  policy_number: string | null
}

type AssetNameRow = {
  id: string
  name: string
}

type AssetRecipientRow = {
  id: string
}

function addDaysToDateKey(dateKey: string, days: number) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  const [, year, month, day] = match

  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day) + days, 12, 0, 0)
  )
    .toISOString()
    .slice(0, 10)
}

function formatDateKeyForCzech(dateKey: string) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return dateKey
  }

  const [, year, month, day] = match

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0)))
}

async function getAssetNotificationRecipients(supabase: ServiceClient) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .eq('majetek', true)

  if (error) {
    throw new Error(`Automatické notifikace (majetek) selhaly: ${error.message}`)
  }

  return ((data ?? []) as AssetRecipientRow[]).map((row) => row.id).filter(Boolean)
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

async function getJobsMissingPp(supabase: ServiceClient, now: Date) {
  const cutoffIso = getIsoHoursAgo(24, now)

  const [{ data: jobs, error: jobsError }, { data: attachments, error: attachmentsError }] =
    await Promise.all([
      supabase
        .from('jobs')
        .select('id, job_number, end_at, site_address, technician_name')
        .gte('end_at', JOB_MISSING_PP_MIN_END_AT_ISO)
        .lt('end_at', cutoffIso),
      supabase
        .from('job_attachments')
        .select('job_id'),
    ])

  if (jobsError) {
    throw new Error(`Automatické notifikace (zakázky) selhaly: ${jobsError.message}`)
  }

  if (attachmentsError) {
    throw new Error(`Automatické notifikace (přílohy zakázek) selhaly: ${attachmentsError.message}`)
  }

  const attachmentJobIds = new Set(
    ((attachments ?? []) as JobAttachmentRow[]).map((row) => row.job_id)
  )

  return ((jobs ?? []) as JobRow[]).filter(
    (job) => !attachmentJobIds.has(job.id)
  )
}

async function getLatestTechnicianMissingPpNotifications(
  supabase: ServiceClient,
  jobIds: string[],
  technicianIds: string[]
) {
  if (jobIds.length === 0 || technicianIds.length === 0) {
    return new Map<string, NotificationHistoryRow>()
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('entity_id, recipient_user_id, type, created_at')
    .eq('category', 'jobs')
    .in('entity_id', jobIds)
    .in('recipient_user_id', technicianIds)
    .in('type', ['job_missing_pp_technician', JOB_MISSING_PP_TECHNICIAN_REPEAT_TYPE])
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Automatické notifikace (historie PP) selhaly: ${error.message}`)
  }

  const latestByPair = new Map<string, NotificationHistoryRow>()

  for (const row of (data ?? []) as NotificationHistoryRow[]) {
    const entityId = String(row.entity_id ?? '').trim()
    const recipientUserId = String(row.recipient_user_id ?? '').trim()

    if (!entityId || !recipientUserId) continue

    const pairKey = `${entityId}:${recipientUserId}`
    if (!latestByPair.has(pairKey)) {
      latestByPair.set(pairKey, row)
    }
  }

  return latestByPair
}

function getJobAddressLabel(siteAddress: string | null | undefined) {
  return String(siteAddress ?? '')
    .split(',')
    .at(0)
    ?.trim() || 'bez adresy'
}

async function sendJobMissingPpNotifications(supabase: ServiceClient, now: Date) {
  const jobsWithoutAnyAttachment = await getJobsMissingPp(supabase, now)

  const { data: admins, error: adminsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .limit(1)

  if (adminsError) {
    throw new Error(`Automatické notifikace (admin) selhaly: ${adminsError.message}`)
  }

  const adminId = (admins?.[0] as AdminRow | undefined)?.id

  if (!adminId || jobsWithoutAnyAttachment.length === 0) {
    return 0
  }

  await Promise.all(
    jobsWithoutAnyAttachment.map((job) => {
      const technicianLabel = job.technician_name?.trim() || 'bez technika'
      return createNotification({
        supabase,
        recipientUserId: adminId,
        actorUserId: null,
        category: 'jobs',
        type: 'job_missing_pp',
        title: 'ZAKÁZKA BEZ PP',
        message: `Zakázka ${job.job_number} (${technicianLabel}) je po termínu a nemá nahraný PP.`,
        entityType: 'job',
        entityId: job.id,
        href: '/faktury',
        priority: 'high',
        dedupeKey: `job_missing_pp:${job.id}`,
        skipSelfNotification: false,
      })
    })
  )

  return jobsWithoutAnyAttachment.length
}

async function sendTechnicianMissingPpNotifications(
  supabase: ServiceClient,
  now: Date
) {
  const jobsWithoutAnyAttachment = await getJobsMissingPp(supabase, now)

  if (jobsWithoutAnyAttachment.length === 0) {
    return 0
  }

  const jobIds = jobsWithoutAnyAttachment.map((job) => job.id)

  const { data: assignments, error: assignmentsError } = await supabase
    .from('job_technicians')
    .select('job_id, technician_id')
    .in('job_id', jobIds)

  if (assignmentsError) {
    throw new Error(`Automatické notifikace (přiřazení techniků) selhaly: ${assignmentsError.message}`)
  }

  const technicianIds = Array.from(
    new Set(
      ((assignments ?? []) as JobTechnicianAssignmentRow[])
        .map((row) => String(row.technician_id ?? '').trim())
        .filter((technicianId) => Boolean(technicianId))
    )
  )

  if (technicianIds.length === 0) {
    return 0
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, role')
    .in('id', technicianIds)

  if (profilesError) {
    throw new Error(`Automatické notifikace (technici) selhaly: ${profilesError.message}`)
  }

  const technicianProfiles = new Map(
    ((profiles ?? []) as TechnicianProfileRow[])
      .filter((profile) => profile.role === 'TECHNIK')
      .map((profile) => [profile.id, profile] as const)
  )

  if (technicianProfiles.size === 0) {
    return 0
  }

  const assignmentsByJobId = new Map<string, Set<string>>()
  for (const assignment of (assignments ?? []) as JobTechnicianAssignmentRow[]) {
    const jobId = String(assignment.job_id ?? '').trim()
    const technicianId = String(assignment.technician_id ?? '').trim()

    if (!jobId || !technicianId) continue
    if (!technicianProfiles.has(technicianId)) continue

    const next = assignmentsByJobId.get(jobId) ?? new Set<string>()
    next.add(technicianId)
    assignmentsByJobId.set(jobId, next)
  }

  const relevantTechnicianIds = Array.from(
    new Set(
      Array.from(assignmentsByJobId.values()).flatMap((technicianSet) =>
        Array.from(technicianSet)
      )
    )
  )

  const latestNotificationsByPair = await getLatestTechnicianMissingPpNotifications(
    supabase,
    jobsWithoutAnyAttachment.map((job) => job.id),
    relevantTechnicianIds
  )

  let sent = 0

  for (const job of jobsWithoutAnyAttachment) {
    const technicianIds = Array.from(assignmentsByJobId.get(job.id) ?? [])
    if (technicianIds.length === 0) continue

    const addressLabel = getJobAddressLabel(job.site_address)

    for (const technicianId of technicianIds) {
      const pairKey = `${job.id}:${technicianId}`
      const latestNotification = latestNotificationsByPair.get(pairKey)

      if (!latestNotification) {
        await createNotification({
          supabase,
          recipientUserId: technicianId,
          actorUserId: null,
          category: 'jobs',
          type: 'job_missing_pp_technician',
          title: 'ZAKÁZKA BEZ PP',
          message: `Zakázka ${job.job_number} ${addressLabel} je po termínu a nemá nahraný PP.`,
          entityType: 'job',
          entityId: job.id,
          href: '/dashboard',
          priority: 'high',
          dedupeKey: `job_missing_pp_technician:${job.id}:${technicianId}`,
          skipSelfNotification: false,
        })

        sent += 1
        continue
      }

      const latestNotificationAt = new Date(latestNotification.created_at)
      if (Number.isNaN(latestNotificationAt.getTime())) {
        continue
      }

      if (
        now.getTime() - latestNotificationAt.getTime() <
        JOB_MISSING_PP_REPEAT_INTERVAL_MS
      ) {
        continue
      }

      await createNotification({
        supabase,
        recipientUserId: technicianId,
        actorUserId: null,
        category: 'jobs',
        type: JOB_MISSING_PP_TECHNICIAN_REPEAT_TYPE,
        title: 'ZAKÁZKA STÁLE BEZ PP!',
        message: `Zakázka ${job.job_number} ${addressLabel} je po termínu a chybí nahraný PP.`,
        entityType: 'job',
        entityId: job.id,
        href: '/dashboard',
        priority: 'high',
        dedupeKey: `job_missing_pp_technician_repeat:${job.id}:${technicianId}:${latestNotification.created_at}`,
        skipSelfNotification: false,
      })

      sent += 1
    }
  }

  return sent
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

async function sendReceivedInvoiceDueNotifications(
  supabase: ServiceClient,
  now: Date
) {
  const pragueParts = getPragueDateParts(now)
  const pragueDateKey = getPragueDateKey(now)

  if (pragueParts.hour !== RECEIVED_INVOICE_REMINDER_HOUR) {
    return 0
  }

  const [{ data: dueRows, error: dueError }, { data: admins, error: adminsError }] =
    await Promise.all([
      supabase
        .from('received_invoices')
        .select('id, file_name, due_date, status')
        .eq('status', 'unpaid')
        .not('due_date', 'is', null)
        .lte('due_date', pragueDateKey),
      supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin'),
    ])

  if (dueError) {
    throw new Error(`Automatické notifikace (přijaté faktury) selhaly: ${dueError.message}`)
  }

  if (adminsError) {
    throw new Error(`Automatické notifikace (admin) selhaly: ${adminsError.message}`)
  }

  const invoices = (dueRows ?? []) as ReceivedInvoiceDueRow[]
  const adminIds = ((admins ?? []) as AdminRow[]).map((admin) => admin.id).filter(Boolean)

  if (invoices.length === 0 || adminIds.length === 0) {
    return 0
  }

  let sent = 0

  for (const invoice of invoices) {
    const dueDate = String(invoice.due_date ?? '')
    const isOverdue = dueDate < pragueDateKey
    const title = isOverdue
      ? 'PŘIJATÁ FAKTURA PO SPLATNOSTI'
      : 'DNES SPLATNÁ PŘIJATÁ FAKTURA'
    const message = isOverdue
      ? `Faktura "${invoice.file_name}" je po splatnosti (${dueDate}) a je stále nezaplacená.`
      : `Faktura "${invoice.file_name}" má dnes splatnost (${dueDate}) a je stále nezaplacená.`

    for (const adminId of adminIds) {
      await createNotification({
        supabase,
        recipientUserId: adminId,
        actorUserId: null,
        category: 'system',
        type: 'received_invoice_due_daily',
        title,
        message,
        entityType: 'received_invoice',
        entityId: invoice.id,
        href: '/dashboard',
        priority: 'high',
        dedupeKey: `received_invoice_due_daily:${invoice.id}:${adminId}:${pragueDateKey}`,
        skipSelfNotification: false,
      })

      sent += 1
    }
  }

  return sent
}

async function sendAssetInsuranceExpiryNotifications(
  supabase: ServiceClient,
  now: Date
) {
  const pragueDateKey = getPragueDateKey(now)
  const targetDateKey = addDaysToDateKey(pragueDateKey, 42)

  if (!targetDateKey) {
    throw new Error('Automatické notifikace (majetek) selhaly: neplatné datum.')
  }

  const [{ data: insuranceRows, error: insuranceError }, recipients] = await Promise.all([
    supabase
      .from('asset_insurance_details')
      .select('id, asset_id, end_date, provider_name, policy_number')
      .eq('end_date', targetDateKey),
    getAssetNotificationRecipients(supabase),
  ])

  if (insuranceError) {
    throw new Error(`Automatické notifikace (majetek) selhaly: ${insuranceError.message}`)
  }

  const insurances = (insuranceRows ?? []) as AssetInsuranceExpiryRow[]

  if (insurances.length === 0 || recipients.length === 0) {
    return 0
  }

  const assetIds = Array.from(new Set(insurances.map((row) => row.asset_id).filter(Boolean)))

  const { data: assetRows, error: assetsError } = await supabase
    .from('assets')
    .select('id, name')
    .in('id', assetIds)

  if (assetsError) {
    throw new Error(`Automatické notifikace (majetek) selhaly: ${assetsError.message}`)
  }

  const assetMap = new Map(
    ((assetRows ?? []) as AssetNameRow[]).map((asset) => [asset.id, asset.name] as const)
  )
  const targetDateLabel = formatDateKeyForCzech(targetDateKey)

  let sent = 0

  for (const insurance of insurances) {
    const assetName = assetMap.get(insurance.asset_id) ?? 'nepojmenovaný majetek'
    const policyLabel = insurance.policy_number ? `, smlouva ${insurance.policy_number}` : ''
    const providerLabel = insurance.provider_name ? ` u ${insurance.provider_name}` : ''
    const message = `Pojištění u majetku „${assetName}“${policyLabel}${providerLabel} končí ${targetDateLabel}. Zkontroluj ho a případně zažádej o aktualizaci pojistky.`

    for (const recipientUserId of recipients) {
      await createNotification({
        supabase,
        recipientUserId,
        actorUserId: null,
        category: 'assets',
        type: 'asset_insurance_expiry_6w',
        title: 'POJIŠTĚNÍ MAJETKU KONČÍ ZA 6 TÝDNŮ',
        message,
        entityType: 'asset_insurance',
        entityId: insurance.id,
        href: buildAssetDetailHref(insurance.asset_id, 'insurance'),
        priority: 'normal',
        dedupeKey: `asset_insurance_expiry_6w:${insurance.id}:${recipientUserId}:${pragueDateKey}`,
        skipSelfNotification: false,
      })

      sent += 1
    }
  }

  return sent
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
        jobsMissingPpTechnicians: 0,
        unreadOlderThan6h: 0,
        receivedInvoicesDue: 0,
        assetInsuranceExpiring6w: 0,
      },
    }
  }

  const supabase = getServiceRoleClient()

  if (!supabase) {
    throw new Error('Chybí SUPABASE_SERVICE_ROLE_KEY nebo NEXT_PUBLIC_SUPABASE_URL pro automatické notifikace.')
  }

  const [meetingsOverdue24h, tasksOverdue, jobsMissingPp, jobsMissingPpTechnicians, unreadOlderThan6h, receivedInvoicesDue, assetInsuranceExpiring6w] =
    await Promise.all([
      sendMeetingOverdue24hNotifications(supabase, now),
      sendTaskOverdueNotifications(supabase, now),
      sendJobMissingPpNotifications(supabase, now),
      sendTechnicianMissingPpNotifications(supabase, now),
      sendUnreadNotificationReminder(supabase, now),
      sendReceivedInvoiceDueNotifications(supabase, now),
      sendAssetInsuranceExpiryNotifications(supabase, now),
    ])

  return {
    sent:
      meetingsOverdue24h +
      tasksOverdue +
      jobsMissingPp +
      jobsMissingPpTechnicians +
      unreadOlderThan6h +
      receivedInvoicesDue +
      assetInsuranceExpiring6w,
    skippedOutsideWindow: false,
    details: {
      meetingsOverdue24h,
      tasksOverdue,
      jobsMissingPp,
      jobsMissingPpTechnicians,
      unreadOlderThan6h,
      receivedInvoicesDue,
      assetInsuranceExpiring6w,
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
