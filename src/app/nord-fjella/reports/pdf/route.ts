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
  buildNordFjellaReportData,
  getClippedNordFjellaNightCount,
  parseNordFjellaFinanceDateBasis,
  parseNordFjellaReportType,
  validateNordFjellaReportRange,
  type NordFjellaFinanceDateBasis,
  type NordFjellaReportData,
  type NordFjellaReportType,
} from '@/lib/nord-fjella/reports'
import type {
  NordFjellaPaymentRow,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaSettingsRow,
  NordFjellaStayGuestRow,
} from '@/lib/nord-fjella/types'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

Font.register({
  family: 'NordFjellaArial',
  fonts: [
    { src: path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf'), fontWeight: 400 },
    { src: path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf'), fontWeight: 700 },
  ],
})

const styles = StyleSheet.create({
  page: {
    paddingTop: 26,
    paddingHorizontal: 28,
    paddingBottom: 32,
    fontFamily: 'NordFjellaArial',
    fontSize: 7.5,
    color: '#172033',
  },
  header: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 9,
  },
  title: { fontSize: 17, fontWeight: 700 },
  subtitle: { marginTop: 3, color: '#64748b' },
  provider: { marginTop: 5, fontSize: 7, color: '#475569' },
  stats: { flexDirection: 'row', gap: 6, marginBottom: 11 },
  stat: {
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#dbe3ec',
    borderRadius: 6,
    padding: 7,
  },
  statLabel: { fontSize: 6.5, color: '#64748b', textTransform: 'uppercase' },
  statValue: { marginTop: 2, fontSize: 11, fontWeight: 700 },
  sectionTitle: { marginTop: 2, marginBottom: 5, fontSize: 9, fontWeight: 700 },
  table: {
    marginBottom: 11,
    borderWidth: 1,
    borderColor: '#dbe3ec',
    borderRadius: 5,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e7edf3', minHeight: 22 },
  head: { backgroundColor: '#eef4f8', borderTopWidth: 0 },
  cell: { paddingVertical: 5, paddingHorizontal: 4 },
  bold: { fontWeight: 700 },
  muted: { marginTop: 2, color: '#64748b', fontSize: 6.5 },
  empty: { padding: 16, textAlign: 'center', color: '#64748b' },
  footer: {
    position: 'absolute',
    bottom: 13,
    left: 28,
    right: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#94a3b8',
    fontSize: 6.5,
  },
})

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}.${month}.${year}` : value
}

function formatCurrency(value: number) {
  return `${new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))} Kč`
}

function reportTypeLabel(type: NordFjellaReportType) {
  if (type === 'finance') return 'Finanční a účetní přehled'
  if (type === 'guests') return 'Historie ubytovaných hostů'
  if (type === 'owner_stays') return 'Přehled vlastních pobytů'
  if (type === 'guest_book') return 'Zákonná evidenční kniha ubytovaných osob'
  return 'Celkový provozní přehled'
}

function basisLabel(basis: NordFjellaFinanceDateBasis) {
  if (basis === 'payment') return 'datum platby'
  if (basis === 'stay') return 'termín pobytu'
  return 'DUZP'
}

function documentTypeLabel(type: NordFjellaStayGuestRow['identity_document_type']) {
  if (type === 'passport') return 'Cestovní pas'
  if (type === 'other') return 'Jiný doklad'
  return 'Občanský průkaz'
}

function paymentTypeLabel(type: NordFjellaPaymentRow['transaction_type']) {
  if (type === 'deposit') return 'Záloha'
  if (type === 'balance') return 'Doplatek'
  if (type === 'refund') return 'Vratka'
  if (type === 'security_deposit_received') return 'Přijetí kauce'
  if (type === 'security_deposit_refund') return 'Vrácení kauce'
  return 'Zadržení kauce'
}

function taxLabel(guest: NordFjellaStayGuestRow) {
  if (guest.city_tax_status === 'exempt') {
    return `Osvobozen · ${guest.city_tax_exemption_reason || 'důvod neuveden'}`
  }
  if (guest.city_tax_status === 'not_applicable') return 'Nepodléhá'
  return `${formatCurrency(guest.city_tax_collected_amount)} / ${formatCurrency(
    guest.city_tax_amount
  )}`
}

function statStrip(values: Array<[string, string | number]>) {
  return h(
    View,
    { style: styles.stats },
    values.map(([label, value]) =>
      h(View, { key: label, style: styles.stat }, [
        h(Text, { key: 'label', style: styles.statLabel }, label),
        h(Text, { key: 'value', style: styles.statValue }, String(value)),
      ])
    )
  )
}

function overviewBody(data: NordFjellaReportData) {
  const entries: Array<[string, string | number]> = [
    ['Pronájmy celkem', data.rentals.length],
    ['Dokončené', data.metrics.completedRentals],
    ['Rezervované / poptávky', data.metrics.reservedRentals],
    ['Zrušené', data.metrics.cancelledRentals],
    ['Noci pronájmů', data.metrics.occupiedNights],
    ['Vlastní pobyty', data.ownerStays.length],
    ['Noci vlastních pobytů', data.metrics.ownerNights],
    ['Technické blokace', data.technicalBlocks.length],
    ['Noci technických blokací', data.metrics.technicalNights],
    ['Unikátní hosté', data.metrics.uniqueGuests],
    ['Osobonoci', data.metrics.guestNights],
    ['Místní poplatek vybraný', formatCurrency(data.metrics.cityTaxCollected)],
  ]
  return h(View, { style: styles.table }, [
    h(View, { key: 'head', style: [styles.row, styles.head] }, [
      h(Text, { key: 'metric', style: [styles.cell, styles.bold, { width: '72%' }] }, 'Ukazatel'),
      h(Text, { key: 'value', style: [styles.cell, styles.bold, { width: '28%' }] }, 'Hodnota'),
    ]),
    ...entries.map(([label, value]) =>
      h(View, { key: label, style: styles.row }, [
        h(Text, { key: 'label', style: [styles.cell, { width: '72%' }] }, label),
        h(Text, { key: 'value', style: [styles.cell, styles.bold, { width: '28%' }] }, String(value)),
      ])
    ),
  ])
}

function financeBody(data: NordFjellaReportData, basis: NordFjellaFinanceDateBasis) {
  const metricRows: Array<[string, number, number, number]> = [
    [
      'Sazba 12 %',
      data.metrics.vat12Base,
      data.metrics.vat12Amount,
      data.metrics.vat12Base + data.metrics.vat12Amount,
    ],
    [
      'Sazba 21 %',
      data.metrics.vat21Base,
      data.metrics.vat21Amount,
      data.metrics.vat21Base + data.metrics.vat21Amount,
    ],
    ['Mimo DPH / místní poplatek', data.metrics.cityTaxAssessed, 0, data.metrics.cityTaxCollected],
  ]
  const reservationMap = new Map(
    data.reservations.map((reservation) => [reservation.id, reservation])
  )

  return h(View, null, [
    h(Text, { key: 'tax-title', style: styles.sectionTitle }, `Daňová rekapitulace · podle ${basisLabel(basis)}`),
    h(View, { key: 'tax-table', style: styles.table }, [
      h(View, { key: 'head', style: [styles.row, styles.head] }, [
        h(Text, { key: 'name', style: [styles.cell, styles.bold, { width: '34%' }] }, 'Položka'),
        h(Text, { key: 'base', style: [styles.cell, styles.bold, { width: '22%' }] }, 'Základ / předpis'),
        h(Text, { key: 'vat', style: [styles.cell, styles.bold, { width: '22%' }] }, 'DPH'),
        h(Text, { key: 'gross', style: [styles.cell, styles.bold, { width: '22%' }] }, 'Celkem / vybráno'),
      ]),
      ...metricRows.map(([label, base, vat, gross]) =>
        h(View, { key: label, style: styles.row }, [
          h(Text, { key: 'label', style: [styles.cell, { width: '34%' }] }, label),
          h(Text, { key: 'base', style: [styles.cell, { width: '22%' }] }, formatCurrency(base)),
          h(Text, { key: 'vat', style: [styles.cell, { width: '22%' }] }, formatCurrency(vat)),
          h(Text, { key: 'gross', style: [styles.cell, styles.bold, { width: '22%' }] }, formatCurrency(gross)),
        ])
      ),
    ]),
    h(Text, { key: 'payment-title', style: styles.sectionTitle }, 'Platební kniha'),
    h(View, { key: 'payments', style: styles.table }, [
      h(View, { key: 'head', style: [styles.row, styles.head] }, [
        h(Text, { key: 'number', style: [styles.cell, styles.bold, { width: '13%' }] }, 'Rezervace'),
        h(Text, { key: 'date', style: [styles.cell, styles.bold, { width: '10%' }] }, 'Datum'),
        h(Text, { key: 'type', style: [styles.cell, styles.bold, { width: '13%' }] }, 'Pohyb'),
        h(Text, { key: 'amount', style: [styles.cell, styles.bold, { width: '12%' }] }, 'Částka'),
        h(Text, { key: 'document', style: [styles.cell, styles.bold, { width: '16%' }] }, 'Daňový doklad'),
        h(Text, { key: 'vat12', style: [styles.cell, styles.bold, { width: '12%' }] }, 'Základ/DPH 12 %'),
        h(Text, { key: 'vat21', style: [styles.cell, styles.bold, { width: '12%' }] }, 'Základ/DPH 21 %'),
        h(Text, { key: 'method', style: [styles.cell, styles.bold, { width: '12%' }] }, 'Úhrada'),
      ]),
      ...data.payments.map((payment) =>
        h(View, { key: payment.id, style: styles.row, wrap: false }, [
          h(Text, { key: 'number', style: [styles.cell, { width: '13%' }] }, reservationMap.get(payment.reservation_id)?.reservation_number || '—'),
          h(Text, { key: 'date', style: [styles.cell, { width: '10%' }] }, formatDate(payment.transaction_date)),
          h(Text, { key: 'type', style: [styles.cell, { width: '13%' }] }, paymentTypeLabel(payment.transaction_type)),
          h(Text, { key: 'amount', style: [styles.cell, styles.bold, { width: '12%' }] }, `${payment.direction === 'out' ? '−' : ''}${formatCurrency(payment.amount)}`),
          h(Text, { key: 'document', style: [styles.cell, { width: '16%' }] }, payment.tax_document_number || '—'),
          h(Text, { key: 'vat12', style: [styles.cell, { width: '12%' }] }, `${formatCurrency(payment.vat_12_base)} / ${formatCurrency(payment.vat_12_amount)}`),
          h(Text, { key: 'vat21', style: [styles.cell, { width: '12%' }] }, `${formatCurrency(payment.vat_21_base)} / ${formatCurrency(payment.vat_21_amount)}`),
          h(Text, { key: 'method', style: [styles.cell, { width: '12%' }] }, payment.payment_method || '—'),
        ])
      ),
      ...(data.payments.length === 0
        ? [h(Text, { key: 'empty', style: styles.empty }, 'V období nejsou platební pohyby.')]
        : []),
    ]),
    h(Text, { key: 'fulfilment-title', style: styles.sectionTitle }, 'Plnění podle rezervací'),
    h(View, { key: 'fulfilments', style: styles.table }, [
      h(View, { key: 'head', style: [styles.row, styles.head] }, [
        h(Text, { key: 'number', style: [styles.cell, styles.bold, { width: '12%' }] }, 'Rezervace'),
        h(Text, { key: 'customer', style: [styles.cell, styles.bold, { width: '20%' }] }, 'Zákazník'),
        h(Text, { key: 'date', style: [styles.cell, styles.bold, { width: '10%' }] }, 'DUZP'),
        h(Text, { key: 'net', style: [styles.cell, styles.bold, { width: '11%' }] }, 'Bez DPH'),
        h(Text, { key: 'vat', style: [styles.cell, styles.bold, { width: '10%' }] }, 'DPH'),
        h(Text, { key: 'gross', style: [styles.cell, styles.bold, { width: '11%' }] }, 'S DPH'),
        h(Text, { key: 'tax', style: [styles.cell, styles.bold, { width: '12%' }] }, 'Poplatek vybrán'),
        h(Text, { key: 'due', style: [styles.cell, styles.bold, { width: '14%' }] }, 'K inkasu'),
      ]),
      ...data.financeRows.map((row) =>
        h(View, { key: row.reservation.id, style: styles.row, wrap: false }, [
          h(Text, { key: 'number', style: [styles.cell, { width: '12%' }] }, row.reservation.reservation_number),
          h(Text, { key: 'customer', style: [styles.cell, { width: '20%' }] }, row.reservation.guest_company_name || row.reservation.guest_full_name || row.reservation.guest_contact_name || '—'),
          h(Text, { key: 'date', style: [styles.cell, { width: '10%' }] }, formatDate(row.reservation.taxable_supply_date || row.reservation.stay_end_date)),
          h(Text, { key: 'net', style: [styles.cell, { width: '11%' }] }, formatCurrency(row.servicesNet)),
          h(Text, { key: 'vat', style: [styles.cell, { width: '10%' }] }, formatCurrency(row.servicesVat)),
          h(Text, { key: 'gross', style: [styles.cell, { width: '11%' }] }, formatCurrency(row.servicesGross)),
          h(Text, { key: 'tax', style: [styles.cell, { width: '12%' }] }, formatCurrency(row.cityTaxCollected)),
          h(Text, { key: 'due', style: [styles.cell, styles.bold, { width: '14%' }] }, formatCurrency(Math.max(row.remaining, 0))),
        ])
      ),
      ...(data.financeRows.length === 0
        ? [h(Text, { key: 'empty', style: styles.empty }, 'V období nejsou finanční záznamy.')]
        : []),
    ]),
  ])
}

function ownerBody(data: NordFjellaReportData, from: string, to: string) {
  return h(View, { style: styles.table }, [
    h(View, { key: 'head', style: [styles.row, styles.head] }, [
      h(Text, { key: 'number', style: [styles.cell, styles.bold, { width: '20%' }] }, 'Číslo'),
      h(Text, { key: 'from', style: [styles.cell, styles.bold, { width: '16%' }] }, 'Od'),
      h(Text, { key: 'to', style: [styles.cell, styles.bold, { width: '16%' }] }, 'Do'),
      h(Text, { key: 'nights', style: [styles.cell, styles.bold, { width: '13%' }] }, 'Nocí v období'),
      h(Text, { key: 'note', style: [styles.cell, styles.bold, { width: '35%' }] }, 'Poznámka'),
    ]),
    ...data.ownerStays.map((row) =>
      h(View, { key: row.id, style: styles.row, wrap: false }, [
        h(Text, { key: 'number', style: [styles.cell, { width: '20%' }] }, row.reservation_number),
        h(Text, { key: 'from', style: [styles.cell, { width: '16%' }] }, formatDate(row.stay_start_date)),
        h(Text, { key: 'to', style: [styles.cell, { width: '16%' }] }, formatDate(row.stay_end_date)),
        h(Text, { key: 'nights', style: [styles.cell, styles.bold, { width: '13%' }] }, String(getClippedNordFjellaNightCount(row, { from, to }))),
        h(Text, { key: 'note', style: [styles.cell, { width: '35%' }] }, row.internal_note || '—'),
      ])
    ),
    ...(data.ownerStays.length === 0
      ? [h(Text, { key: 'empty', style: styles.empty }, 'V období nejsou vlastní pobyty.')]
      : []),
  ])
}

function guestBody(data: NordFjellaReportData, guestBook: boolean) {
  const reservationMap = new Map(
    data.reservations.map((reservation) => [reservation.id, reservation])
  )
  return h(View, { style: styles.table }, [
    h(View, { key: 'head', style: [styles.row, styles.head] }, [
      h(Text, { key: 'guest', style: [styles.cell, styles.bold, { width: '20%' }] }, 'Host'),
      h(Text, { key: 'stay', style: [styles.cell, styles.bold, { width: '18%' }] }, 'Pobyt'),
      h(Text, { key: 'address', style: [styles.cell, styles.bold, { width: guestBook ? '22%' : '32%' }] }, 'Bydliště'),
      h(Text, { key: 'document', style: [styles.cell, styles.bold, { width: guestBook ? '22%' : '15%' }] }, guestBook ? 'Doklad' : 'Rezervace'),
      h(Text, { key: 'tax', style: [styles.cell, styles.bold, { width: guestBook ? '18%' : '15%' }] }, guestBook ? 'Vybráno / předpis' : 'Poplatek'),
    ]),
    ...data.guests.map((guest) => {
      const reservation = reservationMap.get(guest.reservation_id)
      return h(View, { key: guest.id, style: styles.row, wrap: false }, [
        h(View, { key: 'guest', style: [styles.cell, { width: '20%' }] }, [
          h(Text, { key: 'name', style: styles.bold }, `${guest.first_name} ${guest.last_name}`),
          h(Text, { key: 'birth', style: styles.muted }, `${formatDate(guest.birth_date)} · ČR`),
        ]),
        h(View, { key: 'stay', style: [styles.cell, { width: '18%' }] }, [
          h(Text, { key: 'dates' }, `${formatDate(guest.stay_start_date)} – ${formatDate(guest.stay_end_date)}`),
          h(Text, { key: 'number', style: styles.muted }, reservation?.reservation_number || '—'),
        ]),
        h(Text, { key: 'address', style: [styles.cell, { width: guestBook ? '22%' : '32%' }] }, `${guest.street}, ${guest.postal_code} ${guest.city}`),
        h(Text, { key: 'document', style: [styles.cell, { width: guestBook ? '22%' : '15%' }] }, guestBook ? `${documentTypeLabel(guest.identity_document_type)} · ${guest.identity_document_number}` : reservation?.reservation_number || '—'),
        h(View, { key: 'tax', style: [styles.cell, { width: guestBook ? '18%' : '15%' }] }, [
          h(Text, { key: 'value' }, taxLabel(guest)),
          ...(guestBook && guest.city_tax_collected_at
            ? [h(Text, { key: 'date', style: styles.muted }, `${formatDate(guest.city_tax_collected_at)} · ${guest.city_tax_payment_method || 'forma neuvedena'}`)]
            : []),
        ]),
      ])
    }),
    ...(data.guests.length === 0
      ? [h(Text, { key: 'empty', style: styles.empty }, 'V období nejsou evidováni žádní hosté.')]
      : []),
  ])
}

function ReportDocument({
  type,
  basis,
  from,
  to,
  data,
  settings,
}: {
  type: NordFjellaReportType
  basis: NordFjellaFinanceDateBasis
  from: string
  to: string
  data: NordFjellaReportData
  settings: NordFjellaSettingsRow | null
}) {
  const stats =
    type === 'finance'
      ? statStrip([
          ['Bez DPH', formatCurrency(data.metrics.servicesNet)],
          ['DPH', formatCurrency(data.metrics.servicesVat)],
          ['S DPH', formatCurrency(data.metrics.servicesGross)],
          ['Čistý cashflow', formatCurrency(data.metrics.netCashflow)],
          ['K inkasu', formatCurrency(data.metrics.receivable)],
        ])
      : type === 'owner_stays'
        ? statStrip([
            ['Vlastní pobyty', data.ownerStays.length],
            ['Noci', data.metrics.ownerNights],
          ])
        : statStrip([
            ['Záznamy', data.reservations.length],
            ['Hosté', data.metrics.uniqueGuests],
            ['Osobonoci', data.metrics.guestNights],
            ['Poplatek vybrán', formatCurrency(data.metrics.cityTaxCollected)],
          ])

  const body =
    type === 'finance'
      ? financeBody(data, basis)
      : type === 'owner_stays'
        ? ownerBody(data, from, to)
        : type === 'guests' || type === 'guest_book'
          ? guestBody(data, type === 'guest_book')
          : overviewBody(data)

  const provider = [
    settings?.provider_company_name,
    settings?.provider_company_id_number
      ? `IČO ${settings.provider_company_id_number}`
      : null,
    settings?.provider_vat_number ? `DIČ ${settings.provider_vat_number}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return h(
    Document,
    null,
    h(
      Page,
      {
        size: 'A4',
        orientation: type === 'finance' || type === 'guest_book' ? 'landscape' : 'portrait',
        style: styles.page,
      },
      [
        h(View, { key: 'header', style: styles.header }, [
          h(Text, { key: 'title', style: styles.title }, reportTypeLabel(type)),
          h(Text, { key: 'subtitle', style: styles.subtitle }, `${settings?.object_name || 'Nord Fjella'} · ${settings?.object_city || 'Harrachov'} · ${formatDate(from)}–${formatDate(to)}`),
          ...(provider
            ? [h(Text, { key: 'provider', style: styles.provider }, provider)]
            : []),
        ]),
        stats,
        body,
        h(View, { key: 'footer', style: styles.footer, fixed: true }, [
          h(Text, { key: 'generated' }, `Vygenerováno ${new Intl.DateTimeFormat('cs-CZ').format(new Date())} · CZK`),
          h(Text, {
            key: 'page',
            render: ({ pageNumber, totalPages }) => `Strana ${pageNumber}/${totalPages}`,
          }),
        ]),
      ]
    )
  )
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

  const [reservationsResult, guestsResult, settingsResult, itemsResult, paymentsResult] =
    await Promise.all([
      supabase.from('nord_fjella_reservations').select('*').order('stay_start_date'),
      supabase.from('nord_fjella_stay_guests').select('*').order('stay_start_date'),
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

  const data = buildNordFjellaReportData({
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

  const buffer = await renderToBuffer(
    ReportDocument({
      type,
      basis,
      from,
      to,
      data,
      settings: settingsResult.data ?? null,
    })
  )

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Nord-Fjella-${type}-${from}-${to}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
