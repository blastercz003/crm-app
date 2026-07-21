import { NextRequest, NextResponse } from 'next/server'
import {
  getPresenceOverviewForAdmin,
  getUserActivityForAdmin,
  trackUserPresence,
  type PresencePeriod,
  type TrackPresenceInput,
} from '@/lib/dashboard/online-presence-service'

export const dynamic = 'force-dynamic'

function parsePeriod(value: string | null): PresencePeriod {
  return value === '7d' || value === '30d' ? value : 'today'
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode')
  const period = parsePeriod(request.nextUrl.searchParams.get('period'))

  if (mode === 'overview') {
    return NextResponse.json(await getPresenceOverviewForAdmin(period))
  }

  if (mode === 'activity') {
    const userId = request.nextUrl.searchParams.get('userId') ?? ''
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 30)
    return NextResponse.json(await getUserActivityForAdmin(userId, limit, period))
  }

  return NextResponse.json({ success: false, error: 'Neplatný režim požadavku.' }, { status: 400 })
}

export async function POST(request: NextRequest) {
  let input: TrackPresenceInput
  try {
    input = (await request.json()) as TrackPresenceInput
  } catch {
    return NextResponse.json({ success: false, error: 'Neplatná data požadavku.' }, { status: 400 })
  }

  return NextResponse.json(await trackUserPresence(input))
}
