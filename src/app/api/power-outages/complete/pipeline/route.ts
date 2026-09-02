import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { runCompletePowerOutageRuntimePipeline } from '@/lib/power-outages/complete-runtime-pipeline'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

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

  try {
    const result = await runCompletePowerOutageRuntimePipeline()
    if (!result.ok) {
      await reportRouteError({
        error: new Error(`Pipeline KOMPLETNÍ skončila částečně: ${JSON.stringify(result.steps)}`),
        route: '/api/power-outages/complete/pipeline',
        section: 'power-outages',
        errorType: 'CompletePowerOutageRuntimePipelinePartialError',
      })
    }
    return NextResponse.json(result, {
      status: result.ok ? 200 : result.partial ? 207 : 502,
      headers: HEADERS,
    })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/pipeline',
      section: 'power-outages',
      errorType: 'CompletePowerOutageRuntimePipelineError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Pipeline KOMPLETNÍ selhala.' },
      { status: 500, headers: HEADERS },
    )
  }
}

export function GET(request: Request) { return run(request, false) }
export function POST(request: Request) { return run(request, true) }
