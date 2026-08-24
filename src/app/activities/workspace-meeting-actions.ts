'use server'

import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import { createClient } from '@/lib/supabase/server'
import type {
  ActivityWorkspaceMeetingDetail,
  ActivityWorkspaceMeetingDetailResult,
} from '@/lib/activities/workspace-types'

type RelatedProfile = { id: string; name: string | null }
type RelatedClient = { id: string; name: string | null }

type WorkspaceMeetingDetailRow = {
  id: string
  client_id: string | null
  client_contact_id: string | null
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
  status: string | null
  created_at: string | null
  updated_at: string | null
  assigned_user_id: string | null
  created_by: string | null
  creator: RelatedProfile | RelatedProfile[] | null
  assignee: RelatedProfile | RelatedProfile[] | null
  client: RelatedClient | RelatedClient[] | null
}

function relationName(
  relation: RelatedProfile | RelatedProfile[] | RelatedClient | RelatedClient[] | null,
  fallback: string,
) {
  if (!relation) return fallback
  const item = Array.isArray(relation) ? relation[0] : relation
  return item?.name?.trim() || fallback
}

export async function getWorkspaceMeetingDetailAction(
  meetingId: string,
): Promise<ActivityWorkspaceMeetingDetailResult> {
  try {
    const normalizedMeetingId = meetingId.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedMeetingId)) {
      throw new Error('Schůzka nebyla nalezena.')
    }

    const [supabase, currentProfile] = await Promise.all([
      createClient(),
      getCurrentProfile(),
    ])
    const { data, error } = await supabase
      .from('meetings')
      .select(`
        id,
        client_id,
        client_contact_id,
        company_name,
        contact_person,
        contact_phone,
        contact_email,
        address,
        title,
        meeting_datetime,
        pre_meeting_note,
        result_note,
        follow_up_task,
        follow_up_task_note,
        follow_up_task_priority,
        follow_up_task_due_date,
        status,
        created_at,
        updated_at,
        assigned_user_id,
        created_by,
        creator:created_by (id, name),
        assignee:assigned_user_id (id, name),
        client:client_id (id, name)
      `)
      .eq('id', normalizedMeetingId)
      .single<WorkspaceMeetingDetailRow>()

    if (error || !data) throw new Error('Schůzka nebyla nalezena.')

    const canView = currentProfile.role === 'admin'
      || data.assigned_user_id === currentProfile.id
      || data.created_by === currentProfile.id
    if (!canView) throw new Error('Na zobrazení této schůzky nemáte oprávnění.')

    const meeting: ActivityWorkspaceMeetingDetail = {
      id: data.id,
      title: data.title,
      status: data.status,
      meetingDateTime: data.meeting_datetime,
      clientId: data.client_id,
      clientContactId: data.client_contact_id,
      clientName: relationName(data.client, data.company_name ?? 'Bez klienta'),
      companyName: data.company_name,
      contactPerson: data.contact_person,
      contactPhone: data.contact_phone,
      contactEmail: data.contact_email,
      address: data.address,
      preMeetingNote: data.pre_meeting_note,
      resultNote: data.result_note,
      followUpTask: data.follow_up_task,
      followUpTaskNote: data.follow_up_task_note,
      followUpTaskPriority: data.follow_up_task_priority,
      followUpTaskDueDate: data.follow_up_task_due_date,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      createdBy: data.created_by,
      creatorName: relationName(data.creator, 'Neznámý uživatel'),
      assignedUserId: data.assigned_user_id,
      assignedUserName: relationName(data.assignee, 'Nepřiřazeno'),
    }

    return { success: true, error: null, meeting }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Detail schůzky se nepodařilo načíst.',
      meeting: null,
    }
  }
}
