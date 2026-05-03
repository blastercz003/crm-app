import { createClient } from '@/lib/supabase/server'
import type { GlobalSearchSectionKey } from './types'

type SearchEventParams = {
  userId: string
  query: string
  latencyMs: number
  sectionKeys: GlobalSearchSectionKey[]
  resultCounts: Record<string, number>
}

type ClickEventParams = {
  userId: string
  query: string
  sectionKey: GlobalSearchSectionKey
  itemId: string
  itemHref: string
}

async function insertLog(payload: Record<string, unknown>) {
  try {
    const supabase = await createClient()
    const { error } = await supabase.from('global_search_logs').insert(payload)

    if (error) {
      // Best-effort telemetry only; search UX must never fail because of logging.
      console.warn('Global search logging failed:', error.message)
    }
  } catch (error) {
    console.warn('Global search logging failed unexpectedly:', error)
  }
}

export async function logGlobalSearchEvent(params: SearchEventParams) {
  await insertLog({
    event_type: 'query',
    user_id: params.userId,
    query: params.query,
    latency_ms: params.latencyMs,
    visible_sections: params.sectionKeys,
    result_counts: params.resultCounts,
    created_at: new Date().toISOString(),
  })
}

export async function logGlobalSearchClickEvent(params: ClickEventParams) {
  await insertLog({
    event_type: 'click',
    user_id: params.userId,
    query: params.query,
    clicked_section: params.sectionKey,
    clicked_item_id: params.itemId,
    clicked_item_href: params.itemHref,
    created_at: new Date().toISOString(),
  })
}
