import 'server-only'

import { timingSafeEqual } from 'node:crypto'

function safeTokenEquals(provided: string, expected: string) {
  return provided.length === expected.length
    && timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export function isPowerOutageAutomationAuthorized(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const provided = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''
  if (!provided) return false

  const acceptedTokens = [
    process.env.POWER_OUTAGES_AUTOMATION_TOKEN,
    process.env.WEATHER_ALERTS_AUTOMATION_TOKEN,
    process.env.NOTIFICATIONS_AUTOMATION_TOKEN,
  ].filter((token): token is string => Boolean(token))

  return acceptedTokens.some((token) => safeTokenEquals(provided, token))
}
