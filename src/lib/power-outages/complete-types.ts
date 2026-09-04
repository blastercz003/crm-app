import type { PowerOutageSource } from './types'

export type CompleteCandidateStatus = 'new' | 'confirmed' | 'needs_review' | 'dismissed' | 'stale'
export type CompleteEntityKind = 'registered_office' | 'establishment' | 'mixed'
export type CompleteEvidenceProvider = 'ares' | 'res' | 'mapy' | 'google'
export type CompleteCommunicationStatus = 'not_contacted' | 'contacted' | 'follow_up' | 'closed'

export type CompletePowerOutageAssignment = {
  ownerId: string
  ownerName: string
  communicationStatus: CompleteCommunicationStatus
  notes: string
  claimedAt: string
  updatedAt: string
}

export type CompletePowerOutageCommunicationNote = {
  id: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
}

export type CompletePowerOutageListItem = {
  candidateId: string
  outageId: string
  outageAddressId: string
  source: PowerOutageSource
  externalId: string
  sourceStatus: 'scheduled' | 'active' | 'completed' | 'cancelled'
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  sourceUrl: string | null
  announcementUrl: string | null
  firstSeenAt: string
  lastSeenAt: string
  addressScope: 'exact' | 'street' | 'municipality' | 'unresolved'
  municipality: string
  townPart: string | null
  street: string
  houseNumber: string | null
  orientationNumber: string | null
  postalCode: string | null
  rawAddress: string
  companyName: string
  ico: string | null
  legalForm: string | null
  naceCodes: string[]
  employeeCategory: string | null
  entityKind: CompleteEntityKind
  displayAddress: string | null
  confidence: number
  candidateStatus: CompleteCandidateStatus
  sourceCount: number
  evaluationReasons: string[]
  evaluationExplanations: string[]
  evaluatedAt: string | null
  providers: CompleteEvidenceProvider[]
  evidenceCount: number
  assignment: CompletePowerOutageAssignment | null
}

export type CompletePowerOutagePageCursor = {
  at: string
  id: string
}

export type CompletePowerOutagePageFilters = {
  mode: 'current' | 'archive'
  query: string
  owner: string
  source: 'all' | PowerOutageSource
  entityKind: 'all' | CompleteEntityKind
  candidateStatus: 'visible' | 'confirmed' | 'needs_review' | 'dismissed'
}

export type CompletePowerOutagePage = {
  items: CompletePowerOutageListItem[]
  totalCount: number | null
  hasMore: boolean
  nextCursor: CompletePowerOutagePageCursor | null
}

export type CompletePowerOutageCurrentUser = {
  id: string
  name: string
  isAdmin: boolean
}

export type CompletePowerOutageStatistics = {
  currentOutageCount: number
  currentCompanyCount: number
  needsReviewCount: number
  normalizedAddressCount: number
}

export type CompletePowerOutageEvidence = {
  id: string
  provider: CompleteEvidenceProvider
  providerEntityId: string
  evidenceKind: 'registered_office' | 'establishment' | 'address_match' | 'nearby'
  matchLevel: 'exact_address' | 'same_building' | 'nearby' | 'unresolved'
  displayName: string
  displayAddress: string | null
  sourceUrl: string | null
  distanceMeters: number | null
  confidence: number
  observedAt: string
}

export type CompletePowerOutageDetail = CompletePowerOutageListItem & {
  addressLatitude: number | null
  addressLongitude: number | null
  companyLatitude: number | null
  companyLongitude: number | null
  metadata: Record<string, unknown>
  evidence: CompletePowerOutageEvidence[]
}

export type CompleteSourceState = {
  source: PowerOutageSource
  coverageStatus: 'idle' | 'processing' | 'complete' | 'partial' | 'error'
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastCompleteAt: string | null
  lastChangeAt: string | null
  horizonFrom: string | null
  horizonTo: string | null
  latestSourceRef: string | null
  latestPayloadSha256: string | null
  dataVersion: number
  publishedOutageCount: number
  publishedAddressCount: number
  futureOutageCount: number
  activeOutageCount: number
  coverageProcessedCount: number
  coverageTotalCount: number
  lastErrorMessage: string | null
  coverageMessage: string | null
  queryScope: string | null
  discovery: CompleteSourceDiscoveryState
}

export type CompleteSourceDiscoveryState = {
  status: 'waiting' | 'processing' | 'current' | 'delayed' | 'partial' | 'error'
  statusMessage: string
  totalTargetCount: number
  completedTargetCount: number
  remainingTargetCount: number
  pendingTargetCount: number
  errorTargetCount: number
  exactTargetCount: number
  streetTargetCount: number
  progressPercent: number
  lastProgressAt: string | null
}

export type CompleteSourceProviderProgress = {
  provider: 'ares' | 'mapy' | 'google'
  configured: boolean
  totalTargetCount: number
  completedTargetCount: number
  pendingTargetCount: number
  foundTargetCount: number
  notFoundTargetCount: number
  errorTargetCount: number
  progressPercent: number
  lastProgressAt: string | null
}

export type CompleteSourceRun = {
  id: string
  status: 'running' | 'succeeded' | 'no_change' | 'partial' | 'failed' | 'skipped'
  startedAt: string
  finishedAt: string | null
  sourceRecordCount: number
  outageUpsertCount: number
  addressUpsertCount: number
  errorCount: number
  errorCode: string | null
  errorMessage: string | null
  removedAddressCount: number
}

export type CompleteSourceDiagnostic = {
  source: PowerOutageSource
  state: CompleteSourceState
  providers: CompleteSourceProviderProgress[]
  runs: CompleteSourceRun[]
  task: {
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'partial' | null
    lastStartedAt: string | null
    lastFinishedAt: string | null
    lastSuccessAt: string | null
    consecutiveFailureCount: number
    lastErrorMessage: string | null
  } | null
  evaluationTask: {
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'partial' | null
    lastStartedAt: string | null
    lastFinishedAt: string | null
    lastSuccessAt: string | null
    consecutiveFailureCount: number
    lastErrorCode: string | null
    lastErrorMessage: string | null
    pendingCandidateCount: number
  } | null
}

export type CompleteProviderState = {
  provider: 'ares' | 'mapy' | 'google'
  configured: boolean
  status: 'inactive' | 'waiting' | 'processing' | 'current' | 'partial' | 'error' | 'exhausted'
  statusMessage: string
  readyCount: number
  pendingCount: number
  notFoundCount: number
  errorCount: number
  minuteRequestCount: number
  dayRequestCount: number
  dayRequestLimit: number
  dayRequestRemaining: number
  monthlyCreditCount: number
  monthlyCreditLimit: number
  monthlyCreditSafetyCap: number
  monthlyCreditRemaining: number
  completeCreditCount: number
  marketsCreditCount: number
  lastRequestAt: string | null
}

export type CompleteProviderRun = {
  id: string
  status: 'running' | 'succeeded' | 'no_change' | 'partial' | 'failed' | 'skipped'
  startedAt: string
  finishedAt: string | null
  processedCount: number
  companyCount: number
  evidenceCount: number
  cacheHitCount: number
  externalRequestCount: number
  errorCount: number
  quotaReached: boolean
  errorCode: string | null
  errorMessage: string | null
}

export type CompleteProviderDiagnostic = {
  provider: CompleteProviderState['provider']
  observedAt: string
  state: CompleteProviderState
  limits: { minute: number; day: number; maxPerRun: number; cacheHours: number | null }
  task: {
    status: 'idle' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped'
    lastStartedAt: string | null
    lastFinishedAt: string | null
    lastSuccessAt: string | null
    consecutiveFailureCount: number
    lastErrorCode: string | null
    lastErrorMessage: string | null
  } | null
  runs: CompleteProviderRun[]
  recentErrors: Array<{
    id: string
    queryText: string
    targetKind: string
    attemptCount: number
    lastAttemptAt: string | null
    nextAttemptAt: string | null
    errorCode: string | null
    errorMessage: string | null
  }>
}

export type CompleteRuntimeState = {
  status: 'healthy' | 'processing' | 'attention' | 'waiting'
  runningTaskCount: number
  failedTaskCount: number
  staleSourceCount: number
  lastActivityAt: string | null
  issues: string[]
}

export type CompleteCezNewState = {
  activeSource: 'legacy' | 'shadow'
  status: 'waiting' | 'processing' | 'ready' | 'partial' | 'error'
  stage: 'ruian' | 'mapping' | 'scan' | 'normalization' | 'projection' | 'ready'
  statusMessage: string
  progressDone: number
  progressTotal: number
  progressPercent: number
  catalogTotal: number
  representativeDone: number
  representativeRemaining: number
  representativeError: number
  mappingDone: number
  mappingRemaining: number
  mappingError: number
  cezMapped: number
  scanTotal: number
  scanProcessed: number
  scanError: number
  scanOutageCount: number
  scanAddressCount: number
  scanStartedAt: string | null
  scanFinishedAt: string | null
  normalizationTotal: number
  normalizationDone: number
  normalizationRemaining: number
  normalizationError: number
  projectedOutageCount: number
  projectedCurrentOutageCount: number
  projectedAddressCount: number
  projectionStatus: string
  projectionPendingCount: number
  lastProjectionAt: string | null
  publishableCycleCount: number
  recentCycleCount: number
  safeRecentCycleCount: number
  latestTwoCyclesSafe: boolean
  latestProjectionMatches: boolean
  errorStage: 'ruian' | 'mapping' | 'scan' | 'normalization' | 'projection' | null
  errorCode: string | null
  lastErrorMessage: string | null
}

export type CompleteAddressCoverage = {
  status: 'waiting' | 'processing' | 'current' | 'partial' | 'error'
  statusMessage: string
  totalCount: number
  normalizedCount: number
  exactCount: number
  broadCount: number
  unresolvedCount: number
  pendingCount: number
  errorCount: number
}

export type CompleteAddressCoverageRun = {
  id: string
  status: 'running' | 'succeeded' | 'no_change' | 'partial' | 'failed' | 'skipped'
  startedAt: string
  finishedAt: string | null
  processedAddressCount: number
  createdTargetCount: number
  removedTargetCount: number
  exactTargetCount: number
  broadTargetCount: number
  unresolvedAddressCount: number
  remainingCount: number | null
  errorCode: string | null
  errorMessage: string | null
}

export type CompleteAddressCoverageDiagnostic = {
  observedAt: string
  coverage: CompleteAddressCoverage
  normalizerVersion: number
  targets: { exactCount: number; streetCount: number; municipalityCount: number; totalCount: number }
  sources: Array<{
    source: PowerOutageSource
    totalCount: number
    normalizedCount: number
    exactCount: number
    broadCount: number
  }>
  task: {
    status: 'idle' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped'
    lastStartedAt: string | null
    lastFinishedAt: string | null
    lastSuccessAt: string | null
    consecutiveFailureCount: number
    lastErrorCode: string | null
    lastErrorMessage: string | null
  } | null
  runs: CompleteAddressCoverageRun[]
}

export type CompletePowerOutageWorkspace = {
  generatedAt: string
  currentUser: CompletePowerOutageCurrentUser
  statistics: CompletePowerOutageStatistics
  initialPage: CompletePowerOutagePage
  initialPageError: string | null
  filters: {
    owners: Array<{ id: string; name: string }>
    sources: PowerOutageSource[]
    entityKinds: CompleteEntityKind[]
  }
  sources: CompleteSourceState[]
  cezNew: CompleteCezNewState | null
  providers: CompleteProviderState[]
  runtime: CompleteRuntimeState
  addressCoverage: CompleteAddressCoverage
}

export type CompletePowerOutageSidebarWorkspace = Pick<
  CompletePowerOutageWorkspace,
  'currentUser' | 'sources' | 'cezNew' | 'providers' | 'runtime' | 'addressCoverage'
>
