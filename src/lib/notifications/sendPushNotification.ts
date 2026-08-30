import webpush, { WebPushError } from 'web-push'
import { createClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase/service'

type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
}

type SendPushNotificationInput = {
  recipientUserId: string
  title: string
  message?: string | null
  href?: string | null
}

export type PushNotificationDeliveryResult = {
  success: boolean
  subscriptionCount: number
  sentCount: number
  failedCount: number
  removedSubscriptionCount: number
  reason?: string
}

type PushSupabaseClient =
  | Awaited<ReturnType<typeof createClient>>
  | NonNullable<ReturnType<typeof getServiceRoleClient>>

function getPushConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) return null

  return { publicKey, privateKey, subject }
}

function shouldDeleteSubscription(error: unknown) {
  if (error instanceof WebPushError) {
    return error.statusCode === 404 || error.statusCode === 410
  }

  return false
}

async function getUnreadNotificationCount(
  supabase: PushSupabaseClient,
  recipientUserId: string
) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_user_id', recipientUserId)
    .is('read_at', null)
    .is('archived_at', null)

  if (error) return null

  return count ?? 0
}

export async function sendPushNotificationToUser(
  input: SendPushNotificationInput,
): Promise<PushNotificationDeliveryResult> {
  const config = getPushConfig()

  if (!config) {
    return {
      success: false,
      subscriptionCount: 0,
      sentCount: 0,
      failedCount: 0,
      removedSubscriptionCount: 0,
      reason: 'missing-push-config',
    }
  }

  const serviceClient = getServiceRoleClient()
  const supabase = serviceClient ?? (await createClient())

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', input.recipientUserId)

  if (error) {
    return {
      success: false,
      subscriptionCount: 0,
      sentCount: 0,
      failedCount: 0,
      removedSubscriptionCount: 0,
      reason: error.message,
    }
  }

  const rows = (subscriptions ?? []) as PushSubscriptionRow[]

  if (rows.length === 0) {
    return {
      success: true,
      subscriptionCount: 0,
      sentCount: 0,
      failedCount: 0,
      removedSubscriptionCount: 0,
    }
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)

  const badgeCount = await getUnreadNotificationCount(supabase, input.recipientUserId)

  const payload = JSON.stringify({
    title: input.title,
    body: input.message ?? '',
    url: input.href ?? '/',
    badgeCount,
  })

  const results = await Promise.allSettled(
    rows.map((subscription) =>
      webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload
      )
    )
  )

  const expiredEndpoints = results
    .map((result, index) =>
      result.status === 'rejected' && shouldDeleteSubscription(result.reason)
        ? rows[index]?.endpoint
        : null
    )
    .filter((endpoint): endpoint is string => Boolean(endpoint))

  if (expiredEndpoints.length > 0) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', input.recipientUserId)
      .in('endpoint', expiredEndpoints)
  }

  const sentCount = results.filter((result) => result.status === 'fulfilled').length
  const failedCount = results.length - sentCount

  return {
    success: failedCount === 0,
    subscriptionCount: rows.length,
    sentCount,
    failedCount,
    removedSubscriptionCount: expiredEndpoints.length,
    reason: failedCount > 0 ? 'push-delivery-failed' : undefined,
  }
}
