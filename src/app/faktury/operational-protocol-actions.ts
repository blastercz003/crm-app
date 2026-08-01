'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { reportActionError } from '@/lib/errors/reportActionError'
import {
  getOperationalProtocolPdfFileName,
  renderOperationalProtocolPdf,
} from '@/lib/operational-protocols/pdf-document'
import {
  finalizeOperationalProtocol,
  insertGeneratingOperationalProtocol,
  removeGeneratingOperationalProtocol,
} from '@/lib/operational-protocols/server'
import {
  OPERATIONAL_PROTOCOLS_BUCKET,
  OPERATIONAL_PROTOCOLS_STORAGE_PREFIX,
  type OperationalProtocolActionResult,
  type OperationalProtocolArchiveFilters,
  type OperationalProtocolClientOption,
  type OperationalProtocolDetail,
  type OperationalProtocolDraftInput,
  type OperationalProtocolListItem,
  type OperationalProtocolSubtenantChoice,
} from '@/lib/operational-protocols/types'
import {
  normalizeOperationalProtocolJobNumber,
  validateOperationalProtocolDraft,
} from '@/lib/operational-protocols/validation'
import { createClient } from '@/lib/supabase/server'

type ProfileRow = {
  role: string | null
}

type ClientRow = {
  id: string
  name: string
  address: string | null
  ico: string | null
}

type ProtocolListRow = {
  id: string
  job_number: string | null
  job_title: string
  client_name: string
  realization_start_at: string
  realization_end_at: string
  handover_place: string
  technician_name: string
  created_at: string
  created_by: string | null
  pdf_file_name: string
}

type ProtocolDetailRow = ProtocolListRow & {
  source_client_id: string | null
  client_address: string | null
  client_ico: string | null
  client_contact_person: string | null
  client_contact_phone: string | null
  subtenant_choice: OperationalProtocolSubtenantChoice
  subtenant_name: string | null
  subtenant_note: string | null
  realization_at: string
  realization_completed_at: string
  digitally_signed_at: string
  finalized_at: string
  copied_from_protocol_id: string | null
  pdf_storage_path: string
  pdf_size_bytes: number
  pdf_sha256: string
}

type DeviceRow = {
  id: string
  sort_order: number
  device_name: string
  mth_start: string | null
  mth_end: string | null
  fuel_start_percent: number | string | null
  fuel_end_percent: number | string | null
}

type AccessoryRow = {
  id: string
  sort_order: number
  item_name: string
}

async function requireOperationalProtocolAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Nejsi přihlášený.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  if ((profile as ProfileRow | null)?.role !== 'admin') {
    return {
      supabase,
      user: null,
      error: 'Provozní protokoly jsou dostupné pouze administrátorům.',
    }
  }

  return { supabase, user, error: null }
}

function failure<T>(error: string): OperationalProtocolActionResult<T> {
  return { success: false, error, data: null }
}

function normalizeUuid(value: unknown) {
  const normalized = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized
  )
    ? normalized
    : null
}

function sanitizeSearchQuery(value: unknown) {
  return String(value ?? '')
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function normalizeDateFilter(value: unknown) {
  const normalized = String(value ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

async function loadProfileNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileIds: Array<string | null>
) {
  const ids = Array.from(new Set(profileIds.filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return new Map<string, string>()

  const { data } = await supabase.from('profiles').select('id, name').in('id', ids)
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string | null }>).map((profile) => [
      profile.id,
      String(profile.name ?? '').trim(),
    ])
  )
}

export async function searchOperationalProtocolClientsAction(
  query: string
): Promise<OperationalProtocolActionResult<OperationalProtocolClientOption[]>> {
  const { supabase, user, error: accessError } = await requireOperationalProtocolAdmin()
  if (!user) return failure(accessError ?? 'Nemáš oprávnění.')

  try {
    const normalizedQuery = sanitizeSearchQuery(query)
    let request = supabase
      .from('clients')
      .select('id, name, address, ico')
      .order('name', { ascending: true })
      .limit(15)

    if (normalizedQuery) {
      request = request.or(
        `name.ilike.%${normalizedQuery}%,ico.ilike.%${normalizedQuery}%`
      )
    }

    const { data, error } = await request
    if (error) return failure('Nepodařilo se načíst firmy ze sekce Klienti.')

    return {
      success: true,
      error: null,
      data: ((data ?? []) as ClientRow[]).map((client) => ({
        id: client.id,
        name: client.name,
        address: client.address,
        ico: client.ico,
      })),
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'searchOperationalProtocolClientsAction',
      section: 'faktury-operational-protocols',
      userId: user.id,
    })
    return failure('Firmy se nepodařilo načíst.')
  }
}

export async function checkOperationalProtocolJobNumberAction(
  jobNumber: string
): Promise<OperationalProtocolActionResult<{ available: boolean; normalized: string | null }>> {
  const { supabase, user, error: accessError } = await requireOperationalProtocolAdmin()
  if (!user) return failure(accessError ?? 'Nemáš oprávnění.')

  const normalized = normalizeOperationalProtocolJobNumber(jobNumber)
  if (!normalized) {
    return { success: true, error: null, data: { available: true, normalized: null } }
  }

  const { data, error } = await supabase
    .from('operational_protocols')
    .select('id')
    .eq('job_number_normalized', normalized)
    .limit(1)

  if (error) return failure('Číslo zakázky se nepodařilo ověřit.')

  return {
    success: true,
    error: null,
    data: { available: (data ?? []).length === 0, normalized },
  }
}

export async function generateOperationalProtocolAction(
  input: OperationalProtocolDraftInput
): Promise<
  OperationalProtocolActionResult<{
    id: string
    fileName: string
    printUrl: string
  }>
> {
  const { supabase, user, error: accessError } = await requireOperationalProtocolAdmin()
  if (!user) return failure(accessError ?? 'Nemáš oprávnění.')

  const validation = validateOperationalProtocolDraft(input)
  if (!validation.success) return failure(validation.error)
  const copiedFromProtocolId = input.copiedFromProtocolId
    ? normalizeUuid(input.copiedFromProtocolId)
    : null
  if (input.copiedFromProtocolId && !copiedFromProtocolId) {
    return failure('Zdroj kopírovaného protokolu není platný.')
  }

  let protocolId: string | null = null
  let storagePath: string | null = null
  let isFinalized = false

  try {
    const generatedAt = new Date().toISOString()
    const pdfData = { ...validation.data, generatedAt }
    const fileName = getOperationalProtocolPdfFileName(pdfData)

    protocolId = await insertGeneratingOperationalProtocol({
      supabase,
      userId: user.id,
      draft: validation.data,
      copiedFromProtocolId,
    })

    storagePath = `${OPERATIONAL_PROTOCOLS_STORAGE_PREFIX}/${generatedAt.slice(0, 4)}/${protocolId}/${fileName}`
    const pdfBuffer = await renderOperationalProtocolPdf(pdfData)
    const pdfBytes = new Uint8Array(pdfBuffer)
    const sha256 = createHash('sha256').update(pdfBuffer).digest('hex')

    const { error: uploadError } = await supabase.storage
      .from(OPERATIONAL_PROTOCOLS_BUCKET)
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      throw new Error('Vygenerované PDF se nepodařilo uložit.')
    }

    await finalizeOperationalProtocol({
      supabase,
      protocolId,
      pdf: {
        digitallySignedAt: generatedAt,
        finalizedAt: generatedAt,
        storagePath,
        fileName,
        sizeBytes: pdfBytes.byteLength,
        sha256,
      },
    })
    isFinalized = true

    try {
      revalidatePath('/faktury')
    } catch (revalidationError) {
      await reportActionError({
        error: revalidationError,
        action: 'generateOperationalProtocolAction.revalidate',
        section: 'faktury-operational-protocols',
        userId: user.id,
        context: { protocolId },
      })
    }

    return {
      success: true,
      error: null,
      data: {
        id: protocolId,
        fileName,
        printUrl: `/faktury/provozni-protokoly/${protocolId}/tisk`,
      },
    }
  } catch (error) {
    if (!isFinalized && storagePath) {
      await supabase.storage.from(OPERATIONAL_PROTOCOLS_BUCKET).remove([storagePath])
    }
    if (!isFinalized && protocolId) {
      await removeGeneratingOperationalProtocol({ supabase, protocolId })
    }

    await reportActionError({
      error,
      action: 'generateOperationalProtocolAction',
      section: 'faktury-operational-protocols',
      userId: user.id,
      context: { protocolId, storagePath },
    })

    return failure(error instanceof Error ? error.message : 'Protokol se nepodařilo vygenerovat.')
  }
}

export async function listOperationalProtocolsAction(
  filters: OperationalProtocolArchiveFilters = {}
): Promise<
  OperationalProtocolActionResult<{
    items: OperationalProtocolListItem[]
    total: number
    page: number
    pageSize: number
  }>
> {
  const { supabase, user, error: accessError } = await requireOperationalProtocolAdmin()
  if (!user) return failure(accessError ?? 'Nemáš oprávnění.')

  try {
    const page = Math.max(1, Math.floor(Number(filters.page) || 1))
    const pageSize = Math.min(100, Math.max(10, Math.floor(Number(filters.pageSize) || 30)))
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const query = sanitizeSearchQuery(filters.query)
    const dateFrom = normalizeDateFilter(filters.dateFrom)
    const dateTo = normalizeDateFilter(filters.dateTo)

    let request = supabase
      .from('operational_protocols')
      .select(
        'id, job_number, job_title, client_name, realization_start_at, realization_end_at, handover_place, technician_name, created_at, created_by, pdf_file_name',
        { count: 'exact' }
      )
      .eq('generation_status', 'final')
      .order('created_at', { ascending: false })
      .range(from, to)

    if (query) {
      request = request.or(
        `job_number.ilike.%${query}%,job_title.ilike.%${query}%,client_name.ilike.%${query}%`
      )
    }
    if (dateFrom) request = request.gte('realization_start_at', `${dateFrom}T00:00:00+00:00`)
    if (dateTo) request = request.lte('realization_start_at', `${dateTo}T23:59:59.999+00:00`)

    const { data, error, count } = await request
    if (error) return failure('Uložené provozní protokoly se nepodařilo načíst.')

    const rows = (data ?? []) as ProtocolListRow[]
    const ids = rows.map((row) => row.id)
    const [profileNames, devicesResponse, accessoriesResponse] = await Promise.all([
      loadProfileNames(supabase, rows.map((row) => row.created_by)),
      ids.length
        ? supabase
            .from('operational_protocol_devices')
            .select('operational_protocol_id')
            .in('operational_protocol_id', ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? supabase
            .from('operational_protocol_accessories')
            .select('operational_protocol_id')
            .in('operational_protocol_id', ids)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (devicesResponse.error || accessoriesResponse.error) {
      return failure('Nepodařilo se načíst položky uložených protokolů.')
    }

    const deviceCounts = new Map<string, number>()
    for (const item of (devicesResponse.data ?? []) as Array<{ operational_protocol_id: string }>) {
      deviceCounts.set(item.operational_protocol_id, (deviceCounts.get(item.operational_protocol_id) ?? 0) + 1)
    }
    const accessoryCounts = new Map<string, number>()
    for (const item of (accessoriesResponse.data ?? []) as Array<{ operational_protocol_id: string }>) {
      accessoryCounts.set(
        item.operational_protocol_id,
        (accessoryCounts.get(item.operational_protocol_id) ?? 0) + 1
      )
    }

    return {
      success: true,
      error: null,
      data: {
        total: count ?? 0,
        page,
        pageSize,
        items: rows.map((row) => ({
          id: row.id,
          jobNumber: row.job_number,
          jobTitle: row.job_title,
          clientName: row.client_name,
          realizationStartAt: row.realization_start_at,
          realizationEndAt: row.realization_end_at,
          handoverPlace: row.handover_place,
          technicianName: row.technician_name,
          createdAt: row.created_at,
          createdByName: row.created_by ? profileNames.get(row.created_by) || null : null,
          pdfFileName: row.pdf_file_name,
          deviceCount: deviceCounts.get(row.id) ?? 0,
          accessoryCount: accessoryCounts.get(row.id) ?? 0,
        })),
      },
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'listOperationalProtocolsAction',
      section: 'faktury-operational-protocols',
      userId: user.id,
    })
    return failure('Uložené protokoly se nepodařilo načíst.')
  }
}

export async function getOperationalProtocolDetailAction(
  protocolId: string
): Promise<OperationalProtocolActionResult<OperationalProtocolDetail>> {
  const { supabase, user, error: accessError } = await requireOperationalProtocolAdmin()
  if (!user) return failure(accessError ?? 'Nemáš oprávnění.')

  const id = normalizeUuid(protocolId)
  if (!id) return failure('Neplatné ID protokolu.')

  try {
    const [protocolResponse, devicesResponse, accessoriesResponse] = await Promise.all([
      supabase
        .from('operational_protocols')
        .select(
          'id, job_number, job_title, realization_start_at, realization_end_at, handover_place, source_client_id, client_name, client_address, client_ico, client_contact_person, client_contact_phone, subtenant_choice, subtenant_name, subtenant_note, realization_at, realization_completed_at, technician_name, digitally_signed_at, finalized_at, created_at, created_by, copied_from_protocol_id, pdf_storage_path, pdf_file_name, pdf_size_bytes, pdf_sha256'
        )
        .eq('id', id)
        .eq('generation_status', 'final')
        .single(),
      supabase
        .from('operational_protocol_devices')
        .select('id, sort_order, device_name, mth_start, mth_end, fuel_start_percent, fuel_end_percent')
        .eq('operational_protocol_id', id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('operational_protocol_accessories')
        .select('id, sort_order, item_name')
        .eq('operational_protocol_id', id)
        .order('sort_order', { ascending: true }),
    ])

    if (protocolResponse.error || !protocolResponse.data) {
      return failure('Provozní protokol nebyl nalezen.')
    }
    if (devicesResponse.error || accessoriesResponse.error) {
      return failure('Položky provozního protokolu se nepodařilo načíst.')
    }

    const row = protocolResponse.data as ProtocolDetailRow
    const profileNames = await loadProfileNames(supabase, [row.created_by])

    return {
      success: true,
      error: null,
      data: {
        id: row.id,
        jobNumber: row.job_number,
        jobTitle: row.job_title,
        realizationStartAt: row.realization_start_at,
        realizationEndAt: row.realization_end_at,
        handoverPlace: row.handover_place,
        sourceClientId: row.source_client_id,
        clientName: row.client_name,
        clientAddress: row.client_address,
        clientIco: row.client_ico,
        clientContactPerson: row.client_contact_person,
        clientContactPhone: row.client_contact_phone,
        subtenantChoice: row.subtenant_choice,
        subtenantName: row.subtenant_name,
        subtenantNote: row.subtenant_note,
        realizationAt: row.realization_at,
        realizationCompletedAt: row.realization_completed_at,
        technicianName: row.technician_name,
        digitallySignedAt: row.digitally_signed_at,
        finalizedAt: row.finalized_at,
        createdAt: row.created_at,
        createdBy: row.created_by,
        createdByName: row.created_by ? profileNames.get(row.created_by) || null : null,
        copiedFromProtocolId: row.copied_from_protocol_id,
        pdfStoragePath: row.pdf_storage_path,
        pdfFileName: row.pdf_file_name,
        pdfSizeBytes: Number(row.pdf_size_bytes),
        pdfSha256: row.pdf_sha256,
        devices: ((devicesResponse.data ?? []) as DeviceRow[]).map((device) => ({
          id: device.id,
          sortOrder: device.sort_order,
          deviceName: device.device_name,
          mthStart: device.mth_start,
          mthEnd: device.mth_end,
          fuelStartPercent:
            device.fuel_start_percent === null ? null : Number(device.fuel_start_percent),
          fuelEndPercent:
            device.fuel_end_percent === null ? null : Number(device.fuel_end_percent),
        })),
        accessories: ((accessoriesResponse.data ?? []) as AccessoryRow[]).map((item) => ({
          id: item.id,
          sortOrder: item.sort_order,
          itemName: item.item_name,
        })),
      },
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'getOperationalProtocolDetailAction',
      section: 'faktury-operational-protocols',
      userId: user.id,
      context: { protocolId: id },
    })
    return failure('Protokol se nepodařilo načíst.')
  }
}

export async function getOperationalProtocolPdfUrlAction(
  protocolId: string,
  download = false
): Promise<OperationalProtocolActionResult<{ signedUrl: string }>> {
  const { supabase, user, error: accessError } = await requireOperationalProtocolAdmin()
  if (!user) return failure(accessError ?? 'Nemáš oprávnění.')

  const id = normalizeUuid(protocolId)
  if (!id) return failure('Neplatné ID protokolu.')

  const { data: row, error } = await supabase
    .from('operational_protocols')
    .select('pdf_storage_path, pdf_file_name')
    .eq('id', id)
    .eq('generation_status', 'final')
    .single()

  if (error || !row) return failure('PDF provozního protokolu nebylo nalezeno.')

  const typedRow = row as { pdf_storage_path: string; pdf_file_name: string }
  const { data, error: signedUrlError } = await supabase.storage
    .from(OPERATIONAL_PROTOCOLS_BUCKET)
    .createSignedUrl(typedRow.pdf_storage_path, 60 * 10, {
      download: download ? typedRow.pdf_file_name : undefined,
    })

  if (signedUrlError || !data?.signedUrl) {
    return failure('Odkaz na PDF se nepodařilo vytvořit.')
  }

  return { success: true, error: null, data: { signedUrl: data.signedUrl } }
}

export async function deleteOperationalProtocolAction(
  protocolId: string
): Promise<OperationalProtocolActionResult<{ deletedId: string }>> {
  const { supabase, user, error: accessError } = await requireOperationalProtocolAdmin()
  if (!user) return failure(accessError ?? 'Nemáš oprávnění.')

  const id = normalizeUuid(protocolId)
  if (!id) return failure('Neplatné ID protokolu.')

  try {
    const { data: row, error: loadError } = await supabase
      .from('operational_protocols')
      .select('pdf_storage_path')
      .eq('id', id)
      .eq('generation_status', 'final')
      .single()

    if (loadError || !row) return failure('Provozní protokol nebyl nalezen.')

    const storagePath = String((row as { pdf_storage_path: string }).pdf_storage_path)
    const { error: deleteError } = await supabase
      .from('operational_protocols')
      .delete()
      .eq('id', id)

    if (deleteError) return failure('Provozní protokol se nepodařilo smazat.')

    const { error: storageError } = await supabase.storage
      .from(OPERATIONAL_PROTOCOLS_BUCKET)
      .remove([storagePath])

    revalidatePath('/faktury')

    if (storageError) {
      await reportActionError({
        error: storageError,
        action: 'deleteOperationalProtocolAction.storageCleanup',
        section: 'faktury-operational-protocols',
        userId: user.id,
        context: { protocolId: id, storagePath },
      })
      return {
        success: true,
        error: null,
        data: { deletedId: id },
        warning: 'Protokol byl odstraněn, ale soubor ve storage čeká na technické dočištění.',
      }
    }

    return { success: true, error: null, data: { deletedId: id } }
  } catch (error) {
    await reportActionError({
      error,
      action: 'deleteOperationalProtocolAction',
      section: 'faktury-operational-protocols',
      userId: user.id,
      context: { protocolId: id },
    })
    return failure('Protokol se nepodařilo smazat.')
  }
}
