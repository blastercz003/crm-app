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
import {
  loadVehicleLogbookReport,
  validateVehicleLogbookReportInput,
  type VehicleLogbookReportData,
} from '@/lib/vehicle-logbook/reports'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

Font.register({
  family: 'VehicleLogbookArial',
  fonts: [
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf'),
      fontWeight: 400,
    },
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf'),
      fontWeight: 700,
    },
  ],
})

const styles = StyleSheet.create({
  page: {
    paddingTop: 25,
    paddingHorizontal: 28,
    paddingBottom: 28,
    fontFamily: 'VehicleLogbookArial',
    fontSize: 7.2,
    color: '#172033',
  },
  header: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 9,
  },
  kicker: {
    color: '#2f77af',
    fontSize: 6.5,
    fontWeight: 700,
    letterSpacing: 1.1,
  },
  title: { marginTop: 3, fontSize: 17, fontWeight: 700 },
  subtitle: { marginTop: 3, color: '#64748b' },
  metrics: { flexDirection: 'row', gap: 6, marginBottom: 11 },
  metric: {
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#dbe3ec',
    borderRadius: 6,
    padding: 7,
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 6,
    fontWeight: 700,
    textTransform: 'uppercase',
  },
  metricValue: { marginTop: 3, fontSize: 11, fontWeight: 700 },
  metricDetail: { marginTop: 2, color: '#64748b', fontSize: 6.2 },
  sectionTitle: {
    marginTop: 2,
    marginBottom: 5,
    fontSize: 9,
    fontWeight: 700,
  },
  table: {
    marginBottom: 11,
    borderWidth: 1,
    borderColor: '#dbe3ec',
    borderRadius: 5,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e7edf3',
    minHeight: 21,
  },
  head: { borderTopWidth: 0, backgroundColor: '#eef4f8' },
  cell: { paddingVertical: 4.5, paddingHorizontal: 4 },
  bold: { fontWeight: 700 },
  muted: { marginTop: 2, color: '#64748b', fontSize: 6 },
  warning: { color: '#a16207' },
  empty: { padding: 16, textAlign: 'center', color: '#64748b' },
  footer: {
    position: 'absolute',
    right: 28,
    bottom: 11,
    left: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: '#94a3b8',
    fontSize: 6,
  },
})

function formatNumber(value: number, decimals = 0) {
  return new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value)
}

function formatCurrency(value: number) {
  return `${formatNumber(value, 2)} Kč`
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function formatMonth(value: string) {
  const [year, month] = value.split('-')
  return `${month}/${year}`
}

function usageLabel(value: string) {
  if (value === 'private') return 'Soukromá'
  if (value === 'mixed') return 'Smíšená'
  return 'Služební'
}

function energyLabel(value: string) {
  if (value === 'diesel') return 'Nafta'
  if (value === 'electricity') return 'Elektřina'
  return 'Benzín'
}

function reportHeader(
  report: VehicleLogbookReportData,
  title: string,
  subtitle: string
) {
  const scope =
    report.scope === 'fleet'
      ? 'Všechna vozidla'
      : `${report.vehicles[0]?.name ?? 'Vozidlo'} · ${report.vehicles[0]?.registrationPlate ?? '—'}`

  return h(View, { style: styles.header }, [
    h(Text, { key: 'kicker', style: styles.kicker }, 'KNIHY JÍZD'),
    h(Text, { key: 'title', style: styles.title }, title),
    h(
      Text,
      { key: 'subtitle', style: styles.subtitle },
      `${subtitle} · ${scope} · ${formatDate(report.period.from)}–${formatDate(report.period.to)}`
    ),
  ])
}

function reportFooter(report: VehicleLogbookReportData) {
  return h(View, { style: styles.footer, fixed: true }, [
    h(
      Text,
      { key: 'generated' },
      `Vygenerováno ${new Intl.DateTimeFormat('cs-CZ', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Europe/Prague',
      }).format(new Date(report.generatedAt))}`
    ),
    h(Text, {
      key: 'page',
      render: ({ pageNumber, totalPages }) =>
        `Strana ${pageNumber} / ${totalPages}`,
    }),
  ])
}

function metric(
  key: string,
  label: string,
  value: string,
  detail?: string
) {
  return h(View, { key, style: styles.metric }, [
    h(Text, { key: 'label', style: styles.metricLabel }, label),
    h(Text, { key: 'value', style: styles.metricValue }, value),
    detail
      ? h(Text, { key: 'detail', style: styles.metricDetail }, detail)
      : null,
  ])
}

function row(
  key: string,
  cells: Array<{ value: string; width: string; bold?: boolean; muted?: string }>
) {
  return h(
    View,
    { key, style: styles.row, wrap: false },
    cells.map((cell, index) =>
      h(View, { key: index, style: [styles.cell, { width: cell.width }] }, [
        h(
          Text,
          { key: 'value', style: cell.bold ? styles.bold : undefined },
          cell.value
        ),
        cell.muted
          ? h(Text, { key: 'muted', style: styles.muted }, cell.muted)
          : null,
      ])
    )
  )
}

function head(cells: Array<{ value: string; width: string }>) {
  return h(
    View,
    { style: [styles.row, styles.head] },
    cells.map((cell) =>
      h(
        Text,
        {
          key: cell.value,
          style: [styles.cell, styles.bold, { width: cell.width }],
        },
        cell.value
      )
    )
  )
}

function ReportDocument({ report }: { report: VehicleLogbookReportData }) {
  return h(Document, null, [
    h(
      Page,
      { key: 'summary', size: 'A4', orientation: 'landscape', style: styles.page },
      [
        reportHeader(
          report,
          'Souhrnný report knih jízd',
          'Provozní a finanční přehled'
        ),
        h(View, { key: 'metrics', style: styles.metrics }, [
          metric(
            'distance',
            'Celkem kilometrů',
            `${formatNumber(report.metrics.totalKm)} km`,
            `${formatNumber(report.metrics.businessKm)} služebních · ${formatNumber(report.metrics.privateKm)} soukromých`
          ),
          metric(
            'share',
            'Služební podíl',
            `${formatNumber(report.metrics.businessShare, 1)} %`,
            `${report.metrics.tripCount} záznamů`
          ),
          metric(
            'net',
            'Náklady bez DPH',
            formatCurrency(report.metrics.fuelNetAmount),
            `DPH ${formatCurrency(report.metrics.fuelVatAmount)}`
          ),
          metric(
            'gross',
            'Náklady s DPH',
            formatCurrency(report.metrics.fuelGrossAmount),
            report.metrics.costPerKmGross === null
              ? 'Náklad na km nelze určit'
              : `${formatCurrency(report.metrics.costPerKmGross)} / km`
          ),
          metric(
            'closures',
            'Uzávěrky',
            `${report.metrics.validClosureCount} platných`,
            `${report.metrics.changedClosureCount} změněných · ${report.metrics.missingClosureCount} chybí`
          ),
        ]),
        h(Text, { key: 'vehicle-title', style: styles.sectionTitle }, 'Přehled podle vozidel'),
        h(View, { key: 'vehicles', style: styles.table }, [
          head([
            { value: 'Vozidlo', width: '19%' },
            { value: 'Jízdy', width: '7%' },
            { value: 'Celkem km', width: '10%' },
            { value: 'Služební', width: '9%' },
            { value: 'Soukromé', width: '9%' },
            { value: 'Bez DPH', width: '12%' },
            { value: 'DPH', width: '11%' },
            { value: 'S DPH', width: '12%' },
            { value: 'Kč/km s DPH', width: '11%' },
          ]),
          ...report.vehicleSummaries.map((vehicle) =>
            row(vehicle.vehicleId, [
              {
                value: vehicle.vehicleName,
                muted: vehicle.registrationPlate,
                width: '19%',
                bold: true,
              },
              { value: String(vehicle.tripCount), width: '7%' },
              { value: formatNumber(vehicle.totalKm), width: '10%' },
              { value: formatNumber(vehicle.businessKm), width: '9%' },
              { value: formatNumber(vehicle.privateKm), width: '9%' },
              { value: formatCurrency(vehicle.fuelNetAmount), width: '12%' },
              { value: formatCurrency(vehicle.fuelVatAmount), width: '11%' },
              {
                value: formatCurrency(vehicle.fuelGrossAmount),
                width: '12%',
                bold: true,
              },
              {
                value:
                  vehicle.costPerKmGross === null
                    ? '—'
                    : formatCurrency(vehicle.costPerKmGross),
                width: '11%',
              },
            ])
          ),
          ...(report.vehicleSummaries.length === 0
            ? [
                h(
                  Text,
                  { key: 'empty', style: styles.empty },
                  'Nejsou dostupná vozidla.'
                ),
              ]
            : []),
        ]),
        reportFooter(report),
      ]
    ),
    h(
      Page,
      { key: 'trips', size: 'A4', orientation: 'landscape', style: styles.page },
      [
        reportHeader(report, 'Kniha jízd', `${report.entries.length} záznamů`),
        h(View, { key: 'trips-table', style: styles.table }, [
          head([
            { value: 'Datum', width: '9%' },
            { value: 'Vozidlo', width: '14%' },
            { value: 'Trasa', width: '22%' },
            { value: 'Účel', width: '17%' },
            { value: 'Využití', width: '9%' },
            { value: 'Poč. km', width: '8%' },
            { value: 'Kon. km', width: '8%' },
            { value: 'Služ.', width: '6.5%' },
            { value: 'Soukr.', width: '6.5%' },
          ]),
          ...report.entries.map((entry) =>
            row(entry.id, [
              { value: formatDate(entry.date), width: '9%' },
              {
                value: entry.vehicleName,
                muted: entry.registrationPlate,
                width: '14%',
                bold: true,
              },
              {
                value: `${entry.origin} → ${entry.destination}`,
                width: '22%',
                bold: true,
              },
              { value: entry.purpose, width: '17%' },
              { value: usageLabel(entry.usageType), width: '9%' },
              { value: formatNumber(entry.odometerStartKm), width: '8%' },
              { value: formatNumber(entry.odometerEndKm), width: '8%' },
              { value: formatNumber(entry.businessKm), width: '6.5%' },
              { value: formatNumber(entry.privateKm), width: '6.5%' },
            ])
          ),
          ...(report.entries.length === 0
            ? [
                h(
                  Text,
                  { key: 'empty', style: styles.empty },
                  'Ve zvoleném období nejsou žádné jízdy.'
                ),
              ]
            : []),
        ]),
        reportFooter(report),
      ]
    ),
    h(
      Page,
      { key: 'fuel', size: 'A4', orientation: 'landscape', style: styles.page },
      [
        reportHeader(
          report,
          'PHM a nabíjení',
          `${report.fuelEntries.length} záznamů`
        ),
        h(View, { key: 'fuel-metrics', style: styles.metrics }, [
          metric('fuel-net', 'Bez DPH', formatCurrency(report.metrics.fuelNetAmount)),
          metric('fuel-vat', 'DPH', formatCurrency(report.metrics.fuelVatAmount)),
          metric('fuel-gross', 'S DPH', formatCurrency(report.metrics.fuelGrossAmount)),
          metric(
            'fuel-km',
            'Náklad na km',
            report.metrics.costPerKmGross === null
              ? '—'
              : formatCurrency(report.metrics.costPerKmGross),
            'včetně DPH'
          ),
        ]),
        h(View, { key: 'fuel-table', style: styles.table }, [
          head([
            { value: 'Datum', width: '9%' },
            { value: 'Vozidlo', width: '16%' },
            { value: 'Energie', width: '8%' },
            { value: 'Množství', width: '10%' },
            { value: 'Dodavatel / doklad', width: '19%' },
            { value: 'Tachometr', width: '9%' },
            { value: 'Bez DPH', width: '10%' },
            { value: 'DPH', width: '9%' },
            { value: 'S DPH', width: '10%' },
          ]),
          ...report.fuelEntries.map((entry) =>
            row(entry.id, [
              { value: formatDate(entry.date), width: '9%' },
              {
                value: entry.vehicleName,
                muted: entry.registrationPlate,
                width: '16%',
                bold: true,
              },
              { value: energyLabel(entry.energyType), width: '8%' },
              {
                value: `${formatNumber(entry.quantity, 3)} ${entry.unit === 'kwh' ? 'kWh' : 'l'}`,
                width: '10%',
              },
              {
                value: entry.supplier ?? '—',
                muted: entry.documentNumber ?? 'Bez čísla dokladu',
                width: '19%',
              },
              { value: formatNumber(entry.odometerKm), width: '9%' },
              { value: formatCurrency(entry.netAmount), width: '10%' },
              { value: formatCurrency(entry.vatAmount), width: '9%' },
              {
                value: formatCurrency(entry.grossAmount),
                width: '10%',
                bold: true,
              },
            ])
          ),
          ...(report.fuelEntries.length === 0
            ? [
                h(
                  Text,
                  { key: 'empty', style: styles.empty },
                  'Ve zvoleném období není tankování ani nabíjení.'
                ),
              ]
            : []),
        ]),
        reportFooter(report),
      ]
    ),
    h(
      Page,
      {
        key: 'closures',
        size: 'A4',
        orientation: 'landscape',
        style: styles.page,
      },
      [
        reportHeader(
          report,
          'Měsíční uzávěrky',
          `${report.closures.length} uložených uzávěrek`
        ),
        h(View, { key: 'closures-table', style: styles.table }, [
          head([
            { value: 'Období', width: '8%' },
            { value: 'Vozidlo', width: '17%' },
            { value: 'Stav', width: '9%' },
            { value: 'Poč. km', width: '9%' },
            { value: 'Kon. km', width: '9%' },
            { value: 'Služební', width: '8%' },
            { value: 'Soukromé', width: '8%' },
            { value: 'Bez DPH', width: '11%' },
            { value: 'DPH', width: '10%' },
            { value: 'S DPH', width: '11%' },
          ]),
          ...report.closures.map((closure) =>
            row(closure.id, [
              { value: formatMonth(closure.period), width: '8%' },
              {
                value: closure.vehicleName,
                muted: closure.registrationPlate,
                width: '17%',
                bold: true,
              },
              {
                value: closure.changedAfterClosure ? 'Změněná' : 'Platná',
                width: '9%',
              },
              {
                value:
                  closure.openingOdometerKm === null
                    ? '—'
                    : formatNumber(closure.openingOdometerKm),
                width: '9%',
              },
              {
                value:
                  closure.closingOdometerKm === null
                    ? '—'
                    : formatNumber(closure.closingOdometerKm),
                width: '9%',
              },
              { value: formatNumber(closure.businessKm), width: '8%' },
              { value: formatNumber(closure.privateKm), width: '8%' },
              { value: formatCurrency(closure.fuelNetAmount), width: '11%' },
              { value: formatCurrency(closure.fuelVatAmount), width: '10%' },
              {
                value: formatCurrency(closure.fuelGrossAmount),
                width: '11%',
                bold: true,
              },
            ])
          ),
          ...(report.closures.length === 0
            ? [
                h(
                  Text,
                  { key: 'empty', style: styles.empty },
                  'Ve zvoleném období nejsou vytvořené uzávěrky.'
                ),
              ]
            : []),
        ]),
        reportFooter(report),
      ]
    ),
  ])
}

function fileName(report: VehicleLogbookReportData) {
  const scope =
    report.scope === 'fleet'
      ? 'vozovy-park'
      : report.vehicles[0]?.registrationPlate
          .toLocaleLowerCase('cs-CZ')
          .replaceAll(/[^a-z0-9]+/g, '-') || 'vozidlo'
  return `kniha-jizd-${scope}-${report.period.from}-${report.period.to}.pdf`
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nejsi přihlášený.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>()
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 })
  }

  const input = {
    vehicleId: request.nextUrl.searchParams.get('vehicle') || null,
    from: request.nextUrl.searchParams.get('from') ?? '',
    to: request.nextUrl.searchParams.get('to') ?? '',
  }
  const validationError = validateVehicleLogbookReportInput(input)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  try {
    const report = await loadVehicleLogbookReport(supabase, input)
    const buffer = await renderToBuffer(ReportDocument({ report }))
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName(report)}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'PDF report se nepodařilo vytvořit.',
      },
      { status: 500 }
    )
  }
}
