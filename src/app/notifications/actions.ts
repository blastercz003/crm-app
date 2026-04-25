'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'

async function touchNotification(
  notificationId: string,
  values: {
    read_at?: string | null
    archived_at?: string | null
  }
) {
  const supabase = await createClient()
  const profile = await getCurrentProfile()

  const { error } = await supabase
    .from('notifications')
    .update(values)
    .eq('id', notificationId)
    .eq('recipient_user_id', profile.id)

  if (error) {
    throw new Error(`Nepodařilo se upravit notifikaci: ${error.message}`)
  }

  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function markNotificationRead(notificationId: string) {
  await touchNotification(notificationId, {
    read_at: new Date().toISOString(),
  })
}

export async function openNotification(notificationId: string, href: string) {
  await markNotificationRead(notificationId)
  redirect(href)
}

export async function archiveNotification(notificationId: string) {
  const now = new Date().toISOString()

  await touchNotification(notificationId, {
    read_at: now,
    archived_at: now,
  })
}

export async function markAllNotificationsRead() {
  const supabase = await createClient()
  const profile = await getCurrentProfile()

  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_user_id', profile.id)
    .is('read_at', null)
    .is('archived_at', null)

  if (error) {
    throw new Error(`Nepodařilo se označit notifikace jako přečtené: ${error.message}`)
  }

  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function archiveAllReadNotifications() {
  const supabase = await createClient()
  const profile = await getCurrentProfile()

  const { error } = await supabase
    .from('notifications')
    .update({ archived_at: new Date().toISOString() })
    .eq('recipient_user_id', profile.id)
    .not('read_at', 'is', null)
    .is('archived_at', null)

  if (error) {
    throw new Error(`Nepodařilo se archivovat notifikace: ${error.message}`)
  }

  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function deleteNotificationAsAdmin(notificationId: string) {
  const supabase = await createClient()
  const profile = await getCurrentProfile()

  if (profile.role !== 'admin') {
    throw new Error('Mazat notifikace může jen admin.')
  }

  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', notificationId)

  if (error) {
    throw new Error(`Nepodařilo se smazat notifikaci: ${error.message}`)
  }

  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}
