import 'server-only'

import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { domainToASCII } from 'node:url'

const FETCH_TIMEOUT_MS = 7_000
const MAX_RESPONSE_BYTES = 1_000_000
const MAX_REDIRECTS = 3
const MAX_PAGES_PER_CANDIDATE = 3
const WEBSITE_VERIFICATION_BUDGET_EXCEEDED = 'WEBSITE_VERIFICATION_BUDGET_EXCEEDED'

type SafeHtmlResponse = {
  url: string
  status: number
  html: string
}

export type WebsiteVerificationPage = {
  url: string
  status: number | null
  matchedIco: boolean
  matchedName: boolean
  matchedDomainEmail?: boolean
  errorCode: 'fetch_failed' | 'non_html' | null
}

export type OfficialWebsiteVerificationV2 = {
  status: 'verified_company' | 'verified_group' | 'needs_review' | 'rejected'
  normalizedDomain: string
  verifiedUrl: string | null
  confidence: number
  verificationMethods: string[]
  reasonCodes: string[]
  checkedPages: WebsiteVerificationPage[]
}

export type ShadowWebsiteContact = {
  type: 'email' | 'phone'
  value: string
  normalizedValue: string
  sourceUrl: string
  scope: 'company'
  role: 'general' | 'operations' | 'customer_service' | 'personal' | 'unknown'
  isPersonal: boolean
  confidence: number
  extractionMethods: string[]
  reviewFlags: string[]
}

export type ShadowWebsiteContactExtraction = {
  normalizedDomain: string
  checkedPages: Array<{ url: string; status: number | null; errorCode: 'fetch_failed' | 'non_html' | null }>
  contacts: ShadowWebsiteContact[]
}

const V2_BLOCKED_DOMAINS = new Set([
  'sluzby.cz',
  'hradeckralove.org',
  'ceska-trebova.cz',
  'ratajpolska.pl',
])

const V2_FOREIGN_COUNTRY_SUFFIXES = [
  '.sk', '.pl', '.de', '.at', '.hu', '.ro', '.bg', '.si', '.hr', '.rs', '.ua', '.ru',
]

export type OfficialWebsiteVerification = {
  status: 'verified' | 'needs_review' | 'rejected'
  normalizedDomain: string
  verifiedUrl: string | null
  confidence: number
  verificationMethods: string[]
  reasonCodes: string[]
  checkedPages: WebsiteVerificationPage[]
}

function normalizeHostname(value: string) {
  const ascii = domainToASCII(value.trim().toLowerCase().replace(/\.$/, ''))
  if (!ascii || ascii.length > 253) throw new Error('WEBSITE_HOST_INVALID')
  return ascii
}

function isUnsafeIpv4(address: string) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b, c] = parts
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

function isUnsafeIp(address: string) {
  if (isIP(address) === 4) return isUnsafeIpv4(address)
  if (isIP(address) !== 6) return true
  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) return isUnsafeIpv4(normalized.slice('::ffff:'.length))
  return normalized === '::'
    || normalized === '::1'
    || /^f[cd]/.test(normalized)
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:')
}

function assertSafeUrl(rawUrl: string) {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('WEBSITE_PROTOCOL_BLOCKED')
  if (url.username || url.password) throw new Error('WEBSITE_CREDENTIALS_BLOCKED')
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('WEBSITE_PORT_BLOCKED')
  const hostname = normalizeHostname(url.hostname)
  if (isIP(hostname) !== 0) throw new Error('WEBSITE_IP_LITERAL_BLOCKED')
  if (hostname === 'localhost' || /\.(?:localhost|local|internal|home|lan)$/.test(hostname)) {
    throw new Error('WEBSITE_PRIVATE_HOST_BLOCKED')
  }
  url.hostname = hostname
  url.hash = ''
  return url
}

function remainingBudgetMs(deadlineAt?: number) {
  if (deadlineAt === undefined) return FETCH_TIMEOUT_MS
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) throw new Error(WEBSITE_VERIFICATION_BUDGET_EXCEEDED)
  return Math.min(FETCH_TIMEOUT_MS, remaining)
}

async function resolvePublicAddress(hostname: string, deadlineAt?: number) {
  const budgetRemainingMs = deadlineAt === undefined ? Number.POSITIVE_INFINITY : deadlineAt - Date.now()
  const timeoutMs = remainingBudgetMs(deadlineAt)
  const timeoutCode = budgetRemainingMs <= FETCH_TIMEOUT_MS
    ? WEBSITE_VERIFICATION_BUDGET_EXCEEDED
    : 'WEBSITE_DNS_TIMEOUT'
  let timeout: ReturnType<typeof setTimeout> | undefined
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(timeoutCode)), timeoutMs)
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
  if (addresses.length === 0 || addresses.some((item) => isUnsafeIp(item.address))) {
    throw new Error('WEBSITE_PRIVATE_ADDRESS_BLOCKED')
  }
  return addresses.find((item) => item.family === 4) ?? addresses[0]
}

async function requestSafeHtml(
  rawUrl: string,
  redirectCount = 0,
  deadlineAt?: number,
): Promise<SafeHtmlResponse> {
  const url = assertSafeUrl(rawUrl)
  const address = await resolvePublicAddress(url.hostname, deadlineAt)
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: address.address, family: address.family }])
      return
    }
    callback(null, address.address, address.family)
  }

  return await new Promise<SafeHtmlResponse>((resolve, reject) => {
    const request = transport(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9',
        'User-Agent': 'B-ENERGY-OfficialWebsiteVerifier/1.0 (+https://www.blaster-energy.cz)',
      },
      lookup: pinnedLookup,
    }, (response) => {
      const status = response.statusCode ?? 0
      const location = response.headers.location
      if (status >= 300 && status < 400 && location) {
        response.resume()
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error('WEBSITE_TOO_MANY_REDIRECTS'))
          return
        }
        const redirected = new URL(location, url)
        if (url.protocol === 'https:' && redirected.protocol === 'http:') {
          reject(new Error('WEBSITE_INSECURE_REDIRECT_BLOCKED'))
          return
        }
        requestSafeHtml(redirected.toString(), redirectCount + 1, deadlineAt).then(resolve, reject)
        return
      }

      const contentType = String(response.headers['content-type'] ?? '').toLowerCase()
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        response.resume()
        reject(new Error('WEBSITE_NON_HTML_RESPONSE'))
        return
      }
      const declaredLength = Number(response.headers['content-length'] ?? 0)
      if (declaredLength > MAX_RESPONSE_BYTES) {
        response.resume()
        reject(new Error('WEBSITE_RESPONSE_TOO_LARGE'))
        return
      }

      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('WEBSITE_RESPONSE_TOO_LARGE'))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => {
        resolve({
          url: url.toString(),
          status,
          html: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })

    request.setTimeout(remainingBudgetMs(deadlineAt), () => {
      request.destroy(new Error(
        deadlineAt !== undefined && Date.now() >= deadlineAt
          ? WEBSITE_VERIFICATION_BUDGET_EXCEEDED
          : 'WEBSITE_FETCH_TIMEOUT',
      ))
    })
    request.on('error', reject)
    request.end()
  })
}

function decodeBasicHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function htmlToEvidenceText(html: string) {
  const structuredData = [...html.matchAll(
    /<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi,
  )].map((match) => match[2]).join(' ')
  const visibleText = decodeBasicHtmlEntities(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return decodeBasicHtmlEntities(`${structuredData} ${visibleText}`)
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeEvidenceText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function companyNameTokens(companyName: string) {
  const ignored = new Set(['a', 'as', 'cz', 's', 'spol', 'r', 'o', 'v', 'vos'])
  return normalizeEvidenceText(companyName)
    .split(' ')
    .filter((token) => token.length >= 2 && !ignored.has(token))
}

function hasCompanyNameEvidence(text: string, companyName: string) {
  const normalizedText = normalizeEvidenceText(text)
  const tokens = companyNameTokens(companyName)
  if (tokens.length === 0) return false
  const matched = tokens.filter((token) => normalizedText.includes(token)).length
  return matched >= Math.max(1, Math.ceil(tokens.length * 0.8))
}

function hasIcoEvidence(text: string, ico: string) {
  const flexibleIco = ico.split('').join('[\\s.\\-/]*')
  const label = '(?:i[cč]o|i[cč]|identifika[cč]n[ií]\\s+[cč][ií]slo|company\\s+(?:id|number)|taxid)'
  return new RegExp(`${label}[^0-9]{0,40}${flexibleIco}(?![0-9])`, 'iu').test(text)
}

function hasCompanyTokenInDomain(hostname: string, companyName: string) {
  const domainText = normalizeEvidenceText(hostname.split('.').slice(0, -1).join(' ')).replace(/\s+/g, '')
  return companyNameTokens(companyName)
    .filter((token) => token.length >= 4)
    .some((token) => domainText.includes(token))
}

function hasDistinctiveCompanyTokenInDomain(hostname: string, companyName: string) {
  const ignored = new Set([
    'ceska', 'ceske', 'czech', 'republic', 'company', 'group', 'holding',
    'technicke', 'technicky', 'sluzby', 'service', 'servis', 'vyroba', 'vyrobni',
    'obchodni', 'spolecnost', 'druzstvo', 'organizace', 'firma',
  ])
  const domainText = normalizeEvidenceText(hostname.split('.').slice(0, -1).join(' ')).replace(/\s+/g, '')
  const tokens = companyNameTokens(companyName).filter((token) => token.length >= 4 && !ignored.has(token))
  if (tokens.some((token) => domainText.includes(token))) return true
  const initials = companyNameTokens(companyName)
    .filter((token) => token.length >= 3)
    .map((token) => token[0])
    .join('')
  return initials.length >= 3 && domainText.includes(initials)
}

function registrableDomainApproximation(hostname: string) {
  const labels = hostname.replace(/^www\./, '').split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const compoundSuffix = labels.slice(-2).join('.')
  if (new Set(['co.uk', 'com.pl', 'com.de', 'com.sk']).has(compoundSuffix) && labels.length >= 3) {
    return labels.slice(-3).join('.')
  }
  return labels.slice(-2).join('.')
}

function hasSameDomainEmail(html: string, hostname: string) {
  const rootDomain = registrableDomainApproximation(hostname)
  const decoded = decodeBasicHtmlEntities(html)
  const matches = decoded.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9.-]+\.[a-z]{2,})/gi) ?? []
  return matches.some((email) => {
    const emailDomain = email.slice(email.lastIndexOf('@') + 1).toLowerCase().replace(/\.$/, '')
    return emailDomain === rootDomain || emailDomain.endsWith(`.${rootDomain}`)
  })
}

function isForeignCountryDomain(hostname: string) {
  return V2_FOREIGN_COUNTRY_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
}

function contactLinks(html: string, baseUrl: string) {
  const base = new URL(baseUrl)
  const results: string[] = []
  const seen = new Set<string>()
  const expression = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi
  let match: RegExpExecArray | null
  while ((match = expression.exec(html)) !== null) {
    try {
      const url = new URL(decodeBasicHtmlEntities(match[2]), base)
      if (url.hostname !== base.hostname) continue
      if (!/(?:kontakt|contact|o-nas|about|spolecnost|impressum)/i.test(`${url.pathname}${url.search}`)) continue
      url.hash = ''
      const value = url.toString()
      if (!seen.has(value)) {
        seen.add(value)
        results.push(value)
      }
    } catch {
      continue
    }
  }
  return results
}

function publicErrorCode(error: unknown): WebsiteVerificationPage['errorCode'] {
  return error instanceof Error && error.message === 'WEBSITE_NON_HTML_RESPONSE'
    ? 'non_html'
    : 'fetch_failed'
}

export async function verifyOfficialWebsiteCandidate(input: {
  candidateUrl: string
  companyName: string
  ico: string
}): Promise<OfficialWebsiteVerification> {
  const initialUrl = assertSafeUrl(input.candidateUrl)
  const normalizedDomain = initialUrl.hostname.replace(/^www\./, '')
  const rootUrl = new URL('/', initialUrl).toString()
  const urls = initialUrl.toString() === rootUrl ? [rootUrl] : [initialUrl.toString(), rootUrl]
  const queued = new Set(urls)
  const checkedPages: WebsiteVerificationPage[] = []
  let anyNameMatch = false
  let anyIcoMatch = false
  let homepageNameMatch = false
  const domainNameMatch = hasCompanyTokenInDomain(normalizedDomain, input.companyName)

  for (let index = 0; index < urls.length && index < MAX_PAGES_PER_CANDIDATE; index += 1) {
    const url = urls[index]
    try {
      const response = await requestSafeHtml(url)
      const evidenceText = htmlToEvidenceText(response.html)
      const matchedIco = hasIcoEvidence(evidenceText, input.ico)
      const matchedName = hasCompanyNameEvidence(evidenceText, input.companyName)
      anyIcoMatch ||= matchedIco
      anyNameMatch ||= matchedName
      if (new URL(response.url).pathname.replace(/\/+$/, '') === '') homepageNameMatch ||= matchedName
      checkedPages.push({ url: response.url, status: response.status, matchedIco, matchedName, errorCode: null })

      if (matchedIco && domainNameMatch) {
        return {
          status: 'verified',
          normalizedDomain,
          verifiedUrl: rootUrl,
          confidence: matchedName ? 1 : 0.95,
          verificationMethods: matchedName
            ? ['exact_ico_on_website', 'company_name_on_website', 'company_token_in_domain']
            : ['exact_ico_on_website', 'company_token_in_domain'],
          reasonCodes: [],
          checkedPages,
        }
      }

      if (urls.length < MAX_PAGES_PER_CANDIDATE) {
        for (const contactUrl of contactLinks(response.html, response.url)) {
          if (!queued.has(contactUrl)) {
            queued.add(contactUrl)
            urls.push(contactUrl)
            break
          }
        }
      }
    } catch (error) {
      checkedPages.push({ url, status: null, matchedIco: false, matchedName: false, errorCode: publicErrorCode(error) })
    }
  }

  if (anyIcoMatch && homepageNameMatch) {
    return {
      status: 'verified',
      normalizedDomain,
      verifiedUrl: rootUrl,
      confidence: 0.98,
      verificationMethods: ['exact_ico_on_website', 'company_name_on_homepage'],
      reasonCodes: [],
      checkedPages,
    }
  }

  return {
    status: anyIcoMatch || anyNameMatch ? 'needs_review' : 'rejected',
    normalizedDomain,
    verifiedUrl: null,
    confidence: anyIcoMatch ? 0.7 : anyNameMatch ? 0.55 : 0,
    verificationMethods: [
      ...(anyIcoMatch ? ['exact_ico_on_website'] : []),
      ...(anyNameMatch ? ['company_name_on_website'] : []),
    ],
    reasonCodes: anyIcoMatch
      ? ['official_domain_context_missing']
      : anyNameMatch ? ['exact_ico_missing'] : ['company_identity_not_confirmed'],
    checkedPages,
  }
}

export async function verifyOfficialWebsiteCandidateV2(input: {
  candidateUrl: string
  companyName: string
  ico: string
  deadlineAt?: number
  maxPages?: number
}): Promise<OfficialWebsiteVerificationV2> {
  const initialUrl = assertSafeUrl(input.candidateUrl)
  const normalizedDomain = initialUrl.hostname.replace(/^www\./, '')
  const rootUrl = new URL('/', initialUrl).toString()

  if (V2_BLOCKED_DOMAINS.has(normalizedDomain)
    || [...V2_BLOCKED_DOMAINS].some((domain) => normalizedDomain.endsWith(`.${domain}`))) {
    return {
      status: 'rejected',
      normalizedDomain,
      verifiedUrl: null,
      confidence: 0,
      verificationMethods: [],
      reasonCodes: ['blocked_non_first_party_domain'],
      checkedPages: [],
    }
  }

  const urls = initialUrl.toString() === rootUrl ? [rootUrl] : [initialUrl.toString(), rootUrl]
  const queued = new Set(urls)
  const checkedPages: WebsiteVerificationPage[] = []
  let anyNameMatch = false
  let anyIcoMatch = false
  let homepageNameMatch = false
  let anyDomainEmailMatch = false
  const distinctiveDomainMatch = hasDistinctiveCompanyTokenInDomain(normalizedDomain, input.companyName)

  const maxPages = Math.max(1, Math.min(MAX_PAGES_PER_CANDIDATE, input.maxPages ?? MAX_PAGES_PER_CANDIDATE))
  for (let index = 0; index < urls.length && index < maxPages; index += 1) {
    const url = urls[index]
    try {
      remainingBudgetMs(input.deadlineAt)
      const response = await requestSafeHtml(url, 0, input.deadlineAt)
      const evidenceText = htmlToEvidenceText(response.html)
      const matchedIco = hasIcoEvidence(evidenceText, input.ico)
      const matchedName = hasCompanyNameEvidence(evidenceText, input.companyName)
      const matchedDomainEmail = hasSameDomainEmail(response.html, normalizedDomain)
      anyIcoMatch ||= matchedIco
      anyNameMatch ||= matchedName
      anyDomainEmailMatch ||= matchedDomainEmail
      if (new URL(response.url).pathname.replace(/\/+$/, '') === '') homepageNameMatch ||= matchedName
      checkedPages.push({
        url: response.url,
        status: response.status,
        matchedIco,
        matchedName,
        matchedDomainEmail,
        errorCode: null,
      })

      if (urls.length < maxPages) {
        for (const contactUrl of contactLinks(response.html, response.url)) {
          if (!queued.has(contactUrl)) {
            queued.add(contactUrl)
            urls.push(contactUrl)
            break
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === WEBSITE_VERIFICATION_BUDGET_EXCEEDED) throw error
      checkedPages.push({
        url,
        status: null,
        matchedIco: false,
        matchedName: false,
        matchedDomainEmail: false,
        errorCode: publicErrorCode(error),
      })
    }
  }

  const foreignCountryDomain = isForeignCountryDomain(normalizedDomain)
  if (!foreignCountryDomain && anyDomainEmailMatch && anyIcoMatch && anyNameMatch) {
    return {
      status: 'verified_company',
      normalizedDomain,
      verifiedUrl: rootUrl,
      confidence: 1,
      verificationMethods: ['exact_ico_on_website', 'company_name_on_website', 'same_domain_email'],
      reasonCodes: [],
      checkedPages,
    }
  }
  if (!foreignCountryDomain && anyDomainEmailMatch && anyIcoMatch && distinctiveDomainMatch) {
    return {
      status: 'verified_company',
      normalizedDomain,
      verifiedUrl: rootUrl,
      confidence: 0.98,
      verificationMethods: ['exact_ico_on_website', 'distinctive_company_token_in_domain', 'same_domain_email'],
      reasonCodes: [],
      checkedPages,
    }
  }
  if (!foreignCountryDomain && anyDomainEmailMatch && homepageNameMatch && distinctiveDomainMatch) {
    return {
      status: 'verified_company',
      normalizedDomain,
      verifiedUrl: rootUrl,
      confidence: 0.9,
      verificationMethods: ['company_name_on_homepage', 'distinctive_company_token_in_domain', 'same_domain_email'],
      reasonCodes: ['exact_ico_missing_but_first_party_evidence_complete'],
      checkedPages,
    }
  }

  const hasIdentityEvidence = anyIcoMatch || anyNameMatch || distinctiveDomainMatch
  return {
    status: hasIdentityEvidence ? 'needs_review' : 'rejected',
    normalizedDomain,
    verifiedUrl: null,
    confidence: foreignCountryDomain ? 0.4 : anyIcoMatch ? 0.7 : anyNameMatch ? 0.55 : 0,
    verificationMethods: [
      ...(anyIcoMatch ? ['exact_ico_on_website'] : []),
      ...(anyNameMatch ? ['company_name_on_website'] : []),
      ...(distinctiveDomainMatch ? ['distinctive_company_token_in_domain'] : []),
      ...(anyDomainEmailMatch ? ['same_domain_email'] : []),
    ],
    reasonCodes: foreignCountryDomain
      ? ['foreign_country_domain_requires_review']
      : !anyDomainEmailMatch
        ? ['same_domain_email_missing']
        : !anyIcoMatch
          ? ['exact_ico_missing']
          : ['first_party_identity_incomplete'],
    checkedPages,
  }
}

const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  'info', 'kontakt', 'contact', 'office', 'recepce', 'reception', 'sekretariat',
  'podatelna', 'obchod', 'sales', 'servis', 'service', 'provoz', 'dispecink',
  'zakaznici', 'support', 'podpora', 'firma', 'company',
])

function emailRole(localPart: string): ShadowWebsiteContact['role'] {
  if (/^(?:provoz|dispecink|servis|service|technika|operations)/.test(localPart)) return 'operations'
  if (/^(?:zakaznici|support|podpora|reklamace)/.test(localPart)) return 'customer_service'
  if (GENERIC_EMAIL_LOCAL_PARTS.has(localPart) || /^(?:info|kontakt|office|obchod|sales)[._-]/.test(localPart)) {
    return 'general'
  }
  return 'personal'
}

function normalizePublicEmail(value: string, hostname: string) {
  const email = value.trim().toLowerCase().replace(/^mailto:/, '').split(/[?\s]/, 1)[0]
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return null
  const domain = email.slice(email.lastIndexOf('@') + 1)
  const websiteDomain = registrableDomainApproximation(hostname)
  if (domain !== websiteDomain && !domain.endsWith(`.${websiteDomain}`)) return null
  if (/^(?:noreply|no-reply|donotreply|example|test)@/.test(email)) return null
  return email
}

function normalizeCzechPhone(value: string) {
  const extensionRemoved = value.replace(/(?:kl\.?|linka|ext\.?)\s*\d+.*$/i, '')
  let digits = extensionRemoved.replace(/\D/g, '')
  if (digits.startsWith('00420')) digits = digits.slice(2)
  if (digits.length === 9) digits = `420${digits}`
  if (!/^420[1-9][0-9]{8}$/.test(digits)) return null
  return `+${digits}`
}

function extractContactsFromHtml(html: string, sourceUrl: string, hostname: string) {
  const decoded = decodeBasicHtmlEntities(html)
  const contacts = new Map<string, ShadowWebsiteContact>()
  const emailCandidates = [
    ...decoded.matchAll(/mailto:([^"'<>\s?]+)/gi),
    ...decoded.matchAll(/([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})/gi),
  ]
  for (const match of emailCandidates) {
    const normalized = normalizePublicEmail(match[1], hostname)
    if (!normalized) continue
    const localPart = normalized.slice(0, normalized.indexOf('@'))
    const role = emailRole(localPart)
    contacts.set(`email:${normalized}`, {
      type: 'email',
      value: normalized,
      normalizedValue: normalized,
      sourceUrl,
      scope: 'company',
      role,
      isPersonal: role === 'personal',
      confidence: role === 'personal' ? 0.8 : 0.95,
      extractionMethods: ['public_html', 'same_domain_email'],
      reviewFlags: role === 'personal' ? ['possible_personal_contact'] : [],
    })
  }

  const phoneCandidates: Array<{ value: string; method: string; context: string }> = []
  for (const match of decoded.matchAll(/href\s*=\s*(["'])tel:([^"']+)\1/gi)) {
    phoneCandidates.push({ value: match[2], method: 'tel_link', context: match[0] })
  }
  for (const match of htmlToEvidenceText(decoded).matchAll(
    /(?:tel(?:efon)?|mobil|ústředna|ustredna|recepce|kontakt)\s*[:.]?\s*((?:\+|00)?420[\s./-]*)?([1-9](?:[\s./-]*\d){8})/giu,
  )) {
    phoneCandidates.push({ value: `${match[1] ?? ''}${match[2]}`, method: 'labelled_phone', context: match[0] })
  }
  for (const candidate of phoneCandidates) {
    const normalized = normalizeCzechPhone(candidate.value)
    if (!normalized) continue
    const general = /ústředna|ustredna|recepce|kontakt/i.test(candidate.context)
    contacts.set(`phone:${normalized}`, {
      type: 'phone',
      value: normalized,
      normalizedValue: normalized,
      sourceUrl,
      scope: 'company',
      role: general ? 'general' : 'unknown',
      isPersonal: false,
      confidence: candidate.method === 'tel_link' ? 0.9 : 0.8,
      extractionMethods: ['public_html', candidate.method],
      reviewFlags: general ? [] : ['phone_role_unconfirmed'],
    })
  }
  return [...contacts.values()]
}

export async function extractContactsFromVerifiedOfficialWebsite(input: {
  websiteUrl: string
  expectedDomain: string
  deadlineAt: number
  maxPages?: number
}): Promise<ShadowWebsiteContactExtraction> {
  const initialUrl = assertSafeUrl(input.websiteUrl)
  const normalizedDomain = initialUrl.hostname.replace(/^www\./, '')
  if (normalizedDomain !== input.expectedDomain.toLowerCase().replace(/^www\./, '')) {
    throw new Error('CONTACT_EXTRACTION_DOMAIN_MISMATCH')
  }
  const rootUrl = new URL('/', initialUrl).toString()
  const urls = initialUrl.toString() === rootUrl ? [rootUrl] : [initialUrl.toString(), rootUrl]
  const queued = new Set(urls)
  const checkedPages: ShadowWebsiteContactExtraction['checkedPages'] = []
  const contacts = new Map<string, ShadowWebsiteContact>()
  const maxPages = Math.max(1, Math.min(3, input.maxPages ?? 3))

  for (let index = 0; index < urls.length && index < maxPages; index += 1) {
    const url = urls[index]
    try {
      remainingBudgetMs(input.deadlineAt)
      const response = await requestSafeHtml(url, 0, input.deadlineAt)
      const responseDomain = registrableDomainApproximation(new URL(response.url).hostname)
      if (responseDomain !== registrableDomainApproximation(normalizedDomain)) {
        throw new Error('CONTACT_EXTRACTION_CROSS_DOMAIN_REDIRECT_BLOCKED')
      }
      checkedPages.push({ url: response.url, status: response.status, errorCode: null })
      if (response.status >= 200 && response.status < 300) {
        for (const contact of extractContactsFromHtml(response.html, response.url, normalizedDomain)) {
          const key = `${contact.type}:${contact.normalizedValue}`
          const previous = contacts.get(key)
          if (!previous || contact.confidence > previous.confidence) contacts.set(key, contact)
        }
        if (urls.length < maxPages) {
          for (const contactUrl of contactLinks(response.html, response.url)) {
            if (!queued.has(contactUrl)) {
              queued.add(contactUrl)
              urls.push(contactUrl)
              if (urls.length >= maxPages) break
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === WEBSITE_VERIFICATION_BUDGET_EXCEEDED) throw error
      checkedPages.push({ url, status: null, errorCode: publicErrorCode(error) })
    }
  }
  return { normalizedDomain, checkedPages, contacts: [...contacts.values()] }
}
