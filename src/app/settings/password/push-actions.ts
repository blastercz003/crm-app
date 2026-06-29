'use server'

import { sendPushNotificationToUser } from '@/lib/notifications/sendPushNotification'
import { createNotification } from '@/lib/notifications/createNotification'
import { createClient } from '@/lib/supabase/server'

type PushSubscriptionPayload = {
  endpoint?: unknown
  expirationTime?: unknown
  keys?: {
    p256dh?: unknown
    auth?: unknown
  }
}

function parseExpirationTime(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function savePushSubscription(subscription: PushSubscriptionPayload) {
  const endpoint = typeof subscription.endpoint === 'string' ? subscription.endpoint : ''
  const p256dh =
    typeof subscription.keys?.p256dh === 'string' ? subscription.keys.p256dh : ''
  const auth = typeof subscription.keys?.auth === 'string' ? subscription.keys.auth : ''

  if (!endpoint || !p256dh || !auth) {
    return {
      success: false,
      error: 'Subscription data nejsou kompletní.',
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      success: false,
      error: 'Pro zapnutí notifikací musíš být přihlášený.',
    }
  }

  const now = new Date().toISOString()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      expiration_time: parseExpirationTime(subscription.expirationTime),
      updated_at: now,
      last_seen_at: now,
    },
    {
      onConflict: 'endpoint',
    }
  )

  if (error) {
    return {
      success: false,
      error: `Subscription se nepodařilo uložit: ${error.message}`,
    }
  }

  return {
    success: true,
  }
}

export async function checkPushSubscriptionStatus(endpoint: string) {
  if (!endpoint) {
    return {
      success: false,
      error: 'Chybí endpoint zařízení.',
      status: 'missing' as const,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      success: false,
      error: 'Pro kontrolu notifikací musíš být přihlášený.',
      status: 'missing' as const,
    }
  }

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, updated_at, last_seen_at')
    .eq('user_id', user.id)
    .eq('endpoint', endpoint)
    .maybeSingle()

  if (error) {
    return {
      success: false,
      error: `Subscription se nepodařilo ověřit: ${error.message}`,
      status: 'missing' as const,
    }
  }

  return {
    success: true,
    status: data ? ('found' as const) : ('missing' as const),
    updatedAt: data?.updated_at ?? null,
    lastSeenAt: data?.last_seen_at ?? null,
  }
}

export async function deletePushSubscription(endpoint: string) {
  if (!endpoint) {
    return {
      success: false,
      error: 'Chybí endpoint zařízení.',
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      success: false,
      error: 'Pro odebrání notifikací musíš být přihlášený.',
    }
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint)

  if (error) {
    return {
      success: false,
      error: `Subscription se nepodařilo odebrat: ${error.message}`,
    }
  }

  return {
    success: true,
  }
}

export async function sendTestPushNotification() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      success: false,
      error: 'Pro test notifikací musíš být přihlášený.',
    }
  }

  const result = await sendPushNotificationToUser({
    recipientUserId: user.id,
    title: 'B-ENERGY',
    message: 'Testovací push notifikace dorazila.',
    href: '/settings/password',
  })

  if (!result.success) {
    return {
      success: false,
      error: 'Testovací notifikaci se nepodařilo odeslat.',
    }
  }

  if (result.sentCount === 0) {
    return {
      success: false,
      error: 'Pro tento účet není uložené žádné zařízení.',
    }
  }

  return {
    success: true,
    sentCount: result.sentCount,
  }
}

export async function createTestCrmNotification() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      success: false,
      error: 'Pro vytvoření testovací CRM notifikace musíš být přihlášený.',
    }
  }

  await createNotification({
    supabase,
    recipientUserId: user.id,
    actorUserId: user.id,
    category: 'system',
    type: 'push_test',
    title: 'Test CRM notifikace',
    message: 'Interní CRM notifikace vytvořená z testovací stránky.',
    href: '/notifications',
    priority: 'normal',
    skipSelfNotification: false,
  })

  return {
    success: true,
  }
}
