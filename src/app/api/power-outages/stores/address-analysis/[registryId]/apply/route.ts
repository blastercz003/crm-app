import { NextResponse } from 'next/server'
import { z } from 'zod'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const payloadSchema = z.object({
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  city: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(240),
  suggestionId: z.string().uuid().nullable().optional(),
  candidateData: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ registryId: string }> },
) {
  if (!(await isPowerOutageRequestAuthorized(request, { adminOnly: true }))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [{ registryId }, payload, supabase] = await Promise.all([
      context.params,
      request.json().then((value) => payloadSchema.parse(value)),
      createClient(),
    ])
    if (!z.string().uuid().safeParse(registryId).success) {
      return NextResponse.json({ ok: false, error: 'Neplatné ID registru.' }, { status: 400 })
    }
    const { data, error } = await supabase.rpc('apply_power_outage_store_address_correction', {
      p_registry_id: registryId,
      p_expected_fingerprint: payload.expectedFingerprint,
      p_new_city: payload.city,
      p_new_address: payload.address,
      p_suggestion_id: payload.suggestionId ?? null,
      p_candidate_data: payload.candidateData ?? {},
    })
    if (error) throw error
    return NextResponse.json({ ok: true, auditId: data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/stores/address-analysis/[registryId]/apply',
      section: 'power-outages',
      errorType: 'PowerOutageStoreAddressCorrectionError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Opravu adresy se nepodařilo uložit.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
