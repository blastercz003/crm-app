import { buildNordFjellaSettlementSummary } from '@/lib/nord-fjella/settlement'
import type {
  NordFjellaPaymentRow,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaStayGuestRow,
} from '@/lib/nord-fjella/types'

export type NordFjellaReportType =
  | 'overview'
  | 'finance'
  | 'guests'
  | 'owner_stays'
  | 'guest_book'

export type NordFjellaFinanceDateBasis = 'supply' | 'payment' | 'stay'

export type NordFjellaReportRange = {
  from: string
  to: string
}

export type NordFjellaFinanceRow = {
  reservation: NordFjellaReservationRow
  servicesNet: number
  servicesVat: number
  servicesGross: number
  vat12Base: number
  vat12Amount: number
  vat21Base: number
  vat21Amount: number
  vatExemptBase: number
  cityTaxAssessed: number
  cityTaxCollected: number
  totalPayable: number
  paid: number
  refunds: number
  remaining: number
}

export type NordFjellaReportData = {
  reservations: NordFjellaReservationRow[]
  rentals: NordFjellaReservationRow[]
  ownerStays: NordFjellaReservationRow[]
  technicalBlocks: NordFjellaReservationRow[]
  guests: NordFjellaStayGuestRow[]
  payments: NordFjellaPaymentRow[]
  financeRows: NordFjellaFinanceRow[]
  metrics: {
    occupiedNights: number
    ownerNights: number
    technicalNights: number
    completedRentals: number
    reservedRentals: number
    cancelledRentals: number
    uniqueGuests: number
    returningGuests: number
    guestStays: number
    guestNights: number
    taxableGuestNights: number
    exemptGuests: number
    cityTaxAssessed: number
    cityTaxCollected: number
    servicesNet: number
    servicesVat: number
    servicesGross: number
    vat12Base: number
    vat12Amount: number
    vat21Base: number
    vat21Amount: number
    vatExemptBase: number
    paymentIncome: number
    paymentRefunds: number
    netCashflow: number
    advanceVat12Base: number
    advanceVat12Amount: number
    advanceVat21Base: number
    advanceVat21Amount: number
    receivable: number
    heldDeposits: number
    refundedDeposits: number
    withheldDeposits: number
    financialIncompleteCount: number
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function toUtcDate(value: string) {
  return new Date(`${value}T12:00:00Z`)
}

function addDays(value: string, days: number) {
  const date = toUtcDate(value)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function validateNordFjellaReportRange(from: string, to: string) {
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    return 'Vyber platné datum od a do.'
  }

  if (Number.isNaN(toUtcDate(from).getTime()) || Number.isNaN(toUtcDate(to).getTime())) {
    return 'Vyber platné datum od a do.'
  }

  if (from > to) return 'Datum „Od“ musí být před datem „Do“.'
  return null
}

export function overlapsNordFjellaReportRange(
  row: { stay_start_date: string; stay_end_date: string },
  range: NordFjellaReportRange
) {
  return row.stay_end_date > range.from && row.stay_start_date <= range.to
}

export function getClippedNordFjellaNightCount(
  row: { stay_start_date: string; stay_end_date: string },
  range: NordFjellaReportRange
) {
  const start = row.stay_start_date > range.from ? row.stay_start_date : range.from
  const rangeEndExclusive = addDays(range.to, 1)
  const end = row.stay_end_date < rangeEndExclusive ? row.stay_end_date : rangeEndExclusive
  return Math.max(0, Math.round((toUtcDate(end).getTime() - toUtcDate(start).getTime()) / 86_400_000))
}

export function parseNordFjellaReportType(value: string | null): NordFjellaReportType {
  return value === 'finance' ||
    value === 'guests' ||
    value === 'owner_stays' ||
    value === 'guest_book'
    ? value
    : 'overview'
}

export function parseNordFjellaFinanceDateBasis(
  value: string | null
): NordFjellaFinanceDateBasis {
  return value === 'payment' || value === 'stay' ? value : 'supply'
}

function isPaymentInRange(payment: NordFjellaPaymentRow, range: NordFjellaReportRange) {
  return payment.transaction_date >= range.from && payment.transaction_date <= range.to
}

function getGuestIdentityKey(guest: NordFjellaStayGuestRow) {
  return `${guest.first_name.trim().toLocaleLowerCase('cs-CZ')}|${guest.last_name
    .trim()
    .toLocaleLowerCase('cs-CZ')}|${guest.birth_date}`
}

export function buildNordFjellaReportData({
  type,
  basis,
  range,
  reservations,
  reservationItems,
  stayGuests,
  payments,
  guestSearch = '',
  cityTaxFilter = 'all',
  today = new Date().toISOString().slice(0, 10),
}: {
  type: NordFjellaReportType
  basis: NordFjellaFinanceDateBasis
  range: NordFjellaReportRange
  reservations: NordFjellaReservationRow[]
  reservationItems: NordFjellaReservationItemRow[]
  stayGuests: NordFjellaStayGuestRow[]
  payments: NordFjellaPaymentRow[]
  guestSearch?: string
  cityTaxFilter?: 'all' | 'liable' | 'exempt' | 'not_applicable'
  today?: string
}): NordFjellaReportData {
  const paymentsInRange = payments.filter((payment) => isPaymentInRange(payment, range))
  const paymentReservationIds = new Set(
    paymentsInRange.map((payment) => payment.reservation_id)
  )

  const filteredReservations = reservations.filter((reservation) => {
    if (type === 'finance' && basis === 'payment') {
      return paymentReservationIds.has(reservation.id)
    }

    if (type === 'finance' && basis === 'supply') {
      const supplyDate = reservation.taxable_supply_date || reservation.stay_end_date
      return supplyDate >= range.from && supplyDate <= range.to
    }

    return overlapsNordFjellaReportRange(reservation, range)
  })

  const reservationMap = new Map(
    filteredReservations.map((reservation) => [reservation.id, reservation])
  )
  const rentalIds = new Set(
    filteredReservations
      .filter((reservation) => reservation.record_type === 'reservation')
      .map((reservation) => reservation.id)
  )

  const normalizedGuestSearch = guestSearch.trim().toLocaleLowerCase('cs-CZ')
  const filteredGuests = stayGuests
    .filter((guest) => {
      const reservation = reservationMap.get(guest.reservation_id)
      if (!reservation || !rentalIds.has(guest.reservation_id)) return false
      if (
        !(type === 'finance' && basis !== 'stay') &&
        !overlapsNordFjellaReportRange(guest, range)
      ) {
        return false
      }
      if (reservation.reservation_status === 'cancelled') return false
      if (
        (type === 'guests' || type === 'guest_book') &&
        reservation.reservation_status !== 'completed' &&
        guest.stay_start_date > today
      ) {
        return false
      }
      if (cityTaxFilter !== 'all' && guest.city_tax_status !== cityTaxFilter) return false
      if (
        normalizedGuestSearch &&
        !`${guest.first_name} ${guest.last_name} ${reservation.reservation_number}`
          .toLocaleLowerCase('cs-CZ')
          .includes(normalizedGuestSearch)
      ) {
        return false
      }
      return true
    })
    .sort((left, right) =>
      `${left.stay_start_date}|${left.last_name}|${left.first_name}`.localeCompare(
        `${right.stay_start_date}|${right.last_name}|${right.first_name}`,
        'cs'
      )
    )

  const itemsByReservationId = new Map<string, NordFjellaReservationItemRow[]>()
  for (const item of reservationItems) {
    const rows = itemsByReservationId.get(item.reservation_id) ?? []
    rows.push(item)
    itemsByReservationId.set(item.reservation_id, rows)
  }

  const guestsByReservationId = new Map<string, NordFjellaStayGuestRow[]>()
  for (const guest of filteredGuests) {
    const rows = guestsByReservationId.get(guest.reservation_id) ?? []
    rows.push(guest)
    guestsByReservationId.set(guest.reservation_id, rows)
  }

  const rentals = filteredReservations.filter(
    (reservation) => reservation.record_type === 'reservation'
  )
  const ownerStays = filteredReservations.filter(
    (reservation) => reservation.record_type === 'owner_block'
  )
  const technicalBlocks = filteredReservations.filter(
    (reservation) => reservation.record_type === 'technical_block'
  )

  const selectedPayments =
    type === 'finance' && basis === 'payment'
      ? paymentsInRange
      : payments.filter((payment) => reservationMap.has(payment.reservation_id))

  const financeRows = rentals.map((reservation) => {
    const settlement = buildNordFjellaSettlementSummary(
      reservation,
      itemsByReservationId.get(reservation.id) ?? []
    )
    const reservationGuests = guestsByReservationId.get(reservation.id) ?? []
    const cityTaxAssessed = reservationGuests.reduce(
      (sum, guest) => sum + Number(guest.city_tax_amount ?? 0),
      0
    )
    const cityTaxCollected = reservationGuests.reduce(
      (sum, guest) => sum + Number(guest.city_tax_collected_amount ?? 0),
      0
    )
    const refunds = Number(reservation.payment_refund_amount ?? 0)
    const totalPayable = settlement.servicesGrossTotal + cityTaxAssessed
    const remaining = totalPayable - settlement.paidTotal

    return {
      reservation,
      servicesNet: settlement.servicesNetTotal,
      servicesVat: settlement.servicesVatTotal,
      servicesGross: settlement.servicesGrossTotal,
      vat12Base: settlement.vat12Base,
      vat12Amount: settlement.vat12Amount,
      vat21Base: settlement.vat21Base,
      vat21Amount: settlement.vat21Amount,
      vatExemptBase: settlement.vatExemptBase,
      cityTaxAssessed,
      cityTaxCollected,
      totalPayable,
      paid: settlement.paidTotal,
      refunds,
      remaining,
    }
  })

  const guestIdentityCounts = new Map<string, number>()
  for (const guest of filteredGuests) {
    const key = getGuestIdentityKey(guest)
    guestIdentityCounts.set(key, (guestIdentityCounts.get(key) ?? 0) + 1)
  }

  const paymentsByReservationId = new Map<string, NordFjellaPaymentRow[]>()
  for (const payment of payments) {
    const rows = paymentsByReservationId.get(payment.reservation_id) ?? []
    rows.push(payment)
    paymentsByReservationId.set(payment.reservation_id, rows)
  }

  const financialIncompleteCount = rentals.filter((reservation) => {
    const reservationGuests = guestsByReservationId.get(reservation.id) ?? []
    const collectedTax = reservationGuests.reduce(
      (sum, guest) => sum + Number(guest.city_tax_collected_amount ?? 0),
      0
    )
    const assessedTax = reservationGuests.reduce(
      (sum, guest) => sum + Number(guest.city_tax_amount ?? 0),
      0
    )
    const receivedServicePayments = (
      paymentsByReservationId.get(reservation.id) ?? []
    ).filter(
      (payment) =>
        payment.direction === 'in' &&
        (payment.transaction_type === 'deposit' || payment.transaction_type === 'balance')
    )
    return (
      !reservation.taxable_supply_date ||
      (reservation.reservation_status === 'completed' &&
        reservation.settlement_status !== 'closed') ||
      (Number(reservation.deposit_paid_amount ?? 0) > 0 && !reservation.deposit_paid_at) ||
      (Number(reservation.balance_paid_amount ?? 0) > 0 && !reservation.balance_paid_at) ||
      receivedServicePayments.some((payment) => !payment.tax_document_number) ||
      collectedTax < assessedTax
    )
  }).length

  const paymentIncome = selectedPayments
    .filter(
      (payment) =>
        payment.direction === 'in' &&
        (payment.transaction_type === 'deposit' || payment.transaction_type === 'balance')
    )
    .reduce((sum, payment) => sum + Number(payment.amount), 0)
  const paymentRefunds = selectedPayments
    .filter((payment) => payment.transaction_type === 'refund')
    .reduce((sum, payment) => sum + Number(payment.amount), 0)

  const heldDeposits = rentals.reduce(
    (sum, reservation) =>
      sum +
      Math.max(
        Number(reservation.security_deposit_received ? reservation.security_deposit_amount : 0) -
          Number(reservation.security_deposit_refund_amount ?? 0) -
          Number(reservation.security_deposit_withheld_amount ?? 0),
        0
      ),
    0
  )

  return {
    reservations: filteredReservations,
    rentals,
    ownerStays,
    technicalBlocks,
    guests: filteredGuests,
    payments: selectedPayments,
    financeRows,
    metrics: {
      occupiedNights: rentals
        .filter((reservation) => reservation.reservation_status !== 'cancelled')
        .reduce(
          (sum, reservation) => sum + getClippedNordFjellaNightCount(reservation, range),
          0
        ),
      ownerNights: ownerStays.reduce(
        (sum, reservation) => sum + getClippedNordFjellaNightCount(reservation, range),
        0
      ),
      technicalNights: technicalBlocks.reduce(
        (sum, reservation) => sum + getClippedNordFjellaNightCount(reservation, range),
        0
      ),
      completedRentals: rentals.filter(
        (reservation) => reservation.reservation_status === 'completed'
      ).length,
      reservedRentals: rentals.filter(
        (reservation) =>
          reservation.reservation_status === 'reserved' ||
          reservation.reservation_status === 'inquiry'
      ).length,
      cancelledRentals: rentals.filter(
        (reservation) => reservation.reservation_status === 'cancelled'
      ).length,
      uniqueGuests: guestIdentityCounts.size,
      returningGuests: [...guestIdentityCounts.values()].filter((count) => count > 1).length,
      guestStays: new Set(filteredGuests.map((guest) => guest.reservation_id)).size,
      guestNights: filteredGuests.reduce(
        (sum, guest) => sum + getClippedNordFjellaNightCount(guest, range),
        0
      ),
      taxableGuestNights: filteredGuests.reduce(
        (sum, guest) =>
          sum +
          (guest.city_tax_status === 'liable'
            ? Math.min(
                Number(guest.city_tax_nights ?? 0),
                getClippedNordFjellaNightCount(guest, range)
              )
            : 0),
        0
      ),
      exemptGuests: filteredGuests.filter((guest) => guest.city_tax_status === 'exempt').length,
      cityTaxAssessed: roundCurrency(
        filteredGuests.reduce((sum, guest) => sum + Number(guest.city_tax_amount ?? 0), 0)
      ),
      cityTaxCollected: roundCurrency(
        filteredGuests.reduce(
          (sum, guest) => sum + Number(guest.city_tax_collected_amount ?? 0),
          0
        )
      ),
      servicesNet: roundCurrency(
        financeRows.reduce((sum, row) => sum + row.servicesNet, 0)
      ),
      servicesVat: roundCurrency(
        financeRows.reduce((sum, row) => sum + row.servicesVat, 0)
      ),
      servicesGross: roundCurrency(
        financeRows.reduce((sum, row) => sum + row.servicesGross, 0)
      ),
      vat12Base: roundCurrency(financeRows.reduce((sum, row) => sum + row.vat12Base, 0)),
      vat12Amount: roundCurrency(
        financeRows.reduce((sum, row) => sum + row.vat12Amount, 0)
      ),
      vat21Base: roundCurrency(financeRows.reduce((sum, row) => sum + row.vat21Base, 0)),
      vat21Amount: roundCurrency(
        financeRows.reduce((sum, row) => sum + row.vat21Amount, 0)
      ),
      vatExemptBase: roundCurrency(
        financeRows.reduce((sum, row) => sum + row.vatExemptBase, 0)
      ),
      paymentIncome: roundCurrency(paymentIncome),
      paymentRefunds: roundCurrency(paymentRefunds),
      netCashflow: roundCurrency(paymentIncome - paymentRefunds),
      advanceVat12Base: roundCurrency(
        selectedPayments.reduce((sum, payment) => sum + Number(payment.vat_12_base ?? 0), 0)
      ),
      advanceVat12Amount: roundCurrency(
        selectedPayments.reduce((sum, payment) => sum + Number(payment.vat_12_amount ?? 0), 0)
      ),
      advanceVat21Base: roundCurrency(
        selectedPayments.reduce((sum, payment) => sum + Number(payment.vat_21_base ?? 0), 0)
      ),
      advanceVat21Amount: roundCurrency(
        selectedPayments.reduce((sum, payment) => sum + Number(payment.vat_21_amount ?? 0), 0)
      ),
      receivable: roundCurrency(
        financeRows.reduce((sum, row) => sum + Math.max(row.remaining, 0), 0)
      ),
      heldDeposits: roundCurrency(heldDeposits),
      refundedDeposits: roundCurrency(
        rentals.reduce(
          (sum, reservation) =>
            sum + Number(reservation.security_deposit_refund_amount ?? 0),
          0
        )
      ),
      withheldDeposits: roundCurrency(
        rentals.reduce(
          (sum, reservation) =>
            sum + Number(reservation.security_deposit_withheld_amount ?? 0),
          0
        )
      ),
      financialIncompleteCount,
    },
  }
}
