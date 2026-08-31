import { NextResponse } from 'next/server'
import { z } from 'zod'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { resolvePowerOutageStoreMatch } from '@/lib/power-outages/match-resolution'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { createClient } from '@/lib/supabase/server'

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
  if (!(await isPowerOutageRequestAuthorized(request))) {
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
    return NextResponse.json({ ok: true, ...result })
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
