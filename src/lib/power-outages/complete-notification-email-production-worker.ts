import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Resend, type ErrorResponse } from 'resend'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { getCompleteNotificationResendConfiguration } from './complete-notification-email-resend-config'
import {
  buildCompleteNotificationUnsubscribeUrl,
  COMPLETE_NOTIFICATION_EMAIL_LOGO_CONTENT_ID,
  renderCompleteNotificationEmail,
} from './complete-notification-email-template'

type ProductionDelivery = {
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

type ProductionClaim = {
  status: string
  slotId?: string
  claimToken?: string
  delivery?: ProductionDelivery
}

const RETRYABLE_ERRORS = new Set([
  'rate_limit_exceeded', 'internal_server_error', 'application_error',
  'concurrent_idempotent_requests',
])
let logoPromise: Promise<Buffer> | null = null
function logo() {
  logoPromise ??= readFile(path.join(process.cwd(), 'public', 'logo2.png'))
  return logoPromise
}
function cleanHeader(value: string) {
  return value.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim()
}
function retryable(error: ErrorResponse) {
  return (error.statusCode !== null && (error.statusCode === 429 || error.statusCode >= 500))
    || RETRYABLE_ERRORS.has(error.name)
}

export async function sendOneCompleteNotificationProduction(publicBaseUrl: string) {
  const service = getServiceRoleClient()
  if (!service) throw new Error('Chybí serverové připojení pro produkční upozornění KOMPLETNÍ.')

  const { data, error } = await service.rpc('claim_cpo_notification_email_production_v1')
  if (error) throw new Error(`Produkční zprávu se nepodařilo převzít: ${error.message}`)
  const claim = data as ProductionClaim
  if (claim.status !== 'claimed' || !claim.slotId || !claim.claimToken || !claim.delivery) {
    return { ok: true as const, status: claim.status, sentCount: 0 }
  }

  const configuration = getCompleteNotificationResendConfiguration()
  if (!configuration.liveReady) {
    await service.rpc('finish_cpo_notification_email_production_slot_v1', {
      requested_slot_id: claim.slotId,
      requested_claim_token: claim.claimToken,
      requested_outcome: 'released',
      requested_provider_message_id: null,
      requested_reason_code: 'complete_resend_configuration',
    })
    throw new Error(`Resend LIVE KOMPLETNÍ není připraven: ${configuration.issues.join(' ')}`)
  }

  const delivery = claim.delivery
  const resend = new Resend(configuration.apiKey)
  let providerMessageId: string | undefined
  let slotReleased = false
  try {
    const unsubscribeUrl = buildCompleteNotificationUnsubscribeUrl(
      publicBaseUrl,
      delivery.unsubscribeToken,
    )
    const template = renderCompleteNotificationEmail({
      ...delivery,
      unsubscribeUrl,
      testMode: false,
    })
    const response = await resend.emails.send({
      from: `${cleanHeader(configuration.fromName)} <${configuration.fromEmail}>`,
      to: [delivery.recipient],
      replyTo: configuration.replyToEmail ?? undefined,
      subject: template.subject,
      html: template.html,
      text: template.text,
      attachments: [{
        filename: 'b-energy-logo.png',
        content: await logo(),
        contentId: COMPLETE_NOTIFICATION_EMAIL_LOGO_CONTENT_ID,
      }],
      tags: [
        { name: 'category', value: 'complete_outage_production' },
        { name: 'plan_id', value: delivery.planId },
        { name: 'template', value: template.templateVersion },
      ],
    }, { idempotencyKey: `complete-outage-production-${delivery.planId}` })

    if (response.error) {
      await service.rpc('finish_cpo_notification_email_production_slot_v1', {
        requested_slot_id: claim.slotId,
        requested_claim_token: claim.claimToken,
        requested_outcome: 'released',
        requested_provider_message_id: null,
        requested_reason_code: `${retryable(response.error) ? 'retryable' : 'terminal'}_${response.error.name}`,
      })
      slotReleased = true
      throw new Error(response.error.message)
    }

    providerMessageId = response.data.id
    const { error: finishError } = await service.rpc(
      'finish_cpo_notification_email_production_slot_v1',
      {
        requested_slot_id: claim.slotId,
        requested_claim_token: claim.claimToken,
        requested_outcome: 'sent',
        requested_provider_message_id: providerMessageId,
        requested_reason_code: 'provider_accepted',
      },
    )
    if (finishError) {
      throw new Error(`Odeslanou zprávu se nepodařilo bezpečně evidovat: ${finishError.message}`)
    }
    return {
      ok: true as const,
      status: 'sent' as const,
      sentCount: 1,
      companyName: delivery.companyName,
    }
  } catch (error) {
    if (!providerMessageId && !slotReleased) {
      try {
        await service.rpc('finish_cpo_notification_email_production_slot_v1', {
          requested_slot_id: claim.slotId,
          requested_claim_token: claim.claimToken,
          requested_outcome: 'released',
          requested_provider_message_id: null,
          requested_reason_code: 'worker_error',
        })
      } catch {
        // Expirace rezervace zabrani trvalemu zablokovani fronty.
      }
    }
    throw error
  }
}
