import { NextRequest, NextResponse } from 'next/server'
import { canViewNordFjellaSection } from '@/lib/nord-fjella/access'
import {
  buildNordFjellaReportData,
  getClippedNordFjellaNightCount,
  parseNordFjellaFinanceDateBasis,
  parseNordFjellaReportType,
  validateNordFjellaReportRange,
} from '@/lib/nord-fjella/reports'
import type {
  NordFjellaPaymentRow,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaSettingsRow,
  NordFjellaStayGuestRow,
} from '@/lib/nord-fjella/types'
import { createClient } from '@/lib/supabase/server'

function csvCell(value: unknown) {
  const raw = String(value ?? '')
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

function paymentTypeLabel(type: NordFjellaPaymentRow['transaction_type']) {
  if (type === 'deposit') return 'Záloha'
  if (type === 'balance') return 'Doplatek'
  if (type === 'refund') return 'Vratka'
  if (type === 'security_deposit_received') return 'Přijetí kauce'
  if (type === 'security_deposit_refund') return 'Vrácení kauce'
  return 'Zadržení kauce'
}

function documentTypeLabel(type: NordFjellaStayGuestRow['identity_document_type']) {
  if (type === 'passport') return 'Cestovní pas'
  if (type === 'other') return 'Jiný doklad'
  return 'Občanský průkaz'
}

function taxStatusLabel(status: NordFjellaStayGuestRow['city_tax_status']) {
  if (status === 'liable') return 'Podléhá'
  if (status === 'exempt') return 'Osvobozen'
  return 'Nepodléhá'
}

function basisLabel(value: ReturnType<typeof parseNordFjellaFinanceDateBasis>) {
  if (value === 'payment') return 'Datum platby'
  if (value === 'stay') return 'Termín pobytu'
  return 'DUZP'
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

  const params = request.nextUrl.searchParams
  const type = parseNordFjellaReportType(params.get('type'))
  const basis = parseNordFjellaFinanceDateBasis(params.get('basis'))
  const from = params.get('from') || `${new Date().getFullYear()}-01-01`
  const to = params.get('to') || `${new Date().getFullYear()}-12-31`
  const guestSearch = params.get('q') ?? ''
  const requestedTaxFilter = params.get('tax')
  const cityTaxFilter =
    requestedTaxFilter === 'liable' ||
    requestedTaxFilter === 'exempt' ||
    requestedTaxFilter === 'not_applicable'
      ? requestedTaxFilter
      : 'all'
  const rangeError = validateNordFjellaReportRange(from, to)

  if (rangeError) return new NextResponse(rangeError, { status: 400 })

  const [reservationsResult, guestsResult, itemsResult, paymentsResult, settingsResult] =
    await Promise.all([
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
      supabase
        .from('nord_fjella_settings')
        .select('*')
        .eq('singleton_key', 'primary')
        .maybeSingle<NordFjellaSettingsRow>(),
    ])

  if (
    reservationsResult.error ||
    guestsResult.error ||
    itemsResult.error ||
    paymentsResult.error ||
    settingsResult.error
  ) {
    return new NextResponse('Report se nepodařilo načíst.', { status: 500 })
  }

  const report = buildNordFjellaReportData({
    type,
    basis,
    range: { from, to },
    reservations: (reservationsResult.data ?? []) as NordFjellaReservationRow[],
    reservationItems: (itemsResult.data ?? []) as NordFjellaReservationItemRow[],
    stayGuests: (guestsResult.data ?? []) as NordFjellaStayGuestRow[],
    payments: (paymentsResult.data ?? []) as NordFjellaPaymentRow[],
    guestSearch,
    cityTaxFilter,
  })
  const settings = settingsResult.data
  const reservationMap = new Map(
    report.reservations.map((reservation) => [reservation.id, reservation])
  )

  const rows: unknown[][] = [
    ['REPORT NORD FJELLA'],
    ['Provozovatel', settings?.provider_company_name ?? ''],
    ['IČO', settings?.provider_company_id_number ?? ''],
    ['DIČ', settings?.provider_vat_number ?? ''],
    ['Objekt', settings?.object_name ?? 'Nord Fjella'],
    ['Obec objektu', settings?.object_city ?? 'Harrachov'],
    ['Období od', from],
    ['Období do', to],
    ['Časové hledisko financí', basisLabel(basis)],
    ['Měna', 'CZK'],
    ['Vygenerováno', new Date().toISOString()],
    [],
  ]

  if (type === 'finance') {
    rows.push(
      ['FINANČNÍ SOUHRN', 'CZK'],
      ['Výnosy bez DPH', report.metrics.servicesNet],
      ['DPH celkem', report.metrics.servicesVat],
      ['Výnosy s DPH', report.metrics.servicesGross],
      ['Základ 12 %', report.metrics.vat12Base],
      ['DPH 12 %', report.metrics.vat12Amount],
      ['Základ 21 %', report.metrics.vat21Base],
      ['DPH 21 %', report.metrics.vat21Amount],
      ['Místní poplatek předepsaný', report.metrics.cityTaxAssessed],
      ['Místní poplatek vybraný', report.metrics.cityTaxCollected],
      ['Přijaté platby', report.metrics.paymentIncome],
      ['Vratky', report.metrics.paymentRefunds],
      ['Čistý peněžní tok', report.metrics.netCashflow],
      ['Pohledávky', report.metrics.receivable],
      ['Držené kauce mimo tržby', report.metrics.heldDeposits],
      ['Neúplné finanční záznamy', report.metrics.financialIncompleteCount],
      [],
      ['PLATEBNÍ KNIHA'],
      [
        'Rezervace',
        'Datum',
        'Typ pohybu',
        'Směr',
        'Částka',
        'Způsob úhrady',
        'Daňový doklad',
        'Základ 12 %',
        'DPH 12 %',
        'Základ 21 %',
        'DPH 21 %',
        'Poznámka',
      ],
      ...report.payments.map((payment) => [
        reservationMap.get(payment.reservation_id)?.reservation_number ?? '',
        payment.transaction_date,
        paymentTypeLabel(payment.transaction_type),
        payment.direction === 'in' ? 'Příjem' : 'Výdej',
        payment.amount,
        payment.payment_method ?? '',
        payment.tax_document_number ?? '',
        payment.vat_12_base,
        payment.vat_12_amount,
        payment.vat_21_base,
        payment.vat_21_amount,
        payment.note ?? '',
      ]),
      [],
      ['PŘEHLED PLNĚNÍ PODLE REZERVACÍ'],
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
        'Základ 12 %',
        'DPH 12 %',
        'Základ 21 %',
        'DPH 21 %',
        'Osvobozeno',
        'Služby bez DPH',
        'DPH celkem',
        'Služby s DPH',
        'Místní poplatek předepsaný',
        'Místní poplatek vybraný',
        'Celkem k úhradě',
        'Přijato',
        'Vráceno',
        'Zbývá uhradit',
        'Vyúčtování',
      ],
      ...report.financeRows.map((row) => [
        row.reservation.reservation_number,
        row.reservation.external_document_number ?? '',
        row.reservation.variable_symbol,
        row.reservation.guest_company_name ||
          row.reservation.guest_full_name ||
          row.reservation.guest_contact_name ||
          '',
        row.reservation.guest_ico ?? '',
        row.reservation.guest_dic ?? '',
        row.reservation.stay_start_date,
        row.reservation.stay_end_date,
        row.reservation.taxable_supply_date || row.reservation.stay_end_date,
        row.vat12Base,
        row.vat12Amount,
        row.vat21Base,
        row.vat21Amount,
        row.vatExemptBase,
        row.servicesNet,
        row.servicesVat,
        row.servicesGross,
        row.cityTaxAssessed,
        row.cityTaxCollected,
        row.totalPayable,
        row.paid,
        row.refunds,
        Math.max(row.remaining, 0),
        row.reservation.settlement_status,
      ])
    )
  } else if (type === 'owner_stays') {
    rows.push(
      ['Číslo', 'Od', 'Do', 'Nocí ve zvoleném období', 'Poznámka'],
      ...report.ownerStays.map((reservation) => [
        reservation.reservation_number,
        reservation.stay_start_date,
        reservation.stay_end_date,
        getClippedNordFjellaNightCount(reservation, { from, to }),
        reservation.internal_note ?? '',
      ])
    )
  } else if (type === 'overview') {
    rows.push(
      ['Ukazatel', 'Hodnota'],
      ['Záznamy', report.reservations.length],
      ['Pronájmy', report.rentals.length],
      ['Dokončené pronájmy', report.metrics.completedRentals],
      ['Rezervované / poptávky', report.metrics.reservedRentals],
      ['Zrušené pronájmy', report.metrics.cancelledRentals],
      ['Vlastní pobyty', report.ownerStays.length],
      ['Technické blokace', report.technicalBlocks.length],
      ['Noci pronájmů', report.metrics.occupiedNights],
      ['Noci vlastních pobytů', report.metrics.ownerNights],
      ['Noci technických blokací', report.metrics.technicalNights],
      ['Unikátní hosté', report.metrics.uniqueGuests],
      ['Osobonoci', report.metrics.guestNights],
      ['Zpoplatněné osobonoci', report.metrics.taxableGuestNights],
      ['Místní poplatek předepsaný', report.metrics.cityTaxAssessed],
      ['Místní poplatek vybraný', report.metrics.cityTaxCollected]
    )
  } else {
    const guestHeader =
      type === 'guest_book'
        ? [
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
            'Zpoplatněných nocí',
            'Předepsáno',
            'Vybráno',
            'Datum výběru',
            'Způsob výběru',
          ]
        : [
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
            'Stav poplatku',
          ]
    rows.push(
      guestHeader,
      ...report.guests.map((guest) => {
        const common = [
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
        ]
        return type === 'guest_book'
          ? [
              ...common,
              documentTypeLabel(guest.identity_document_type),
              guest.identity_document_number,
              taxStatusLabel(guest.city_tax_status),
              guest.city_tax_exemption_reason ?? '',
              guest.city_tax_rate,
              guest.city_tax_nights,
              guest.city_tax_amount,
              guest.city_tax_collected_amount,
              guest.city_tax_collected_at ?? '',
              guest.city_tax_payment_method ?? '',
            ]
          : [...common, taxStatusLabel(guest.city_tax_status)]
      })
    )
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
