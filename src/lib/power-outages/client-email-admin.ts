import 'server-only'

import { getPowerOutageRuntimeContext } from './access'
import { getResendConfigurationStatus } from './client-email-resend-config'
import type {
  MarketClientEmailAdminWorkspace,
  MarketClientEmailDelivery,
  MarketClientEmailMode,
  MarketClientEmailRecipient,
  MarketClientEmailRule,
} from './types'

type StateRow = {
  runtime_mode: MarketClientEmailMode
  dispatch_enabled: boolean
  provider: 'resend'
  last_planned_at: string | null
  last_error_code: string | null
  last_error_message: string | null
}

type SettingsRow = {
  client_id: string
  chain_name: string
  client_name_snapshot: string
  mode: MarketClientEmailMode
  from_name: string | null
  from_email: string | null
  reply_to_email: string | null
  updated_at: string
}

type RecipientRow = {
  id: string
  client_id: string
  recipient_kind: 'to' | 'cc' | 'bcc'
  name: string | null
  email: string
  is_active: boolean
}

type RuleRow = {
  id: string
  client_id: string
  name: string
  event_kind: MarketClientEmailRule['eventKind']
  enabled: boolean
  version: number
  activated_at: string | null
}

type DeliveryRow = {
  id: string
  client_id: string
  event_kind: MarketClientEmailDelivery['eventKind']
  delivery_status: MarketClientEmailDelivery['status']
  subject_snapshot: string | null
  text_snapshot: string | null
  store_snapshot: unknown
  metadata: unknown
  recipient_snapshot: unknown
  attempt_count: number
  max_attempt_count: number
  provider_message_id: string | null
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  sent_at: string | null
  delivered_at: string | null
}

function recipientEmails(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (!item || typeof item !== 'object') return []
    const email = 'email' in item && typeof item.email === 'string' ? item.email : null
    return email ? [email] : []
  })
}

function deliveryStores(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    return [{
      chainName: typeof row.chainName === 'string' ? row.chainName : '',
      storeNumber: typeof row.storeNumber === 'string' ? row.storeNumber : '',
      city: typeof row.city === 'string' ? row.city : '',
      address: typeof row.address === 'string' ? row.address : '',
    }]
  })
}

function metadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

function metadataUrl(metadata: unknown, key: string) {
  const value = metadataValue(metadata, key)
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export async function getMarketClientEmailAdminWorkspace(): Promise<MarketClientEmailAdminWorkspace> {
  const { supabase, profile } = await getPowerOutageRuntimeContext()
  if (profile.role !== 'admin') {
    throw new Error('Administrace klientských e-mailů je dostupná pouze administrátorům.')
  }

  const [stateResult, settingsResult, recipientsResult, rulesResult, deliveriesResult] = await Promise.all([
    supabase
      .from('power_outage_client_email_state')
      .select('runtime_mode,dispatch_enabled,provider,last_planned_at,last_error_code,last_error_message')
      .eq('singleton', true)
      .single<StateRow>(),
    supabase
      .from('power_outage_client_email_settings')
      .select('client_id,chain_name,client_name_snapshot,mode,from_name,from_email,reply_to_email,updated_at')
      .order('chain_name'),
    supabase
      .from('power_outage_client_email_recipients')
      .select('id,client_id,recipient_kind,name,email,is_active')
      .order('recipient_kind')
      .order('email'),
    supabase
      .from('power_outage_client_email_rules')
      .select('id,client_id,name,event_kind,enabled,version,activated_at')
      .order('event_kind')
      .order('version', { ascending: false }),
    supabase
      .from('power_outage_client_email_deliveries')
      .select('id,client_id,event_kind,delivery_status,subject_snapshot,text_snapshot,recipient_snapshot,store_snapshot,metadata,attempt_count,max_attempt_count,provider_message_id,last_error_code,last_error_message,created_at,sent_at,delivered_at')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const firstError = [
    stateResult.error,
    settingsResult.error,
    recipientsResult.error,
    rulesResult.error,
    deliveriesResult.error,
  ].find(Boolean)
  if (firstError) {
    throw new Error(`Administraci e-mailových upozornění se nepodařilo načíst: ${firstError.message}`)
  }

  const state = stateResult.data
  if (!state) throw new Error('Globální stav klientských e-mailů není dostupný.')
  const recipients = (recipientsResult.data ?? []) as RecipientRow[]
  const rules = (rulesResult.data ?? []) as RuleRow[]
  const deliveries = (deliveriesResult.data ?? []) as DeliveryRow[]

  return {
    runtimeMode: state.runtime_mode,
    dispatchEnabled: state.dispatch_enabled,
    provider: state.provider,
    lastPlannedAt: state.last_planned_at,
    lastErrorCode: state.last_error_code,
    lastErrorMessage: state.last_error_message,
    resend: getResendConfigurationStatus(),
    clients: ((settingsResult.data ?? []) as SettingsRow[]).map((settings) => ({
      clientId: settings.client_id,
      chainName: settings.chain_name,
      clientName: settings.client_name_snapshot,
      mode: settings.mode,
      fromName: settings.from_name ?? '',
      fromEmail: settings.from_email ?? '',
      replyToEmail: settings.reply_to_email ?? '',
      updatedAt: settings.updated_at,
      recipients: recipients
        .filter((recipient) => recipient.client_id === settings.client_id && recipient.recipient_kind !== 'bcc')
        .map((recipient): MarketClientEmailRecipient => ({
          id: recipient.id,
          kind: recipient.recipient_kind as 'to' | 'cc',
          name: recipient.name ?? '',
          email: recipient.email,
          isActive: recipient.is_active,
        })),
      rules: rules
        .filter((rule) => rule.client_id === settings.client_id)
        .map((rule): MarketClientEmailRule => ({
          id: rule.id,
          name: rule.name,
          eventKind: rule.event_kind,
          enabled: rule.enabled,
          version: rule.version,
          activatedAt: rule.activated_at,
        })),
      deliveries: deliveries
        .filter((delivery) => delivery.client_id === settings.client_id)
        .map((delivery): MarketClientEmailDelivery => ({
          id: delivery.id,
          eventKind: delivery.event_kind,
          status: delivery.delivery_status,
          subject: delivery.subject_snapshot,
          text: delivery.text_snapshot,
          recipients: recipientEmails(delivery.recipient_snapshot),
          stores: deliveryStores(delivery.store_snapshot),
          source: metadataValue(delivery.metadata, 'source') as MarketClientEmailDelivery['source'],
          startsAt: metadataValue(delivery.metadata, 'startsAt'),
          endsAt: metadataValue(delivery.metadata, 'endsAt'),
          announcementUrl: metadataUrl(delivery.metadata, 'announcementUrl'),
          attemptCount: delivery.attempt_count,
          maxAttemptCount: delivery.max_attempt_count,
          providerMessageId: delivery.provider_message_id,
          lastErrorCode: delivery.last_error_code,
          lastErrorMessage: delivery.last_error_message,
          createdAt: delivery.created_at,
          sentAt: delivery.sent_at,
          deliveredAt: delivery.delivered_at,
        })),
    })),
  }
}
