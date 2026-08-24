'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { reportActionError } from '@/lib/errors/reportActionError'
import { createNotificationsForAdmins } from '@/lib/notifications/createNotification'
import {
  cancelMeetingCalendarItem,
  backfillMeetingCalendarItemsForUser,
  ensureMeetingCalendarFeed,
  cancelMeetingGoogleCalendarItem,
  disconnectMeetingGoogleCalendar,
  syncMeetingCalendarItem,
  syncMeetingGoogleCalendarItem,
} from '@/lib/meetings/calendar-feed'
import { logUserActivity } from '@/lib/activity-log/logUserActivity'

export type MeetingFormActionState = {
  success: boolean
  error: string | null
  companyName?: string
  meetingDateTime?: string
}

export type CreateMeetingActionState = MeetingFormActionState
export type UpdateMeetingActionState = MeetingFormActionState
export type MeetingCalendarActivationActionState = {
  success: boolean
  error: string | null
  token?: string
  feedPath?: string
  insertedCount?: number
}

export type MeetingGoogleCalendarDisconnectActionState = {
  success: boolean
  error: string | null
  disconnectedAt?: string
  deletedCalendar?: boolean
}

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function normalizeStatus(value: FormDataEntryValue | null) {
  return value === 'completed' ? 'completed' : 'planned'
}

function normalizeTaskPriority(value: FormDataEntryValue | null) {
  const allowed = ['low', 'medium', 'high']
  const str = String(value ?? 'medium')
  return allowed.includes(str) ? str : 'medium'
}

function normalizeDate(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function normalizeContactId(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length ? str : null
}

function getPragueOffsetMinutes(dateUtc: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    timeZoneName: 'shortOffset',
  })

  const parts = formatter.formatToParts(dateUtc)
  const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value

  if (!timeZoneName) {
    throw new Error('Nepodařilo se určit časové pásmo Europe/Prague.')
  }

  if (timeZoneName === 'GMT' || timeZoneName === 'UTC') {
    return 0
  }

  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)

  if (!match) {
    throw new Error('Nepodařilo se zpracovat offset časového pásma Europe/Prague.')
  }

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '0')

  return sign * (hours * 60 + minutes)
}

function convertPragueLocalDateTimeToUtcIsoString(localDateTime: string) {
  const match = localDateTime.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
  )

  if (!match) {
    throw new Error('Datum a čas schůzky má neplatný formát.')
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match

  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minuteStr)

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))

  if (Number.isNaN(utcGuess.getTime())) {
    throw new Error('Datum a čas schůzky má neplatný formát.')
  }

  const offsetMinutes = getPragueOffsetMinutes(utcGuess)

  const correctedUtcDate = new Date(
    Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000
  )

  if (Number.isNaN(correctedUtcDate.getTime())) {
    throw new Error('Datum a čas schůzky má neplatný formát.')
  }

  return correctedUtcDate.toISOString()
}

function normalizeDateTime(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()

  if (text.length === 0) return null

  return convertPragueLocalDateTimeToUtcIsoString(text)
}

function normalizeClientId(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

async function getCurrentUserWithRole() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    throw new Error('Nepodařilo se načíst profil přihlášeného uživatele.')
  }

  return {
    supabase,
    user,
    profile,
    role: profile.role as 'admin' | 'member',
  }
}

export async function activateMeetingCalendarModalAction(
  _prevState: MeetingCalendarActivationActionState,
  _formData: FormData
): Promise<MeetingCalendarActivationActionState> {
  void _prevState
  void _formData

  try {
    const { user } = await getCurrentUserWithRole()

    const backfillResult = await backfillMeetingCalendarItemsForUser(user.id)
    const feed = await ensureMeetingCalendarFeed(user.id)

    return {
      success: true,
      error: null,
      token: feed.token,
      feedPath: `/api/calendars/${feed.token}`,
      insertedCount: backfillResult.insertedCount,
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'activateMeetingCalendarModalAction',
      section: 'meetings',
      errorType: 'MeetingCalendarActivationError',
    })

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se aktivovat kalendář.',
    }
  }
}

export async function disconnectMeetingGoogleCalendarModalAction(
  _prevState: MeetingGoogleCalendarDisconnectActionState,
  _formData: FormData
): Promise<MeetingGoogleCalendarDisconnectActionState> {
  void _prevState
  void _formData

  try {
    const { user } = await getCurrentUserWithRole()
    const result = await disconnectMeetingGoogleCalendar(user.id)

    revalidatePath('/meetings')

    return {
      success: Boolean(result.disconnected),
      error: null,
      disconnectedAt: result.disconnectedAt,
      deletedCalendar: result.deletedCalendar,
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'disconnectMeetingGoogleCalendarModalAction',
      section: 'meetings',
      errorType: 'MeetingGoogleCalendarDisconnectError',
    })

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se odpojit Google kalendář.',
    }
  }
}

async function getMeetingForPermissionCheck(meetingId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('meetings')
    .select('id, assigned_user_id, created_by, client_id')
    .eq('id', meetingId)
    .single()

  if (error || !data) {
    throw new Error('Schůzka nebyla nalezena.')
  }

  return data
}

async function getClientSnapshot(clientId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clients')
    .select('id, name, contact_person, contact_phone, contact_email, address')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    throw new Error('Vybraný klient nebyl nalezen.')
  }

  return data
}

async function getClientContactSnapshot(contactId: string, clientId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('client_contacts')
    .select('id, client_id, name, phone, email')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .single()

  if (error || !data) {
    throw new Error('Vybraná kontaktní osoba nebyla nalezena.')
  }

  return data
}

async function resolveMeetingClientFields(params: {
  clientId: string | null
  contactId: string | null
  companyName: string | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
}) {
  const {
    clientId,
    contactId,
    companyName,
    contactPerson,
    contactPhone,
    contactEmail,
    address,
  } = params

  if (!clientId) {
    return {
      companyName,
      contactPerson,
      contactPhone,
      contactEmail,
      address,
    }
  }

  const client = await getClientSnapshot(clientId)

  if (contactId) {
    const contact = await getClientContactSnapshot(contactId, clientId)

    return {
      companyName: companyName ?? client.name ?? null,
      contactPerson: contact.name ?? null,
      contactPhone: contact.phone ?? null,
      contactEmail: contact.email ?? null,
      address: address ?? client.address ?? null,
    }
  }

  return {
    companyName: companyName ?? client.name ?? null,
    contactPerson: contactPerson ?? client.contact_person ?? null,
    contactPhone: contactPhone ?? client.contact_phone ?? null,
    contactEmail: contactEmail ?? client.contact_email ?? null,
    address: address ?? client.address ?? null,
  }
}

async function syncMeetingFollowUpTask(params: {
  meetingId: string
  clientId: string | null
  contactId: string | null
  followUpTask: string | null
  followUpTaskNote: string | null
  followUpTaskPriority: string
  followUpTaskDueDate: string | null
  companyName: string | null
  contactPerson: string | null
  assignedUserId?: string | null
  createdByUserId?: string | null
}) {
  const supabase = await createClient()

  const {
    meetingId,
    clientId,
    contactId,
    followUpTask,
    followUpTaskNote,
    followUpTaskPriority,
    followUpTaskDueDate,
    companyName,
    contactPerson,
    assignedUserId,
    createdByUserId,
  } = params

  const existingTaskResponse = await supabase
    .from('tasks')
    .select('id, status')
    .eq('meeting_id', meetingId)
    .eq('source', 'meeting')
    .maybeSingle()

  if (existingTaskResponse.error) {
    throw new Error(
      `Nepodařilo se načíst task navázaný na schůzku: ${existingTaskResponse.error.message}`
    )
  }

  const existingTask = existingTaskResponse.data

  if (followUpTask) {
    if (existingTask?.id) {
      const { error } = await supabase
        .from('tasks')
        .update({
          title: followUpTask,
          note: followUpTaskNote,
          due_date: followUpTaskDueDate,
          priority: followUpTaskPriority,
          client_id: clientId,
          client_contact_id: contactId,
          company_name: companyName,
          contact_person: contactPerson,
          assigned_to: assignedUserId ?? null,
        })
        .eq('id', existingTask.id)

      if (error) {
        throw new Error(
          `Nepodařilo se aktualizovat task ze schůzky: ${error.message}`
        )
      }
    } else {
      const { error } = await supabase.from('tasks').insert({
        title: followUpTask,
        note: followUpTaskNote,
        due_date: followUpTaskDueDate,
        status: 'todo',
        priority: followUpTaskPriority,
        source: 'meeting',
        meeting_id: meetingId,
        client_id: clientId,
        client_contact_id: contactId,
        company_name: companyName,
        contact_person: contactPerson,
        assigned_to: assignedUserId ?? null,
        created_by: createdByUserId ?? null,
      })

      if (error) {
        throw new Error(`Nepodařilo se vytvořit task ze schůzky: ${error.message}`)
      }
    }
  } else if (existingTask?.id) {
    const { error } = await supabase.from('tasks').delete().eq('id', existingTask.id)

    if (error) {
      throw new Error(`Nepodařilo se odstranit task ze schůzky: ${error.message}`)
    }
  }
}

async function syncMeetingCalendarItemSafely(params: {
  meetingId: string
  userId: string
  meeting: {
    id: string
    company_name: string | null
    contact_person: string | null
    contact_phone: string | null
    contact_email: string | null
    address: string | null
    title: string | null
    meeting_datetime: string | null
    pre_meeting_note: string | null
    result_note: string | null
    follow_up_task: string | null
    follow_up_task_note: string | null
    follow_up_task_priority: string | null
    follow_up_task_due_date: string | null
    status: 'planned' | 'completed'
    assigned_user_id: string | null
  }
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  try {
    await syncMeetingCalendarItem({
      meetingId: params.meetingId,
      userId: params.userId,
      meeting: params.meeting,
    })
  } catch (error) {
    try {
      await reportActionError({
        error,
        action: params.action,
        section: 'meetings',
        errorType: params.errorType,
        userId: params.userIdForErrorLog ?? params.userId,
      })
    } catch (reportError) {
      console.error('Kalendářová synchronizace schůzky selhala.', reportError)
    }
  }
}

async function cancelMeetingCalendarItemSafely(params: {
  meetingId: string
  userId: string
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  try {
    await cancelMeetingCalendarItem({
      meetingId: params.meetingId,
      userId: params.userId,
    })
  } catch (error) {
    try {
      await reportActionError({
        error,
        action: params.action,
        section: 'meetings',
        errorType: params.errorType,
        userId: params.userIdForErrorLog ?? params.userId,
      })
    } catch (reportError) {
      console.error('Kalendářové zrušení schůzky selhalo.', reportError)
    }
  }
}

async function syncMeetingGoogleCalendarItemSafely(params: {
  meetingId: string
  userId: string
  meeting: {
    id: string
    company_name: string | null
    contact_person: string | null
    contact_phone: string | null
    contact_email: string | null
    address: string | null
    title: string | null
    meeting_datetime: string | null
    pre_meeting_note: string | null
    result_note: string | null
    follow_up_task: string | null
    follow_up_task_note: string | null
    follow_up_task_priority: string | null
    follow_up_task_due_date: string | null
    status: 'planned' | 'completed'
    assigned_user_id: string | null
  }
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  try {
    await syncMeetingGoogleCalendarItem({
      meetingId: params.meetingId,
      userId: params.userId,
      meeting: params.meeting,
    })
  } catch (error) {
    try {
      await reportActionError({
        error,
        action: params.action,
        section: 'meetings',
        errorType: params.errorType,
        userId: params.userIdForErrorLog ?? params.userId,
      })
    } catch (reportError) {
      console.error('Google kalendářová synchronizace schůzky selhala.', reportError)
    }
  }
}

async function cancelMeetingGoogleCalendarItemSafely(params: {
  meetingId: string
  userId: string
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  try {
    await cancelMeetingGoogleCalendarItem({
      meetingId: params.meetingId,
      userId: params.userId,
    })
  } catch (error) {
    try {
      await reportActionError({
        error,
        action: params.action,
        section: 'meetings',
        errorType: params.errorType,
        userId: params.userIdForErrorLog ?? params.userId,
      })
    } catch (reportError) {
      console.error('Google kalendářové zrušení schůzky selhalo.', reportError)
    }
  }
}

async function createMeetingRecord(formData: FormData) {
  const { supabase, user, profile } = await getCurrentUserWithRole()

  const clientId = normalizeClientId(formData.get('client_id'))
  const contactId = normalizeContactId(formData.get('client_contact_id'))
  const rawCompanyName = normalizeText(formData.get('company_name'))
  const rawContactPerson = normalizeText(formData.get('contact_person'))
  const rawContactPhone = normalizeText(formData.get('contact_phone'))
  const rawContactEmail = normalizeText(formData.get('contact_email'))
  const rawAddress = normalizeText(formData.get('address'))
  const title = normalizeText(formData.get('title'))
  const meetingDatetime = normalizeDateTime(formData.get('meeting_datetime'))
  const preMeetingNote = normalizeText(formData.get('pre_meeting_note'))
  const resultNote = normalizeText(formData.get('result_note'))
  const followUpTask = normalizeText(formData.get('follow_up_task'))
  const followUpTaskNote = normalizeText(formData.get('follow_up_task_note'))
  const followUpTaskPriority = normalizeTaskPriority(formData.get('follow_up_task_priority'))
  const followUpTaskDueDate = normalizeDate(formData.get('follow_up_task_due_date'))
  const status = normalizeStatus(formData.get('status'))

  const resolvedFields = await resolveMeetingClientFields({
    clientId,
    contactId,
    companyName: rawCompanyName,
    contactPerson: rawContactPerson,
    contactPhone: rawContactPhone,
    contactEmail: rawContactEmail,
    address: rawAddress,
  })

  const companyName = resolvedFields.companyName
  const contactPerson = resolvedFields.contactPerson
  const contactPhone = resolvedFields.contactPhone
  const contactEmail = resolvedFields.contactEmail
  const address = resolvedFields.address

  if (!companyName) {
    throw new Error('Firma je povinná.')
  }

  if (!meetingDatetime) {
    throw new Error('Datum a čas schůzky je povinný.')
  }

  const { data, error } = await supabase
    .from('meetings')
    .insert({
      client_id: clientId,
      client_contact_id: contactId,
      company_name: companyName,
      contact_person: contactPerson,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      address,
      title,
      meeting_datetime: meetingDatetime,
      pre_meeting_note: preMeetingNote,
      result_note: resultNote,
      follow_up_task: followUpTask,
      follow_up_task_note: followUpTaskNote,
      follow_up_task_priority: followUpTaskPriority,
      follow_up_task_due_date: followUpTaskDueDate,
      status,
      assigned_user_id: user.id,
      created_by: user.id,
    })
    .select('id, assigned_user_id, created_by')
    .single()

  if (error || !data) {
    throw new Error(
      `Nepodařilo se vytvořit schůzku: ${error?.message ?? 'Neznámá chyba'}`
    )
  }

  await syncMeetingCalendarItemSafely({
    meetingId: data.id,
    userId: data.assigned_user_id ?? user.id,
    meeting: {
      id: data.id,
      company_name: companyName,
      contact_person: contactPerson,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      address,
      title,
      meeting_datetime: meetingDatetime,
      pre_meeting_note: preMeetingNote,
      result_note: resultNote,
      follow_up_task: followUpTask,
      follow_up_task_note: followUpTaskNote,
      follow_up_task_priority: followUpTaskPriority,
      follow_up_task_due_date: followUpTaskDueDate,
      status,
      assigned_user_id: data.assigned_user_id,
    },
    action: 'syncMeetingCalendarItemOnCreate',
    errorType: 'MeetingCalendarSyncCreateError',
    userIdForErrorLog: user.id,
  })

  await syncMeetingGoogleCalendarItemSafely({
    meetingId: data.id,
    userId: data.assigned_user_id ?? user.id,
    meeting: {
      id: data.id,
      company_name: companyName,
      contact_person: contactPerson,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      address,
      title,
      meeting_datetime: meetingDatetime,
      pre_meeting_note: preMeetingNote,
      result_note: resultNote,
      follow_up_task: followUpTask,
      follow_up_task_note: followUpTaskNote,
      follow_up_task_priority: followUpTaskPriority,
      follow_up_task_due_date: followUpTaskDueDate,
      status,
      assigned_user_id: data.assigned_user_id,
    },
    action: 'syncMeetingGoogleCalendarItemOnCreate',
    errorType: 'MeetingGoogleCalendarSyncCreateError',
    userIdForErrorLog: user.id,
  })

  await syncMeetingFollowUpTask({
    meetingId: data.id,
    clientId,
    contactId,
    followUpTask,
    followUpTaskNote,
    followUpTaskPriority,
    followUpTaskDueDate,
    companyName,
    contactPerson,
    assignedUserId: data.assigned_user_id,
    createdByUserId: data.created_by,
  })

  await createNotificationsForAdmins({
    supabase,
    actorUserId: user.id,
    category: 'meetings',
    type: 'meeting_created',
    title: 'Nová domluvená schůzka',
    message: `${profile.name ?? user.email ?? 'Uživatel'} domluvil schůzku: ${companyName}.`,
    entityType: 'meeting',
    entityId: data.id,
    href: `/meetings/${data.id}`,
    priority: 'normal',
    dedupeKey: `meeting_created:${data.id}`,
  })

  await logUserActivity({
    action: `Vytvořil schůzku: ${companyName}`,
    section: 'Schůzky',
    route: `/meetings/${data.id}`,
    userId: user.id,
  })

  revalidatePath('/dashboard')
  revalidatePath('/meetings')
  revalidatePath('/activities')
  revalidatePath('/notifications')
  revalidatePath('/tasks')
  revalidatePath('/clients')

  if (clientId) {
    revalidatePath(`/clients/${clientId}`)
  }

  return {
    id: data.id,
    companyName,
    meetingDateTime: meetingDatetime,
  }
}

async function updateMeetingRecord(formData: FormData) {
  const { supabase, user, role } = await getCurrentUserWithRole()

  const id = normalizeText(formData.get('id'))
  const clientId = normalizeClientId(formData.get('client_id'))
  const contactId = normalizeContactId(formData.get('client_contact_id'))
  const rawCompanyName = normalizeText(formData.get('company_name'))
  const rawContactPerson = normalizeText(formData.get('contact_person'))
  const rawContactPhone = normalizeText(formData.get('contact_phone'))
  const rawContactEmail = normalizeText(formData.get('contact_email'))
  const rawAddress = normalizeText(formData.get('address'))
  const title = normalizeText(formData.get('title'))
  const meetingDatetime = normalizeDateTime(formData.get('meeting_datetime'))
  const preMeetingNote = normalizeText(formData.get('pre_meeting_note'))
  const resultNote = normalizeText(formData.get('result_note'))
  const followUpTask = normalizeText(formData.get('follow_up_task'))
  const followUpTaskNote = normalizeText(formData.get('follow_up_task_note'))
  const followUpTaskPriority = normalizeTaskPriority(formData.get('follow_up_task_priority'))
  const followUpTaskDueDate = normalizeDate(formData.get('follow_up_task_due_date'))
  const status = normalizeStatus(formData.get('status'))

  if (!id) {
    throw new Error('Chybí ID schůzky.')
  }

  const resolvedFields = await resolveMeetingClientFields({
    clientId,
    contactId,
    companyName: rawCompanyName,
    contactPerson: rawContactPerson,
    contactPhone: rawContactPhone,
    contactEmail: rawContactEmail,
    address: rawAddress,
  })

  const companyName = resolvedFields.companyName
  const contactPerson = resolvedFields.contactPerson
  const contactPhone = resolvedFields.contactPhone
  const contactEmail = resolvedFields.contactEmail
  const address = resolvedFields.address

  if (!companyName) {
    throw new Error('Firma je povinná.')
  }

  if (!meetingDatetime) {
    throw new Error('Datum a čas schůzky je povinný.')
  }

  const meeting = await getMeetingForPermissionCheck(id)

  const canEdit =
    role === 'admin' ||
    meeting.assigned_user_id === user.id ||
    meeting.created_by === user.id

  if (!canEdit) {
    throw new Error('Tuto schůzku můžete upravit jen jako admin nebo jako její vlastník.')
  }

  const { data, error } = await supabase
    .from('meetings')
    .update({
      client_id: clientId,
      client_contact_id: contactId,
      company_name: companyName,
      contact_person: contactPerson,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      address,
      title,
      meeting_datetime: meetingDatetime,
      pre_meeting_note: preMeetingNote,
      result_note: resultNote,
      follow_up_task: followUpTask,
      follow_up_task_note: followUpTaskNote,
      follow_up_task_priority: followUpTaskPriority,
      follow_up_task_due_date: followUpTaskDueDate,
      status,
    })
    .eq('id', id)
    .select('id, assigned_user_id, created_by')
    .single()

  if (error || !data) {
    throw new Error(
      `Nepodařilo se uložit schůzku: ${error?.message ?? 'Neznámá chyba'}`
    )
  }

  await syncMeetingCalendarItemSafely({
    meetingId: data.id,
    userId: data.assigned_user_id ?? user.id,
    meeting: {
      id,
      company_name: companyName,
      contact_person: contactPerson,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      address,
      title,
      meeting_datetime: meetingDatetime,
      pre_meeting_note: preMeetingNote,
      result_note: resultNote,
      follow_up_task: followUpTask,
      follow_up_task_note: followUpTaskNote,
      follow_up_task_priority: followUpTaskPriority,
      follow_up_task_due_date: followUpTaskDueDate,
      status,
      assigned_user_id: data.assigned_user_id,
    },
    action: 'syncMeetingCalendarItemOnUpdate',
    errorType: 'MeetingCalendarSyncUpdateError',
    userIdForErrorLog: user.id,
  })

  await syncMeetingGoogleCalendarItemSafely({
    meetingId: data.id,
    userId: data.assigned_user_id ?? user.id,
    meeting: {
      id,
      company_name: companyName,
      contact_person: contactPerson,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      address,
      title,
      meeting_datetime: meetingDatetime,
      pre_meeting_note: preMeetingNote,
      result_note: resultNote,
      follow_up_task: followUpTask,
      follow_up_task_note: followUpTaskNote,
      follow_up_task_priority: followUpTaskPriority,
      follow_up_task_due_date: followUpTaskDueDate,
      status,
      assigned_user_id: data.assigned_user_id,
    },
    action: 'syncMeetingGoogleCalendarItemOnUpdate',
    errorType: 'MeetingGoogleCalendarSyncUpdateError',
    userIdForErrorLog: user.id,
  })

  await syncMeetingFollowUpTask({
    meetingId: data.id,
    clientId,
    contactId,
    followUpTask,
    followUpTaskNote,
    followUpTaskPriority,
    followUpTaskDueDate,
    companyName,
    contactPerson,
    assignedUserId: data.assigned_user_id,
    createdByUserId: data.created_by,
  })

  await logUserActivity({
    action: `Upravil schůzku: ${companyName}`,
    section: 'Schůzky',
    route: `/meetings/${id}`,
    userId: user.id,
  })

  revalidatePath('/dashboard')
  revalidatePath('/meetings')
  revalidatePath('/activities')
  revalidatePath(`/meetings/${id}`)
  revalidatePath(`/meetings/${id}/edit`)
  revalidatePath('/tasks')
  revalidatePath('/clients')

  if (clientId) {
    revalidatePath(`/clients/${clientId}`)
  }

  if (meeting.client_id && meeting.client_id !== clientId) {
    revalidatePath(`/clients/${meeting.client_id}`)
  }

  return { id }
}

export async function createMeeting(formData: FormData) {
  const { id } = await createMeetingRecord(formData)
  redirect(`/meetings/${id}`)
}

export async function createMeetingModalAction(
  _prevState: CreateMeetingActionState,
  formData: FormData
): Promise<CreateMeetingActionState> {
  try {
    const result = await createMeetingRecord(formData)

    return {
      success: true,
      error: null,
      companyName: result.companyName ?? undefined,
      meetingDateTime: result.meetingDateTime ?? undefined,
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'createMeetingModalAction',
      section: 'meetings',
      errorType: 'CreateMeetingModalActionError',
    })
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se vytvořit schůzku.',
    }
  }
}

export async function updateMeeting(formData: FormData) {
  const { id } = await updateMeetingRecord(formData)
  redirect(`/meetings/${id}`)
}

export async function updateMeetingModalAction(
  _prevState: UpdateMeetingActionState,
  formData: FormData
): Promise<UpdateMeetingActionState> {
  try {
    await updateMeetingRecord(formData)

    return {
      success: true,
      error: null,
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'updateMeetingModalAction',
      section: 'meetings',
      errorType: 'UpdateMeetingModalActionError',
    })
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se uložit schůzku.',
    }
  }
}

export async function deleteMeeting(formData: FormData) {
  const { supabase, role, user } = await getCurrentUserWithRole()

  const id = normalizeText(formData.get('id'))

  if (!id) {
    throw new Error('Chybí ID schůzky.')
  }

  const meeting = await getMeetingForPermissionCheck(id)

  const canDelete = role === 'admin'

  if (!canDelete) {
    throw new Error('Tuto schůzku může smazat jen admin.')
  }

  const { error: taskDeleteError } = await supabase
    .from('tasks')
    .delete()
    .eq('meeting_id', id)
    .eq('source', 'meeting')

  if (taskDeleteError) {
    throw new Error(
      `Nepodařilo se odstranit navázaný task: ${taskDeleteError.message}`
    )
  }

  await cancelMeetingCalendarItemSafely({
    meetingId: id,
    userId: meeting.assigned_user_id ?? user.id,
    action: 'cancelMeetingCalendarItemOnDelete',
    errorType: 'MeetingCalendarSyncDeleteError',
    userIdForErrorLog: user.id,
  })

  await cancelMeetingGoogleCalendarItemSafely({
    meetingId: id,
    userId: meeting.assigned_user_id ?? user.id,
    action: 'cancelMeetingGoogleCalendarItemOnDelete',
    errorType: 'MeetingGoogleCalendarSyncDeleteError',
    userIdForErrorLog: user.id,
  })

  const { error } = await supabase.from('meetings').delete().eq('id', id)

  if (error) {
    throw new Error(`Nepodařilo se smazat schůzku: ${error.message}`)
  }

  await logUserActivity({
    action: `Smazal schůzku ${meeting.id}`,
    section: 'Schůzky',
    route: '/meetings',
    userId: user.id,
  })

  revalidatePath('/dashboard')
  revalidatePath('/meetings')
  revalidatePath('/activities')
  revalidatePath('/tasks')
  revalidatePath('/clients')

  if (meeting.client_id) {
    revalidatePath(`/clients/${meeting.client_id}`)
  }

  redirect('/meetings')
}
