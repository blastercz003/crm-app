import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { enrichCompletePowerOutageCompanyProfiles } from '@/lib/power-outages/complete-company-enrichment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

export async function GET(request: Request) {
  if (!isPowerOutageAutomationAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }
  const rawLimit = Number(new URL(request.url).searchParams.get('limit') ?? '10')
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 10
  try {
    const result = await enrichCompletePowerOutageCompanyProfiles(limit)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/companies/enrich',
      section: 'power-outages',
      errorType: 'CompletePowerOutageCompanyEnrichmentError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'ARES RES enrichment selhal.' },
      { status: 500, headers: HEADERS },
    )
  }
}
