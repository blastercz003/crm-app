import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import {
  reconcilePowerOutageStoreMatches,
  StoreMatchSyncAlreadyRunningError,
} from '@/lib/power-outages/store-match-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

export async function POST(request: Request) {
  if (!await isPowerOutageRequestAuthorized(request, { adminOnly: true })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }

  try {
    const payload = await request.json().catch(() => null) as { target?: unknown } | null
    if (payload?.target !== 'matching') {
      return NextResponse.json({ ok: false, error: 'Neznámý typ opravy.' }, { status: 400, headers: HEADERS })
    }
    try {
      const result = await reconcilePowerOutageStoreMatches({ triggerKind: 'retry' })
      return NextResponse.json({ ok: true, result }, { headers: HEADERS })
    } catch (error) {
      if (error instanceof StoreMatchSyncAlreadyRunningError) {
        return NextResponse.json({ ok: true, skipped: true, reason: error.message }, { headers: HEADERS })
      }
      throw error
    }
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/recover',
      section: 'power-outages',
      errorType: 'PowerOutageRecoveryError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Oprava párování odstávek selhala.' },
      { status: 500, headers: HEADERS },
    )
  }
}
