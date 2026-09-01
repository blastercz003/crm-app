import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { sendPushNotificationToUser } from './sendPushNotification'
import type { PushNotificationDeliveryResult } from './sendPushNotification'
import type { NotificationCategory, NotificationPriority } from './types'

type SupabaseClient =
  | Awaited<ReturnType<typeof createClient>>
  | NonNullable<ReturnType<typeof getServiceRoleClient>>

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
  returnExistingOnDuplicate?: boolean
}

export async function createNotification(input: CreateNotificationInput) {
  const recipientUserId = input.recipientUserId ?? null
  const actorUserId = input.actorUserId ?? null

  if (!recipientUserId) return null

  if (input.skipSelfNotification !== false && actorUserId === recipientUserId) {
    return null
  }

  // Notification creation is a server-side operation. Always prefer the
  // service-role client so a legitimate cross-user notification does not
  // depend on the actor's RLS permissions. Browser clients never receive the
  // service key and cannot call this module directly.
  const supabase = getServiceRoleClient() ?? input.supabase ?? (await createClient())

  const { data: createdNotification, error } = await supabase
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
    .select('id')
    .single<{ id: string }>()

  if (error) {
    const message = error.message.toLowerCase()

    if (
      input.dedupeKey &&
      (message.includes('duplicate') || message.includes('unique'))
    ) {
      if (!input.returnExistingOnDuplicate) return null

      const { data: existingNotification } = await supabase
        .from('notifications')
        .select('id')
        .eq('dedupe_key', input.dedupeKey)
        .maybeSingle<{ id: string }>()

      return existingNotification
        ? { success: true as const, id: existingNotification.id, deduplicated: true }
        : null
    }

    throw new Error(`Nepodařilo se vytvořit notifikaci: ${error.message}`)
  }

  let pushDelivery: PushNotificationDeliveryResult
  try {
    pushDelivery = await sendPushNotificationToUser({
      recipientUserId,
      title: input.title,
      message: input.message,
      href: input.href,
    })
  } catch (pushError) {
    console.error('Nepodařilo se odeslat push notifikaci.', pushError)
    pushDelivery = {
      success: false,
      subscriptionCount: 0,
      sentCount: 0,
      failedCount: 0,
      removedSubscriptionCount: 0,
      reason: pushError instanceof Error ? pushError.message : 'unexpected-push-error',
    }
  }

  return {
    success: true as const,
    id: createdNotification.id,
    deduplicated: false,
    pushDelivery,
  }
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
