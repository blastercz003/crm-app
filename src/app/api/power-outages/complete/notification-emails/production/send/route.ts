import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { sendOneCompleteNotificationProduction } from '@/lib/power-outages/complete-notification-email-production-worker'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

async function run(request: Request, adminSession: boolean) {
  const authorized = adminSession
    ? await isPowerOutageRequestAuthorized(request, { adminOnly: true, allowAutomation: false })
    : isPowerOutageAutomationAuthorized(request)
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }
  try {
    const origin = new URL(request.url).origin
    const result = await sendOneCompleteNotificationProduction(origin)
    return NextResponse.json(result, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/notification-emails/production/send',
      section: 'power-outages',
      errorType: 'CompleteNotificationEmailProductionDispatchError',
    })
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Produkční odesílání KOMPLETNÍ selhalo.',
    }, { status: 500, headers: HEADERS })
  }
}

export function GET(request: Request) { return run(request, false) }
export function POST(request: Request) { return run(request, true) }
