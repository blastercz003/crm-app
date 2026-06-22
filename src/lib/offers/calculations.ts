import type { OfferItemRow } from './types'

export function getOfferItemNetTotal(item: Pick<
  OfferItemRow,
  'quantity' | 'unit_price_without_vat' | 'discount_percent'
>) {
  const quantity = Number(item.quantity) || 0
  const unitPrice = Number(item.unit_price_without_vat) || 0
  const discount = Math.min(Math.max(Number(item.discount_percent) || 0, 0), 100)

  return quantity * unitPrice * (1 - discount / 100)
}

export function getOfferTotals(
  items: Array<Pick<OfferItemRow, 'quantity' | 'unit_price_without_vat' | 'discount_percent' | 'vat_rate'>>
) {
  const subtotalWithoutVat = items.reduce(
    (sum, item) => sum + getOfferItemNetTotal(item),
    0
  )
  const vatTotal = items.reduce(
    (sum, item) => sum + getOfferItemNetTotal(item) * ((Number(item.vat_rate) || 0) / 100),
    0
  )

  return {
    subtotalWithoutVat,
    vatTotal,
    totalWithVat: subtotalWithoutVat + vatTotal,
  }
}

export function formatCurrency(value: number, currency = 'CZK') {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 2,
  }).format(value)
}
