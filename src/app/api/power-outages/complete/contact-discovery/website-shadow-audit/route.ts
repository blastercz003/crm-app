import { NextResponse } from 'next/server'
import { z } from 'zod'
import { diagnoseOfficialWebsiteWithBrave } from '@/lib/power-outages/complete-contact-discovery-brave'
import { verifyOfficialWebsiteCandidate } from '@/lib/power-outages/complete-contact-discovery-website-verification'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import { getServiceRoleClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const
const InputSchema = z.object({
  icos: z.array(z.string().regex(/^\d{8}$/)).min(1).max(5),
}).strict()

type QueueRow = { ico: string; company_profile_id: string | null }
type ProfileRow = { id: string; ico: string; official_name: string }

export async function POST(request: Request) {
  if (!(await isPowerOutageRequestAuthorized(request, { adminOnly: true }))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }

  const input = InputSchema.safeParse(await request.json().catch(() => null))
  if (!input.success || new Set(input.data.icos).size !== input.data.icos.length) {
    return NextResponse.json({ ok: false, error: 'Zadejte 1 až 5 unikátních osmimístných IČO.' }, { status: 400, headers: HEADERS })
  }

  const client = getServiceRoleClient()
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Chybí serverová konfigurace databáze.' }, { status: 503, headers: HEADERS })
  }

  const { data: queueRows, error: queueError } = await client
    .from('complete_power_outage_contact_discovery_queue')
    .select('ico,company_profile_id')
    .in('ico', input.data.icos)
    .returns<QueueRow[]>()
  if (queueError) {
    return NextResponse.json({ ok: false, error: 'Připravený auditní vzorek se nepodařilo načíst.' }, { status: 500, headers: HEADERS })
  }

  const queueByIco = new Map((queueRows ?? []).map((row) => [row.ico, row]))
  const profileIds = (queueRows ?? []).flatMap((row) => row.company_profile_id ? [row.company_profile_id] : [])
  const { data: profiles, error: profileError } = profileIds.length > 0
    ? await client.from('complete_power_outage_company_profiles')
      .select('id,ico,official_name')
      .in('id', profileIds)
      .returns<ProfileRow[]>()
    : { data: [] as ProfileRow[], error: null }
  if (profileError) {
    return NextResponse.json({ ok: false, error: 'Profily auditního vzorku se nepodařilo načíst.' }, { status: 500, headers: HEADERS })
  }
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))

  const results = []
  for (const ico of input.data.icos) {
    const queueRow = queueByIco.get(ico)
    const profile = queueRow?.company_profile_id ? profileById.get(queueRow.company_profile_id) : null
    if (!queueRow || !profile || profile.ico !== ico) {
      results.push({ ico, status: 'not_testable', reasonCodes: ['prepared_profile_missing'] })
      continue
    }

    try {
      const search = await diagnoseOfficialWebsiteWithBrave({ companyName: profile.official_name, ico })
      const candidates = []
      for (const candidate of search.candidates) {
        const verification = await verifyOfficialWebsiteCandidate({
          candidateUrl: candidate.url,
          companyName: profile.official_name,
          ico,
        })
        candidates.push({ ...candidate, verification })
        if (verification.status === 'verified') break
      }
      const verified = candidates.find((candidate) => candidate.verification.status === 'verified')
      const needsReview = candidates.find((candidate) => candidate.verification.status === 'needs_review')
      results.push({
        ico,
        companyName: profile.official_name,
        status: verified ? 'verified' : needsReview ? 'needs_review' : 'rejected',
        verifiedWebsite: verified?.verification.verifiedUrl ?? null,
        search: {
          provider: search.provider,
          queryContract: search.queryContract,
          queryCount: search.queryCount,
          resultCount: search.resultCount,
          acceptedCandidateCount: search.acceptedCandidateCount,
        },
        candidates,
      })
    } catch (error) {
      results.push({
        ico,
        companyName: profile.official_name,
        status: 'error',
        error: error instanceof Error ? error.message : 'SHADOW ověření webu selhalo.',
      })
    }
  }

  return NextResponse.json({
    ok: true,
    mode: 'shadow',
    persisted: false,
    queueMutated: false,
    testedCount: results.length,
    results,
  }, { headers: HEADERS })
}
