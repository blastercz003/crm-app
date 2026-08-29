import { createHash } from 'node:crypto'
import type {
  ChmiDownloadedResource,
  ChmiResourceKind,
  WeatherInsightFeedKey,
} from './types'

const CHMI_ORIGIN = 'https://opendata.chmi.cz'
const MAX_REDIRECTS = 3

const FEED_PATH_PREFIXES: Record<WeatherInsightFeedKey, readonly string[]> = {
  radar: ['/meteorology/weather/radar/'],
  observations: ['/meteorology/climate/'],
  forecast: ['/meteorology/weather/forecast/'],
}

const DEFAULT_MAX_BYTES: Record<ChmiResourceKind, number> = {
  html: 2 * 1024 * 1024,
  json: 8 * 1024 * 1024,
  xml: 8 * 1024 * 1024,
  png: 8 * 1024 * 1024,
  archive: 32 * 1024 * 1024,
}

export class ChmiResourceError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ChmiResourceError'
    this.code = code
  }
}

export function assertAllowedChmiUrl(
  input: string | URL,
  feedKey: WeatherInsightFeedKey,
) {
  const url = input instanceof URL ? new URL(input) : new URL(input)
  if (
    url.origin !== CHMI_ORIGIN ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new ChmiResourceError(
      'CHMI_URL_NOT_ALLOWED',
      'Zdrojová adresa není povolenou HTTPS adresou ČHMÚ.',
    )
  }

  if (!FEED_PATH_PREFIXES[feedKey].some((prefix) => url.pathname.startsWith(prefix))) {
    throw new ChmiResourceError(
      'CHMI_PATH_NOT_ALLOWED',
      `Zdrojová cesta není povolena pro kanál ${feedKey}.`,
    )
  }

  return url
}

function hasExpectedMagic(bytes: Uint8Array, kind: ChmiResourceKind) {
  if (kind === 'png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    )
  }

  const prefix = new TextDecoder().decode(bytes.slice(0, 256)).trimStart()
  if (kind === 'json') return prefix.startsWith('{') || prefix.startsWith('[')
  if (kind === 'xml') return prefix.startsWith('<?xml') || prefix.startsWith('<')
  if (kind === 'html') {
    const normalized = prefix.toLowerCase()
    return normalized.startsWith('<!doctype html') || normalized.startsWith('<html')
  }
  if (kind === 'archive') {
    const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b
    const isZip =
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    const tarMarker = new TextDecoder().decode(bytes.slice(257, 262))
    return isGzip || isZip || tarMarker === 'ustar'
  }
  return false
}

async function readLimitedBody(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ChmiResourceError(
      'CHMI_RESOURCE_TOO_LARGE',
      `Zdroj ČHMÚ překračuje limit ${maxBytes} B.`,
    )
  }

  if (!response.body) {
    throw new ChmiResourceError('CHMI_EMPTY_RESPONSE', 'Zdroj ČHMÚ nemá tělo odpovědi.')
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new ChmiResourceError(
          'CHMI_RESOURCE_TOO_LARGE',
          `Zdroj ČHMÚ překračuje limit ${maxBytes} B.`,
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export async function fetchChmiResource(params: {
  feedKey: WeatherInsightFeedKey
  url: string | URL
  kind: ChmiResourceKind
  maxBytes?: number
  timeoutMs?: number
  headers?: HeadersInit
}): Promise<ChmiDownloadedResource> {
  const maxBytes = params.maxBytes ?? DEFAULT_MAX_BYTES[params.kind]
  const timeoutMs = params.timeoutMs ?? 20_000
  let currentUrl = assertAllowedChmiUrl(params.url, params.feedKey)

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'User-Agent': 'B-Energy-Weather-Insights/1.0',
        ...params.headers,
      },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new ChmiResourceError(
          'CHMI_REDIRECT_REJECTED',
          'Zdroj ČHMÚ vrátil neplatné nebo příliš dlouhé přesměrování.',
        )
      }
      currentUrl = assertAllowedChmiUrl(new URL(location, currentUrl), params.feedKey)
      continue
    }

    if (!response.ok) {
      throw new ChmiResourceError(
        'CHMI_HTTP_ERROR',
        `Zdroj ČHMÚ odpověděl stavem HTTP ${response.status}.`,
      )
    }

    const bytes = await readLimitedBody(response, maxBytes)
    if (!hasExpectedMagic(bytes, params.kind)) {
      throw new ChmiResourceError(
        'CHMI_CONTENT_INVALID',
        `Obsah zdroje ČHMÚ neodpovídá očekávanému formátu ${params.kind}.`,
      )
    }

    return {
      url: currentUrl.toString(),
      bytes,
      contentType: response.headers.get('content-type'),
      etag: response.headers.get('etag'),
      lastModifiedAt: response.headers.get('last-modified'),
      payloadSha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }

  throw new ChmiResourceError(
    'CHMI_REDIRECT_REJECTED',
    'Zdroj ČHMÚ překročil povolený počet přesměrování.',
  )
}
