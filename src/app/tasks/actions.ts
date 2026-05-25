'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import { createNotification } from '@/lib/notifications/createNotification'
import { logUserActivity } from '@/lib/activity-log/logUserActivity'

export type TaskFormActionState = {
  success: boolean
  error: string | null
  taskTitle?: string
}

export type CreateTaskActionState = TaskFormActionState
export type UpdateTaskActionState = TaskFormActionState

function isMissingCompletedAtColumnError(errorMessage: string | null | undefined) {
  const message = String(errorMessage ?? '').toLowerCase()
  return message.includes('completed_at') && message.includes('column')
}

function resolveCompletedAt(params: {
  nextStatus: string
  previousStatus?: string | null
  previousCompletedAt?: string | null
}) {
  const { nextStatus, previousStatus = null, previousCompletedAt = null } = params

  if (nextStatus !== 'done') {
    return null
  }

  if (previousStatus === 'done' && previousCompletedAt) {
    return previousCompletedAt
  }

  return new Date().toISOString()
}

function normalizeStatus(value: FormDataEntryValue | null): string {
  const allowed = ['todo', 'done']
  const str = String(value ?? 'todo')
  return allowed.includes(str) ? str : 'todo'
}

function normalizePriority(value: FormDataEntryValue | null): string {
  const allowed = ['low', 'medium', 'high']
  const str = String(value ?? 'medium')
  return allowed.includes(str) ? str : 'medium'
}

function normalizeRepeatInterval(value: FormDataEntryValue | null): string | null {
  const allowed = ['daily', 'weekly', 'monthly']
  const str = String(value ?? '').trim()
  return allowed.includes(str) ? str : null
}

function getNotificationPriority(taskPriority: string) {
  return taskPriority === 'high' ? 'high' : 'normal'
}

function normalizeOptionalString(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length ? str : null
}

function normalizeClientId(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length ? str : null
}

function normalizeContactId(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length ? str : null
}

function parseDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))

  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateOnly(value: Date) {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function addMonthsClamped(value: Date, months: number) {
  const year = value.getUTCFullYear()
  const month = value.getUTCMonth()
  const day = value.getUTCDate()
  const targetMonthStart = new Date(Date.UTC(year, month + months, 1))
  const lastDayInTargetMonth = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0
    )
  ).getUTCDate()

  return new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(day, lastDayInTargetMonth)
    )
  )
}

function getNextDueDate(
  dueDate: string | null,
  repeatInterval: string | null
) {
  if (!dueDate || !repeatInterval) return null

  const parsed = parseDateOnly(dueDate)
  if (!parsed) return null

  if (repeatInterval === 'daily') {
    parsed.setUTCDate(parsed.getUTCDate() + 1)
    return formatDateOnly(parsed)
  }

  if (repeatInterval === 'weekly') {
    parsed.setUTCDate(parsed.getUTCDate() + 7)
    return formatDateOnly(parsed)
  }

  if (repeatInterval === 'monthly') {
    return formatDateOnly(addMonthsClamped(parsed, 1))
  }

  return null
}

async function createNextRecurringTask(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  task: {
    title: string
    note: string | null
    due_date: string | null
    priority: string | null
    repeat_interval: string | null
    client_id: string | null
    client_contact_id: string | null
    company_name: string | null
    contact_person: string | null
    created_by: string | null
    assigned_to: string | null
  }
}) {
  const { supabase, task } = params
  const nextDueDate = getNextDueDate(task.due_date, task.repeat_interval)

  if (!nextDueDate || !task.repeat_interval) {
    return null
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: task.title,
      note: task.note,
      due_date: nextDueDate,
      status: 'todo',
      completed_at: null,
      priority: task.priority ?? 'medium',
      repeat_interval: task.repeat_interval,
      client_id: task.client_id,
      client_contact_id: task.client_contact_id,
      company_name: task.company_name,
      contact_person: task.contact_person,
      created_by: task.created_by,
      assigned_to: task.assigned_to,
      source: 'manual',
      meeting_id: null,
    })
    .select('id')
    .single()

  if (error && isMissingCompletedAtColumnError(error.message)) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('tasks')
      .insert({
        title: task.title,
        note: task.note,
        due_date: nextDueDate,
        status: 'todo',
        priority: task.priority ?? 'medium',
        repeat_interval: task.repeat_interval,
        client_id: task.client_id,
        client_contact_id: task.client_contact_id,
        company_name: task.company_name,
        contact_person: task.contact_person,
        created_by: task.created_by,
        assigned_to: task.assigned_to,
        source: 'manual',
        meeting_id: null,
      })
      .select('id')
      .single()

    if (fallbackError) {
      throw new Error(`Nepodařilo se vytvořit další opakování úkolu: ${fallbackError.message}`)
    }

    return fallbackData?.id ?? null
  }

  if (error) {
    throw new Error(`Nepodařilo se vytvořit další opakování úkolu: ${error.message}`)
  }

  return data?.id ?? null
}

async function getClientSnapshot(clientId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clients')
    .select('id, name, contact_person')
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
    .select('id, client_id, name')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .single()

  if (error || !data) {
    throw new Error('Vybraná kontaktní osoba nebyla nalezena.')
  }

  return data
}

async function resolveTaskClientFields(params: {
  clientId: string | null
  contactId: string | null
  companyName: string | null
  contactPerson: string | null
}) {
  const { clientId, contactId, companyName, contactPerson } = params

  if (!clientId) {
    return {
      companyName,
      contactPerson,
    }
  }

  const client = await getClientSnapshot(clientId)

  if (contactId) {
    const contact = await getClientContactSnapshot(contactId, clientId)

    return {
      companyName: companyName ?? client.name ?? null,
      contactPerson: contact.name ?? null,
    }
  }

  return {
    companyName: companyName ?? client.name ?? null,
    contactPerson: contactPerson ?? client.contact_person ?? null,
  }
}

async function createTaskRecord(formData: FormData) {
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()

  const title = String(formData.get('title') ?? '').trim()
  const note = normalizeOptionalString(formData.get('note'))
  const due_date = normalizeOptionalString(formData.get('due_date'))
  const assigned_to = normalizeOptionalString(formData.get('assigned_to'))
  const status = normalizeStatus(formData.get('status'))
  const priority = normalizePriority(formData.get('priority'))
  const repeat_interval = normalizeRepeatInterval(formData.get('repeat_interval'))

  const clientId = normalizeClientId(formData.get('client_id'))
  const contactId = normalizeContactId(formData.get('client_contact_id'))
  const rawCompanyName = normalizeOptionalString(formData.get('company_name'))
  const rawContactPerson = normalizeOptionalString(formData.get('contact_person'))

  const resolvedFields = await resolveTaskClientFields({
    clientId,
    contactId,
    companyName: rawCompanyName,
    contactPerson: rawContactPerson,
  })

  if (!title) {
    throw new Error('Název úkolu je povinný.')
  }

  if (repeat_interval && !due_date) {
    throw new Error('Opakování úkolu vyžaduje vyplněný termín.')
  }

  const { data: createdTask, error } = await supabase
    .from('tasks')
    .insert({
      title,
      note,
      due_date,
      status,
      completed_at: status === 'done' ? new Date().toISOString() : null,
      priority,
      repeat_interval,
      client_id: clientId,
      client_contact_id: contactId,
      company_name: resolvedFields.companyName,
      contact_person: resolvedFields.contactPerson,
      created_by: currentProfile.id,
      assigned_to: assigned_to ?? currentProfile.id,
    })
    .select('id, title, assigned_to, created_by')
    .single()

  let notificationTask = createdTask as {
    id: string
    title: string
    assigned_to: string | null
    created_by: string | null
  } | null

  if (error && isMissingCompletedAtColumnError(error.message)) {
    const { data: fallbackTask, error: fallbackError } = await supabase
      .from('tasks')
      .insert({
        title,
        note,
        due_date,
        status,
        priority,
        repeat_interval,
        client_id: clientId,
        client_contact_id: contactId,
        company_name: resolvedFields.companyName,
        contact_person: resolvedFields.contactPerson,
        created_by: currentProfile.id,
        assigned_to: assigned_to ?? currentProfile.id,
      })
      .select('id, title, assigned_to, created_by')
      .single()

    if (fallbackError) {
      throw new Error(`Nepodařilo se vytvořit úkol: ${fallbackError.message}`)
    }

    notificationTask = fallbackTask as typeof notificationTask
  } else if (error) {
    throw new Error(`Nepodařilo se vytvořit úkol: ${error.message}`)
  }

  if (notificationTask) {
    await createNotification({
      supabase,
      recipientUserId: notificationTask.assigned_to,
      actorUserId: currentProfile.id,
      category: 'tasks',
      type: 'task_assigned',
      title: 'Nový úkol',
      message: `${currentProfile.name ?? 'Uživatel'} Ti přiřadil úkol: ${notificationTask.title}.`,
      entityType: 'task',
      entityId: notificationTask.id,
      href: `/tasks/${notificationTask.id}`,
      priority: getNotificationPriority(priority),
      dedupeKey: `task_assigned:${notificationTask.id}:${notificationTask.assigned_to}`,
    })
  }

  await logUserActivity({
    action: `Vytvořil úkol: ${title}`,
    section: 'Úkoly',
    route: '/tasks',
    userId: currentProfile.id,
  })

  revalidatePath('/tasks')
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
  revalidatePath('/clients')

  if (clientId) {
    revalidatePath(`/clients/${clientId}`)
  }

  return {
    taskTitle: title,
  }
}

async function updateTaskRecord(taskId: string, formData: FormData) {
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()

  const title = String(formData.get('title') ?? '').trim()
  const note = normalizeOptionalString(formData.get('note'))
  const due_date = normalizeOptionalString(formData.get('due_date'))
  const assigned_to = normalizeOptionalString(formData.get('assigned_to'))
  const status = normalizeStatus(formData.get('status'))
  const submittedPriority = formData.get('priority')
  const repeat_interval = normalizeRepeatInterval(formData.get('repeat_interval'))

  const clientId = normalizeClientId(formData.get('client_id'))
  const contactId = normalizeContactId(formData.get('client_contact_id'))
  const rawCompanyName = normalizeOptionalString(formData.get('company_name'))
  const rawContactPerson = normalizeOptionalString(formData.get('contact_person'))

  if (!title) {
    throw new Error('Název úkolu je povinný.')
  }

  if (repeat_interval && !due_date) {
    throw new Error('Opakování úkolu vyžaduje vyplněný termín.')
  }

  const { data: existingTask, error: loadError } = await supabase
    .from('tasks')
    .select(
      'id, title, note, due_date, created_by, assigned_to, client_id, client_contact_id, company_name, contact_person, priority, status, repeat_interval'
    )
    .eq('id', taskId)
    .single()

  if (loadError || !existingTask) {
    throw new Error('Úkol nebyl nalezen.')
  }

  const isAdmin = currentProfile.role === 'admin'
  const canEdit =
    isAdmin ||
    existingTask.created_by === currentProfile.id ||
    existingTask.assigned_to === currentProfile.id

  if (!canEdit) {
    throw new Error('Na úpravu tohoto úkolu nemáš oprávnění.')
  }

  const canManageAssignment =
    isAdmin || existingTask.created_by === currentProfile.id
  const canManageClientLink =
    isAdmin || existingTask.created_by === currentProfile.id

  const resolvedFields = canManageClientLink
    ? await resolveTaskClientFields({
        clientId,
        contactId,
        companyName: rawCompanyName,
        contactPerson: rawContactPerson,
      })
    : {
        companyName: existingTask.company_name ?? rawCompanyName,
        contactPerson: existingTask.contact_person ?? rawContactPerson,
      }

  const priority =
    submittedPriority === null
      ? existingTask.priority ?? 'medium'
      : normalizePriority(submittedPriority)

  const nextAssignedTo = canManageAssignment
    ? assigned_to
    : existingTask.assigned_to
  const nextClientId = canManageClientLink
    ? clientId
    : existingTask.client_id
  const nextContactId = canManageClientLink
    ? contactId
    : existingTask.client_contact_id

  const completed_at = resolveCompletedAt({
    nextStatus: status,
    previousStatus: existingTask.status,
    previousCompletedAt: null,
  })

  const { error } = await supabase
    .from('tasks')
    .update({
      title,
      note,
      due_date,
      status,
      completed_at,
      priority,
      repeat_interval,
      client_id: nextClientId,
      client_contact_id: nextContactId,
      company_name: resolvedFields.companyName,
      contact_person: resolvedFields.contactPerson,
      assigned_to: nextAssignedTo,
    })
    .eq('id', taskId)

  if (error && isMissingCompletedAtColumnError(error.message)) {
    const { error: fallbackError } = await supabase
      .from('tasks')
      .update({
        title,
        note,
        due_date,
        status,
        priority,
        repeat_interval,
        client_id: nextClientId,
        client_contact_id: nextContactId,
        company_name: resolvedFields.companyName,
        contact_person: resolvedFields.contactPerson,
        assigned_to: nextAssignedTo,
      })
      .eq('id', taskId)

    if (fallbackError) {
      throw new Error(`Nepodařilo se upravit úkol: ${fallbackError.message}`)
    }
  } else if (error) {
    throw new Error(`Nepodařilo se upravit úkol: ${error.message}`)
  }

  if (nextAssignedTo && nextAssignedTo !== existingTask.assigned_to) {
    await createNotification({
      supabase,
      recipientUserId: nextAssignedTo,
      actorUserId: currentProfile.id,
      category: 'tasks',
      type: 'task_assigned',
      title: 'Nový úkol',
      message: `${currentProfile.name ?? 'Uživatel'} Ti přiřadil úkol: ${title}.`,
      entityType: 'task',
      entityId: taskId,
      href: `/tasks/${taskId}`,
      priority: getNotificationPriority(priority),
      dedupeKey: `task_assigned:${taskId}:${nextAssignedTo}`,
    })
  }

  if (existingTask.status !== 'done' && status === 'done') {
    await createNotification({
      supabase,
      recipientUserId: existingTask.created_by,
      actorUserId: currentProfile.id,
      category: 'tasks',
      type: 'task_completed',
      title: 'Úkol byl splněn',
      message: `${currentProfile.name ?? 'Uživatel'} splnil úkol: ${title}.`,
      entityType: 'task',
      entityId: taskId,
      href: `/tasks/${taskId}`,
      priority: 'normal',
      dedupeKey: `task_completed:${taskId}`,
    })
  }

  if (
    existingTask.status !== 'done' &&
    status === 'done' &&
    repeat_interval
  ) {
    await createNextRecurringTask({
      supabase,
      task: {
        title,
        note,
        due_date,
        priority,
        repeat_interval,
        client_id: nextClientId,
        client_contact_id: nextContactId,
        company_name: resolvedFields.companyName,
        contact_person: resolvedFields.contactPerson,
        created_by: existingTask.created_by,
        assigned_to: nextAssignedTo,
      },
    })
  }

  await logUserActivity({
    action: `Upravil úkol: ${title}`,
    section: 'Úkoly',
    route: `/tasks/${taskId}`,
    userId: currentProfile.id,
  })

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  revalidatePath(`/tasks/${taskId}/edit`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
  revalidatePath('/clients')

  if (nextClientId) {
    revalidatePath(`/clients/${nextClientId}`)
  }

  if (existingTask.client_id && existingTask.client_id !== nextClientId) {
    revalidatePath(`/clients/${existingTask.client_id}`)
  }
}

export async function createTask(formData: FormData) {
  await createTaskRecord(formData)
  redirect('/tasks')
}

export async function createTaskModalAction(
  _prevState: CreateTaskActionState,
  formData: FormData
): Promise<CreateTaskActionState> {
  try {
    const result = await createTaskRecord(formData)

    return {
      success: true,
      error: null,
      taskTitle: result.taskTitle,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Nepodařilo se vytvořit úkol.',
    }
  }
}

export async function updateTask(taskId: string, formData: FormData) {
  await updateTaskRecord(taskId, formData)
  redirect(`/tasks/${taskId}`)
}

export async function updateTaskModalAction(
  taskId: string,
  _prevState: UpdateTaskActionState,
  formData: FormData
): Promise<UpdateTaskActionState> {
  try {
    await updateTaskRecord(taskId, formData)

    return {
      success: true,
      error: null,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Nepodařilo se upravit úkol.',
    }
  }
}

async function updateTaskStatusRecord(
  taskId: string,
  status: string,
  options: {
    skipNextRepeat?: boolean
    clearRepeatInterval?: boolean
  } = {}
) {
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()

  const normalizedStatus = ['todo', 'done'].includes(status) ? status : 'todo'

  const { data: existingTask, error: loadError } = await supabase
    .from('tasks')
    .select(`
      id,
      title,
      note,
      due_date,
      created_by,
      assigned_to,
      client_id,
      client_contact_id,
      company_name,
      contact_person,
      priority,
      status,
      repeat_interval
    `)
    .eq('id', taskId)
    .single()

  if (loadError || !existingTask) {
    throw new Error('Úkol nebyl nalezen.')
  }

  const isAdmin = currentProfile.role === 'admin'
  const canEdit =
    isAdmin ||
    existingTask.created_by === currentProfile.id ||
    existingTask.assigned_to === currentProfile.id

  if (!canEdit) {
    throw new Error('Na změnu stavu tohoto úkolu nemáš oprávnění.')
  }

  const completed_at = resolveCompletedAt({
    nextStatus: normalizedStatus,
    previousStatus: existingTask.status,
    previousCompletedAt: null,
  })

  const updateValues = options.clearRepeatInterval
    ? {
        status: normalizedStatus,
        completed_at,
        repeat_interval: null,
      }
    : {
        status: normalizedStatus,
        completed_at,
      }

  const { error } = await supabase
    .from('tasks')
    .update(updateValues)
    .eq('id', taskId)

  if (error && isMissingCompletedAtColumnError(error.message)) {
    const fallbackUpdateValues = options.clearRepeatInterval
      ? {
          status: normalizedStatus,
          repeat_interval: null,
        }
      : {
          status: normalizedStatus,
        }

    const { error: fallbackError } = await supabase
      .from('tasks')
      .update(fallbackUpdateValues)
      .eq('id', taskId)

    if (fallbackError) {
      throw new Error(`Nepodařilo se změnit stav úkolu: ${fallbackError.message}`)
    }
  } else if (error) {
    throw new Error(`Nepodařilo se změnit stav úkolu: ${error.message}`)
  }

  if (existingTask.status !== 'done' && normalizedStatus === 'done') {
    await createNotification({
      supabase,
      recipientUserId: existingTask.created_by,
      actorUserId: currentProfile.id,
      category: 'tasks',
      type: 'task_completed',
      title: 'Úkol byl splněn',
      message: `${currentProfile.name ?? 'Uživatel'} splnil úkol: ${existingTask.title}.`,
      entityType: 'task',
      entityId: taskId,
      href: `/tasks/${taskId}`,
      priority: 'normal',
      dedupeKey: `task_completed:${taskId}`,
    })
  }

  if (
    existingTask.status !== 'done' &&
    normalizedStatus === 'done' &&
    existingTask.repeat_interval &&
    !options.skipNextRepeat
  ) {
    await createNextRecurringTask({
      supabase,
      task: {
        title: existingTask.title,
        note: existingTask.note,
        due_date: existingTask.due_date,
        priority: existingTask.priority,
        repeat_interval: existingTask.repeat_interval,
        client_id: existingTask.client_id,
        client_contact_id: existingTask.client_contact_id,
        company_name: existingTask.company_name,
        contact_person: existingTask.contact_person,
        created_by: existingTask.created_by,
        assigned_to: existingTask.assigned_to,
      },
    })
  }

  await logUserActivity({
    action:
      normalizedStatus === 'done'
        ? `Označil úkol jako hotový: ${existingTask.title}`
        : `Přepnul úkol na aktivní: ${existingTask.title}`,
    section: 'Úkoly',
    route: `/tasks/${taskId}`,
    userId: currentProfile.id,
  })

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
  revalidatePath('/clients')

  if (existingTask.client_id) {
    revalidatePath(`/clients/${existingTask.client_id}`)
  }
}

export async function updateTaskStatus(taskId: string, status: string) {
  await updateTaskStatusRecord(taskId, status)
}

export async function endTaskRecurrence(taskId: string) {
  await updateTaskStatusRecord(taskId, 'done', {
    skipNextRepeat: true,
    clearRepeatInterval: true,
  })
}

export async function deleteTask(taskId: string) {
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()

  const { data: existingTask, error: loadError } = await supabase
    .from('tasks')
    .select('id, title, created_by, assigned_to, client_id')
    .eq('id', taskId)
    .single()

  if (loadError || !existingTask) {
    throw new Error('Úkol nebyl nalezen.')
  }

  const isAdmin = currentProfile.role === 'admin'
  const canDelete =
    isAdmin ||
    existingTask.created_by === currentProfile.id ||
    existingTask.assigned_to === currentProfile.id

  if (!canDelete) {
    throw new Error('Na smazání tohoto úkolu nemáš oprávnění.')
  }

  const { error } = await supabase.from('tasks').delete().eq('id', taskId)

  if (error) {
    throw new Error(`Nepodařilo se smazat úkol: ${error.message}`)
  }

  await logUserActivity({
    action: `Smazal úkol: ${existingTask.title}`,
    section: 'Úkoly',
    route: '/tasks',
    userId: currentProfile.id,
  })

  revalidatePath('/tasks')
  revalidatePath('/clients')

  if (existingTask.client_id) {
    revalidatePath(`/clients/${existingTask.client_id}`)
  }

  redirect('/tasks')
}
