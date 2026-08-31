export type PowerOutageSource = 'cez' | 'egd'
export type PowerOutageMatchStatus = 'confirmed' | 'needs_review'
export type PowerOutageSourceStatus = 'pending' | 'live' | 'warning' | 'error'

export type PowerOutageNotificationPreferences = {
  notificationsEnabled: boolean
  reminder24hEnabled: boolean
  updatedAt: string | null
}

export type PowerOutageListItem = {
  matchId: string
  outageId: string
  source: PowerOutageSource
  sourceStatus: 'scheduled' | 'active' | 'completed' | 'cancelled'
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  archivedAt: string | null
  municipality: string | null
  district: string | null
  region: string | null
  sourceUrl: string | null
  announcementUrl: string | null
  sourceUpdatedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
  matchStatus: PowerOutageMatchStatus
  confidence: number
  matchReasons: string[]
  store: {
    id: string | null
    chainName: string
    storeNumber: string
    city: string
    address: string
  }
  informed: boolean
  informedAt: string | null
}

export type PowerOutageDetail = {
  matchId: string
  outageId: string
  storeId: string | null
  outageAddressId: string | null
  externalId: string
  source: PowerOutageSource
  sourceStatus: PowerOutageListItem['sourceStatus']
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  archiveAt: string
  archivedAt: string | null
  municipality: string | null
  municipalityCode: string | null
  district: string | null
  region: string | null
  sourceUrl: string | null
  announcementUrl: string | null
  sourceUpdatedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
  matchStatus: PowerOutageMatchStatus
  matchMethod: 'city_street' | 'manual'
  confidence: number
  matchReasons: string[]
  storeRevision: number
  firstMatchedAt: string
  lastVerifiedAt: string
  resolvedAt: string | null
  store: PowerOutageListItem['store']
  addresses: Array<{
    id: string
    rawAddress: string
    municipality: string
    townPart: string | null
    street: string
    houseNumber: string | null
    orientationNumber: string | null
    postalCode: string | null
  }>
  versions: Array<{
    id: string
    versionNumber: number
    changeReasons: string[]
    createdAt: string
  }>
  matchAudit: Array<{
    id: string
    previousStatus: PowerOutageMatchStatus | 'dismissed'
    nextStatus: PowerOutageMatchStatus | 'dismissed'
    note: string | null
    actorUserId: string
    createdAt: string
  }>
  informedHistory: Array<{
    id: string
    informed: boolean
    note: string | null
    actorUserId: string
    createdAt: string
  }>
}

export type PowerOutageSourceSummary = {
  source: PowerOutageSource
  status: PowerOutageSourceStatus
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastChangeAt: string | null
  ageHours: number | null
  consecutiveFailureCount: number
  lastErrorCode: string | null
  lastErrorMessage: string | null
  activeOutageCount: number
  futureOutageCount: number
  dataVersion: number
  storeCatalogPending: boolean
  processedRecordCount: number
  changeCount: number | null
  municipalityCoverage: string
}

export type PowerOutageSourceDiagnostic = {
  generatedAt: string
  source: PowerOutageSource
  status: PowerOutageSourceStatus
  sourceState: {
    lastAttemptAt: string | null
    lastSuccessAt: string | null
    lastChangeAt: string | null
    lastErrorAt: string | null
    latestSourceRef: string | null
    latestPayloadSha256: string | null
    activeOutageCount: number
    futureOutageCount: number
    consecutiveFailureCount: number
    lastErrorCode: string | null
    lastErrorMessage: string | null
    dataVersion: number
    storeRevisionProcessed: number
    lockExpiresAt: string | null
  }
  task: {
    lastStartedAt: string | null
    lastFinishedAt: string | null
    lastSuccessAt: string | null
    lastStatus: 'pending' | 'running' | 'succeeded' | 'failed'
    consecutiveFailureCount: number
    lastErrorCode: string | null
    lastErrorMessage: string | null
    lockExpiresAt: string | null
  } | null
  catalogRevision: number
  runs: Array<{
    id: string
    triggerKind: 'scheduled' | 'manual' | 'store_change' | 'retry'
    status: 'running' | 'succeeded' | 'no_change' | 'failed' | 'skipped'
    startedAt: string
    finishedAt: string | null
    sourceRecordCount: number
    outageUpsertCount: number
    addressUpsertCount: number
    storeMatchCount: number
    storeReviewCount: number
    storeRevision: number
    errorCode: string | null
    errorMessage: string | null
  }>
}

export type PowerOutageStoreCoverage = {
  totalStoreCount: number
  readyStoreCount: number
  pendingStoreCount: number
  reviewStoreCount: number
  failedStoreCount: number
  coveragePercent: number
  cezStoreCount: number
  egdStoreCount: number
  unknownDistributorCount: number
  catalogRevision: number
  catalogLastChangedAt: string
}

export type PowerOutageFilterOptions = {
  sources: PowerOutageSource[]
  chains: string[]
  cities: string[]
  matchStatuses: PowerOutageMatchStatus[]
}

export type PowerOutageWorkspace = {
  generatedAt: string
  statistics: {
    analyzedOutageCount: number
    currentMatchCount: number
    archivedMatchCount: number
    needsReviewCount: number
  }
  currentOutages: PowerOutageListItem[]
  archivedOutages: PowerOutageListItem[]
  filters: PowerOutageFilterOptions
  sources: PowerOutageSourceSummary[]
  sourceHealth: 'pending' | 'live' | 'warning' | 'error'
  storeCoverage: PowerOutageStoreCoverage
  preferences: PowerOutageNotificationPreferences
}
