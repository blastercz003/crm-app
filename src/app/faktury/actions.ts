'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type UpdateFinanceInlineFieldActionState = {
  success: boolean
  error: string | null
}

export type FinanceCostItem = {
  id: string
  label: string
  supplier: string | null
  presetKey: string | null
  sortOrder: number
  unitPrice: number
  quantity: number
  lineTotal: number
}

export type FinanceCostItemInput = {
  label: string
  supplier?: string | null
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

type ProfileRoleRow = {
  role: string | null
}

const FINANCE_EDITABLE_FIELDS = [
  'info_note',
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

type JobFinanceCostItemRow = {
  id: string
  label: string
  supplier: string | null
  preset_key: string | null
  sort_order: number | null
  unit_price: number | string | null
  quantity: number | string | null
  line_total: number | null
}

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

function revalidateFinancePaths(jobId?: string | null) {
  revalidatePath('/faktury')

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
      'id, label, supplier, preset_key, sort_order, unit_price, quantity, line_total'
    )
    .eq('job_finance_id', normalizedFinanceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error && isMissingSupplierColumnError(error)) {
    const fallbackResponse = await supabase
      .from('job_finance_cost_items')
      .select('id, label, preset_key, sort_order, unit_price, quantity, line_total')
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

  const normalizedItems = items.map((item, index) => {
    const label = String(item.label ?? '').trim()
    const supplier = normalizeOptionalPresetKey(item.supplier)
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
        preset_key: normalizeOptionalPresetKey(item.presetKey),
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
    const fallbackRowsToInsert = rowsToInsert.map(({ supplier: _supplier, ...row }) => row)

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
    .select('id, job_id')
    .eq('id', normalizedFinanceId)
    .single()

  if (financeRowError || !financeRow) {
    return {
      success: false,
      error: 'Nepodařilo se načíst finanční záznam.',
    }
  }

  if (field === 'info_note' || field === 'invoice_number') {
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
          field === 'info_note'
            ? 'Info se nepodařilo uložit.'
            : 'Číslo faktury se nepodařilo uložit.',
      }
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

  revalidateFinancePaths(String(financeRow.job_id))

  return {
    success: true,
    error: null,
  }
}
