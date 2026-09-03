import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { importCompleteCezRuian } from '@/lib/power-outages/complete-cez-ruian'
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
  return 'Import RÚIAN pro ČEZ selhal.'
}

async function run(request: Request, allowAdminSession: boolean) {
  const authorized = allowAdminSession
    ? await isPowerOutageRequestAuthorized(request, { adminOnly: true })
    : isPowerOutageAutomationAuthorized(request)
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }

  const url = new URL(request.url)
  const phase = url.searchParams.get('phase') ?? 'all'
  if (!['catalog', 'representatives', 'all'].includes(phase)) {
    return NextResponse.json(
      { ok: false, error: 'Parametr phase musí být catalog, representatives nebo all.' },
      { status: 400, headers: HEADERS },
    )
  }
  const rawLimit = Number(url.searchParams.get('limit') ?? '100')
  const limit = Number.isFinite(rawLimit)
    ? Math.min(250, Math.max(1, Math.trunc(rawLimit)))
    : 100

  try {
    const result = await importCompleteCezRuian({
      phase: phase as 'catalog' | 'representatives' | 'all',
      limit,
    })
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/cez/ruian',
      section: 'power-outages',
      errorType: 'CompleteCezRuianImportError',
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
