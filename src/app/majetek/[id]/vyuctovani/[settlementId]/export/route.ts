import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { createClient } from '@/lib/supabase/server'
import { canViewAssetsSection } from '@/lib/majetek/access'
import {
  calculateAdvancePaymentsForPeriod,
  buildSettlementLineItems,
  type RentalServiceAdvanceHistoryRow,
  type RentalServiceSettlementCustomItemRow,
  type RentalServiceSettlementRow,
} from '@/lib/majetek/rental-settlements'

type ProfilePermissionRow = {
  role: string | null
  majetek: boolean | null
}

type AssetRow = {
  id: string
  name: string
}

type RentalRow = {
  id: string
  asset_id: string
  tenant_name: string | null
  tenant_contact: string | null
}

function formatMonthLabel(value: string | null) {
  if (!value) return '—'
  const [year, month] = value.slice(0, 7).split('-')
  if (!year || !month) return value.slice(0, 7)
  return `${month}/${year}`
}

function buildFileName(settlementCode: string) {
  const safe = settlementCode
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')

  return `${safe || 'vyuctovani'}.xlsx`
}

function formatDateTimeForExcel(value: string | null) {
  if (!value) return ''

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string; settlementId: string }> }
) {
  try {
    const { id: assetId, settlementId } = await context.params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Nejsi přihlášený.' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, majetek')
      .eq('id', user.id)
      .single()

    if (profileError) {
      await reportRouteError({
        error: profileError,
        route: '/app/majetek/[id]/vyuctovani/[settlementId]/export',
        section: 'majetek',
        errorType: 'AssetSettlementExportProfileError',
        userId: user.id,
      })
      return NextResponse.json(
        { error: 'Nepodařilo se ověřit oprávnění uživatele.' },
        { status: 500 }
      )
    }

    const typedProfile = profile as ProfilePermissionRow | null
    if (!canViewAssetsSection(typedProfile?.role ?? null, typedProfile)) {
      return NextResponse.json(
        { error: 'Nemáš oprávnění pro export vyúčtování.' },
        { status: 403 }
      )
    }

    const [{ data: asset, error: assetError }, { data: settlement, error: settlementError }] =
      await Promise.all([
        supabase
          .from('assets')
          .select('id, name')
          .eq('id', assetId)
          .maybeSingle<AssetRow>(),
        supabase
      .from('asset_rental_service_settlements')
      .select('id, asset_id, rental_id, settlement_code, period_from, period_to, tenant_name_snapshot, tenant_contact_snapshot, status, electricity_amount, hot_water_heating_amount, space_heating_amount, common_area_cleaning_amount, cold_water_sewer_amount, hot_water_sewer_amount, advance_payments_total_amount, service_total_amount, balance_amount, settled_on, settled_by, settled_note, note, closed_at, closed_by, created_by, created_at, updated_at')
      .eq('id', settlementId)
      .eq('asset_id', assetId)
      .maybeSingle<RentalServiceSettlementRow>(),
      ])

    if (assetError) {
      await reportRouteError({
        error: assetError,
        route: '/app/majetek/[id]/vyuctovani/[settlementId]/export',
        section: 'majetek',
        errorType: 'AssetSettlementExportAssetError',
        userId: user.id,
        context: { assetId, settlementId },
      })
      return NextResponse.json(
        { error: 'Nepodařilo se načíst majetek pro export.' },
        { status: 500 }
      )
    }

    if (settlementError) {
      await reportRouteError({
        error: settlementError,
        route: '/app/majetek/[id]/vyuctovani/[settlementId]/export',
        section: 'majetek',
        errorType: 'AssetSettlementExportSettlementError',
        userId: user.id,
        context: { assetId, settlementId },
      })
      return NextResponse.json(
        { error: 'Nepodařilo se načíst vyúčtování pro export.' },
        { status: 500 }
      )
    }

    if (!asset || !settlement) {
      return NextResponse.json(
        { error: 'Vyúčtování nebylo nalezeno.' },
        { status: 404 }
      )
    }

    const { data: rental, error: rentalError } = await supabase
      .from('asset_rentals')
      .select('id, asset_id, tenant_name, tenant_contact')
      .eq('id', settlement.rental_id)
      .eq('asset_id', asset.id)
      .maybeSingle<RentalRow>()

    if (rentalError) {
      await reportRouteError({
        error: rentalError,
        route: '/app/majetek/[id]/vyuctovani/[settlementId]/export',
        section: 'majetek',
        errorType: 'AssetSettlementExportRentalError',
        userId: user.id,
        context: { assetId, settlementId },
      })
      return NextResponse.json(
        { error: 'Nepodařilo se načíst pronájem pro export.' },
        { status: 500 }
      )
    }

    if (!rental) {
      return NextResponse.json(
        { error: 'Pronájem pro vyúčtování nebyl nalezen.' },
        { status: 404 }
      )
    }

    const { data: historyRows, error: historyError } = await supabase
      .from('asset_rental_service_advance_history')
      .select('id, rental_id, effective_from, monthly_advance, note, created_at, updated_at')
      .eq('rental_id', rental.id)
      .order('effective_from', { ascending: true })
      .order('created_at', { ascending: true })

    const { data: customItemRows, error: customItemError } = await supabase
      .from('asset_rental_service_settlement_custom_items')
      .select('id, settlement_id, title, amount, sort_order, created_by, created_at, updated_at')
      .eq('settlement_id', settlement.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (historyError) {
      await reportRouteError({
        error: historyError,
        route: '/app/majetek/[id]/vyuctovani/[settlementId]/export',
        section: 'majetek',
        errorType: 'AssetSettlementExportHistoryError',
        userId: user.id,
        context: { assetId, settlementId },
      })
      return NextResponse.json(
        { error: 'Nepodařilo se načíst historii záloh pro export.' },
        { status: 500 }
      )
    }

    if (customItemError) {
      await reportRouteError({
        error: customItemError,
        route: '/app/majetek/[id]/vyuctovani/[settlementId]/export',
        section: 'majetek',
        errorType: 'AssetSettlementExportCustomItemsError',
        userId: user.id,
        context: { assetId, settlementId },
      })
      return NextResponse.json(
        { error: 'Nepodařilo se načíst vlastní položky pro export.' },
        { status: 500 }
      )
    }

    const history = (historyRows ?? []) as RentalServiceAdvanceHistoryRow[]
    const customItems = (customItemRows ?? []) as RentalServiceSettlementCustomItemRow[]
    const advanceCalculation = calculateAdvancePaymentsForPeriod({
      history,
      periodFrom: settlement.period_from,
      periodTo: settlement.period_to,
    })
    const lineItems = buildSettlementLineItems({
      settlement,
      customItems,
    })
    const customLineItems = lineItems.filter((item) => item.kind === 'custom')

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Vyúčtování')

    worksheet.columns = [
      { header: 'Položka', key: 'label', width: 34 },
      { header: 'Hodnota', key: 'value', width: 18 },
      { header: 'Poznámka', key: 'note', width: 40 },
    ]

    worksheet.mergeCells('A1:C1')
    worksheet.getCell('A1').value = `Vyúčtování služeb - ${settlement.settlement_code}`
    worksheet.getCell('A1').font = { bold: true, size: 14 }

    worksheet.addRow(['Majetek', asset.name, ''])
    worksheet.addRow(['Nájemce', settlement.tenant_name_snapshot, settlement.tenant_contact_snapshot ?? ''])
    worksheet.addRow(['Období', `${formatMonthLabel(settlement.period_from)} - ${formatMonthLabel(settlement.period_to)}`, ''])
    worksheet.addRow(['Stav', settlement.status === 'closed' ? 'Uzavřené' : 'Koncept', ''])
    worksheet.addRow(['Exportováno', formatDateTimeForExcel(new Date().toISOString()), ''])
    worksheet.addRow([])

    const summaryHeader = worksheet.addRow([
      'Nájemce',
      'Období od',
      'Období do',
      'El. energie',
      'Ohřev TV',
      'Otop',
      'Úklid',
      'Vodné SV',
      'Vodné TV',
      'Zálohy celkem',
      'Služby celkem',
      'Výsledek',
    ])
    summaryHeader.font = { bold: true }
    summaryHeader.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }

    const summaryRow = worksheet.addRow([
      settlement.tenant_name_snapshot,
      formatMonthLabel(settlement.period_from),
      formatMonthLabel(settlement.period_to),
      settlement.electricity_amount,
      settlement.hot_water_heating_amount,
      settlement.space_heating_amount,
      settlement.common_area_cleaning_amount,
      settlement.cold_water_sewer_amount,
      settlement.hot_water_sewer_amount,
      settlement.advance_payments_total_amount,
      settlement.service_total_amount,
      settlement.balance_amount,
    ])
    summaryRow.font = { bold: true }

    worksheet.addRow([])

    if (customLineItems.length > 0) {
      const customTitleRow = worksheet.addRow(['Vlastní položky'])
      customTitleRow.font = { bold: true }
      worksheet.mergeCells(customTitleRow.number, 1, customTitleRow.number, 3)

      customLineItems.forEach((entry) => {
        const row = worksheet.addRow([entry.title, entry.amount, ''])
        row.getCell(2).numFmt = '#,##0 "Kč"'
      })

      worksheet.addRow([])
    }

    const monthHeader = worksheet.addRow(['Měsíc', 'Záloha', 'Zdroj'])
    monthHeader.font = { bold: true }
    monthHeader.alignment = { vertical: 'middle', horizontal: 'center' }

    advanceCalculation.monthBreakdown.forEach((entry) => {
      const row = worksheet.addRow([entry.month, entry.monthlyAdvance, entry.sourceAdvanceId ?? ''])
      row.getCell(2).numFmt = '#,##0 "Kč"'
    })

    worksheet.addRow([])
    const totalsRow = worksheet.addRow([
      'Součet služeb',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      settlement.advance_payments_total_amount,
      settlement.service_total_amount,
      settlement.balance_amount,
    ])
    totalsRow.font = { bold: true }

    worksheet.getColumn(2).alignment = { horizontal: 'left' }
    worksheet.getColumn(3).alignment = { horizontal: 'left' }
    for (const column of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      worksheet.getColumn(column).alignment = { horizontal: 'right' }
      worksheet.getColumn(column).numFmt = '#,##0 "Kč"'
    }

    worksheet.getColumn(1).alignment = { horizontal: 'left' }
    worksheet.getColumn(10).numFmt = '#,##0 "Kč"'
    worksheet.getColumn(11).numFmt = '#,##0 "Kč"'
    worksheet.getColumn(12).numFmt = '#,##0 "Kč"'

    const buffer = await workbook.xlsx.writeBuffer()

    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${buildFileName(settlement.settlement_code)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/app/majetek/[id]/vyuctovani/[settlementId]/export',
      section: 'majetek',
      errorType: 'AssetSettlementExportUnhandledError',
    })

    return NextResponse.json(
      { error: 'Nepodařilo se vygenerovat export vyúčtování.' },
      { status: 500 }
    )
  }
}
