import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { syncWeatherAlerts } from '@/lib/weather-alerts/orchestrator'
import { WeatherSyncAlreadyRunningError } from '@/lib/weather-alerts/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
} as const

function isAuthorized(request: Request) {
  const token = process.env.WEATHER_ALERTS_AUTOMATION_TOKEN
  if (!token) return false

  const authorization = request.headers.get('authorization') ?? ''
  const providedToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : ''

  if (!providedToken || providedToken.length !== token.length) return false
  return timingSafeEqual(Buffer.from(providedToken), Buffer.from(token))
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: RESPONSE_HEADERS },
    )
  }

  try {
    const result = await syncWeatherAlerts()
    return NextResponse.json(
      { ok: true, skipped: false, ...result },
      { headers: RESPONSE_HEADERS },
    )
  } catch (error) {
    if (error instanceof WeatherSyncAlreadyRunningError) {
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          reason: 'already_running',
          message: 'Předchozí synchronizace ČHMÚ stále probíhá.',
        },
        { status: 202, headers: RESPONSE_HEADERS },
      )
    }

    await reportRouteError({
      error,
      route: '/api/weather-alerts/sync',
      section: 'weather-alerts',
      errorType: 'WeatherAlertsSyncRouteError',
    })

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Nepodařilo se načíst výstrahy ČHMÚ.',
      },
      { status: 500, headers: RESPONSE_HEADERS },
    )
  }
}
