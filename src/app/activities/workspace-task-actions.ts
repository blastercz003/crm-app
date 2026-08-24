'use server'

import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import { createClient } from '@/lib/supabase/server'
import type {
  ActivityWorkspaceTaskDetail,
  ActivityWorkspaceTaskDetailResult,
} from '@/lib/activities/workspace-types'

type RelatedPerson = { id: string; name: string | null }
type RelatedClient = { id: string; name: string | null }

type WorkspaceTaskDetailRow = {
  id: string
  title: string
  note: string | null
  status: string | null
  priority: string | null
  due_date: string | null
  repeat_interval: string | null
  created_at: string | null
  created_by: string | null
  assigned_to: string | null
  client_id: string | null
  client_contact_id: string | null
  company_name: string | null
  contact_person: string | null
  creator: RelatedPerson | RelatedPerson[] | null
  assignee: RelatedPerson | RelatedPerson[] | null
  client: RelatedClient | RelatedClient[] | null
}

function relatedName(
  relation: RelatedPerson | RelatedPerson[] | null,
  fallback: string,
) {
  if (!relation) return fallback
  const item = Array.isArray(relation) ? relation[0] : relation
  return item?.name?.trim() || fallback
}

function clientName(
  relation: RelatedClient | RelatedClient[] | null,
  fallback: string,
) {
  if (!relation) return fallback
  const item = Array.isArray(relation) ? relation[0] : relation
  return item?.name?.trim() || fallback
}

export async function getWorkspaceTaskDetailAction(
  taskId: string,
): Promise<ActivityWorkspaceTaskDetailResult> {
  try {
    const normalizedTaskId = taskId.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedTaskId)) {
      throw new Error('Úkol nebyl nalezen.')
    }

    const [supabase, currentProfile] = await Promise.all([
      createClient(),
      getCurrentProfile(),
    ])
    const { data, error } = await supabase
      .from('tasks')
      .select(`
        id,
        title,
        note,
        status,
        priority,
        due_date,
        repeat_interval,
        created_at,
        created_by,
        assigned_to,
        client_id,
        client_contact_id,
        company_name,
        contact_person,
        creator:created_by (id, name),
        assignee:assigned_to (id, name),
        client:client_id (id, name)
      `)
      .eq('id', normalizedTaskId)
      .single<WorkspaceTaskDetailRow>()

    if (error || !data) throw new Error('Úkol nebyl nalezen.')

    const canView = currentProfile.role === 'admin'
      || data.created_by === currentProfile.id
      || data.assigned_to === currentProfile.id
    if (!canView) throw new Error('Na zobrazení tohoto úkolu nemáte oprávnění.')

    const task: ActivityWorkspaceTaskDetail = {
      id: data.id,
      title: data.title,
      note: data.note,
      status: data.status,
      priority: data.priority,
      hasNotification: false,
      dueDate: data.due_date,
      repeatInterval: data.repeat_interval,
      createdAt: data.created_at,
      createdBy: data.created_by,
      creatorName: relatedName(data.creator, 'Neznámý uživatel'),
      assignedTo: data.assigned_to,
      assigneeName: relatedName(data.assignee, 'Nepřiřazeno'),
      clientId: data.client_id,
      clientContactId: data.client_contact_id,
      clientName: clientName(data.client, data.company_name ?? 'Bez klienta'),
      companyName: data.company_name,
      contactPerson: data.contact_person,
    }

    return { success: true, error: null, task }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Detail úkolu se nepodařilo načíst.',
      task: null,
    }
  }
}
