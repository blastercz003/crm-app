'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canViewAssetsSection } from '@/lib/majetek/access'
import {
  calculateAdvancePaymentsForPeriod,
  formatSettlementCode,
  normalizeMonthStart,
  type RentalServiceAdvanceHistoryRow,
} from '@/lib/majetek/rental-settlements'

const ASSET_FILES_BUCKET = 'asset-files'
const MAX_UPLOAD_FILE_SIZE_BYTES = 25 * 1024 * 1024

export type UpsertAssetRentalServiceSettlementActionState = {
  success: boolean
  error: string | null
  settlementId?: string
  assetId?: string
  rentalId?: string
  settlementCode?: string
}

export type DeleteAssetRentalServiceSettlementActionState = {
  success: boolean
  error: string | null
  settlementId?: string
  assetId?: string
  rentalId?: string
}

export type UploadAssetRentalServiceSettlementFilesActionState = {
  success: boolean
  error: string | null
  uploadedCount?: number
  settlementId?: string
  assetId?: string
  rentalId?: string
}

export type DeleteAssetRentalServiceSettlementFileActionState = {
  success: boolean
  error: string | null
  fileId?: string
  settlementId?: string
  assetId?: string
  rentalId?: string
}

type ProfilePermissionRow = {
  role: string | null
  majetek: boolean | null
}

type AssetRow = {
  id: string
  category_id: string
}

type RentalRow = {
  id: string
  asset_id: string
  tenant_name: string | null
  tenant_contact: string | null
}

type SettlementFileStorageRow = {
  id: string
  settlement_id: string
  storage_bucket: string
  storage_path: string
}

type SettlementLifecycleRow = {
  id: string
  asset_id: string
  rental_id: string
  status: 'draft' | 'closed'
  settled_on: string | null
  settled_by: string | null
  settled_note: string | null
}

function buildCreateFailure(error: string): UpsertAssetRentalServiceSettlementActionState {
  return { success: false, error }
}

function buildCreateSuccess(params: {
  settlementId: string
  assetId: string
  rentalId: string
  settlementCode: string
}): UpsertAssetRentalServiceSettlementActionState {
  return {
    success: true,
    error: null,
    settlementId: params.settlementId,
    assetId: params.assetId,
    rentalId: params.rentalId,
    settlementCode: params.settlementCode,
  }
}

function buildDeleteSettlementFailure(error: string): DeleteAssetRentalServiceSettlementActionState {
  return { success: false, error }
}

function buildDeleteSettlementSuccess(params: {
  settlementId: string
  assetId: string
  rentalId: string
}): DeleteAssetRentalServiceSettlementActionState {
  return {
    success: true,
    error: null,
    settlementId: params.settlementId,
    assetId: params.assetId,
    rentalId: params.rentalId,
  }
}

function buildUploadFailure(error: string): UploadAssetRentalServiceSettlementFilesActionState {
  return { success: false, error }
}

function buildUploadSuccess(params: {
  uploadedCount: number
  settlementId: string
  assetId: string
  rentalId: string
}): UploadAssetRentalServiceSettlementFilesActionState {
  return {
    success: true,
    error: null,
    uploadedCount: params.uploadedCount,
    settlementId: params.settlementId,
    assetId: params.assetId,
    rentalId: params.rentalId,
  }
}

function buildDeleteFileFailure(error: string): DeleteAssetRentalServiceSettlementFileActionState {
  return { success: false, error }
}

function buildDeleteFileSuccess(params: {
  fileId: string
  settlementId: string
  assetId: string
  rentalId: string
}): DeleteAssetRentalServiceSettlementFileActionState {
  return {
    success: true,
    error: null,
    fileId: params.fileId,
    settlementId: params.settlementId,
    assetId: params.assetId,
    rentalId: params.rentalId,
  }
}

function formatSettlementSaveError(error: { code?: string; message?: string; details?: string; hint?: string } | null) {
  if (!error) {
    return 'Vyúčtování se nepodařilo uložit.'
  }

  const message = error.message?.trim() || 'Neznámá chyba.'
  const details = [error.details?.trim(), error.hint?.trim()]
    .filter((value): value is string => Boolean(value))
    .filter((value) => value !== message)

  const suffix = details.length > 0 ? ` (${details.join(' | ')})` : ''
  return `Vyúčtování se nepodařilo uložit: ${message}${suffix}`
}

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeOptionalText(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  return text.length > 0 ? text : null
}

function normalizeWholeCurrency(value: FormDataEntryValue | null) {
  const text = normalizeText(value).replaceAll(/\s+/g, '').replace(',', '.')

  if (!text) return 0

  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return 0

  return Math.max(0, Math.round(parsed))
}

function normalizeOptionalWholeCurrency(value: FormDataEntryValue | null) {
  const text = normalizeText(value).replaceAll(/\s+/g, '').replace(',', '.')

  if (!text) return null

  const parsed = Number(text)
  if (!Number.isFinite(parsed)) return null

  return Math.max(0, Math.round(parsed))
}

function sanitizeFileName(fileName: string) {
  const normalized = fileName
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')

  return normalized
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 120)
}

function stripFileExtension(fileName: string) {
  const trimmed = fileName.trim()
  return trimmed.replace(/\.[^.]+$/, '')
}

async function requireAssetsAdmin() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, majetek')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return { supabase, error: 'Nepodařilo se ověřit oprávnění uživatele.' as const }
  }

  const typedProfile = profile as ProfilePermissionRow
  if (!canViewAssetsSection(typedProfile.role, typedProfile)) {
    return { supabase, error: 'Nemáš oprávnění spravovat majetek.' as const }
  }

  return { supabase, userId: user.id, error: null }
}

async function requireAsset(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assetId: string,
) {
  const { data, error } = await supabase
    .from('assets')
    .select('id, category_id')
    .eq('id', assetId)
    .maybeSingle<AssetRow>()

  if (error) {
    throw new Error('Nepodařilo se ověřit majetek.')
  }

  if (!data) {
    throw new Error('Vybraný majetek neexistuje.')
  }

  return data
}

async function requireRental(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rentalId: string,
) {
  const { data, error } = await supabase
    .from('asset_rentals')
    .select('id, asset_id, tenant_name, tenant_contact')
    .eq('id', rentalId)
    .maybeSingle<RentalRow>()

  if (error) {
    throw new Error('Nepodařilo se ověřit pronájem.')
  }

  if (!data) {
    throw new Error('Vybraný pronájem neexistuje.')
  }

  return data
}

async function requireSettlement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  settlementId: string,
) {
  const { data, error } = await supabase
    .from('asset_rental_service_settlements')
    .select('id, asset_id, rental_id, status, settled_on, settled_by, settled_note')
    .eq('id', settlementId)
    .maybeSingle<SettlementLifecycleRow>()

  if (error) {
    throw new Error('Nepodařilo se ověřit vyúčtování.')
  }

  if (!data) {
    throw new Error('Vybrané vyúčtování neexistuje.')
  }

  return data
}

function getPragueDateISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10)
  }

  return `${year}-${month}-${day}`
}

function buildStoragePath(params: {
  assetId: string
  settlementId: string
  fileName: string
}) {
  const safeName = sanitizeFileName(params.fileName) || 'soubor'
  return `majetek/${params.assetId}/vyuctovani/${params.settlementId}/${crypto.randomUUID()}-${safeName}`
}

export async function upsertAssetRentalServiceSettlementAction(
  _prevState: UpsertAssetRentalServiceSettlementActionState,
  formData: FormData
): Promise<UpsertAssetRentalServiceSettlementActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildCreateFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildCreateFailure('Chybí ID majetku.')

  const rentalId = normalizeText(formData.get('rental_id'))
  if (!rentalId) return buildCreateFailure('Chybí ID pronájmu.')

  const periodFrom = normalizeMonthStart(normalizeText(formData.get('period_from')))
  const periodTo = normalizeMonthStart(normalizeText(formData.get('period_to')))

  if (!periodFrom || !periodTo) {
    return buildCreateFailure('Zadej měsíční rozsah vyúčtování.')
  }

  if (periodFrom > periodTo) {
    return buildCreateFailure('Počáteční měsíc nemůže být po koncovém měsíci.')
  }

  const status = normalizeText(formData.get('status')) === 'closed' ? 'closed' : 'draft'
  const note = normalizeOptionalText(formData.get('note'))
  const settlementId = normalizeOptionalText(formData.get('settlement_id'))

  const electricityAmount = normalizeWholeCurrency(formData.get('electricity_amount'))
  const hotWaterHeatingAmount = normalizeWholeCurrency(formData.get('hot_water_heating_amount'))
  const spaceHeatingAmount = normalizeWholeCurrency(formData.get('space_heating_amount'))
  const commonAreaCleaningAmount = normalizeWholeCurrency(formData.get('common_area_cleaning_amount'))
  const coldWaterSewerAmount = normalizeWholeCurrency(formData.get('cold_water_sewer_amount'))
  const hotWaterSewerAmount = normalizeWholeCurrency(formData.get('hot_water_sewer_amount'))
  const customItemTitles = formData.getAll('custom_item_title').map(normalizeText)
  const customItemAmounts = formData.getAll('custom_item_amount').map(normalizeOptionalWholeCurrency)

  let asset: AssetRow
  let rental: RentalRow
  try {
    asset = await requireAsset(auth.supabase, assetId)
    rental = await requireRental(auth.supabase, rentalId)
  } catch (error) {
    return buildCreateFailure(error instanceof Error ? error.message : 'Pronájem není dostupný.')
  }

  if (rental.asset_id !== asset.id) {
    return buildCreateFailure('Vybraný pronájem nepatří k tomuto majetku.')
  }

  const { data: historyRows, error: historyError } = await auth.supabase
    .from('asset_rental_service_advance_history')
    .select('id, rental_id, effective_from, monthly_advance, note, created_at, updated_at')
    .eq('rental_id', rentalId)
    .order('effective_from', { ascending: true })
    .order('created_at', { ascending: true })

  if (historyError) {
    return buildCreateFailure(`Nepodařilo se načíst historii záloh: ${historyError.message}`)
  }

  const history = (historyRows ?? []) as RentalServiceAdvanceHistoryRow[]
  const settlementCode = formatSettlementCode(periodFrom, periodTo)

  if (!settlementCode) {
    return buildCreateFailure('Nepodařilo se sestavit kód vyúčtování.')
  }

  const normalizedCustomItems: { title: string; amount: number; sort_order: number }[] = []

  for (let index = 0; index < customItemTitles.length; index += 1) {
    const title = customItemTitles[index]
    const amount = customItemAmounts[index] ?? null

    if (!title && amount === null) {
      continue
    }

    if (!title || amount === null) {
      return buildCreateFailure('U vlastní položky vyplň název i částku.')
    }

    normalizedCustomItems.push({
      title,
      amount,
      sort_order: index,
    })
  }

  const { totalAdvance } = calculateAdvancePaymentsForPeriod({
    history,
    periodFrom,
    periodTo,
  })

  const serviceTotalAmount =
    electricityAmount +
    hotWaterHeatingAmount +
    spaceHeatingAmount +
    commonAreaCleaningAmount +
    coldWaterSewerAmount +
    hotWaterSewerAmount +
    normalizedCustomItems.reduce((sum, item) => sum + item.amount, 0)

  const balanceAmount = totalAdvance - serviceTotalAmount

  const existingSettlement = settlementId
    ? await requireSettlement(auth.supabase, settlementId)
    : null

  if (existingSettlement && existingSettlement.asset_id !== asset.id) {
    return buildCreateFailure('Vyúčtování nepatří k tomuto majetku.')
  }

  if (existingSettlement && existingSettlement.rental_id !== rental.id) {
    return buildCreateFailure('Vyúčtování nepatří k tomuto pronájmu.')
  }

  const existingClosedAt = settlementId && existingSettlement?.status === 'closed'
    ? await auth.supabase
        .from('asset_rental_service_settlements')
        .select('closed_at, closed_by')
        .eq('id', settlementId)
        .maybeSingle<{ closed_at: string | null; closed_by: string | null }>()
    : null

  if (existingClosedAt?.error) {
    return buildCreateFailure('Nepodařilo se načíst stav vyúčtování.')
  }

  const closedAt =
    status === 'closed'
      ? existingClosedAt?.data?.closed_at ?? new Date().toISOString()
      : null
  const closedBy =
    status === 'closed'
      ? existingClosedAt?.data?.closed_by ?? auth.userId
      : null

  const { data, error } = await auth.supabase.rpc('upsert_asset_rental_service_settlement_with_custom_items', {
    p_settlement_id: settlementId || null,
    p_asset_id: asset.id,
    p_rental_id: rental.id,
    p_settlement_code: settlementCode,
    p_period_from: periodFrom,
    p_period_to: periodTo,
    p_tenant_name_snapshot: rental.tenant_name ?? '—',
    p_tenant_contact_snapshot: rental.tenant_contact,
    p_status: status,
    p_electricity_amount: electricityAmount,
    p_hot_water_heating_amount: hotWaterHeatingAmount,
    p_space_heating_amount: spaceHeatingAmount,
    p_common_area_cleaning_amount: commonAreaCleaningAmount,
    p_cold_water_sewer_amount: coldWaterSewerAmount,
    p_hot_water_sewer_amount: hotWaterSewerAmount,
    p_advance_payments_total_amount: totalAdvance,
    p_service_total_amount: serviceTotalAmount,
    p_balance_amount: balanceAmount,
    p_note: note,
    p_closed_at: closedAt,
    p_closed_by: closedBy,
    p_created_by: auth.userId,
    p_custom_items: normalizedCustomItems,
  }).single<{ settlement_id: string; settlement_code: string }>()

  if (error || !data) {
    const message = error?.code === '23505' || error?.message?.toLowerCase().includes('duplicate')
      ? 'Pro tento pronájem a období už vyúčtování existuje.'
      : formatSettlementSaveError(error)
    return buildCreateFailure(message)
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${asset.id}`)

  return buildCreateSuccess({
    settlementId: data.settlement_id,
    assetId: asset.id,
    rentalId: rental.id,
    settlementCode: data.settlement_code,
  })
}

export type UpdateAssetRentalServiceSettlementReconciliationActionState = {
  success: boolean
  error: string | null
  settlementId?: string
  assetId?: string
  rentalId?: string
}

function buildUpdateReconciliationFailure(
  error: string,
): UpdateAssetRentalServiceSettlementReconciliationActionState {
  return { success: false, error }
}

function buildUpdateReconciliationSuccess(params: {
  settlementId: string
  assetId: string
  rentalId: string
}): UpdateAssetRentalServiceSettlementReconciliationActionState {
  return {
    success: true,
    error: null,
    settlementId: params.settlementId,
    assetId: params.assetId,
    rentalId: params.rentalId,
  }
}

export async function updateAssetRentalServiceSettlementReconciliationAction(
  _prevState: UpdateAssetRentalServiceSettlementReconciliationActionState,
  formData: FormData,
): Promise<UpdateAssetRentalServiceSettlementReconciliationActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildUpdateReconciliationFailure(auth.error)

  const settlementId = normalizeText(formData.get('settlement_id'))
  if (!settlementId) return buildUpdateReconciliationFailure('Chybí ID vyúčtování.')

  const isSettled = normalizeText(formData.get('is_settled')) === 'on'
  const settledNote = normalizeOptionalText(formData.get('settled_note'))

  let settlement: SettlementLifecycleRow
  try {
    settlement = await requireSettlement(auth.supabase, settlementId)
  } catch (error) {
    return buildUpdateReconciliationFailure(error instanceof Error ? error.message : 'Vyúčtování není dostupné.')
  }

  const settledOn = isSettled ? settlement.settled_on ?? getPragueDateISO() : null
  const settledBy = isSettled ? settlement.settled_by ?? auth.userId : null

  const { error } = await auth.supabase
    .from('asset_rental_service_settlements')
    .update({
      settled_on: settledOn,
      settled_by: settledBy,
      settled_note: isSettled ? settledNote : null,
    })
    .eq('id', settlement.id)
    .eq('asset_id', settlement.asset_id)
    .eq('rental_id', settlement.rental_id)

  if (error) {
    return buildUpdateReconciliationFailure('Vypořádání se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${settlement.asset_id}`)
  revalidatePath(`/majetek/${settlement.asset_id}/vyuctovani/${settlement.id}`)

  return buildUpdateReconciliationSuccess({
    settlementId: settlement.id,
    assetId: settlement.asset_id,
    rentalId: settlement.rental_id,
  })
}

export async function deleteAssetRentalServiceSettlementAction(
  _prevState: DeleteAssetRentalServiceSettlementActionState,
  formData: FormData
): Promise<DeleteAssetRentalServiceSettlementActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildDeleteSettlementFailure(auth.error)

  const settlementId = normalizeText(formData.get('settlement_id'))
  if (!settlementId) return buildDeleteSettlementFailure('Chybí ID vyúčtování.')

  let settlement: { id: string; asset_id: string; rental_id: string }
  try {
    settlement = await requireSettlement(auth.supabase, settlementId)
  } catch (error) {
    return buildDeleteSettlementFailure(error instanceof Error ? error.message : 'Vyúčtování není dostupné.')
  }

  const { data: files, error: filesError } = await auth.supabase
    .from('asset_rental_service_settlement_files')
    .select('id, settlement_id, storage_bucket, storage_path')
    .eq('settlement_id', settlementId)

  if (filesError) {
    return buildDeleteSettlementFailure('Nepodařilo se načíst přílohy vyúčtování.')
  }

  const typedFiles = (files ?? []) as SettlementFileStorageRow[]
  if (typedFiles.length > 0) {
    await auth.supabase.storage
      .from(ASSET_FILES_BUCKET)
      .remove(typedFiles.map((file) => file.storage_path))
  }

  const { error } = await auth.supabase
    .from('asset_rental_service_settlements')
    .delete()
    .eq('id', settlement.id)
    .eq('asset_id', settlement.asset_id)
    .eq('rental_id', settlement.rental_id)

  if (error) {
    return buildDeleteSettlementFailure('Vyúčtování se nepodařilo smazat.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${settlement.asset_id}`)

  return buildDeleteSettlementSuccess({
    settlementId: settlement.id,
    assetId: settlement.asset_id,
    rentalId: settlement.rental_id,
  })
}

export async function uploadAssetRentalServiceSettlementFilesAction(
  _prevState: UploadAssetRentalServiceSettlementFilesActionState,
  formData: FormData
): Promise<UploadAssetRentalServiceSettlementFilesActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildUploadFailure(auth.error)

  const settlementId = normalizeText(formData.get('settlement_id'))
  if (!settlementId) return buildUploadFailure('Chybí ID vyúčtování.')

  const files = formData.getAll('files').filter((file): file is File => file instanceof File)
  if (files.length === 0) {
    return buildUploadFailure('Vyber alespoň jeden soubor.')
  }

  let settlement: { id: string; asset_id: string; rental_id: string }
  try {
    settlement = await requireSettlement(auth.supabase, settlementId)
  } catch (error) {
    return buildUploadFailure(error instanceof Error ? error.message : 'Vyúčtování není dostupné.')
  }

  const uploadRows: Array<{ id: string; storage_path: string }> = []
  const uploadedPaths: string[] = []

  try {
    for (const file of files) {
      const mimeType = String(file.type ?? '').trim().toLowerCase()
      const isAllowed =
        mimeType === 'application/pdf' ||
        mimeType.startsWith('image/') ||
        file.name.toLowerCase().endsWith('.pdf') ||
        /\.(png|jpe?g|webp)$/i.test(file.name)

      if (!isAllowed) {
        throw new Error(`Soubor "${file.name}" musí být PDF nebo obrázek.`)
      }

      if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
        throw new Error(`Soubor "${file.name}" je příliš velký.`)
      }

      const storagePath = buildStoragePath({
        assetId: settlement.asset_id,
        settlementId,
        fileName: file.name,
      })

      const buffer = Buffer.from(await file.arrayBuffer())
      const contentType = mimeType || 'application/pdf'

      const { error: uploadError } = await auth.supabase.storage
        .from(ASSET_FILES_BUCKET)
        .upload(storagePath, buffer, {
          cacheControl: '3600',
          upsert: false,
          contentType,
        })

      if (uploadError) {
        throw new Error(`Soubor "${file.name}" se nepodařilo nahrát (${uploadError.message}).`)
      }

      uploadedPaths.push(storagePath)

      const { data: inserted, error: insertError } = await auth.supabase
        .from('asset_rental_service_settlement_files')
        .insert({
          settlement_id: settlementId,
          title: stripFileExtension(file.name) || file.name,
          file_name: file.name,
          storage_bucket: ASSET_FILES_BUCKET,
          storage_path: storagePath,
          mime_type: contentType,
          file_size_bytes: file.size,
          uploaded_by: auth.userId,
        })
        .select('id, storage_path')
        .single<{ id: string; storage_path: string }>()

      if (insertError || !inserted) {
        throw new Error(`Metadata souboru "${file.name}" se nepodařilo uložit.`)
      }

      uploadRows.push({ id: inserted.id, storage_path: inserted.storage_path })
    }
  } catch (uploadError) {
    if (uploadedPaths.length > 0) {
      await auth.supabase.storage.from(ASSET_FILES_BUCKET).remove(uploadedPaths)
    }

    if (uploadRows.length > 0) {
      await auth.supabase
        .from('asset_rental_service_settlement_files')
        .delete()
        .in('id', uploadRows.map((row) => row.id))
    }

    return buildUploadFailure(uploadError instanceof Error ? uploadError.message : 'Soubory se nepodařilo nahrát.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${settlement.asset_id}`)

  return buildUploadSuccess({
    uploadedCount: files.length,
    settlementId,
    assetId: settlement.asset_id,
    rentalId: settlement.rental_id,
  })
}

export async function deleteAssetRentalServiceSettlementFileAction(
  _prevState: DeleteAssetRentalServiceSettlementFileActionState,
  formData: FormData
): Promise<DeleteAssetRentalServiceSettlementFileActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildDeleteFileFailure(auth.error)

  const settlementId = normalizeText(formData.get('settlement_id'))
  if (!settlementId) return buildDeleteFileFailure('Chybí ID vyúčtování.')

  const fileId = normalizeText(formData.get('file_id'))
  if (!fileId) return buildDeleteFileFailure('Chybí ID souboru.')

  let settlement: { id: string; asset_id: string; rental_id: string }
  try {
    settlement = await requireSettlement(auth.supabase, settlementId)
  } catch (error) {
    return buildDeleteFileFailure(error instanceof Error ? error.message : 'Vyúčtování není dostupné.')
  }

  const { data: fileRow, error: rowError } = await auth.supabase
    .from('asset_rental_service_settlement_files')
    .select('id, settlement_id, storage_bucket, storage_path')
    .eq('id', fileId)
    .eq('settlement_id', settlementId)
    .maybeSingle<SettlementFileStorageRow>()

  if (rowError || !fileRow) {
    return buildDeleteFileFailure('Soubor nebyl nalezen.')
  }

  const { error: storageError } = await auth.supabase.storage
    .from(fileRow.storage_bucket)
    .remove([fileRow.storage_path])

  if (storageError) {
    return buildDeleteFileFailure('Soubor se nepodařilo smazat ze storage.')
  }

  const { error } = await auth.supabase
    .from('asset_rental_service_settlement_files')
    .delete()
    .eq('id', fileRow.id)

  if (error) {
    return buildDeleteFileFailure('Metadata souboru se nepodařilo smazat.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${settlement.asset_id}`)

  return buildDeleteFileSuccess({
    fileId: fileRow.id,
    settlementId,
    assetId: settlement.asset_id,
    rentalId: settlement.rental_id,
  })
}
