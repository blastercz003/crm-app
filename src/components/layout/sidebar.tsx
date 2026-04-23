import { createClient } from '@/lib/supabase/server'
import { SidebarClient } from './sidebar-client'

export async function Sidebar() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, role, can_view_jobs, can_view_jobs_portal')
    .eq('id', user.id)
    .single()

  return <SidebarClient profile={profile} />
}
