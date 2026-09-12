import 'server-only'

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Resend, type ErrorResponse } from 'resend'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { getCompleteNotificationResendConfiguration } from './complete-notification-email-resend-config'
import { buildCompleteNotificationUnsubscribeUrl, COMPLETE_NOTIFICATION_EMAIL_LOGO_CONTENT_ID, renderCompleteNotificationEmail } from './complete-notification-email-template'

type LiveDelivery = {
  planId: string
  recipient: string
  companyName: string
  startsAt: string
  endsAt: string
  addresses: unknown[]
  source: string
  municipality: string | null
  announcementUrl: string | null
  sourceUrl: string | null
  unsubscribeToken: string
}
type LiveClaim = { status: string; slotId?: string; claimToken?: string; delivery?: LiveDelivery }

const RETRYABLE_ERRORS = new Set(['rate_limit_exceeded', 'internal_server_error', 'application_error', 'concurrent_idempotent_requests'])
let logoPromise: Promise<Buffer> | null = null
function logo() { logoPromise ??= readFile(path.join(process.cwd(), 'public', 'logo2.png')); return logoPromise }
function cleanHeader(value: string) { return value.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim() }
function retryable(error: ErrorResponse) { return (error.statusCode !== null && (error.statusCode === 429 || error.statusCode >= 500)) || RETRYABLE_ERRORS.has(error.name) }

async function recordSafety(input: { signal: 'transient_error' | 'configuration_error'; planId?: string; providerMessageId?: string; code: string; message: string }) {
  const service = getServiceRoleClient()
  if (!service) return
  await service.rpc('record_cpo_notification_email_pilot_safety_event_v1', {
    requested_source: 'complete_worker', requested_external_event_id: randomUUID(),
    requested_signal_type: input.signal, requested_plan_id: input.planId ?? null,
    requested_provider_message_id: input.providerMessageId ?? null,
    requested_error_code: input.code, requested_error_message: input.message,
    requested_payload: { contract: 'complete-notification-email-live-pilot-v1' },
  })
}

export async function sendOneCompleteNotificationPilot(publicBaseUrl: string) {
  const configuration = getCompleteNotificationResendConfiguration()
  if (!configuration.liveReady) {
    await recordSafety({ signal: 'configuration_error', code: 'COMPLETE_RESEND_CONFIGURATION', message: configuration.issues.join(' ') })
    throw new Error(`Resend LIVE KOMPLETNÍ není připraven: ${configuration.issues.join(' ')}`)
  }
  const service = getServiceRoleClient()
  if (!service) throw new Error('Chybí serverové připojení pro LIVE pilot KOMPLETNÍ.')
  const { data, error } = await service.rpc('claim_cpo_notification_email_live_pilot_v1')
  if (error) throw new Error(`LIVE pilotní zprávu se nepodařilo převzít: ${error.message}`)
  const claim = data as LiveClaim
  if (claim.status !== 'claimed' || !claim.slotId || !claim.claimToken || !claim.delivery) {
    return { ok: true as const, status: claim.status, sentCount: 0 }
  }

  const delivery = claim.delivery
  const resend = new Resend(configuration.apiKey)
  let providerMessageId: string | undefined
  let failureRecorded = false
  try {
    const unsubscribeUrl = buildCompleteNotificationUnsubscribeUrl(publicBaseUrl, delivery.unsubscribeToken)
    const template = renderCompleteNotificationEmail({ ...delivery, unsubscribeUrl, testMode: false })
    const response = await resend.emails.send({
      from: `${cleanHeader(configuration.fromName)} <${configuration.fromEmail}>`,
      to: [delivery.recipient],
      replyTo: configuration.replyToEmail ?? undefined,
      subject: template.subject,
      html: template.html,
      text: template.text,
      attachments: [{ filename: 'b-energy-logo.png', content: await logo(), contentId: COMPLETE_NOTIFICATION_EMAIL_LOGO_CONTENT_ID }],
      tags: [
        { name: 'category', value: 'complete_outage_pilot' },
        { name: 'plan_id', value: delivery.planId },
        { name: 'template', value: template.templateVersion },
      ],
    }, { idempotencyKey: `complete-outage-pilot-${delivery.planId}` })
    if (response.error) {
      const isRetryable = retryable(response.error)
      await service.rpc('finish_cpo_notification_email_pilot_slot_v1', {
        requested_slot_id: claim.slotId, requested_claim_token: claim.claimToken,
        requested_outcome: 'released', requested_provider_message_id: null,
        requested_reason_code: response.error.name,
      })
      await recordSafety({ signal: isRetryable ? 'transient_error' : 'configuration_error', planId: delivery.planId, code: response.error.name, message: response.error.message })
      failureRecorded = true
      throw new Error(response.error.message)
    }
    providerMessageId = response.data.id
    const { error: finishError } = await service.rpc('finish_cpo_notification_email_pilot_slot_v1', {
      requested_slot_id: claim.slotId, requested_claim_token: claim.claimToken,
      requested_outcome: 'sent', requested_provider_message_id: providerMessageId,
      requested_reason_code: 'provider_accepted',
    })
    if (finishError) {
      await recordSafety({ signal: 'configuration_error', planId: delivery.planId, providerMessageId, code: 'COMPLETE_PILOT_PERSISTENCE', message: finishError.message })
      throw new Error(`Odeslanou zprávu se nepodařilo bezpečně evidovat: ${finishError.message}`)
    }
    return { ok: true as const, status: 'sent' as const, sentCount: 1, companyName: delivery.companyName }
  } catch (error) {
    if (!providerMessageId && !failureRecorded) {
      const message = error instanceof Error ? error.message : 'LIVE odeslání KOMPLETNÍ selhalo.'
      try {
        await service.rpc('finish_cpo_notification_email_pilot_slot_v1', {
          requested_slot_id: claim.slotId, requested_claim_token: claim.claimToken,
          requested_outcome: 'released', requested_provider_message_id: null,
          requested_reason_code: 'worker_error',
        })
      } catch {
        // Expirace rezervace zajisti, ze ani chyba pri uvolneni frontu trvale nezablokuje.
      }
      await recordSafety({ signal: 'transient_error', planId: delivery.planId, code: 'COMPLETE_PILOT_WORKER', message })
    }
    throw error
  }
}
