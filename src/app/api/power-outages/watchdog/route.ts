import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { runPowerOutageWatchdog } from '@/lib/power-outages/maintenance'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { claimPowerOutageTask, finishPowerOutageTask } from '@/lib/power-outages/task-lock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

async function run(request: Request, allowAdminSession: boolean) {
  const authorized = allowAdminSession
    ? await isPowerOutageRequestAuthorized(request, { adminOnly: true })
    : isPowerOutageAutomationAuthorized(request)
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }

  let lockToken: string | null = null
  try {
    lockToken = await claimPowerOutageTask('watchdog', 10 * 60)
    if (!lockToken) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Watchdog již probíhá.' }, { headers: HEADERS })
    }
    const result = await runPowerOutageWatchdog()
    await finishPowerOutageTask({ taskKey: 'watchdog', lockToken, succeeded: true, metadata: result })
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    if (lockToken) {
      await finishPowerOutageTask({
        taskKey: 'watchdog', lockToken, succeeded: false,
        errorCode: 'POWER_OUTAGE_WATCHDOG_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Watchdog odstávek selhal.',
      }).catch(() => undefined)
    }
    await reportRouteError({ error, route: '/api/power-outages/watchdog', section: 'power-outages', errorType: 'PowerOutageWatchdogError' })
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Watchdog odstávek selhal.' }, { status: 500, headers: HEADERS })
  }
}

export function GET(request: Request) { return run(request, false) }
export function POST(request: Request) { return run(request, true) }
