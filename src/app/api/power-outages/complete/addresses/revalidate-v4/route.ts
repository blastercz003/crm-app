import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { processCompleteAddressRevalidationV4 } from '@/lib/power-outages/complete-address-revalidation-v4'
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
  const rawLimit = Number(new URL(request.url).searchParams.get('limit') ?? '1')
  const limit = Number.isFinite(rawLimit) ? Math.min(3, Math.max(1, Math.trunc(rawLimit))) : 1
  try {
    const result = await processCompleteAddressRevalidationV4(limit)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/addresses/revalidate-v4',
      section: 'power-outages',
      errorType: 'CompleteAddressRevalidationV4Error',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Externi adresni revalidace selhala.' },
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
