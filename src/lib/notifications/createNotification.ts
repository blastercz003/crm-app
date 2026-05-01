import { createClient } from '@/lib/supabase/server'
import { sendPushNotificationToUser } from './sendPushNotification'
import type { NotificationCategory, NotificationPriority } from './types'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type CreateNotificationInput = {
  supabase?: SupabaseClient
  recipientUserId: string | null | undefined
  actorUserId?: string | null
  category: NotificationCategory
  type: string
  title: string
  message?: string | null
  entityType?: string | null
  entityId?: string | null
  href?: string | null
  priority?: NotificationPriority
  dedupeKey?: string | null
  skipSelfNotification?: boolean
}

export async function createNotification(input: CreateNotificationInput) {
  const recipientUserId = input.recipientUserId ?? null
  const actorUserId = input.actorUserId ?? null

  if (!recipientUserId) return null

  if (input.skipSelfNotification !== false && actorUserId === recipientUserId) {
    return null
  }

  const supabase = input.supabase ?? (await createClient())

  const { error } = await supabase
    .from('notifications')
    .insert({
      recipient_user_id: recipientUserId,
      actor_user_id: actorUserId,
      category: input.category,
      type: input.type,
      title: input.title,
      message: input.message ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      href: input.href ?? null,
      priority: input.priority ?? 'normal',
      dedupe_key: input.dedupeKey ?? null,
    })

  if (error) {
    const message = error.message.toLowerCase()

    if (
      input.dedupeKey &&
      (message.includes('duplicate') || message.includes('unique'))
    ) {
      return null
    }

    throw new Error(`Nepodařilo se vytvořit notifikaci: ${error.message}`)
  }

  try {
    await sendPushNotificationToUser({
      recipientUserId,
      title: input.title,
      message: input.message,
      href: input.href,
    })
  } catch (pushError) {
    console.error('Nepodařilo se odeslat push notifikaci.', pushError)
  }

  return { success: true }
}

export async function getAdminProfileIds(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin')

  if (error) {
    throw new Error(`Nepodařilo se načíst administrátory: ${error.message}`)
  }

  return (data ?? []).map((profile) => profile.id as string)
}

export async function createNotificationsForAdmins(input: Omit<
  CreateNotificationInput,
  'recipientUserId'
> & {
  supabase: SupabaseClient
}) {
  const adminIds = await getAdminProfileIds(input.supabase)

  await Promise.all(
    adminIds.map((adminId) =>
      createNotification({
        ...input,
        recipientUserId: adminId,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${adminId}` : null,
      })
    )
  )
}
