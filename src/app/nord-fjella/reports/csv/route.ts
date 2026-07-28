import { NextRequest, NextResponse } from 'next/server'
import { canViewNordFjellaSection } from '@/lib/nord-fjella/access'
import {
  buildNordFjellaSettlementSummary,
  getNordFjellaNightCount,
} from '@/lib/nord-fjella/settlement'
import type {
  NordFjellaPaymentRow,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaStayGuestRow,
} from '@/lib/nord-fjella/types'
import { createClient } from '@/lib/supabase/server'

type ReportType = 'overview' | 'finance' | 'guests' | 'owner_stays' | 'guest_book'
type FinanceDateBasis = 'supply' | 'payment' | 'stay'

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function parseReportType(value: string | null): ReportType {
  return value === 'finance' ||
    value === 'guests' ||
    value === 'owner_stays' ||
    value === 'guest_book'
    ? value
    : 'overview'
}

function parseFinanceDateBasis(value: string | null): FinanceDateBasis {
  return value === 'payment' || value === 'stay' ? value : 'supply'
}

function overlapsStay(row: { stay_start_date: string; stay_end_date: string }, from: string, to: string) {
  return row.stay_end_date > from && row.stay_start_date <= to
}

function getDateNightCount(from: string, to: string) {
  return Math.max(
    0,
    Math.round(
      (new Date(`${to}T12:00:00Z`).getTime() -
        new Date(`${from}T12:00:00Z`).getTime()) /
        86_400_000
    )
  )
}

function formatPaymentType(type: NordFjellaPaymentRow['transaction_type']) {
  if (type === 'deposit') return 'Záloha'
  if (type === 'balance') return 'Doplatek'
  if (type === 'refund') return 'Vratka'
  if (type === 'security_deposit_received') return 'Přijetí kauce'
  if (type === 'security_deposit_refund') return 'Vrácení kauce'
  return 'Zadržení kauce'
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, can_view_nord_fjella')
    .eq('id', user.id)
    .single<{ role: string | null; can_view_nord_fjella: boolean | null }>()

  if (!profile || !canViewNordFjellaSection(profile.role, profile)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const type = parseReportType(request.nextUrl.searchParams.get('type'))
  const basis = parseFinanceDateBasis(request.nextUrl.searchParams.get('basis'))
  const from = request.nextUrl.searchParams.get('from') || `${new Date().getFullYear()}-01-01`
  const to = request.nextUrl.searchParams.get('to') || `${new Date().getFullYear()}-12-31`

  const [reservationsResult, guestsResult, itemsResult, paymentsResult] = await Promise.all([
    supabase.from('nord_fjella_reservations').select('*').order('stay_start_date'),
    supabase.from('nord_fjella_stay_guests').select('*').order('stay_start_date'),
    supabase
      .from('nord_fjella_reservation_items')
      .select('*')
      .order('reservation_id')
      .order('sort_order'),
    supabase
      .from('nord_fjella_payments')
      .select('*')
      .order('transaction_date')
      .order('created_at'),
  ])

  if (
    reservationsResult.error ||
    guestsResult.error ||
    itemsResult.error ||
    paymentsResult.error
  ) {
    return new NextResponse('Report se nepodařilo načíst.', { status: 500 })
  }

  const allReservations = (reservationsResult.data ?? []) as NordFjellaReservationRow[]
  const allGuests = (guestsResult.data ?? []) as NordFjellaStayGuestRow[]
  const items = (itemsResult.data ?? []) as NordFjellaReservationItemRow[]
  const payments = (paymentsResult.data ?? []) as NordFjellaPaymentRow[]
  const paymentsInRange = payments.filter(
    (payment) => payment.transaction_date >= from && payment.transaction_date <= to
  )
  const paymentReservationIds = new Set(
    paymentsInRange.map((payment) => payment.reservation_id)
  )
  const reservations =
    type === 'finance' && basis === 'payment'
      ? allReservations.filter((reservation) => paymentReservationIds.has(reservation.id))
      : type === 'finance' && basis === 'supply'
        ? allReservations.filter((reservation) => {
            const supplyDate = reservation.taxable_supply_date || reservation.stay_end_date
            return supplyDate >= from && supplyDate <= to
          })
        : allReservations.filter((reservation) => overlapsStay(reservation, from, to))
  const reservationMap = new Map(
    reservations.map((reservation) => [reservation.id, reservation])
  )
  const rentalGuests = allGuests.filter(
    (guest) =>
      reservationMap.get(guest.reservation_id)?.record_type === 'reservation' &&
      overlapsStay(guest, from, to)
  )
  const itemsByReservationId = new Map<string, NordFjellaReservationItemRow[]>()
  for (const item of items) {
    const rows = itemsByReservationId.get(item.reservation_id) ?? []
    rows.push(item)
    itemsByReservationId.set(item.reservation_id, rows)
  }

  let rows: unknown[][]

  if (type === 'finance') {
    const rentals = reservations.filter(
      (reservation) => reservation.record_type === 'reservation'
    )
    rows = [
      [
        'Rezervace',
        'Externí doklad',
        'Variabilní symbol',
        'Zákazník',
        'IČO',
        'DIČ',
        'Pobyt od',
        'Pobyt do',
        'DUZP',
        'Splatnost doplatku',
        'Základ 12 %',
        'DPH 12 %',
        'Základ 21 %',
        'DPH 21 %',
        'Osvobozeno',
        'Služby bez DPH',
        'DPH celkem',
        'Služby s DPH',
        'Místní poplatek',
        'Celkem k úhradě',
        'Přijato',
        'Vrácené platby',
        'Zbývá uhradit',
        'Vyúčtování',
      ],
      ...rentals.map((reservation) => {
        const settlement = buildNordFjellaSettlementSummary(
          reservation,
          itemsByReservationId.get(reservation.id) ?? []
        )
        return [
          reservation.reservation_number,
          reservation.external_document_number ?? '',
          reservation.variable_symbol,
          reservation.guest_company_name ||
            reservation.guest_full_name ||
            reservation.guest_contact_name ||
            '',
          reservation.guest_ico ?? '',
          reservation.guest_dic ?? '',
          reservation.stay_start_date,
          reservation.stay_end_date,
          reservation.taxable_supply_date || reservation.stay_end_date,
          reservation.balance_due_date ?? '',
          settlement.vat12Base,
          settlement.vat12Amount,
          settlement.vat21Base,
          settlement.vat21Amount,
          settlement.vatExemptBase,
          settlement.servicesNetTotal,
          settlement.servicesVatTotal,
          settlement.servicesGrossTotal,
          settlement.outsideVatTotal,
          settlement.totalPayable,
          settlement.paidTotal,
          Number(reservation.payment_refund_amount ?? 0),
          Math.max(settlement.remainingToPay, 0),
          reservation.settlement_status,
        ]
      }),
      [],
      ['PLATEBNÍ KNIHA'],
      ['Rezervace', 'Datum', 'Typ pohybu', 'Směr', 'Částka', 'Způsob úhrady', 'Poznámka'],
      ...(basis === 'payment'
        ? paymentsInRange
        : payments.filter((payment) => reservationMap.has(payment.reservation_id))
      ).map((payment) => [
        reservationMap.get(payment.reservation_id)?.reservation_number ?? '',
        payment.transaction_date,
        formatPaymentType(payment.transaction_type),
        payment.direction,
        payment.amount,
        payment.payment_method ?? '',
        payment.note ?? '',
      ]),
    ]
  } else if (type === 'owner_stays') {
    rows = [
      ['Číslo', 'Od', 'Do', 'Nocí', 'Poznámka'],
      ...reservations
        .filter((reservation) => reservation.record_type === 'owner_block')
        .map((reservation) => [
          reservation.reservation_number,
          reservation.stay_start_date,
          reservation.stay_end_date,
          getNordFjellaNightCount(reservation),
          reservation.internal_note ?? '',
        ]),
    ]
  } else if (type === 'overview') {
    rows = [
      ['Ukazatel', 'Hodnota'],
      ['Záznamy', reservations.length],
      [
        'Pronájmy',
        reservations.filter((reservation) => reservation.record_type === 'reservation')
          .length,
      ],
      [
        'Vlastní pobyty',
        reservations.filter((reservation) => reservation.record_type === 'owner_block')
          .length,
      ],
      ['Ubytované osoby', rentalGuests.length],
      [
        'Všechny osobonoci',
        rentalGuests.reduce(
          (sum, guest) => sum + getDateNightCount(guest.stay_start_date, guest.stay_end_date),
          0
        ),
      ],
      [
        'Zpoplatněné osobonoci',
        rentalGuests.reduce(
          (sum, guest) => sum + Number(guest.city_tax_nights ?? 0),
          0
        ),
      ],
      [
        'Místní poplatek Kč',
        rentalGuests.reduce(
          (sum, guest) => sum + Number(guest.city_tax_amount ?? 0),
          0
        ),
      ],
    ]
  } else {
    rows = [
      [
        'Rezervace',
        'Jméno',
        'Příjmení',
        'Datum narození',
        'Občanství',
        'Ulice',
        'Obec',
        'PSČ',
        'Od',
        'Do',
        'Druh dokladu',
        'Číslo dokladu',
        'Stav poplatku',
        'Důvod osvobození',
        'Sazba',
        'Nocí',
        'Částka',
      ],
      ...rentalGuests.map((guest) => [
        reservationMap.get(guest.reservation_id)?.reservation_number ?? '',
        guest.first_name,
        guest.last_name,
        guest.birth_date,
        'CZ',
        guest.street,
        guest.city,
        guest.postal_code,
        guest.stay_start_date,
        guest.stay_end_date,
        guest.identity_document_type,
        type === 'guest_book' ? guest.identity_document_number : '',
        guest.city_tax_status,
        guest.city_tax_exemption_reason ?? '',
        guest.city_tax_rate,
        guest.city_tax_nights,
        guest.city_tax_amount,
      ]),
    ]
  }

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="Nord-Fjella-${type}-${from}-${to}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
