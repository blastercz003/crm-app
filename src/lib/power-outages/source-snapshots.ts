import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export async function storePowerOutageSourceSnapshot(input: {
  client: SupabaseClient
  source: 'cez' | 'egd' | 'pre'
  payloadSha256: string
  payload: unknown
  recordCount: number
  observedAt: string
  metadata?: Record<string, unknown>
}) {
  // Snapshoty jsou obsahove adresovane hashem. Pokud uz stejny obsah mame,
  // neposilame znovu cely (u EG.D velmi objemny) JSON do databaze. Krome
  // zbytecneho prepisu tim predchazime cekani na zamek a statement timeoutu
  // pri soubehu planovaneho a rucne opakovaneho nacteni.
  const { data: existing, error: lookupError } = await input.client
    .from('power_outage_source_payloads')
    .select('id')
    .eq('source', input.source)
    .eq('payload_sha256', input.payloadSha256)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Nepodařilo se ověřit zdrojový snapshot ${input.source.toUpperCase()}: ${lookupError.message}`)
  }
  if (existing) return

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
      { onConflict: 'source,payload_sha256', ignoreDuplicates: true },
    )

  if (error) {
    throw new Error(`Nepodařilo se uložit zdrojový snapshot ${input.source.toUpperCase()}: ${error.message}`)
  }
}
