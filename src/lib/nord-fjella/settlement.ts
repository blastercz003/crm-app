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
  vatRate: number
  netTotal: number
  vatAmount: number
  grossTotal: number
  total: number
  note: string | null
}

export type NordFjellaSettlementSummary = {
  nights: number
  lines: NordFjellaComputedSettlementLine[]
  servicesNetTotal: number
  servicesVatTotal: number
  servicesGrossTotal: number
  outsideVatTotal: number
  totalPayable: number
  subtotalExcludingDeposit: number
  paidTotal: number
  requestedDepositAmount: number
  remainingToPay: number
  depositReceivedAmount: number
  depositRefundAmount: number
  depositWithheldAmount: number
  vat12Base: number
  vat12Amount: number
  vat12Gross: number
  vat21Base: number
  vat21Amount: number
  vat21Gross: number
  vatExemptBase: number
  vat12Total: number
  vat21Total: number
  vatExemptTotal: number
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function getVatRate(vatMode: NordFjellaVatMode) {
  if (vatMode === 'vat_12') return 12
  if (vatMode === 'vat_21') return 21
  return 0
}

function createLine(params: {
  key: string
  label: string
  quantity: number
  unit: string
  unitPrice: number
  vatMode: NordFjellaVatMode
  note: string | null
}): NordFjellaComputedSettlementLine {
  const vatRate = getVatRate(params.vatMode)
  const netTotal = roundCurrency(params.quantity * params.unitPrice)
  const vatAmount = roundCurrency(netTotal * (vatRate / 100))
  const grossTotal = roundCurrency(netTotal + vatAmount)

  return {
    ...params,
    vatRate,
    netTotal,
    vatAmount,
    grossTotal,
    total: grossTotal,
  }
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

  if (
    row.reservation_status !== 'cancelled' &&
    Number(row.accommodation_night_rate ?? 0) !== 0
  ) {
    lines.push(
      createLine({
        key: 'accommodation',
        label: 'Ubytování',
        quantity: nights,
        unit: 'noc',
        unitPrice: Number(row.accommodation_night_rate ?? 0),
        vatMode: Number(row.accommodation_vat_rate ?? 0) === 21 ? 'vat_21' : 'vat_12',
        note: null,
      })
    )
  }

  if (row.reservation_status !== 'cancelled' && Number(row.cleaning_fee ?? 0) !== 0) {
    lines.push(
      createLine({
        key: 'cleaning',
        label: 'Úklid',
        quantity: 1,
        unit: 'ks',
        unitPrice: Number(row.cleaning_fee ?? 0),
        vatMode: Number(row.cleaning_fee_vat_rate ?? 0) === 21 ? 'vat_21' : 'vat_12',
        note: null,
      })
    )
  }

  const cityTaxTotal =
    Number(row.city_tax_rate ?? 0) * Number(row.city_tax_person_count ?? 0) * nights
  if (row.reservation_status !== 'cancelled' && cityTaxTotal !== 0) {
    lines.push(
      createLine({
        key: 'city_tax',
        label: 'Místní poplatek z pobytu',
        quantity: Number(row.city_tax_person_count ?? 0) * nights,
        unit: 'os./noc',
        unitPrice: Number(row.city_tax_rate ?? 0),
        vatMode: 'outside_vat',
        note: null,
      })
    )
  }

  if (Number(row.cancellation_fee_amount ?? 0) !== 0) {
    lines.push(
      createLine({
        key: 'cancellation_fee',
        label: 'Storno poplatek',
        quantity: 1,
        unit: 'ks',
        unitPrice: Number(row.cancellation_fee_amount ?? 0),
        vatMode: Number(row.cancellation_fee_vat_rate ?? 12) === 21 ? 'vat_21' : 'vat_12',
        note: null,
      })
    )
  }

  for (const item of extraItems) {
    lines.push(
      createLine({
        key: item.id,
        label: item.label,
        quantity: Number(item.quantity ?? 0),
        unit: item.unit,
        unitPrice: Number(item.unit_price ?? 0),
        vatMode: item.vat_mode,
        note: item.note ?? null,
      })
    )
  }

  const vat12Lines = lines.filter((line) => line.vatMode === 'vat_12')
  const vat21Lines = lines.filter((line) => line.vatMode === 'vat_21')
  const vatExemptLines = lines.filter((line) => line.vatMode === 'vat_exempt')
  const outsideVatLines = lines.filter((line) => line.vatMode === 'outside_vat')
  const serviceLines = lines.filter((line) => line.vatMode !== 'outside_vat')

  const servicesNetTotal = roundCurrency(
    serviceLines.reduce((sum, line) => sum + line.netTotal, 0)
  )
  const servicesVatTotal = roundCurrency(
    serviceLines.reduce((sum, line) => sum + line.vatAmount, 0)
  )
  const servicesGrossTotal = roundCurrency(servicesNetTotal + servicesVatTotal)
  const outsideVatTotal = roundCurrency(
    outsideVatLines.reduce((sum, line) => sum + line.grossTotal, 0)
  )
  const totalPayable = roundCurrency(servicesGrossTotal + outsideVatTotal)
  const paidTotal = roundCurrency(
    Number(row.deposit_paid_amount ?? 0) +
      Number(row.balance_paid_amount ?? 0) -
      Number(row.payment_refund_amount ?? 0)
  )
  const requestedDepositAmount = Number(row.requested_deposit_amount ?? 0)
  const depositReceivedAmount = row.security_deposit_received
    ? Number(row.security_deposit_amount ?? 0)
    : 0
  const depositRefundAmount = Number(row.security_deposit_refund_amount ?? 0)
  const depositWithheldAmount = Number(row.security_deposit_withheld_amount ?? 0)
  const vat12Base = roundCurrency(vat12Lines.reduce((sum, line) => sum + line.netTotal, 0))
  const vat12Amount = roundCurrency(vat12Lines.reduce((sum, line) => sum + line.vatAmount, 0))
  const vat21Base = roundCurrency(vat21Lines.reduce((sum, line) => sum + line.netTotal, 0))
  const vat21Amount = roundCurrency(vat21Lines.reduce((sum, line) => sum + line.vatAmount, 0))
  const vatExemptBase = roundCurrency(
    vatExemptLines.reduce((sum, line) => sum + line.netTotal, 0)
  )

  return {
    nights,
    lines,
    servicesNetTotal,
    servicesVatTotal,
    servicesGrossTotal,
    outsideVatTotal,
    totalPayable,
    subtotalExcludingDeposit: totalPayable,
    paidTotal,
    requestedDepositAmount,
    remainingToPay: roundCurrency(totalPayable - paidTotal),
    depositReceivedAmount,
    depositRefundAmount,
    depositWithheldAmount,
    vat12Base,
    vat12Amount,
    vat12Gross: roundCurrency(vat12Base + vat12Amount),
    vat21Base,
    vat21Amount,
    vat21Gross: roundCurrency(vat21Base + vat21Amount),
    vatExemptBase,
    vat12Total: vat12Base,
    vat21Total: vat21Base,
    vatExemptTotal: vatExemptBase,
  }
}
