import { NextResponse } from 'next/server'
import { z } from 'zod'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { getCompleteNotificationResendConfiguration } from '@/lib/power-outages/complete-notification-email-resend-config'
import { sendOneCompleteNotificationTest } from '@/lib/power-outages/complete-notification-email-test-worker'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const
const bodySchema = z.object({ planId: z.string().uuid().optional() }).strict()

export async function GET(request: Request) {
  if (!await isPowerOutageRequestAuthorized(request, { adminOnly: true, allowAutomation: false })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }
  const configuration = getCompleteNotificationResendConfiguration()
  return NextResponse.json({
    ok: true,
    testReady: configuration.testReady,
    testRecipientMasked: configuration.testRecipientMasked,
    sendingDomain: configuration.sendingDomain,
    apiKeyConfigured: configuration.apiKeyConfigured,
    domainVerified: configuration.domainVerified,
    webhookSecretConfigured: configuration.webhookSecretConfigured,
    fromEmailConfigured: configuration.fromEmailConfigured,
    fromDomainMatches: configuration.fromDomainMatches,
    issues: configuration.issues,
    liveDispatchAvailable: false,
    marketEmailIsolation: true,
  }, { headers: HEADERS })
}

export async function POST(request: Request) {
  if (!await isPowerOutageRequestAuthorized(request, { adminOnly: true, allowAutomation: false })) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }
  try {
    const rawBody = await request.json().catch(() => ({}))
    const input = bodySchema.parse(rawBody)
    return NextResponse.json(await sendOneCompleteNotificationTest(input.planId), { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/notification-emails/test/send',
      section: 'power-outages',
      errorType: 'CompleteNotificationEmailTestError',
    })
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Resend TEST KOMPLETNI selhal.',
    }, { status: 500, headers: HEADERS })
  }
}
