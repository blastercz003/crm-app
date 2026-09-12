import 'server-only'

import { Resend, type ErrorResponse } from 'resend'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { getCompleteNotificationResendConfiguration } from './complete-notification-email-resend-config'

type ClaimedDelivery = {
  id: string
  subject: string
  text: string
  companyName: string
  startsAt: string
  endsAt: string
  addresses: unknown[]
  originalRecipient: string
  attemptCount: number
}

type Claim = {
  status: 'disabled' | 'empty' | 'claimed'
  leaseToken?: string
  delivery?: ClaimedDelivery | null
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character] ?? character)
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

function renderTestHtml(delivery: ClaimedDelivery) {
  const originalRecipient = escapeHtml(delivery.originalRecipient)
  const body = escapeHtml(delivery.text).replace(/\n/g, '<br>')
  return `<!doctype html><html lang="cs"><body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:680px;margin:0 auto;padding:24px"><div style="border:2px solid #7c3aed;border-radius:16px;background:#f5f3ff;padding:16px;color:#5b21b6"><strong>TEST KOMPLETNÍ · KLIENT NIC NEOBDRŽÍ</strong><br><span style="font-size:13px">Původní příjemce: ${originalRecipient}</span></div><div style="margin-top:16px;border:1px solid #dbe3ee;border-radius:20px;background:#fff;padding:28px"><h1 style="margin:0 0 16px;font-size:24px">${escapeHtml(delivery.subject)}</h1><p style="font-size:15px;line-height:1.65">${body}</p><hr style="margin:24px 0;border:0;border-top:1px solid #e2e8f0"><p style="font-size:12px;line-height:1.5;color:#64748b">Toto je bezpečný interní náhled. Odkaz pro odhlášení je v TEST režimu neaktivní.</p></div></div></body></html>`
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
    'claim_complete_power_outage_notification_email_test_v1',
  )
  if (claimError) throw new Error(`TEST zprávu se nepodařilo převzít: ${claimError.message}`)
  const claim = data as Claim
  if (claim.status !== 'claimed' || !claim.delivery || !claim.leaseToken) {
    throw new Error(`Resend TEST KOMPLETNI nebyl převzat: ${claim.status}.`)
  }

  const delivery = claim.delivery
  const resend = new Resend(configuration.apiKey)
  try {
    const response = await resend.emails.send({
      from: `${configuration.fromName.replace(/[\r\n"<>]/g, ' ')} <${configuration.fromEmail}>`,
      to: [configuration.testRecipient],
      replyTo: configuration.replyToEmail ?? undefined,
      subject: `[TEST KOMPLETNÍ] ${delivery.subject}`,
      html: renderTestHtml(delivery),
      text: `TEST KOMPLETNÍ – klient nic neobdrží.\nPůvodní příjemce: ${delivery.originalRecipient}\n\n${delivery.text}\n\nOdkaz pro odhlášení je v TEST režimu neaktivní.`,
      tags: [
        { name: 'category', value: 'complete_outage_test' },
        { name: 'delivery_id', value: delivery.id },
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
