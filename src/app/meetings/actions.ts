'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type MeetingFormActionState = {
  success: boolean
  error: string | null
}

export type CreateMeetingActionState = MeetingFormActionState
export type UpdateMeetingActionState = MeetingFormActionState

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function normalizeStatus(value: FormDataEntryValue | null) {
  return value === 'completed' ? 'completed' : 'planned'
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
    .select('id, role')
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

async function resolveMeetingClientFields(params: {
  clientId: string | null
  companyName: string | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
}) {
  const {
    clientId,
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
  followUpTask: string | null
  followUpTaskNote: string | null
  companyName: string | null
  contactPerson: string | null
  assignedUserId?: string | null
  createdByUserId?: string | null
}) {
  const supabase = await createClient()

  const {
    meetingId,
    followUpTask,
    followUpTaskNote,
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
        status: 'todo',
        source: 'meeting',
        meeting_id: meetingId,
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

async function createMeetingRecord(formData: FormData) {
  const { supabase, user } = await getCurrentUserWithRole()

  const clientId = normalizeClientId(formData.get('client_id'))
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
  const status = normalizeStatus(formData.get('status'))

  const resolvedFields = await resolveMeetingClientFields({
    clientId,
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

  await syncMeetingFollowUpTask({
    meetingId: data.id,
    followUpTask,
    followUpTaskNote,
    companyName,
    contactPerson,
    assignedUserId: data.assigned_user_id,
    createdByUserId: data.created_by,
  })

  revalidatePath('/dashboard')
  revalidatePath('/meetings')
  revalidatePath('/tasks')
  revalidatePath('/clients')

  if (clientId) {
    revalidatePath(`/clients/${clientId}`)
  }

  return { id: data.id }
}

async function updateMeetingRecord(formData: FormData) {
  const { supabase, user, role } = await getCurrentUserWithRole()

  const id = normalizeText(formData.get('id'))
  const clientId = normalizeClientId(formData.get('client_id'))
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
  const status = normalizeStatus(formData.get('status'))

  if (!id) {
    throw new Error('Chybí ID schůzky.')
  }

  const resolvedFields = await resolveMeetingClientFields({
    clientId,
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

  await syncMeetingFollowUpTask({
    meetingId: data.id,
    followUpTask,
    followUpTaskNote,
    companyName,
    contactPerson,
    assignedUserId: data.assigned_user_id,
    createdByUserId: data.created_by,
  })

  revalidatePath('/dashboard')
  revalidatePath('/meetings')
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
    await createMeetingRecord(formData)

    return {
      success: true,
      error: null,
    }
  } catch (error) {
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
  const { supabase, user, role } = await getCurrentUserWithRole()

  const id = normalizeText(formData.get('id'))

  if (!id) {
    throw new Error('Chybí ID schůzky.')
  }

  const meeting = await getMeetingForPermissionCheck(id)

  const canDelete =
    role === 'admin' ||
    meeting.assigned_user_id === user.id ||
    meeting.created_by === user.id

  if (!canDelete) {
    throw new Error('Tuto schůzku můžete smazat jen jako admin nebo jako její vlastník.')
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

  const { error } = await supabase.from('meetings').delete().eq('id', id)

  if (error) {
    throw new Error(`Nepodařilo se smazat schůzku: ${error.message}`)
  }

  revalidatePath('/dashboard')
  revalidatePath('/meetings')
  revalidatePath('/tasks')
  revalidatePath('/clients')

  if (meeting.client_id) {
    revalidatePath(`/clients/${meeting.client_id}`)
  }

  redirect('/meetings')
}
