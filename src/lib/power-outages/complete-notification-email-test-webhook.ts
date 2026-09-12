import 'server-only'

import { Resend, type WebhookEventPayload } from 'resend'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { getCompleteNotificationResendConfiguration } from './complete-notification-email-resend-config'

const SUPPORTED_EVENTS = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
])

export function verifyCompleteNotificationTestWebhook(input: {
  payload: string
  id: string
  timestamp: string
  signature: string
}): WebhookEventPayload {
  const configuration = getCompleteNotificationResendConfiguration()
  if (!configuration.webhookSecretConfigured) {
    throw new Error('Chybí samostatný COMPLETE_RESEND_WEBHOOK_SECRET.')
  }
  const resend = new Resend(configuration.apiKey)
  return resend.webhooks.verify({
    payload: input.payload,
    headers: { id: input.id, timestamp: input.timestamp, signature: input.signature },
    webhookSecret: configuration.webhookSecret,
  })
}

export async function recordCompleteNotificationTestWebhook(
  providerEventId: string,
  event: WebhookEventPayload,
) {
  if (!SUPPORTED_EVENTS.has(event.type) || !('email_id' in event.data)) {
    return { ignored: true, duplicate: false }
  }
  const service = getServiceRoleClient()
  if (!service) throw new Error('Chybí serverové připojení pro Resend TEST webhook KOMPLETNI.')
  const { data, error } = await service.rpc(
    'record_cpo_notification_email_test_event_v1',
    {
      requested_provider_event_id: providerEventId,
      requested_provider_message_id: event.data.email_id,
      requested_event_kind: event.type,
      requested_payload: event,
    },
  )
  if (error) throw new Error(`Resend TEST webhook KOMPLETNI se nepodařilo uložit: ${error.message}`)
  return data
}
