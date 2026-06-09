import { createClient } from '@/lib/supabase/server'

export type AssignableUser = {
  id: string
  name: string | null
  role: string | null
  can_be_assigned_as_technician: boolean | null
}

export async function getAssignableUsers(): Promise<AssignableUser[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role, can_be_assigned_as_technician')
    .order('name', { ascending: true })

  if (error) {
    throw new Error('Nepodařilo se načíst uživatele.')
  }

  return data ?? []
}
