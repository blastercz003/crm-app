import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { runCompleteCezTownPilot } from '@/lib/power-outages/complete-cez-town-pilot'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Ověřovací pilot úplnosti městského seznamu ČEZ selhal.'
}

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

  const url = new URL(request.url)
  const rawSample = Number(url.searchParams.get('sample') ?? '120')
  const rawLimit = Number(url.searchParams.get('limit') ?? '3')
  const sample = Number.isFinite(rawSample)
    ? Math.min(200, Math.max(20, Math.trunc(rawSample)))
    : 120
  const limit = Number.isFinite(rawLimit)
    ? Math.min(4, Math.max(1, Math.trunc(rawLimit)))
    : 3

  try {
    const result = await runCompleteCezTownPilot(sample, limit)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/cez/pilot',
      section: 'power-outages',
      errorType: 'CompleteCezTownPilotError',
    })
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
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
