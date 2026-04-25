import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { OfferProfile } from './types'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export async function getOfferRuntimeContext() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, name, role, can_view_offers')
    .eq('id', user.id)
    .single<OfferProfile>()

  if (error || !profile) {
    throw new Error('Nepodařilo se ověřit oprávnění k nabídkám.')
  }

  const isAdmin = profile.role === 'admin'

  if (!isAdmin && !profile.can_view_offers) {
    redirect('/dashboard')
  }

  return {
    supabase,
    user,
    profile,
    isAdmin,
  }
}

export async function getOfferApprover(params: {
  supabase: SupabaseClient
}) {
  const { supabase } = params
  const configuredApproverId = process.env.OFFER_APPROVER_USER_ID?.trim()

  if (configuredApproverId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, role')
      .eq('id', configuredApproverId)
      .single<{ id: string; name: string | null; role: string | null }>()

    if (error || !data) {
      throw new Error('Nastavený schvalovatel nabídek nebyl nalezen.')
    }

    return data
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, role')
    .eq('role', 'admin')
    .limit(1)
    .single<{ id: string; name: string | null; role: string | null }>()

  if (error || !data) {
    throw new Error('Nepodařilo se najít schvalovatele nabídek.')
  }

  return data
}
