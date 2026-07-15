import { getServiceRoleClient } from '@/lib/supabase/service'
import type { ProvizeSalesOwner } from './access'

type EligibleFinanceJoinRow = {
  id: string
  job_id: string
  invoice_number: string | null
  sale_amount: number | null
  cost_amount: number | null
  job:
    | {
        id: string
        job_number: string
        company_name: string
        sales_owner: string | null
        start_at: string
        end_at: string
        site_address: string | null
        store_number: string | null
      }
    | {
        id: string
        job_number: string
        company_name: string
        sales_owner: string | null
        start_at: string
        end_at: string
        site_address: string | null
        store_number: string | null
      }[]
    | null
}

export type ProvizeRecordRow = {
  id: string
  job_finance_id: string
  job_id: string
  sales_owner: ProvizeSalesOwner
  job_number: string
  company_name: string
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  invoice_number: string
  sale_amount: number
  cost_amount: number
  base_profit_amount: number
  manual_profit_amount: number | null
  approved_for_payout: boolean
  approved_for_payout_at: string | null
  current_draft_batch_id: string | null
  confirmed_batch_id: string | null
  created_at: string
  updated_at: string
}

const PROVIZE_ELIGIBLE_OWNERS: ProvizeSalesOwner[] = ['MICHAL', 'LÍDA']

function isProvizeEligibleOwner(value: string | null | undefined): value is ProvizeSalesOwner {
  return PROVIZE_ELIGIBLE_OWNERS.includes(String(value ?? '').trim().toUpperCase() as ProvizeSalesOwner)
}

export function getCommissionRateForSalesOwner(salesOwner: ProvizeSalesOwner) {
  return salesOwner === 'MICHAL' ? 0.5 : 0.2
}

export function roundCommissionAmount(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0)
}

export function calculateProvizeCostAmount(saleAmount: number, profitAmount: number) {
  const normalizedSale = Math.round(Number.isFinite(saleAmount) ? saleAmount : 0)
  const normalizedProfit = Math.round(Number.isFinite(profitAmount) ? profitAmount : 0)

  return normalizedSale - normalizedProfit
}

export function getEffectiveProfitAmount(row: Pick<ProvizeRecordRow, 'base_profit_amount' | 'manual_profit_amount'>) {
  return typeof row.manual_profit_amount === 'number'
    ? row.manual_profit_amount
    : row.base_profit_amount
}

function normalizeMoney(value: number) {
  return Number(value.toFixed(2))
}

export async function syncProvizeRecordsFromJobFinances() {
  const supabase = getServiceRoleClient()

  if (!supabase) {
    throw new Error('Chybí Supabase service role client pro sekci Provize.')
  }

  const { data, error } = await supabase
    .from('job_finances')
    .select(`
      id,
      job_id,
      invoice_number,
      sale_amount,
      cost_amount,
      job:jobs!inner (
        id,
        job_number,
        company_name,
        sales_owner,
        start_at,
        end_at,
        site_address,
        store_number
      )
    `)

  if (error) {
    throw new Error(`Nepodařilo se načíst podklady pro provize: ${error.message}`)
  }

  const payload = ((data ?? []) as EligibleFinanceJoinRow[])
    .map((item) => {
      const job = Array.isArray(item.job) ? item.job[0] : item.job

      if (!job) return null

      const salesOwner = String(job.sales_owner ?? '').trim().toUpperCase()
      const invoiceNumber = String(item.invoice_number ?? '').trim()

      if (!isProvizeEligibleOwner(salesOwner)) return null
      if (!invoiceNumber) return null
      if (typeof item.sale_amount !== 'number' || typeof item.cost_amount !== 'number') {
        return null
      }

      return {
        job_finance_id: item.id,
        job_id: item.job_id,
        sales_owner: salesOwner,
        job_number: String(job.job_number ?? '').trim(),
        company_name: String(job.company_name ?? '').trim(),
        start_at: job.start_at,
        end_at: job.end_at,
        site_address: job.site_address?.trim() ?? null,
        store_number: job.store_number?.trim() ?? null,
        invoice_number: invoiceNumber,
        sale_amount: normalizeMoney(item.sale_amount),
        cost_amount: normalizeMoney(item.cost_amount),
        base_profit_amount: normalizeMoney(item.sale_amount - item.cost_amount),
      }
    })
    .filter(
      (
        item
      ): item is {
        job_finance_id: string
        job_id: string
        sales_owner: ProvizeSalesOwner
        job_number: string
        company_name: string
        start_at: string
        end_at: string
        site_address: string | null
        store_number: string | null
        invoice_number: string
        sale_amount: number
        cost_amount: number
        base_profit_amount: number
      } => Boolean(item)
    )

  const eligibleFinanceIds = payload.map((item) => item.job_finance_id)

  if (payload.length > 0) {
    const { error: upsertError } = await supabase
      .from('provize_records')
      .upsert(payload, { onConflict: 'job_finance_id' })

    if (upsertError) {
      throw new Error(`Nepodařilo se synchronizovat provizní záznamy: ${upsertError.message}`)
    }
  }

  let pruneRequest = supabase
    .from('provize_records')
    .delete()
    .is('confirmed_batch_id', null)
    .is('current_draft_batch_id', null)

  if (eligibleFinanceIds.length > 0) {
    pruneRequest = pruneRequest.not('job_finance_id', 'in', `(${eligibleFinanceIds.join(',')})`)
  }

  const { data: prunedRows, error: pruneError } = await pruneRequest.select('id')

  if (pruneError) {
    throw new Error(`Nepodařilo se odklidit nezpůsobilé provizní záznamy: ${pruneError.message}`)
  }

  return {
    syncedCount: payload.length,
    prunedCount: (prunedRows ?? []).length,
  }
}
