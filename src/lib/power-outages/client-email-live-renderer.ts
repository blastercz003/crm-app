import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'

type DeliveryRow = {
  id: string
  client_id: string
  outage_id: string | null
  event_kind: 'new_outage' | 'schedule_changed' | 'cancelled' | 'reminder_24h'
  recipient_snapshot: unknown
  store_snapshot: unknown
  metadata: unknown
  created_at: string
  next_attempt_at: string | null
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
}

type StoreSnapshot = {
  chainName: string
  storeNumber: string
  city: string
  address: string
}

const EVENT_LABELS: Record<DeliveryRow['event_kind'], string> = {
  new_outage: 'Nová potvrzená odstávka',
  schedule_changed: 'Změna termínu odstávky',
  cancelled: 'Zrušení plánované odstávky',
  reminder_24h: 'Připomenutí plánované odstávky',
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

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

function storesFromSnapshot(value: unknown): StoreSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    return [{
      chainName: typeof row.chainName === 'string' ? row.chainName : '',
      storeNumber: typeof row.storeNumber === 'string' ? row.storeNumber : '',
      city: typeof row.city === 'string' ? row.city : '',
      address: typeof row.address === 'string' ? row.address : '',
    }]
  })
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Odstávka nemá platný termín.')
  return DATE_TIME_FORMATTER.format(date)
}

export async function renderMarketClientEmailLiveDeliveries(limit = 200) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro vykreslení ostrých e-mailů.')
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Velikost dávky ostrých e-mailů musí být mezi 1 a 1000.')
  }

  const { data: deliveryData, error: deliveryError } = await client
    .from('power_outage_client_email_deliveries')
    .select('id,client_id,outage_id,event_kind,recipient_snapshot,store_snapshot,metadata,created_at,next_attempt_at')
    .eq('mode_at_plan', 'live')
    .eq('delivery_status', 'planned')
    .order('created_at')
    .limit(limit)
  if (deliveryError) throw new Error(`Ostré e-maily se nepodařilo načíst: ${deliveryError.message}`)

  const deliveries = (deliveryData ?? []) as DeliveryRow[]
  if (deliveries.length === 0) return { renderedCount: 0 }

  const clientIds = [...new Set(deliveries.map((delivery) => delivery.client_id))]
  const outageIds = [...new Set(deliveries.flatMap((delivery) => delivery.outage_id ? [delivery.outage_id] : []))]
  const [settingsResult, outagesResult] = await Promise.all([
    client
      .from('power_outage_client_email_settings')
      .select('client_id,client_name_snapshot,chain_name,mode,from_name,from_email,reply_to_email')
      .in('client_id', clientIds),
    client
      .from('power_outages')
      .select('id,source,external_id,title,starts_at,ends_at,municipality,source_url,announcement_url')
      .in('id', outageIds),
  ])
  if (settingsResult.error) throw new Error(`Nastavení ostrých e-mailů se nepodařilo načíst: ${settingsResult.error.message}`)
  if (outagesResult.error) throw new Error(`Odstávky pro ostré e-maily se nepodařilo načíst: ${outagesResult.error.message}`)

  const settingsByClient = new Map(
    ((settingsResult.data ?? []) as SettingsRow[]).map((settings) => [settings.client_id, settings]),
  )
  const outagesById = new Map(
    ((outagesResult.data ?? []) as OutageRow[]).map((outage) => [outage.id, outage]),
  )

  let renderedCount = 0
  for (const delivery of deliveries) {
    const settings = settingsByClient.get(delivery.client_id)
    const outage = delivery.outage_id ? outagesById.get(delivery.outage_id) : null
    if (!settings || settings.mode !== 'live' || !outage) continue
    if (!settings.from_name || !settings.from_email) {
      throw new Error(`Klient ${settings.client_name_snapshot} nemá platného odesílatele.`)
    }

    const stores = storesFromSnapshot(delivery.store_snapshot)
    if (stores.length === 0) continue
    const eventLabel = EVENT_LABELS[delivery.event_kind]
    const startsAt = formatDateTime(outage.starts_at)
    const endsAt = formatDateTime(outage.ends_at)
    const municipality = outage.municipality || 'neuvedena'
    const source = outage.source.toUpperCase()
    const announcementUrl = safeHttpsUrl(outage.announcement_url)
    const sourceUrl = safeHttpsUrl(outage.source_url)
    const storeLines = stores.map((store) =>
      `• ${store.chainName || settings.chain_name} ${store.storeNumber} · ${store.address}, ${store.city}`,
    )
    const storeHtml = stores.map((store) =>
      `<li><strong>${escapeHtml(store.chainName || settings.chain_name)} ${escapeHtml(store.storeNumber)}</strong> · ${escapeHtml(store.address)}, ${escapeHtml(store.city)}</li>`,
    ).join('')
    const linksText = [
      announcementUrl ? `PDF oznámení: ${announcementUrl}` : null,
      sourceUrl ? `Zdroj: ${sourceUrl}` : null,
    ].filter(Boolean)
    const linksHtml = [
      announcementUrl ? `<p style="margin:22px 0 0"><a href="${escapeHtml(announcementUrl)}" style="color:#0369a1;font-weight:700">Otevřít PDF oznámení</a></p>` : '',
      sourceUrl ? `<p style="margin:10px 0 0"><a href="${escapeHtml(sourceUrl)}" style="color:#0369a1">Otevřít zdroj odstávky</a></p>` : '',
    ].join('')
    const minimumAttemptAt = new Date(new Date(delivery.created_at).getTime() + 5 * 60_000)
    const previousAttemptAt = delivery.next_attempt_at ? new Date(delivery.next_attempt_at) : null
    const nextAttemptAt = previousAttemptAt && previousAttemptAt > minimumAttemptAt
      ? previousAttemptAt
      : minimumAttemptAt

    const { error: updateError } = await client
      .from('power_outage_client_email_deliveries')
      .update({
        subject_snapshot: `${settings.client_name_snapshot}: ${eventLabel} · ${outage.municipality || 'bez určení obce'} (${source})`,
        text_snapshot: [
          eventLabel,
          '',
          `Klient: ${settings.client_name_snapshot}`,
          `Zdroj: ${source}`,
          `Odstávka: ${outage.title || 'Plánovaná odstávka elektřiny'}`,
          `Termín: ${startsAt}–${endsAt}`,
          `Obec: ${municipality}`,
          `Dotčené prodejny: ${stores.length}`,
          ...storeLines,
          ...linksText,
          '',
          'Toto je automatické upozornění na odstávku elektřiny.',
        ].join('\n'),
        html_snapshot: `<!doctype html><html lang="cs"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:680px;margin:0 auto;padding:24px"><div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:28px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#64748b;text-transform:uppercase">${escapeHtml(settings.client_name_snapshot)} · ${escapeHtml(source)}</div><h1 style="margin:10px 0 20px;font-size:24px;line-height:1.25">${escapeHtml(eventLabel)}</h1><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0;color:#64748b">Termín</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(startsAt)}–${escapeHtml(endsAt)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Obec</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(municipality)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Dotčené prodejny</td><td style="padding:8px 0;text-align:right;font-weight:700">${stores.length}</td></tr></table><h2 style="margin:24px 0 10px;font-size:17px">Prodejny</h2><ul style="margin:0;padding-left:20px;line-height:1.7">${storeHtml}</ul>${linksHtml}<p style="margin:24px 0 0;font-size:12px;color:#64748b">Toto je automatické upozornění na odstávku elektřiny.</p></div></div></body></html>`,
        next_attempt_at: nextAttemptAt.toISOString(),
        metadata: {
          ...objectValue(delivery.metadata),
          contract: 'market-client-email-live-pilot-v1',
          renderedAt: new Date().toISOString(),
          aggregationWindowMinutes: 5,
          fromName: settings.from_name,
          fromEmail: settings.from_email,
          replyToEmail: settings.reply_to_email,
          source: outage.source,
          externalId: outage.external_id,
          municipality: outage.municipality,
          startsAt: outage.starts_at,
          endsAt: outage.ends_at,
          sourceUrl,
          announcementUrl,
          storeCount: stores.length,
          sendingAttempted: false,
        },
      })
      .eq('id', delivery.id)
      .eq('delivery_status', 'planned')
      .eq('mode_at_plan', 'live')
    if (updateError) throw new Error(`Ostrý e-mail se nepodařilo připravit: ${updateError.message}`)
    renderedCount += 1
  }

  return { renderedCount }
}
