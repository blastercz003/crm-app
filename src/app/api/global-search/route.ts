import { NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { createClient } from '@/lib/supabase/server'
import { GLOBAL_SEARCH_FEATURE_ENABLED } from '@/lib/global-search/config'
import { logGlobalSearchEvent } from '@/lib/global-search/logging'
import { globalSearch } from '@/lib/global-search/search'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!GLOBAL_SEARCH_FEATURE_ENABLED) {
    return NextResponse.json({ query: '', sections: [] })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Uživatel není přihlášen.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim() ?? ''
  const startedAt = Date.now()

  try {
    const payload = await globalSearch(query)

    const latencyMs = Date.now() - startedAt
    const sectionKeys = payload.sections.map((section) => section.key)
    const resultCounts = Object.fromEntries(
      payload.sections.map((section) => [section.key, section.totalCount])
    )

    await logGlobalSearchEvent({
      userId: user.id,
      query,
      latencyMs,
      sectionKeys,
      resultCounts,
    })

    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nepodařilo se načíst globální hledání.'
    await reportRouteError({
      error,
      route: '/api/global-search',
      section: 'global-search',
      errorType: 'GlobalSearchRouteError',
      userId: user.id,
      context: { query },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
