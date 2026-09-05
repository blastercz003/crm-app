import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'

export type MarketClientEmailCandidatePlanResult = {
  ok: boolean
  status?: 'disabled' | 'shadow' | 'test' | 'live'
  processedCount?: number
  plannedCount: number
  skippedCount?: number
  sendingAttempted?: false
  renderedCount?: number
  skipped?: boolean
  reason?: string
  errorCode?: string
  errorMessage?: string
}

export async function planMarketClientEmailCandidates(limit = 200) {
  const client = getServiceRoleClient()
  if (!client) {
    throw new Error('Chybí serverové připojení pro plánování klientských e-mailů.')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Velikost dávky kandidátů musí být mezi 1 a 1000.')
  }

  const { data, error } = await client.rpc('plan_power_outage_client_email_candidates', {
    p_limit: limit,
  })
  if (error) throw new Error(`Kandidáty klientských e-mailů se nepodařilo připravit: ${error.message}`)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Plánovač klientských e-mailů nevrátil platný výsledek.')
  }
  const result = data as MarketClientEmailCandidatePlanResult
  if (!result.ok) {
    throw new Error(result.errorMessage || 'Plánování kandidátů klientských e-mailů selhalo.')
  }

  if (result.status === 'disabled') return result

  const { data: renderedData, error: renderedError } = await client.rpc(
    'render_power_outage_client_email_shadow_deliveries',
    { p_limit: limit },
  )
  if (renderedError) {
    throw new Error(`Stínové náhledy klientských e-mailů se nepodařilo připravit: ${renderedError.message}`)
  }
  if (!renderedData || typeof renderedData !== 'object' || Array.isArray(renderedData)) {
    throw new Error('Příprava stínových náhledů nevrátila platný výsledek.')
  }
  const rendered = renderedData as MarketClientEmailCandidatePlanResult
  if (!rendered.ok) {
    throw new Error(rendered.errorMessage || 'Příprava stínových náhledů selhala.')
  }

  return {
    ...result,
    renderedCount: rendered.renderedCount ?? 0,
    sendingAttempted: false as const,
  }
}
