import 'server-only'

const BRAVE_WEB_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_RESULT_LIMIT = 5
const BRAVE_V2_RESULT_LIMIT = 10
const BRAVE_TIMEOUT_MS = 12_000
const BRAVE_CANDIDATE_LIMIT = 3
const BRAVE_V2_CANDIDATE_LIMIT = 5
const BRAVE_MIN_REQUEST_INTERVAL_MS = 1_100
const BRAVE_RATE_LIMIT_RETRY_CAP_MS = 5_000

let lastBraveRequestStartedAt = 0

const BLOCKED_HOSTS = new Set([
  'ares.gov.cz',
  'facebook.com',
  'firmy.cz',
  'firmy.euro.cz',
  'finmag.cz',
  'finstat.cz',
  'finance.cz',
  'companywall.cz',
  'b2bhint.com',
  'aaadodavatel.cz',
  'aktualnezregionu.cz',
  'autobazar.sk',
  'betonserver.cz',
  'chytryrejstrik.cz',
  'dobrykontakt.cz',
  'edb.cz',
  'electroindustry.cz',
  'firmyvdosahu.cz',
  'financni-web.cz',
  'hlidacstatu.cz',
  'idatabaze.cz',
  'industrycontact.cz',
  'info-morava.cz',
  'info-cechy.cz',
  'info-vysocina.cz',
  'instagram.com',
  'ispis.com',
  'ispis.cz',
  'jenfirmy.cz',
  'justice.cz',
  'kompass.com',
  'kurzy.cz',
  'linkedin.com',
  'lei.bloomberg.com',
  'medicusindex.cz',
  'northdata.com',
  'nzip.cz',
  'mapy.com',
  'mapy.cz',
  'mesec.cz',
  'or.justice.cz',
  'orsr.sk',
  'obchodiste.cz',
  'ov.gov.cz',
  'penize.cz',
  'podnikatel.cz',
  'portal.gov.cz',
  'pracesemily.cz',
  'qoobus.com',
  'rejstriky.finance.cz',
  'rocketreach.co',
  'search.seznam.cz',
  'seznamremeslniku.cz',
  'sluzby.cz',
  'telefonny.zoznam.sk',
  'transparex.sk',
  'usteckyinfo.cz',
  'wikidata.org',
  'zlatestranky.cz',
  'hradeckralove.org',
  'ceska-trebova.cz',
  'ratajpolska.pl',
  'x.com',
  'youtube.com',
  'zivefirmy.cz',
])

const BLOCKED_HOST_SUFFIXES = [
  '.facebook.com',
  '.firmy.cz',
  '.firmy.euro.cz',
  '.finmag.cz',
  '.finstat.cz',
  '.finance.cz',
  '.companywall.cz',
  '.b2bhint.com',
  '.aaadodavatel.cz',
  '.aktualnezregionu.cz',
  '.autobazar.sk',
  '.betonserver.cz',
  '.chytryrejstrik.cz',
  '.dobrykontakt.cz',
  '.edb.cz',
  '.electroindustry.cz',
  '.firmyvdosahu.cz',
  '.financni-web.cz',
  '.hlidacstatu.cz',
  '.idatabaze.cz',
  '.industrycontact.cz',
  '.info-cechy.cz',
  '.info-vysocina.cz',
  '.info-morava.cz',
  '.instagram.com',
  '.ispis.com',
  '.ispis.cz',
  '.jenfirmy.cz',
  '.justice.cz',
  '.kompass.com',
  '.kurzy.cz',
  '.linkedin.com',
  '.bloomberg.com',
  '.northdata.com',
  '.nzip.cz',
  '.medicusindex.cz',
  '.mapy.com',
  '.mapy.cz',
  '.mesec.cz',
  '.penize.cz',
  '.orsr.sk',
  '.obchodiste.cz',
  '.ov.gov.cz',
  '.podnikatel.cz',
  '.pracesemily.cz',
  '.qoobus.com',
  '.rocketreach.co',
  '.search.seznam.cz',
  '.seznamremeslniku.cz',
  '.sluzby.cz',
  '.telefonny.zoznam.sk',
  '.transparex.sk',
  '.usteckyinfo.cz',
  '.wikidata.org',
  '.zlatestranky.cz',
  '.hradeckralove.org',
  '.ceska-trebova.cz',
  '.ratajpolska.pl',
  '.x.com',
  '.youtube.com',
  '.zivefirmy.cz',
]

type BraveWebResult = {
  url?: unknown
}

type BraveWebSearchPayload = {
  web?: {
    results?: unknown
  }
}

type BraveErrorPayload = {
  error?: {
    code?: unknown
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForBraveRequestSlot() {
  const remaining = BRAVE_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastBraveRequestStartedAt)
  if (remaining > 0) await wait(remaining)
  lastBraveRequestStartedAt = Date.now()
}

function rateLimitResetMilliseconds(response: Response) {
  const retryAfter = Number(response.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.ceil(retryAfter * 1_000) + 100

  const resetValues = (response.headers.get('x-ratelimit-reset') ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0)
  if (resetValues.length === 0) return BRAVE_MIN_REQUEST_INTERVAL_MS
  return Math.ceil(Math.min(...resetValues) * 1_000) + 100
}

export type BraveOfficialWebsiteCandidate = {
  rank: number
  queryVariant: 'name_ico' | 'name_contact'
  url: string
  hostname: string
  verificationStatus: 'unverified'
}

export type BraveOfficialWebsiteDiagnostic = {
  provider: 'brave'
  queryContract: 'complete-contact-official-website-search-v2'
  searchedAt: string
  queryCount: number
  resultCount: number
  acceptedCandidateCount: number
  rejectedResultCount: number
  candidates: BraveOfficialWebsiteCandidate[]
}

export type BraveOfficialWebsiteV2Diagnostic = Omit<BraveOfficialWebsiteDiagnostic, 'queryContract'> & {
  queryContract: 'complete-contact-official-website-search-v3'
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

const V2_SEARCH_EXCLUSIONS = [
  'ispis.cz', 'qoobus.com', 'northdata.com', 'industrycontact.cz',
  'firmyvdosahu.cz', 'chytryrejstrik.cz', 'wikidata.org', 'nzip.cz',
  'ov.gov.cz', 'obchodiste.cz', 'sluzby.cz', 'zlatestranky.cz',
]

export function buildBraveOfficialWebsiteQuery(
  companyName: string,
  ico: string,
  variant: 'name_ico' | 'name_contact' = 'name_ico',
) {
  const safeName = normalizeCompanyName(companyName)
  const safeIco = normalizeIco(ico)
  if (!safeName || !safeIco) throw new Error('Pro vyhledání webu chybí platný název firmy nebo IČO.')
  return variant === 'name_ico'
    ? `"${escapeSearchPhrase(safeName)}" "${safeIco}"`
    : `"${escapeSearchPhrase(safeName)}" kontakt`
}

function buildBraveOfficialWebsiteV2Query(
  companyName: string,
  ico: string,
  variant: BraveOfficialWebsiteCandidate['queryVariant'],
) {
  const base = buildBraveOfficialWebsiteQuery(companyName, ico, variant)
  return `${base} ${V2_SEARCH_EXCLUSIONS.map((host) => `-site:${host}`).join(' ')}`
}

function isBlockedHostname(hostname: string) {
  return BLOCKED_HOSTS.has(hostname)
    || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
}

function candidateFromResult(
  value: unknown,
  rank: number,
  queryVariant: BraveOfficialWebsiteCandidate['queryVariant'],
): BraveOfficialWebsiteCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as BraveWebResult
  if (typeof result.url !== 'string') return null

  try {
    const url = new URL(result.url)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!hostname || isBlockedHostname(hostname)) return null
    if (/\.(?:pdf|docx?|xlsx?|zip)$/i.test(url.pathname)) return null
    if (/(?:obchodni-rejstrik|rejstrik-firem|\/firma\/|\/firmy\/|\/subjekt\/|company-profile)/i.test(url.pathname)) return null
    return {
      rank,
      queryVariant,
      url: url.toString(),
      hostname,
      verificationStatus: 'unverified',
    }
  } catch {
    return null
  }
}

async function braveSearch(input: {
  companyName: string
  ico: string
  variant: BraveOfficialWebsiteCandidate['queryVariant']
  queryContract?: 'v2' | 'v3'
  resultLimit?: number
}) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim()
  if (!apiKey) throw new Error('Na serveru chybí BRAVE_SEARCH_API_KEY.')

  const query = input.queryContract === 'v3'
    ? buildBraveOfficialWebsiteV2Query(input.companyName, input.ico, input.variant)
    : buildBraveOfficialWebsiteQuery(input.companyName, input.ico, input.variant)
  const endpoint = new URL(BRAVE_WEB_SEARCH_ENDPOINT)
  endpoint.searchParams.set('q', query)
  endpoint.searchParams.set('count', String(input.resultLimit ?? BRAVE_RESULT_LIMIT))
  endpoint.searchParams.set('result_filter', 'web')
  endpoint.searchParams.set('safesearch', 'strict')
  endpoint.searchParams.set('spellcheck', 'false')

  for (let requestAttempt = 0; requestAttempt < 2; requestAttempt += 1) {
    await waitForBraveRequestSlot()
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
        const errorPayload = await response.json().catch(() => null) as BraveErrorPayload | null
        const errorCode = typeof errorPayload?.error?.code === 'string'
          ? errorPayload.error.code
          : null
        if (errorCode === 'SUBSCRIPTION_TOKEN_INVALID' || response.status === 401 || response.status === 403) {
          throw new Error('Brave Search odmítl API klíč nebo oprávnění.')
        }
        if (response.status === 429) {
          if (errorCode === 'QUOTA_LIMITED') {
            throw new Error('Brave Search vyčerpal měsíční kvótu API.')
          }
          const retryInMs = rateLimitResetMilliseconds(response)
          if (requestAttempt === 0 && retryInMs <= BRAVE_RATE_LIMIT_RETRY_CAP_MS) {
            await wait(Math.max(BRAVE_MIN_REQUEST_INTERVAL_MS, retryInMs))
            continue
          }
          throw new Error(`Brave Search dočasně odmítl dotaz kvůli limitu; další pokus nejdříve za ${Math.ceil(retryInMs / 1_000)} s.`)
        }
        throw new Error(`Brave Search vrátil HTTP ${response.status}.`)
      }

      const payload = await response.json() as BraveWebSearchPayload
      const rawResults = Array.isArray(payload.web?.results) ? payload.web.results : []
      return rawResults.map((result, index) => candidateFromResult(result, index + 1, input.variant))
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Brave Search překročil bezpečný časový limit.')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error('Brave Search nevrátil výsledek po bezpečném opakování.')
}

export async function diagnoseOfficialWebsiteWithBrave(input: {
  companyName: string
  ico: string
}): Promise<BraveOfficialWebsiteDiagnostic> {
  const variants: BraveOfficialWebsiteCandidate['queryVariant'][] = ['name_ico', 'name_contact']
  const candidates: BraveOfficialWebsiteCandidate[] = []
  const seenHosts = new Set<string>()
  let resultCount = 0
  let queryCount = 0

  for (const variant of variants) {
    const results = await braveSearch({ ...input, variant })
    queryCount += 1
    resultCount += results.length
    for (const candidate of results) {
      if (!candidate || seenHosts.has(candidate.hostname)) continue
      seenHosts.add(candidate.hostname)
      candidates.push(candidate)
      if (candidates.length >= BRAVE_CANDIDATE_LIMIT) break
    }
    if (candidates.length >= BRAVE_CANDIDATE_LIMIT) break
  }

  return {
    provider: 'brave',
    queryContract: 'complete-contact-official-website-search-v2',
    searchedAt: new Date().toISOString(),
    queryCount,
    resultCount,
    acceptedCandidateCount: candidates.length,
    rejectedResultCount: Math.max(0, resultCount - candidates.length),
    candidates,
  }
}

export async function diagnoseOfficialWebsiteV2WithBrave(input: {
  companyName: string
  ico: string
}): Promise<BraveOfficialWebsiteV2Diagnostic> {
  const variants: BraveOfficialWebsiteCandidate['queryVariant'][] = ['name_ico', 'name_contact']
  const candidates: BraveOfficialWebsiteCandidate[] = []
  const seenHosts = new Set<string>()
  let resultCount = 0
  let queryCount = 0

  for (const variant of variants) {
    const results = await braveSearch({
      ...input,
      variant,
      queryContract: 'v3',
      resultLimit: BRAVE_V2_RESULT_LIMIT,
    })
    queryCount += 1
    resultCount += results.length
    for (const candidate of results) {
      if (!candidate || seenHosts.has(candidate.hostname)) continue
      seenHosts.add(candidate.hostname)
      candidates.push(candidate)
      if (candidates.length >= BRAVE_V2_CANDIDATE_LIMIT) break
    }
    if (candidates.length >= BRAVE_V2_CANDIDATE_LIMIT) break
  }

  return {
    provider: 'brave',
    queryContract: 'complete-contact-official-website-search-v3',
    searchedAt: new Date().toISOString(),
    queryCount,
    resultCount,
    acceptedCandidateCount: candidates.length,
    rejectedResultCount: Math.max(0, resultCount - candidates.length),
    candidates,
  }
}
