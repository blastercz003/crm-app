import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import {
  getProvizeHistoryBatchById,
  requireProvizeHistoryAccess,
} from '@/lib/provize/history'

export const runtime = 'nodejs'

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function buildFileName(salesOwner: string, confirmedAt: string) {
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(confirmedAt))

  const ownerPart = salesOwner
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')

  return `provize-${ownerPart || 'obchodnik'}-${datePart}.xlsx`
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await context.params

  try {
    const access = await requireProvizeHistoryAccess()

    if (!access.success) {
      return NextResponse.json({ error: access.error }, { status: 403 })
    }

    const batch = await getProvizeHistoryBatchById(access, batchId)

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'B-ENERGY CRM'
    workbook.created = new Date()

    const summarySheet = workbook.addWorksheet('Souhrn')
    summarySheet.columns = [
      { header: 'Položka', key: 'label', width: 28 },
      { header: 'Hodnota', key: 'value', width: 28 },
    ]

    summarySheet.getRow(1).font = { bold: true }
    summarySheet.addRow(['Obchodník', batch.salesOwner])
    summarySheet.addRow(['Potvrzeno', formatDateTime(batch.confirmedAt)])
    summarySheet.addRow(['Počet zakázek', batch.itemCount])
    summarySheet.addRow(['Provize ze zakázek', batch.commissionSubtotal])
    summarySheet.addRow(['Bonusy a odpočty', batch.adjustmentTotal])
    summarySheet.addRow(['Celkem vyplaceno', batch.payoutTotal])
    summarySheet.addRow([])
    summarySheet.addRow(['Bonusy a odpočty', ''])
    summarySheet.getRow(summarySheet.lastRow?.number ?? 1).font = { bold: true }

    if (batch.adjustments.length === 0) {
      summarySheet.addRow(['Bez bonusů a odpočtů', ''])
    } else {
      batch.adjustments.forEach((item) => {
        summarySheet.addRow([
          `${item.itemType === 'bonus' ? 'Bonus' : 'Odpočet'}: ${item.label}`,
          item.itemType === 'bonus' ? item.amount : -item.amount,
        ])
      })
    }

    summarySheet.getColumn('B').numFmt = '#,##0 "Kč"'

    const detailSheet = workbook.addWorksheet('Zakázky')
    detailSheet.columns = [
      { header: 'Zakázka', key: 'jobNumber', width: 14 },
      { header: 'Firma', key: 'companyName', width: 28 },
      { header: 'Faktura', key: 'invoiceNumber', width: 18 },
      { header: 'Začátek', key: 'startAt', width: 22 },
      { header: 'Konec', key: 'endAt', width: 22 },
      { header: 'Adresa', key: 'siteAddress', width: 30 },
      { header: 'Prodejna', key: 'storeNumber', width: 12 },
      { header: 'Prodej', key: 'saleAmount', width: 14 },
      { header: 'Náklad', key: 'costAmount', width: 14 },
      { header: 'Zisk', key: 'profitAmount', width: 14 },
      { header: 'Sazba provize', key: 'commissionRate', width: 14 },
      { header: 'Provize', key: 'commissionAmount', width: 14 },
    ]

    detailSheet.getRow(1).font = { bold: true }

    batch.items.forEach((item) => {
      detailSheet.addRow({
        jobNumber: item.jobNumber,
        companyName: item.companyName,
        invoiceNumber: item.invoiceNumber,
        startAt: formatDateTime(item.startAt),
        endAt: formatDateTime(item.endAt),
        siteAddress: item.siteAddress ?? '',
        storeNumber: item.storeNumber ?? '',
        saleAmount: item.saleAmount,
        costAmount: item.costAmount,
        profitAmount: item.profitAmount,
        commissionRate: item.commissionRate,
        commissionAmount: item.commissionAmount,
      })
    })

    ;['H', 'I', 'J', 'L'].forEach((column) => {
      detailSheet.getColumn(column).numFmt = '#,##0 "Kč"'
    })
    detailSheet.getColumn('K').numFmt = '0%'

    const buffer = await workbook.xlsx.writeBuffer()

    return new NextResponse(buffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${buildFileName(batch.salesOwner, batch.confirmedAt)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const access = await requireProvizeHistoryAccess().catch(() => null)
    await reportRouteError({
      error,
      route: '/app/provize/vyplaty/[batchId]/export',
      section: 'provize',
      errorType: 'ProvizeBatchExportError',
      userId: access && access.success ? access.userId : null,
      context: { batchId },
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export dávky se nepodařil.' },
      { status: 500 }
    )
  }
}
