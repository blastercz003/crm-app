import 'server-only'

import { Resend, type WebhookEventPayload } from 'resend'
import { getServiceRoleClient } from '@/lib/supabase/service'

const SUPPORTED_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
])

export function verifyMarketClientEmailWebhook(input: {
  payload: string
  id: string
  timestamp: string
  signature: string
}): WebhookEventPayload {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!webhookSecret) throw new Error('Chybí RESEND_WEBHOOK_SECRET.')
  const resend = new Resend(process.env.RESEND_API_KEY?.trim())
  return resend.webhooks.verify({
    payload: input.payload,
    headers: {
      id: input.id,
      timestamp: input.timestamp,
      signature: input.signature,
    },
    webhookSecret,
  })
}

export async function recordMarketClientEmailWebhook(
  providerEventId: string,
  event: WebhookEventPayload,
) {
  if (!SUPPORTED_EVENTS.has(event.type) || !('email_id' in event.data)) {
    return { ignored: true, duplicate: false }
  }

  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro Resend webhook.')
  const { data, error } = await client.rpc('record_power_outage_client_email_resend_event', {
    p_provider_event_id: providerEventId,
    p_provider_message_id: event.data.email_id,
    p_event_kind: event.type,
    p_payload: event,
  })
  if (error) throw new Error(`Webhookovou událost se nepodařilo uložit: ${error.message}`)
  const result = data && typeof data === 'object' && !Array.isArray(data)
    ? data as { duplicate?: boolean }
    : {}
  return { ignored: false, duplicate: result.duplicate === true }
}
