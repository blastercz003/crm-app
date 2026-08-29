import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isWeatherAutomationAuthorized } from '@/lib/weather-alerts/automation-auth'
import { notifyAdminsAfterWeatherSyncFailure } from '@/lib/weather-alerts/failure-notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
} as const

export async function GET(request: Request) {
  if (!isWeatherAutomationAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: RESPONSE_HEADERS },
    )
  }

  try {
    const result = await notifyAdminsAfterWeatherSyncFailure()
    return NextResponse.json(
      { ok: true, ...result },
      { headers: RESPONSE_HEADERS },
    )
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/weather-alerts/health',
      section: 'weather-alerts',
      errorType: 'WeatherAlertsHealthRouteError',
    })
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error
          ? error.message
          : 'Kontrola synchronizace ČHMÚ selhala.',
      },
      { status: 500, headers: RESPONSE_HEADERS },
    )
  }
}
