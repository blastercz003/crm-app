import path from 'node:path'
import { createElement as h } from 'react'
import { NextRequest, NextResponse } from 'next/server'
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import { canViewNordFjellaSection } from '@/lib/nord-fjella/access'
import {
  buildNordFjellaSettlementSummary,
  getNordFjellaNightCount,
} from '@/lib/nord-fjella/settlement'
import type {
  NordFjellaPaymentRow,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaSettingsRow,
  NordFjellaStayGuestRow,
} from '@/lib/nord-fjella/types'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type ReportType = 'overview' | 'finance' | 'guests' | 'owner_stays' | 'guest_book'
type FinanceDateBasis = 'supply' | 'payment' | 'stay'

const arialRegularPath = path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf')
const arialBoldPath = path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf')

Font.register({
  family: 'NordFjellaArial',
  fonts: [
    { src: arialRegularPath, fontWeight: 400 },
    { src: arialBoldPath, fontWeight: 700 },
  ],
})

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontFamily: 'NordFjellaArial',
    fontSize: 8,
    color: '#172033',
  },
  header: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 10,
  },
  title: { fontSize: 18, fontWeight: 700 },
  subtitle: { marginTop: 4, color: '#64748b' },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  stat: { flexGrow: 1, borderWidth: 1, borderColor: '#dbe3ec', borderRadius: 6, padding: 8 },
  statLabel: { fontSize: 7, color: '#64748b', textTransform: 'uppercase' },
  statValue: { marginTop: 3, fontSize: 13, fontWeight: 700 },
  table: { borderWidth: 1, borderColor: '#dbe3ec', borderRadius: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e7edf3', minHeight: 24 },
  head: { backgroundColor: '#eef4f8', borderTopWidth: 0 },
  cell: { paddingVertical: 6, paddingHorizontal: 5 },
  colMain: { width: '24%' },
  colStay: { width: '20%' },
  colAddress: { width: '26%' },
  colDocument: { width: '15%' },
  colTax: { width: '15%' },
  colOwnerNumber: { width: '22%' },
  colOwnerDate: { width: '18%' },
  colOwnerNights: { width: '12%' },
  colOwnerNote: { width: '30%' },
  financeNumber: { width: '12%' },
  financeCustomer: { width: '17%' },
  financeDate: { width: '10%' },
  financeMoney: { width: '9%' },
  financeStatus: { width: '7%' },
  bold: { fontWeight: 700 },
  muted: { color: '#64748b', marginTop: 2, fontSize: 7 },
  empty: { padding: 20, textAlign: 'center', color: '#64748b' },
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 28,
    right: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#94a3b8',
    fontSize: 7,
  },
})

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}.${month}.${year}` : value
}

function formatCurrency(value: number) {
  return `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(Number(value ?? 0))} Kč`
}

function reportTypeLabel(type: ReportType) {
  if (type === 'finance') return 'Finanční a účetní přehled'
  if (type === 'guests') return 'Historie ubytovaných hostů'
  if (type === 'owner_stays') return 'Přehled vlastních pobytů'
  if (type === 'guest_book') return 'Evidenční kniha poplatku z pobytu'
  return 'Celkový provozní přehled'
}

function getTaxStatusLabel(guest: NordFjellaStayGuestRow) {
  if (guest.city_tax_status === 'liable') return formatCurrency(guest.city_tax_amount)
  if (guest.city_tax_status === 'exempt') return `Osvobozen: ${guest.city_tax_exemption_reason || 'neuvedeno'}`
  return 'Nepodléhá'
}

function ReportDocument({
  type,
  from,
  to,
  reservations,
  guests,
  items,
  payments,
  basis,
  settings,
}: {
  type: ReportType
  from: string
  to: string
  reservations: NordFjellaReservationRow[]
  guests: NordFjellaStayGuestRow[]
  items: NordFjellaReservationItemRow[]
  payments: NordFjellaPaymentRow[]
  basis: FinanceDateBasis
  settings: NordFjellaSettingsRow | null
}) {
  const rentals = reservations.filter((row) => row.record_type === 'reservation')
  const ownerStays = reservations.filter((row) => row.record_type === 'owner_block')
  const rentalIds = new Set(rentals.map((row) => row.id))
  const rentalGuests = guests.filter((guest) => rentalIds.has(guest.reservation_id))
  const totalTax = rentalGuests.reduce((sum, guest) => sum + Number(guest.city_tax_amount ?? 0), 0)
  const guestNights = rentalGuests.reduce(
    (sum, guest) =>
      sum +
      Math.max(
        0,
        Math.round(
          (new Date(`${guest.stay_end_date}T12:00:00Z`).getTime() -
            new Date(`${guest.stay_start_date}T12:00:00Z`).getTime()) /
            86_400_000
        )
      ),
    0
  )
  const reservationMap = new Map(reservations.map((reservation) => [reservation.id, reservation]))
  const itemsByReservationId = new Map<string, NordFjellaReservationItemRow[]>()
  for (const item of items) {
    const rows = itemsByReservationId.get(item.reservation_id) ?? []
    rows.push(item)
    itemsByReservationId.set(item.reservation_id, rows)
  }
  const financeRows = rentals.map((reservation) => ({
    reservation,
    settlement: buildNordFjellaSettlementSummary(
      reservation,
      itemsByReservationId.get(reservation.id) ?? []
    ),
  }))
  const financeTotals = financeRows.reduce(
    (summary, row) => ({
      net: summary.net + row.settlement.servicesNetTotal,
      vat: summary.vat + row.settlement.servicesVatTotal,
      gross: summary.gross + row.settlement.servicesGrossTotal,
      vat12Base: summary.vat12Base + row.settlement.vat12Base,
      vat12: summary.vat12 + row.settlement.vat12Amount,
      vat21Base: summary.vat21Base + row.settlement.vat21Base,
      vat21: summary.vat21 + row.settlement.vat21Amount,
      outsideVat: summary.outsideVat + row.settlement.outsideVatTotal,
      received: summary.received + row.settlement.paidTotal,
      receivable: summary.receivable + Math.max(row.settlement.remainingToPay, 0),
    }),
    {
      net: 0,
      vat: 0,
      gross: 0,
      vat12Base: 0,
      vat12: 0,
      vat21Base: 0,
      vat21: 0,
      outsideVat: 0,
      received: 0,
      receivable: 0,
    }
  )
  const paymentIncome = payments
    .filter(
      (payment) =>
        payment.direction === 'in' &&
        (payment.transaction_type === 'deposit' ||
          payment.transaction_type === 'balance')
    )
    .reduce((sum, payment) => sum + Number(payment.amount), 0)
  const paymentRefunds = payments
    .filter((payment) => payment.transaction_type === 'refund')
    .reduce((sum, payment) => sum + Number(payment.amount), 0)
  const reportedReceived =
    type === 'finance' && basis === 'payment'
      ? paymentIncome - paymentRefunds
      : financeTotals.received
  const basisLabel =
    basis === 'payment'
      ? 'podle data platby'
      : basis === 'stay'
        ? 'podle termínu pobytu'
        : 'podle DUZP'

  const stats = h(
    View,
    { style: styles.stats },
    (type === 'finance'
      ? [
          ['Bez DPH', formatCurrency(financeTotals.net)],
          ['DPH', formatCurrency(financeTotals.vat)],
          ['S DPH', formatCurrency(financeTotals.gross)],
          ['Přijato', formatCurrency(reportedReceived)],
          ['K inkasu', formatCurrency(financeTotals.receivable)],
        ]
      : [
          ['Záznamy', reservations.length],
          ['Pronájmy', rentals.length],
          ['Hosté', rentalGuests.length],
          ['Osobonoci', guestNights],
          ['Místní poplatek', formatCurrency(totalTax)],
        ]
    ).map(([label, value]) =>
      h(View, { key: String(label), style: styles.stat }, [
        h(Text, { key: 'label', style: styles.statLabel }, String(label)),
        h(Text, { key: 'value', style: styles.statValue }, String(value)),
      ])
    )
  )

  let body

  if (type === 'finance') {
    body = h(View, null, [
      h(View, { key: 'tax-summary', style: [styles.table, { marginBottom: 12 }] }, [
        h(View, { key: 'head', style: [styles.row, styles.head] }, [
          h(Text, { key: 'metric', style: [styles.cell, { width: '38%' }, styles.bold] }, 'Daňová rekapitulace'),
          h(Text, { key: 'base', style: [styles.cell, { width: '21%' }, styles.bold] }, 'Základ'),
          h(Text, { key: 'vat', style: [styles.cell, { width: '20%' }, styles.bold] }, 'DPH'),
          h(Text, { key: 'gross', style: [styles.cell, { width: '21%' }, styles.bold] }, 'Celkem'),
        ]),
        ...[
          ['Sazba 12 %', financeTotals.vat12Base, financeTotals.vat12, financeTotals.vat12Base + financeTotals.vat12],
          ['Sazba 21 %', financeTotals.vat21Base, financeTotals.vat21, financeTotals.vat21Base + financeTotals.vat21],
          ['Mimo DPH', financeTotals.outsideVat, 0, financeTotals.outsideVat],
        ].map(([label, base, vat, gross]) =>
          h(View, { key: String(label), style: styles.row }, [
            h(Text, { key: 'label', style: [styles.cell, { width: '38%' }] }, String(label)),
            h(Text, { key: 'base', style: [styles.cell, { width: '21%' }] }, formatCurrency(Number(base))),
            h(Text, { key: 'vat', style: [styles.cell, { width: '20%' }] }, formatCurrency(Number(vat))),
            h(Text, { key: 'gross', style: [styles.cell, { width: '21%' }, styles.bold] }, formatCurrency(Number(gross))),
          ])
        ),
        h(View, { key: 'payments', style: styles.row }, [
          h(Text, { key: 'label', style: [styles.cell, { width: '38%' }, styles.bold] }, `Platební kniha · ${basisLabel}`),
          h(Text, { key: 'income', style: [styles.cell, { width: '21%' }] }, `Přijato ${formatCurrency(paymentIncome)}`),
          h(Text, { key: 'refund', style: [styles.cell, { width: '20%' }] }, `Vratky ${formatCurrency(paymentRefunds)}`),
          h(Text, { key: 'net', style: [styles.cell, { width: '21%' }, styles.bold] }, `Čistě ${formatCurrency(paymentIncome - paymentRefunds)}`),
        ]),
      ]),
      h(View, { key: 'finance-table', style: styles.table }, [
        h(View, { key: 'head', style: [styles.row, styles.head] }, [
          h(Text, { key: 'number', style: [styles.cell, styles.financeNumber, styles.bold] }, 'Rezervace'),
          h(Text, { key: 'customer', style: [styles.cell, styles.financeCustomer, styles.bold] }, 'Zákazník'),
          h(Text, { key: 'date', style: [styles.cell, styles.financeDate, styles.bold] }, 'DUZP'),
          h(Text, { key: 'net', style: [styles.cell, styles.financeMoney, styles.bold] }, 'Bez DPH'),
          h(Text, { key: 'vat', style: [styles.cell, styles.financeMoney, styles.bold] }, 'DPH'),
          h(Text, { key: 'gross', style: [styles.cell, styles.financeMoney, styles.bold] }, 'S DPH'),
          h(Text, { key: 'tax', style: [styles.cell, styles.financeMoney, styles.bold] }, 'Poplatek'),
          h(Text, { key: 'paid', style: [styles.cell, styles.financeMoney, styles.bold] }, 'Přijato'),
          h(Text, { key: 'due', style: [styles.cell, styles.financeMoney, styles.bold] }, 'K inkasu'),
          h(Text, { key: 'status', style: [styles.cell, styles.financeStatus, styles.bold] }, 'Stav'),
        ]),
        ...financeRows.map(({ reservation, settlement }) =>
          h(View, { key: reservation.id, style: styles.row, wrap: false }, [
            h(Text, { key: 'number', style: [styles.cell, styles.financeNumber] }, reservation.reservation_number),
            h(Text, { key: 'customer', style: [styles.cell, styles.financeCustomer] }, reservation.guest_company_name || reservation.guest_full_name || reservation.guest_contact_name || '—'),
            h(Text, { key: 'date', style: [styles.cell, styles.financeDate] }, formatDate(reservation.taxable_supply_date || reservation.stay_end_date)),
            h(Text, { key: 'net', style: [styles.cell, styles.financeMoney] }, formatCurrency(settlement.servicesNetTotal)),
            h(Text, { key: 'vat', style: [styles.cell, styles.financeMoney] }, formatCurrency(settlement.servicesVatTotal)),
            h(Text, { key: 'gross', style: [styles.cell, styles.financeMoney] }, formatCurrency(settlement.servicesGrossTotal)),
            h(Text, { key: 'tax', style: [styles.cell, styles.financeMoney] }, formatCurrency(settlement.outsideVatTotal)),
            h(Text, { key: 'paid', style: [styles.cell, styles.financeMoney] }, formatCurrency(settlement.paidTotal)),
            h(Text, { key: 'due', style: [styles.cell, styles.financeMoney, styles.bold] }, formatCurrency(Math.max(settlement.remainingToPay, 0))),
            h(Text, { key: 'status', style: [styles.cell, styles.financeStatus] }, reservation.settlement_status === 'closed' ? 'Uzavřeno' : 'Otevřeno'),
          ])
        ),
        ...(financeRows.length === 0
          ? [h(Text, { key: 'empty', style: styles.empty }, 'V období nejsou finanční záznamy.')]
          : []),
      ]),
    ])
  } else if (type === 'owner_stays') {
    body = h(View, { style: styles.table }, [
      h(View, { key: 'head', style: [styles.row, styles.head] }, [
        h(Text, { key: 'number', style: [styles.cell, styles.colOwnerNumber, styles.bold] }, 'Číslo'),
        h(Text, { key: 'from', style: [styles.cell, styles.colOwnerDate, styles.bold] }, 'Od'),
        h(Text, { key: 'to', style: [styles.cell, styles.colOwnerDate, styles.bold] }, 'Do'),
        h(Text, { key: 'nights', style: [styles.cell, styles.colOwnerNights, styles.bold] }, 'Nocí'),
        h(Text, { key: 'note', style: [styles.cell, styles.colOwnerNote, styles.bold] }, 'Poznámka'),
      ]),
      ...ownerStays.map((row) =>
        h(View, { key: row.id, style: styles.row, wrap: false }, [
          h(Text, { key: 'number', style: [styles.cell, styles.colOwnerNumber] }, row.reservation_number),
          h(Text, { key: 'from', style: [styles.cell, styles.colOwnerDate] }, formatDate(row.stay_start_date)),
          h(Text, { key: 'to', style: [styles.cell, styles.colOwnerDate] }, formatDate(row.stay_end_date)),
          h(Text, { key: 'nights', style: [styles.cell, styles.colOwnerNights] }, String(getNordFjellaNightCount(row))),
          h(Text, { key: 'note', style: [styles.cell, styles.colOwnerNote] }, row.internal_note || '—'),
        ])
      ),
      ...(ownerStays.length === 0 ? [h(Text, { key: 'empty', style: styles.empty }, 'V období nejsou vlastní pobyty.')] : []),
    ])
  } else if (type === 'guests' || type === 'guest_book') {
    body = h(View, { style: styles.table }, [
      h(View, { key: 'head', style: [styles.row, styles.head] }, [
        h(Text, { key: 'guest', style: [styles.cell, styles.colMain, styles.bold] }, 'Host'),
        h(Text, { key: 'stay', style: [styles.cell, styles.colStay, styles.bold] }, 'Pobyt'),
        h(Text, { key: 'address', style: [styles.cell, styles.colAddress, styles.bold] }, 'Bydliště'),
        h(Text, { key: 'document', style: [styles.cell, styles.colDocument, styles.bold] }, type === 'guest_book' ? 'Doklad' : 'Rezervace'),
        h(Text, { key: 'tax', style: [styles.cell, styles.colTax, styles.bold] }, 'Poplatek'),
      ]),
      ...rentalGuests.map((guest) => {
        const reservation = reservationMap.get(guest.reservation_id)
        return h(View, { key: guest.id, style: styles.row, wrap: false }, [
          h(View, { key: 'guest', style: [styles.cell, styles.colMain] }, [
            h(Text, { key: 'name', style: styles.bold }, `${guest.first_name} ${guest.last_name}`),
            h(Text, { key: 'birth', style: styles.muted }, `${formatDate(guest.birth_date)} · ČR`),
          ]),
          h(View, { key: 'stay', style: [styles.cell, styles.colStay] }, [
            h(Text, { key: 'dates' }, `${formatDate(guest.stay_start_date)} – ${formatDate(guest.stay_end_date)}`),
            h(Text, { key: 'number', style: styles.muted }, reservation?.reservation_number || '—'),
          ]),
          h(Text, { key: 'address', style: [styles.cell, styles.colAddress] }, `${guest.street}, ${guest.postal_code} ${guest.city}`),
          h(Text, { key: 'document', style: [styles.cell, styles.colDocument] }, type === 'guest_book' ? guest.identity_document_number : reservation?.reservation_number || '—'),
          h(Text, { key: 'tax', style: [styles.cell, styles.colTax] }, getTaxStatusLabel(guest)),
        ])
      }),
      ...(rentalGuests.length === 0 ? [h(Text, { key: 'empty', style: styles.empty }, 'V období nejsou evidováni žádní hosté.')] : []),
    ])
  } else {
    body = h(View, { style: styles.table }, [
      h(View, { key: 'head', style: [styles.row, styles.head] }, [
        h(Text, { key: 'metric', style: [styles.cell, { width: '70%' }, styles.bold] }, 'Ukazatel'),
        h(Text, { key: 'value', style: [styles.cell, { width: '30%' }, styles.bold] }, 'Hodnota'),
      ]),
      ...[
        ['Dokončené pronájmy', rentals.filter((row) => row.reservation_status === 'completed').length],
        ['Noci pronájmů', rentals.reduce((sum, row) => sum + getNordFjellaNightCount(row), 0)],
        ['Vlastní pobyty', ownerStays.length],
        ['Noci vlastních pobytů', ownerStays.reduce((sum, row) => sum + getNordFjellaNightCount(row), 0)],
        ['Osoby podléhající poplatku', rentalGuests.filter((guest) => guest.city_tax_status === 'liable').length],
        ['Osvobozené osoby', rentalGuests.filter((guest) => guest.city_tax_status === 'exempt').length],
      ].map(([label, value]) =>
        h(View, { key: String(label), style: styles.row }, [
          h(Text, { key: 'label', style: [styles.cell, { width: '70%' }] }, String(label)),
          h(Text, { key: 'value', style: [styles.cell, { width: '30%' }, styles.bold] }, String(value)),
        ])
      ),
    ])
  }

  return h(Document, null,
    h(Page, { size: 'A4', orientation: type === 'guest_book' || type === 'finance' ? 'landscape' : 'portrait', style: styles.page }, [
      h(View, { key: 'header', style: styles.header }, [
        h(Text, { key: 'title', style: styles.title }, reportTypeLabel(type)),
        h(Text, { key: 'subtitle', style: styles.subtitle }, `${settings?.object_name || 'Nord Fjella'} · ${settings?.object_city || 'Harrachov'} · ${formatDate(from)}–${formatDate(to)}`),
      ]),
      stats,
      body,
      h(View, { key: 'footer', style: styles.footer, fixed: true }, [
        h(Text, { key: 'generated' }, `Vygenerováno ${new Intl.DateTimeFormat('cs-CZ').format(new Date())}`),
        h(Text, { key: 'page', render: ({ pageNumber, totalPages }) => `Strana ${pageNumber}/${totalPages}` }),
      ]),
    ])
  )
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

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

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

  const [reservationsResult, guestsResult, settingsResult, itemsResult, paymentsResult] = await Promise.all([
    supabase
      .from('nord_fjella_reservations')
      .select('*')
      .order('stay_start_date', { ascending: true }),
    supabase
      .from('nord_fjella_stay_guests')
      .select('*')
      .order('stay_start_date', { ascending: true }),
    supabase
      .from('nord_fjella_settings')
      .select('*')
      .eq('singleton_key', 'primary')
      .maybeSingle<NordFjellaSettingsRow>(),
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
    settingsResult.error ||
    itemsResult.error ||
    paymentsResult.error
  ) {
    return new NextResponse('Report se nepodařilo načíst.', { status: 500 })
  }

  const allReservations = (reservationsResult.data ?? []) as NordFjellaReservationRow[]
  const allGuests = (guestsResult.data ?? []) as NordFjellaStayGuestRow[]
  const allPayments = (paymentsResult.data ?? []) as NordFjellaPaymentRow[]
  const paymentsInRange = allPayments.filter(
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
        : allReservations.filter(
            (reservation) =>
              reservation.stay_end_date > from && reservation.stay_start_date <= to
          )
  const reservationIds = new Set(reservations.map((reservation) => reservation.id))
  const guests = allGuests.filter(
    (guest) =>
      reservationIds.has(guest.reservation_id) &&
      guest.stay_end_date > from &&
      guest.stay_start_date <= to
  )
  const payments =
    type === 'finance' && basis === 'payment'
      ? paymentsInRange
      : allPayments.filter((payment) => reservationIds.has(payment.reservation_id))

  const buffer = await renderToBuffer(ReportDocument({
    type,
    from,
    to,
    reservations,
    guests,
    items: (itemsResult.data ?? []) as NordFjellaReservationItemRow[],
    payments,
    basis,
    settings: settingsResult.data ?? null,
  }))

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Nord-Fjella-${type}-${from}-${to}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
