import { NextRequest, NextResponse } from 'next/server'
import { getReceivedInvoiceSignedUrl, getReceivedInvoices } from '@/lib/received-invoices/service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('mode') ?? 'list'

  try {
    if (mode === 'list') {
      const filter = request.nextUrl.searchParams.get('filter') ?? undefined
      const rows = await getReceivedInvoices({ filter, limit: 500 })
      return NextResponse.json({ success: true, error: null, rows })
    }

    if (mode === 'preview') {
      const invoiceId = request.nextUrl.searchParams.get('invoiceId') ?? ''
      const signedUrl = await getReceivedInvoiceSignedUrl({ invoiceId, download: false })
      return NextResponse.json({ success: true, error: null, signedUrl })
    }

    return NextResponse.json({ success: false, error: 'Neplatný režim požadavku.' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se načíst faktury.',
      rows: [],
      signedUrl: null,
    })
  }
}
