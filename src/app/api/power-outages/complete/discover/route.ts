import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { discoverCompletePowerOutageCompanies } from '@/lib/power-outages/complete-company-discovery'
import type { CompleteDiscoveryProvider } from '@/lib/power-outages/complete-company-providers'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

async function run(request: Request, allowAdminSession: boolean) {
  const authorized = allowAdminSession
    ? await isPowerOutageRequestAuthorized(request, { adminOnly: true })
    : isPowerOutageAutomationAuthorized(request)
  if (!authorized) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  const url = new URL(request.url)
  const provider = url.searchParams.get('provider')?.toLowerCase()
  if (!provider || !['ares', 'mapy', 'google'].includes(provider)) {
    return NextResponse.json({ ok: false, error: 'Poskytovatel musí být ares, mapy nebo google.' }, { status: 400, headers: HEADERS })
  }
  const value = Number(url.searchParams.get('limit') ?? '5')
  const limit = Number.isFinite(value) ? Math.min(10, Math.max(1, Math.trunc(value))) : 5
  try {
    const result = await discoverCompletePowerOutageCompanies(provider as CompleteDiscoveryProvider, limit)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error, route: '/api/power-outages/complete/discover', section: 'power-outages',
      errorType: 'CompletePowerOutageCompanyDiscoveryError', context: { provider },
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Dohledávání firem selhalo.' },
      { status: 500, headers: HEADERS },
    )
  }
}

export function GET(request: Request) { return run(request, false) }
export function POST(request: Request) { return run(request, true) }
