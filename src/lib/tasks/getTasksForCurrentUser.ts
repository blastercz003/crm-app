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
  company_name: string | null
  contact_person: string | null
  comment_count: number
  creator: TaskPerson | TaskPerson[] | null
  assignee: TaskPerson | TaskPerson[] | null
  client: TaskClient | TaskClient[] | null
}

function attachCommentCounts(tasks: TaskRow[], commentEntityIds: string[]) {
  const commentCountByTaskId = new Map<string, number>()

  for (const entityId of commentEntityIds) {
    commentCountByTaskId.set(
      entityId,
      (commentCountByTaskId.get(entityId) ?? 0) + 1
    )
  }

  return tasks.map((task) => ({
    ...task,
    comment_count: commentCountByTaskId.get(task.id) ?? 0,
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
    created_by,
    assigned_to,
    created_at,
    client_id,
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

    const tasks = ((data ?? []) as Omit<TaskRow, 'comment_count'>[]).map((task) => ({
      ...task,
      comment_count: 0,
    }))

    const taskIds = tasks.map((task) => task.id)

    const { data: comments, error: commentsError } = taskIds.length
      ? await supabase
          .from('comments')
          .select('entity_id')
          .eq('entity_type', 'task')
          .in('entity_id', taskIds)
      : { data: [], error: null }

    if (commentsError) {
      throw new Error('Nepodařilo se načíst počty komentářů k úkolům.')
    }

    const commentEntityIds = (comments ?? []).map((row) => row.entity_id as string)
    const tasksWithComments = attachCommentCounts(tasks, commentEntityIds)

    return {
      profile,
      assignedToMe: tasksWithComments.filter(
        (task) => task.assigned_to === profile.id
      ),
      createdByMe: tasksWithComments.filter(
        (task) => task.created_by === profile.id
      ),
      allTasks: tasksWithComments,
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

  const assignedTasks = ((assignedToMe ?? []) as Omit<TaskRow, 'comment_count'>[]).map(
    (task) => ({
      ...task,
      comment_count: 0,
    })
  )

  const createdTasks = ((createdByMe ?? []) as Omit<TaskRow, 'comment_count'>[]).map(
    (task) => ({
      ...task,
      comment_count: 0,
    })
  )

  const uniqueTaskIds = Array.from(
    new Set([
      ...assignedTasks.map((task) => task.id),
      ...createdTasks.map((task) => task.id),
    ])
  )

  const { data: comments, error: commentsError } = uniqueTaskIds.length
    ? await supabase
        .from('comments')
        .select('entity_id')
        .eq('entity_type', 'task')
        .in('entity_id', uniqueTaskIds)
    : { data: [], error: null }

  if (commentsError) {
    throw new Error('Nepodařilo se načíst počty komentářů k úkolům.')
  }

  const commentEntityIds = (comments ?? []).map((row) => row.entity_id as string)

  return {
    profile,
    assignedToMe: attachCommentCounts(assignedTasks, commentEntityIds),
    createdByMe: attachCommentCounts(createdTasks, commentEntityIds),
    allTasks: [],
  }
}