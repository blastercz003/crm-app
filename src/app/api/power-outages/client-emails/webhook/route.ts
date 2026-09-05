import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import {
  recordMarketClientEmailWebhook,
  verifyMarketClientEmailWebhook,
} from '@/lib/power-outages/client-email-webhook'

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
    event = verifyMarketClientEmailWebhook({ payload, id, timestamp, signature })
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid webhook signature' }, { status: 400 })
  }

  try {
    const result = await recordMarketClientEmailWebhook(id, event)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/client-emails/webhook',
      section: 'power-outages',
      errorType: 'MarketClientEmailWebhookError',
    })
    return NextResponse.json({ ok: false, error: 'Webhook event could not be stored' }, { status: 500 })
  }
}
