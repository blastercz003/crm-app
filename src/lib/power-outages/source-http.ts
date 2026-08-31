import 'server-only'

const DEFAULT_TIMEOUT_MS = 25_000
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

export async function fetchPowerOutageSource(
  url: string,
  init: RequestInit = {},
  options: {
    timeoutMs?: number
    maxBytes?: number
    retryCount?: number
  } = {},
) {
  const attempts = Math.min(4, Math.max(1, (options.retryCount ?? 2) + 1))
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )

    try {
      const response = await fetch(url, {
        ...init,
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'MeetingCRM-PowerOutageProbe/1.0',
          ...init.headers,
        },
      })

      if ((response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
        await response.arrayBuffer().catch(() => undefined)
        const retryAfterSeconds = Number(response.headers.get('retry-after') ?? 0)
        const delayMs = retryAfterSeconds > 0
          ? Math.min(60_000, retryAfterSeconds * 1_000)
          : 2_000 * 2 ** attempt
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        continue
      }

      const contentLength = Number(response.headers.get('content-length') ?? 0)
      const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
      if (contentLength > maxBytes) {
        throw new Error(`Odpověď zdroje překračuje limit ${maxBytes} B.`)
      }

      const body = await response.arrayBuffer()
      if (body.byteLength > maxBytes) {
        throw new Error(`Odpověď zdroje překračuje limit ${maxBytes} B.`)
      }

      return {
        response,
        body,
        text: new TextDecoder('utf-8', { fatal: true }).decode(body),
      }
    } catch (error) {
      lastError = error
      if (attempt + 1 >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Načtení zdroje odstávek selhalo.')
}

export function parseSourceJson(value: string, sourceLabel: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(`${sourceLabel} nevrátil platný JSON.`)
  }
}
