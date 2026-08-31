import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { syncPowerOutages } from './orchestrator'

type SourceRefreshState = {
  source: 'cez' | 'egd'
  last_success_at: string | null
  consecutive_failure_count: number
  store_revision_processed: number
}

export async function refreshPowerOutagesIfNeeded() {
  const client = getServiceRoleClient()
  if (!client) {
    throw new Error('Chybí serverové připojení Supabase pro kontrolu aktualizace odstávek.')
  }

  const [{ data: sources, error: sourceError }, { data: catalog, error: catalogError }] = await Promise.all([
    client
      .from('power_outage_source_state')
      .select('source,last_success_at,consecutive_failure_count,store_revision_processed')
      .order('source'),
    client
      .from('power_outage_store_catalog_state')
      .select('revision')
      .eq('singleton', true)
      .single<{ revision: number }>(),
  ])
  if (sourceError) throw sourceError
  if (catalogError) throw catalogError

  const typedSources = (sources ?? []) as SourceRefreshState[]
  const reasons: string[] = []
  if (typedSources.length !== 2 || typedSources.some((source) => !source.last_success_at)) {
    reasons.push('initial_sync')
  }
  if (typedSources.some((source) => source.consecutive_failure_count > 0)) {
    reasons.push('retry_after_failure')
  }
  if (typedSources.some((source) => source.store_revision_processed < catalog.revision)) {
    reasons.push('store_catalog_changed')
  }

  if (reasons.length === 0) {
    return {
      ok: true as const,
      skipped: true as const,
      reasons: [] as string[],
      storeRevision: catalog.revision,
    }
  }

  return {
    ...(await syncPowerOutages('all')),
    skipped: false as const,
    reasons: [...new Set(reasons)],
    storeRevision: catalog.revision,
  }
}
