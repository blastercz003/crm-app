import { NextResponse } from 'next/server'
import { z } from 'zod'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { getServiceRoleClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

const tokenSchema = z.string().uuid()
const SECURITY_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
} as const

function page(input: { title: string; message: string; token?: string; confirm?: boolean }, status = 200) {
  const action = input.token
    ? `/api/power-outages/complete/notification-emails/unsubscribe/${encodeURIComponent(input.token)}`
    : ''
  const button = input.confirm && input.token
    ? `<form method="post" action="${action}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Odhlásit tato upozornění</button></form>`
    : ''
  const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${input.title}</title><style>body{margin:0;background:#eef3f8;color:#102033;font-family:Arial,sans-serif}main{box-sizing:border-box;max-width:620px;margin:12vh auto;padding:34px;border:1px solid #d9e3ee;border-radius:24px;background:#fff;box-shadow:0 18px 60px rgba(15,35,55,.12)}small{font-weight:700;letter-spacing:.12em;color:#51708b}h1{margin:12px 0;font-size:28px}p{line-height:1.65;color:#526475}button{margin-top:18px;border:0;border-radius:14px;background:#176fa8;color:#fff;padding:14px 20px;font-weight:700;cursor:pointer}footer{margin-top:24px;font-size:12px;color:#758699}</style></head><body><main><small>B-ENERGY · PLÁNOVANÉ ODSTÁVKY</small><h1>${input.title}</h1><p>${input.message}</p>${button}<footer>Otevření tohoto odkazu samo o sobě nastavení nemění.</footer></main></body></html>`
  return new NextResponse(html, { status, headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } })
}

type RouteContext = { params: Promise<{ token: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params
  const parsed = tokenSchema.safeParse(token)
  if (!parsed.success) {
    return page({ title: 'Odkaz není dostupný', message: 'Odkaz pro odhlášení není platný.' }, 404)
  }
  return page({
    title: 'Odhlášení upozornění',
    message: 'Po potvrzení přestaneme na tuto adresu posílat provozní upozornění na plánované odstávky elektřiny.',
    token: parsed.data,
    confirm: true,
  })
}

export async function POST(_request: Request, context: RouteContext) {
  const { token } = await context.params
  const parsed = tokenSchema.safeParse(token)
  if (!parsed.success) {
    return page({ title: 'Odkaz není dostupný', message: 'Požadavek se nepodařilo ověřit.' }, 404)
  }

  const service = getServiceRoleClient()
  if (!service) {
    return page({ title: 'Odhlášení se nezdařilo', message: 'Zkuste požadavek prosím později.' }, 503)
  }

  try {
    const { data, error } = await service.rpc('unsubscribe_cpo_notification_email_v1', {
      requested_token: parsed.data,
      requested_evidence: {
        endpointContract: 'complete-notification-email-unsubscribe-http-v1',
        method: 'POST',
      },
    })
    if (error) throw new Error(error.message)
    const result = data && typeof data === 'object' && !Array.isArray(data)
      ? data as { status?: string }
      : {}
    if (result.status === 'unavailable') {
      return page({ title: 'Odkaz není dostupný', message: 'Požadavek se nepodařilo ověřit.' }, 404)
    }
    return page({
      title: 'Upozornění jsou odhlášena',
      message: 'Nastavení jsme bezpečně uložili. Na tuto adresu již další provozní upozornění neodešleme.',
    })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/complete/notification-emails/unsubscribe/[token]',
      section: 'power-outages',
      errorType: 'CompleteNotificationEmailUnsubscribeError',
    })
    return page({ title: 'Odhlášení se nezdařilo', message: 'Zkuste požadavek prosím později.' }, 500)
  }
}
