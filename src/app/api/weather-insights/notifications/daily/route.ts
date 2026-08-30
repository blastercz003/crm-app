import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isWeatherAutomationAuthorized } from '@/lib/weather-alerts/automation-auth'
import { dispatchDailyWeatherSummary } from '@/lib/weather-insights/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RESPONSE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

export async function GET(request: Request) {
  if (!isWeatherAutomationAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: RESPONSE_HEADERS },
    )
  }

  try {
    const notifications = await dispatchDailyWeatherSummary()
    return NextResponse.json(
      { ok: true, notifications },
      { headers: RESPONSE_HEADERS },
    )
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/weather-insights/notifications/daily',
      section: 'weather-alerts',
      errorType: 'WeatherDailySummaryDispatchError',
    })
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error
          ? error.message
          : 'Denní meteorologický přehled se nepodařilo odeslat.',
      },
      { status: 500, headers: RESPONSE_HEADERS },
    )
  }
}
