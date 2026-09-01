import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'
import {
  analyzeStoreAddresses,
  getStoreAddressAnalysis,
} from '@/lib/power-outages/store-address-analysis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const HEADERS = { 'Cache-Control': 'no-store, max-age=0' } as const

async function currentUserIsAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>()
  return data?.role === 'admin'
}

export async function GET(request: Request) {
  if (!(await isPowerOutageRequestAuthorized(request))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }
  try {
    const [analysis, canAnalyze] = await Promise.all([
      getStoreAddressAnalysis(),
      currentUserIsAdmin(),
    ])
    return NextResponse.json({ ok: true, canAnalyze, ...analysis }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/stores/address-analysis',
      section: 'power-outages',
      errorType: 'PowerOutageStoreAddressAnalysisLoadError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Analýzu adres se nepodařilo načíst.' },
      { status: 500, headers: HEADERS },
    )
  }
}

export async function POST(request: Request) {
  if (!(await isPowerOutageRequestAuthorized(request, { adminOnly: true }))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  }
  try {
    const body = await request.json().catch(() => ({})) as { limit?: unknown }
    const limit = typeof body.limit === 'number' ? body.limit : 20
    const result = await analyzeStoreAddresses(limit)
    return NextResponse.json({ ok: true, ...result }, { headers: HEADERS })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/api/power-outages/stores/address-analysis',
      section: 'power-outages',
      errorType: 'PowerOutageStoreAddressAnalysisRunError',
    })
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Analýza adres selhala.' },
      { status: 500, headers: HEADERS },
    )
  }
}
