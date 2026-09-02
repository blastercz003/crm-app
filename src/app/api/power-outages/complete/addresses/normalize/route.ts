import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { normalizeCompletePowerOutageAddresses } from '@/lib/power-outages/complete-address-normalization'
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
  const value = Number(new URL(request.url).searchParams.get('limit') ?? '1500')
  const limit = Number.isFinite(value) ? Math.min(2000, Math.max(1, Math.trunc(value))) : 1500
  try {
    const result = await normalizeCompletePowerOutageAddresses(limit)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/addresses/normalize',
      section: 'power-outages',
      errorType: 'CompletePowerOutageAddressNormalizationError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Normalizace adres selhala.' },
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
