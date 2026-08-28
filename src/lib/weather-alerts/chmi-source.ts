import type { ChmiDirectoryCandidate } from './types'

export const CHMI_CAP_DIRECTORY_URL =
  'https://opendata.chmi.cz/meteorology/weather/alerts/cap/'

export const CHMI_CAP_MAX_XML_BYTES = 12 * 1024 * 1024

const MONTH_INDEX: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

function parseApacheTimestamp(value: string) {
  const match = value.match(
    /^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})$/,
  )
  if (!match) return null

  const [, day, monthName, year, hour, minute] = match
  const month = MONTH_INDEX[monthName]
  if (month == null) return null

  const timestamp = new Date(
    Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute)),
  )
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString()
}

function decodeHtmlValue(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

export function parseChmiCapDirectory(html: string) {
  const candidates: ChmiDirectoryCandidate[] = []
  const rowPattern =
    /href=["']([^"']*alert_cap_50_[0-9]{6}\.xml)["'][^\r\n]*?([0-9]{2}-[A-Za-z]{3}-[0-9]{4}\s+[0-9]{2}:[0-9]{2})(?:\s+([0-9]+))?/gi

  for (const match of html.matchAll(rowPattern)) {
    const rawHref = decodeHtmlValue(match[1])
    const fileName = rawHref.split('/').at(-1) ?? ''
    if (!/^alert_cap_50_[0-9]{6}\.xml$/i.test(fileName)) continue

    const lastModifiedAt = parseApacheTimestamp(match[2])
    if (!lastModifiedAt) continue

    const url = new URL(rawHref, CHMI_CAP_DIRECTORY_URL)
    if (url.origin !== new URL(CHMI_CAP_DIRECTORY_URL).origin) continue

    candidates.push({
      fileName,
      url: url.toString(),
      lastModifiedAt,
      sizeBytes: match[3] ? Number(match[3]) : null,
    })
  }

  return candidates.sort((left, right) => {
    const byTimestamp =
      new Date(right.lastModifiedAt).getTime() -
      new Date(left.lastModifiedAt).getTime()
    return byTimestamp || right.fileName.localeCompare(left.fileName)
  })
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: '*/*',
        'User-Agent': 'MeetingCRM-WeatherAlerts/1.0',
        ...init.headers,
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function discoverLatestChmiCapFile() {
  const response = await fetchWithTimeout(CHMI_CAP_DIRECTORY_URL, {
    headers: { Accept: 'text/html' },
  })
  if (!response.ok) {
    throw new Error(`Adresář ČHMÚ odpověděl stavem HTTP ${response.status}.`)
  }

  const html = await response.text()
  const candidates = parseChmiCapDirectory(html)
  const latest = candidates[0]
  if (!latest) {
    throw new Error('V adresáři ČHMÚ nebyl nalezen žádný bulletin XOCZ50.')
  }

  return {
    latest,
    discoveredFileCount: candidates.length,
    httpStatus: response.status,
  }
}

export async function downloadChmiCapFile(input: {
  candidate: ChmiDirectoryCandidate
  previousEtag?: string | null
  previousLastModifiedAt?: string | null
}) {
  if (
    input.candidate.sizeBytes != null &&
    input.candidate.sizeBytes > CHMI_CAP_MAX_XML_BYTES
  ) {
    throw new Error('ČHMÚ CAP soubor překračuje povolenou velikost 12 MB.')
  }

  const headers: Record<string, string> = { Accept: 'application/xml, text/xml' }
  if (input.previousEtag) headers['If-None-Match'] = input.previousEtag
  if (input.previousLastModifiedAt) {
    headers['If-Modified-Since'] = new Date(
      input.previousLastModifiedAt,
    ).toUTCString()
  }

  const response = await fetchWithTimeout(input.candidate.url, { headers })
  if (response.status === 304) {
    return {
      unchanged: true as const,
      httpStatus: response.status,
      etag: input.previousEtag ?? null,
      lastModifiedAt: input.previousLastModifiedAt ?? null,
      xml: null,
    }
  }
  if (!response.ok) {
    throw new Error(`ČHMÚ CAP soubor odpověděl stavem HTTP ${response.status}.`)
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > CHMI_CAP_MAX_XML_BYTES) {
    throw new Error('ČHMÚ CAP soubor překračuje povolenou velikost 12 MB.')
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > CHMI_CAP_MAX_XML_BYTES) {
    throw new Error('ČHMÚ CAP soubor překračuje povolenou velikost 12 MB.')
  }

  const lastModifiedHeader = response.headers.get('last-modified')
  const parsedLastModified = lastModifiedHeader
    ? new Date(lastModifiedHeader)
    : new Date(input.candidate.lastModifiedAt)

  return {
    unchanged: false as const,
    httpStatus: response.status,
    etag: response.headers.get('etag'),
    lastModifiedAt: Number.isNaN(parsedLastModified.getTime())
      ? input.candidate.lastModifiedAt
      : parsedLastModified.toISOString(),
    xml: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
  }
}
