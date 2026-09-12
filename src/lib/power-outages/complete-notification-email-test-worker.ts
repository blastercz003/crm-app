import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Resend, type ErrorResponse } from 'resend'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { getCompleteNotificationResendConfiguration } from './complete-notification-email-resend-config'
import {
  COMPLETE_NOTIFICATION_EMAIL_LOGO_CONTENT_ID,
  renderCompleteNotificationEmail,
} from './complete-notification-email-template'

type ClaimedDelivery = {
  id: string
  subject: string
  text: string
  companyName: string
  startsAt: string
  endsAt: string
  addresses: unknown[]
  source: string
  municipality: string | null
  announcementUrl: string | null
  sourceUrl: string | null
  originalRecipient: string
  attemptCount: number
}

type Claim = {
  status: 'disabled' | 'empty' | 'claimed'
  leaseToken?: string
  delivery?: ClaimedDelivery | null
}

let bEnergyLogoPromise: Promise<Buffer> | null = null

function getBEnergyLogo() {
  bEnergyLogoPromise ??= readFile(path.join(process.cwd(), 'public', 'logo2.png'))
  return bEnergyLogoPromise
}

function errorDetails(error: unknown) {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return {
      code: typeof record.name === 'string' ? record.name : 'COMPLETE_RESEND_TEST_FAILED',
      message: typeof record.message === 'string' ? record.message : 'Resend TEST selhal.',
    }
  }
  return { code: 'COMPLETE_RESEND_TEST_FAILED', message: 'Resend TEST selhal.' }
}

function resendErrorDetails(error: ErrorResponse) {
  return { code: error.name, message: error.message }
}

export async function sendOneCompleteNotificationTest(planId?: string) {
  const configuration = getCompleteNotificationResendConfiguration()
  if (!configuration.testReady) {
    throw new Error(`Resend TEST KOMPLETNI není připraven: ${configuration.issues.join(' ')}`)
  }
  const service = getServiceRoleClient()
  if (!service) throw new Error('Chybí serverové připojení pro Resend TEST KOMPLETNI.')

  const { data: prepared, error: prepareError } = await service.rpc(
    'prepare_complete_power_outage_notification_email_test_v1',
    { requested_plan_id: planId ?? null },
  )
  if (prepareError) throw new Error(`TEST zprávu se nepodařilo připravit: ${prepareError.message}`)

  const { data, error: claimError } = await service.rpc(
    'claim_cpo_notification_email_test_v2',
  )
  if (claimError) throw new Error(`TEST zprávu se nepodařilo převzít: ${claimError.message}`)
  const claim = data as Claim
  if (claim.status !== 'claimed' || !claim.delivery || !claim.leaseToken) {
    throw new Error(`Resend TEST KOMPLETNI nebyl převzat: ${claim.status}.`)
  }

  const delivery = claim.delivery
  const template = renderCompleteNotificationEmail({
    companyName: delivery.companyName,
    startsAt: delivery.startsAt,
    endsAt: delivery.endsAt,
    source: delivery.source,
    municipality: delivery.municipality,
    addresses: delivery.addresses,
    announcementUrl: delivery.announcementUrl,
    sourceUrl: delivery.sourceUrl,
    testMode: true,
  })
  const resend = new Resend(configuration.apiKey)
  try {
    const response = await resend.emails.send({
      from: `${configuration.fromName.replace(/[\r\n"<>]/g, ' ')} <${configuration.fromEmail}>`,
      to: [configuration.testRecipient],
      replyTo: configuration.replyToEmail ?? undefined,
      subject: `[TEST KOMPLETNÍ] ${template.subject}`,
      html: template.html,
      text: `TEST KOMPLETNÍ – firma nic neobdrží.\nPůvodní příjemce: ${delivery.originalRecipient}\n\n${template.text}`,
      attachments: [{
        filename: 'b-energy-logo.png',
        content: await getBEnergyLogo(),
        contentId: COMPLETE_NOTIFICATION_EMAIL_LOGO_CONTENT_ID,
      }],
      tags: [
        { name: 'category', value: 'complete_outage_test' },
        { name: 'delivery_id', value: delivery.id },
        { name: 'template', value: template.templateVersion },
      ],
    }, { idempotencyKey: `complete-outage-test-${delivery.id}` })

    if (response.error) {
      const details = resendErrorDetails(response.error)
      const resendError = new Error(details.message)
      resendError.name = details.code
      throw resendError
    }

    const { error: finishError } = await service.rpc(
      'finish_complete_power_outage_notification_email_test_sent_v1',
      {
        requested_delivery_id: delivery.id,
        requested_lease_token: claim.leaseToken,
        requested_provider_message_id: response.data.id,
        requested_test_recipient: configuration.testRecipient,
      },
    )
    if (finishError) throw new Error(`Výsledek TEST odeslání se nepodařilo uložit: ${finishError.message}`)
    return {
      ok: true as const,
      status: 'sent' as const,
      testOnly: true,
      deliveryId: delivery.id,
      companyName: delivery.companyName,
      testRecipientMasked: configuration.testRecipientMasked,
      prepared,
    }
  } catch (error) {
    const details = errorDetails(error)
    const { error: failureError } = await service.rpc('finish_complete_power_outage_notification_email_test_failed_v1', {
      requested_delivery_id: delivery.id,
      requested_lease_token: claim.leaseToken,
      requested_error_code: details.code,
      requested_error_message: details.message,
    })
    if (failureError && !/platnou lease/i.test(failureError.message)) {
      throw new Error(`Chybu Resend TESTU se nepodařilo uložit: ${failureError.message}`)
    }
    throw error
  }
}
