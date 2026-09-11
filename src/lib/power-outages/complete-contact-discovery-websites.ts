import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { diagnoseOfficialWebsiteWithBrave } from './complete-contact-discovery-brave'
import { verifyOfficialWebsiteCandidate, type OfficialWebsiteVerification } from './complete-contact-discovery-website-verification'
import { powerOutageErrorMessage } from './error-message'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type WebsiteClaim = {
  ico: string
  company_profile_id: string
  company_name: string
  processing_token: string
  attempt_count: number
}

type CheckedCandidate = {
  rank: number
  queryVariant: 'name_ico' | 'name_contact'
  url: string
  hostname: string
  verification: OfficialWebsiteVerification
}

function retryableWebsiteError(message: string) {
  return !/BRAVE_SEARCH_API_KEY|API kl[ií][cč]|opr[aá]vn[eě]n[ií]|m[eě]s[ií][cč]n[ií] kv[oó]tu|neplatn[yý] v[yý]sledek|chybi serverov[aá] konfigurace/i.test(message)
}

async function finishWebsiteClaim(client: ServiceClient, claim: WebsiteClaim, input: {
  result: 'website_ready' | 'needs_review' | 'no_website' | 'error'
  websiteId?: string | null
  evidence?: Record<string, unknown>
  errorCode?: string | null
  errorMessage?: string | null
  retryable?: boolean
}) {
  const { data, error } = await client.rpc('finish_complete_power_outage_contact_discovery_website', {
    requested_ico: claim.ico,
    requested_processing_token: claim.processing_token,
    requested_result: input.result,
    requested_website_id: input.websiteId ?? null,
    requested_evidence: input.evidence ?? {},
    requested_error_code: input.errorCode ?? null,
    requested_error_message: input.errorMessage ?? null,
    requested_retryable: input.retryable ?? true,
  })
  if (error) throw error
  if (data !== true) throw new Error(`Lease pro ověření webu IČO ${claim.ico} již není platný.`)
}

async function saveVerifiedWebsite(client: ServiceClient, claim: WebsiteClaim, candidate: CheckedCandidate) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000)
  const verifiedUrl = candidate.verification.verifiedUrl
  if (!verifiedUrl || candidate.verification.status !== 'verified') {
    throw new Error('Ověřený kandidát neobsahuje platnou cílovou URL.')
  }

  const { data, error } = await client
    .from('complete_power_outage_company_websites')
    .upsert({
      company_profile_id: claim.company_profile_id,
      website_url: verifiedUrl,
      normalized_url: verifiedUrl,
      normalized_domain: candidate.verification.normalizedDomain,
      website_scope: 'company',
      discovery_source: 'search_api',
      source_reference: 'brave',
      source_url: candidate.url,
      verification_status: 'verified',
      verification_methods: candidate.verification.verificationMethods,
      confidence: candidate.verification.confidence,
      fetched_at: now.toISOString(),
      last_verified_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      metadata: {
        contract: 'complete-contact-official-website-v1',
        searchProvider: 'brave',
        searchQueryContract: 'complete-contact-official-website-search-v2',
        candidateRank: candidate.rank,
        queryVariant: candidate.queryVariant,
        reasonCodes: candidate.verification.reasonCodes,
        checkedPages: candidate.verification.checkedPages,
        rawHtmlStored: false,
      },
    }, { onConflict: 'company_profile_id,normalized_domain' })
    .select('id')
    .single<{ id: string }>()
  if (error) throw error
  return data.id
}

export async function processCompleteContactDiscoveryWebsites(requestedLimit = 1) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverová konfigurace Supabase service role.')
  const limit = Math.min(1, Math.max(1, Math.trunc(requestedLimit)))

  const { data: state, error: stateError } = await client
    .from('complete_power_outage_contact_discovery_state')
    .select('discovery_enabled,website_lookup_enabled,contact_extraction_enabled,email_planning_enabled,email_dispatch_enabled')
    .eq('singleton', true)
    .maybeSingle<{
      discovery_enabled: boolean
      website_lookup_enabled: boolean
      contact_extraction_enabled: boolean
      email_planning_enabled: boolean
      email_dispatch_enabled: boolean
    }>()
  if (stateError) throw stateError
  if (!state?.discovery_enabled || !state.website_lookup_enabled) {
    return { status: 'disabled' as const, claimed: 0, verified: 0, needsReview: 0, noWebsite: 0, failed: 0 }
  }
  if (state.contact_extraction_enabled || state.email_planning_enabled || state.email_dispatch_enabled) {
    throw new Error('Bezpečnostní zámek odmítl krok 5, protože je aktivní pozdější fáze zpracování.')
  }

  const { data, error } = await client.rpc('claim_complete_power_outage_contact_discovery', {
    requested_limit: limit,
  })
  if (error) throw error
  const claims = (data ?? []) as WebsiteClaim[]
  if (claims.length === 0) {
    return { status: 'idle' as const, claimed: 0, verified: 0, needsReview: 0, noWebsite: 0, failed: 0 }
  }

  let verified = 0
  let needsReview = 0
  let noWebsite = 0
  let failed = 0

  for (const claim of claims) {
    try {
      const search = await diagnoseOfficialWebsiteWithBrave({
        companyName: claim.company_name,
        ico: claim.ico,
      })
      const checkedCandidates: CheckedCandidate[] = []
      for (const candidate of search.candidates) {
        const verification = await verifyOfficialWebsiteCandidate({
          candidateUrl: candidate.url,
          companyName: claim.company_name,
          ico: claim.ico,
        })
        checkedCandidates.push({ ...candidate, verification })
        if (verification.status === 'verified') break
      }

      const accepted = checkedCandidates.find((candidate) => candidate.verification.status === 'verified')
      const reviewCandidate = checkedCandidates.find((candidate) => candidate.verification.status === 'needs_review')
      const evidence = {
        contract: 'complete-contact-official-website-v1',
        provider: search.provider,
        queryContract: search.queryContract,
        searchedAt: search.searchedAt,
        queryCount: search.queryCount,
        resultCount: search.resultCount,
        acceptedCandidateCount: search.acceptedCandidateCount,
        checkedCandidates,
        rawSearchPayloadStored: false,
        rawHtmlStored: false,
      }

      if (accepted) {
        const websiteId = await saveVerifiedWebsite(client, claim, accepted)
        await finishWebsiteClaim(client, claim, { result: 'website_ready', websiteId, evidence })
        verified += 1
      } else if (reviewCandidate) {
        await finishWebsiteClaim(client, claim, { result: 'needs_review', evidence })
        needsReview += 1
      } else {
        await finishWebsiteClaim(client, claim, { result: 'no_website', evidence })
        noWebsite += 1
      }
    } catch (error) {
      const message = powerOutageErrorMessage(error, 'Ověření oficiálního webu selhalo.')
      try {
        await finishWebsiteClaim(client, claim, {
          result: 'error',
          evidence: { contract: 'complete-contact-official-website-v1', rawPayloadStored: false },
          errorCode: 'COMPLETE_CONTACT_WEBSITE_LOOKUP_FAILED',
          errorMessage: message,
          retryable: retryableWebsiteError(message),
        })
      } catch {
        // Lease se bezpečně obnoví databázovou claim funkcí po vypršení.
      }
      failed += 1
    }
  }

  return {
    status: failed > 0 ? 'partial' as const : 'succeeded' as const,
    claimed: claims.length,
    verified,
    needsReview,
    noWebsite,
    failed,
  }
}
