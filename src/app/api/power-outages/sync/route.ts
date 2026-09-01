import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { syncPowerOutages, type PowerOutageSyncSource } from '@/lib/power-outages/orchestrator'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { claimPowerOutageTask, finishPowerOutageTask, type PowerOutageTaskKey } from '@/lib/power-outages/task-lock'

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

  const sourceValue = new URL(request.url).searchParams.get('source') ?? 'all'
  if (!['all', 'cez', 'egd', 'pre'].includes(sourceValue)) {
    return NextResponse.json(
      { ok: false, error: 'Parametr source musí být all, cez, egd nebo pre.' },
      { status: 400, headers: HEADERS },
    )
  }

  try {
    const taskKey: PowerOutageTaskKey | null = sourceValue === 'cez'
      ? 'sync_cez'
      : sourceValue === 'egd'
        ? 'sync_egd'
        : sourceValue === 'pre'
          ? 'sync_pre'
        : null
    const lockToken = taskKey ? await claimPowerOutageTask(taskKey, 90 * 60) : null
    if (taskKey && !lockToken) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: `Synchronizace ${sourceValue.toUpperCase()} již probíhá.` },
        { headers: HEADERS },
      )
    }

    let result: Awaited<ReturnType<typeof syncPowerOutages>>
    try {
      result = await syncPowerOutages(sourceValue as PowerOutageSyncSource)
      if (taskKey && lockToken) {
        await finishPowerOutageTask({
          taskKey,
          lockToken,
          succeeded: result.ok,
          errorCode: result.ok ? null : 'POWER_OUTAGE_PARTIAL_SYNC',
          errorMessage: result.ok ? null : `Synchronizace skončila částečně: ${JSON.stringify(result.sourceResults)}`,
          metadata: { partial: result.partial, sourceResults: result.sourceResults },
        })
      }
    } catch (syncError) {
      if (taskKey && lockToken) {
        await finishPowerOutageTask({
          taskKey,
          lockToken,
          succeeded: false,
          errorCode: 'POWER_OUTAGE_SYNC_FAILED',
          errorMessage: syncError instanceof Error ? syncError.message : 'Synchronizace odstávek selhala.',
        }).catch(() => undefined)
      }
      throw syncError
    }
    if (!result.ok) {
      await reportRouteError({
        error: new Error(`Synchronizace odstávek skončila částečně: ${JSON.stringify(result.sourceResults)}`),
        route: '/api/power-outages/sync',
        section: 'power-outages',
        errorType: 'PowerOutagePartialSyncError',
        context: { matchingError: result.matchingError },
      })
    }
    return NextResponse.json(result, {
      status: result.ok ? 200 : result.partial ? 207 : 502,
      headers: HEADERS,
    })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/sync',
      section: 'power-outages',
      errorType: 'PowerOutageSyncRouteError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Synchronizace odstávek selhala.' },
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
