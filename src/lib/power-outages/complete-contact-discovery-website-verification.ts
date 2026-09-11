import 'server-only'

import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'

const FETCH_TIMEOUT_MS = 7_000
const MAX_RESPONSE_BYTES = 1_000_000
const MAX_REDIRECTS = 3
const MAX_PAGES_PER_CANDIDATE = 3

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
  errorCode: 'fetch_failed' | 'non_html' | null
}

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

async function resolvePublicAddress(hostname: string) {
  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some((item) => isUnsafeIp(item.address))) {
    throw new Error('WEBSITE_PRIVATE_ADDRESS_BLOCKED')
  }
  return addresses.find((item) => item.family === 4) ?? addresses[0]
}

async function requestSafeHtml(rawUrl: string, redirectCount = 0): Promise<SafeHtmlResponse> {
  const url = assertSafeUrl(rawUrl)
  const address = await resolvePublicAddress(url.hostname)
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest

  return await new Promise<SafeHtmlResponse>((resolve, reject) => {
    const request = transport(url, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9',
        'User-Agent': 'B-ENERGY-OfficialWebsiteVerifier/1.0 (+https://www.blaster-energy.cz)',
      },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
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
        requestSafeHtml(redirected.toString(), redirectCount + 1).then(resolve, reject)
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

    request.setTimeout(FETCH_TIMEOUT_MS, () => request.destroy(new Error('WEBSITE_FETCH_TIMEOUT')))
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
