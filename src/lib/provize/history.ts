import { createClient } from '@/lib/supabase/server'
import {
  canViewProvizeSection,
  resolveProvizeSalesOwnerName,
  type ProvizeSalesOwner,
} from '@/lib/provize/access'
import { getServiceRoleClient } from '@/lib/supabase/service'

type ProfileAccessRow = {
  role: string | null
  name: string | null
  can_view_provize: boolean | null
}

type HistoryBatchRow = {
  id: string
  sales_owner: ProvizeSalesOwner
  status: 'draft' | 'confirmed'
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

type HistoryBatchItemRow = {
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
}

type HistoryAdjustmentRow = {
  id: string
  batch_id: string
  sort_order: number
  item_type: 'bonus' | 'deduction'
  label: string
  amount: number
}

export type ProvizeHistoryBatchItem = {
  id: string
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

export type ProvizeHistoryAdjustment = {
  id: string
  itemType: 'bonus' | 'deduction'
  label: string
  amount: number
}

export type ProvizeHistoryBatch = {
  id: string
  salesOwner: ProvizeSalesOwner
  confirmedAt: string
  createdAt: string
  updatedAt: string
  itemCount: number
  commissionSubtotal: number
  adjustmentTotal: number
  payoutTotal: number
  items: ProvizeHistoryBatchItem[]
  adjustments: ProvizeHistoryAdjustment[]
}

export type ProvizeHistoryPayload = {
  isAdmin: boolean
  selectedOwner: ProvizeSalesOwner
  batches: ProvizeHistoryBatch[]
}

export type ProvizeHistoryAccess =
  | {
      success: true
      userId: string
      isAdmin: boolean
      salesOwner: ProvizeSalesOwner | null
    }
  | {
      success: false
      error: string
    }

function getServiceSupabase() {
  const supabase = getServiceRoleClient()

  if (!supabase) {
    throw new Error('Chybí Supabase service role client pro historii výplat provizí.')
  }

  return supabase
}

function normalizeWholeCurrency(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0)
}

export async function requireProvizeHistoryAccess(): Promise<ProvizeHistoryAccess> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      success: false,
      error: 'Neautorizovaný přístup.',
    }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, name, can_view_provize')
    .eq('id', user.id)
    .single<ProfileAccessRow>()

  if (error || !profile) {
    return {
      success: false,
      error: 'Nepodařilo se ověřit přístup do historie provizí.',
    }
  }

  if (!canViewProvizeSection(profile.role, profile)) {
    return {
      success: false,
      error: 'Do historie provizí nemáš přístup.',
    }
  }

  return {
    success: true,
    userId: user.id,
    isAdmin: profile.role === 'admin',
    salesOwner: resolveProvizeSalesOwnerName(profile.name),
  }
}

export async function getProvizeHistoryPayload(
  access: Extract<ProvizeHistoryAccess, { success: true }>,
  requestedOwner?: ProvizeSalesOwner
): Promise<ProvizeHistoryPayload> {
  const selectedOwner = access.isAdmin ? requestedOwner : access.salesOwner

  if (!selectedOwner) {
    throw new Error('Nepodařilo se určit obchodníka pro historii výplat.')
  }

  const supabase = getServiceSupabase()
  const { data: batches, error: batchesError } = await supabase
    .from('provize_payout_batches')
    .select('id, sales_owner, status, created_at, updated_at, confirmed_at')
    .eq('sales_owner', selectedOwner)
    .eq('status', 'confirmed')
    .order('confirmed_at', { ascending: false })
    .returns<HistoryBatchRow[]>()

  if (batchesError) {
    throw new Error('Nepodařilo se načíst historii výplat.')
  }

  const normalizedBatches = (batches ?? []).filter(
    (batch): batch is HistoryBatchRow & { confirmed_at: string } => Boolean(batch.confirmed_at)
  )

  const batchIds = normalizedBatches.map((batch) => batch.id)

  const [{ data: items, error: itemsError }, { data: adjustments, error: adjustmentsError }] =
    batchIds.length === 0
      ? [{ data: [], error: null }, { data: [], error: null }]
      : await Promise.all([
          supabase
            .from('provize_payout_batch_items')
            .select('*')
            .in('batch_id', batchIds)
            .order('sort_order', { ascending: true })
            .returns<HistoryBatchItemRow[]>(),
          supabase
            .from('provize_payout_adjustments')
            .select('*')
            .in('batch_id', batchIds)
            .order('sort_order', { ascending: true })
            .returns<HistoryAdjustmentRow[]>(),
        ])

  if (itemsError) {
    throw new Error('Nepodařilo se načíst položky historie výplat.')
  }

  if (adjustmentsError) {
    throw new Error('Nepodařilo se načíst bonusy a odpočty historie výplat.')
  }

  const itemsByBatchId = new Map<string, ProvizeHistoryBatchItem[]>()
  const adjustmentsByBatchId = new Map<string, ProvizeHistoryAdjustment[]>()

  for (const item of (items ?? []) as HistoryBatchItemRow[]) {
    const bucket = itemsByBatchId.get(item.batch_id) ?? []
    bucket.push({
      id: item.id,
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
    })
    itemsByBatchId.set(item.batch_id, bucket)
  }

  for (const item of (adjustments ?? []) as HistoryAdjustmentRow[]) {
    const bucket = adjustmentsByBatchId.get(item.batch_id) ?? []
    bucket.push({
      id: item.id,
      itemType: item.item_type,
      label: item.label,
      amount: normalizeWholeCurrency(item.amount),
    })
    adjustmentsByBatchId.set(item.batch_id, bucket)
  }

  return {
    isAdmin: access.isAdmin,
    selectedOwner,
    batches: normalizedBatches.map((batch) => {
      const batchItems = itemsByBatchId.get(batch.id) ?? []
      const batchAdjustments = adjustmentsByBatchId.get(batch.id) ?? []
      const commissionSubtotal = batchItems.reduce((sum, item) => sum + item.commissionAmount, 0)
      const adjustmentTotal = batchAdjustments.reduce((sum, item) => {
        return sum + (item.itemType === 'bonus' ? item.amount : -item.amount)
      }, 0)

      return {
        id: batch.id,
        salesOwner: batch.sales_owner,
        confirmedAt: batch.confirmed_at,
        createdAt: batch.created_at,
        updatedAt: batch.updated_at,
        itemCount: batchItems.length,
        commissionSubtotal,
        adjustmentTotal,
        payoutTotal: commissionSubtotal + adjustmentTotal,
        items: batchItems,
        adjustments: batchAdjustments,
      }
    }),
  }
}

export async function getProvizeHistoryBatchById(
  access: Extract<ProvizeHistoryAccess, { success: true }>,
  batchId: string
): Promise<ProvizeHistoryBatch> {
  const supabase = getServiceSupabase()
  const { data: batchRow, error: batchError } = await supabase
    .from('provize_payout_batches')
    .select('id, sales_owner, status, created_at, updated_at, confirmed_at')
    .eq('id', batchId)
    .eq('status', 'confirmed')
    .maybeSingle<HistoryBatchRow>()

  if (batchError) {
    throw new Error('Nepodařilo se načíst potvrzenou výplatní dávku.')
  }

  if (!batchRow || !batchRow.confirmed_at) {
    throw new Error('Potvrzená výplatní dávka nebyla nalezena.')
  }

  if (!access.isAdmin && access.salesOwner !== batchRow.sales_owner) {
    throw new Error('K této výplatní dávce nemáš přístup.')
  }

  const payload = await getProvizeHistoryPayload(access, batchRow.sales_owner)
  const batch = payload.batches.find((item) => item.id === batchId)

  if (!batch) {
    throw new Error('Detail výplatní dávky se nepodařilo načíst.')
  }

  return batch
}
