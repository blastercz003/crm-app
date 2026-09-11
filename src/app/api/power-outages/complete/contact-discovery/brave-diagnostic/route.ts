import { NextResponse } from 'next/server'
import { z } from 'zod'
import { diagnoseOfficialWebsiteWithBrave } from '@/lib/power-outages/complete-contact-discovery-brave'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { getServiceRoleClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const
const InputSchema = z.object({ ico: z.string().regex(/^\d{8}$/) }).strict()

export async function POST(request: Request) {
  if (!(await isPowerOutageRequestAuthorized(request, { adminOnly: true }))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }

  const input = InputSchema.safeParse(await request.json().catch(() => null))
  if (!input.success) {
    return NextResponse.json({ ok: false, error: 'Je vyžadováno platné osmimístné IČO.' }, { status: 400, headers: HEADERS })
  }

  const serviceClient = getServiceRoleClient()
  if (!serviceClient) {
    return NextResponse.json({ ok: false, error: 'Chybí serverová konfigurace databáze.' }, { status: 503, headers: HEADERS })
  }

  const { data: queueItem, error: queueError } = await serviceClient
    .from('complete_power_outage_contact_discovery_queue')
    .select('ico,company_profile_id,queue_status')
    .eq('ico', input.data.ico)
    .maybeSingle<{ ico: string; company_profile_id: string | null; queue_status: string }>()

  if (queueError) {
    return NextResponse.json({ ok: false, error: 'Připravenou položku se nepodařilo ověřit.' }, { status: 500, headers: HEADERS })
  }
  if (!queueItem) {
    return NextResponse.json({ ok: false, error: 'IČO není součástí připravené auditní fronty.' }, { status: 404, headers: HEADERS })
  }
  if (!queueItem.company_profile_id) {
    return NextResponse.json({ ok: false, error: 'Firma ještě nemá dokončený ARES/RES profil.' }, { status: 409, headers: HEADERS })
  }

  const { data: profile, error: profileError } = await serviceClient
    .from('complete_power_outage_company_profiles')
    .select('ico,official_name')
    .eq('id', queueItem.company_profile_id)
    .eq('ico', queueItem.ico)
    .maybeSingle<{ ico: string; official_name: string }>()

  if (profileError || !profile) {
    return NextResponse.json({ ok: false, error: 'Profil firmy se nepodařilo bezpečně načíst.' }, { status: 500, headers: HEADERS })
  }

  try {
    const diagnostic = await diagnoseOfficialWebsiteWithBrave({
      companyName: profile.official_name,
      ico: profile.ico,
    })
    return NextResponse.json({
      ok: true,
      persisted: false,
      queueMutated: false,
      company: { ico: profile.ico, officialName: profile.official_name },
      ...diagnostic,
    }, { headers: HEADERS })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Diagnostický dotaz Brave Search selhal.',
    }, { status: 502, headers: HEADERS })
  }
}
