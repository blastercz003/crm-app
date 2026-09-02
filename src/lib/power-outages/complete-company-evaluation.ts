import 'server-only'

import { normalizePowerOutageText } from './normalization'

export const COMPLETE_COMPANY_EVALUATION_VERSION = 1
export const MASS_REGISTERED_OFFICE_THRESHOLD = 20

export type CompleteCompanyEvaluationEvidence = {
  provider: 'ares' | 'res' | 'mapy' | 'google'
  evidenceKind: 'registered_office' | 'establishment' | 'address_match' | 'nearby'
  matchLevel: 'exact_address' | 'same_building' | 'nearby' | 'unresolved'
  displayName: string
  confidence: number
  distanceMeters: number | null
}

export type CompleteCompanyEvaluation = {
  confidence: number
  candidateStatus: 'confirmed' | 'needs_review'
  entityKind: 'registered_office' | 'establishment' | 'mixed'
  reasonCodes: string[]
  explanations: string[]
  providers: Array<'ares' | 'res' | 'mapy' | 'google'>
  exactProviderCount: number
  massRegisteredOffice: boolean
  nameConflict: boolean
}

const LEGAL_SUFFIXES = /\s+(?:(?:spol\s+s\s+r\s+o)|(?:s\s+r\s+o)|(?:a\s+s)|(?:v\s+o\s+s)|(?:k\s+s)|(?:o\s+p\s+s)|(?:z\s+s)|(?:s\s+e)|druzstvo)$/

export function canonicalCompleteCompanyName(value: string) {
  let result = normalizePowerOutageText(value)
  let previous = ''
  while (result && result !== previous) {
    previous = result
    result = result.replace(LEGAL_SUFFIXES, '').trim()
  }
  return result
}

export function shouldMergeCompleteCompanyCandidates(left: {
  ico: string | null
  companyName: string
  manuallyResolved: boolean
  candidateStatus: string
}, right: {
  ico: string | null
  companyName: string
  manuallyResolved: boolean
  candidateStatus: string
}) {
  if (['dismissed', 'stale'].includes(left.candidateStatus)) return false
  if (['dismissed', 'stale'].includes(right.candidateStatus)) return false
  if (
    left.manuallyResolved
    && right.manuallyResolved
    && left.candidateStatus !== right.candidateStatus
  ) return false
  if (left.ico && right.ico) return left.ico === right.ico
  const leftName = canonicalCompleteCompanyName(left.companyName)
  const rightName = canonicalCompleteCompanyName(right.companyName)
  return Boolean(leftName && rightName && leftName === rightName)
}

function finiteConfidence(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export function evaluateCompleteCompanyCandidate(input: {
  addressScope: 'exact' | 'street' | 'municipality' | 'unresolved'
  companyName: string
  evidence: CompleteCompanyEvaluationEvidence[]
  registeredOfficeCountAtAddress: number
}): CompleteCompanyEvaluation {
  const providers = [...new Set(input.evidence.map((item) => item.provider))].sort()
  const exactEvidence = input.evidence.filter((item) => (
    item.matchLevel === 'exact_address' || item.matchLevel === 'same_building'
  ))
  const exactProviders = new Set(exactEvidence.map((item) => item.provider))
  const hasAresExact = exactEvidence.some((item) => item.provider === 'ares' || item.provider === 'res')
  const hasMapyExact = exactEvidence.some((item) => item.provider === 'mapy')
  const hasGoogleExact = exactEvidence.some((item) => item.provider === 'google')
  const hasRegisteredOffice = input.evidence.some((item) => item.evidenceKind === 'registered_office')
  const hasEstablishment = input.evidence.some((item) => item.evidenceKind === 'establishment')
  const massRegisteredOffice = hasRegisteredOffice
    && input.registeredOfficeCountAtAddress >= MASS_REGISTERED_OFFICE_THRESHOLD
  const canonicalNames = new Set(
    input.evidence.map((item) => canonicalCompleteCompanyName(item.displayName)).filter(Boolean),
  )
  const companyCanonicalName = canonicalCompleteCompanyName(input.companyName)
  const materiallyDifferentNames = [...canonicalNames].filter((name) => name !== companyCanonicalName)
  const nameConflict = providers.length > 1 && materiallyDifferentNames.length > 0

  let confidence = Math.max(0, ...input.evidence.map((item) => finiteConfidence(item.confidence)))
  const reasonCodes: string[] = []
  const explanations: string[] = []

  if (input.addressScope === 'municipality' || input.addressScope === 'unresolved') {
    confidence = Math.min(confidence, 0.35)
    reasonCodes.push('insufficient_address')
    explanations.push('Adresa není dostatečně přesná pro automatické potvrzení firmy.')
  } else if (input.addressScope === 'street') {
    confidence = Math.min(confidence, 0.68)
    reasonCodes.push('street_without_number')
    explanations.push('Zdroj uvádí pouze ulici bez ověřeného čísla domu.')
  }

  if (hasAresExact) {
    confidence = Math.max(confidence, 0.94)
    reasonCodes.push('ares_exact_address')
    explanations.push('ARES eviduje sídlo firmy na přesné dotčené adrese.')
  }
  if (hasMapyExact) {
    confidence = Math.max(confidence, 0.82)
    reasonCodes.push('mapy_exact_address')
    explanations.push('Mapy.com evidují provozovnu na přesné dotčené adrese.')
  }
  if (hasGoogleExact) {
    confidence = Math.max(confidence, 0.8)
    reasonCodes.push('google_exact_address')
    explanations.push('Google Places potvrzuje provozovnu na přesné dotčené adrese.')
  }
  if (hasMapyExact && hasGoogleExact) {
    confidence = Math.max(confidence, 0.92)
    reasonCodes.push('poi_sources_agree')
    explanations.push('Dva nezávislé katalogy provozoven se shodují na stejné firmě a adrese.')
  }
  if (hasAresExact && (hasMapyExact || hasGoogleExact)) {
    confidence = Math.max(confidence, 0.98)
    reasonCodes.push('registry_and_poi_agree')
    explanations.push('Registr sídel a katalog provozoven se shodují na stejné firmě a adrese.')
  }
  if (exactProviders.size >= 2) {
    reasonCodes.push('multiple_exact_sources')
  }
  if (massRegisteredOffice) {
    confidence = Math.min(confidence, 0.74)
    reasonCodes.push('mass_registered_office')
    explanations.push('Na adrese je evidováno neobvykle mnoho sídel; výsledek vyžaduje ruční kontrolu.')
  }
  if (nameConflict) {
    confidence = Math.min(confidence, 0.69)
    reasonCodes.push('provider_name_conflict')
    explanations.push('Jednotlivé zdroje uvádějí odlišné názvy firmy.')
  }
  if (providers.length === 1) {
    reasonCodes.push('single_source')
    explanations.push('Výsledek zatím pochází pouze z jednoho zdroje.')
  }

  confidence = Math.round(confidence * 10_000) / 10_000
  const canConfirm = input.addressScope === 'exact'
    && confidence >= 0.9
    && !massRegisteredOffice
    && !nameConflict
    && (hasAresExact || (hasMapyExact && hasGoogleExact))

  return {
    confidence,
    candidateStatus: canConfirm ? 'confirmed' : 'needs_review',
    entityKind: hasRegisteredOffice && hasEstablishment
      ? 'mixed'
      : hasRegisteredOffice
        ? 'registered_office'
        : 'establishment',
    reasonCodes: [...new Set(reasonCodes)],
    explanations: [...new Set(explanations)],
    providers,
    exactProviderCount: exactProviders.size,
    massRegisteredOffice,
    nameConflict,
  }
}
