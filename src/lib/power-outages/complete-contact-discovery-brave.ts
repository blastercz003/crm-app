import 'server-only'

const BRAVE_WEB_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_RESULT_LIMIT = 5
const BRAVE_TIMEOUT_MS = 12_000

const BLOCKED_HOSTS = new Set([
  'ares.gov.cz',
  'facebook.com',
  'firmy.cz',
  'instagram.com',
  'justice.cz',
  'linkedin.com',
  'mapy.com',
  'mapy.cz',
  'or.justice.cz',
  'portal.gov.cz',
  'x.com',
  'youtube.com',
])

const BLOCKED_HOST_SUFFIXES = [
  '.facebook.com',
  '.firmy.cz',
  '.instagram.com',
  '.justice.cz',
  '.linkedin.com',
  '.mapy.com',
  '.mapy.cz',
  '.x.com',
  '.youtube.com',
]

type BraveWebResult = {
  url?: unknown
}

type BraveWebSearchPayload = {
  web?: {
    results?: unknown
  }
}

export type BraveOfficialWebsiteCandidate = {
  rank: number
  url: string
  hostname: string
  verificationStatus: 'unverified'
}

export type BraveOfficialWebsiteDiagnostic = {
  provider: 'brave'
  queryContract: 'complete-contact-official-website-search-v1'
  searchedAt: string
  resultCount: number
  acceptedCandidateCount: number
  rejectedResultCount: number
  candidates: BraveOfficialWebsiteCandidate[]
}

function normalizeIco(value: string) {
  const digits = value.replace(/\D/g, '')
  return /^\d{8}$/.test(digits) ? digits : null
}

function normalizeCompanyName(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length >= 2 && normalized.length <= 240 ? normalized : null
}

function escapeSearchPhrase(value: string) {
  return value.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildBraveOfficialWebsiteQuery(companyName: string, ico: string) {
  const safeName = normalizeCompanyName(companyName)
  const safeIco = normalizeIco(ico)
  if (!safeName || !safeIco) throw new Error('Pro vyhledání webu chybí platný název firmy nebo IČO.')
  return `"${escapeSearchPhrase(safeName)}" "${safeIco}"`
}

function isBlockedHostname(hostname: string) {
  return BLOCKED_HOSTS.has(hostname)
    || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
}

function candidateFromResult(value: unknown, rank: number): BraveOfficialWebsiteCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as BraveWebResult
  if (typeof result.url !== 'string') return null

  try {
    const url = new URL(result.url)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!hostname || isBlockedHostname(hostname)) return null
    if (/\.(?:pdf|docx?|xlsx?|zip)$/i.test(url.pathname)) return null
    return {
      rank,
      url: url.toString(),
      hostname,
      verificationStatus: 'unverified',
    }
  } catch {
    return null
  }
}

export async function diagnoseOfficialWebsiteWithBrave(input: {
  companyName: string
  ico: string
}): Promise<BraveOfficialWebsiteDiagnostic> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim()
  if (!apiKey) throw new Error('Na serveru chybí BRAVE_SEARCH_API_KEY.')

  const query = buildBraveOfficialWebsiteQuery(input.companyName, input.ico)
  const endpoint = new URL(BRAVE_WEB_SEARCH_ENDPOINT)
  endpoint.searchParams.set('q', query)
  endpoint.searchParams.set('country', 'CZ')
  endpoint.searchParams.set('search_lang', 'cs')
  endpoint.searchParams.set('ui_lang', 'cs-CZ')
  endpoint.searchParams.set('count', String(BRAVE_RESULT_LIMIT))
  endpoint.searchParams.set('result_filter', 'web')
  endpoint.searchParams.set('safesearch', 'strict')
  endpoint.searchParams.set('spellcheck', 'false')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BRAVE_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Brave Search odmítl API klíč nebo oprávnění.')
      }
      if (response.status === 429) {
        throw new Error('Brave Search dočasně odmítl dotaz kvůli limitu.')
      }
      throw new Error(`Brave Search vrátil HTTP ${response.status}.`)
    }

    const payload = await response.json() as BraveWebSearchPayload
    const rawResults = Array.isArray(payload.web?.results) ? payload.web.results : []
    const candidates: BraveOfficialWebsiteCandidate[] = []
    const seenHosts = new Set<string>()

    rawResults.forEach((result, index) => {
      const candidate = candidateFromResult(result, index + 1)
      if (!candidate || seenHosts.has(candidate.hostname)) return
      seenHosts.add(candidate.hostname)
      candidates.push(candidate)
    })

    return {
      provider: 'brave',
      queryContract: 'complete-contact-official-website-search-v1',
      searchedAt: new Date().toISOString(),
      resultCount: rawResults.length,
      acceptedCandidateCount: candidates.length,
      rejectedResultCount: rawResults.length - candidates.length,
      candidates,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Brave Search překročil bezpečný časový limit.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
