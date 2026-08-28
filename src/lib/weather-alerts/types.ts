export const CHMI_SOURCE = 'chmi' as const
export const CHMI_BULLETIN_TYPE = 'XOCZ50' as const

export type WeatherHazardType =
  | 'wind'
  | 'snow'
  | 'ice_load'
  | 'thunderstorm'
  | 'rain'
  | 'flood'

export type ChmiDirectoryCandidate = {
  fileName: string
  url: string
  lastModifiedAt: string
  sizeBytes: number | null
}

export type WeatherAreaCode = {
  type: string
  value: string
}

export type WeatherArea = {
  name: string
  altitude: number | null
  ceiling: number | null
  codes: WeatherAreaCode[]
}

export type NormalizedWeatherSegment = {
  segmentIndex: number
  language: string
  eventName: string
  primaryEventCode: string | null
  eventCodes: string[]
  hazardType: WeatherHazardType | null
  urgency: string | null
  severity: string | null
  certainty: string | null
  effectiveAt: string | null
  onsetAt: string | null
  expiresAt: string | null
  eventEndingAt: string | null
  headline: string | null
  description: string | null
  instruction: string | null
  situation: string | null
  criterion: string | null
  sourceWebUrl: string | null
  awarenessLevel: string | null
  awarenessType: string | null
  parameters: Record<string, string | string[]>
  areas: WeatherArea[]
  isRelevantHazard: boolean
  isActiveWarning: boolean
  segmentSha256: string
}

export type ParsedChmiCapMessage = {
  identifier: string
  sender: string
  sentAt: string
  status: string
  messageType: string
  scope: string
  referencesText: string | null
  sourceCodes: string[]
  segments: NormalizedWeatherSegment[]
}

export type WeatherImportResult = {
  status: 'success' | 'unchanged'
  syncRunId: string
  candidateFileName: string
  sourceMessageId: string | null
  discoveredFileCount: number
  processedSegmentCount: number
  relevantSegmentCount: number
  activeRelevantSegmentCount: number
  downloaded: boolean
}

export type WeatherReconciliationResult = {
  activeEventCount: number
  newEventCount: number
  updatedEventCount: number
  endedEventCount: number
  notificationCandidateCount: number
  dataChanged: boolean
}

export type WeatherNotificationPreferences = {
  notificationsEnabled: boolean
  includeYellowWarnings: boolean
  updatedAt: string | null
}

export type WeatherNotificationDispatchResult = {
  createdCount: number
  deduplicatedCount: number
  failedCount: number
  skippedCount: number
}

export type WeatherEventStatus = 'upcoming' | 'active' | 'ended' | 'cancelled'

export type WeatherEventAreaSummary = {
  codeType: string
  codeValue: string
  name: string
  altitude: number | null
  ceiling: number | null
}

export type WeatherEventListItem = {
  id: string
  eventCode: string
  eventName: string
  hazardType: WeatherHazardType
  severity: string
  severityLevel: number
  severityColor: 'yellow' | 'orange' | 'red'
  certainty: string
  headline: string
  description: string
  instruction: string
  situation: string | null
  criterion: string | null
  sourceWebUrl: string | null
  onsetAt: string | null
  validTo: string | null
  status: WeatherEventStatus
  firstSeenAt: string
  lastChangedAt: string
  endedAt: string | null
  areas: WeatherEventAreaSummary[]
}

export type WeatherAlertsWorkspace = {
  activeEvents: WeatherEventListItem[]
  historyEvents: WeatherEventListItem[]
  preferences: WeatherNotificationPreferences
  sourceStatus: {
    lastSuccessAt: string | null
    lastAttemptAt: string | null
    lastErrorAt: string | null
    consecutiveFailureCount: number
    dataVersion: number
  }
}
