import type { PowerOutageSource } from './types'

export type CompleteCandidateStatus = 'new' | 'confirmed' | 'needs_review' | 'dismissed' | 'stale'
export type CompleteEntityKind = 'registered_office' | 'establishment' | 'mixed'
export type CompleteEvidenceProvider = 'ares' | 'res' | 'mapy' | 'google'

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
  publishedOutageCount: number
  publishedAddressCount: number
  futureOutageCount: number
  activeOutageCount: number
  coverageProcessedCount: number
  coverageTotalCount: number
  lastErrorMessage: string | null
}

export type CompleteProviderState = {
  provider: 'ares' | 'mapy' | 'google'
  readyCount: number
  pendingCount: number
  notFoundCount: number
  errorCount: number
  minuteRequestCount: number
  dayRequestCount: number
  lastRequestAt: string | null
}

export type CompletePowerOutageWorkspace = {
  generatedAt: string
  statistics: {
    currentOutageCount: number
    currentCompanyCount: number
    needsReviewCount: number
    normalizedAddressCount: number
  }
  currentItems: CompletePowerOutageListItem[]
  archivedItems: CompletePowerOutageListItem[]
  filters: {
    companies: string[]
    sources: PowerOutageSource[]
    entityKinds: CompleteEntityKind[]
  }
  sources: CompleteSourceState[]
  providers: CompleteProviderState[]
  addressCoverage: {
    totalCount: number
    normalizedCount: number
    exactCount: number
    insufficientCount: number
    errorCount: number
  }
}
