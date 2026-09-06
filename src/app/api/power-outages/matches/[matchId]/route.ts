import { NextResponse } from 'next/server'
import { z } from 'zod'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { planMarketClientEmailCandidates } from '@/lib/power-outages/client-email-candidates'
import { resolvePowerOutageStoreMatch } from '@/lib/power-outages/match-resolution'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { createClient } from '@/lib/supabase/server'
import { planPowerOutageNotifications } from '@/lib/power-outages/notification-planner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const payloadSchema = z.object({
  status: z.enum(['confirmed', 'needs_review', 'dismissed']),
  note: z.string().max(1_000).nullish(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ matchId: string }> },
) {
  if (!(await isPowerOutageRequestAuthorized(request, { adminOnly: true }))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [{ matchId }, payload, supabase] = await Promise.all([
      context.params,
      request.json().then((value) => payloadSchema.parse(value)),
      createClient(),
    ])
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
    const result = await resolvePowerOutageStoreMatch({
      matchId,
      status: payload.status,
      actorUserId: user.id,
      note: payload.note,
    })
    let notificationPlanning = null
    let clientEmailPlanning = null
    if (result.changed && payload.status === 'confirmed') {
      const [notificationResult, clientEmailResult] = await Promise.allSettled([
        planPowerOutageNotifications(),
        planMarketClientEmailCandidates(200),
      ])
      if (notificationResult.status === 'fulfilled') {
        notificationPlanning = notificationResult.value
      } else {
        console.error('Potvrzená shoda byla uložena, ale plán upozornění se nepodařilo obnovit.', notificationResult.reason)
      }
      if (clientEmailResult.status === 'fulfilled') {
        clientEmailPlanning = clientEmailResult.value
      } else {
        console.error('Potvrzená shoda byla uložena, ale plán klientských e-mailů se nepodařilo obnovit.', clientEmailResult.reason)
      }
    }
    return NextResponse.json({ ok: true, ...result, notificationPlanning, clientEmailPlanning })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/matches/[matchId]',
      section: 'power-outages',
      errorType: 'PowerOutageMatchResolutionError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Úprava shody selhala.' },
      { status: 400 },
    )
  }
}
