import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  extractContactsFromVerifiedOfficialWebsite,
  type ShadowWebsiteContact,
} from './complete-contact-discovery-website-verification'
import { powerOutageErrorMessage } from './error-message'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type ContactExtractionClaim = {
  ico: string
  company_profile_id: string
  website_url: string
  normalized_domain: string
  processing_token: string
  attempt_count: number
}

const ITEM_BUDGET_MS = 120_000
const COMPLETION_RESERVE_MS = 15_000
const BUDGET_ERROR = 'WEBSITE_VERIFICATION_BUDGET_EXCEEDED'

async function finishClaim(client: ServiceClient, claim: ContactExtractionClaim, input: {
  result: 'contacts_found' | 'no_contact' | 'needs_review' | 'error'
  contacts?: ShadowWebsiteContact[]
  evidence?: Record<string, unknown>
  errorCode?: string | null
  errorMessage?: string | null
  retryable?: boolean
}) {
  const { data, error } = await client.rpc('finish_complete_power_outage_contact_extraction_shadow', {
    requested_ico: claim.ico,
    requested_processing_token: claim.processing_token,
    requested_result: input.result,
    requested_contacts: input.contacts ?? [],
    requested_evidence: input.evidence ?? {},
    requested_error_code: input.errorCode ?? null,
    requested_error_message: input.errorMessage ?? null,
    requested_retryable: input.retryable ?? true,
  })
  if (error) throw error
  if (data !== true) throw new Error(`Lease SHADOW extrakce kontaktů IČO ${claim.ico} již není platný.`)
}

export async function processCompleteContactExtractionShadow() {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverová konfigurace Supabase service role.')

  const { data: state, error: stateError } = await client
    .from('complete_power_outage_contact_discovery_state')
    .select('contact_extraction_shadow_enabled,contact_extraction_enabled,ui_enabled,email_planning_enabled,email_dispatch_enabled')
    .eq('singleton', true)
    .maybeSingle<{
      contact_extraction_shadow_enabled: boolean
      contact_extraction_enabled: boolean
      ui_enabled: boolean
      email_planning_enabled: boolean
      email_dispatch_enabled: boolean
    }>()
  if (stateError) throw stateError
  if (!state?.contact_extraction_shadow_enabled) {
    return { status: 'disabled' as const, claimed: 0, contacts: 0 }
  }
  if (state.contact_extraction_enabled || state.ui_enabled || state.email_planning_enabled || state.email_dispatch_enabled) {
    throw new Error('Bezpečnostní zámek odmítl SHADOW extrakci, protože je aktivní pozdější fáze.')
  }

  const { data, error } = await client.rpc('claim_complete_power_outage_contact_extraction_shadow')
  if (error) throw error
  const claims = (data ?? []) as ContactExtractionClaim[]
  if (claims.length === 0) return { status: 'idle' as const, claimed: 0, contacts: 0 }
  const claim = claims[0]

  try {
    const extraction = await extractContactsFromVerifiedOfficialWebsite({
      websiteUrl: claim.website_url,
      expectedDomain: claim.normalized_domain,
      deadlineAt: Date.now() + ITEM_BUDGET_MS - COMPLETION_RESERVE_MS,
      maxPages: 3,
    })
    const evidence = {
      contract: 'complete-contact-extraction-shadow-v1',
      normalizedDomain: extraction.normalizedDomain,
      checkedPages: extraction.checkedPages,
      rawHtmlStored: false,
      externalSearchPerformed: false,
      productionContactsPersisted: false,
      timeBudgetMilliseconds: ITEM_BUDGET_MS,
    }
    const result = extraction.contacts.length > 0 ? 'contacts_found' : 'no_contact'
    await finishClaim(client, claim, { result, contacts: extraction.contacts, evidence })
    return { status: 'succeeded' as const, claimed: 1, contacts: extraction.contacts.length }
  } catch (error) {
    const message = powerOutageErrorMessage(error, 'SHADOW extrakce kontaktů selhala.')
    try {
      if (error instanceof Error && error.message === BUDGET_ERROR) {
        await finishClaim(client, claim, {
          result: 'needs_review',
          evidence: {
            contract: 'complete-contact-extraction-shadow-v1',
            reasonCodes: ['contact_extraction_time_budget_exceeded'],
            productionContactsPersisted: false,
          },
          retryable: false,
        })
      } else {
        await finishClaim(client, claim, {
          result: 'error',
          evidence: {
            contract: 'complete-contact-extraction-shadow-v1',
            productionContactsPersisted: false,
          },
          errorCode: 'COMPLETE_CONTACT_EXTRACTION_SHADOW_FAILED',
          errorMessage: message,
          retryable: true,
        })
      }
    } catch {
      // Propadlý lease uzavře databázová claim funkce jako needs_review.
    }
    return { status: 'partial' as const, claimed: 1, contacts: 0 }
  }
}
