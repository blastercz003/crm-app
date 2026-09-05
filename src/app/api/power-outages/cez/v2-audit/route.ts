import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { runMarketCezV2Audit } from '@/lib/power-outages/market-cez-v2-audit'
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
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }

  const url = new URL(request.url)
  const requestedSample = Number(url.searchParams.get('sample') ?? 120)
  const requestedLimit = Number(url.searchParams.get('limit') ?? 3)
  const sample = Number.isFinite(requestedSample)
    ? Math.min(500, Math.max(20, Math.trunc(requestedSample)))
    : 120
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(5, Math.max(1, Math.trunc(requestedLimit)))
    : 3

  try {
    const result = await runMarketCezV2Audit(sample, limit)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/cez/v2-audit',
      section: 'power-outages',
      errorType: 'MarketCezV2AuditError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Audit ČEZ v2 selhal.' },
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
