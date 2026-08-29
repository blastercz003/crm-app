import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { getWeatherAlertsRuntimeContext } from '@/lib/weather-alerts/access'
import type {
  WeatherForecastOutlook,
  WeatherForecastPhenomenonKey,
  WeatherInsightFeedKey,
  WeatherInsightFeedStatus,
  WeatherInsightsWorkspace,
  WeatherObservationExtreme,
  WeatherObservationMetricKey,
  WeatherRadarFrame,
  WeatherRadarFrameKind,
} from './types'

const RADAR_SIGNED_URL_TTL_SECONDS = 15 * 60
const VALID_FORECAST_KEYS = new Set<WeatherForecastPhenomenonKey>([
  'wind',
  'thunderstorm',
  'heavy_rain',
  'snow',
  'icing',
  'flood',
])

type FeedStateRow = {
  feed_key: WeatherInsightFeedKey
  last_attempt_at: string | null
  last_success_at: string | null
  last_change_at: string | null
  consecutive_failure_count: number | null
  last_error_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  data_version: number | null
}

type RadarFrameRow = {
  id: string
  frame_kind: WeatherRadarFrameKind
  source_timestamp: string
  valid_at: string
  lead_minutes: number
  storage_bucket: string
  storage_path: string
  width_px: number | null
  height_px: number | null
  bounds: Record<string, unknown> | null
}

type ObservationExtremeRow = {
  id: string
  snapshot_at: string
  metric_key: WeatherObservationMetricKey
  extremum_kind: 'maximum' | 'minimum'
  rank_position: number
  station_code: string
  station_name: string
  latitude: number | null
  longitude: number | null
  value: number
  unit: string
  metadata: Record<string, unknown> | null
}

type ForecastSnapshotRow = {
  id: string
  issued_at: string
  valid_from: string
  valid_to: string
  scope_type: 'national' | 'regional'
  region_code: string
  region_name: string
  headline: string | null
  text_weather: string | null
  text_wind: string | null
  relevant_phenomena: unknown
  metadata: Record<string, unknown> | null
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeBounds(value: Record<string, unknown> | null) {
  const west = finiteNumber(value?.west)
  const south = finiteNumber(value?.south)
  const east = finiteNumber(value?.east)
  const north = finiteNumber(value?.north)
  if (
    west === null ||
    south === null ||
    east === null ||
    north === null ||
    west >= east ||
    south >= north
  ) {
    throw new Error('Radarový snímek má neplatné geografické hranice.')
  }
  return { west, south, east, north }
}

function normalizeRelevantPhenomena(value: unknown) {
  if (!Array.isArray(value)) return []
  const result: WeatherForecastOutlook['relevantPhenomena'] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const key = typeof record.key === 'string' ? record.key : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const textComment =
      typeof record.textComment === 'string' ? record.textComment.trim() : ''
    const source = record.source
    if (
      !VALID_FORECAST_KEYS.has(key as WeatherForecastPhenomenonKey) ||
      !name ||
      (source !== 'structured' && source !== 'forecast_text')
    ) {
      continue
    }
    result.push({
      key: key as WeatherForecastPhenomenonKey,
      name,
      textComment,
      source,
    })
  }
  return result
}

function feedStatus(row: FeedStateRow): WeatherInsightFeedStatus {
  return {
    feedKey: row.feed_key,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastChangeAt: row.last_change_at,
    consecutiveFailureCount: row.consecutive_failure_count ?? 0,
    lastErrorAt: row.last_error_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    dataVersion: row.data_version ?? 0,
  }
}

async function signedRadarFrames(rows: RadarFrameRow[]) {
  if (rows.length === 0) return []
  const serviceClient = getServiceRoleClient()
  if (!serviceClient) {
    throw new Error('Pro radarové snímky není dostupné zabezpečené úložiště.')
  }
  const expiresAt = new Date(
    Date.now() + RADAR_SIGNED_URL_TTL_SECONDS * 1_000,
  ).toISOString()

  const frames = await Promise.all(
    rows.map(async (row): Promise<WeatherRadarFrame> => {
      const { data, error } = await serviceClient.storage
        .from(row.storage_bucket)
        .createSignedUrl(row.storage_path, RADAR_SIGNED_URL_TTL_SECONDS)
      if (error || !data?.signedUrl) {
        throw new Error(
          `Radarový snímek ${row.id} se nepodařilo bezpečně zpřístupnit.`,
        )
      }
      return {
        id: row.id,
        frameKind: row.frame_kind,
        validAt: row.valid_at,
        sourceTimestamp: row.source_timestamp,
        leadMinutes: row.lead_minutes,
        imageUrl: data.signedUrl,
        imageUrlExpiresAt: expiresAt,
        width: row.width_px,
        height: row.height_px,
        bounds: normalizeBounds(row.bounds),
      }
    }),
  )
  return frames.sort(
    (left, right) =>
      new Date(left.validAt).getTime() - new Date(right.validAt).getTime(),
  )
}

function latestObservationExtremes(rows: ObservationExtremeRow[]) {
  const latestSnapshotAt = rows[0]?.snapshot_at ?? null
  if (!latestSnapshotAt) return { snapshotAt: null, extremes: [] }
  const extremes: WeatherObservationExtreme[] = rows
    .filter((row) => row.snapshot_at === latestSnapshotAt)
    .map((row) => ({
      id: row.id,
      snapshotAt: row.snapshot_at,
      metricKey: row.metric_key,
      extremumKind: row.extremum_kind,
      rank: row.rank_position,
      stationCode: row.station_code,
      stationName: row.station_name,
      latitude: row.latitude,
      longitude: row.longitude,
      value: row.value,
      unit: row.unit,
      observedAt:
        typeof row.metadata?.observedAt === 'string'
          ? row.metadata.observedAt
          : null,
    }))
    .sort((left, right) => {
      const metricDifference = left.metricKey.localeCompare(right.metricKey)
      return metricDifference || left.rank - right.rank
    })
  return { snapshotAt: latestSnapshotAt, extremes }
}

function latestForecastOutlooks(rows: ForecastSnapshotRow[], now: number) {
  const latestByStream = new Map<string, ForecastSnapshotRow>()
  for (const row of rows) {
    const streamId =
      typeof row.metadata?.dataStreamId === 'string'
        ? row.metadata.dataStreamId
        : `${row.valid_from}:${row.valid_to}`
    const key = `${row.scope_type}:${row.region_code}:${streamId}`
    if (!latestByStream.has(key)) latestByStream.set(key, row)
  }

  const outlooks: WeatherForecastOutlook[] = []
  for (const row of latestByStream.values()) {
    if (new Date(row.valid_to).getTime() <= now) continue
    const relevantPhenomena = normalizeRelevantPhenomena(row.relevant_phenomena)
    if (relevantPhenomena.length === 0) continue
    outlooks.push({
      id: row.id,
      issuedAt: row.issued_at,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      scopeType: row.scope_type,
      regionCode: row.region_code,
      regionName: row.region_name,
      headline: row.headline,
      textWeather: row.text_weather,
      textWind: row.text_wind,
      relevantPhenomena,
    })
  }
  outlooks.sort((left, right) => {
    const timeDifference =
      new Date(left.validFrom).getTime() - new Date(right.validFrom).getTime()
    if (timeDifference !== 0) return timeDifference
    if (left.scopeType !== right.scopeType) {
      return left.scopeType === 'national' ? -1 : 1
    }
    return left.regionName.localeCompare(right.regionName, 'cs')
  })
  const issuedAt = rows.map((row) => row.issued_at).sort().at(-1) ?? null
  return { issuedAt, outlooks }
}

export async function getWeatherInsightsWorkspace(): Promise<WeatherInsightsWorkspace> {
  const { supabase } = await getWeatherAlertsRuntimeContext()
  const now = Date.now()
  const radarFrom = new Date(now - 2 * 60 * 60 * 1_000).toISOString()
  const forecastFrom = new Date(now - 6 * 60 * 60 * 1_000).toISOString()

  const [feedResult, radarResult, observationResult, forecastResult] =
    await Promise.all([
      supabase
        .from('weather_feed_state')
        .select(
          'feed_key,last_attempt_at,last_success_at,last_change_at,consecutive_failure_count,last_error_at,last_error_code,last_error_message,data_version',
        )
        .order('feed_key'),
      supabase
        .from('weather_radar_frames')
        .select(
          'id,frame_kind,source_timestamp,valid_at,lead_minutes,storage_bucket,storage_path,width_px,height_px,bounds',
        )
        .gte('valid_at', radarFrom)
        .order('valid_at', { ascending: true })
        .limit(40),
      supabase
        .from('weather_observation_extremes')
        .select(
          'id,snapshot_at,metric_key,extremum_kind,rank_position,station_code,station_name,latitude,longitude,value,unit,metadata',
        )
        .order('snapshot_at', { ascending: false })
        .order('metric_key')
        .order('rank_position')
        .limit(60),
      supabase
        .from('weather_forecast_snapshots')
        .select(
          'id,issued_at,valid_from,valid_to,scope_type,region_code,region_name,headline,text_weather,text_wind,relevant_phenomena,metadata',
        )
        .gte('valid_to', forecastFrom)
        .order('issued_at', { ascending: false })
        .limit(500),
    ])

  const error =
    feedResult.error ??
    radarResult.error ??
    observationResult.error ??
    forecastResult.error
  if (error) {
    throw new Error(`Doplňková data ČHMÚ se nepodařilo načíst: ${error.message}`)
  }

  const radarFrames = await signedRadarFrames(
    (radarResult.data ?? []) as unknown as RadarFrameRow[],
  )
  const observations = latestObservationExtremes(
    (observationResult.data ?? []) as unknown as ObservationExtremeRow[],
  )
  const forecast = latestForecastOutlooks(
    (forecastResult.data ?? []) as unknown as ForecastSnapshotRow[],
    now,
  )

  return {
    generatedAt: new Date().toISOString(),
    feeds: ((feedResult.data ?? []) as unknown as FeedStateRow[]).map(feedStatus),
    radar: {
      frames: radarFrames,
      latestObservationAt:
        radarFrames
          .filter((frame) => frame.frameKind === 'observation')
          .map((frame) => frame.validAt)
          .sort()
          .at(-1) ?? null,
      latestForecastAt:
        radarFrames
          .filter((frame) => frame.frameKind === 'forecast')
          .map((frame) => frame.validAt)
          .sort()
          .at(-1) ?? null,
    },
    observations,
    forecast,
  }
}
