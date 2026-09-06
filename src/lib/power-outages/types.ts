export type PowerOutageSource = 'cez' | 'egd' | 'pre'
export type PowerOutageMatchStatus = 'confirmed' | 'needs_review' | 'dismissed'
export type PowerOutageSourceStatus = 'pending' | 'live' | 'processing' | 'warning' | 'error'

export type PowerOutageNotificationPreferences = {
  notificationsEnabled: boolean
  reminder24hEnabled: boolean
  updatedAt: string | null
}

export type MarketClientEmailMode = 'disabled' | 'shadow' | 'test' | 'live'
export type MarketClientEmailRecipientKind = 'to' | 'cc'
export type MarketClientEmailEventKind =
  | 'new_outage'
  | 'schedule_changed'
  | 'cancelled'
  | 'reminder_24h'
  | 'missing_job_72h'

export type MarketClientEmailRecipient = {
  id: string
  kind: MarketClientEmailRecipientKind
  name: string
  email: string
  isActive: boolean
}

export type MarketClientEmailRule = {
  id: string
  name: string
  eventKind: MarketClientEmailEventKind
  enabled: boolean
  version: number
  activatedAt: string | null
}

export type MarketClientEmailDelivery = {
  id: string
  mode: 'shadow' | 'test' | 'live'
  eventKind: MarketClientEmailRule['eventKind']
  status: 'planned' | 'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'skipped' | 'cancelled'
  subject: string | null
  text: string | null
  recipients: string[]
  stores: Array<{
    chainName: string
    storeNumber: string
    city: string
    address: string
  }>
  source: PowerOutageSource | null
  startsAt: string | null
  endsAt: string | null
  announcementUrl: string | null
  attemptCount: number
  maxAttemptCount: number
  providerMessageId: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  sentAt: string | null
  deliveredAt: string | null
}

export type MarketClientEmailConfiguration = {
  clientId: string
  chainName: string
  clientName: string
  mode: MarketClientEmailMode
  fromName: string
  fromEmail: string
  replyToEmail: string
  updatedAt: string
  hasDeliveredTest: boolean
  recipients: MarketClientEmailRecipient[]
  rules: MarketClientEmailRule[]
  deliveries: MarketClientEmailDelivery[]
}

export type MarketClientEmailAdminWorkspace = {
  runtimeMode: MarketClientEmailMode
  dispatchEnabled: boolean
  provider: 'resend'
  lastPlannedAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  automationHealth: {
    overallStatus: 'healthy' | 'warning' | 'error' | 'inactive'
    planner: MarketClientEmailAutomationHealthItem
    worker: MarketClientEmailAutomationHealthItem
    cron: MarketClientEmailAutomationHealthItem
  }
  resend: {
    apiKeyConfigured: boolean
    sendingDomain: string | null
    domainVerified: boolean
    webhookSecretConfigured: boolean
    testRecipientConfigured: boolean
    testRecipientMasked: string | null
    providerReady: boolean
    webhookReady: boolean
    testReady: boolean
    liveReady: boolean
    issues: string[]
  }
  clients: MarketClientEmailConfiguration[]
}

export type MarketClientEmailAutomationHealthItem = {
  status: 'healthy' | 'warning' | 'error' | 'inactive'
  label: string
  lastActivityAt: string | null
  message: string
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
  isNew: boolean
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
  linkedJob: {
    id: string
    jobNumber: string
    matchCount: number
  } | null
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
  contractor: string | null
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
    previousStatus: PowerOutageMatchStatus
    nextStatus: PowerOutageMatchStatus
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
  storeRevisionProcessed: number
  catalogScanRevision: number | null
  catalogScanProcessedStoreCount: number | null
  processedRecordCount: number
  changeCount: number | null
  municipalityCoverage: string
  comparisonProgress: {
    status: 'queued' | 'processing' | 'current' | 'error'
    phase: 'source_scan' | 'source_sync' | 'matching_addresses' | 'saving_matches' | 'complete'
    processedCount: number | null
    totalCount: number | null
    percent: number
    lastProgressAt: string | null
  }
  cezCollectors: PowerOutageCezCollectorOverview | null
  attention: {
    code: string
    message: string
    recoveryAction: 'source_sync' | 'matching' | 'cez_v1' | 'cez_v2'
  } | null
}

export type PowerOutageCezCollectorVersion = {
  version: 'v1' | 'v2'
  displayName: string
  isEnabled: boolean
  isPrimary: boolean
  cadenceSeconds: number
  healthStatus: 'inactive' | 'waiting' | 'processing' | 'current' | 'delayed' | 'error'
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastCompleteAt: string | null
  consecutiveFailureCount: number
  lastErrorCode: string | null
  lastErrorMessage: string | null
  latestCycleStatus: 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | null
  targetCount: number
  processedCount: number
  successCount: number
  errorCount: number
  observedOutageCount: number
  exactOutageCount: number
  townOutageCount: number
  cycleStartedAt: string | null
  cycleFinishedAt: string | null
  cycleErrorCode: string | null
  cycleErrorMessage: string | null
}

export type PowerOutageCezCollectorOverview = {
  operatingMode: 'v1_only' | 'dual' | 'v2_only'
  primaryVersion: 'v1' | 'v2'
  secondaryVersion: 'v1' | 'v2' | null
  activationReady: boolean
  switchedAt: string
  calculatedAt: string
  v1OutageCount: number
  v2OutageCount: number
  sharedOutageCount: number
  v1OnlyOutageCount: number
  v2OnlyOutageCount: number
  uniqueOutageCount: number
  versions: PowerOutageCezCollectorVersion[]
}

export type PowerOutageSourceDiagnostic = {
  generatedAt: string
  source: PowerOutageSource
  status: PowerOutageSourceStatus
  attention: PowerOutageSourceSummary['attention']
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
  progress: {
    mode: 'determinate' | 'indeterminate'
    phase: 'queued' | 'loading'
    storeRevision: number
    processedStoreCount: number | null
    totalStoreCount: number
    percent: number | null
    completedBatchCount: number | null
    startedAt: string | null
    lastProgressAt: string | null
  } | null
  cezCollectors: PowerOutageCezCollectorOverview | null
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
  notFoundStoreCount: number
  errorStoreCount: number
  coveragePercent: number
  cezStoreCount: number
  egdStoreCount: number
  preStoreCount: number
  unknownDistributorCount: number
  unknownReadyStoreCount: number
  catalogRevision: number
  catalogLastChangedAt: string
  catalogLastChangeKind: 'initial' | 'insert' | 'update' | 'delete'
  matchingRevision: number
  matchingFinishedAt: string | null
  matchingStatus: 'running' | 'succeeded' | 'failed' | null
  chains: Array<{
    chainName: string
    totalStoreCount: number
    readyStoreCount: number
    pendingStoreCount: number
    reviewStoreCount: number
    notFoundStoreCount: number
    errorStoreCount: number
    unknownDistributorCount: number
  }>
}

export type StoreAddressAnalysisItem = {
  registryId: string
  chainName: string
  storeNumber: string
  currentCity: string
  currentAddress: string
  verificationStatus: 'pending' | 'verified' | 'probable' | 'needs_review' | 'not_found' | 'error'
  suggestionId: string | null
  addressFingerprint: string
  analysisStatus: 'pending' | 'verified' | 'normalization' | 'needs_review' | 'insufficient' | 'not_found' | 'error'
  confidence: number | null
  suggestedCity: string | null
  suggestedAddress: string | null
  suggestedLabel: string | null
  suggestedZip: string | null
  longitude: number | null
  latitude: number | null
  candidateCount: number | null
  analyzedAt: string | null
  errorMessage: string | null
  nearbyCandidates: StoreAddressNearbyCandidate[]
}

export type StoreAddressNearbyCandidate = {
  id: string
  poiName: string
  city: string
  address: string
  label: string | null
  longitude: number
  latitude: number
  distanceMeters: number
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
  sourceHealth: PowerOutageSourceStatus
  storeCoverage: PowerOutageStoreCoverage
  preferences: PowerOutageNotificationPreferences
}
