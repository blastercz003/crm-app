import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { refreshPowerOutagesIfNeeded } from '@/lib/power-outages/conditional-refresh'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

async function run(request: Request, allowAdminSession: boolean) {
  const authorized = allowAdminSession
    ? await isPowerOutageRequestAuthorized(request, { adminOnly: true })
    : isPowerOutageAutomationAuthorized(request)
  if (!authorized) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: HEADERS },
    )
  }

  try {
    const result = await refreshPowerOutagesIfNeeded()
    return NextResponse.json(result, {
      status: result.ok ? 200 : result.partial ? 207 : 502,
      headers: HEADERS,
    })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/refresh',
      section: 'power-outages',
      errorType: 'PowerOutageConditionalRefreshRouteError',
    })
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error
          ? error.message
          : 'Podmíněná aktualizace odstávek selhala.',
      },
      { status: 500, headers: HEADERS },
    )
  }
}

export function GET(request: Request) {
  return run(request, false)
}

export function POST(request: Request) {
  return run(request, true)
}
