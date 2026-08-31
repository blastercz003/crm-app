import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { planPowerOutageNotifications } from '@/lib/power-outages/notification-planner'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { claimPowerOutageTask, finishPowerOutageTask } from '@/lib/power-outages/task-lock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

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
    lockToken = await claimPowerOutageTask('notification_plan', 10 * 60)
    if (!lockToken) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: 'Plánování upozornění na odstávky již probíhá.' },
        { headers: HEADERS },
      )
    }
    const notifications = await planPowerOutageNotifications()
    await finishPowerOutageTask({
      taskKey: 'notification_plan',
      lockToken,
      succeeded: true,
      metadata: notifications,
    })
    return NextResponse.json({ ok: true, notifications }, { headers: HEADERS })
  } catch (error) {
    if (lockToken) {
      await finishPowerOutageTask({
        taskKey: 'notification_plan',
        lockToken,
        succeeded: false,
        errorCode: 'POWER_OUTAGE_NOTIFICATION_PLAN_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Plán upozornění na odstávky selhal.',
      }).catch(() => undefined)
    }
    await reportRouteError({
      error,
      route: '/api/power-outages/notifications/plan',
      section: 'power-outages',
      errorType: 'PowerOutageNotificationPlanError',
    })
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error
          ? error.message
          : 'Plán upozornění na odstávky se nepodařilo připravit.',
      },
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
