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

  if (profile.role === 'admin') {
    const { data, error } = await supabase
      .from('tasks')
      .select(baseSelect)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error('Nepodařilo se načíst úkoly.')
    }

    const tasks = (data ?? []) as TaskRow[]

    return {
      profile,
      assignedToMe: tasks.filter((task) => task.assigned_to === profile.id),
      createdByMe: tasks.filter((task) => task.created_by === profile.id),
      allTasks: tasks,
    }
  }

  const { data: assignedToMe, error: assignedError } = await supabase
    .from('tasks')
    .select(baseSelect)
    .eq('assigned_to', profile.id)
    .order('created_at', { ascending: false })

  if (assignedError) {
    throw new Error('Nepodařilo se načíst přiřazené úkoly.')
  }

  const { data: createdByMe, error: createdError } = await supabase
    .from('tasks')
    .select(baseSelect)
    .eq('created_by', profile.id)
    .order('created_at', { ascending: false })

  if (createdError) {
    throw new Error('Nepodařilo se načíst zadané úkoly.')
  }

  const assignedTasks = (assignedToMe ?? []) as TaskRow[]
  const createdTasks = (createdByMe ?? []) as TaskRow[]

  return {
    profile,
    assignedToMe: assignedTasks,
    createdByMe: createdTasks,
    allTasks: [],
  }
}
