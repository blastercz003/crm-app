export const WEATHER_INSIGHT_FEED_KEYS = [
  'radar',
  'observations',
  'forecast',
] as const

export type WeatherInsightFeedKey = (typeof WEATHER_INSIGHT_FEED_KEYS)[number]

export type WeatherFeedState = {
  feedKey: WeatherInsightFeedKey
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastChangeAt: string | null
  latestSourceRef: string | null
  latestPayloadSha256: string | null
  consecutiveFailureCount: number
  dataVersion: number
  metadata: Record<string, unknown>
}

export type WeatherFeedSyncSuccess = {
  changed: boolean
  sourceRef?: string | null
  payloadSha256?: string | null
  metadata?: Record<string, unknown>
}

export type ChmiResourceKind =
  | 'html'
  | 'json'
  | 'xml'
  | 'png'
  | 'archive'

export type ChmiDownloadedResource = {
  url: string
  bytes: Uint8Array
  contentType: string | null
  etag: string | null
  lastModifiedAt: string | null
  payloadSha256: string
}

export type WeatherRadarFrameKind = 'observation' | 'forecast'

export type WeatherRadarSyncResult = WeatherFeedSyncSuccess & {
  observationFrameCount: number
  forecastFrameCount: number
  insertedFrameCount: number
  retainedFrameCount: number
  removedFrameCount: number
}

export type WeatherObservationMetricKey =
  | 'temperature_max'
  | 'temperature_min'
  | 'wind_gust_max'
  | 'precipitation_max'

export type WeatherObservationSyncResult = WeatherFeedSyncSuccess & {
  monitoredStationCount: number
  reportingStationCount: number
  insertedExtremeCount: number
  snapshotAt: string
}

export type WeatherForecastPhenomenonKey =
  | 'wind'
  | 'thunderstorm'
  | 'heavy_rain'
  | 'snow'
  | 'icing'
  | 'flood'

export type WeatherForecastSyncResult = WeatherFeedSyncSuccess & {
  downloadedFileCount: number
  nationalSnapshotCount: number
  regionalSnapshotCount: number
  relevantSnapshotCount: number
  insertedSnapshotCount: number
  issuedAt: string
}

export type WeatherInsightFeedStatus = {
  feedKey: WeatherInsightFeedKey
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastChangeAt: string | null
  consecutiveFailureCount: number
  lastErrorAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  dataVersion: number
}

export type WeatherRadarFrame = {
  id: string
  frameKind: WeatherRadarFrameKind
  validAt: string
  sourceTimestamp: string
  leadMinutes: number
  imageUrl: string
  imageUrlExpiresAt: string
  width: number | null
  height: number | null
  bounds: {
    west: number
    south: number
    east: number
    north: number
  }
}

export type WeatherObservationExtreme = {
  id: string
  snapshotAt: string
  metricKey: WeatherObservationMetricKey
  extremumKind: 'maximum' | 'minimum'
  rank: number
  stationCode: string
  stationName: string
  latitude: number | null
  longitude: number | null
  value: number
  unit: string
  observedAt: string | null
}

export type WeatherForecastOutlook = {
  id: string
  issuedAt: string
  validFrom: string
  validTo: string
  scopeType: 'national' | 'regional'
  regionCode: string
  regionName: string
  headline: string | null
  textWeather: string | null
  textWind: string | null
  dangerousPhenomena: Array<{
    name: string
    textComment: string
  }>
  relevantPhenomena: Array<{
    key: WeatherForecastPhenomenonKey
    name: string
    textComment: string
    source: 'structured' | 'forecast_text'
  }>
  sourceUrl: string | null
  sourceFileName: string | null
  senderName: string | null
}

export type WeatherInsightsWorkspace = {
  generatedAt: string
  feeds: WeatherInsightFeedStatus[]
  radar: {
    frames: WeatherRadarFrame[]
    latestObservationAt: string | null
    latestForecastAt: string | null
  }
  observations: {
    snapshotAt: string | null
    extremes: WeatherObservationExtreme[]
  }
  forecast: {
    issuedAt: string | null
    outlooks: WeatherForecastOutlook[]
  }
}
