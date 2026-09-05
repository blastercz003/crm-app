import 'server-only'

import { Resend, type ErrorResponse } from 'resend'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { getResendConfigurationStatus } from './client-email-resend-config'

type ClaimedRecipient = {
  kind: 'to' | 'cc' | 'bcc'
  email: string
  name?: string | null
}

type ClaimedDelivery = {
  id: string
  mode: 'test' | 'live'
  eventKind: string
  dedupeKey: string
  subject: string
  html: string
  text: string | null
  recipients: ClaimedRecipient[]
  fromName: string
  fromEmail: string
  replyToEmail: string | null
  attemptCount: number
  maxAttemptCount: number
}

type ClaimResult = {
  ok: boolean
  status: 'disabled' | 'already_running' | 'empty' | 'test' | 'live'
  batchToken?: string
  claimedCount: number
  deliveries: ClaimedDelivery[]
}

export type MarketClientEmailDispatchResult = {
  ok: true
  status: ClaimResult['status']
  claimedCount: number
  sentCount: number
  failedCount: number
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RETRYABLE_ERROR_NAMES = new Set([
  'rate_limit_exceeded',
  'internal_server_error',
  'application_error',
  'concurrent_idempotent_requests',
])

class DeliveryStatePersistenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeliveryStatePersistenceError'
  }
}

function cleanHeaderText(value: string) {
  return value.replace(/[\r\n"]/g, ' ').replace(/\s+/g, ' ').trim()
}

function validEmail(value: string | null | undefined): value is string {
  return Boolean(value && EMAIL_PATTERN.test(value.trim()))
}

function recipientGroups(recipients: ClaimedRecipient[]) {
  const unique = new Map<string, ClaimedRecipient>()
  for (const recipient of recipients) {
    if (!validEmail(recipient.email)) continue
    const key = `${recipient.kind}:${recipient.email.trim().toLowerCase()}`
    unique.set(key, { ...recipient, email: recipient.email.trim().toLowerCase() })
  }
  const values = [...unique.values()]
  return {
    to: values.filter((item) => item.kind === 'to').map((item) => item.email),
    cc: values.filter((item) => item.kind === 'cc').map((item) => item.email),
    bcc: values.filter((item) => item.kind === 'bcc').map((item) => item.email),
  }
}

function retryableResendError(error: ErrorResponse) {
  return (error.statusCode !== null && (error.statusCode === 429 || error.statusCode >= 500))
    || RETRYABLE_ERROR_NAMES.has(error.name)
}

function errorDetails(error: unknown) {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return {
      code: typeof record.name === 'string' ? record.name : 'RESEND_SEND_FAILED',
      message: typeof record.message === 'string' ? record.message : 'Odeslání přes Resend selhalo.',
      retryable: error instanceof TypeError
        || (typeof record.code === 'string' && /^(ECONN|ETIMEDOUT|UND_ERR_)/.test(record.code)),
    }
  }
  return { code: 'RESEND_SEND_FAILED', message: 'Odeslání přes Resend selhalo.', retryable: false }
}

export async function dispatchMarketClientEmails(limit = 10): Promise<MarketClientEmailDispatchResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Velikost odesílací dávky musí být mezi 1 a 50.')
  }

  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro e-mailový worker.')

  const { data: state, error: stateError } = await client
    .from('power_outage_client_email_state')
    .select('runtime_mode,dispatch_enabled')
    .eq('singleton', true)
    .single<{ runtime_mode: string; dispatch_enabled: boolean }>()
  if (stateError) throw new Error(`Stav e-mailového workeru se nepodařilo načíst: ${stateError.message}`)
  if (!state.dispatch_enabled || !['test', 'live'].includes(state.runtime_mode)) {
    return { ok: true, status: 'disabled', claimedCount: 0, sentCount: 0, failedCount: 0 }
  }

  const configuration = getResendConfigurationStatus()
  const configurationReady = state.runtime_mode === 'test'
    ? configuration.testReady
    : configuration.liveReady
  if (!configurationReady) {
    throw new Error(`Resend není připraven: ${configuration.issues.join(' ')}`)
  }
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey || !configuration.sendingDomain) throw new Error('Chybí bezpečná konfigurace Resendu.')

  const { data, error } = await client.rpc('claim_power_outage_client_email_delivery_batch', {
    p_limit: state.runtime_mode === 'live' ? 1 : limit,
  })
  if (error) throw new Error(`E-mailovou dávku se nepodařilo převzít: ${error.message}`)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('E-mailový worker nevrátil platnou dávku.')
  }
  const claim = data as ClaimResult
  if (!claim.ok) throw new Error('Převzetí e-mailové dávky selhalo.')
  if (!claim.batchToken || claim.deliveries.length === 0) {
    return { ok: true, status: claim.status, claimedCount: 0, sentCount: 0, failedCount: 0 }
  }

  const resend = new Resend(apiKey)
  let sentCount = 0
  let failedCount = 0

  try {
    for (const delivery of claim.deliveries) {
      try {
        if (!validEmail(delivery.fromEmail)) throw new Error('Zpráva nemá platnou adresu odesílatele.')
        const senderDomain = delivery.fromEmail.trim().toLowerCase().split('@')[1]
        if (senderDomain !== configuration.sendingDomain) {
          throw new Error('Doména odesílatele neodpovídá ověřené doméně Resendu.')
        }

        const recipients = recipientGroups(delivery.recipients)
        let to = recipients.to
        let cc = recipients.cc
        let bcc = recipients.bcc
        let subject = delivery.subject

        if (delivery.mode === 'test') {
          const testRecipient = process.env.RESEND_TEST_RECIPIENT?.trim().toLowerCase()
          if (!validEmail(testRecipient)) {
            throw new Error('Testovací režim nemá nastavenou RESEND_TEST_RECIPIENT.')
          }
          if (!delivery.html.includes('TESTOVACÍ REŽIM') || !delivery.text?.includes('Původní příjemci:')) {
            throw new Error('Testovací zpráva neobsahuje povinné bezpečnostní označení a původní příjemce.')
          }
          subject = `[TEST] ${subject}`
          to = [testRecipient]
          cc = []
          bcc = []
        }

        if (to.length === 0) throw new Error('Zpráva nemá žádného příjemce TO.')
        const response = await resend.emails.send({
          from: `${cleanHeaderText(delivery.fromName)} <${delivery.fromEmail.trim().toLowerCase()}>`,
          to,
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          replyTo: validEmail(delivery.replyToEmail) ? delivery.replyToEmail.trim().toLowerCase() : undefined,
          subject,
          html: delivery.html,
          text: delivery.text ?? undefined,
          tags: [
            { name: 'category', value: 'market_outage' },
            { name: 'delivery_id', value: delivery.id },
          ],
        }, {
          idempotencyKey: `market-outage-${delivery.id}`,
        })

        if (response.error) {
          const { error: failureError } = await client.rpc('finish_power_outage_client_email_delivery_failed', {
            p_delivery_id: delivery.id,
            p_batch_token: claim.batchToken,
            p_error_code: response.error.name,
            p_error_message: response.error.message,
            p_retryable: retryableResendError(response.error),
          })
          if (failureError) {
            throw new DeliveryStatePersistenceError(`Chybu Resendu se nepodařilo uložit: ${failureError.message}`)
          }
          failedCount += 1
          continue
        }

        const { error: finishError } = await client.rpc('finish_power_outage_client_email_delivery_sent', {
          p_delivery_id: delivery.id,
          p_batch_token: claim.batchToken,
          p_provider_message_id: response.data.id,
        })
        if (finishError) {
          throw new DeliveryStatePersistenceError(`Výsledek odeslání se nepodařilo uložit: ${finishError.message}`)
        }
        sentCount += 1
      } catch (deliveryError) {
        if (deliveryError instanceof DeliveryStatePersistenceError) throw deliveryError
        const details = errorDetails(deliveryError)
        const { error: failureError } = await client.rpc('finish_power_outage_client_email_delivery_failed', {
          p_delivery_id: delivery.id,
          p_batch_token: claim.batchToken,
          p_error_code: details.code,
          p_error_message: details.message,
          p_retryable: details.retryable,
        })
        if (failureError) throw new Error(`Chybu odeslání se nepodařilo uložit: ${failureError.message}`)
        failedCount += 1
      }
    }
  } finally {
    const { error: finishBatchError } = await client.rpc(
      'finish_power_outage_client_email_delivery_batch',
      { p_batch_token: claim.batchToken },
    )
    if (finishBatchError) throw new Error(`Odesílací dávku se nepodařilo uzavřít: ${finishBatchError.message}`)
  }

  return {
    ok: true,
    status: claim.status,
    claimedCount: claim.claimedCount,
    sentCount,
    failedCount,
  }
}
