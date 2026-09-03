import { NextResponse } from 'next/server'
import { logUserActivity } from '@/lib/activity-log/logUserActivity'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { getPowerOutageRuntimeContext } from '@/lib/power-outages/access'
import { recoverCompletePowerOutageTask, type CompleteRecoveryRequest } from '@/lib/power-outages/complete-recovery'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

function validRequest(value: unknown): value is CompleteRecoveryRequest {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  if (input.target === 'address_normalization' || input.target === 'company_reconciliation') return true
  if (input.target === 'source_projection') return ['cez', 'egd', 'pre'].includes(String(input.source))
  if (input.target === 'provider_discovery') return ['ares', 'mapy', 'google'].includes(String(input.provider))
  return false
}

function actionLabel(input: CompleteRecoveryRequest) {
  if (input.target === 'source_projection') return `obnova projekce ${input.source.toUpperCase()}`
  if (input.target === 'provider_discovery') return `obnova poskytovatele ${input.provider.toUpperCase()}`
  if (input.target === 'address_normalization') return 'obnova normalizace adres'
  return 'obnova vyhodnocení firem'
}

export async function POST(request: Request) {
  let userId: string | null = null
  let input: CompleteRecoveryRequest | null = null
  try {
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) {
      return NextResponse.json({ ok: false, error: 'Neplatný původ požadavku.' }, { status: 403, headers: HEADERS })
    }
    if (!await isPowerOutageRequestAuthorized(request, { adminOnly: true })) {
      return NextResponse.json({ ok: false, error: 'Opravu může spustit pouze administrátor.' }, { status: 403, headers: HEADERS })
    }
    const context = await getPowerOutageRuntimeContext()
    userId = context.user.id
    if (context.profile.role !== 'admin') {
      return NextResponse.json({ ok: false, error: 'Opravu může spustit pouze administrátor.' }, { status: 403, headers: HEADERS })
    }

    const body: unknown = await request.json()
    if (!validRequest(body)) {
      return NextResponse.json({ ok: false, error: 'Neplatný nebo příliš široký požadavek na obnovu.' }, { status: 400, headers: HEADERS })
    }
    input = body
    const result = await recoverCompletePowerOutageTask(input)
    await logUserActivity({
      userId,
      route: '/power-outages?mode=complete',
      section: 'power-outages-complete',
      action: `${actionLabel(input)}: ${result.status}`,
    }, context.supabase)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    if (input && userId) {
      await logUserActivity({
        userId,
        route: '/power-outages?mode=complete',
        section: 'power-outages-complete',
        action: `${actionLabel(input)}: failed`,
      })
    }
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/recover',
      section: 'power-outages-complete',
      errorType: 'CompletePowerOutageRecoveryError',
      userId,
      context: input ? { target: input.target } : {},
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Obnova zpracování se nezdařila.' },
      { status: 500, headers: HEADERS },
    )
  }
}
