import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageAutomationAuthorized } from '@/lib/power-outages/automation-auth'
import { processCompleteContactDiscoveryWebsitesV2 } from '@/lib/power-outages/complete-contact-discovery-websites-v2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

export async function GET(request: Request) {
  if (!isPowerOutageAutomationAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }
  try {
    const result = await processCompleteContactDiscoveryWebsitesV2()
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/contact-discovery/websites-v2/process',
      section: 'power-outages',
      errorType: 'CompleteContactDiscoveryWebsiteV2Error',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'SHADOW ověření webu v2 selhalo.' },
      { status: 500, headers: HEADERS },
    )
  }
}
