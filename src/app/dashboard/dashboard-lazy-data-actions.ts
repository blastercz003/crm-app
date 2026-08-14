'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUserNotifications } from '@/lib/notifications/getNotifications'

export type DashboardQuickActionOptions = {
  users: Array<{
    id: string
    name: string | null
    role: string | null
    can_be_assigned_as_technician: boolean | null
  }>
  clients: Array<{ id: string; name: string }>
  contacts: Array<{
    id: string
    client_id: string
    name: string
    phone: string | null
    email: string | null
    is_primary: boolean
  }>
  offers: Array<{
    id: string
    client_id: string
    offer_number: string
    title: string
    realization_starts_at: string | null
    realization_ends_at: string | null
    realization_address: string | null
  }>
}

export async function getDashboardNotificationsAction() {
  return getCurrentUserNotifications({ status: 'active', limit: 30 })
}

export async function getDashboardQuickActionOptionsAction(): Promise<DashboardQuickActionOptions> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Uživatel není přihlášen.')
  }

  const [usersResponse, clientsResponse, contactsResponse, offersResponse] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, role, can_be_assigned_as_technician')
      .order('name', { ascending: true }),
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, phone, email, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('offers')
      .select(
        'id, client_id, offer_number, title, realization_starts_at, realization_ends_at, realization_address, offer_type, status'
      )
      .eq('offer_type', 'classic')
      .neq('status', 'realizace')
      .order('offer_number', { ascending: false }),
  ])

  const firstError = [
    usersResponse.error,
    clientsResponse.error,
    contactsResponse.error,
    offersResponse.error,
  ].find(Boolean)

  if (firstError) {
    throw new Error(`Nepodařilo se načíst data rychlých akcí: ${firstError.message}`)
  }

  return {
    users: usersResponse.data ?? [],
    clients: clientsResponse.data ?? [],
    contacts: contactsResponse.data ?? [],
    offers: (offersResponse.data ?? [])
      .filter(
        (item) =>
          Boolean(String(item.id ?? '').trim()) &&
          Boolean(String(item.client_id ?? '').trim()) &&
          Boolean(String(item.offer_number ?? '').trim()) &&
          Boolean(String(item.title ?? '').trim())
      )
      .map((item) => ({
        id: String(item.id).trim(),
        client_id: String(item.client_id).trim(),
        offer_number: String(item.offer_number).trim(),
        title: String(item.title).trim(),
        realization_starts_at: item.realization_starts_at ?? null,
        realization_ends_at: item.realization_ends_at ?? null,
        realization_address: item.realization_address ?? null,
      })),
  }
}
