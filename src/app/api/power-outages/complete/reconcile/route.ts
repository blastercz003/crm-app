import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { reconcileCompletePowerOutageCompanies } from '@/lib/power-outages/complete-company-reconciliation'
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
  const value = Number(new URL(request.url).searchParams.get('limit') ?? '250')
  const limit = Number.isFinite(value) ? Math.min(1000, Math.max(1, Math.trunc(value))) : 250
  try {
    const result = await reconcileCompletePowerOutageCompanies(limit)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error, route: '/api/power-outages/complete/reconcile', section: 'power-outages',
      errorType: 'CompletePowerOutageCompanyReconciliationError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Vyhodnocení firem selhalo.' },
      { status: 500, headers: HEADERS },
    )
  }
}

export function GET(request: Request) { return run(request, false) }
export function POST(request: Request) { return run(request, true) }
