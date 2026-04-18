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

function normalizeStatus(value: FormDataEntryValue | null): string {
  const allowed = ['todo', 'in_progress', 'done']
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
  const priority = normalizePriority(formData.get('priority'))

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
    priority,
    client_id: clientId,
    company_name: resolvedFields.companyName,
    contact_person: resolvedFields.contactPerson,
    created_by: currentProfile.id,
    assigned_to: assigned_to ?? currentProfile.id,
  })

  if (error) {
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
  const priority = normalizePriority(formData.get('priority'))

  const clientId = normalizeClientId(formData.get('client_id'))
  const rawCompanyName = normalizeOptionalString(formData.get('company_name'))
  const rawContactPerson = normalizeOptionalString(formData.get('contact_person'))

  if (!title) {
    throw new Error('Název úkolu je povinný.')
  }

  const { data: existingTask, error: loadError } = await supabase
    .from('tasks')
    .select('id, created_by, assigned_to, client_id')
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

  const resolvedFields = await resolveTaskClientFields({
    clientId,
    companyName: rawCompanyName,
    contactPerson: rawContactPerson,
  })

  const { error } = await supabase
    .from('tasks')
    .update({
      title,
      note,
      due_date,
      status,
      priority,
      client_id: clientId,
      company_name: resolvedFields.companyName,
      contact_person: resolvedFields.contactPerson,
      assigned_to,
    })
    .eq('id', taskId)

  if (error) {
    throw new Error(`Nepodařilo se upravit úkol: ${error.message}`)
  }

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  revalidatePath(`/tasks/${taskId}/edit`)
  revalidatePath('/clients')

  if (clientId) {
    revalidatePath(`/clients/${clientId}`)
  }

  if (existingTask.client_id && existingTask.client_id !== clientId) {
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
  redirect('/tasks')
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

  const normalizedStatus = ['todo', 'in_progress', 'done'].includes(status)
    ? status
    : 'todo'

  const { data: existingTask, error: loadError } = await supabase
    .from('tasks')
    .select('id, created_by, assigned_to, client_id')
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

  const { error } = await supabase
    .from('tasks')
    .update({ status: normalizedStatus })
    .eq('id', taskId)

  if (error) {
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
