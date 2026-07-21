'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { reportActionError } from '@/lib/errors/reportActionError'
import { syncProvizeRecordFromJobFinance } from '@/lib/provize/service'
import {
  cancelJobCalendarItem,
  syncJobCalendarItem,
  type JobCalendarJobRow,
} from '@/lib/jobs/calendar-feed'
import {
  cancelJobGoogleCalendarItem,
  syncJobGoogleCalendarItem,
} from '@/lib/jobs/google-calendar'
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  buildAttachmentStoragePath,
  JOB_ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_FILE_SIZE_BYTES,
  isJobAttachmentCategory,
  mapJobAttachmentRow,
  type JobAttachment,
  type JobAttachmentRow,
} from '@/lib/job-attachments'

export type UpdateFinanceInlineFieldActionState = {
  success: boolean
  error: string | null
}

export type FinanceCostItem = {
  id: string
  label: string
  supplier: string | null
  technicianId: string | null
  presetKey: string | null
  sortOrder: number
  unitPrice: number
  quantity: number
  lineTotal: number
}

export type FinanceCostItemInput = {
  label: string
  supplier?: string | null
  technicianId?: string | null
  presetKey?: string | null
  sortOrder: number
  unitPrice: number
  quantity: number
}

export type LoadFinanceCostItemsActionState = {
  success: boolean
  error: string | null
  items: FinanceCostItem[]
}

export type SaveFinanceCostItemsActionState = {
  success: boolean
  error: string | null
  totalCost: number | null
}

export type DeleteFinanceCostItemsActionState = {
  success: boolean
  error: string | null
}

export type LoadJobAttachmentsActionState = {
  success: boolean
  error: string | null
  items: JobAttachment[]
  offerOrderFiles: OfferOrderAttachment[]
  offerOrderReference: string | null
  hasLinkedOffer: boolean
}

export type UploadJobAttachmentsActionState = {
  success: boolean
  error: string | null
  uploadedCount: number
}

export type RenameJobAttachmentActionState = {
  success: boolean
  error: string | null
}

export type UpdateJobAttachmentNoteActionState = {
  success: boolean
  error: string | null
}

export type DeleteJobAttachmentActionState = {
  success: boolean
  error: string | null
}

export type OpenJobAttachmentActionState =
  | {
      success: true
      error: null
      signedUrl: string
    }
  | {
      success: false
      error: string
      signedUrl: null
    }

export type DownloadJobAttachmentActionState =
  | {
      success: true
      error: null
      signedUrl: string
    }
  | {
      success: false
      error: string
      signedUrl: null
    }

export type OpenOfferOrderAttachmentActionState =
  | {
      success: true
      error: null
      signedUrl: string
    }
  | {
      success: false
      error: string
      signedUrl: null
    }

export type DownloadOfferOrderAttachmentActionState =
  | {
      success: true
      error: null
      signedUrl: string
    }
  | {
      success: false
      error: string
      signedUrl: null
    }

type ProfileRoleRow = {
  role: string | null
}

const FINANCE_EDITABLE_FIELDS = [
  'client_order_number',
  'invoice_number',
  'sale_amount',
] as const

type FinanceEditableField = (typeof FINANCE_EDITABLE_FIELDS)[number]

type NormalizeDecimalResult =
  | {
      success: true
      value: number | null
      error: null
    }
  | {
      success: false
      value: null
      error: string
    }

type JobFinanceAccessRow = {
  id: string
  job_id: string
}

type AssignedTechnicianRow = {
  technician_id: string
}

type JobFinanceCostItemRow = {
  id: string
  label: string
  supplier: string | null
  technician_id: string | null
  preset_key: string | null
  sort_order: number | null
  unit_price: number | string | null
  quantity: number | string | null
  line_total: number | null
}

type JobAttachmentAccessRow = {
  id: string
  offer_id: string | null
}

type OfferOrderAttachmentRow = {
  id: string
  offer_id: string
  file_name: string
  storage_path: string
  mime_type: string
  file_size_bytes: number
  created_at: string
}

export type OfferOrderAttachment = {
  id: string
  offerId: string
  fileName: string
  mimeType: string
  fileSizeBytes: number
  createdAt: string
}

const OFFER_ORDER_ATTACHMENTS_BUCKET = 'offer-orders'

function isMissingSupplierColumnError(error: {
  message?: string | null
  details?: string | null
  hint?: string | null
  code?: string | null
} | null | undefined) {
  const haystack = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes('supplier')
}

function isFinanceEditableField(value: string): value is FinanceEditableField {
  return FINANCE_EDITABLE_FIELDS.includes(value as FinanceEditableField)
}

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function normalizeDecimal(value: FormDataEntryValue | null): NormalizeDecimalResult {
  const text = String(value ?? '').trim()

  if (!text) {
    return {
      success: true,
      value: null,
      error: null,
    }
  }

  const normalized = text.replace(/\s+/g, '').replace(',', '.')

  if (!/^-?\d+$/.test(normalized)) {
    return {
      success: false,
      value: null,
      error: 'Zadej celé číslo ve správném formátu.',
    }
  }

  const parsed = Number(normalized)

  if (!Number.isFinite(parsed)) {
    return {
      success: false,
      value: null,
      error: 'Zadej platnou číselnou hodnotu.',
    }
  }

  return {
    success: true,
    value: parsed,
    error: null,
  }
}

function normalizeOptionalPresetKey(value: unknown) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function normalizeFiniteNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.')

    if (!normalized) {
      return null
    }

    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function mapFinanceCostItemRow(row: JobFinanceCostItemRow): FinanceCostItem {
  return {
    id: String(row.id),
    label: String(row.label ?? '').trim(),
    supplier: normalizeOptionalPresetKey(row.supplier),
    technicianId: normalizeOptionalPresetKey(row.technician_id),
    presetKey: normalizeOptionalPresetKey(row.preset_key),
    sortOrder:
      typeof row.sort_order === 'number' && row.sort_order >= 0
        ? row.sort_order
        : 0,
    unitPrice: normalizeFiniteNumber(row.unit_price) ?? 0,
    quantity: normalizeFiniteNumber(row.quantity) ?? 0,
    lineTotal:
      typeof row.line_total === 'number' && Number.isFinite(row.line_total)
        ? row.line_total
        : 0,
  }
}

async function getAssignedTechnicianIdsForJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('job_technicians')
    .select('technician_id')
    .eq('job_id', jobId)

  if (error) {
    throw new Error(
      `Nepodařilo se načíst přiřazené techniky k zakázce: ${error.message}`
    )
  }

  return Array.from(
    new Set(
      ((data ?? []) as AssignedTechnicianRow[])
        .map((row) => String(row.technician_id ?? '').trim())
        .filter((technicianId) => Boolean(technicianId))
    )
  )
}

async function syncJobGoogleCalendarForTechniciansSafely(params: {
  jobId: string
  technicianIds: string[]
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  if (params.technicianIds.length === 0) {
    return
  }

  const supabase = await createClient()
  const job = await getJobCalendarSnapshot(supabase, params.jobId)

  await Promise.all(
    params.technicianIds.map((technicianId) =>
      syncJobGoogleCalendarItem({
        jobId: params.jobId,
        userId: technicianId,
        job,
      }).catch(async (error) => {
        try {
          await reportActionError({
            error,
            action: params.action,
            section: 'faktury',
            errorType: params.errorType,
            userId: params.userIdForErrorLog ?? technicianId,
          })
        } catch (reportError) {
          console.error('Google kalendářová synchronizace z faktur selhala.', reportError)
        }
      })
    )
  )
}

async function cancelJobGoogleCalendarForTechniciansSafely(params: {
  jobId: string
  technicianIds: string[]
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  if (params.technicianIds.length === 0) {
    return
  }

  await Promise.all(
    params.technicianIds.map((technicianId) =>
      cancelJobGoogleCalendarItem({
        jobId: params.jobId,
        userId: technicianId,
      }).catch(async (error) => {
        try {
          await reportActionError({
            error,
            action: params.action,
            section: 'faktury',
            errorType: params.errorType,
            userId: params.userIdForErrorLog ?? technicianId,
          })
        } catch (reportError) {
          console.error('Google kalendářové zrušení z faktur selhalo.', reportError)
        }
      })
    )
  )
}

async function getJobCalendarSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('jobs')
    .select(
      `
        id,
        job_number,
        company_name,
        contact_person,
        start_at,
        end_at,
        site_address,
        store_number,
        technician_name,
        generator_name,
        info_note,
        job_status,
        invoice_status,
        evidence_status
      `
    )
    .eq('id', jobId)
    .single()

  if (error || !data) {
    throw new Error(
      `Nepodařilo se načíst zakázku pro kalendář: ${error?.message ?? 'Neznámá chyba'}`
    )
  }

  return data as JobCalendarJobRow
}

async function syncJobCalendarForTechniciansSafely(params: {
  jobId: string
  technicianIds: string[]
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  if (params.technicianIds.length === 0) {
    return
  }

  const supabase = await createClient()
  const job = await getJobCalendarSnapshot(supabase, params.jobId)

  await Promise.all(
    params.technicianIds.map((technicianId) =>
      syncJobCalendarItem({
        jobId: params.jobId,
        userId: technicianId,
        job,
      })
    )
  ).catch(async (error) => {
    await reportActionError({
      error,
      action: params.action,
      section: 'faktury',
      errorType: params.errorType,
      userId: params.userIdForErrorLog ?? null,
      context: { jobId: params.jobId },
    })
  })
}

async function cancelJobCalendarForTechniciansSafely(params: {
  jobId: string
  technicianIds: string[]
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  if (params.technicianIds.length === 0) {
    return
  }

  await Promise.all(
    params.technicianIds.map((technicianId) =>
      cancelJobCalendarItem({
        jobId: params.jobId,
        userId: technicianId,
      })
    )
  ).catch(async (error) => {
    await reportActionError({
      error,
      action: params.action,
      section: 'faktury',
      errorType: params.errorType,
      userId: params.userIdForErrorLog ?? null,
      context: { jobId: params.jobId },
    })
  })
}

async function requireAuthenticatedUser() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error: 'Nejsi přihlášený.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

async function requireFinanceAdminAccess() {
  const { supabase, user, error } = await requireAuthenticatedUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error,
    }
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

  const typedProfile = profile as ProfileRoleRow | null

  if (typedProfile?.role !== 'admin') {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění pro práci s fakturací.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

async function getJobAttachmentAccessRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, offer_id')
    .eq('id', jobId)
    .single()

  if (error || !data) {
    return {
      success: false as const,
      error: 'Zakázka neexistuje nebo se ji nepodařilo načíst.',
      jobRow: null,
    }
  }

  return {
    success: true as const,
    error: null,
    jobRow: data as JobAttachmentAccessRow,
  }
}

function mapOfferOrderAttachmentRow(row: OfferOrderAttachmentRow): OfferOrderAttachment {
  return {
    id: String(row.id),
    offerId: String(row.offer_id),
    fileName: String(row.file_name ?? ''),
    mimeType: String(row.mime_type ?? ''),
    fileSizeBytes: Number(row.file_size_bytes) || 0,
    createdAt: String(row.created_at ?? ''),
  }
}

function revalidateFinancePaths(jobId?: string | null) {
  revalidatePath('/faktury')
  revalidatePath('/zakazky-techniku')
  revalidatePath('/provize')
  revalidatePath('/dashboard')

  if (jobId) {
    revalidatePath(`/jobs/${jobId}`)
  }

  revalidatePath('/jobs')
}

async function getFinanceAccessRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  financeId: string
) {
  const { data: financeRow, error } = await supabase
    .from('job_finances')
    .select('id, job_id')
    .eq('id', financeId)
    .single()

  if (error || !financeRow) {
    return {
      success: false as const,
      error: 'Nepodařilo se načíst finanční záznam.',
      financeRow: null,
    }
  }

  return {
    success: true as const,
    error: null,
    financeRow: financeRow as JobFinanceAccessRow,
  }
}

async function syncProvizeAfterFinanceChange(params: {
  action: string
  userId: string
  financeId: string
  jobId: string
  changedField: 'invoice_number' | 'sale_amount' | 'cost_amount'
}) {
  try {
    await syncProvizeRecordFromJobFinance(params.financeId)
  } catch (error) {
    console.error('Provize sync after finance change failed:', error)

    await reportActionError({
      error,
      action: params.action,
      section: 'faktury',
      errorType: 'ProvizeSyncAfterFinanceChangeError',
      userId: params.userId,
      context: {
        financeId: params.financeId,
        jobId: params.jobId,
        changedField: params.changedField,
      },
    })
  }
}

export async function getFinanceCostItemsAction(
  financeId: string
): Promise<LoadFinanceCostItemsActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
      items: [],
    }
  }

  const normalizedFinanceId = String(financeId ?? '').trim()

  if (!normalizedFinanceId) {
    return {
      success: false,
      error: 'Chybí ID finančního záznamu.',
      items: [],
    }
  }

  const financeAccess = await getFinanceAccessRow(supabase, normalizedFinanceId)

  if (!financeAccess.success) {
    return {
      success: false,
      error: financeAccess.error,
      items: [],
    }
  }

  let { data, error } = await supabase
    .from('job_finance_cost_items')
    .select(
      'id, label, supplier, technician_id, preset_key, sort_order, unit_price, quantity, line_total'
    )
    .eq('job_finance_id', normalizedFinanceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error && isMissingSupplierColumnError(error)) {
    const fallbackResponse = await supabase
      .from('job_finance_cost_items')
      .select(
        'id, label, technician_id, preset_key, sort_order, unit_price, quantity, line_total'
      )
      .eq('job_finance_id', normalizedFinanceId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    data = (fallbackResponse.data ?? []).map((row) => ({
      ...row,
      supplier: null,
    }))
    error = fallbackResponse.error
  }

  if (error) {
    return {
      success: false,
      error: 'Nepodařilo se načíst nákladové položky.',
      items: [],
    }
  }

  return {
    success: true,
    error: null,
    items: ((data ?? []) as JobFinanceCostItemRow[]).map(mapFinanceCostItemRow),
  }
}

export async function saveFinanceCostItemsAction(
  financeId: string,
  items: FinanceCostItemInput[]
): Promise<SaveFinanceCostItemsActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
      totalCost: null,
    }
  }

  const normalizedFinanceId = String(financeId ?? '').trim()

  if (!normalizedFinanceId) {
    return {
      success: false,
      error: 'Chybí ID finančního záznamu.',
      totalCost: null,
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return {
      success: false,
      error: 'Doplň alespoň základní nákladové řádky.',
      totalCost: null,
    }
  }

  const financeAccess = await getFinanceAccessRow(supabase, normalizedFinanceId)

  if (!financeAccess.success || !financeAccess.financeRow) {
    return {
      success: false,
      error: financeAccess.error,
      totalCost: null,
    }
  }

  const statisticsPresetKeys = new Set(['doprava', 'prace-technika'])
  const requestedTechnicianIds = Array.from(
    new Set(
      items
        .filter((item) =>
          statisticsPresetKeys.has(String(item.presetKey ?? '').trim())
        )
        .map((item) => String(item.technicianId ?? '').trim())
        .filter(Boolean)
    )
  )

  if (requestedTechnicianIds.length > 0) {
    const { data: technicianRows, error: techniciansError } = await supabase
      .from('profiles')
      .select('id')
      .in('id', requestedTechnicianIds)
      .eq('can_be_assigned_as_technician', true)

    const validTechnicianIds = new Set(
      (technicianRows ?? []).map((row) => String(row.id))
    )

    if (
      techniciansError ||
      requestedTechnicianIds.some((technicianId) =>
        !validTechnicianIds.has(technicianId)
      )
    ) {
      return {
        success: false,
        error: 'Vybraného technika se nepodařilo ověřit.',
        totalCost: null,
      }
    }
  }

  const normalizedItems = items.map((item, index) => {
    const label = String(item.label ?? '').trim()
    const supplier = normalizeOptionalPresetKey(item.supplier)
    const presetKey = normalizeOptionalPresetKey(item.presetKey)
    const technicianId =
      presetKey && statisticsPresetKeys.has(presetKey)
        ? normalizeOptionalPresetKey(item.technicianId)
        : null
    const unitPrice = normalizeFiniteNumber(item.unitPrice)
    const quantity = normalizeFiniteNumber(item.quantity)
    const sortOrder =
      typeof item.sortOrder === 'number' && item.sortOrder >= 0
        ? Math.floor(item.sortOrder)
        : index

    if (!label) {
      return {
        success: false as const,
        error: 'Každý nákladový řádek musí mít vyplněný název položky.',
        item: null,
      }
    }

    if (unitPrice === null || unitPrice < 0) {
      return {
        success: false as const,
        error: `Jednotková cena u položky "${label}" není platná.`,
        item: null,
      }
    }

    if (quantity === null || quantity < 0) {
      return {
        success: false as const,
        error: `Množství u položky "${label}" není platné.`,
        item: null,
      }
    }

    const lineTotal = Math.round(unitPrice * quantity)

    return {
      success: true as const,
      error: null,
      item: {
        job_finance_id: normalizedFinanceId,
        label,
        supplier,
        technician_id: technicianId,
        preset_key: presetKey,
        sort_order: sortOrder,
        unit_price: unitPrice,
        quantity,
        line_total: lineTotal,
      },
    }
  })

  const validationError = normalizedItems.find((item) => !item.success)

  if (validationError && !validationError.success) {
    return {
      success: false,
      error: validationError.error,
      totalCost: null,
    }
  }

  const rowsToInsert = normalizedItems
    .filter(
      (
        item
      ): item is Extract<typeof item, { success: true; item: NonNullable<typeof item.item> }> =>
        item.success && Boolean(item.item)
    )
    .map((item) => item.item)

  const totalCost = rowsToInsert.reduce((sum, item) => sum + item.line_total, 0)

  const { error: deleteError } = await supabase
    .from('job_finance_cost_items')
    .delete()
    .eq('job_finance_id', normalizedFinanceId)

  if (deleteError) {
    return {
      success: false,
      error: 'Původní nákladové položky se nepodařilo aktualizovat.',
      totalCost: null,
    }
  }

  let { error: insertError } = await supabase
    .from('job_finance_cost_items')
    .insert(rowsToInsert)

  if (insertError && isMissingSupplierColumnError(insertError)) {
    const fallbackRowsToInsert = rowsToInsert.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'supplier'))
    )

    const fallbackInsertResponse = await supabase
      .from('job_finance_cost_items')
      .insert(fallbackRowsToInsert)

    insertError = fallbackInsertResponse.error
  }

  if (insertError) {
    return {
      success: false,
      error: 'Nákladové položky se nepodařilo uložit.',
      totalCost: null,
    }
  }

  const { error: updateError } = await supabase
    .from('job_finances')
    .update({
      cost_amount: totalCost,
    })
    .eq('id', normalizedFinanceId)

  if (updateError) {
    return {
      success: false,
      error: 'Celkový náklad se nepodařilo přepočítat.',
      totalCost: null,
    }
  }

  await syncProvizeAfterFinanceChange({
    action: 'saveFinanceCostItemsAction',
    userId: user.id,
    financeId: normalizedFinanceId,
    jobId: String(financeAccess.financeRow.job_id),
    changedField: 'cost_amount',
  })

  revalidateFinancePaths(financeAccess.financeRow.job_id)

  return {
    success: true,
    error: null,
    totalCost,
  }
}

export async function deleteFinanceCostItemsAction(
  financeId: string
): Promise<DeleteFinanceCostItemsActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  const normalizedFinanceId = String(financeId ?? '').trim()

  if (!normalizedFinanceId) {
    return {
      success: false,
      error: 'Chybí ID finančního záznamu.',
    }
  }

  const financeAccess = await getFinanceAccessRow(supabase, normalizedFinanceId)

  if (!financeAccess.success || !financeAccess.financeRow) {
    return {
      success: false,
      error: financeAccess.error,
    }
  }

  const { error: deleteError } = await supabase
    .from('job_finance_cost_items')
    .delete()
    .eq('job_finance_id', normalizedFinanceId)

  if (deleteError) {
    return {
      success: false,
      error: 'Nákladové položky se nepodařilo smazat.',
    }
  }

  const { error: updateError } = await supabase
    .from('job_finances')
    .update({
      cost_amount: null,
    })
    .eq('id', normalizedFinanceId)

  if (updateError) {
    return {
      success: false,
      error: 'Náklad se nepodařilo vymazat.',
    }
  }

  await syncProvizeAfterFinanceChange({
    action: 'deleteFinanceCostItemsAction',
    userId: user.id,
    financeId: normalizedFinanceId,
    jobId: String(financeAccess.financeRow.job_id),
    changedField: 'cost_amount',
  })

  revalidateFinancePaths(financeAccess.financeRow.job_id)

  return {
    success: true,
    error: null,
  }
}

export async function updateFinanceInlineFieldAction(
  financeId: string,
  _prevState: UpdateFinanceInlineFieldActionState,
  formData: FormData
): Promise<UpdateFinanceInlineFieldActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  const normalizedFinanceId = String(financeId ?? '').trim()

  if (!normalizedFinanceId) {
    return {
      success: false,
      error: 'Chybí ID finančního záznamu.',
    }
  }

  const field = String(formData.get('field') ?? '').trim()
  const value = formData.get('value')

  if (!isFinanceEditableField(field)) {
    return {
      success: false,
      error: 'Neplatné pole pro editaci.',
    }
  }

  const { data: financeRow, error: financeRowError } = await supabase
    .from('job_finances')
    .select('id, job_id, invoice_number')
    .eq('id', normalizedFinanceId)
    .single()

  if (financeRowError || !financeRow) {
    return {
      success: false,
      error: 'Nepodařilo se načíst finanční záznam.',
    }
  }

  if (field === 'client_order_number' || field === 'invoice_number') {
    const normalizedText = normalizeText(value)

    const { error } = await supabase
      .from('job_finances')
      .update({
        [field]: normalizedText,
      })
      .eq('id', normalizedFinanceId)

    if (error) {
      return {
        success: false,
        error:
          field === 'client_order_number'
            ? 'Číslo objednávky se nepodařilo uložit.'
            : 'Číslo faktury se nepodařilo uložit.',
      }
    }

    if (field === 'client_order_number') {
      const { error: syncJobError } = await supabase
        .from('jobs')
        .update({
          client_order_number: normalizedText,
        })
        .eq('id', String(financeRow.job_id))

      if (syncJobError) {
        return {
          success: false,
          error: 'Číslo objednávky se uložilo do fakturace, ale nepodařilo se propsat do zakázky.',
        }
      }
    }

    if (field === 'invoice_number') {
      try {
        const technicianIds = await getAssignedTechnicianIdsForJob(
          supabase,
          String(financeRow.job_id)
        )

        if (normalizedText) {
          await cancelJobCalendarForTechniciansSafely({
            jobId: String(financeRow.job_id),
            technicianIds,
            action: 'updateFinanceInlineFieldAction',
            errorType: 'UpdateFinanceCalendarCancelError',
            userIdForErrorLog: user.id,
          })
          await cancelJobGoogleCalendarForTechniciansSafely({
            jobId: String(financeRow.job_id),
            technicianIds,
            action: 'updateFinanceInlineFieldAction',
            errorType: 'UpdateFinanceGoogleCalendarCancelError',
            userIdForErrorLog: user.id,
          })
        } else {
          await syncJobCalendarForTechniciansSafely({
            jobId: String(financeRow.job_id),
            technicianIds,
            action: 'updateFinanceInlineFieldAction',
            errorType: 'UpdateFinanceCalendarSyncError',
            userIdForErrorLog: user.id,
          })
          await syncJobGoogleCalendarForTechniciansSafely({
            jobId: String(financeRow.job_id),
            technicianIds,
            action: 'updateFinanceInlineFieldAction',
            errorType: 'UpdateFinanceGoogleCalendarSyncError',
            userIdForErrorLog: user.id,
          })
        }
      } catch (calendarError) {
        console.error(
          'Nepodařilo se synchronizovat kalendář po změně čísla faktury.',
          calendarError
        )
        await reportActionError({
          error: calendarError,
          action: 'updateFinanceInlineFieldAction',
          section: 'faktury',
          errorType: 'UpdateFinanceCalendarSyncError',
          userId: user.id,
          context: { financeId: normalizedFinanceId, jobId: financeRow.job_id },
        })
      }

      await syncProvizeAfterFinanceChange({
        action: 'updateFinanceInlineFieldAction',
        userId: user.id,
        financeId: normalizedFinanceId,
        jobId: String(financeRow.job_id),
        changedField: 'invoice_number',
      })
    }

    revalidateFinancePaths(String(financeRow.job_id))

    return {
      success: true,
      error: null,
    }
  }

  const parsedNumber = normalizeDecimal(value)

  if (!parsedNumber.success) {
    return {
      success: false,
      error: parsedNumber.error,
    }
  }

  const { error } = await supabase
    .from('job_finances')
    .update({
      [field]: parsedNumber.value,
    })
    .eq('id', normalizedFinanceId)

  if (error) {
    return {
      success: false,
      error:
        field === 'sale_amount'
          ? 'Prodej se nepodařilo uložit.'
          : 'Náklad se nepodařilo uložit.',
    }
  }

  await syncProvizeAfterFinanceChange({
    action: 'updateFinanceInlineFieldAction',
    userId: user.id,
    financeId: normalizedFinanceId,
    jobId: String(financeRow.job_id),
    changedField: 'sale_amount',
  })

  revalidateFinancePaths(String(financeRow.job_id))

  return {
    success: true,
    error: null,
  }
}

export async function getJobAttachmentsAction(
  jobId: string
): Promise<LoadJobAttachmentsActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
      items: [],
      offerOrderFiles: [],
      offerOrderReference: null,
      hasLinkedOffer: false,
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()
  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
      items: [],
      offerOrderFiles: [],
      offerOrderReference: null,
      hasLinkedOffer: false,
    }
  }

  const access = await getJobAttachmentAccessRow(supabase, normalizedJobId)
  if (!access.success) {
    return {
      success: false,
      error: access.error,
      items: [],
      offerOrderFiles: [],
      offerOrderReference: null,
      hasLinkedOffer: false,
    }
  }

  const linkedOfferId = String((access.jobRow.offer_id ?? '')).trim() || null

  const { data, error } = await supabase
    .from('job_attachments')
    .select(
      'id, job_id, file_name, display_name, storage_bucket, storage_path, mime_type, file_size_bytes, category, note, uploaded_by, created_at'
    )
    .eq('job_id', normalizedJobId)
    .order('created_at', { ascending: false })

  if (error) {
    return {
      success: false,
      error: 'Přílohy se nepodařilo načíst.',
      items: [],
      offerOrderFiles: [],
      offerOrderReference: null,
      hasLinkedOffer: Boolean(linkedOfferId),
    }
  }

  let offerOrderFiles: OfferOrderAttachment[] = []
  let offerOrderReference: string | null = null

  if (linkedOfferId) {
    const [{ data: offerOrderRows, error: offerOrderError }, { data: offerRow, error: offerError }] =
      await Promise.all([
        supabase
          .from('offer_order_files')
          .select('id, offer_id, file_name, storage_path, mime_type, file_size_bytes, created_at')
          .eq('offer_id', linkedOfferId)
          .order('created_at', { ascending: false }),
        supabase
          .from('offers')
          .select('id, order_reference')
          .eq('id', linkedOfferId)
          .single(),
      ])

    if (offerOrderError) {
      return {
        success: false,
        error: 'Objednávkové podklady se nepodařilo načíst.',
        items: ((data ?? []) as JobAttachmentRow[]).map(mapJobAttachmentRow),
        offerOrderFiles: [],
        offerOrderReference: null,
        hasLinkedOffer: true,
      }
    }

    if (offerError) {
      return {
        success: false,
        error: 'Nepodařilo se načíst navázanou nabídku zakázky.',
        items: ((data ?? []) as JobAttachmentRow[]).map(mapJobAttachmentRow),
        offerOrderFiles: [],
        offerOrderReference: null,
        hasLinkedOffer: true,
      }
    }

    offerOrderFiles = ((offerOrderRows ?? []) as OfferOrderAttachmentRow[]).map(
      mapOfferOrderAttachmentRow
    )
    offerOrderReference =
      String((offerRow as { order_reference?: string | null } | null)?.order_reference ?? '').trim() ||
      null
  }

  return {
    success: true,
    error: null,
    items: ((data ?? []) as JobAttachmentRow[]).map(mapJobAttachmentRow),
    offerOrderFiles,
    offerOrderReference,
    hasLinkedOffer: Boolean(linkedOfferId),
  }
}

export async function openOfferOrderAttachmentAction(
  offerOrderFileId: string
): Promise<OpenOfferOrderAttachmentActionState> {
  const { supabase, user, error: accessError } = await requireFinanceAdminAccess()

  if (!user) {
    return { success: false, error: accessError, signedUrl: null }
  }

  const normalizedAttachmentId = String(offerOrderFileId ?? '').trim()
  if (!normalizedAttachmentId) {
    return { success: false, error: 'Chybí ID souboru.', signedUrl: null }
  }

  const { data: row, error } = await supabase
    .from('offer_order_files')
    .select('id, storage_path')
    .eq('id', normalizedAttachmentId)
    .single()

  if (error || !row) {
    return { success: false, error: 'Soubor nebyl nalezen.', signedUrl: null }
  }

  const { data, error: signedUrlError } = await supabase.storage
    .from(OFFER_ORDER_ATTACHMENTS_BUCKET)
    .createSignedUrl(String((row as { storage_path: string }).storage_path), 60 * 10)

  if (signedUrlError || !data?.signedUrl) {
    return { success: false, error: 'Nepodařilo se vytvořit odkaz na soubor.', signedUrl: null }
  }

  return { success: true, error: null, signedUrl: data.signedUrl }
}

export async function downloadOfferOrderAttachmentAction(
  offerOrderFileId: string
): Promise<DownloadOfferOrderAttachmentActionState> {
  const { supabase, user, error: accessError } = await requireFinanceAdminAccess()

  if (!user) {
    return { success: false, error: accessError, signedUrl: null }
  }

  const normalizedAttachmentId = String(offerOrderFileId ?? '').trim()
  if (!normalizedAttachmentId) {
    return { success: false, error: 'Chybí ID souboru.', signedUrl: null }
  }

  const { data: row, error } = await supabase
    .from('offer_order_files')
    .select('id, file_name, storage_path')
    .eq('id', normalizedAttachmentId)
    .single()

  if (error || !row) {
    return { success: false, error: 'Soubor nebyl nalezen.', signedUrl: null }
  }

  const typedRow = row as { file_name: string; storage_path: string }
  const { data, error: signedUrlError } = await supabase.storage
    .from(OFFER_ORDER_ATTACHMENTS_BUCKET)
    .createSignedUrl(String(typedRow.storage_path), 60 * 10, {
      download: String(typedRow.file_name ?? '').trim() || undefined,
    })

  if (signedUrlError || !data?.signedUrl) {
    return { success: false, error: 'Nepodařilo se vytvořit odkaz pro stažení.', signedUrl: null }
  }

  return { success: true, error: null, signedUrl: data.signedUrl }
}

export async function uploadJobAttachmentsAction(
  jobId: string,
  formData: FormData
): Promise<UploadJobAttachmentsActionState> {
  let resolvedUserId: string | null = null
  const resolvedJobId = String(jobId ?? '').trim()
  let resolvedCategory: string | null = null
  let resolvedFilesCount = 0

  try {
    const { supabase, user, error: accessError } =
      await requireFinanceAdminAccess()

    if (!user) {
      return { success: false, error: accessError, uploadedCount: 0 }
    }

    resolvedUserId = user.id

    if (!resolvedJobId) {
      return { success: false, error: 'Chybí ID zakázky.', uploadedCount: 0 }
    }

    const categoryValue = String(formData.get('category') ?? '').trim()
    const category = isJobAttachmentCategory(categoryValue)
      ? categoryValue
      : null
    resolvedCategory = category
    if (!category) {
      return { success: false, error: 'Neplatná kategorie přílohy.', uploadedCount: 0 }
    }

    const normalizedNote = normalizeText(formData.get('note'))
    const access = await getJobAttachmentAccessRow(supabase, resolvedJobId)
    if (!access.success) {
      return { success: false, error: access.error, uploadedCount: 0 }
    }

    const filesFromFormData = formData.getAll('files')
    const cleanFiles = filesFromFormData.filter(
      (file): file is File => file instanceof File
    )
    resolvedFilesCount = cleanFiles.length

    if (cleanFiles.length === 0) {
      return {
        success: false,
        error: 'Vyber alespoň jeden soubor.',
        uploadedCount: 0,
      }
    }

    for (const file of cleanFiles) {
      if (file.size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
        return {
          success: false,
          error: `Soubor "${file.name}" překračuje limit 5 MB.`,
          uploadedCount: 0,
        }
      }

      const mimeType = String(file.type ?? '').trim().toLowerCase()
      if (!mimeType || !ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
        return {
          success: false,
          error: `Soubor "${file.name}" má nepodporovaný typ.`,
          uploadedCount: 0,
        }
      }
    }

    const createdRows: Array<{ id: string; storagePath: string }> = []

    for (const file of cleanFiles) {
      const storagePath = buildAttachmentStoragePath(resolvedJobId, file.name)
      const contentType = String(file.type ?? '').trim() || 'application/octet-stream'

      const { error: uploadError } = await supabase.storage
        .from(JOB_ATTACHMENTS_BUCKET)
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType,
        })

      if (uploadError) {
        for (const createdRow of createdRows) {
          await supabase.storage.from(JOB_ATTACHMENTS_BUCKET).remove([createdRow.storagePath])
          await supabase.from('job_attachments').delete().eq('id', createdRow.id)
        }

        return {
          success: false,
          error: `Soubor "${file.name}" se nepodařilo nahrát (${uploadError.message}).`,
          uploadedCount: 0,
        }
      }

      const insertPayload = {
        job_id: resolvedJobId,
        file_name: file.name,
        display_name: file.name,
        storage_bucket: JOB_ATTACHMENTS_BUCKET,
        storage_path: storagePath,
        mime_type: contentType,
        file_size_bytes: file.size,
        category,
        note: normalizedNote,
        uploaded_by: user.id,
      }

      const { data: insertedRow, error: insertError } = await supabase
        .from('job_attachments')
        .insert(insertPayload)
        .select('id')
        .single()

      if (insertError || !insertedRow) {
        await supabase.storage.from(JOB_ATTACHMENTS_BUCKET).remove([storagePath])

        for (const createdRow of createdRows) {
          await supabase.storage.from(JOB_ATTACHMENTS_BUCKET).remove([createdRow.storagePath])
          await supabase.from('job_attachments').delete().eq('id', createdRow.id)
        }

        return {
          success: false,
          error: `Metadata souboru "${file.name}" se nepodařilo uložit (${insertError?.message ?? 'neznámá chyba'}).`,
          uploadedCount: 0,
        }
      }

      createdRows.push({
        id: String((insertedRow as { id: string }).id),
        storagePath,
      })
    }

    revalidateFinancePaths(resolvedJobId)

    return {
      success: true,
      error: null,
      uploadedCount: createdRows.length,
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Neznámá chyba během nahrávání.'

    await reportActionError({
      error,
      action: 'uploadJobAttachmentsAction',
      section: 'faktury',
      errorType: 'UploadJobAttachmentsActionError',
      userId: resolvedUserId,
      context: {
        jobId: resolvedJobId,
        category: resolvedCategory,
        filesCount: resolvedFilesCount,
      },
    })

    return {
      success: false,
      error: `Přílohu se nepodařilo nahrát (${errorMessage}).`,
      uploadedCount: 0,
    }
  }
}

export async function renameJobAttachmentAction(
  attachmentId: string,
  displayName: string
): Promise<RenameJobAttachmentActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return { success: false, error: accessError }
  }

  const normalizedAttachmentId = String(attachmentId ?? '').trim()
  const normalizedDisplayName = String(displayName ?? '').trim()

  if (!normalizedAttachmentId) {
    return { success: false, error: 'Chybí ID přílohy.' }
  }

  if (!normalizedDisplayName) {
    return { success: false, error: 'Název přílohy nesmí být prázdný.' }
  }

  const { data: attachmentRow, error: attachmentError } = await supabase
    .from('job_attachments')
    .select('id, job_id')
    .eq('id', normalizedAttachmentId)
    .single()

  if (attachmentError || !attachmentRow) {
    return { success: false, error: 'Příloha nebyla nalezena.' }
  }

  const { error } = await supabase
    .from('job_attachments')
    .update({ display_name: normalizedDisplayName })
    .eq('id', normalizedAttachmentId)

  if (error) {
    return { success: false, error: 'Název přílohy se nepodařilo uložit.' }
  }

  revalidateFinancePaths(String((attachmentRow as { job_id: string }).job_id))

  return { success: true, error: null }
}

export async function updateJobAttachmentNoteAction(
  attachmentId: string,
  note: string
): Promise<UpdateJobAttachmentNoteActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return { success: false, error: accessError }
  }

  const normalizedAttachmentId = String(attachmentId ?? '').trim()
  if (!normalizedAttachmentId) {
    return { success: false, error: 'Chybí ID přílohy.' }
  }

  const normalizedNote = normalizeText(note)

  const { data: attachmentRow, error: attachmentError } = await supabase
    .from('job_attachments')
    .select('id, job_id')
    .eq('id', normalizedAttachmentId)
    .single()

  if (attachmentError || !attachmentRow) {
    return { success: false, error: 'Příloha nebyla nalezena.' }
  }

  const { error } = await supabase
    .from('job_attachments')
    .update({ note: normalizedNote })
    .eq('id', normalizedAttachmentId)

  if (error) {
    return { success: false, error: 'Poznámku se nepodařilo uložit.' }
  }

  revalidateFinancePaths(String((attachmentRow as { job_id: string }).job_id))

  return { success: true, error: null }
}

export async function deleteJobAttachmentAction(
  attachmentId: string
): Promise<DeleteJobAttachmentActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return { success: false, error: accessError }
  }

  const normalizedAttachmentId = String(attachmentId ?? '').trim()
  if (!normalizedAttachmentId) {
    return { success: false, error: 'Chybí ID přílohy.' }
  }

  const { data: attachmentRow, error: rowError } = await supabase
    .from('job_attachments')
    .select('id, job_id, storage_bucket, storage_path')
    .eq('id', normalizedAttachmentId)
    .single()

  if (rowError || !attachmentRow) {
    return { success: false, error: 'Příloha nebyla nalezena.' }
  }

  const typedRow = attachmentRow as {
    job_id: string
    storage_bucket: string
    storage_path: string
  }

  const { error: storageError } = await supabase.storage
    .from(String(typedRow.storage_bucket))
    .remove([String(typedRow.storage_path)])

  if (storageError) {
    return { success: false, error: 'Soubor ve storage se nepodařilo smazat.' }
  }

  const { error: deleteError } = await supabase
    .from('job_attachments')
    .delete()
    .eq('id', normalizedAttachmentId)

  if (deleteError) {
    return { success: false, error: 'Metadata přílohy se nepodařilo smazat.' }
  }

  revalidateFinancePaths(String(typedRow.job_id))

  return { success: true, error: null }
}

export async function openJobAttachmentAction(
  attachmentId: string
): Promise<OpenJobAttachmentActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return { success: false, error: accessError ?? 'Chybí přihlášení.', signedUrl: null }
  }

  const normalizedAttachmentId = String(attachmentId ?? '').trim()
  if (!normalizedAttachmentId) {
    return { success: false, error: 'Chybí ID přílohy.', signedUrl: null }
  }

  const { data: attachmentRow, error: rowError } = await supabase
    .from('job_attachments')
    .select('storage_bucket, storage_path')
    .eq('id', normalizedAttachmentId)
    .single()

  if (rowError || !attachmentRow) {
    return { success: false, error: 'Příloha nebyla nalezena.', signedUrl: null }
  }

  const typedRow = attachmentRow as {
    storage_bucket: string
    storage_path: string
  }

  const { data, error } = await supabase.storage
    .from(String(typedRow.storage_bucket))
    .createSignedUrl(String(typedRow.storage_path), 60)

  if (error || !data?.signedUrl) {
    return {
      success: false,
      error: 'Nepodařilo se vytvořit odkaz pro otevření přílohy.',
      signedUrl: null,
    }
  }

  return {
    success: true,
    error: null,
    signedUrl: data.signedUrl,
  }
}

export async function downloadJobAttachmentAction(
  attachmentId: string
): Promise<DownloadJobAttachmentActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return { success: false, error: accessError ?? 'Chybí přihlášení.', signedUrl: null }
  }

  const normalizedAttachmentId = String(attachmentId ?? '').trim()
  if (!normalizedAttachmentId) {
    return { success: false, error: 'Chybí ID přílohy.', signedUrl: null }
  }

  const { data: attachmentRow, error: rowError } = await supabase
    .from('job_attachments')
    .select('display_name, storage_bucket, storage_path')
    .eq('id', normalizedAttachmentId)
    .single()

  if (rowError || !attachmentRow) {
    return { success: false, error: 'Příloha nebyla nalezena.', signedUrl: null }
  }

  const typedRow = attachmentRow as {
    display_name: string
    storage_bucket: string
    storage_path: string
  }

  const { data, error } = await supabase.storage
    .from(String(typedRow.storage_bucket))
    .createSignedUrl(String(typedRow.storage_path), 60, {
      download: String(typedRow.display_name ?? '').trim() || undefined,
    })

  if (error || !data?.signedUrl) {
    return {
      success: false,
      error: 'Nepodařilo se vytvořit odkaz pro stažení přílohy.',
      signedUrl: null,
    }
  }

  return {
    success: true,
    error: null,
    signedUrl: data.signedUrl,
  }
}
