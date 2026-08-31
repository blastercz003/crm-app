import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { processPowerOutageStoreRegistryQueue } from '@/lib/power-outages/store-registry'
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
    await finishPowerOutageTask({ taskKey: 'store_queue', lockToken, succeeded: true, metadata: result })
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
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
