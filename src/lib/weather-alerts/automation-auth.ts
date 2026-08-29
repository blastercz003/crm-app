import 'server-only'

import { timingSafeEqual } from 'node:crypto'

export function isWeatherAutomationAuthorized(request: Request) {
  const token = process.env.WEATHER_ALERTS_AUTOMATION_TOKEN
  if (!token) return false

  const authorization = request.headers.get('authorization') ?? ''
  const providedToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''

  if (!providedToken || providedToken.length !== token.length) return false
  return timingSafeEqual(Buffer.from(providedToken), Buffer.from(token))
}
