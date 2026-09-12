import 'server-only'

import type { WebhookEventPayload } from 'resend'
import { getServiceRoleClient } from '@/lib/supabase/service'

export async function recordCompleteNotificationLiveWebhook(providerEventId: string, event: WebhookEventPayload) {
  if (!('email_id' in event.data)) return { ignored: true }
  const service = getServiceRoleClient()
  if (!service) throw new Error('Chybí serverové připojení pro LIVE webhook KOMPLETNÍ.')
  const { data, error } = await service.rpc('record_cpo_notification_email_live_resend_event_v1', {
    requested_provider_event_id: providerEventId,
    requested_provider_message_id: event.data.email_id,
    requested_event_kind: event.type,
    requested_payload: event,
  })
  if (error) throw new Error(`LIVE webhook KOMPLETNÍ se nepodařilo uložit: ${error.message}`)
  return data
}
