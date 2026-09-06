import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import type { MarketClientEmailEventKind } from './types'

type DeliveryRow = {
  id: string
  client_id: string
  rule_id: string | null
  outage_id: string | null
  outage_version_id: string | null
  event_kind: MarketClientEmailEventKind
  metadata: unknown
  created_at: string
  next_attempt_at: string | null
  delivery_status: string
}

type SettingsRow = {
  client_id: string
  client_name_snapshot: string
  chain_name: string
  mode: string
  from_name: string | null
  from_email: string | null
  reply_to_email: string | null
}

type OutageRow = {
  id: string
  source: string
  external_id: string
  title: string | null
  starts_at: string
  ends_at: string
  municipality: string | null
  source_url: string | null
  announcement_url: string | null
  source_status: string
  archived_at: string | null
  created_at: string
}

type RuleRow = {
  id: string
  activated_at: string | null
}

type MatchRow = {
  id: string
  store_id: string | null
  store_chain_name: string
  store_number: string
  store_city: string
  store_address: string
}

type RecipientRow = {
  recipient_kind: 'to' | 'cc' | 'bcc'
  name: string | null
  email: string
}

type StoreSnapshot = {
  matchId: string
  storeId: string | null
  chainName: string
  storeNumber: string
  city: string
  address: string
}

export type PreparedMarketClientEmail = {
  subject: string
  html: string
  text: string
  recipients: Array<{ kind: 'to' | 'cc' | 'bcc'; name: string; email: string }>
  fromName: string
  fromEmail: string
  replyToEmail: string | null
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const EVENT_COPY: Record<MarketClientEmailEventKind, {
  subject: string
  heading: string
  badge: string
  introduction: (storeLabel: string) => string
  followUp: string | null
}> = {
  new_outage: {
    subject: 'Nová plánovaná odstávka',
    heading: 'Nová plánovaná odstávka',
    badge: 'NOVÁ ODSTÁVKA',
    introduction: (storeLabel) => `Dobrý den, pro ${storeLabel} evidujeme novou plánovanou odstávku elektřiny.`,
    followUp: 'Ověřte prosím, zda se odstávka skutečně týká Vaší prodejny.',
  },
  schedule_changed: {
    subject: 'Změna termínu plánované odstávky',
    heading: 'Změna termínu plánované odstávky',
    badge: 'ZMĚNA TERMÍNU',
    introduction: (storeLabel) => `Dobrý den, u plánované odstávky pro ${storeLabel} evidujeme změnu termínu.`,
    followUp: 'Ověřte prosím, zda se změna týká Vaší prodejny.',
  },
  cancelled: {
    subject: 'Zrušení plánované odstávky',
    heading: 'Zrušení plánované odstávky',
    badge: 'ZRUŠENO',
    introduction: (storeLabel) => `Dobrý den, plánovaná odstávka pro ${storeLabel} byla podle údajů distributora zrušena.`,
    followUp: null,
  },
  reminder_24h: {
    subject: 'Připomenutí plánované odstávky',
    heading: 'Připomenutí plánované odstávky',
    badge: '24 HODIN PŘEDEM',
    introduction: (storeLabel) => `Dobrý den, připomínáme plánovanou odstávku elektřiny pro ${storeLabel}. Začíná přibližně za 24 hodin.`,
    followUp: 'Ověřte prosím, zda se odstávka skutečně týká Vaší prodejny.',
  },
  missing_job_72h: {
    subject: 'Víte o této plánované odstávce?',
    heading: 'Víte o této plánované odstávce?',
    badge: '3 DNY PŘEDEM',
    introduction: (storeLabel) => `Dobrý den, pro ${storeLabel} evidujeme plánovanou odstávku elektřiny. Začíná za 3 dny a v našem systému zatím neevidujeme objednávku. Prosíme o její zaslání.`,
    followUp: 'Ověřte prosím, zda se odstávka skutečně týká Vaší prodejny.',
  },
}

const SOURCE_LABELS: Record<string, string> = {
  cez: 'ČEZ Distribuce',
  egd: 'EG.D',
  pre: 'PREdistribuce',
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeHttpsUrl(value: string | null) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Odstávka nemá platný termín.')
  return DATE_TIME_FORMATTER.format(date)
}

function isFuturePublishableOutage(outage: OutageRow) {
  return !outage.archived_at
    && !['completed', 'cancelled'].includes(outage.source_status)
    && new Date(outage.starts_at).getTime() > Date.now()
}

function storePhrase(count: number) {
  return count === 1 ? 'níže uvedenou prodejnu' : 'níže uvedené prodejny'
}

function renderDetailsRows(eventKind: MarketClientEmailEventKind, startsAt: string, endsAt: string, previousStartsAt: string | null, previousEndsAt: string | null, sourceLabel: string, municipality: string) {
  const dateRows = eventKind === 'schedule_changed'
    ? `<tr><td style="padding:15px 0;border-bottom:1px solid #e8edf2;color:#64748b;font-size:13px">Původní termín</td><td align="right" style="padding:15px 0;border-bottom:1px solid #e8edf2;font-size:14px;font-weight:700">${escapeHtml(previousStartsAt ? formatDateTime(previousStartsAt) : 'neuveden')}–${escapeHtml(previousEndsAt ? formatDateTime(previousEndsAt) : 'neuveden')}</td></tr><tr><td style="padding:15px 0;border-bottom:1px solid #e8edf2;color:#64748b;font-size:13px">Nový termín</td><td align="right" style="padding:15px 0;border-bottom:1px solid #e8edf2;font-size:14px;font-weight:700">${escapeHtml(formatDateTime(startsAt))}–${escapeHtml(formatDateTime(endsAt))}</td></tr>`
    : `<tr><td style="padding:15px 0;border-bottom:1px solid #e8edf2;color:#64748b;font-size:13px">Termín</td><td align="right" style="padding:15px 0;border-bottom:1px solid #e8edf2;font-size:14px;font-weight:700">${escapeHtml(formatDateTime(startsAt))}–${escapeHtml(formatDateTime(endsAt))}</td></tr>`

  return `${dateRows}<tr><td style="padding:15px 0;border-bottom:1px solid #e8edf2;color:#64748b;font-size:13px">Distributor</td><td align="right" style="padding:15px 0;border-bottom:1px solid #e8edf2;font-size:14px;font-weight:700">${escapeHtml(sourceLabel)}</td></tr><tr><td style="padding:15px 0;border-bottom:1px solid #e8edf2;color:#64748b;font-size:13px">Obec</td><td align="right" style="padding:15px 0;border-bottom:1px solid #e8edf2;font-size:14px;font-weight:700">${escapeHtml(municipality)}</td></tr>`
}

async function prepareDelivery(deliveryId: string, expectedStatus: 'planned' | 'sending', batchToken?: string): Promise<PreparedMarketClientEmail | null> {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro vykreslení ostrého e-mailu.')

  let deliveryQuery = client
    .from('power_outage_client_email_deliveries')
    .select('id,client_id,rule_id,outage_id,outage_version_id,event_kind,metadata,created_at,next_attempt_at,delivery_status')
    .eq('id', deliveryId)
    .eq('mode_at_plan', 'live')
    .eq('delivery_status', expectedStatus)
  if (batchToken) deliveryQuery = deliveryQuery.eq('processing_token', batchToken)
  const { data: deliveryData, error: deliveryError } = await deliveryQuery.maybeSingle<DeliveryRow>()
  if (deliveryError) throw new Error(`Ostrý e-mail se nepodařilo načíst: ${deliveryError.message}`)
  if (!deliveryData?.outage_id) return null
  const delivery = deliveryData

  const [settingsResult, outageResult, recipientsResult, matchesResult, ruleResult] = await Promise.all([
    client.from('power_outage_client_email_settings').select('client_id,client_name_snapshot,chain_name,mode,from_name,from_email,reply_to_email').eq('client_id', delivery.client_id).maybeSingle<SettingsRow>(),
    client.from('power_outages').select('id,source,external_id,title,starts_at,ends_at,municipality,source_url,announcement_url,source_status,archived_at,created_at').eq('id', delivery.outage_id).maybeSingle<OutageRow>(),
    client.from('power_outage_client_email_recipients').select('recipient_kind,name,email').eq('client_id', delivery.client_id).eq('is_active', true),
    client.from('power_outage_store_matches').select('id,store_id,store_chain_name,store_number,store_city,store_address').eq('outage_id', delivery.outage_id).eq('match_status', 'confirmed'),
    delivery.rule_id
      ? client.from('power_outage_client_email_rules').select('id,activated_at').eq('id', delivery.rule_id).maybeSingle<RuleRow>()
      : Promise.resolve({ data: null, error: null }),
  ])
  const firstError = [settingsResult.error, outageResult.error, recipientsResult.error, matchesResult.error, ruleResult.error].find(Boolean)
  if (firstError) throw new Error(`Podklady ostrého e-mailu se nepodařilo načíst: ${firstError.message}`)
  const settings = settingsResult.data
  const outage = outageResult.data
  const rule = ruleResult.data
  if (!settings || settings.mode !== 'live' || !outage) return null
  if (!settings.from_name || !settings.from_email) throw new Error(`Klient ${settings.client_name_snapshot} nemá platného odesílatele.`)

  let matches = ((matchesResult.data ?? []) as MatchRow[]).filter((match) => upper(match.store_chain_name) === settings.chain_name)
  if (delivery.event_kind === 'missing_job_72h' && matches.length > 0) {
    const { data: linkData, error: linkError } = await client
      .from('power_outage_job_links')
      .select('match_id')
      .in('match_id', matches.map((match) => match.id))
    if (linkError) throw new Error(`Kontrola přiřazených zakázek selhala: ${linkError.message}`)
    const linkedMatchIds = new Set((linkData ?? []).map((link) => link.match_id as string))
    matches = matches.filter((match) => !linkedMatchIds.has(match.id))
  }

  const activationTime = rule?.activated_at ? new Date(rule.activated_at).getTime() : Number.NaN
  const outageCreatedTime = new Date(outage.created_at).getTime()
  const belongsToPostActivationCohort = Number.isFinite(activationTime)
    && Number.isFinite(outageCreatedTime)
    && outageCreatedTime >= activationTime
  const eventStillEligible = belongsToPostActivationCohort && (delivery.event_kind === 'cancelled'
    ? true
    : delivery.event_kind === 'schedule_changed'
      ? !outage.archived_at && outage.source_status !== 'cancelled'
      : isFuturePublishableOutage(outage))
  const recipients = (recipientsResult.data ?? []) as RecipientRow[]
  const hasTo = recipients.some((recipient) => recipient.recipient_kind === 'to')
  if (!eventStillEligible || matches.length === 0 || !hasTo) {
    let cancellationQuery = client.from('power_outage_client_email_deliveries').update({
        delivery_status: 'cancelled',
        processing_token: null,
        processing_expires_at: null,
        next_attempt_at: null,
        last_error_code: 'CLIENT_EMAIL_NO_LONGER_ELIGIBLE',
        last_error_message: 'Před odesláním již nebyla splněna podmínka pravidla.',
        updated_at: new Date().toISOString(),
      }).eq('id', delivery.id).eq('delivery_status', expectedStatus)
    if (batchToken) cancellationQuery = cancellationQuery.eq('processing_token', batchToken)
    const { error: cancellationError } = await cancellationQuery
    if (cancellationError) throw new Error(`Neplatnou ostrou zprávu se nepodařilo bezpečně zrušit: ${cancellationError.message}`)
    return null
  }

  const metadata = objectValue(delivery.metadata)
  const startsAt = stringValue(metadata.startsAt) ?? outage.starts_at
  const endsAt = stringValue(metadata.endsAt) ?? outage.ends_at
  const previousStartsAt = stringValue(metadata.previousStartsAt)
  const previousEndsAt = stringValue(metadata.previousEndsAt)
  const copy = EVENT_COPY[delivery.event_kind]
  const municipality = stringValue(metadata.municipality) ?? outage.municipality ?? 'neuvedena'
  const source = (stringValue(metadata.source) ?? outage.source).toLowerCase()
  const sourceLabel = SOURCE_LABELS[source] ?? source.toUpperCase()
  const announcementUrl = safeHttpsUrl(stringValue(metadata.announcementUrl) ?? outage.announcement_url)
  const sourceUrl = safeHttpsUrl(stringValue(metadata.sourceUrl) ?? outage.source_url)
  const stores: StoreSnapshot[] = matches.map((match) => ({
    matchId: match.id,
    storeId: match.store_id,
    chainName: match.store_chain_name,
    storeNumber: match.store_number,
    city: match.store_city,
    address: match.store_address,
  }))
  const introduction = copy.introduction(storePhrase(stores.length))
  const storeLines = stores.map((store) => `• ${store.chainName} ${store.storeNumber} · ${store.address}, ${store.city}`)
  const storeHtml = stores.map((store) => `<li style="margin:0 0 6px"><strong>${escapeHtml(store.chainName)} ${escapeHtml(store.storeNumber)}</strong> · ${escapeHtml(store.address)}, ${escapeHtml(store.city)}</li>`).join('')
  const detailRows = renderDetailsRows(delivery.event_kind, startsAt, endsAt, previousStartsAt, previousEndsAt, sourceLabel, municipality)
  const actionUrl = announcementUrl ?? sourceUrl
  const actionLabel = announcementUrl ? 'Otevřít oznámení distributora' : 'Otevřít zdroj odstávky'
  const actionHtml = actionUrl ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px;border-collapse:collapse"><tr><td><a href="${escapeHtml(actionUrl)}" style="display:block;padding:14px 18px;border-radius:10px;background:#0788c1;color:#ffffff;text-align:center;text-decoration:none;font-size:14px;font-weight:700">${actionLabel}</a></td></tr></table>` : ''
  const secondaryLinkHtml = announcementUrl && sourceUrl ? `<p style="margin:12px 0 0;text-align:center"><a href="${escapeHtml(sourceUrl)}" style="color:#64748b;font-size:12px">Otevřít zdroj odstávky</a></p>` : ''
  const followUpHtml = copy.followUp ? `<p style="margin:25px 0 0;font-size:15px;line-height:1.7;color:#475569">${escapeHtml(copy.followUp)}</p>` : ''
  const previousText = delivery.event_kind === 'schedule_changed'
    ? [`Původní termín: ${previousStartsAt ? formatDateTime(previousStartsAt) : 'neuveden'}–${previousEndsAt ? formatDateTime(previousEndsAt) : 'neuveden'}`, `Nový termín: ${formatDateTime(startsAt)}–${formatDateTime(endsAt)}`]
    : [`Termín: ${formatDateTime(startsAt)}–${formatDateTime(endsAt)}`]
  const linksText = [announcementUrl ? `Oznámení distributora: ${announcementUrl}` : null, sourceUrl ? `Zdroj odstávky: ${sourceUrl}` : null].filter(Boolean) as string[]
  const text = [
    copy.heading,
    '',
    introduction,
    '',
    ...previousText,
    `Distributor: ${sourceLabel}`,
    `Obec: ${municipality}`,
    `Dotčené prodejny: ${stores.length}`,
    ...storeLines,
    ...(copy.followUp ? ['', copy.followUp] : []),
    ...linksText,
    '',
    'S pozdravem',
    'B-ENERGY',
    '',
    'Automatické upozornění vychází z údajů distributora. Termín nebo rozsah odstávky se může změnit.',
  ].join('\n')
  const html = `<!doctype html><html lang="cs"><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#18212f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f6f8"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:separate;background:#ffffff;border:1px solid #e4e9ef;border-radius:18px;overflow:hidden"><tr><td style="padding:30px 34px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td valign="middle"><img src="cid:b-energy-logo" width="136" alt="B-ENERGY" style="display:block;width:136px;max-width:100%;height:auto;border:0"></td><td align="right" valign="middle"><span style="display:inline-block;padding:7px 11px;border:1px solid #bae6fd;border-radius:999px;background:#f0f9ff;color:#0369a1;font-size:11px;font-weight:700;letter-spacing:.04em">${escapeHtml(copy.badge)}</span></td></tr></table></td></tr><tr><td style="padding:0 34px"><div style="height:1px;background:#e8edf2"></div></td></tr><tr><td style="padding:34px 34px 32px"><div style="margin-bottom:11px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Plánovaná odstávka elektřiny</div><h1 style="margin:0;font-size:28px;line-height:1.28;letter-spacing:-.02em;color:#111827">${escapeHtml(copy.heading)}</h1><p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:#475569">${escapeHtml(introduction)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;border-collapse:collapse;border-top:1px solid #e8edf2">${detailRows}</table><h2 style="margin:24px 0 9px;font-size:14px">${stores.length === 1 ? 'Prodejna' : 'Prodejny'}</h2><ul style="margin:0;padding-left:18px;color:#475569;font-size:13px;line-height:1.65">${storeHtml}</ul>${followUpHtml}${actionHtml}${secondaryLinkHtml}<p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#18212f">S pozdravem<br><strong>B-ENERGY</strong></p></td></tr><tr><td style="padding:20px 34px;background:#fafbfc;border-top:1px solid #e8edf2;color:#7c8798;font-size:11px;line-height:1.6">Automatické upozornění vychází z údajů distributora. Termín nebo rozsah odstávky se může změnit.</td></tr></table></td></tr></table></body></html>`
  const recipientSnapshot = recipients.map((recipient) => ({
    kind: recipient.recipient_kind,
    name: recipient.name ?? '',
    email: recipient.email,
  }))
  const nextAttemptAt = expectedStatus === 'planned'
    ? new Date(Math.max(
      new Date(delivery.created_at).getTime() + 5 * 60_000,
      delivery.next_attempt_at ? new Date(delivery.next_attempt_at).getTime() : 0,
    )).toISOString()
    : null
  let updateQuery = client.from('power_outage_client_email_deliveries').update({
    recipient_snapshot: recipientSnapshot,
    store_snapshot: stores,
    subject_snapshot: copy.subject,
    text_snapshot: text,
    html_snapshot: html,
    ...(nextAttemptAt ? { next_attempt_at: nextAttemptAt } : {}),
    metadata: {
      ...metadata,
      contract: 'market-client-email-production-v1',
      renderedAt: new Date().toISOString(),
      aggregationWindowMinutes: 5,
      fromName: settings.from_name,
      fromEmail: settings.from_email,
      replyToEmail: settings.reply_to_email,
      source,
      externalId: outage.external_id,
      municipality,
      startsAt,
      endsAt,
      previousStartsAt,
      previousEndsAt,
      sourceUrl,
      announcementUrl,
      storeCount: stores.length,
      sendingAttempted: expectedStatus === 'sending',
    },
    updated_at: new Date().toISOString(),
  }).eq('id', delivery.id).eq('delivery_status', expectedStatus)
  if (batchToken) updateQuery = updateQuery.eq('processing_token', batchToken)
  const { error: updateError } = await updateQuery
  if (updateError) throw new Error(`Ostrý e-mail se nepodařilo připravit: ${updateError.message}`)

  return {
    subject: copy.subject,
    html,
    text,
    recipients: recipientSnapshot,
    fromName: settings.from_name,
    fromEmail: settings.from_email,
    replyToEmail: settings.reply_to_email,
  }
}

function upper(value: string) {
  return value.trim().toUpperCase()
}

export async function prepareMarketClientEmailLiveDeliveryForSend(deliveryId: string, batchToken: string) {
  return prepareDelivery(deliveryId, 'sending', batchToken)
}

export async function renderMarketClientEmailLiveDeliveries(limit = 200) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro vykreslení ostrých e-mailů.')
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Velikost dávky ostrých e-mailů musí být mezi 1 a 1000.')
  const { data, error } = await client
    .from('power_outage_client_email_deliveries')
    .select('id')
    .eq('mode_at_plan', 'live')
    .eq('delivery_status', 'planned')
    .order('created_at')
    .limit(limit)
  if (error) throw new Error(`Ostré e-maily se nepodařilo načíst: ${error.message}`)
  let renderedCount = 0
  for (const row of data ?? []) {
    if (await prepareDelivery(row.id as string, 'planned')) renderedCount += 1
  }
  return { renderedCount }
}
