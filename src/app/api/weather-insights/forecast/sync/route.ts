import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isWeatherAutomationAuthorized } from '@/lib/weather-alerts/automation-auth'
import { WeatherFeedAlreadyRunningError } from '@/lib/weather-insights/feed-sync'
import { syncChmiForecastOutlook } from '@/lib/weather-insights/forecast-sync'
import { dispatchForecastInsightNotifications } from '@/lib/weather-insights/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

export async function GET(request: Request) {
  if (!isWeatherAutomationAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: RESPONSE_HEADERS },
    )
  }

  try {
    const result = await syncChmiForecastOutlook()
    let notifications = null
    try {
      notifications = await dispatchForecastInsightNotifications({
        issuedAt: result.issuedAt,
      })
    } catch (notificationError) {
      await reportRouteError({
        error: notificationError,
        route: '/api/weather-insights/forecast/sync',
        section: 'weather-alerts',
        errorType: 'WeatherForecastNotificationDispatchError',
      })
      notifications = { error: true }
    }
    return NextResponse.json(
      { ok: true, skipped: false, ...result, notifications },
      { headers: RESPONSE_HEADERS },
    )
  } catch (error) {
    if (error instanceof WeatherFeedAlreadyRunningError) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: 'already_running' },
        { status: 202, headers: RESPONSE_HEADERS },
      )
    }

    await reportRouteError({
      error,
      route: '/api/weather-insights/forecast/sync',
      section: 'weather-alerts',
      errorType: 'WeatherForecastSyncRouteError',
    })
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Nepodařilo se načíst výhled ČHMÚ.',
      },
      { status: 500, headers: RESPONSE_HEADERS },
    )
  }
}
