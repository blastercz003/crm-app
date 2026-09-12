import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { processCompleteContactExtractionShadow } from '@/lib/power-outages/complete-contact-discovery-contact-extraction-shadow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

export async function GET(request: Request) {
  if (!isPowerOutageAutomationAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }
  try {
    const result = await processCompleteContactExtractionShadow()
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/contact-discovery/contacts-shadow/process',
      section: 'power-outages',
      errorType: 'CompleteContactExtractionShadowError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'SHADOW extrakce kontaktů selhala.' },
      { status: 500, headers: HEADERS },
    )
  }
}
