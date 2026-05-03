import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GLOBAL_SEARCH_FEATURE_ENABLED } from '@/lib/global-search/config'
import { logGlobalSearchClickEvent } from '@/lib/global-search/logging'
import type { GlobalSearchSectionKey } from '@/lib/global-search/types'

type ClickPayload = {
  query?: string
  sectionKey?: GlobalSearchSectionKey
  itemId?: string
  itemHref?: string
}

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!GLOBAL_SEARCH_FEATURE_ENABLED) {
    return NextResponse.json({ ok: true })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as ClickPayload

  if (!body.query || !body.sectionKey || !body.itemId || !body.itemHref) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  await logGlobalSearchClickEvent({
    userId: user.id,
    query: body.query,
    sectionKey: body.sectionKey,
    itemId: body.itemId,
    itemHref: body.itemHref,
  })

  return NextResponse.json({ ok: true })
}
