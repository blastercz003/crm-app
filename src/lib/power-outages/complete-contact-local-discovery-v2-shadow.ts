import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { localWebsiteCandidates } from './complete-contact-local-candidates'
import {
  extractContactsFromVerifiedOfficialWebsite,
  verifyOfficialWebsiteCandidateV2,
  type OfficialWebsiteVerificationV2,
  type ShadowWebsiteContact,
} from './complete-contact-discovery-website-verification'
import { powerOutageErrorMessage } from './error-message'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type LocalDiscoveryClaim = {
  batch_id: string
  ico: string
  company_profile_id: string
  company_name: string
  known_website_urls: unknown
  processing_token: string
  attempt_count: number
}

type CheckedCandidate = {
  source: 'verified_cache' | 'deterministic_guess'
  url: string
  verification: OfficialWebsiteVerificationV2
}

const ITEM_BUDGET_MS = 120_000
const CANDIDATE_BUDGET_MS = 28_000
const COMPLETION_RESERVE_MS = 12_000
const MAX_KNOWN_CANDIDATES = 2
const MAX_GUESSED_CANDIDATES = 3

function websiteUrls(value: unknown) {
  if (!Array.isArray(value)) return []
  const urls: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    try {
      const url = new URL(item)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      urls.push(url.toString())
    } catch {
      continue
    }
  }
  return [...new Set(urls)].slice(0, MAX_KNOWN_CANDIDATES)
}

function automaticEmail(contact: ShadowWebsiteContact) {
  if (contact.type !== 'email') return false
  const localPart = contact.normalizedValue.split('@', 1)[0]?.toLowerCase() ?? ''
  return /^(?:servis|service|servisni|provoz|vyroba|technik|technicke|udrzba|maintenance|dispecink|dispatch|doprava|logistika|sklad|mistr|vedouci|zkusebna|lakovna|technologie|nahradni)(?:[._-]|$)/.test(localPart)
    || /^(?:info|kontakt|contact|office|recepce|reception|sekretariat|mail|hello|firma|company)(?:[._-]|$)/.test(localPart)
    || /^(?:obchod|obchodni|sales|poptav[a-z]*|rfq|nabid[a-z]*|export)(?:[._-]|$)/.test(localPart)
    || /^priprava[._-]?nabid/.test(localPart)
    || ['okna.priprava', 'vysavace.odsavace', 'alucomposite', 'modrylom'].includes(localPart)
}

async function finishClaim(client: ServiceClient, claim: LocalDiscoveryClaim, input: {
  result: 'completed' | 'error'
  contacts?: ShadowWebsiteContact[]
  checkedCandidates?: CheckedCandidate[]
  errorCode?: string | null
  errorMessage?: string | null
}) {
  const { data, error } = await client.rpc('finish_complete_power_outage_contact_local_discovery_v2_shadow', {
    requested_ico: claim.ico,
    requested_processing_token: claim.processing_token,
    requested_result: input.result,
    requested_contacts: input.contacts ?? [],
    requested_checked_candidates: input.checkedCandidates ?? [],
    requested_error_code: input.errorCode ?? null,
    requested_error_message: input.errorMessage ?? null,
  })
  if (error) throw error
  if (data !== true) throw new Error(`Lease lokálního dohledání IČO ${claim.ico} již není platný.`)
}

export async function processCompleteContactLocalDiscoveryV2Shadow() {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverová konfigurace Supabase service role.')

  const { data: state, error: stateError } = await client
    .from('complete_power_outage_contact_discovery_state')
    .select('local_discovery_v2_shadow_enabled,email_dispatch_enabled')
    .eq('singleton', true)
    .maybeSingle<{ local_discovery_v2_shadow_enabled: boolean; email_dispatch_enabled: boolean }>()
  if (stateError) throw stateError
  if (!state?.local_discovery_v2_shadow_enabled) {
    return { status: 'disabled' as const, claimed: 0, contacts: 0, eligibleEmails: 0 }
  }
  if (state.email_dispatch_enabled) {
    throw new Error('Bezpečnostní zámek odmítl lokální SHADOW dohledání při aktivním odesílání.')
  }

  const { data, error } = await client.rpc('claim_complete_power_outage_contact_local_discovery_v2_shadow')
  if (error) throw error
  const claims = (data ?? []) as LocalDiscoveryClaim[]
  if (claims.length === 0) {
    return { status: 'idle' as const, claimed: 0, contacts: 0, eligibleEmails: 0 }
  }

  const claim = claims[0]
  const deadlineAt = Date.now() + ITEM_BUDGET_MS
  const candidates = [
    ...websiteUrls(claim.known_website_urls).map((url) => ({ source: 'verified_cache' as const, url })),
    ...localWebsiteCandidates(claim.company_name)
      .slice(0, MAX_GUESSED_CANDIDATES)
      .map((url) => ({ source: 'deterministic_guess' as const, url })),
  ]
  const seenDomains = new Set<string>()
  const checkedCandidates: CheckedCandidate[] = []
  const contacts = new Map<string, ShadowWebsiteContact>()

  try {
    for (const candidate of candidates) {
      if (Date.now() >= deadlineAt - COMPLETION_RESERVE_MS) break
      const hostname = new URL(candidate.url).hostname.toLowerCase().replace(/^www\./, '')
      if (seenDomains.has(hostname)) continue
      seenDomains.add(hostname)

      const verification = await verifyOfficialWebsiteCandidateV2({
        candidateUrl: candidate.url,
        companyName: claim.company_name,
        ico: claim.ico,
        deadlineAt: Math.min(deadlineAt - COMPLETION_RESERVE_MS, Date.now() + CANDIDATE_BUDGET_MS),
        maxPages: 2,
      })
      checkedCandidates.push({ ...candidate, verification })
      if (verification.status !== 'verified_company' || !verification.verifiedUrl) continue

      const extraction = await extractContactsFromVerifiedOfficialWebsite({
        websiteUrl: verification.verifiedUrl,
        expectedDomain: verification.normalizedDomain,
        deadlineAt: deadlineAt - COMPLETION_RESERVE_MS,
        maxPages: 3,
      })
      for (const contact of extraction.contacts) {
        const key = `${contact.type}:${contact.normalizedValue}`
        const previous = contacts.get(key)
        if (!previous || contact.confidence > previous.confidence) contacts.set(key, contact)
      }
      if ([...contacts.values()].some(automaticEmail)) break
    }

    const extractedContacts = [...contacts.values()]
    await finishClaim(client, claim, {
      result: 'completed',
      contacts: extractedContacts,
      checkedCandidates,
    })
    return {
      status: 'succeeded' as const,
      claimed: 1,
      contacts: extractedContacts.length,
      eligibleEmails: extractedContacts.filter(automaticEmail).length,
      braveRequests: 0,
    }
  } catch (error) {
    const message = powerOutageErrorMessage(error, 'Lokální SHADOW dohledání kontaktu selhalo.')
    try {
      await finishClaim(client, claim, {
        result: 'error',
        checkedCandidates,
        errorCode: 'COMPLETE_CONTACT_LOCAL_DISCOVERY_V2_FAILED',
        errorMessage: message,
      })
    } catch {
      // Propadlý lease uvolní databázová claim funkce při dalším průchodu.
    }
    return { status: 'partial' as const, claimed: 1, contacts: 0, eligibleEmails: 0, braveRequests: 0 }
  }
}
