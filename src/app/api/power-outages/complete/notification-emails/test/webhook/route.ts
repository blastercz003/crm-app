import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import {
  recordCompleteNotificationTestWebhook,
  verifyCompleteNotificationTestWebhook,
} from '@/lib/power-outages/complete-notification-email-test-webhook'
import { recordCompleteNotificationLiveWebhook } from '@/lib/power-outages/complete-notification-email-live-webhook'
import { recordCompleteNotificationProductionWebhook } from '@/lib/power-outages/complete-notification-email-production-webhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: Request) {
  const id = request.headers.get('svix-id')
  const timestamp = request.headers.get('svix-timestamp')
  const signature = request.headers.get('svix-signature')
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ ok: false, error: 'Missing signature headers' }, { status: 400 })
  }

  const payload = await request.text()
  let event
  try {
    event = verifyCompleteNotificationTestWebhook({ payload, id, timestamp, signature })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid webhook signature' }, { status: 400 })
  }

  try {
    const testResult = await recordCompleteNotificationTestWebhook(id, event)
    const liveResult = await recordCompleteNotificationLiveWebhook(id, event)
    const productionResult = await recordCompleteNotificationProductionWebhook(id, event)
    return NextResponse.json({ ok: true, testResult, liveResult, productionResult })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/notification-emails/test/webhook',
      section: 'power-outages',
      errorType: 'CompleteNotificationEmailWebhookError',
    })
    return NextResponse.json({ ok: false, error: 'Webhook event could not be stored' }, { status: 500 })
  }
}
