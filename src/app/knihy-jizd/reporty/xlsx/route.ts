import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import {
  loadVehicleLogbookReport,
  validateVehicleLogbookReportInput,
  type VehicleLogbookReportData,
} from '@/lib/vehicle-logbook/reports'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const COLORS = {
  navy: '172033',
  blue: '2F77AF',
  blueLight: 'E8F2F9',
  slate: '64748B',
  line: 'DCE5EE',
  surface: 'F6F9FC',
  white: 'FFFFFF',
  green: 'DDF5EB',
  amber: 'FFF1D6',
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

function formatGeneratedAt(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function usageLabel(value: string) {
  if (value === 'private') return 'Soukromá'
  if (value === 'mixed') return 'Smíšená'
  return 'Služební'
}

function entryTypeLabel(value: string) {
  return value === 'daily_summary' ? 'Denní souhrn' : 'Jízda'
}

function energyLabel(value: string) {
  if (value === 'diesel') return 'Nafta'
  if (value === 'electricity') return 'Elektřina'
  return 'Benzín'
}

function styleTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string) {
  sheet.mergeCells('A1:K1')
  sheet.getCell('A1').value = title
  sheet.getCell('A1').font = {
    name: 'Arial',
    size: 18,
    bold: true,
    color: { argb: COLORS.navy },
  }
  sheet.getCell('A1').alignment = { vertical: 'middle' }
  sheet.getRow(1).height = 30

  sheet.mergeCells('A2:K2')
  sheet.getCell('A2').value = subtitle
  sheet.getCell('A2').font = {
    name: 'Arial',
    size: 9,
    color: { argb: COLORS.slate },
  }
  sheet.getRow(2).height = 20
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 25
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blue } }
    cell.font = {
      name: 'Arial',
      size: 9,
      bold: true,
      color: { argb: COLORS.white },
    }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: COLORS.line } },
    }
  })
}

function styleDataRows(sheet: ExcelJS.Worksheet, from: number, to: number) {
  for (let rowNumber = from; rowNumber <= to; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    row.height = 22
    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 9, color: { argb: COLORS.navy } }
      cell.alignment = { vertical: 'middle' }
      cell.border = {
        bottom: { style: 'hair', color: { argb: COLORS.line } },
      }
      if (rowNumber % 2 === 0) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: COLORS.surface },
        }
      }
    })
  }
}

function writeRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  values: ExcelJS.CellValue[]
) {
  const row = sheet.getRow(rowNumber)
  values.forEach((value, index) => {
    row.getCell(index + 1).value = value
  })
}

function setNumberFormat(
  sheet: ExcelJS.Worksheet,
  fromRow: number,
  toRow: number,
  fromColumn: number,
  toColumn: number,
  numberFormat: string
) {
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let column = fromColumn; column <= toColumn; column += 1) {
      sheet.getRow(row).getCell(column).numFmt = numberFormat
    }
  }
}

function setupSheet(sheet: ExcelJS.Worksheet) {
  sheet.properties.defaultRowHeight = 20
  sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }]
  sheet.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.4,
      bottom: 0.4,
      header: 0.2,
      footer: 0.2,
    },
  }
}

function createSummarySheet(
  workbook: ExcelJS.Workbook,
  report: VehicleLogbookReportData
) {
  const sheet = workbook.addWorksheet('Souhrn')
  sheet.views = [{ showGridLines: false }]
  sheet.columns = [
    { width: 24 },
    { width: 18 },
    { width: 3 },
    { width: 24 },
    { width: 18 },
    { width: 3 },
    { width: 24 },
    { width: 18 },
    { width: 3 },
    { width: 24 },
    { width: 18 },
  ]

  styleTitle(
    sheet,
    'Souhrnný report knih jízd',
    `${report.scope === 'fleet' ? 'Všechna vozidla' : `${report.vehicles[0]?.name ?? 'Vozidlo'} · ${report.vehicles[0]?.registrationPlate ?? '—'}`} | ${report.period.from} až ${report.period.to} | Vygenerováno ${formatGeneratedAt(report.generatedAt)}`
  )

  const cards = [
    ['A4:B4', 'A5:B6', 'Celkem kilometrů', report.metrics.totalKm, '#,##0 "km"'],
    ['D4:E4', 'D5:E6', 'Služební podíl', report.metrics.businessShare / 100, '0.0%'],
    ['G4:H4', 'G5:H6', 'Náklady bez DPH', report.metrics.fuelNetAmount, '#,##0.00 "Kč"'],
    ['J4:K4', 'J5:K6', 'Náklady s DPH', report.metrics.fuelGrossAmount, '#,##0.00 "Kč"'],
  ] as const

  for (const [labelRange, valueRange, label, value, numberFormat] of cards) {
    sheet.mergeCells(labelRange)
    sheet.mergeCells(valueRange)
    const labelCell = sheet.getCell(labelRange.split(':')[0])
    labelCell.value = label
    labelCell.font = {
      name: 'Arial',
      size: 8,
      bold: true,
      color: { argb: COLORS.slate },
    }
    labelCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.blueLight },
    }
    labelCell.alignment = { vertical: 'middle' }

    const valueCell = sheet.getCell(valueRange.split(':')[0])
    valueCell.value = value
    valueCell.numFmt = numberFormat
    valueCell.font = {
      name: 'Arial',
      size: 16,
      bold: true,
      color: { argb: COLORS.navy },
    }
    valueCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.blueLight },
    }
    valueCell.alignment = { vertical: 'middle' }
  }

  sheet.getRow(4).height = 20
  sheet.getRow(5).height = 25
  sheet.getRow(6).height = 25

  sheet.getCell('A8').value = 'Kontrolní součty'
  sheet.getCell('A8').font = {
    name: 'Arial',
    size: 11,
    bold: true,
    color: { argb: COLORS.navy },
  }
  writeRow(sheet, 9, ['Ukazatel', 'Hodnota', 'Ukazatel', 'Hodnota', 'Poznámka'])
  styleHeader(sheet.getRow(9))
  const checks = [
    ['Počet vozidel', report.metrics.vehicleCount, 'Počet jízd', report.metrics.tripCount, ''],
    ['Služební km', report.metrics.businessKm, 'Soukromé km', report.metrics.privateKm, ''],
    ['Tankování', report.metrics.fuelEntryCount, 'DPH', report.metrics.fuelVatAmount, 'Kč'],
    ['Platné uzávěrky', report.metrics.validClosureCount, 'Změněné uzávěrky', report.metrics.changedClosureCount, ''],
    ['Chybějící uzávěrky', report.metrics.missingClosureCount, 'Náklad s DPH / km', report.metrics.costPerKmGross, 'Kč/km'],
  ]
  checks.forEach((check, index) => writeRow(sheet, 10 + index, check))
  styleDataRows(sheet, 10, 9 + checks.length)
  setNumberFormat(sheet, 10, 9 + checks.length, 2, 2, '#,##0.00')
  setNumberFormat(sheet, 10, 9 + checks.length, 4, 4, '#,##0.00')

  const vehicleStart = 17
  sheet.getCell(`A${vehicleStart}`).value = 'Přehled podle vozidel'
  sheet.getCell(`A${vehicleStart}`).font = {
    name: 'Arial',
    size: 11,
    bold: true,
    color: { argb: COLORS.navy },
  }
  const vehicleHeader = vehicleStart + 1
  writeRow(sheet, vehicleHeader, [
    'Vozidlo',
    'SPZ',
    'Jízdy',
    'Celkem km',
    'Služební km',
    'Soukromé km',
    'Služební podíl',
    'Bez DPH',
    'DPH',
    'S DPH',
    'Kč/km s DPH',
  ])
  styleHeader(sheet.getRow(vehicleHeader))
  report.vehicleSummaries.forEach((vehicle, index) => {
    const row = vehicleHeader + 1 + index
    writeRow(sheet, row, [
      vehicle.vehicleName,
      vehicle.registrationPlate,
      vehicle.tripCount,
      vehicle.totalKm,
      vehicle.businessKm,
      vehicle.privateKm,
      vehicle.businessShare / 100,
      vehicle.fuelNetAmount,
      vehicle.fuelVatAmount,
      vehicle.fuelGrossAmount,
      vehicle.costPerKmGross,
    ])
  })
  const vehicleLast = Math.max(vehicleHeader, vehicleHeader + report.vehicleSummaries.length)
  if (report.vehicleSummaries.length > 0) {
    styleDataRows(sheet, vehicleHeader + 1, vehicleLast)
    setNumberFormat(sheet, vehicleHeader + 1, vehicleLast, 3, 6, '#,##0')
    setNumberFormat(sheet, vehicleHeader + 1, vehicleLast, 7, 7, '0.0%')
    setNumberFormat(
      sheet,
      vehicleHeader + 1,
      vehicleLast,
      8,
      11,
      '#,##0.00 "Kč"'
    )
  }
  sheet.autoFilter = {
    from: { row: vehicleHeader, column: 1 },
    to: { row: vehicleLast, column: 11 },
  }
}

function createTripsSheet(
  workbook: ExcelJS.Workbook,
  report: VehicleLogbookReportData
) {
  const sheet = workbook.addWorksheet('Jízdy')
  setupSheet(sheet)
  sheet.columns = [
    { width: 13 },
    { width: 7 },
    { width: 24 },
    { width: 13 },
    { width: 24 },
    { width: 24 },
    { width: 28 },
    { width: 14 },
    { width: 13 },
    { width: 13 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 30 },
  ]
  styleTitle(
    sheet,
    'Kniha jízd',
    `${report.period.from} až ${report.period.to} | ${report.entries.length} záznamů`
  )
  writeRow(sheet, 4, [
    'Datum',
    'Pořadí',
    'Vozidlo',
    'SPZ',
    'Výchozí místo',
    'Cíl',
    'Účel',
    'Využití',
    'Typ záznamu',
    'Počáteční km',
    'Konečný km',
    'Služební km',
    'Soukromé km',
    'Poznámka',
  ])
  styleHeader(sheet.getRow(4))
  report.entries.forEach((entry, index) => {
    const row = 5 + index
    writeRow(sheet, row, [
      formatDate(entry.date),
      entry.sequence,
      entry.vehicleName,
      entry.registrationPlate,
      entry.origin,
      entry.destination,
      entry.purpose,
      usageLabel(entry.usageType),
      entryTypeLabel(entry.entryType),
      entry.odometerStartKm,
      entry.odometerEndKm,
      entry.businessKm,
      entry.privateKm,
      entry.note ?? '',
    ])
  })
  const last = Math.max(4, 4 + report.entries.length)
  if (report.entries.length > 0) {
    styleDataRows(sheet, 5, last)
    setNumberFormat(sheet, 5, last, 1, 1, 'yyyy-mm-dd')
    setNumberFormat(sheet, 5, last, 10, 13, '#,##0')
  }
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: 14 } }
}

function createFuelSheet(
  workbook: ExcelJS.Workbook,
  report: VehicleLogbookReportData
) {
  const sheet = workbook.addWorksheet('PHM a nabíjení')
  setupSheet(sheet)
  sheet.columns = [
    { width: 13 },
    { width: 24 },
    { width: 13 },
    { width: 14 },
    { width: 13 },
    { width: 11 },
    { width: 14 },
    { width: 24 },
    { width: 18 },
    { width: 12 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 13 },
  ]
  styleTitle(
    sheet,
    'PHM a nabíjení',
    `${report.period.from} až ${report.period.to} | ${report.fuelEntries.length} záznamů`
  )
  writeRow(sheet, 4, [
    'Datum',
    'Vozidlo',
    'SPZ',
    'Energie',
    'Množství',
    'Jednotka',
    'Tachometr',
    'Dodavatel',
    'Číslo dokladu',
    'Sazba DPH',
    'Bez DPH',
    'DPH',
    'S DPH',
    'Plná nádrž',
  ])
  styleHeader(sheet.getRow(4))
  report.fuelEntries.forEach((entry, index) => {
    const row = 5 + index
    writeRow(sheet, row, [
      formatDate(entry.date),
      entry.vehicleName,
      entry.registrationPlate,
      energyLabel(entry.energyType),
      entry.quantity,
      entry.unit === 'kwh' ? 'kWh' : 'l',
      entry.odometerKm,
      entry.supplier ?? '',
      entry.documentNumber ?? '',
      entry.vatRate / 100,
      entry.netAmount,
      entry.vatAmount,
      entry.grossAmount,
      entry.isFullTank ? 'Ano' : 'Ne',
    ])
  })
  const last = Math.max(4, 4 + report.fuelEntries.length)
  if (report.fuelEntries.length > 0) {
    styleDataRows(sheet, 5, last)
    setNumberFormat(sheet, 5, last, 1, 1, 'yyyy-mm-dd')
    setNumberFormat(sheet, 5, last, 5, 5, '#,##0.000')
    setNumberFormat(sheet, 5, last, 7, 7, '#,##0')
    setNumberFormat(sheet, 5, last, 10, 10, '0.00%')
    setNumberFormat(sheet, 5, last, 11, 13, '#,##0.00 "Kč"')
  }
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: 14 } }
}

function createClosuresSheet(
  workbook: ExcelJS.Workbook,
  report: VehicleLogbookReportData
) {
  const sheet = workbook.addWorksheet('Uzávěrky')
  setupSheet(sheet)
  sheet.columns = [
    { width: 13 },
    { width: 24 },
    { width: 13 },
    { width: 14 },
    { width: 15 },
    { width: 15 },
    { width: 13 },
    { width: 13 },
    { width: 13 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 20 },
  ]
  styleTitle(
    sheet,
    'Měsíční uzávěrky',
    `${report.period.from} až ${report.period.to} | ${report.closures.length} uzávěrek`
  )
  writeRow(sheet, 4, [
    'Období',
    'Vozidlo',
    'SPZ',
    'Stav',
    'Počáteční km',
    'Konečný km',
    'Služební km',
    'Soukromé km',
    'Celkem km',
    'Bez DPH',
    'DPH',
    'S DPH',
    'Přepočteno',
  ])
  styleHeader(sheet.getRow(4))
  report.closures.forEach((closure, index) => {
    const rowNumber = 5 + index
    writeRow(sheet, rowNumber, [
      closure.period,
      closure.vehicleName,
      closure.registrationPlate,
      closure.changedAfterClosure ? 'Změněná' : 'Platná',
      closure.openingOdometerKm,
      closure.closingOdometerKm,
      closure.businessKm,
      closure.privateKm,
      closure.totalKm,
      closure.fuelNetAmount,
      closure.fuelVatAmount,
      closure.fuelGrossAmount,
      new Date(closure.calculatedAt),
    ])
    sheet.getCell(`D${rowNumber}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: closure.changedAfterClosure ? COLORS.amber : COLORS.green,
      },
    }
  })
  const last = Math.max(4, 4 + report.closures.length)
  if (report.closures.length > 0) {
    styleDataRows(sheet, 5, last)
    setNumberFormat(sheet, 5, last, 5, 9, '#,##0')
    setNumberFormat(sheet, 5, last, 10, 12, '#,##0.00 "Kč"')
    setNumberFormat(sheet, 5, last, 13, 13, 'yyyy-mm-dd hh:mm')
  }
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: 13 } }
}

function fileName(report: VehicleLogbookReportData) {
  const scope =
    report.scope === 'fleet'
      ? 'vozovy-park'
      : report.vehicles[0]?.registrationPlate
          .toLocaleLowerCase('cs-CZ')
          .replaceAll(/[^a-z0-9]+/g, '-') || 'vozidlo'
  return `kniha-jizd-${scope}-${report.period.from}-${report.period.to}.xlsx`
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
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'B-Energy App'
    workbook.created = new Date(report.generatedAt)
    workbook.modified = new Date(report.generatedAt)
    workbook.calcProperties.fullCalcOnLoad = true

    createSummarySheet(workbook, report)
    createTripsSheet(workbook, report)
    createFuelSheet(workbook, report)
    createClosuresSheet(workbook, report)

    const buffer = await workbook.xlsx.writeBuffer()
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName(report)}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'XLSX report se nepodařilo vytvořit.',
      },
      { status: 500 }
    )
  }
}
