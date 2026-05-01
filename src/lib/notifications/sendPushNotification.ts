import { createClient as createSupabaseServiceClient } from '@supabase/supabase-js'
import webpush, { WebPushError } from 'web-push'
import { createClient } from '@/lib/supabase/server'

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

function getPushConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) return null

  return { publicKey, privateKey, subject }
}

function getServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) return null

  return createSupabaseServiceClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function shouldDeleteSubscription(error: unknown) {
  if (error instanceof WebPushError) {
    return error.statusCode === 404 || error.statusCode === 410
  }

  return false
}

export async function sendPushNotificationToUser(input: SendPushNotificationInput) {
  const config = getPushConfig()

  if (!config) return { success: false, reason: 'missing-push-config' }

  const serviceClient = getServiceRoleClient()
  const supabase = serviceClient ?? (await createClient())

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', input.recipientUserId)

  if (error) {
    return { success: false, reason: error.message }
  }

  const rows = (subscriptions ?? []) as PushSubscriptionRow[]

  if (rows.length === 0) {
    return { success: true, sentCount: 0 }
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)

  const payload = JSON.stringify({
    title: input.title,
    body: input.message ?? '',
    url: input.href ?? '/',
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

  return {
    success: true,
    sentCount: results.filter((result) => result.status === 'fulfilled').length,
  }
}
