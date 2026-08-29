import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { getWeatherInsightsWorkspace } from '@/lib/weather-insights/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
} as const

export async function GET() {
  try {
    const workspace = await getWeatherInsightsWorkspace()
    return NextResponse.json(
      { ok: true, workspace },
      { headers: RESPONSE_HEADERS },
    )
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Doplňková data ČHMÚ se nepodařilo načíst.'
    const status = message.includes('přihlásit')
      ? 401
      : message.includes('oprávnění')
        ? 403
        : 500

    if (status === 500) {
      await reportRouteError({
        error,
        route: '/api/weather-insights',
        section: 'weather-alerts',
        errorType: 'WeatherInsightsReadRouteError',
      })
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status, headers: RESPONSE_HEADERS },
    )
  }
}
