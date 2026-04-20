import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'

type ProfileRoleRow = {
  role: string | null
}

type CostItemRow = {
  label: string
  unit_price: number | string | null
  quantity: number | string | null
  line_total: number | null
  sort_order: number | null
}

type FinanceExportRow = {
  id: string
  cost_amount: number | null
  job:
    | {
        job_number: string
        company_name: string
        sales_owner: string | null
        start_at: string
        end_at: string
      }
    | {
        job_number: string
        company_name: string
        sales_owner: string | null
        start_at: string
        end_at: string
      }[]
    | null
}

function formatDateTimeForExport(value: Date) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(value)
}

function buildFileName(jobNumber: string) {
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const safeJobNumber = jobNumber.replace(/[^\p{L}\p{N}-]+/gu, '-')
  return `naklady-${safeJobNumber}-${datePart}.xlsx`
}

function toFiniteNumber(value: number | string | null) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ financeId: string }> }
) {
  const { financeId } = await context.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nejsi přihlášený.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    return NextResponse.json(
      { error: 'Nepodařilo se ověřit oprávnění uživatele.' },
      { status: 500 }
    )
  }

  const typedProfile = profile as ProfileRoleRow | null

  if (typedProfile?.role !== 'admin') {
    return NextResponse.json(
      { error: 'Nemáš oprávnění pro export nákladů.' },
      { status: 403 }
    )
  }

  const normalizedFinanceId = String(financeId ?? '').trim()

  if (!normalizedFinanceId) {
    return NextResponse.json(
      { error: 'Chybí ID finančního záznamu.' },
      { status: 400 }
    )
  }

  const [{ data: financeRow, error: financeError }, { data: costItems, error: costError }] =
    await Promise.all([
      supabase
        .from('job_finances')
        .select(
          `
            id,
            cost_amount,
            job:jobs!inner (
              job_number,
              company_name,
              sales_owner,
              start_at,
              end_at
            )
          `
        )
        .eq('id', normalizedFinanceId)
        .single(),
      supabase
        .from('job_finance_cost_items')
        .select('label, unit_price, quantity, line_total, sort_order')
        .eq('job_finance_id', normalizedFinanceId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

  if (financeError || !financeRow) {
    return NextResponse.json(
      { error: 'Nepodařilo se načíst finanční záznam.' },
      { status: 404 }
    )
  }

  if (costError) {
    return NextResponse.json(
      { error: 'Nepodařilo se načíst nákladové položky.' },
      { status: 500 }
    )
  }

  const typedFinanceRow = financeRow as FinanceExportRow
  const job = Array.isArray(typedFinanceRow.job)
    ? typedFinanceRow.job[0]
    : typedFinanceRow.job

  if (!job) {
    return NextResponse.json(
      { error: 'Nepodařilo se načíst zakázku pro export nákladů.' },
      { status: 404 }
    )
  }

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Náklady')

  worksheet.columns = [
    { header: 'Položka', key: 'label', width: 30 },
    { header: 'Jednotková cena', key: 'unit_price', width: 18 },
    { header: 'Množství', key: 'quantity', width: 14 },
    { header: 'Cena', key: 'line_total', width: 16 },
  ]

  worksheet.insertRow(1, ['Zakázka', job.job_number])
  worksheet.insertRow(2, ['Firma', job.company_name])
  worksheet.insertRow(3, ['Obchodník', job.sales_owner ?? '—'])
  worksheet.insertRow(4, ['Začátek', formatDateTimeForExport(new Date(job.start_at))])
  worksheet.insertRow(5, ['Konec', formatDateTimeForExport(new Date(job.end_at))])
  worksheet.insertRow(6, ['Exportováno', formatDateTimeForExport(new Date())])
  worksheet.insertRow(7, [])

  const headerRow = worksheet.getRow(8)
  headerRow.values = ['Položka', 'Jednotková cena', 'Množství', 'Cena']
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' }
  headerRow.height = 20

  ;((costItems ?? []) as CostItemRow[]).forEach((item) => {
    worksheet.addRow({
      label: item.label,
      unit_price: toFiniteNumber(item.unit_price),
      quantity: toFiniteNumber(item.quantity),
      line_total: toFiniteNumber(item.line_total),
    })
  })

  const totalRow = worksheet.addRow({
    label: 'Celkový náklad',
    line_total: toFiniteNumber(typedFinanceRow.cost_amount),
  })

  totalRow.font = { bold: true }

  worksheet.getColumn('B').numFmt = '#,##0.00'
  worksheet.getColumn('C').numFmt = '#,##0.00'
  worksheet.getColumn('D').numFmt = '#,##0 "Kč"'

  worksheet.getColumn('A').alignment = { horizontal: 'left' }
  worksheet.getColumn('B').alignment = { horizontal: 'right' }
  worksheet.getColumn('C').alignment = { horizontal: 'right' }
  worksheet.getColumn('D').alignment = { horizontal: 'right' }

  worksheet.getCell('A1').font = { bold: true }
  worksheet.getCell('A2').font = { bold: true }
  worksheet.getCell('A3').font = { bold: true }
  worksheet.getCell('A4').font = { bold: true }
  worksheet.getCell('A5').font = { bold: true }
  worksheet.getCell('A6').font = { bold: true }
  worksheet.getCell(`A${totalRow.number}`).font = { bold: true }
  worksheet.getCell(`D${totalRow.number}`).font = { bold: true }

  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${buildFileName(job.job_number)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
