import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { normalizeCompleteCezStagedAddresses } from '@/lib/power-outages/complete-cez-staging-normalization'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Normalizace stagingových adres ČEZ selhala.'
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
  const rawLimit = Number(url.searchParams.get('limit') ?? '100')
  const limit = Number.isFinite(rawLimit)
    ? Math.min(500, Math.max(1, Math.trunc(rawLimit)))
    : 100

  try {
    const result = await normalizeCompleteCezStagedAddresses(limit)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/cez/staging/normalize',
      section: 'power-outages',
      errorType: 'CompleteCezStagingNormalizationError',
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
