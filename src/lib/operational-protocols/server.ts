import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { NormalizedOperationalProtocolDraft } from './types'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type FinalOperationalProtocolPdfMetadata = {
  digitallySignedAt: string
  finalizedAt: string
  storagePath: string
  fileName: string
  sizeBytes: number
  sha256: string
}

export async function insertGeneratingOperationalProtocol(params: {
  supabase: SupabaseServerClient
  userId: string
  draft: NormalizedOperationalProtocolDraft
  copiedFromProtocolId?: string | null
}) {
  const { supabase, userId, draft } = params

  const { data: protocol, error: protocolError } = await supabase
    .from('operational_protocols')
    .insert({
      job_number: draft.jobNumber,
      job_title: draft.jobTitle,
      realization_start_at: draft.realizationStartAt,
      realization_end_at: draft.realizationEndAt,
      handover_place: draft.handoverPlace,
      source_client_id: draft.sourceClientId,
      client_name: draft.clientName,
      client_address: draft.clientAddress,
      client_ico: draft.clientIco,
      client_contact_person: draft.clientContactPerson,
      client_contact_phone: draft.clientContactPhone,
      subtenant_choice: draft.subtenantChoice,
      subtenant_name: draft.subtenantName,
      subtenant_note: draft.subtenantNote,
      realization_at: draft.realizationAt,
      realization_completed_at: draft.realizationCompletedAt,
      technician_name: draft.technicianName,
      copied_from_protocol_id: params.copiedFromProtocolId ?? null,
      generation_status: 'generating',
      created_by: userId,
    })
    .select('id')
    .single()

  if (protocolError || !protocol) {
    if (protocolError?.code === '23505') {
      throw new Error('Protokol s tímto číslem zakázky už existuje.')
    }
    throw new Error('Nepodařilo se založit provozní protokol.')
  }

  const protocolId = String(protocol.id)

  try {
    if (draft.devices.length > 0) {
      const { error } = await supabase.from('operational_protocol_devices').insert(
        draft.devices.map((device, index) => ({
          operational_protocol_id: protocolId,
          sort_order: index,
          device_name: device.deviceName,
          mth_start: device.mthStart,
          mth_end: device.mthEnd,
          fuel_start_percent: device.fuelStartPercent,
          fuel_end_percent: device.fuelEndPercent,
        }))
      )

      if (error) throw new Error('Nepodařilo se uložit zařízení protokolu.')
    }

    if (draft.accessories.length > 0) {
      const { error } = await supabase
        .from('operational_protocol_accessories')
        .insert(
          draft.accessories.map((item, index) => ({
            operational_protocol_id: protocolId,
            sort_order: index,
            item_name: item.itemName,
          }))
        )

      if (error) throw new Error('Nepodařilo se uložit příslušenství protokolu.')
    }
  } catch (error) {
    await supabase.from('operational_protocols').delete().eq('id', protocolId)
    throw error
  }

  return protocolId
}

export async function finalizeOperationalProtocol(params: {
  supabase: SupabaseServerClient
  protocolId: string
  pdf: FinalOperationalProtocolPdfMetadata
}) {
  const { error } = await params.supabase
    .from('operational_protocols')
    .update({
      generation_status: 'final',
      digitally_signed_at: params.pdf.digitallySignedAt,
      finalized_at: params.pdf.finalizedAt,
      pdf_storage_path: params.pdf.storagePath,
      pdf_file_name: params.pdf.fileName,
      pdf_size_bytes: params.pdf.sizeBytes,
      pdf_sha256: params.pdf.sha256,
    })
    .eq('id', params.protocolId)
    .eq('generation_status', 'generating')

  if (error) {
    throw new Error('Nepodařilo se dokončit uložení provozního protokolu.')
  }
}

export async function removeGeneratingOperationalProtocol(params: {
  supabase: SupabaseServerClient
  protocolId: string
}) {
  await params.supabase
    .from('operational_protocols')
    .delete()
    .eq('id', params.protocolId)
    .eq('generation_status', 'generating')
}
