import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { syncCompletePowerOutageCatalog } from '@/lib/power-outages/complete-catalog-sync'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import type { PowerOutageSource } from '@/lib/power-outages/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

async function run(request: Request, allowAdminSession: boolean) {
  const authorized = allowAdminSession
    ? await isPowerOutageRequestAuthorized(request, { adminOnly: true })
    : isPowerOutageAutomationAuthorized(request)
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }

  const source = new URL(request.url).searchParams.get('source') ?? 'all'
  if (!['all', 'cez', 'egd', 'pre'].includes(source)) {
    return NextResponse.json(
      { ok: false, error: 'Parametr source musí být all, cez, egd nebo pre.' },
      { status: 400, headers: HEADERS },
    )
  }

  try {
    const result = await syncCompletePowerOutageCatalog(source as PowerOutageSource | 'all')
    return NextResponse.json(result, {
      status: result.ok ? 200 : result.partial ? 207 : 502,
      headers: HEADERS,
    })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/sync',
      section: 'power-outages',
      errorType: 'CompletePowerOutageSyncRouteError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Aktualizace kompletního katalogu selhala.' },
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
