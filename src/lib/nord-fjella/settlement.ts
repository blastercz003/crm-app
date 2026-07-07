import type {
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaVatMode,
} from '@/lib/nord-fjella/types'

export type NordFjellaComputedSettlementLine = {
  key: string
  label: string
  quantity: number
  unit: string
  unitPrice: number
  vatMode: NordFjellaVatMode
  total: number
  note: string | null
}

export type NordFjellaSettlementSummary = {
  nights: number
  lines: NordFjellaComputedSettlementLine[]
  subtotalExcludingDeposit: number
  paidTotal: number
  requestedDepositAmount: number
  remainingToPay: number
  depositReceivedAmount: number
  depositRefundAmount: number
  depositWithheldAmount: number
  vat12Total: number
  vat21Total: number
  vatExemptTotal: number
}

export function getNordFjellaNightCount(row: NordFjellaReservationRow) {
  const start = new Date(`${row.stay_start_date}T12:00:00Z`)
  const end = new Date(`${row.stay_end_date}T12:00:00Z`)
  const diff = end.getTime() - start.getTime()
  return Math.max(1, Math.round(diff / 86_400_000))
}

export function buildNordFjellaSettlementSummary(
  row: NordFjellaReservationRow,
  extraItems: NordFjellaReservationItemRow[] = []
): NordFjellaSettlementSummary {
  const nights = getNordFjellaNightCount(row)
  const lines: NordFjellaComputedSettlementLine[] = []

  if (Number(row.accommodation_night_rate ?? 0) !== 0) {
    lines.push({
      key: 'accommodation',
      label: 'Ubytování',
      quantity: nights,
      unit: 'noc',
      unitPrice: Number(row.accommodation_night_rate ?? 0),
      vatMode: Number(row.accommodation_vat_rate ?? 0) === 21 ? 'vat_21' : 'vat_12',
      total: nights * Number(row.accommodation_night_rate ?? 0),
      note: null,
    })
  }

  if (Number(row.cleaning_fee ?? 0) !== 0) {
    lines.push({
      key: 'cleaning',
      label: 'Úklid',
      quantity: 1,
      unit: 'ks',
      unitPrice: Number(row.cleaning_fee ?? 0),
      vatMode: Number(row.cleaning_fee_vat_rate ?? 0) === 21 ? 'vat_21' : 'vat_12',
      total: Number(row.cleaning_fee ?? 0),
      note: null,
    })
  }

  const cityTaxTotal = Number(row.city_tax_rate ?? 0) * Number(row.city_tax_person_count ?? 0) * nights
  if (cityTaxTotal !== 0) {
    lines.push({
      key: 'city_tax',
      label: 'Místní poplatek z pobytu',
      quantity: Number(row.city_tax_person_count ?? 0) * nights,
      unit: 'os./noc',
      unitPrice: Number(row.city_tax_rate ?? 0),
      vatMode: 'vat_exempt',
      total: cityTaxTotal,
      note: null,
    })
  }

  if (Number(row.cancellation_fee_amount ?? 0) !== 0) {
    lines.push({
      key: 'cancellation_fee',
      label: 'Storno poplatek',
      quantity: 1,
      unit: 'ks',
      unitPrice: Number(row.cancellation_fee_amount ?? 0),
      vatMode: 'vat_12',
      total: Number(row.cancellation_fee_amount ?? 0),
      note: null,
    })
  }

  for (const item of extraItems) {
    const quantity = Number(item.quantity ?? 0)
    const unitPrice = Number(item.unit_price ?? 0)
    lines.push({
      key: item.id,
      label: item.label,
      quantity,
      unit: item.unit,
      unitPrice,
      vatMode: item.vat_mode,
      total: quantity * unitPrice,
      note: item.note ?? null,
    })
  }

  const subtotalExcludingDeposit = lines.reduce((sum, line) => sum + line.total, 0)
  const paidTotal = Number(row.deposit_paid_amount ?? 0) + Number(row.balance_paid_amount ?? 0)
  const requestedDepositAmount = Number(row.requested_deposit_amount ?? 0)
  const depositReceivedAmount = row.security_deposit_received
    ? Number(row.security_deposit_amount ?? 0)
    : 0
  const depositRefundAmount = Number(row.security_deposit_refund_amount ?? 0)
  const depositWithheldAmount = Number(row.security_deposit_withheld_amount ?? 0)

  return {
    nights,
    lines,
    subtotalExcludingDeposit,
    paidTotal,
    requestedDepositAmount,
    remainingToPay: subtotalExcludingDeposit - paidTotal,
    depositReceivedAmount,
    depositRefundAmount,
    depositWithheldAmount,
    vat12Total: lines.filter((line) => line.vatMode === 'vat_12').reduce((sum, line) => sum + line.total, 0),
    vat21Total: lines.filter((line) => line.vatMode === 'vat_21').reduce((sum, line) => sum + line.total, 0),
    vatExemptTotal: lines
      .filter((line) => line.vatMode === 'vat_exempt')
      .reduce((sum, line) => sum + line.total, 0),
  }
}
