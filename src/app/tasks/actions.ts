'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'

export type TaskFormActionState = {
  success: boolean
  error: string | null
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

function normalizeOptionalString(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length ? str : null
}

function normalizeClientId(value: FormDataEntryValue | null): string | null {
  const str = String(value ?? '').trim()
  return str.length ? str : null
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

async function resolveTaskClientFields(params: {
  clientId: string | null
  companyName: string | null
  contactPerson: string | null
}) {
  const { clientId, companyName, contactPerson } = params

  if (!clientId) {
    return {
      companyName,
      contactPerson,
    }
  }

  const client = await getClientSnapshot(clientId)

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
  const priority = 'medium'

  const clientId = normalizeClientId(formData.get('client_id'))
  const rawCompanyName = normalizeOptionalString(formData.get('company_name'))
  const rawContactPerson = normalizeOptionalString(formData.get('contact_person'))

  const resolvedFields = await resolveTaskClientFields({
    clientId,
    companyName: rawCompanyName,
    contactPerson: rawContactPerson,
  })

  if (!title) {
    throw new Error('Název úkolu je povinný.')
  }

  const { error } = await supabase.from('tasks').insert({
    title,
    note,
    due_date,
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null,
    priority,
    client_id: clientId,
    company_name: resolvedFields.companyName,
    contact_person: resolvedFields.contactPerson,
    created_by: currentProfile.id,
    assigned_to: assigned_to ?? currentProfile.id,
  })

  if (error && isMissingCompletedAtColumnError(error.message)) {
    const { error: fallbackError } = await supabase.from('tasks').insert({
      title,
      note,
      due_date,
      status,
      priority,
      client_id: clientId,
      company_name: resolvedFields.companyName,
      contact_person: resolvedFields.contactPerson,
      created_by: currentProfile.id,
      assigned_to: assigned_to ?? currentProfile.id,
    })

    if (fallbackError) {
      throw new Error(`Nepodařilo se vytvořit úkol: ${fallbackError.message}`)
    }
  } else if (error) {
    throw new Error(`Nepodařilo se vytvořit úkol: ${error.message}`)
  }

  revalidatePath('/tasks')
  revalidatePath('/clients')

  if (clientId) {
    revalidatePath(`/clients/${clientId}`)
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

  const clientId = normalizeClientId(formData.get('client_id'))
  const rawCompanyName = normalizeOptionalString(formData.get('company_name'))
  const rawContactPerson = normalizeOptionalString(formData.get('contact_person'))

  if (!title) {
    throw new Error('Název úkolu je povinný.')
  }

  const { data: existingTask, error: loadError } = await supabase
    .from('tasks')
    .select(
      'id, created_by, assigned_to, client_id, company_name, contact_person, priority, status'
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
      client_id: nextClientId,
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
        client_id: nextClientId,
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

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  revalidatePath(`/tasks/${taskId}/edit`)
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
    await createTaskRecord(formData)

    return {
      success: true,
      error: null,
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

export async function updateTaskStatus(taskId: string, status: string) {
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()

  const normalizedStatus = ['todo', 'done'].includes(status) ? status : 'todo'

  const { data: existingTask, error: loadError } = await supabase
    .from('tasks')
    .select('id, created_by, assigned_to, client_id, status')
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

  const { error } = await supabase
    .from('tasks')
    .update({ status: normalizedStatus, completed_at })
    .eq('id', taskId)

  if (error && isMissingCompletedAtColumnError(error.message)) {
    const { error: fallbackError } = await supabase
      .from('tasks')
      .update({ status: normalizedStatus })
      .eq('id', taskId)

    if (fallbackError) {
      throw new Error(`Nepodařilo se změnit stav úkolu: ${fallbackError.message}`)
    }
  } else if (error) {
    throw new Error(`Nepodařilo se změnit stav úkolu: ${error.message}`)
  }

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  revalidatePath('/clients')

  if (existingTask.client_id) {
    revalidatePath(`/clients/${existingTask.client_id}`)
  }
}

export async function deleteTask(taskId: string) {
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()

  const { data: existingTask, error: loadError } = await supabase
    .from('tasks')
    .select('id, created_by, assigned_to, client_id')
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

  revalidatePath('/tasks')
  revalidatePath('/clients')

  if (existingTask.client_id) {
    revalidatePath(`/clients/${existingTask.client_id}`)
  }

  redirect('/tasks')
}
