import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'

export type TaskPerson = {
  id: string
  name: string | null
  role: string | null
}

export type TaskClient = {
  id: string
  name: string | null
}

export type TaskRow = {
  id: string
  title: string
  note: string | null
  due_date: string | null
  status: string | null
  priority: string | null
  repeat_interval: string | null
  created_by: string | null
  assigned_to: string | null
  created_at: string | null
  client_id: string | null
  client_contact_id: string | null
  company_name: string | null
  contact_person: string | null
  creator: TaskPerson | TaskPerson[] | null
  assignee: TaskPerson | TaskPerson[] | null
  client: TaskClient | TaskClient[] | null
}

function isMissingRepeatIntervalColumnError(error: {
  code?: string
  message?: string
} | null) {
  const message = String(error?.message ?? '').toLowerCase()

  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    (message.includes('repeat_interval') && message.includes('column'))
  )
}

function withDefaultRepeatInterval(tasks: unknown[] | null): TaskRow[] {
  return (tasks ?? []).map((task) => ({
    ...(task as Omit<TaskRow, 'repeat_interval'>),
    repeat_interval:
      'repeat_interval' in (task as Record<string, unknown>)
        ? ((task as { repeat_interval?: string | null }).repeat_interval ?? null)
        : null,
  }))
}

export async function getTasksForCurrentUser(): Promise<{
  profile: { id: string; name: string | null; role: string | null }
  assignedToMe: TaskRow[]
  createdByMe: TaskRow[]
  allTasks: TaskRow[]
}> {
  const supabase = await createClient()
  const profile = await getCurrentProfile()

  const baseSelect = `
    id,
    title,
    note,
    due_date,
    status,
    priority,
    repeat_interval,
    created_by,
    assigned_to,
    created_at,
    client_id,
    client_contact_id,
    company_name,
    contact_person,
    creator:created_by (
      id,
      name,
      role
    ),
    assignee:assigned_to (
      id,
      name,
      role
    ),
    client:clients (
      id,
      name
    )
  `

  const baseSelectWithoutRepeatInterval = baseSelect
    .replace(/\s*repeat_interval,\n/, '\n')

  if (profile.role === 'admin') {
    const response = await supabase
      .from('tasks')
      .select(baseSelect)
      .order('created_at', { ascending: false })

    let data = response.data as unknown[] | null
    let error = response.error

    if (isMissingRepeatIntervalColumnError(error)) {
      const fallbackResponse = await supabase
        .from('tasks')
        .select(baseSelectWithoutRepeatInterval)
        .order('created_at', { ascending: false })

      data = fallbackResponse.data as unknown[] | null
      error = fallbackResponse.error
    }

    if (error) {
      throw new Error('Nepodařilo se načíst úkoly.')
    }

    const tasks = withDefaultRepeatInterval(data)

    return {
      profile,
      assignedToMe: tasks.filter((task) => task.assigned_to === profile.id),
      createdByMe: tasks.filter((task) => task.created_by === profile.id),
      allTasks: tasks,
    }
  }

  const assignedResponse = await supabase
    .from('tasks')
    .select(baseSelect)
    .eq('assigned_to', profile.id)
    .order('created_at', { ascending: false })

  let assignedToMe = assignedResponse.data as unknown[] | null
  let assignedError = assignedResponse.error

  if (isMissingRepeatIntervalColumnError(assignedError)) {
    const fallbackResponse = await supabase
      .from('tasks')
      .select(baseSelectWithoutRepeatInterval)
      .eq('assigned_to', profile.id)
      .order('created_at', { ascending: false })

    assignedToMe = fallbackResponse.data as unknown[] | null
    assignedError = fallbackResponse.error
  }

  if (assignedError) {
    throw new Error('Nepodařilo se načíst přiřazené úkoly.')
  }

  const createdResponse = await supabase
    .from('tasks')
    .select(baseSelect)
    .eq('created_by', profile.id)
    .order('created_at', { ascending: false })

  let createdByMe = createdResponse.data as unknown[] | null
  let createdError = createdResponse.error

  if (isMissingRepeatIntervalColumnError(createdError)) {
    const fallbackResponse = await supabase
      .from('tasks')
      .select(baseSelectWithoutRepeatInterval)
      .eq('created_by', profile.id)
      .order('created_at', { ascending: false })

    createdByMe = fallbackResponse.data as unknown[] | null
    createdError = fallbackResponse.error
  }

  if (createdError) {
    throw new Error('Nepodařilo se načíst zadané úkoly.')
  }

  const assignedTasks = withDefaultRepeatInterval(assignedToMe)
  const createdTasks = withDefaultRepeatInterval(createdByMe)

  return {
    profile,
    assignedToMe: assignedTasks,
    createdByMe: createdTasks,
    allTasks: [],
  }
}
