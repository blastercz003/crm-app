import { NextResponse } from 'next/server'
import { getOfferRuntimeContext } from '@/lib/offers/permissions'

const OFFER_ORDER_FILES_BUCKET = 'offer-orders'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function contentDisposition(fileName: string) {
  const fallback = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/["\\]/g, '-')

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await context.params
  if (!UUID_PATTERN.test(fileId)) {
    return NextResponse.json({ error: 'Neplatné ID souboru.' }, { status: 400 })
  }

  try {
    const { supabase } = await getOfferRuntimeContext()
    const { data, error } = await supabase
      .from('offer_order_files')
      .select('file_name, mime_type, storage_path')
      .eq('id', fileId)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Soubor nebyl nalezen.' }, { status: 404 })
    }

    const file = data as {
      file_name: string | null
      mime_type: string | null
      storage_path: string
    }
    const { data: content, error: downloadError } = await supabase.storage
      .from(OFFER_ORDER_FILES_BUCKET)
      .download(file.storage_path)

    if (downloadError || !content) {
      return NextResponse.json({ error: 'Soubor se nepodařilo stáhnout.' }, { status: 404 })
    }

    const bytes = new Uint8Array(await content.arrayBuffer())
    const fileName = String(file.file_name ?? 'podklad-k-objednavce').trim() || 'podklad-k-objednavce'

    return new NextResponse(bytes, {
      headers: {
        'Content-Type': String(file.mime_type ?? 'application/octet-stream'),
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': contentDisposition(fileName),
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Soubor se nepodařilo stáhnout.' }, { status: 500 })
  }
}
