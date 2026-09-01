import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isJobCalendarAutomationAuthorized } from '@/lib/jobs/calendar-automation-auth'
import { reconcileActiveDispatcherCalendars } from '@/lib/jobs/calendar-reconciliation'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handleRequest(request: Request) {
  if (!isJobCalendarAutomationAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const forceGoogle = new URL(request.url).searchParams.get('mode') === 'full'

  try {
    const result = await reconcileActiveDispatcherCalendars({ forceGoogle })
    if (!result.ok) {
      await reportRouteError({
        error: new Error(
          `Některé zakázkové kalendáře se nepodařilo opravit: ${JSON.stringify(
            result.results.filter((item) => !item.ok)
          )}`
        ),
        route: '/api/dispatcher-job-calendars/reconcile',
        section: 'job-calendars',
        errorType: 'DispatcherJobCalendarPartialReconciliationError',
      })
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 207 })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/dispatcher-job-calendars/reconcile',
      section: 'job-calendars',
      errorType: 'DispatcherJobCalendarReconciliationError',
    })

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Oprava kalendářů zakázek se nepodařila.',
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  return handleRequest(request)
}

export async function POST(request: Request) {
  return handleRequest(request)
}
