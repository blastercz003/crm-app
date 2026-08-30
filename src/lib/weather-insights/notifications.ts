import 'server-only'

import { createHash } from 'node:crypto'
import { createNotification } from '@/lib/notifications/createNotification'
import { getServiceRoleClient } from '@/lib/supabase/service'
import type {
  WeatherForecastPhenomenonKey,
  WeatherObservationMetricKey,
} from './types'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>
type DeliveryStatus = 'created' | 'deduplicated' | 'failed'

type PreferenceRow = {
  user_id: string
  updated_at: string
}

type ForecastPhenomenon = {
  key: WeatherForecastPhenomenonKey
  name: string
  textComment?: string
  source: 'structured' | 'forecast_text'
}

type ForecastRow = {
  issued_at: string
  valid_from: string
  valid_to: string
  scope_type: 'national' | 'regional'
  region_code: string
  region_name: string
  relevant_phenomena: ForecastPhenomenon[] | null
}

type OfficialEventRow = {
  hazard_type: string
  onset_at: string | null
  valid_to: string | null
}

type ObservationRow = {
  snapshot_at: string
  metric_key: WeatherObservationMetricKey
  station_name: string
  value: number
  unit: string
}

type ForecastCandidate = {
  phenomenonKey: WeatherForecastPhenomenonKey
  phenomenonName: string
  validFrom: string
  validTo: string
  regions: string[]
  sourceKey: string
}

export type WeatherInsightNotificationResult = {
  createdCount: number
  deduplicatedCount: number
  failedCount: number
  skippedCount: number
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const FORECAST_HORIZON_MS = 36 * 60 * 60 * 1_000
const FORECAST_COOLDOWN_MS = 12 * 60 * 60 * 1_000
const FORECAST_DAILY_LIMIT = 3

const PHENOMENON_LABELS: Record<WeatherForecastPhenomenonKey, string> = {
  wind: 'SILNÝ VÍTR',
  thunderstorm: 'BOUŘKY',
  heavy_rain: 'SILNÉ SRÁŽKY',
  snow: 'SNĚŽENÍ',
  icing: 'NÁMRAZA',
  flood: 'POVODŇOVÉ JEVY',
}

const OFFICIAL_HAZARD_KEYS: Record<WeatherForecastPhenomenonKey, string> = {
  wind: 'wind',
  thunderstorm: 'thunderstorm',
  heavy_rain: 'rain',
  snow: 'snow',
  icing: 'ice_load',
  flood: 'flood',
}

function emptyResult(): WeatherInsightNotificationResult {
  return { createdCount: 0, deduplicatedCount: 0, failedCount: 0, skippedCount: 0 }
}

function pragueParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour')),
  }
}

function preferenceStartsNextDay(preferenceUpdatedAt: string, now: Date) {
  const current = pragueParts(now)
  const updated = pragueParts(new Date(preferenceUpdatedAt))
  return updated.dateKey === current.dateKey && updated.hour >= 9
}

function formatPeriod(validFrom: string, validTo: string) {
  const formatter = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${formatter.format(new Date(validFrom))}–${formatter.format(new Date(validTo))}`
}

function areaSummary(regions: string[]) {
  if (regions.includes('Česká republika')) return 'celá Česká republika'
  if (regions.length <= 2) return regions.join(' a ')
  return `${regions.slice(0, 2).join(', ')} a další ${regions.length - 2}`
}

function overlaps(
  candidate: ForecastCandidate,
  event: OfficialEventRow,
) {
  const candidateStart = new Date(candidate.validFrom).getTime()
  const candidateEnd = new Date(candidate.validTo).getTime()
  const eventStart = event.onset_at ? new Date(event.onset_at).getTime() : -Infinity
  const eventEnd = event.valid_to ? new Date(event.valid_to).getTime() : Infinity
  return candidateStart < eventEnd && candidateEnd > eventStart
}

async function extendedPreferences(client: ServiceClient) {
  const { data, error } = await client
    .from('weather_notification_preferences')
    .select('user_id,updated_at')
    .eq('notifications_enabled', true)
    .eq('extended_notifications_enabled', true)
  if (error) throw error
  const preferences = (data ?? []) as PreferenceRow[]
  if (preferences.length === 0) return []

  const { data: profiles, error: profileError } = await client
    .from('profiles')
    .select('id')
    .in('id', preferences.map((preference) => preference.user_id))
    .eq('can_view_weather_alerts', true)
  if (profileError) throw profileError
  const allowed = new Set((profiles ?? []).map((profile) => profile.id as string))
  return preferences.filter((preference) => allowed.has(preference.user_id))
}

async function storeDelivery(
  client: ServiceClient,
  input: {
    userId: string
    signalType: 'forecast' | 'daily_summary'
    phenomenonKey: string | null
    sourceKey: string
    dedupeKey: string
    status: DeliveryStatus
    notificationId: string | null
    payload: Record<string, unknown>
    errorMessage: string | null
  },
) {
  const now = new Date().toISOString()
  const { error } = await client.from('weather_insight_notification_deliveries').upsert(
    {
      user_id: input.userId,
      signal_type: input.signalType,
      phenomenon_key: input.phenomenonKey,
      source_key: input.sourceKey,
      dedupe_key: input.dedupeKey,
      delivery_status: input.status,
      notification_id: input.notificationId,
      payload: input.payload,
      error_message: input.errorMessage,
      updated_at: now,
    },
    { onConflict: 'dedupe_key' },
  )
  if (error) throw error
}

async function recordNotification(
  client: ServiceClient,
  input: {
    userId: string
    signalType: 'forecast' | 'daily_summary'
    phenomenonKey: string | null
    sourceKey: string
    dedupeKey: string
    title: string
    message: string
    href: string
    payload: Record<string, unknown>
  },
) {
  try {
    const notification = await createNotification({
      supabase: client,
      recipientUserId: input.userId,
      actorUserId: null,
      category: 'weather',
      type: input.signalType === 'forecast'
        ? 'weather_forecast_signal'
        : 'weather_daily_summary',
      title: input.title,
      message: input.message,
      entityType: input.signalType === 'forecast'
        ? 'weather_forecast'
        : 'weather_observations',
      href: input.href,
      priority: 'normal',
      dedupeKey: input.dedupeKey,
      skipSelfNotification: false,
      returnExistingOnDuplicate: true,
    })
    if (!notification) throw new Error('Notifikaci se nepodařilo vytvořit.')
    const status: DeliveryStatus = notification.deduplicated ? 'deduplicated' : 'created'
    await storeDelivery(client, {
      ...input,
      status,
      notificationId: notification.id,
      payload: {
        ...input.payload,
        pushDelivery: notification.deduplicated
          ? { attempted: false, reason: 'deduplicated' }
          : notification.pushDelivery
            ? { ...notification.pushDelivery }
            : { attempted: false, reason: 'push-result-unavailable' },
      },
      errorMessage: null,
    })
    return status
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Neznámá chyba doručení.'
    try {
      await storeDelivery(client, {
        ...input,
        status: 'failed',
        notificationId: null,
        errorMessage: errorMessage.slice(0, 2_000),
      })
    } catch (deliveryError) {
      console.error('Nepodařilo se uložit chybu rozšířeného upozornění.', deliveryError)
    }
    throw error
  }
}

function forecastCandidates(rows: ForecastRow[], now: Date) {
  const groups = new Map<string, Omit<ForecastCandidate, 'sourceKey'>>()
  const nowTime = now.getTime()
  for (const row of rows) {
    const start = new Date(row.valid_from).getTime()
    const end = new Date(row.valid_to).getTime()
    if (end <= nowTime || start > nowTime + FORECAST_HORIZON_MS) continue
    for (const phenomenon of row.relevant_phenomena ?? []) {
      if (phenomenon.source !== 'structured') continue
      const key = `${phenomenon.key}:${row.valid_from}:${row.valid_to}`
      const existing = groups.get(key) ?? {
        phenomenonKey: phenomenon.key,
        phenomenonName: phenomenon.name || PHENOMENON_LABELS[phenomenon.key],
        validFrom: row.valid_from,
        validTo: row.valid_to,
        regions: [],
      }
      if (row.scope_type === 'national') existing.regions = ['Česká republika']
      else if (!existing.regions.includes('Česká republika')) existing.regions.push(row.region_name)
      groups.set(key, existing)
    }
  }
  return [...groups.values()].map((candidate) => {
    const regions = [...new Set(candidate.regions)].sort((left, right) => left.localeCompare(right, 'cs'))
    const sourceKey = createHash('sha256')
      .update(`${candidate.phenomenonKey}|${candidate.validFrom}|${candidate.validTo}|${regions.join('|')}`)
      .digest('hex')
    return { ...candidate, regions, sourceKey }
  })
}

export async function dispatchForecastInsightNotifications(input: {
  issuedAt: string
  now?: Date
}): Promise<WeatherInsightNotificationResult> {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro rozšířená upozornění.')
  const now = input.now ?? new Date()
  const result = emptyResult()
  const [preferenceData, forecastData, eventData] = await Promise.all([
    extendedPreferences(client),
    client
      .from('weather_forecast_snapshots')
      .select('issued_at,valid_from,valid_to,scope_type,region_code,region_name,relevant_phenomena')
      .eq('issued_at', input.issuedAt),
    client
      .from('weather_events')
      .select('hazard_type,onset_at,valid_to')
      .in('status', ['upcoming', 'active']),
  ])
  if (forecastData.error) throw forecastData.error
  if (eventData.error) throw eventData.error
  const preferences = preferenceData
  const issuedTime = new Date(input.issuedAt).getTime()
  const officialEvents = (eventData.data ?? []) as OfficialEventRow[]
  const candidates = forecastCandidates((forecastData.data ?? []) as ForecastRow[], now)
    .filter((candidate) => !officialEvents.some((event) =>
      event.hazard_type === OFFICIAL_HAZARD_KEYS[candidate.phenomenonKey]
      && overlaps(candidate, event),
    ))

  for (const preference of preferences) {
    if (new Date(preference.updated_at).getTime() >= issuedTime) {
      result.skippedCount += candidates.length
      continue
    }
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString()
    const { count, error: countError } = await client
      .from('weather_insight_notification_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', preference.user_id)
      .eq('signal_type', 'forecast')
      .in('delivery_status', ['created', 'deduplicated'])
      .gte('created_at', dayAgo)
    if (countError) throw countError
    let remaining = Math.max(0, FORECAST_DAILY_LIMIT - (count ?? 0))

    for (const candidate of candidates) {
      if (remaining <= 0) {
        result.skippedCount += 1
        continue
      }
      const cooldownFrom = new Date(now.getTime() - FORECAST_COOLDOWN_MS).toISOString()
      const { data: recent, error: recentError } = await client
        .from('weather_insight_notification_deliveries')
        .select('id')
        .eq('user_id', preference.user_id)
        .eq('signal_type', 'forecast')
        .eq('phenomenon_key', candidate.phenomenonKey)
        .in('delivery_status', ['created', 'deduplicated'])
        .gte('created_at', cooldownFrom)
        .limit(1)
      if (recentError) throw recentError
      if ((recent ?? []).length > 0) {
        result.skippedCount += 1
        continue
      }

      const dedupeKey = `weather-insight:forecast:${preference.user_id}:${candidate.sourceKey}`
      try {
        const status = await recordNotification(client, {
          userId: preference.user_id,
          signalType: 'forecast',
          phenomenonKey: candidate.phenomenonKey,
          sourceKey: candidate.sourceKey,
          dedupeKey,
          title: `VÝHLED ČHMÚ: ${PHENOMENON_LABELS[candidate.phenomenonKey]}`,
          message: `${formatPeriod(candidate.validFrom, candidate.validTo)} · ${areaSummary(candidate.regions)}. Předběžná informace, zatím bez oficiální výstrahy ČHMÚ.`,
          href: '/weather-alerts#weather-outlook',
          payload: candidate,
        })
        if (status === 'deduplicated') result.deduplicatedCount += 1
        else result.createdCount += 1
        remaining -= 1
      } catch {
        result.failedCount += 1
      }
    }
  }
  return result
}

function selectDailyExtremes(rows: ObservationRow[]) {
  const selected = new Map<WeatherObservationMetricKey, ObservationRow>()
  for (const row of rows) {
    const current = selected.get(row.metric_key)
    const shouldReplace = !current
      || (row.metric_key === 'temperature_min' ? row.value < current.value : row.value > current.value)
    if (shouldReplace) selected.set(row.metric_key, row)
  }
  return selected
}

function formatMetric(row: ObservationRow | undefined, prefix: string) {
  if (!row) return null
  const value = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 }).format(row.value)
  return `${prefix} ${value} ${row.unit} ${row.station_name}`
}

export async function dispatchDailyWeatherSummary(input: {
  now?: Date
} = {}): Promise<WeatherInsightNotificationResult> {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro denní přehled počasí.')
  const now = input.now ?? new Date()
  const local = pragueParts(now)
  const result = emptyResult()
  if (local.hour < 9) return result

  const preferences = await extendedPreferences(client)
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString()
  const { data, error } = await client
    .from('weather_observation_extremes')
    .select('snapshot_at,metric_key,station_name,value,unit')
    .gte('snapshot_at', from)
  if (error) throw error
  const extremes = selectDailyExtremes((data ?? []) as ObservationRow[])
  const parts = [
    formatMetric(extremes.get('temperature_max'), 'max.'),
    formatMetric(extremes.get('temperature_min'), 'min.'),
    formatMetric(extremes.get('wind_gust_max'), 'vítr'),
    formatMetric(extremes.get('precipitation_max'), 'srážky'),
  ].filter((part): part is string => Boolean(part))
  if (parts.length === 0) {
    result.skippedCount += preferences.length
    return result
  }

  for (const preference of preferences) {
    // Zapnutí před 09:00 zahrne uživatele ještě do dnešního přehledu.
    // Zapnutí v 09:00 nebo později začne platit od následujícího dne.
    if (preferenceStartsNextDay(preference.updated_at, now)) {
      result.skippedCount += 1
      continue
    }
    const dedupeKey = `weather-insight:daily:${preference.user_id}:${local.dateKey}`
    try {
      const status = await recordNotification(client, {
        userId: preference.user_id,
        signalType: 'daily_summary',
        phenomenonKey: null,
        sourceKey: local.dateKey,
        dedupeKey,
        title: 'DENNÍ METEOROLOGICKÝ PŘEHLED',
        message: `Posledních 24 h: ${parts.join(', ')}.`,
        href: '/weather-alerts#weather-observations',
        payload: { dateKey: local.dateKey, metrics: Object.fromEntries(extremes) },
      })
      if (status === 'deduplicated') result.deduplicatedCount += 1
      else result.createdCount += 1
    } catch {
      result.failedCount += 1
    }
  }
  return result
}
