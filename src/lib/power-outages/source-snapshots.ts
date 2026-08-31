import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export async function storePowerOutageSourceSnapshot(input: {
  client: SupabaseClient
  source: 'cez' | 'egd'
  payloadSha256: string
  payload: unknown
  recordCount: number
  observedAt: string
  metadata?: Record<string, unknown>
}) {
  const { error } = await input.client
    .from('power_outage_source_payloads')
    .upsert(
      {
        source: input.source,
        payload_sha256: input.payloadSha256,
        payload: input.payload,
        record_count: input.recordCount,
        observed_at: input.observedAt,
        metadata: input.metadata ?? {},
      },
      { onConflict: 'source,payload_sha256' },
    )

  if (error) {
    throw new Error(`Nepodařilo se uložit zdrojový snapshot ${input.source.toUpperCase()}: ${error.message}`)
  }
}
