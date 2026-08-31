import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { processPowerOutageStoreRegistryQueue } from '@/lib/power-outages/store-registry'
import {
  reconcilePowerOutageStoreMatches,
  StoreMatchSyncAlreadyRunningError,
} from '@/lib/power-outages/store-match-sync'
import { claimPowerOutageTask, finishPowerOutageTask } from '@/lib/power-outages/task-lock'

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

  const requestedLimit = Number(new URL(request.url).searchParams.get('limit') ?? 40)
  let lockToken: string | null = null
  try {
    lockToken = await claimPowerOutageTask('store_queue', 10 * 60)
    if (!lockToken) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Zpracování změn Prodejen již probíhá.' }, { headers: HEADERS })
    }
    const result = await processPowerOutageStoreRegistryQueue(requestedLimit)
    let matching: Awaited<ReturnType<typeof reconcilePowerOutageStoreMatches>> | null = null
    let matchingSkipped = false
    if (result.processedCount > 0) {
      try {
        // Pouze přepočet nad daty v Supabase; nevytváří další požadavky na ČEZ ani EG.D.
        matching = await reconcilePowerOutageStoreMatches({ triggerKind: 'store_change' })
      } catch (matchingError) {
        if (matchingError instanceof StoreMatchSyncAlreadyRunningError) {
          matchingSkipped = true
        } else {
          throw matchingError
        }
      }
    }
    const metadata = { ...result, matching, matchingSkipped }
    await finishPowerOutageTask({ taskKey: 'store_queue', lockToken, succeeded: true, metadata })
    return NextResponse.json({ ok: true, ...metadata }, { headers: HEADERS })
  } catch (error) {
    if (lockToken) {
      await finishPowerOutageTask({
        taskKey: 'store_queue', lockToken, succeeded: false,
        errorCode: 'POWER_OUTAGE_STORE_QUEUE_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Ověření adres Prodejen selhalo.',
      }).catch(() => undefined)
    }
    await reportRouteError({
      error,
      route: '/api/power-outages/stores/process',
      section: 'power-outages',
      errorType: 'PowerOutageStoreRegistryProcessError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Ověření adres Prodejen selhalo.' },
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
