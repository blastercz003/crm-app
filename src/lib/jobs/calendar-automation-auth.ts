import 'server-only'

import { timingSafeEqual } from 'node:crypto'

function matchesToken(provided: string, expected: string | undefined) {
  if (!expected || !provided || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export function isJobCalendarAutomationAuthorized(request: Request) {
  const authorization = request.headers.get('authorization') ?? ''
  const provided = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''

  return (
    matchesToken(provided, process.env.NOTIFICATIONS_AUTOMATION_TOKEN) ||
    matchesToken(provided, process.env.WEATHER_ALERTS_AUTOMATION_TOKEN)
  )
}
