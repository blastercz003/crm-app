'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase/service'
import type { ProvizeSalesOwner } from '@/lib/provize/access'
import {
  getCommissionRateForSalesOwner,
  roundCommissionAmount,
  type ProvizeRecordRow,
} from '@/lib/provize/service'

type ProfileRoleRow = {
  role: string | null
}

type ProvizePayoutBatchRow = {
  id: string
  sales_owner: ProvizeSalesOwner
  status: 'draft' | 'confirmed'
  created_by: string | null
  confirmed_by: string | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

type ProvizePayoutBatchItemRow = {
  id: string
  batch_id: string
  provize_record_id: string
  sort_order: number
  sales_owner: ProvizeSalesOwner
  job_finance_id: string
  job_id: string
  job_number: string
  company_name: string
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  invoice_number: string
  sale_amount: number
  cost_amount: number
  profit_amount: number
  commission_rate: number
  commission_amount: number
  created_at: string
  updated_at: string
}

type ProvizePayoutAdjustmentRow = {
  id: string
  batch_id: string
  sort_order: number
  item_type: 'bonus' | 'deduction'
  label: string
  amount: number
  created_at: string
  updated_at: string
}

type DraftItemInput = {
  provizeRecordId: string
  profitAmount: number
}

type DraftAdjustmentInput = {
  id?: string
  itemType: 'bonus' | 'deduction'
  label: string
  amount: number
}

export type ProvizePayoutDraftRecord = {
  provizeRecordId: string
  jobNumber: string
  companyName: string
  invoiceNumber: string
  saleAmount: number
  costAmount: number
  profitAmount: number
  commissionRate: number
  commissionAmount: number
  startAt: string
  endAt: string
  siteAddress: string | null
  storeNumber: string | null
}

export type ProvizePayoutDraftAdjustment = {
  id: string
  itemType: 'bonus' | 'deduction'
  label: string
  amount: number
}

export type ProvizePayoutDraftData = {
  batchId: string
  salesOwner: ProvizeSalesOwner
  createdAt: string
  updatedAt: string
  existingDraft: boolean
  items: ProvizePayoutDraftRecord[]
  candidates: ProvizePayoutDraftRecord[]
  adjustments: ProvizePayoutDraftAdjustment[]
  commissionSubtotal: number
  adjustmentTotal: number
  payoutTotal: number
}

type DraftActionResult =
  | {
      success: true
      draft: ProvizePayoutDraftData
    }
  | {
      success: false
      error: string
    }

type ConfirmDraftActionResult =
  | {
      success: true
      batchId: string
      salesOwner: ProvizeSalesOwner
    }
  | {
      success: false
      error: string
    }

type DeleteDraftActionResult =
  | {
      success: true
      salesOwner: ProvizeSalesOwner
    }
  | {
      success: false
      error: string
    }

function revalidateProvizePaths() {
  revalidatePath('/provize')
  revalidatePath('/dashboard')
}

function getJobNumberSortValue(jobNumber: string) {
  const digits = String(jobNumber ?? '').match(/\d+/g)?.join('') ?? ''
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : -1
}

function compareByJobNumberDesc(a: { job_number: string }, b: { job_number: string }) {
  const aValue = getJobNumberSortValue(a.job_number)
  const bValue = getJobNumberSortValue(b.job_number)

  if (bValue !== aValue) {
    return bValue - aValue
  }

  return String(b.job_number).localeCompare(String(a.job_number), 'cs')
}

function normalizeWholeCurrency(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0)
}

async function requireProvizeAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false as const, error: 'Neautorizovaný přístup.', userId: null }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<ProfileRoleRow>()

  if (error || profile?.role !== 'admin') {
    return {
      success: false as const,
      error: 'Tuto akci může provést pouze admin.',
      userId: null,
    }
  }

  return {
    success: true as const,
    error: null,
    userId: user.id,
  }
}

function getServiceSupabase() {
  const supabase = getServiceRoleClient()

  if (!supabase) {
    throw new Error('Chybí Supabase service role client pro výplaty provizí.')
  }

  return supabase
}

function mapRecordToDraftSnapshot(
  record: ProvizeRecordRow,
  profitAmount: number
): ProvizePayoutDraftRecord {
  const commissionRate = getCommissionRateForSalesOwner(record.sales_owner)
  const normalizedProfit = normalizeWholeCurrency(profitAmount)

  return {
    provizeRecordId: record.id,
    jobNumber: record.job_number,
    companyName: record.company_name,
    invoiceNumber: record.invoice_number,
    saleAmount: normalizeWholeCurrency(record.sale_amount),
    costAmount: normalizeWholeCurrency(record.cost_amount),
    profitAmount: normalizedProfit,
    commissionRate,
    commissionAmount: roundCommissionAmount(normalizedProfit * commissionRate),
    startAt: record.start_at,
    endAt: record.end_at,
    siteAddress: record.site_address,
    storeNumber: record.store_number,
  }
}

function mapBatchItemToDraftItem(item: ProvizePayoutBatchItemRow): ProvizePayoutDraftRecord {
  return {
    provizeRecordId: item.provize_record_id,
    jobNumber: item.job_number,
    companyName: item.company_name,
    invoiceNumber: item.invoice_number,
    saleAmount: normalizeWholeCurrency(item.sale_amount),
    costAmount: normalizeWholeCurrency(item.cost_amount),
    profitAmount: normalizeWholeCurrency(item.profit_amount),
    commissionRate: Number(item.commission_rate),
    commissionAmount: normalizeWholeCurrency(item.commission_amount),
    startAt: item.start_at,
    endAt: item.end_at,
    siteAddress: item.site_address,
    storeNumber: item.store_number,
  }
}

async function getDraftBatchForOwner(
  salesOwner: ProvizeSalesOwner
): Promise<ProvizePayoutBatchRow | null> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('provize_payout_batches')
    .select('*')
    .eq('sales_owner', salesOwner)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ProvizePayoutBatchRow>()

  if (error) {
    throw new Error('Nepodařilo se načíst draft výplatní dávky.')
  }

  return data
}

async function getDraftBatchById(batchId: string): Promise<ProvizePayoutBatchRow> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('provize_payout_batches')
    .select('*')
    .eq('id', batchId)
    .single<ProvizePayoutBatchRow>()

  if (error || !data) {
    throw new Error('Draft výplatní dávky nebyl nalezen.')
  }

  if (data.status !== 'draft') {
    throw new Error('Tato výplatní dávka už byla potvrzená.')
  }

  return data
}

async function getEligibleProvizeRecords(
  salesOwner: ProvizeSalesOwner
): Promise<ProvizeRecordRow[]> {
  const supabase = getServiceSupabase()
  const { data, error } = await supabase
    .from('provize_records')
    .select(
      'id, job_finance_id, job_id, sales_owner, job_number, company_name, start_at, end_at, site_address, store_number, invoice_number, sale_amount, cost_amount, base_profit_amount, manual_profit_amount, approved_for_payout, approved_for_payout_at, current_draft_batch_id, confirmed_batch_id, created_at, updated_at'
    )
    .eq('sales_owner', salesOwner)
    .eq('approved_for_payout', true)
    .is('confirmed_batch_id', null)

  if (error) {
    throw new Error('Nepodařilo se načíst kandidáty pro výplatní dávku.')
  }

  return ((data ?? []) as ProvizeRecordRow[]).sort(compareByJobNumberDesc)
}

async function seedDraftBatchIfEmpty(batch: ProvizePayoutBatchRow) {
  const supabase = getServiceSupabase()
  const { data: existingItems, error: itemsError } = await supabase
    .from('provize_payout_batch_items')
    .select('id')
    .eq('batch_id', batch.id)
    .limit(1)

  if (itemsError) {
    throw new Error('Nepodařilo se ověřit obsah draft dávky.')
  }

  if ((existingItems ?? []).length > 0) {
    return
  }

  const eligibleRecords = await getEligibleProvizeRecords(batch.sales_owner)
  const availableRecords = eligibleRecords.filter(
    (record) =>
      record.current_draft_batch_id === null || record.current_draft_batch_id === batch.id
  )

  if (availableRecords.length === 0) {
    return
  }

  const insertPayload = availableRecords.map((record, index) => {
    const snapshot = mapRecordToDraftSnapshot(
      record,
      typeof record.manual_profit_amount === 'number'
        ? record.manual_profit_amount
        : record.base_profit_amount
    )

    return {
      batch_id: batch.id,
      provize_record_id: record.id,
      sort_order: index,
      sales_owner: batch.sales_owner,
      job_finance_id: record.job_finance_id,
      job_id: record.job_id,
      job_number: snapshot.jobNumber,
      company_name: snapshot.companyName,
      start_at: snapshot.startAt,
      end_at: snapshot.endAt,
      site_address: snapshot.siteAddress,
      store_number: snapshot.storeNumber,
      invoice_number: snapshot.invoiceNumber,
      sale_amount: snapshot.saleAmount,
      cost_amount: snapshot.costAmount,
      profit_amount: snapshot.profitAmount,
      commission_rate: snapshot.commissionRate,
      commission_amount: snapshot.commissionAmount,
    }
  })

  const { error: insertError } = await supabase
    .from('provize_payout_batch_items')
    .insert(insertPayload)

  if (insertError) {
    throw new Error('Nepodařilo se připravit položky draft dávky.')
  }

  const recordIds = availableRecords.map((record) => record.id)
  const { error: lockError } = await supabase
    .from('provize_records')
    .update({ current_draft_batch_id: batch.id })
    .in('id', recordIds)

  if (lockError) {
    throw new Error('Nepodařilo se uzamknout zakázky do draft dávky.')
  }
}

async function buildDraftData(
  batch: ProvizePayoutBatchRow,
  existingDraft: boolean
): Promise<ProvizePayoutDraftData> {
  const supabase = getServiceSupabase()

  const [{ data: items, error: itemsError }, { data: adjustments, error: adjustmentsError }] =
    await Promise.all([
      supabase
        .from('provize_payout_batch_items')
        .select('*')
        .eq('batch_id', batch.id)
        .order('sort_order', { ascending: true })
        .returns<ProvizePayoutBatchItemRow[]>(),
      supabase
        .from('provize_payout_adjustments')
        .select('*')
        .eq('batch_id', batch.id)
        .order('sort_order', { ascending: true })
        .returns<ProvizePayoutAdjustmentRow[]>(),
    ])

  if (itemsError) {
    throw new Error('Nepodařilo se načíst položky draft dávky.')
  }

  if (adjustmentsError) {
    throw new Error('Nepodařilo se načíst bonusy a odpočty draft dávky.')
  }

  const draftItems = (items ?? []).map(mapBatchItemToDraftItem)
  const itemIds = new Set((items ?? []).map((item) => item.provize_record_id))
  const eligibleRecords = await getEligibleProvizeRecords(batch.sales_owner)

  const candidateItems = eligibleRecords
    .filter(
      (record) =>
        !itemIds.has(record.id) &&
        (record.current_draft_batch_id === null || record.current_draft_batch_id === batch.id)
    )
    .map((record) =>
      mapRecordToDraftSnapshot(
        record,
        typeof record.manual_profit_amount === 'number'
          ? record.manual_profit_amount
          : record.base_profit_amount
      )
    )

  const commissionSubtotal = draftItems.reduce(
    (sum, item) => sum + normalizeWholeCurrency(item.commissionAmount),
    0
  )

  const normalizedAdjustments = (adjustments ?? []).map((item) => ({
    id: item.id,
    itemType: item.item_type,
    label: item.label,
    amount: normalizeWholeCurrency(item.amount),
  }))

  const adjustmentTotal = normalizedAdjustments.reduce((sum, item) => {
    return sum + (item.itemType === 'bonus' ? item.amount : -item.amount)
  }, 0)

  return {
    batchId: batch.id,
    salesOwner: batch.sales_owner,
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    existingDraft,
    items: draftItems,
    candidates: candidateItems,
    adjustments: normalizedAdjustments,
    commissionSubtotal,
    adjustmentTotal,
    payoutTotal: commissionSubtotal + adjustmentTotal,
  }
}

function normalizeDraftPayload(
  items: DraftItemInput[],
  adjustments: DraftAdjustmentInput[]
) {
  const normalizedItems = items
    .map((item, index) => ({
      provizeRecordId: String(item.provizeRecordId ?? '').trim(),
      profitAmount: normalizeWholeCurrency(item.profitAmount),
      sortOrder: index,
    }))
    .filter((item) => item.provizeRecordId)

  const normalizedAdjustments = adjustments
    .map((item, index) => ({
      id: item.id ? String(item.id).trim() : null,
      itemType: item.itemType,
      label: String(item.label ?? '').trim(),
      amount: normalizeWholeCurrency(item.amount),
      sortOrder: index,
    }))
    .filter((item) => item.label && item.amount > 0)

  return {
    items: normalizedItems,
    adjustments: normalizedAdjustments,
  }
}

async function persistDraftState(
  batch: ProvizePayoutBatchRow,
  items: DraftItemInput[],
  adjustments: DraftAdjustmentInput[]
) {
  const supabase = getServiceSupabase()
  const normalized = normalizeDraftPayload(items, adjustments)

  const recordIds = normalized.items.map((item) => item.provizeRecordId)
  const { data: existingItems, error: itemsError } = await supabase
    .from('provize_payout_batch_items')
    .select('*')
    .eq('batch_id', batch.id)
    .returns<ProvizePayoutBatchItemRow[]>()

  if (itemsError) {
    throw new Error('Nepodařilo se načíst položky draft dávky pro uložení.')
  }

  const currentItemsByRecordId = new Map(
    (existingItems ?? []).map((item) => [item.provize_record_id, item])
  )

  if (recordIds.length > 0) {
    const { data: records, error: recordsError } = await supabase
      .from('provize_records')
      .select(
        'id, job_finance_id, job_id, sales_owner, job_number, company_name, start_at, end_at, site_address, store_number, invoice_number, sale_amount, cost_amount, base_profit_amount, manual_profit_amount, approved_for_payout, approved_for_payout_at, current_draft_batch_id, confirmed_batch_id, created_at, updated_at'
      )
      .in('id', recordIds)
      .returns<ProvizeRecordRow[]>()

    if (recordsError) {
      throw new Error('Nepodařilo se načíst provizní záznamy pro uložení draftu.')
    }

    const recordsById = new Map((records ?? []).map((record) => [record.id, record]))

    for (const item of normalized.items) {
      const record = recordsById.get(item.provizeRecordId)

      if (!record) {
        throw new Error('Některý provizní záznam pro draft už neexistuje.')
      }

      if (record.confirmed_batch_id) {
        throw new Error(`Zakázka ${record.job_number} už byla mezitím vyplacena.`)
      }

      if (!record.approved_for_payout) {
        throw new Error(`Zakázka ${record.job_number} už není označena K vyplacení.`)
      }

      if (
        record.current_draft_batch_id !== null &&
        record.current_draft_batch_id !== batch.id
      ) {
        throw new Error(`Zakázka ${record.job_number} je už uzamčená v jiné draft dávce.`)
      }

      const commissionRate = getCommissionRateForSalesOwner(batch.sales_owner)
      const commissionAmount = roundCommissionAmount(item.profitAmount * commissionRate)
      const existingItem = currentItemsByRecordId.get(item.provizeRecordId)

      if (existingItem) {
        const { error: updateItemError } = await supabase
          .from('provize_payout_batch_items')
          .update({
            sort_order: item.sortOrder,
            profit_amount: item.profitAmount,
            commission_rate: commissionRate,
            commission_amount: commissionAmount,
          })
          .eq('id', existingItem.id)

        if (updateItemError) {
          throw new Error('Nepodařilo se uložit položku draft dávky.')
        }
      } else {
        const { error: insertItemError } = await supabase
          .from('provize_payout_batch_items')
          .insert({
            batch_id: batch.id,
            provize_record_id: record.id,
            sort_order: item.sortOrder,
            sales_owner: batch.sales_owner,
            job_finance_id: record.job_finance_id,
            job_id: record.job_id,
            job_number: record.job_number,
            company_name: record.company_name,
            start_at: record.start_at,
            end_at: record.end_at,
            site_address: record.site_address,
            store_number: record.store_number,
            invoice_number: record.invoice_number,
            sale_amount: normalizeWholeCurrency(record.sale_amount),
            cost_amount: normalizeWholeCurrency(record.cost_amount),
            profit_amount: item.profitAmount,
            commission_rate: commissionRate,
            commission_amount: commissionAmount,
          })

        if (insertItemError) {
          throw new Error('Nepodařilo se přidat položku do draft dávky.')
        }
      }

      const { error: updateRecordError } = await supabase
        .from('provize_records')
        .update({
          manual_profit_amount: item.profitAmount,
          current_draft_batch_id: batch.id,
        })
        .eq('id', record.id)

      if (updateRecordError) {
        throw new Error('Nepodařilo se propsat upravený zisk do hlavní tabulky provizí.')
      }
    }
  }

  const removedItemIds = (existingItems ?? [])
    .filter((item) => !recordIds.includes(item.provize_record_id))
    .map((item) => item.id)

  const removedRecordIds = (existingItems ?? [])
    .filter((item) => !recordIds.includes(item.provize_record_id))
    .map((item) => item.provize_record_id)

  if (removedItemIds.length > 0) {
    const { error: deleteItemsError } = await supabase
      .from('provize_payout_batch_items')
      .delete()
      .in('id', removedItemIds)

    if (deleteItemsError) {
      throw new Error('Nepodařilo se odebrat položku z draft dávky.')
    }
  }

  if (removedRecordIds.length > 0) {
    const { error: unlockError } = await supabase
      .from('provize_records')
      .update({ current_draft_batch_id: null })
      .in('id', removedRecordIds)
      .is('confirmed_batch_id', null)

    if (unlockError) {
      throw new Error('Nepodařilo se vrátit zakázku zpět mezi kandidáty.')
    }
  }

  const { error: deleteAdjustmentsError } = await supabase
    .from('provize_payout_adjustments')
    .delete()
    .eq('batch_id', batch.id)

  if (deleteAdjustmentsError) {
    throw new Error('Nepodařilo se vymazat předchozí bonusy a odpočty draftu.')
  }

  if (normalized.adjustments.length > 0) {
    const { error: insertAdjustmentsError } = await supabase
      .from('provize_payout_adjustments')
      .insert(
        normalized.adjustments.map((item) => ({
          batch_id: batch.id,
          sort_order: item.sortOrder,
          item_type: item.itemType,
          label: item.label,
          amount: item.amount,
        }))
      )

    if (insertAdjustmentsError) {
      throw new Error('Nepodařilo se uložit bonusy a odpočty draft dávky.')
    }
  }
}

export async function openProvizePayoutDraftAction(
  salesOwner: ProvizeSalesOwner
): Promise<DraftActionResult> {
  const access = await requireProvizeAdmin()

  if (!access.success) {
    return { success: false, error: access.error }
  }

  try {
    const supabase = getServiceSupabase()
    const existingDraft = await getDraftBatchForOwner(salesOwner)
    let batch = existingDraft

    if (!batch) {
      const { data, error } = await supabase
        .from('provize_payout_batches')
        .insert({
          sales_owner: salesOwner,
          status: 'draft',
          created_by: access.userId,
        })
        .select('*')
        .single<ProvizePayoutBatchRow>()

      if (error || !data) {
        return { success: false, error: 'Nepodařilo se založit novou draft dávku.' }
      }

      batch = data
    }

    await seedDraftBatchIfEmpty(batch)
    const draft = await buildDraftData(batch, Boolean(existingDraft))

    revalidateProvizePaths()

    return {
      success: true,
      draft,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Draft dávku se nepodařilo otevřít.',
    }
  }
}

export async function saveProvizePayoutDraftAction(
  batchId: string,
  items: DraftItemInput[],
  adjustments: DraftAdjustmentInput[]
): Promise<DraftActionResult> {
  const access = await requireProvizeAdmin()

  if (!access.success) {
    return { success: false, error: access.error }
  }

  try {
    const batch = await getDraftBatchById(batchId)
    await persistDraftState(batch, items, adjustments)
    const refreshedBatch = await getDraftBatchById(batch.id)
    const draft = await buildDraftData(refreshedBatch, true)

    revalidateProvizePaths()

    return {
      success: true,
      draft,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Draft dávku se nepodařilo uložit.',
    }
  }
}

export async function toggleProvizePayoutDraftItemAction(
  batchId: string,
  provizeRecordId: string,
  include: boolean
): Promise<DraftActionResult> {
  const access = await requireProvizeAdmin()

  if (!access.success) {
    return { success: false, error: access.error }
  }

  try {
    const supabase = getServiceSupabase()
    const batch = await getDraftBatchById(batchId)

    if (include) {
      const { data: record, error: recordError } = await supabase
        .from('provize_records')
        .select(
          'id, job_finance_id, job_id, sales_owner, job_number, company_name, start_at, end_at, site_address, store_number, invoice_number, sale_amount, cost_amount, base_profit_amount, manual_profit_amount, approved_for_payout, approved_for_payout_at, current_draft_batch_id, confirmed_batch_id, created_at, updated_at'
        )
        .eq('id', provizeRecordId)
        .single<ProvizeRecordRow>()

      if (recordError || !record) {
        throw new Error('Vybranou zakázku se nepodařilo načíst.')
      }

      if (record.sales_owner !== batch.sales_owner) {
        throw new Error('Zakázka patří jinému obchodníkovi.')
      }

      if (record.confirmed_batch_id) {
        throw new Error('Zakázka už byla vyplacená.')
      }

      if (!record.approved_for_payout) {
        throw new Error('Zakázka není označená jako K vyplacení.')
      }

      if (
        record.current_draft_batch_id !== null &&
        record.current_draft_batch_id !== batch.id
      ) {
        throw new Error('Zakázka je už uzamčená v jiné draft dávce.')
      }

      const profitAmount = normalizeWholeCurrency(
        typeof record.manual_profit_amount === 'number'
          ? record.manual_profit_amount
          : record.base_profit_amount
      )
      const commissionRate = getCommissionRateForSalesOwner(batch.sales_owner)
      const commissionAmount = roundCommissionAmount(profitAmount * commissionRate)

      const { data: existingItem } = await supabase
        .from('provize_payout_batch_items')
        .select('id')
        .eq('batch_id', batch.id)
        .eq('provize_record_id', record.id)
        .maybeSingle()

      if (!existingItem) {
        const { data: maxSortItems } = await supabase
          .from('provize_payout_batch_items')
          .select('sort_order')
          .eq('batch_id', batch.id)
          .order('sort_order', { ascending: false })
          .limit(1)

        const nextSortOrder =
          typeof maxSortItems?.[0]?.sort_order === 'number'
            ? maxSortItems[0].sort_order + 1
            : 0

        const { error: insertItemError } = await supabase
          .from('provize_payout_batch_items')
          .insert({
            batch_id: batch.id,
            provize_record_id: record.id,
            sort_order: nextSortOrder,
            sales_owner: batch.sales_owner,
            job_finance_id: record.job_finance_id,
            job_id: record.job_id,
            job_number: record.job_number,
            company_name: record.company_name,
            start_at: record.start_at,
            end_at: record.end_at,
            site_address: record.site_address,
            store_number: record.store_number,
            invoice_number: record.invoice_number,
            sale_amount: normalizeWholeCurrency(record.sale_amount),
            cost_amount: normalizeWholeCurrency(record.cost_amount),
            profit_amount: profitAmount,
            commission_rate: commissionRate,
            commission_amount: commissionAmount,
          })

        if (insertItemError) {
          throw new Error('Zakázku se nepodařilo přidat do draft dávky.')
        }
      }

      const { error: lockError } = await supabase
        .from('provize_records')
        .update({ current_draft_batch_id: batch.id })
        .eq('id', record.id)

      if (lockError) {
        throw new Error('Zakázku se nepodařilo uzamknout do draft dávky.')
      }
    } else {
      const { data: existingItem, error: existingItemError } = await supabase
        .from('provize_payout_batch_items')
        .select('id')
        .eq('batch_id', batch.id)
        .eq('provize_record_id', provizeRecordId)
        .maybeSingle()

      if (existingItemError) {
        throw new Error('Nepodařilo se načíst položku draft dávky.')
      }

      if (existingItem?.id) {
        const { error: deleteItemError } = await supabase
          .from('provize_payout_batch_items')
          .delete()
          .eq('id', existingItem.id)

        if (deleteItemError) {
          throw new Error('Zakázku se nepodařilo odebrat z draft dávky.')
        }
      }

      const { error: unlockError } = await supabase
        .from('provize_records')
        .update({ current_draft_batch_id: null })
        .eq('id', provizeRecordId)
        .is('confirmed_batch_id', null)

      if (unlockError) {
        throw new Error('Zakázku se nepodařilo vrátit zpět mezi kandidáty.')
      }
    }

    const refreshedBatch = await getDraftBatchById(batch.id)
    const draft = await buildDraftData(refreshedBatch, true)

    revalidateProvizePaths()

    return {
      success: true,
      draft,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Draft dávku se nepodařilo upravit.',
    }
  }
}

export async function confirmProvizePayoutDraftAction(
  batchId: string,
  items: DraftItemInput[],
  adjustments: DraftAdjustmentInput[]
): Promise<ConfirmDraftActionResult> {
  const access = await requireProvizeAdmin()

  if (!access.success) {
    return { success: false, error: access.error }
  }

  try {
    const supabase = getServiceSupabase()
    const batch = await getDraftBatchById(batchId)
    await persistDraftState(batch, items, adjustments)

    const { data: refreshedItems, error: refreshedItemsError } = await supabase
      .from('provize_payout_batch_items')
      .select('provize_record_id')
      .eq('batch_id', batch.id)

    if (refreshedItemsError) {
      throw new Error('Nepodařilo se ověřit položky pro potvrzení výplaty.')
    }

    const recordIds = (refreshedItems ?? []).map((item) => item.provize_record_id)

    if (recordIds.length === 0) {
      throw new Error('Výplatní dávka neobsahuje žádné zakázky.')
    }

    const { error: confirmBatchError } = await supabase
      .from('provize_payout_batches')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: access.userId,
      })
      .eq('id', batch.id)

    if (confirmBatchError) {
      throw new Error('Nepodařilo se potvrdit výplatní dávku.')
    }

    const { error: markPaidError } = await supabase
      .from('provize_records')
      .update({
        confirmed_batch_id: batch.id,
        current_draft_batch_id: null,
      })
      .in('id', recordIds)

    if (markPaidError) {
      throw new Error('Nepodařilo se označit provize jako vyplacené.')
    }

    const { error: clearRemainingDraftLocksError } = await supabase
      .from('provize_records')
      .update({ current_draft_batch_id: null })
      .eq('current_draft_batch_id', batch.id)
      .is('confirmed_batch_id', null)

    if (clearRemainingDraftLocksError) {
      throw new Error('Nepodařilo se dočistit zbylé kandidáty draft dávky.')
    }

    revalidateProvizePaths()

    return {
      success: true,
      batchId: batch.id,
      salesOwner: batch.sales_owner,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Výplatní dávku se nepodařilo potvrdit.',
    }
  }
}

export async function deleteProvizePayoutDraftAction(
  batchId: string
): Promise<DeleteDraftActionResult> {
  const access = await requireProvizeAdmin()

  if (!access.success) {
    return { success: false, error: access.error }
  }

  try {
    const supabase = getServiceSupabase()
    const batch = await getDraftBatchById(batchId)

    const { error: unlockError } = await supabase
      .from('provize_records')
      .update({ current_draft_batch_id: null })
      .eq('current_draft_batch_id', batch.id)
      .is('confirmed_batch_id', null)

    if (unlockError) {
      throw new Error('Nepodařilo se vrátit zakázky z draftu zpět mezi kandidáty.')
    }

    const { error: deleteAdjustmentsError } = await supabase
      .from('provize_payout_adjustments')
      .delete()
      .eq('batch_id', batch.id)

    if (deleteAdjustmentsError) {
      throw new Error('Nepodařilo se smazat bonusy a odpočty draftu.')
    }

    const { error: deleteItemsError } = await supabase
      .from('provize_payout_batch_items')
      .delete()
      .eq('batch_id', batch.id)

    if (deleteItemsError) {
      throw new Error('Nepodařilo se smazat položky draftu.')
    }

    const { error: deleteBatchError } = await supabase
      .from('provize_payout_batches')
      .delete()
      .eq('id', batch.id)
      .eq('status', 'draft')

    if (deleteBatchError) {
      throw new Error('Nepodařilo se smazat draft výplatní dávky.')
    }

    revalidateProvizePaths()

    return {
      success: true,
      salesOwner: batch.sales_owner,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Draft dávku se nepodařilo smazat.',
    }
  }
}
