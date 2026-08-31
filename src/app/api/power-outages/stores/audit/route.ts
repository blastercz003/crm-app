import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import {
  auditPowerOutageStoreRegistry,
  StoreRegistryRunAlreadyRunningError,
} from '@/lib/power-outages/store-registry'
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

  let lockToken: string | null = null
  try {
    lockToken = await claimPowerOutageTask('store_audit', 60 * 60)
    if (!lockToken) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'Úplný audit Prodejen již probíhá.' }, { headers: HEADERS })
    }
    const result = await auditPowerOutageStoreRegistry(allowAdminSession ? 'manual' : 'scheduled')
    await finishPowerOutageTask({ taskKey: 'store_audit', lockToken, succeeded: true, metadata: result })
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    if (error instanceof StoreRegistryRunAlreadyRunningError) {
      if (lockToken) {
        await finishPowerOutageTask({
          taskKey: 'store_audit',
          lockToken,
          succeeded: true,
          metadata: { skipped: true, reason: error.message },
        }).catch(() => undefined)
      }
      return NextResponse.json({ ok: true, skipped: true, reason: error.message }, { headers: HEADERS })
    }
    if (lockToken) {
      await finishPowerOutageTask({
        taskKey: 'store_audit', lockToken, succeeded: false,
        errorCode: 'POWER_OUTAGE_STORE_AUDIT_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Audit Prodejen selhal.',
      }).catch(() => undefined)
    }
    await reportRouteError({
      error,
      route: '/api/power-outages/stores/audit',
      section: 'power-outages',
      errorType: 'PowerOutageStoreRegistryAuditError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Audit Prodejen selhal.' },
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
