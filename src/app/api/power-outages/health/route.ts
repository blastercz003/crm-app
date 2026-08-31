import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { getPowerOutageHealth } from '@/lib/power-outages/health'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

export async function GET(request: Request) {
  if (!(await isPowerOutageRequestAuthorized(request))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }

  try {
    return NextResponse.json(
      { ok: true, ...(await getPowerOutageHealth()) },
      { headers: HEADERS },
    )
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/health',
      section: 'power-outages',
      errorType: 'PowerOutageHealthRouteError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Kontrola odstávek selhala.' },
      { status: 500, headers: HEADERS },
    )
  }
}
