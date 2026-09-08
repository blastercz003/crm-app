import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { powerOutageErrorMessage } from './error-message'
import { powerOutageSha256 } from './normalization'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type ClaimRow = {
  ico: string
  requested_sources: string[]
  processing_token: string
  attempt_count: number
}

type PublicContact = {
  type: 'email' | 'phone'
  value: string
  normalizedValue: string
}

const ARES_RES_ENDPOINT = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty-res'
const ARES_MINUTE_LIMIT = 60
const ARES_DAY_LIMIT = 30_000

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  const object = objectValue(value)
  if (!object) return null
  return scalarText(object.kod) ?? scalarText(object.nazev) ?? scalarText(object.text)
}

function firstField(root: unknown, keys: string[]) {
  const object = objectValue(root)
  if (!object) return null
  for (const key of keys) {
    const value = scalarText(object[key])
    if (value) return value
  }
  return null
}

function unwrapSubject(payload: unknown) {
  const root = objectValue(payload)
  if (!root) return null
  for (const key of ['ekonomickeSubjekty', 'zaznamy', 'subjekty', 'polozky']) {
    const list = root[key]
    if (Array.isArray(list) && list.length > 0) return objectValue(list[0]) ?? root
  }
  return root
}

function normalizeNace(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 2 && digits.length <= 6 ? digits : null
}

function collectNaceCodes(value: unknown, keyHint = '', output = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectNaceCodes(item, keyHint, output)
    return output
  }
  const object = objectValue(value)
  if (object) {
    for (const [key, item] of Object.entries(object)) collectNaceCodes(item, key, output)
    return output
  }
  if (/nace/i.test(keyHint)) {
    const code = scalarText(value)
    const normalized = code ? normalizeNace(code) : null
    if (normalized) output.add(normalized)
  }
  return output
}

function normalizeEmail(value: string) {
  const normalized = value.trim().toLocaleLowerCase('cs-CZ').replace(/^mailto:/i, '')
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null
}

function normalizePhone(value: string) {
  const trimmed = value.trim().replace(/^tel:/i, '')
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 15) return null
  return `${trimmed.startsWith('+') ? '+' : ''}${digits}`
}

function collectPublicContacts(value: unknown, keyHint = '', output = new Map<string, PublicContact>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectPublicContacts(item, keyHint, output)
    return output
  }
  const object = objectValue(value)
  if (object) {
    for (const [key, item] of Object.entries(object)) collectPublicContacts(item, key, output)
    return output
  }
  const text = scalarText(value)
  if (!text) return output
  if (/(?:e-?mail|emailovaAdresa)/i.test(keyHint)) {
    const normalized = normalizeEmail(text)
    if (normalized) output.set(`email:${normalized}`, { type: 'email', value: text, normalizedValue: normalized })
  }
  if (/(?:telefon|phone|mobil)/i.test(keyHint)) {
    const normalized = normalizePhone(text)
    if (normalized) output.set(`phone:${normalized}`, { type: 'phone', value: text, normalizedValue: normalized })
  }
  return output
}

async function fetchPublicRes(ico: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${ARES_RES_ENDPOINT}/${encodeURIComponent(ico)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`ARES RES HTTP ${response.status}`)
    return await response.json() as unknown
  } finally {
    clearTimeout(timeout)
  }
}

async function claimSharedAresQuota(client: ServiceClient) {
  const { data, error } = await client.rpc('claim_complete_power_outage_provider_quota', {
    requested_provider: 'ares',
    requested_minute_limit: ARES_MINUTE_LIMIT,
    requested_day_limit: ARES_DAY_LIMIT,
  })
  if (error) throw error
  return data === true
}

async function releaseClaim(client: ServiceClient, row: ClaimRow) {
  const { error } = await client.rpc('release_complete_power_outage_company_enrichment_claim', {
    requested_ico: row.ico,
    requested_processing_token: row.processing_token,
    requested_delay_seconds: 60,
  })
  if (error) throw error
}

async function finishClaim(client: ServiceClient, row: ClaimRow, input: {
  result: 'ready' | 'not_found' | 'error'
  profileId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  retryable?: boolean
}) {
  const { data, error } = await client.rpc('finish_complete_power_outage_company_enrichment', {
    requested_ico: row.ico,
    requested_processing_token: row.processing_token,
    requested_result: input.result,
    requested_company_profile_id: input.profileId ?? null,
    requested_error_code: input.errorCode ?? null,
    requested_error_message: input.errorMessage ?? null,
    requested_retryable: input.retryable ?? true,
  })
  if (error) throw error
  if (data !== true) throw new Error(`Enrichment lease pro IČO ${row.ico} již není platný.`)
}

async function saveProfile(client: ServiceClient, ico: string, payload: unknown) {
  const subject = unwrapSubject(payload)
  if (!subject) throw new Error('ARES RES vrátil neplatný profil subjektu.')
  const officialName = firstField(subject, ['obchodniJmeno', 'nazev', 'firma'])
  if (!officialName) throw new Error('ARES RES profil neobsahuje název subjektu.')
  const naceCodes = [...collectNaceCodes(subject)].sort()
  const prevailingNace = firstField(subject, ['czNacePrevazujici', 'czNacePrevazujici2008'])
  const primaryNaceCode = prevailingNace ? normalizeNace(prevailingNace) : null
  const fetchedAt = new Date()
  const expiresAt = new Date(fetchedAt.getTime() + 30 * 24 * 60 * 60_000)
  const subjectStatus = firstField(subject, ['stavZdrojeRes', 'stavSubjektu', 'stav'])
  const { data: profile, error: profileError } = await client
    .from('complete_power_outage_company_profiles')
    .upsert({
      ico,
      official_name: officialName,
      legal_form: firstField(subject, ['pravniForma', 'kodPravniFormy']),
      primary_nace_code: primaryNaceCode ?? naceCodes[0] ?? null,
      nace_codes: naceCodes,
      subject_status: subjectStatus,
      is_in_liquidation: /v\s+likvidaci/i.test(officialName),
      is_terminated: /zanikl|vymazan|ukoncen/i.test(subjectStatus ?? ''),
      source_registries: ['res'],
      fetched_at: fetchedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      payload_sha256: powerOutageSha256(payload),
      metadata: { contract: 'complete-company-ares-res-v1', publicSource: true },
    }, { onConflict: 'ico' })
    .select('id')
    .single<{ id: string }>()
  if (profileError) throw profileError

  const contacts = [...collectPublicContacts(subject).values()]
  if (contacts.length > 0) {
    const { error: contactError } = await client
      .from('complete_power_outage_company_contacts')
      .upsert(contacts.map((contact) => ({
        company_profile_id: profile.id,
        contact_type: contact.type,
        contact_value: contact.value,
        normalized_value: contact.normalizedValue,
        source_registry: 'ares_res',
        source_reference: ico,
        source_url: `${ARES_RES_ENDPOINT}/${encodeURIComponent(ico)}`,
        is_public_at_source: true,
        source_validity_status: 'valid',
        outreach_permission_status: 'unknown',
        fetched_at: fetchedAt.toISOString(),
        last_verified_at: fetchedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        metadata: { collectedAutomatically: true },
      })), { onConflict: 'company_profile_id,contact_type,normalized_value' })
    if (contactError) throw contactError
  }
  return { profileId: profile.id, contactCount: contacts.length }
}

export async function enrichCompletePowerOutageCompanyProfiles(requestedLimit = 10) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverová konfigurace Supabase service role.')
  const limit = Math.min(50, Math.max(1, Math.trunc(requestedLimit)))
  const { data: state, error: stateError } = await client
    .from('complete_power_outage_commercial_selection_state')
    .select('res_enrichment_enabled')
    .eq('singleton', true)
    .maybeSingle<{ res_enrichment_enabled: boolean }>()
  if (stateError) throw stateError
  if (!state?.res_enrichment_enabled) {
    return { status: 'disabled' as const, claimed: 0, ready: 0, notFound: 0, failed: 0, contacts: 0 }
  }

  const { data, error } = await client.rpc('claim_complete_power_outage_company_enrichment', {
    requested_limit: limit,
  })
  if (error) throw error
  const rows = (data ?? []) as ClaimRow[]
  let ready = 0
  let notFound = 0
  let failed = 0
  let contacts = 0

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    try {
      if (!(await claimSharedAresQuota(client))) {
        for (const waitingRow of rows.slice(index)) await releaseClaim(client, waitingRow)
        break
      }
      const payload = await fetchPublicRes(row.ico)
      if (!payload) {
        await finishClaim(client, row, { result: 'not_found' })
        notFound += 1
        continue
      }
      const saved = await saveProfile(client, row.ico, payload)
      await finishClaim(client, row, { result: 'ready', profileId: saved.profileId })
      ready += 1
      contacts += saved.contactCount
    } catch (error) {
      const message = powerOutageErrorMessage(error, 'ARES RES enrichment selhal.')
      const retryable = !/HTTP\s+(400|404)\b/i.test(message)
      await finishClaim(client, row, {
        result: 'error',
        errorCode: 'COMPLETE_COMPANY_ARES_RES_FAILED',
        errorMessage: message,
        retryable,
      })
      failed += 1
    }
  }

  return { status: 'processed' as const, claimed: rows.length, ready, notFound, failed, contacts }
}
