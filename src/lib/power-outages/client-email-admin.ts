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
  last_dispatch_completed_at: string | null
  worker_expires_at: string | null
  last_plan_cron_at: string | null
  last_plan_cron_status_code: number | null
  last_plan_cron_error: string | null
  last_dispatch_cron_at: string | null
  last_dispatch_cron_status_code: number | null
  last_dispatch_cron_error: string | null
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
  mode_at_plan: MarketClientEmailDelivery['mode']
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

type AutomationStatus = MarketClientEmailAdminWorkspace['automationHealth']['overallStatus']

const AUTOMATION_STATUS_PRIORITY: Record<AutomationStatus, number> = {
  inactive: 0,
  healthy: 1,
  warning: 2,
  error: 3,
}

function isRecent(value: string | null, maximumAgeMinutes: number) {
  if (!value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && Date.now() - time <= maximumAgeMinutes * 60_000
}

function buildAutomationHealth(state: StateRow): MarketClientEmailAdminWorkspace['automationHealth'] {
  if (state.runtime_mode === 'disabled') {
    const inactive = (label: string) => ({
      status: 'inactive' as const,
      label,
      lastActivityAt: null,
      message: 'Automatizace je vypnutá.',
    })
    return {
      overallStatus: 'inactive',
      planner: inactive('Plánovač'),
      worker: inactive('Odesílací worker'),
      cron: inactive('Plánované úlohy'),
    }
  }

  const plannerError = state.last_error_code === 'CLIENT_EMAIL_CANDIDATE_PLAN_FAILED'
    ? state.last_error_message ?? state.last_error_code
    : null
  const plannerRecent = isRecent(state.last_planned_at, 12)
  const planner = {
    status: plannerError ? 'error' as const : plannerRecent ? 'healthy' as const : 'error' as const,
    label: 'Plánovač',
    lastActivityAt: state.last_planned_at,
    message: plannerError ?? (plannerRecent
      ? 'Pravidelně vyhodnocuje nové e-mailové události.'
      : 'Plánovač se neozval v očekávaném intervalu.'),
  }

  const workerLeaseActive = isRecent(state.worker_expires_at, 2)
    && Date.parse(state.worker_expires_at ?? '') > Date.now()
  const workerRecent = isRecent(state.last_dispatch_completed_at, 8)
  const worker = {
    status: workerRecent || workerLeaseActive ? 'healthy' as const : 'error' as const,
    label: 'Odesílací worker',
    lastActivityAt: state.last_dispatch_completed_at,
    message: workerRecent
      ? 'Pravidelně kontroluje a odesílá bezpečnou frontu.'
      : workerLeaseActive
        ? 'Worker právě zpracovává e-mailovou frontu.'
        : 'Worker se neozval v očekávaném intervalu.',
  }

  const planCronRecent = isRecent(state.last_plan_cron_at, 12)
  const dispatchCronRecent = isRecent(state.last_dispatch_cron_at, 8)
  const cronError = state.last_plan_cron_error
    ?? state.last_dispatch_cron_error
    ?? (state.last_plan_cron_status_code !== null && (state.last_plan_cron_status_code < 200 || state.last_plan_cron_status_code >= 300)
      ? `Cron plánovače odpověděl HTTP ${state.last_plan_cron_status_code}.`
      : null)
    ?? (state.last_dispatch_cron_status_code !== null && (state.last_dispatch_cron_status_code < 200 || state.last_dispatch_cron_status_code >= 300)
      ? `Cron workeru odpověděl HTTP ${state.last_dispatch_cron_status_code}.`
      : null)
  const cronRecent = planCronRecent && dispatchCronRecent
  const cronLastActivityAt = [state.last_plan_cron_at, state.last_dispatch_cron_at]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  const cron = {
    status: cronError ? 'error' as const : cronRecent ? 'healthy' as const : 'error' as const,
    label: 'Plánované úlohy',
    lastActivityAt: cronLastActivityAt,
    message: cronError ?? (cronRecent
      ? 'Oba databázové crony spouštějí své endpointy podle plánu.'
      : 'Alespoň jeden e-mailový cron se neozval v očekávaném intervalu.'),
  }

  const overallStatus = [planner.status, worker.status, cron.status]
    .reduce<AutomationStatus>((worst, status) => (
      AUTOMATION_STATUS_PRIORITY[status] > AUTOMATION_STATUS_PRIORITY[worst] ? status : worst
    ), 'healthy')

  return { overallStatus, planner, worker, cron }
}

export async function getMarketClientEmailAdminWorkspace(): Promise<MarketClientEmailAdminWorkspace> {
  const { supabase, profile } = await getPowerOutageRuntimeContext()
  if (profile.role !== 'admin') {
    throw new Error('Administrace klientských e-mailů je dostupná pouze administrátorům.')
  }

  const [stateResult, settingsResult, recipientsResult, rulesResult, deliveriesResult, deliveredTestsResult] = await Promise.all([
    supabase
      .from('power_outage_client_email_state')
      .select('runtime_mode,dispatch_enabled,provider,last_planned_at,last_dispatch_completed_at,worker_expires_at,last_plan_cron_at,last_plan_cron_status_code,last_plan_cron_error,last_dispatch_cron_at,last_dispatch_cron_status_code,last_dispatch_cron_error,last_error_code,last_error_message')
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
      .select('id,client_id,mode_at_plan,event_kind,delivery_status,subject_snapshot,text_snapshot,recipient_snapshot,store_snapshot,metadata,attempt_count,max_attempt_count,provider_message_id,last_error_code,last_error_message,created_at,sent_at,delivered_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('power_outage_client_email_deliveries')
      .select('client_id')
      .eq('mode_at_plan', 'test')
      .eq('delivery_status', 'delivered'),
  ])

  const firstError = [
    stateResult.error,
    settingsResult.error,
    recipientsResult.error,
    rulesResult.error,
    deliveriesResult.error,
    deliveredTestsResult.error,
  ].find(Boolean)
  if (firstError) {
    throw new Error(`Administraci e-mailových upozornění se nepodařilo načíst: ${firstError.message}`)
  }

  const state = stateResult.data
  if (!state) throw new Error('Globální stav klientských e-mailů není dostupný.')
  const recipients = (recipientsResult.data ?? []) as RecipientRow[]
  const rules = (rulesResult.data ?? []) as RuleRow[]
  const deliveries = (deliveriesResult.data ?? []) as DeliveryRow[]
  const clientsWithDeliveredTest = new Set(
    ((deliveredTestsResult.data ?? []) as Array<{ client_id: string }>).map((delivery) => delivery.client_id),
  )

  return {
    runtimeMode: state.runtime_mode,
    dispatchEnabled: state.dispatch_enabled,
    provider: state.provider,
    lastPlannedAt: state.last_planned_at,
    lastErrorCode: state.last_error_code,
    lastErrorMessage: state.last_error_message,
    automationHealth: buildAutomationHealth(state),
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
      hasDeliveredTest: clientsWithDeliveredTest.has(settings.client_id),
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
          mode: delivery.mode_at_plan,
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
