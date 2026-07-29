export type RentalServiceAdvanceHistoryRow = {
  id: string
  rental_id: string
  effective_from: string
  monthly_advance: string | number
  note: string | null
  created_at?: string
  updated_at?: string
}

export type RentalRentHistoryRow = {
  id: string
  rental_id: string
  effective_from: string
  monthly_rent: string | number
  note: string | null
  created_at?: string
  updated_at?: string
}

export type RentalServiceSettlementAdvanceMonthRow = {
  id: string
  settlement_id: string
  month: string
  monthly_advance: string | number
  source_advance_id: string | null
  source_effective_from: string | null
  created_at?: string
}

export type RentalServiceSettlementRow = {
  id: string
  asset_id: string
  rental_id: string
  settlement_code: string
  period_from: string
  period_to: string
  tenant_name_snapshot: string
  tenant_contact_snapshot: string | null
  status: 'draft' | 'closed'
  electricity_amount: number
  hot_water_heating_amount: number
  space_heating_amount: number
  common_area_cleaning_amount: number
  cold_water_sewer_amount: number
  hot_water_sewer_amount: number
  advance_payments_total_amount: number
  service_total_amount: number
  balance_amount: number
  settled_on: string | null
  settled_by: string | null
  settled_note: string | null
  note: string | null
  closed_at: string | null
  closed_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type RentalServiceSettlementFileRow = {
  id: string
  settlement_id: string
  title: string | null
  file_name: string
  storage_bucket: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number
  uploaded_by: string | null
  created_at: string
  updated_at: string
}

export type RentalServiceSettlementCustomItemRow = {
  id: string
  settlement_id: string
  title: string
  amount: number
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type RentalServiceSettlementLineItem = {
  key: string
  title: string
  amount: number
  kind: 'fixed' | 'custom'
}

export type RentalServiceSettlementMonthBreakdown = {
  month: string
  monthlyAdvance: number
  sourceAdvanceId: string | null
}

export type RentalServiceAdvanceCalculationResult = {
  totalAdvance: number
  monthBreakdown: RentalServiceSettlementMonthBreakdown[]
}

export function getRentForMonth(params: {
  history: RentalRentHistoryRow[]
  month: string
}) {
  const monthStart = normalizeMonthStart(params.month)
  if (!monthStart) return null

  const applicable = [...params.history]
    .sort((left, right) => String(right.effective_from).localeCompare(String(left.effective_from)))
    .find((entry) => String(entry.effective_from) <= monthStart)

  if (!applicable) return null

  const monthlyRent = Number(applicable.monthly_rent)
  return Number.isFinite(monthlyRent) ? monthlyRent : null
}

export function buildAdvanceCalculationFromSnapshot(
  rows: RentalServiceSettlementAdvanceMonthRow[]
): RentalServiceAdvanceCalculationResult {
  const monthBreakdown = [...rows]
    .sort((left, right) => String(left.month).localeCompare(String(right.month)))
    .map((entry) => ({
      month: String(entry.month).slice(0, 7),
      monthlyAdvance: Math.round(Number(entry.monthly_advance) || 0),
      sourceAdvanceId: entry.source_advance_id,
    }))

  return {
    totalAdvance: monthBreakdown.reduce((sum, entry) => sum + entry.monthlyAdvance, 0),
    monthBreakdown,
  }
}

export function buildSettlementLineItems(params: {
  settlement: Pick<
    RentalServiceSettlementRow,
    | 'electricity_amount'
    | 'hot_water_heating_amount'
    | 'space_heating_amount'
    | 'common_area_cleaning_amount'
    | 'cold_water_sewer_amount'
    | 'hot_water_sewer_amount'
  >
  customItems: Pick<RentalServiceSettlementCustomItemRow, 'id' | 'title' | 'amount' | 'sort_order'>[]
}) {
  const fixedItems: RentalServiceSettlementLineItem[] = [
    { key: 'electricity', title: 'Spotřeba el. energie', amount: params.settlement.electricity_amount, kind: 'fixed' },
    { key: 'hot_water_heating', title: 'Teplo - ohřev TV', amount: params.settlement.hot_water_heating_amount, kind: 'fixed' },
    { key: 'space_heating', title: 'Teplo - otop', amount: params.settlement.space_heating_amount, kind: 'fixed' },
    { key: 'common_area_cleaning', title: 'Úklid spol. prostor', amount: params.settlement.common_area_cleaning_amount, kind: 'fixed' },
    { key: 'cold_water_sewer', title: 'Vodné a stočné SV', amount: params.settlement.cold_water_sewer_amount, kind: 'fixed' },
    { key: 'hot_water_sewer', title: 'Vodné a stočné TV', amount: params.settlement.hot_water_sewer_amount, kind: 'fixed' },
  ]

  const customLineItems: RentalServiceSettlementLineItem[] = [...params.customItems]
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order
      }

      return left.id.localeCompare(right.id)
    })
    .map((item) => ({
      key: `custom-${item.id}`,
      title: item.title,
      amount: item.amount,
      kind: 'custom' as const,
    }))

  return [...fixedItems, ...customLineItems]
}

function parseMonthStart(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})(?:-01)?$/)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null
  }

  if (month < 1 || month > 12) {
    return null
  }

  return { year, month }
}

function monthStartToIso(year: number, month: number) {
  const normalizedYear = year + Math.floor((month - 1) / 12)
  const normalizedMonth = ((month - 1) % 12) + 1
  const monthString = String(normalizedMonth).padStart(2, '0')
  return `${normalizedYear}-${monthString}-01`
}

function compareMonthStarts(left: { year: number; month: number }, right: { year: number; month: number }) {
  if (left.year !== right.year) {
    return left.year - right.year
  }

  return left.month - right.month
}

export function normalizeMonthStart(value: string) {
  const parsed = parseMonthStart(value)

  if (parsed) {
    return monthStartToIso(parsed.year, parsed.month)
  }

  const fullDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (fullDateMatch && fullDateMatch[3] === '01') {
    return `${fullDateMatch[1]}-${fullDateMatch[2]}-01`
  }

  return null
}

function formatPeriodCode(value: string) {
  const parsed = parseMonthStart(value)

  if (!parsed) {
    return null
  }

  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}`
}

export function formatSettlementCode(periodFrom: string, periodTo: string) {
  const from = formatPeriodCode(periodFrom)
  const to = formatPeriodCode(periodTo)

  if (!from || !to) {
    return null
  }

  return `Vyúčtování ${from} - ${to}`
}

export function enumerateMonthStarts(periodFrom: string, periodTo: string) {
  const start = parseMonthStart(periodFrom)
  const end = parseMonthStart(periodTo)

  if (!start || !end || compareMonthStarts(start, end) > 0) {
    return []
  }

  const months: string[] = []
  let year = start.year
  let month = start.month

  while (compareMonthStarts({ year, month }, end) <= 0) {
    months.push(monthStartToIso(year, month))
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return months
}

export function calculateAdvancePaymentsForPeriod(params: {
  history: RentalServiceAdvanceHistoryRow[]
  periodFrom: string
  periodTo: string
}): RentalServiceAdvanceCalculationResult {
  const monthStarts = enumerateMonthStarts(params.periodFrom, params.periodTo)

  const sortedHistory = [...params.history].sort((left, right) => {
    return String(left.effective_from).localeCompare(String(right.effective_from))
  })

  const monthBreakdown = monthStarts.map((monthStart) => {
    const applicableHistory = [...sortedHistory]
      .reverse()
      .find((entry) => String(entry.effective_from) <= monthStart)

    const monthlyAdvance = applicableHistory
      ? Math.round(Number(applicableHistory.monthly_advance) || 0)
      : 0

    return {
      month: monthStart.slice(0, 7),
      monthlyAdvance,
      sourceAdvanceId: applicableHistory?.id ?? null,
    }
  })

  const totalAdvance = monthBreakdown.reduce((sum, entry) => sum + entry.monthlyAdvance, 0)

  return { totalAdvance, monthBreakdown }
}
