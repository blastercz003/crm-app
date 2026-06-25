import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { createClient } from '@/lib/supabase/server'
import type { SalesOwner, SortMode } from '../page'

type ProfileRoleRow = {
  role: string | null
}

type JobIdRow = {
  id: string
}

type JobFinanceJoinRow = {
  id: string
  job_id: string
  info_note: string | null
  invoice_number: string | null
  sale_amount: number | null
  cost_amount: number | null
  job:
    | {
        id: string
        job_number: string
        company_name: string
        contact_person: string | null
        sales_owner: SalesOwner
        start_at: string
        end_at: string
        site_address: string | null
        store_number: string | null
      }
    | {
        id: string
        job_number: string
        company_name: string
        contact_person: string | null
        sales_owner: SalesOwner
        start_at: string
        end_at: string
        site_address: string | null
        store_number: string | null
      }[]
    | null
}

type FakturaExportRow = {
  job_number: string
  company_name: string
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  info_note: string | null
  invoice_number: string | null
  sale_amount: number | null
  cost_amount: number | null
}

const SALES_OWNER_OPTIONS: SalesOwner[] = ['JIŘÍ', 'MICHAL', 'LÍDA']

function isSalesOwner(value: string | null): value is SalesOwner {
  return SALES_OWNER_OPTIONS.includes(value as SalesOwner)
}

function isSortMode(value: string | null): value is SortMode {
  return (
    value === 'start_nearest' ||
    value === 'job_number_desc' ||
    value === 'sale_desc'
  )
}

function isInvoicedFilter(value: string | null) {
  return value === 'yes' || value === 'no' ? value : ''
}

function sanitizeSearchTerm(search: string) {
  return search.replaceAll(',', ' ').trim()
}

function buildFinanceSearchFilter(search: string) {
  const escaped = sanitizeSearchTerm(search)

  return [
    `invoice_number.ilike.%${escaped}%`,
    `info_note.ilike.%${escaped}%`,
  ].join(',')
}

function buildJobSearchFilter(search: string) {
  const escaped = sanitizeSearchTerm(search)

  return [
    `job_number_search.ilike.%${escaped}%`,
    `company_name_search.ilike.%${escaped}%`,
    `contact_person_search.ilike.%${escaped}%`,
    `site_address_search.ilike.%${escaped}%`,
    `store_number_search.ilike.%${escaped}%`,
  ].join(',')
}

function getJobNumberSortValue(jobNumber: string) {
  const digits = String(jobNumber ?? '').match(/\d+/g)?.join('') ?? ''
  const parsed = Number(digits)
  return Number.isFinite(parsed) ? parsed : -1
}

function compareByJobNumberDesc(a: FakturaExportRow, b: FakturaExportRow) {
  const aValue = getJobNumberSortValue(a.job_number)
  const bValue = getJobNumberSortValue(b.job_number)

  if (bValue !== aValue) {
    return bValue - aValue
  }

  return String(b.job_number).localeCompare(String(a.job_number), 'cs')
}

function getProfit(saleAmount: number | null, costAmount: number | null) {
  const sale = typeof saleAmount === 'number' ? saleAmount : 0
  const cost = typeof costAmount === 'number' ? costAmount : 0
  return sale - cost
}

function formatDateTimeForExcel(value: string | null) {
  if (!value) return ''

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function buildFileName() {
  const now = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  return `faktury-${now}.xlsx`
}

export async function GET(request: NextRequest) {
  try {
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
      await reportRouteError({
        error: profileError,
        route: '/app/faktury/export',
        section: 'faktury',
        errorType: 'FakturyExportProfileError',
        userId: user.id,
      })
      return NextResponse.json(
        { error: 'Nepodařilo se ověřit oprávnění uživatele.' },
        { status: 500 }
      )
    }

    const typedProfile = profile as ProfileRoleRow | null

    if (typedProfile?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Nemáš oprávnění pro export fakturace.' },
        { status: 403 }
      )
    }

    const searchParams = request.nextUrl.searchParams

    const query = searchParams.get('q')?.trim() ?? ''
    const salesOwner = isSalesOwner(searchParams.get('sales'))
      ? (searchParams.get('sales') as SalesOwner)
      : ''
    const sort = isSortMode(searchParams.get('sort'))
      ? (searchParams.get('sort') as SortMode)
      : 'job_number_desc'
    const dateFrom = searchParams.get('date_from')?.trim() ?? ''
    const dateTo = searchParams.get('date_to')?.trim() ?? ''
    const invoiced = isInvoicedFilter(searchParams.get('invoiced'))

    let matchingJobIds: string[] = []

    if (query) {
      let jobsSearchRequest = supabase.from('jobs').select('id')

      if (salesOwner) {
        jobsSearchRequest = jobsSearchRequest.eq('sales_owner', salesOwner)
      }

      if (dateFrom) {
        jobsSearchRequest = jobsSearchRequest.gte('start_at', `${dateFrom}T00:00:00`)
      }

      if (dateTo) {
        jobsSearchRequest = jobsSearchRequest.lte('start_at', `${dateTo}T23:59:59`)
      }

      const { data: matchingJobs, error: matchingJobsError } =
        await jobsSearchRequest.or(buildJobSearchFilter(query))

      if (matchingJobsError) {
        await reportRouteError({
          error: matchingJobsError,
          route: '/app/faktury/export',
          section: 'faktury',
          errorType: 'FakturyExportJobsSearchError',
          userId: user.id,
          context: { query, salesOwner, dateFrom, dateTo },
        })
        return NextResponse.json(
          { error: 'Nepodařilo se načíst zakázky pro export.' },
          { status: 500 }
        )
      }

      matchingJobIds = ((matchingJobs ?? []) as JobIdRow[]).map((job) => job.id)
    }

    let requestBuilder = supabase.from('job_finances').select(`
      id,
      job_id,
      info_note,
      invoice_number,
      sale_amount,
      cost_amount,
      job:jobs!inner (
        id,
        job_number,
        company_name,
        contact_person,
        sales_owner,
        start_at,
        end_at,
        site_address,
        store_number
      )
    `)

    if (salesOwner) {
      requestBuilder = requestBuilder.eq('job.sales_owner', salesOwner)
    }

    if (dateFrom) {
      requestBuilder = requestBuilder.gte('job.start_at', `${dateFrom}T00:00:00`)
    }

    if (dateTo) {
      requestBuilder = requestBuilder.lte('job.start_at', `${dateTo}T23:59:59`)
    }

    if (invoiced === 'yes') {
      requestBuilder = requestBuilder.not('invoice_number', 'is', null)
    }

    if (invoiced === 'no') {
      requestBuilder = requestBuilder.is('invoice_number', null)
    }

    if (query) {
      const financeSearchFilter = buildFinanceSearchFilter(query)

      if (matchingJobIds.length > 0) {
        requestBuilder = requestBuilder.or(
          `${financeSearchFilter},job_id.in.(${matchingJobIds.join(',')})`
        )
      } else {
        requestBuilder = requestBuilder.or(financeSearchFilter)
      }
    }

    const { data, error } = await requestBuilder

    if (error) {
      await reportRouteError({
        error,
        route: '/app/faktury/export',
        section: 'faktury',
        errorType: 'FakturyExportQueryError',
        userId: user.id,
        context: { query, salesOwner, sort, dateFrom, dateTo, invoiced },
      })
      return NextResponse.json(
        { error: 'Nepodařilo se načíst fakturaci pro export.' },
        { status: 500 }
      )
    }

  let rows: FakturaExportRow[] = ((data ?? []) as JobFinanceJoinRow[])
    .map((item) => {
      const job = Array.isArray(item.job) ? item.job[0] : item.job

      if (!job) return null

      return {
        job_number: job.job_number,
        company_name: job.company_name,
        contact_person: job.contact_person,
        sales_owner: job.sales_owner,
        start_at: job.start_at,
        end_at: job.end_at,
        site_address: job.site_address,
        store_number: job.store_number,
        info_note: item.info_note,
        invoice_number: item.invoice_number,
        sale_amount:
          typeof item.sale_amount === 'number' ? item.sale_amount : null,
        cost_amount:
          typeof item.cost_amount === 'number' ? item.cost_amount : null,
      }
    })
    .filter((item): item is FakturaExportRow => Boolean(item))

  if (sort === 'start_nearest') {
    rows = [...rows].sort((a, b) => {
      const dateDiff =
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime()

      if (dateDiff !== 0) {
        return dateDiff
      }

      return compareByJobNumberDesc(a, b)
    })
  } else if (sort === 'sale_desc') {
    rows = [...rows].sort((a, b) => {
      const aSale = typeof a.sale_amount === 'number' ? a.sale_amount : -1
      const bSale = typeof b.sale_amount === 'number' ? b.sale_amount : -1

      if (bSale !== aSale) {
        return bSale - aSale
      }

      return compareByJobNumberDesc(a, b)
    })
  } else {
    rows = [...rows].sort(compareByJobNumberDesc)
  }

    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Faktury')

  worksheet.columns = [
    { header: 'Zakázka', key: 'job_number', width: 12 },
    { header: 'Obchodník', key: 'sales_owner', width: 12 },
    { header: 'Firma', key: 'company_name', width: 28 },
    { header: 'Osoba', key: 'contact_person', width: 20 },
    { header: 'Začátek', key: 'start_at', width: 22 },
    { header: 'Konec', key: 'end_at', width: 22 },
    { header: 'Adresa', key: 'site_address', width: 32 },
    { header: 'Prodejna', key: 'store_number', width: 12 },
    { header: 'Info', key: 'info_note', width: 24 },
    { header: 'Faktura', key: 'invoice_number', width: 16 },
    { header: 'Prodej', key: 'sale_amount', width: 14 },
    { header: 'Náklad', key: 'cost_amount', width: 14 },
    { header: 'Zisk', key: 'profit', width: 14 },
  ]

  worksheet.getRow(1).font = { bold: true }
  worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'left' }
  worksheet.getRow(1).height = 20

  rows.forEach((row) => {
    worksheet.addRow({
      job_number: row.job_number,
      sales_owner: row.sales_owner,
      company_name: row.company_name,
      contact_person: row.contact_person ?? '',
      start_at: formatDateTimeForExcel(row.start_at),
      end_at: formatDateTimeForExcel(row.end_at),
      site_address: row.site_address ?? '',
      store_number: row.store_number ?? '',
      info_note: row.info_note ?? '',
      invoice_number: row.invoice_number ?? '',
      sale_amount: row.sale_amount,
      cost_amount: row.cost_amount,
      profit: getProfit(row.sale_amount, row.cost_amount),
    })
  })

  const currencyColumns = ['K', 'L', 'M']
  currencyColumns.forEach((columnKey) => {
    worksheet.getColumn(columnKey).numFmt = '#,##0 "Kč"'
    worksheet.getColumn(columnKey).alignment = { horizontal: 'right' }
  })

  worksheet.getColumn('A').alignment = { horizontal: 'left' }
  worksheet.getColumn('B').alignment = { horizontal: 'left' }
  worksheet.getColumn('C').alignment = { horizontal: 'left' }
  worksheet.getColumn('D').alignment = { horizontal: 'left' }
  worksheet.getColumn('E').alignment = { horizontal: 'left' }
  worksheet.getColumn('F').alignment = { horizontal: 'left' }
  worksheet.getColumn('G').alignment = { horizontal: 'left' }
  worksheet.getColumn('H').alignment = { horizontal: 'left' }
  worksheet.getColumn('I').alignment = { horizontal: 'left' }
  worksheet.getColumn('J').alignment = { horizontal: 'left' }

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    row.height = 18

    const profitCell = row.getCell(13)
    const profitValue =
      typeof profitCell.value === 'number'
        ? profitCell.value
        : Number(profitCell.value ?? 0)

    if (profitValue < 0) {
      profitCell.font = { color: { argb: 'DC2626' }, bold: true }
    }
  })

    const buffer = await workbook.xlsx.writeBuffer()

    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${buildFileName()}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/app/faktury/export',
      section: 'faktury',
      errorType: 'FakturyExportUnhandledError',
    })

    return NextResponse.json(
      { error: 'Nepodařilo se vygenerovat export fakturace.' },
      { status: 500 }
    )
  }
}
