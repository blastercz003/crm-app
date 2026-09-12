import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { diagnoseOfficialWebsiteV2WithBrave, type BraveOfficialWebsiteCandidate } from './complete-contact-discovery-brave'
import {
  verifyOfficialWebsiteCandidateV2,
  type OfficialWebsiteVerificationV2,
} from './complete-contact-discovery-website-verification'
import { powerOutageErrorMessage } from './error-message'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type WebsiteV2Claim = {
  ico: string
  company_profile_id: string
  company_name: string
  processing_token: string
  attempt_count: number
  prior_website_url: string | null
}

type CheckedCandidateV2 = {
  rank: number
  queryVariant: BraveOfficialWebsiteCandidate['queryVariant'] | 'v1_verified'
  url: string
  hostname: string
  verification: OfficialWebsiteVerificationV2
}

function isVerifiedCandidate(candidate: CheckedCandidateV2): candidate is CheckedCandidateV2 & {
  verification: OfficialWebsiteVerificationV2 & { status: 'verified_company' | 'verified_group' }
} {
  return candidate.verification.status === 'verified_company'
    || candidate.verification.status === 'verified_group'
}

function retryableWebsiteError(message: string) {
  return !/BRAVE_SEARCH_API_KEY|API kl[ií][cč]|opr[aá]vn[eě]n[ií]|m[eě]s[ií][cč]n[ií] kv[oó]tu|neplatn[yý] v[yý]sledek|chybi serverov[aá] konfigurace/i.test(message)
}

async function finishWebsiteV2Claim(client: ServiceClient, claim: WebsiteV2Claim, input: {
  result: 'verified_company' | 'verified_group' | 'needs_review' | 'no_website' | 'error'
  websiteKind?: 'company' | 'group' | null
  candidateUrl?: string | null
  normalizedDomain?: string | null
  confidence?: number
  verificationMethods?: string[]
  reasonCodes?: string[]
  evidence?: Record<string, unknown>
  errorCode?: string | null
  errorMessage?: string | null
  retryable?: boolean
}) {
  const { data, error } = await client.rpc('finish_complete_power_outage_contact_discovery_website_v2', {
    requested_ico: claim.ico,
    requested_processing_token: claim.processing_token,
    requested_result: input.result,
    requested_website_kind: input.websiteKind ?? null,
    requested_candidate_url: input.candidateUrl ?? null,
    requested_normalized_domain: input.normalizedDomain ?? null,
    requested_confidence: input.confidence ?? 0,
    requested_verification_methods: input.verificationMethods ?? [],
    requested_reason_codes: input.reasonCodes ?? [],
    requested_evidence: input.evidence ?? {},
    requested_error_code: input.errorCode ?? null,
    requested_error_message: input.errorMessage ?? null,
    requested_retryable: input.retryable ?? true,
  })
  if (error) throw error
  if (data !== true) throw new Error(`Lease v2 pro ověření webu IČO ${claim.ico} již není platný.`)
}

async function checkCandidate(input: {
  claim: WebsiteV2Claim
  url: string
  rank: number
  queryVariant: CheckedCandidateV2['queryVariant']
}): Promise<CheckedCandidateV2> {
  const url = new URL(input.url)
  const verification = await verifyOfficialWebsiteCandidateV2({
    candidateUrl: url.toString(),
    companyName: input.claim.company_name,
    ico: input.claim.ico,
  })
  return {
    rank: input.rank,
    queryVariant: input.queryVariant,
    url: url.toString(),
    hostname: url.hostname.toLowerCase().replace(/^www\./, ''),
    verification,
  }
}

export async function processCompleteContactDiscoveryWebsitesV2() {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverová konfigurace Supabase service role.')

  const { data: state, error: stateError } = await client
    .from('complete_power_outage_contact_discovery_state')
    .select('website_verification_v2_enabled,contact_extraction_enabled,email_planning_enabled,email_dispatch_enabled')
    .eq('singleton', true)
    .maybeSingle<{
      website_verification_v2_enabled: boolean
      contact_extraction_enabled: boolean
      email_planning_enabled: boolean
      email_dispatch_enabled: boolean
    }>()
  if (stateError) throw stateError
  if (!state?.website_verification_v2_enabled) {
    return { status: 'disabled' as const, claimed: 0, verified: 0, needsReview: 0, noWebsite: 0, failed: 0 }
  }
  if (state.contact_extraction_enabled || state.email_planning_enabled || state.email_dispatch_enabled) {
    throw new Error('Bezpečnostní zámek odmítl SHADOW v2, protože je aktivní pozdější fáze zpracování.')
  }

  const { data, error } = await client.rpc('claim_complete_power_outage_contact_discovery_website_v2')
  if (error) throw error
  const claims = (data ?? []) as WebsiteV2Claim[]
  if (claims.length === 0) {
    return { status: 'idle' as const, claimed: 0, verified: 0, needsReview: 0, noWebsite: 0, failed: 0 }
  }

  const claim = claims[0]
  try {
    const checkedCandidates: CheckedCandidateV2[] = []
    const seenHosts = new Set<string>()

    if (claim.prior_website_url) {
      const prior = await checkCandidate({
        claim,
        url: claim.prior_website_url,
        rank: 0,
        queryVariant: 'v1_verified',
      })
      checkedCandidates.push(prior)
      seenHosts.add(prior.hostname)
    }

    let accepted = checkedCandidates.find(isVerifiedCandidate)
    let searchSummary: Record<string, unknown> | null = null
    if (!accepted) {
      const search = await diagnoseOfficialWebsiteV2WithBrave({
        companyName: claim.company_name,
        ico: claim.ico,
      })
      searchSummary = {
        provider: search.provider,
        queryContract: search.queryContract,
        searchedAt: search.searchedAt,
        queryCount: search.queryCount,
        resultCount: search.resultCount,
        acceptedCandidateCount: search.acceptedCandidateCount,
      }
      for (const candidate of search.candidates) {
        if (seenHosts.has(candidate.hostname)) continue
        seenHosts.add(candidate.hostname)
        const checked = await checkCandidate({ claim, ...candidate })
        checkedCandidates.push(checked)
        if (isVerifiedCandidate(checked)) {
          accepted = checked
          break
        }
      }
    }

    const reviewCandidate = checkedCandidates.find((candidate) => candidate.verification.status === 'needs_review')
    const evidence = {
      contract: 'complete-contact-official-website-v2-shadow',
      v1CandidateRechecked: Boolean(claim.prior_website_url),
      search: searchSummary,
      checkedCandidates,
      rawSearchPayloadStored: false,
      rawHtmlStored: false,
      contactsPersisted: false,
    }

    if (accepted) {
      const websiteKind = accepted.verification.status === 'verified_group' ? 'group' : 'company'
      await finishWebsiteV2Claim(client, claim, {
        result: accepted.verification.status,
        websiteKind,
        candidateUrl: accepted.verification.verifiedUrl,
        normalizedDomain: accepted.verification.normalizedDomain,
        confidence: accepted.verification.confidence,
        verificationMethods: accepted.verification.verificationMethods,
        reasonCodes: accepted.verification.reasonCodes,
        evidence,
      })
      return { status: 'succeeded' as const, claimed: 1, verified: 1, needsReview: 0, noWebsite: 0, failed: 0 }
    }
    if (reviewCandidate) {
      await finishWebsiteV2Claim(client, claim, {
        result: 'needs_review',
        verificationMethods: reviewCandidate.verification.verificationMethods,
        reasonCodes: reviewCandidate.verification.reasonCodes,
        evidence,
      })
      return { status: 'succeeded' as const, claimed: 1, verified: 0, needsReview: 1, noWebsite: 0, failed: 0 }
    }
    await finishWebsiteV2Claim(client, claim, { result: 'no_website', evidence })
    return { status: 'succeeded' as const, claimed: 1, verified: 0, needsReview: 0, noWebsite: 1, failed: 0 }
  } catch (error) {
    const message = powerOutageErrorMessage(error, 'SHADOW ověření oficiálního webu v2 selhalo.')
    try {
      await finishWebsiteV2Claim(client, claim, {
        result: 'error',
        evidence: {
          contract: 'complete-contact-official-website-v2-shadow',
          rawPayloadStored: false,
          contactsPersisted: false,
        },
        errorCode: 'COMPLETE_CONTACT_WEBSITE_V2_LOOKUP_FAILED',
        errorMessage: message,
        retryable: retryableWebsiteError(message),
      })
    } catch {
      // Propadly lease se obnoví databázovou claim funkcí.
    }
    return { status: 'partial' as const, claimed: 1, verified: 0, needsReview: 0, noWebsite: 0, failed: 1 }
  }
}
